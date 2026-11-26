import { getQuotedMessage } from '../../lib/quoted.js';
import { downloadMedia, reply } from '../../lib/message.js';
import { mediaTypeOf } from '../../services/SoundStickerReferenceCache.js';
import { SoundStickerError, SoundStickerService } from '../../services/SoundStickerService.js';
import { sendSoundSticker } from '../../lib/soundStickerProtocol.js';
import { logger } from '../../utils/logger.js';

const uniqueMessages = (messages) => {
  const seen = new Set();
  return messages.filter((message) => {
    const id = message?.key?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const referencesFor = (msg, soundStickerReferences) => uniqueMessages([
  msg,
  getQuotedMessage(msg),
  ...(soundStickerReferences?.candidates(msg) || []).reverse()
]);

const downloadFirst = async (references, predicate, maxBytes, validMedia = () => true) => {
  for (const reference of references) {
    if (!predicate(mediaTypeOf(reference))) continue;
    const media = await downloadMedia(reference, { maxBytes });
    if (validMedia(media)) return { reference, media };
  }
  return null;
};

const errorText = (error) => {
  if (error instanceof SoundStickerError) {
    if (error.code === 'DURATION') return error.message;
    if (error.code === 'NO_AUDIO') return 'Video tidak memiliki audio yang dapat digunakan. Kirim audio terpisah.';
    if (error.code === 'INVALID_MEDIA') return 'Format media tidak didukung atau file rusak.';
    if (error.code === 'OUTPUT_TOO_LARGE') return 'Sticker hasil terlalu besar. Coba video yang lebih sederhana.';
  }
  if (error?.message?.includes('Ukuran media')) return error.message;
  return 'Gagal membuat Sound Sticker. Silakan coba lagi.';
};

const respond = async (sock, msg, text) => {
  try {
    return await reply(sock, msg, text);
  } catch (error) {
    // If WhatsApp cannot fetch group metadata, another reply would trigger the
    // same failing query. Log a concise diagnostic and let the user retry.
    logger.warn(`Sound Sticker response gagal dikirim: ${error.message}`);
    return null;
  }
};

export default {
  name: 'ss',
  alias: ['soundsticker', 'ssvideo'],
  category: 'sticker',
  description: 'Membuat Sound Sticker WhatsApp dari gambar/video dan audio.',
  usage: 'reply gambar/video atau audio lalu .ss',
  cooldown: 10,
  async execute({ sock, msg, config, soundStickerReferences }) {
    const limits = config.soundSticker;
    const references = referencesFor(msg, soundStickerReferences);
    const visualResult = await downloadFirst(
      references,
      (type) => type === 'imageMessage' || type === 'videoMessage',
      limits.maxInputBytes
    );

    if (!visualResult) {
      return respond(sock, msg, 'Kirim atau reply gambar/video dan audio yang ingin digabungkan.');
    }
    const { media: visual } = visualResult;
    if (!SoundStickerService.isImage(visual) && !SoundStickerService.isVideo(visual)) {
      return respond(sock, msg, 'Format gambar atau video tidak didukung.');
    }

    const audioResult = await downloadFirst(
      references.filter((reference) => reference.key.id !== visualResult.reference.key.id),
      (type) => type === 'audioMessage' || type === 'documentMessage',
      limits.maxInputBytes,
      SoundStickerService.isAudio
    );

    const service = new SoundStickerService(limits);
    try {
      const audio = audioResult?.media || (SoundStickerService.isVideo(visual)
        ? await service.extractVideoAudio(visual)
        : null);
      if (!audio) {
        return respond(sock, msg, 'Kirim atau reply gambar/video dan audio yang ingin digabungkan.');
      }

      await respond(sock, msg, 'Sedang membuat Sound Sticker... Mohon tunggu.');
      const result = await service.create({ visual, audio });
      await sendSoundSticker({
        sock,
        jid: msg.key.remoteJid,
        sticker: result.sticker,
        audio: result.audio,
        seconds: result.seconds,
        quoted: msg
      });
    } catch (error) {
      return respond(sock, msg, errorText(error));
    }
  }
};
