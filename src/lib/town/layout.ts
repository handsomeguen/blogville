// 마을 배치·이동 규칙 (TOWN-01~04, specs/038-town). 게임 화면과 단위 시험이 같이 쓴다. 좌표 단위는 px, 기준점은 그림의 발밑(아랫변 가운데).

/** 마을 크기. 동쪽 400px은 내 정원(TOWN-20, specs/053-my-garden) 자리 */
export const WORLD = { width: 2400, height: 1600 } as const;
export const CENTER = { x: 1000, y: 800 } as const;
/** 돌광장 반지름 */
export const PLAZA_RADIUS = 230;
/** 초당 이동 거리 */
export const SPEED = 230;
/** 입구에서 이만큼 안이면 들어갈 수 있다 */
export const INTERACT_DISTANCE = 90;
/** 캐릭터 그림 크기 (도트 16칸 × 4, 정수배라 칸이 고르다) */
export const PLAYER_SIZE = 64;
/** 캐릭터 발밑 상자 */
export const FEET = { width: 28, height: 16 } as const;
/** 처음 서는 곳: 분수 아래 */
export const START_POS = { x: CENTER.x + 50, y: CENTER.y + 160 } as const;

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** 서쪽·동쪽 길이 지나는 x, 남쪽·언덕 길이 지나는 y, 길 너비 */
export const WEST_ROAD = 490;
export const EAST_ROAD = 1510;
const SOUTH_ROAD = 1500;
/** 북쪽 언덕 위 길 (TOWN-05) */
export const HILL_ROAD = 175;
export const ROAD = 52;

/** 내 정원 (TOWN-20): 마을 동쪽, 상점 너머 한 단 높은 반듯한 타원 (가운데 `cx`·`cy`, 가로·세로 반지름) */
export const GARDEN = { cx: 2000, cy: 740, rx: 350, ry: 210 } as const;
/** 정원 앞(남쪽) 가장자리 가운데: 돌 축대 위, 계단 꼭대기 */
export const GARDEN_FRONT_Y = GARDEN.cy + GARDEN.ry;
/** 정원 안 가로 길 (집 앞·농장 앞) */
export const GARDEN_PATH_Y = 770;
/** 갈림길(동쪽 길)에서 정원 계단 아래로 가는 길 */
export const GARDEN_APPROACH_Y = 1050;

/**
 * 집 자리 11곳 (집 그림의 발밑). 0번은 내 집으로 내 정원 안(TOWN-20), 1~4·7·8은 서쪽 길 양옆, 5·6은 동쪽 길 서쪽, 9·10은 남쪽 들판.
 * 이웃 집(1~10)은 모두 정원에서 200px 넘게 떨어져 있다.
 */
export const HOUSE_LOTS: readonly Point[] = [
  { x: 1870, y: 730 },
  { x: 300, y: 380 },
  { x: 300, y: 640 },
  { x: 300, y: 900 },
  { x: 300, y: 1160 },
  { x: 1320, y: 380 },
  { x: 1320, y: 1160 },
  { x: 680, y: 1160 },
  { x: 680, y: 380 },
  { x: 720, y: SOUTH_ROAD - 40 },
  { x: 1280, y: SOUTH_ROAD - 40 },
];

export const BOARD_POS = { x: CENTER.x, y: CENTER.y - 300 } as const;
export const SHOP_POS = { x: CENTER.x + 360, y: CENTER.y - 30 } as const;
/** 동물 농장 (TOWN-09): 내 정원 안, 내 집 오른쪽 (TOWN-20) */
export const FARM_POS = { x: 2150, y: 740 } as const;
/** 연못 낚시터 (TOWN-14): 광장 왼쪽, 상점 맞은편 */
export const POND_POS = { x: CENTER.x - 350, y: CENTER.y - 40 } as const;
export const FOUNTAIN_POS = { x: CENTER.x, y: CENTER.y + 40 } as const;

const band = (x1: number, y1: number, x2: number, y2: number): Rect => ({
  x: Math.min(x1, x2) - ROAD / 2,
  y: Math.min(y1, y2) - ROAD / 2,
  width: Math.abs(x2 - x1) + ROAD,
  height: Math.abs(y2 - y1) + ROAD,
});

/** 흙길 (가로·세로 띠). 바닥 그림과 나무 놓을 자리 거르기, 걸어 다니는 이웃(TOWN-19)의 길에 쓰고 걷는 데는 막지 않는다 */
export const ROADS: readonly Rect[] = [
  band(WEST_ROAD, CENTER.y, EAST_ROAD, CENTER.y), // 가운데 가로 길 (광장 동쪽으로 상점 앞을 지나는 상점 길)
  band(CENTER.x, BOARD_POS.y + 30, CENTER.x, CENTER.y + PLAZA_RADIUS), // 게시판 ~ 광장
  band(WEST_ROAD, HOUSE_LOTS[1].y + 40, WEST_ROAD, SOUTH_ROAD), // 서쪽 길
  band(EAST_ROAD, HOUSE_LOTS[5].y + 40, EAST_ROAD, SOUTH_ROAD), // 동쪽 길
  band(WEST_ROAD, SOUTH_ROAD, EAST_ROAD, SOUTH_ROAD), // 남쪽 길
  // 집 앞에서 길까지
  ...[1, 2, 3, 4, 7, 8].map((i) => band(HOUSE_LOTS[i].x, HOUSE_LOTS[i].y + 40, WEST_ROAD, HOUSE_LOTS[i].y + 40)),
  ...[5, 6].map((i) => band(HOUSE_LOTS[i].x, HOUSE_LOTS[i].y + 40, EAST_ROAD, HOUSE_LOTS[i].y + 40)),
  band(SHOP_POS.x, SHOP_POS.y + 30, SHOP_POS.x, CENTER.y),
  // 북쪽 언덕 (TOWN-05): 서쪽·동쪽 길이 계단으로 올라가 언덕 위 길로 이어진다
  band(WEST_ROAD, HILL_ROAD, WEST_ROAD, HOUSE_LOTS[1].y + 40),
  band(EAST_ROAD, HILL_ROAD, EAST_ROAD, HOUSE_LOTS[5].y + 40),
  band(WEST_ROAD, HILL_ROAD, EAST_ROAD, HILL_ROAD),
];

