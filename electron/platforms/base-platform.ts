import { WebContents } from 'electron';
import { PlatformTabAdapter, windowManager } from '../services/window-manager';
import { tPlatform, getPlatformDisplayName, localizePlatformLog, PlatformI18nEntry } from './platform-i18n';
import { normalizeLangCode } from '../utils/i18n';

export interface PublishPayload {
  videoId: string;
  videoUrl: string;
  title: string;
  description: string;
  tags?: string[];
  coverUrl?: string;
  scheduledPublishAt?: number;
}

export interface PlatformPublishResult {
  success: boolean;
  message: string;
  platform: 'wechat' | 'xiaohongshu';
}

export class PublishAbortedError extends Error {
  readonly isAborted = true;
  constructor(message?: string, lang?: string) {
    const msg = message || tPlatform('publishAborted', lang);
    super(msg);
    this.name = 'PublishAbortedError';
  }
}

export abstract class BasePlatform {
  abstract readonly platformId: 'wechat' | 'xiaohongshu';
  abstract readonly name: string;
  abstract readonly homeUrl: string;
  abstract readonly publishUrl: string;

  protected currentAbortController: AbortController | null = null;

  /**
   * 解析当前运行时有效语言环境代码
   */
  public getCurrentLang(lang?: string | null): string {
    if (lang) return normalizeLangCode(lang);
    return normalizeLangCode(typeof windowManager !== 'undefined' ? windowManager.getCurrentLanguage() : 'zh');
  }

  /**
   * 获取当前多语言本地化平台显示名称
   */
  public getDisplayName(lang?: string): string {
    return getPlatformDisplayName(this.platformId, this.getCurrentLang(lang));
  }

  /**
   * 翻译平台专有多语言词条
   */
  public t(key: keyof PlatformI18nEntry, lang?: string, params?: Record<string, string | number>): string {
    return tPlatform(key, this.getCurrentLang(lang), params);
  }

  /**
   * 动态翻译格式化运行时日志文本
   */
  public formatLog(text: string, lang?: string): string {
    return localizePlatformLog(text, this.getCurrentLang(lang));
  }

  /**
   * 中止当前正在执行的发布流程
   */
  public abortPublish(reason?: string, lang?: string): void {
    if (this.currentAbortController && !this.currentAbortController.signal.aborted) {
      const activeLang = this.getCurrentLang(lang);
      const platformName = this.getDisplayName(activeLang);
      const msg = reason || tPlatform('tabClosed', activeLang, { platform: platformName });
      console.warn(`[${platformName}] abortPublish: ${msg}`);
      this.currentAbortController.abort(new PublishAbortedError(msg, activeLang));
    }
  }

  /**
   * 检查当前是否正处于发布执行中
   */
  public isPublishing(): boolean {
    return this.currentAbortController !== null && !this.currentAbortController.signal.aborted;
  }

  /**
   * 判断当前页面是否已处于登录态
   */
  abstract checkLoginStatus(webContents: WebContents): Promise<boolean>;

  /**
   * 执行完整的自动化视频发布流程
   */
  abstract executePublish(
    adapter: PlatformTabAdapter,
    localVideoPath: string,
    payload: PublishPayload,
    onStatusUpdate?: (status: string) => void,
    lang?: string
  ): Promise<PlatformPublishResult>;
}

