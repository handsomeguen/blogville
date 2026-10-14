import type { Metadata } from "next";
import Link from "next/link";
import { NearbyLocator } from "@/components/food/NearbyLocator";
import { FocusOnMapButton, FoodMap } from "@/components/food/FoodMap";
import { PlaceCard } from "@/components/food/PlaceCard";
import { ReviewList } from "@/components/food/ReviewList";
import {
  buzzLabel,
  FOOD_MESSAGES,
  FOOD_QUERY_MAX,
  FOOD_REGIONS,
  FOOD_TABS,
  isFoodRegion,
  isFoodTab,
  parseCoords,
  parseFoodQuery,
  reviewWriteHref,
  type FoodPlace,
  type FoodTab,
} from "@/lib/food";
import { formatDate } from "@/lib/time";
import { foodEnabled, kakaoEnabled, naverFoodEnabled, nearbyPlaces, placeDetail, regionHot, searchPlaces, type FoodResult } from "@/server/food";

export const metadata: Metadata = {
  title: "🍽 맛집 | Blogville",
  description: "내 주변 식당, 지역별 요즘 많이 찾는 식당, 식당 블로그 후기를 한곳에서",
};

const DEFAULT_REGION = "서울";

/** 🗺 지도용 카카오 JavaScript 키 (없으면 지도 없이 목록만) */
function mapKey(): string | null {
  return process.env.KAKAO_JS_KEY || null;
}

function detailHref(q: string, p: FoodPlace) {
  return `/food?tab=search&q=${encodeURIComponent(q)}&place=${encodeURIComponent(p.id)}`;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 rounded-xl border border-dashed border-line p-8 text-center text-ink-soft">{children}</div>;
}

function failText(r: FoodResult<unknown>): string {
  return r.status === "forbidden" ? FOOD_MESSAGES.forbidden : r.status === "off" ? FOOD_MESSAGES.off : FOOD_MESSAGES.error;
}

