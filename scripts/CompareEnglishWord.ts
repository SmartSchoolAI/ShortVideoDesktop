#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn, execSync } from 'child_process';
import { uploadToR2, CDN_BASE_DOMAIN } from '../src/functions/r2-client';

// Material download helper function
async function downloadFile(url: string, destPath: string, minSizeBytes = 1000): Promise<boolean> {
  try {
    const parentDir = path.dirname(destPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Reuse if local file already exists and meets minimum size requirements
    if (fs.existsSync(destPath)) {
      const stats = fs.statSync(destPath);
      if (stats.size >= minSizeBytes) {
        return true;
      }
    }

    // Attempt up to 2 downloads with a 10-second timeout
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          return false;
        }
        const arrayBuffer = await res.arrayBuffer();
        if (arrayBuffer.byteLength < minSizeBytes) return false;

        fs.writeFileSync(destPath, new Uint8Array(arrayBuffer));
        return true;
      } catch (_) {
        if (attempt >= 2) return false;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return false;
  } catch (err: any) {
    return false;
  }
}

// Probe exact audio duration using ffprobe
function getMediaExactDuration(filePath: string): number | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    const stdout = execSync(cmd, { encoding: 'utf-8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
    const val = parseFloat(stdout.trim());
    if (!isNaN(val) && val > 0) {
      return Number(val.toFixed(3));
    }
  } catch (e) {}
  return null;
}

// Apply slight pitch shift to MP4 audio track
// ： （Hz） ，
// ：ffmpeg rubberband  （ ），  asetrate+atempo
// pitchCents:  （ ），1  = 1/100  ≈ 0.058%
// ±5~10 ，±2~6
async function applyAudioPitchShift(mp4Path: string, pitchCents: number): Promise<boolean> {
  if (!pitchCents || pitchCents === 0) return true;
  if (!fs.existsSync(mp4Path)) return false;

  const tmpPath = mp4Path.replace(/\.mp4$/, `_pitchshift_tmp.mp4`);

  // pitch ratio = 2^(cents/1200)，  asetrate
  const pitchRatio = Math.pow(2, pitchCents / 1200);
  // asetrate  （  44100   48000，  48000  ）
  const baseSampleRate = 48000;
  const shiftedSampleRate = Math.round(baseSampleRate * pitchRatio);

  // rubberband（ ， ）
  // ：asetrate  （ ）+ atempo
  const strategies: Array<{ name: string; audioFilter: string }> = [
    {
      name: 'rubberband',
      audioFilter: `rubberband=pitch=${pitchRatio.toFixed(6)}`,
    },
    {
      name: 'asetrate+atempo',
      // asetrate  / （ ），atempo
      audioFilter: `asetrate=${shiftedSampleRate},aresample=${baseSampleRate},atempo=${(1 / pitchRatio).toFixed(6)}`,
    },
  ];

  for (const strategy of strategies) {
    try {
      // ffmpeg  ：  copy，
      const cmd = [
        'ffmpeg', '-y',
        '-i', `"${mp4Path}"`,
        '-vcodec', 'copy',
        '-af', `"${strategy.audioFilter}"`,
        '-acodec', 'aac',
        '-b:a', '192k',
        `"${tmpPath}"`,
      ].join(' ');

      execSync(cmd, { timeout: 120000, stdio: 'pipe' });

      if (fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 10000) {
        fs.renameSync(tmpPath, mp4Path);
        return true;
      }
    } catch (_e) {
      // ，
      if (fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
      }
    }
  }

  return false;
}

