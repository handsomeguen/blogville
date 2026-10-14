// 블로그 곳곳의 시각 표시 (모두 한국 시간, 분까지).
//   formatDateTime  `2026.10.14 14:05`                       어디서나
//   fullDateTime    `2026년 10월 14일 오후 2:05 (한국 시간)`  마우스를 올렸을 때(title)
// 화면에는 components/common/Time.tsx 를 쓴다 (<time datetime>에 원래 시각). "N분 전" 같은 상대 시각은 쓰지 않는다 (v1.7.1).

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function kstParts(date: Date) {
  const p = Object.fromEntries(partsFormat.formatToParts(date).map((x) => [x.type, x.value]));
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

/** `14:05` (한국 시간, 24시간) */
export function formatTime(date: Date): string {
  const p = kstParts(date);
  return `${p.hour}:${p.minute}`;
}

/** `2026.10.14` (한국 시간) */
export function formatDate(date: Date): string {
  const p = kstParts(date);
  return `${p.year}.${p.month}.${p.day}`;
}

/** `2026.10.14 14:05` (한국 시간, 24시간) */
export function formatDateTime(date: Date): string {
  return `${formatDate(date)} ${formatTime(date)}`;
}

/** `2026년 10월 14일 오후 2:05 (한국 시간)` — seconds면 `오후 2:05:09` */
export function fullDateTime(date: Date, { seconds = false } = {}): string {
  const p = kstParts(date);
  const h = Number(p.hour);
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${p.year}년 ${Number(p.month)}월 ${Number(p.day)}일 ${ampm} ${h12}:${p.minute}${seconds ? `:${p.second}` : ""} (한국 시간)`;
}