// 🍽 맛집: 📍 내 주변(카카오) · 🔥 지역 인기(네이버 지역·블로그) · 🔎 식당 찾기(정보 + 블로그 후기 + 이웃 글). 로그인 필요 없음
export default async function FoodPage({ searchParams }: PageProps<"/food">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const tab: FoodTab = isFoodTab(one(sp.tab)) ? (one(sp.tab) as FoodTab) : "near";

  return (
    <section aria-labelledby="food-title" className="mx-auto max-w-3xl min-w-0" data-food-tab={tab}>
      <h1 id="food-title" className="text-2xl font-extrabold">
        🍽 맛집
      </h1>
      <p className="mt-1 text-sm text-ink-soft">내 주변 식당, 지역에서 요즘 많이 찾는 곳, 식당 블로그 후기를 한곳에서 봐요.</p>
      <nav aria-label="맛집 탭" className="mt-3 flex flex-wrap gap-2">
        {FOOD_TABS.map((t) => (
          <Link key={t.key} href={`/food?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined} className={`btn ${t.key === tab ? "btn-current" : ""}`}>
            {t.label}
          </Link>
        ))}
      </nav>
      {!foodEnabled() ? (
        <Notice>{FOOD_MESSAGES.off}</Notice>
      ) : tab === "near" ? (
        <NearTab lat={one(sp.lat)} lng={one(sp.lng)} sort={one(sp.sort) === "buzz" ? "buzz" : "distance"} />
      ) : tab === "region" ? (
        <RegionTab region={isFoodRegion(one(sp.region)) ? one(sp.region)! : DEFAULT_REGION} />
      ) : (
        <SearchTab q={parseFoodQuery(one(sp.q))} placeId={one(sp.place) ?? null} />
      )}
    </section>
  );
}

async function NearTab({ lat, lng, sort }: { lat?: string; lng?: string; sort: "distance" | "buzz" }) {
  if (!kakaoEnabled()) return <Notice>{FOOD_MESSAGES.nearOff}</Notice>;
  const at = parseCoords(lat, lng);
  const result = at ? await nearbyPlaces(at, sort) : null;
  const base = at ? `/food?tab=near&lat=${at.lat}&lng=${at.lng}` : "";
  return (
    <div className="mt-4 space-y-3">
      <NearbyLocator sort={sort} located={!!at} />
      {at && (
        <nav aria-label="정렬" className="flex gap-2 text-sm">
          <Link href={base} aria-current={sort === "distance" ? "page" : undefined} className={`btn ${sort === "distance" ? "btn-current" : ""}`}>
            가까운 순
          </Link>
          {naverFoodEnabled() && (
            <Link href={`${base}&sort=buzz`} aria-current={sort === "buzz" ? "page" : undefined} className={`btn ${sort === "buzz" ? "btn-current" : ""}`}>
              요즘 블로그에 많이 올라온 순
            </Link>
          )}
        </nav>
      )}
      {result &&
        (result.status !== "ok" ? (
          <Notice>{failText(result)}</Notice>
        ) : result.value.length === 0 ? (
          <Notice>{FOOD_MESSAGES.nearEmpty}</Notice>
        ) : (
          <>
            {mapKey() && <FoodMap jsKey={mapKey()!} places={result.value} me={at} researchSort={sort} />}
            <ol className="space-y-3" data-food-list="near">
              {result.value.map((p, i) => (
                <li key={p.id}>
                  <PlaceCard place={p} rank={mapKey() ? i + 1 : undefined} recent={naverFoodEnabled() ? p.recent : undefined} detailHref={detailHref(p.name, p)} />
                  {mapKey() && p.lat !== null && <FocusOnMapButton id={p.id} />}
                </li>
              ))}
            </ol>
          </>
        ))}
    </div>
  );
}

async function RegionTab({ region }: { region: string }) {
  if (!naverFoodEnabled()) return <Notice>{FOOD_MESSAGES.off}</Notice>;
  const result = await regionHot(region);
  return (
    <div className="mt-4 space-y-3">
      <nav aria-label="지역" className="flex flex-wrap gap-1.5">
        {FOOD_REGIONS.map((r) => (
          <Link
            key={r}
            href={`/food?tab=region&region=${encodeURIComponent(r)}`}
            aria-current={r === region ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${r === region ? "border-ink bg-ink font-bold text-surface" : "border-line hover:border-accent"}`}
          >
            {r}
          </Link>
        ))}
      </nav>
      <p className="text-sm text-ink-soft">
        {region}에서 블로그·카페 후기가 많은 식당을 모아, <strong className="text-ink">최근 한 달 블로그에 많이 올라온 순</strong>으로 보여 줘요.
      </p>
      {result.status !== "ok" ? (
        <Notice>{failText(result)}</Notice>
      ) : result.value.length === 0 ? (
        <Notice>{FOOD_MESSAGES.empty}</Notice>
      ) : (
        <>
          {mapKey() && result.value.some((p) => p.lat !== null) && <FoodMap jsKey={mapKey()!} places={result.value} />}
          <ol className="space-y-3" data-food-list="region">
            {result.value.map((p, i) => (
              <li key={p.id}>
                <PlaceCard place={p} recent={p.recent} rank={i + 1} detailHref={detailHref(p.name, p)} />
                {mapKey() && p.lat !== null && <FocusOnMapButton id={p.id} />}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

async function SearchTab({ q, placeId }: { q: string | null; placeId: string | null }) {
  const result = q ? await searchPlaces(q) : null;
  const picked = result?.status === "ok" && placeId ? (result.value.find((p) => p.id === placeId) ?? null) : null;
  return (
    <div className="mt-4 space-y-3">
      <form action="/food" className="flex gap-2" role="search">
        <input type="hidden" name="tab" value="search" />
        <input
          name="q"
          defaultValue={q ?? ""}
          maxLength={FOOD_QUERY_MAX}
          placeholder="식당 이름 (예: 광주 영미오리탕)"
          aria-label="식당 이름"
          className="field min-w-0 flex-1"
          type="search"
          required
        />
        <button type="submit" className="btn btn-primary">
          찾기
        </button>
      </form>
      {picked ? (
        <PlaceDetailView place={picked} backHref={`/food?tab=search&q=${encodeURIComponent(q!)}`} />
      ) : (
        result &&
        (result.status !== "ok" ? (
          <Notice>{failText(result)}</Notice>
        ) : result.value.length === 0 ? (
          <Notice>{FOOD_MESSAGES.empty}</Notice>
        ) : (
          <ul className="space-y-3" data-food-list="search">
            {result.value.map((p) => (
              <li key={p.id}>
                <PlaceCard place={p} detailHref={detailHref(q!, p)} />
              </li>
            ))}
          </ul>
        ))
      )}
    </div>
  );
}

async function PlaceDetailView({ place, backHref }: { place: FoodPlace; backHref: string }) {
  const d = await placeDetail(place);
  return (
    <div className="space-y-4" data-food-detail={place.id}>
      <Link href={backHref} className="text-sm text-ink-soft hover:underline">
        ← 검색 결과로
      </Link>
      <PlaceCard place={place} recent={d.reviews.status === "ok" ? d.recent : undefined} />
      {mapKey() && place.lat !== null && <FoodMap jsKey={mapKey()!} places={[place]} />}

      {d.local.length > 0 && (
        <section aria-labelledby="food-local" className="rounded-xl border border-line bg-surface p-4">
          <h2 id="food-local" className="font-bold">
            🏘 Blogville 이웃 후기
          </h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {d.local.map((p) => (
              <li key={p.id} className="flex gap-2">
                <Link href={`/@${p.slug}/${p.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {p.title}
                </Link>
                <span className="shrink-0 text-ink-soft">
                  {p.nickname} · {formatDate(p.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="food-reviews" className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="food-reviews" className="font-bold">
            📝 네이버 블로그 후기
          </h2>
          {d.reviews.status === "ok" && <span className="text-xs text-ink-soft">{buzzLabel(d.recent)}</span>}
        </div>
        {d.reviews.status !== "ok" ? (
          <p className="mt-2 text-sm text-ink-soft">{d.reviews.status === "off" ? "블로그 후기는 준비 중이에요." : failText(d.reviews)}</p>
        ) : d.reviews.value.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">아직 블로그 후기가 없어요. 첫 후기를 남겨 보세요!</p>
        ) : (
          <>
            <ReviewList reviews={d.reviews.value} />
            {d.reviews.value.some((r) => r.sponsored) && (
              <p className="mt-2 text-xs text-ink-soft">
                <span className="font-semibold text-[#ef6c00]">협찬</span>·<span className="font-semibold text-[#2e7d32]">내돈내산</span> 표시는 글에 적힌 문구(제공받아·원고료·체험단, 내돈내산 등)를 자동으로 읽어 붙인 거라 틀릴 수 있어요.
              </p>
            )}
          </>
        )}
      </section>

      <Link href={reviewWriteHref(place)} className="btn btn-primary w-full justify-center">
        ✏ 이 식당 후기 쓰기
      </Link>
    </div>
  );
}
