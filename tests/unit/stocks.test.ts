import { describe, expect, it } from "vitest";
import { parseYahooTick, yahooTicker, parseYahooOvernight, parseYahooQuoteOvernight, krakenPair, parseKrakenTicker, isUsDayMarketTime, kisDaySymbol, parseKisPrice, checkStock, formatChange, formatPrice, parseIndexChart, parseNaverQuote, parseNaverSearchItem, toNumber } from "@/lib/stocks";

describe("관심 종목 규칙", () => {
  it("국내 6자리·미국 로이터 코드만 받는다", () => {
    expect(checkStock("KR", "005930", " 삼성전자 ")).toEqual({ market: "KR", code: "005930", name: "삼성전자" });
    expect(checkStock("KR", "0001A0", "새 종목")).not.toBeNull();
    expect(checkStock("US", "AAPL.O", "애플")).not.toBeNull();
    expect(checkStock("US", "BRK-B.N", "버크셔")).not.toBeNull();
    expect(checkStock("KR", "5930", "짧음")).toBeNull();
    expect(checkStock("KR", "<script>", "나쁨")).toBeNull();
    expect(checkStock("JP", "7203", "도요타")).toBeNull();
    expect(checkStock("US", "AAPL.O", " ")).toBeNull();
    expect(checkStock("US", "AAPL.O", "가".repeat(61))).toBeNull();
  });

  it("쉼표 든 글자도 수로 읽는다", () => {
    expect(toNumber("71,000")).toBe(71000);
    expect(toNumber("-1.25")).toBe(-1.25);
    expect(toNumber(3)).toBe(3);
    expect(toNumber("N/A")).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });

  it("네이버 실시간 시세: 하락이면 등락이 양수로 와도 음수로 맞춘다", () => {
    const kr = parseNaverQuote({
      itemCode: "005930",
      stockName: "삼성전자",
      closePrice: "71,000",
      compareToPreviousClosePrice: "500",
      compareToPreviousPrice: { code: "5", text: "하락", name: "FALLING" },
      fluctuationsRatio: "0.70",
      marketStatus: "OPEN",
    });
    expect(kr).toMatchObject({ key: "005930", price: 71000, change: -500, rate: -0.7, status: "OPEN", name: "삼성전자" });
    const us = parseNaverQuote({
      reutersCode: "AAPL.O",
      closePrice: "227.50",
      compareToPreviousClosePrice: "1.25",
      compareToPreviousPrice: { code: "2", name: "RISING" },
      fluctuationsRatio: "0.55",
      currencyType: { code: "USD" },
    });
    expect(us).toMatchObject({ key: "AAPL.O", price: 227.5, change: 1.25, rate: 0.55, currency: "USD" });
    expect(parseNaverQuote({ closePrice: "1" })).toBeNull();
    expect(parseNaverQuote(null)).toBeNull();
  });

  it("네이버 검색: 국내는 code, 미국은 reutersCode, 나머지 나라는 뺀다", () => {
    expect(parseNaverSearchItem({ code: "005930", name: "삼성전자", nationCode: "KOR", reutersCode: "005930" })).toEqual({ market: "KR", code: "005930", name: "삼성전자" });
    expect(parseNaverSearchItem({ code: "AAPL", name: "애플", nationCode: "USA", reutersCode: "AAPL.O" })).toEqual({ market: "US", code: "AAPL.O", name: "애플" });
    expect(parseNaverSearchItem({ code: "7203", name: "도요타", nationCode: "JPN", reutersCode: "7203.T" })).toBeNull();
  });

  it("가격·등락 글자", () => {
    expect(formatPrice(71000, "KRW")).toBe("71,000");
    expect(formatPrice(227.5, "USD")).toBe("227.50");
    expect(formatChange(500, 0.71, "KRW")).toBe("▲ 500 (+0.71%)");
    expect(formatChange(-1.25, -0.55, "USD")).toBe("▼ 1.25 (-0.55%)");
    expect(formatChange(0, 0, "KRW")).toBe("0 (0.00%)");
    expect(formatChange(null, null, "KRW")).toBe("");
  });
});

