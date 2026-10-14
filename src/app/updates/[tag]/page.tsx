import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isReleaseTag, RELEASES_REPO, releaseSummary, releaseTitle } from "@/lib/releases";
import { Time } from "@/components/common/Time";
import { getRelease } from "@/server/releases";

async function load(tag: string) {
  if (!isReleaseTag(tag)) return null;
  return getRelease(tag);
}

export async function generateMetadata({ params }: PageProps<"/updates/[tag]">): Promise<Metadata> {
  const found = await load((await params).tag);
  if (!found || found === "error") return { title: "업데이트 소식 | Blogville" };
  return { title: `${releaseTitle(found.release.name)} | 업데이트 소식`, description: releaseSummary(found.release.html, 150) };
}

// 버전 하나의 릴리스 노트 (그림 포함). 위아래로 이전·다음 버전, 목록으로 돌아가기
export default async function ReleasePage({ params }: PageProps<"/updates/[tag]">) {
  const found = await load((await params).tag);
  if (!found) notFound();
  if (found === "error") {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="rounded-2xl border border-line bg-surface p-5 text-sm" data-updates-error>
          업데이트 소식을 불러오지 못했어요. 잠시 뒤 다시 열거나{" "}
          <a href={`https://github.com/${RELEASES_REPO}/releases`} target="_blank" rel="noopener noreferrer" className="underline">
            GitHub 릴리스
          </a>
          에서 보세요.
        </p>
      </div>
    );
  }
  const { release: r, newer, older } = found;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/updates" className="inline-flex min-h-11 items-center text-sm text-ink-soft hover:text-accent">
        ← 업데이트 소식 목록
      </Link>
      <article className="min-w-0 space-y-3 rounded-2xl border border-line bg-surface p-5" data-release={r.tag}>
        <header className="space-y-1">
          <h1 className="text-2xl font-extrabold">{releaseTitle(r.name)}</h1>
          <Time date={r.publishedAt} className="block text-sm text-ink-soft" />
        </header>
        <div className="prose-post release-body min-w-0" dangerouslySetInnerHTML={{ __html: r.html }} />
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm text-ink-soft underline">
          GitHub에서 보기 ({r.tag})
        </a>
      </article>
      <nav aria-label="다른 버전" className="grid gap-2 sm:grid-cols-2">
        {older ? (
          <Link href={`/updates/${older.tag}`} className="btn min-w-0 justify-start" data-release-older>
            <span className="truncate">← 이전 {releaseTitle(older.name)}</span>
          </Link>
        ) : (
          <span />
        )}
        {newer && (
          <Link href={`/updates/${newer.tag}`} className="btn min-w-0 justify-end sm:col-start-2" data-release-newer>
            <span className="truncate">다음 {releaseTitle(newer.name)} →</span>
          </Link>
        )}
      </nav>
    </div>
  );
}
