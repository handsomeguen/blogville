// 블로그 관심 종목 (📈 위젯) 규칙과 네이버 증권 응답 읽기. 브라우저와 서버가 같이 쓴다.

export type StockMarket = "KR" | "US";
export type StockItem = { market: StockMarket; code: string; name: string };

/** 위젯에 보여 줄 한 종목의 시세. 받지 못하면 price가 null */
export type StockQuote = StockItem & {
  price: number | null;
  change: number | null;
  rate: number | null;
  /** "KRW"·"USD" */
  currency: string;
  /** 장 상태 (OPEN·CLOSE 등), 모르면 null */
  status: string | null;
  /** 정규장 밖 거래 중이면 그 시간대 (국내 넥스트레이드 프리·애프터마켓, 미국 프리·애프터마켓). price는 그 시간대 가격 */
  session?: StockSession | null;
};

export type StockSession = "pre" | "after" | "afterClose" | "day" | "dayYahoo" | "dayToken";
export const STOCK_SESSION_LABELS: Record<StockSession, string> = { pre: "프리", after: "애프터", afterClose: "애프터 마감", day: "데이", dayYahoo: "데이", dayToken: "데이" };

/**
 * 미국 주식 데이마켓(주간거래, 블루오션) 시간인가: 미국 동부 일~목 20:00부터 다음 날 04:00까지 (한국 낮 시간).
 * 네이버 증권은 이 시간 가격을 주지 않아 한국투자증권 시세로 채운다
 */
export function isUsDayMarketTime(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
  const day = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
  if (hour >= 20) return ["Sun", "Mon", "Tue", "Wed", "Thu"].includes(day);
  if (hour < 4) return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(day);
  return false;
}

/**
 * 데이마켓이 열린 지 몇 분 지났나 (미국 동부 20:00 = 0분). 데이마켓 시간이 아니면 null.
 * 장이 막 열리면 몇 분 동안은 체결이 없어 야후에도 값이 없다
 */
export function usDayMarketMinutes(now: Date = new Date()): number | null {
  if (!isUsDayMarketTime(now)) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? NaN);
  return (hour >= 20 ? hour - 20 : hour + 4) * 60 + minute;
}

/** 네이버 로이터 코드(AAPL.O, BRK-B.N) → 한국투자증권 주간거래 시세 거래소·종목 (나스닥 BAQ, 뉴욕 BAY, 아멕스 BAA). 모르면 null */
export function kisDaySymbol(code: string): { excd: "BAQ" | "BAY" | "BAA"; symb: string } | null {
  const m = /^([A-Z0-9.-]+?)\.([ONAK])$/.exec(code.toUpperCase());
  if (!m) return null;
  const excd = m[2] === "O" ? "BAQ" : m[2] === "N" ? "BAY" : "BAA";
  return { excd, symb: m[1].replace(/-/g, "/") };
}

/** 네이버 로이터 코드(MU.O, BRK-B.N) → 야후 티커(MU, BRK-B). 모르면 null */
export function yahooTicker(code: string): string | null {
  const m = /^([A-Z]{1,6}(?:-[A-Z])?)\.[ONAK]$/.exec(code.toUpperCase());
  return m ? m[1] : null;
}

/** 야후 시세 화면(HTML)의 데이마켓(Overnight, 블루오션) 가격·등락(정규장 종가 대비). 데이마켓 시간이 아니거나 없으면 null */
export function parseYahooOvernight(html: string): { price: number; change: number | null; rate: number | null } | null {
  const pick = (id: string) => new RegExp(`data-testid="${id}"[^>]*>\\s*([^<]+?)\\s*<`).exec(html)?.[1] ?? null;
  const price = toNumber(pick("qsp-overnight-price"));
  if (price === null || price <= 0) return null;
  const change = toNumber((pick("qsp-overnight-price-change") ?? "").replace(/^\+/, ""));
  const rate = toNumber((pick("qsp-overnight-price-change-percent") ?? "").replace(/[()%+]/g, ""));
  return { price, change, rate };
}

/**
 * 야후 시세 API(v7/finance/quote) 응답의 데이마켓(Overnight, 블루오션) 가격. 종목별로 돌려준다.
 * 등락률은 등락과 가격으로 직접 계산한다 (응답의 % 칸은 formatted 여부에 따라 단위가 달라서).
 * 체결이 maxAgeMs보다 오래됐으면(지난 데이마켓 값) 넣지 않는다.
 */
