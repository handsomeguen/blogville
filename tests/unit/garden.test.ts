import { describe, expect, it } from "vitest";
import { ROOF_HEX } from "@/lib/roof";
import { FARM_POS, feetRect, GARDEN, GARDEN_BEDS, HOUSE_LOTS, inGarden, lotFront, overlaps, START_POS, WORLD, type Point, type Rect } from "@/lib/town/layout";
import { lotArea } from "@/lib/town/lots";
import { GARDEN_CLEARANCE, npcGraph } from "@/lib/town/npc";
import { GARDEN_GATE, townLayout, townSpots, type TownHouseInput } from "@/lib/town/structures";
import { GARDEN_STAIR, heightAt, stairEnds } from "@/lib/town/terrain";

// 내 정원 (TOWN-20), specs/053-my-garden
const house = (lot: number, mine = false): TownHouseInput => ({ lot, slug: `blog${lot}`, nickname: `주민${lot}`, blogTitle: `블로그 ${lot}`, stage: 10, roof: ROOF_HEX.red, mine });
const all = HOUSE_LOTS.map((_, i) => house(i, i === 0));
const layout = townLayout(all, true, false, true);
const bodies = [...layout.walls, ...layout.structures.flatMap((s) => (s.body ? [s.body] : []))];
const corners = (r: Rect): Point[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y },
  { x: r.x, y: r.y + r.height },
  { x: r.x + r.width, y: r.y + r.height },
];

/** 정원 둘레(타원)까지 가장 가까운 거리 (둘레를 0.25도마다 본다) */
function distanceToGarden(p: Point): number {
  let best = Infinity;
  for (let i = 0; i < 1440; i++) {
    const a = (i / 1440) * Math.PI * 2;
    best = Math.min(best, Math.hypot(GARDEN.cx + GARDEN.rx * Math.cos(a) - p.x, GARDEN.cy + GARDEN.ry * Math.sin(a) - p.y));
  }
  return best;
}

/** `from`에서 10px 칸으로 걸어서 닿는 곳 (`extra`는 더 막을 곳) */
function reachable(from: Point, extra: readonly Rect[] = []): (p: Point) => boolean {
  const blocks = [...bodies, ...extra];
  const free = (p: Point) => {
    const f = feetRect(p);
    return f.x >= 0 && f.y >= 0 && f.x + f.width <= WORLD.width && f.y + f.height <= WORLD.height && !blocks.some((b) => overlaps(f, b));
  };
  const cell = 10;
  const key = (p: Point) => `${Math.round(p.x / cell)},${Math.round(p.y / cell)}`;
  const seen = new Set([key(from)]);
  const queue: Point[] = [from];
  while (queue.length) {
    const p = queue.pop()!;
    for (const [dx, dy] of [
      [cell, 0],
      [-cell, 0],
      [0, cell],
      [0, -cell],
    ]) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (!seen.has(key(n)) && free(n)) {
        seen.add(key(n));
        queue.push(n);
      }
    }
  }
  // 입구처럼 `INTERACT_DISTANCE`보다 넉넉히 가까운 칸이 있으면 닿는다
  return (p) => [...seen].some((k) => {
    const [x, y] = k.split(",").map((v) => Number(v) * cell);
    return Math.hypot(x - p.x, y - p.y) <= 30;
  });
}

