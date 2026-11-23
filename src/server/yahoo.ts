import "server-only";
import { parseYahooOvernight, yahooTicker } from "@/lib/stocks";
import { describeFetchError } from "./yahoo-quote";

// 📈 미국 주식 데이마켓(Overnight, 블루오션) 가격: 야후 파이낸스 공개 시세 화면에서 읽는다.
// 공식 API가 아니라 화면이 바뀌면 못 읽을 수 있다. 그때는 크라켄 토큰 가격으로 넘어간다 (src/server/stocks.ts).
// 시험은 YAHOO_QUOTE_BASE로 가짜 서버를 가리킨다.
const BASE = () => process.env.YAHOO_QUOTE_BASE ?? "https://finance.yahoo.com";
const TIMEOUT_MS = 5_000;
// 화면이 무거워(약 1MB) 종목마다 15초에 한 번만 받는다
const TTL_MS = 15_000;
// 데이마켓 가격은 화면 앞쪽(약 400KB)에 있어 그만큼만 읽는다
const MAX_BYTES = 800_000;

type Overnight = { price: number; change: number | null; rate: number | null };
const cache = new Map<string, { at: number; value: Promise<Overnight | null> }>();
// 운영 점검용 (/api/stocks/status): 마지막으로 시세 화면을 받은 결과
let lastResult: string | null = null;

async function readHead(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  let text = "";
  const decoder = new TextDecoder();
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.byteLength;
    text += decoder.decode(value, { stream: true });
    // 등락률까지 나왔으면 그만 읽는다
    if (text.includes('qsp-overnight-price-change-percent"') && /qsp-overnight-price-change-percent"[^>]*>[^<]*</.test(text)) break;
  }
  await reader.cancel().catch(() => {});
  return text;
}

// 마지막으로 받은 값 (화면 받는 데 1~2초 걸려서, 새로 받는 동안에는 이 값을 먼저 쓴다)
const last = new Map<string, { at: number; value: Overnight | null }>();

/** 미국 종목(네이버 로이터 코드)의 야후 데이마켓 가격. 데이마켓 시간이 아니거나 못 받으면 null */
export function getYahooOvernight(code: string): Promise<Overnight | null> {
  const ticker = yahooTicker(code);
  if (!ticker) return Promise.resolve(null);
  const hit = cache.get(ticker);
  if (!hit || Date.now() - hit.at >= TTL_MS) {
    const value = load(ticker).then((v) => {
      last.set(ticker, { at: Date.now(), value: v });
      return v;
    });
    cache.set(ticker, { at: Date.now(), value });
    if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at >= 10 * TTL_MS) cache.delete(k);
    if (last.size > 500) for (const [k, v] of last) if (Date.now() - v.at >= 10 * TTL_MS) last.delete(k);
  }
  // 1분 안에 받은 값이 있으면 기다리지 않는다 (첫 번째만 기다린다)
  const prev = last.get(ticker);
  if (prev && prev.value && Date.now() - prev.at < 60_000) return Promise.resolve(prev.value);
  return cache.get(ticker)!.value;
}

function load(ticker: string): Promise<Overnight | null> {
  return (async () => {
    const res = await fetch(`${BASE()}/quote/${encodeURIComponent(ticker)}/`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", Accept: "text/html" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      lastResult = `${new Date().toISOString()} ${ticker} HTTP ${res.status} ${res.url}`;
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const html = await readHead(res);
    const v = parseYahooOvernight(html);
    lastResult = `${new Date().toISOString()} ${ticker} ${v ? `가격 ${v.price}` : `데이마켓 값 없음 (${html.length}자, ${res.url})`}`;
    return v;
  })().catch((e: unknown) => {
    lastResult = `${new Date().toISOString()} ${ticker} 오류 ${describeFetchError(e)}`;
    console.warn("[yahoo] 데이마켓 가격을 못 받음", ticker, e instanceof Error ? e.message : e);
    return null;
  });
}

/** 운영 점검용: 마지막으로 야후 시세 화면을 받은 결과 */
export function yahooPageStatus(): string | null {
  return lastResult;
}
