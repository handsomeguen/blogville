import "server-only";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { blogs, posts, profiles } from "@/db/schema";
import { likePattern } from "@/lib/blog-search";
import { todayKST } from "@/lib/kst";
import {
  analyzeReviewPage,
  mobileBlogUrl,
  FOOD_RADIUS_M,
  FOOD_RECENT_CAP,
  FOOD_REGION_TOP,
  areaOf,
  countRecent,
  dedupePlaces,
  parseKakaoPlaces,
  parseNaverPlaces,
  parseReviews,
  rankByBuzz,
  type BuzzPlace,
  type FoodPlace,
  type FoodReview,
} from "@/lib/food";

// 🍽 맛집: 카카오 로컬(내 주변·식당 찾기, 하루 10만 번 무료)과 NAVER API HUB 검색(지역 인기·블로그 후기)을 서버가 부른다.
// 열쇠: KAKAO_REST_API_KEY(카카오맵 사용 설정을 켠 앱의 REST API 키), NAVER_SEARCH_CLIENT_ID·_SECRET(뉴스 위젯과 같은 앱에 지역·블로그 추가).
// 둘 중 하나만 있어도 되는 탭은 켜진다. 같은 질문은 6시간 기억하고, 실패는 1분만 기억한다.
// 시험은 KAKAO_API_BASE·FOOD_NAVER_BASE로 가짜 서버를 가리킨다. 위치는 저장하지 않는다.
const KAKAO = () => process.env.KAKAO_API_BASE ?? "https://dapi.kakao.com";
const NAVER = () => process.env.FOOD_NAVER_BASE ?? "https://naverapihub.apigw.ntruss.com";
const TTL_MS = 6 * 3_600_000;
const FAIL_TTL_MS = 60_000;
const TIMEOUT_MS = 5_000;
// 지역 인기 후보를 모으는 검색어 (네이버 지역 검색은 한 번에 5곳까지라 여러 번 묻는다)
const REGION_QUERIES = ["맛집", "한식 맛집", "고기 맛집", "일식 맛집", "중식 맛집", "양식 맛집"];

export type FoodResult<T> = { status: "ok"; value: T } | { status: "off" | "forbidden" | "error" };

class Forbidden extends Error {}

export function kakaoEnabled(): boolean {
  return !!process.env.KAKAO_REST_API_KEY;
}

export function naverFoodEnabled(): boolean {
  return !!(process.env.NAVER_SEARCH_CLIENT_ID && process.env.NAVER_SEARCH_CLIENT_SECRET);
}

export function foodEnabled(): boolean {
  return kakaoEnabled() || naverFoodEnabled();
}

const cache = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();

function remember<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value as Promise<T>;
  const entry = { at: Date.now(), ttl: TTL_MS, value: load() as Promise<unknown> };
  entry.value.catch(() => {
    entry.ttl = FAIL_TTL_MS;
  });
  cache.set(key, entry);
  if (cache.size > 5_000) for (const [k, v] of cache) if (Date.now() - v.at >= v.ttl) cache.delete(k);
  return entry.value as Promise<T>;
}

async function getJson(url: string, headers: Record<string, string>, name: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  // 카카오맵 사용 설정을 안 켰거나 API HUB 앱에 지역·블로그를 추가하지 않았으면 401·403
  if (res.status === 401 || res.status === 403) throw new Forbidden(`${name} ${res.status}`);
  if (!res.ok) throw new Error(`${name} ${res.status}`);
  return res.json();
}

