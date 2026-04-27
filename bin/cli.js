#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const path = require('path');
const { execSync, spawn } = require('child_process');

const program = new Command();

program
    .name('voicenote')
    .description('VoiceNote → Obsidian Pipeline CLI')
    .version('1.0.0');

program
    .command('setup')
    .description('Lancer le wizard de configuration interactif')
    .action(() => {
        require('./setup');
    });

program
    .command('start')
    .description('Démarrer le pipeline (tous les channels configurés)')
    .option('--wa', 'WhatsApp uniquement')
    .option('--tg', 'Telegram uniquement')
    .action((opts) => {
        const args = [path.join(__dirname, '..', 'index.js')];
        if (opts.wa) args.push('--wa');
        if (opts.tg) args.push('--tg');
        const proc = spawn(process.execPath, args, { stdio: 'inherit' });
        proc.on('exit', (code) => process.exit(code || 0));
    });

program
    .command('status')
    .description('Afficher l\'état du pipeline')
    .action(() => {
        const fs = require('fs');
        const yaml = require('js-yaml');
        const configPath = path.join(__dirname, '..', 'config.yaml');

        if (!fs.existsSync(configPath)) {
            console.log('❌ Pas de configuration. Lance "voicenote setup" d\'abord.');
            return;
        }

        const cfg = yaml.load(fs.readFileSync(configPath, 'utf8'));
        console.log('\n── Status VoiceNote Pipeline ──────────────────\n');
        const wa = cfg.channels?.whatsapp;
        const tg = cfg.channels?.telegram;
        console.log(`WhatsApp : ${wa?.enabled ? '✅ Activé (' + wa.allowedNumber + ')' : '⬜ Désactivé'}`);
        console.log(`Telegram : ${tg?.enabled ? '✅ Activé (userId: ' + tg.allowedUserId + ')' : '⬜ Désactivé'}`);
        console.log(`Vault    : ${cfg.vault?.path || '❌ Non configurée'}`);
        console.log(`Whisper  : ${cfg.whisper?.model || 'medium'} / ${cfg.whisper?.language || 'fr'}`);

        const pendingFile = path.join(__dirname, '..', 'pending.json');
        if (fs.existsSync(pendingFile)) {
            const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8')).pending || [];
            console.log(`Pending  : ${pending.length} proposition(s) en attente`);
        }
        console.log('');
    });

program
    .command('categories')
    .description('Lister les catégories actives')
    .action(() => {
        require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
        const { loadCategories } = require('../pipeline/categories');
        const cats = loadCategories();
        if (cats.length === 0) {
            console.log('Aucune catégorie. Lance "voicenote setup" d\'abord.');
            return;
        }
        console.log(`\n── ${cats.length} catégorie(s) ──────────────────────────\n`);
        cats.forEach(c => {
            console.log(`  📁 ${c.path}${c.description ? ' — ' + c.description : ''}`);
        });
        console.log('');
    });

program
    .command('logs')
    .description('Afficher les logs en temps réel')
    .action(() => {
        const logDir = path.join(__dirname, '..', 'logs');
        const logFile = path.join(logDir, 'voicenote.log');
        const fs = require('fs');
        if (!fs.existsSync(logFile)) {
            console.log('Aucun fichier de log trouvé. Démarre le pipeline avec "voicenote start".');
            return;
        }
        const tail = spawn('tail', ['-f', logFile], { stdio: 'inherit' });
        tail.on('exit', () => process.exit(0));
    });

program.parse(process.argv);
