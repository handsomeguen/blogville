// 마을 바닥 (TOWN-02·05·20): 잔디·흙길·돌광장·내 정원·절벽 앞면·계단·먼 하늘을 도트(칸 4px)로 한 번만 굽는다. 브라우저에서만 부른다.
import { CENTER, GARDEN, GARDEN_APPROACH, GARDEN_BEDS, gardenEdge, GARDEN_PATHS, inGarden, PLAZA_RADIUS, ROADS, WORLD } from "@/lib/town/layout";
import { CLIFF_FACE, CLIFF_LINES, GARDEN_RIM, RAIL, SKY_HEIGHT, STAIRS } from "@/lib/town/terrain";

export const GROUND_CELL = 4;

export function bakeGround(): HTMLCanvasElement {
  const w = WORLD.width / GROUND_CELL;
  const h = WORLD.height / GROUND_CELL;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  // 잔디: 높은 단일수록 밝게 (북쪽 언덕 · 가운데 · 남쪽 들판)
  const c = (v: number) => Math.round(v / GROUND_CELL);
  const [north, south] = CLIFF_LINES.map(c);
  ctx.fillStyle = "#86cc72";
  ctx.fillRect(0, 0, w, north);
  ctx.fillStyle = "#7cc46a";
  ctx.fillRect(0, north, w, south - north);
  ctx.fillStyle = "#72b961";
  ctx.fillRect(0, south, w, h - south);
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const dots = ["#6db35c", "#8fd27c", "#6db35c", "#5fa34f"];
  for (let i = 0; i < (w * h) / 9; i++) {
    ctx.fillStyle = dots[i % dots.length];
    ctx.fillRect(Math.floor(random() * w), Math.floor(random() * h), 1, 1);
  }
  const flowers = ["#ffffff", "#ffd166", "#ff8fab", "#b39ddb"];
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = flowers[i % flowers.length];
    ctx.fillRect(Math.floor(random() * w), Math.floor(random() * h), 1, 1);
  }
  // 흙길: 테두리 한 칸 진하게 (정원 가는 길도 같은 흙길)
  const dirt = [...ROADS, ...GARDEN_APPROACH];
  ctx.fillStyle = "#b8925f";
  for (const r of dirt) ctx.fillRect(c(r.x) - 1, c(r.y) - 1, c(r.width) + 2, c(r.height) + 2);
  ctx.fillStyle = "#d9b98a";
  for (const r of dirt) ctx.fillRect(c(r.x), c(r.y), c(r.width), c(r.height));
  ctx.fillStyle = "#cfae7d";
  for (let i = 0; i < 1400; i++) {
    const r = dirt[i % dirt.length];
    ctx.fillRect(c(r.x) + Math.floor(random() * c(r.width)), c(r.y) + Math.floor(random() * c(r.height)), 1, 1);
  }
  // 돌광장: 원 안을 돌 타일로
  const cx = c(CENTER.x);
  const cy = c(CENTER.y);
  const radius = c(PLAZA_RADIUS);
  for (let y = -radius - 1; y <= radius + 1; y++) {
    for (let x = -radius - 1; x <= radius + 1; x++) {
      const d = Math.hypot(x, y);
      if (d > radius + 1) continue;
      if (d > radius) ctx.fillStyle = "#9c9486";
      else if ((x + 200) % 8 === 0 || (y + 200) % 6 === 0) ctx.fillStyle = "#c2baab";
      else ctx.fillStyle = (Math.floor((x + 200) / 8) + Math.floor((y + 200) / 6)) % 2 === 0 ? "#ddd6c8" : "#d4ccbd";
      ctx.fillRect(cx + x, cy + y, 1, 1);
    }
  }
  drawGarden(ctx, c, random);
  drawCliffs(ctx, w, c);
  drawSky(ctx, w, c(SKY_HEIGHT));
  // 대기 원근: 북쪽(먼 곳)일수록 하늘빛을 섞는다
  const air = ctx.createLinearGradient(0, 0, 0, c(900));
  air.addColorStop(0, "rgba(214, 233, 255, 0.28)");
  air.addColorStop(1, "rgba(214, 233, 255, 0)");
  ctx.fillStyle = air;
  ctx.fillRect(0, 0, w, c(900));
  return canvas;
}

