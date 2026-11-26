export default {
  name: 'sshelp',
  category: 'sticker',
  description: 'Petunjuk membuat Sound Sticker.',
  async execute({ sock, msg, prefix }) {
    const text = [
      '*Sound Sticker*',
      '',
      `1. Kirim gambar lalu kirim audio, kemudian reply salah satu media dengan ${prefix}ss.`,
      `2. Kirim video lalu reply video dengan ${prefix}ss untuk memakai audio asli.`,
      `3. Kirim video dan audio terpisah, lalu reply salah satunya dengan ${prefix}ss.`,
      '',
      'Format gambar: JPG, PNG, WebP.',
      'Format audio: MP3, OGG, WAV, M4A.',
      'Video dipakai hingga 15 detik pertama; audio maksimal 7 detik secara default.'
    ].join('\n');
    return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });
  }
};
