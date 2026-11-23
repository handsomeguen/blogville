import { isStockIndex, STOCK_STREAM_LIFETIME_MS, STOCK_STREAM_MS } from "@/lib/stocks";
import { getIndex, getQuotes, listStocksBySlug } from "@/server/stocks";

// 블로그 📈 관심 종목 실시간 스트림 (Server-Sent Events). 누구나.
// 서버가 1초마다 시세를 확인해 바뀌었을 때만 보낸다. 15초 동안 바뀐 게 없으면 연결 유지용 빈 줄을 보낸다.
// 5분이 지나면 닫고, 브라우저(EventSource)가 2초 뒤 저절로 다시 붙는다. 종목은 그 블로그에 저장된 것만, 지수는 코스피·코스닥 중 ?index=.
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const slug = params.get("blog") ?? "";
  const indexParam = params.get("index");
  const indexCode = isStockIndex(indexParam) ? indexParam : "KOSPI";
  const items = /^[a-z0-9_]{1,40}$/.test(slug) ? await listStocksBySlug(slug) : [];
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };
      const stop = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", stop);
      send("retry: 2000\n\n");
      const started = Date.now();
      let last = "";
      let quiet = Date.now();
      while (!closed && Date.now() - started < STOCK_STREAM_LIFETIME_MS) {
        const [quotes, index] = await Promise.all([getQuotes(items), getIndex(indexCode)]);
        const body = JSON.stringify([quotes, index]);
        if (body !== last) {
          last = body;
          quiet = Date.now();
          send(`data: ${JSON.stringify({ quotes, index, at: new Date().toISOString() })}\n\n`);
        } else if (Date.now() - quiet >= HEARTBEAT_MS) {
          quiet = Date.now();
          send(": ping\n\n");
        }
        await new Promise((r) => setTimeout(r, STOCK_STREAM_MS));
      }
      stop();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform: 압축하느라 모아 두지 않게. X-Accel-Buffering: nginx가 모아 두지 않게
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