export function parseYahooQuoteOvernight(json: unknown, now = Date.now(), maxAgeMs = 12 * 3_600_000): Map<string, { price: number; change: number | null; rate: number | null }> {
  const out = new Map<string, { price: number; change: number | null; rate: number | null }>();
  const result = (json as { quoteResponse?: { result?: unknown } } | null)?.quoteResponse?.result;
  if (!Array.isArray(result)) return out;
  const num = (v: unknown) => toNumber(v !== null && typeof v === "object" && "raw" in v ? (v as { raw: unknown }).raw : v);
  for (const r of result as Record<string, unknown>[]) {
    const symbol = typeof r?.symbol === "string" ? r.symbol.toUpperCase() : null;
    const price = num(r?.overnightMarketPrice);
    const time = num(r?.overnightMarketTime);
    if (!symbol || price === null || price <= 0 || time === null || now - time * 1000 > maxAgeMs) continue;
    const rawChange = num(r?.overnightMarketChange);
    const change = rawChange === null ? null : Math.round(rawChange * 100) / 100;
    const close = change === null ? null : price - change;
    const rate = change !== null && close ? Math.round((change / close) * 10000) / 100 : null;
    out.set(symbol, { price: Math.round(price * 100) / 100, change, rate });
  }
  return out;
}

/** 야후 실시간 스트림(streamer.finance.yahoo.com) 한 줄: 프로토콜 버퍼(PricingData)를 base64로 보낸다 */
export type YahooTick = { id: string; price: number; time: number; marketHours: number | null; changePercent: number | null; change: number | null };

/**
 * 야후 실시간 스트림의 PricingData(base64 프로토콜 버퍼)에서 필요한 칸만 읽는다.
 * 1 종목(문자), 2 가격(float), 3 시각(ms, zigzag), 7 시간대(4 = 데이마켓), 8 등락률(float), 12 등락(float). 못 읽으면 null
 */
