import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { eventSource, event_types } from '../../../events.js';
import { macros } from '../../../macros/macro-system.js';

const MODULE = 'preferenceRoulette';
const FOLDER = 'third-party/st-preference-roulette';

const defaults = {
    enabled: true,
    keywords: '',
    every: 5,
    current: '',
    counter: 0,
};

function settings() {
    if (!extension_settings[MODULE]) {
        extension_settings[MODULE] = structuredClone(defaults);
    }
    for (const key of Object.keys(defaults)) {
        if (extension_settings[MODULE][key] === undefined) {
            extension_settings[MODULE][key] = defaults[key];
        }
    }
    return extension_settings[MODULE];
}

function parseKeywords(text) {
    return String(text ?? '')
        .split(',')
        .map(k => k.trim())
        .filter(Boolean);
}

/** Pick a new random keyword, avoiding an immediate repeat when possible. */
function reroll() {
    const s = settings();
    const list = parseKeywords(s.keywords);

    if (list.length === 0) {
        s.current = '';
    } else {
        const pool = list.length > 1 ? list.filter(k => k !== s.current) : list;
        s.current = pool[Math.floor(Math.random() * pool.length)];
    }

    s.counter = 0;
    saveSettingsDebounced();
    updateStatus();
}

/** Count bot replies; reroll once the user-chosen interval is reached. */
function onMessageReceived(messageIndex) {
    const s = settings();
    if (!s.enabled) return;

    const ctx = SillyTavern.getContext();
    const message = ctx.chat?.[messageIndex];
    if (!message || message.is_user || message.is_system) return;

    s.counter += 1;

    if (s.counter >= Math.max(1, Number(s.every) || 1)) {
        reroll();
    } else {
        saveSettingsDebounced();
        updateStatus();
    }
}

function registerMacro() {
    const handler = () => settings().current ?? '';

    if (macros?.register) {
        macros.register('preference', {
            description: 'The keyword currently chosen by Preference Roulette',
            handler,
        });
        return;
    }

    // Fallback for older SillyTavern builds.
    const ctx = SillyTavern.getContext();
    if (typeof ctx.registerMacro === 'function') {
        ctx.registerMacro('preference', handler);
    } else {
        console.warn('[Preference Roulette] No macro registration API found; {{preference}} will not work.');
    }
}

function updateStatus() {
    const s = settings();
    const every = Math.max(1, Number(s.every) || 1);
    const remaining = Math.max(0, every - s.counter);
    const label = s.current ? `Current: "${s.current}"` : 'No keyword chosen';
    $('#pr_status').text(`${label} · reroll in ${remaining} repl${remaining === 1 ? 'y' : 'ies'}`);
}

async function mountSettings() {
    const html = await $.get(`/scripts/extensions/${FOLDER}/settings.html`);
    $('#extensions_settings2').append(html);

    const s = settings();
    $('#pr_enabled').prop('checked', s.enabled);
    $('#pr_keywords').val(s.keywords);
    $('#pr_every').val(s.every);

    $('#pr_enabled').on('change', function () {
        settings().enabled = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#pr_keywords').on('input', function () {
        const st = settings();
        st.keywords = $(this).val();
        // If the current keyword was removed from the list, pick a fresh one.
        if (st.current && !parseKeywords(st.keywords).includes(st.current)) {
            reroll();
        }
        saveSettingsDebounced();
    });

    $('#pr_every').on('input', function () {
        const n = Math.max(1, parseInt($(this).val(), 10) || 1);
        settings().every = n;
        saveSettingsDebounced();
        updateStatus();
    });

    $('#pr_reroll').on('click', reroll);

    updateStatus();
}

jQuery(async () => {
    settings();
    registerMacro();
    await mountSettings();

    // If nothing has been chosen yet, choose one now.
    if (!settings().current) reroll();

    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
});
