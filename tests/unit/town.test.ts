import { describe, expect, it } from "vitest";
import { houseArt, HOUSE_ART_WIDTH } from "@/lib/art/town";
import { CLIFF_FACE, CLIFF_LINES, heightAt, onStairs, stairEnds, STAIRS, TERRAIN_WALLS } from "@/lib/town/terrain";
import { ROOF_HEX } from "@/lib/roof";
import { feetRect, HOUSE_LOTS, INTERACT_DISTANCE, lotFront, nearestEntrance, normalize, overlaps, shortName, START_POS, step, WORLD, type Point } from "@/lib/town/layout";
import { EMPTY_LOT_HINT, entrancePrompt, mailboxLot, townLayout, townSpots, type TownHouseInput } from "@/lib/town/structures";

const house = (lot: number, mine = false): TownHouseInput => ({ lot, slug: `blog${lot}`, nickname: `주민${lot}`, blogTitle: `블로그 ${lot}`, stage: 1, roof: ROOF_HEX.red, mine });

describe("마을 이동 (TOWN-02)", () => {
  it("대각선도 같은 속도", () => {
    const d = normalize(1, 1);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
    expect(normalize(0, 0)).toEqual({ x: 0, y: 0 });
  });
  it("벽에 막힌 축만 멈추고 다른 축으로 미끄러진다, 마을 밖으로는 못 나간다", () => {
    const wall = { x: 100, y: 0, width: 20, height: 400 };
    expect(step({ x: 80, y: 200 }, { x: 10, y: 5 }, [wall])).toEqual({ x: 80, y: 205 });
    expect(step({ x: 20, y: 200 }, { x: -10, y: 0 }, [])).toEqual({ x: 20, y: 200 });
    expect(step({ x: WORLD.width - 20, y: WORLD.height }, { x: 0, y: 5 }, [])).toEqual({ x: WORLD.width - 20, y: WORLD.height });
  });
  it("입구는 90px 안에서 가장 가까운 것", () => {
    const es = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 50, y: 0 },
    ];
    expect(nearestEntrance({ x: 40, y: 0 }, es)?.id).toBe("b");
    expect(nearestEntrance({ x: -INTERACT_DISTANCE - 1, y: 0 }, es)).toBeNull();
  });
  it("이름표는 12자에서 줄인다", () => {
    expect(shortName("가나다라마바사아자차카타")).toBe("가나다라마바사아자차카타");
    expect(shortName("가나다라마바사아자차카타파")).toBe("가나다라마바사아자차카타…");
  });
});

describe("마을 배치 (TOWN-03·04)", () => {
  it("방문자에게 출석 체크·상점은 로그인 안내, 회원은 그 화면", () => {
    const guest = townLayout([], false).entrances;
    expect(entrancePrompt(guest.find((e) => e.id === "shop")!)).toBe("🏪 상점 · Space 로그인하고 이용하기");
    expect(guest.find((e) => e.id === "feed")!.href).toBe("/feed");
    const member = townLayout([house(0, true)], true).entrances;
    expect(member.find((e) => e.id === "attendance")!.href).toBe("/attendance");
    expect(entrancePrompt(member.find((e) => e.id === "house:0")!)).toBe("🏠 내 집 · Space 들어가기");
  });
  it("집이 없는 자리는 빈 집터(0번은 내 집 자리)이고 입구가 없다", () => {
    const { structures, entrances } = townLayout([house(0, true), house(3)], true);
    expect(structures.filter((s) => s.id.startsWith("lot:")).map((s) => s.label)).toEqual(Array(9).fill("빈 집터"));
    expect(entrances.filter((e) => e.id.startsWith("house:")).map((e) => [e.id, e.href, e.label])).toEqual([
      ["house:0", "/@blog0", "🏠 내 집"],
      ["house:3", "/@blog3", "🏠 주민3의 집"],
    ]);
    expect(townLayout([], false).structures.find((s) => s.id === "lot:0")!.label).toBe("내 집 자리");
  });

  it("집이 다 차도 모든 입구에 처음 자리(분수 아래)에서 걸어서 갈 수 있다", () => {
    const { structures, entrances, walls } = townLayout(
      HOUSE_LOTS.map((_, i) => house(i, i === 0)),
      true,
    );
    const bodies = [...walls, ...structures.flatMap((s) => (s.body ? [s.body] : []))];
    const free = (p: Point) => {
      const f = feetRect(p);
      return f.x >= 0 && f.y >= 0 && f.x + f.width <= WORLD.width && f.y + f.height <= WORLD.height && !bodies.some((b) => overlaps(f, b));
    };
    // 10px 칸으로 걸어서 닿는 곳을 넓혀 간다
    const cell = 10;
    const key = (p: Point) => `${Math.round(p.x / cell)},${Math.round(p.y / cell)}`;
    const seen = new Set([key(START_POS)]);
    const queue: Point[] = [START_POS];
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
    expect(free(START_POS)).toBe(true);
    for (const e of entrances) {
      const reached = [...seen].some((k) => {
        const [x, y] = k.split(",").map((v) => Number(v) * cell);
        return Math.hypot(x - e.x, y - e.y) <= INTERACT_DISTANCE - 10;
      });
      expect(reached, e.id).toBe(true);
    }
    // 집 앞(도착 자리)은 몸체에 걸리지 않는다
    for (let i = 0; i < HOUSE_LOTS.length; i++) expect(free(lotFront(i)), `lot ${i}`).toBe(true);
    // 높낮이 (TOWN-05): 세 단 모두와 계단 양끝에 걸어서 닿는다
    const reach = (p: Point) => seen.has(key(p));
    for (const st of STAIRS) {
      const { top, bottom } = stairEnds(st);
      expect(reach(top), `${st.id} 위`).toBe(true);
      expect(reach(bottom), `${st.id} 아래`).toBe(true);
    }
    expect([...seen].some((k) => heightAt(Number(k.split(",")[1]) * cell) === 2)).toBe(true);
    expect([...seen].some((k) => heightAt(Number(k.split(",")[1]) * cell) === 0)).toBe(true);
    // 계단이 아닌 곳의 절벽 앞면은 걸을 수 없다
    for (const line of CLIFF_LINES) expect(free({ x: 1000, y: line + CLIFF_FACE / 2 })).toBe(false);
  });
});

