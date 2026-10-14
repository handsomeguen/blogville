import type { Metadata } from "next";
import { Pagination } from "@/components/blog/Pagination";
import { parsePage } from "@/lib/ids";
import { feedbackNotificationText, guestbookNotificationText, levelUpText, NOTIFICATION_EMPTY, NOTIFICATIONS_PAGE_SIZE, notificationText, notificationTime } from "@/lib/notifications";
import { fullDateTime } from "@/lib/time";
import { requireMember } from "@/server/dal";
import { countUnreadNotifications, listNotifications } from "@/server/notifications";
import { markAllNotificationsRead, openNotification } from "./actions";

export const metadata: Metadata = { title: "알림함 | Blogville" };

// 알림함 (GAME-08): 내 글에 달린 공감·댓글, 내 댓글에 달린 답글, 방명록(BLOG-10), 레벨업(GAME-06), 문의 답변(SUP-03). 최신순 20개씩.
export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const member = await requireMember();
  const page = parsePage((await searchParams).page);
  const [{ items, total }, unread] = await Promise.all([listNotifications(member.userId, page), countUnreadNotifications(member.userId)]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">🔔 알림함</h1>
        {unread > 0 && (
          <form action={markAllNotificationsRead}>
            <button type="submit" className="btn">
              모두 읽음
            </button>
          </form>
        )}
      </div>

      {/* 마지막보다 큰 쪽도 빈 문구 (POST-05) */}
      {items.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-center text-ink-soft">{NOTIFICATION_EMPTY}</p>
      ) : (
        <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface" aria-label="알림">
          {items.map((n) => (
            <li key={n.id}>
              <form action={openNotification}>
                <input type="hidden" name="id" value={n.id} />
                <button
                  type="submit"
                  className={`flex min-h-11 w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-ink/5 ${n.read ? "" : "bg-[#fff3d6] font-bold"}`}
                  data-notification={n.read ? "read" : "unread"}
                  data-kind={n.kind}
                >
                  <span className="min-w-0 break-words">
                    {!n.read && <span className="sr-only">안 읽음, </span>}
                    {n.kind === "level_up"
                      ? levelUpText(n.level)
                      : n.kind === "feedback_reply"
                        ? feedbackNotificationText(n.feedbackTitle)
                        : n.kind === "guestbook" || n.kind === "guestbook_reply"
                        ? guestbookNotificationText(n.kind, n.nickname)
                        : notificationText(n.kind, n.nickname, n.postTitle)}
                  </span>
                  <time className="shrink-0 text-sm font-normal text-ink-soft" dateTime={n.createdAt.toISOString()} title={fullDateTime(n.createdAt)}>
                    {notificationTime(n.createdAt)}
                  </time>
                </button>
              </form>
            </li>
          ))}
        </ol>
      )}
      <Pagination basePath="/notifications" query={{}} page={page} totalPages={Math.ceil(total / NOTIFICATIONS_PAGE_SIZE)} />
    </div>
  );
}
