const { EventEmitter } = require('events');

/**
 * @typedef {Object} NormalizedMessage
 * @property {'whatsapp'|'telegram'} channelId
 * @property {string} from - Native channel ID (phone number or Telegram user ID)
 * @property {'voice'|'text'} type
 * @property {string|null} text - Text content (null if voice)
 * @property {string|null} audioPath - Local path to downloaded audio file (null if text)
 * @property {function(string): Promise<void>} reply - Send a reply to the user
 * @property {function(string): Promise<void>} replyVoice - Alias for reply
 */

class ChannelAdapter extends EventEmitter {
    /** @returns {Promise<void>} */
    async connect() {
        throw new Error('Not implemented: connect()');
    }

    /**
     * @param {string} to
     * @param {string} text
     * @returns {Promise<void>}
     */
    async send(to, text) {
        throw new Error('Not implemented: send()');
    }

    /**
     * @param {*} rawMsg
     * @returns {Promise<string>} Local path to downloaded audio file
     */
    async downloadAudio(rawMsg) {
        throw new Error('Not implemented: downloadAudio()');
    }

    /**
     * @param {*} msg
     * @returns {boolean}
     */
    isAuthorized(msg) {
        throw new Error('Not implemented: isAuthorized()');
    }
}

module.exports = ChannelAdapter;