export function parseYahooTick(base64: string): YahooTick | null {
  let b: Uint8Array;
  try {
    b = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 0;
  // 시각(ms)도 2^53 안이라 BigInt 없이 센다
  const varint = (): number => {
    let v = 0;
    let scale = 1;
    for (;;) {
      if (i >= b.length) throw new Error("eof");
      const c = b[i++];
      v += (c & 0x7f) * scale;
      scale *= 128;
      if (c < 0x80) return v;
    }
  };
  const out: Partial<YahooTick> & { marketHours?: number | null } = {};
  try {
    while (i < b.length) {
      const key = varint();
      const field = key >> 3;
      const type = key & 7;
      if (type === 0) {
        const v = varint();
        // zigzag: 짝수는 양수, 홀수는 음수
        if (field === 3) out.time = v % 2 === 0 ? v / 2 : -(v + 1) / 2;
        else if (field === 7) out.marketHours = v;
      } else if (type === 5) {
        if (i + 4 > b.length) break;
        const f = Math.round(view.getFloat32(i, true) * 10000) / 10000;
        i += 4;
        if (field === 2) out.price = f;
        else if (field === 8) out.changePercent = Math.round(f * 100) / 100;
        else if (field === 12) out.change = Math.round(f * 100) / 100;
      } else if (type === 1) {
        i += 8;
      } else if (type === 2) {
        const len = varint();
        if (field === 1) out.id = new TextDecoder().decode(b.subarray(i, i + len));
        i += len;
      } else break;
    }
  } catch {
    return null;
  }
  if (!out.id || !out.price || out.price <= 0) return null;
  return { id: out.id, price: Math.round(out.price * 100) / 100, time: out.time ?? 0, marketHours: out.marketHours ?? null, changePercent: out.changePercent ?? null, change: out.change ?? null };
}

/** 네이버 로이터 코드(MU.O) → 크라켄 xStocks 페어 이름(MUxUSD). 모르면 null */
export function krakenPair(code: string): string | null {
  const m = /^([A-Z]{1,6})\.[ONAK]$/.exec(code.toUpperCase());
  return m ? `${m[1]}xUSD` : null;
}

/**
 * 크라켄 공개 시세(Ticker) 한 페어 → 가격. 호가 가운데 값(매수·매도 차이가 1% 안일 때), 아니면 마지막 체결가.
 * 거래가 적은 토큰은 호가가 벌어져 있어 마지막 체결가가 더 믿을 만하다
 */
export function parseKrakenTicker(row: unknown): number | null {
  const r = rec(row);
  if (!r) return null;
  const first = (v: unknown) => (Array.isArray(v) ? toNumber(v[0]) : null);
  const ask = first(r.a);
  const bid = first(r.b);
  const last = first(r.c);
  if (ask && bid && ask > 0 && bid > 0 && (ask - bid) / bid < 0.01) return Math.round(((ask + bid) / 2) * 100) / 100;
  return last && last > 0 ? last : null;
}

/** 한국투자증권 해외주식 현재체결가(HHDFS00000300) 응답 → 가격·등락(전날 종가 대비). 값이 없으면 null */
export function parseKisPrice(json: unknown): { price: number; change: number | null; rate: number | null } | null {
  const r = rec(json);
  if (!r || str(r.rt_cd) !== "0") return null;
  const o = rec(r.output);
  const price = toNumber(o?.last);
  if (!o || price === null || price <= 0) return null;
  // 대비 기호: 1 상한, 2 상승, 3 보합, 4 하한, 5 하락
  const sign = str(o.sign);
  const signed = (n: number | null) => (n === null ? null : sign === "4" || sign === "5" ? -Math.abs(n) : sign === "3" ? 0 : sign === "1" || sign === "2" ? Math.abs(n) : n);
  return { price, change: signed(toNumber(o.diff)), rate: signed(toNumber(o.rate)) };
}

/** 증시 지수 (코스피·코스닥): 지금 값과 오늘 분 단위 흐름. 받지 못하면 price가 null */
export type StockIndex = {
  code: StockIndexCode;
  name: string;
  price: number | null;
  change: number | null;
  rate: number | null;
  status: string | null;
  /** 오늘 장중 값 (오래된 것부터, 많아야 80개). 장 시작 전이면 빈 목록 */
  chart: number[];
};

export const STOCK_INDEXES = [
  { code: "KOSPI", name: "코스피" },
  { code: "KOSDAQ", name: "코스닥" },
] as const;
export type StockIndexCode = (typeof STOCK_INDEXES)[number]["code"];

export function isStockIndex(value: unknown): value is StockIndexCode {
  return STOCK_INDEXES.some((i) => i.code === value);
}

/** 분 단위 지수 응답(api.stock.naver.com/chart/…/minute) → 값 목록 (많으면 고르게 솎아 max개) */
export function parseIndexChart(json: unknown, max = 80): number[] {
  if (!Array.isArray(json)) return [];
  const values = json.map((r) => toNumber((r as Record<string, unknown> | null)?.currentPrice)).filter((v): v is number => v !== null);
  if (values.length <= max) return values;
  const step = (values.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => values[Math.round(i * step)]);
}

export const STOCK_MAX = 10;
/** 스트림이 끊겼을 때 대신 묻는 간격 */
export const STOCK_REFRESH_MS = 5_000;
/** 서버가 실시간 스트림으로 새 시세를 확인하는 간격 */
export const STOCK_STREAM_MS = 1_000;
/** 스트림 한 번의 길이: 끝나면 브라우저가 바로 다시 붙는다 (오래된 연결이 쌓이지 않게) */
export const STOCK_STREAM_LIFETIME_MS = 5 * 60_000;
export const STOCK_ERRORS = {
  invalid: "이 종목은 넣을 수 없어요. 검색 결과에서 골라 주세요.",
  full: `관심 종목은 ${STOCK_MAX}개까지 넣을 수 있어요.`,
  duplicate: "이미 넣은 종목이에요.",
  added: "관심 종목에 넣었어요",
  removed: "관심 종목에서 뺐어요",
  reordered: "순서를 바꿨어요",
  stale: "종목 목록이 그새 바뀌었어요. 새로 고침한 뒤 다시 해 주세요.",
} as const;

const KR_CODE = /^[0-9A-Z]{6}$/;
const US_CODE = /^[A-Z0-9][A-Z0-9.\-]{0,15}$/;

/** 저장해도 되는 종목인지 (코드 모양·이름 길이). 이름은 앞뒤 공백을 지운 값 */
export function checkStock(market: string, code: string, name: string): StockItem | null {
  const n = name.trim();
  if (n.length < 1 || n.length > 60) return null;
  if (market === "KR" && KR_CODE.test(code)) return { market, code, name: n };
  if (market === "US" && US_CODE.test(code)) return { market, code, name: n };
  return null;
}

/** "71,000"·"-1.25"·71000 → 수. 읽을 수 없으면 null */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/,/g, "").trim();
  if (t === "" || t === "-" || t === "N/A") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * 네이버 증권 실시간 시세(polling.finance.naver.com/api/realtime/…)의 `datas` 한 줄.
 * 하락이면 compareToPreviousClosePrice·fluctuationsRatio가 이미 음수인 때와 양수인 때가 섞여 있어 compareToPreviousPrice.name으로 부호를 맞춘다.
 */