function kakao(path: string, params: Record<string, string | number>): Promise<unknown> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return getJson(`${KAKAO()}${path}?${q}`, { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` }, "kakao local");
}

function naver(path: string, params: Record<string, string | number>): Promise<unknown> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return getJson(
    `${NAVER()}${path}?${q}`,
    { "X-NCP-APIGW-API-KEY-ID": process.env.NAVER_SEARCH_CLIENT_ID!, "X-NCP-APIGW-API-KEY": process.env.NAVER_SEARCH_CLIENT_SECRET! },
    `naver ${path}`,
  );
}

async function settle<T>(work: () => Promise<T>, label: string): Promise<FoodResult<T>> {
  try {
    return { status: "ok", value: await work() };
  } catch (e) {
    if (e instanceof Forbidden) return { status: "forbidden" };
    console.error(`${label}을 못 받았어요`, e instanceof Error ? e.message : e);
    return { status: "error" };
  }
}

/** 한꺼번에 너무 많이 부르지 않도록 n개씩 */
async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function reviewQuery(p: Pick<FoodPlace, "name" | "address">): string {
  return `${p.name} ${areaOf(p.address)}`.trim();
}

/** 최근 30일 블로그 글 수 (최신순 100편 중). 네이버 열쇠가 없거나 못 받으면 0 */
function recentCount(p: FoodPlace): Promise<number> {
  if (!naverFoodEnabled()) return Promise.resolve(0);
  const today = todayKST();
  return remember(`recent|${today}|${reviewQuery(p)}`, async () => {
    const json = await naver("/search/v1/blog", { query: reviewQuery(p), display: FOOD_RECENT_CAP, sort: "date" });
    return countRecent(parseReviews(json), today);
  }).catch(() => 0);
}

function withBuzz(list: FoodPlace[]): Promise<BuzzPlace[]> {
  return mapLimit(list, 5, async (p) => ({ ...p, recent: await recentCount(p) }));
}

/** 📍 내 주변 1km 식당 (가까운 순, 또는 최근 블로그 글 많은 순) */
export function nearbyPlaces(at: { lat: number; lng: number }, sort: "distance" | "buzz"): Promise<FoodResult<BuzzPlace[]>> {
  if (!kakaoEnabled()) return Promise.resolve({ status: "off" });
  return settle(async () => {
    const list = await remember(`near|${at.lat},${at.lng}`, async () =>
      parseKakaoPlaces(
        await kakao("/v2/local/search/category.json", { category_group_code: "FD6", x: at.lng, y: at.lat, radius: FOOD_RADIUS_M, sort: "distance", size: 15 }),
      ),
    );
    const buzz = await withBuzz(list);
    return sort === "buzz" ? rankByBuzz(buzz) : buzz;
  }, "주변 식당");
}

/** 🔥 지역 인기: 후기 많은 곳을 모아 최근 한 달 블로그 글 많은 순 TOP 10 */
export function regionHot(region: string): Promise<FoodResult<BuzzPlace[]>> {
  if (!naverFoodEnabled()) return Promise.resolve({ status: "off" });
  return settle(async () => {
    const lists = await remember(`region|${region}`, () =>
      Promise.all(REGION_QUERIES.map(async (q) => parseNaverPlaces(await naver("/search/v1/local", { query: `${region} ${q}`, display: 5, sort: "comment" })))),
    );
    const candidates = dedupePlaces(lists.flat());
    return rankByBuzz(await withBuzz(candidates)).slice(0, FOOD_REGION_TOP);
  }, "지역 인기 식당");
}

/** 🔎 식당 찾기: 카카오(음식점만 15곳), 카카오 열쇠가 없으면 네이버 지역 검색 5곳 */
export function searchPlaces(q: string): Promise<FoodResult<FoodPlace[]>> {
  if (kakaoEnabled()) {
    return settle(
      () =>
        remember(`search|k|${q}`, async () => parseKakaoPlaces(await kakao("/v2/local/search/keyword.json", { query: q, category_group_code: "FD6", size: 15 }))),
      "식당 검색",
    );
  }
  if (naverFoodEnabled()) {
    return settle(() => remember(`search|n|${q}`, async () => parseNaverPlaces(await naver("/search/v1/local", { query: q, display: 5 }))), "식당 검색");
  }
  return Promise.resolve({ status: "off" });
}

export type PlaceDetail = {
  place: FoodPlace;
  reviews: FoodResult<FoodReview[]>;
  recent: number;
  local: { id: number; title: string; slug: string; nickname: string; createdAt: Date }[];
};

const BLOG_BASE = () => process.env.FOOD_BLOG_BASE ?? "https://m.blog.naver.com";
const PAGE_TTL_MS = 24 * 3_600_000;
const pageCache = new Map<string, { at: number; value: Promise<{ image: string | null; sponsored: "yes" | "no" | null }> }>();

/** 후기 글 한 편의 대표 사진·협찬 표시 (네이버 블로그만, 하루 기억). 못 읽으면 둘 다 null */
function reviewPage(url: string) {
  const m = mobileBlogUrl(url);
  if (!m) return Promise.resolve({ image: null, sponsored: null });
  const hit = pageCache.get(m);
  if (hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.value;
  const value = fetch(m.replace("https://m.blog.naver.com", BLOG_BASE()), {
    headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Blogville", Accept: "text/html" },
    signal: AbortSignal.timeout(4_000),
    cache: "no-store",
  })
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`blog ${res.status}`))))
    .then((html) => analyzeReviewPage(html.slice(0, 600_000)))
    .catch(() => ({ image: null, sponsored: null }) as const);
  pageCache.set(m, { at: Date.now(), value });
  if (pageCache.size > 3_000) for (const [k, v] of pageCache) if (Date.now() - v.at >= PAGE_TTL_MS) pageCache.delete(k);
  return value;
}

/** 후기마다 대표 사진·협찬 표시를 붙인다 (동시에 5편씩) */
async function withCards(reviews: FoodReview[]): Promise<FoodReview[]> {
  const out: FoodReview[] = [];
  for (let i = 0; i < reviews.length; i += 5) {
    const chunk = reviews.slice(i, i + 5);
    const pages = await Promise.all(chunk.map((r) => reviewPage(r.url)));
    chunk.forEach((r, j) => out.push({ ...r, ...pages[j] }));
  }
  return out;
}

/** 식당 하나: 정보 + 네이버 블로그 후기 10편 + Blogville 이웃 글 */
export async function placeDetail(place: FoodPlace): Promise<PlaceDetail> {
  const reviews: FoodResult<FoodReview[]> = naverFoodEnabled()
    ? await settle(
        () => remember(`reviews|${reviewQuery(place)}`, async () => withCards(parseReviews(await naver("/search/v1/blog", { query: reviewQuery(place), display: 10, sort: "sim" })))),
        "블로그 후기",
      )
    : { status: "off" };
  const [recent, local] = await Promise.all([recentCount(place), blogvillePosts(place.name)]);
  return { place, reviews, recent, local };
}

/** Blogville 공개 글 중 식당 이름이 든 글 (최신 5편) */
function blogvillePosts(name: string) {
  const pattern = likePattern(name);
  return db
    .select({ id: posts.id, title: posts.title, slug: blogs.slug, nickname: profiles.nickname, createdAt: posts.createdAt })
    .from(posts)
    .innerJoin(blogs, eq(blogs.id, posts.blogId))
    .innerJoin(profiles, eq(profiles.userId, blogs.ownerId))
    .where(and(eq(posts.isPublic, true), or(ilike(posts.title, pattern), ilike(posts.contentText, pattern))))
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(5);
}
