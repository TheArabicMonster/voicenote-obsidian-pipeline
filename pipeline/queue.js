'use strict';

/**
 * VoiceQueue — Singleton FIFO queue for sequential voice message processing.
 * Guarantees that audio jobs are processed one at a time, preventing
 * concurrent Whisper/ffmpeg invocations and resource contention.
 */
class VoiceQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
    }

    /**
     * Add a job to the tail of the queue and trigger processing.
     * @param {Function} job — Async function (or sync) to execute.
     */
    enqueue(job) {
        this.queue.push(job);
        console.log(`[queue] +1 job (total en attente : ${this.queue.length})`);
        this.process();
    }

    /**
     * Internal: pull jobs from the head of the queue one at a time.
     * Re-entrant calls are silently discarded while a job is running.
     */
    async process() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;
        const job = this.queue.shift();
        try {
            await job();
        } catch (err) {
            console.error('[queue] Erreur sur job :', err.message);
        } finally {
            this.processing = false;
            this.process();
        }
    }
}

module.exports = new VoiceQueue();
