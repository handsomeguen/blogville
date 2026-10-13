// 이웃 집 자리 고르기 (TOWN-18, specs/049-town-lots): 화면과 서버가 같이 쓴다.
import { CENTER, HOUSE_LOTS } from "./layout";
import { CLIFF_LINES } from "./terrain";

/** 이웃 집 자리 번호 (0번은 주인의 집) */
export const NEIGHBOR_LOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** 자리가 있는 곳: 남쪽 들판, 아니면 광장 서쪽·동쪽 길 (내 정원 자리 이동, TOWN-20) */
export function lotArea(lot: number): string {
  const p = HOUSE_LOTS[lot];
  if (p.y > CLIFF_LINES[1]) return "남쪽 들판";
  return p.x < CENTER.x ? "서쪽 길" : "동쪽 길";
}

export function isNeighborLot(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= NEIGHBOR_LOTS.length;
}

/**
 * 즐겨찾는 이웃(즐겨찾기한 순서)에게 자리를 준다: 고른 자리(`townLot`)가 먼저, 안 고른 이웃은 남은 자리를
 * 작은 번호부터 차례로. 자리는 10개까지라 넘치는 이웃은 빠진다.
 */
export function assignLots<T extends { townLot: number | null }>(favorites: readonly T[]): (T & { lot: number })[] {
  const taken = new Set<number>();
  const placed = new Map<T, number>();
  for (const f of favorites) {
    if (f.townLot !== null && isNeighborLot(f.townLot) && !taken.has(f.townLot)) {
      taken.add(f.townLot);
      placed.set(f, f.townLot);
    }
  }
  const free = NEIGHBOR_LOTS.filter((l) => !taken.has(l));
  for (const f of favorites) {
    if (placed.has(f)) continue;
    const lot = free.shift();
    if (lot === undefined) break;
    placed.set(f, lot);
  }
  return favorites.filter((f) => placed.has(f)).map((f) => ({ ...f, lot: placed.get(f)! }));
}

/**
 * `id` 이웃을 `lot`번 자리로 옮긴 뒤 모두의 자리 (TOWN-18): 그 자리에 살던 이웃은 옮긴 이웃의 옛 자리로, 나머지는 그대로.
 */
export function moveToLot(placed: readonly { id: string; lot: number }[], id: string, lot: number): { id: string; lot: number | null }[] {
  const old = placed.find((p) => p.id === id)?.lot ?? null;
  return placed.map((p) => ({ id: p.id, lot: p.id === id ? lot : p.lot === lot ? old : p.lot }));
}

export const LOT_ERRORS = {
  lot: "이웃 집 자리는 1~10번이에요.",
  notFavorite: "⭐ 즐겨찾기한 이웃만 집 자리를 고를 수 있어요.",
} as const;
