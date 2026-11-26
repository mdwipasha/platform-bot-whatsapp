# Modern WhatsApp Bot

WhatsApp bot modular berbasis Node.js ES Module, Baileys terbaru, Express dashboard, JSON database, hot reload command, permission middleware, cooldown, rate limiter, dan fitur owner/group/media/AI/downloader.

## Fitur Utama

- Pairing Code Login dan QR status di dashboard.
- Auto reconnect dan auto save session.
- Anti crash untuk `uncaughtException` dan `unhandledRejection`.
- Hot reload command: tambah/edit file di `src/commands`, bot reload daftar command otomatis.
- Multi prefix dari `.env`, contoh `PREFIX=.,!,/`.
- Owner Only, Admin Only, Group Only, Private Only, cooldown command.
- Rate limiter, input validation, anti spam, auto block nomor spam.
- Dashboard Express di `http://localhost:3000`.
- Database JSON dengan adapter layer yang bisa diganti MongoDB, SQLite, atau PostgreSQL.

## Instalasi

```bash
npm install
```

Edit `.env`:

```env
OWNER_NUMBER=628xxxxxxxxxx
BOT_NAME=Modern Bot
PREFIX=.
PORT=3000
AUTH_METHOD=pairing

OPENAI_API_KEY=
GEMINI_API_KEY=
CLAUDE_API_KEY=

COBALT_API_URL=https://api.cobalt.tools/
COBALT_API_KEY=
```

Jalankan bot:

```bash
npm start
```

Saat pertama login, pairing code akan tampil di console dan dashboard. Buka WhatsApp, pilih perangkat tertaut, lalu masukkan pairing code.

Kalau ingin login memakai QR di dashboard, ubah:

```env
AUTH_METHOD=qr
```

Setelah itu restart bot dan scan QR dari WhatsApp > Perangkat tertaut.

## Development

```bash
npm run dev
npm run lint
```

Dashboard:

```text
http://localhost:3000
```

## Sound Sticker WhatsApp

Command baru ini menghasilkan satu pesan sticker animasi dengan audio tertanam:

- `.ss` — buat Sound Sticker.
- `.ssvideo` — alias `.ss` untuk video.
- `.sshelp` — lihat petunjuk di WhatsApp.

Cara pakai:

1. Kirim gambar dan audio, lalu reply salah satu media dengan `.ss`.
2. Kirim video ber-audio, lalu reply videonya dengan `.ss` untuk memakai audio asli.
3. Untuk audio terpisah, kirim video dan audio di chat yang sama dari pengirim yang sama, lalu reply salah satunya dengan `.ss` dalam 10 menit.

Format yang diterima: JPG/PNG/WebP, MP3/OGG/WAV/M4A, dan MP4/MOV/WebM/MKV/AVI. Batas default adalah input 20 MB, 15 detik pertama video, audio 7 detik, output WebP 500 KB, serta dua pekerjaan media bersamaan. Ubah melalui `.env`:

```env
SOUND_STICKER_MAX_INPUT_BYTES=20971520
SOUND_STICKER_MAX_VIDEO_SECONDS=15
SOUND_STICKER_MAX_AUDIO_SECONDS=7
SOUND_STICKER_MAX_OUTPUT_BYTES=512000
SOUND_STICKER_MAX_CONCURRENT_JOBS=2
SOUND_STICKER_REFERENCE_TTL_MS=600000
```

`ffmpeg-static` dipasang sebagai dependency dan mengunduh binary FFmpeg yang diperlukan saat `npm install`. Pastikan server dapat mengakses artefak binary paket tersebut pada instalasi pertama. Feature Sound Sticker sedang roll-out bertahap pada WhatsApp Android; verifikasi pada akun penerima yang telah mendapat fitur (ikon audio di sticker) sebelum mengaktifkannya di produksi.

## Deploy

1. Gunakan Node.js 20 atau lebih baru.
2. Upload project ke VPS.
3. Jalankan `npm install`.
4. Isi `.env`.
5. Jalankan dengan process manager:

```bash
npm install -g pm2
pm2 start src/index.js --name modern-wa-bot
pm2 save
```

