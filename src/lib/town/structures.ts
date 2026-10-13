// 마을에 놓을 것과 입구 (TOWN-03·04, specs/038-town). 그림은 `src/lib/art/town.ts`, 좌표는 `layout.ts`.
import type { PixelArt } from "@/lib/art/characters";
import {
  benchArt,
  boardArt,
  cherryTreeArt,
  emptyLotArt,
  farmArt,
  fenceArt,
  fountainArt,
  gardenArchArt,
  houseArt,
  lampArt,
  mailboxArt,
  pondArt,
  shopArt,
  TOWN_CELL,
  treeArt,
} from "@/lib/art/town";
import {
  BOARD_POS,
  CENTER,
  FOUNTAIN_POS,
  GARDEN,
  GARDEN_APPROACH,
  gardenEdge,
  GARDEN_FRONT_Y,
  HILL_ROAD,
  HOUSE_LOTS,
  lotFront,
  PLAZA_RADIUS,
  ROADS,
  FARM_POS,
  POND_POS,
  SHOP_POS,
  START_POS,
  WORLD,
  overlaps,
  shortName,
  type Entrance,
  type Rect,
} from "./layout";
import { CLIFF_FACE, CLIFF_LINES, TERRAIN_WALLS } from "./terrain";

export type TownHouseInput = {
  lot: number;
  slug: string;
  nickname: string;
  blogTitle: string;
  stage: number;
  roof: string;
  mine: boolean;
  /** 집 주인의 입은 모습 (걸어 다니는 이웃, TOWN-19). 없으면 회색 주민 */
  layers?: string[];
};

/** 마을에 서는 것 하나: 그림(발밑 기준), 부딪히는 몸체, 이름표 */
export type Structure = {
  id: string;
  art: PixelArt;
  x: number;
  y: number;
  body: Rect | null;
  label?: string;
  sub?: string;
};

/** 들어갈 곳. `href`가 `login`이면 로그인이 필요한 곳(방문자), `mailbox:{자리}`면 우체통 창 (TOWN-13), `lots:{자리}`면 자리 고르기 창 (TOWN-18) */
export type TownEntrance = Entrance & { label: string; href: string };

/** 우체통 입구의 집 자리 번호 (우체통이 아니면 null) */
export function mailboxLot(href: string): number | null {
  const m = /^mailbox:(\d+)$/.exec(href);
  return m ? Number(m[1]) : null;
}

/** 빈 집터 입구의 자리 번호 (자리 고르기가 아니면 null, TOWN-18) */
export function lotChoice(href: string): number | null {
  const m = /^lots:(\d+)$/.exec(href);
  return m ? Number(m[1]) : null;
}

/** 우체통은 집 오른쪽 앞 (집 발밑에서) */
export const MAILBOX_OFFSET = { x: 118, y: 6 } as const;

/** 정원 아치 문 발밑 (TOWN-20): 정원 계단 꼭대기 */
export const GARDEN_GATE = { x: GARDEN.cx, y: GARDEN_FRONT_Y - 4 } as const;

/** 아치 문 기둥 둘 (걸을 수 없다). 기둥 사이 90px로 지나간다 */
export const GARDEN_GATE_POSTS: readonly Rect[] = [
  { x: GARDEN_GATE.x - 60, y: GARDEN_GATE.y - 8, width: 15, height: 8 },
  { x: GARDEN_GATE.x + 45, y: GARDEN_GATE.y - 8, width: 15, height: 8 },
];

/** 정원 앞 흰 울타리 칸의 가운데 x (아치 문 양옆으로 50px마다, 타원 끝 가까이는 비운다) */
export const GARDEN_FENCE_XS: readonly number[] = [75, 125, 175, 225, 275].flatMap((d) => [GARDEN.cx - d, GARDEN.cx + d]).sort((a, b) => a - b);

/** 정원 뒤 귀퉁이 벚나무 둘 */
export const GARDEN_TREES: readonly { x: number; y: number }[] = [
  { x: GARDEN.cx - 275, y: 650 },
  { x: GARDEN.cx + 275, y: 650 },
];

/** `walls`: 걸을 수 없는 땅 (절벽 앞면·하늘, TOWN-05, 정원 둘레와 아치 문 기둥, TOWN-20) */
export type TownLayout = { structures: Structure[]; entrances: TownEntrance[]; walls: readonly Rect[] };

