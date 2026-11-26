import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AUDIO_MIMES = new Set([
  'audio/mpeg', 'audio/ogg', 'audio/ogg; codecs=opus', 'audio/wav', 'audio/x-wav', 'audio/vnd.wave', 'audio/mp4', 'audio/x-m4a'
]);
const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/x-msvideo']);

export class SoundStickerError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const runFfmpeg = (args) => new Promise((resolve, reject) => {
  const process = spawn(ffmpegPath, ['-hide_banner', '-y', ...args], { windowsHide: true });
  let stderr = '';
  process.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  process.once('error', reject);
  process.once('close', (code) => {
    if (code === 0) return resolve(stderr);
    reject(new SoundStickerError('FFMPEG', `FFmpeg gagal memproses media (${code}).`));
  });
});

const durationOf = async (input) => {
  try {
    const output = await runFfmpeg(['-i', input, '-t', '0', '-f', 'null', '-']);
    const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
    if (!match) throw new Error('duration missing');
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  } catch (error) {
    if (error instanceof SoundStickerError) throw error;
    throw new SoundStickerError('INVALID_MEDIA', 'Media tidak dapat dibaca.');
  }
};

const withTempDirectory = async (work) => {
  const root = path.join(process.cwd(), 'tmp');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'sound-sticker-'));
  try {
    return await work(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
};

const optimizeImage = async (input, output, maxBytes) => {
  for (const quality of [88, 78, 68, 58, 48]) {
    const buffer = await sharp(input, { animated: false })
      .rotate()
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, withoutEnlargement: true })
      .webp({ quality, effort: 5 })
      .toBuffer();
    if (buffer.length <= maxBytes || quality === 48) {
      await fs.writeFile(output, buffer);
      return buffer;
    }
  }
};

const optimizeVideo = async (input, output, maxSeconds, maxBytes) => {
  const profiles = [
    { quality: 70, fps: 12, edge: 512 },
    { quality: 55, fps: 10, edge: 512 },
    { quality: 42, fps: 8, edge: 448 },
    { quality: 30, fps: 8, edge: 384 },
    { quality: 22, fps: 6, edge: 320 },
    { quality: 18, fps: 5, edge: 256 }
  ];
  for (const profile of profiles) {
    await runFfmpeg([
      '-t', String(maxSeconds), '-i', input,
      '-an', '-vf', `fps=${profile.fps},scale=${profile.edge}:${profile.edge}:force_original_aspect_ratio=decrease:flags=lanczos`,
      '-c:v', 'libwebp', '-q:v', String(profile.quality), '-preset', 'default', '-loop', '0', output
    ]);
    const result = await fs.readFile(output);
    if (result.length <= maxBytes || profile === profiles.at(-1)) return result;
  }
};

let activeJobs = 0;
const pendingJobs = [];
const acquire = (limit) => new Promise((resolve) => {
  const start = () => {
    activeJobs += 1;
    resolve(() => {
      activeJobs -= 1;
      pendingJobs.shift()?.();
    });
  };
  if (activeJobs < limit) start();
  else pendingJobs.push(start);
});

export class SoundStickerService {
  constructor(limits) {
    this.limits = limits;
  }

  static isImage(media) { return IMAGE_MIMES.has(media?.mime); }
  static isVideo(media) { return VIDEO_MIMES.has(media?.mime); }
  static isAudio(media) { return AUDIO_MIMES.has(media?.mime); }

  async create({ visual, audio }) {
    if (!ffmpegPath) throw new SoundStickerError('FFMPEG', 'FFmpeg tidak tersedia pada server.');
    const release = await acquire(this.limits.maxConcurrentJobs);
    try {
      return await withTempDirectory(async (directory) => {
        const visualInput = path.join(directory, `${randomUUID()}.visual`);
        const audioInput = path.join(directory, `${randomUUID()}.audio`);
        const stickerOutput = path.join(directory, 'sticker.webp');
        const audioOutput = path.join(directory, 'sound.ogg');
        await Promise.all([fs.writeFile(visualInput, visual.buffer), fs.writeFile(audioInput, audio.buffer)]);

        if (SoundStickerService.isVideo(visual)) {
          await optimizeVideo(visualInput, stickerOutput, this.limits.maxVideoSeconds, this.limits.maxOutputBytes);
        } else {
          await optimizeImage(visualInput, stickerOutput, this.limits.maxOutputBytes);
        }

        const audioDuration = await durationOf(audioInput);
        // Opus granule timing may report a few milliseconds beyond the requested
        // cutoff. Anything materially longer is rejected before conversion.
        if (audioDuration > this.limits.maxAudioSeconds + 0.1) {
          throw new SoundStickerError('DURATION', 'Durasi audio melebihi batas yang ditentukan.');
        }
        await runFfmpeg(['-i', audioInput, '-t', String(this.limits.maxAudioSeconds), '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '48k', audioOutput]);
        const [sticker, sound] = await Promise.all([fs.readFile(stickerOutput), fs.readFile(audioOutput)]);
        if (sticker.length > this.limits.maxOutputBytes) {
          throw new SoundStickerError('OUTPUT_TOO_LARGE', 'Ukuran sticker hasil melebihi batas.');
        }
        return {
          sticker,
          audio: sound,
          seconds: Math.max(1, Math.min(this.limits.maxAudioSeconds, Math.ceil(audioDuration)))
        };
      });
    } finally {
      release();
    }
  }

  async extractVideoAudio(video) {
    const release = await acquire(this.limits.maxConcurrentJobs);
    try {
      return await withTempDirectory(async (directory) => {
        const input = path.join(directory, `${randomUUID()}.video`);
        const output = path.join(directory, 'sound.ogg');
        await fs.writeFile(input, video.buffer);
        await runFfmpeg(['-i', input, '-t', String(this.limits.maxAudioSeconds), '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '48k', output]);
        const audio = await fs.readFile(output);
        if (!audio.length) throw new SoundStickerError('NO_AUDIO', 'Video tidak memiliki audio yang dapat digunakan.');
        return { buffer: audio, mime: 'audio/ogg; codecs=opus' };
      });
    } catch (error) {
      if (error instanceof SoundStickerError) throw error;
      throw new SoundStickerError('NO_AUDIO', 'Video tidak memiliki audio yang dapat digunakan.');
    } finally {
      release();
    }
  }
}
