import {
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  proto
} from '@whiskeysockets/baileys';
import { rawLogger } from '../utils/logger.js';

const SOUND_STICKER_AUDIO_FIELD = 26;
let protocolInstalled = false;

/**
 * rc13 predates StickerMessage.audioMessage. Field 26 is present in the newer
 * WhatsApp schema, so extend only this generated encoder at runtime rather
 * than editing node_modules or changing the socket/auth implementation.
 */
export const installSoundStickerProtocol = () => {
  if (protocolInstalled) return;

  const StickerMessage = proto.Message.StickerMessage;
  const encodeSticker = StickerMessage.encode;
  StickerMessage.encode = (message, writer) => {
    const result = encodeSticker(message, writer);
    if (message.audioMessage != null && Object.hasOwn(message, 'audioMessage')) {
      proto.Message.AudioMessage.encode(message.audioMessage, result.uint32((SOUND_STICKER_AUDIO_FIELD << 3) | 2).fork()).ldelim();
    }
    return result;
  };
  protocolInstalled = true;
};

export const assertSoundStickerProtocol = () => {
  installSoundStickerProtocol();
  const audio = proto.Message.AudioMessage.create({ mimetype: 'audio/ogg; codecs=opus' });
  const encoded = proto.Message.StickerMessage.encode({ audioMessage: audio }).finish();
  // Field 26, wire type 2, is varint encoded as D2 01.
  if (!encoded.includes(Buffer.from([0xd2, 0x01]))) {
    throw new Error('Encoder Sound Sticker tidak dapat menulis field audio WhatsApp.');
  }
};

export const sendSoundSticker = async ({ sock, jid, sticker, audio, seconds, quoted }) => {
  assertSoundStickerProtocol();
  if (!sock.waUploadToServer || !sock.user?.id) {
    throw new Error('Socket WhatsApp belum siap mengunggah media.');
  }
  if (jid.endsWith('@g.us') && !sock.groupMetadataCache?.has(jid)) {
    try {
      await sock.groupMetadata(jid);
    } catch {
      throw new Error('Metadata grup belum dapat diambil. Pastikan bot tersambung, lalu coba lagi.');
    }
  }

  const mediaOptions = {
    upload: sock.waUploadToServer,
    logger: rawLogger,
    options: {},
    jid
  };
  const [stickerContent, audioContent] = await Promise.all([
    prepareWAMessageMedia({ sticker }, mediaOptions),
    prepareWAMessageMedia({
      audio,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
      seconds
    }, mediaOptions)
  ]);

  const stickerMessage = stickerContent.stickerMessage;
  stickerMessage.audioMessage = audioContent.audioMessage;
  const content = proto.Message.create({ stickerMessage });
  const outgoing = generateWAMessageFromContent(jid, content, {
    userJid: sock.user.id,
    quoted,
    timestamp: new Date()
  });

  await sock.relayMessage(jid, outgoing.message, {
    messageId: outgoing.key.id,
    useCachedGroupMetadata: jid.endsWith('@g.us')
  });
  return outgoing;
};