/**
 * 내 정원 (TOWN-20): 깎은 줄무늬 잔디, 뒤 덤불 줄, 돌길, 꽃밭, 뒤·옆 낮은 돌 테, 앞 다듬은 돌 축대(큰 돌을 엇갈려 쌓음).
 * 계단은 `drawCliffs`가 그 위에 그린다.
 */
function drawGarden(ctx: CanvasRenderingContext2D, c: (v: number) => number, random: () => number) {
  const C = GROUND_CELL;
  const x0 = c(GARDEN.cx - GARDEN.rx) - 2;
  const x1 = c(GARDEN.cx + GARDEN.rx) + 2;
  // 잔디: 세로 줄무늬 (6칸마다 밝게·어둡게)
  for (let y = c(GARDEN.cy - GARDEN.ry) - 2; y <= c(GARDEN.cy + GARDEN.ry) + 2; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inGarden({ x: x * C + C / 2, y: y * C + C / 2 })) continue;
      const stripe = Math.floor((x - x0) / 6) % 2 === 0;
      ctx.fillStyle = stripe ? "#93d77e" : "#84ca70";
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // 뒤 덤불 줄: 돌 테 바로 안쪽에 둥근 덤불
  for (let x = GARDEN.cx - GARDEN.rx * 0.82; x <= GARDEN.cx + GARDEN.rx * 0.82; x += 22) {
    const top = c(gardenEdge(x)!.top + GARDEN_RIM + 10);
    const bx = c(x);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if ((dx * dx) / 20 + (dy * dy) / 10 > 1) continue;
        ctx.fillStyle = dy > 1 ? "#2f6e2c" : (dx + dy) % 3 === 0 ? "#4f9a45" : "#3d8237";
        ctx.fillRect(bx + dx, top + dy, 1, 1);
      }
    }
  }
  // 돌길 (넓적한 판돌, 줄눈)
  for (const r of GARDEN_PATHS) {
    for (let y = c(r.y); y < c(r.y + r.height); y++) {
      for (let x = c(r.x); x < c(r.x + r.width); x++) {
        ctx.fillStyle = (x % 5 === 0 || y % 4 === 0) && (x + y) % 2 === 0 ? "#c9bea6" : (x * 3 + y * 7) % 13 === 0 ? "#ddd3bd" : "#e8e0cc";
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  // 꽃밭: 흙 테두리 안에 빨강·분홍·노랑·흰 꽃과 잎
  const petals = ["#e0414f", "#ff9fb8", "#ffd166", "#ffffff", "#b39ddb"];
  for (const bed of GARDEN_BEDS) {
    const [bx, by, bw, bh] = [c(bed.x), c(bed.y), c(bed.width), c(bed.height)];
    ctx.fillStyle = "#7a5230";
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = "#94643a";
    ctx.fillRect(bx, by, bw, bh);
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) {
        if ((x + y * 2) % 3 === 0) {
          ctx.fillStyle = "#4f9a45";
          ctx.fillRect(x, y, 1, 1);
        } else if (random() < 0.3) {
          ctx.fillStyle = petals[Math.floor(random() * petals.length)];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }
  // 둘레: 뒤·옆은 낮은 돌 테 (가장자리 띠), 앞은 축대 윗돌
  for (let y = c(GARDEN.cy - GARDEN.ry) - 3; y <= c(GARDEN.cy + GARDEN.ry) + 3; y++) {
    for (let x = x0 - 2; x <= x1 + 2; x++) {
      const p = { x: x * C + C / 2, y: y * C + C / 2 };
      if (!inGarden(p, GARDEN_RIM) || inGarden(p, -GARDEN_RIM)) continue;
      if (p.y < GARDEN.cy) ctx.fillStyle = inGarden(p) ? ((x + y) % 4 === 0 ? "#8e8370" : "#a39883") : "#b7ad98";
      else ctx.fillStyle = "#ddd3bd";
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // 앞 다듬은 돌 축대: 아래 가장자리에서 `CLIFF_FACE`만큼, 큰 돌을 엇갈려 쌓는다
  const face = c(CLIFF_FACE);
  for (let x = x0; x <= x1; x++) {
    const edge = gardenEdge(x * C + C / 2);
    if (!edge) continue;
    const bottom = c(edge.bottom) + 1;
    for (let y = 0; y < face; y++) {
      const course = Math.floor(y / 4);
      const joint = y % 4 === 3 || (x + (course % 2) * 4) % 8 === 0;
      ctx.fillStyle = joint ? "#8e8370" : y === 0 ? "#d6ccb5" : (x * 5 + course * 11) % 9 === 0 ? "#bdb29b" : "#c8bea8";
      ctx.fillRect(x, bottom + y, 1, 1);
    }
    ctx.fillStyle = "#6e6455";
    ctx.fillRect(x, bottom + face - 1, 1, 1);
    ctx.fillStyle = "rgba(40, 60, 30, 0.25)";
    ctx.fillRect(x, bottom + face, 1, 2);
  }
}

/** 절벽 앞면(돌벽)과 계단 (TOWN-05). 앞면은 높은 단 가장자리에서 아래로 `CLIFF_FACE` */
function drawCliffs(ctx: CanvasRenderingContext2D, w: number, c: (v: number) => number) {
  const face = c(CLIFF_FACE);
  for (const line of CLIFF_LINES) {
    const top = c(line);
    // 가장자리 풀 한 줄, 돌벽(줄눈은 엇갈려), 아래 그림자
    ctx.fillStyle = "#5c9a4c";
    ctx.fillRect(0, top - 1, w, 1);
    for (let y = 0; y < face; y++) {
      const course = Math.floor(y / 3);
      for (let x = 0; x < w; x++) {
        const joint = y % 3 === 2 || (x + (course % 2) * 3) % 6 === 0;
        ctx.fillStyle = joint ? "#7d7262" : y < 1 ? "#b3a890" : (x * 7 + course * 13) % 11 === 0 ? "#a39782" : "#9b8f7c";
        ctx.fillRect(x, top + y, 1, 1);
      }
    }
    ctx.fillStyle = "#5f574b";
    ctx.fillRect(0, top + face - 1, w, 1);
    ctx.fillStyle = "rgba(40, 60, 30, 0.25)";
    ctx.fillRect(0, top + face, w, 2);
  }
  // 계단: 디딤돌 두 줄씩 밝게·어둡게, 양쪽 돌 난간
  for (const s of STAIRS) {
    const x = c(s.rect.x);
    const y = c(s.rect.y);
    const sw = c(s.rect.width);
    const rail = Math.max(1, c(RAIL));
    for (let r = -1; r < face; r++) {
      ctx.fillStyle = r < 0 ? "#cbbd9f" : r % 3 === 0 ? "#8f826b" : r % 3 === 1 ? "#d6c9ab" : "#bcae90";
      ctx.fillRect(x + rail, y + r, sw - rail * 2, 1);
    }
    ctx.fillStyle = "#6e6455";
    ctx.fillRect(x, y - 1, rail, face + 1);
    ctx.fillRect(x + sw - rail, y - 1, rail, face + 1);
  }
}

/** 맨 위 먼 하늘과 산 (걸을 수 없는 띠) */
function drawSky(ctx: CanvasRenderingContext2D, w: number, sky: number) {
  const g = ctx.createLinearGradient(0, 0, 0, sky);
  g.addColorStop(0, "#a9d8ff");
  g.addColorStop(1, "#e2f2ff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, sky);
  // 먼 산 (푸른빛), 가까운 숲 (진한 초록) 실루엣
  for (const [base, amp, period, color] of [
    [sky - 6, 9, 61, "#a7bfd6"],
    [sky - 2, 5, 23, "#6f9f6a"],
  ] as const) {
    ctx.fillStyle = color;
    for (let x = 0; x < w; x++) {
      const peak = Math.round(amp * (0.6 + 0.4 * Math.sin((x / period) * Math.PI * 2) * Math.cos((x / (period * 2.3)) * Math.PI)));
      ctx.fillRect(x, base - peak, 1, sky - (base - peak));
    }
  }
}