// Load multi-tier environment variables
// 1.  ：  .env   .env.desktop
// 2.  ：  .env，  .env.desktop
function loadEnv() {
  const procResourcesPath = (process as any).resourcesPath || '';
  const isPackaged = Boolean(
    procResourcesPath ||
    __dirname.includes('.asar') ||
    (process.env.ELECTRON_RUN_AS_NODE === '1' && !fs.existsSync(path.resolve(__dirname, '../../package.json')))
  );

  const candidatePaths = isPackaged
    ? [
        path.join(procResourcesPath, '.env.desktop'),
        path.join(procResourcesPath, 'app.asar.unpacked', '.env.desktop'),
        path.resolve(process.cwd(), '.env.desktop'),
        path.resolve(__dirname, '../.env.desktop'),
        path.resolve(__dirname, '../../.env.desktop'),
      ].filter(Boolean)
    : [
        path.resolve(process.cwd(), '.env.desktop'),
        path.resolve(__dirname, '../.env.desktop'),
        path.resolve(__dirname, '../../.env.desktop'),
        path.resolve(process.cwd(), '.env'),
        path.resolve(process.cwd(), '.env.local'),
        path.resolve(__dirname, '../.env'),
        path.resolve(__dirname, '../.env.local'),
      ].filter(Boolean);

  for (const envPath of candidatePaths) {
    if (fs.existsSync(envPath)) {
      try {
        const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const idx = trimmed.indexOf('=');
          if (idx > 0) {
            const key = trimmed.slice(0, idx).trim();
            const val = trimmed.slice(idx + 1).trim().replace(/(^["'])|(["']$)/g, '');
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch (e) {}
      break;
    }
  }
}
loadEnv();

// 、  Token
function extractAuthToken(): string {
  const args = process.argv.slice(2);
  for (const a of args) {
    if (a.startsWith('--token=')) {
      return a.slice(8).trim();
    }
  }
  if (process.env.SHORTVIDEO_AUTH_TOKEN && process.env.SHORTVIDEO_AUTH_TOKEN.trim()) {
    return process.env.SHORTVIDEO_AUTH_TOKEN.trim();
  }
  if (process.env.AUTH_TOKEN && process.env.AUTH_TOKEN.trim()) {
    return process.env.AUTH_TOKEN.trim();
  }

  // user_session.json
  try {
    const candidateDirs = [
      path.join(process.env.APPDATA || '', 'shortvideo'),
      path.join(process.env.APPDATA || '', 'ShortVideo'),
      path.join(process.env.HOME || '', '.config', 'shortvideo'),
      path.join(process.env.HOME || '', '.config', 'ShortVideo'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'shortvideo'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'ShortVideo'),
      path.resolve(__dirname, '..'),
    ];
    for (const d of candidateDirs) {
      if (!d) continue;
      const sFile = path.join(d, 'user_session.json');
      if (fs.existsSync(sFile)) {
        const raw = fs.readFileSync(sFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed?.token && typeof parsed.token === 'string') {
          return parsed.token.trim();
        }
      }
    }
  } catch (_) {}

  return '';
}

function decryptStoredToken(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  // 1.   JWT Token (xxx.yyy.zzz)，
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) {
    return trimmed;
  }
  // 2.   AES-256-CBC   JWT Token
  try {
    const keyHex = process.env.NEXT_PUBLIC_AESKEY || '68656c6c6f20776f726c64203132333435363738';
    const ivHex = process.env.NEXT_PUBLIC_AESIV || '31323334353637383930313233343536';
    const key = Buffer.from(keyHex.padEnd(64, '0'), 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key as any, iv as any);
    let decrypted = decipher.update(trimmed, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    if (decrypted) {
      try {
        const parsed = JSON.parse(decrypted);
        if (typeof parsed === 'string') return parsed.trim();
        if (parsed && typeof parsed.token === 'string') return parsed.token.trim();
      } catch {
        return decrypted.trim();
      }
    }
  } catch (_) {}
  return trimmed;
}

const CURRENT_AUTH_TOKEN = decryptStoredToken(extractAuthToken());


const DEFAULT_API_BASE =
  process.env.SHORTVIDEO_API_BASE ||
  process.env.NEXT_PUBLIC_APP_SITE_URL ||
  process.env.NEXT_PUBLIC_SITE_ORIGIN ||
  'https://app.shortvideo.ca';
const getCdnDomain = () => process.env.NEXT_PUBLIC_DOWNLOAD_BASE_URL || CDN_BASE_DOMAIN || '';
const POLL_INTERVAL_MS = 30000; // 30
function resolveSafeRootDir(): string {
  if (process.env.SHORTVIDEO_ROOT_DIR && !process.env.SHORTVIDEO_ROOT_DIR.includes('.asar')) {
    return process.env.SHORTVIDEO_ROOT_DIR;
  }
  if (!__dirname.includes('.asar')) {
    return path.resolve(__dirname, '..');
  }
  // app.asar  ， ，  .asar   ENOTDIR
  const fallbackBase = process.env.APPDATA || process.env.HOME || os.homedir();
  return path.join(fallbackBase, 'ShortVideo');
}

const ROOT_DIR = resolveSafeRootDir();

/**
 *  ：
 * 1.   SHORTVIDEO_OUTPUT_DIR（ ，  %APPDATA%/shortvideo/out）
 * 2.   APPDATA/shortvideo/out  
 * 3.   out
 */
function resolveBaseOutputDir(): string {
  if (process.env.SHORTVIDEO_OUTPUT_DIR && !process.env.SHORTVIDEO_OUTPUT_DIR.includes('.asar')) {
    return process.env.SHORTVIDEO_OUTPUT_DIR;
  }
  if (__dirname.includes('.asar') || (process as any).resourcesPath) {
    const fallbackBase = process.env.APPDATA || process.env.HOME || os.homedir();
    return path.join(fallbackBase, 'shortvideo', 'out');
  }
  return path.join(ROOT_DIR, 'out');
}

// Cloudflare R2
const HAS_R2_CONFIG = Boolean(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY
);

// CLI rendering script multi-language (14 languages) mechanism
const SCRIPT_VALID_LANGS = ['zh', 'en', 'ja', 'ko', 'vi', 'th', 'id', 'es', 'fr', 'pt', 'de', 'it', 'ru', 'tr'] as const;
type ScriptSupportedLang = typeof SCRIPT_VALID_LANGS[number];

function normalizeScriptLang(lang?: string | null): ScriptSupportedLang {
  if (!lang) return 'zh';
  const clean = String(lang).toLowerCase().trim();
  if ((SCRIPT_VALID_LANGS as readonly string[]).includes(clean)) {
    return clean as ScriptSupportedLang;
  }
  const prefix = clean.split(/[-_]/)[0];
  if ((SCRIPT_VALID_LANGS as readonly string[]).includes(prefix)) {
    return prefix as ScriptSupportedLang;
  }
  return 'zh';
}

const SCRIPT_I18N_RULES: Array<{ regex: RegExp; translations: Partial<Record<ScriptSupportedLang, string>> }> = [
  {
    regex: /网络操作/g,
    translations: {
      "zh": "Network operation",
      "en": "Network operation",
      "ja": "Network operation",
      "ko": "네트워크 작업",
      "vi": "Thao tác mạng",
      "th": "การดำเนินการเครือข่าย",
      "id": "Operasi jaringan",
      "es": "Operación de red",
      "fr": "Opération réseau",
      "pt": "Operação de rede",
      "de": "Netzwerkoperation",
      "it": "Operazione di rete",
      "ru": "Сетевая операция",
      "tr": "Ağ işlemi",
    }
  },
  {
    regex: /中文字幕/g,
    translations: {
      "zh": "Chinese Subtitles",
      "en": "Chinese Subtitles",
      "ja": "Chinese Subtitles",
      "ko": "중국어 자막",
      "vi": "Phụ đề tiếng Trung",
      "th": "ซับไตเติลภาษาจีน",
      "id": "Subtitel Bahasa Mandarin",
      "es": "Subtítulos en chino",
      "fr": "Sous-titres chinois",
      "pt": "Legendas em chinês",
      "de": "Chinesische Untertitel",
      "it": "Sottotitoli in cinese",
      "ru": "Китайские субтитры",
      "tr": "Çince Altyazı",
    }
  },
  {
    regex: /纯英文/g,
    translations: {
      "zh": "English Only",
      "en": "English Only",
      "ja": "English Only",
      "ko": "영어 전용",
      "vi": "Chỉ tiếng Anh",
      "th": "ภาษาอังกฤษเท่านั้น",
      "id": "Hanya Bahasa Inggris",
      "es": "Solo inglés",
      "fr": "Anglais uniquement",
      "pt": "Apenas inglês",
      "de": "Nur Englisch",
      "it": "Solo inglese",
      "ru": "Только английский",
      "tr": "Sadece İngilizce",
    }
  },
  {
    regex: /日文字幕/g,
    translations: {
      "zh": "Japanese Subtitles",
      "en": "Japanese Subtitles",
      "ja": "Japanese Subtitles",
      "ko": "일본어 자막",
      "vi": "Phụ đề tiếng Nhật",
      "th": "ซับไตเติลภาษาญี่ปุ่น",
      "id": "Subtitel Bahasa Jepang",
      "es": "Subtítulos en japonés",
      "fr": "Sous-titres japonais",
      "pt": "Legendas em japonês",
      "de": "Japanische Untertitel",
      "it": "Sottotitoli in giapponese",
      "ru": "Японские субтитры",
      "tr": "Japonca Altyazı",
    }
  },
  {
    regex: /韩文字幕/g,
    translations: {
      "zh": "Korean Subtitles",
      "en": "Korean Subtitles",
      "ja": "Korean Subtitles",
      "ko": "한국어 자막",
      "vi": "Phụ đề tiếng Hàn",
      "th": "ซับไตเติลเกาหลี",
      "id": "Subtitel Bahasa Korea",
      "es": "Subtítulos en coreano",
      "fr": "Sous-titres coréens",
      "pt": "Legendas em coreano",
      "de": "Koreanische Untertitel",
      "it": "Sottotitoli in coreano",
      "ru": "Корейские субтитры",
      "tr": "Korece Altyazı",
    }
  },
  {
    regex: /越南文字幕/g,
    translations: {
      "zh": "Vietnamese Subtitles",
      "en": "Vietnamese Subtitles",
      "ja": "Vietnamese Subtitles",
      "ko": "베트남어 자막",
      "vi": "Phụ đề tiếng Việt",
      "th": "ซับไตเติลเวียดนาม",
      "id": "Subtitel Bahasa Vietnam",
      "es": "Subtítulos en vietnamita",
      "fr": "Sous-titres vietnamiens",
      "pt": "Legendas em vietnamita",
      "de": "Vietnamesische Untertitel",
      "it": "Sottotitoli in vietnamita",
      "ru": "Вьетнамские субтитры",
      "tr": "Vietnamca Altyazı",
    }
  },
  {
    regex: /泰文字幕/g,
    translations: {
      "zh": "Thai Subtitles",
      "en": "Thai Subtitles",
      "ja": "Thai Subtitles",
      "ko": "태국어 자막",
      "vi": "Phụ đề tiếng Thái",
      "th": "ซับไตเติลไทย",
      "id": "Subtitel Bahasa Thailand",
      "es": "Subtítulos en tailandés",
      "fr": "Sous-titres thaïlandais",
      "pt": "Legendas em tailandês",
      "de": "Thailändische Untertitel",
      "it": "Sottotitoli in tailandese",
      "ru": "Тайские субтитры",
      "tr": "Tayca Altyazı",
    }
  },
  {
    regex: /印尼文字幕/g,
    translations: {
      "zh": "Indonesian Subtitles",
      "en": "Indonesian Subtitles",
      "ja": "Indonesian Subtitles",
      "ko": "인도네시아어 자막",
      "vi": "Phụ đề tiếng Indonesia",
      "th": "ซับไตเติลอินโดนีเซีย",
      "id": "Subtitel Bahasa Indonesia",
      "es": "Subtítulos en indonesio",
      "fr": "Sous-titres indonésiens",
      "pt": "Legendas em indonésio",
      "de": "Indonesische Untertitel",
      "it": "Sottotitoli in indonesiano",
      "ru": "Индонезийские субтитры",
      "tr": "Endonezce Altyazı",
    }
  },
  {
    regex: /西班牙文字幕/g,
    translations: {
      "zh": "Spanish Subtitles",
      "en": "Spanish Subtitles",
      "ja": "Spanish Subtitles",
      "ko": "스페인어 자막",
      "vi": "Phụ đề tiếng Tây Ban Nha",
      "th": "ซับไตเติลสเปน",
      "id": "Subtitel Bahasa Spanyol",
      "es": "Subtítulos en español",
      "fr": "Sous-titres espagnols",
      "pt": "Legendas em espanhol",
      "de": "Spanische Untertitel",
      "it": "Sottotitoli in spagnolo",
      "ru": "Испанские субтитры",
      "tr": "İspanyolca Altyazı",
    }
  },
  {
    regex: /法文字幕/g,
    translations: {
      "zh": "French Subtitles",
      "en": "French Subtitles",
      "ja": "French Subtitles",
      "ko": "프랑스어 자막",
      "vi": "Phụ đề tiếng Pháp",
      "th": "ซับไตเติลฝรั่งเศส",
      "id": "Subtitel Bahasa Prancis",
      "es": "Subtítulos en francés",
      "fr": "Sous-titres français",
      "pt": "Legendas em francês",
      "de": "Französische Untertitel",
      "it": "Sottotitoli in francese",
      "ru": "Французские субтитры",
      "tr": "Fransızca Altyazı",
    }
  },
  {
    regex: /葡萄牙文字幕/g,
    translations: {
      "zh": "Portuguese Subtitles",
      "en": "Portuguese Subtitles",
      "ja": "Portuguese Subtitles",
      "ko": "포르투갈어 자막",
      "vi": "Phụ đề tiếng Bồ Đào Nha",
      "th": "ซับไตเติลโปรตุเกส",
      "id": "Subtitel Bahasa Portugis",
      "es": "Subtítulos en portugués",
      "fr": "Sous-titres portugais",
      "pt": "Legendas em português",
      "de": "Portugiesische Untertitel",
      "it": "Sottotitoli in portoghese",
      "ru": "Португальские субтитры",
      "tr": "Portekizce Altyazı",
    }
  },
  {
    regex: /德文字幕/g,
    translations: {
      "zh": "German Subtitles",
      "en": "German Subtitles",
      "ja": "German Subtitles",
      "ko": "독일어 자막",
      "vi": "Phụ đề tiếng Đức",
      "th": "ซับไตเติลเยอรมัน",
      "id": "Subtitel Bahasa Jerman",
      "es": "Subtítulos en alemán",
      "fr": "Sous-titres allemands",
      "pt": "Legendas em alemão",
      "de": "Deutsche Untertitel",
      "it": "Sottotitoli in tedesco",
      "ru": "Немецкие субтитры",
      "tr": "Almanca Altyazı",
    }
  },
  {
    regex: /意大利文字幕/g,
    translations: {
      "zh": "Italian Subtitles",
      "en": "Italian Subtitles",
      "ja": "Italian Subtitles",
      "ko": "이탈리아어 자막",
      "vi": "Phụ đề tiếng Ý",
      "th": "ซับไตเติลอิตาลี",
      "id": "Subtitel Bahasa Italia",
      "es": "Subtítulos en italiano",
      "fr": "Sous-titres italiens",
      "pt": "Legendas em italiano",
      "de": "Italienische Untertitel",
      "it": "Sottotitoli in italiano",
      "ru": "Итальянские субтитры",
      "tr": "İtalyanca Altyazı",
    }
  },
  {
    regex: /俄文字幕/g,
    translations: {
      "zh": "Russian Subtitles",
      "en": "Russian Subtitles",
      "ja": "Russian Subtitles",
      "ko": "러시아어 자막",
      "vi": "Phụ đề tiếng Nga",
      "th": "ซับไตเติลรัสเซีย",
      "id": "Subtitel Bahasa Rusia",
      "es": "Subtítulos en ruso",
      "fr": "Sous-titres russes",
      "pt": "Legendas em russo",
      "de": "Russische Untertitel",
      "it": "Sottotitoli in russo",
      "ru": "Русские субтитры",
      "tr": "Rusça Altyazı",
    }
  },
  {
    regex: /土耳其文字幕/g,
    translations: {
      "zh": "Turkish Subtitles",
      "en": "Turkish Subtitles",
      "ja": "Turkish Subtitles",
      "ko": "터키어 자막",
      "vi": "Phụ đề tiếng Thổ Nhĩ Kỳ",
      "th": "ซับไตเติลตุรกี",
      "id": "Subtitel Bahasa Turki",
      "es": "Subtítulos en turco",
      "fr": "Sous-titres turcs",
      "pt": "Legendas em turco",
      "de": "Türkische Untertitel",
      "it": "Sottotitoli in turco",
      "ru": "Турецкие субтитры",
      "tr": "Türkçe Altyazı",
    }
  },
  {
    regex: /根据任务语言设定检测到 (\d+) 种渲染版本，即将开始渲染[:：]/g,
    translations: {
      "zh": "Detected $1 render versions based on task language settings, starting render:",
      "en": "Detected $1 render versions based on task language settings, starting render:",
      "ja": "Detected $1 render versions based on task language settings, starting render:",
      "ko": "작업 언어 설정에 따라 $1개 렌더링 버전이 감지되었습니다. 렌더링을 시작합니다:",
      "vi": "Đã phát hiện $1 phiên bản render dựa trên cài đặt ngôn ngữ, chuẩn bị bắt đầu render:",
      "th": "ตรวจพบ $1 เวอร์ชันเรนเดอร์ตามการตั้งค่าภาษา กำลังเริ่มเรนเดอร์:",
      "id": "Mendeteksi $1 versi render berdasarkan pengaturan bahasa, memulai render:",
      "es": "Se detectaron $1 versiones de renderizado según la configuración de idioma, iniciando:",
      "fr": "Détection de $1 versions de rendu basées sur la langue, démarrage du rendu :",
      "pt": "Detectadas $1 versões de renderização com base no idioma, iniciando:",
      "de": "$1 Rendering-Versionen basierend auf den Sprachoptionen erkannt, Rendering wird gestartet:",
      "it": "Rilevate $1 versioni di rendering in base alla lingua, avvio del rendering:",
      "ru": "Обнаружено $1 версий рендеринга на основе настроек языка, запуск рендеринга:",
      "tr": "Görev dil ayarlarına göre $1 işleme sürümü algılandı, işleme başlatılıyor:",
    }
  },
  {
    regex: /正在执行【(.*?)】渲染 \((.*?)\)\.\.\./g,
    translations: {
      "zh": "正在执行【$1】渲染 ($2)...",
      "en": "Executing [$1] rendering ($2)...",
      "ja": "【$1】のレンダリングを実行中 ($2)...",
      "ko": "【$1】 렌더링 실행 중 ($2)...",
      "vi": "Đang thực hiện render [$1] ($2)...",
      "th": "กำลังเรนเดอร์ [$1] ($2)...",
      "id": "Mengeksekusi rendering [$1] ($2)...",
      "es": "Ejecutando renderizado de [$1] ($2)...",
      "fr": "Exécution du rendu [$1] ($2)...",
      "pt": "Executando renderização de [$1] ($2)...",
      "de": "Rendering von [$1] wird ausgeführt ($2)...",
      "it": "Esecuzione rendering di [$1] ($2)...",
      "ru": "Выполнение рендеринга [$1] ($2)...",
      "tr": "[$1] işlemesi yürütülüyor ($2)...",
    }
  },
  {
    regex: /【(.*?)】渲染完成! 耗时[:：]\s*(.*?)s \| 文件大小[:：]\s*(.*?) MB/g,
    translations: {
      "zh": "[$1] render completed! Time: $2s | File size: $3 MB",
      "en": "[$1] render completed! Time: $2s | File size: $3 MB",
      "ja": "[$1] render completed! Time: $2s | File size: $3 MB",
      "ko": "【$1】 렌더링 완료! 소요 시간: $2s | 파일 크기: $3 MB",
      "vi": "[$1] render thành công! Thời gian: $2s | Dung lượng: $3 MB",
      "th": "[$1] เรนเดอร์เสร็จสมบูรณ์! ใช้เวลา: $2 วินาที | ขนาดไฟล์: $3 MB",
      "id": "[$1] render selesai! Waktu: $2s | Ukuran berkas: $3 MB",
      "es": "¡Renderizado de [$1] completado! Tiempo: $2s | Tamaño: $3 MB",
      "fr": "Rendu de [$1] terminé ! Temps : $2s | Taille : $3 MB",
      "pt": "Renderização de [$1] concluída! Tempo: $2s | Tamanho: $3 MB",
      "de": "Rendering von [$1] abgeschlossen! Dauer: $2s | Dateigröße: $3 MB",
      "it": "Rendering di [$1] completato! Tempo: $2s | Dimensione file: $3 MB",
      "ru": "Рендеринг [$1] завершен! Время: $2с | Размер файла: $3 МБ",
      "tr": "[$1] işlemesi tamamlandı! Süre: $2s | Dosya boyutu: $3 MB",
    }
  },
  {
    regex: /正在对音频轨做微小变调 \((.*?) 音分\)，人耳无感知但指纹辛辣差异化\.\.\./g,
    translations: {
      "zh": "Applying subtle pitch shift ($1 cents) to audio track to differentiate fingerprint...",
      "en": "Applying subtle pitch shift ($1 cents) to audio track to differentiate fingerprint...",
      "ja": "Applying subtle pitch shift ($1 cents) to audio track to differentiate fingerprint...",
      "ko": "오디오 트랙에 미세 피치 시프트 ($1 센트) 적용 중...",
      "vi": "Đang áp dụng điều chỉnh cao độ ($1 cents) cho dải âm thanh...",
      "th": "กำลังปรับระดับเสียงในแทร็กเสียง ($1 เซนต์)...",
      "id": "Menerapkan pitch shift halus ($1 sen) pada trek audio...",
      "es": "Aplicando cambio sutil de tono ($1 cents) a la pista de audio...",
      "fr": "Application d'un léger changement de hauteur ($1 cents) à la piste audio...",
      "pt": "Aplicando alteração sutil de tom ($1 cents) na faixa de áudio...",
      "de": "Subtile Tonhöhenänderung ($1 Cents) auf die Tonspur anwenden...",
      "it": "Applicazione di un leggero cambio di tonalità ($1 cents) alla traccia audio...",
      "ru": "Применение питч-шифта ($1 центов) к аудиодорожке...",
      "tr": "Ses parçasına ince ton kaydırma ($1 cent) uygulanıyor...",
    }
  },
  {
    regex: /【(.*?)】代理上传成功! 耗时[:：]\s*(.*?)s \| 地址[:：]\s*(.*)/g,
    translations: {
      "zh": "[$1] proxy upload successful! Time: $2s | URL: $3",
      "en": "[$1] proxy upload successful! Time: $2s | URL: $3",
      "ja": "[$1] proxy upload successful! Time: $2s | URL: $3",
      "ko": "【$1】 프록시 업로드 성공! 소요 시간: $2s | URL: $3",
      "vi": "[$1] tải lên qua proxy thành công! Thời gian: $2s | URL: $3",
      "th": "[$1] อัปโหลดผ่านพร็อกซีสำเร็จ! ใช้เวลา: $2 วินาที | URL: $3",
      "id": "[$1] unggah proksi berhasil! Waktu: $2s | URL: $3",
      "es": "¡[$1] carga proxy exitosa! Tiempo: $2s | URL: $3",
      "fr": "Téléversement proxy [$1] réussi ! Temps : $2s | URL : $3",
      "pt": "Upload por proxy de [$1] bem-sucedido! Tempo: $2s | URL: $3",
      "de": "Proxy-Upload für [$1] erfolgreich! Dauer: $2s | URL: $3",
      "it": "Caricamento proxy di [$1] riuscito! Tempo: $2s | URL: $3",
      "ru": "Загрузка через прокси [$1] успешна! Время: $2с | URL: $3",
      "tr": "[$1] vekil yüklemesi başarılı! Süre: $2s | URL: $3",
    }
  },
  {
    regex: /【(.*?)】本地直传成功[:：]\s*(.*)/g,
    translations: {
      "zh": "[$1] local direct upload successful: $2",
      "en": "[$1] local direct upload successful: $2",
      "ja": "[$1] local direct upload successful: $2",
      "ko": "【$1】 로컬 직송 성공: $2",
      "vi": "[$1] tải trực tiếp cục bộ thành công: $2",
      "th": "[$1] อัปโหลดตรงในเครื่องสำเร็จ: $2",
      "id": "[$1] unggah langsung lokal berhasil: $2",
      "es": "[$1] Carga directa local exitosa: $2",
      "fr": "Téléversement direct local [$1] réussi : $2",
      "pt": "Upload direto local de [$1] bem-sucedido: $2",
      "de": "Direkter lokaler Upload für [$1] erfolgreich: $2",
      "it": "Caricamento diretto locale di [$1] riuscito: $2",
      "ru": "Прямая локальная загрузка [$1] успешна: $2",
      "tr": "[$1] yerel doğrudan yükleme başarılı: $2",
    }
  },
  {
    regex: /任务 \[(.*?)\] (\d+) 个多语言视频全部处理并发布完成!/g,
    translations: {
      "zh": "Task [$1] all $2 multilingual videos processed and published!",
      "en": "Task [$1] all $2 multilingual videos processed and published!",
      "ja": "Task [$1] all $2 multilingual videos processed and published!",
      "ko": "작업 [$1] 총 $2개 다국어 동영상 처리 및 게시 완료!",
      "vi": "Nhiệm vụ [$1] tất cả $2 video đa ngôn ngữ đã xử lý và xuất bản xong!",
      "th": "งาน [$1] ทั้งหมด $2 วิดีโอหลายภาษาประมวลผลและเผยแพร่เสร็จสมบูรณ์!",
      "id": "Tugas [$1] semua $2 video multibahasa telah diproses dan dipublikasikan!",
      "es": "¡Tarea [$1] procesada y publicada para los $2 videos multilingües!",
      "fr": "Tâche [$1] : les $2 vidéos multilingues ont été traitées et publiées !",
      "pt": "Tarefa [$1]: todos os $2 vídeos multilíngues processados e publicados!",
      "de": "Aufgabe [$1]: Alle $2 mehrsprachigen Videos verarbeitet und veröffentlicht!",
      "it": "Attività [$1]: tutti i $2 video multilingue elaborati e pubblicati!",
      "ru": "Задача [$1]: все $2 мультиязычных видео успешно обработаны и опубликованы!",
      "tr": "Görev [$1] tüm $2 çok dilli video işlendi ve yayınlandı!",
    }
  },
  {
    regex: /正在向服务端同步状态为「渲染完成 \(video_finished\)」\.\.\./g,
    translations: {
      "zh": "Syncing status [video_finished] to server...",
      "en": "Syncing status [video_finished] to server...",
      "ja": "Syncing status [video_finished] to server...",
      "ko": "서버로 상태 [video_finished] 동기화 중...",
      "vi": "Đang đồng bộ trạng thái [video_finished] với máy chủ...",
      "th": "กำลังซิงค์สถานะ [video_finished] ไปยังเซิร์ฟเวอร์...",
      "id": "Menyinkronkan status [video_finished] ke server...",
      "es": "Sincronizando estado [video_finished] con el servidor...",
      "fr": "Synchronisation du statut [video_finished] avec le serveur...",
      "pt": "Sincronizando status [video_finished] com o servidor...",
      "de": "Status [video_finished] wird mit dem Server synchronisiert...",
      "it": "Sincronizzazione dello stato [video_finished] con il server...",
      "ru": "Синхронизация статуса [video_finished] с сервером...",
      "tr": "[video_finished] durumu sunucuya senkronize ediliyor...",
    }
  },
  {
    regex: /🧹\ 检测到强制重新构建，清理历史缓存目录:\ \$\{BUNDLE_CACHE_DIR\}/g,
    translations: {
      "zh": "🧹 检测到强制重新构建，清理历史缓存目录: ${BUNDLE_CACHE_DIR}",
      "en": "🧹 检测到强制重新构建，清理历史缓存目录: BUNDLE_CACHE_DIR",
      "ja": "🧹 检测到强制重新构建，清理历史缓存目录: BUNDLE_CACHE_DIR",
      "ko": "🧹 检测到强制重新构建，清理历史缓存目录: BUNDLE_CACHE_DIR",
      "vi": "🧹 检测到强制重新构建，清理历史缓存目录: BUNDLE_CACHE_DIR",
      "th": "🧹 检测到强制重新构建，清理历史缓存目录: BUNDLE_CACHE_DIR",
      "id": "🧹 检测到强制重新构建，清理历史缓存目录: BUNDLE_CACHE_DIR",
      "es": "🧹 检测到强制重新构建，清理历史缓存目录: BUNDLE_CACHE_DIR",
      "fr": "🧹 检测到强制重新构建，清理历史缓存目录: BUNDLE_CACHE_DIR",
      "pt": "🧹 检测到强制重新构建，清理历史缓存目录: BUNDLE_CACHE_DIR",
      "de": "🧹 检测到强制重新构建，清理历史缓存目录: BUNDLE_CACHE_DIR",
      "it": "🧹 检测到强制重新构建，清理历史缓存目录: BUNDLE_CACHE_DIR",
      "ru": "🧹 检测到强制重新构建，清理历史缓存目录: BUNDLE_CACHE_DIR",
      "tr": "🧹 检测到强制重新构建，清理历史缓存目录: BUNDLE_CACHE_DIR",
    }
  },
  {
    regex: /R2\ 上传接口返回失败/g,
    translations: {
      "zh": "R2 上传接口返回失败",
      "en": "R2",
      "ja": "R2",
      "ko": "R2",
      "vi": "R2",
      "th": "R2",
      "id": "R2",
      "es": "R2",
      "fr": "R2",
      "pt": "R2",
      "de": "R2",
      "it": "R2",
      "ru": "R2",
      "tr": "R2",
    }
  },
  {
    regex: /R2\ 视频上传\ \((.*?)/g,
    translations: {
      "zh": "R2 视频上传 (.*?",
      "en": "R2   (.*?",
      "ja": "R2   (.*?",
      "ko": "R2   (.*?",
      "vi": "R2   (.*?",
      "th": "R2   (.*?",
      "id": "R2   (.*?",
      "es": "R2   (.*?",
      "fr": "R2   (.*?",
      "pt": "R2   (.*?",
      "de": "R2   (.*?",
      "it": "R2   (.*?",
      "ru": "R2   (.*?",
      "tr": "R2   (.*?",
    }
  },
  {
    regex: /Remotion\ 打包失败，退出码:\ (.*?)/g,
    translations: {
      "zh": "Remotion 打包失败，退出码: .*?",
      "en": "Remotion  ， : .*?",
      "ja": "Remotion  ， : .*?",
      "ko": "Remotion  ， : .*?",
      "vi": "Remotion  ， : .*?",
      "th": "Remotion  ， : .*?",
      "id": "Remotion  ， : .*?",
      "es": "Remotion  ， : .*?",
      "fr": "Remotion  ， : .*?",
      "pt": "Remotion  ， : .*?",
      "de": "Remotion  ， : .*?",
      "it": "Remotion  ， : .*?",
      "ru": "Remotion  ， : .*?",
      "tr": "Remotion  ， : .*?",
    }
  },
  {
    regex: /Remotion\ 渲染进程异常退出，状态码:\ (.*?)/g,
    translations: {
      "zh": "Remotion 渲染进程异常退出，状态码: .*?",
      "en": "Remotion  ， : .*?",
      "ja": "Remotion  ， : .*?",
      "ko": "Remotion  ， : .*?",
      "vi": "Remotion  ， : .*?",
      "th": "Remotion  ， : .*?",
      "id": "Remotion  ， : .*?",
      "es": "Remotion  ， : .*?",
      "fr": "Remotion  ， : .*?",
      "pt": "Remotion  ， : .*?",
      "de": "Remotion  ， : .*?",
      "it": "Remotion  ， : .*?",
      "ru": "Remotion  ， : .*?",
      "tr": "Remotion  ， : .*?",
    }
  },
  {
    regex: /SSE\ 监听主线程异常:\ (.*?)/g,
    translations: {
      "zh": "SSE 监听主线程异常: .*?",
      "en": "SSE  : .*?",
      "ja": "SSE  : .*?",
      "ko": "SSE  : .*?",
      "vi": "SSE  : .*?",
      "th": "SSE  : .*?",
      "id": "SSE  : .*?",
      "es": "SSE  : .*?",
      "fr": "SSE  : .*?",
      "pt": "SSE  : .*?",
      "de": "SSE  : .*?",
      "it": "SSE  : .*?",
      "ru": "SSE  : .*?",
      "tr": "SSE  : .*?",
    }
  },
  {
    regex: /SSE\ 长连接中断:\ (.*?)，5秒后自动重连\.\.\./g,
    translations: {
      "zh": "SSE 长连接中断: .*?，5秒后自动重连...",
      "en": "SSE  : .*?，5 ...",
      "ja": "SSE  : .*?，5 ...",
      "ko": "SSE  : .*?，5 ...",
      "vi": "SSE  : .*?，5 ...",
      "th": "SSE  : .*?，5 ...",
      "id": "SSE  : .*?，5 ...",
      "es": "SSE  : .*?，5 ...",
      "fr": "SSE  : .*?，5 ...",
      "pt": "SSE  : .*?，5 ...",
      "de": "SSE  : .*?，5 ...",
      "it": "SSE  : .*?，5 ...",
      "ru": "SSE  : .*?，5 ...",
      "tr": "SSE  : .*?，5 ...",
    }
  },
  {
    regex: /\[重试\ (.*?)/,
    translations: {
      "zh": "[重试 .*?/.*?] .*? 发生异常: .*?，.*?秒后重试...",
      "en": "[  .*?/.*?] .*?  : .*?，.*? ...",
      "ja": "[  .*?/.*?] .*?  : .*?，.*? ...",
      "ko": "[  .*?/.*?] .*?  : .*?，.*? ...",
      "vi": "[  .*?/.*?] .*?  : .*?，.*? ...",
      "th": "[  .*?/.*?] .*?  : .*?，.*? ...",
      "id": "[  .*?/.*?] .*?  : .*?，.*? ...",
      "es": "[  .*?/.*?] .*?  : .*?，.*? ...",
      "fr": "[  .*?/.*?] .*?  : .*?，.*? ...",
      "pt": "[  .*?/.*?] .*?  : .*?，.*? ...",
      "de": "[  .*?/.*?] .*?  : .*?，.*? ...",
      "it": "[  .*?/.*?] .*?  : .*?，.*? ...",
      "ru": "[  .*?/.*?] .*?  : .*?，.*? ...",
      "tr": "[  .*?/.*?] .*?  : .*?，.*? ...",
    }
  },
  {
    regex: /☁️\ 检测到本地开发\ R2\ 密钥配置，正在通过【本地直传通道】上传\ (.*?)\ 个多语言视频至\ Cloudflare\ R2\.\.\./g,
    translations: {
      "zh": "☁️ 检测到本地开发 R2 密钥配置，正在通过【本地直传通道】上传 .*? 个多语言视频至 Cloudflare R2...",
      "en": "☁️ Local R2 config detected, uploading .*?  multilingual videos to Cloudflare R2 via local direct channel...",
      "ja": "☁️ Local R2 config detected, uploading .*?  multilingual videos to Cloudflare R2 via local direct channel...",
      "ko": "☁️ Local R2 config detected, uploading .*?  multilingual videos to Cloudflare R2 via local direct channel...",
      "vi": "☁️ Local R2 config detected, uploading .*?  multilingual videos to Cloudflare R2 via local direct channel...",
      "th": "☁️ Local R2 config detected, uploading .*?  multilingual videos to Cloudflare R2 via local direct channel...",
      "id": "☁️ Local R2 config detected, uploading .*?  multilingual videos to Cloudflare R2 via local direct channel...",
      "es": "☁️ Local R2 config detected, uploading .*?  multilingual videos to Cloudflare R2 via local direct channel...",
      "fr": "☁️ Local R2 config detected, uploading .*?  multilingual videos to Cloudflare R2 via local direct channel...",
      "pt": "☁️ Local R2 config detected, uploading .*?  multilingual videos to Cloudflare R2 via local direct channel...",
      "de": "☁️ Local R2 config detected, uploading .*?  multilingual videos to Cloudflare R2 via local direct channel...",
      "it": "☁️ Local R2 config detected, uploading .*?  multilingual videos to Cloudflare R2 via local direct channel...",
      "ru": "☁️ Local R2 config detected, uploading .*?  multilingual videos to Cloudflare R2 via local direct channel...",
      "tr": "☁️ Local R2 config detected, uploading .*?  multilingual videos to Cloudflare R2 via local direct channel...",
    }
  },
  {
    regex: /单次运行模式完成，退出。/g,
    translations: {
      "zh": "单次运行模式完成，退出。",
      "en": "Single run mode finished, exiting.",
      "ja": "Single run mode finished, exiting.",
      "ko": "Single run mode finished, exiting.",
      "vi": "Single run mode finished, exiting.",
      "th": "Single run mode finished, exiting.",
      "id": "Single run mode finished, exiting.",
      "es": "Single run mode finished, exiting.",
      "fr": "Single run mode finished, exiting.",
      "pt": "Single run mode finished, exiting.",
      "de": "Single run mode finished, exiting.",
      "it": "Single run mode finished, exiting.",
      "ru": "Single run mode finished, exiting.",
      "tr": "Single run mode finished, exiting.",
    }
  },
  {
    regex: /🌐\s*正在通过【服务端安全代理上传通道】同步\s*(\d+)\s*个多语言视频\.\.\./g,
    translations: {
      "zh": "🌐 正在通过【服务端安全代理上传通道】同步 $1 个多语言视频...",
      "en": "🌐 Synchronizing $1 multilingual videos via server secure proxy channel...",
      "ja": "🌐 サーバーセキュアプロキシ経由で $1 個のマルチ言語動画を同期中...",
      "ko": "🌐 서버 보안 프록시 채널을 통해 $1개 다국어 비디오 동기화 중...",
      "vi": "🌐 Đang đồng bộ $1 video đa ngôn ngữ qua kênh proxy bảo mật của máy chủ...",
      "th": "🌐 กำลังซิงค์วิดีโอหลายภาษา $1 รายการผ่านช่องทางพร็อกซีความปลอดภัยของเซิร์ฟเวอร์...",
      "id": "🌐 Menyinkronkan $1 video multibahasa melalui saluran proksi aman server...",
      "es": "🌐 Sincronizando $1 videos multilingües mediante canal proxy seguro del servidor...",
      "fr": "🌐 Synchronisation de $1 vidéos multilingues via le canal proxy sécurisé du serveur...",
      "pt": "🌐 Sincronizando $1 vídeos multilíngues via canal proxy seguro do servidor...",
      "de": "🌐 Synchronisiere $1 mehrsprachige Videos über den sicheren Server-Proxy-Kanal...",
      "it": "🌐 Sincronizzazione di $1 video multilingue tramite canale proxy sicuro del server...",
      "ru": "🌐 Синхронизация $1 мультиязычных видео через защищенный прокси сервера...",
      "tr": "🌐 Güvenli sunucu proxy kanalı aracılığıyla $1 çok dilli video senkronize ediliyor...",
    }
  },
  {
    regex: /🎉\s*全部\s*(\d+)\s*个语言版本视频渲染完成!\s*总渲染耗时[:：]\s*([\d.]+)s/g,
    translations: {
      "zh": "🎉 全部 $1 个语言版本视频渲染完成! 总渲染耗时: $2s",
      "en": "🎉 All $1 language versions render finished! Total duration: $2s",
      "ja": "🎉 全 $1 言語バージョンのレンダリングが完了しました! 合計所要時間: $2s",
      "ko": "🎉 전체 $1개 언어 버전 렌더링 완료! 총 소요 시간: $2s",
      "vi": "🎉 Hoàn tất kết xuất toàn bộ $1 phiên bản ngôn ngữ! Tổng thời gian: $2s",
      "th": "🎉 เรนเดอร์วิดีโอครบทั้ง $1 ภาษาแล้ว! เวลาทั้งหมด: $2 วินาที",
      "id": "🎉 Semua $1 versi bahasa selesai dirender! Total durasi: $2s",
      "es": "🎉 ¡Renderizado completado para las $1 versiones de idioma! Duración total: $2s",
      "fr": "🎉 Rendu terminé pour les $1 versions linguistiques ! Durée totale : $2s",
      "pt": "🎉 Renderização concluída para todas as $1 versões de idioma! Duração total: $2s",
      "de": "🎉 Alle $1 Sprachversionen erfolgreich gerendert! Gesamtdauer: $2s",
      "it": "🎉 Rendering completato per tutte le $1 versioni linguistiche! Durata totale: $2s",
      "ru": "🎉 Рендеринг всех $1 языковых версий завершен! Общее время: $2s",
      "tr": "🎉 Tüm $1 dil sürümünün işlemesi tamamlandı! Toplam süre: $2s",
    }
  },
  {
    regex: /🎬\s*根据任务语言设定检测到\s*(\d+)\s*种渲染版本[，,]?\s*即将开始渲染[:：]?/g,
    translations: {
      "zh": "🎬 根据任务语言设定检测到 $1 种渲染版本，即将开始渲染:",
      "en": "🎬 Detected $1 render versions based on task settings, starting render:",
      "ja": "🎬 タスク設定に基づき $1 種類のレンダリングバージョンを検出、レンダリングを開始:",
      "ko": "🎬 작업 언어 설정에 따라 $1개 렌더링 버전 감지됨, 렌더링 시작:",
      "vi": "🎬 Đã phát hiện $1 phiên bản kết xuất theo cài đặt tác vụ, bắt đầu kết xuất:",
      "th": "🎬 ตรวจพบเวอร์ชันการเรนเดอร์ $1 เวอร์ชันตามการตั้งค่างาน กำลังเริ่มเรนเดอร์:",
      "id": "🎬 Terdeteksi $1 versi render berdasarkan pengaturan tugas, memulai rendering:",
      "es": "🎬 Detectadas $1 versiones de renderizado según configuración, iniciando:",
      "fr": "🎬 Détection de $1 versions de rendu basées sur les paramètres, démarrage du rendu :",
      "pt": "🎬 Detectadas $1 versões de renderização com base nas configurações, iniciando:",
      "de": "🎬 $1 Rendering-Versionen basierend auf den Aufgabeneinstellungen erkannt, Rendering wird gestartet:",
      "it": "🎬 Rilevate $1 versioni di rendering in base alle impostazioni, avvio del rendering:",
      "ru": "🎬 Обнаружено $1 версий рендеринга на основе настроек задачи, запуск рендеринга:",
      "tr": "🎬 Görev ayarlarına göre $1 işleme sürümü algılandı, işleme başlatılıyor:",
    }
  },
  {
    regex: /🔔\s*\[SSE\s*实时下发\]\s*收到新视频渲染任务[:：]?\s*\[(.*?)\]\s*(.*?)\s*vs\s*(.*?)/g,
    translations: {
      "zh": "🔔 [SSE 实时下发] 收到新视频渲染任务: [$1] $2 vs $3",
      "en": "🔔 [SSE Realtime] Received new video render task: [$1] $2 vs $3",
      "ja": "🔔 [SSE 配信] 新規動画レンダリングタスクを受信: [$1] $2 vs $3",
      "ko": "🔔 [SSE 실시간 수신] 새 비디오 렌더링 작업 수신됨: [$1] $2 vs $3",
      "vi": "🔔 [SSE Thời gian thực] Nhận tác vụ kết xuất video mới: [$1] $2 vs $3",
      "th": "🔔 [SSE เรียลไทม์] ได้รับงานเรนเดอร์วิดีโอใหม่: [$1] $2 vs $3",
      "id": "🔔 [SSE Realtime] Menerima tugas render video baru: [$1] $2 vs $3",
      "es": "🔔 [SSE Tiempo Real] Nueva tarea de renderizado recibida: [$1] $2 vs $3",
      "fr": "🔔 [SSE Temps Réel] Nouvelle tâche de rendu reçue : [$1] $2 vs $3",
      "pt": "🔔 [SSE Tempo Real] Nova tarefa de renderização recebida: [$1] $2 vs $3",
      "de": "🔔 [SSE Echtzeit] Neue Video-Rendering-Aufgabe empfangen: [$1] $2 vs $3",
      "it": "🔔 [SSE Tempo Reale] Nuova attività di rendering ricevuta: [$1] $2 vs $3",
      "ru": "🔔 [SSE Реальное время] Получена новая задача рендеринга: [$1] $2 vs $3",
      "tr": "🔔 [SSE Gerçek Zamanlı] Yeni video işleme görevi alındı: [$1] $2 vs $3",
    }
  },
  {
    regex: /ℹ️\s*已启用\s*--skip-upload\s*选项[，,]?\s*全部视频仅保存在本地。/g,
    translations: {
      "zh": "ℹ️ 已启用 --skip-upload 选项，全部视频仅保存在本地。",
      "en": "ℹ️ Option --skip-upload enabled, all videos saved locally.",
      "ja": "ℹ️ --skip-upload オプションが有効です。すべての動画はローカルにのみ保存されます。",
      "ko": "ℹ️ --skip-upload 옵션이 활성화되었습니다. 모든 비디오는 로컬에만 저장됩니다.",
      "vi": "ℹ️ Tùy chọn --skip-upload đã bật, tất cả video chỉ lưu cục bộ.",
      "th": "ℹ️ เปิดใช้งานตัวเลือก --skip-upload แล้ว วิดีโอทั้งหมดจะถูกบันทึกไว้ในเครื่องเท่านั้น",
      "id": "ℹ️ Opsi --skip-upload diaktifkan, semua video hanya disimpan secara lokal.",
      "es": "ℹ️ Opción --skip-upload habilitada, todos los videos se guardan solo localmente.",
      "fr": "ℹ️ Option --skip-upload activée, toutes les vidéos sont enregistrées uniquement localement.",
      "pt": "ℹ️ Opção --skip-upload ativada, todos os vídeos salvos apenas localmente.",
      "de": "ℹ️ Option --skip-upload aktiviert, alle Videos werden nur lokal gespeichert.",
      "it": "ℹ️ Opzione --skip-upload abilitata, tutti i video salvati solo localmente.",
      "ru": "ℹ️ Включена опция --skip-upload, все видео сохраняются только локально.",
      "tr": "ℹ️ --skip-upload seçeneği etkinleştirildi, tüm videolar yalnızca yerel olarak kaydedildi.",
    }
  },
  {
    regex: /⏳\s*正在向调度端同步状态为[「"“]正在渲染\s*\(rendering\)[」"”]\.\.\./g,
    translations: {
      "zh": "⏳ 正在向调度端同步状态为「正在渲染 (rendering)」...",
      "en": "⏳ Syncing status to scheduler: \"rendering\"...",
      "ja": "⏳ スケジューラーに「レンダリング中 (rendering)」ステータスを同期中...",
      "ko": "⏳ 스케줄러에 '렌더링 중 (rendering)' 상태 동기화 중...",
      "vi": "⏳ Đang đồng bộ trạng thái sang bộ lập lịch: \"đang kết xuất (rendering)\"...",
      "th": "⏳ กำลังซิงค์สถานะไปยังตัวจัดกำหนดการ: \"กำลังเรนเดอร์ (rendering)\"...",
      "id": "⏳ Menyinkronkan status ke penjadwal: \"sedang merender (rendering)\"...",
      "es": "⏳ Sincronizando estado con el programador: \"renderizando (rendering)\"...",
      "fr": "⏳ Synchronisation du statut avec le planificateur : \"rendu en cours (rendering)\"...",
      "pt": "⏳ Sincronizando status com o agendador: \"renderizando (rendering)\"...",
      "de": "⏳ Synchronisiere Status mit Planer: \"Rendering läuft (rendering)\"...",
      "it": "⏳ Sincronizzazione stato con lo scheduler: \"rendering (rendering)\"...",
      "ru": "⏳ Синхронизация статуса с диспетчером: «рендеринг (rendering)»...",
      "tr": "⏳ Zamanlayıcıya durum senkronize ediliyor: \"işleniyor (rendering)\"...",
    }
  },
  {
    regex: /▶️\s*\[(\d+)\/(\d+)\]\s*正在执行【(.*?)】渲染\s*\((.*?)\)\.\.\./g,
    translations: {
      "zh": "▶️ [$1/$2] 正在执行【$3】渲染 ($4)...",
      "en": "▶️ [$1/$2] Executing [$3] rendering ($4)...",
      "ja": "▶️ [$1/$2] 【$3】のレンダリングを実行中 ($4)...",
      "ko": "▶️ [$1/$2] 【$3】 렌더링 실행 중 ($4)...",
      "vi": "▶️ [$1/$2] Đang thực hiện kết xuất [$3] ($4)...",
      "th": "▶️ [$1/$2] กำลังเรนเดอร์ [$3] ($4)...",
      "id": "▶️ [$1/$2] Mengeksekusi rendering [$3] ($4)...",
      "es": "▶️ [$1/$2] Ejecutando renderizado de [$3] ($4)...",
      "fr": "▶️ [$1/$2] Exécution du rendu [$3] ($4)...",
      "pt": "▶️ [$1/$2] Executando renderização de [$3] ($4)...",
      "de": "▶️ [$1/$2] Rendering von [$3] wird ausgeführt ($4)...",
      "it": "▶️ [$1/$2] Esecuzione rendering di [$3] ($4)...",
      "ru": "▶️ [$1/$2] Выполнение рендеринга [$3] ($4)...",
      "tr": "▶️ [$1/$2] [$3] işlemesi yürütülüyor ($4)...",
    }
  },
  {
    regex: /🎯 任务调度范围/g,
    translations: {
      "zh": "🎯 任务调度范围",
      "en": "🎯 Task scheduling scope",
      "ja": "🎯 タスクスケジューリング範囲",
      "ko": "🎯 작업 스케줄링 범위",
      "vi": "🎯 Phạm vi lập lịch tác vụ",
      "th": "🎯 ขอบเขตการจัดตารางงาน",
      "id": "🎯 Cakupan penjadwalan tugas",
      "es": "🎯 Alcance de programación de tareas",
      "fr": "🎯 Portée de planification des tâches",
      "pt": "🎯 Escopo de agendamento de tarefas",
      "de": "🎯 Bereich der Aufgabenplanung",
      "it": "🎯 Ambito di pianificazione delle attività",
      "ru": "🎯 Область планирования задач",
      "tr": "🎯 Görev zamanlama kapsamı",
    }
  },
  {
    regex: /仅限当前登录用户 \(Electron 客户端模式\)/g,
    translations: {
      "zh": "仅限当前登录用户 (Electron 客户端模式)",
      "en": "Current logged-in user only (Electron client mode)",
      "ja": "現在のログインユーザーのみ (Electronクライアントモード)",
      "ko": "현재 로그인한 사용자 전용 (Electron 클라이언트 모드)",
      "vi": "Chỉ người dùng hiện tại đã đăng nhập (Chế độ máy khách Electron)",
      "th": "เฉพาะผู้ใช้ที่เข้าสู่ระบบปัจจุบันเท่านั้น (โหมดไคลเอ็นต์ Electron)",
      "id": "Hanya pengguna yang sedang masuk (Mode klien Electron)",
      "es": "Solo usuario actual conectado (Modo cliente Electron)",
      "fr": "Utilisateur connecté actuel uniquement (Mode client Electron)",
      "pt": "Apenas usuário conectado atual (Modo cliente Electron)",
      "de": "Nur aktuell angemeldeter Benutzer (Electron-Client-Modus)",
      "it": "Solo utente attualmente connesso (Modalità client Electron)",
      "ru": "Только текущий вошедший пользователь (Режим клиента Electron)",
      "tr": "Yalnızca oturum açmış geçerli kullanıcı (Electron istemci modu)",
    }
  },
  {
    regex: /全局任务队列 \(支持渲染所有用户的待处理视频 - CLI 模式\)/g,
    translations: {
      "zh": "全局任务队列 (支持渲染所有用户的待处理视频 - CLI 模式)",
      "en": "Global task queue (Renders pending videos for all users - CLI mode)",
      "ja": "グローバルタスクキュー (全ユーザーの保留中動画のレンダリング対応 - CLIモード)",
      "ko": "전역 작업 큐 (모든 사용자의 대기 중 비디오 렌더링 지원 - CLI 모드)",
      "vi": "Hàng đợi tác vụ toàn cầu (Hiển thị video đang chờ cho tất cả người dùng - Chế độ CLI)",
      "th": "คิวงานส่วนกลาง (เรนเดอร์วิดีโอที่รอดำเนินการของผู้ใช้ทั้งหมด - โหมด CLI)",
      "id": "Antrean tugas global (Merender video tertunda untuk semua pengguna - Mode CLI)",
      "es": "Cola de tareas global (Renderiza videos pendientes para todos los usuarios - Modo CLI)",
      "fr": "File d'attente globale des tâches (Rendu des vidéos en attente pour tous les utilisateurs - Mode CLI)",
      "pt": "Fila global de tarefas (Renderiza vídeos pendentes para todos os usuários - Modo CLI)",
      "de": "Globale Aufgabenwarteschlange (Rendert ausstehende Videos für alle Benutzer - CLI-Modus)",
      "it": "Coda globale delle attività (Esegue il rendering dei video in sospeso per tutti gli utenti - Modalità CLI)",
      "ru": "Глобальная очередь задач (Рендеринг ожидающих видео для всех пользователей - Режим CLI)",
      "tr": "Genel görev kuyruğu (Tüm kullanıcılar için bekleyen videoları işler - CLI modu)",
    }
  },
  {
    regex: /流水线接续抢单/g,
    translations: {
      "zh": "流水线接续抢单",
      "en": "Pipeline Continuous Claiming",
      "ja": "パイプライン継続タスク取得",
      "ko": "파이프라인 연속 작업 잠금",
      "vi": "Nhận tác vụ liên tục dạng đường ống",
      "th": "การรับงานต่อเนื่องแบบไปป์ไลน์",
      "id": "Pengambilan tugas berkelanjutan pipeline",
      "es": "Reclamación continua de tareas en canalización",
      "fr": "Réclamation continue des tâches en pipeline",
      "pt": "Reivindicação contínua de tarefas em pipeline",
      "de": "Kontinuierliche Pipeline-Aufgabenübernahme",
      "it": "Acquisizione continua di attività in pipeline",
      "ru": "Непрерывный захват задач конвейера",
      "tr": "Ardışık düzen sürekli görev alma",
    }
  }
];

function localizeScriptLog(rawText: string, lang?: string | null): string {
  if (!rawText || typeof rawText !== 'string') return '';
  const activeLang = normalizeScriptLang(lang || process.env.SHORTVIDEO_LANG || process.env.LANG || 'zh');
  if (activeLang === 'zh') return rawText;

  let text = rawText;
  for (const rule of SCRIPT_I18N_RULES) {
    const targetTpl = rule.translations[activeLang] || rule.translations.en;
    if (targetTpl && rule.regex.test(text)) {
      text = text.replace(rule.regex, targetTpl);
    }
  }
  return text;
}

// ──   (  14  ) ───────────────────────────
function log(msg: string, color: 'green' | 'blue' | 'yellow' | 'red' | 'gray' = 'gray', lang?: string) {
  const colors = {
    green: '\x1b[32m',
    blue: '\x1b[34m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    gray: '\x1b[90m',
  };
  const reset = '\x1b[0m';
  const activeLang = normalizeScriptLang(lang || process.env.SHORTVIDEO_LANG || process.env.LANG || 'zh');
  const localizedMsg = localizeScriptLog(msg, activeLang);
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`${colors.gray}[${time}]${reset} ${colors[color]}${localizedMsg}${reset}`);
}

// ──   ──────────────────────────────────────────────────────
async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  delayMs = 2000,
  operationName = localizeScriptLog('网络操作')
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        log(localizeScriptLog(`[重试 ${attempt}/${maxRetries}] ${operationName} 发生异常: ${err.message}，${delayMs / 1000}秒后重试...`), 'yellow');
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

// ── 1. 任务拉取与原子抢单 ──────────────────────────────────
function detectIsElectronClient(): boolean {
  const args = process.argv.slice(2);
  if (args.includes('--client=electron') || args.some((a) => a.startsWith('--client=electron'))) return true;
  if (args.includes('--scope=current_user') || args.some((a) => a.startsWith('--scope=current_user'))) return true;
  if (process.env.SHORTVIDEO_CLIENT_MODE === 'electron' || process.env.SHORTVIDEO_CLIENT_SCOPE === 'current_user') return true;
  return false;
}

const IS_ELECTRON_CLIENT = detectIsElectronClient();

async function fetchWaitingTasks(
  baseUrl: string,
  token: string = CURRENT_AUTH_TOKEN,
  scope: 'current_user' | 'all_users' = (IS_ELECTRON_CLIENT ? 'current_user' : 'all_users')
): Promise<any[]> {
  const targetUrl = `${baseUrl.replace(/\/+$/, '')}/api/video/compare-english-word/tasks/`;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'get_pending_render_tasks',
        client: scope === 'current_user' ? 'electron' : 'cli',
        scope,
      }),
    });

    if (!res.ok) {
      log(localizeScriptLog(`拉取待渲染任务失败 (HTTP ${res.status}): ${res.statusText}`), 'red');
      return [];
    }

    const data = await res.json();
    if (data && data.success && Array.isArray(data.tasks)) {
      return data.tasks;
    }
    log(localizeScriptLog(`拉取待渲染任务失败: 服务端响应格式不符合预期`), 'red');
    return [];
  } catch (err: any) {
    log(localizeScriptLog(`连接渲染调度服务端失败 (${baseUrl}): ${err.message}`), 'red');
    return [];
  }
}

async function claimNextTask(
  baseUrl: string,
  token: string = CURRENT_AUTH_TOKEN,
  scope: 'current_user' | 'all_users' = (IS_ELECTRON_CLIENT ? 'current_user' : 'all_users')
): Promise<any | null> {
  const targetUrl = `${baseUrl.replace(/\/+$/, '')}/api/video/compare-english-word/tasks/`;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'claim_next_task',
        client: scope === 'current_user' ? 'electron' : 'cli',
        scope,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.success && data.task) {
      return data.task;
    }
    return null;
  } catch (err) {
    return null;
  }
}