/** 그림 크기 (px) */
export function artSize(art: PixelArt): { width: number; height: number } {
  return {
    width: art.rows[0].length * TOWN_CELL,
    height: art.rows.length * TOWN_CELL,
  };
}

/** 그림 맨 위 빈 줄을 뺀 실제 높이 (px). 이름표를 그림 바로 위에 붙인다 */
export function artVisibleHeight(art: PixelArt): number {
  const first = art.rows.findIndex((row) => /[^.]/.test(row));
  return (art.rows.length - Math.max(0, first)) * TOWN_CELL;
}

/** 고정 씨앗 난수 (나무 자리가 매번 같다) */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 입구에 붙는 안내: `🏪 상점 · Space 들어가기`, 방문자가 회원 전용 곳에 가면 `· Space 로그인하고 이용하기` */
export function entrancePrompt(e: TownEntrance): string {
  const action = e.href === "login" ? "로그인하고 이용하기" : mailboxLot(e.href) !== null ? "소식 보기" : lotChoice(e.href) !== null ? "이웃 자리 고르기" : "들어가기";
  return `${e.label} · Space ${action}`;
}

/**
 * 마을 배치를 만든다: 게시판(마을 소식·출석 체크 입구 둘)·상점·분수·가로등, 집 자리 11곳(집이 없으면 빈 집터), 나무.
 * 방문자(`member = false`)에게 출석 체크·상점은 로그인 안내다. 집마다 오른쪽 앞에 우체통(TOWN-13), 내 우체통은 안 읽은 알림이 있으면(`mailFlag`) 깃발을 올린다.
 * 내 마을(`chooseLots`)이면 1~10번 빈 집터 앞이 자리 고르기 입구다 (TOWN-18).
 */
