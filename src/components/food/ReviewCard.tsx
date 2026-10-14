import type { FoodReview } from "@/lib/food";

/**
 * 🍽 블로그 후기 카드: 대표 사진 배너, 그 위에 협찬·내돈내산 표시, 제목·요약·블로거·날짜. 누르면 원문이 새 탭으로.
 * 사진은 네이버(pstatic)가 다른 사이트에서 부르면 막기 때문에 referrer 없이 부른다.
 */
export function ReviewCard({ review }: { review: FoodReview }) {
  return (
    <a
      href={review.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface transition hover:border-accent hover:shadow-md"
      data-food-review={review.sponsored ?? "unknown"}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-bg">
        {review.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- 네이버 블로그 사진, 크기를 모른다
          <img src={review.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover transition group-hover:scale-[1.02]" />
        ) : (
          <span aria-hidden className="absolute inset-0 flex items-center justify-center text-3xl">
            📝
          </span>
        )}
        {review.sponsored === "yes" && (
          <span className="absolute left-2 top-2 rounded-full bg-[#ef6c00] px-2 py-0.5 text-xs font-bold text-white shadow" data-sponsored>
            협찬
          </span>
        )}
        {review.sponsored === "no" && (
          <span className="absolute left-2 top-2 rounded-full bg-[#2e7d32] px-2 py-0.5 text-xs font-bold text-white shadow" data-own-money>
            내돈내산
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 font-semibold leading-snug group-hover:underline">{review.title}</p>
        {review.summary && <p className="line-clamp-2 text-sm text-ink-soft">{review.summary}</p>}
        <p className="mt-auto pt-1 text-xs text-ink-soft">
          {review.blogger}
          {review.date && ` · ${review.date.replaceAll("-", ".")}`}
        </p>
      </div>
    </a>
  );
}