// ── 2.   ─────────────────────────────────────────────
async function updateTaskStatus(
  baseUrl: string,
  taskId: string | number,
  status: 'rendering' | 'video_finished' | 'waiting_render',
  videoPath?: string,
  folderPath?: string,
  videoSize?: number,
  videos?: Record<string, string>,
  token: string = CURRENT_AUTH_TOKEN
): Promise<boolean> {
  const targetUrl = `${baseUrl.replace(/\/+$/, '')}/api/video/compare-english-word/tasks/`;
  try {
    return await retryOperation(
      async () => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            action: 'update_render_status',
            taskId,
            folderPath,
            status,
            videoPath,
            videoSize,
            videos,
          }),
        });
        const data = await res.json();
        return Boolean(res.ok && data.success);
      },
      2,
      1500,
      localizeScriptLog(`更新状态为 ${status}`)
    );
  } catch (err: any) {
    log(localizeScriptLog(`更新任务状态(${status})失败: ${err.message}`), 'red');
    return false;
  }
}

// ── 2.1   MP4   Cloudflare R2 ─────────────────────────
async function uploadVideoViaServerProxy(
  baseUrl: string,
  taskId: string | number,
  lang: string,
  filePath: string,
  filename: string,
  folderPath?: string,
  token: string = CURRENT_AUTH_TOKEN,
  isFinished: boolean = false
): Promise<{ success: boolean; cdnUrl?: string; error?: string }> {
  const targetUrl = new URL(`${baseUrl.replace(/\/+$/, '')}/api/video/compare-english-word/upload-video`);
  targetUrl.searchParams.set('taskId', String(taskId));
  targetUrl.searchParams.set('lang', lang);
  targetUrl.searchParams.set('filename', filename);
  if (folderPath) {
    targetUrl.searchParams.set('folderPath', folderPath);
  }
  if (isFinished) {
    targetUrl.searchParams.set('isFinished', 'true');
  }

  const fileBytes = fs.readFileSync(filePath);
  const headers: Record<string, string> = {
    'Content-Type': 'video/mp4',
    'x-task-id': String(taskId),
    'x-lang': lang,
    'x-filename': filename,
  };
  if (isFinished) {
    headers['x-is-finished'] = 'true';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    log(localizeScriptLog(`⚠️ [鉴权警告] 当前未传入登录 Token (CURRENT_AUTH_TOKEN 为空)，代理上传将被服务端拒绝 (401)`), 'red');
  }

  return await retryOperation(
    async () => {
      const res = await fetch(targetUrl.toString(), {
        method: 'POST',
        headers,
        body: new Uint8Array(fileBytes),
        signal: AbortSignal.timeout(180000), // 3
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status} ${res.statusText}`);
      }
      return { success: true, cdnUrl: data.cdnUrl };
    },
    3,
    2500,
    localizeScriptLog(`服务端代理上传视频 (${lang})`)
  );
}


// ── 3.   Remotion   ────────────────────────────────────────────
// Electron   REMOTION_BUNDLE_CACHE_DIR（ ），
// BundledCodeCache（ ）
const BUNDLE_CACHE_DIR = process.env.REMOTION_BUNDLE_CACHE_DIR
  || path.resolve(ROOT_DIR, 'BundledCodeCache/CompareEnglishWord');

/**
 *   Remotion  ：
 * 1.  /  @remotion/cli/remotion-cli.js，  Node  （ ， ）
 * 2.   npx remotion（  remotion，  @remotion/cli）
 */
function getRemotionExecutor(): { command: string; baseArgs: string[]; isNode: boolean } {
  const procResourcesPath = (process as any).resourcesPath || '';
  const candidates = [
    path.join(__dirname, '..', 'node_modules', '@remotion', 'cli', 'remotion-cli.js'),
    path.join(__dirname, '..', '..', 'node_modules', '@remotion', 'cli', 'remotion-cli.js'),
    path.join(process.cwd(), 'node_modules', '@remotion', 'cli', 'remotion-cli.js'),
    path.join(procResourcesPath, 'app.asar.unpacked', 'node_modules', '@remotion', 'cli', 'remotion-cli.js'),
    path.join(procResourcesPath, 'app.asar', 'node_modules', '@remotion', 'cli', 'remotion-cli.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return { command: process.execPath, baseArgs: [c], isNode: true };
    }
  }
  return { command: 'npx', baseArgs: ['remotion'], isNode: false };
}

/**
 *   Remotion   ./BundledCodeCache/CompareEnglishWord
 *  ， ，  'Bundled code'  
 */
let bundlePromise: Promise<string> | null = null;

function ensureRemotionBundle(forceRebuild = false): Promise<string> {
  const indexHtml = path.join(BUNDLE_CACHE_DIR, 'index.html');
  if (!forceRebuild && fs.existsSync(indexHtml)) {
    log(localizeScriptLog(`⚡ 检测到已有 Remotion 打包缓存: ${BUNDLE_CACHE_DIR}，直接复用免打包`), 'green');
    return Promise.resolve(BUNDLE_CACHE_DIR);
  }

  // 1.   Bundle  ，
  const procResourcesPath = (process as any).resourcesPath || '';
  const builtInBundleDirs = [
    path.join(__dirname, '..', '..', 'build', 'remotion-bundle'),
    path.join(__dirname, '..', 'build', 'remotion-bundle'),
    path.join(procResourcesPath, 'build', 'remotion-bundle'),
    path.join(procResourcesPath, 'app.asar.unpacked', 'build', 'remotion-bundle'),
    path.resolve(ROOT_DIR, 'build/remotion-bundle'),
  ];

  for (const bDir of builtInBundleDirs) {
    if (fs.existsSync(path.join(bDir, 'index.html'))) {
      log(localizeScriptLog(`📦 检测到安装包内置的预编译 Remotion 资源 (${bDir})，正在注入运行缓存...`), 'green');
      try {
        if (!fs.existsSync(BUNDLE_CACHE_DIR)) {
          fs.mkdirSync(BUNDLE_CACHE_DIR, { recursive: true });
        }
        // asar  ，
        fs.cpSync(bDir, BUNDLE_CACHE_DIR, { recursive: true });
        if (fs.existsSync(indexHtml)) {
          log(localizeScriptLog(`✅ 内置 Remotion 资源固化就绪: ${BUNDLE_CACHE_DIR}，免源码秒级执行！`), 'green');
          return Promise.resolve(BUNDLE_CACHE_DIR);
        }
      } catch (cpErr: any) {
        log(localizeScriptLog(`⚠️ 复制内置资源警告: ${cpErr.message}，尝试直接使用内置路径`), 'yellow');
        return Promise.resolve(bDir);
      }
    }
  }

  if (bundlePromise && !forceRebuild) {
    return bundlePromise;
  }

  bundlePromise = (async () => {
    if (forceRebuild && fs.existsSync(BUNDLE_CACHE_DIR)) {
      log(localizeScriptLog(`🧹 检测到强制重新构建，清理历史缓存目录: ${BUNDLE_CACHE_DIR}`), 'yellow');
      fs.rmSync(BUNDLE_CACHE_DIR, { recursive: true, force: true });
    }

    log(localizeScriptLog(`📦 未检测到 Remotion 打包缓存，正在首次打包至: ${BUNDLE_CACHE_DIR} ...`), 'yellow');
    if (!fs.existsSync(BUNDLE_CACHE_DIR)) {
      fs.mkdirSync(BUNDLE_CACHE_DIR, { recursive: true });
    }

    return new Promise<string>((resolve, reject) => {
      // Remotion
      const entryFile = path.resolve(ROOT_DIR, 'src/index.ts');
      if (!fs.existsSync(entryFile)) {
        const errMsg = localizeScriptLog(`❌ 当前工作区 (${ROOT_DIR}) 缺失 Remotion 入口文件 src/index.ts！请在控制台顶部点击【设置项目目录】指定 ShortVideo 源码工程根目录。`);
        log(errMsg, 'red');
        bundlePromise = null;
        return reject(new Error(errMsg));
      }

      const executor = getRemotionExecutor();
      const args = [
        ...executor.baseArgs,
        'bundle',
        'src/index.ts',
        `--out-dir=${BUNDLE_CACHE_DIR}`,
        '--log=info',
      ];

      log(localizeScriptLog(`🚀 执行 Bundle 打包命令: ${executor.command} ${args.join(' ')}`), 'gray');

      const proc = spawn(executor.command, args, {
        cwd: ROOT_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: !executor.isNode,
        windowsHide: true,
        env: {
          ...process.env,
          ...(executor.isNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
          PUPPETEER_DISABLE_DEV_SHM_USAGE: 'true',
        },
      });

      proc.stdout?.on('data', (chunk) => {
        process.stdout.write(chunk);
      });
      proc.stderr?.on('data', (chunk) => {
        process.stderr.write(chunk);
      });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(indexHtml)) {
          log(localizeScriptLog(`✅ Remotion 打包完成，已固化至: ${BUNDLE_CACHE_DIR}，后续渲染将直接秒级复用！`), 'green');
          resolve(BUNDLE_CACHE_DIR);
        } else {
          bundlePromise = null;
          reject(new Error(localizeScriptLog(`Remotion 打包失败，退出码: ${code}`)));
        }
      });

      proc.on('error', (err) => {
        bundlePromise = null;
        reject(err);
      });
    });
  })();

  return bundlePromise;
}

/**
 *   Remotion   Web   (bundleTarget)   ( 、 、 )
 *   .env.desktop   NEXT_PUBLIC_DOWNLOAD_BASE_URL (  https://download.shortvideo.ca)
 *   bundleTarget/CompareEnglishWord/...，  (http:// localhost:3000)  404
 */
async function ensureBundleStaticAssets(bundleTarget: string, cleanFolder?: string): Promise<void> {
  const downloadBaseUrl = getCdnDomain().replace(/\/+$/, '');
  const cewDir = path.join(bundleTarget, 'CompareEnglishWord');
  if (!fs.existsSync(cewDir)) {
    fs.mkdirSync(cewDir, { recursive: true });
  }

  const downloads: Promise<boolean>[] = [];

  // 1.  : https://download.shortvideo.ca/CompareEnglishWord/background.mp3
  const bgmDest = path.join(cewDir, 'background.mp3');
  const bgmUrl = `${downloadBaseUrl}/CompareEnglishWord/background.mp3`;
  downloads.push(downloadFile(bgmUrl, bgmDest, 1000));

  // 2.  : https://download.shortvideo.ca/CompareEnglishWord/style01/01.png ~ 06.png (  style02)
  for (const style of ['style01', 'style02']) {
    const styleDir = path.join(cewDir, style);
    if (!fs.existsSync(styleDir)) {
      fs.mkdirSync(styleDir, { recursive: true });
    }
    for (let i = 1; i <= 6; i++) {
      const filename = `0${i}.png`;
      const imgDest = path.join(styleDir, filename);
      const imgUrl = `${downloadBaseUrl}/CompareEnglishWord/${style}/${filename}`;
      downloads.push(downloadFile(imgUrl, imgDest, 500));
    }
  }

  // 3.  : 01.png, 02.png, audio_en.mp3
  if (cleanFolder) {
    const taskDir = path.join(cewDir, cleanFolder);
    if (!fs.existsSync(taskDir)) {
      fs.mkdirSync(taskDir, { recursive: true });
    }
    const cdnFolderUrl = `${downloadBaseUrl}/CompareEnglishWord/${cleanFolder}`;
    downloads.push(downloadFile(`${cdnFolderUrl}/01.png`, path.join(taskDir, '01.png'), 1000));
    downloads.push(downloadFile(`${cdnFolderUrl}/02.png`, path.join(taskDir, '02.png'), 1000));
    downloads.push(downloadFile(`${cdnFolderUrl}/audio_en.mp3`, path.join(taskDir, 'audio_en.mp3'), 2000));
  }

  await Promise.all(downloads);
}

async function renderVideoWithRemotion(
  outputFile: string,
  props: Record<string, any>,
  concurrency?: number | string
): Promise<void> {
  // ， ，Remotion   Bundled code
  const bundleTarget = await ensureRemotionBundle();

  // Remotion   Web   ( 、 、 )
  log(localizeScriptLog(`📥 正在同步 Remotion 本地静态素材 (${getCdnDomain()}/CompareEnglishWord)...`), 'gray');
  await ensureBundleStaticAssets(bundleTarget, props.folder);

  return new Promise((resolve, reject) => {
    // props  ，  shell  、 (#)  JSON
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const propsFilePath = path.join(outputDir, `render_props_${props.lang || 'default'}.json`);
    fs.writeFileSync(propsFilePath, JSON.stringify(props, null, 2), 'utf-8');

    const executor = getRemotionExecutor();
    const args = [
      ...executor.baseArgs,
      'render',
      bundleTarget,
      'CompareEnglishWord',
      outputFile,
      `--props=${propsFilePath}`,
      '--disable-web-security',
      '--log=info',
    ];

    // Windows   ANGLE  ；Linux / macOS
    if (process.platform === 'win32') {
      args.push('--gl=angle');
    }
    // Linux  ，  Chromium
    if (process.platform === 'linux') {
      args.push('--chromium-options=--no-sandbox,--disable-setuid-sandbox');
    }

    const finalConcurrency = concurrency || '2';
    args.push(`--concurrency=${finalConcurrency}`);

    log(localizeScriptLog(`🚀 执行渲染命令 (并发: ${finalConcurrency}x): ${executor.command} ${args.join(' ')}`), 'gray');

    const extraPaths: string[] = [];
    const procResources = (process as any).resourcesPath || '';
    const remotionBaseDirs = [
      path.join(procResources, 'app.asar.unpacked', 'node_modules', '@remotion'),
      path.join(__dirname, '..', 'node_modules', '@remotion'),
      path.join(process.cwd(), 'node_modules', '@remotion'),
    ];

    for (const baseDir of remotionBaseDirs) {
      if (fs.existsSync(baseDir)) {
        try {
          const entries = fs.readdirSync(baseDir);
          for (const entry of entries) {
            if (entry.startsWith('compositor-')) {
              extraPaths.push(path.join(baseDir, entry));
            }
          }
        } catch {}
      }
    }

    const currentPath = process.env.PATH || process.env.Path || '';
    const newPath = [...extraPaths, currentPath].filter(Boolean).join(path.delimiter);

    // (  C:\Users\Administrator\AppData\Roaming\shortvideo)
    // chrome-headless-shell
    const sharedAppDir = process.env.APPDATA
      ? path.join(process.env.APPDATA, 'shortvideo')
      : (process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'shortvideo')
        : path.join(os.homedir(), '.shortvideo'));

    if (!fs.existsSync(sharedAppDir)) {
      try { fs.mkdirSync(sharedAppDir, { recursive: true }); } catch (_) {}
    }

    // chrome-headless-shell
    const globalRemotionDir = path.join(sharedAppDir, '.remotion');
    const localRemotionDir = path.join(outputDir, '.remotion');
    if (!fs.existsSync(globalRemotionDir) && fs.existsSync(localRemotionDir)) {
      try {
        log(localizeScriptLog(`⚡ 检测到本地历史 Chromium 缓存，正在提升至全局共享目录: ${globalRemotionDir}`), 'green');
        fs.cpSync(localRemotionDir, globalRemotionDir, { recursive: true });
      } catch (_) {}
    }

    const proc = spawn(executor.command, args, {
      cwd: sharedAppDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: !executor.isNode,
      windowsHide: true,
      env: {
        ...process.env,
        ...(executor.isNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        PATH: newPath,
        Path: newPath,
        PUPPETEER_DISABLE_DEV_SHM_USAGE: 'true',
      },
    });

    let lastIsProgress = false;
    let stdoutBuffer = '';

    const processLogChunk = (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString('utf-8');
      const lines = stdoutBuffer.split(/[\r\n]+/);
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        const progressMatch = trimmedLine.match(/Rendered\s+(\d+)\/(\d+)(?:,\s*time remaining:\s*([0-9a-zA-Z\s]+))?/i);
        if (progressMatch) {
          const cur = parseInt(progressMatch[1], 10);
          const tot = parseInt(progressMatch[2], 10);
          const eta = progressMatch[3] ? ` | 剩余预计: ${progressMatch[3].trim()}` : '';
          const pct = ((cur / tot) * 100).toFixed(1);

          if (process.stdout.isTTY) {
            process.stdout.write(`\r\x1b[K⏳ 渲染进度: ${pct}% (${cur}/${tot} 帧)${eta}`);
          } else {
            if (cur === 1 || cur === tot || cur % 50 === 0) {
              process.stdout.write(`⏳ 渲染进度: ${pct}% (${cur}/${tot} 帧)${eta}\n`);
            }
          }
          lastIsProgress = true;
        } else {
          if (lastIsProgress) {
            process.stdout.write('\n');
            lastIsProgress = false;
          }
          process.stdout.write(trimmedLine + '\n');
        }
      }
    };

    proc.stdout?.on('data', processLogChunk);
    proc.stderr?.on('data', processLogChunk);

    proc.on('close', (code) => {
      if (stdoutBuffer.trim()) {
        if (lastIsProgress) process.stdout.write('\n');
        process.stdout.write(stdoutBuffer.trim() + '\n');
        lastIsProgress = false;
      } else if (lastIsProgress) {
        process.stdout.write('\n');
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(localizeScriptLog(`Remotion 渲染进程异常退出，状态码: ${code}`)));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

export interface RenderWorkerOptions {
  skipUpload?: boolean;
  concurrency?: number | string;
  lang?: string;
  scope?: 'current_user' | 'all_users';
}

// ── 4.   ────────────────────────────────────────────
async function processSingleTask(
  task: any,
  baseUrl: string,
  options: RenderWorkerOptions = {}
) {
  const taskId = task.videoId || task.id;
  const rawFolder = (task.folderPath || '').trim();
  const cleanFolder = rawFolder
    .replace(/^\/+|\/+$/g, '')
    .replace(/^CompareEnglishWord\//, '') || `${task.wordA}_${task.wordB}`;

  const wordA = (task.wordA || 'wordA').trim().toLowerCase();
  const wordB = (task.wordB || 'wordB').trim().toLowerCase();

  // 1.   ./out/CompareEnglishWord/ /
  // a)
  const rawEmail = (task.userEmail || '').trim();
  const safeUserEmail = rawEmail
    ? rawEmail.replace(/[\\/:*?"<>|]/g, '_')
    : 'default_user';

  // b)   (  cleanFolder，  101_mountain_hill，  title  )
  let rawVideoName = cleanFolder;
  if (!rawVideoName) {
    rawVideoName = (task.title || '').trim() || `${wordA}-${wordB}`;
  }
  // ，
  const safeVideoName = path.basename(rawVideoName)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_');

  // c)  （ ）
  const baseOutputDir = resolveBaseOutputDir();
  const outputDir = path.join(baseOutputDir, 'CompareEnglishWord', safeUserEmail, safeVideoName);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // ：  task   mp4  ，  wordA-wordB.mp4
  let filename = `${wordA}-${wordB}.mp4`;
  if (task.videoPath && typeof task.videoPath === 'string') {
    const base = path.basename(task.videoPath.split('?')[0]);
    if (base.endsWith('.mp4')) {
      filename = base;
    }
  }

  const outputFile = path.join(outputDir, filename);

  log(`\n------------------------------------------------------------`, 'blue');
  log(localizeScriptLog(`🎯 拾取待渲染任务: [${taskId}] ${task.wordA} vs ${task.wordB}`), 'blue');
  log(localizeScriptLog(`📂 存储目录路径: CompareEnglishWord/${cleanFolder}`), 'blue');
  log(localizeScriptLog(`💾 本地存储位置: ${outputFile}`), 'green');
  if (CURRENT_AUTH_TOKEN) {
    const masked = CURRENT_AUTH_TOKEN.length > 12 ? `${CURRENT_AUTH_TOKEN.slice(0, 6)}...${CURRENT_AUTH_TOKEN.slice(-6)}` : '***';
    log(localizeScriptLog(`🔑 携带用户鉴权凭据: ${masked}`), 'gray');
  } else if (!HAS_R2_CONFIG) {
    log(localizeScriptLog(`⚠️ 提示: 当前未检测到登录 Token，若需服务端代理上传，请先在桌面客户端登录账号`), 'yellow');
  }

  // d. 任务已通过 claimNextTask 在服务端原子锁定为 rendering，此处直接开始渲染流程
  log(localizeScriptLog(`✅ 任务 [${taskId}] 已由服务端原子锁定为「正在渲染」，开始本地渲染...`), 'green');

  // e.  ： 、 、 ，
  log(localizeScriptLog(`📥 正在预下载并校验核心素材 (音频/图片/文字)...`), 'yellow');

  // 1)
  let summaryData = task.summaryData;
  const cdnFolderUrl = `${getCdnDomain()}/CompareEnglishWord/${cleanFolder}`;
  if (!summaryData || !Array.isArray(summaryData.segments) || summaryData.segments.length === 0) {
    const summaryCdnUrl = `${cdnFolderUrl}/summary.json?_t=${Date.now()}`;
    try {
      const sRes = await fetch(summaryCdnUrl);
      if (sRes.ok) summaryData = await sRes.json();
    } catch (e) {}
  }

  if (!summaryData || !Array.isArray(summaryData.segments) || summaryData.segments.length === 0) {
    log(localizeScriptLog(`❌ 素材缺失: 未能获取到有效的文字段落数据 (segments 为空)，拦截渲染以保护质量。`), 'red');
    await updateTaskStatus(baseUrl, taskId, 'waiting_render', undefined, task.folderPath);
    return;
  }

  // 2)
  const assetsDir = path.join(outputDir, 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const localAudioPath = path.join(assetsDir, 'audio_en.mp3');
  const rawAudioUrl = task.audioPath ? task.audioPath.split('?')[0] : `${cdnFolderUrl}/audio_en.mp3`;
  const audioDownloaded = await downloadFile(rawAudioUrl, localAudioPath, 5000);

  if (!audioDownloaded && !fs.existsSync(localAudioPath)) {
    log(localizeScriptLog(`❌ 音频素材准备失败: 无法下载或音频文件无效 (${rawAudioUrl})`), 'red');
    await updateTaskStatus(baseUrl, taskId, 'waiting_render', undefined, task.folderPath);
    return;
  }

  // ( )
  const physicalAudioDuration = getMediaExactDuration(localAudioPath);

  // segments
  let maxSpeechEndTime = 0;
  for (const seg of summaryData.segments) {
    const end = seg.end_en || seg.end || 0;
    if (end > maxSpeechEndTime) maxSpeechEndTime = end;
    if (Array.isArray(seg.words_en)) {
      for (const w of seg.words_en) {
        if (w.end > maxSpeechEndTime) maxSpeechEndTime = w.end;
      }
    }
  }

  // ：  meta.duration_en，  meta.duration
  let durationSeconds = 18;
  if (typeof summaryData?.meta?.duration_en === 'number' && summaryData.meta.duration_en > 0) {
    durationSeconds = summaryData.meta.duration_en;
  } else if (physicalAudioDuration && physicalAudioDuration > 0) {
    durationSeconds = physicalAudioDuration;
  } else if (maxSpeechEndTime > 0) {
    durationSeconds = maxSpeechEndTime;
  }

  // 3)   01   02
  const localImg01Path = path.join(assetsDir, '01.png');
  const localImg02Path = path.join(assetsDir, '02.png');
  const rawImg01Url = task.img01Path ? task.img01Path.split('?')[0] : `${cdnFolderUrl}/01.png`;
  const rawImg02Url = task.img02Path ? task.img02Path.split('?')[0] : `${cdnFolderUrl}/02.png`;

  const [img1Ok, img2Ok] = await Promise.all([
    downloadFile(rawImg01Url, localImg01Path, 3000),
    downloadFile(rawImg02Url, localImg02Path, 3000),
  ]);

  if (!img1Ok || !img2Ok) {
    log(localizeScriptLog(`❌ 图片素材准备失败: 01.png 或 02.png 无法下载或损坏，拦截渲染。`), 'red');
    await updateTaskStatus(baseUrl, taskId, 'waiting_render', undefined, task.folderPath);
    return;
  }

  const style = summaryData?.meta?.style || task.style || 'style01';

  // Base64  ， 、  CDN   CORS
  let img01Data = rawImg01Url;
  let img02Data = rawImg02Url;
  try {
    if (fs.existsSync(localImg01Path)) {
      img01Data = `data:image/png;base64,${fs.readFileSync(localImg01Path).toString('base64')}`;
    }
    if (fs.existsSync(localImg02Path)) {
      img02Data = `data:image/png;base64,${fs.readFileSync(localImg02Path).toString('base64')}`;
    }
  } catch (err: any) {
    log(localizeScriptLog(`⚠️ 本地图片转 Base64 失败，降级使用远程 URL: ${err.message}`), 'yellow');
  }

  // Helper function note
  const baseRenderProps = {
    folder: cleanFolder,
    summaryData,
    img01: img01Data,
    img02: img02Data,
    audioEn: rawAudioUrl,
    style,
    durationSeconds,
  };

  log(localizeScriptLog(`✅ 核心素材全部就绪: 采用 meta.duration_en 视频时长 ${durationSeconds.toFixed(2)}s (${Math.ceil(durationSeconds * 30)} 帧)`), 'green');

  // summary.json  ，  14   +
  // audioStartFrom:  （0~15 ， 0~500ms），
  // MP4  ，
  const SUPPORTED_LANG_DEFINITIONS = [
    // 1.   (  +  )
    { lang: 'zh', label: localizeScriptLog('中文字幕'), audioStartFrom: 0, audioVolumeTweak: 0.000, pitchCents: 0 },
    { lang: 'en', label: localizeScriptLog('纯英文'),   audioStartFrom: 1, audioVolumeTweak: 0.002, pitchCents: 2 },
    { lang: 'ja', label: localizeScriptLog('日文字幕'), audioStartFrom: 2, audioVolumeTweak: 0.004, pitchCents: -2 },
    { lang: 'ko', label: localizeScriptLog('韩文字幕'), audioStartFrom: 3, audioVolumeTweak: -0.002, pitchCents: 4 },
    { lang: 'vi', label: localizeScriptLog('越南文字幕'), audioStartFrom: 4, audioVolumeTweak: -0.004, pitchCents: -4 },
    { lang: 'th', label: localizeScriptLog('泰文字幕'), audioStartFrom: 5, audioVolumeTweak: 0.006, pitchCents: 6 },
    { lang: 'id', label: localizeScriptLog('印尼文字幕'), audioStartFrom: 6, audioVolumeTweak: 0.008, pitchCents: 8 },
    // 2.   /   (  CPM +  )
    { lang: 'es', label: localizeScriptLog('西班牙文字幕'), audioStartFrom: 7, audioVolumeTweak: -0.006, pitchCents: -6 },
    { lang: 'fr', label: localizeScriptLog('法文字幕'), audioStartFrom: 8, audioVolumeTweak: 0.003, pitchCents: 3 },
    { lang: 'pt', label: localizeScriptLog('葡萄牙文字幕'), audioStartFrom: 9, audioVolumeTweak: -0.003, pitchCents: -3 },
    { lang: 'de', label: localizeScriptLog('德文字幕'), audioStartFrom: 10, audioVolumeTweak: -0.005, pitchCents: -5 },
    { lang: 'it', label: localizeScriptLog('意大利文字幕'), audioStartFrom: 11, audioVolumeTweak: -0.007, pitchCents: -7 },
    // 3.
    { lang: 'ru', label: localizeScriptLog('俄文字幕'), audioStartFrom: 12, audioVolumeTweak: 0.005, pitchCents: 5 },
    { lang: 'tr', label: localizeScriptLog('土耳其文字幕'), audioStartFrom: 13, audioVolumeTweak: 0.007, pitchCents: 7 },
    // Helper function note
    { lang: 'bn', label: localizeScriptLog('孟加拉文字幕'), audioStartFrom: 14, audioVolumeTweak: 0.009, pitchCents: 9 },
    { lang: 'ur', label: localizeScriptLog('乌尔都文字幕'), audioStartFrom: 15, audioVolumeTweak: -0.009, pitchCents: -9 },
  ];

  // /
  const chosenLang = (
    options.lang ||
    task.targetLang ||
    task.subtitle_language ||
    summaryData?.meta?.subtitle_language ||
    summaryData?.meta?.target_languages?.[0] ||
    summaryData?.subtitle_language ||
    summaryData?.target_languages?.[0] ||
    ''
  ).trim().toLowerCase();
  let renderLangs: typeof SUPPORTED_LANG_DEFINITIONS = [];

  if (chosenLang) {
    const matched = SUPPORTED_LANG_DEFINITIONS.find((item) => item.lang === chosenLang);
    if (matched) {
      renderLangs = [matched];
    }
  }

  // ，  JSON
  if (renderLangs.length === 0) {
    for (const item of SUPPORTED_LANG_DEFINITIONS) {
      if (item.lang === 'en') {
        renderLangs.push(item);
      } else {
        const hasContent = summaryData.segments?.some(
          (seg: any) => typeof seg[`text_${item.lang}`] === 'string' && seg[`text_${item.lang}`].trim().length > 0
        );
        if (hasContent) {
          renderLangs.push(item);
        }
      }
    }
  }

  // Helper function note
  if (renderLangs.length === 0) {
    renderLangs = SUPPORTED_LANG_DEFINITIONS;
  }

  log(localizeScriptLog(`\n🎬 根据任务语言设定检测到 ${renderLangs.length} 种渲染版本，即将开始渲染:`), 'blue');
  renderLangs.forEach((l, idx) => {
    log(`   ${idx + 1}. [${l.lang}] ${l.label} (${wordA}-${wordB}_${l.lang}.mp4)`, 'blue');
  });

  // f.
  const totalStartTime = Date.now();
  const renderedVideos: Array<{
    lang: string;
    label: string;
    outputFile: string;
    filename: string;
    r2Key: string;
    cdnUrl: string;
    size: number;
  }> = [];

  for (let idx = 0; idx < renderLangs.length; idx++) {
    const { lang, label } = renderLangs[idx];
    const langFilename = `${wordA}-${wordB}_${lang}.mp4`;
    const langOutputFile = path.join(outputDir, langFilename);

    log(`\n------------------------------------------------------------`, 'blue');
    log(localizeScriptLog(`▶️ [${idx + 1}/${renderLangs.length}] 正在执行【${label}】渲染 (${langFilename})...`), 'yellow');

    const langRenderProps = {
      ...baseRenderProps,
      lang,
      // ： ，
      audioStartFrom: renderLangs[idx].audioStartFrom ?? idx,
      // ： （ ），
      audioVolumeTweak: renderLangs[idx].audioVolumeTweak ?? 0,
    };

    const langStartTime = Date.now();
    try {
      await renderVideoWithRemotion(langOutputFile, langRenderProps, options.concurrency);
    } catch (renderErr: any) {
      log(localizeScriptLog(`❌ 【${label}】渲染失败: ${renderErr.message}`), 'red');
      // waiting_render
      await updateTaskStatus(baseUrl, taskId, 'waiting_render', undefined, task.folderPath);
      return;
    }

    if (!fs.existsSync(langOutputFile)) {
      log(localizeScriptLog(`❌ 【${label}】渲染流程完成但未在本地找到目标 MP4 文件: ${langOutputFile}`), 'red');
      await updateTaskStatus(baseUrl, taskId, 'waiting_render', undefined, task.folderPath);
      return;
    }

    const stats = fs.statSync(langOutputFile);
    const costSec = ((Date.now() - langStartTime) / 1000).toFixed(1);
    const sizeMb = (stats.size / 1024 / 1024).toFixed(2);
    log(localizeScriptLog(`✅ 【${label}】渲染完成! 耗时: ${costSec}s | 文件大小: ${sizeMb} MB`), 'green');

    // ✨  ，  pitch shift，  YouTube
    const pitchCents = renderLangs[idx].pitchCents ?? 0;
    if (pitchCents !== 0) {
      log(localizeScriptLog(`🎵 【${label}】正在对音频轨做微小变调 (${pitchCents > 0 ? '+' : ''}${pitchCents} 音分)，人耳无感知但指纹辛辣差异化...`), 'yellow');
      const pitchOk = await applyAudioPitchShift(langOutputFile, pitchCents);
      if (pitchOk) {
        log(localizeScriptLog(`✅ 【${label}】音频变调处理完成 (${pitchCents > 0 ? '+' : ''}${pitchCents} 音分)`), 'green');
      } else {
        log(localizeScriptLog(`⚠️ 【${label}】音频变调处理失败，将使用未变调版本继续上传`), 'yellow');
      }
    }

    // 兼容机制：同时生成一份默认无语言后缀的根主视频 (wordA-wordB.mp4)
    const isPrimaryCompatLang = lang === chosenLang || lang === 'en' || lang === 'zh';
    if (isPrimaryCompatLang) {
      const defaultCompatFile = path.join(outputDir, `${wordA}-${wordB}.mp4`);
      try {
        fs.copyFileSync(langOutputFile, defaultCompatFile);
      } catch (_) { }
    }

    const r2Key = `CompareEnglishWord/${cleanFolder}/${langFilename}`;
    const cdnUrl = `${getCdnDomain()}/${r2Key}`;

    renderedVideos.push({
      lang,
      label,
      outputFile: langOutputFile,
      filename: langFilename,
      r2Key,
      cdnUrl,
      size: stats.size,
    });
  }

  const totalCostSec = ((Date.now() - totalStartTime) / 1000).toFixed(1);
  log(localizeScriptLog(`\n🎉 全部 ${renderedVideos.length} 个语言版本视频渲染完成! 总渲染耗时: ${totalCostSec}s`), 'green');

  // （ ）
  const primaryVideo = renderedVideos.find((v) => v.lang === chosenLang) || renderedVideos.find((v) => v.lang === 'zh') || renderedVideos[0];

  // g.   MP4
  // 1.   --skip-upload，
  if (options.skipUpload) {
    log(localizeScriptLog(`ℹ️ 已启用 --skip-upload 选项，全部视频仅保存在本地。`), 'yellow');
    await updateTaskStatus(
      baseUrl,
      taskId,
      'video_finished',
      `local://${primaryVideo.outputFile}`,
      task.folderPath,
      primaryVideo.size,
      undefined,
      CURRENT_AUTH_TOKEN
    );
    return;
  }

  // 2.  ：
  // -   R2   (  Electron  )， 【 】
  // -   R2  ， 【 】
  const useServerProxy = !HAS_R2_CONFIG;
  if (useServerProxy) {
    log(localizeScriptLog(`\n🌐 正在通过【服务端安全代理上传通道】同步 ${renderedVideos.length} 个多语言视频...`), 'yellow');
  } else {
    log(localizeScriptLog(`\n☁️ 检测到本地开发 R2 密钥配置，正在通过【本地直传通道】上传 ${renderedVideos.length} 个多语言视频至 Cloudflare R2...`), 'yellow');
  }

  try {
    for (let i = 0; i < renderedVideos.length; i++) {
      const item = renderedVideos[i];
      const isLast = i === renderedVideos.length - 1;
      const sizeMb = (item.size / 1024 / 1024).toFixed(2);

      if (useServerProxy) {
        log(localizeScriptLog(`📤 服务端代理上传【${item.label}】: ${item.filename} (${sizeMb} MB)...`), 'yellow');
        const uploadStart = Date.now();
        const proxyRes = await uploadVideoViaServerProxy(
          baseUrl,
          taskId,
          item.lang,
          item.outputFile,
          item.filename,
          task.folderPath,
          CURRENT_AUTH_TOKEN,
          isLast
        );
        if (proxyRes.cdnUrl) {
          item.cdnUrl = proxyRes.cdnUrl;
        }
        const costSec = ((Date.now() - uploadStart) / 1000).toFixed(1);
        log(localizeScriptLog(`✅ 【${item.label}】代理上传成功! 耗时: ${costSec}s | 地址: ${item.cdnUrl}`), 'green');
      } else {
        log(localizeScriptLog(`📤 本地直传上传【${item.label}】: ${item.r2Key}...`), 'yellow');
        const fileBuffer = fs.readFileSync(item.outputFile);

        await retryOperation(
          async () => {
            const res = await uploadToR2(item.r2Key, fileBuffer, 'video/mp4');
            if (!res.success) {
              throw new Error(res.error || localizeScriptLog('R2 上传接口返回失败'));
            }
            return res;
          },
          3,
          2500,
          localizeScriptLog(`R2 视频上传 (${item.lang})`)
        );

        log(localizeScriptLog(`✅ 【${item.label}】本地直传成功: ${item.cdnUrl}`), 'green');

        // 兼容机制：向 R2 上传一份默认无语言后缀的主视频，确保旧链接与根链接 100% 访问可用
        if (item.lang === chosenLang || item.lang === 'en' || item.lang === 'zh') {
          const defaultCompatKey = `CompareEnglishWord/${cleanFolder}/${wordA}-${wordB}.mp4`;
          await uploadToR2(defaultCompatKey, fileBuffer, 'video/mp4').catch(() => null);
        }
      }
    }

    // Helper function note
    log(localizeScriptLog(`📝 正在向服务端同步状态为「渲染完成 (video_finished)」...`), 'yellow');
    const videosMap: Record<string, string> = {};
    renderedVideos.forEach((v) => {
      videosMap[v.lang] = v.cdnUrl;
    });

    const updateSuccess = await updateTaskStatus(
      baseUrl,
      taskId,
      'video_finished',
      primaryVideo.cdnUrl,
      task.folderPath,
      primaryVideo.size,
      videosMap,
      CURRENT_AUTH_TOKEN
    );

    if (updateSuccess) {
      log(localizeScriptLog(`🏆 任务 [${taskId}] ${renderedVideos.length} 个多语言视频全部处理并发布完成!\n`), 'green');
    } else {
      log(localizeScriptLog(`⚠️ 任务 [${taskId}] 视频已上传成功，但状态回写遇到网络波动，请人工核查`), 'yellow');
    }
  } catch (uploadErr: any) {
    log(localizeScriptLog(`❌ 视频上传或回写状态失败: ${uploadErr.message}`), 'red');
  }
}

// ── 5.   ──────────────────────────────────────────────
let isProcessingQueue = false;
let currentRunningTaskId: string | number | null = null;
const pendingQueue: any[] = [];

async function enqueueRenderTask(
  task: any,
  baseUrl: string,
  options: RenderWorkerOptions = {}
) {
  const taskId = task.videoId || task.id;
  // ，
  if (currentRunningTaskId != null && currentRunningTaskId === taskId) {
    return;
  }
  // Helper function note
  const exists = pendingQueue.some((t) => (t.videoId || t.id) === taskId);
  if (exists) return;

  pendingQueue.push(task);
  triggerQueue(baseUrl, options);
}

async function triggerQueue(
  baseUrl: string,
  options: RenderWorkerOptions = {}
) {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  try {
    while (true) {
      let task = pendingQueue.shift();
      if (!task) {
        // 尝试即刻连贯抢占下一个任务，实现批量任务流水线无缝渲染，免除空档等待
        const clientScope = options.scope || (IS_ELECTRON_CLIENT ? 'current_user' : 'all_users');
        const nextTask = await claimNextTask(baseUrl, CURRENT_AUTH_TOKEN, clientScope);
        if (nextTask) {
          log(localizeScriptLog(`\n⚡ [流水线接续抢单] 成功锁定待渲染任务: [${nextTask.videoId || nextTask.id}] ${nextTask.wordA} vs ${nextTask.wordB}`), 'green');
          task = nextTask;
        } else {
          break;
        }
      }

      currentRunningTaskId = task.videoId || task.id;
      try {
        await processSingleTask(task, baseUrl, options);
      } catch (err: any) {
        log(localizeScriptLog(`❌ 任务 [${currentRunningTaskId}] 执行异常: ${err.message}，已自动恢复为待渲染状态`), 'red');
        if (currentRunningTaskId) {
          await updateTaskStatus(baseUrl, currentRunningTaskId, 'waiting_render', undefined, task.folderPath).catch(() => null);
        }
      } finally {
        currentRunningTaskId = null;
      }
    }
  } finally {
    isProcessingQueue = false;
    currentRunningTaskId = null;
  }
}

// ── 6. SSE   ( ) ────────────────────────────────
async function startSSEListener(
  baseUrl: string,
  options: RenderWorkerOptions = {}
) {
  // Next.js trailingSlash: true  ，  308
  const eventsUrl = `${baseUrl.replace(/\/+$/, '')}/api/video/compare-english-word/events/`;

  while (true) {
    try {
      log(localizeScriptLog(`📡 正在建立 SSE 实时任务下发长连接: ${eventsUrl}...`), 'blue');
      const headers: Record<string, string> = {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      };
      if (CURRENT_AUTH_TOKEN) {
        headers['Authorization'] = `Bearer ${CURRENT_AUTH_TOKEN}`;
      }
      const res = await fetch(eventsUrl, { headers });

      if (!res.ok || !res.body) {
        throw new Error(localizeScriptLog(`无法建立 SSE 连接 (HTTP ${res.status})`));
      }

      log(localizeScriptLog(`⚡ SSE 任务长连接已打通！已进入「即时事件下发」监听状态。`), 'green');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const block of parts) {
          const trimmed = block.trim();
          if (!trimmed || trimmed.startsWith(':')) continue; 

          let eventName = 'message';
          let dataStr = '';

          for (const line of trimmed.split('\n')) {
            if (line.startsWith('event:')) {
              eventName = line.replace('event:', '').trim();
            } else if (line.startsWith('data:')) {
              dataStr = line.replace('data:', '').trim();
            }
          }

          if (eventName === 'new_task' && dataStr) {
            try {
              const clientScope = options.scope || (IS_ELECTRON_CLIENT ? 'current_user' : 'all_users');
              const claimedTask = await claimNextTask(baseUrl, CURRENT_AUTH_TOKEN, clientScope);
              if (claimedTask) {
                log(localizeScriptLog(`\n🔔 [SSE 抢单成功] 成功锁定待渲染任务: [${claimedTask.videoId || claimedTask.id}] ${claimedTask.wordA} vs ${claimedTask.wordB}`), 'green');
                enqueueRenderTask(claimedTask, baseUrl, options);
              } else {
                log(localizeScriptLog(`\n🔔 [SSE 消息触发] 任务已被其他 Worker 提前锁定或非当前用户任务，跳过`), 'gray');
              }
            } catch (err: any) {
              log(localizeScriptLog(`解析或抢占 SSE 任务异常: ${err.message}`), 'red');
            }
          } else if (eventName === 'ready') {
            log(localizeScriptLog(`📡 服务端确认长连接就绪 (SSE Ready)`), 'gray');
          }
        }
      }
    } catch (err: any) {
      log(localizeScriptLog(`SSE 长连接中断: ${err.message}，5秒后自动重连...`), 'yellow');
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

// ── 7. 主启动入口 / 调度循环 ───────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const isOnce = args.includes('--once');
  const skipUpload = args.includes('--skip-upload');
  const baseUrlArg = args.find((a) => a.startsWith('--url='));
  const baseUrl = baseUrlArg ? baseUrlArg.replace('--url=', '') : DEFAULT_API_BASE;
  const concurrencyArg = args.find((a) => a.startsWith('--concurrency='));
  const concurrency = concurrencyArg ? concurrencyArg.replace('--concurrency=', '') : '2';
  const langArg = args.find((a) => a.startsWith('--lang=') || a.startsWith('--target-lang='));
  const targetLang = langArg ? langArg.split('=')[1]?.trim().toLowerCase() : undefined;
  if (targetLang) {
    process.env.SHORTVIDEO_LANG = targetLang;
  }

  const isElectronClient = args.includes('--client=electron') || args.some((a) => a.startsWith('--client=electron')) || process.env.SHORTVIDEO_CLIENT_MODE === 'electron';
  const scopeArg = args.find((a) => a.startsWith('--scope='));
  const clientScope: 'current_user' | 'all_users' = scopeArg
    ? (scopeArg.split('=')[1]?.trim() as 'current_user' | 'all_users')
    : (isElectronClient ? 'current_user' : 'all_users');

  const options: RenderWorkerOptions = { skipUpload, concurrency, lang: targetLang, scope: clientScope };

  console.clear();
  log(`============================================================`, 'green');
  log(localizeScriptLog(`🎬 短视频远程渲染工作进程 (ShortVideo Render Worker)`), 'green');
  log(localizeScriptLog(`💻 本机硬件配置: ${os.cpus()[0]?.model || 'CPU'} (${os.cpus().length} 核心) | 内存: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB`), 'blue');
  log(localizeScriptLog(`⚡ 渲染并发配置: ${concurrency}x`), 'blue');
  if (targetLang) {
    log(localizeScriptLog(`🌍 指定渲染语言: ${targetLang}`), 'blue');
  }
  log(localizeScriptLog(`🎯 任务调度范围: ${clientScope === 'current_user' ? '🔒 仅限当前登录用户 (Electron 客户端模式)' : '🌍 全局任务队列 (支持渲染所有用户的待处理视频 - CLI 模式)'}`), 'blue');
  log(localizeScriptLog(`🌐 目标服务端: ${baseUrl}`), 'blue');
  log(localizeScriptLog(`☁️ 视频上传通道: ${HAS_R2_CONFIG ? '⚡ 本地直传模式 (Local R2)' : '🌐 服务端安全代理模式 (Server R2 Proxy)'}`), 'green');
  log(localizeScriptLog(`🔑 用户会话鉴权: ${CURRENT_AUTH_TOKEN ? '✅ 已绑定当前用户 Token (安全会话)' : '⚠️ 未传入 Token (公共无鉴权模式)'}`), CURRENT_AUTH_TOKEN ? 'green' : 'yellow');
  log(localizeScriptLog(`⚡ Remotion 缓存: ${fs.existsSync(path.join(BUNDLE_CACHE_DIR, 'index.html')) ? '✅ 已就绪 (秒级免打包)' : '⏳ 首次任务将自动构建并固化缓存'} (${BUNDLE_CACHE_DIR})`), 'blue');
  log(localizeScriptLog(`🔁 运行模式: ${isOnce ? '单次执行 (--once)' : '后台守护监听'}`), 'blue');
  log(`============================================================\n`, 'green');

  // 严格安全鉴权校验：
  if (!CURRENT_AUTH_TOKEN && !HAS_R2_CONFIG) {
    log(localizeScriptLog(`❌ [登录拦截] 当前未检测到用户登录凭据 (Token 为空)，已终止执行渲染！`), 'red');
    log(localizeScriptLog(`💡 提示: 请先在 ShortVideo 桌面客户端的主站窗口中登录账号后再开始渲染。\n`), 'yellow');
    process.exit(1);
  }

  // 检查是否指定了 --rebuild-bundle
  const rebuildBundle = args.includes('--rebuild-bundle') || args.includes('--clean-bundle');
  if (rebuildBundle) {
    await ensureRemotionBundle(true);
  }

  // 后台模式下，优先拉起 SSE 任务即时通知长连接
  if (!isOnce) {
    startSSEListener(baseUrl, options).catch((err) => {
      log(localizeScriptLog(`SSE 监听主线程异常: ${err.message}`), 'red');
    });
  }

  // 主轮询循环：补偿 SSE 丢包/重连空档，每隔 POLL_INTERVAL_MS 向服务端原子抢单
  while (true) {
    try {
      // 如果当前已有任务正在执行或队列非空，跳过主动轮询，避免超额抢单
      if (!isProcessingQueue && pendingQueue.length === 0 && currentRunningTaskId == null) {
        const claimedTask = await claimNextTask(baseUrl, CURRENT_AUTH_TOKEN, clientScope);
        if (claimedTask) {
          log(localizeScriptLog(`\n⚡ [轮询抢单] 成功锁定待渲染任务: [${claimedTask.videoId || claimedTask.id}] ${claimedTask.wordA} vs ${claimedTask.wordB}`), 'green');
          enqueueRenderTask(claimedTask, baseUrl, options);
        } else if (!isProcessingQueue && currentRunningTaskId == null) {
          process.stdout.write(localizeScriptLog(`\r渲染调度服务端连接正常，当前队列中没有视频任务，等待中...\n`));
        }
      }

      if (isOnce) {
        while (isProcessingQueue || pendingQueue.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        log(localizeScriptLog(`\n单次运行模式完成，退出。`), 'gray');
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    } catch (e) {
      log(localizeScriptLog(`轮询异常: ${e.message}`), 'red');
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

main().catch((err) => {
  console.error('Fatal Worker Error:', err);
  process.exit(1);
});