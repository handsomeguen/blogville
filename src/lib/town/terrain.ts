// 마을 높낮이 (TOWN-05, specs/042-terrain): 3/4 탑다운. 높은 단의 남쪽 가장자리 아래로 돌벽 앞면이 보이고,
// 앞면은 걸을 수 없으며 길이 지나는 곳만 계단이다. 게임 화면·바닥 굽기·단위 시험이 같이 쓴다.
import { EAST_ROAD, GARDEN, GARDEN_FRONT_Y, gardenEdge, inGarden, ROAD, WEST_ROAD, WORLD, type Point, type Rect } from "./layout";

/** 돌벽 앞면 높이 (도트 12칸 × 4px) */
export const CLIFF_FACE = 48;
/** 높은 단의 남쪽 가장자리 y: 북쪽 언덕(높이 2) → 가운데(1), 가운데 → 남쪽 들판(0) */
export const CLIFF_LINES = [260, 1330] as const;
/** 맨 위 먼 하늘·산 (걸을 수 없다) */
export const SKY_HEIGHT = 90;
/** 계단은 길 가운데선에서 반폭 + 이만큼, 맨 바깥 `RAIL`은 돌 난간 */
export const STAIR_PAD = 15;
export const RAIL = 6;
/** 계단에서는 조금 느리게 */
export const STAIR_SLOW = 0.75;

export type Stair = { id: string; x: number; top: number; rect: Rect };

/** 정원 계단 (TOWN-20): 정원 앞 돌 축대 가운데, 꼭대기에 장미 아치 문. 정원으로 들어가는 길은 이것 하나 */
export const GARDEN_STAIR: Stair = {
  id: "garden",
  x: GARDEN.cx,
  top: GARDEN_FRONT_Y,
  rect: { x: GARDEN.cx - ROAD / 2 - STAIR_PAD, y: GARDEN_FRONT_Y, width: ROAD + STAIR_PAD * 2, height: CLIFF_FACE },
};

/** 계단: 서쪽·동쪽 길이 두 절벽을 지나는 4곳 + 정원 계단 */
export const STAIRS: readonly Stair[] = [
  ...CLIFF_LINES.flatMap((line, i) =>
    [
      ["west", WEST_ROAD],
      ["east", EAST_ROAD],
    ].map(([side, x]) => ({
      id: `${i === 0 ? "north" : "south"}-${side}`,
      x: Number(x),
      top: line,
      rect: { x: Number(x) - ROAD / 2 - STAIR_PAD, y: line, width: ROAD + STAIR_PAD * 2, height: CLIFF_FACE },
    })),
  ),
  GARDEN_STAIR,
];

/** 땅 높이: 북쪽 언덕 2, 가운데 1, 남쪽 들판 0 (앞면은 아래 단으로 친다). `x`를 주면 내 정원 안도 2 (TOWN-20) */
export function heightAt(y: number, x?: number): number {
  if (x !== undefined && inGarden({ x, y })) return 2;
  return y < CLIFF_LINES[0] ? 2 : y < CLIFF_LINES[1] ? 1 : 0;
}

/** 정원 벽을 이만큼 폭의 세로 조각으로 나눈다 */
const GARDEN_COLUMN = 8;
/** 뒤·옆 낮은 돌 테의 반 두께 */
export const GARDEN_RIM = 6;

/**
 * 정원 둘레 (TOWN-20): 뒤·옆은 낮은 돌 테, 앞(남쪽)은 `CLIFF_FACE` 높이 돌 축대. 타원을 세로 조각으로 나눠
 * 조각마다 위 가장자리 띠(돌 테)와 아래 가장자리에서 내려가는 앞면을 만든다. 정원 계단 자리만 비우고 양쪽 난간은 남긴다.
 */
function gardenWalls(): Rect[] {
  const walls: Rect[] = [];
  const gap = [GARDEN_STAIR.rect.x + RAIL, GARDEN_STAIR.rect.x + GARDEN_STAIR.rect.width - RAIL];
  for (let x = GARDEN.cx - GARDEN.rx; x < GARDEN.cx + GARDEN.rx; x += GARDEN_COLUMN) {
    const x2 = Math.min(x + GARDEN_COLUMN, GARDEN.cx + GARDEN.rx);
    const [a, b] = [gardenEdge(x)!, gardenEdge(x2)!];
    const rimTop = Math.min(a.top, b.top) - GARDEN_RIM;
    walls.push({ x, y: rimTop, width: x2 - x, height: Math.max(a.top, b.top) + GARDEN_RIM - rimTop });
    const faceTop = Math.min(a.bottom, b.bottom);
    const face = { y: faceTop, height: Math.max(a.bottom, b.bottom) + CLIFF_FACE - faceTop };
    if (x < gap[0]) walls.push({ x, width: Math.min(x2, gap[0]) - x, ...face });
    if (x2 > gap[1]) walls.push({ x: Math.max(x, gap[1]), width: x2 - Math.max(x, gap[1]), ...face });
  }
  return walls;
}

/** 정원 둘레 벽 (돌 테·돌 축대 조각) */
export const GARDEN_WALLS: readonly Rect[] = gardenWalls();

/** 걸을 수 없는 땅: 하늘, 절벽 앞면(계단 자리를 뺀 조각), 계단 양쪽 난간, 정원 둘레 (TOWN-20) */
export const TERRAIN_WALLS: readonly Rect[] = [
  { x: 0, y: 0, width: WORLD.width, height: SKY_HEIGHT },
  ...CLIFF_LINES.flatMap((line) => {
    const stairs = STAIRS.filter((s) => s.top === line)
      .map((s) => s.rect)
      .sort((a, b) => a.x - b.x);
    const walls: Rect[] = [];
    let x = 0;
    for (const r of stairs) {
      walls.push({ x, y: line, width: r.x + RAIL - x, height: CLIFF_FACE });
      x = r.x + r.width - RAIL;
    }
    walls.push({ x, y: line, width: WORLD.width - x, height: CLIFF_FACE });
    return walls;
  }),
  ...GARDEN_WALLS,
];

/** 발밑이 계단 위인가 */
export function onStairs(p: Point): boolean {
  return STAIRS.some((s) => p.x >= s.rect.x && p.x <= s.rect.x + s.rect.width && p.y >= s.rect.y && p.y <= s.rect.y + s.rect.height + 16);
}

/** 계단 위·아래 끝 (시험 훅 `data-stairs`): 위 단 가장자리 바로 위, 아래 단 앞면 바로 아래 */
export function stairEnds(s: Stair): { top: Point; bottom: Point } {
  return { top: { x: s.x, y: s.top - 6 }, bottom: { x: s.x, y: s.top + CLIFF_FACE + 24 } };
}
