import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminDeleteButton } from "@/components/admin/AdminDeleteButton";
import { ViewCount } from "@/components/blog/ViewCount";
import { CategoryBadge } from "@/components/post/CategoryBadge";
import { DeletePostButton } from "@/components/post/DeletePostButton";
import { CommentSection } from "@/components/post/CommentSection";
import { LikeButton } from "@/components/post/LikeButton";
import { BookmarkButton } from "@/components/post/BookmarkButton";
import { ReportButton } from "@/components/post/ReportButton";
import { PublishNotice } from "@/components/post/PublishNotice";
import { PostJsonLd } from "@/components/post/PostJsonLd";
import { SeriesBox } from "@/components/post/SeriesBox";
import { AdjacentPosts } from "@/components/post/AdjacentPosts";
import { BackToTop } from "@/components/post/BackToTop";
import { PostBody } from "@/components/post/PostBody";
import { ShareBar } from "@/components/post/ShareBar";
import { TableOfContents } from "@/components/post/TableOfContents";
import { CategoryPosts } from "@/components/post/CategoryPosts";
import { TagList } from "@/components/post/TagList";
import { excerpt, firstImageKey, siteUrl } from "@/lib/feed";
import { parseId } from "@/lib/ids";
import { hasPostReward } from "@/server/points";
import { showsPublishNotice } from "@/lib/post-rules";
import { loginHref } from "@/lib/safe-next";
import { scheduleLabel } from "@/lib/schedule";
import { Time } from "@/components/common/Time";
import { renderPostHtml } from "@/lib/post-render";
import { readingMinutes, TOC_MIN_HEADINGS } from "@/lib/reader";
import { getBlogBySlug } from "@/server/blog";
import { accentProps } from "@/lib/blog-accent";
import { getSession } from "@/server/dal";
import { BlindNotice } from "@/components/post/BlindNotice";
import { getAdjacentPosts, getCategoryPosts, getPostForView } from "@/server/post";
import { getCommentThread } from "@/server/comments";
import { getLikeState } from "@/server/likes";
import { getBookmarkState } from "@/server/bookmarks";
import { hasViewedToday } from "@/server/stats";
import { getPostTags } from "@/server/tags";
import { readVisitorId } from "@/server/visitor";

async function load(slug: string, rawId: string) {
  const postId = parseId(rawId);
  if (postId === null) return null;
  const found = await getBlogBySlug(slug);
  if (!found) return null;
  const member = await getSession();
  const isOwner = member?.userId === found.blog.ownerId;
  const row = await getPostForView(found.blog.id, postId, isOwner);
  return row ? { ...found, ...row, isOwner, member } : null;
}

export async function generateMetadata({ params }: PageProps<"/blog/[slug]/[postId]">): Promise<Metadata> {
  const { slug, postId } = await params;
  const data = await load(slug, postId);
  if (!data) return { title: "길을 잃었어요 | Blogville" };
  // 비공개 글은 주인이 봐도 제목을 탭·기록에 남기지 않고, 공유 미리보기·검색에도 내놓지 않는다 (POST-02)
  if (!data.post.isPublic) return { title: "글 | Blogville", openGraph: null, twitter: null, robots: { index: false, follow: false } };
  const { post, blog, nickname } = data;
  const description = excerpt(post.contentText);
  const image = firstImageKey(post.contentHtml);
  const url = `/@${blog.slug}/${post.id}`;
  return {
    title: `${post.title} | ${blog.title}`,
    description,
    alternates: { canonical: url, types: { "application/rss+xml": [{ url: `/@${blog.slug}/rss`, title: blog.title }] } },
    // 카카오톡·SNS에 주소를 붙이면 보이는 미리보기 (제목·요약·첫 사진)
    openGraph: {
      type: "article",
      title: post.title,
      description,
      url,
      siteName: blog.title,
      publishedTime: post.createdAt.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      authors: [nickname],
      // 사진이 없는 글은 사이트 기본 그림 (opengraph-image.tsx)
      images: [{ url: image ? `/files/${image}` : "/opengraph-image" }],
    },
    twitter: { card: image ? "summary_large_image" : "summary", title: post.title, description },
  };
}

