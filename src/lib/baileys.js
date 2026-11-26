import makeWASocket, {
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import fs from 'fs-extra';
import { config } from '../config/env.js';
import { rawLogger, logger } from '../utils/logger.js';

const runPairingRequest = async (sock, botState, phoneNumber, options = {}) => {
  const cleanNumber = (phoneNumber || '').replace(/\D/g, '');
  if (!cleanNumber) {
    botState.pairingStatus = 'Nomor telepon tidak valid untuk pairing code';
    return;
  }

  try {
    const code = await sock.requestPairingCode(cleanNumber);
    botState.pairingCode = code;
    botState.qr = null;
    botState.pairingStatus = `Pairing code aktif: ${code}`;
    options.onPairingUpdate?.({ pairingCode: code, pairingStatus: botState.pairingStatus, qr: null });
    logger.success(`Pairing code untuk ${cleanNumber}: ${code}`);
  } catch (error) {
    botState.pairingStatus = `Pairing gagal: ${error.message}`;
    options.onPairingUpdate?.({ pairingCode: '', pairingStatus: botState.pairingStatus, error: error.message });
    logger.warn(`Pairing code gagal dibuat: ${error.message}`);
  }
};

export const createSocket = async (botState, options = {}) => {
  const sessionPath = options.sessionPath || config.sessionPath;
  // authMethod sekarang datang per-request (dari dashboard), fallback ke config kalau gak dikirim
  const authMethod = options.authMethod === 'qr' || options.authMethod === 'pairing'
    ? options.authMethod
    : config.authMethod;
  const pairingPhoneNumber = options.pairingPhoneNumber;

  await fs.ensureDir(sessionPath);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  // Baileys queries group metadata for every group send unless this cache is
  // supplied. Keep it per socket/session so a transient metadata query does
  // not block subsequent media sends to a known group.
  const groupMetadataCache = new Map();
  const sock = makeWASocket({
    version,
    logger: rawLogger,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, rawLogger)
    },
    qrTimeout: 60000,
    generateHighQualityLinkPreview: true,
    markOnlineOnConnect: true,
    cachedGroupMetadata: async (jid) => groupMetadataCache.get(jid)
  });

  const fetchGroupMetadata = sock.groupMetadata.bind(sock);
  sock.groupMetadata = async (jid) => {
    const metadata = await fetchGroupMetadata(jid);
    if (metadata?.id && Array.isArray(metadata.participants)) {
      groupMetadataCache.set(jid, metadata);
    }
    return metadata;
  };
  sock.groupMetadataCache = groupMetadataCache;

  sock.ev.on('groups.update', (updates = []) => {
    for (const update of updates) {
      const cached = groupMetadataCache.get(update.id);
      if (cached) groupMetadataCache.set(update.id, { ...cached, ...update });
    }
  });
  sock.ev.on('group-participants.update', (update) => {
    const cached = groupMetadataCache.get(update.id);
    if (!cached?.participants) return;
    const participants = new Map(cached.participants.map((participant) => [participant.id, participant]));
    for (const participant of update.participants || []) {
      if (update.action === 'add') participants.set(participant, { id: participant });
      if (update.action === 'remove') participants.delete(participant);
    }
    groupMetadataCache.set(update.id, { ...cached, participants: [...participants.values()] });
  });

  sock.ev.on('creds.update', saveCreds);
  sock.sessionPath = sessionPath;
  sock.__authMethod = authMethod;

  if (!sock.authState.creds.registered) {
    if (authMethod === 'pairing' && pairingPhoneNumber) {
      setTimeout(() => runPairingRequest(sock, botState, pairingPhoneNumber, options), 1500);
    } else {
      botState.pairingStatus = 'Menunggu QR dari WhatsApp';
    }
  }

  return sock;
};

// Dipanggil manual (mis. tombol "Request/Regenerate Pairing Code" di dashboard),
// dipakai juga oleh BotManager.pairBot(). Bisa jalan meski session awalnya mode QR.
export const requestPairingCode = async (sock, botState, phoneNumber, options = {}) => {
  if (!sock) throw new Error('Socket belum siap');
  if (sock.authState.creds.registered) throw new Error('Session sudah terdaftar, tidak perlu pairing code');
  await runPairingRequest(sock, botState, phoneNumber, options);
  if (!botState.pairingCode) throw new Error(botState.pairingStatus || 'Gagal membuat pairing code');
  return botState.pairingCode;
};