describe("parseIndexChart (지수 하루 흐름)", () => {
  it("currentPrice만 모으고, 많으면 처음·끝을 지키며 고르게 솎는다", () => {
    expect(parseIndexChart([{ currentPrice: 1 }, { currentPrice: "2" }, { x: 1 }, null])).toEqual([1, 2]);
    const many = Array.from({ length: 391 }, (_, i) => ({ currentPrice: i }));
    const out = parseIndexChart(many, 80);
    expect(out).toHaveLength(80);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBe(390);
    expect(parseIndexChart({ error: 1 })).toEqual([]);
  });
});

describe("정규장 밖 거래 (애프터마켓)", () => {
  it("15:30 뒤 넥스트레이드 애프터마켓이 거래 중이면 그 가격과 전날 종가 대비 등락을 쓴다", () => {
    const row = {
      itemCode: "005930",
      closePrice: "215,500",
      compareToPreviousClosePrice: "5,500",
      compareToPreviousPrice: { code: "2", name: "RISING" },
      fluctuationsRatio: "2.62",
      marketStatus: "OPEN",
      overMarketPriceInfo: { tradingSessionType: "AFTER_MARKET", overMarketStatus: "OPEN", overPrice: "216,000", compareToPreviousPrice: { code: "2", name: "RISING" }, compareToPreviousClosePrice: "6,000", fluctuationsRatio: "2.86" },
    };
    expect(parseNaverQuote(row)).toMatchObject({ price: 216000, change: 6000, rate: 2.86, session: "after" });
    // 애프터마켓이 끝났으면 정규장 종가
    expect(parseNaverQuote({ ...row, overMarketPriceInfo: { ...row.overMarketPriceInfo, overMarketStatus: "CLOSE" } })).toMatchObject({ price: 215500, change: 5500, session: null });
  });

  it("미국 프리·애프터마켓은 네이버 증권과 같은 등락(그 시간대 기준)을 그대로 쓴다", () => {
    const row = {
      reutersCode: "AAPL.O",
      closePrice: "342.00",
      compareToPreviousClosePrice: "2.00",
      compareToPreviousPrice: { code: "2", name: "RISING" },
      fluctuationsRatio: "0.59",
      marketStatus: "CLOSE",
      overMarketPriceInfo: { tradingSessionType: "PRE_MARKET", overMarketStatus: "OPEN", overPrice: "340.67", compareToPreviousPrice: { code: "5", name: "FALLING" }, compareToPreviousClosePrice: "-1.33", fluctuationsRatio: "-0.39" },
    };
    expect(parseNaverQuote(row)).toMatchObject({ price: 340.67, change: -1.33, rate: -0.39, session: "pre" });
    // 방향 표시가 없어도 부호를 그대로 믿는다
    const noDir = { ...row, overMarketPriceInfo: { ...row.overMarketPriceInfo, compareToPreviousPrice: undefined, tradingSessionType: "AFTER_MARKET" } };
    expect(parseNaverQuote(noDir)).toMatchObject({ price: 340.67, change: -1.33, rate: -0.39, session: "after" });
    // 상승은 부호 없이 와도 양수
    const up = { ...row, overMarketPriceInfo: { ...row.overMarketPriceInfo, compareToPreviousPrice: { code: "2", name: "RISING" }, compareToPreviousClosePrice: "1.20", fluctuationsRatio: "0.35" } };
    expect(parseNaverQuote(up)).toMatchObject({ change: 1.2, rate: 0.35 });
  });

  it("미국 애프터마켓이 끝난 뒤에는 정규장 종가 대신 애프터 마지막 가격을 [애프터 마감]으로", () => {
    const row = {
      reutersCode: "MU.O",
      closePrice: "656.39",
      compareToPreviousClosePrice: "10.00",
      compareToPreviousPrice: { code: "2", name: "RISING" },
      fluctuationsRatio: "1.55",
      marketStatus: "CLOSE",
      localTradedAt: "2026-11-05T16:00:00-05:00",
      overMarketPriceInfo: { tradingSessionType: "AFTER_MARKET", overMarketStatus: "CLOSE", overPrice: "683.40", compareToPreviousPrice: { code: "2", name: "RISING" }, compareToPreviousClosePrice: "27.01", fluctuationsRatio: "4.11", localTradedAt: "2026-11-05T20:00:00-05:00" },
    };
    expect(parseNaverQuote(row)).toMatchObject({ price: 683.4, change: 27.01, rate: 4.11, session: "afterClose" });
    // 애프터 기록이 정규장보다 옛것이면(다음 날 정규장 중) 정규장 값
    expect(parseNaverQuote({ ...row, marketStatus: "OPEN", localTradedAt: "2026-11-06T10:00:00-05:00" })).toMatchObject({ price: 656.39, session: null });
  });
});

