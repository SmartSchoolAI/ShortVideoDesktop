import { WebContents } from 'electron';
import { CdpPageClient } from '../services/cdp-bridge';
import { windowManager } from '../services/window-manager';

export type StepState = 'pending' | 'active' | 'done' | 'error';

export interface StepDef {
  name: string;
}

import { SupportedLocale, normalizeLang } from './i18n';

export const PLATFORM_STEPS: Record<SupportedLocale, { wechat: string[]; xiaohongshu: string[] }> = {
  zh: {
    wechat: ['页面就绪', '视频上传', '短标题录入', '简介与话题', '高级设置', '转码与发布'],
    xiaohongshu: ['页面就绪', '视频上传', '笔记标题', '正文与话题', '高级设置', '校验与发布']
  },
  en: {
    wechat: ['Page Ready', 'Video Upload', 'Short Title', 'Description & Tags', 'Advanced Settings', 'Transcode & Publish'],
    xiaohongshu: ['Page Ready', 'Video Upload', 'Note Title', 'Content & Tags', 'Advanced Settings', 'Validate & Publish']
  },
  ja: {
    wechat: ['ページ準備完了', '動画アップロード', 'ショートタイトル', '概要とタグ', '詳細設定', '変換と投稿'],
    xiaohongshu: ['ページ準備完了', '動画アップロード', 'ノートタイトル', '本文とタグ', '詳細設定', '検証と投稿']
  },
  ko: {
    wechat: ['페이지 준비 완료', '동영상 업로드', '짧은 제목 입력', '설명 및 태그', '고급 설정', '변환 및 게시'],
    xiaohongshu: ['페이지 준비 완료', '동영상 업로드', '노트 제목', '본문 및 태그', '고급 설정', '검증 및 게시']
  },
  vi: {
    wechat: ['Trang sẵn sàng', 'Tải lên video', 'Nhập tiêu đề ngắn', 'Mô tả & Thẻ', 'Cài đặt nâng cao', 'Chuyển mã & Xuất bản'],
    xiaohongshu: ['Trang sẵn sàng', 'Tải lên video', 'Tiêu đề ghi chú', 'Nội dung & Thẻ', 'Cài đặt nâng cao', 'Xác thực & Xuất bản']
  },
  th: {
    wechat: ['หน้าเว็บพร้อม', 'อัปโหลดวิดีโอ', 'กรอกชื่อเรื่องสั้น', 'คำอธิบายและแท็ก', 'การตั้งค่าขั้นสูง', 'แปลงรหัสและเผยแพร่'],
    xiaohongshu: ['หน้าเว็บพร้อม', 'อัปโหลดวิดีโอ', 'ชื่อโน้ต', 'เนื้อหาและแท็ก', 'การตั้งค่าขั้นสูง', 'ตรวจสอบและเผยแพร่']
  },
  id: {
    wechat: ['Halaman Siap', 'Unggah Video', 'Masukkan Judul Pendek', 'Deskripsi & Tag', 'Pengaturan Lanjutan', 'Transcode & Publikasikan'],
    xiaohongshu: ['Halaman Siap', 'Unggah Video', 'Judul Catatan', 'Konten & Tag', 'Pengaturan Lanjutan', 'Validasi & Publikasikan']
  },
  es: {
    wechat: ['Página lista', 'Subida de video', 'Título corto', 'Descripción y etiquetas', 'Ajustes avanzados', 'Transcodificación y publicación'],
    xiaohongshu: ['Página lista', 'Subida de video', 'Título de nota', 'Contenido y etiquetas', 'Ajustes avanzados', 'Validación y publicación']
  },
  fr: {
    wechat: ['Page prête', 'Téléversement vidéo', 'Titre court', 'Description & Tags', 'Paramètres avancés', 'Transcodage & Publication'],
    xiaohongshu: ['Page prête', 'Téléversement vidéo', 'Titre de la note', 'Contenu & Tags', 'Paramètres avancés', 'Validation & Publication']
  },
  pt: {
    wechat: ['Página pronta', 'Envio do vídeo', 'Título curto', 'Descrição e tags', 'Configurações avançadas', 'Transcodificação e publicação'],
    xiaohongshu: ['Página pronta', 'Envio do vídeo', 'Título da nota', 'Conteúdo e tags', 'Configurações avançadas', 'Validação e publicação']
  },
  ru: {
    wechat: ['Страница готова', 'Загрузка видео', 'Краткий заголовок', 'Описание и теги', 'Расширенные настройки', 'Транскодирование и публикация'],
    xiaohongshu: ['Страница готова', 'Загрузка видео', 'Заголовок заметки', 'Текст и теги', 'Расширенные настройки', 'Проверка и публикация']
  },
  de: {
    wechat: ['Seite bereit', 'Video-Upload', 'Kurztitel', 'Beschreibung & Tags', 'Erweiterte Einstellungen', 'Transcodierung & Veröffentlichung'],
    xiaohongshu: ['Seite bereit', 'Video-Upload', 'Notiztitel', 'Inhalt & Tags', 'Erweiterte Einstellungen', 'Validierung & Veröffentlichung']
  },
  tr: {
    wechat: ['Sayfa Hazır', 'Video Yükleme', 'Kısa Başlık', 'Açıklama ve Etiketler', 'Gelişmiş Ayarlar', 'Kod Dönüştürme ve Yayınlama'],
    xiaohongshu: ['Sayfa Hazır', 'Video Yükleme', 'Not Başlığı', 'İçerik ve Etiketler', 'Gelişmiş Ayarlar', 'Doğrulama ve Yayınlama']
  },
  it: {
    wechat: ['Pagina pronta', 'Caricamento video', 'Titolo breve', 'Descrizione e tag', 'Impostazioni avanzate', 'Transcodifica e pubblicazione'],
    xiaohongshu: ['Pagina pronta', 'Caricamento video', 'Titolo della nota', 'Contenuto e tag', 'Impostazioni avanzate', 'Convalida e pubblicazione']
  }
};

export const WECHAT_PUBLISH_STEPS = PLATFORM_STEPS.zh.wechat;
export const XIAOHONGSHU_PUBLISH_STEPS = PLATFORM_STEPS.zh.xiaohongshu;

export function getPlatformPublishSteps(platform: 'wechat' | 'xiaohongshu', lang?: string): string[] {
  const currentLang = normalizeLang(lang || windowManager.getCurrentLanguage());
  const stepsMap = PLATFORM_STEPS[currentLang] || PLATFORM_STEPS.en || PLATFORM_STEPS.zh;
  return stepsMap[platform] || (platform === 'wechat' ? WECHAT_PUBLISH_STEPS : XIAOHONGSHU_PUBLISH_STEPS);
}

/**
 * 刷新或更新发布流水线步骤条
 * 安全防检测加固：
 * 绝不在第三方平台页面（微信视频号/小红书）的 DOM 树中插入任何元素或修改全局 window 对象，
 * 避免被平台的 MutationObserver、反爬 SDK 及截屏机制捕获为外挂或机器人；
 * 步骤状态统一通过 Electron 原生 IPC 广播至桌面端原生 TabBar 视图展示。
 */
export async function updatePlatformStepsBar(
  target: WebContents | CdpPageClient | null | undefined,
  platformTitle: string,
  steps: string[],
  currentStep: number,
  state: StepState = 'active'
): Promise<void> {
  windowManager.broadcast('platform:steps-update', {
    platform: platformTitle,
    steps,
    currentStep,
    state,
    timestamp: Date.now(),
  });
}
