/**
 * Multilingual dictionary for every ChatGPT UI label super-whisper matches on.
 *
 * ChatGPT localizes the whole UI to the ACCOUNT language (bottom-left profile
 * button → Settings → Language), so label matching must cover the languages
 * users actually run. Verified live: en (2026-07-04), ja (2026-07-05).
 * zh-Hans / zh-Hant / ko / es / fr / de / pt / ru are best-effort translations
 * of ChatGPT's strings — when one is wrong, the fix is HERE, in one place
 * (plus the position/testid fallbacks, which are language-independent).
 *
 * All matching happens against lowercased text, so keep tokens lowercase.
 */

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Joins tokens into a regex alternation for use inside page expressions. */
export const labelAlternation = (tokens: readonly string[]): string =>
  tokens.map(escapeRegex).join("|");

/** Words that mean voice/dictation/microphone. */
export const VOICE_WORDS = [
  "dictat", // dictate/dictation
  "speech",
  "microphone",
  "voice",
  "音声入力",
  "音声",
  "マイク",
  "听写", // measured zh-hans: 开始听写 / 提交听写 / 取消听写
  "聽寫", // measured zh-hant(TW): 開始聽寫 / 提交聽寫 / 取消聽寫
  "语音",
  "語音",
  "麦克风",
  "麥克風",
  "받아쓰기",
  "음성",
  "마이크",
  "dictado",
  "dictée",
  "dictee",
  "voz",
  "micrófono",
  "diktat",
  "diktier",
  "spracheingabe",
  "voix",
  "dictar",
  "ditado",
  "диктов",
  "голос",
  "микрофон",
] as const;

/** Words that mean start/begin. */
export const START_WORDS = [
  "start",
  "begin",
  "record",
  "input",
  "入力",
  "開始",
  "开始",
  "시작",
  "iniciar",
  "commencer",
  "démarrer",
  "demarrer",
  "starten",
  "começar",
  "comecar",
  "начать",
  "запис",
] as const;

/** Words that mean send/submit (also used as a START-scorer penalty). */
export const SEND_WORDS = [
  "send",
  "submit",
  "送信",
  "送出", // measured zh-hant(HK) 2026-07-05: 送出聽寫
  "发送",
  "傳送",
  "提交",
  "전송",
  "보내기",
  "제출",
  "enviar",
  "envoyer",
  "soumettre",
  "senden",
  "übermitteln",
  "отправ",
] as const;

/** Words that mean finish/done/confirm/stop (dictation submit variants). */
export const FINISH_WORDS = [
  "finish",
  "done",
  "confirm",
  "accept",
  "use transcription",
  "確定",
  "完了",
  "停止",
  "完成",
  "확인",
  "완료",
  "중지",
  "listo",
  "terminado",
  "detener",
  "terminé",
  "termine",
  "arrêter",
  "arreter",
  "fertig",
  "stoppen",
  "concluído",
  "concluido",
  "parar",
  "готово",
  "остановить",
] as const;

/** Exact-ish "send message" phrases (always the WRONG button for dictation). */
export const SEND_MESSAGE_PHRASES = [
  "send message",
  "submit message",
  "send prompt",
  "メッセージを送信",
  "プロンプトを送信",
  "发送消息",
  "傳送訊息",
  "메시지 보내기",
  "메시지 전송",
  "enviar mensaje",
  "envoyer le message",
  "nachricht senden",
  "enviar mensagem",
  "отправить сообщение",
] as const;

/** Words that mean cancel/close/discard. */
export const CANCEL_WORDS = [
  "cancel",
  "close",
  "discard",
  "clear",
  "dismiss",
  "stop",
  "キャンセル",
  "閉じる",
  "停止",
  "破棄",
  "取消",
  "关闭",
  "關閉",
  "취소",
  "닫기",
  "cancelar",
  "cerrar",
  "annuler",
  "fermer",
  "abbrechen",
  "schließen",
  "schliessen",
  "fechar",
  "отмена",
  "закрыть",
] as const;

/** Words that mean delete. */
export const DELETE_WORDS = [
  "delete",
  "削除",
  "删除",
  "刪除",
  "삭제",
  "eliminar",
  "borrar",
  "supprimer",
  "löschen",
  "loschen",
  "excluir",
  "apagar",
  "удалить",
] as const;

/** Words that mean archive (measured ja/zh-Hans/zh-Hant/ko 2026-07-05). */
export const ARCHIVE_WORDS = [
  "archive",
  "アーカイブ",
  "归档",
  "封存",
  "아카이브",
  "archivar",
  "archiver",
  "archivieren",
  "arquivar",
  "архив",
] as const;

