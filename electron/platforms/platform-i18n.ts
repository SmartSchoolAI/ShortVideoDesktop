import { SupportedLangCode, normalizeLangCode } from '../utils/i18n';
import { windowManager } from '../services/window-manager';

export interface PlatformI18nEntry {
  // 平台通用名称
  platformNameWechat: string;
  platformNameXhs: string;

  // 中止与异常
  publishAborted: string;
  tabClosed: string;
  fileNotFound: string;
  windowDestroyed: string;
  loginTimeout: string;
  publishTimeout: string;
  publishSuccess: string;
  publishFailed: string;

  // 登录检测
  waitingLogin: string;
  waitingLoginTick: string;
  loginSuccess: string;
  switchedToQrMode: string;

  // 导航与页面准备
  checkingPublishPage: string;
  alreadyOnPublishPage: string;
  findingPublishEntry: string;
  clickedPublishEntry: string;
  enteredPublishPageSuccess: string;
  fallbackDirectNav: string;
  waitingPageReady: string;
  waitingPageReadyTick: string;
  pageReadySuccess: string;
  pageReadyTimeout: string;
  dismissedDialog: string;

  // 素材上传
  preparingCdpUpload: string;
  uploadRetry: string;
  uploadSuccess: string;
  uploadAttemptFailed: string;
  interceptedFileChooser: string;
  waitingFormReady: string;
  waitingFormReadyTick: string;
  formReadySuccess: string;
  formReadyTimeout: string;
  deletingCurrentVideo: string;
  deletedVideoSuccess: string;
  reuploadTriggered: string;

  // 内容填充
  fillingShortTitle: string;
  fillingTitle: string;
  fillingDescription: string;
  fieldFilledSuccess: string;
  addingTag: string;
  locatingInput: string;
  inputLocated: string;
  inputNotFound: string;
  focusingInput: string;
  typingHumanLike: string;

  // 高级设置
  configuringAdvanced: string;
  waitingAdvancedMounted: string;
  settingLocationNone: string;
  settingCollection: string;
  declaringOriginal: string;
  declaredOriginalSuccess: string;
  markingAiGenerated: string;
  markedAiSuccess: string;
  schedulingPublish: string;
  scheduledSuccess: string;

  // 发布提交
  submittingPublish: string;
  clickedPublishBtn: string;
  waitingTranscode: string;
  waitingTranscodeTick: string;
  publishSuccessDetected: string;
}

