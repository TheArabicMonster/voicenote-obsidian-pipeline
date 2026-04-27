'use strict';

const https = require('https');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const TelegramBot = require('node-telegram-bot-api');
const ChannelAdapter = require('./base');

/**
 * Downloads a file from a URL to a local destination path.
 * @param {string} url
 * @param {string} dest
 * @returns {Promise<string>} Resolved destination path
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

class TelegramAdapter extends ChannelAdapter {
  /**
   * @param {{ token: string, allowedUserId: string|number }} config
   */
  constructor(config) {
    super();
    this.config = config;
    this.allowedUserId = config.allowedUserId;
    this.bot = null;
  }

  /**
   * Initialise the bot with long-polling and attach message handlers.
   * @returns {Promise<void>}
   */
  async connect() {
    this.bot = new TelegramBot(this.config.token, { polling: true });
    console.log('[Telegram] Connected via polling');

    this.bot.on('message', (msg) => this._onMessage(msg));
    this.bot.on('voice',   (msg) => this._onMessage(msg));
    this.bot.on('audio',   (msg) => this._onMessage(msg));
  }

  /**
   * Returns true when the incoming Telegram message originates from
   * the configured allowed user.
   * @param {Object} msg - Raw Telegram message object
   * @returns {boolean}
   */
  isAuthorized(msg) {
    return String(msg.from.id) === String(this.allowedUserId);
  }

  /**
   * Processes a raw Telegram message: authorisation check, type detection,
   * NormalizedMessage construction, and event emission.
   * @param {Object} msg - Raw Telegram message object
   */
  _onMessage(msg) {
    if (!this.isAuthorized(msg)) return;

    const isVoice = !!(msg.voice || msg.audio);
    const isText  = !isVoice && typeof msg.text === 'string' && msg.text.trim().length > 0;

    if (!isVoice && !isText) return;

    /** @type {import('./base').NormalizedMessage} */
    const normalized = {
      channelId: 'telegram',
      from: String(msg.from.id),
      type: isVoice ? 'voice' : 'text',
      text: isText ? msg.text.trim() : null,
      audioPath: null,
      reply:      (text) => this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' }),
      replyVoice: (text) => this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' }),
    };

    this.emit('message', normalized, msg);
  }

  /**
   * Downloads the audio file attached to a raw Telegram voice/audio message.
   * @param {Object} rawMsg - Raw Telegram message object
   * @returns {Promise<string>} Local path to the downloaded audio file
   */
  async downloadAudio(rawMsg) {
    const fileId = (rawMsg.voice || rawMsg.audio).file_id;
    const fileUrl = await this.bot.getFileLink(fileId);
    const dest = `/tmp/audio-${uuidv4()}.oga`;
    return downloadFile(fileUrl, dest);
  }

  /**
   * Sends a Markdown-formatted message to a Telegram chat.
   * @param {string|number} to - Telegram chat ID
   * @param {string} text
   * @returns {Promise<void>}
   */
  async send(to, text) {
    return this.bot.sendMessage(to, text, { parse_mode: 'Markdown' });
  }
}

module.exports = TelegramAdapter;