describe("미국 데이마켓 (한국투자증권 주간거래 시세)", () => {
  it("데이마켓 시간: 미국 동부 일~목 20:00 ~ 다음 날 04:00", () => {
    // 2026-11-11(수) 01:00 UTC = 미국 동부 10일(화) 20:00 (EST)
    expect(isUsDayMarketTime(new Date("2026-11-11T01:00:00Z"))).toBe(true);
    // 수 08:59 UTC = 03:59 ET
    expect(isUsDayMarketTime(new Date("2026-11-11T08:59:00Z"))).toBe(true);
    // 수 09:00 UTC = 04:00 ET → 프리마켓
    expect(isUsDayMarketTime(new Date("2026-11-11T09:00:00Z"))).toBe(false);
    // 정규장 중
    expect(isUsDayMarketTime(new Date("2026-11-11T16:00:00Z"))).toBe(false);
    // 금 20:00 ET(토 01:00 UTC)는 쉰다, 일 20:00 ET(월 01:00 UTC)부터 다시
    expect(isUsDayMarketTime(new Date("2026-11-14T01:00:00Z"))).toBe(false);
    expect(isUsDayMarketTime(new Date("2026-11-16T01:00:00Z"))).toBe(true);
  });

  it("로이터 코드 → 주간거래 거래소·종목", () => {
    expect(kisDaySymbol("AAPL.O")).toEqual({ excd: "BAQ", symb: "AAPL" });
    expect(kisDaySymbol("BRK-B.N")).toEqual({ excd: "BAY", symb: "BRK/B" });
    expect(kisDaySymbol("SPY.K")).toEqual({ excd: "BAA", symb: "SPY" });
    expect(kisDaySymbol("005930")).toBeNull();
  });

  it("현재체결가 응답: 하락 기호면 음수, 값이 없으면 null", () => {
    expect(parseKisPrice({ rt_cd: "0", output: { last: "683.4000", diff: "27.0100", rate: "4.11", sign: "2" } })).toEqual({ price: 683.4, change: 27.01, rate: 4.11 });
    expect(parseKisPrice({ rt_cd: "0", output: { last: "340.67", diff: "1.33", rate: "0.39", sign: "5" } })).toEqual({ price: 340.67, change: -1.33, rate: -0.39 });
    expect(parseKisPrice({ rt_cd: "0", output: { last: "", diff: "", rate: "" } })).toBeNull();
    expect(parseKisPrice({ rt_cd: "1", msg1: "토큰 만료" })).toBeNull();
  });
});

describe("크라켄 주식 토큰 (데이마켓 참고 가격)", () => {
  it("로이터 코드 → xStocks 페어", () => {
    expect(krakenPair("MU.O")).toBe("MUxUSD");
    expect(krakenPair("AAPL.O")).toBe("AAPLxUSD");
    expect(krakenPair("BRK-B.N")).toBeNull();
    expect(krakenPair("005930")).toBeNull();
  });
  it("호가 차이가 1% 안이면 가운데 값, 넓으면 마지막 체결가", () => {
    expect(parseKrakenTicker({ a: ["348.08", "2", "2.000"], b: ["348.07", "20", "20.000"], c: ["348.20", "0.06"] })).toBe(348.08);
    expect(parseKrakenTicker({ a: ["760.00", "1", "1"], b: ["737.62", "1", "1"], c: ["735.93", "0.04"] })).toBe(735.93);
    expect(parseKrakenTicker({ c: ["0", "0"] })).toBeNull();
    expect(parseKrakenTicker(null)).toBeNull();
  });
});