export const PLATFORM_I18N_LOCALES: Record<SupportedLangCode, PlatformI18nEntry> = {
  zh: {
    platformNameWechat: '微信视频号',
    platformNameXhs: '小红书',

    publishAborted: '视频发布任务已由用户主动中止',
    tabClosed: '用户已关闭【{platform}】标签页，自动化发布任务已强行中止',
    fileNotFound: '本地待发布视频文件不存在: {path}',
    windowDestroyed: '目标窗口已销毁，无法继续执行发布',
    loginTimeout: '等待用户登录超时（超过 {minutes} 分钟），发布终止',
    publishTimeout: '发布超时，平台未能在此期间完成转码发布',
    publishSuccess: '【{platform}】短视频发布成功！',
    publishFailed: '【{platform}】发布失败: {error}',

    waitingLogin: '⏳ 未检测到有效登录态，请在【{platform}】窗口中扫码登录 (登录成功后将自动继续)...',
    waitingLoginTick: '⏳ 正在等待【{platform}】扫码登录 (已等待 {elapsed}s，登录成功后将自动继续)...',
    loginSuccess: '✅ 检测到已成功登录【{platform}】！正在准备进入发表界面...',
    switchedToQrMode: '⏳ 未检测到小红书有效登录态，已自动将登录卡片切换为【App 扫码登录】，请使用手机扫码 (登录成功后将自动继续)...',

    checkingPublishPage: '🔍 正在检查当前是否处于视频发表页面...',
    alreadyOnPublishPage: '✅ 当前已处于视频发表页面',
    findingPublishEntry: '⏳ 正在拟人化寻找并点击【{btn}】进入新建发布页面...',
    clickedPublishEntry: '🖱️ 找到【{btn}】按钮，正在模拟真实鼠标点击进入发表页面...',
    enteredPublishPageSuccess: '✅ 已成功通过点击进入视频发表页面！',
    fallbackDirectNav: '⏳ 备用方案：正在通过 URL 直接导航至视频发表页面...',
    waitingPageReady: '⏳ 正在等待【{platform}】发表界面完成网络加载与组件渲染...',
    waitingPageReadyTick: '⏳ 正在等待【{platform}】发表界面完成网络加载与组件渲染 ({elapsed}s)...',
    pageReadySuccess: '✅ 【{platform}】发表界面已彻底渲染就绪！',
    pageReadyTimeout: '⚠️ 发表页面加载等待超时，将继续尝试后续操作...',
    dismissedDialog: '检测到提示/公约弹窗，已通过物理点击【{btn}】解除页面遮罩！',

    preparingCdpUpload: '准备通过原生 CDP 注入本地短视频文件...',
    uploadRetry: '⚠️ 检测到当前未处于发表页，正在尝试重新进入发表页面...',
    uploadSuccess: '✅ 原生 CDP 注入视频素材成功！(第 {attempt} 次尝试)',
    uploadAttemptFailed: 'CDP 注入尝试 ({attempt}) 异常: {error}',
    interceptedFileChooser: '✅ 通过拦截文件选择器成功注入视频素材！',
    waitingFormReady: '⏳ 正在等待【{platform}】解析短视频并加载发表表单...',
    waitingFormReadyTick: '⏳ 正在等待【{platform}】解析短视频并加载发表表单 ({elapsed}s)...',
    formReadySuccess: '✅ 【{platform}】发表表单已完全加载就绪！',
    formReadyTimeout: '❌ 等待【{platform}】发表表单加载超时！',
    deletingCurrentVideo: '🗑️ 正在尝试取消并删除当前视频素材...',
    deletedVideoSuccess: '✅ 已成功取消/删除当前异常视频，页面已恢复为待上传状态！',
    reuploadTriggered: '已直接触发【重新上传】操作',

    fillingShortTitle: '✍️ 正在录入短标题【{title}】...',
    fillingTitle: '✍️ 正在录入笔记标题【{title}】...',
    fillingDescription: '✍️ 正在录入视频动态描述与话题标签...',
    fieldFilledSuccess: '✅ 【{field}】录入并校验成功！',
    addingTag: '🏷️ 正在添加话题标签 #{tag}...',
    locatingInput: '[{field}] 开始智能定位目标输入框 (含 Shadow DOM 穿透)...',
    inputLocated: '[{field}] ✅ 成功锁定输入框真实物理坐标 ({x}, {y})！',
    inputNotFound: '[{field}] ❌ 持续扫描均未找到有效输入控件！',
    focusingInput: '[{field}] 正在物理点击输入框聚焦 (拟人鼠标轨迹)...',
    typingHumanLike: '[{field}] 正在模拟人类键入录入文本 (单次录入，含拟人化击键频率与微停顿)...',

    configuringAdvanced: '⚙️ 开始配置高级发布选项 (位置/合集/定时发表/声明原创/AI标注)...',
    waitingAdvancedMounted: '⏳ 正在滚动探测并等待高级选项组件完全挂载 (合集/原创/AI标注)...',
    settingLocationNone: '📍 已设置地理位置为【不显示位置】',
    settingCollection: '📚 已配置添加到合集: 【{name}】',
    declaringOriginal: '🛡️ 正在申请声明原创并签署创作者协议...',
    declaredOriginalSuccess: '✅ 原创声明已成功勾选并确认！',
    markingAiGenerated: '🤖 正在标注为【由 AI 生成的内容】...',
    markedAiSuccess: '✅ AI 生成标注配置成功！',
    schedulingPublish: '⏰ 正在配置定时发表时间: {time}...',
    scheduledSuccess: '✅ 定时发表时间已成功设定！',

    submittingPublish: '🚀 正在点击最终【发表】按钮提交视频...',
    clickedPublishBtn: '🖱️ 已成功点击【{btn}】按钮，正在监控转码与最终发表结果...',
    waitingTranscode: '⏳ 正在等待平台转码处理并确认发布完成...',
    waitingTranscodeTick: '⏳ 正在等待转码处理 ({elapsed}s)...',
    publishSuccessDetected: '🎉 检测到发布成功提示！短视频已顺利发布到【{platform}】！'
  },

  en: {
    platformNameWechat: 'WeChat Channels',
    platformNameXhs: 'Xiaohongshu',

    publishAborted: 'Video publishing task was aborted by user',
    tabClosed: 'User closed the [{platform}] tab, automated publishing task has been aborted',
    fileNotFound: 'Local video file does not exist: {path}',
    windowDestroyed: 'Target window is destroyed, cannot continue publishing',
    loginTimeout: 'User login timed out (exceeded {minutes} mins), publishing terminated',
    publishTimeout: 'Publishing timed out, platform failed to complete transcode & publish in time',
    publishSuccess: '[{platform}] Short video published successfully!',
    publishFailed: '[{platform}] Publish failed: {error}',

    waitingLogin: '⏳ No valid login session detected. Please scan QR code in the [{platform}] window (will resume automatically upon login)...',
    waitingLoginTick: '⏳ Waiting for [{platform}] QR code login ({elapsed}s elapsed, will resume upon login)...',
    loginSuccess: '✅ Successfully logged in to [{platform}]! Preparing publish page...',
    switchedToQrMode: '⏳ No valid session detected, switched login mode to [App QR Code Scan]. Please scan with your phone...',

    checkingPublishPage: '🔍 Checking if currently on video publishing page...',
    alreadyOnPublishPage: '✅ Currently on video publishing page',
    findingPublishEntry: '⏳ Finding and clicking [{btn}] button to enter publish page...',
    clickedPublishEntry: '🖱️ Found [{btn}] button, clicking to enter publish page...',
    enteredPublishPageSuccess: '✅ Successfully entered video publishing page!',
    fallbackDirectNav: '⏳ Fallback: Navigating directly to publish page URL...',
    waitingPageReady: '⏳ Waiting for [{platform}] publish page to load & render...',
    waitingPageReadyTick: '⏳ Waiting for [{platform}] publish page to load & render ({elapsed}s)...',
    pageReadySuccess: '✅ [{platform}] publish page is completely ready!',
    pageReadyTimeout: '⚠️ Publish page loading timed out, attempting to proceed...',
    dismissedDialog: 'Detected notice/agreement dialog, clicked [{btn}] to dismiss!',

    preparingCdpUpload: 'Preparing to upload local video file via native CDP...',
    uploadRetry: '⚠️ Not on publish page, navigating to publish page...',
    uploadSuccess: '✅ Video file uploaded successfully via native CDP! (Attempt {attempt})',
    uploadAttemptFailed: 'CDP upload attempt ({attempt}) error: {error}',
    interceptedFileChooser: '✅ Successfully uploaded video via intercepted file chooser!',
    waitingFormReady: '⏳ Waiting for [{platform}] to parse video and load publishing form...',
    waitingFormReadyTick: '⏳ Waiting for [{platform}] to parse video and load publishing form ({elapsed}s)...',
    formReadySuccess: '✅ [{platform}] publishing form is fully loaded & ready!',
    formReadyTimeout: '❌ Timed out waiting for [{platform}] publishing form to load!',
    deletingCurrentVideo: '🗑️ Cancelling and removing current video file...',
    deletedVideoSuccess: '✅ Current abnormal video removed, page reset to ready-to-upload state!',
    reuploadTriggered: 'Triggered [Re-upload] operation directly',

    fillingShortTitle: '✍️ Entering short title [{title}]...',
    fillingTitle: '✍️ Entering note title [{title}]...',
    fillingDescription: '✍️ Entering video description and hashtags...',
    fieldFilledSuccess: '✅ [{field}] entered and verified successfully!',
    addingTag: '🏷️ Adding hashtag #{tag}...',
    locatingInput: '[{field}] Locating target input field (with Shadow DOM penetration)...',
    inputLocated: '[{field}] ✅ Successfully located physical coordinates ({x}, {y})!',
    inputNotFound: '[{field}] ❌ No valid input element found after scanning!',
    focusingInput: '[{field}] Clicking input field to focus (human mouse trajectory)...',
    typingHumanLike: '[{field}] Typing text with human-like keystroke intervals & micro-pauses...',

    configuringAdvanced: '⚙️ Configuring advanced options (Location/Collection/Schedule/Original/AI)...',
    waitingAdvancedMounted: '⏳ Probing & waiting for advanced option components to mount...',
    settingLocationNone: '📍 Set location to [Do Not Show Location]',
    settingCollection: '📚 Configured addition to collection: [{name}]',
    declaringOriginal: '🛡️ Applying for Original statement & signing creator agreement...',
    declaredOriginalSuccess: '✅ Original statement successfully checked and confirmed!',
    markingAiGenerated: '🤖 Marking video as [AI-generated content]...',
    markedAiSuccess: '✅ AI-generated mark configured successfully!',
    schedulingPublish: '⏰ Configuring scheduled publish time: {time}...',
    scheduledSuccess: '✅ Scheduled publish time successfully set!',

    submittingPublish: '🚀 Clicking final [Publish] button to submit video...',
    clickedPublishBtn: '🖱️ Clicked [{btn}] button, monitoring transcoding and final result...',
    waitingTranscode: '⏳ Waiting for platform transcoding & final confirmation...',
    waitingTranscodeTick: '⏳ Waiting for transcoding ({elapsed}s)...',
    publishSuccessDetected: '🎉 Success detected! Short video has been published to [{platform}]!'
  },

  ja: {
    platformNameWechat: 'WeChat チャンネル',
    platformNameXhs: '小紅書 (RED)',

    publishAborted: '動画投稿タスクはユーザーによって中止されました',
    tabClosed: 'ユーザーが【{platform}】タブを閉じたため、自動投稿タスクを中止しました',
    fileNotFound: 'ローカル動画ファイルが存在しません: {path}',
    windowDestroyed: '対象ウィンドウが破棄されたため、投稿を続行できません',
    loginTimeout: 'ログイン待機タイムアウト（{minutes} 分超過）、投稿を終了します',
    publishTimeout: '投稿タイムアウト、プラットフォームの変換・投稿が完了しませんでした',
    publishSuccess: '【{platform}】ショート動画の投稿に成功しました！',
    publishFailed: '【{platform}】投稿失敗: {error}',

    waitingLogin: '⏳ 有効なログイン状態が検出されません。【{platform}】ウィンドウでQRコードをスキャンしてください...',
    waitingLoginTick: '⏳ 【{platform}】QRコードログイン待機中（待機時間: {elapsed}秒）...',
    loginSuccess: '✅ 【{platform}】へのログインに成功しました！投稿画面を準備中...',
    switchedToQrMode: '⏳ 有効なセッションがありません。【アプリQRコードスキャン】に切り替えました...',

    checkingPublishPage: '🔍 動画投稿ページにいるか確認中...',
    alreadyOnPublishPage: '✅ 現在動画投稿ページにいます',
    findingPublishEntry: '⏳ 【{btn}】ボタンを検索して投稿ページへ移動中...',
    clickedPublishEntry: '🖱️ 【{btn}】ボタンをクリックして投稿ページへ移動中...',
    enteredPublishPageSuccess: '✅ 動画投稿ページへ正常に移動しました！',
    fallbackDirectNav: '⏳ バックアップ手順: URLで直接投稿ページへ移動中...',
    waitingPageReady: '⏳ 【{platform}】投稿画面の読み込みとレンダリングを待機中...',
    waitingPageReadyTick: '⏳ 【{platform}】投稿画面の読み込みを待機中 ({elapsed}秒)...',
    pageReadySuccess: '✅ 【{platform}】投稿画面の準備が完全に完了しました！',
    pageReadyTimeout: '⚠️ 投稿画面の読み込み待機がタイムアウトしました。次の処理を試みます...',
    dismissedDialog: '通知/規約ポップアップを検出し、【{btn}】をクリックして閉じました！',

    preparingCdpUpload: 'ネイティブCDP経由でローカル動画素材をアップロード準備中...',
    uploadRetry: '⚠️ 投稿ページではないため、投稿ページへ再移動中...',
    uploadSuccess: '✅ ネイティブCDPによる動画素材アップロード成功！（試行回数: {attempt}）',
    uploadAttemptFailed: 'CDPアップロード試行 ({attempt}) エラー: {error}',
    interceptedFileChooser: '✅ ファイル選択ダイアログを捕捉し動画素材をアップロードしました！',
    waitingFormReady: '⏳ 【{platform}】が動画を解析して投稿フォームを表示するのを待機中...',
    waitingFormReadyTick: '⏳ 動画解析とフォーム表示を待機中 ({elapsed}秒)...',
    formReadySuccess: '✅ 【{platform}】投稿フォームの読み込みが完了しました！',
    formReadyTimeout: '❌ 【{platform}】投稿フォーム読み込みがタイムアウトしました！',
    deletingCurrentVideo: '🗑️ 現在の動画素材を削除中...',
    deletedVideoSuccess: '✅ 異常動画を削除し、アップロード待機状態にリセットしました！',
    reuploadTriggered: '【再アップロード】を直接実行しました',

    fillingShortTitle: '✍️ ショートタイトル【{title}】を入力中...',
    fillingTitle: '✍️ ノートタイトル【{title}】を入力中...',
    fillingDescription: '✍️ 動画の概要とハッシュタグを入力中...',
    fieldFilledSuccess: '✅ 【{field}】の入力と検証に成功しました！',
    addingTag: '🏷️ ハッシュタグ #{tag} を追加中...',
    locatingInput: '[{field}] 入力欄を検出中（Shadow DOM 透過含む）...',
    inputLocated: '[{field}] ✅ 入力欄の物理座標 ({x}, {y}) を特定しました！',
    inputNotFound: '[{field}] ❌ 有効な入力要素が見つかりませんでした！',
    focusingInput: '[{field}] 入力欄をクリックしてフォーカス中...',
    typingHumanLike: '[{field}] 人間らしいタイピング速度と間隔でテキストを入力中...',

    configuringAdvanced: '⚙️ 詳細設定を構成中（位置/コレクション/予約投稿/オリジナル宣言/AI表記）...',
    waitingAdvancedMounted: '⏳ 詳細設定コンポーネントのマウントを待機中...',
    settingLocationNone: '📍 位置情報を【非表示】に設定しました',
    settingCollection: '📚 コレクション【{name}】への追加を設定しました',
    declaringOriginal: '🛡️ オリジナル宣言の申請と規約への同意処理中...',
    declaredOriginalSuccess: '✅ オリジナル宣言を確認・チェックしました！',
    markingAiGenerated: '🤖 【AI生成コンテンツ】としてマーク中...',
    markedAiSuccess: '✅ AI生成マークの設定に成功しました！',
    schedulingPublish: '⏰ 予約投稿時間を設定中: {time}...',
    scheduledSuccess: '✅ 予約投稿時間が設定されました！',

    submittingPublish: '🚀 最終【投稿】ボタンをクリックして送信中...',
    clickedPublishBtn: '🖱️ 【{btn}】ボタンをクリックしました。変換と結果を監視中...',
    waitingTranscode: '⏳ プラットフォームの動画変換と完了確認を待機中...',
    waitingTranscodeTick: '⏳ 動画変換を待機中 ({elapsed}秒)...',
    publishSuccessDetected: '🎉 投稿成功を検出！ショート動画が【{platform}】に投稿されました！'
  },

  ko: {
    platformNameWechat: 'WeChat 채널',
    platformNameXhs: '샤오홍슈 (Xiaohongshu)',

    publishAborted: '사용자에 의해 동영상 게시 작업이 중단되었습니다',
    tabClosed: '사용자가 【{platform}】 탭을 닫아 자동 게시 작업이 강제 중단되었습니다',
    fileNotFound: '게시할 로컬 동영상 파일이 존재하지 않습니다: {path}',
    windowDestroyed: '대상 창이 닫혀 게시를 계속할 수 없습니다',
    loginTimeout: '사용자 로그인 대기 시간 초과 ({minutes}분 초과), 게시가 종료됩니다',
    publishTimeout: '게시 시간 초과, 플랫폼에서 인코딩 및 게시를 완료하지 못했습니다',
    publishSuccess: '【{platform}】 숏폼 동영상 게시 성공!',
    publishFailed: '【{platform}】 게시 실패: {error}',

    waitingLogin: '⏳ 유효한 로그인 세션이 없습니다. 【{platform}】 창에서 QR 코드를 스캔하세요...',
    waitingLoginTick: '⏳ 【{platform}】 QR 코드 로그인 대기 중 ({elapsed}초 경과)...',
    loginSuccess: '✅ 【{platform}】 로그인 성공! 게시 페이지 준비 중...',
    switchedToQrMode: '⏳ 세션이 없어 【앱 QR 코드 스캔】 모드로 자동 전환했습니다...',

    checkingPublishPage: '🔍 현재 동영상 게시 페이지인지 확인 중...',
    alreadyOnPublishPage: '✅ 현재 동영상 게시 페이지에 있습니다',
    findingPublishEntry: '⏳ 【{btn}】 버튼을 찾아 게시 페이지로 이동 중...',
    clickedPublishEntry: '🖱️ 【{btn}】 버튼을 클릭하여 게시 페이지로 이동 중...',
    enteredPublishPageSuccess: '✅ 동영상 게시 페이지로 이동 성공!',
    fallbackDirectNav: '⏳ 대체 방식: URL을 통해 직접 게시 페이지로 이동 중...',
    waitingPageReady: '⏳ 【{platform}】 게시 페이지 로딩 및 렌더링 대기 중...',
    waitingPageReadyTick: '⏳ 【{platform}】 게시 페이지 로딩 대기 중 ({elapsed}초)...',
    pageReadySuccess: '✅ 【{platform}】 게시 인터페이스 준비 완료!',
    pageReadyTimeout: '⚠️ 게시 페이지 로딩 대기 시간 초과, 다음 단계를 시도합니다...',
    dismissedDialog: '공지/동의 팝업을 감지하여 【{btn}】 버튼을 클릭해 닫았습니다!',

    preparingCdpUpload: '네이티브 CDP를 통해 로컬 동영상 파일 업로드 준비 중...',
    uploadRetry: '⚠️ 게시 페이지가 아니므로 다시 이동 중...',
    uploadSuccess: '✅ 네이티브 CDP 동영상 업로드 성공! ({attempt}번째 시도)',
    uploadAttemptFailed: 'CDP 업로드 시도 ({attempt}) 오류: {error}',
    interceptedFileChooser: '✅ 파일 선택기를 가로채 동영상 업로드 성공!',
    waitingFormReady: '⏳ 【{platform}】 동영상 분석 및 게시 양식 로딩 대기 중...',
    waitingFormReadyTick: '⏳ 동영상 분석 및 양식 로딩 대기 중 ({elapsed}초)...',
    formReadySuccess: '✅ 【{platform}】 게시 양식 로딩 완료!',
    formReadyTimeout: '❌ 【{platform}】 게시 양식 로딩 시간 초과!',
    deletingCurrentVideo: '🗑️ 현재 동영상 파일 삭제 시도 중...',
    deletedVideoSuccess: '✅ 비정상 동영상이 삭제되었으며 업로드 대기 상태로 복원되었습니다!',
    reuploadTriggered: '【다시 업로드】 작업을 직접 실행했습니다',

    fillingShortTitle: '✍️ 짧은 제목 【{title}】 입력 중...',
    fillingTitle: '✍️ 노트 제목 【{title}】 입력 중...',
    fillingDescription: '✍️ 동영상 설명 및 해시태그 입력 중...',
    fieldFilledSuccess: '✅ 【{field}】 입력 및 검증 성공!',
    addingTag: '🏷️ 해시태그 #{tag} 추가 중...',
    locatingInput: '[{field}] 입력 필드 탐색 중 (Shadow DOM 관통)...',
    inputLocated: '[{field}] ✅ 입력 필드 물리적 좌표 ({x}, {y}) 확인!',
    inputNotFound: '[{field}] ❌ 유효한 입력 요소를 찾을 수 없습니다!',
    focusingInput: '[{field}] 입력 필드 포커스 클릭 중...',
    typingHumanLike: '[{field}] 사람의 타이핑 속도와 미세 정지로 텍스트 입력 중...',

    configuringAdvanced: '⚙️ 고급 옵션 설정 중 (위치/컬렉션/예약게시/오리지널선언/AI표기)...',
    waitingAdvancedMounted: '⏳ 고급 설정 구성 요소 마운트 대기 중...',
    settingLocationNone: '📍 위치를 【위치 표시 안 함】으로 설정했습니다',
    settingCollection: '📚 컬렉션 【{name}】 추가 설정 완료',
    declaringOriginal: '🛡️ 오리지널 선언 신청 및 제작자 약관 동의 중...',
    declaredOriginalSuccess: '✅ 오리지널 선언 확인 및 선택 완료!',
    markingAiGenerated: '🤖 【AI 생성 콘텐츠】로 표기 중...',
    markedAiSuccess: '✅ AI 생성 표기 설정 완료!',
    schedulingPublish: '⏰ 예약 게시 시간 설정 중: {time}...',
    scheduledSuccess: '✅ 예약 게시 시간이 성공적으로 설정되었습니다!',

    submittingPublish: '🚀 최종 【게시】 버튼을 클릭하여 제출 중...',
    clickedPublishBtn: '🖱️ 【{btn}】 버튼 클릭 완료, 인코딩 및 결과를 모니터링 중...',
    waitingTranscode: '⏳ 플랫폼 인코딩 및 최종 완료 대기 중...',
    waitingTranscodeTick: '⏳ 인코딩 대기 중 ({elapsed}초)...',
    publishSuccessDetected: '🎉 게시 성공 감지! 【{platform}】에 동영상이 성공적으로 게시되었습니다!'
  },

  vi: {
    platformNameWechat: 'WeChat Kênh Video',
    platformNameXhs: 'Xiaohongshu',

    publishAborted: 'Tác vụ xuất bản video đã bị người dùng hủy bỏ',
    tabClosed: 'Người dùng đã đóng tab 【{platform}】, tác vụ xuất bản tự động đã bị dừng',
    fileNotFound: 'Tệp video cục bộ không tồn tại: {path}',
    windowDestroyed: 'Cửa sổ mục tiêu đã bị đóng, không thể tiếp tục xuất bản',
    loginTimeout: 'Hết thời gian chờ đăng nhập (quá {minutes} phút), xuất bản bị hủy',
    publishTimeout: 'Hết thời gian xuất bản, nền tảng không hoàn tất chuyển mã & đăng kịp thời',
    publishSuccess: 'Xuất bản video ngắn lên 【{platform}】 thành công!',
    publishFailed: 'Xuất bản lên 【{platform}】 thất bại: {error}',

    waitingLogin: '⏳ Chưa phát hiện phiên đăng nhập hợp lệ. Vui lòng quét mã QR trên cửa sổ 【{platform}】...',
    waitingLoginTick: '⏳ Đang chờ quét mã QR 【{platform}】 (đã chờ {elapsed}s)...',
    loginSuccess: '✅ Đăng nhập 【{platform}】 thành công! Đang chuẩn bị trang xuất bản...',
    switchedToQrMode: '⏳ Đã tự động chuyển sang chế độ 【Quét mã QR qua ứng dụng】...',

    checkingPublishPage: '🔍 Đang kiểm tra xem có đang ở trang xuất bản video hay không...',
    alreadyOnPublishPage: '✅ Hiện đang ở trang xuất bản video',
    findingPublishEntry: '⏳ Đang tìm và nhấp vào nút 【{btn}】 để vào trang tạo mới...',
    clickedPublishEntry: '🖱️ Đã tìm thấy nút 【{btn}】, đang nhấp để vào trang xuất bản...',
    enteredPublishPageSuccess: '✅ Đã vào trang xuất bản video thành công!',
    fallbackDirectNav: '⏳ Phương án phụ: Đang điều hướng trực tiếp bằng URL...',
    waitingPageReady: '⏳ Đang chờ giao diện xuất bản 【{platform}】 tải xong...',
    waitingPageReadyTick: '⏳ Đang chờ giao diện xuất bản tải xong ({elapsed}s)...',
    pageReadySuccess: '✅ Giao diện xuất bản 【{platform}】 đã sẵn sàng!',
    pageReadyTimeout: '⚠️ Hết thời gian tải trang xuất bản, tiếp tục thử các bước tiếp theo...',
    dismissedDialog: 'Phát hiện hộp thoại thông báo/điều khoản, đã nhấp 【{btn}】 để đóng!',

    preparingCdpUpload: 'Chuẩn bị tải lên tệp video cục bộ qua CDP gốc...',
    uploadRetry: '⚠️ Chưa ở trang xuất bản, đang điều hướng lại...',
    uploadSuccess: '✅ Tải video lên thành công qua CDP! (Lần thử {attempt})',
    uploadAttemptFailed: 'Lỗi tải lên CDP ({attempt}): {error}',
    interceptedFileChooser: '✅ Đã tải tệp video lên thành công qua bộ chọn tệp bị chặn!',
    waitingFormReady: '⏳ Đang chờ 【{platform}】 phân tích video và tải biểu mẫu xuất bản...',
    waitingFormReadyTick: '⏳ Đang chờ phân tích video và tải biểu mẫu ({elapsed}s)...',
    formReadySuccess: '✅ Biểu mẫu xuất bản 【{platform}】 đã sẵn sàng!',
    formReadyTimeout: '❌ Hết thời gian chờ biểu mẫu xuất bản tải xong!',
    deletingCurrentVideo: '🗑️ Đang thử hủy và xóa tệp video hiện tại...',
    deletedVideoSuccess: '✅ Đã xóa video bất thường, trang đã trở lại trạng thái sẵn sàng tải lên!',
    reuploadTriggered: 'Đã kích hoạt trực tiếp thao tác 【Tải lên lại】',

    fillingShortTitle: '✍️ Đang nhập tiêu đề ngắn 【{title}】...',
    fillingTitle: '✍️ Đang nhập tiêu đề bài viết 【{title}】...',
    fillingDescription: '✍️ Đang nhập mô tả video và thẻ hashtag...',
    fieldFilledSuccess: '✅ Đã nhập và xác thực 【{field}】 thành công!',
    addingTag: '🏷️ Đang thêm hashtag #{tag}...',
    locatingInput: '[{field}] Đang định vị ô nhập liệu (xuyên qua Shadow DOM)...',
    inputLocated: '[{field}] ✅ Đã xác định tọa độ vật lý ({x}, {y})!',
    inputNotFound: '[{field}] ❌ Không tìm thấy phần tử nhập liệu hợp lệ!',
    focusingInput: '[{field}] Đang nhấp vào ô nhập liệu để lấy nét...',
    typingHumanLike: '[{field}] Đang gõ văn bản mô phỏng tốc độ người dùng...',

    configuringAdvanced: '⚙️ Đang cấu hình cài đặt nâng cao (Vị trí/Bộ sưu tập/Hẹn giờ/Bản quyền/AI)...',
    waitingAdvancedMounted: '⏳ Đang chờ các thành phần tùy chọn nâng cao gắn kết...',
    settingLocationNone: '📍 Đã đặt vị trí là 【Không hiển thị vị trí】',
    settingCollection: '📚 Đã cấu hình thêm vào bộ sưu tập: 【{name}】',
    declaringOriginal: '🛡️ Đang đăng ký bản quyền gốc và chấp nhận thỏa thuận...',
    declaredOriginalSuccess: '✅ Tuyên bố bản quyền gốc đã được chọn và xác nhận!',
    markingAiGenerated: '🤖 Đang đánh dấu là 【Nội dung do AI tạo ra】...',
    markedAiSuccess: '✅ Cấu hình đánh dấu do AI tạo thành công!',
    schedulingPublish: '⏰ Đang đặt thời gian xuất bản hẹn giờ: {time}...',
    scheduledSuccess: '✅ Đã đặt lịch xuất bản hẹn giờ thành công!',

    submittingPublish: '🚀 Đang nhấp vào nút 【Xuất bản】 cuối cùng để gửi video...',
    clickedPublishBtn: '🖱️ Đã nhấp nút 【{btn}】, đang theo dõi quá trình chuyển mã và kết quả...',
    waitingTranscode: '⏳ Đang chờ nền tảng chuyển mã và xác nhận hoàn tất...',
    waitingTranscodeTick: '⏳ Đang chờ chuyển mã ({elapsed}s)...',
    publishSuccessDetected: '🎉 Phát hiện xuất bản thành công! Video đã được đăng lên 【{platform}】!'
  },

  th: {
    platformNameWechat: 'WeChat Channels',
    platformNameXhs: 'Xiaohongshu',

    publishAborted: 'งานเผยแพร่วิดีโอถูกยกเลิกโดยผู้ใช้',
    tabClosed: 'ผู้ใช้ปิดแท็บ 【{platform}】 งานเผยแพร่อัตโนมัติจึงถูกยกเลิก',
    fileNotFound: 'ไม่พบไฟล์วิดีโอในเครื่อง: {path}',
    windowDestroyed: 'หน้าต่างเป้าหมายถูกปิด ไม่สามารถดำเนินการเผยแพร่ต่อได้',
    loginTimeout: 'หมดเวลารอเข้าสู่ระบบ (เกิน {minutes} นาที) ยกเลิกการเผยแพร่',
    publishTimeout: 'หมดเวลาเผยแพร่ แพลตฟอร์มแปลงรหัสและเผยแพร่ไม่ทัน',
    publishSuccess: 'เผยแพร่วิดีโอสั้นไปยัง 【{platform}】 สำเร็จ!',
    publishFailed: 'การเผยแพร่ไปยัง 【{platform}】 ล้มเหลว: {error}',

    waitingLogin: '⏳ ตรวจไม่พบเซสชันการเข้าสู่ระบบ โปรดสแกนรหัส QR ในหน้าต่าง 【{platform}】...',
    waitingLoginTick: '⏳ กำลังรอการสแกนรหัส QR 【{platform}】 (รอแล้ว {elapsed} วินาที)...',
    loginSuccess: '✅ เข้าสู่ระบบ 【{platform}】 สำเร็จแล้ว! กำลังเตรียมหน้าเผยแพร่...',
    switchedToQrMode: '⏳ สลับเป็นโหมด 【สแกนรหัส QR ผ่านแอป】 อัตโนมัติแล้ว...',

    checkingPublishPage: '🔍 กำลังตรวจสอบว่าอยู่ในหน้าเผยแพร่วิดีโอหรือไม่...',
    alreadyOnPublishPage: '✅ ขณะนี้อยู่ในหน้าเผยแพร่วิดีโอแล้ว',
    findingPublishEntry: '⏳ กำลังค้นหาและคลิกปุ่ม 【{btn}】 เพื่อเข้าสู่หน้าสร้างใหม่...',
    clickedPublishEntry: '🖱️ พบปุ่ม 【{btn}】 แล้ว กำลังคลิกเพื่อเข้าสู่หน้าเผยแพร่...',
    enteredPublishPageSuccess: '✅ เข้าสู่หน้าเผยแพร่วิดีโอสำเร็จ!',
    fallbackDirectNav: '⏳ วิธีสำรอง: กำลังนำทางโดยตรงผ่าน URL...',
    waitingPageReady: '⏳ กำลังรอหน้าเผยแพร่ 【{platform}】 โหลดและแสดงผล...',
    waitingPageReadyTick: '⏳ กำลังรอหน้าเผยแพร่โหลด ({elapsed} วินาที)...',
    pageReadySuccess: '✅ หน้าเผยแพร่ 【{platform}】 พร้อมใช้งานแล้ว!',
    pageReadyTimeout: '⚠️ หมดเวลารอโหลดหน้าเผยแพร่ กำลังดำเนินการขั้นตอนถัดไป...',
    dismissedDialog: 'ตรวจพบหน้าต่างข้อความ/ข้อตกลง คลิก 【{btn}】 เพื่อปิดแล้ว!',

    preparingCdpUpload: 'กำลังเตรียมอัปโหลดไฟล์วิดีโอผ่าน CDP ดั้งเดิม...',
    uploadRetry: '⚠️ ไม่อยู่ในหน้าเผยแพร่ กำลังนำทางกลับไปหน้าเผยแพร่...',
    uploadSuccess: '✅ อัปโหลดไฟล์วิดีโอผ่าน CDP สำเร็จ! (ครั้งที่ {attempt})',
    uploadAttemptFailed: 'เกิดข้อผิดพลาดในการอัปโหลด CDP ({attempt}): {error}',
    interceptedFileChooser: '✅ อัปโหลดไฟล์วิดีโอผ่านตัวเลือกไฟล์สำเร็จ!',
    waitingFormReady: '⏳ กำลังรอ 【{platform}】 แยกวิเคราะห์วิดีโอและโหลดแบบฟอร์ม...',
    waitingFormReadyTick: '⏳ กำลังรอแยกวิเคราะห์วิดีโอและโหลดแบบฟอร์ม ({elapsed} วินาที)...',
    formReadySuccess: '✅ แบบฟอร์มเผยแพร่ 【{platform}】 พร้อมแล้ว!',
    formReadyTimeout: '❌ หมดเวลารอแบบฟอร์มเผยแพร่ 【{platform}】!',
    deletingCurrentVideo: '🗑️ กำลังพยายามยกเลิกและลบไฟล์วิดีโอปัจจุบัน...',
    deletedVideoSuccess: '✅ ลบวิดีโอที่ไม่ถูกต้องสำเร็จ หน้ารีเซ็ตเป็นสถานะพร้อมอัปโหลด!',
    reuploadTriggered: 'เรียกใช้การดำเนินการ 【อัปโหลดอีกครั้ง】 แล้ว',

    fillingShortTitle: '✍️ กำลังกรอกชื่อเรื่องสั้น 【{title}】...',
    fillingTitle: '✍️ กำลังกรอกชื่อโน้ต 【{title}】...',
    fillingDescription: '✍️ กำลังกรอกคำอธิบายวิดีโอและแฮชแท็ก...',
    fieldFilledSuccess: '✅ กรอกและตรวจสอบ 【{field}】 สำเร็จแล้ว!',
    addingTag: '🏷️ กำลังเพิ่มแฮชแท็ก #{tag}...',
    locatingInput: '[{field}] กำลังระบุตำแหน่งช่องป้อนข้อมูล (ทะลุ Shadow DOM)...',
    inputLocated: '[{field}] ✅ ระบุพิกัดกายภาพสำเร็จ ({x}, {y})!',
    inputNotFound: '[{field}] ❌ ไม่พบองค์ประกอบอินพุตที่ถูกต้อง!',
    focusingInput: '[{field}] กำลังคลิกช่องป้อนข้อมูลเพื่อโฟกัส...',
    typingHumanLike: '[{field}] กำลังพิมพ์ข้อความด้วยความเร็วเสมือนมนุษย์...',

    configuringAdvanced: '⚙️ กำลังกำหนดค่าตัวเลือกขั้นสูง (ตำแหน่ง/คอลเลกชัน/ตั้งเวลา/ต้นฉบับ/AI)...',
    waitingAdvancedMounted: '⏳ กำลังรอโหลดคอมโพเนนต์ตัวเลือกขั้นสูง...',
    settingLocationNone: '📍 ตั้งค่าตำแหน่งเป็น 【ไม่แสดงตำแหน่ง】',
    settingCollection: '📚 กำหนดค่าเพิ่มลงในคอลเลกชัน: 【{name}】',
    declaringOriginal: '🛡️ กำลังยื่นขอประกาศต้นฉบับและยอมรับข้อตกลง...',
    declaredOriginalSuccess: '✅ ประกาศต้นฉบับได้รับการยืนยันแล้ว!',
    markingAiGenerated: '🤖 กำลังทำเครื่องหมายเป็น 【เนื้อหาที่สร้างโดย AI】...',
    markedAiSuccess: '✅ กำหนดค่าเครื่องหมาย AI สำเร็จแล้ว!',
    schedulingPublish: '⏰ กำลังกำหนดเวลาเผยแพร่: {time}...',
    scheduledSuccess: '✅ ตั้งเวลาเผยแพร่สำเร็จแล้ว!',

    submittingPublish: '🚀 กำลังคลิกปุ่ม 【เผยแพร่】 สุดท้ายเพื่อส่งวิดีโอ...',
    clickedPublishBtn: '🖱️ คลิกปุ่ม 【{btn}】 แล้ว กำลังตรวจสอบการแปลงรหัสและผลลัพธ์...',
    waitingTranscode: '⏳ กำลังรอแพลตฟอร์มแปลงรหัสและยืนยันผลลัพธ์...',
    waitingTranscodeTick: '⏳ กำลังรอการแปลงรหัส ({elapsed} วินาที)...',
    publishSuccessDetected: '🎉 ตรวจพบการเผยแพร่สำเร็จ! เผยแพร่วิดีโอสั้นไปยัง 【{platform}】 แล้ว!'
  },

  id: {
    platformNameWechat: 'WeChat Channels',
    platformNameXhs: 'Xiaohongshu',

    publishAborted: 'Tugas publikasi video dibatalkan oleh pengguna',
    tabClosed: 'Pengguna menutup tab 【{platform}】, tugas publikasi otomatis dihentikan',
    fileNotFound: 'File video lokal tidak ditemukan: {path}',
    windowDestroyed: 'Jendela target ditutup, tidak dapat melanjutkan publikasi',
    loginTimeout: 'Batas waktu login pengguna habis (lebih dari {minutes} menit)',
    publishTimeout: 'Batas waktu publikasi habis, platform gagal menyelesaikan transcode & publikasi tepat waktu',
    publishSuccess: 'Video pendek berhasil dipublikasikan ke 【{platform}】!',
    publishFailed: 'Publikasi ke 【{platform}】 gagal: {error}',

    waitingLogin: '⏳ Sesi login tidak terdeteksi. Silakan pindai kode QR di jendela 【{platform}】...',
    waitingLoginTick: '⏳ Menunggu pemindaian kode QR 【{platform}】 ({elapsed} detik)...',
    loginSuccess: '✅ Berhasil login ke 【{platform}】! Mempersiapkan halaman publikasi...',
    switchedToQrMode: '⏳ Dialihkan otomatis ke mode 【Pindai QR Kode Aplikasi】...',

    checkingPublishPage: '🔍 Memeriksa apakah berada di halaman publikasi video...',
    alreadyOnPublishPage: '✅ Saat ini berada di halaman publikasi video',
    findingPublishEntry: '⏳ Mencari dan mengklik tombol 【{btn}】 untuk masuk ke halaman buat baru...',
    clickedPublishEntry: '🖱️ Menemukan tombol 【{btn}】, mengklik untuk masuk ke halaman publikasi...',
    enteredPublishPageSuccess: '✅ Berhasil masuk ke halaman publikasi video!',
    fallbackDirectNav: '⏳ Alternatif: Menavigasi langsung melalui URL...',
    waitingPageReady: '⏳ Menunggu antarmuka publikasi 【{platform}】 selesai dimuat...',
    waitingPageReadyTick: '⏳ Menunggu antarmuka publikasi selesai dimuat ({elapsed} detik)...',
    pageReadySuccess: '✅ Antarmuka publikasi 【{platform}】 telah siap sepenuhnya!',
    pageReadyTimeout: '⚠️ Waktu muat halaman habis, melanjutkan langkah berikutnya...',
    dismissedDialog: 'Mendeteksi dialog info/perjanjian, mengklik 【{btn}】 untuk menutup!',

    preparingCdpUpload: 'Mempersiapkan pengunggahan file video lokal via CDP asli...',
    uploadRetry: '⚠️ Tidak berada di halaman publikasi, menavigasi ulang...',
    uploadSuccess: '✅ Berhasil mengunggah file video via CDP asli! (Percobaan {attempt})',
    uploadAttemptFailed: 'Kesalahan unggah CDP ({attempt}): {error}',
    interceptedFileChooser: '✅ Berhasil mengunggah video melalui pencegat pemilih file!',
    waitingFormReady: '⏳ Menunggu 【{platform}】 memproses video dan memuat formulir...',
    waitingFormReadyTick: '⏳ Menunggu pemrosesan video dan pemuatan formulir ({elapsed} detik)...',
    formReadySuccess: '✅ Formulir publikasi 【{platform}】 telah siap sepenuhnya!',
    formReadyTimeout: '❌ Waktu tunggu formulir publikasi 【{platform}】 habis!',
    deletingCurrentVideo: '🗑️ Mencoba membatalkan dan menghapus file video saat ini...',
    deletedVideoSuccess: '✅ Video abnormal dihapus, halaman dikembalikan ke status siap unggah!',
    reuploadTriggered: 'Memicu operasi 【Unggah Ulang】 secara langsung',

    fillingShortTitle: '✍️ Memasukkan judul pendek 【{title}】...',
    fillingTitle: '✍️ Memasukkan judul catatan 【{title}】...',
    fillingDescription: '✍️ Memasukkan deskripsi video dan tagar...',
    fieldFilledSuccess: '✅ 【{field}】 berhasil dimasukkan dan diverifikasi!',
    addingTag: '🏷️ Menambahkan tagar #{tag}...',
    locatingInput: '[{field}] Menemukan kotak input target (dengan tembusan Shadow DOM)...',
    inputLocated: '[{field}] ✅ Berhasil mengunci koordinat fisik ({x}, {y})!',
    inputNotFound: '[{field}] ❌ Tidak ditemukan elemen input yang valid!',
    focusingInput: '[{field}] Mengklik kotak input untuk fokus...',
    typingHumanLike: '[{field}] Mengetik teks dengan kecepatan alami seperti manusia...',

    configuringAdvanced: '⚙️ Mengonfigurasi opsi lanjutan (Lokasi/Koleksi/Jadwal/Orisinal/AI)...',
    waitingAdvancedMounted: '⏳ Menunggu komponen opsi lanjutan terpasang...',
    settingLocationNone: '📍 Menyetel lokasi ke 【Jangan Tampilkan Lokasi】',
    settingCollection: '📚 Mengonfigurasi penambahan ke koleksi: 【{name}】',
    declaringOriginal: '🛡️ Mengajukan pernyataan orisinalitas & menyetujui syarat kreator...',
    declaredOriginalSuccess: '✅ Pernyataan orisinalitas berhasil dipilih dan dikonfirmasi!',
    markingAiGenerated: '🤖 Menandai video sebagai 【Konten buatan AI】...',
    markedAiSuccess: '✅ Penandaan buatan AI berhasil dikonfigurasi!',
    schedulingPublish: '⏰ Mengonfigurasi waktu publikasi terjadwal: {time}...',
    scheduledSuccess: '✅ Waktu publikasi terjadwal berhasil disetel!',

    submittingPublish: '🚀 Mengklik tombol 【Publikasikan】 terakhir untuk mengirim video...',
    clickedPublishBtn: '🖱️ Mengklik tombol 【{btn}】, memantau transcode dan hasil akhir...',
    waitingTranscode: '⏳ Menunggu platform menyelesaikan transcode dan konfirmasi akhir...',
    waitingTranscodeTick: '⏳ Menunggu proses transcode ({elapsed} detik)...',
    publishSuccessDetected: '🎉 Publikasi berhasil terdeteksi! Video telah dipublikasikan ke 【{platform}】!'
  },

  es: {
    platformNameWechat: 'WeChat Channels',
    platformNameXhs: 'Xiaohongshu',

    publishAborted: 'La tarea de publicación de video fue cancelada por el usuario',
    tabClosed: 'El usuario cerró la pestaña de 【{platform}】, la publicación automática fue abortada',
    fileNotFound: 'El archivo de video local no existe: {path}',
    windowDestroyed: 'La ventana de destino está cerrada, no se puede continuar la publicación',
    loginTimeout: 'Tiempo de espera de inicio de sesión agotado (más de {minutes} minutos)',
    publishTimeout: 'Tiempo de publicación agotado, la plataforma no completó la transcodificación a tiempo',
    publishSuccess: '¡Video corto publicado con éxito en 【{platform}】!',
    publishFailed: 'Error al publicar en 【{platform}】: {error}',

    waitingLogin: '⏳ No se detectó sesión válida. Escanee el código QR en la ventana de 【{platform}】...',
    waitingLoginTick: '⏳ Esperando inicio de sesión con código QR de 【{platform}】 ({elapsed}s transcurridos)...',
    loginSuccess: '✅ ¡Inicio de sesión exitoso en 【{platform}】! Preparando página de publicación...',
    switchedToQrMode: '⏳ Sesión no detectada, cambiado al modo 【Escaneo de código QR de la aplicación】...',

    checkingPublishPage: '🔍 Comprobando si se encuentra en la página de publicación de videos...',
    alreadyOnPublishPage: '✅ Actualmente en la página de publicación de videos',
    findingPublishEntry: '⏳ Buscando y haciendo clic en 【{btn}】 para ingresar a la página de creación...',
    clickedPublishEntry: '🖱️ Botón 【{btn}】 encontrado, haciendo clic para ingresar a la página de publicación...',
    enteredPublishPageSuccess: '✅ ¡Ingreso exitoso a la página de publicación de videos!',
    fallbackDirectNav: '⏳ Plan de respaldo: Navegando directamente mediante URL...',
    waitingPageReady: '⏳ Esperando que la interfaz de publicación de 【{platform}】 termine de cargar...',
    waitingPageReadyTick: '⏳ Esperando que la interfaz de publicación termine de cargar ({elapsed}s)...',
    pageReadySuccess: '✅ ¡La interfaz de publicación de 【{platform}】 está completamente lista!',
    pageReadyTimeout: '⚠️ Tiempo de espera agotado, intentando continuar con el siguiente paso...',
    dismissedDialog: '¡Diálogo de aviso detectado, se hizo clic en 【{btn}】 para cerrarlo!',

    preparingCdpUpload: 'Preparando la subida del archivo de video local mediante CDP nativo...',
    uploadRetry: '⚠️ Fuera de la página de publicación, navegando de nuevo...',
    uploadSuccess: '✅ ¡Archivo de video subido con éxito mediante CDP! (Intento {attempt})',
    uploadAttemptFailed: 'Error en el intento de subida por CDP ({attempt}): {error}',
    interceptedFileChooser: '✅ ¡Video subido con éxito mediante interceptor de selector de archivos!',
    waitingFormReady: '⏳ Esperando que 【{platform}】 analice el video y cargue el formulario...',
    waitingFormReadyTick: '⏳ Esperando análisis del video y carga del formulario ({elapsed}s)...',
    formReadySuccess: '✅ ¡El formulario de publicación de 【{platform}】 está listo!',
    formReadyTimeout: '❌ ¡Tiempo de espera agotado para cargar el formulario de 【{platform}】!',
    deletingCurrentVideo: '🗑️ Intentando cancelar y eliminar el archivo de video actual...',
    deletedVideoSuccess: '✅ ¡Video anormal eliminado, la página está lista para subir de nuevo!',
    reuploadTriggered: 'Operación 【Volver a subir】 ejecutada directamente',

    fillingShortTitle: '✍️ Ingresando título corto 【{title}】...',
    fillingTitle: '✍️ Ingresando título de la nota 【{title}】...',
    fillingDescription: '✍️ Ingresando descripción del video y etiquetas hashtag...',
    fieldFilledSuccess: '✅ ¡【{field}】 ingresado y verificado con éxito!',
    addingTag: '🏷️ Agregando hashtag #{tag}...',
    locatingInput: '[{field}] Localizando campo de entrada (con penetración Shadow DOM)...',
    inputLocated: '[{field}] ✅ ¡Coordenadas físicas bloqueadas con éxito ({x}, {y})!',
    inputNotFound: '[{field}] ❌ ¡No se encontró ningún elemento de entrada válido!',
    focusingInput: '[{field}] Haciendo clic en el campo para enfocar...',
    typingHumanLike: '[{field}] Escribiendo texto simulando pulsaciones humanas...',

    configuringAdvanced: '⚙️ Configurando opciones avanzadas (Ubicación/Colección/Programar/Original/IA)...',
    waitingAdvancedMounted: '⏳ Esperando que los componentes de opciones avanzadas se carguen...',
    settingLocationNone: '📍 Ubicación configurada como 【No mostrar ubicación】',
    settingCollection: '📚 Configurada la adición a la colección: 【{name}】',
    declaringOriginal: '🛡️ Solicitando declaración de originalidad y aceptando acuerdos...',
    declaredOriginalSuccess: '✅ ¡Declaración de originalidad seleccionada y confirmada!',
    markingAiGenerated: '🤖 Marcando video como 【Contenido generado por IA】...',
    markedAiSuccess: '✅ ¡Etiqueta de IA configurada con éxito!',
    schedulingPublish: '⏰ Configurando hora de publicación programada: {time}...',
    scheduledSuccess: '✅ ¡Hora de publicación programada establecida con éxito!',

    submittingPublish: '🚀 Haciendo clic en el botón 【Publicar】 final para enviar el video...',
    clickedPublishBtn: '🖱️ Clic en el botón 【{btn}】 realizado, monitoreando transcodificación y resultado...',
    waitingTranscode: '⏳ Esperando transcodificación de la plataforma y confirmación final...',
    waitingTranscodeTick: '⏳ Esperando transcodificación ({elapsed}s)...',
    publishSuccessDetected: '🎉 ¡Publicación exitosa detectada! ¡El video se ha publicado en 【{platform}】!'
  },

  fr: {
    platformNameWechat: 'WeChat Channels',
    platformNameXhs: 'Xiaohongshu',

    publishAborted: 'La tâche de publication vidéo a été annulée par l\'utilisateur',
    tabClosed: 'L\'utilisateur a fermé l\'onglet 【{platform}】, la publication automatique est annulée',
    fileNotFound: 'Le fichier vidéo local n\'existe pas : {path}',
    windowDestroyed: 'La fenêtre cible est fermée, impossible de continuer',
    loginTimeout: 'Délai d\'attente de connexion dépassé (plus de {minutes} min)',
    publishTimeout: 'Délai de publication dépassé, transcodage non terminé à temps',
    publishSuccess: 'Vidéo courte publiée avec succès sur 【{platform}】 !',
    publishFailed: 'Échec de la publication sur 【{platform}】 : {error}',

    waitingLogin: '⏳ Aucune session valide. Veuillez scanner le code QR dans la fenêtre 【{platform}】...',
    waitingLoginTick: '⏳ En attente de connexion par code QR sur 【{platform}】 ({elapsed}s)...',
    loginSuccess: '✅ Connexion à 【{platform}】 réussie ! Préparation de la page de publication...',
    switchedToQrMode: '⏳ Basculement automatique en mode 【Scan du code QR de l\'application】...',

    checkingPublishPage: '🔍 Vérification de la présence sur la page de publication vidéo...',
    alreadyOnPublishPage: '✅ Actuellement sur la page de publication vidéo',
    findingPublishEntry: '⏳ Recherche et clic sur le bouton 【{btn}】 pour accéder à la création...',
    clickedPublishEntry: '🖱️ Bouton 【{btn}】 trouvé, clic pour entrer dans la page de publication...',
    enteredPublishPageSuccess: '✅ Accès à la page de publication réussi !',
    fallbackDirectNav: '⏳ Solution de secours : Navigation directe via l\'URL...',
    waitingPageReady: '⏳ En attente du chargement complet de l\'interface 【{platform}】...',
    waitingPageReadyTick: '⏳ En attente du chargement de l\'interface ({elapsed}s)...',
    pageReadySuccess: '✅ L\'interface de publication 【{platform}】 est prête !',
    pageReadyTimeout: '⚠️ Délai de chargement dépassé, passage à l\'étape suivante...',
    dismissedDialog: 'Dialogue d\'information détecté, clic sur 【{btn}】 pour fermer !',

    preparingCdpUpload: 'Préparation du téléversement du fichier vidéo via CDP natif...',
    uploadRetry: '⚠️ Hors page de publication, nouvelle navigation en cours...',
    uploadSuccess: '✅ Vidéo téléversée avec succès via CDP ! (Tentative {attempt})',
    uploadAttemptFailed: 'Erreur lors de la tentative de téléversement CDP ({attempt}) : {error}',
    interceptedFileChooser: '✅ Vidéo téléversée avec succès via le sélecteur de fichiers intercepté !',
    waitingFormReady: '⏳ En attente de l\'analyse vidéo et du formulaire par 【{platform}】...',
    waitingFormReadyTick: '⏳ En attente de l\'analyse vidéo et du formulaire ({elapsed}s)...',
    formReadySuccess: '✅ Le formulaire de publication 【{platform}】 est prêt !',
    formReadyTimeout: '❌ Délai d\'attente du formulaire de publication dépassé !',
    deletingCurrentVideo: '🗑️ Tentative d\'annulation et de suppression du fichier actuel...',
    deletedVideoSuccess: '✅ Vidéo anormale supprimée, page prête pour un nouveau téléversement !',
    reuploadTriggered: 'Opération 【Re-téléverser】 déclenchée directement',

    fillingShortTitle: '✍️ Saisie du titre court 【{title}】...',
    fillingTitle: '✍️ Saisie du titre de la note 【{title}】...',
    fillingDescription: '✍️ Saisie de la description vidéo et des hashtags...',
    fieldFilledSuccess: '✅ 【{field}】 saisi et vérifié avec succès !',
    addingTag: '🏷️ Ajout du hashtag #{tag}...',
    locatingInput: '[{field}] Localisation du champ de saisie (avec Shadow DOM)...',
    inputLocated: '[{field}] ✅ Coordonnées physiques verrouillées ({x}, {y}) !',
    inputNotFound: '[{field}] ❌ Aucun champ de saisie valide trouvé !',
    focusingInput: '[{field}] Clic pour focaliser le champ de saisie...',
    typingHumanLike: '[{field}] Saisie du texte simulant une frappe humaine...',

    configuringAdvanced: '⚙️ Configuration des options avancées (Lieu/Collection/Planification/Original/IA)...',
    waitingAdvancedMounted: '⏳ En attente du montage des composants d\'options avancées...',
    settingLocationNone: '📍 Emplacement défini sur 【Ne pas afficher le lieu】',
    settingCollection: '📚 Ajout à la collection configuré : 【{name}】',
    declaringOriginal: '🛡️ Demande de déclaration d\'originalité et signature de l\'accord...',
    declaredOriginalSuccess: '✅ Déclaration d\'originalité cochée et confirmée !',
    markingAiGenerated: '🤖 Marquage de la vidéo comme 【Contenu généré par IA】...',
    markedAiSuccess: '✅ Marquage généré par IA configuré avec succès !',
    schedulingPublish: '⏰ Configuration de l\'heure de publication planifiée : {time}...',
    scheduledSuccess: '✅ Heure de publication planifiée configurée avec succès !',

    submittingPublish: '🚀 Clic sur le bouton final 【Publier】 pour soumettre la vidéo...',
    clickedPublishBtn: '🖱️ Clic sur 【{btn}】 effectué, suivi du transcodage et du résultat final...',
    waitingTranscode: '⏳ En attente du transcodage et de la confirmation finale...',
    waitingTranscodeTick: '⏳ En attente du transcodage ({elapsed}s)...',
    publishSuccessDetected: '🎉 Publication réussie détectée ! La vidéo a été publiée sur 【{platform}】 !'
  },

  pt: {
    platformNameWechat: 'WeChat Channels',
    platformNameXhs: 'Xiaohongshu',

    publishAborted: 'A publicação do vídeo foi cancelada pelo usuário',
    tabClosed: 'O usuário fechou a aba 【{platform}】, a publicação automática foi interrompida',
    fileNotFound: 'O arquivo de vídeo local não existe: {path}',
    windowDestroyed: 'A janela de destino foi fechada, não é possível continuar',
    loginTimeout: 'Tempo limite de login excedido (mais de {minutes} min)',
    publishTimeout: 'Tempo limite de publicação excedido, transcodificação não finalizada a tempo',
    publishSuccess: 'Vídeo curto publicado com sucesso no 【{platform}】!',
    publishFailed: 'Falha na publicação no 【{platform}】: {error}',

    waitingLogin: '⏳ Nenhuma sessão válida detectada. Escaneie o código QR na janela 【{platform}】...',
    waitingLoginTick: '⏳ Aguardando leitura do código QR do 【{platform}】 ({elapsed}s decorridos)...',
    loginSuccess: '✅ Login no 【{platform}】 realizado com sucesso! Preparando página...',
    switchedToQrMode: '⏳ Alternado automaticamente para o modo 【Escanear QR Code do Aplicativo】...',

    checkingPublishPage: '🔍 Verificando se está na página de publicação de vídeo...',
    alreadyOnPublishPage: '✅ Atualmente na página de publicação de vídeo',
    findingPublishEntry: '⏳ Localizando e clicando no botão 【{btn}】 para criar nova publicação...',
    clickedPublishEntry: '🖱️ Botão 【{btn}】 encontrado, clicando para abrir a página de publicação...',
    enteredPublishPageSuccess: '✅ Acesso à página de publicação de vídeo concluído com sucesso!',
    fallbackDirectNav: '⏳ Alternativa: Navegando diretamente via URL...',
    waitingPageReady: '⏳ Aguardando carregamento e renderização da página de 【{platform}】...',
    waitingPageReadyTick: '⏳ Aguardando carregamento da página de publicação ({elapsed}s)...',
    pageReadySuccess: '✅ A página de publicação do 【{platform}】 está pronta!',
    pageReadyTimeout: '⚠️ Tempo limite de carregamento da página atingido, tentando prosseguir...',
    dismissedDialog: 'Aviso detectado, clicado em 【{btn}】 para fechar!',

    preparingCdpUpload: 'Preparando envio do arquivo de vídeo local via CDP nativo...',
    uploadRetry: '⚠️ Fora da página de publicação, navegando novamente...',
    uploadSuccess: '✅ Vídeo enviado com sucesso via CDP nativo! (Tentativa {attempt})',
    uploadAttemptFailed: 'Erro na tentativa de envio via CDP ({attempt}): {error}',
    interceptedFileChooser: '✅ Vídeo enviado com sucesso pelo seletor de arquivos interceptado!',
    waitingFormReady: '⏳ Aguardando o 【{platform}】 analisar o vídeo e carregar o formulário...',
    waitingFormReadyTick: '⏳ Aguardando análise do vídeo e formulário ({elapsed}s)...',
    formReadySuccess: '✅ O formulário de publicação do 【{platform}】 está pronto!',
    formReadyTimeout: '❌ Tempo limite para carregar o formulário do 【{platform}】!',
    deletingCurrentVideo: '🗑️ Tentando cancelar e remover o arquivo de vídeo atual...',
    deletedVideoSuccess: '✅ Vídeo anormal removido, página pronta para novo envio!',
    reuploadTriggered: 'Operação 【Reenviar】 disparada diretamente',

    fillingShortTitle: '✍️ Inserindo título curto 【{title}】...',
    fillingTitle: '✍️ Inserindo título da nota 【{title}】...',
    fillingDescription: '✍️ Inserindo descrição do vídeo e hashtags...',
    fieldFilledSuccess: '✅ 【{field}】 inserido e validado com sucesso!',
    addingTag: '🏷️ Adicionando hashtag #{tag}...',
    locatingInput: '[{field}] Localizando campo de entrada (com Shadow DOM)...',
    inputLocated: '[{field}] ✅ Coordenadas físicas bloqueadas com sucesso ({x}, {y})!',
    inputNotFound: '[{field}] ❌ Nenhum elemento de entrada válido encontrado!',
    focusingInput: '[{field}] Clicando no campo para focar...',
    typingHumanLike: '[{field}] Digitando texto simulando velocidade humana...',

    configuringAdvanced: '⚙️ Configurando opções avançadas (Local/Coleção/Agendar/Original/IA)...',
    waitingAdvancedMounted: '⏳ Aguardando montagem dos componentes avançados...',
    settingLocationNone: '📍 Localização definida como 【Não mostrar localização】',
    settingCollection: '📚 Configurada adição à coleção: 【{name}】',
    declaringOriginal: '🛡️ Solicitando declaração de originalidade e aceitando termos...',
    declaredOriginalSuccess: '✅ Declaração de originalidade confirmada!',
    markingAiGenerated: '🤖 Marcando vídeo como 【Conteúdo gerado por IA】...',
    markedAiSuccess: '✅ Marcação de IA configurada com sucesso!',
    schedulingPublish: '⏰ Configurando horário de publicação agendada: {time}...',
    scheduledSuccess: '✅ Horário de publicação agendada definido com sucesso!',

    submittingPublish: '🚀 Clicando no botão final 【Publicar】 para enviar o vídeo...',
    clickedPublishBtn: '🖱️ Botão 【{btn}】 clicado, monitorando transcodificação e resultado...',
    waitingTranscode: '⏳ Aguardando transcodificação e confirmação final...',
    waitingTranscodeTick: '⏳ Aguardando transcodificação ({elapsed}s)...',
    publishSuccessDetected: '🎉 Publicação bem-sucedida! O vídeo foi postado no 【{platform}】!'
  },

  de: {
    platformNameWechat: 'WeChat Channels',
    platformNameXhs: 'Xiaohongshu',

    publishAborted: 'Die Videoveröffentlichung wurde vom Benutzer abgebrochen',
    tabClosed: 'Der Benutzer hat den Tab 【{platform}】 geschlossen, die Veröffentlichung wurde abgebrochen',
    fileNotFound: 'Lokale Videodatei nicht gefunden: {path}',
    windowDestroyed: 'Zielfenster wurde geschlossen, Veröffentlichung kann nicht fortgesetzt werden',
    loginTimeout: 'Benutzer-Login-Zeitüberschreitung (über {minutes} Min.)',
    publishTimeout: 'Veröffentlichungs-Zeitüberschreitung, Plattform konnte nicht rechtzeitig abschließen',
    publishSuccess: 'Kurzvideo erfolgreich auf 【{platform}】 veröffentlicht!',
    publishFailed: 'Veröffentlichung auf 【{platform}】 fehlgeschlagen: {error}',

    waitingLogin: '⏳ Keine gültige Sitzung erkannt. Bitte scannen Sie den QR-Code im Fenster 【{platform}】...',
    waitingLoginTick: '⏳ Warten auf QR-Code-Login für 【{platform}】 ({elapsed}s vergangen)...',
    loginSuccess: '✅ Erfolgreich bei 【{platform}】 angemeldet! Seite wird vorbereitet...',
    switchedToQrMode: '⏳ Automatisch auf 【App-QR-Code-Scan】 umgeschaltet...',

    checkingPublishPage: '🔍 Prüfen, ob sich der Browser auf der Video-Veröffentlichungsseite befindet...',
    alreadyOnPublishPage: '✅ Befindet sich bereits auf der Video-Veröffentlichungsseite',
    findingPublishEntry: '⏳ Schaltfläche 【{btn}】 wird gesucht und geklickt...',
    clickedPublishEntry: '🖱️ Schaltfläche 【{btn}】 gefunden, Weiterleitung zur Veröffentlichungsseite...',
    enteredPublishPageSuccess: '✅ Erfolgreich zur Video-Veröffentlichungsseite navigiert!',
    fallbackDirectNav: '⏳ Ausweichplan: Direkte Navigation über URL...',
    waitingPageReady: '⏳ Warten auf vollständiges Laden der 【{platform}】-Seite...',
    waitingPageReadyTick: '⏳ Warten auf Laden der Veröffentlichungsseite ({elapsed}s)...',
    pageReadySuccess: '✅ Veröffentlichungsoberfläche von 【{platform}】 ist bereit!',
    pageReadyTimeout: '⚠️ Ladezeitüberschreitung, versuche mit dem nächsten Schritt fortzufahren...',
    dismissedDialog: 'Hinweisdialog erkannt, mit Klick auf 【{btn}】 geschlossen!',

    preparingCdpUpload: 'Vorbereitung des Video-Uploads über natives CDP...',
    uploadRetry: '⚠️ Nicht auf der Veröffentlichungsseite, navigiere erneut...',
    uploadSuccess: '✅ Video über natives CDP erfolgreich hochgeladen! (Versuch {attempt})',
    uploadAttemptFailed: 'Fehler beim CDP-Upload-Versuch ({attempt}): {error}',
    interceptedFileChooser: '✅ Video erfolgreich über abgefangenen Dateidialog hochgeladen!',
    waitingFormReady: '⏳ Warten auf Videoanalyse und Laden des Veröffentlichungsformulars...',
    waitingFormReadyTick: '⏳ Warten auf Videoanalyse und Formular ({elapsed}s)...',
    formReadySuccess: '✅ Veröffentlichungsformular von 【{platform}】 ist bereit!',
    formReadyTimeout: '❌ Zeitüberschreitung beim Laden des Veröffentlichungsformulars!',
    deletingCurrentVideo: '🗑️ Aktuelle Videodatei wird abgebrochen und gelöscht...',
    deletedVideoSuccess: '✅ Fehlerhaftes Video gelöscht, Seite ist wieder bereit zum Hochladen!',
    reuploadTriggered: 'Aktion 【Erneut hochladen】 direkt ausgelöst',

    fillingShortTitle: '✍️ Kurztitel 【{title}】 wird eingegeben...',
    fillingTitle: '✍️ Notiztitel 【{title}】 wird eingegeben...',
    fillingDescription: '✍️ Videobeschreibung und Hashtags werden eingegeben...',
    fieldFilledSuccess: '✅ 【{field}】 erfolgreich eingegeben und validiert!',
    addingTag: '🏷️ Hashtag #{tag} wird hinzugefügt...',
    locatingInput: '[{field}] Eingabefeld wird lokalisiert (mit Shadow-DOM-Durchdringung)...',
    inputLocated: '[{field}] ✅ Physische Koordinaten ({x}, {y}) erfolgreich fixiert!',
    inputNotFound: '[{field}] ❌ Kein gültiges Eingabeelement gefunden!',
    focusingInput: '[{field}] Klick auf Eingabefeld zum Fokussieren...',
    typingHumanLike: '[{field}] Text wird mit natürlicher Tippgeschwindigkeit eingegeben...',

    configuringAdvanced: '⚙️ Erweiterte Optionen werden konfiguriert (Ort/Sammlung/Planung/Original/KI)...',
    waitingAdvancedMounted: '⏳ Warten auf Komponenten der erweiterten Optionen...',
    settingLocationNone: '📍 Standort auf 【Standort nicht anzeigen】 festgelegt',
    settingCollection: '📚 Hinzufügen zur Sammlung konfiguriert: 【{name}】',
    declaringOriginal: '🛡️ Originalitätserklärung wird beantragt und Vereinbarung akzeptiert...',
    declaredOriginalSuccess: '✅ Originalitätserklärung erfolgreich bestätigt!',
    markingAiGenerated: '🤖 Video wird als 【KI-generierter Inhalt】 gekennzeichnet...',
    markedAiSuccess: '✅ KI-Kennzeichnung erfolgreich konfiguriert!',
    schedulingPublish: '⏰ Geplante Veröffentlichungszeit wird eingestellt: {time}...',
    scheduledSuccess: '✅ Geplante Veröffentlichungszeit erfolgreich festgelegt!',

    submittingPublish: '🚀 Klick auf 【Veröffentlichen】, um das Video einzureichen...',
    clickedPublishBtn: '🖱️ Klick auf 【{btn}】 ausgeführt, Transkodierung wird überwacht...',
    waitingTranscode: '⏳ Warten auf Transkodierung und finale Bestätigung...',
    waitingTranscodeTick: '⏳ Warten auf Transkodierung ({elapsed}s)...',
    publishSuccessDetected: '🎉 Erfolgreiche Veröffentlichung erkannt! Video wurde auf 【{platform}】 veröffentlicht!'
  },

  it: {
    platformNameWechat: 'WeChat Channels',
    platformNameXhs: 'Xiaohongshu',

    publishAborted: 'La pubblicazione del video è stata annullata dall\'utente',
    tabClosed: 'L\'utente ha chiuso la scheda 【{platform}】, la pubblicazione automatica è interrotta',
    fileNotFound: 'Il file video locale non esiste: {path}',
    windowDestroyed: 'La finestra di destinazione è stata chiusa, impossibile continuare',
    loginTimeout: 'Timeout di accesso utente (superati {minutes} min)',
    publishTimeout: 'Timeout di pubblicazione, transcodifica non completata in tempo',
    publishSuccess: 'Video breve pubblicato con successo su 【{platform}】!',
    publishFailed: 'Pubblicazione su 【{platform}】 non riuscita: {error}',

    waitingLogin: '⏳ Nessuna sessione valida rilevata. Scansiona il codice QR nella finestra 【{platform}】...',
    waitingLoginTick: '⏳ In attesa della scansione QR per 【{platform}】 ({elapsed}s trascorsi)...',
    loginSuccess: '✅ Accesso a 【{platform}】 riuscito! Preparazione della pagina di pubblicazione...',
    switchedToQrMode: '⏳ Passaggio automatico alla modalità 【Scansione QR Code dall\'App】...',

    checkingPublishPage: '🔍 Verifica della presenza sulla pagina di pubblicazione video...',
    alreadyOnPublishPage: '✅ Attualmente sulla pagina di pubblicazione video',
    findingPublishEntry: '⏳ Ricerca e clic sul pulsante 【{btn}】 per entrare nella pagina...',
    clickedPublishEntry: '🖱️ Pulsante 【{btn}】 trovato, clic per accedere alla pubblicazione...',
    enteredPublishPageSuccess: '✅ Accesso alla pagina di pubblicazione completato con successo!',
    fallbackDirectNav: '⏳ Alternativa: Navigazione diretta tramite URL...',
    waitingPageReady: '⏳ In attesa del caricamento della pagina di 【{platform}】...',
    waitingPageReadyTick: '⏳ In attesa del caricamento della pagina ({elapsed}s)...',
    pageReadySuccess: '✅ L\'interfaccia di pubblicazione di 【{platform}】 è pronta!',
    pageReadyTimeout: '⚠️ Timeout caricamento pagina, tentativo di procedere al passaggio successivo...',
    dismissedDialog: 'Finestra di notifica rilevata, cliccato su 【{btn}】 per chiudere!',

    preparingCdpUpload: 'Preparazione del caricamento del video tramite CDP nativo...',
    uploadRetry: '⚠️ Fuori dalla pagina di pubblicazione, navigazione di nuovo in corso...',
    uploadSuccess: '✅ Video caricato con successo tramite CDP! (Tentativo {attempt})',
    uploadAttemptFailed: 'Errore nel tentativo di caricamento CDP ({attempt}): {error}',
    interceptedFileChooser: '✅ Video caricato con successo tramite selettore di file intercettato!',
    waitingFormReady: '⏳ In attesa dell\'analisi video e caricamento del modulo su 【{platform}】...',
    waitingFormReadyTick: '⏳ In attesa dell\'analisi video e del modulo ({elapsed}s)...',
    formReadySuccess: '✅ Il modulo di pubblicazione di 【{platform}】 è pronto!',
    formReadyTimeout: '❌ Timeout durante il caricamento del modulo di pubblicazione!',
    deletingCurrentVideo: '🗑️ Tentativo di annullamento e rimozione del video attuale...',
    deletedVideoSuccess: '✅ Video anomalo rimosso, pagina pronta per un nuovo caricamento!',
    reuploadTriggered: 'Operazione 【Ricarica】 attivata direttamente',

    fillingShortTitle: '✍️ Inserimento titolo breve 【{title}】...',
    fillingTitle: '✍️ Inserimento titolo nota 【{title}】...',
    fillingDescription: '✍️ Inserimento descrizione video e hashtag...',
    fieldFilledSuccess: '✅ 【{field}】 inserito e verificato con successo!',
    addingTag: '🏷️ Aggiunta hashtag #{tag}...',
    locatingInput: '[{field}] Localizzazione campo di input (con penetrazione Shadow DOM)...',
    inputLocated: '[{field}] ✅ Coordinate fisiche bloccate con successo ({x}, {y})!',
    inputNotFound: '[{field}] ❌ Nessun elemento di input valido trovato!',
    focusingInput: '[{field}] Clic sul campo per attivare il focus...',
    typingHumanLike: '[{field}] Digitazione del testo simulando la velocità umana...',

    configuringAdvanced: '⚙️ Configurazione opzioni avanzate (Luogo/Raccolta/Pianificazione/Originale/IA)...',
    waitingAdvancedMounted: '⏳ In attesa del montaggio dei componenti opzioni avanzate...',
    settingLocationNone: '📍 Posizione impostata su 【Non mostrare posizione】',
    settingCollection: '📚 Aggiunta alla raccolta configurata: 【{name}】',
    declaringOriginal: '🛡️ Richiesta dichiarazione di originalità e accettazione accordi...',
    declaredOriginalSuccess: '✅ Dichiarazione di originalità confermata!',
    markingAiGenerated: '🤖 Contrassegno del video come 【Contenuto generato da IA】...',
    markedAiSuccess: '✅ Contrassegno generato da IA configurato con successo!',
    schedulingPublish: '⏰ Configurazione orario di pubblicazione pianificata: {time}...',
    scheduledSuccess: '✅ Orario di pubblicazione pianificata impostato con successo!',

    submittingPublish: '🚀 Clic sul pulsante 【Pubblica】 per inviare il video...',
    clickedPublishBtn: '🖱️ Clic su 【{btn}】 effettuato, monitoraggio della transcodifica in corso...',
    waitingTranscode: '⏳ In attesa della transcodifica e della conferma finale...',
    waitingTranscodeTick: '⏳ In attesa della transcodifica ({elapsed}s)...',
    publishSuccessDetected: '🎉 Pubblicazione riuscita! Il video è stato pubblicato su 【{platform}】!'
  },

  ru: {
    platformNameWechat: 'WeChat Channels',
    platformNameXhs: 'Xiaohongshu',

    publishAborted: 'Публикация видео была отменена пользователем',
    tabClosed: 'Пользователь закрыл вкладку 【{platform}】, публикация прервана',
    fileNotFound: 'Локальный видеофайл не найден: {path}',
    windowDestroyed: 'Целевое окно закрыто, невозможно продолжить публикацию',
    loginTimeout: 'Время ожидания входа пользователя истекло (более {minutes} мин.)',
    publishTimeout: 'Таймаут публикации, платформа не успела завершить кодирование',
    publishSuccess: 'Короткое видео успешно опубликовано на 【{platform}】!',
    publishFailed: 'Ошибка публикации на 【{platform}】: {error}',

    waitingLogin: '⏳ Сессия не обнаружена. Пожалуйста, отсканируйте QR-код в окне 【{platform}】...',
    waitingLoginTick: '⏳ Ожидание входа по QR-коду на 【{platform}】 (прошло {elapsed} сек.)...',
    loginSuccess: '✅ Вход в 【{platform}】 выполнен успешно! Подготовка страницы публикации...',
    switchedToQrMode: '⏳ Автоматическое переключение в режим 【Сканирование QR-кода через приложение】...',

    checkingPublishPage: '🔍 Проверка нахождения на странице публикации видео...',
    alreadyOnPublishPage: '✅ Вы уже находитесь на странице публикации видео',
    findingPublishEntry: '⏳ Поиск и клик по кнопке 【{btn}】 для перехода к созданию...',
    clickedPublishEntry: '🖱️ Кнопка 【{btn}】 найдена, переход на страницу публикации...',
    enteredPublishPageSuccess: '✅ Успешный переход на страницу публикации видео!',
    fallbackDirectNav: '⏳ Резервный вариант: Прямой переход по URL...',
    waitingPageReady: '⏳ Ожидание загрузки интерфейса публикации 【{platform}】...',
    waitingPageReadyTick: '⏳ Ожидание загрузки интерфейса ({elapsed} сек.)...',
    pageReadySuccess: '✅ Интерфейс публикации 【{platform}】 полностью готов!',
    pageReadyTimeout: '⚠️ Время ожидания загрузки страницы истекло, переход к следующему шагу...',
    dismissedDialog: 'Обнаружено диалоговое окно, закрыто кликом по 【{btn}】!',

    preparingCdpUpload: 'Подготовка к загрузке видеофайла через нативный CDP...',
    uploadRetry: '⚠️ Не на странице публикации, повторная навигация...',
    uploadSuccess: '✅ Видео успешно загружено через CDP! (Попытка {attempt})',
    uploadAttemptFailed: 'Ошибка попытки загрузки через CDP ({attempt}): {error}',
    interceptedFileChooser: '✅ Видео успешно загружено через перехваченный диалог файлов!',
    waitingFormReady: '⏳ Ожидание обработки видео и формы публикации на 【{platform}】...',
    waitingFormReadyTick: '⏳ Ожидание обработки видео и формы ({elapsed} сек.)...',
    formReadySuccess: '✅ Форма публикации 【{platform}】 полностью готова!',
    formReadyTimeout: '❌ Время ожидания загрузки формы публикации истекло!',
    deletingCurrentVideo: '🗑️ Попытка отмены и удаления текущего видеофайла...',
    deletedVideoSuccess: '✅ Некорректное видео удалено, страница снова готова к загрузке!',
    reuploadTriggered: 'Действие 【Повторная загрузка】 выполнено напрямую',

    fillingShortTitle: '✍️ Ввод краткого заголовка 【{title}】...',
    fillingTitle: '✍️ Ввод заголовка заметки 【{title}】...',
    fillingDescription: '✍️ Ввод описания видео и хэштегов...',
    fieldFilledSuccess: '✅ Поле 【{field}】 успешно заполнено и проверено!',
    addingTag: '🏷️ Добавление хэштега #{tag}...',
    locatingInput: '[{field}] Поиск поля ввода (с проникновением в Shadow DOM)...',
    inputLocated: '[{field}] ✅ Физические координаты ({x}, {y}) успешно определены!',
    inputNotFound: '[{field}] ❌ Допустимый элемент ввода не найден!',
    focusingInput: '[{field}] Клик по полю для установки фокуса...',
    typingHumanLike: '[{field}] Ввод текста с естественной скоростью набора...',

    configuringAdvanced: '⚙️ Настройка параметров (Место/Коллекция/Расписание/Оригинал/ИИ)...',
    waitingAdvancedMounted: '⏳ Ожидание загрузки компонентов расширенных настроек...',
    settingLocationNone: '📍 Геолокация установлена: 【Не показывать местоположение】',
    settingCollection: '📚 Настроено добавление в коллекцию: 【{name}】',
    declaringOriginal: '🛡️ Запрос подтверждения авторства и принятие соглашений...',
    declaredOriginalSuccess: '✅ Заявление об авторстве подтверждено!',
    markingAiGenerated: '🤖 Установка метки 【Контент создан ИИ】...',
    markedAiSuccess: '✅ Метка ИИ-контента успешно настроена!',
    schedulingPublish: '⏰ Настройка времени отложенной публикации: {time}...',
    scheduledSuccess: '✅ Время отложенной публикации успешно установлено!',

    submittingPublish: '🚀 Клик по кнопке 【Опубликовать】 для отправки видео...',
    clickedPublishBtn: '🖱️ Кнопка 【{btn}】 нажата, мониторинг кодирования и результата...',
    waitingTranscode: '⏳ Ожидание кодирования платформой и финального подтверждения...',
    waitingTranscodeTick: '⏳ Ожидание кодирования ({elapsed} сек.)...',
    publishSuccessDetected: '🎉 Успешная публикация обнаружена! Видео опубликовано на 【{platform}】!'
  },

  tr: {
    platformNameWechat: 'WeChat Channels',
    platformNameXhs: 'Xiaohongshu',

    publishAborted: 'Video yayınlama görevi kullanıcı tarafından iptal edildi',
    tabClosed: 'Kullanıcı 【{platform}】 sekmesini kapattı, otomatik yayınlama iptal edildi',
    fileNotFound: 'Yerel video dosyası bulunamadı: {path}',
    windowDestroyed: 'Hedef pencere kapatıldı, yayınlamaya devam edilemiyor',
    loginTimeout: 'Kullanıcı girişi zaman aşımı ({minutes} dakikayı aştı)',
    publishTimeout: 'Yayınlama zaman aşımı, platform kod dönüştürmeyi zamanında tamamlayamadı',
    publishSuccess: 'Kısa video 【{platform}】 platformunda başarıyla yayınlandı!',
    publishFailed: '【{platform}】 üzerinde yayınlama başarısız: {error}',

    waitingLogin: '⏳ Geçerli bir oturum bulunamadı. Lütfen 【{platform}】 penceresindeki QR kodu tarayın...',
    waitingLoginTick: '⏳ 【{platform}】 QR kod ile giriş bekleniyor ({elapsed} sn geçti)...',
    loginSuccess: '✅ 【{platform}】 girişi başarılı! Yayınlama sayfası hazırlanıyor...',
    switchedToQrMode: '⏳ Otomatik olarak 【Uygulama QR Kodu Tara】 moduna geçildi...',

    checkingPublishPage: '🔍 Video yayınlama sayfasında olup olmadığı kontrol ediliyor...',
    alreadyOnPublishPage: '✅ Şu anda video yayınlama sayfasındasınız',
    findingPublishEntry: '⏳ Yeni oluşturma sayfasına gitmek için 【{btn}】 aranıyor ve tıklanıyor...',
    clickedPublishEntry: '🖱️ 【{btn}】 düğmesi bulundu, yayınlama sayfasına geçiliyor...',
    enteredPublishPageSuccess: '✅ Video yayınlama sayfasına başarıyla girildi!',
    fallbackDirectNav: '⏳ Yedek plan: URL ile doğrudan yayın sayfasına gidiliyor...',
    waitingPageReady: '⏳ 【{platform}】 yayın arayüzünün yüklenmesi bekleniyor...',
    waitingPageReadyTick: '⏳ Yayın arayüzünün yüklenmesi bekleniyor ({elapsed} sn)...',
    pageReadySuccess: '✅ 【{platform}】 yayın arayüzü tamamen hazır!',
    pageReadyTimeout: '⚠️ Sayfa yükleme zaman aşımına uğradı, sonraki adıma geçiliyor...',
    dismissedDialog: 'Bildirim iletişim kutusu algılandı, kapatmak için 【{btn}】 tıklandı!',

    preparingCdpUpload: 'Yerel video dosyası yerel CDP ile yüklenmeye hazırlanıyor...',
    uploadRetry: '⚠️ Yayın sayfasında değil, tekrar yayın sayfasına gidiliyor...',
    uploadSuccess: '✅ Video dosyası CDP ile başarıyla yüklendi! ({attempt}. deneme)',
    uploadAttemptFailed: 'CDP yükleme denemesi hatası ({attempt}): {error}',
    interceptedFileChooser: '✅ Dosya seçici yakalanarak video başarıyla yüklendi!',
    waitingFormReady: '⏳ 【{platform}】 videoyu işlerken ve yayın formunu yüklerken bekleniyor...',
    waitingFormReadyTick: '⏳ Video analizi ve form yüklemesi bekleniyor ({elapsed} sn)...',
    formReadySuccess: '✅ 【{platform}】 yayın formu hazır!',
    formReadyTimeout: '❌ Yayın formu yükleme zaman aşımı!',
    deletingCurrentVideo: '🗑️ Mevcut video dosyası iptal edilmeye ve silinmeye çalışılıyor...',
    deletedVideoSuccess: '✅ Hatalı video silindi, sayfa yeniden yüklemeye hazır!',
    reuploadTriggered: '【Yeniden Yükle】 işlemi doğrudan tetiklendi',

    fillingShortTitle: '✍️ Kısa başlık 【{title}】 giriliyor...',
    fillingTitle: '✍️ Not başlığı 【{title}】 giriliyor...',
    fillingDescription: '✍️ Video açıklaması ve etiketler giriliyor...',
    fieldFilledSuccess: '✅ 【{field}】 başarıyla girildi ve doğrulandı!',
    addingTag: '🏷️ Etiket #{tag} ekleniyor...',
    locatingInput: '[{field}] Giriş kutusu aranıyor (Shadow DOM geçişi dahil)...',
    inputLocated: '[{field}] ✅ Fiziksel koordinatlar ({x}, {y}) başarıyla kilitlendi!',
    inputNotFound: '[{field}] ❌ Geçerli giriş öğesi bulunamadı!',
    focusingInput: '[{field}] Odaklanmak için giriş kutusuna tıklanıyor...',
    typingHumanLike: '[{field}] İnsan yazım hızını taklit ederek metin giriliyor...',

    configuringAdvanced: '⚙️ Gelişmiş ayarlar yapılandırılıyor (Konum/Koleksiyon/Zamanlama/Orijinal/Yapay Zeka)...',
    waitingAdvancedMounted: '⏳ Gelişmiş seçenek bileşenlerinin yüklenmesi bekleniyor...',
    settingLocationNone: '📍 Konum 【Konumu Gösterme】 olarak ayarlandı',
    settingCollection: '📚 Koleksiyona ekleme yapılandırıldı: 【{name}】',
    declaringOriginal: '🛡️ Orijinallik beyanı yapılıyor ve anlaşma onaylanıyor...',
    declaredOriginalSuccess: '✅ Orijinallik beyanı onaylandı!',
    markingAiGenerated: '🤖 Video 【Yapay zeka tarafından oluşturuldu】 olarak işaretleniyor...',
    markedAiSuccess: '✅ Yapay zeka işareti başarıyla ayarlandı!',
    schedulingPublish: '⏰ Zamanlanmış yayınlama saati yapılandırılıyor: {time}...',
    scheduledSuccess: '✅ Zamanlanmış yayınlama saati başarıyla ayarlandı!',

    submittingPublish: '🚀 Videoyu göndermek için son 【Yayınla】 düğmesine tıklanıyor...',
    clickedPublishBtn: '🖱️ 【{btn}】 düğmesine tıklandı, dönüştürme ve sonuç izleniyor...',
    waitingTranscode: '⏳ Platform kod dönüştürme ve nihai onay bekleniyor...',
    waitingTranscodeTick: '⏳ Kod dönüştürme bekleniyor ({elapsed} sn)...',
    publishSuccessDetected: '🎉 Başarılı yayınlama algılandı! Video 【{platform}】 üzerinde yayınlandı!'
  }
};