describe("집 그림 (TOWN-11)", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])("%i단계 그림은 폭이 같고 모든 글자에 색이 있다", (stage) => {
    const art = houseArt(stage, ROOF_HEX.blue);
    for (const row of art.rows) {
      expect(row).toHaveLength(HOUSE_ART_WIDTH);
      for (const ch of row) if (ch !== ".") expect(art.palette[ch]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(art.rows).toHaveLength(stage >= 6 ? 40 : 30);
  });
  it("단계가 오르면 그림이 달라진다", () => {
    const drawings = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => houseArt(s, ROOF_HEX.red).rows.join("\n")));
    expect(drawings.size).toBe(10);
  });
});

describe("☰ 텔레포트 목록 (TOWN-12)", () => {
  it("마을 5곳 + 집 11자리, 집은 입구 앞 좌표·블로그 주소, 빈 집터는 못 고르고 회원에게만 ⭐ 안내", () => {
    const member = townSpots([house(0, true), house(2)], true);
    expect(member.places.map((s) => s.label)).toEqual(["⛲ 광장 분수", "📋 마을 게시판", "🏪 상점", "🐮 동물 농장", "🎣 낚시터"]);
    expect(member.houses).toHaveLength(11);
    expect(member.houses[0]).toMatchObject({ label: "🏠 내 집", sub: "블로그 0", enabled: true, slug: "blog0", ...lotFront(0) });
    expect(member.houses[2]).toMatchObject({ label: "🏠 주민2의 집", enabled: true, slug: "blog2" });
    expect(member.houses[1]).toMatchObject({ label: "빈 집터", sub: EMPTY_LOT_HINT, enabled: false, slug: null });
    const guest = townSpots([house(1)], false);
    expect(guest.houses[0]).toMatchObject({ label: "내 집 자리", sub: null, enabled: false });
    expect(guest.houses[2]).toMatchObject({ label: "빈 집터", sub: null });
  });
  it("텔레포트 자리는 몸체에 걸리지 않는다", () => {
    const { structures } = townLayout(
      HOUSE_LOTS.map((_, i) => house(i, i === 0)),
      true,
    );
    const bodies = structures.flatMap((s) => (s.body ? [s.body] : []));
    const spots = townSpots(
      HOUSE_LOTS.map((_, i) => house(i, i === 0)),
      true,
    );
    for (const s of [...spots.places, ...spots.houses]) expect(bodies.some((b) => overlaps(feetRect(s), b)), s.id).toBe(false);
  });
});

describe("높낮이 (TOWN-05)", () => {
  it("계단은 절벽 4곳 + 정원 1곳, 길보다 넓고 앞면 조각과 겹치지 않으며 계단 위는 느리게", () => {
    expect(STAIRS.map((s) => s.id)).toEqual(["north-west", "north-east", "south-west", "south-east", "garden"]);
    for (const st of STAIRS) {
      expect(st.rect.width).toBeGreaterThan(52);
      const inner = { x: st.rect.x + 8, y: st.rect.y, width: st.rect.width - 16, height: st.rect.height };
      expect(TERRAIN_WALLS.some((w) => overlaps(w, inner))).toBe(false);
      expect(onStairs({ x: st.x, y: st.top + 10 })).toBe(true);
    }
    expect(onStairs({ x: 1000, y: 800 })).toBe(false);
    expect([100, 600, 1500].map(heightAt)).toEqual([2, 1, 0]);
  });
});

describe("집 앞 우체통 (TOWN-13)", () => {
  it("집이 선 자리에만 우체통과 `소식 보기` 입구, 내 우체통은 깃발을 올릴 수 있다", () => {
    const { structures, entrances } = townLayout([house(0, true), house(3)], true, true);
    const boxes = entrances.filter((e) => mailboxLot(e.href) !== null);
    expect(boxes.map((e) => mailboxLot(e.href))).toEqual([0, 3]);
    expect(entrancePrompt(boxes[0])).toBe("📬 내 우체통 · Space 소식 보기");
    expect(entrancePrompt(boxes[1])).toBe("📬 주민3의 우체통 · Space 소식 보기");
    expect(structures.filter((s) => s.id.startsWith("mailbox:"))).toHaveLength(2);
    const mine = structures.find((s) => s.id === "mailbox:0")!;
    expect(Object.values(mine.art.palette)).toContain("#4a90d9");
    expect(mine.art.rows.join("")).not.toEqual(townLayout([house(0, true)], true, false).structures.find((s) => s.id === "mailbox:0")!.art.rows.join(""));
    expect(Object.values(structures.find((s) => s.id === "mailbox:3")!.art.palette)).toContain("#d9534f");
    expect(mailboxLot("/@abc")).toBeNull();
    expect(mailboxLot("mailbox:x")).toBeNull();
  });
});