export default async function PostPage({ params, searchParams }: PageProps<"/blog/[slug]/[postId]">) {
  const { slug, postId } = await params;
  const { new: justPublished } = await searchParams;
  const data = await load(slug, postId);
  if (!data) notFound();
  const { blog, nickname, post, categoryName, subcategoryName, isOwner, member } = data;
  const [thread, adjacent, sameCategory] = await Promise.all([
    getCommentThread(post.id, blog.ownerId, member),
    getAdjacentPosts(blog.id, post.id, isOwner),
    post.categoryId ? getCategoryPosts(blog.id, post.id, post.categoryId, isOwner) : [],
  ]);
  const categoryHref = post.categoryId
    ? `/@${blog.slug}?category=${post.categoryId}${post.subcategoryId ? `&sub=${post.subcategoryId}` : ""}`
    : undefined;
  const edited = post.updatedAt.getTime() - post.createdAt.getTime() > 1000;
  // 방문자의 [로그인]은 로그인 뒤 이 글로 돌아온다 (AUTH-09·SOC-01·SOC-03 열린 질문)
  const postPath = `/@${blog.slug}/${post.id}`;
  // 조회수 (POST-06): 서버 렌더는 바꾸지 않는다. 오늘 처음 연 브라우저면 +1 한 값으로 시작한다.
  const countsView = !isOwner && post.isPublic;
  const firstToday = countsView && !(await hasViewedToday(post.id, await readVisitorId()));

  // 발행 안내: 주소에 ?new가 있고 주인이 만든 지 10분 안인 글 (POST-01)
  const notice = justPublished !== undefined && showsPublishNotice(isOwner, post.createdAt);
  // 글 읽기 편의: 소제목 id·목차, 코드 색칠 (보여 줄 때만 바꾸고 다시 정화한다)
  const body = renderPostHtml(post.contentHtml);

  return (
    // 블로그 강조색은 CSS 변수라 display:contents 칸으로 감싸도 안쪽에 이어진다
    <div className="contents" {...accentProps(blog.accentColor)}>
      {post.isPublic && (
        <PostJsonLd
          siteUrl={siteUrl()}
          blog={blog}
          post={post}
          nickname={nickname}
          description={excerpt(post.contentText)}
          imageKey={firstImageKey(post.contentHtml)}
          categoryName={categoryName}
          categoryHref={categoryHref ?? null}
        />
      )}
      {notice && <PublishNotice rewarded={await hasPostReward(blog.ownerId, post.id)} />}
      <article className="mx-auto max-w-3xl rounded-2xl border border-line bg-surface p-5 md:p-8">
        {isOwner && post.blindedAt && <BlindNotice reason={post.blindReason} />}
        <Link href={`/@${blog.slug}`} className="-ml-1 flex min-h-11 w-fit max-w-full items-center px-1 font-semibold text-ink-soft hover:text-ink" data-blog-link>
          <span className="truncate">📖 {blog.title}</span>
        </Link>
        <CategoryBadge categoryName={categoryName} subcategoryName={subcategoryName} href={categoryHref} />
        <h1 className="mt-2 text-3xl font-extrabold focus:outline-none" tabIndex={-1}>
          {post.title}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          {nickname} · <Time date={post.createdAt} />
          {edited && " · 수정됨"}
          {` · 약 ${readingMinutes(post.contentText)}분 읽기`}
          {" · "}
          <ViewCount postId={post.id} initial={post.viewCount + (firstToday ? 1 : 0)} record={countsView} />
          {!post.isPublic && <span className="ml-2 font-semibold">{post.publishAt ? `⏰ ${scheduleLabel(post.publishAt)} 공개 예약` : "🔒 비공개"}</span>}
        </p>
        {post.seriesId !== null && <SeriesBox slug={blog.slug} seriesId={post.seriesId} postId={post.id} viewerIsOwner={isOwner} />}
        {body.toc.length >= TOC_MIN_HEADINGS && <TableOfContents items={body.toc} />}
        {/* content_html은 저장할 때 허용 태그만 남긴 HTML이고, renderPostHtml이 한 번 더 거른다 (NF-03) */}
        <PostBody html={body.html} />
        <TagList tags={await getPostTags(post.id)} />
        {post.isPublic && <ShareBar url={`${siteUrl()}${postPath}`} title={post.title} />}
        <LikeButton postId={post.id} {...await getLikeState(post.id, member?.userId ?? null)} canLike={member !== null} loginHref={loginHref(postPath)} />
        {/* 🔖 스크랩 (공개 글만)·🚨 신고 (남의 글을 볼 수 있는 회원만), specs/059-report-bookmarks */}
        {(post.isPublic || (member && !isOwner)) && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2" data-post-actions>
            {post.isPublic && (
              <BookmarkButton postId={post.id} {...await getBookmarkState(post.id, member?.userId ?? null)} canBookmark={member !== null} loginHref={loginHref(postPath)} />
            )}
            {member && !isOwner && <ReportButton targetType="post" targetId={post.id} />}
          </div>
        )}
        <AdjacentPosts slug={blog.slug} {...adjacent} />
        <footer className={`flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 ${adjacent.older || adjacent.newer ? "" : "mt-8"}`}>
          <Link href={`/@${blog.slug}`} className="btn">
            목록으로
          </Link>
          {isOwner && (
            <div className="flex gap-2">
              <Link href={`/write/${post.id}`} className="btn">
                수정
              </Link>
              <DeletePostButton postId={post.id} />
            </div>
          )}
          {/* 관리자는 남의 공개 글을 이 화면에서 지운다 (AUTH-08, /admin 최근 글에 없는 오래된 글도) */}
          {!isOwner && member?.role === "admin" && <AdminDeleteButton postId={post.id} title={post.title} leave />}
        </footer>
        <CommentSection postId={post.id} items={thread.items} count={thread.count} signedIn={member !== null} loginHref={loginHref(`${postPath}#comments`)} />
        {post.categoryId && categoryName && <CategoryPosts slug={blog.slug} categoryName={categoryName} href={`/@${blog.slug}?category=${post.categoryId}`} items={sameCategory} />}
      </article>
      <BackToTop />
    </div>
  );
}
