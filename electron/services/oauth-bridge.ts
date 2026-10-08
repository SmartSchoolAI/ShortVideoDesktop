import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app, net } from 'electron';
import { APP_CONFIG } from '../config';

export interface OAuthTokenPayload {
  token: string;
  user?: any;
}

export type OAuthTokenCallback = (payload: OAuthTokenPayload) => Promise<void> | void;

interface PendingAuth {
  state: string;
  verifier: string;
  expiresAt: number;
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function sha256Base64Url(str: string): string {
  return base64UrlEncode(crypto.createHash('sha256').update(str).digest());
}

class OAuthBridgeService {
  private server: http.Server | null = null;
  private port: number = 39281;
  private onTokenReceived: OAuthTokenCallback | null = null;
  private isListening: boolean = false;
  private pendingAuth: PendingAuth | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private shutdownTimer: NodeJS.Timeout | null = null;
  private pendingStates: Map<string, number> = new Map();

  private getAuthCacheFilePath(): string {
    try {
      const dir = app.getPath('userData');
      return path.join(dir, 'pending_pkce.json');
    } catch {
      return '';
    }
  }

  private savePendingAuth(auth: PendingAuth): void {
    this.pendingAuth = auth;
    try {
      const file = this.getAuthCacheFilePath();
      if (file) {
        fs.writeFileSync(file, JSON.stringify(auth), 'utf8');
      }
    } catch {}
  }

  private loadPendingAuth(): PendingAuth | null {
    if (this.pendingAuth && this.pendingAuth.expiresAt > Date.now()) {
      return this.pendingAuth;
    }
    try {
      const file = this.getAuthCacheFilePath();
      if (file && fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.expiresAt > Date.now()) {
          this.pendingAuth = parsed;
          return parsed;
        }
      }
    } catch {}
    return null;
  }

  private clearPendingAuth(): void {
    this.pendingAuth = null;
    try {
      const file = this.getAuthCacheFilePath();
      if (file && fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch {}
  }

  public init(onToken: OAuthTokenCallback): void {
    this.onTokenReceived = onToken;
    // 按需启动：默认不监听端口，仅在用户点击 GMAIL 图标发起授权时才动态启动监听
  }

  private pollTimer: NodeJS.Timeout | null = null;
  private isExchanged: boolean = false;

  public stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * 启动后台主动轮询（当用户在系统浏览器中完成登录，哪怕协议跳转受阻，客户端也能秒级感知并完成登录）
   */
  public startPolling(state: string, verifier: string): void {
    this.stopPolling();
    this.isExchanged = false;
    let attempts = 0;
    const maxAttempts = 120; // 120次 * 1.5s = 3分钟

    console.log('[OAuthBridge] 已启动后台授权状态轮询保底通道 (state: %s)', state);
    this.pollTimer = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts || this.isExchanged) {
        this.stopPolling();
        return;
      }

      try {
        const siteUrl = APP_CONFIG.siteUrl || APP_CONFIG.productionUrl || 'https://app.shortvideo.ca';
        const exchangeEndpoint = `${siteUrl}/api/desktop/exchange`;

        const res = await net.fetch(exchangeEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state, code_verifier: verifier }),
        });

        if (!res.ok) return;