Untuk restart:

```bash
pm2 restart modern-wa-bot
```

## Menambah Command

Buat file baru di dalam `src/commands/<kategori>/nama.js`.

```js
export default {
  name: 'ping',
  alias: ['p'],
  category: 'general',
  description: 'Cek respons bot.',
  async execute({ sock, msg, args }) {
    await sock.sendMessage(msg.key.remoteJid, { text: `Args: ${args.join(' ')}` }, { quoted: msg });
  }
};
```

Properti tambahan yang bisa dipakai:

- `ownerOnly: true`
- `adminOnly: true`
- `groupOnly: true`
- `privateOnly: true`
- `cooldownMs: 5000`

## Struktur Project

```text
project/
├── src/
│   ├── commands/
│   │   ├── ai/
│   │   ├── downloader/
│   │   ├── general/
│   │   ├── group/
│   │   ├── media/
│   │   ├── owner/
│   │   └── sticker/
│   ├── config/
│   ├── database/
│   ├── events/
│   ├── handlers/
│   ├── lib/
│   ├── middleware/
│   ├── session/
│   ├── utils/
│   └── index.js
├── public/
├── .env
├── package.json
└── README.md
```

## Command Tersedia

General: `menu`, `help`, `ping`, `runtime`, `uptime`, `owner`, `info`, `speed`.

Group: `welcome`, `goodbye`, `antilink`, `antispam`, `antibadword`, `mute`, `tagall`, `hidetag`, `promote`, `demote`, `kick`, `add`, `setppgroup`, `setdesc`, `setname`, `group open`, `group close`.

Downloader: `tiktok`, `instagram`, `facebook`, `ytmp3`, `ytmp4`.

AI: `chatgpt`, `gemini`, `claude`.

Sticker/Media: `sticker`, `meme`, `ss`, `ssvideo`, `sshelp`, `toimage`, `tovideo`, `toaudio`, `tosticker`.

Owner: `eval`, `terminal`, `restart`, `shutdown`, `clearsession`, `backupdb`, `broadcast`.

## Database Adapter

Default adapter ada di `src/database/JsonDatabase.js`. Untuk mengganti ke MongoDB, SQLite, atau PostgreSQL, buat class baru yang extend `DatabaseAdapter`, lalu ubah export di `src/database/index.js`.

Method wajib:

- `init()`
- `read()`
- `write(data)`

## Troubleshooting

Pairing code tidak muncul:

- Pastikan `OWNER_NUMBER` berformat angka internasional tanpa `+`, contoh `6281234567890`.
- Hapus folder `src/session`, lalu jalankan ulang.
- Jika pairing code dianggap tidak valid, hapus atau backup folder `src/session` karena biasanya ada session parsial dari percobaan login sebelumnya.
- Pairing code cepat kedaluwarsa. Pakai code terbaru yang muncul setelah restart bot.

Bot tidak merespons command:

- Pastikan command diawali prefix dari `.env`.
- Cek dashboard log activity.
- Pastikan bot tidak sedang mute di grup.

Command admin gagal:

- Bot harus menjadi admin grup.
- Pengirim command juga harus admin grup atau owner.

Downloader gagal:

- Pastikan URL valid dan publik.
- Beberapa platform membatasi region, private post, atau konten tertentu.
- Downloader Instagram, Facebook, YouTube memakai `yt-dlp` lokal. Saat pertama dipakai bot akan download binary ke folder `bin/`.
- Jika YouTube MP3 ingin hasil `.mp3` murni, install FFmpeg di server. Tanpa FFmpeg bot mengirim audio terbaik yang tersedia, biasanya `.m4a`.
- Cobalt masih tersedia di helper, tetapi public API bisa menolak request. Untuk memakai Cobalt, deploy instance sendiri lalu isi `COBALT_API_URL` dan `COBALT_API_KEY`.

AI gagal:

- Isi API key terkait di `.env`.
- Pastikan billing/quota provider API aktif.

Sharp gagal install di Windows:

- Gunakan Node.js LTS terbaru.
- Jalankan ulang `npm install`.
