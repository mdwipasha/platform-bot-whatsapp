import { unwrapMessageContent } from '../lib/message.js';

const MEDIA_KEYS = new Set(['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage']);

const mediaTypeOf = (message) => {
  const content = unwrapMessageContent(message?.message || {});
  return Object.keys(content).find((key) => MEDIA_KEYS.has(key)) || null;
};

const senderOf = (message) => message?.key?.participant || message?.key?.remoteJid || '';

/**
 * Bounded metadata cache for pairing media sent in separate messages. It never
 * stores downloaded buffers and is deliberately short-lived per chat/sender.
 */
export class SoundStickerReferenceCache {
  constructor({ ttlMs = 10 * 60 * 1000, maxPerSender = 12 } = {}) {
    this.ttlMs = ttlMs;
    this.maxPerSender = maxPerSender;
    this.entries = new Map();
  }

  keyFor(message) {
    return `${message?.key?.remoteJid || ''}:${senderOf(message)}`;
  }

  remember(message) {
    if (!message?.key?.id || !mediaTypeOf(message)) return;
    this.prune();
    const key = this.keyFor(message);
    const current = this.entries.get(key) || [];
    const withoutDuplicate = current.filter((item) => item.message.key.id !== message.key.id);
    withoutDuplicate.push({ message, receivedAt: Date.now() });
    this.entries.set(key, withoutDuplicate.slice(-this.maxPerSender));
  }

  candidates(message) {
    this.prune();
    return (this.entries.get(this.keyFor(message)) || []).map((item) => item.message);
  }

  prune() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [key, values] of this.entries) {
      const fresh = values.filter((item) => item.receivedAt >= cutoff);
      if (fresh.length) this.entries.set(key, fresh);
      else this.entries.delete(key);
    }
  }
}

export { mediaTypeOf };
