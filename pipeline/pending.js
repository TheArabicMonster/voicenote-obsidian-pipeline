'use strict';

const fs = require('fs');
const path = require('path');
const { writeNote } = require('./vaultWriter');

/**
 * Return the absolute path to the pending proposals JSON file.
 * Defaults to <repo-root>/pending.json; overridable via PENDING_FILE env var.
 *
 * @returns {string}
 */
function getPendingFile() {
    return process.env.PENDING_FILE || path.join(__dirname, '..', 'pending.json');
}

/**
 * Load the full list of pending entries from disk.
 * Returns an empty array when the file does not exist or is malformed.
 *
 * @returns {Array<object>}
 */
function loadPending() {
    const file = getPendingFile();
    if (!fs.existsSync(file)) return [];
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')).pending || [];
    } catch {
        return [];
    }
}

/**
 * Persist the given entries array to disk atomically (overwrite).
 *
 * @param {Array<object>} entries
 */
function savePending(entries) {
    fs.writeFileSync(getPendingFile(), JSON.stringify({ pending: entries }, null, 2), 'utf8');
}

/**
 * Append a new proposal entry to the pending store.
 *
 * Expected entry shape:
 * {
 *   id:                    string  — unique identifier (e.g. `${channelId}-${from}-${Date.now()}`)
 *   from:                  string  — sender identifier (phone / Telegram user-id)
 *   channelId:             string  — 'telegram' | 'whatsapp'
 *   status:                'pending'
 *   suggestedCategory:     string  — new category path suggested by the AI
 *   suggestedDescription:  string  — one-line description of the new category
 *   proposedAt:            string  — ISO 8601 timestamp
 *   expiresAt:             string  — ISO 8601 timestamp (proposedAt + TTL)
 *   note: {
 *     titre:   string
 *     contenu: string
 *     rawText: string
 *     source:  string
 *     tags:    string[]
 *     priorite: string
 *     raisonnement: string
 *   }
 * }
 *
 * @param {object} entry
 */
function addPending(entry) {
    const entries = loadPending();
    entries.push(entry);
    savePending(entries);
    console.log(`[pending] Ajouté: ${entry.id} — catégorie suggérée: ${entry.suggestedCategory}`);
}

/**
 * Remove a pending entry by its id.
 *
 * @param {string} id
 */
function removePending(id) {
    const entries = loadPending().filter(e => e.id !== id);
    savePending(entries);
    console.log(`[pending] Supprimé: ${id}`);
}

/**
 * Return the oldest non-expired pending entry for a given sender (FIFO order).
 * Only entries with status === 'pending' and a future expiresAt are returned.
 *
 * @param {string} from  — sender identifier
 * @returns {object|null}
 */
function getPendingByFrom(from) {
    return loadPending()
        .filter(e => e.from === from && e.status === 'pending' && new Date(e.expiresAt) > new Date())
        .sort((a, b) => new Date(a.proposedAt) - new Date(b.proposedAt))[0] || null;
}

/**
 * Calculate the number of whole minutes remaining until the given ISO timestamp.
 * Returns 0 when the timestamp is already in the past.
 *
 * @param {string} expiresAt  ISO 8601 string
 * @returns {number}
 */
function minutesRemaining(expiresAt) {
    return Math.max(0, Math.round((new Date(expiresAt) - new Date()) / 60000));
}

/**
 * Called once at bot startup.
 *
 * For every persisted proposal:
 *   - Expired entries  → filed to _Inbox via writeNote(), then removed from store.
 *   - Live entries     → re-sent to the originating sender via the matching adapter
 *                        so the user knows the proposal is still awaiting their reply.
 *
 * @param {Object.<string, import('../adapters/base')>} adapters
 *   Map of channelId → ChannelAdapter instance (must implement send(to, text)).
 * @returns {Promise<void>}
 */
async function recoverPendingOnStartup(adapters) {
    const entries = loadPending();
    const now = new Date();
    let recovered = 0;
    let expired = 0;

    for (const entry of entries) {
        if (new Date(entry.expiresAt) <= now) {
            await writeNote(
                { ...entry.note, categorie_suggeree: entry.suggestedCategory },
                '_Inbox'
            );
            removePending(entry.id);
            expired++;
        } else {
            const adapter = adapters[entry.channelId];
            if (adapter) {
                const mins = minutesRemaining(entry.expiresAt);
                await adapter.send(
                    entry.from,
                    `Proposition en attente (reprise apres redemarrage)\n\n` +
                    `Nouvelle categorie : *${entry.suggestedCategory}*\n` +
                    `-> ${entry.suggestedDescription}\n\n` +
                    `Reponds *OUI* pour creer, *NON* pour mettre en _Inbox\n` +
                    `(Expire dans ${mins} min)`
                );
            }
            recovered++;
        }
    }

    if (recovered > 0 || expired > 0) {
        console.log(`[pending] Demarrage: ${recovered} relancee(s), ${expired} expiree(s) -> _Inbox`);
    }
}

/**
 * Start a periodic watcher (every 60 seconds) that detects proposals whose
 * timeout has elapsed while the bot is running.
 *
 * For each expired proposal the note is filed to _Inbox and the sender receives
 * a timeout notification via the matching adapter.
 *
 * @param {Object.<string, import('../adapters/base')>} adapters
 *   Map of channelId → ChannelAdapter instance (must implement send(to, text)).
 * @returns {NodeJS.Timeout}  The interval handle (call clearInterval() to stop).
 */
function startTimeoutWatcher(adapters) {
    return setInterval(async () => {
        const entries = loadPending();
        const now = new Date();

        for (const entry of entries) {
            if (entry.status === 'pending' && new Date(entry.expiresAt) <= now) {
                await writeNote(
                    { ...entry.note, categorie_suggeree: entry.suggestedCategory },
                    '_Inbox'
                );
                removePending(entry.id);

                const adapter = adapters[entry.channelId];
                if (adapter) {
                    await adapter.send(
                        entry.from,
                        `Timeout — la note *"${entry.note.titre}"* a ete placee en _Inbox.\n` +
                        `Categorie suggeree conservee dans le frontmatter : ${entry.suggestedCategory}`
                    );
                }
            }
        }
    }, 60 * 1000);
}

module.exports = {
    addPending,
    removePending,
    getPendingByFrom,
    recoverPendingOnStartup,
    startTimeoutWatcher,
};
