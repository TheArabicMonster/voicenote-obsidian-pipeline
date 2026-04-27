'use strict';

require('dotenv').config();
const fs = require('fs');

const { loadConfig } = require('./config/loader');
const queue = require('./pipeline/queue');
const { callGroqAPI } = require('./pipeline/processor');
const { loadCategories, addCategory } = require('./pipeline/categories');
const { writeNote } = require('./pipeline/vaultWriter');
const {
    convertToWav,
    transcribeWhisper,
    saveAudio,
    purgeStaleAudioFiles,
} = require('./pipeline/transcriber');
const {
    addPending,
    removePending,
    getPendingByFrom,
    recoverPendingOnStartup,
    startTimeoutWatcher,
} = require('./pipeline/pending');

// CLI flags: --wa or --tg override config channels
const cliArgs = process.argv.slice(2);
const forceWA = cliArgs.includes('--wa');
const forceTG = cliArgs.includes('--tg');

async function main() {
    console.log('[voicenote] Démarrage du pipeline...');

    const config = loadConfig();

    // Propagate config values to env so pipeline modules can read them directly
    process.env.VAULT_PATH = config.vault.path;
    process.env.CATEGORIES_FILE = config.vault.categoriesFile;
    process.env.PENDING_FILE = config.pipeline.pendingFile;
    process.env.WHISPER_MODEL = config.whisper.model;
    process.env.WHISPER_LANGUAGE = config.whisper.language;
    process.env.CATEGORY_APPROVAL_TIMEOUT_MIN = String(config.pipeline.categoryApprovalTimeoutMin);

    const useWA = forceWA || (!forceTG && config.channels.whatsapp.enabled);
    const useTG = forceTG || (!forceWA && config.channels.telegram.enabled);

    const adapters = {};

    if (useWA) {
        const WhatsAppAdapter = require('./adapters/whatsapp');
        adapters['whatsapp'] = new WhatsAppAdapter({
            allowedNumber: config.channels.whatsapp.allowedNumber,
            sessionPath: config.channels.whatsapp.sessionPath,
            tmpPath: config.pipeline.audioTmpPath,
        });
    }

    if (useTG) {
        const TelegramAdapter = require('./adapters/telegram');
        adapters['telegram'] = new TelegramAdapter({
            token: config.channels.telegram.token,
            allowedUserId: config.channels.telegram.allowedUserId,
        });
    }

    purgeStaleAudioFiles();
    await recoverPendingOnStartup(adapters);

    const watcherInterval = startTimeoutWatcher(adapters);

    for (const [channelId, adapter] of Object.entries(adapters)) {
        adapter.on('message', (normalized, rawMsg) => {
            handleMessage(normalized, rawMsg, adapters).catch(err => {
                console.error(`[voicenote] Erreur non gérée (${channelId}):`, err.message);
            });
        });
        await adapter.connect();
        console.log(`[voicenote] ${channelId} connecté`);
    }

    console.log('[voicenote] Pipeline prêt. En attente de messages...');

    const shutdown = async (signal) => {
        console.log(`\n[voicenote] Signal ${signal} reçu — arrêt propre...`);
        clearInterval(watcherInterval);
        for (const adapter of Object.values(adapters)) {
            try { await adapter.disconnect?.(); } catch {}
        }
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

// ── Message dispatch ─────────────────────────────────────────────────────────

async function handleMessage(normalized, rawMsg, adapters) {
    const { type, text } = normalized;

    if (type === 'text') {
        const upperText = text.trim().toUpperCase();
        if (upperText === 'OUI' || upperText === 'NON') {
            const pending = getPendingByFrom(normalized.from);
            if (pending) {
                await handleCategoryApproval(normalized, upperText, pending, adapters);
                return;
            }
        }
        await handleTextMessage(normalized, adapters);
    } else if (type === 'voice') {
        await handleVoiceMessage(normalized, rawMsg, adapters);
    }
}

// ── Voice handler ─────────────────────────────────────────────────────────────

async function handleVoiceMessage(normalized, rawMsg, adapters) {
    const adapter = adapters[normalized.channelId];
    await adapter.send(normalized.from, '🎙️ Message vocal reçu — transcription en cours...');

    queue.enqueue(async () => {
        await runVoicePipeline(normalized, rawMsg, adapters);
    });
}

async function runVoicePipeline(normalized, rawMsg, adapters) {
    const adapter = adapters[normalized.channelId];
    let oggPath, wavPath;

    try {
        const mediaData = await adapter.downloadAudio(rawMsg);
        const saved = saveAudio(mediaData);
        oggPath = saved.oggPath;
        wavPath = saved.wavPath;

        await convertToWav(oggPath, wavPath);
        const transcribedText = await transcribeWhisper(wavPath);

        if (!transcribedText || !transcribedText.trim()) {
            await adapter.send(normalized.from, '⚠️ Transcription vide — message vocal non compris.');
            return;
        }

        console.log(`[voicenote] Transcription: "${transcribedText.slice(0, 80)}..."`);
        await runAIPipeline(normalized, transcribedText, `${normalized.channelId}-vocal`, adapters);
    } catch (err) {
        console.error('[voicenote] Erreur pipeline vocal:', err.message);
        await adapter.send(
            normalized.from,
            `❌ Erreur traitement vocal : ${err.message}`
        ).catch(() => {});
    } finally {
        if (oggPath) try { fs.unlinkSync(oggPath); } catch {}
        if (wavPath) try { fs.unlinkSync(wavPath); } catch {}
    }
}

// ── Text handler ──────────────────────────────────────────────────────────────

async function handleTextMessage(normalized, adapters) {
    const adapter = adapters[normalized.channelId];
    await adapter.send(normalized.from, '✍️ Message reçu — traitement en cours...');
    await runAIPipeline(normalized, normalized.text, `${normalized.channelId}-texte`, adapters);
}

// ── Category approval handler ─────────────────────────────────────────────────

async function handleCategoryApproval(normalized, reply, pending, adapters) {
    const adapter = adapters[normalized.channelId];

    if (reply === 'OUI') {
        addCategory(pending.suggestedCategory, pending.suggestedDescription);
        writeNote(pending.note, pending.suggestedCategory);
        removePending(pending.id);
        await adapter.send(
            normalized.from,
            `✅ Catégorie *${pending.suggestedCategory}* créée et note archivée.`
        );
    } else {
        writeNote(
            { ...pending.note, categorie_suggeree: pending.suggestedCategory },
            '_Inbox'
        );
        removePending(pending.id);
        await adapter.send(
            normalized.from,
            `📥 Note placée en _Inbox avec catégorie suggérée conservée dans le frontmatter.`
        );
    }

    // Surface next pending proposal for this sender (FIFO)
    const next = getPendingByFrom(normalized.from);
    if (next) {
        const mins = Math.max(0, Math.round((new Date(next.expiresAt) - new Date()) / 60000));
        await adapter.send(
            normalized.from,
            `Proposition suivante :\n\n` +
            `Nouvelle catégorie : *${next.suggestedCategory}*\n` +
            `→ ${next.suggestedDescription}\n\n` +
            `Réponds *OUI* pour créer, *NON* pour mettre en _Inbox\n` +
            `(Expire dans ${mins} min)`
        );
    }
}

// ── Shared AI pipeline (voice + text) ────────────────────────────────────────

async function runAIPipeline(normalized, rawText, source, adapters) {
    const adapter = adapters[normalized.channelId];

    let aiResult;
    try {
        const categories = loadCategories();
        aiResult = await callGroqAPI(rawText, categories);
    } catch (err) {
        console.error('[voicenote] Erreur Groq API:', err.message);
        writeNote({
            titre: 'Note brute (erreur IA)',
            contenu: rawText,
            rawText,
            source,
            tags: ['a-classer', 'erreur-ia'],
            priorite: 'normale',
        }, '_Inbox');
        await adapter.send(
            normalized.from,
            `⚠️ IA indisponible — note brute archivée en _Inbox.`
        ).catch(() => {});
        return;
    }

    const noteData = {
        titre: aiResult.titre,
        contenu: aiResult.contenu,
        rawText,
        source,
        tags: aiResult.tags,
        priorite: aiResult.priorite,
        raisonnement: aiResult.raisonnement,
    };

    if (aiResult.nouvelle_categorie) {
        const timeoutMin = parseInt(process.env.CATEGORY_APPROVAL_TIMEOUT_MIN || '10');
        const now = new Date();
        const expiresAt = new Date(now.getTime() + timeoutMin * 60 * 1000).toISOString();

        const entry = {
            id: `${normalized.channelId}-${normalized.from}-${Date.now()}`,
            from: normalized.from,
            channelId: normalized.channelId,
            status: 'pending',
            suggestedCategory: aiResult.categorie,
            suggestedDescription: aiResult.nouvelle_categorie_description,
            proposedAt: now.toISOString(),
            expiresAt,
            note: noteData,
        };

        addPending(entry);
        await adapter.send(
            normalized.from,
            `💡 L'IA suggère une nouvelle catégorie :\n\n` +
            `*${aiResult.categorie}*\n` +
            `→ ${aiResult.nouvelle_categorie_description}\n\n` +
            `Réponds *OUI* pour créer la catégorie et archiver la note.\n` +
            `Réponds *NON* pour mettre la note en _Inbox.\n` +
            `(Expire dans ${timeoutMin} min)`
        );
    } else {
        writeNote(noteData, aiResult.categorie);
        const msg = `✅ Note archivée dans *${aiResult.categorie}*\n📝 "${aiResult.titre}"` +
            (aiResult.raisonnement ? `\n💭 ${aiResult.raisonnement}` : '');
        await adapter.send(normalized.from, msg);
    }
}

main().catch(err => {
    console.error('[voicenote] Erreur fatale:', err.message);
    process.exit(1);
});
