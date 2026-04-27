'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const ChannelAdapter = require('./base');

class WhatsAppAdapter extends ChannelAdapter {
  /**
   * @param {{ allowedNumber: string, sessionPath?: string, tmpPath?: string }} config
   */
  constructor(config) {
    super();
    // config: { allowedNumber, sessionPath, tmpPath }
    this.allowedNumber = config.allowedNumber;
    this.tmpPath = config.tmpPath || path.join(__dirname, '..', 'tmp', 'audio');
    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: config.sessionPath || '.wwebjs_auth' }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    });
  }

  /**
   * Initialises the WhatsApp client, displays the QR code for pairing,
   * and resolves once the session is ready.
   * @returns {Promise<void>}
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this.client.on('qr', (qr) => {
        console.log('\n[WhatsApp] Scanne ce QR code avec ton téléphone secondaire :');
        qrcode.generate(qr, { small: true });
      });

      this.client.on('ready', () => {
        console.log('[WhatsApp] Connecté');
        resolve();
      });

      this.client.on('auth_failure', (msg) => {
        console.error('[WhatsApp] Échec d\'authentification:', msg);
        reject(new Error('WhatsApp auth failure: ' + msg));
      });

      this.client.on('disconnected', (reason) => {
        console.warn('[WhatsApp] Déconnecté:', reason);
        this.emit('disconnected', reason);
      });

      this.client.on('message', (msg) => this._onMessage(msg));

      this.client.initialize().catch(reject);
    });
  }

  /**
   * Returns true when the incoming message originates from the configured
   * allowed phone number. Handles the optional @c.us suffix and leading '+'.
   * @param {Object} msg - Raw whatsapp-web.js message object
   * @returns {boolean}
   */
  isAuthorized(msg) {
    // Normalize: strip @c.us suffix for comparison if present
    const from = msg.from.replace(/@c\.us$/, '');
    const allowed = this.allowedNumber.replace(/^\+/, '').replace(/\s/g, '');
    return from === allowed;
  }

  /**
   * Processes a raw whatsapp-web.js message: authorisation check, type
   * detection, NormalizedMessage construction, and event emission.
   * @param {Object} msg - Raw whatsapp-web.js message object
   */
  async _onMessage(msg) {
    if (!this.isAuthorized(msg)) return;
    // Ignore status messages and group messages
    if (msg.isStatus || msg.from.includes('@g.us')) return;

    const isVoice = msg.type === 'ptt' || msg.type === 'audio';
    const isText  = msg.type === 'chat';

    if (!isVoice && !isText) return;

    /** @type {import('./base').NormalizedMessage} */
    const normalized = {
      channelId: 'whatsapp',
      from:      msg.from,
      type:      isVoice ? 'voice' : 'text',
      text:      isText ? (msg.body || '').trim() : null,
      audioPath: null,
      reply:      (text) => msg.reply(text),
      replyVoice: (text) => msg.reply(text),
    };

    this.emit('message', normalized, msg);
  }

  /**
   * Downloads the audio payload of a raw whatsapp-web.js voice/audio message
   * to a local temp file and returns its path.
   * @param {Object} rawMsg - Raw whatsapp-web.js message object
   * @returns {Promise<string>} Local path to the downloaded audio file
   */
  async downloadAudio(rawMsg) {
    if (!fs.existsSync(this.tmpPath)) {
      fs.mkdirSync(this.tmpPath, { recursive: true });
    }

    const media = await rawMsg.downloadMedia();
    if (!media || !media.data) {
      throw new Error('[WhatsApp] downloadAudio: media data empty');
    }

    const ext = 'ogg';
    const filename = `audio-${uuidv4()}.${ext}`;
    const filePath = path.join(this.tmpPath, filename);

    fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
    console.log(`[WhatsApp] Audio téléchargé: ${filename}`);

    return filePath;
  }

  /**
   * Sends a plain-text message to a WhatsApp contact or group.
   * @param {string} to - WhatsApp ID (e.g. "33612345678@c.us")
   * @param {string} text
   * @returns {Promise<void>}
   */
  async send(to, text) {
    await this.client.sendMessage(to, text);
  }
}

module.exports = WhatsAppAdapter;
