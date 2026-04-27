'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const TMP_DIR = path.resolve(__dirname, '..', 'tmp', 'audio');
const TRANSCRIBE_SCRIPT = path.resolve(__dirname, '..', 'transcriber', 'transcribe.py');

const TRANSCRIPTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Ensure the tmp/audio directory exists before writing files into it.
 */
function ensureTmpDir() {
    if (!fs.existsSync(TMP_DIR)) {
        fs.mkdirSync(TMP_DIR, { recursive: true });
    }
}

/**
 * Convert an audio file to 16 kHz mono WAV using ffmpeg.
 * Uses spawn (not exec) so large outputs never overflow a buffer.
 *
 * @param {string} inputPath  — Absolute path to the source audio file.
 * @param {string} outputPath — Absolute path for the output WAV file.
 * @returns {Promise<void>}
 */
function convertToWav(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        console.log('[transcriber] Conversion ffmpeg...');

        const args = [
            '-i', inputPath,
            '-ar', '16000',
            '-ac', '1',
            '-y',
            outputPath,
        ];

        const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

        let stderrBuf = '';
        proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });

        proc.on('error', (err) => {
            reject(new Error(`[transcriber] ffmpeg spawn error: ${err.message}`));
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`[transcriber] ffmpeg exited with code ${code}: ${stderrBuf.slice(-500)}`));
            }
        });
    });
}

/**
 * Run the Python faster-whisper script and return the transcribed text.
 *
 * @param {string} wavPath — Absolute path to the 16 kHz mono WAV file.
 * @returns {Promise<string>} — Transcribed text.
 */
function transcribeWhisper(wavPath) {
    const model = process.env.WHISPER_MODEL || 'medium';
    const language = process.env.WHISPER_LANGUAGE || 'fr';

    return new Promise((resolve, reject) => {
        console.log(`[transcriber] Transcription Whisper (modèle: ${model})...`);
        const startTime = Date.now();

        const args = [
            TRANSCRIBE_SCRIPT,
            '--file', wavPath,
            '--model', model,
            '--language', language,
        ];

        const proc = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'] });

        let stdoutBuf = '';
        let stderrBuf = '';

        proc.stdout.on('data', (chunk) => { stdoutBuf += chunk.toString(); });
        proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });

        // Hard timeout: kill the process if transcription hangs.
        const timer = setTimeout(() => {
            proc.kill('SIGKILL');
            reject(new Error(`[transcriber] Whisper timeout after ${TRANSCRIPTION_TIMEOUT_MS / 1000}s`));
        }, TRANSCRIPTION_TIMEOUT_MS);

        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`[transcriber] python3 spawn error: ${err.message}`));
        });

        proc.on('close', (code) => {
            clearTimeout(timer);

            const elapsed = Date.now() - startTime;
            let parsed;

            try {
                parsed = JSON.parse(stdoutBuf.trim());
            } catch (_) {
                return reject(new Error(
                    `[transcriber] Réponse JSON invalide depuis transcribe.py: ${stdoutBuf.slice(0, 200)}`
                ));
            }

            if (parsed.error) {
                return reject(new Error(`[transcriber] Whisper error: ${parsed.error}`));
            }

            if (code !== 0) {
                return reject(new Error(
                    `[transcriber] transcribe.py exited ${code}: ${stderrBuf.slice(-300)}`
                ));
            }

            console.log(`[transcriber] Terminé en ${elapsed}ms`);
            resolve(parsed.text || '');
        });
    });
}

/**
 * Persist a base64-encoded audio buffer as a .ogg file and prepare WAV path.
 * The caller is responsible for running convertToWav before transcribeWhisper.
 *
 * @param {string|Buffer} mediaData — Raw audio bytes or base64-encoded string.
 * @returns {{ id: string, oggPath: string, wavPath: string }}
 */
function saveAudio(mediaData) {
    ensureTmpDir();

    const id = uuidv4();
    const oggPath = path.join(TMP_DIR, `audio-${id}.ogg`);
    const wavPath = path.join(TMP_DIR, `audio-${id}.wav`);

    const buffer = Buffer.isBuffer(mediaData)
        ? mediaData
        : Buffer.from(mediaData, 'base64');

    fs.writeFileSync(oggPath, buffer);

    return { id, oggPath, wavPath };
}

/**
 * Delete all `audio-*` files in the tmp/audio directory.
 * Runs synchronously; intended for startup cleanup or maintenance tasks.
 *
 * @param {string} [tmpDir] — Override directory path (defaults to tmp/audio).
 */
function purgeStaleAudioFiles(tmpDir) {
    const targetDir = tmpDir || TMP_DIR;

    if (!fs.existsSync(targetDir)) return;

    const entries = fs.readdirSync(targetDir);
    let removed = 0;

    for (const entry of entries) {
        if (entry.startsWith('audio-')) {
            try {
                fs.unlinkSync(path.join(targetDir, entry));
                removed++;
            } catch (err) {
                console.warn(`[transcriber] Impossible de supprimer ${entry}: ${err.message}`);
            }
        }
    }

    if (removed > 0) {
        console.log(`[transcriber] ${removed} fichier(s) audio périmé(s) supprimé(s)`);
    }
}

module.exports = { convertToWav, transcribeWhisper, saveAudio, purgeStaleAudioFiles };