/** Words that mean the ... options/more menu. */
export const OPTIONS_WORDS = [
  "more",
  "options",
  "open menu",
  "conversation options",
  "オプション",
  "选项",
  "更多",
  "選項",
  "옵션",
  "더보기",
  "opciones",
  "options",
  "optionen",
  "opções",
  "opcoes",
  "параметры",
  "ещё",
  "еще",
] as const;

/** Words that mean project (used to EXCLUDE project-level controls). */
export const PROJECT_WORDS = [
  "project",
  "プロジェクト",
  "项目",
  "項目", // zh-hant(TW) says 項目, not 專案 (measured 2026-07-05)
  "專案",
  "프로젝트",
  "proyecto",
  "projet",
  "projekt",
  "projeto",
  "проект",
] as const;

/** The sidebar "New project" button. */
export const NEW_PROJECT_LABELS = [
  "new project",
  "create project",
  "プロジェクトを新規作成",
  "新しいプロジェクト",
  "新規プロジェクト",
  "新项目", // measured zh-hans 2026-07-05
  "新建项目",
  "创建项目",
  "新項目", // measured zh-hant(TW) 2026-07-05
  "新增專案",
  "建立專案",
  "새 프로젝트",
  "프로젝트 만들기",
  "nuevo proyecto",
  "crear proyecto",
  "nouveau projet",
  "créer un projet",
  "neues projekt",
  "projekt erstellen",
  "novo projeto",
  "criar projeto",
  "новый проект",
  "создать проект",
] as const;

/** Confirm button in the create-project dialog. */
export const CREATE_CONFIRM_LABELS = [
  "create",
  "作成",
  "创建",
  "建立",
  "만들기",
  "생성",
  "crear",
  "créer",
  "creer",
  "erstellen",
  "criar",
  "создать",
] as const;

/** The "Show project details" button on a project page. */
export const PROJECT_DETAILS_LABELS = [
  "show project details",
  "project details",
  "プロジェクトの詳細",
  "项目详情",
  "項目の詳細",
  "項目詳細", // measured zh-hant(TW): 顯示項目詳細資料
  "專案詳細", // measured zh-hant(HK): 顯示專案詳細資料
  "프로젝트 세부", // measured ko 2026-07-05: "프로젝트 세부 정보 표시"
  "detalles del proyecto",
  "détails du projet",
  "details du projet",
  "projektdetails",
  "detalhes do projeto",
  "сведения о проекте",
  "детали проекта",
] as const;

/** The "Project settings" menu item. */
export const PROJECT_SETTINGS_LABELS = [
  "project settings",
  "プロジェクト設定",
  "项目设置",
  "項目設定", // measured zh-hant(TW) 2026-07-05
  "專案設定",
  "프로젝트 설정",
  "configuración del proyecto",
  "configuracion del proyecto",
  "paramètres du projet",
  "parametres du projet",
  "projekteinstellungen",
  "configurações do projeto",
  "configuracoes do projeto",
  "настройки проекта",
] as const;

/** The dirty-state "Save" button in the settings dialog. */
export const SAVE_LABELS = [
  "save",
  "保存",
  "儲存",
  "저장",
  "guardar",
  "enregistrer",
  "speichern",
  "salvar",
  "сохранить",
] as const;

/** The "Close" button of dialogs. */
export const CLOSE_LABELS = [
  "close",
  "閉じる",
  "关闭",
  "關閉",
  "닫기",
  "cerrar",
  "fermer",
  "schließen",
  "schliessen",
  "fechar",
  "закрыть",
] as const;

/** The sidebar row button "Open project home". */
export const OPEN_PROJECT_HOME_LABELS = [
  "open project home",
  "プロジェクトのホームを開く",
  "打开项目首页", // measured zh-hans 2026-07-05
  "開啟項目主頁", // measured zh-hant(TW) 2026-07-05
  "開啟專案首頁",
  "프로젝트 홈 열기",
  "abrir página principal del proyecto",
  "ouvrir l'accueil du projet",
  "projekt-startseite öffnen",
  "abrir página inicial do projeto",
  "открыть главную страницу проекта",
] as const;

/** Pin/unpin — clicking these once unpinned a user's conversation. Never touch. */
export const PIN_WORDS = [
  "unpin",
  "pin",
  "ピン",
  "固定",
  "置顶", // measured zh-hans 2026-07-05 (取消置顶 = unpin)
  "置頂", // measured zh-hant(TW)
  "釘選", // measured zh-hant(HK): 取消釘選
  "고정",
  "fijar",
  "épingler",
  "epingler",
  "anheften",
  "fixar",
  "закрепить",
] as const;
