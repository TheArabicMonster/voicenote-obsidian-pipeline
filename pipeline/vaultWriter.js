const fs = require('fs');
const path = require('path');

/**
 * Slugify a title without external dependencies.
 * Lowercases, strips diacritics, replaces non-alphanumeric runs with hyphens,
 * trims leading/trailing hyphens, and caps at 60 characters.
 *
 * @param {string} text
 * @returns {string}
 */
function slugify(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
}

/**
 * Format a Date as "YYYY-MM-DDTHH-MM" for use in filenames.
 *
 * @param {Date} date
 * @returns {string}
 */
function formatDateForFilename(date) {
    const pad = n => String(n).padStart(2, '0');
    return (
        date.getFullYear() +
        '-' + pad(date.getMonth() + 1) +
        '-' + pad(date.getDate()) +
        '_' + pad(date.getHours()) +
        '-' + pad(date.getMinutes())
    );
}

/**
 * Format a Date as ISO 8601 without milliseconds.
 *
 * @param {Date} date
 * @returns {string}
 */
function formatDateISO(date) {
    const pad = n => String(n).padStart(2, '0');
    return (
        date.getFullYear() +
        '-' + pad(date.getMonth() + 1) +
        '-' + pad(date.getDate()) +
        'T' + pad(date.getHours()) +
        ':' + pad(date.getMinutes()) +
        ':' + pad(date.getSeconds())
    );
}

/**
 * Determine whether the message source is a voice note or plain text based on
 * the source identifier convention: "<channel>-vocal" | "<channel>-texte".
 *
 * @param {string} source  e.g. "telegram-vocal" or "whatsapp-texte"
 * @returns {"vocal"|"texte"}
 */
function sourceType(source) {
    return source && source.endsWith('-vocal') ? 'vocal' : 'texte';
}

/**
 * Build the YAML frontmatter block for a note.
 *
 * @param {object} noteData
 * @param {string} categoryPath
 * @param {Date}   date
 * @returns {string}
 */
function buildFrontmatter(noteData, categoryPath, date) {
    const { source, tags = [], priorite = 'normale', raisonnement, categorie_suggeree } = noteData;
    const isInbox = categoryPath === '_Inbox';

    const effectiveTags = isInbox ? ['a-classer'] : tags;
    const statut = isInbox ? 'a-classer' : 'nouveau';

    const tagsFormatted = '[' + effectiveTags.map(t => t).join(', ') + ']';

    let frontmatter = '---\n';
    frontmatter += `date: ${formatDateISO(date)}\n`;
    frontmatter += `source: ${source || 'unknown'}\n`;
    frontmatter += `categorie: ${categoryPath}\n`;
    frontmatter += `tags: ${tagsFormatted}\n`;
    frontmatter += `priorite: ${priorite}\n`;
    frontmatter += `statut: ${statut}\n`;
    if (raisonnement) {
        frontmatter += `raisonnement_ia: "${raisonnement.replace(/"/g, '\\"')}"\n`;
    }
    if (isInbox && categorie_suggeree) {
        frontmatter += `categorie_suggeree: ${categorie_suggeree}\n`;
    }
    frontmatter += '---';
    return frontmatter;
}

/**
 * Build the Markdown body of a note.
 *
 * @param {object} noteData
 * @returns {string}
 */
function buildBody(noteData, categoryPath) {
    const { titre, contenu, rawText, source } = noteData;
    const type = sourceType(source);
    const isInbox = categoryPath === '_Inbox';

    const originalLabel = (type === 'vocal' || isInbox)
        ? '*Transcription originale :*'
        : '*Message original :*';

    return `# ${titre}\n\n${contenu}\n\n---\n${originalLabel} "${rawText}"`;
}

/**
 * Write a Markdown note into the Obsidian vault.
 *
 * @param {object} noteData
 *   @property {string}   titre               Note title
 *   @property {string}   contenu             AI-reformulated content
 *   @property {string}   rawText             Original transcription / message
 *   @property {string}   source              Channel identifier, e.g. "telegram-vocal"
 *   @property {string[]} [tags]              Array of tag strings
 *   @property {string}   [priorite]          Priority level (default: "normale")
 *   @property {string}   [raisonnement]      AI reasoning for category choice
 *   @property {string}   [categorie_suggeree] Suggested category when filing to _Inbox
 * @param {string} categoryPath  Vault-relative path such as "Projets/Tech" or "_Inbox"
 * @returns {string} Absolute path of the written file
 */
function writeNote(noteData, categoryPath) {
    const vaultPath = process.env.VAULT_PATH || '';
    const now = new Date();

    // Build filename: YYYY-MM-DD_HH-MM_slug.md
    const slug = slugify(noteData.titre || 'note');
    const datePart = formatDateForFilename(now);
    const filename = `${datePart}_${slug}.md`;

    // Resolve and ensure destination directory exists
    const destDir = path.join(vaultPath, categoryPath);
    fs.mkdirSync(destDir, { recursive: true });

    const filePath = path.join(destDir, filename);

    // Assemble note content
    const frontmatter = buildFrontmatter(noteData, categoryPath, now);
    const body = buildBody(noteData, categoryPath);
    const content = `${frontmatter}\n\n${body}\n`;

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[vault] Note écrite : ${filePath}`);

    return filePath;
}

module.exports = { writeNote, slugify };