describe("내 정원 (TOWN-20)", () => {
  it("내 집(0번)·우체통·동물 농장과 그 입구가 정원 타원 안에 있고, 정원은 한 단 높다", () => {
    const inside = (id: string) => {
      const s = layout.structures.find((x) => x.id === id)!;
      expect(inGarden(s), id).toBe(true);
      if (s.body) for (const c of corners(s.body)) expect(inGarden(c), `${id} 몸체`).toBe(true);
    };
    inside("house:0");
    inside("mailbox:0");
    inside("farm");
    expect(inGarden(HOUSE_LOTS[0])).toBe(true);
    expect(inGarden(FARM_POS)).toBe(true);
    for (const id of ["house:0", "mailbox:0", "farm"]) expect(inGarden(layout.entrances.find((e) => e.id === id)!), `${id} 입구`).toBe(true);
    // 텔레포트 ✨ 내 집·동물 농장도 정원 안 (TOWN-12)
    const spots = townSpots(all, true);
    expect(inGarden(spots.houses[0])).toBe(true);
    expect(inGarden(spots.places.find((s) => s.id === "farm")!)).toBe(true);
    // 꽃밭·아치 문도 정원 안, 정원은 가운데 단보다 한 단 높다
    for (const bed of GARDEN_BEDS) for (const c of corners(bed)) expect(inGarden(c)).toBe(true);
    expect(inGarden(GARDEN_GATE)).toBe(true);
    expect(heightAt(lotFront(0).y, lotFront(0).x)).toBe(2);
    expect(heightAt(START_POS.y, START_POS.x)).toBe(1);
  });

  it("정원 안 건물은 내 집·농장·우체통·아치 문·울타리뿐이다 (벚나무 장식 둘)", () => {
    const inside = layout.structures.filter((s) => inGarden(s, 40)).map((s) => s.id);
    const allowed = /^(house:0|mailbox:0|farm|garden-arch|garden-fence:\d+|garden-tree:[01])$/;
    for (const id of inside) expect(id, id).toMatch(allowed);
    expect(inside).toEqual(expect.arrayContaining(["house:0", "mailbox:0", "farm", "garden-arch", "garden-tree:0", "garden-tree:1"]));
    expect(inside.filter((id) => id.startsWith("garden-fence:")).length).toBeGreaterThanOrEqual(8);
    // 정원 장식은 정원 밖에 없다, 빈 0번 자리(방문자)도 정원 안
    for (const s of layout.structures.filter((s) => s.id.startsWith("garden-"))) expect(inGarden(s), s.id).toBe(true);
    expect(inGarden(townLayout([], false).structures.find((s) => s.id === "lot:0")!)).toBe(true);
  });

  it("이웃 집 자리 1~10번은 모두 정원에서 200px 넘게 떨어져 있다", () => {
    for (let lot = 1; lot <= 10; lot++) {
      const s = layout.structures.find((x) => x.id === `house:${lot}`)!;
      for (const p of [HOUSE_LOTS[lot], lotFront(lot), ...corners(s.body!)]) {
        expect(inGarden(p), `${lot}번`).toBe(false);
        expect(distanceToGarden(p), `${lot}번`).toBeGreaterThan(200);
      }
      expect(["서쪽 길", "동쪽 길", "남쪽 들판"]).toContain(lotArea(lot));
    }
  });

  it("걸어 다니는 이웃의 길(점·줄)은 정원 둘레 60px 안에 없다", () => {
    const graph = npcGraph(bodies, lotFront(0), HOUSE_LOTS.map((_, i) => lotFront(i)));
    expect(GARDEN_CLEARANCE).toBe(60);
    expect(graph.nodes.length).toBeGreaterThan(10);
    for (const n of graph.nodes) expect(inGarden(n, 60)).toBe(false);
    graph.links.forEach((ns, i) => {
      for (const j of ns) {
        const [a, b] = [graph.nodes[i], graph.nodes[j]];
        for (let t = 0; t <= 1; t += 0.02) expect(inGarden({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, 60)).toBe(false);
      }
    });
  });

  it("정원에는 정원 계단으로만 들어간다: 계단을 막으면 집·농장 앞에 못 간다, 정원 밖 둘레·축대는 걸을 수 없다", () => {
    const targets = ["house:0", "mailbox:0", "farm"].map((id) => layout.entrances.find((e) => e.id === id)!);
    const open = reachable(START_POS);
    for (const t of targets) expect(open(t), t.id).toBe(true);
    const { top, bottom } = stairEnds(GARDEN_STAIR);
    expect(open(top)).toBe(true);
    expect(open(bottom)).toBe(true);
    expect(inGarden(top)).toBe(true);
    expect(inGarden(bottom)).toBe(false);

    const closed = reachable(START_POS, [GARDEN_STAIR.rect]);
    for (const t of targets) expect(closed(t), `${t.id} (계단을 막으면)`).toBe(false);
    expect(closed(top)).toBe(false);
    expect(closed(bottom)).toBe(true);
    // 정원 안에서 시작해도 계단을 막으면 밖(광장)에 못 나간다
    expect(reachable(lotFront(0), [GARDEN_STAIR.rect])(START_POS)).toBe(false);
    // 정원 둘레(앞 축대 가운데 옆, 옆 끝, 뒤)는 몸이 들어갈 수 없다
    for (const p of [
      { x: GARDEN.cx - 150, y: GARDEN.cy + GARDEN.ry * Math.sqrt(1 - (150 / GARDEN.rx) ** 2) + 30 },
      { x: GARDEN.cx - GARDEN.rx + 2, y: GARDEN.cy + 10 },
      { x: GARDEN.cx + 100, y: GARDEN.cy - GARDEN.ry * Math.sqrt(1 - (100 / GARDEN.rx) ** 2) + 4 },
    ])
      expect(bodies.some((b) => overlaps(feetRect(p), b)), `${p.x},${p.y}`).toBe(true);
  });
});
