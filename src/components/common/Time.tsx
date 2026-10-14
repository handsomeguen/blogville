import { formatDateTime, fullDateTime } from "@/lib/time";

type Props = {
  date: Date | string;
  /** 마우스를 올렸을 때 초까지 (오류 기록처럼 같은 분에 여러 번 생기는 곳) */
  seconds?: boolean;
  className?: string;
};

/** 블로그 공통 시각 표시: 한국 시간 `2026.10.14 14:05` (분까지). 마우스를 올리면 전체 시각 */
export function Time({ date, seconds = false, className }: Props) {
  const at = typeof date === "string" ? new Date(date) : date;
  return (
    <time dateTime={at.toISOString()} title={fullDateTime(at, { seconds })} className={className}>
      {formatDateTime(at)}
    </time>
  );
}
