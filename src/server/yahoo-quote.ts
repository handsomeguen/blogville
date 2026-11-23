import "server-only";
import { parseYahooQuoteOvernight, yahooTicker } from "@/lib/stocks";

// 📈 미국 주식 데이마켓(Overnight, 블루오션) 가격: 야후 시세 화면이 쓰는 시세 API(v7/finance/quote)에서 받는다.
// 2026-11 야후 실시간 스트림이 데이마켓 체결을 더 이상 보내지 않아(맥에서 확인) 이 길을 쓴다.
// 이 API는 야후 쿠키와 crumb이 있어야 답한다 (없으면 401). 쿠키는 fc.yahoo.com이 주고, crumb은 쿠키로 받는다.
// 공식 API가 아니라 막히면 null → 크라켄 토큰 가격으로 넘어간다 (src/server/stocks.ts).
// 시험은 YAHOO_API_BASE·YAHOO_COOKIE_URL로 가짜 서버를 가리킨다.
const API_BASE = () => process.env.YAHOO_API_BASE ?? "https://query2.finance.yahoo.com";
const COOKIE_URL = () => process.env.YAHOO_COOKIE_URL ?? "https://fc.yahoo.com/";
const TIMEOUT_MS = 4_000;
// 여러 화면이 5초마다 불러도 야후에는 3초에 한 번만 묻는다
const TTL_MS = 3_000;
// 쿠키·crumb은 6시간 쓰고, 401이 오면 바로 새로 받는다
const AUTH_TTL_MS = 6 * 3_600_000;
// 실패하면 10분 동안은 묻지 않는다 (막혔을 때 위젯이 기다리지 않고, 야후 429를 더 부르지 않게)
const FAIL_TTL_MS = 10 * 60_000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const FIELDS = "overnightMarketPrice,overnightMarketChange,overnightMarketChangePercent,overnightMarketTime,regularMarketPrice";

type Overnight = { price: number; change: number | null; rate: number | null };
type Auth = { cookie: string; crumb: string; at: number };

const g = globalThis as unknown as { __bvYahooQuote?: { auth: Promise<Auth> | null; cache: Map<string, { at: number; ttl: number; value: Promise<Map<string, Overnight>> }>; last: string | null } };
const state = (g.__bvYahooQuote ??= { auth: null, cache: new Map(), last: null });

/** fetch 실패 이유: undici는 "fetch failed"만 주고 진짜 이유는 cause에 둔다 */
export function describeFetchError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as Error & { cause?: unknown }).cause as { code?: string; message?: string } | undefined;
  const detail = cause ? [cause.code, cause.message].filter(Boolean).join(" ") : "";
  return detail ? `${e.message} (${detail})` : e.message;
}

async function login(): Promise<Auth> {
  // fc.yahoo.com은 404와 함께 A3 쿠키를 준다
  const res = await fetch(COOKIE_URL(), { headers: { "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  await res.body?.cancel().catch(() => {});
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
  if (!cookie) throw new Error(`쿠키 없음 (HTTP ${res.status})`);
  const c = await fetch(`${API_BASE()}/v1/test/getcrumb`, { headers: { "User-Agent": UA, Cookie: cookie }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  const crumb = (await c.text()).trim();
  if (!c.ok || !crumb || crumb.length > 64 || /[<{\s]/.test(crumb)) throw new Error(`crumb 못 받음 (HTTP ${c.status})`);
  return { cookie, crumb, at: Date.now() };
}

function auth(fresh = false): Promise<Auth> {
  if (fresh || !state.auth) {
    state.auth = login();
    // 실패한 로그인은 다음 번에 다시 시도한다
    state.auth.catch(() => {
      state.auth = null;
    });
  }
  return state.auth.then((a) => {
    if (Date.now() - a.at < AUTH_TTL_MS) return a;
    state.auth = null;
    return auth(true);
  });
}

async function load(tickers: string[]): Promise<Map<string, Overnight>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const a = await auth(attempt > 0);
    const url = `${API_BASE()}/v7/finance/quote?symbols=${encodeURIComponent(tickers.join(","))}&fields=${FIELDS}&crumb=${encodeURIComponent(a.crumb)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Cookie: a.cookie, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => {});
      state.last = `${new Date().toISOString()} HTTP ${res.status} (crumb 다시 받음)`;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    const found = parseYahooQuoteOvernight(await res.json());
    state.last = `${new Date().toISOString()} ${tickers.join(",")} → ${found.size ? [...found].map(([t, v]) => `${t} ${v.price}`).join(", ") : "데이마켓 값 없음"}`;
    return found;
  }
  throw new Error("401이 계속 옴");
}

/** 미국 종목들(네이버 로이터 코드)의 야후 데이마켓 가격. 못 받은 종목은 빠진다 (코드 → 가격) */
export async function getQuoteOvernight(codes: string[]): Promise<Map<string, Overnight>> {
  const byTicker = new Map<string, string>();
  for (const code of codes) {
    const t = yahooTicker(code);
    if (t) byTicker.set(t, code);
  }
  if (byTicker.size === 0) return new Map();
  const tickers = [...byTicker.keys()].sort();
  const key = tickers.join(",");
  let hit = state.cache.get(key);
  if (!hit || Date.now() - hit.at >= hit.ttl) {
    const entry: { at: number; ttl: number; value: Promise<Map<string, Overnight>> } = { at: Date.now(), ttl: TTL_MS, value: Promise.resolve(new Map()) };
    entry.value = load(tickers).catch((e: unknown) => {
      entry.ttl = FAIL_TTL_MS;
      state.last = `${new Date().toISOString()} 오류 ${describeFetchError(e)}`;
      console.warn("[yahoo-quote] 데이마켓 가격을 못 받음", describeFetchError(e));
      return new Map<string, Overnight>();
    });
    hit = entry;
    state.cache.set(key, hit);
    if (state.cache.size > 200) for (const [k, v] of state.cache) if (Date.now() - v.at >= 2 * FAIL_TTL_MS) state.cache.delete(k);
  }
  const found = await hit.value;
  const out = new Map<string, Overnight>();
  for (const [t, code] of byTicker) {
    const v = found.get(t);
    if (v) out.set(code, v);
  }
  return out;
}

/** 운영 점검용: 마지막으로 시세 API를 부른 결과 */
export function yahooQuoteStatus(): string | null {
  return state.last;
}
