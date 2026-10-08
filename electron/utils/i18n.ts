export interface SupportedLanguageItem {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
}

export const SUPPORTED_LANGUAGES: SupportedLanguageItem[] = [
  // 1. 亚太核心 (高变现 + 高流量)
  { code: 'zh', name: '中文', nativeName: '中文 (Chinese)', flag: '🇨🇳' },
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇬🇧' },
  { code: 'ja', name: '日本語', nativeName: '日本語 (Japanese)', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', nativeName: '한국어 (Korean)', flag: '🇰🇷' },
  { code: 'vi', name: 'Tiếng Việt', nativeName: 'Tiếng Việt (Vietnamese)', flag: '🇻🇳' },
  { code: 'th', name: 'ไทย', nativeName: 'ไทย (Thai)', flag: '🇹🇭' },
  { code: 'id', name: 'Bahasa Indonesia', nativeName: 'Bahasa Indonesia', flag: '🇮🇩' },
  // 2. 欧美 / 拉美核心 (高 CPM + 巨大用户基数)
  { code: 'es', name: 'Español', nativeName: 'Español (Spanish)', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', nativeName: 'Français (French)', flag: '🇫🇷' },
  { code: 'pt', name: 'Português', nativeName: 'Português (Portuguese)', flag: '🇧🇷' },
  { code: 'de', name: 'Deutsch', nativeName: 'Deutsch (German)', flag: '🇩🇪' },
  { code: 'it', name: 'Italiano', nativeName: 'Italiano (Italian)', flag: '🇮🇹' },
  // 3. 欧亚高潜力市场
  { code: 'ru', name: 'Русский', nativeName: 'Русский (Russian)', flag: '🇷🇺' },
  { code: 'tr', name: 'Türkçe', nativeName: 'Türkçe (Turkish)', flag: '🇹🇷' },
];

export const VALID_LANG_CODES = [
  'zh', 'en', 'ja', 'ko', 'vi', 'th', 'id',
  'es', 'fr', 'pt', 'de', 'it', 'ru', 'tr'
] as const;

export type SupportedLocale = typeof VALID_LANG_CODES[number];
export type SupportedLangCode = SupportedLocale;

export function normalizeLangCode(lang?: string | null): SupportedLangCode {
  if (!lang) return 'zh';
  const clean = String(lang).toLowerCase().trim();
  if ((VALID_LANG_CODES as readonly string[]).includes(clean)) {
    return clean as SupportedLangCode;
  }
  const prefix = clean.split(/[-_]/)[0];
  if ((VALID_LANG_CODES as readonly string[]).includes(prefix)) {
    return prefix as SupportedLangCode;
  }
  return 'zh';
}

export interface I18nDictionary {
  menu: {
    app: {
      about: string;
      checkUpdate: string;
      services: string;
      hide: string;
      hideOthers: string;
      unhide: string;
      quit: string;
    };
    edit: {
      label: string;
      undo: string;
      redo: string;
      cut: string;
      copy: string;
      paste: string;
      selectAll: string;
    };
    view: {
      label: string;
      reload: string;
      forceReload: string;
      toggleDevTools: string;
      resetZoom: string;
      zoomIn: string;
      zoomOut: string;
      toggleFullscreen: string;
    };
    window: {
      label: string;
      minimize: string;
      zoom: string;
      front: string;
      close: string;
    };
    language: {
      label: string;
    };
    help: {
      label: string;
      checkUpdate: string;
      officialSite: string;
      syslogs: string;
      render: string;
      about: string;
    };
  };
  dialogs: {
    newVersionTitle: string;
    newVersionMsg: string;
    linuxManualDetail: string;
    btnGoWebsite: string;
    btnRemindLater: string;
    checkUpdateTitle: string;
    alreadyLatestMsg: string;
    alreadyLatestDetail: string;
    btnOk: string;
    btnCancel: string;
    updateFailedTitle: string;
    updateFailedMsg: string;
    updateFailedDetail: string;
    devModeTitle: string;
    devModeMsg: string;
    devModeDetail: string;
    exportLogsTitle: string;
    logFileFilter: string;
    selectProjectDirTitle: string;
    projectDirNotFound: string;
  };
  notifications: {
    updateDownloadedTitle: string;
    updateDownloadedBody: string;
    startPublishTitle: string;
    startPublishBody: string;
    scheduleSuccessTitle: string;
    scheduleSuccessBody: string;
    scheduleFailedTitle: string;
    scheduleFailedBody: string;
    scheduleErrorTitle: string;
    scheduleErrorBody: string;
    autoRetryTitle: string;
    autoRetryBody: string;
  };
  platforms: {
    wechat: string;
    wechatShort: string;
    xiaohongshu: string;
    xhsShort: string;
    system: string;
  };
  steps: {
    wechat: string[];
    xiaohongshu: string[];
  };
}

export const I18N_LOCALES: Record<SupportedLangCode, I18nDictionary> = {
  zh: {
    menu: {
      app: {
        about: "关于 {app}",
        checkUpdate: "检查更新...",
        services: "服务",
        hide: "隐藏 {app}",
        hideOthers: "隐藏其他",
        unhide: "显示全部",
        quit: "退出 {app}",
      },
      edit: {
        label: "编辑",
        undo: "撤销",
        redo: "重做",
        cut: "剪切",
        copy: "复制",
        paste: "粘贴",
        selectAll: "全选",
      },
      view: {
        label: "视图",
        reload: "重新加载",
        forceReload: "强制刷新",
        toggleDevTools: "切换开发者工具",
        resetZoom: "实际大小",
        zoomIn: "放大",
        zoomOut: "缩小",
        toggleFullscreen: "全屏模式",
      },
      window: {
        label: "窗口",
        minimize: "最小化",
        zoom: "缩放",
        front: "前置全部窗口",
        close: "关闭",
      },
      language: {
        label: "语言 / Language",
      },
      help: {
        label: "帮助",
        checkUpdate: "检查更新...",
        officialSite: "ShortVideo AI 创作官网",
        syslogs: "系统运行日志",
        render: "视频渲染",
        about: "系统说明与关于",
      },
    },
    dialogs: {
      newVersionTitle: "发现新版本: {version}",
      newVersionMsg: "ShortVideo 客户端有新版本可用",
      linuxManualDetail: "检测到最新版本为 {version}。由于 Linux 桌面环境包格式多样，请前往官方发布站点下载对应 AppImage/deb/rpm 安装包。",
      btnGoWebsite: "前往官网下载",
      btnRemindLater: "稍后提醒",
      checkUpdateTitle: "检查更新",
      alreadyLatestMsg: "当前已是最新版本",
      alreadyLatestDetail: "您使用的 ShortVideo (v{version}) 已经是最新版本，无需更新。",
      btnOk: "确定",
      btnCancel: "取消",
      updateFailedTitle: "检查更新失败",
      updateFailedMsg: "未能获取最新版本信息",
      updateFailedDetail: "请检查网络连接是否正常，或稍后重试。",
      devModeTitle: "开发调试模式",
      devModeMsg: "当前处于开发源码调试模式",
      devModeDetail: "开发环境下无需检查自动更新。",
      exportLogsTitle: "导出 ShortVideo 系统运行日志",
      logFileFilter: "日志文件 (*.log)",
      selectProjectDirTitle: "选择 ShortVideo 项目源码根目录",
      projectDirNotFound: "未找到指定源码目录",
    },
    notifications: {
      updateDownloadedTitle: "新版本 v{version} 已下载完成",
      updateDownloadedBody: "新版本已在后台准备就绪，重启客户端即可完成升级！",
      startPublishTitle: "视频发布已启动",
      startPublishBody: "正在为您自动发布短视频到【{platform}】，预计耗时 1-3 分钟...",
      scheduleSuccessTitle: "定时发布成功",
      scheduleSuccessBody: "【{platform}】{title} 已按计划成功发布！",
      scheduleFailedTitle: "定时发布未成功",
      scheduleFailedBody: "【{platform}】{title} 未能完成发布: {error}",
      scheduleErrorTitle: "定时发布执行异常",
      scheduleErrorBody: "【{platform}】{title}: {error}",
      autoRetryTitle: "自动重试发布",
      autoRetryBody: "检测到 {count} 个此前未成功发布的视频，已自动重新安排立即发布处理！",
    },
    platforms: {
      wechat: "微信视频号",
      wechatShort: "视频号",
      xiaohongshu: "小红书创作者服务平台",
      xhsShort: "小红书",
      system: "系统日志",
    },
    steps: {
      wechat: ['页面就绪', '视频上传', '短标题录入', '简介与话题', '高级设置', '转码与发布'],
      xiaohongshu: ['页面就绪', '视频上传', '笔记标题', '正文与话题', '高级设置', '校验与发布'],
    },
  },
  en: {
    menu: {
      app: {
        about: "About {app}",
        checkUpdate: "Check for Updates...",
        services: "Services",
        hide: "Hide {app}",
        hideOthers: "Hide Others",
        unhide: "Show All",
        quit: "Quit {app}",
      },
      edit: {
        label: "Edit",
        undo: "Undo",
        redo: "Redo",
        cut: "Cut",
        copy: "Copy",
        paste: "Paste",
        selectAll: "Select All",
      },
      view: {
        label: "View",
        reload: "Reload",
        forceReload: "Force Reload",
        toggleDevTools: "Toggle Developer Tools",
        resetZoom: "Actual Size",
        zoomIn: "Zoom In",
        zoomOut: "Zoom Out",
        toggleFullscreen: "Toggle Full Screen",
      },
      window: {
        label: "Window",
        minimize: "Minimize",
        zoom: "Zoom",
        front: "Bring All to Front",
        close: "Close Window",
      },
      language: {
        label: "Language",
      },
      help: {
        label: "Help",
        checkUpdate: "Check for Updates...",
        officialSite: "Official Website",
        syslogs: "System Logs",
        render: "Video Rendering",
        about: "About ShortVideo",
      },
    },
    dialogs: {
      newVersionTitle: "New Version Available: {version}",
      newVersionMsg: "A new version of ShortVideo is available",
      linuxManualDetail: "Version {version} is now available. Please download the latest package from our website.",
      btnGoWebsite: "Visit Website",
      btnRemindLater: "Remind Me Later",
      checkUpdateTitle: "Check for Updates",
      alreadyLatestMsg: "You are up to date",
      alreadyLatestDetail: "ShortVideo v{version} is currently the newest version available.",
      btnOk: "OK",
      btnCancel: "Cancel",
      updateFailedTitle: "Update Check Failed",
      updateFailedMsg: "Unable to check for updates",
      updateFailedDetail: "Please check your internet connection and try again later.",
      devModeTitle: "Development Mode",
      devModeMsg: "Running in development mode",
      devModeDetail: "Auto-update is disabled in development mode.",
      exportLogsTitle: "Export System Logs",
      logFileFilter: "Log Files (*.log)",
      selectProjectDirTitle: "Select ShortVideo Project Root Directory",
      projectDirNotFound: "Specified directory not found",
    },
    notifications: {
      updateDownloadedTitle: "Update v{version} Downloaded",
      updateDownloadedBody: "A new version has been downloaded. Restart the app to apply updates.",
      startPublishTitle: "Publishing Started",
      startPublishBody: "Auto-publishing video to 【{platform}】, estimated 1-3 minutes...",
      scheduleSuccessTitle: "Scheduled Publish Succeeded",
      scheduleSuccessBody: "【{platform}】{title} published successfully!",
      scheduleFailedTitle: "Scheduled Publish Failed",
      scheduleFailedBody: "【{platform}】{title} failed to publish: {error}",
      scheduleErrorTitle: "Scheduled Publish Error",
      scheduleErrorBody: "【{platform}】{title}: {error}",
      autoRetryTitle: "Auto-Retry Publishing",
      autoRetryBody: "Detected {count} unpublished videos, rescheduled for publishing now!",
    },
    platforms: {
      wechat: "WeChat Channels",
      wechatShort: "Channels",
      xiaohongshu: "Xiaohongshu Creator Platform",
      xhsShort: "Xiaohongshu",
      system: "System Logs",
    },
    steps: {
      wechat: ['Page Ready', 'Video Upload', 'Short Title', 'Description & Tags', 'Advanced Settings', 'Transcode & Publish'],
      xiaohongshu: ['Page Ready', 'Video Upload', 'Post Title', 'Content & Tags', 'Advanced Settings', 'Verify & Publish'],
    },
  },
  ja: {
    menu: {
      app: {
        about: "{app} について",
        checkUpdate: "アップデートを確認...",
        services: "サービス",
        hide: "{app} を隠す",
        hideOthers: "ほかを隠す",
        unhide: "すべてを表示",
        quit: "{app} を終了",
      },
      edit: {
        label: "編集",
        undo: "取り消し",
        redo: "やり直し",
        cut: "カット",
        copy: "コピー",
        paste: "貼り付け",
        selectAll: "すべて選択",
      },
      view: {
        label: "表示",
        reload: "再読み込み",
        forceReload: "強制的に再読み込み",
        toggleDevTools: "開発者ツール",
        resetZoom: "実際のサイズ",
        zoomIn: "拡大",
        zoomOut: "縮小",
        toggleFullscreen: "フルスクリーン",
      },
      window: {
        label: "ウィンドウ",
        minimize: "最小化",
        zoom: "拡大/縮小",
        front: "すべてを手前に移動",
        close: "ウィンドウを閉じる",
      },
      language: {
        label: "言語 (Language)",
      },
      help: {
        label: "ヘルプ",
        checkUpdate: "アップデートを確認...",
        officialSite: "公式サイト",
        syslogs: "システムログ",
        render: "動画レンダリング",
        about: "ShortVideo について",
      },
    },
    dialogs: {
      newVersionTitle: "新しいバージョンがあります: {version}",
      newVersionMsg: "ShortVideo の新しいバージョンが利用可能です",
      linuxManualDetail: "バージョン {version} が利用可能です。公式サイトよりダウンロードしてください。",
      btnGoWebsite: "公式サイトへ",
      btnRemindLater: "後で通知",
      checkUpdateTitle: "アップデート確認",
      alreadyLatestMsg: "最新バージョンです",
      alreadyLatestDetail: "ご利用の ShortVideo (v{version}) は最新です。",
      btnOk: "OK",
      btnCancel: "キャンセル",
      updateFailedTitle: "確認失敗",
      updateFailedMsg: "アップデート情報を取得できませんでした",
      updateFailedDetail: "ネットワーク接続を確認し、再試行してください。",
      devModeTitle: "開発者モード",
      devModeMsg: "開発者モードで実行中です",
      devModeDetail: "開発環境では自動更新は無効です。",
      exportLogsTitle: "システムログをエクスポート",
      logFileFilter: "ログファイル (*.log)",
      selectProjectDirTitle: "プロジェクトディレクトリを選択",
      projectDirNotFound: "指定されたディレクトリが見つかりません",
    },
    notifications: {
      updateDownloadedTitle: "バージョン v{version} のダウンロード完了",
      updateDownloadedBody: "新バージョンの準備が完了しました。再起動して適用してください。",
      startPublishTitle: "動画投稿を開始しました",
      startPublishBody: "【{platform}】への自動投稿を開始しました。所要時間は約1〜3分です...",
      scheduleSuccessTitle: "予約投稿成功",
      scheduleSuccessBody: "【{platform}】{title} の投稿が完了しました！",
      scheduleFailedTitle: "予約投稿失敗",
      scheduleFailedBody: "【{platform}】{title} の投稿に失敗しました: {error}",
      scheduleErrorTitle: "予約投稿エラー",
      scheduleErrorBody: "【{platform}】{title}: {error}",
      autoRetryTitle: "自動再試行投稿",
      autoRetryBody: "未投稿の動画 {count} 件を検出しました。直ちに再投稿をスケジュールしました！",
    },
    platforms: {
      wechat: "WeChat チャンネル",
      wechatShort: "WeChat",
      xiaohongshu: "小紅書 (RED) クリエイター",
      xhsShort: "小紅書",
      system: "システムログ",
    },
    steps: {
      wechat: ['ページ準備完了', '動画アップロード', 'タイトル入力', '説明とタグ', '詳細設定', '変換と投稿'],
      xiaohongshu: ['ページ準備完了', '動画アップロード', 'ノートタイトル', '本文とハッシュタグ', '詳細設定', '検証と投稿'],
    },
  },
  ko: {
    menu: {
      app: {
        about: "{app} 정보",
        checkUpdate: "업데이트 확인...",
        services: "서비스",
        hide: "{app} 숨기기",
        hideOthers: "기타 숨기기",
        unhide: "모두 표시",
        quit: "{app} 종료",
      },
      edit: {
        label: "편집",
        undo: "실행 취소",
        redo: "다시 실행",
        cut: "잘라내기",
        copy: "복사",
        paste: "붙여넣기",
        selectAll: "모두 선택",
      },
      view: {
        label: "보기",
        reload: "새로고침",
        forceReload: "강제 새로고침",
        toggleDevTools: "개발자 도구",
        resetZoom: "실제 크기",
        zoomIn: "확대",
        zoomOut: "축소",
        toggleFullscreen: "전체 화면",
      },
      window: {
        label: "창",
        minimize: "최소화",
        zoom: "확대",
        front: "모두 앞으로 가져오기",
        close: "창 닫기",
      },
      language: {
        label: "언어 (Language)",
      },
      help: {
        label: "도움말",
        checkUpdate: "업데이트 확인...",
        officialSite: "공식 웹사이트",
        syslogs: "시스템 로그",
        render: "동영상 렌더링",
        about: "ShortVideo 정보",
      },
    },
    dialogs: {
      newVersionTitle: "새 버전 사용 가능: {version}",
      newVersionMsg: "ShortVideo의 새 버전을 사용할 수 있습니다",
      linuxManualDetail: "새 버전 {version}이 준비되었습니다. 공식 사이트에서 설치 패키지를 다운로드해 주세요.",
      btnGoWebsite: "공식 사이트 방문",
      btnRemindLater: "나중에 알림",
      checkUpdateTitle: "업데이트 확인",
      alreadyLatestMsg: "최신 버전입니다",
      alreadyLatestDetail: "현재 ShortVideo (v{version}) 최신 버전을 사용 중입니다.",
      btnOk: "확인",
      btnCancel: "취소",
      updateFailedTitle: "확인 실패",
      updateFailedMsg: "업데이트 정보를 가져올 수 없습니다",
      updateFailedDetail: "네트워크 연결을 확인한 후 다시 시도해 주세요.",
      devModeTitle: "개발자 모드",
      devModeMsg: "개발자 모드로 실행 중입니다",
      devModeDetail: "개발 환경에서는 자동 업데이트가 비활성화됩니다.",
      exportLogsTitle: "시스템 로그 내보내기",
      logFileFilter: "로그 파일 (*.log)",
      selectProjectDirTitle: "프로젝트 디렉터리 선택",
      projectDirNotFound: "지정된 디렉터리를 찾을 수 없습니다",
    },
    notifications: {
      updateDownloadedTitle: "업데이트 v{version} 다운로드 완료",
      updateDownloadedBody: "새 버전이 준비되었습니다. 앱을 재시작하여 업데이트를 적용하세요.",
      startPublishTitle: "동영상 발행 시작",
      startPublishBody: "【{platform}】에 동영상을 자동 발행 중입니다. 약 1-3분 소요됩니다...",
      scheduleSuccessTitle: "예약 발행 성공",
      scheduleSuccessBody: "【{platform}】{title} 게시가 성공적으로 완료되었습니다!",
      scheduleFailedTitle: "예약 발행 실패",
      scheduleFailedBody: "【{platform}】{title} 게시 실패: {error}",
      scheduleErrorTitle: "예약 발행 오류",
      scheduleErrorBody: "【{platform}】{title}: {error}",
      autoRetryTitle: "자동 재시도 발행",
      autoRetryBody: "이전에 게시되지 않은 동영상 {count}개를 감지하여 즉시 다시 예약했습니다!",
    },
    platforms: {
      wechat: "위챗 채널",
      wechatShort: "위챗",
      xiaohongshu: "샤오홍슈 크리에이터 플랫폼",
      xhsShort: "샤오홍슈",
      system: "시스템 로그",
    },
    steps: {
      wechat: ['페이지 준비', '동영상 업로드', '제목 입력', '설명 및 태그', '고급 설정', '변환 및 게시'],
      xiaohongshu: ['페이지 준비', '동영상 업로드', '노트 제목', '본문 및 태그', '고급 설정', '검증 및 게시'],
    },
  },
  vi: {
    menu: {
      app: {
        about: "Giới thiệu về {app}",
        checkUpdate: "Kiểm tra cập nhật...",
        services: "Dịch vụ",
        hide: "Ẩn {app}",
        hideOthers: "Ẩn các ứng dụng khác",
        unhide: "Hiện tất cả",
        quit: "Thoát {app}",
      },
      edit: {
        label: "Chỉnh sửa",
        undo: "Hoàn tác",
        redo: "Làm lại",
        cut: "Cắt",
        copy: "Sao chép",
        paste: "Dán",
        selectAll: "Chọn tất cả",
      },
      view: {
        label: "Xem",
        reload: "Tải lại",
        forceReload: "Tải lại bắt buộc",
        toggleDevTools: "Công cụ phát triển",
        resetZoom: "Kích thước gốc",
        zoomIn: "Phóng to",
        zoomOut: "Thu nhỏ",
        toggleFullscreen: "Toàn màn hình",
      },
      window: {
        label: "Cửa sổ",
        minimize: "Thu nhỏ",
        zoom: "Thu phóng",
        front: "Đưa lên đầu",
        close: "Đóng cửa sổ",
      },
      language: {
        label: "Ngôn ngữ (Language)",
      },
      help: {
        label: "Trợ giúp",
        checkUpdate: "Kiểm tra cập nhật...",
        officialSite: "Trang web chính thức",
        syslogs: "Nhật ký hệ thống",
        render: "Xuất video",
        about: "Thông tin ShortVideo",
      },
    },
    dialogs: {
      newVersionTitle: "Đã có phiên bản mới: {version}",
      newVersionMsg: "Đã có bản cập nhật mới cho ShortVideo",
      linuxManualDetail: "Phiên bản {version} đã sẵn sàng. Vui lòng tải gói cài đặt từ trang web chính thức.",
      btnGoWebsite: "Đến trang web",
      btnRemindLater: "Nhắc lại sau",
      checkUpdateTitle: "Kiểm tra cập nhật",
      alreadyLatestMsg: "Đang là phiên bản mới nhất",
      alreadyLatestDetail: "Bạn đang sử dụng ShortVideo (v{version}) mới nhất.",
      btnOk: "OK",
      btnCancel: "Hủy",
      updateFailedTitle: "Kiểm tra thất bại",
      updateFailedMsg: "Không thể lấy thông tin cập nhật",
      updateFailedDetail: "Vui lòng kiểm tra kết nối mạng và thử lại sau.",
      devModeTitle: "Chế độ phát triển",
      devModeMsg: "Đang chạy trong môi trường phát triển",
      devModeDetail: "Cập nhật tự động tắt trong chế độ phát triển.",
      exportLogsTitle: "Xuất nhật ký hệ thống",
      logFileFilter: "Tệp nhật ký (*.log)",
      selectProjectDirTitle: "Chọn thư mục mã nguồn ShortVideo",
      projectDirNotFound: "Không tìm thấy thư mục được chỉ định",
    },
    notifications: {
      updateDownloadedTitle: "Đã tải xong bản cập nhật v{version}",
      updateDownloadedBody: "Phiên bản mới đã sẵn sàng. Khởi động lại ứng dụng để hoàn tất cập nhật.",
      startPublishTitle: "Bắt đầu đăng video",
      startPublishBody: "Đang tự động đăng video lên 【{platform}】, dự kiến mất 1-3 phút...",
      scheduleSuccessTitle: "Đăng định kỳ thành công",
      scheduleSuccessBody: "【{platform}】{title} đã được đăng thành công!",
      scheduleFailedTitle: "Đăng định kỳ thất bại",
      scheduleFailedBody: "【{platform}】{title} không thể đăng: {error}",
      scheduleErrorTitle: "Lỗi đăng định kỳ",
      scheduleErrorBody: "【{platform}】{title}: {error}",
      autoRetryTitle: "Tự động thử lại đăng bài",
      autoRetryBody: "Đã phát hiện {count} video chưa đăng thành công, đã tự động lên lịch đăng lại ngay!",
    },
    platforms: {
      wechat: "WeChat Channels",
      wechatShort: "WeChat",
      xiaohongshu: "Nền tảng sáng tạo Xiaohongshu",
      xhsShort: "Xiaohongshu",
      system: "Nhật ký hệ thống",
    },
    steps: {
      wechat: ['Trang sẵn sàng', 'Tải video lên', 'Tiêu đề ngắn', 'Mô tả & Thẻ', 'Cài đặt nâng cao', 'Chuyển mã & Đăng'],
      xiaohongshu: ['Trang sẵn sàng', 'Tải video lên', 'Tiêu đề bài viết', 'Nội dung & Thẻ', 'Cài đặt nâng cao', 'Xác thực & Đăng'],
    },
  },
  th: {
    menu: {
      app: {
        about: "เกี่ยวกับ {app}",
        checkUpdate: "ตรวจสอบการอัปเดต...",
        services: "บริการ",
        hide: "ซ่อน {app}",
        hideOthers: "ซ่อนรายการอื่น",
        unhide: "แสดงทั้งหมด",
        quit: "ออกจาก {app}",
      },
      edit: {
        label: "แก้ไข",
        undo: "เลิกทำ",
        redo: "ทำซ้ำ",
        cut: "ตัด",
        copy: "คัดลอก",
        paste: "วาง",
        selectAll: "เลือกทั้งหมด",
      },
      view: {
        label: "มุมมอง",
        reload: "โหลดใหม่",
        forceReload: "บังคับโหลดใหม่",
        toggleDevTools: "เครื่องมือนักพัฒนา",
        resetZoom: "ขนาดจริง",
        zoomIn: "ขยาย",
        zoomOut: "ย่อ",
        toggleFullscreen: "เต็มหน้าจอ",
      },
      window: {
        label: "หน้าต่าง",
        minimize: "ย่อเล็กสุด",
        zoom: "ขยาย",
        front: "นำทั้งหมดมาไว้ข้างหน้า",
        close: "ปิดหน้าต่าง",
      },
      language: {
        label: "ภาษา (Language)",
      },
      help: {
        label: "ความช่วยเหลือ",
        checkUpdate: "ตรวจสอบการอัปเดต...",
        officialSite: "เว็บไซต์อย่างเป็นทางการ",
        syslogs: "บันทึกระบบ",
        render: "เรนเดอร์วิดีโอ",
        about: "เกี่ยวกับ ShortVideo",
      },
    },
    dialogs: {
      newVersionTitle: "มีเวอร์ชันใหม่: {version}",
      newVersionMsg: "มี ShortVideo เวอร์ชันใหม่พร้อมใช้งาน",
      linuxManualDetail: "เวอร์ชัน {version} พร้อมใช้งานแล้ว กรุณาดาวน์โหลดแพ็กเกจติดตั้งจากเว็บไซต์",
      btnGoWebsite: "ไปยังเว็บไซต์",
      btnRemindLater: "เตือนฉันภายหลัง",
      checkUpdateTitle: "ตรวจสอบการอัปเดต",
      alreadyLatestMsg: "เป็นเวอร์ชันล่าสุดแล้ว",
      alreadyLatestDetail: "คุณกำลังใช้ ShortVideo (v{version}) เวอร์ชันล่าสุดแล้ว",
      btnOk: "ตกลง",
      btnCancel: "ยกเลิก",
      updateFailedTitle: "ตรวจสอบไม่สำเร็จ",
      updateFailedMsg: "ไม่สามารถรับข้อมูลการอัปเดตได้",
      updateFailedDetail: "กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่อีกครั้ง",
      devModeTitle: "โหมดนักพัฒนา",
      devModeMsg: "กำลังทำงานในโหมดนักพัฒนา",
      devModeDetail: "ปิดใช้งานการอัปเดตอัตโนมัติในโหมดนักพัฒนา",
      exportLogsTitle: "ส่งออกบันทึกระบบ",
      logFileFilter: "ไฟล์บันทึก (*.log)",
      selectProjectDirTitle: "เลือกไดเรกทอรีโครงการ ShortVideo",
      projectDirNotFound: "ไม่พบไดเรกทอรีที่ระบุ",
    },
    notifications: {
      updateDownloadedTitle: "ดาวน์โหลดอัปเดต v{version} แล้ว",
      updateDownloadedBody: "ดาวน์โหลดเวอร์ชันใหม่เรียบร้อยแล้ว รีสตาร์ตแอปเพื่ออัปเกรด",
      startPublishTitle: "เริ่มการเผยแพร่วิดีโอ",
      startPublishBody: "กำลังเผยแพร่วิดีโอไปยัง 【{platform}】 โดยอัตโนมัติ ใช้เวลาประมาณ 1-3 นาที...",
      scheduleSuccessTitle: "เผยแพร่วิดีโอตามกำหนดการสำเร็จ",
      scheduleSuccessBody: "【{platform}】{title} เผยแพร่เรียบร้อยแล้ว!",
      scheduleFailedTitle: "เผยแพร่วิดีโอตามกำหนดการไม่สำเร็จ",
      scheduleFailedBody: "【{platform}】{title} เผยแพร่ไม่สำเร็จ: {error}",
      scheduleErrorTitle: "ข้อผิดพลาดการเผยแพร่ตามกำหนดการ",
      scheduleErrorBody: "【{platform}】{title}: {error}",
      autoRetryTitle: "ลองเผยแพร่อัตโนมัติอีกครั้ง",
      autoRetryBody: "ตรวจพบวิดีโอที่ยังไม่เผยแพร่ {count} รายการ ได้จัดกำหนดการใหม่ทันที!",
    },
    platforms: {
      wechat: "WeChat Channels",
      wechatShort: "WeChat",
      xiaohongshu: "แพลตฟอร์มผู้สร้างเสี่ยวหงซู",
      xhsShort: "เสี่ยวหงซู",
      system: "บันทึกระบบ",
    },
    steps: {
      wechat: ['หน้าพร้อมใช้งาน', 'อัปโหลดวิดีโอ', 'ระบุชื่อเรื่อง', 'คำอธิบายและแท็ก', 'การตั้งค่าขั้นสูง', 'แปลงรหัสและเผยแพร่'],
      xiaohongshu: ['หน้าพร้อมใช้งาน', 'อัปโหลดวิดีโอ', 'ชื่อโน้ต', 'เนื้อหาและแท็ก', 'การตั้งค่าขั้นสูง', 'ตรวจสอบและเผยแพร่'],
    },
  },
  id: {
    menu: {
      app: {
        about: "Tentang {app}",
        checkUpdate: "Periksa Pembaruan...",
        services: "Layanan",
        hide: "Sembunyikan {app}",
        hideOthers: "Sembunyikan Lainnya",
        unhide: "Tampilkan Semua",
        quit: "Keluar {app}",
      },
      edit: {
        label: "Edit",
        undo: "Urungkan",
        redo: "Ulangi",
        cut: "Potong",
        copy: "Salin",
        paste: "Tempel",
        selectAll: "Pilih Semua",
      },
      view: {
        label: "Tampilan",
        reload: "Muat Ulang",
        forceReload: "Muat Ulang Paksa",
        toggleDevTools: "Alat Pengembang",
        resetZoom: "Ukuran Sebenarnya",
        zoomIn: "Perbesar",
        zoomOut: "Perkecil",
        toggleFullscreen: "Layar Penuh",
      },
      window: {
        label: "Jendela",
        minimize: "Minimalkan",
        zoom: "Perbesar",
        front: "Bawa Semua ke Depan",
        close: "Tutup Jendela",
      },
      language: {
        label: "Bahasa (Language)",
      },
      help: {
        label: "Bantuan",
        checkUpdate: "Periksa Pembaruan...",
        officialSite: "Situs Resmi",
        syslogs: "Log Sistem",
        render: "Rendering Video",
        about: "Tentang ShortVideo",
      },
    },
    dialogs: {
      newVersionTitle: "Versi Baru Tersedia: {version}",
      newVersionMsg: "Versi baru ShortVideo telah tersedia",
      linuxManualDetail: "Versi {version} telah tersedia. Silakan unduh paket penginstal dari situs web resmi.",
      btnGoWebsite: "Kunjungi Situs Web",
      btnRemindLater: "Ingatkan Nanti",
      checkUpdateTitle: "Periksa Pembaruan",
      alreadyLatestMsg: "Anda sudah menggunakan versi terbaru",
      alreadyLatestDetail: "ShortVideo v{version} saat ini adalah versi terbaru.",
      btnOk: "OK",
      btnCancel: "Batal",
      updateFailedTitle: "Gagal Memeriksa Pembaruan",
      updateFailedMsg: "Tidak dapat memperoleh informasi pembaruan",
      updateFailedDetail: "Silakan periksa koneksi internet Anda dan coba lagi.",
      devModeTitle: "Mode Pengembang",
      devModeMsg: "Berjalan dalam mode pengembang",
      devModeDetail: "Pembaruan otomatis dinonaktifkan dalam mode pengembang.",
      exportLogsTitle: "Ekspor Log Sistem",
      logFileFilter: "Berkas Log (*.log)",
      selectProjectDirTitle: "Pilih Direktori Sumber ShortVideo",
      projectDirNotFound: "Direktori tidak ditemukan",
    },
    notifications: {
      updateDownloadedTitle: "Pembaruan v{version} Telah Diunduh",
      updateDownloadedBody: "Versi baru siap dipasang. Mulai ulang aplikasi untuk menerapkan.",
      startPublishTitle: "Publikasi Video Dimulai",
      startPublishBody: "Mempublikasikan video ke 【{platform}】 secara otomatis, perkiraan 1-3 menit...",
      scheduleSuccessTitle: "Publikasi Terjadwal Berhasil",
      scheduleSuccessBody: "【{platform}】{title} telah berhasil dipublikasikan!",
      scheduleFailedTitle: "Publikasi Terjadwal Gagal",
      scheduleFailedBody: "【{platform}】{title} gagal dipublikasikan: {error}",
      scheduleErrorTitle: "Kesalahan Publikasi Terjadwal",
      scheduleErrorBody: "【{platform}】{title}: {error}",
      autoRetryTitle: "Coba Lagi Publikasi Otomatis",
      autoRetryBody: "Terdeteksi {count} video yang belum dipublikasikan, telah dijadwalkan ulang sekarang!",
    },
    platforms: {
      wechat: "WeChat Channels",
      wechatShort: "WeChat",
      xiaohongshu: "Platform Kreator Xiaohongshu",
      xhsShort: "Xiaohongshu",
      system: "Log Sistem",
    },
    steps: {
      wechat: ['Halaman Siap', 'Unggah Video', 'Judul Singkat', 'Deskripsi & Tag', 'Pengaturan Lanjutan', 'Transkode & Publikasikan'],
      xiaohongshu: ['Halaman Siap', 'Unggah Video', 'Judul Catatan', 'Konten & Tag', 'Pengaturan Lanjutan', 'Verifikasi & Publikasikan'],
    },
  },
  es: {
    menu: {
      app: {
        about: "Acerca de {app}",
        checkUpdate: "Buscar actualizaciones...",
        services: "Servicios",
        hide: "Ocultar {app}",
        hideOthers: "Ocultar otros",
        unhide: "Mostrar todo",
        quit: "Salir de {app}",
      },
      edit: {
        label: "Edición",
        undo: "Deshacer",
        redo: "Rehacer",
        cut: "Cortar",
        copy: "Copiar",
        paste: "Pegar",
        selectAll: "Seleccionar todo",
      },
      view: {
        label: "Ver",
        reload: "Recargar",
        forceReload: "Forzar recarga",
        toggleDevTools: "Herramientas de desarrollo",
        resetZoom: "Tamaño real",
        zoomIn: "Acercar",
        zoomOut: "Alejar",
        toggleFullscreen: "Pantalla completa",
      },
      window: {
        label: "Ventana",
        minimize: "Minimizar",
        zoom: "Zoom",
        front: "Traer todo al frente",
        close: "Cerrar ventana",
      },
      language: {
        label: "Idioma (Language)",
      },
      help: {
        label: "Ayuda",
        checkUpdate: "Buscar actualizaciones...",
        officialSite: "Sitio web oficial",
        syslogs: "Registros del sistema",
        render: "Renderizado de video",
        about: "Acerca de ShortVideo",
      },
    },
    dialogs: {
      newVersionTitle: "Nueva versión disponible: {version}",
      newVersionMsg: "Una nueva versión de ShortVideo está disponible",
      linuxManualDetail: "La versión {version} está lista. Descargue el instalador desde el sitio oficial.",
      btnGoWebsite: "Ir al sitio web",
      btnRemindLater: "Recordar más tarde",
      checkUpdateTitle: "Buscar actualizaciones",
      alreadyLatestMsg: "Tiene la versión más reciente",
      alreadyLatestDetail: "ShortVideo v{version} es la versión más actual.",
      btnOk: "Aceptar",
      btnCancel: "Cancelar",
      updateFailedTitle: "Error al buscar actualización",
      updateFailedMsg: "No se pudo obtener información de actualización",
      updateFailedDetail: "Compruebe su conexión a internet e inténtelo de nuevo.",
      devModeTitle: "Modo desarrollador",
      devModeMsg: "Ejecutándose en modo de desarrollo",
      devModeDetail: "Las actualizaciones automáticas están desactivadas en modo desarrollador.",
      exportLogsTitle: "Exportar registros del sistema",
      logFileFilter: "Archivos de registro (*.log)",
      selectProjectDirTitle: "Seleccionar directorio de origen del proyecto",
      projectDirNotFound: "Directorio no encontrado",
    },
    notifications: {
      updateDownloadedTitle: "Actualización v{version} descargada",
      updateDownloadedBody: "La nueva versión está lista. Reinicie la aplicación para actualizar.",
      startPublishTitle: "Publicación de video iniciada",
      startPublishBody: "Publicando video automáticamente en 【{platform}】, estimado 1-3 minutos...",
      scheduleSuccessTitle: "Publicación programada exitosa",
      scheduleSuccessBody: "¡【{platform}】{title} se publicó con éxito!",
      scheduleFailedTitle: "Publicación programada fallida",
      scheduleFailedBody: "【{platform}】{title} no se pudo publicar: {error}",
      scheduleErrorTitle: "Error en publicación programada",
      scheduleErrorBody: "【{platform}】{title}: {error}",
      autoRetryTitle: "Reintentar publicación automática",
      autoRetryBody: "¡Se detectaron {count} videos no publicados, reprogramados ahora!",
    },
    platforms: {
      wechat: "WeChat Channels",
      wechatShort: "WeChat",
      xiaohongshu: "Plataforma Xiaohongshu",
      xhsShort: "Xiaohongshu",
      system: "Registros",
    },
    steps: {
      wechat: ['Página lista', 'Subir video', 'Título corto', 'Descripción y etiquetas', 'Configuración avanzada', 'Transcodificar y publicar'],
      xiaohongshu: ['Página lista', 'Subir video', 'Título de nota', 'Contenido y etiquetas', 'Configuración avanzada', 'Verificar y publicar'],
    },
  },
  fr: {
    menu: {
      app: {
        about: "À propos de {app}",
        checkUpdate: "Rechercher des mises à jour...",
        services: "Services",
        hide: "Masquer {app}",
        hideOthers: "Masquer les autres",
        unhide: "Tout afficher",
        quit: "Quitter {app}",
      },
      edit: {
        label: "Édition",
        undo: "Annuler",
        redo: "Rétablir",
        cut: "Couper",
        copy: "Copier",
        paste: "Coller",
        selectAll: "Tout sélectionner",
      },
      view: {
        label: "Présentation",
        reload: "Recharger",
        forceReload: "Forcer le rechargement",
        toggleDevTools: "Outils de développement",
        resetZoom: "Taille réelle",
        zoomIn: "Zoom avant",
        zoomOut: "Zoom arrière",
        toggleFullscreen: "Plein écran",
      },
      window: {
        label: "Fenêtre",
        minimize: "Réduire",
        zoom: "Agrandir",
        front: "Tout ramener au premier plan",
        close: "Fermer la fenêtre",
      },
      language: {
        label: "Langue (Language)",
      },
      help: {
        label: "Aide",
        checkUpdate: "Vérifier les mises à jour...",
        officialSite: "Site officiel",
        syslogs: "Journaux système",
        render: "Rendu vidéo",
        about: "À propos de ShortVideo",
      },
    },
    dialogs: {
      newVersionTitle: "Nouvelle version disponible : {version}",
      newVersionMsg: "Une nouvelle version de ShortVideo est disponible",
      linuxManualDetail: "La version {version} est prête. Téléchargez le paquet sur le site officiel.",
      btnGoWebsite: "Visiter le site",
      btnRemindLater: "Me le rappeler plus tard",
      checkUpdateTitle: "Vérifier les mises à jour",
      alreadyLatestMsg: "Vous êtes à jour",
      alreadyLatestDetail: "ShortVideo v{version} est la version la plus récente.",
      btnOk: "OK",
      btnCancel: "Annuler",
      updateFailedTitle: "Échec de la recherche",
      updateFailedMsg: "Impossible de vérifier les mises à jour",
      updateFailedDetail: "Veuillez vérifier votre connexion internet et réessayer.",
      devModeTitle: "Mode développement",
      devModeMsg: "Exécution en mode développement",
      devModeDetail: "La mise à jour automatique est désactivée en mode développement.",
      exportLogsTitle: "Exporter les journaux système",
      logFileFilter: "Fichiers journaux (*.log)",
      selectProjectDirTitle: "Sélectionner le répertoire du projet",
      projectDirNotFound: "Répertoire introuvable",
    },
    notifications: {
      updateDownloadedTitle: "Mise à jour v{version} téléchargée",
      updateDownloadedBody: "La nouvelle version est prête. Redémarrez l'application pour l'appliquer.",
      startPublishTitle: "Publication vidéo démarrée",
      startPublishBody: "Publication automatique sur 【{platform}】, environ 1 à 3 minutes...",
      scheduleSuccessTitle: "Publication programmée réussie",
      scheduleSuccessBody: "【{platform}】{title} a été publié avec succès !",
      scheduleFailedTitle: "Échec de publication programmée",
      scheduleFailedBody: "【{platform}】{title} n'a pas pu être publié : {error}",
      scheduleErrorTitle: "Erreur de publication programmée",
      scheduleErrorBody: "【{platform}】{title} : {error}",
      autoRetryTitle: "Nouvelle tentative automatique",
      autoRetryBody: "{count} vidéos non publiées détectées, reprogrammées maintenant !",
    },
    platforms: {
      wechat: "WeChat Channels",
      wechatShort: "WeChat",
      xiaohongshu: "Plateforme Xiaohongshu",
      xhsShort: "Xiaohongshu",
      system: "Journaux",
    },
    steps: {
      wechat: ['Page prête', 'Téléverser vidéo', 'Titre court', 'Description & Tags', 'Paramètres avancés', 'Transcoder & Publier'],
      xiaohongshu: ['Page prête', 'Téléverser vidéo', 'Titre de note', 'Contenu & Tags', 'Paramètres avancés', 'Vérifier & Publier'],
    },
  },
  pt: {
    menu: {
      app: {
        about: "Sobre o {app}",
        checkUpdate: "Verificar atualizações...",
        services: "Serviços",
        hide: "Ocultar {app}",
        hideOthers: "Ocultar outros",
        unhide: "Mostrar tudo",
        quit: "Encerrar {app}",
      },
      edit: {
        label: "Editar",
        undo: "Desfazer",
        redo: "Refazer",
        cut: "Cortar",
        copy: "Copiar",
        paste: "Colar",
        selectAll: "Selecionar tudo",
      },
      view: {
        label: "Visualizar",
        reload: "Recarregar",
        forceReload: "Forçar recarga",
        toggleDevTools: "Ferramentas de desenvolvedor",
        resetZoom: "Tamanho real",
        zoomIn: "Ampliar",
        zoomOut: "Reduzir",
        toggleFullscreen: "Tela cheia",
      },
      window: {
        label: "Janela",
        minimize: "Minimizar",
        zoom: "Zoom",
        front: "Trazer tudo para a frente",
        close: "Fechar janela",
      },
      language: {
        label: "Idioma (Language)",
      },
      help: {
        label: "Ajuda",
        checkUpdate: "Verificar atualizações...",
        officialSite: "Site oficial",
        syslogs: "Registros do sistema",
        render: "Renderização de vídeo",
        about: "Sobre o ShortVideo",
      },
    },
    dialogs: {
      newVersionTitle: "Nova versão disponível: {version}",
      newVersionMsg: "Uma nova versão do ShortVideo está disponível",
      linuxManualDetail: "A versão {version} está pronta. Baixe o instalador no site oficial.",
      btnGoWebsite: "Ir para o site",
      btnRemindLater: "Lembrar mais tarde",
      checkUpdateTitle: "Verificar atualizações",
      alreadyLatestMsg: "Você está atualizado",
      alreadyLatestDetail: "ShortVideo v{version} é a versão mais recente.",
      btnOk: "OK",
      btnCancel: "Cancelar",
      updateFailedTitle: "Falha na verificação",
      updateFailedMsg: "Não foi possível obter informações de atualização",
      updateFailedDetail: "Verifique sua conexão e tente novamente.",
      devModeTitle: "Modo desenvolvedor",
      devModeMsg: "Executando em modo de desenvolvimento",
      devModeDetail: "Atualizações automáticas desativadas no modo desenvolvedor.",
      exportLogsTitle: "Exportar registros do sistema",
      logFileFilter: "Arquivos de registro (*.log)",
      selectProjectDirTitle: "Selecionar diretório do projeto",
      projectDirNotFound: "Diretório não encontrado",
    },
    notifications: {
      updateDownloadedTitle: "Atualização v{version} baixada",
      updateDownloadedBody: "Nova versão pronta. Reinicie o aplicativo para concluir.",
      startPublishTitle: "Publicação de vídeo iniciada",
      startPublishBody: "Publicando vídeo automaticamente no 【{platform}】, cerca de 1 a 3 minutos...",
      scheduleSuccessTitle: "Publicação agendada com sucesso",
      scheduleSuccessBody: "【{platform}】{title} foi publicado com sucesso!",
      scheduleFailedTitle: "Falha na publicação agendada",
      scheduleFailedBody: "【{platform}】{title} não pôde ser publicado: {error}",
      scheduleErrorTitle: "Erro na publicação agendada",
      scheduleErrorBody: "【{platform}】{title}: {error}",
      autoRetryTitle: "Tentar novamente automaticamente",
      autoRetryBody: "{count} vídeos não publicados detectados, reagendados agora!",
    },
    platforms: {
      wechat: "WeChat Channels",
      wechatShort: "WeChat",
      xiaohongshu: "Plataforma Xiaohongshu",
      xhsShort: "Xiaohongshu",
      system: "Registros",
    },
    steps: {
      wechat: ['Página pronta', 'Enviar vídeo', 'Título curto', 'Descrição e tags', 'Configurações avançadas', 'Transcodificar e publicar'],
      xiaohongshu: ['Página pronta', 'Enviar vídeo', 'Título da nota', 'Conteúdo e tags', 'Configurações avançadas', 'Verificar e publicar'],
    },
  },
  de: {
    menu: {
      app: {
        about: "Über {app}",
        checkUpdate: "Nach Updates suchen...",
        services: "Dienste",
        hide: "{app} ausblenden",
        hideOthers: "Andere ausblenden",
        unhide: "Alle anzeigen",
        quit: "{app} beenden",
      },
      edit: {
        label: "Bearbeiten",
        undo: "Rückgängig",
        redo: "Wiederholen",
        cut: "Ausschneiden",
        copy: "Kopieren",
        paste: "Einfügen",
        selectAll: "Alles auswählen",
      },
      view: {
        label: "Ansicht",
        reload: "Neu laden",
        forceReload: "Vollständig neu laden",
        toggleDevTools: "Entwicklertools umschalten",
        resetZoom: "Originalgröße",
        zoomIn: "Vergrößern",
        zoomOut: "Verkleinern",
        toggleFullscreen: "Vollbildmodus",
      },
      window: {
        label: "Fenster",
        minimize: "Minimieren",
        zoom: "Zoomen",
        front: "Alle nach vorne bringen",
        close: "Fenster schließen",
      },
      language: {
        label: "Sprache (Language)",
      },
      help: {
        label: "Hilfe",
        checkUpdate: "Nach Updates suchen...",
        officialSite: "Offizielle Website",
        syslogs: "Systemprotokolle",
        render: "Videorendering",
        about: "Über ShortVideo",
      },
    },
    dialogs: {
      newVersionTitle: "Neues Update verfügbar: {version}",
      newVersionMsg: "Eine neue Version von ShortVideo ist verfügbar",
      linuxManualDetail: "Version {version} ist verfügbar. Bitte laden Sie das Installationspaket von der offiziellen Website herunter.",
      btnGoWebsite: "Zur Website",
      btnRemindLater: "Später erinnern",
      checkUpdateTitle: "Nach Updates suchen",
      alreadyLatestMsg: "Sie sind auf dem neuesten Stand",
      alreadyLatestDetail: "ShortVideo v{version} ist die aktuellste Version.",
      btnOk: "OK",
      btnCancel: "Abbrechen",
      updateFailedTitle: "Update-Prüfung fehlgeschlagen",
      updateFailedMsg: "Update-Informationen konnten nicht abgerufen werden",
      updateFailedDetail: "Bitte überprüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.",
      devModeTitle: "Entwicklermodus",
      devModeMsg: "Wird im Entwicklermodus ausgeführt",
      devModeDetail: "Automatische Updates sind im Entwicklermodus deaktiviert.",
      exportLogsTitle: "Systemprotokolle exportieren",
      logFileFilter: "Protokolldateien (*.log)",
      selectProjectDirTitle: "Projektquellverzeichnis auswählen",
      projectDirNotFound: "Verzeichnis nicht gefunden",
    },
    notifications: {
      updateDownloadedTitle: "Update v{version} heruntergeladen",
      updateDownloadedBody: "Die neue Version ist bereit. Starten Sie die App neu, um das Update anzuwenden.",
      startPublishTitle: "Videoveröffentlichung gestartet",
      startPublishBody: "Automatisches Veröffentlichen auf 【{platform}】, ca. 1-3 Minuten...",
      scheduleSuccessTitle: "Geplante Veröffentlichung erfolgreich",
      scheduleSuccessBody: "【{platform}】{title} wurde erfolgreich veröffentlicht!",
      scheduleFailedTitle: "Geplante Veröffentlichung fehlgeschlagen",
      scheduleFailedBody: "【{platform}】{title} konnte nicht veröffentlicht werden: {error}",
      scheduleErrorTitle: "Fehler bei geplanter Veröffentlichung",
      scheduleErrorBody: "【{platform}】{title}: {error}",
      autoRetryTitle: "Automatische Wiederholung",
      autoRetryBody: "{count} unveröffentlichte Videos erkannt, jetzt neu geplant!",
    },
    platforms: {
      wechat: "WeChat Channels",
      wechatShort: "WeChat",
      xiaohongshu: "Xiaohongshu Plattform",
      xhsShort: "Xiaohongshu",
      system: "Systemprotokolle",
    },
    steps: {
      wechat: ['Seite bereit', 'Video hochladen', 'Kurzer Titel', 'Beschreibung & Tags', 'Erweiterte Einstellungen', 'Transkodieren & Veröffentlichen'],
      xiaohongshu: ['Seite bereit', 'Video hochladen', 'Beitragstitel', 'Inhalt & Tags', 'Erweiterte Einstellungen', 'Prüfen & Veröffentlichen'],
    },
  },
  it: {
    menu: {
      app: {
        about: "Informazioni su {app}",
        checkUpdate: "Controlla aggiornamenti...",
        services: "Servizi",
        hide: "Nascondi {app}",
        hideOthers: "Nascondi altre",
        unhide: "Mostra tutte",
        quit: "Esci da {app}",
      },
      edit: {
        label: "Modifica",
        undo: "Annulla",
        redo: "Ripeti",
        cut: "Taglia",
        copy: "Copia",
        paste: "Incolla",
        selectAll: "Seleziona tutto",
      },
      view: {
        label: "Visualizza",
        reload: "Ricarica",
        forceReload: "Forza ricarica",
        toggleDevTools: "Strumenti di sviluppo",
        resetZoom: "Dimensioni reali",
        zoomIn: "Ingrandisci",
        zoomOut: "Riduci",
        toggleFullscreen: "Schermo intero",
      },
      window: {
        label: "Finestra",
        minimize: "Riduci a icona",
        zoom: "Ridimensiona",
        front: "Porta tutto in primo piano",
        close: "Chiudi finestra",
      },
      language: {
        label: "Lingua (Language)",
      },
      help: {
        label: "Aiuto",
        checkUpdate: "Controlla aggiornamenti...",
        officialSite: "Sito ufficiale",
        syslogs: "Registri di sistema",
        render: "Rendering video",
        about: "Informazioni su ShortVideo",
      },
    },
    dialogs: {
      newVersionTitle: "Nuova versione disponibile: {version}",
      newVersionMsg: "È disponibile una nuova versione di ShortVideo",
      linuxManualDetail: "La versione {version} è pronta. Scarica il pacchetto dal sito ufficiale.",
      btnGoWebsite: "Visita il sito",
      btnRemindLater: "Ricordamelo più tardi",
      checkUpdateTitle: "Controlla aggiornamenti",
      alreadyLatestMsg: "Sei aggiornato",
      alreadyLatestDetail: "ShortVideo v{version} è l'ultima versione disponibile.",
      btnOk: "OK",
      btnCancel: "Annulla",
      updateFailedTitle: "Controllo fallito",
      updateFailedMsg: "Impossibile recuperare informazioni sull'aggiornamento",
      updateFailedDetail: "Verifica la connessione internet e riprova.",
      devModeTitle: "Modalità sviluppatore",
      devModeMsg: "Esecuzione in modalità sviluppatore",
      devModeDetail: "Gli aggiornamenti automatici sono disabilitati.",
      exportLogsTitle: "Esporta registri di sistema",
      logFileFilter: "File di registro (*.log)",
      selectProjectDirTitle: "Seleziona la directory del progetto",
      projectDirNotFound: "Directory non trovata",
    },
    notifications: {
      updateDownloadedTitle: "Aggiornamento v{version} scaricato",
      updateDownloadedBody: "Nuova versione pronta. Riavvia l'applicazione per applicarla.",
      startPublishTitle: "Pubblicazione video avviata",
      startPublishBody: "Pubblicazione automatica su 【{platform}】, tempo previsto 1-3 minuti...",
      scheduleSuccessTitle: "Pubblicazione programmata completata",
      scheduleSuccessBody: "【{platform}】{title} è stato pubblicato con successo!",
      scheduleFailedTitle: "Pubblicazione programmata non riuscita",
      scheduleFailedBody: "【{platform}】{title} non è stato pubblicato: {error}",
      scheduleErrorTitle: "Errore pubblicazione programmata",
      scheduleErrorBody: "【{platform}】{title}: {error}",
      autoRetryTitle: "Nuovo tentativo automatico",
      autoRetryBody: "{count} video non pubblicati rilevati, ripianificati ora!",
    },
    platforms: {
      wechat: "WeChat Channels",
      wechatShort: "WeChat",
      xiaohongshu: "Piattaforma Xiaohongshu",
      xhsShort: "Xiaohongshu",
      system: "Registri",
    },
    steps: {
      wechat: ['Pagina pronta', 'Carica video', 'Titolo breve', 'Descrizione e tag', 'Impostazioni avanzate', 'Transcodifica e pubblica'],
      xiaohongshu: ['Pagina pronta', 'Carica video', 'Titolo nota', 'Contenuto e tag', 'Impostazioni avanzate', 'Verifica e pubblica'],
    },
  },
  ru: {
    menu: {
      app: {
        about: "О программе {app}",
        checkUpdate: "Проверить обновления...",
        services: "Службы",
        hide: "Скрыть {app}",
        hideOthers: "Скрыть остальные",
        unhide: "Показать все",
        quit: "Завершить {app}",
      },
      edit: {
        label: "Правка",
        undo: "Отменить",
        redo: "Повторить",
        cut: "Вырезать",
        copy: "Копировать",
        paste: "Вставить",
        selectAll: "Выбрать все",
      },
      view: {
        label: "Вид",
        reload: "Перезагрузить",
        forceReload: "Принудительная перезагрузка",
        toggleDevTools: "Инструменты разработчика",
        resetZoom: "Исходный размер",
        zoomIn: "Увеличить",
        zoomOut: "Уменьшить",
        toggleFullscreen: "Полноэкранный режим",
      },
      window: {
        label: "Окно",
        minimize: "Свернуть",
        zoom: "Развернуть",
        front: "Все окна — на передний план",
        close: "Закрыть окно",
      },
      language: {
        label: "Язык (Language)",
      },
      help: {
        label: "Справка",
        checkUpdate: "Проверить обновления...",
        officialSite: "Официальный сайт",
        syslogs: "Системные журналы",
        render: "Рендеринг видео",
        about: "О программе ShortVideo",
      },
    },
    dialogs: {
      newVersionTitle: "Доступна новая версия: {version}",
      newVersionMsg: "Доступна новая версия ShortVideo",
      linuxManualDetail: "Версия {version} готова. Загрузите установочный пакет с официального сайта.",
      btnGoWebsite: "Перейти на сайт",
      btnRemindLater: "Напомнить позже",
      checkUpdateTitle: "Проверка обновлений",
      alreadyLatestMsg: "У вас установлена последняя версия",
      alreadyLatestDetail: "ShortVideo v{version} — самая актуальная версия.",
      btnOk: "ОК",
      btnCancel: "Отмена",
      updateFailedTitle: "Ошибка проверки",
      updateFailedMsg: "Не удалось получить информацию об обновлении",
      updateFailedDetail: "Проверьте подключение к интернету и повторите попытку.",
      devModeTitle: "Режим разработчика",
      devModeMsg: "Запущено в режиме разработки",
      devModeDetail: "Автоматическое обновление отключено в режиме разработки.",
      exportLogsTitle: "Экспорт системных журналов",
      logFileFilter: "Файлы журналов (*.log)",
      selectProjectDirTitle: "Выберите каталог проекта",
      projectDirNotFound: "Каталог не найден",
    },
    notifications: {
      updateDownloadedTitle: "Обновление v{version} загружено",
      updateDownloadedBody: "Новая версия готова. Перезапустите приложение для применения.",
      startPublishTitle: "Публикация видео запущена",
      startPublishBody: "Автоматическая публикация видео в 【{platform}】, примерно 1-3 минуты...",
      scheduleSuccessTitle: "Запланированная публикация выполнена",
      scheduleSuccessBody: "【{platform}】{title} успешно опубликовано!",
      scheduleFailedTitle: "Ошибка запланированной публикации",
      scheduleFailedBody: "【{platform}】{title} не удалось опубликовать: {error}",
      scheduleErrorTitle: "Сбой публикации по расписанию",
      scheduleErrorBody: "【{platform}】{title}: {error}",
      autoRetryTitle: "Автоматический повтор публикации",
      autoRetryBody: "Обнаружено {count} неопубликованных видео, перенаправлено на публикацию!",
    },
    platforms: {
      wechat: "WeChat Channels",
      wechatShort: "WeChat",
      xiaohongshu: "Платформа Xiaohongshu",
      xhsShort: "Xiaohongshu",
      system: "Системные журналы",
    },
    steps: {
      wechat: ['Страница готова', 'Загрузка видео', 'Короткий заголовок', 'Описание и теги', 'Расширенные настройки', 'Транскодирование и публикация'],
      xiaohongshu: ['Страница готова', 'Загрузка видео', 'Заголовок заметки', 'Текст и теги', 'Расширенные настройки', 'Проверка и публикация'],
    },
  },
  tr: {
    menu: {
      app: {
        about: "{app} Hakkında",
        checkUpdate: "Güncellemeleri Denetle...",
        services: "Hizmetler",
        hide: "{app} Gizle",
        hideOthers: "Diğerlerini Gizle",
        unhide: "Tümünü Göster",
        quit: "{app} Çıkış",
      },
      edit: {
        label: "Düzenle",
        undo: "Geri Al",
        redo: "Yinele",
        cut: "Kes",
        copy: "Kopyala",
        paste: "Yapıştır",
        selectAll: "Tümünü Seç",
      },
      view: {
        label: "Görünüm",
        reload: "Yeniden Yükle",
        forceReload: "Zorla Yeniden Yükle",
        toggleDevTools: "Geliştirici Araçları",
        resetZoom: "Gerçek Boyut",
        zoomIn: "Yakınlaştır",
        zoomOut: "Uzaklaştır",
        toggleFullscreen: "Tam Ekran",
      },
      window: {
        label: "Pencere",
        minimize: "Simge Durumuna Küçült",
        zoom: "Yakınlaştır",
        front: "Tümünü Öne Getir",
        close: "Pencereyi Kapat",
      },
      language: {
        label: "Dil (Language)",
      },
      help: {
        label: "Yardım",
        checkUpdate: "Güncellemeleri Denetle...",
        officialSite: "Resmi Web Sitesi",
        syslogs: "Sistem Günlükleri",
        render: "Video İşleme",
        about: "ShortVideo Hakkında",
      },
    },
    dialogs: {
      newVersionTitle: "Yeni Sürüm Mevcut: {version}",
      newVersionMsg: "ShortVideo'nun yeni bir sürümü mevcut",
      linuxManualDetail: "{version} sürümü hazır. Lütfen resmi web sitesinden yükleyiciyi indirin.",
      btnGoWebsite: "Web Sitesine Git",
      btnRemindLater: "Daha Sonra Hatırlat",
      checkUpdateTitle: "Güncellemeleri Denetle",
      alreadyLatestMsg: "En son sürümü kullanıyorsunuz",
      alreadyLatestDetail: "ShortVideo v{version} şu anda en güncel sürümdür.",
      btnOk: "Tamam",
      btnCancel: "İptal",
      updateFailedTitle: "Güncelleme Denetimi Başarısız",
      updateFailedMsg: "Güncelleme bilgisi alınamadı",
      updateFailedDetail: "Lütfen internet bağlantınızı kontrol edip tekrar deneyin.",
      devModeTitle: "Geliştirici Modu",
      devModeMsg: "Geliştirici modunda çalışıyor",
      devModeDetail: "Otomatik güncelleme geliştirici modunda devre dışıdır.",
      exportLogsTitle: "Sistem Günlüklerini Dışa Aktar",
      logFileFilter: "Günlük Dosyaları (*.log)",
      selectProjectDirTitle: "Proje Kaynak Dizinini Seçin",
      projectDirNotFound: "Belirtilen dizin bulunamadı",
    },
    notifications: {
      updateDownloadedTitle: "Güncelleme v{version} İndirildi",
      updateDownloadedBody: "Yeni sürüm hazır. Güncellemeyi uygulamak için uygulamayı yeniden başlatın.",
      startPublishTitle: "Video Yayınlama Başlatıldı",
      startPublishBody: "【{platform}】 platformuna video otomatik yayınlanıyor, tahmini 1-3 dakika...",
      scheduleSuccessTitle: "Zamanlanmış Yayın Başarılı",
      scheduleSuccessBody: "【{platform}】{title} başarıyla yayınlandı!",
      scheduleFailedTitle: "Zamanlanmış Yayın Başarısız",
      scheduleFailedBody: "【{platform}】{title} yayınlanamadı: {error}",
      scheduleErrorTitle: "Zamanlanmış Yayın Hatası",
      scheduleErrorBody: "【{platform}】{title}: {error}",
      autoRetryTitle: "Otomatik Yeniden Yayınlama",
      autoRetryBody: "{count} yayınlanmamış video tespit edildi, hemen yeniden zamanlandı!",
    },
    platforms: {
      wechat: "WeChat Channels",
      wechatShort: "WeChat",
      xiaohongshu: "Xiaohongshu İçerik Üretici Platformu",
      xhsShort: "Xiaohongshu",
      system: "Sistem Günlükleri",
    },
    steps: {
      wechat: ['Sayfa Hazır', 'Video Yükleme', 'Kısa Başlık', 'Açıklama ve Etiketler', 'Gelişmiş Ayarlar', 'Dönüştür ve Yayınla'],
      xiaohongshu: ['Sayfa Hazır', 'Video Yükleme', 'Not Başlığı', 'İçerik ve Etiketler', 'Gelişmiş Ayarlar', 'Doğrula ve Yayınla'],
    },
  },
};

export function getLocale(lang?: string | null): I18nDictionary {
  const code = normalizeLangCode(lang);
  return I18N_LOCALES[code] || I18N_LOCALES.zh;
}

export function formatI18n(template: string, params?: Record<string, string | number>): string {
  if (!template) return '';
  if (!params) return template;
  let str = template;
  for (const [k, v] of Object.entries(params)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return str;
}

export function t(path: string, lang?: string | null, params?: Record<string, string | number>): string {
  const loc = getLocale(lang);
  const parts = path.split('.');
  let cur: any = loc;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) {
      cur = cur[p];
    } else {
      return path;
    }
  }
  if (typeof cur === 'string') {
    return formatI18n(cur, params);
  }
  return path;
}

export function getSupportedLanguages(): SupportedLanguageItem[] {
  return SUPPORTED_LANGUAGES;
}

export const normalizeLang = normalizeLangCode;

export function getClientHtmlTranslations(lang?: string | null): Record<string, string> {
  const loc = getLocale(lang);
  const flat: Record<string, string> = {};
  function flatten(obj: any, prefix = '') {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}_${k}` : k;
      if (typeof v === 'string') {
        flat[fullKey] = v;
      } else if (typeof v === 'object') {
        flatten(v, fullKey);
      }
    }
  }
  flatten(loc);
  return flat;
}
