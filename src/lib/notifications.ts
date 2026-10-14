import { MAX_LEVEL } from "./game";
import { withJosa } from "./josa";
import { formatDateTime } from "./time";

// 알림함 문구·주소·시간 (GAME-08, specs/017-notifications · 레벨업 GAME-06, specs/034-level-up). 서버와 화면이 같이 쓴다.

/** 회원이 남긴 활동 알림 (행동한 사람·글이 있다). new_post는 이웃이 새 글을 올렸을 때 (글쓴이·그 글) */
export type ActivityKind = "like" | "comment" | "reply" | "new_post";
/** 방명록 알림 (BLOG-10, specs/056-guestbook): 행동한 사람과 방명록 글이 있다 (글은 없다) */
export type GuestbookKind = "guestbook" | "guestbook_reply";
export type NotificationKind = ActivityKind | GuestbookKind | "level_up" | "feedback_reply";

export const NOTIFICATIONS_PAGE_SIZE = 20;
/** 헤더 숫자는 10개까지만 센다 (`9+`) */
export const UNREAD_COUNT_CAP = 10;

export const NOTIFICATION_EMPTY = "아직 알림이 없어요";

/** 헤더 🔔 빨간 숫자: 없으면 null, 1~9, 10개 이상은 `9+` */
export function unreadBadge(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null;
  return count > 9 ? "9+" : String(Math.floor(count));
}

export function notificationText(kind: ActivityKind, nickname: string, postTitle: string): string {
  switch (kind) {
    case "like":
      return `❤️ ${nickname}님이 「${postTitle}」에 공감했어요`;
    case "comment":
      return `💬 ${nickname}님이 「${postTitle}」에 댓글을 달았어요`;
    case "reply":
      return `💬 ${nickname}님이 내 댓글에 답글을 달았어요`;
    case "new_post":
      return `📝 ${nickname}님이 새 글을 올렸어요: ${postTitle}`;
  }
}

/** 누르면 갈 곳: 공감·새 글은 그 글, 댓글·답글은 그 글의 댓글 자리 */
export function notificationHref(kind: ActivityKind, blogSlug: string, postId: number): string {
  const post = `/@${blogSlug}/${postId}`;
  return kind === "like" || kind === "new_post" ? post : `${post}#comments`;
}

/** 방명록 알림 문구: 주인에게는 새 방명록 글, 작성자에게는 주인의 답글 */
export function guestbookNotificationText(kind: GuestbookKind, nickname: string): string {
  return kind === "guestbook" ? `📖 ${nickname}님이 방명록에 글을 남겼어요` : `📖 ${nickname}님이 내 방명록 글에 답글을 달았어요`;
}

/** 방명록 알림을 누르면 그 블로그의 방명록으로 */
export function guestbookNotificationHref(blogSlug: string): string {
  return `/@${blogSlug}/guestbook`;
}

/** 문의 답변 알림 (SUP-03·04, specs/057-support): 관리자·자동 처리가 내 문의에 답하거나 처리했을 때 */
export function feedbackNotificationText(title: string): string {
  return `🐞 문의에 답변이 달렸어요: ${title}`;
}

/** 문의 답변 알림을 누르면 내 문의가 있는 버그·문의 화면으로 */
export const FEEDBACK_NOTIFICATION_HREF = "/support";

export function isGuestbookKind(value: string): value is GuestbookKind {
  return value === "guestbook" || value === "guestbook_reply";
}

/** 알림 시각: `2026.10.02 14:05` (한국 시간) */
export function notificationTime(createdAt: Date): string {
  return formatDateTime(createdAt);
}

export function isActivityKind(value: string): value is ActivityKind {
  return value === "like" || value === "comment" || value === "reply" || value === "new_post";
}

/** 레벨업 팝업 제목: `Lv.3이 되었어요!`, `Lv.4가 되었어요!`, 최고 레벨이면 `최고 레벨 Lv.99가 되었어요!` */
export function levelUpTitle(level: number): string {
  const text = `${withJosa(`Lv.${level}`, "이/가")} 되었어요!`;
  return level >= MAX_LEVEL ? `최고 레벨 ${text}` : text;
}

/** 레벨업 팝업에 보여 줄 새 아이템 수 */
export const LEVEL_UP_ITEMS_SHOWN = 3;

export type PendingLevelUp = { level: number; items: { name: string; art: string; type: string }[]; more: number };

/** 알림함의 레벨업 줄 */
export function levelUpText(level: number): string {
  return `🎉 ${levelUpTitle(level)}`;
}

/** 레벨업 읽음 요청의 레벨: 2~99 정수만 */
export function parseLevel(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,2}$/.test(value)) return null;
  const level = Number(value);
  return level >= 2 && level <= MAX_LEVEL ? level : null;
}

/** 이웃 새 글 알림은 한 번에 이만큼의 이웃에게만 (먼저 이웃이 된 순) */
export const NEW_POST_NOTIFY_CAP = 1000;

// 알림 설정 (🔔 내 정보): 끌 수 있는 알림 종류. 문의 답변 알림은 늘 받는다.
export const NOTIFICATION_PREF_KEYS = ["like", "comment", "reply", "guestbook", "newPost", "levelUp"] as const;
export type NotificationPrefKey = (typeof NOTIFICATION_PREF_KEYS)[number];
export type NotificationPrefs = Record<NotificationPrefKey, boolean>;

/** 설정 행이 없으면 모두 켜짐 */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { like: true, comment: true, reply: true, guestbook: true, newPost: true, levelUp: true };

/** 설정 화면의 이름표 (설정 칸 순서대로) */
export const NOTIFICATION_PREF_LABELS: Record<NotificationPrefKey, string> = {
  like: "❤️ 내 글에 공감",
  comment: "💬 내 글에 댓글",
  reply: "💬 내 댓글에 답글",
  guestbook: "📖 방명록 글·답글",
  newPost: "📝 이웃의 새 글",
  levelUp: "🎉 레벨업",
};

export const NOTIFICATION_PREFS_SAVED = "알림 설정을 저장했어요";

/** 알림 종류 → 그 종류를 켜고 끄는 설정 칸. 끌 수 없는 종류(문의 답변)는 null */
export function prefKeyFor(kind: NotificationKind): NotificationPrefKey | null {
  switch (kind) {
    case "like":
    case "comment":
    case "reply":
      return kind;
    case "guestbook":
    case "guestbook_reply":
      return "guestbook";
    case "new_post":
      return "newPost";
    case "level_up":
      return "levelUp";
    case "feedback_reply":
      return null;
  }
}

/** 설정 저장 폼: 체크된 칸(값 "on")만 켜짐 */
export function parseNotificationPrefs(form: { get(name: string): unknown }): NotificationPrefs {
  return Object.fromEntries(NOTIFICATION_PREF_KEYS.map((key) => [key, form.get(key) === "on"])) as NotificationPrefs;
}
