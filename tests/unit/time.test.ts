import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatTime, fullDateTime } from "@/lib/time";

describe("formatDateTime · formatDate · formatTime (한국 시간, 분까지)", () => {
  it("24시간 표기", () => {
    expect(formatDateTime(new Date("2026-10-02T05:07:09Z"))).toBe("2026.10.02 14:07");
    expect(formatDateTime(new Date("2026-10-02T15:00:00Z"))).toBe("2026.10.03 00:00");
    expect(formatDate(new Date("2026-10-01T16:00:00Z"))).toBe("2026.10.02");
    expect(formatTime(new Date("2026-10-01T16:05:00Z"))).toBe("01:05");
  });
});

describe("fullDateTime (마우스를 올렸을 때)", () => {
  it("오전·오후, 12시", () => {
    expect(fullDateTime(new Date("2026-10-14T01:16:42Z"))).toBe("2026년 10월 14일 오전 10:16 (한국 시간)");
    expect(fullDateTime(new Date("2026-10-14T05:05:00Z"))).toBe("2026년 10월 14일 오후 2:05 (한국 시간)");
    expect(fullDateTime(new Date("2026-10-14T03:30:00Z"))).toBe("2026년 10월 14일 오후 12:30 (한국 시간)");
    expect(fullDateTime(new Date("2026-10-13T15:30:00Z"))).toBe("2026년 10월 14일 오전 12:30 (한국 시간)");
  });
  it("seconds면 초까지", () => {
    expect(fullDateTime(new Date("2026-10-14T01:16:42Z"), { seconds: true })).toBe("2026년 10월 14일 오전 10:16:42 (한국 시간)");
  });
});
