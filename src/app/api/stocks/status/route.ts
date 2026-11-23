import { getQuotes, searchStocks } from "@/server/stocks";
import { yahooPageStatus } from "@/server/yahoo";
import { yahooQuoteStatus } from "@/server/yahoo-quote";
import { yahooStreamStatus } from "@/server/yahoo-stream";

// 시세 연결 확인 (운영 점검용): 정해 둔 두 종목의 시세와 검색 한 번이 네이버 증권에서 오는지. 입력을 받지 않고 캐시를 같이 쓴다.
// 미국 데이마켓 가격이 어디서 왔는지(session)와 야후 스트림·시세 화면 상태도 함께 보여 준다 (비밀 값은 없다)
export async function GET() {
  const [quotes, search] = await Promise.all([
    getQuotes([
      { market: "KR", code: "005930", name: "삼성전자" },
      { market: "US", code: "AAPL.O", name: "애플" },
    ]),
    searchStocks("삼성전자"),
  ]);
  const ok = quotes.every((q) => q.price !== null) && search.length > 0;
  return Response.json(
    { ok, quotes: quotes.map((q) => ({ code: q.code, price: q.price, change: q.change, rate: q.rate, currency: q.currency, status: q.status, session: q.session ?? null })), search: search.slice(0, 3), yahoo: { api: yahooQuoteStatus(), stream: yahooStreamStatus(), page: yahooPageStatus() } },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
