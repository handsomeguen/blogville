// 걸어 다니는 이웃 (TOWN-19, specs/050-town-npc): 마을에 집이 선 이웃이 흙길을 따라 걷는다. 게임 화면과 단위 시험이 같이 쓴다.
import { walkDir, type WalkDir } from "@/lib/art/walk";
import { feetRect, inGarden, lotFront, overlaps, ROAD, ROADS, WORLD, type Point, type Rect } from "./layout";

/** 이웃이 걷는 빠르기 (px/초). 내 캐릭터(230)보다 느긋하게 */
export const NPC_SPEED = 70;
/** 내 집(0번) 앞 이만큼 안에는 오지 않는다 */
export const HOME_CLEARANCE = 190;
/** 내 정원(TOWN-20) 둘레 이만큼 안에도 오지 않는다. 정원 길(`GARDEN_APPROACH`·`GARDEN_PATHS`)은 처음부터 길 그물에 없다 */
export const GARDEN_CLEARANCE = 60;
/** 갈림길에서 쉬는 시간 (초) */
export const NPC_PAUSE = { min: 0.6, max: 1.8 } as const;
/** 이 거리 안에 들어오면 이름표가 보인다 */
export const NPC_TAG_DISTANCE = 140;

/** 이웃이 걷는 길: 흙길 가운데선의 점(갈림길·끝·집 앞)과 그 사이 줄 */
export type NpcGraph = { nodes: Point[]; links: number[][] };

/** 흙길 띠(`ROADS`)의 가운데선 */
function centerline(r: Rect): [Point, Point] {
  return [
    { x: r.x + ROAD / 2, y: r.y + ROAD / 2 },
    { x: r.x + r.width - ROAD / 2, y: r.y + r.height - ROAD / 2 },
  ];
}

/** 점이 가로·세로 선분 위에 있는가 */
function onSegment(p: Point, a: Point, b: Point): boolean {
  return Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y) && (a.x === b.x ? p.x === a.x : p.y === a.y);
}

/** 두 점 사이를 걸을 수 있는가: 6px마다 발 상자가 마을 안이고 몸체(`bodies`)에 닿지 않는다 */
export function segmentClear(a: Point, b: Point, bodies: readonly Rect[]): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
  for (let i = 0; i <= n; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
    const f = feetRect(p);
    if (f.x < 0 || f.y < 0 || f.x + f.width > WORLD.width || f.y + f.height > WORLD.height) return false;
    if (bodies.some((body) => overlaps(f, body))) return false;
  }
  return true;
}

/** 두 점 사이가 내 정원 둘레 `GARDEN_CLEARANCE` 안을 지나는가 (6px마다 본다) */
function nearGarden(a: Point, b: Point): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
  for (let i = 0; i <= n; i++) if (inGarden({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }, GARDEN_CLEARANCE)) return true;
  return false;
}

/** 선분 위에서 `home`에 가장 가까운 거리 */
function distanceToSegment(home: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((home.x - a.x) * dx + (home.y - a.y) * dy) / len));
  return Math.hypot(a.x + t * dx - home.x, a.y + t * dy - home.y);
}

/**
 * 걷는 길 만들기: 흙길마다 끝·다른 길과 만나는 점·집 앞(`stops`)에서 끊어 이웃한 점끼리 잇는다.
 * 건물·나무·절벽에 막히는 줄, 내 집(`home`) 앞 `HOME_CLEARANCE` 안을 지나는 줄, 내 정원 둘레를 지나는 줄은 뺀다. 줄이 없는 점은 버린다.
 * 길은 공개 흙길(`ROADS`)만 쓰고 정원 길은 쓰지 않는다 (TOWN-20).
 */