export function townLayout(houses: readonly TownHouseInput[], member: boolean, mailFlag = false, chooseLots = false): TownLayout {
  const lotArt = emptyLotArt();
  const lamp = lampArt();
  const structures: Structure[] = [];
  const entrances: TownEntrance[] = [];

  structures.push({
    id: "board",
    art: boardArt(),
    x: BOARD_POS.x,
    y: BOARD_POS.y,
    body: { x: BOARD_POS.x - 120, y: BOARD_POS.y - 40, width: 240, height: 40 },
    label: "마을 게시판",
  });
  entrances.push({
    id: "feed",
    x: BOARD_POS.x - 60,
    y: BOARD_POS.y + 30,
    label: "📋 마을 소식",
    href: "/feed",
  });
  entrances.push({
    id: "attendance",
    x: BOARD_POS.x + 60,
    y: BOARD_POS.y + 30,
    label: "📮 출석 체크",
    href: member ? "/attendance" : "login",
  });

  structures.push({
    id: "shop",
    art: shopArt(),
    x: SHOP_POS.x,
    y: SHOP_POS.y,
    body: { x: SHOP_POS.x - 95, y: SHOP_POS.y - 60, width: 190, height: 60 },
    label: "상점",
  });
  entrances.push({
    id: "shop",
    x: SHOP_POS.x + 40,
    y: SHOP_POS.y + 30,
    label: "🏪 상점",
    href: member ? "/shop" : "login",
  });

  structures.push({
    id: "farm",
    art: farmArt(),
    x: FARM_POS.x,
    y: FARM_POS.y,
    body: { x: FARM_POS.x - 110, y: FARM_POS.y - 50, width: 220, height: 50 },
    label: "동물 농장",
  });
  entrances.push({
    id: "farm",
    x: FARM_POS.x,
    y: FARM_POS.y + 30,
    label: "🐮 동물 농장",
    href: member ? "/farm" : "login",
  });

  // 내 정원 (TOWN-20): 계단 꼭대기 장미 아치 문, 앞 가장자리 흰 울타리, 뒤 귀퉁이 벚나무. 집(0번)·농장·우체통 말고 다른 건물은 없다
  structures.push({ id: "garden-arch", art: gardenArchArt(), x: GARDEN_GATE.x, y: GARDEN_GATE.y, body: null });
  const fence = fenceArt();
  for (const x of GARDEN_FENCE_XS) {
    structures.push({ id: `garden-fence:${x}`, art: fence, x, y: Math.round(gardenEdge(x)!.bottom) - 1, body: null });
  }
  const cherry = cherryTreeArt();
  GARDEN_TREES.forEach((t, i) => {
    structures.push({ id: `garden-tree:${i}`, art: cherry, x: t.x, y: t.y, body: { x: t.x - 10, y: t.y - 10, width: 20, height: 10 } });
  });

  structures.push({
    id: "pond",
    art: pondArt(),
    x: POND_POS.x,
    y: POND_POS.y,
    body: { x: POND_POS.x - 100, y: POND_POS.y - 110, width: 200, height: 70 },
    label: "연못 낚시터",
  });
  entrances.push({
    id: "pond",
    x: POND_POS.x,
    y: POND_POS.y + 30,
    label: "🎣 낚시터",
    href: member ? "/fishing" : "login",
  });

  structures.push({
    id: "fountain",
    art: fountainArt(),
    x: FOUNTAIN_POS.x,
    y: FOUNTAIN_POS.y,
    body: {
      x: FOUNTAIN_POS.x - 70,
      y: FOUNTAIN_POS.y - 45,
      width: 140,
      height: 45,
    },
  });
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const x = CENTER.x + dx * (PLAZA_RADIUS - 30) * 0.72;
    const y = CENTER.y + dy * (PLAZA_RADIUS - 30) * 0.72;
    structures.push({
      id: `lamp:${dx},${dy}`,
      art: lamp,
      x,
      y,
      body: { x: x - 6, y: y - 8, width: 12, height: 8 },
    });
  }

  // 북쪽 언덕 위 전망대 의자 (TOWN-05): 언덕 길 바로 위
  structures.push({
    id: "lookout",
    art: benchArt(),
    x: CENTER.x,
    y: HILL_ROAD - 32,
    body: { x: CENTER.x - 40, y: HILL_ROAD - 44, width: 80, height: 12 },
    label: "전망대",
  });

  HOUSE_LOTS.forEach((lot, i) => {
    const house = houses.find((h) => h.lot === i);
    if (house) {
      const name = house.mine ? "내 집" : `${shortName(house.nickname)}의 집`;
      structures.push({
        id: `house:${i}`,
        art: houseArt(house.stage, house.roof),
        x: lot.x,
        y: lot.y,
        body: { x: lot.x - 55, y: lot.y - 55, width: 105, height: 55 },
        label: name,
        sub: house.blogTitle,
      });
      const front = lotFront(i);
      entrances.push({
        id: `house:${i}`,
        x: front.x,
        y: front.y,
        label: `🏠 ${name}`,
        href: `/@${house.slug}`,
      });
      const box = { x: lot.x + MAILBOX_OFFSET.x, y: lot.y + MAILBOX_OFFSET.y };
      structures.push({
        id: `mailbox:${i}`,
        art: mailboxArt(house.mine, house.mine && mailFlag),
        x: box.x,
        y: box.y,
        body: { x: box.x - 8, y: box.y - 8, width: 16, height: 8 },
      });
      entrances.push({
        id: `mailbox:${i}`,
        x: box.x,
        y: box.y + 34,
        label: house.mine ? "📬 내 우체통" : `📬 ${shortName(house.nickname)}의 우체통`,
        href: `mailbox:${i}`,
      });
    } else {
      structures.push({
        id: `lot:${i}`,
        art: lotArt,
        x: lot.x,
        y: lot.y + 10,
        body: null,
        label: i === 0 ? "내 집 자리" : "빈 집터",
      });
      if (chooseLots && i > 0) {
        const front = lotFront(i);
        entrances.push({ id: `lot:${i}`, x: front.x, y: front.y, label: `🏡 빈 집터 ${i}번`, href: `lots:${i}` });
      }
    }
  });

  // 나무: 마을 가장자리 숲 + 군데군데. 길·광장·건물·내 정원 근처는 비운다
  const random = seeded(20261012);
  const keepOut: Rect[] = [
    { x: GARDEN.cx - GARDEN.rx - 40, y: GARDEN.cy - GARDEN.ry - 30, width: (GARDEN.rx + 40) * 2, height: GARDEN.ry * 2 + 120 },
    ...[...ROADS, ...GARDEN_APPROACH].map((r) => ({
      x: r.x - 20,
      y: r.y - 40,
      width: r.width + 40,
      height: r.height + 80,
    })),
    // 절벽 앞면과 그 위아래 가장자리
    ...CLIFF_LINES.map((line) => ({ x: 0, y: line - 24, width: WORLD.width, height: CLIFF_FACE + 48 })),
    {
      x: CENTER.x - PLAZA_RADIUS - 30,
      y: CENTER.y - PLAZA_RADIUS - 30,
      width: (PLAZA_RADIUS + 30) * 2,
      height: (PLAZA_RADIUS + 30) * 2,
    },
    ...structures.map((s) => {
      const { width, height } = artSize(s.art);
      return {
        x: s.x - width / 2 - 30,
        y: s.y - height - 10,
        width: width + 60,
        height: height + 110,
      };
    }),
  ];
  const treeArts = [treeArt(0), treeArt(1)];
  const trees: Structure[] = [];
  for (let tries = 0; tries < 900 && trees.length < 140; tries++) {
    const edge = tries % 3 !== 0;
    let x = random() * WORLD.width;
    let y = 60 + random() * (WORLD.height - 60);
    if (edge) {
      // 가장자리 띠 (120px)
      const side = Math.floor(random() * 4);
      if (side === 0) x = random() * 120;
      else if (side === 1) x = WORLD.width - random() * 120;
      else if (side === 2) y = 80 + random() * 120;
      else y = WORLD.height - random() * 60;
    }
    const spot = { x: x - 30, y: y - 20, width: 60, height: 24 };
    if (keepOut.some((k) => overlaps(spot, k)) || trees.some((t) => Math.hypot(t.x - x, t.y - y) < 46)) continue;
    trees.push({
      id: `tree:${trees.length}`,
      art: treeArts[trees.length % 2],
      x,
      y,
      body: { x: x - 10, y: y - 10, width: 20, height: 10 },
    });
  }
  structures.push(...trees);
  return { structures, entrances, walls: [...TERRAIN_WALLS, ...GARDEN_GATE_POSTS] };
}

