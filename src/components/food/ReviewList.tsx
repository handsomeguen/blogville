"use client";

import { useState } from "react";
import type { FoodReview } from "@/lib/food";
import { ReviewCard } from "./ReviewCard";

/** 블로그 후기 카드 목록 + [협찬 빼고 보기] */
export function ReviewList({ reviews }: { reviews: FoodReview[] }) {
  const [hideSponsored, setHide] = useState(false);
  const sponsored = reviews.filter((r) => r.sponsored === "yes").length;
  const shown = hideSponsored ? reviews.filter((r) => r.sponsored !== "yes") : reviews;
  return (
    <>
      {sponsored > 0 && (
        <div role="group" aria-label="후기 거르기" className="mt-3 flex flex-wrap gap-2 text-sm">
          <button type="button" aria-pressed={!hideSponsored} onClick={() => setHide(false)} className={`btn min-h-9 rounded-full px-3 ${!hideSponsored ? "btn-current" : ""}`}>
            전체 {reviews.length}
          </button>
          <button type="button" aria-pressed={hideSponsored} onClick={() => setHide(true)} className={`btn min-h-9 rounded-full px-3 ${hideSponsored ? "btn-current" : ""}`} data-hide-sponsored>
            협찬 빼고 {reviews.length - sponsored}
          </button>
        </div>
      )}
      <ul className="mt-3 grid gap-3 sm:grid-cols-2" data-food-reviews>
        {shown.map((r) => (
          <li key={r.url}>
            <ReviewCard review={r} />
          </li>
        ))}
      </ul>
    </>
  );
}