export function parseNaverQuote(row: unknown): { key: string; price: number | null; change: number | null; rate: number | null; currency: string | null; status: string | null; name: string | null; session: StockSession | null } | null {
  const r = rec(row);
  if (!r) return null;
  const key = str(r.reutersCode) ?? str(r.itemCode) ?? str(r.symbolCode);
  if (!key) return null;
  const direction = str(rec(r.compareToPreviousPrice)?.name) ?? str(rec(r.compareToPreviousPrice)?.code);
  const falling = direction === "FALLING" || direction === "LOWER_LIMIT" || direction === "5" || direction === "4";
  const sign = (n: number | null) => (n === null ? null : falling ? -Math.abs(n) : direction === "EVEN" || direction === "3" ? 0 : Math.abs(n));
  const currency = str(rec(r.currencyType)?.code) ?? str(r.currencyType);
  const price = toNumber(r.closePrice);
  const change = sign(toNumber(r.compareToPreviousClosePrice));
  const base = {
    key,
    price,
    change,
    rate: sign(toNumber(r.fluctuationsRatio)),
    currency,
    status: str(r.marketStatus),
    name: str(r.stockName),
    session: null as StockSession | null,
  };
  // 정규장 밖 거래 (국내 넥스트레이드 프리·애프터, 미국 프리·애프터마켓): 거래 중이면 그 가격과 네이버 증권이 보여 주는 등락을 그대로 쓴다.
  // 국내는 전날 종가 대비, 미국 프리마켓은 전날 종가 대비, 미국 애프터마켓은 그날 종가 대비 (네이버 증권 화면과 같다)
  const over = rec(r.overMarketPriceInfo);
  const overPrice = toNumber(over?.overPrice);
  const type = (str(over?.tradingSessionType) ?? "").toUpperCase();
  const session: StockSession | null = /AFTER/.test(type) ? "after" : /PRE|BEFORE/.test(type) ? "pre" : null;
  if (!over || overPrice === null || !session) return base;
  const overOpen = str(over.overMarketStatus)?.toUpperCase() === "OPEN";
  // 장이 다 닫힌 뒤(미국 애프터 20:00 마감 ~ 다음 프리 전)에는 정규장 종가보다 애프터 마지막 가격이 더 최근 가격이다
  const overAt = Date.parse(str(over.localTradedAt) ?? "");
  const regularAt = Date.parse(str(r.localTradedAt) ?? "");
  const afterClose = !overOpen && session === "after" && overAt > regularAt && overPrice !== price;
  if (!overOpen && !afterClose) return base;
  const overDirection = str(rec(over.compareToPreviousPrice)?.name) ?? str(rec(over.compareToPreviousPrice)?.code);
  const overFalling = overDirection === "FALLING" || overDirection === "LOWER_LIMIT" || overDirection === "5" || overDirection === "4";
  const overSign = (n: number | null) => (n === null ? null : overFalling ? -Math.abs(n) : overDirection === "EVEN" || overDirection === "3" ? 0 : overDirection ? Math.abs(n) : n);
  return { ...base, price: overPrice, change: overSign(toNumber(over.compareToPreviousClosePrice)), rate: overSign(toNumber(over.fluctuationsRatio)), session: afterClose ? "afterClose" : session };
}

/** 네이버 증권 검색 자동 완성(ac.stock.naver.com/ac) 한 줄 → 넣을 수 있는 종목. 국내·미국 주식만 */
export function parseNaverSearchItem(row: unknown): StockItem | null {
  const r = rec(row);
  if (!r) return null;
  const nation = str(r.nationCode);
  const name = str(r.name);
  if (!name) return null;
  if (nation === "KOR") {
    const code = str(r.code);
    return code ? checkStock("KR", code, name) : null;
  }
  if (nation === "USA") {
    const code = str(r.reutersCode);
    return code ? checkStock("US", code, name) : null;
  }
  return null;
}

/** 위젯의 가격 글자: 원화는 정수에 쉼표, 달러는 소수 둘째 자리 */
export function formatPrice(price: number, currency: string): string {
  return currency === "KRW"
    ? Math.round(price).toLocaleString("ko-KR")
    : price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 등락 글자: ▲ 1,200 (+1.71%) · ▼ … · 보합 */
export function formatChange(change: number | null, rate: number | null, currency: string): string {
  if (change === null || rate === null) return "";
  if (change === 0) return `0 (0.00%)`;
  const arrow = change > 0 ? "▲" : "▼";
  return `${arrow} ${formatPrice(Math.abs(change), currency)} (${rate > 0 ? "+" : ""}${rate.toFixed(2)}%)`;
}