export function npcGraph(bodies: readonly Rect[], home: Point | null, stops: readonly Point[] = []): NpcGraph {
  const segments = ROADS.map(centerline).filter(([a, b]) => a.x !== b.x || a.y !== b.y);
  const key = (p: Point) => `${p.x},${p.y}`;
  const index = new Map<string, number>();
  const points: Point[] = [];
  const pairs = new Set<string>();
  const nodeOf = (p: Point) => {
    const k = key(p);
    if (!index.has(k)) {
      index.set(k, points.length);
      points.push(p);
    }
    return index.get(k)!;
  };
  for (const [a, b] of segments) {
    const cuts: Point[] = [a, b];
    for (const [c, d] of segments) {
      // 가로·세로 두 길이 만나는 점 (끝이 닿는 T자 포함)
      const cross = a.y === b.y ? { x: c.x, y: a.y } : { x: a.x, y: c.y };
      if (c.x === d.x !== (a.x === b.x) && onSegment(cross, a, b) && onSegment(cross, c, d)) cuts.push(cross);
      for (const end of [c, d]) if (onSegment(end, a, b)) cuts.push(end);
    }
    for (const s of stops) if (onSegment(s, a, b)) cuts.push(s);
    const along = (p: Point) => (a.x === b.x ? p.y : p.x);
    const sorted = [...new Map(cuts.map((p) => [key(p), p])).values()].sort((p, q) => along(p) - along(q));
    for (let i = 1; i < sorted.length; i++) {
      const [p, q] = [sorted[i - 1], sorted[i]];
      if (home && distanceToSegment(home, p, q) < HOME_CLEARANCE) continue;
      if (nearGarden(p, q)) continue;
      if (!segmentClear(p, q, bodies)) continue;
      const [x, y] = [nodeOf(p), nodeOf(q)];
      pairs.add(x < y ? `${x}:${y}` : `${y}:${x}`);
    }
  }
  const links: number[][] = points.map(() => []);
  for (const pair of pairs) {
    const [x, y] = pair.split(":").map(Number);
    links[x].push(y);
    links[y].push(x);
  }
  return { nodes: points, links };
}

/** 걷는 이웃 하나 */
export type Npc = {
  lot: number;
  name: string;
  pos: Point;
  /** 지난 점, 가는 점 (길 점 번호) */
  from: number;
  to: number;
  /** 남은 쉬는 시간 (초) */
  pause: number;
  facing: WalkDir;
  walking: boolean;
};

/** 집 앞에서 가장 가까운 길 점 (줄이 있는 점만) */
export function nearestNode(graph: NpcGraph, p: Point): number {
  let best = -1;
  let bestDistance = Infinity;
  graph.nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (graph.links[i].length > 0 && d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

/** 이웃마다 자기 집 앞에서 가까운 길 점에서 출발한다. 길이 없으면 아무도 걷지 않는다 */
export function createNpcs(graph: NpcGraph, houses: readonly { lot: number; nickname: string }[], random: () => number): Npc[] {
  return houses.flatMap((h) => {
    const start = nearestNode(graph, lotFront(h.lot));
    if (start < 0) return [];
    return [{ lot: h.lot, name: h.nickname, pos: { ...graph.nodes[start] }, from: start, to: start, pause: random() * NPC_PAUSE.max, facing: "down" as WalkDir, walking: false }];
  });
}

/** 다음에 갈 점: 온 길로 바로 돌아가지 않는다 (막다른 길이면 돌아간다) */
function nextNode(graph: NpcGraph, npc: Npc, random: () => number): number {
  const options = graph.links[npc.to].filter((n) => n !== npc.from);
  const choices = options.length > 0 ? options : graph.links[npc.to];
  return choices[Math.floor(random() * choices.length)] ?? npc.to;
}

/** `dt`초만큼 걷는다. 점에 닿으면 다음 점을 고르고, 갈림길(줄 3개 이상)·막다른 길에서는 잠깐 쉰다 */
export function updateNpcs(npcs: Npc[], graph: NpcGraph, dt: number, random: () => number): void {
  for (const npc of npcs) {
    let left = dt;
    npc.walking = false;
    while (left > 0) {
      if (npc.pause > 0) {
        const rest = Math.min(npc.pause, left);
        npc.pause -= rest;
        left -= rest;
        continue;
      }
      if (npc.from === npc.to) {
        const next = nextNode(graph, npc, random);
        if (next === npc.to) break;
        npc.to = next;
      }
      const target = graph.nodes[npc.to];
      const dx = target.x - npc.pos.x;
      const dy = target.y - npc.pos.y;
      const distance = Math.hypot(dx, dy);
      const move = Math.min(distance, NPC_SPEED * left);
      if (distance > 0) {
        npc.facing = walkDir(dx, dy, npc.facing);
        npc.pos = { x: npc.pos.x + (dx / distance) * move, y: npc.pos.y + (dy / distance) * move };
        npc.walking = true;
      }
      left -= distance > 0 ? move / NPC_SPEED : 0;
      if (move >= distance) {
        npc.pos = { ...target };
        const arrived = npc.to;
        const degree = graph.links[arrived].length;
        npc.to = nextNode(graph, npc, random);
        npc.from = arrived;
        if (degree !== 2) npc.pause = NPC_PAUSE.min + random() * (NPC_PAUSE.max - NPC_PAUSE.min);
        if (npc.to === arrived) break;
      }
    }
  }
}