/** ✨ 텔레포트 한 줄 (TOWN-12): 고르면 그 앞(`x`, `y`)으로. 빈 집터는 고를 수 없다 */
export type TownSpot = { id: string; label: string; sub: string | null; x: number; y: number; enabled: boolean; slug: string | null };

export const EMPTY_LOT_HINT = "친구 목록에서 ⭐를 누르면 집이 생겨요";

/**
 * 텔레포트 목록: `마을` 5곳(분수·게시판·상점·농장·낚시터) + 집 11자리. 게임과 같은 좌표(입구 앞)를 쓴다.
 * 빈 집터의 부제(⭐ 안내)는 회원에게만, 0번 자리는 없다.
 */
export function townSpots(houses: readonly TownHouseInput[], member: boolean): { places: TownSpot[]; houses: TownSpot[] } {
  const places: TownSpot[] = [
    { id: "fountain", label: "⛲ 광장 분수", sub: null, ...START_POS, enabled: true, slug: null },
    { id: "board", label: "📋 마을 게시판", sub: null, x: BOARD_POS.x, y: BOARD_POS.y + 30, enabled: true, slug: null },
    { id: "shop", label: "🏪 상점", sub: null, x: SHOP_POS.x + 40, y: SHOP_POS.y + 30, enabled: true, slug: null },
    { id: "farm", label: "🐮 동물 농장", sub: null, x: FARM_POS.x, y: FARM_POS.y + 30, enabled: true, slug: null },
    { id: "pond", label: "🎣 낚시터", sub: null, x: POND_POS.x, y: POND_POS.y + 30, enabled: true, slug: null },
  ];
  const lots = HOUSE_LOTS.map((_, i): TownSpot => {
    const house = houses.find((h) => h.lot === i);
    const front = lotFront(i);
    if (house) return { id: `house:${i}`, label: house.mine ? "🏠 내 집" : `🏠 ${shortName(house.nickname)}의 집`, sub: house.blogTitle, ...front, enabled: true, slug: house.slug };
    return { id: `lot:${i}`, label: i === 0 ? "내 집 자리" : "빈 집터", sub: i === 0 || !member ? null : EMPTY_LOT_HINT, ...front, enabled: false, slug: null };
  });
  return { places, houses: lots };
}