        const data: any = await res.json();
        if (data && data.success && data.token && !this.isExchanged) {
          this.isExchanged = true;
          this.stopPolling();
          this.clearPendingAuth();
          console.log('[OAuthBridge] 🚀 后台轮询通道成功捕获到授权完成，开始登录同步！');
          if (this.onTokenReceived) {
            await this.onTokenReceived({ token: data.token, user: data.user });
          }
        }
      } catch (err: any) {
        // 静默处理网络波动
      }
    }, 1500);
  }

  /**
   * 生成一组安全 PKCE 上下文 (用于系统浏览器 Google 登录)
   */
  public createPKCEContext(): { state: string; verifier: string; challenge: string } {
    const verifier = base64UrlEncode(crypto.randomBytes(32));
    const challenge = sha256Base64Url(verifier);
    const state = base64UrlEncode(crypto.randomBytes(16));

    const auth: PendingAuth = {
      state,
      verifier,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 分钟有效
    };

    this.savePendingAuth(auth);
    this.startPolling(state, verifier);

    return { state, verifier, challenge };
  }



  /**
   * 重置空闲超时定时器（5 分钟内无任何授权请求则自动释放本地端口）
   */
  public resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.idleTimer = setTimeout(() => {
      console.log('[OAuthBridge] ⌛ 授权等待超时(5分钟)，自动关闭本地临时 HTTP 服务并释放端口');
      this.destroy();
    }, 5 * 60 * 1000);
  }

  /**
   * 注册当前发起授权的预期 State 参数（用于后续 CSRF 防御校验）
   */
  public registerPendingState(state: string): void {
    if (!state) return;
    this.cleanExpiredStates();
    this.pendingStates.set(state, Date.now() + 5 * 60 * 1000);
    this.resetIdleTimer();
  }

  /**
   * 清理已过期的 state 缓存
   */
  private cleanExpiredStates(): void {
    const now = Date.now();
    for (const [s, exp] of this.pendingStates.entries()) {
      if (exp < now) {
        this.pendingStates.delete(s);
      }
    }
  }

  /**
   * 校验回调返回的 state 是否由客户端发起
   */
  public isValidState(state: string | null): boolean {
    if (!state) return false;
    this.cleanExpiredStates();
    if (this.pendingStates.size === 0) return true; // 若未预先注册则宽容兼容
    return this.pendingStates.has(state);
  }

  /**
   * 计划延迟释放本地 HTTP 服务（防重复并发竞态）
   */
  public scheduleShutdown(delayMs: number = 20000): void {
    this.cancelScheduledShutdown();
    this.shutdownTimer = setTimeout(() => {
      try {
        this.destroy();
        console.log('[OAuthBridge] ✅ 授权流程结束，本地临时服务已平滑关闭释放端口');
      } catch {}
    }, delayMs);
  }

  /**
   * 取消已排期的服务释放定时器（新授权到来时保持服务激活）
   */
  public cancelScheduledShutdown(): void {
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
  }

  /**
   * 确保本地 HTTP 回调服务正在监听
   */
  public ensureHttpServer(): number {
    this.cancelScheduledShutdown();
    if (!this.server || !this.isListening) {
      this.startHttpServer();
    }
    this.resetIdleTimer();
    return this.port;
  }

  /**
   * 渲染统一的高品质认证结果静态 HTML（多语言跟随浏览器语言动态显示，支持 9 种核心语言）
   */
  private renderAuthResultHtml(success: boolean, fallbackTitle?: string, fallbackDesc?: string): string {
    const icon = success ? '🎉' : '⚠️';
    const accentColor = success ? '#10b981' : '#ef4444';
    const badgeBg = success ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
    const badgeBorder = success ? 'rgba(52, 211, 153, 0.3)' : 'rgba(239, 68, 68, 0.3)';

    return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShortVideo</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎬</text></svg>">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: radial-gradient(circle at 50% 20%, #1e1b4b 0%, #0f172a 75%);
      color: #f8fafc;
      padding: 24px;
    }
    .card {
      background: rgba(30, 41, 59, 0.85);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      padding: 48px 40px;
      border-radius: 24px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.65);
      text-align: center;
      max-width: 460px;
      width: 100%;
      border: 1px solid rgba(255, 255, 255, 0.1);
      animation: popIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes popIn {
      from { opacity: 0; transform: scale(0.95) translateY(12px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .icon {
      font-size: 60px;
      margin-bottom: 20px;
      line-height: 1;
      display: inline-block;
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 12px;
      color: #ffffff;
      letter-spacing: -0.02em;
    }
    p {
      font-size: 15px;
      color: #94a3b8;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    .badge {
      display: inline-block;
      padding: 8px 22px;
      border-radius: 9999px;
      background: ${badgeBg};
      border: 1px solid ${badgeBorder};
      color: ${accentColor};
      font-size: 13px;
      font-weight: 600;
    }
    .countdown {
      margin-top: 20px;
      padding: 8px 18px;
      border-radius: 9999px;
      background: rgba(99, 102, 241, 0.12);
      border: 1px solid rgba(99, 102, 241, 0.3);
      color: #c7d2fe;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      transition: all 0.3s ease;
    }
    .countdown-done {
      background: rgba(16, 185, 129, 0.12);
      border-color: rgba(52, 211, 153, 0.35);
      color: #6ee7b7;
    }
    .countdown-timer {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      height: 22px;
      padding: 0 5px;
      border-radius: 9999px;
      background: #6366f1;
      color: #ffffff;
      font-weight: 700;
      font-size: 12px;
      box-shadow: 0 0 10px rgba(99, 102, 241, 0.5);
    }
    .tip {
      margin-top: 16px;
      font-size: 13px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1 id="title">${fallbackTitle || (success ? '登录成功' : '授权未完成')}</h1>
    <p id="desc">${fallbackDesc || (success ? '登录凭证已自动同步至 ShortVideo 桌面客户端！您可以安全关闭当前浏览器窗口。' : '授权未完成，请返回客户端重新尝试。')}</p>
    <div class="badge" id="badge">${success ? '✓ 客户端已就绪 / Client Ready' : '✗ 授权未完成 / Incomplete'}</div>
    ${success ? `
    <div>
      <div class="countdown" id="countdown-wrap">
        <span class="countdown-timer" id="countdown-num">15</span>
        <span id="countdown-msg">本窗口将在 15 秒后自动关闭</span>
      </div>
    </div>` : ''}
    <div class="tip" id="tip">${success ? '已向 ShortVideo 桌面客户端注入凭证。若本标签页未自动关闭，您可以安全手动关闭。' : '您可以关闭当前窗口并返回客户端重新尝试。'}</div>
  </div>
  <script>
    (function() {
      var isSuccess = ${success ? 'true' : 'false'};
      var customDesc = ${fallbackDesc ? JSON.stringify(fallbackDesc) : 'null'};

      var I18N = {
        zh: {
          success_title: '登录成功',
          success_desc: '登录凭证已自动同步至 ShortVideo 桌面客户端！您可以安全关闭当前浏览器窗口。',
          success_badge: '✓ 客户端已就绪',
          success_tip: '已向 ShortVideo 桌面客户端注入凭证。若本标签页未自动关闭，您可以安全手动关闭。',
          fail_title: '授权未完成',
          fail_desc: '第三方平台返回错误或已取消授权。请返回客户端重新尝试。',
          fail_badge: '✗ 授权未完成',
          fail_tip: '您可以关闭当前窗口并返回客户端重新尝试。'
        },
        en: {
          success_title: 'Login Successful',
          success_desc: 'Login credentials have been automatically synced to ShortVideo Desktop client! You can safely close this window.',
          success_badge: '✓ Client Ready',
          success_tip: 'Credentials have been synced. If this tab does not close automatically, you can close it manually.',
          fail_title: 'Authorization Incomplete',
          fail_desc: 'Third-party authorization failed or was cancelled. Please return to the client and try again.',
          fail_badge: '✗ Incomplete',
          fail_tip: 'You can close this window and try again in the client.'
        },
        ja: {
          success_title: 'ログイン成功',
          success_desc: 'ログイン情報は ShortVideo デスクトップクライアントに自動同期されました！このウィンドウを閉じて構いません。',
          success_badge: '✓ クライアント準備完了',
          success_tip: 'ログイン情報が正常に同期されました。自動で閉じない場合は手動で閉じてください。',
          fail_title: '認証未完了',
          fail_desc: 'サードパーティ認証に失敗したか、キャンセルされました。アプリに戻って再試行してください。',
          fail_badge: '✗ 認証未完了',
          fail_tip: 'このウィンドウを閉じてアプリで再度お試しください。'
        },
        ko: {
          success_title: '로그인 성공',
          success_desc: '로그인 정보가 ShortVideo 데스크톱 클라이언트에 자동으로 동기화되었습니다! 이 창을 닫으셔도 됩니다.',
          success_badge: '✓ 클라이언트 준비 완료',
          success_tip: '로그인 자격 증명이 주입되었습니다. 탭이 자동으로 닫히지 않으면 직접 닫아주세요.',
          fail_title: '인증 미완료',
          fail_desc: '인증에 실패했거나 취소되었습니다. 데스크톱 앱으로 돌아가 다시 시도해 주세요.',
          fail_badge: '✗ 인증 미완료',
          fail_tip: '이 창을 닫고 클라이언트에서 다시 시도할 수 있습니다.'
        },
        vi: {
          success_title: 'Đăng nhập thành công',
          success_desc: 'Thông tin đăng nhập đã được tự động đồng bộ hóa với ShortVideo! Bạn có thể đóng cửa sổ này an toàn.',
          success_badge: '✓ Ứng dụng đã sẵn sàng',
          success_tip: 'Đã hoàn tất xác thực. Nếu tab không tự đóng, bạn có thể tự đóng tab này.',
          fail_title: 'Chưa hoàn tất xác thực',
          fail_desc: 'Xác thực bên thứ ba thất bại hoặc bị hủy. Vui lòng quay lại ứng dụng để thử lại.',
          fail_badge: '✗ Chưa hoàn tất',
          fail_tip: 'Bạn có thể đóng cửa sổ này và thử lại trong ứng dụng.'
        },
        th: {
          success_title: 'เข้าสู่ระบบสำเร็จ',
          success_desc: 'ข้อมูลการเข้าสู่ระบบถูกซิงค์ไปยัง ShortVideo Desktop เรียบร้อยแล้ว! คุณสามารถปิดหน้าต่างนี้ได้อย่างปลอดภัย',
          success_badge: '✓ ไคลเอนต์พร้อมแล้ว',
          success_tip: 'นำส่งข้อมูลรับรองแล้ว หากแท็บนี้ไม่ปิดโดยอัตโนมัติ คุณสามารถปิดได้ด้วยตนเอง',
          fail_title: 'การยืนยันไม่เสร็จสมบูรณ์',
          fail_desc: 'การยืนยันตัวตนล้มเหลวหรือถูกยกเลิก โปรดกลับไปที่แอปพลิเคชันและลองอีกครั้ง',
          fail_badge: '✗ ไม่เสร็จสมบูรณ์',
          fail_tip: 'คุณสามารถปิดหน้าต่างนี้และลองใหม่ในแอป'
        },
        bn: {
          success_title: 'লগইন সফল হয়েছে',
          success_desc: 'লগইন তথ্য স্বয়ংক্রিয়ভাবে ShortVideo ডেস্কটপ ক্লায়েন্টে সিঙ্ক হয়েছে! আপনি নিরাপদে এই উইন্ডো বন্ধ করতে পারেন।',
          success_badge: '✓ ক্লায়েন্ট প্রস্তুত',
          success_tip: 'শংসাপত্র সফলভাবে যোগ করা হয়েছে। এই ট্যাবটি স্বয়ংক্রিয়ভাবে বন্ধ না হলে ম্যানুয়ালি বন্ধ করুন।',
          fail_title: 'অনুমোদন অসম্পূর্ণ',
          fail_desc: 'তৃতীয় পক্ষের অনুমোদন ব্যর্থ হয়েছে বা বাতিল হয়েছে। ক্লায়েন্টে ফিরে আবার চেষ্টা করুন।',
          fail_badge: '✗ অসম্পূর্ণ',
          fail_tip: 'আপনি এই উইন্ডো বন্ধ করে ক্লায়েন্টে পুনরায় চেষ্টা করতে পারেন।'
        },
        id: {
          success_title: 'Login Berhasil',
          success_desc: 'Kredensial login telah disinkronkan secara otomatis ke ShortVideo Desktop! Anda dapat menutup jendela ini dengan aman.',
          success_badge: '✓ Klien Siap',
          success_tip: 'Kredensial telah disuntikkan. Jika tab ini tidak menutup secara otomatis, Anda dapat menutupnya secara manual.',
          fail_title: 'Otorisasi Belum Selesai',
          fail_desc: 'Otorisasi pihak ketiga gagal atau dibatalkan. Silakan kembali ke klien untuk mencoba lagi.',
          fail_badge: '✗ Belum Selesai',
          fail_tip: 'Anda dapat menutup jendela ini dan mencoba lagi di klien.'
        },
        es: {
          success_title: 'Inicio de Sesión Exitoso',
          success_desc: '¡Las credenciales de inicio de sesión se han sincronizado automáticamente con ShortVideo Desktop! Puede cerrar esta ventana con seguridad.',
          success_badge: '✓ Cliente Listo',
          success_tip: 'Credenciales inyectadas. Si esta pestaña no se cierra automáticamente, puede cerrarla manualmente.',
          fail_title: 'Autorización Incompleta',
          fail_desc: 'La autorización de terceros falló o fue cancelada. Vuelva a la aplicación e inténtelo de nuevo.',
          fail_badge: '✗ Incompleto',
          fail_tip: 'Puede cerrar esta ventana y volver a intentarlo en el cliente.'
        },
        fr: {
          success_title: 'Connexion Réussie',
          success_desc: 'Les identifiants de connexion ont été automatiquement synchronisés avec ShortVideo Desktop ! Vous pouvez fermer cette fenêtre en toute sécurité.',
          success_badge: '✓ Client Prêt',
          success_tip: 'Identifiants injectés. Si cet onglet ne se ferme pas automatiquement, vous pouvez le fermer manuellement.',
          fail_title: 'Autorisation Incomplète',
          fail_desc: "L'autorisation tierce a échoué ou a été annulée. Veuillez revenir à l'application et réessayer.",
          fail_badge: '✗ Incomplet',
          fail_tip: "Vous pouvez fermer cette fenêtre et réessayer dans le client."
        },
        pt: {
          success_title: 'Login Bem-sucedido',
          success_desc: 'As credenciais de login foram sincronizadas automaticamente com o ShortVideo Desktop! Você pode fechar esta janela com segurança.',
          success_badge: '✓ Cliente Pronto',
          success_tip: 'Credenciais injetadas. Se esta aba não fechar automaticamente, você pode fechá-la manualmente.',
          fail_title: 'Autorização Incompleta',
          fail_desc: 'A autorização de terceiros falhou ou foi cancelada. Volte para o aplicativo e tente novamente.',
          fail_badge: '✗ Incompleto',
          fail_tip: 'Você pode fechar esta janela e tentar novamente no cliente.'
        },
        de: {
          success_title: 'Anmeldung Erfolgreich',
          success_desc: 'Die Anmeldedaten wurden automatisch mit ShortVideo Desktop synchronisiert! Sie können dieses Fenster sicher schließen.',
          success_badge: '✓ Client Bereit',
          success_tip: 'Anmeldedaten übertragen. Wenn sich dieser Tab nicht automatisch schließt, können Sie ihn manuell schließen.',
          fail_title: 'Autorisierung Unvollständig',
          fail_desc: 'Die Drittanbieter-Autorisierung ist fehlgeschlagen oder wurde abgebrochen. Bitte kehren Sie zur App zurück und versuchen Sie es erneut.',
          fail_badge: '✗ Unvollständig',
          fail_tip: 'Sie können dieses Fenster schließen und es im Client erneut versuchen.'
        },
        it: {
          success_title: 'Accesso Riuscito',
          success_desc: 'Le credenziali di accesso sono state sincronizzate automaticamente con ShortVideo Desktop! Puoi chiudere tranquillamente questa finestra.',
          success_badge: '✓ Client Pronto',
          success_tip: 'Credenziali iniettate. Se questa scheda non si chiude automaticamente, puoi chiuderla manualmente.',
          fail_title: 'Autorizzazione Non Completata',
          fail_desc: "L'autorizzazione di terze parti non è riuscita o è stata annullata. Torna all'applicazione e riprova.",
          fail_badge: '✗ Non Completata',
          fail_tip: 'Puoi chiudere questa finestra e riprovare nel client.'
        },
        ru: {
          success_title: 'Вход Выполнен Успешно',
          success_desc: 'Учетные данные для входа автоматически синхронизированы с ShortVideo Desktop! Вы можете безопасно закрыть это окно.',
          success_badge: '✓ Клиент Готов',
          success_tip: 'Данные переданы. Если эта вкладка не закроется автоматически, вы можете закрыть её вручную.',
          fail_title: 'Авторизация Не Завершена',
          fail_desc: 'Сторонняя авторизация не удалась или была отменена. Пожалуйста, вернитесь в приложение и попробуйте снова.',
          fail_badge: '✗ Не Завершено',
          fail_tip: 'Вы можете закрыть это окно и повторить попытку в клиенте.'
        },
        tr: {
          success_title: 'Giriş Başarılı',
          success_desc: 'Giriş kimlik bilgileri otomatik olarak ShortVideo Desktop ile senkronize edildi! Bu pencereyi güvenle kapatabilirsiniz.',
          success_badge: '✓ İstemci Hazır',
          success_tip: 'Kimlik bilgileri eklendi. Bu sekme otomatik olarak kapanmazsa manuel olarak kapatabilirsiniz.',
          fail_title: 'Yetkilendirme Tamamlanmadı',
          fail_desc: 'Üçüncü taraf yetkilendirmesi başarısız oldu veya iptal edildi. Lütfen uygulamaya dönüp tekrar deneyin.',
          fail_badge: '✗ Tamamlanmadı',
          fail_tip: 'Bu pencereyi kapatıp istemcide tekrar deneyebilirsiniz.'
        }
      };

      // 提取浏览器界面首选语言并对齐 14 种支持的核心语言
      var rawLang = (navigator.language || (navigator.languages && navigator.languages[0]) || 'zh').toLowerCase();
      var langCode = 'zh';
      var supported = ['zh', 'en', 'ja', 'ko', 'vi', 'th', 'id', 'es', 'fr', 'pt', 'de', 'it', 'ru', 'tr'];
      for (var i = 0; i < supported.length; i++) {
        var code = supported[i];
        if (rawLang === code || rawLang.indexOf(code + '-') === 0) {
          langCode = code;
          break;
        }
      }

      var dict = I18N[langCode] || I18N['en'] || I18N['zh'];
      document.documentElement.lang = langCode;

      var titleEl = document.getElementById('title');
      var descEl = document.getElementById('desc');
      var badgeEl = document.getElementById('badge');
      var tipEl = document.getElementById('tip');

      if (isSuccess) {
        if (titleEl) titleEl.textContent = dict.success_title;
        if (descEl) descEl.textContent = dict.success_desc;
        if (badgeEl) badgeEl.textContent = dict.success_badge;
        if (tipEl) tipEl.textContent = dict.success_tip;
        document.title = 'ShortVideo - ' + dict.success_title;

        var countdownWrap = document.getElementById('countdown-wrap');
        var countdownNum = document.getElementById('countdown-num');
        var countdownMsg = document.getElementById('countdown-msg');

        var countdownTpl = {
          zh: '本窗口将在 {n} 秒后自动关闭',
          en: 'This window will close in {n}s',
          ja: 'このウィンドウは {n} 秒後に自動で閉じます',
          ko: '이 창은 {n}초 후 자동으로 닫힙니다',
          vi: 'Cửa sổ sẽ tự đóng sau {n}s',
          th: 'หน้าต่างจะปิดอัตโนมัติในอีก {n} วินาที',
          id: 'Jendela akan menutup otomatis dalam {n} detik',
          es: 'Esta ventana se cerrará en {n}s',
          fr: 'Cette fenêtre se fermera dans {n}s',
          pt: 'Esta janela fechará em {n}s',
          de: 'Dieses Fenster schließt sich in {n}s',
          it: 'Questa finestra si chiuderà tra {n}s',
          ru: 'Это окно закроется через {n}с',
          tr: 'Bu pencere {n}sn içinde kapanacak'
        };

        var doneTpl = {
          zh: '✓ 已完成，您可以安全手动关闭本页',
          en: '✓ Done, you can safely close this window',
          ja: '✓ 完了しました。このウィンドウを閉じてください',
          ko: '✓ 완료되었습니다. 이 창을 닫아주세요',
          vi: '✓ Đã xong, bạn có thể đóng cửa sổ này',
          th: '✓ เสร็จสิ้น คุณสามารถปิดหน้าต่างนี้ได้แล้ว',
          id: '✓ Selesai, Anda dapat menutup jendela ini',
          es: '✓ Listo, puede cerrar esta ventana de forma segura',
          fr: '✓ Terminé, vous pouvez fermer cette fenêtre en toute sécurité',
          pt: '✓ Concluído, você pode fechar esta janela com segurança',
          de: '✓ Fertig, Sie können dieses Fenster sicher schließen',
          it: '✓ Fatto, puoi chiudere questa finestra in sicurezza',
          ru: '✓ Готово, вы можете безопасно закрыть это окно',
          tr: '✓ Tamamlandı, bu pencereyi güvenle kapatabilirsiniz'
        };

        var tpl = countdownTpl[langCode] || countdownTpl['en'] || countdownTpl['zh'];
        var endMsg = doneTpl[langCode] || doneTpl['en'] || doneTpl['zh'];
        var totalMs = 15000;
        var endTime = Date.now() + totalMs;

        var updateTimerDisplay = function() {
          var remainingSec = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
          if (countdownNum) countdownNum.textContent = String(remainingSec);
          if (countdownMsg) countdownMsg.textContent = tpl.replace('{n}', String(remainingSec));

          if (remainingSec <= 0) {
            clearInterval(timer);
            if (countdownNum) countdownNum.style.display = 'none';
            if (countdownMsg) countdownMsg.textContent = endMsg;
            if (countdownWrap) countdownWrap.className = 'countdown countdown-done';
            try {
              window.open('', '_self');
              window.close();
            } catch(e) {}
          }
        };

        updateTimerDisplay();
        var timer = setInterval(updateTimerDisplay, 500);
      } else {
        if (titleEl) titleEl.textContent = dict.fail_title;
        if (descEl && !customDesc) descEl.textContent = dict.fail_desc;
        if (badgeEl) badgeEl.textContent = dict.fail_badge;
        if (tipEl) tipEl.textContent = dict.fail_tip;
        document.title = 'ShortVideo - ' + dict.fail_title;
        if (langCode === 'ur') {
          document.documentElement.dir = 'rtl';
        }
      }
    })();
  </script>
</body>
</html>`;
  }

  /**
   * 启动本地 HTTP 接收服务 (方案一：Loopback 回环地址监听)
   */
  private startHttpServer(): void {
    if (this.isListening || this.server) return;

    this.server = http.createServer(async (req, res) => {
      const origin = req.headers.origin || '*';
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Private-Network': 'true',
          'Access-Control-Max-Age': '86400',
          'Cross-Origin-Resource-Policy': 'cross-origin',
        });
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);
      const pathname = parsedUrl.pathname;

      // ── 方案一核心路由：接收本地 Loopback 回调 (GET /callback 或 GET /oauth/callback) ──
      if (req.method === 'GET' && (pathname === '/callback' || pathname === '/oauth/callback')) {
        const code = parsedUrl.searchParams.get('code');
        const state = parsedUrl.searchParams.get('state');
        const error = parsedUrl.searchParams.get('error');
        const token = parsedUrl.searchParams.get('token');
        const userRaw = parsedUrl.searchParams.get('user');

        // 1. 用户取消或第三方授权拒绝
        if (error) {
          console.warn('[OAuthBridge] 用户取消或第三方授权失败:', error);
          const errorHtml = this.renderAuthResultHtml(
            false,
            '授权未完成',
            `第三方平台返回错误: ${error}。<br>请返回 ShortVideo 客户端重新点击登录。`
          );
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(errorHtml);
          return;
        }

        // 2. 原生方案一核心：直接捕获 Google 等授权中心返回的 authorization_code
        if (code) {
          // 安全校验：校验 state 参数防止 CSRF 攻击或仿冒请求
          if (state && !this.isValidState(state)) {
            console.warn('[OAuthBridge] State 校验不匹配，已拒绝非法的授权回调请求:', state);
            const csrfHtml = this.renderAuthResultHtml(
              false,
              '安全校验失败',
              '授权状态 (State) 校验不匹配或已过期。<br>请返回 ShortVideo 客户端重新点击登录。'
            );
            res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(csrfHtml);
            return;
          }

          this.resetIdleTimer();
          console.log('[OAuthBridge] ⚡ 本地 Loopback HTTP 成功捕获到授权码 (code)，开始请求后端换取 Token...');
          try {
            const siteUrl = APP_CONFIG.siteUrl || APP_CONFIG.productionUrl || 'https://app.shortvideo.ca';
            const exchangeEndpoint = `${siteUrl}/api/auth/oauth-callback`;
            const redirectUri = `http://127.0.0.1:${this.port}/callback`;

            const exchangeRes = await net.fetch(exchangeEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code,
                provider: 'google',
                redirect_uri: redirectUri,
                state: state || 'zh_google',
              }),
            });

            let responseData: any = null;
            let responseText = '';
            try {
              responseText = await exchangeRes.text();
              responseData = JSON.parse(responseText);
            } catch {
              // 非 JSON 纯文本格式响应
            }

            if (exchangeRes.ok && responseData && responseData.token) {
              console.log('[OAuthBridge] 🎉 授权码兑换成功！开始同步至桌面客户端主窗口...');
              this.stopPolling();
              this.clearPendingAuth();
              if (this.onTokenReceived) {
                Promise.resolve(this.onTokenReceived({ token: responseData.token, user: responseData.user })).catch(() => {});
              }

              const successHtml = this.renderAuthResultHtml(
                true,
                '登录成功',
                '登录凭证已自动同步至 ShortVideo 桌面客户端！<br>您可以安全关闭当前浏览器窗口。'
              );
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(successHtml);

              // 授权成功后延迟 20 秒平滑关闭本地临时 HTTP 服务（充分覆盖前端 15 秒倒计时），彻底释放端口与系统资源
              this.scheduleShutdown(20000);
              return;
            }

            const errorDetail = responseData?.error || responseData?.message || responseText || `HTTP ${exchangeRes.status}`;
            console.error('[OAuthBridge] 服务端换票失败:', exchangeRes.status, errorDetail);
            const failHtml = this.renderAuthResultHtml(
              false,
              '换取凭证失败',
              `认证响应: ${errorDetail}。<br>请关闭后返回客户端重新登录。`
            );
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(failHtml);
            return;
          } catch (netErr: any) {
            console.error('[OAuthBridge] 换取凭证网络异常:', netErr?.message || netErr);
            const failHtml = this.renderAuthResultHtml(
              false,
              '网络请求异常',
              `未能连接到认证服务端: ${netErr?.message || '网络超时'}，请检查网络后重试。`
            );
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(failHtml);
            return;
          }
        }

        // 3. 兼容通道：直接传入已兑换好的 token（如来自线上 callback 页面跳转）
        if (token) {
          let user: any = undefined;
          if (userRaw) {
            try {
              user = JSON.parse(decodeURIComponent(userRaw));
            } catch {
              user = userRaw;
            }
          }

          console.log('[OAuthBridge] ✅ Loopback HTTP 成功接收到浏览器回传的 Token 凭证！');
          this.stopPolling();
          this.clearPendingAuth();
          if (this.onTokenReceived) {
            Promise.resolve(this.onTokenReceived({ token, user })).catch(() => {});
          }

          const successHtml = this.renderAuthResultHtml(
            true,
            '登录成功',
            '登录凭证已自动同步至 ShortVideo 桌面客户端！<br>您可以安全关闭当前浏览器窗口。'
          );
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(successHtml);

          // 授权成功后延迟 20 秒平滑关闭本地临时 HTTP 服务，彻底释放端口与系统资源
          this.scheduleShutdown(20000);
          return;
        }

        const badHtml = this.renderAuthResultHtml(
          false,
          '请求参数缺失',
          '未检测到有效的授权码 (code) 或凭证 (token)。'
        );
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(badHtml);
        return;
      }

      // ── 兼容通道：POST 接口接收外部直传 Token ──
      if (req.method === 'POST' && (pathname === '/oauth-token' || pathname === '/oauth-sync' || pathname.startsWith('/oauth'))) {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 1024 * 1024) {
            req.destroy();
          }
        });

        req.on('end', async () => {
          try {
            const data = JSON.parse(body);
            if (data && data.token) {
              console.log('[OAuthBridge] 本地 HTTP 接口成功接收到外部广播的 Token');
              this.stopPolling();
              this.clearPendingAuth();
              if (this.onTokenReceived) {
                await this.onTokenReceived({
                  token: data.token,
                  user: data.user,
                });
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, message: 'Token successfully synced to client' }));
              return;
            }
          } catch (err: any) {
            console.warn('[OAuthBridge] 处理接收到的 Token 数据异常:', err?.message || err);
          }
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid payload' }));
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', app: 'ShortVideo Desktop', port: this.port }));
        return;
      }

      if (req.method === 'GET' && pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    this.server.on('error', (err: any) => {
      console.warn(`[OAuthBridge] HTTP 监听端口 ${this.port} 异常:`, err?.message || err);
      if (err.code === 'EADDRINUSE') {
        this.port = 39282 + Math.floor(Math.random() * 50);
        try {
          this.server?.listen(this.port, '127.0.0.1');
        } catch {}
      }
    });

    try {
      this.server.listen(this.port, '127.0.0.1', () => {
        this.isListening = true;
        console.log(`[OAuthBridge] 本地认证同步服务已就绪: http://127.0.0.1:${this.port}`);
      });
    } catch (e: any) {
      console.warn('[OAuthBridge] 启动 HTTP 服务失败:', e?.message || e);
    }
  }

  public getPort(): number {
    return this.port;
  }

  public destroy(): void {
    this.stopPolling();
    this.cancelScheduledShutdown();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.pendingStates.clear();
    if (this.server) {
      try {
        if (typeof (this.server as any).closeAllConnections === 'function') {
          (this.server as any).closeAllConnections();
        }
        this.server.close();
      } catch {}
      this.server = null;
    }
    this.isListening = false;
  }
}

export const oauthBridge = new OAuthBridgeService();
