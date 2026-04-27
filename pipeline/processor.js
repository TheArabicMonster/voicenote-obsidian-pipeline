const https = require('https');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-70b-versatile';
const TIMEOUT_MS = 30000;

function buildSystemPrompt(categories) {
    const catList = categories.length > 0
        ? categories.map(c => `- ${c.path}${c.description ? ' : ' + c.description : ''}`).join('\n')
        : '- Aucune catégorie définie — suggère une catégorie appropriée';

    return `Tu es un assistant de gestion de connaissances personnelles.
Tu reçois une transcription brute d'un message vocal ou texte en français
(hésitations, langage oral, fautes possibles).

Catégories disponibles dans la vault :
${catList}

RÈGLES DE CATÉGORISATION :
1. Analyse le sens profond de l'idée, pas juste les mots-clés.
2. Si une catégorie existante correspond bien → utilise-la.
3. Si l'idée est proche d'une catégorie sans être exactement dedans
   → rattache-la à la catégorie la plus proche ET justifie ton choix.
4. Si aucune catégorie ne convient réellement → propose une nouvelle
   catégorie avec un nom et une description clairs, et mets
   "nouvelle_categorie": true dans ta réponse.

Retourne UNIQUEMENT un JSON valide, sans markdown, sans explication :
{
  "titre": "Titre court et clair (max 60 caractères)",
  "contenu": "Description reformulée, concise, phrase nominale ou infinitif",
  "categorie": "chemin/exact/de/la/categorie",
  "nouvelle_categorie": false,
  "nouvelle_categorie_description": "",
  "raisonnement": "Pourquoi ce choix de catégorie (1 phrase)",
  "tags": ["tag1", "tag2"],
  "priorite": "haute | normale | basse"
}

Ne reformule pas excessivement. Garde l'intention originale. Sois concis.`;
}

function httpsRequest(options, body) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Groq API timeout (30s)')), TIMEOUT_MS);

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                clearTimeout(timer);
                if (res.statusCode >= 400) {
                    reject(new Error(`Groq API HTTP ${res.statusCode}: ${data}`));
                    return;
                }
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Groq API invalid JSON: ${data.slice(0, 200)}`));
                }
            });
        });

        req.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });

        req.write(body);
        req.end();
    });
}

function parseGroqResponse(content) {
    // Strip potential markdown code fences
    const cleaned = content
        .replace(/^```(?:json)?\n?/m, '')
        .replace(/\n?```$/m, '')
        .trim();

    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        // Best-effort: try to extract JSON object
        const match = cleaned.match(/\{[\s\S]+\}/);
        if (!match) throw new Error(`Cannot parse Groq response: ${cleaned.slice(0, 300)}`);
        parsed = JSON.parse(match[0]);
    }

    // Normalize and validate fields
    return {
        titre: String(parsed.titre || 'Note sans titre').slice(0, 60),
        contenu: String(parsed.contenu || ''),
        categorie: String(parsed.categorie || '_Inbox'),
        nouvelle_categorie: Boolean(parsed.nouvelle_categorie),
        nouvelle_categorie_description: String(parsed.nouvelle_categorie_description || ''),
        raisonnement: String(parsed.raisonnement || ''),
        tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
        priorite: ['haute', 'normale', 'basse'].includes(parsed.priorite) ? parsed.priorite : 'normale',
    };
}

/**
 * @param {string} rawText - Raw transcription or text message
 * @param {Array} categories - Array of category objects from categories.json
 * @returns {Promise<Object>} Parsed AI response
 */
async function callGroqAPI(rawText, categories) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set');

    const systemPrompt = buildSystemPrompt(categories);
    const requestBody = JSON.stringify({
        model: GROQ_MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: rawText },
        ],
        temperature: 0.3,
        max_tokens: 512,
    });

    const url = new URL(GROQ_API_URL);
    const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody),
        },
    };

    const t0 = Date.now();
    console.log('[groq] Appel API...');

    const response = await httpsRequest(options, requestBody);
    const elapsed = Date.now() - t0;
    console.log(`[groq] Réponse reçue (${elapsed}ms)`);

    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error('Groq API returned empty content');

    return parseGroqResponse(content);
}

module.exports = { callGroqAPI, buildSystemPrompt };
