import type { Metadata } from "next";
import Link from "next/link";
import { adminResolveError } from "@/app/admin/errors-actions";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { TestErrorButton } from "@/components/admin/TestErrorButton";
import { Time } from "@/components/common/Time";
import { ERROR_RANGES, parseErrorRange, ROUTE_TYPES, type ErrorRange } from "@/lib/error-log-rules";
import { requireAdmin } from "@/server/dal";
import { listErrors } from "@/server/error-log";

export const metadata: Metadata = { title: "오류 | 관리자 | Blogville" };

// 서버 오류 기록: 처리 못 한 서버 오류를 마지막으로 난 순서로. 기간으로 거른다 (`?range=24h|7d|all`)
export default async function AdminErrorsPage({ searchParams }: PageProps<"/admin/errors">) {
  await requireAdmin();
  const range = parseErrorRange((await searchParams).range);
  const items = await listErrors(range);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">⚠️ 서버 오류</h1>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="기간" className="flex gap-1">
          {(Object.keys(ERROR_RANGES) as ErrorRange[]).map((r) => (
            <Link
              key={r}
              href={r === "24h" ? "/admin/errors" : `/admin/errors?range=${r}`}
              aria-current={r === range ? "page" : undefined}
              className={`btn ${r === range ? "btn-current" : ""}`}
            >
              {ERROR_RANGES[r]}
            </Link>
          ))}
        </nav>
        <TestErrorButton />
      </div>
      <p className="text-sm text-ink-soft">
        {items.length.toLocaleString("ko-KR")}가지 · 같은 오류가 1시간 안에 또 나면 한 줄로 묶어 횟수를 센다 · 30일 지난 기록은 지워진다
      </p>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-5 text-ink-soft">기록된 오류가 없어요</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface px-4">
          {items.map((e) => (
            <li key={e.id} className="space-y-1 py-3 text-sm" data-error-log={e.id} data-error-count={e.count}>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Time date={e.lastSeenAt} seconds className="text-ink-soft" />
                {e.routeType && <span className="rounded-full bg-accent/10 px-2 font-bold text-accent">{ROUTE_TYPES[e.routeType] ?? e.routeType}</span>}
                <span className="font-semibold break-all" data-error-route>
                  {e.method ? `${e.method} ` : ""}
                  {e.routePath ?? e.url ?? "-"}
                </span>
                <span className={e.count > 1 ? "font-bold text-danger" : "text-ink-soft"} data-error-times>
                  {e.count.toLocaleString("ko-KR")}회
                </span>
              </p>
              <p className="break-words" data-error-message>
                {e.message}
              </p>
              {e.url && e.url !== e.routePath && <p className="break-all text-ink-soft">주소: {e.url}</p>}
              {(e.stack || e.digest || e.userAgent) && (
                <details>
                  <summary className="cursor-pointer text-ink-soft">자세히</summary>
                  <dl className="mt-1 space-y-1 text-ink-soft">
                    <dd>처음: <Time date={e.createdAt} seconds /></dd>
                    {e.digest && <dd>digest: {e.digest}</dd>}
                    {e.userAgent && <dd className="break-all">브라우저: {e.userAgent}</dd>}
                  </dl>
                  {e.stack && <pre className="mt-1 overflow-x-auto rounded-lg bg-bg p-2 text-xs whitespace-pre">{e.stack}</pre>}
                </details>
              )}
              <AdminActionForm action={adminResolveError} label="오류 해결함" confirm="이 오류 기록을 지울까요?" className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="errorId" value={e.id} />
                <button type="submit" className="btn btn-ghost px-2">
                  해결함
                </button>
              </AdminActionForm>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