/** 정원 가는 흙길 (TOWN-20): 동쪽 길 갈림길 → 정원 계단 아래. 걸어 다니는 이웃은 쓰지 않는다 */
export const GARDEN_APPROACH: readonly Rect[] = [
  band(EAST_ROAD, GARDEN_APPROACH_Y, GARDEN.cx, GARDEN_APPROACH_Y),
  band(GARDEN.cx, GARDEN_FRONT_Y, GARDEN.cx, GARDEN_APPROACH_Y),
];

/** 정원 안 돌길 (TOWN-20): 아치 문 → 집 앞·농장 앞 */
export const GARDEN_PATHS: readonly Rect[] = [
  band(GARDEN.cx, GARDEN_PATH_Y, GARDEN.cx, GARDEN_FRONT_Y),
  band(HOUSE_LOTS[0].x, GARDEN_PATH_Y, FARM_POS.x, GARDEN_PATH_Y),
];

/** 정원 꽃밭 (TOWN-20): 아치 문 양옆, 내 집 옆. 바닥 그림이라 걸을 수 있다 */
export const GARDEN_BEDS: readonly Rect[] = [
  { x: GARDEN.cx - 130, y: 885, width: 70, height: 36 },
  { x: GARDEN.cx + 60, y: 885, width: 70, height: 36 },
  { x: HOUSE_LOTS[0].x - 170, y: 690, width: 60, height: 50 },
];

/** 정원 안인가: 타원을 `margin`px 넓혀서 본다 (음수면 좁혀서) */
export function inGarden(p: Point, margin = 0): boolean {
  const dx = (p.x - GARDEN.cx) / (GARDEN.rx + margin);
  const dy = (p.y - GARDEN.cy) / (GARDEN.ry + margin);
  return dx * dx + dy * dy <= 1;
}

/** 정원 타원의 x 자리 위·아래 가장자리 y (타원 밖이면 null) */
export function gardenEdge(x: number): { top: number; bottom: number } | null {
  const t = (x - GARDEN.cx) / GARDEN.rx;
  if (t < -1 || t > 1) return null;
  const half = GARDEN.ry * Math.sqrt(1 - t * t);
  return { top: GARDEN.cy - half, bottom: GARDEN.cy + half };
}

/** 이름표가 길면 줄인다 (12자) */
export function shortName(name: string, max = 12): string {
  const chars = [...name];
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : name;
}

/** 두 상자가 겹치는가 (모서리만 닿으면 안 겹침) */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** 발밑 좌표의 발 상자 */
export function feetRect(p: Point): Rect {
  return {
    x: p.x - FEET.width / 2,
    y: p.y - FEET.height,
    width: FEET.width,
    height: FEET.height,
  };
}

/** 입력 방향을 길이 1로 (대각선도 같은 속도) */
export function normalize(dx: number, dy: number): Point {
  const len = Math.hypot(dx, dy);
  return len === 0 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len };
}

/**
 * 한 걸음 옮긴다: 가로, 세로를 따로 옮겨 벽을 따라 미끄러지게 한다.
 * 마을 밖과 몸체(`bodies`)에 걸리는 축은 그대로 둔다.
 */
export function step(from: Point, delta: Point, bodies: readonly Rect[]): Point {
  const blocked = (p: Point) => {
    const f = feetRect(p);
    if (f.x < 0 || f.y < 0 || f.x + f.width > WORLD.width || f.y + f.height > WORLD.height) return true;
    return bodies.some((b) => overlaps(f, b));
  };
  let p = from;
  const nx = { x: p.x + delta.x, y: p.y };
  if (delta.x !== 0 && !blocked(nx)) p = nx;
  const ny = { x: p.x, y: p.y + delta.y };
  if (delta.y !== 0 && !blocked(ny)) p = ny;
  return p;
}

export type Entrance = { id: string; x: number; y: number };

/** `INTERACT_DISTANCE` 안에서 가장 가까운 입구 */
export function nearestEntrance<T extends Entrance>(p: Point, entrances: readonly T[]): T | null {
  let best: T | null = null;
  let bestDistance: number = INTERACT_DISTANCE;
  for (const e of entrances) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d <= bestDistance) {
      best = e;
      bestDistance = d;
    }
  }
  return best;
}

/** 집 자리 앞 (입구·도착 자리) */
export function lotFront(lot: number): Point {
  const p = HOUSE_LOTS[lot];
  return { x: p.x, y: p.y + 40 };
}
