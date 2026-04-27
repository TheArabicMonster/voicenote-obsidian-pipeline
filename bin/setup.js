#!/usr/bin/env node
'use strict';

// Wizard CLI — voicenote setup
// Uses inquirer v9 (dynamic import required for ESM-only package)

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { initCategories } = require('../pipeline/categories');

const PROJECT_ROOT = path.resolve(__dirname, '..');

async function run() {
    // inquirer v9 is ESM-only — dynamic import required from CJS
    const { default: inquirer } = await import('inquirer');
    const { default: chalk } = await import('chalk');

    console.log('\n' + chalk.bold.yellow('╔══════════════════════════════════════════╗'));
    console.log(chalk.bold.yellow('║') + chalk.bold('   VoiceNote → Obsidian  Setup            ') + chalk.bold.yellow('║'));
    console.log(chalk.bold.yellow('╚══════════════════════════════════════════╝'));
    console.log('\nBienvenue ! Ce wizard va configurer ton pipeline de capture d\'idées.\n');

    // ── Étape 1 — Canal(aux) ──────────────────────────────────────────────
    console.log(chalk.cyan('── Étape 1 / 5 — Canal(aux) de messagerie ─────────\n'));

    const { channels } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'channels',
        message: 'Quel(s) canal(aux) veux-tu activer ?',
        choices: [
            { name: 'WhatsApp', value: 'whatsapp' },
            { name: 'Telegram', value: 'telegram' },
        ],
        validate: (v) => v.length > 0 || 'Sélectionne au moins un canal.',
    }]);

    const useWA = channels.includes('whatsapp');
    const useTG = channels.includes('telegram');

    const env = {};
    const config = {
        channels: { whatsapp: { enabled: false }, telegram: { enabled: false } },
        vault: { categoriesFile: 'categories.json', inboxFolder: '_Inbox', inboxTag: 'a-classer' },
        whisper: {},
        pipeline: {},
    };

    // ── Étape 2a — WhatsApp ───────────────────────────────────────────────
    if (useWA) {
        console.log('\n' + chalk.cyan('── Étape 2a / 5 — Configuration WhatsApp ──────────\n'));
        console.log(chalk.yellow('⚠️  WhatsApp nécessite un numéro secondaire dédié.'));
        console.log(chalk.yellow('   Les CGU interdisent les bots — risque de ban sur ce numéro.'));
        console.log(chalk.yellow('   Recommandé : eSIM (~5€/mois) ou vieux téléphone.\n'));

        const { waNumber } = await inquirer.prompt([{
            type: 'input',
            name: 'waNumber',
            message: 'Numéro autorisé (format international, ex: +41791234567) :',
            validate: (v) => /^\+\d{7,15}$/.test(v.trim()) || 'Format invalide (ex: +41791234567)',
        }]);

        env.WA_ENABLED = 'true';
        env.WA_ALLOWED_NUMBER = waNumber.trim();
        config.channels.whatsapp = {
            enabled: true,
            allowedNumber: waNumber.trim(),
            sessionPath: '.wwebjs_auth',
        };

        console.log(chalk.green('\n→ Un QR code s\'affichera au premier démarrage.'));
        console.log(chalk.green('  Ouvre WhatsApp → Appareils liés → Lier un appareil.\n'));
    }

    // ── Étape 2b — Telegram ───────────────────────────────────────────────
    if (useTG) {
        console.log('\n' + chalk.cyan('── Étape 2b / 5 — Configuration Telegram ──────────\n'));
        console.log('Token BotFather : obtenu via @BotFather sur Telegram');
        console.log('Ton User ID     : envoie /start à @userinfobot\n');

        const { tgToken, tgUserId } = await inquirer.prompt([
            {
                type: 'password',
                name: 'tgToken',
                message: 'Token BotFather :',
                mask: '*',
                validate: (v) => v.trim().length > 20 || 'Token invalide',
            },
            {
                type: 'input',
                name: 'tgUserId',
                message: 'Ton Telegram User ID :',
                validate: (v) => /^\d+$/.test(v.trim()) || 'User ID invalide (chiffres uniquement)',
            },
        ]);

        env.TG_ENABLED = 'true';
        env.TG_BOT_TOKEN = tgToken.trim();
        env.TG_ALLOWED_USER_ID = tgUserId.trim();
        config.channels.telegram = {
            enabled: true,
            allowedUserId: tgUserId.trim(),
        };
    }

    // ── Étape 3 — Vault ───────────────────────────────────────────────────
    console.log('\n' + chalk.cyan('── Étape 3 / 5 — Vault Obsidian ───────────────────\n'));

    const { vaultPath, categoriesRaw } = await inquirer.prompt([
        {
            type: 'input',
            name: 'vaultPath',
            message: 'Chemin absolu vers ta vault Obsidian :',
            default: '/home/ubuntu/obsidian-vault',
            validate: (v) => {
                const p = v.trim();
                if (!path.isAbsolute(p)) return 'Le chemin doit être absolu';
                return true;
            },
        },
        {
            type: 'input',
            name: 'categoriesRaw',
            message: 'Catégories initiales (séparées par virgule) :',
            default: 'Projets/Tech, Projets/Personnel, Idées, Apprentissage, Tâches',
        },
    ]);

    const vaultAbsPath = vaultPath.trim();
    const initialCategories = categoriesRaw.split(',').map(c => c.trim()).filter(Boolean);

    env.VAULT_PATH = vaultAbsPath;
    env.CATEGORIES_FILE = path.join(vaultAbsPath, 'categories.json');
    env.PENDING_FILE = path.join(PROJECT_ROOT, 'pending.json');
    env.TMP_PATH = path.join(PROJECT_ROOT, 'tmp', 'audio');

    config.vault.path = vaultAbsPath;

    // ── Étape 4 — Whisper & Groq ──────────────────────────────────────────
    console.log('\n' + chalk.cyan('── Étape 4 / 5 — Transcription & IA ───────────────\n'));
    console.log('Modèles Whisper : tiny | base | small | medium | large-v3');
    console.log(chalk.dim('Recommandé : medium (bon équilibre vitesse/qualité)\n'));

    const { whisperModel, whisperLang, groqKey } = await inquirer.prompt([
        {
            type: 'list',
            name: 'whisperModel',
            message: 'Modèle Whisper :',
            choices: ['tiny', 'base', 'small', 'medium', 'large-v3'],
            default: 'medium',
        },
        {
            type: 'input',
            name: 'whisperLang',
            message: 'Langue principale de tes vocaux (code ISO) :',
            default: 'fr',
            validate: (v) => /^[a-z]{2}$/.test(v.trim()) || 'Code langue invalide (ex: fr, en, ar)',
        },
        {
            type: 'password',
            name: 'groqKey',
            message: 'Clé API Groq (console.groq.com — gratuit) :',
            mask: '*',
            validate: (v) => v.trim().startsWith('gsk_') || 'Clé invalide (doit commencer par gsk_)',
        },
    ]);

    env.WHISPER_MODEL = whisperModel;
    env.WHISPER_LANGUAGE = whisperLang.trim();
    env.GROQ_API_KEY = groqKey.trim();
    env.CATEGORY_APPROVAL_TIMEOUT_MIN = '10';
    env.INBOX_TAG = 'a-classer';

    config.whisper = { model: whisperModel, language: whisperLang.trim() };
    config.pipeline = {
        categoryApprovalTimeoutMin: 10,
        audioTmpPath: env.TMP_PATH,
    };

    // ── Étape 5 — Récapitulatif ───────────────────────────────────────────
    console.log('\n' + chalk.cyan('── Étape 5 / 5 — Vérification ─────────────────────\n'));

    if (useWA) console.log(chalk.green(`  ✅ WhatsApp    → ${env.WA_ALLOWED_NUMBER}`));
    if (useTG)  console.log(chalk.green(`  ✅ Telegram    → User ID: ${env.TG_ALLOWED_USER_ID}`));
    console.log(chalk.green(`  ✅ Vault       → ${vaultAbsPath}`));
    console.log(chalk.green(`  ✅ Catégories  → ${initialCategories.length} à créer`));
    console.log(chalk.green(`  ✅ Whisper     → ${whisperModel}, langue: ${whisperLang}`));
    console.log(chalk.green(`  ✅ Groq API    → Clé configurée`));

    const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: '\nTout est prêt. Générer la configuration et démarrer ?',
        default: true,
    }]);

    if (!confirm) {
        console.log(chalk.yellow('\nConfiguration annulée. Relance "voicenote setup" quand tu es prêt.'));
        process.exit(0);
    }

    // ── Génération des fichiers ───────────────────────────────────────────
    console.log('\n' + chalk.bold('🔧 Génération de la configuration...\n'));

    // config.yaml
    const configPath = path.join(PROJECT_ROOT, 'config.yaml');
    fs.writeFileSync(configPath, yaml.dump(config, { indent: 2 }), 'utf8');
    console.log(chalk.green('  ✅ config.yaml généré'));

    // .env
    const envPath = path.join(PROJECT_ROOT, '.env');
    const envLines = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
    fs.writeFileSync(envPath, envLines + '\n', 'utf8');
    console.log(chalk.green('  ✅ .env généré'));

    // Vault + catégories initiales
    fs.mkdirSync(vaultAbsPath, { recursive: true });
    fs.mkdirSync(path.join(vaultAbsPath, '_Inbox'), { recursive: true });
    fs.mkdirSync(path.join(PROJECT_ROOT, 'tmp', 'audio'), { recursive: true });

    // Set env vars for initCategories
    process.env.VAULT_PATH = vaultAbsPath;
    process.env.CATEGORIES_FILE = env.CATEGORIES_FILE;
    initCategories(vaultAbsPath, initialCategories);
    console.log(chalk.green(`  ✅ Vault initialisée avec ${initialCategories.length} catégorie(s)`));

    console.log('\n' + chalk.bold.green('🚀 Configuration terminée !'));
    console.log(chalk.dim('\nDémarre le pipeline avec : ') + chalk.bold('voicenote start'));
    if (useWA) {
        console.log(chalk.dim('WhatsApp uniquement    : ') + chalk.bold('voicenote start --wa'));
    }
    if (useTG) {
        console.log(chalk.dim('Telegram uniquement    : ') + chalk.bold('voicenote start --tg'));
    }
    console.log('');
}

run().catch((err) => {
    console.error('\n❌ Erreur wizard :', err.message);
    process.exit(1);
});
