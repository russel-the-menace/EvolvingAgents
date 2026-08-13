import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function extractDouyinShare(shareText) {
  const text = String(shareText || '').trim();
  const match = text.match(/https?:\/\/v\.douyin\.com\/[A-Za-z0-9_-]+\/?/i);
  if (!match) throw new Error('Paste a Douyin share message containing a v.douyin.com link.');
  const withoutLink = text.replace(match[0], '').replace(/复制此链接[，,]?\s*打开Dou音搜索[，,]?\s*直接观看视频！?/gi, '').trim();
  const titleMatch = withoutLink.match(/[:：]\s*([^#\n]{4,120})/);
  const titleSource = titleMatch?.[1] || withoutLink.split(/[#\n]/)[0] || 'Douyin learning material';
  const firstChineseCharacter = titleSource.search(/\p{Script=Han}/u);
  const title = titleSource.slice(firstChineseCharacter >= 0 ? firstChineseCharacter : 0).trim().replace(/[。！!]+$/, '');
  const tags = [...withoutLink.matchAll(/#\s*([^#\s]+)/g)].map((item) => item[1]).slice(0, 12);
  return { sourceUrl: match[0], title: title.slice(0, 120), shareText: text, tags };
}

export async function resolveDouyinLink(sourceUrl) {
  let current = sourceUrl;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const url = new URL(current);
    if (url.protocol !== 'https:' || !(url.hostname === 'douyin.com' || url.hostname.endsWith('.douyin.com'))) {
      throw new Error('The shared link redirected outside Douyin and was not followed.');
    }
    const result = await fetch(current, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 MindClone/0.2' }, signal: AbortSignal.timeout(8_000) });
    if (result.status < 300 || result.status >= 400) return current;
    const next = result.headers.get('location');
    if (!next) return current;
    current = new URL(next, current).toString();
  }
  return current;
}

function findMediaUrl(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) { const found = findMediaUrl(item, seen); if (found) return found; }
    return null;
  }
  const preferredKeys = ['play_addr', 'play_url', 'download_addr', 'download_url', 'video_url', 'url_list', 'url'];
  for (const key of preferredKeys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) return candidate;
    if (Array.isArray(candidate)) {
      const url = candidate.find((item) => typeof item === 'string' && /^https?:\/\//i.test(item));
      if (url) return url;
    }
    if (candidate && typeof candidate === 'object') { const found = findMediaUrl(candidate, seen); if (found) return found; }
  }
  for (const candidate of Object.values(value)) { const found = findMediaUrl(candidate, seen); if (found) return found; }
  return null;
}

function findPlaybackUrl(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) { const found = findPlaybackUrl(item, seen); if (found) return found; }
    return null;
  }
  if (value.play_addr) {
    const found = findMediaUrl(value.play_addr);
    if (found) return found;
  }
  for (const candidate of Object.values(value)) { const found = findPlaybackUrl(candidate, seen); if (found) return found; }
  return null;
}

async function fetchTikHubVideo(shareText) {
  const token = process.env.TIKHUB_API_KEY;
  if (!token) throw new Error('TIKHUB_API_KEY is not configured. Add it to the local .env file and restart the service.');
  const baseUrl = (process.env.TIKHUB_BASE_URL || 'https://api.tikhub.dev').replace(/\/$/, '');
  const url = new URL('/api/v1/hybrid/video_data', baseUrl);
  url.searchParams.set('url', shareText);
  url.searchParams.set('minimal', 'false');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 200) throw new Error(payload.message_zh || payload.message || `TikHub video parsing failed (${response.status}).`);
  const mediaUrl = findPlaybackUrl(payload.data) || findMediaUrl(payload.data);
  if (!mediaUrl) throw new Error('TikHub returned video data but no downloadable media URL.');
  return { data: payload.data, mediaUrl };
}

export async function transcribeShortVideo(shareText) {
  const whisperModel = process.env.WHISPER_MODEL_PATH || join(process.cwd(), 'models', 'whisper', 'ggml-small.bin');
  try { await readFile(whisperModel); } catch { throw new Error(`Local Whisper model was not found at ${whisperModel}. Run the setup command or set WHISPER_MODEL_PATH.`); }
  const { mediaUrl, data } = await fetchTikHubVideo(shareText);
  const directory = await mkdtemp(join(tmpdir(), 'mindclone-transcript-'));
  const mediaPath = join(directory, 'source-media');
  const audioPath = join(directory, 'speech.wav');
  try {
    const media = await fetch(mediaUrl, { headers: { 'User-Agent': 'Mozilla/5.0 MindClone/0.2' }, signal: AbortSignal.timeout(120_000) });
    if (!media.ok || !media.body) throw new Error(`Media download failed (${media.status}).`);
    const bytes = Buffer.from(await media.arrayBuffer());
    if (bytes.length > 200 * 1024 * 1024) throw new Error('The source video exceeds the 200 MB transcription limit.');
    await writeFile(mediaPath, bytes);
    await execFileAsync('ffmpeg', ['-y', '-i', mediaPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audioPath], { timeout: 120_000 });
    const outputBase = join(directory, 'transcript');
    const threads = String(Math.max(1, Math.min(Number(process.env.WHISPER_THREADS || 4), 12)));
    await execFileAsync(process.env.WHISPER_CLI_PATH || 'whisper-cli', ['-m', whisperModel, '-f', audioPath, '-l', 'zh', '-otxt', '-of', outputBase, '-t', threads, '-np'], { timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 });
    const transcript = (await readFile(`${outputBase}.txt`, 'utf8')).trim();
    if (!transcript) throw new Error('Local Whisper returned an empty transcript.');
    return { transcript, videoData: data };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
