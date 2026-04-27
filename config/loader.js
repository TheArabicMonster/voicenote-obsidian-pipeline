const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const CONFIG_FILE = path.join(__dirname, '..', 'config.yaml');

let _config = null;

function loadConfig() {
    if (_config) return _config;

    if (!fs.existsSync(CONFIG_FILE)) {
        throw new Error(
            `config.yaml not found. Run "voicenote setup" first.\nExpected: ${CONFIG_FILE}`
        );
    }

    const raw = yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8'));
    _config = {
        channels: {
            whatsapp: {
                enabled: raw.channels?.whatsapp?.enabled ?? false,
                allowedNumber: process.env.WA_ALLOWED_NUMBER || raw.channels?.whatsapp?.allowedNumber,
                sessionPath: raw.channels?.whatsapp?.sessionPath || '.wwebjs_auth',
            },
            telegram: {
                enabled: raw.channels?.telegram?.enabled ?? false,
                allowedUserId: process.env.TG_ALLOWED_USER_ID || String(raw.channels?.telegram?.allowedUserId || ''),
                token: process.env.TG_BOT_TOKEN,
            },
        },
        vault: {
            path: process.env.VAULT_PATH || raw.vault?.path,
            categoriesFile: process.env.CATEGORIES_FILE || path.join(process.env.VAULT_PATH || raw.vault?.path, raw.vault?.categoriesFile || 'categories.json'),
            inboxFolder: raw.vault?.inboxFolder || '_Inbox',
            inboxTag: raw.vault?.inboxTag || 'a-classer',
        },
        whisper: {
            model: process.env.WHISPER_MODEL || raw.whisper?.model || 'medium',
            language: process.env.WHISPER_LANGUAGE || raw.whisper?.language || 'fr',
        },
        pipeline: {
            categoryApprovalTimeoutMin: parseInt(
                process.env.CATEGORY_APPROVAL_TIMEOUT_MIN || raw.pipeline?.categoryApprovalTimeoutMin || 10
            ),
            audioTmpPath: process.env.TMP_PATH || raw.pipeline?.audioTmpPath || path.join(__dirname, '..', 'tmp', 'audio'),
            pendingFile: process.env.PENDING_FILE || path.join(__dirname, '..', 'pending.json'),
        },
        api: {
            groqApiKey: process.env.GROQ_API_KEY,
        },
    };

    validate(_config);
    return _config;
}

function validate(config) {
    const errors = [];

    if (!config.vault.path) errors.push('VAULT_PATH is required');
    if (!config.api.groqApiKey) errors.push('GROQ_API_KEY is required in .env');

    const waEnabled = config.channels.whatsapp.enabled;
    const tgEnabled = config.channels.telegram.enabled;

    if (!waEnabled && !tgEnabled) {
        errors.push('At least one channel (whatsapp or telegram) must be enabled in config.yaml');
    }
    if (waEnabled && !config.channels.whatsapp.allowedNumber) {
        errors.push('WA_ALLOWED_NUMBER is required when WhatsApp is enabled');
    }
    if (tgEnabled && !config.channels.telegram.token) {
        errors.push('TG_BOT_TOKEN is required in .env when Telegram is enabled');
    }
    if (tgEnabled && !config.channels.telegram.allowedUserId) {
        errors.push('TG_ALLOWED_USER_ID is required when Telegram is enabled');
    }

    if (errors.length > 0) {
        throw new Error(`Configuration errors:\n${errors.map(e => '  - ' + e).join('\n')}`);
    }
}

function resetConfig() {
    _config = null;
}

module.exports = { loadConfig, resetConfig };
