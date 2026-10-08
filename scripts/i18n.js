/**
 * Command-line Scripts Internationalization (i18n) Helper
 * Supports 14 core languages with automatic system/environment locale detection.
 */

const VALID_LANGUAGES = [
  'zh', 'en', 'ja', 'ko', 'vi', 'th', 'id',
  'es', 'fr', 'pt', 'de', 'it', 'ru', 'tr'
];

function detectCliLang() {
  const envLang = process.env.CLI_LANG || process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE;
  if (envLang) {
    const clean = envLang.split('.')[0].replace('_', '-').toLowerCase();
    const prefix = clean.split('-')[0];
    if (VALID_LANGUAGES.includes(prefix)) {
      return prefix;
    }
  }

  try {
    const sysLocale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    const prefix = sysLocale.split('-')[0];
    if (VALID_LANGUAGES.includes(prefix)) {
      return prefix;
    }
  } catch {}

  return 'en';
}

let currentLang = detectCliLang();

function setCliLang(lang) {
  if (lang && VALID_LANGUAGES.includes(lang.toLowerCase())) {
    currentLang = lang.toLowerCase();
  }
}

function getCliLang() {
  return currentLang;
}

const DICTIONARY = {
  // ── Clean Electron ──
  CLEAN_ELECTRON_START: {
    zh: '[clean-electron] 正在清理历史 Electron 进程与构建缓存...',
    en: '[clean-electron] Cleaning legacy Electron processes and build cache...',
    ja: '[clean-electron] 以前の Electron プロセスとビルドキャッシュをクリーンアップ中...',
    ko: '[clean-electron] 이전 Electron 프로세스 및 빌드 캐시를 정리하는 중...',
    vi: '[clean-electron] Đang dọn dẹp các tiến trình Electron cũ và bộ nhớ đệm bản dựng...',
    th: '[clean-electron] กำลังล้างกระบวนการ Electron ก่อนหน้าและแคชบิลด์...',
    id: '[clean-electron] Membersihkan proses Electron lama dan cache build...',
    es: '[clean-electron] Limpiando procesos heredados de Electron y caché de compilación...',
    fr: '[clean-electron] Nettoyage des processus Electron précédents et du cache de build...',
    pt: '[clean-electron] Limpando processos legados do Electron e cache de compilação...',
    de: '[clean-electron] Bereinige alte Electron-Prozesse und Build-Cache...',
    it: '[clean-electron] Pulizia dei processi Electron precedenti e della cache di compilazione...',
    ru: '[clean-electron] Очистка старых процессов Electron и кэша сборки...',
    tr: '[clean-electron] Eski Electron süreçleri ve derleme önbelleği temizleniyor...',
  },
  CLEAN_ELECTRON_WARN_LOCK: {
    zh: '[clean-electron] 无法完全清理 {dir} (可能被安全软件扫描锁定): {err}',
    en: '[clean-electron] Unable to completely clean {dir} (may be locked by scanner): {err}',
    ja: '[clean-electron] {dir} を完全にクリーンアップできません (ロックされている可能性があります): {err}',
    ko: '[clean-electron] {dir}을(를) 완전히 정리할 수 없습니다 (잠겨 있을 수 있음): {err}',
    vi: '[clean-electron] Không thể dọn dẹp hoàn toàn {dir} (có thể bị khóa): {err}',
    th: '[clean-electron] ไม่สามารถล้าง {dir} ได้อย่างสมบูรณ์ (อาจถูกล็อก): {err}',
    id: '[clean-electron] Tidak dapat membersihkan {dir} sepenuhnya (mungkin terkunci): {err}',
    es: '[clean-electron] No se pudo limpiar completamente {dir} (puede estar bloqueado): {err}',
    fr: '[clean-electron] Impossible de nettoyer complètement {dir} (peut-être verrouillé) : {err}',
    pt: '[clean-electron] Não foi possível limpar completamente {dir} (pode estar bloqueado): {err}',
    de: '[clean-electron] {dir} konnte nicht vollständig bereinigt werden: {err}',
    it: '[clean-electron] Impossibile pulire completamente {dir} (potrebbe essere bloccato): {err}',
    ru: '[clean-electron] Не удалось полностью очистить {dir}: {err}',
    tr: '[clean-electron] {dir} tamamen temizlenemedi: {err}',
  },
  CLEAN_ELECTRON_DONE: {
    zh: '[clean-electron] 清理完毕。',
    en: '[clean-electron] Cleanup completed.',
    ja: '[clean-electron] クリーンアップが完了しました。',
    ko: '[clean-electron] 정리가 완료되었습니다.',
    vi: '[clean-electron] Dọn dẹp hoàn tất.',
    th: '[clean-electron] ล้างข้อมูลเสร็จสิ้น',
    id: '[clean-electron] Pembersihan selesai.',
    es: '[clean-electron] Limpieza completada.',
    fr: '[clean-electron] Nettoyage terminé.',
    pt: '[clean-electron] Limpeza concluída.',
    de: '[clean-electron] Bereinigung abgeschlossen.',
    it: '[clean-electron] Pulizia completata.',
    ru: '[clean-electron] Очистка завершена.',
    tr: '[clean-electron] Temizlik tamamlandı.',
  },

  // ── Add Tag ──
  ADD_TAG_BANNER_TITLE: {
    zh: '🚀 ShortVideo 自动化 GitHub Tag 发布工具',
    en: '🚀 ShortVideo Automated GitHub Tag Release Tool',
    ja: '🚀 ShortVideo 自動 GitHub Tag リリースツール',
    ko: '🚀 ShortVideo 자동 GitHub Tag 릴리스 도구',
    vi: '🚀 Công cụ phát hành GitHub Tag tự động ShortVideo',
    th: '🚀 เครื่องมือปล่อย GitHub Tag อัตโนมัติ ShortVideo',
    id: '🚀 Alat Rilis GitHub Tag Otomatis ShortVideo',
    es: '🚀 Herramienta de lanzamiento automático de etiquetas GitHub de ShortVideo',
    fr: '🚀 Outil de publication automatique de tags GitHub ShortVideo',
    pt: '🚀 Ferramenta de lançamento automático de tags GitHub ShortVideo',
    de: '🚀 Automatisches GitHub-Tag-Release-Tool für ShortVideo',
    it: '🚀 Strumento di rilascio automatico dei tag GitHub di ShortVideo',
    ru: '🚀 Инструмент автоматического создания тегов GitHub для ShortVideo',
    tr: '🚀 ShortVideo Otomatik GitHub Etiket Sürüm Aracı',
  },
  ADD_TAG_DRY_RUN_LABEL: {
    zh: '[DRY-RUN 预览模式]',
    en: '[DRY-RUN Preview Mode]',
    ja: '[DRY-RUN プレビューモード]',
    ko: '[DRY-RUN 미리보기 모드]',
    vi: '[DRY-RUN Chế độ xem trước]',
    th: '[DRY-RUN โหมดแสดงตัวอย่าง]',
    id: '[DRY-RUN Mode Pratinjau]',
    es: '[DRY-RUN Modo de vista previa]',
    fr: '[DRY-RUN Mode prévisualisation]',
    pt: '[DRY-RUN Modo de visualização]',
    de: '[DRY-RUN Vorschau-Modus]',
    it: '[DRY-RUN Modalità anteprima]',
    ru: '[DRY-RUN Режим предпросмотра]',
    tr: '[DRY-RUN Önizleme Modu]',
  },
  ADD_TAG_CURRENT_BRANCH: {
    zh: '[AddTag] 当前工作分支:',
    en: '[AddTag] Current working branch:',
    ja: '[AddTag] 現在の作業ブランチ:',
    ko: '[AddTag] 현재 작업 브랜치:',
    vi: '[AddTag] Nhánh làm việc hiện tại:',
    th: '[AddTag] สาขาที่ทำงานปัจจุบัน:',
    id: '[AddTag] Branch kerja saat ini:',
    es: '[AddTag] Rama de trabajo actual:',
    fr: '[AddTag] Branche de travail actuelle :',
    pt: '[AddTag] Branch de trabalho atual:',
    de: '[AddTag] Aktueller Arbeitszweig:',
    it: '[AddTag] Ramo di lavoro corrente:',
    ru: '[AddTag] Текущая рабочая ветка:',
    tr: '[AddTag] Geçerli çalışma dalı:',
  },
  ADD_TAG_COMMIT_MSG: {
    zh: '[AddTag] 最新提交摘要:',
    en: '[AddTag] Latest commit summary:',
    ja: '[AddTag] 最新コミット概要:',
    ko: '[AddTag] 최신 커밋 요약:',
    vi: '[AddTag] Tóm tắt cam kết mới nhất:',
    th: '[AddTag] สรุปคอมมิตล่าสุด:',
    id: '[AddTag] Ringkasan komit terbaru:',
    es: '[AddTag] Resumen del último commit:',
    fr: '[AddTag] Résumé du dernier commit :',
    pt: '[AddTag] Resumo do último commit:',
    de: '[AddTag] Zusammenfassung des letzten Commits:',
    it: '[AddTag] Riepilogo ultimo commit:',
    ru: '[AddTag] Описание последнего коммита:',
    tr: '[AddTag] Son taahhüt özeti:',
  },
  ADD_TAG_REMOTE_REPO: {
    zh: '[AddTag] 目标远程仓库:',
    en: '[AddTag] Target remote repository:',
    ja: '[AddTag] 対象リモートリポジトリ:',
    ko: '[AddTag] 대상 원격 저장소:',
    vi: '[AddTag] Kho lưu trữ từ xa mục tiêu:',
    th: '[AddTag] ที่เก็บข้อมูลระยะไกลเป้าหมาย:',
    id: '[AddTag] Repositori jarak jauh target:',
    es: '[AddTag] Repositorio remoto de destino:',
    fr: '[AddTag] Dépôt distant cible :',
    pt: '[AddTag] Repositório remoto de destino:',
    de: '[AddTag] Remote-Ziel-Repository:',
    it: '[AddTag] Repository remoto di destinazione:',
    ru: '[AddTag] Целевой удаленный репозиторий:',
    tr: '[AddTag] Hedef uzak depo:',
  },
  ADD_TAG_DIRTY_WARN: {
    zh: '⚠️  注意: 当前工作区有未提交的改动，Tag 将标记在当前最新的 Commit [{commit}] 上。',
    en: '⚠️  Notice: Working tree has uncommitted changes. Tag will mark latest commit [{commit}].',
    ja: '⚠️  注意: 未コミットの変更があります。Tag は最新の Commit [{commit}] に付けられます。',
    ko: '⚠️  주의: 커밋되지 않은 변경 사항이 있습니다. 태그는 최신 커밋 [{commit}]에 지정됩니다.',
    vi: '⚠️  Lưu ý: Không gian làm việc có thay đổi chưa cam kết. Tag sẽ đánh dấu commit mới nhất [{commit}].',
    th: '⚠️  คำเตือน: มีการเปลี่ยนแปลงที่ยังไม่ได้คอมมิต แท็กจะถูกกำหนดให้กับคอมมิตล่าสุด [{commit}]',
    id: '⚠️  Perhatian: Terdapat perubahan yang belum di-commit. Tag akan menandai commit terbaru [{commit}].',
    es: '⚠️  Aviso: Hay cambios sin confirmar. La etiqueta marcará el último commit [{commit}].',
    fr: '⚠️  Remarque : Modifications non validées présentes. Le tag marquera le dernier commit [{commit}].',
    pt: '⚠️  Aviso: Alterações não confirmadas. A tag marcará o commit mais recente [{commit}].',
    de: '⚠️  Hinweis: Nicht übernommene Änderungen vorhanden. Tag markiert letzten Commit [{commit}].',
    it: '⚠️  Avviso: Modifiche non salvate. Il tag contrassegnerà l\'ultimo commit [{commit}].',
    ru: '⚠️  Внимание: Есть незафиксированные изменения. Тег будет указывать на последний коммит [{commit}].',
    tr: '⚠️  Uyarı: İşlenmemiş değişiklikler var. Etiket son taahhüdü [{commit}] işaretleyecek.',
  },
  ADD_TAG_FETCHING: {
    zh: '[AddTag] 正在同步拉取最新 Tags (git fetch --tags)...',
    en: '[AddTag] Fetching latest tags from remote (git fetch --tags)...',
    ja: '[AddTag] 最新のタグをリモートから取得中 (git fetch --tags)...',
    ko: '[AddTag] 원격에서 최신 태그를 가져오는 중 (git fetch --tags)...',
    vi: '[AddTag] Đang tìm nạp các thẻ mới nhất (git fetch --tags)...',
    th: '[AddTag] กำลังดึงแท็กล่าสุด (git fetch --tags)...',
    id: '[AddTag] Mengambil tag terbaru dari jarak jauh (git fetch --tags)...',
    es: '[AddTag] Obteniendo las últimas etiquetas (git fetch --tags)...',
    fr: '[AddTag] Récupération des derniers tags (git fetch --tags)...',
    pt: '[AddTag] Buscando as tags mais recentes (git fetch --tags)...',
    de: '[AddTag] Letzte Tags abrufen (git fetch --tags)...',
    it: '[AddTag] Recupero degli ultimi tag (git fetch --tags)...',
    ru: '[AddTag] Получение последних тегов (git fetch --tags)...',
    tr: '[AddTag] En son etiketler getiriliyor (git fetch --tags)...',
  },
  ADD_TAG_STATS: {
    zh: '[AddTag] 检索到本地 Tag: {local} 个 | 远程 Tag: {remote} 个',
    en: '[AddTag] Found Local Tags: {local} | Remote Tags: {remote}',
    ja: '[AddTag] ローカル Tag: {local} 件 | リモート Tag: {remote} 件',
    ko: '[AddTag] 로컬 태그: {local}개 | 원격 태그: {remote}개',
    vi: '[AddTag] Tìm thấy Thẻ cục bộ: {local} | Thẻ từ xa: {remote}',
    th: '[AddTag] พบแท็กในเครื่อง: {local} | แท็กระยะไกล: {remote}',
    id: '[AddTag] Ditemukan Tag Lokal: {local} | Tag Jarak Jauh: {remote}',
    es: '[AddTag] Etiquetas locales: {local} | Etiquetas remotas: {remote}',
    fr: '[AddTag] Tags locaux : {local} | Tags distants : {remote}',
    pt: '[AddTag] Tags locais: {local} | Tags remotas: {remote}',
    de: '[AddTag] Lokale Tags: {local} | Remote-Tags: {remote}',
    it: '[AddTag] Tag locali: {local} | Tag remoti: {remote}',
    ru: '[AddTag] Локальные теги: {local} | Удаленные теги: {remote}',
    tr: '[AddTag] Yerel Etiketler: {local} | Uzak Etiketler: {remote}',
  },
  ADD_TAG_CUSTOM_SPECIFIED: {
    zh: '[AddTag] 使用手动指定的版本 Tag: {tag}',
    en: '[AddTag] Using manually specified version tag: {tag}',
    ja: '[AddTag] 手動で指定されたバージョンタグを使用: {tag}',
    ko: '[AddTag] 수동으로 지정된 버전 태그 사용: {tag}',
    vi: '[AddTag] Sử dụng thẻ phiên bản được chỉ định thủ công: {tag}',
    th: '[AddTag] ใช้แท็กเวอร์ชันที่ระบุด้วยตนเอง: {tag}',
    id: '[AddTag] Menggunakan tag versi yang ditentukan secara manual: {tag}',
    es: '[AddTag] Usando etiqueta de versión especificada manualmente: {tag}',
    fr: '[AddTag] Utilisation du tag de version spécifié manuellement : {tag}',
    pt: '[AddTag] Usando tag de versão especificada manualmente: {tag}',
    de: '[AddTag] Manuell angegebenes Versions-Tag verwenden: {tag}',
    it: '[AddTag] Utilizzo del tag di versione specificato manualmente: {tag}',
    ru: '[AddTag] Использование вручную указанного тега версии: {tag}',
    tr: '[AddTag] Manuel olarak belirtilen sürüm etiketi kullanılıyor: {tag}',
  },
  ADD_TAG_DETECTED_LATEST: {
    zh: '[AddTag] 检测到当前最新 Tag: {tag}',
    en: '[AddTag] Detected current latest tag: {tag}',
    ja: '[AddTag] 現在の最新タグを検出: {tag}',
    ko: '[AddTag] 현재 최신 태그 감지: {tag}',
    vi: '[AddTag] Đã phát hiện thẻ mới nhất hiện tại: {tag}',
    th: '[AddTag] ตรวจพบแท็กล่าสุดปัจจุบัน: {tag}',
    id: '[AddTag] Terdeteksi tag terbaru saat ini: {tag}',
    es: '[AddTag] Se detectó la etiqueta más reciente: {tag}',
    fr: '[AddTag] Dernier tag actuel détecté : {tag}',
    pt: '[AddTag] Tag mais recente detectada: {tag}',
    de: '[AddTag] Aktuellstes Tag erkannt: {tag}',
    it: '[AddTag] Rilevato il tag più recente corrente: {tag}',
    ru: '[AddTag] Обнаружен текущий последний тег: {tag}',
    tr: '[AddTag] Geçerli en son etiket algılandı: {tag}',
  },
  ADD_TAG_TARGET: {
    zh: '[AddTag] 🎯 目标 Tag: {tag} (对应应用版本: {version})',
    en: '[AddTag] 🎯 Target Tag: {tag} (App Version: {version})',
    ja: '[AddTag] 🎯 ターゲット Tag: {tag} (アプリバージョン: {version})',
    ko: '[AddTag] 🎯 대상 태그: {tag} (앱 버전: {version})',
    vi: '[AddTag] 🎯 Thẻ mục tiêu: {tag} (Phiên bản ứng dụng: {version})',
    th: '[AddTag] 🎯 แท็กเป้าหมาย: {tag} (เวอร์ชันแอป: {version})',
    id: '[AddTag] 🎯 Tag Target: {tag} (Versi Aplikasi: {version})',
    es: '[AddTag] 🎯 Etiqueta objetivo: {tag} (Versión de app: {version})',
    fr: '[AddTag] 🎯 Tag cible : {tag} (Version app : {version})',
    pt: '[AddTag] 🎯 Tag de destino: {tag} (Versão do app: {version})',
    de: '[AddTag] 🎯 Ziel-Tag: {tag} (App-Version: {version})',
    it: '[AddTag] 🎯 Tag di destinazione: {tag} (Versione app: {version})',
    ru: '[AddTag] 🎯 Целевой тег: {tag} (Версия приложения: {version})',
    tr: '[AddTag] 🎯 Hedef Etiket: {tag} (Uygulama Sürümü: {version})',
  },
  ADD_TAG_DRY_RUN_DONE: {
    zh: '🔍 DRY-RUN 演练完成！未做任何实际修改与推送。',
    en: '🔍 DRY-RUN preview completed! No actual changes or pushes made.',
    ja: '🔍 DRY-RUN プレビュー完了！実際の変更やプッシュは行われていません。',
    ko: '🔍 DRY-RUN 미리보기가 완료되었습니다! 실제 변경 사항이나 푸시는 수행되지 않았습니다.',
    vi: '🔍 DRY-RUN hoàn tất! Không có thay đổi hoặc đẩy thực tế nào được thực hiện.',
    th: '🔍 การซ้อม DRY-RUN เสร็จสมบูรณ์! ไม่มีการแก้ไขหรือพุชจริง',
    id: '🔍 DRY-RUN selesai! Tidak ada perubahan atau push aktual yang dilakukan.',
    es: '🔍 ¡Vista previa de DRY-RUN completada! No se realizaron cambios ni envíos.',
    fr: '🔍 DRY-RUN terminé ! Aucune modification réelle ni aucun push effectué.',
    pt: '🔍 Visualização DRY-RUN concluída! Nenhuma alteração real foi feita.',
    de: '🔍 DRY-RUN-Vorschau abgeschlossen! Keine tatsächlichen Änderungen vorgenommen.',
    it: '🔍 Anteprima DRY-RUN completata! Nessuna modifica effettiva eseguita.',
    ru: '🔍 Предпросмотр DRY-RUN завершен! Изменения не отправлены.',
    tr: '🔍 DRY-RUN önizlemesi tamamlandı! Hiçbir gerçek değişiklik yapılmadı.',
  },
  ADD_TAG_CREATING_LOCAL: {
    zh: '[AddTag] 正在创建本地附注 Git Tag: {tag}...',
    en: '[AddTag] Creating local annotated Git tag: {tag}...',
    ja: '[AddTag] ローカル注釈付き Git Tag を作成中: {tag}...',
    ko: '[AddTag] 로컬 주석 첨부 Git 태그 생성 중: {tag}...',
    vi: '[AddTag] Đang tạo thẻ Git có chú thích cục bộ: {tag}...',
    th: '[AddTag] กำลังสร้างแท็ก Git พร้อมคำอธิบายในเครื่อง: {tag}...',
    id: '[AddTag] Membuat tag Git beranotasi lokal: {tag}...',
    es: '[AddTag] Creando etiqueta Git anotada local: {tag}...',
    fr: '[AddTag] Création du tag Git annoté local : {tag}...',
    pt: '[AddTag] Criando tag Git anotada local: {tag}...',
    de: '[AddTag] Lokales annotiertes Git-Tag erstellen: {tag}...',
    it: '[AddTag] Creazione del tag Git annotato locale: {tag}...',
    ru: '[AddTag] Создание локального аннотированного тега Git: {tag}...',
    tr: '[AddTag] Yerel açıklamalı Git etiketi oluşturuluyor: {tag}...',
  },
  ADD_TAG_LOCAL_CREATED: {
    zh: '[AddTag] ✅ 本地 Tag 创建成功: {tag}',
    en: '[AddTag] ✅ Local tag created successfully: {tag}',
    ja: '[AddTag] ✅ ローカル Tag の作成に成功しました: {tag}',
    ko: '[AddTag] ✅ 로컬 태그가 성공적으로 생성되었습니다: {tag}',
    vi: '[AddTag] ✅ Tạo thẻ cục bộ thành công: {tag}',
    th: '[AddTag] ✅ สร้างแท็กในเครื่องสำเร็จ: {tag}',
    id: '[AddTag] ✅ Tag lokal berhasil dibuat: {tag}',
    es: '[AddTag] ✅ Etiqueta local creada con éxito: {tag}',
    fr: '[AddTag] ✅ Tag local créé avec succès : {tag}',
    pt: '[AddTag] ✅ Tag local criada com sucesso: {tag}',
    de: '[AddTag] ✅ Lokales Tag erfolgreich erstellt: {tag}',
    it: '[AddTag] ✅ Tag locale creato con successo: {tag}',
    ru: '[AddTag] ✅ Локальный тег успешно создан: {tag}',
    tr: '[AddTag] ✅ Yerel etiket başarıyla oluşturuldu: {tag}',
  },
  ADD_TAG_PUSHING: {
    zh: '[AddTag] 正在将 Tag 推送至 GitHub (git push {remote} {tag})...',
    en: '[AddTag] Pushing tag to GitHub (git push {remote} {tag})...',
    ja: '[AddTag] タグを GitHub にプッシュ中 (git push {remote} {tag})...',
    ko: '[AddTag] 태그를 GitHub에 푸시하는 중 (git push {remote} {tag})...',
    vi: '[AddTag] Đang đẩy thẻ lên GitHub (git push {remote} {tag})...',
    th: '[AddTag] กำลังพุชแท็กไปยัง GitHub (git push {remote} {tag})...',
    id: '[AddTag] Mendorong tag ke GitHub (git push {remote} {tag})...',
    es: '[AddTag] Enviando etiqueta a GitHub (git push {remote} {tag})...',
    fr: '[AddTag] Push du tag vers GitHub (git push {remote} {tag})...',
    pt: '[AddTag] Enviando tag para o GitHub (git push {remote} {tag})...',
    de: '[AddTag] Tag auf GitHub pushen (git push {remote} {tag})...',
    it: '[AddTag] Push del tag su GitHub (git push {remote} {tag})...',
    ru: '[AddTag] Отправка тега на GitHub (git push {remote} {tag})...',
    tr: '[AddTag] Etiket GitHub\'a gönderiliyor (git push {remote} {tag})...',
  },
  ADD_TAG_SUCCESS: {
    zh: '🎉 发布成功！已在 GitHub 中新增 Tag: {tag}',
    en: '🎉 Release successful! New tag created on GitHub: {tag}',
    ja: '🎉 リリース成功！GitHub に新しい Tag が作成されました: {tag}',
    ko: '🎉 릴리스 성공! GitHub에 새 태그가 생성되었습니다: {tag}',
    vi: '🎉 Phát hành thành công! Thẻ mới đã được tạo trên GitHub: {tag}',
    th: '🎉 ปล่อยสำเร็จ! สร้างแท็กใหม่บน GitHub แล้ว: {tag}',
    id: '🎉 Rilis berhasil! Tag baru dibuat di GitHub: {tag}',
    es: '🎉 ¡Lanzamiento exitoso! Nueva etiqueta creada en GitHub: {tag}',
    fr: '🎉 Publication réussie ! Nouveau tag créé sur GitHub : {tag}',
    pt: '🎉 Lançamento com sucesso! Nova tag criada no GitHub: {tag}',
    de: '🎉 Release erfolgreich! Neues Tag auf GitHub erstellt: {tag}',
    it: '🎉 Rilascio completato con successo! Nuovo tag creato su GitHub: {tag}',
    ru: '🎉 Релиз успешен! Новый тег создан на GitHub: {tag}',
    tr: '🎉 Yayınlama başarılı! GitHub\'da yeni etiket oluşturuldu: {tag}',
  },

  // ── Manage R2 Website ──
  R2_SYNC_START: {
    zh: '[R2-Website] 开始同步静态资源至 Cloudflare R2 存储桶...',
    en: '[R2-Website] Starting sync of static assets to Cloudflare R2 bucket...',
    ja: '[R2-Website] 静的アセットを Cloudflare R2 バケットに同期開始...',
    ko: '[R2-Website] Cloudflare R2 버킷에 정적 자산 동기화 시작...',
    vi: '[R2-Website] Bắt đầu đồng bộ hóa tài nguyên tĩnh với bộ chứa Cloudflare R2...',
    th: '[R2-Website] เริ่มซิงค์เนื้อหาคงที่ไปยังบักเก็ต Cloudflare R2...',
    id: '[R2-Website] Mulai sinkronisasi aset statis ke bucket Cloudflare R2...',
    es: '[R2-Website] Iniciando sincronización de recursos estáticos con Cloudflare R2...',
    fr: '[R2-Website] Début de la synchronisation des ressources vers Cloudflare R2...',
    pt: '[R2-Website] Iniciando sincronização de ativos estáticos para o Cloudflare R2...',
    de: '[R2-Website] Synchronisierung statischer Assets mit Cloudflare R2 gestartet...',
    it: '[R2-Website] Avvio sincronizzazione delle risorse statiche con Cloudflare R2...',
    ru: '[R2-Website] Запуск синхронизации статических ресурсов в Cloudflare R2...',
    tr: '[R2-Website] Statik varlıkların Cloudflare R2\'ye senkronizasyonu başlatılıyor...',
  },
  R2_SYNC_SUCCESS: {
    zh: '[R2-Website] ✅ 静态资源同步完成！总计传输文件: {count} 个',
    en: '[R2-Website] ✅ Static assets sync completed! Total uploaded files: {count}',
    ja: '[R2-Website] ✅ 静的アセットの同期が完了しました！総ファイル数: {count}',
    ko: '[R2-Website] ✅ 정적 자산 동기화 완료! 총 파일 수: {count}',
    vi: '[R2-Website] ✅ Đồng bộ tài nguyên tĩnh hoàn tất! Tổng số tệp: {count}',
    th: '[R2-Website] ✅ ซิงค์เนื้อหาคงที่สำเร็จ! จำนวนไฟล์ทั้งหมด: {count}',
    id: '[R2-Website] ✅ Sinkronisasi aset statis selesai! Total file: {count}',
    es: '[R2-Website] ✅ ¡Sincronización completada! Archivos totales: {count}',
    fr: '[R2-Website] ✅ Synchronisation terminée ! Fichiers totaux : {count}',
    pt: '[R2-Website] ✅ Sincronização concluída! Total de arquivos: {count}',
    de: '[R2-Website] ✅ Synchronisierung abgeschlossen! Dateien gesamt: {count}',
    it: '[R2-Website] ✅ Sincronizzazione completata! File totali: {count}',
    ru: '[R2-Website] ✅ Синхронизация завершена! Всего файлов: {count}',
    tr: '[R2-Website] ✅ Statik varlık senkronizasyonu tamamlandı! Toplam dosya: {count}',
  },

  // ── Delete Workflow Runs ──
  WORKFLOW_RUNS_START: {
    zh: '[WorkflowCleaner] 正在检索待清理的 GitHub Actions 运行记录...',
    en: '[WorkflowCleaner] Fetching GitHub Actions workflow runs to clean...',
    ja: '[WorkflowCleaner] クリーンアップ対象の GitHub Actions 実行ログを取得中...',
    ko: '[WorkflowCleaner] 정리할 GitHub Actions 워크플로 실행 기록을 조회 중...',
    vi: '[WorkflowCleaner] Đang tìm nạp các bản ghi chạy GitHub Actions cần dọn dẹp...',
    th: '[WorkflowCleaner] กำลังดึงประวัติการรัน GitHub Actions เพื่อทำความสะอาด...',
    id: '[WorkflowCleaner] Mengambil riwayat alur kerja GitHub Actions untuk dibersihkan...',
    es: '[WorkflowCleaner] Obteniendo ejecuciones de GitHub Actions para limpiar...',
    fr: '[WorkflowCleaner] Récupération des exécutions GitHub Actions à nettoyer...',
    pt: '[WorkflowCleaner] Buscando execuções do GitHub Actions para limpar...',
    de: '[WorkflowCleaner] Workflow-Ausführungen von GitHub Actions abrufen...',
    it: '[WorkflowCleaner] Recupero delle esecuzioni di GitHub Actions da pulire...',
    ru: '[WorkflowCleaner] Получение записей выполнения GitHub Actions для очистки...',
    tr: '[WorkflowCleaner] Temizlenecek GitHub Actions çalıştırma kayıtları alınıyor...',
  },
  WORKFLOW_RUNS_DONE: {
    zh: '[WorkflowCleaner] ✅ 历史 Workflow 运行记录清理完成。',
    en: '[WorkflowCleaner] ✅ Legacy workflow runs cleaned up successfully.',
    ja: '[WorkflowCleaner] ✅ 以前のワークフロー実行履歴のクリーンアップが完了しました。',
    ko: '[WorkflowCleaner] ✅ 이전 워크플로 실행 기록 정리가 완료되었습니다.',
    vi: '[WorkflowCleaner] ✅ Đã dọn dẹp xong các bản ghi chạy quy trình làm việc cũ.',
    th: '[WorkflowCleaner] ✅ ล้างประวัติการรันเวิร์กโฟลว์เสร็จสิ้น',
    id: '[WorkflowCleaner] ✅ Riwayat alur kerja lama berhasil dibersihkan.',
    es: '[WorkflowCleaner] ✅ Ejecuciones de flujo de trabajo limpiadas con éxito.',
    fr: '[WorkflowCleaner] ✅ Nettoyage des anciennes exécutions terminé.',
    pt: '[WorkflowCleaner] ✅ Execuções antigas de fluxo de trabalho limpas com sucesso.',
    de: '[WorkflowCleaner] ✅ Alte Workflow-Ausführungen erfolgreich bereinigt.',
    it: '[WorkflowCleaner] ✅ Vecchie esecuzioni del flusso di lavoro ripulite con successo.',
    ru: '[WorkflowCleaner] ✅ Очистка записей выполнения завершена.',
    tr: '[WorkflowCleaner] ✅ Eski iş akışı çalıştırma kayıtları başarıyla temizlendi.',
  },

  // ── GitHub Release Publisher ──
  RELEASE_BANNER_TITLE: {
    zh: '🚀 ShortVideo 自动化 GitHub Release 发布工具',
    en: '🚀 ShortVideo Automated GitHub Release Publisher',
    ja: '🚀 ShortVideo 自動 GitHub Release リリースツール',
    ko: '🚀 ShortVideo 자동 GitHub Release 게시 도구',
    vi: '🚀 Công cụ xuất bản GitHub Release tự động ShortVideo',
    th: '🚀 เครื่องมือเผยแพร่ GitHub Release อัตโนมัติ ShortVideo',
    id: '🚀 Alat Publikasi GitHub Release Otomatis ShortVideo',
    es: '🚀 Publicador automático de GitHub Release ShortVideo',
    fr: '🚀 Éditeur automatique de GitHub Release ShortVideo',
    pt: '🚀 Publicador automático de GitHub Release ShortVideo',
    de: '🚀 ShortVideo Automatisierter GitHub Release Publisher',
    it: '🚀 Pubblicatore automatico di GitHub Release ShortVideo',
    ru: '🚀 Автоматический инструмент публикации GitHub Release ShortVideo',
    tr: '🚀 ShortVideo Otomatik GitHub Release Yayınlama Aracı',
  },
  RELEASE_NO_TAG: {
    zh: '[Release] 未检测到有效的 Git Tag。请先运行 `pnpm run addtag` 创建 Tag。',
    en: '[Release] No valid Git Tag detected. Please run `pnpm run addtag` first to create a Tag.',
    ja: '[Release] 有効な Git Tag が検出されませんでした。先に `pnpm run addtag` を実行してください。',
    ko: '[Release] 유효한 Git Tag가 감지되지 않았습니다. 먼저 `pnpm run addtag`를 실행하세요.',
    vi: '[Release] Không tìm thấy Thẻ Git hợp lệ. Vui lòng chạy `pnpm run addtag` trước.',
    th: '[Release] ไม่พบแท็ก Git ที่ถูกต้อง โปรดรัน `pnpm run addtag` ก่อน',
    id: '[Release] Tidak ada Tag Git sah yang terdeteksi. Silakan jalankan `pnpm run addtag` terlebih dahulu.',
    es: '[Release] No se detectó ninguna etiqueta Git válida. Ejecute primero `pnpm run addtag`.',
    fr: '[Release] Aucune balise Git valide détectée. Veuillez d\'abord exécuter `pnpm run addtag`.',
    pt: '[Release] Nenhuma tag Git válida detectada. Por favor, execute `pnpm run addtag` primeiro.',
    de: '[Release] Kein gültiges Git-Tag erkannt. Bitte führen Sie zuerst `pnpm run addtag` aus.',
    it: '[Release] Nessun tag Git valido rilevato. Esegui prima `pnpm run addtag`.',
    ru: '[Release] Действительный тег Git не обнаружен. Сначала запустите `pnpm run addtag`.',
    tr: '[Release] Geçerli bir Git Etiketi algılanamadı. Lütfen önce `pnpm run addtag` çalıştırın.',
  },
};

function t(key, params = {}) {
  const item = DICTIONARY[key];
  if (!item) return key;

  let text = item[currentLang] || item['en'] || item['zh'] || key;
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

module.exports = {
  t,
  setCliLang,
  getCliLang,
  VALID_LANGUAGES,
};