describe("야후 데이마켓(Overnight) 가격", () => {
  it("로이터 코드 → 야후 티커", () => {
    expect(yahooTicker("MU.O")).toBe("MU");
    expect(yahooTicker("BRK-B.N")).toBe("BRK-B");
    expect(yahooTicker("005930")).toBeNull();
  });
  it("시세 화면의 데이마켓 가격·등락", () => {
    const html =
      '<span class="price" data-testid="qsp-price">725.11 </span><span data-testid="qsp-price-change">-8.04 </span>' +
      '<span class="price yf-1n64cj base" data-testid="qsp-overnight-price">748.49 </span> <span class="priceChange" data-testid="qsp-overnight-price-change">+23.38 </span> ' +
      '<span class="priceChangePercent" data-testid="qsp-overnight-price-change-percent">(+3.22%) </span>';
    expect(parseYahooOvernight(html)).toEqual({ price: 748.49, change: 23.38, rate: 3.22 });
    const down = html.replace("+23.38", "-1.50").replace("(+3.22%)", "(-0.21%)");
    expect(parseYahooOvernight(down)).toEqual({ price: 748.49, change: -1.5, rate: -0.21 });
    expect(parseYahooOvernight('<span data-testid="qsp-price">725.11 </span>')).toBeNull();
  });
});

describe("야후 시세 API 데이마켓 가격", () => {
  const now = 1795409669_000 + 60_000;
  it("overnightMarket 칸을 읽고 등락률은 직접 계산한다 (raw 감싸기도)", () => {
    const json = {
      quoteResponse: {
        result: [
          { symbol: "AAPL", overnightMarketPrice: 348.07, overnightMarketChange: 5.51, overnightMarketChangePercent: 1.608, overnightMarketTime: 1795409669 },
          { symbol: "MU", overnightMarketPrice: { raw: 621.2, fmt: "621.20" }, overnightMarketChange: { raw: -3.3 }, overnightMarketTime: { raw: 1795409600 } },
        ],
      },
    };
    const got = parseYahooQuoteOvernight(json, now);
    expect(got.get("AAPL")).toEqual({ price: 348.07, change: 5.51, rate: 1.61 });
    expect(got.get("MU")).toEqual({ price: 621.2, change: -3.3, rate: -0.53 });
  });

  it("데이마켓 값이 없거나 12시간 넘게 지난 체결이면 뺀다", () => {
    const json = {
      quoteResponse: {
        result: [
          { symbol: "AAPL", regularMarketPrice: 342.56 },
          { symbol: "MU", overnightMarketPrice: 600, overnightMarketChange: 1, overnightMarketTime: 1795409669 - 13 * 3600 },
        ],
      },
    };
    expect(parseYahooQuoteOvernight(json, now).size).toBe(0);
    expect(parseYahooQuoteOvernight(null, now).size).toBe(0);
    expect(parseYahooQuoteOvernight({ finance: { error: { code: "Unauthorized" } } }, now).size).toBe(0);
  });
});

describe("야후 실시간 스트림 (PricingData)", () => {
  it("데이마켓 체결: 종목·가격·시각·시간대·등락", () => {
    expect(parseYahooTick("CgJNVRX2aDpEGNDgjIW5aCoDTk1TMAg4BEX/MzVAZYA9pEHYAQT1AgDXR0H9AsYP2j8=")).toEqual({
      id: "MU",
      price: 745.64,
      time: 1794362153000,
      marketHours: 4,
      changePercent: 2.83,
      change: 20.53,
    });
    expect(parseYahooTick("CgRBQVBMFXsUrkMYwI+NhbloKgNOTVMwCDgERd6tzb1lADSzvtgBBPUCgOshwP0C7684vw==")).toMatchObject({ id: "AAPL", price: 348.16, changePercent: -0.1, change: -0.35 });
    expect(parseYahooTick("!!")).toBeNull();
    expect(parseYahooTick("")).toBeNull();
  });
});