export function getPlatformLocale(lang?: string | null): PlatformI18nEntry {
  const code = normalizeLangCode(lang || (typeof windowManager !== 'undefined' ? windowManager.getCurrentLanguage() : 'zh'));
  return PLATFORM_I18N_LOCALES[code] || PLATFORM_I18N_LOCALES.zh;
}

export function formatPlatformText(template: string, params?: Record<string, string | number>): string {
  if (!template) return '';
  if (!params) return template;
  let str = template;
  for (const [k, v] of Object.entries(params)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return str;
}

export function tPlatform(key: keyof PlatformI18nEntry, lang?: string | null, params?: Record<string, string | number>): string {
  const loc = getPlatformLocale(lang);
  const text = loc[key] || PLATFORM_I18N_LOCALES.zh[key] || key;
  return formatPlatformText(text, params);
}

export function getPlatformDisplayName(platform: 'wechat' | 'xiaohongshu' | string, lang?: string | null): string {
  const loc = getPlatformLocale(lang);
  if (platform === 'wechat' || platform.toLowerCase().includes('wechat')) {
    return loc.platformNameWechat;
  }
  if (platform === 'xiaohongshu' || platform.toLowerCase().includes('xiaohongshu')) {
    return loc.platformNameXhs;
  }
  return platform;
}

/**
 * 平台通用操作与短语多语言动态匹配表（支持 14 种核心语言）
 */
const PLATFORM_TERM_RULES: Array<{ regex: RegExp; translations: Partial<Record<SupportedLangCode, string>> }> = [
  {
    regex: /\[位置\]\s*正在物理点击【不显示位置】选项.*/g,
    translations: {
      "zh": "[位置]s*正在物理点击【不显示位置】选项.*",
      "en": "[Location] Clicking [Do Not Show Location] option...",
      "ja": "[] 「をしない」のをクリック...",
      "ko": "[위치] \\\"위치 표시 안 함\\\" 옵션 클릭 중...",
      "vi": "[Vị trí] Đang nhấp vào tùy chọn [Không hiển thị vị trí]...",
      "th": "[ตำแหน่ง] กำลังคลิกตัวเลือก [ไม่แสดงตำแหน่ง]...",
      "id": "[Lokasi] Mengklik opsi [Jangan Tampilkan Lokasi]...",
      "es": "[Ubicación] Haciendo clic en la opción [No mostrar ubicación]...",
      "fr": "[Localisation] Clic sur l'option [Ne pas afficher la localisation]...",
      "pt": "[Localização] Clicando na opção [Não mostrar localização]...",
      "de": "[Standort] Klick auf die Option [Standort nicht anzeigen]...",
      "it": "[Posizione] Clic sull'opzione [Non mostrare posizione]...",
      "ru": "[Местоположение] Клик по опции [Не показывать местоположение]...",
      "tr": "[Konum] [Konumu gösterme] seçeneğine tıklanıyor...",
    }
  },
  {
    regex: /\[位置\]\s*当前位置为[:：]?\s*【(.*?)】,\s*正在点击展开位置选项菜单.*/g,
    translations: {
      "zh": "[位置]s*当前位置为[:：]?s*【(.*?)】,s*正在点击展开位置选项菜单.*",
      "en": "[Location] Current location: [$1], opening location menu...",
      "ja": "[] の: 【$1】、メニューを...",
      "ko": "[위치] 현재 위치: 【$1】, 위치 메뉴 펼치는 중...",
      "vi": "[Vị trí] Vị trí hiện tại: [$1], đang mở menu vị trí...",
      "th": "[ตำแหน่ง] ตำแหน่งปัจจุบัน: [$1] กำลังเปิดเมนูตำแหน่ง...",
      "id": "[Lokasi] Lokasi saat ini: [$1], membuka menu lokasi...",
      "es": "[Ubicación] Ubicación actual: [$1], abriendo menú de ubicación...",
      "fr": "[Localisation] Emplacement actuel : [$1], ouverture du menu...",
      "pt": "[Localização] Localização atual: [$1], abrindo menu de localização...",
      "de": "[Standort] Aktueller Standort: [$1], Standortmenü wird geöffnet...",
      "it": "[Posizione] Posizione attuale: [$1], apertura menu posizione...",
      "ru": "[Местоположение] Текущее местоположение: [$1], открытие меню...",
      "tr": "[Konum] Mevcut konum: [$1], konum menüsü açılıyor...",
    }
  },
  {
    regex: /\[添加到合集\]\s*点击展开合集下拉框.*/g,
    translations: {
      "zh": "[添加到合集]s*点击展开合集下拉框.*",
      "en": "[Collection] Opening collection dropdown menu...",
      "ja": "[コレクション] コレクションドロップダウンを...",
      "ko": "[컬렉션] 컬렉션 드롭다운 메뉴 펼치는 중...",
      "vi": "[Bộ sưu tập] Đang mở menu bộ sưu tập...",
      "th": "[คอลเลกชัน] กำลังเปิดเมนูคอลเลกชัน...",
      "id": "[Koleksi] Membuka menu dropdown koleksi...",
      "es": "[Colección] Abriendo menú desplegable de colecciones...",
      "fr": "[Collection] Ouverture du menu déroulant de la collection...",
      "pt": "[Coleção] Abrindo menu suspenso de coleções...",
      "de": "[Sammlung] Dropdown-Menü der Sammlung wird geöffnet...",
      "it": "[Raccolta] Apertura menu a discesa della raccolta...",
      "ru": "[Коллекция] Открытие выпадающего меню коллекции...",
      "tr": "[Koleksiyon] Koleksiyon açılır menüsü açılıyor...",
    }
  },
  {
    regex: /\[添加到合集\]\s*接口数据已就绪.*/g,
    translations: {
      "zh": "[添加到合集]s*接口数据已就绪.*",
      "en": "[Collection] API data ready, selecting collection...",
      "ja": "[コレクション] APIデータ、コレクションを...",
      "ko": "[컬렉션] API 데이터 준비 완료, 컬렉션 선택 중...",
      "vi": "[Bộ sưu tập] Dữ liệu API đã sẵn sàng, đang chọn bộ sưu tập...",
      "th": "[คอลเลกชัน] ข้อมูล API พร้อมแล้ว กำลังเลือกคอลเลกชัน...",
      "id": "[Koleksi] Data API siap, memilih koleksi...",
      "es": "[Colección] Datos de API listos, seleccionando colección...",
      "fr": "[Collection] Données API prêtes, sélection de la collection...",
      "pt": "[Coleção] Dados da API prontos, selecionando coleção...",
      "de": "[Sammlung] API-Daten bereit, Sammlung wird ausgewählt...",
      "it": "[Raccolta] Dati API pronti, selezione della raccolta...",
      "ru": "[Коллекция] Данные API готовы, выбор коллекции...",
      "tr": "[Koleksiyon] API verileri hazır, koleksiyon seçiliyor...",
    }
  },
  {
    regex: /\[定时发表\]\s*正在物理点击【定时】.*/g,
    translations: {
      "zh": "[定时发表]s*正在物理点击【定时】.*",
      "en": "[Scheduled Publish] Clicking [Schedule] option...",
      "ja": "[] 「」ラジオボタンをクリック...",
      "ko": "[예약 게시] \\\"예약\\\" 옵션 클릭 중...",
      "vi": "[Đăng định kỳ] Đang nhấp vào tùy chọn [Hẹn giờ]...",
      "th": "[กำหนดเวลา] กำลังคลิกตัวเลือก [ตั้งเวลา]...",
      "id": "[Publikasi Terjadwal] Mengklik opsi [Jadwal]...",
      "es": "[Publicación programada] Haciendo clic en opción de programación...",
      "fr": "[Publication programmée] Clic sur l'option de programmation...",
      "pt": "[Publicação agendada] Clicando na opção de agendamento...",
      "de": "[Geplante Veröffentlichung] Klick auf die Option [Geplant]...",
      "it": "[Pubblicazione programmata] Clic sull'opzione di programmazione...",
      "ru": "[Отложенная публикация] Клик по опции отложенной публикации...",
      "tr": "[Zamanlanmış Yayınlama] [Zamanla] seçeneğine tıklanıyor...",
    }
  },
  {
    regex: /\[定时发表\]\s*日历面板已展开.*/g,
    translations: {
      "zh": "[定时发表]s*日历面板已展开.*",
      "en": "[Scheduled Publish] Calendar panel opened",
      "ja": "[] カレンダーパネルがきました",
      "ko": "[예약 게시] 달력 패널이 펼쳐졌습니다",
      "vi": "[Đăng định kỳ] Bảng lịch đã được mở",
      "th": "[กำหนดเวลา] แผงปฏิทินเปิดแล้ว",
      "id": "[Publikasi Terjadwal] Panel kalender telah terbuka",
      "es": "[Publicación programada] Panel de calendario abierto",
      "fr": "[Publication programmée] Panneau de calendrier ouvert",
      "pt": "[Publicação agendada] Painel de calendário aberto",
      "de": "[Geplante Veröffentlichung] Kalenderfeld geöffnet",
      "it": "[Pubblicazione programmata] Pannello calendario aperto",
      "ru": "[Отложенная публикация] Панель календаря открыта",
      "tr": "[Zamanlanmış Yayınlama] Takvim paneli açıldı",
    }
  },
  {
    regex: /\[定时发表\]\s*时分选择面板已展开.*/g,
    translations: {
      "zh": "[定时发表]s*时分选择面板已展开.*",
      "en": "[Scheduled Publish] Time picker panel opened",
      "ja": "[] パネルがきました",
      "ko": "[예약 게시] 시간 선택 패널이 펼쳐졌습니다",
      "vi": "[Đăng định kỳ] Bảng chọn giờ đã được mở",
      "th": "[กำหนดเวลา] แผงเลือกเวลาเปิดแล้ว",
      "id": "[Publikasi Terjadwal] Panel pemilih waktu telah terbuka",
      "es": "[Publicación programada] Panel de selección de hora abierto",
      "fr": "[Publication programmée] Panneau de sélection d'heure ouvert",
      "pt": "[Publicação agendada] Painel de seleção de hora aberto",
      "de": "[Geplante Veröffentlichung] Zeitauswahlfeld geöffnet",
      "it": "[Pubblicazione programmata] Pannello selezione ora aperto",
      "ru": "[Отложенная публикация] Панель выбора времени открыта",
      "tr": "[Zamanlanmış Yayınlama] Saat seçici paneli açıldı",
    }
  },
  {
    regex: /已点击【声明原创】复选框,\s*正在等待【原创权益】弹窗呈现\.\.\./g,
    translations: {
      "zh": "已点击【声明原创】复选框,s*正在等待【原创权益】弹窗呈现...",
      "en": "Clicked Original Statement checkbox, waiting for terms modal...",
      "ja": "【オリジナル】のチェックボックスをクリック、モーダルのを...",
      "ko": "【오리지널 선언】 체크박스를 클릭함, 이용안내 팝업 대기 중...",
      "vi": "Đã nhấp vào ô tuyên bố bản quyền, đang chờ hộp thoại điều khoản...",
      "th": "คลิกช่องประกาศผลงานต้นฉบับแล้ว กำลังรอหน้าต่างข้อกำหนด...",
      "id": "Mengklik kotak centang pernyataan orisinal, menunggu pop-up syarat...",
      "es": "Casilla de originalidad marcada, esperando ventana de términos...",
      "fr": "Case de déclaration d'originalité cochée, en attente de la fenêtre modale...",
      "pt": "Caixa de declaração de originalidade marcada, aguardando janela...",
      "de": "Originalitäts-Kontrollkästchen angeklickt, Warten auf das Hinweis-Fenster...",
      "it": "Casella di controllo dichiarazione di originalità selezionata, in attesa della finestra modale...",
      "ru": "Флажок заявления об авторстве отмечен, ожидание всплывающего окна...",
      "tr": "Özgünlük bildirimi onay kutusu tıklandı, şartlar penceresi bekleniyor...",
    }
  },
  {
    regex: /\[视频标注\]\s*点击展开选项列表.*/g,
    translations: {
      "zh": "[视频标注]s*点击展开选项列表.*",
      "en": "[Video Label] Opening option dropdown menu...",
      "ja": "[ラベル] オプションドロップダウンを...",
      "ko": "[동영상 라벨] 옵션 드롭다운 메뉴 펼치는 중...",
      "vi": "[Nhãn video] Đang mở menu tùy chọn...",
      "th": "[ป้ายกำกับวิดีโอ] กำลังเปิดเมนูตัวเลือก...",
      "id": "[Label Video] Membuka menu dropdown opsi...",
      "es": "[Etiqueta de video] Abriendo menú desplegable de opciones...",
      "fr": "[Étiquette vidéo] Ouverture du menu déroulant des options...",
      "pt": "[Rótulo do vídeo] Abrindo menu suspenso de opções...",
      "de": "[Video-Kennzeichnung] Dropdown-Menü der Optionen wird geöffnet...",
      "it": "[Etichetta video] Apertura menu a discesa delle opzioni...",
      "ru": "[Метка видео] Открытие выпадающего меню опций...",
      "tr": "[Video Etiketi] Seçenek açılır menüsü açılıyor...",
    }
  },
  {
    regex: /\[视频标注\]\s*物理点击目标选项.*/g,
    translations: {
      "zh": "[视频标注]s*物理点击目标选项.*",
      "en": "[Video Label] Clicking target option...",
      "ja": "[ラベル] のオプションをクリック...",
      "ko": "[동영상 라벨] 대상 옵션 클릭 중...",
      "vi": "[Nhãn video] Đang nhấp vào tùy chọn mục tiêu...",
      "th": "[ป้ายกำกับวิดีโอ] กำลังคลิกตัวเลือกเป้าหมาย...",
      "id": "[Label Video] Mengklik opsi target...",
      "es": "[Etiqueta de video] Haciendo clic en la opción de destino...",
      "fr": "[Étiquette vidéo] Clic sur l'option cible...",
      "pt": "[Rótulo do vídeo] Clicando na opção alvo...",
      "de": "[Video-Kennzeichnung] Klick auf die Zieloption...",
      "it": "[Etichetta video] Clic sull'opzione di destinazione...",
      "ru": "[Метка видео] Клик по целевой опции...",
      "tr": "[Video Etiketi] Hedef seçeneğe tıklanıyor...",
    }
  },
  {
    regex: /成功建立专属页面 CDP WebSocket 连接/g,
    translations: {
      "zh": "成功建立专属页面 CDP WebSocket 连接",
      "en": "Successfully established CDP WebSocket connection for page",
      "ja": "ページ CDP WebSocket のにsuccessしました",
      "ko": "페이지 전용 CDP WebSocket 연결 성공",
      "vi": "Đã thiết lập kết nối CDP WebSocket cho trang thành công",
      "th": "สถาปนาการเชื่อมต่อ CDP WebSocket สำหรับหน้าเพจสำเร็จแล้ว",
      "id": "Berhasil membangun koneksi CDP WebSocket untuk halaman",
      "es": "Conexión CDP WebSocket para la página establecida con éxito",
      "fr": "Connexion CDP WebSocket établie avec succès pour la page",
      "pt": "Conexão CDP WebSocket estabelecida com sucesso para a página",
      "de": "CDP WebSocket-Verbindung für die Seite erfolgreich hergestellt",
      "it": "Connessione CDP WebSocket per la pagina stabilita con successo",
      "ru": "Успешно установлено подключение CDP WebSocket для страницы",
      "tr": "Sayfa için CDP WebSocket bağlantısı başarıyla kuruldu",
    }
  },
  {
    regex: /\[步骤\s*(\d+)(?:\/|分之)(\d+)\]/g,
    translations: {
      "zh": "[步骤 $1/$2]",
      "en": "[Step $1/$2] Monitoring video upload transcode status & checking publish button...",
      "ja": "[ステップ $1/$2] のアップロード・をし、ボタンを...",
      "ko": "[단계 $1/$2] 동영상 인코딩 상태 모니터링 및 게시 버튼 활성화 검증 중...",
      "vi": "[Bước $1/$2] Đang theo dõi trạng thái chuyển mã video và xác thực nút xuất bản...",
      "th": "[ขั้นตอน $1/$2] กำลังตรวจสอบสถานะการแปลงรหัสวิดีโอและยืนยันปุ่มเผยแพร่...",
      "id": "[Langkah $1/$2] Memantau status transcode video & menguji tombol publikasi...",
      "es": "[Paso $1/$2] Monitoreando transcodificación de video y verificando botón de publicación...",
      "fr": "[Étape $1/$2] Suivi du transcodage vidéo et vérification du bouton de publication...",
      "pt": "[Etapa $1/$2] Monitorando transcodificação de vídeo e verificando botão de publicação...",
      "de": "[Schritt $1/$2] Videotranskodierung überwachen und Veröffentlichungsschaltfläche prüfen...",
      "it": "[Passaggio $1/$2] Monitoraggio transcodifica video e verifica pulsante di pubblicazione...",
      "ru": "[Шаг $1/$2] Мониторинг состояния транскодирования видео и проверка кнопки...",
      "tr": "[Adım $1/$2] Video kod dönüştürme durumu izleniyor ve yayınlama düğmesi doğrulanıyor...",
    }
  },
  {
    regex: /已回到底部发表区域，准备监测转码与校验按钮/g,
    translations: {
      "zh": "已回到底部发表区域，准备监测转码与校验按钮",
      "en": "Returned to publish area at bottom, preparing to monitor transcoding & verify button",
      "ja": "ページのエリアにりました。とボタンのを",
      "ko": "하단 게시 영역으로 이동 완료, 인코딩 및 게시 버튼 검증 준비 중",
      "vi": "Đã trở lại khu vực xuất bản ở cuối trang, chuẩn bị theo dõi chuyển mã và xác thực nút",
      "th": "กลับไปยังพื้นที่เผยแพร่ด้านล่างแล้ว กำลังเตรียมตรวจสอบการแปลงรหัสและปุ่ม",
      "id": "Kembali ke area publikasi di bagian bawah, bersiap memantau transcode & tombol",
      "es": "De vuelta al área de publicación al final, preparando para monitorear transcodificación y botón",
      "fr": "Retour à la zone de publication en bas, préparation du suivi du transcodage et validation du bouton",
      "pt": "Voltado para a área de publicação no final, preparando para monitorar transcodificação e botão",
      "de": "Zurück zum Veröffentlichungsbereich unten, Überwachung der Transkodierung und Schaltflächenprüfung vorbereiten",
      "it": "Tornato all'area di pubblicazione in basso, preparazione monitoraggio transcodifica e pulsante",
      "ru": "Возврат в область публикации внизу, подготовка к мониторингу транскодирования и проверке кнопки",
      "tr": "Alt kısımdaki yayınlama alanına dönüldü, kod dönüştürme ve düğme doğrulaması izlemeye hazırlanılıyor",
    }
  },
  {
    regex: /\[步骤\s*(\d+)(?:\/|分之)(\d+)\]/g,
    translations: {
      "zh": "[步骤 $1/$2]",
      "en": "[Step $1/$2]",
      "ja": "[ステップ $1/$2]",
      "ko": "[단계 $1/$2]",
      "vi": "[Bước $1/$2]",
      "th": "[ขั้นตอน $1/$2]",
      "id": "[Langkah $1/$2]",
      "es": "[Paso $1/$2]",
      "fr": "[Étape $1/$2]",
      "pt": "[Etapa $1/$2]",
      "de": "[Schritt $1/$2]",
      "it": "[Passaggio $1/$2]",
      "ru": "[Шаг $1/$2]",
      "tr": "[Adım $1/$2]",
    }
  },
  {
    regex: /\[视频标注\]\ ℹ️\ 尝试第\ \$\{mTry\ \+\ 1\}\ 次定位组件\.\.\./g,
    translations: {
      "zh": "[视频标注] ℹ️ 尝试第 ${mTry + 1} 次定位组件...",
      "en": "[] ℹ️ ${mTry + 1} ...",
      "ja": "[] ℹ️ ${mTry + 1} ...",
      "ko": "[] ℹ️ ${mTry + 1} ...",
      "vi": "[] ℹ️ ${mTry + 1} ...",
      "th": "[] ℹ️ ${mTry + 1} ...",
      "id": "[] ℹ️ ${mTry + 1} ...",
      "es": "[] ℹ️ ${mTry + 1} ...",
      "fr": "[] ℹ️ ${mTry + 1} ...",
      "pt": "[] ℹ️ ${mTry + 1} ...",
      "de": "[] ℹ️ ${mTry + 1} ...",
      "it": "[] ℹ️ ${mTry + 1} ...",
      "ru": "[] ℹ️ ${mTry + 1} ...",
      "tr": "[] ℹ️ ${mTry + 1} ...",
    }
  },
  {
    regex: /⏳\ 微信正在提交视频素材与发表数据中\.\.\./g,
    translations: {
      "zh": "⏳ 微信正在提交视频素材与发表数据中...",
      "en": "⏳ ...",
      "ja": "⏳ ...",
      "ko": "⏳ ...",
      "vi": "⏳ ...",
      "th": "⏳ ...",
      "id": "⏳ ...",
      "es": "⏳ ...",
      "fr": "⏳ ...",
      "pt": "⏳ ...",
      "de": "⏳ ...",
      "it": "⏳ ...",
      "ru": "⏳ ...",
      "tr": "⏳ ...",
    }
  },
  {
    regex: /⚡\ \[定时发表\]\ 未指定计划发布时间，保持【立即发表】模式/g,
    translations: {
      "zh": "⚡ [定时发表] 未指定计划发布时间，保持【立即发表】模式",
      "en": "⚡ Automated process running: [Scheduled publish] ，【】",
      "ja": "⚡ : [Scheduled publish] ，【】",
      "ko": "⚡ 자동화 프로세스 실행 중: [Scheduled publish] ，【】",
      "vi": "⚡ Quy trình tự động đang chạy: [Scheduled publish] ，【】",
      "th": "⚡ กำลังประมวลผลอัตโนมัติ: [Scheduled publish] ，【】",
      "id": "⚡ Proses otomatis berjalan: [Scheduled publish] ，【】",
      "es": "⚡ Proceso automatizado en ejecución: [Scheduled publish] ，【】",
      "fr": "⚡ Processus automatisé en cours : [Scheduled publish] ，【】",
      "pt": "⚡ Processo automatizado em execução: [Scheduled publish] ，【】",
      "de": "⚡ Automatisierter Prozess läuft: [Scheduled publish] ，【】",
      "it": "⚡ Processo automatizzato in corso: [Scheduled publish] ，【】",
      "ru": "⚡ Автоматический процесс выполняется: [Scheduled publish] ，【】",
      "tr": "⚡ Otomatik işlem çalışıyor: [Scheduled publish] ，【】",
    }
  },
  {
    regex: /✅\ \[定时发表\]\ 已成功设置为:\ \$\{finalCheck\.inputVal\}/g,
    translations: {
      "zh": "✅ [定时发表] 已成功设置为: ${finalCheck.inputVal}",
      "en": "✅ [Scheduled publish] successfully set to: ${finalCheck.inputVal}",
      "ja": "✅ [Scheduled publish] successfully set to: ${finalCheck.inputVal}",
      "ko": "✅ [Scheduled publish] successfully set to: ${finalCheck.inputVal}",
      "vi": "✅ [Scheduled publish] successfully set to: ${finalCheck.inputVal}",
      "th": "✅ [Scheduled publish] successfully set to: ${finalCheck.inputVal}",
      "id": "✅ [Scheduled publish] successfully set to: ${finalCheck.inputVal}",
      "es": "✅ [Scheduled publish] successfully set to: ${finalCheck.inputVal}",
      "fr": "✅ [Scheduled publish] successfully set to: ${finalCheck.inputVal}",
      "pt": "✅ [Scheduled publish] successfully set to: ${finalCheck.inputVal}",
      "de": "✅ [Scheduled publish] successfully set to: ${finalCheck.inputVal}",
      "it": "✅ [Scheduled publish] successfully set to: ${finalCheck.inputVal}",
      "ru": "✅ [Scheduled publish] successfully set to: ${finalCheck.inputVal}",
      "tr": "✅ [Scheduled publish] successfully set to: ${finalCheck.inputVal}",
    }
  },
  {
    regex: /✅\ \[声明原创\]\ 复选框已勾选生效/g,
    translations: {
      "zh": "✅ [声明原创] 复选框已勾选生效",
      "en": "✅ []",
      "ja": "✅ []",
      "ko": "✅ []",
      "vi": "✅ []",
      "th": "✅ []",
      "id": "✅ []",
      "es": "✅ []",
      "fr": "✅ []",
      "pt": "✅ []",
      "de": "✅ []",
      "it": "✅ []",
      "ru": "✅ []",
      "tr": "✅ []",
    }
  },
  {
    regex: /\[定时发表\]\ 处理略过:\ \$\{e\.message\}/g,
    translations: {
      "zh": "[定时发表] 处理略过: ${e.message}",
      "en": "[Scheduled publish] : ${e.message}",
      "ja": "[Scheduled publish] : ${e.message}",
      "ko": "[Scheduled publish] : ${e.message}",
      "vi": "[Scheduled publish] : ${e.message}",
      "th": "[Scheduled publish] : ${e.message}",
      "id": "[Scheduled publish] : ${e.message}",
      "es": "[Scheduled publish] : ${e.message}",
      "fr": "[Scheduled publish] : ${e.message}",
      "pt": "[Scheduled publish] : ${e.message}",
      "de": "[Scheduled publish] : ${e.message}",
      "it": "[Scheduled publish] : ${e.message}",
      "ru": "[Scheduled publish] : ${e.message}",
      "tr": "[Scheduled publish] : ${e.message}",
    }
  },
  {
    regex: /\[定时发表\]\ 时分选择面板已展开/g,
    translations: {
      "zh": "[定时发表] 时分选择面板已展开",
      "en": "[Scheduled publish]",
      "ja": "[Scheduled publish]",
      "ko": "[Scheduled publish]",
      "vi": "[Scheduled publish]",
      "th": "[Scheduled publish]",
      "id": "[Scheduled publish]",
      "es": "[Scheduled publish]",
      "fr": "[Scheduled publish]",
      "pt": "[Scheduled publish]",
      "de": "[Scheduled publish]",
      "it": "[Scheduled publish]",
      "ru": "[Scheduled publish]",
      "tr": "[Scheduled publish]",
    }
  },
  {
    regex: /❌\ 微信视频上传失败（网络出错，请稍后重试），已坚决终止发表操作，避免提交空内容！/g,
    translations: {
      "zh": "❌ 微信视频上传失败（网络出错，请稍后重试），已坚决终止发表操作，避免提交空内容！",
      "en": "❌ Automated process running: Video uploadfailed（，），，！",
      "ja": "❌ : Video uploadfailed（，），，！",
      "ko": "❌ 자동화 프로세스 실행 중: Video uploadfailed（，），，！",
      "vi": "❌ Quy trình tự động đang chạy: Video uploadfailed（，），，！",
      "th": "❌ กำลังประมวลผลอัตโนมัติ: Video uploadfailed（，），，！",
      "id": "❌ Proses otomatis berjalan: Video uploadfailed（，），，！",
      "es": "❌ Proceso automatizado en ejecución: Video uploadfailed（，），，！",
      "fr": "❌ Processus automatisé en cours : Video uploadfailed（，），，！",
      "pt": "❌ Processo automatizado em execução: Video uploadfailed（，），，！",
      "de": "❌ Automatisierter Prozess läuft: Video uploadfailed（，），，！",
      "it": "❌ Processo automatizzato in corso: Video uploadfailed（，），，！",
      "ru": "❌ Автоматический процесс выполняется: Video uploadfailed（，），，！",
      "tr": "❌ Otomatik işlem çalışıyor: Video uploadfailed（，），，！",
    }
  },
  {
    regex: /✅\ \[定时发表\]\ 已成功设置为:\ \$\{finalCheck\.dtText\}/g,
    translations: {
      "zh": "✅ [定时发表] 已成功设置为: ${finalCheck.dtText}",
      "en": "✅ [Scheduled publish] successfully set to: ${finalCheck.dtText}",
      "ja": "✅ [Scheduled publish] successfully set to: ${finalCheck.dtText}",
      "ko": "✅ [Scheduled publish] successfully set to: ${finalCheck.dtText}",
      "vi": "✅ [Scheduled publish] successfully set to: ${finalCheck.dtText}",
      "th": "✅ [Scheduled publish] successfully set to: ${finalCheck.dtText}",
      "id": "✅ [Scheduled publish] successfully set to: ${finalCheck.dtText}",
      "es": "✅ [Scheduled publish] successfully set to: ${finalCheck.dtText}",
      "fr": "✅ [Scheduled publish] successfully set to: ${finalCheck.dtText}",
      "pt": "✅ [Scheduled publish] successfully set to: ${finalCheck.dtText}",
      "de": "✅ [Scheduled publish] successfully set to: ${finalCheck.dtText}",
      "it": "✅ [Scheduled publish] successfully set to: ${finalCheck.dtText}",
      "ru": "✅ [Scheduled publish] successfully set to: ${finalCheck.dtText}",
      "tr": "✅ [Scheduled publish] successfully set to: ${finalCheck.dtText}",
    }
  },
  {
    regex: /✅\ \[声明原创\]\ 当前已处于原创勾选状态/g,
    translations: {
      "zh": "✅ [声明原创] 当前已处于原创勾选状态",
      "en": "✅ []",
      "ja": "✅ []",
      "ko": "✅ []",
      "vi": "✅ []",
      "th": "✅ []",
      "id": "✅ []",
      "es": "✅ []",
      "fr": "✅ []",
      "pt": "✅ []",
      "de": "✅ []",
      "it": "✅ []",
      "ru": "✅ []",
      "tr": "✅ []",
    }
  },
  {
    regex: /🎉\ \[声明原创\]\ ✅\ 弹窗中成功确认【声明原创】，弹窗已关闭！/g,
    translations: {
      "zh": "🎉 [声明原创] ✅ 弹窗中成功确认【声明原创】，弹窗已关闭！",
      "en": "🎉 Automated process running: [] ✅ success【】，！",
      "ja": "🎉 : [] ✅ success【】，！",
      "ko": "🎉 자동화 프로세스 실행 중: [] ✅ success【】，！",
      "vi": "🎉 Quy trình tự động đang chạy: [] ✅ success【】，！",
      "th": "🎉 กำลังประมวลผลอัตโนมัติ: [] ✅ success【】，！",
      "id": "🎉 Proses otomatis berjalan: [] ✅ success【】，！",
      "es": "🎉 Proceso automatizado en ejecución: [] ✅ success【】，！",
      "fr": "🎉 Processus automatisé en cours : [] ✅ success【】，！",
      "pt": "🎉 Processo automatizado em execução: [] ✅ success【】，！",
      "de": "🎉 Automatisierter Prozess läuft: [] ✅ success【】，！",
      "it": "🎉 Processo automatizzato in corso: [] ✅ success【】，！",
      "ru": "🎉 Автоматический процесс выполняется: [] ✅ success【】，！",
      "tr": "🎉 Otomatik işlem çalışıyor: [] ✅ success【】，！",
    }
  },
  {
    regex: /\[定时发表\]\ ⚠️\ 未能确认定时单选激活状态，继续尝试后续步骤\.\.\./g,
    translations: {
      "zh": "[定时发表] ⚠️ 未能确认定时单选激活状态，继续尝试后续步骤...",
      "en": "Automated process running: [Scheduled publish] ⚠️ ，Step...",
      "ja": ": [Scheduled publish] ⚠️ ，Step...",
      "ko": "자동화 프로세스 실행 중: [Scheduled publish] ⚠️ ，Step...",
      "vi": "Quy trình tự động đang chạy: [Scheduled publish] ⚠️ ，Step...",
      "th": "กำลังประมวลผลอัตโนมัติ: [Scheduled publish] ⚠️ ，Step...",
      "id": "Proses otomatis berjalan: [Scheduled publish] ⚠️ ，Step...",
      "es": "Proceso automatizado en ejecución: [Scheduled publish] ⚠️ ，Step...",
      "fr": "Processus automatisé en cours : [Scheduled publish] ⚠️ ，Step...",
      "pt": "Processo automatizado em execução: [Scheduled publish] ⚠️ ，Step...",
      "de": "Automatisierter Prozess läuft: [Scheduled publish] ⚠️ ，Step...",
      "it": "Processo automatizzato in corso: [Scheduled publish] ⚠️ ，Step...",
      "ru": "Автоматический процесс выполняется: [Scheduled publish] ⚠️ ，Step...",
      "tr": "Otomatik işlem çalışıyor: [Scheduled publish] ⚠️ ，Step...",
    }
  },
  {
    regex: /⏳\ 视频正在上传或转码中\ \(\$\{currentProgress\}\)，持续等待上传成功\.\.\./g,
    translations: {
      "zh": "⏳ 视频正在上传或转码中 (${currentProgress})，持续等待上传成功...",
      "en": "⏳ (${currentProgress})，...",
      "ja": "⏳ (${currentProgress})，...",
      "ko": "⏳ (${currentProgress})，...",
      "vi": "⏳ (${currentProgress})，...",
      "th": "⏳ (${currentProgress})，...",
      "id": "⏳ (${currentProgress})，...",
      "es": "⏳ (${currentProgress})，...",
      "fr": "⏳ (${currentProgress})，...",
      "pt": "⏳ (${currentProgress})，...",
      "de": "⏳ (${currentProgress})，...",
      "it": "⏳ (${currentProgress})，...",
      "ru": "⏳ (${currentProgress})，...",
      "tr": "⏳ (${currentProgress})，...",
    }
  },
  {
    regex: /❌\ \[发布终止\]\ 高级发布选项未达标已强制中止发布:\ \$\{optErr\.message\}/g,
    translations: {
      "zh": "❌ [发布终止] 高级发布选项未达标已强制中止发布: ${optErr.message}",
      "en": "❌ [] : ${optErr.message}",
      "ja": "❌ [] : ${optErr.message}",
      "ko": "❌ [] : ${optErr.message}",
      "vi": "❌ [] : ${optErr.message}",
      "th": "❌ [] : ${optErr.message}",
      "id": "❌ [] : ${optErr.message}",
      "es": "❌ [] : ${optErr.message}",
      "fr": "❌ [] : ${optErr.message}",
      "pt": "❌ [] : ${optErr.message}",
      "de": "❌ [] : ${optErr.message}",
      "it": "❌ [] : ${optErr.message}",
      "ru": "❌ [] : ${optErr.message}",
      "tr": "❌ [] : ${optErr.message}",
    }
  }
];

/**
 * 通用平台自动化动作日志本地化转换器（支持 14 种语言）
 */
export function localizePlatformLog(rawText: string, lang?: string | null): string {
  if (!rawText || typeof rawText !== 'string') return '';
  const currentLang = normalizeLangCode(lang || (typeof windowManager !== 'undefined' ? windowManager.getCurrentLanguage() : 'zh'));
  if (currentLang === 'zh') return rawText;

  const loc = getPlatformLocale(currentLang);

  // 1. 先尝试直接从字典匹配核心预设文本
  for (const [k, v] of Object.entries(PLATFORM_I18N_LOCALES.zh)) {
    const rawPattern = v.replace(/\{(\w+)\}/g, '(.*?)');
    try {
      const match = rawText.match(new RegExp(`^${rawPattern}$`));
      if (match) {
        let targetTpl = (loc as any)[k] || v;
        for (let i = 1; i < match.length; i++) {
          const varNameMatch = Object.keys(PLATFORM_I18N_LOCALES.zh[k as keyof PlatformI18nEntry] || {})[i - 1];
          if (varNameMatch) {
            targetTpl = targetTpl.replace(`{${varNameMatch}}`, match[i]);
          }
        }
        return targetTpl;
      }
    } catch {}
  }

  // 2. 遍历多语言动态短语规则表进行深度转换
  let text = rawText;
  for (const rule of PLATFORM_TERM_RULES) {
    const targetTpl = rule.translations[currentLang] || rule.translations.en;
    if (targetTpl && rule.regex.test(text)) {
      text = text.replace(rule.regex, targetTpl);
    }
  }

  return text;
}
