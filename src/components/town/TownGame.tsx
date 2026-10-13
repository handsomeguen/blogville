"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { findArt } from "@/lib/art";
import { pixelRects, type PixelArt } from "@/lib/art/characters";
import { walkDir, walkFrame, WALK_DIRS, WALK_FPS, WALK_FRAMES, type ColorGrid, type WalkDir } from "@/lib/art/walk";
import { TOWN_CELL } from "@/lib/art/town";
import { GARDEN, HOUSE_LOTS, lotFront, PLAYER_SIZE, shortName, SPEED, WORLD, nearestEntrance, normalize, step, type Point } from "@/lib/town/layout";
import { createNpcs, NPC_TAG_DISTANCE, npcGraph, updateNpcs, type Npc } from "@/lib/town/npc";
import { artSize, artVisibleHeight, entrancePrompt, lotChoice, mailboxLot, townLayout, type TownEntrance, type TownHouseInput } from "@/lib/town/structures";
import { onStairs, STAIR_SLOW, stairEnds, STAIRS } from "@/lib/town/terrain";
import { bakeGround, GROUND_CELL } from "./ground";

/** 휴대폰에는 마을이 없다 (TOWN-01): 폭 640px 미만 */
export const PHONE_MEDIA = "(max-width: 639px)";

const MOVE_KEYS: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  KeyW: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
};

function subscribePhone(onChange: () => void) {
  const media = window.matchMedia(PHONE_MEDIA);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** 도트 그림을 칸 `scale`px짜리 캔버스로 한 번 굽는다 */
function bake(arts: readonly PixelArt[], scale: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = arts[0].rows[0].length * scale;
  canvas.height = arts[0].rows.length * scale;
  const ctx = canvas.getContext("2d")!;
  for (const art of arts) {
    for (const r of pixelRects(art)) {
      ctx.fillStyle = r.fill;
      ctx.fillRect(r.x * scale, r.y * scale, r.width * scale, scale);
    }
  }
  return canvas;
}

/** 색 칸(걷는 그림 한 칸)을 칸 `scale`px짜리 캔버스로 굽는다 */
function bakeGrid(grid: ColorGrid, scale: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = grid[0].length * scale;
  canvas.height = grid.length * scale;
  const ctx = canvas.getContext("2d")!;
  grid.forEach((row, y) =>
    row.forEach((color, x) => {
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }),
  );
  return canvas;
}

/** 키를 게임에 주지 않을 곳: 글자 칸, 그리고 버튼·링크 위의 Enter·Space (NF-18) */
function yieldsKey(event: KeyboardEvent): boolean {
  // 레벨업 팝업 같은 창이 열려 있으면 게임은 키보드를 쓰지 않는다
  if (document.querySelector("dialog[open]")) return true;
  // 브라우저·운영체제 단축키 (Alt+← 뒤로 가기, Ctrl+A 등)
  if (event.ctrlKey || event.metaKey || event.altKey) return true;
  const el = event.target as HTMLElement | null;
  if (!el || el === document.body) return false;
  if (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  if ((event.code === "Space" || event.code === "Enter") && el.closest("a,button,[role=button],dialog")) return true;
  return false;
}

function drawTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, bold: boolean, sub?: string) {
  ctx.font = `${bold ? "700" : "500"} 13px system-ui, sans-serif`;
  const width = Math.max(ctx.measureText(text).width, sub ? ((ctx.font = "500 11px system-ui, sans-serif"), ctx.measureText(sub).width) : 0) + 14;
  const height = sub ? 34 : 20;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - height, width, height, 6);
  ctx.fill();
  ctx.fillStyle = "#3b2a20";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${bold ? "700" : "500"} 13px system-ui, sans-serif`;
  ctx.fillText(text, x, y - height + 10);
  if (sub) {
    ctx.font = "500 11px system-ui, sans-serif";
    ctx.fillStyle = "#7a6a5a";
    ctx.fillText(sub, x, y - 10);
  }
}

/**
 * 마을 게임 (TOWN-01~04, specs/038-town): 캔버스 하나에 바닥·건물·집·나무·캐릭터를 그린다.
 * 방향키·WASD·클릭으로 걷고, 입구 앞에서 Space·Enter(또는 건물 클릭)로 들어간다.
 * 시험용으로 캔버스에 발 위치 `data-feet`를 적고, `bv-teleport` 이벤트(`{x, y}`)로 옮길 수 있다.
 * 우체통 입구는 페이지를 옮기지 않고 창 밖(window)에 `bv-mailbox` 이벤트(`{lot}`)를 보낸다 (TOWN-13, `TownHud`가 연다).
 * 내 마을(`chooseLots`)의 빈 집터는 `bv-lots` 이벤트(`{lot}`)로 자리 고르기 창을 연다 (TOWN-18).
 * 집이 선 이웃은 흙길을 걸어 다니고(TOWN-19), 누르면 그 집 우체통이 열린다. 시험 훅 `data-npcs`·`data-npc-walking`·`data-npc-at`.
 * 내 집(0번)과 농장은 동쪽 내 정원 안에 있고(TOWN-20), 정원 타원은 시험 훅 `data-garden`.
 */
export function TownGame({
  houses,
  member,
  layers,
  name,
  start,
  startKey,
  mailFlag = false,
  chooseLots = false,
  place = "마을",
}: {
  houses: TownHouseInput[];
  member: boolean;
  layers: string[];
  name: string;
  start: Point;
  /** 시작 자리를 고른 주소 값(`?at`). 같으면 다시 만들 때 서 있던 자리를 이어 쓴다 */
  startKey: string;
  /** 안 읽은 알림이 있으면 내 우체통 깃발을 올린다 */
  mailFlag?: boolean;
  /** 내 마을이면 빈 집터에서 이웃 집 자리를 고른다 (TOWN-18) */
  chooseLots?: boolean;
  /** 화면 낭독기 지도 이름 (친구 마을이면 `{닉네임}님의 마을`, TOWN-15) */
  place?: string;
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 즐겨찾기를 바꿔 집 목록이 다시 오면 게임을 다시 만들되 서 있던 자리는 그대로 (TOWN-12 친구 목록)
  const lastPos = useRef<{ from: string; pos: Point } | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [touch, setTouch] = useState(false);
  const data = JSON.stringify({ houses, member, layers, name, start, startKey, mailFlag, chooseLots });
  // 창 폭이 휴대폰 조건을 넘나들면 게임을 끄고 다시 만든다
  const phone = useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_MEDIA).matches,
    () => false,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || phone) return;
    const { houses, member, layers, name, start, startKey, mailFlag, chooseLots } = JSON.parse(data) as {
      mailFlag: boolean;
      chooseLots: boolean;
      houses: TownHouseInput[];
      member: boolean;
      layers: string[];
      name: string;
      start: Point;
      startKey: string;
    };
    setTouch(window.matchMedia("(pointer: coarse)").matches);
    const ctx = canvas.getContext("2d")!;
    const { structures, entrances, walls } = townLayout(houses, member, mailFlag, chooseLots);
    const bodies = [...walls, ...structures.flatMap((s) => (s.body ? [s.body] : []))];
    const sprites = new Map<object, HTMLCanvasElement>();
    for (const s of structures) if (!sprites.has(s.art)) sprites.set(s.art, bake([s.art], TOWN_CELL));
    // 걷는 그림 (TOWN-17): 방향마다 서 있기 + 걷기 4칸
    const bakeSheet = (keys: readonly string[]) => {
      const arts = keys.map(findArt).filter((a): a is PixelArt => a !== undefined);
      const sheet = new Map<string, HTMLCanvasElement>();
      if (arts.length > 0) {
        for (const d of WALK_DIRS) for (let f = 0; f <= WALK_FRAMES; f++) sheet.set(`${d}:${f}`, bakeGrid(walkFrame(arts, d, f), PLAYER_SIZE / 16));
      }
      return sheet;
    };
    const walkSheet = bakeSheet(layers);

    // 걸어 다니는 이웃 (TOWN-19): 집이 선 이웃(1~10번)이 흙길을 걷는다. 내 집(0번) 앞과 내 정원(TOWN-20)에는 오지 않는다
    const graph = npcGraph(bodies, lotFront(0), HOUSE_LOTS.map((_, i) => lotFront(i)));
    const npcs = createNpcs(
      graph,
      houses.filter((h) => h.lot > 0),
      Math.random,
    );
    const npcSheets = new Map<number, Map<string, HTMLCanvasElement>>();
    for (const h of houses) if (h.lot > 0) npcSheets.set(h.lot, bakeSheet(h.layers && h.layers.length > 0 ? h.layers : ["char.visitor"]));
    const npcTime = new Map<number, number>();
    canvas.dataset.npcs = String(npcs.length);
    // 마우스가 올라간 곳 (이웃 이름표)
    let hover: Point | null = null;
    const npcAt = (p: Point): Npc | undefined =>
      npcs.find((n) => Math.abs(p.x - n.pos.x) <= 22 && p.y >= n.pos.y - PLAYER_SIZE + 8 && p.y <= n.pos.y + 4);
    const ground = bakeGround();

    // 시작 자리(?at)가 바뀌었으면 새 자리에서. 환영(?welcome)을 주소에서 지운 뒤 다시 그려도 자리는 그대로
    const from = startKey;
    let pos: Point = lastPos.current?.from === from ? lastPos.current.pos : { ...start };
    let target: Point | null = null;
    let enterNext = false;
    let facing: WalkDir = "down";
    let walking = false;
    let walkTime = 0;
    let shown: string | null = null;
    let stuck = 0;
    const held = new Set<string>();
    const camera = { x: 0, y: 0 };

    const go = (e: TownEntrance) => {
      const lot = mailboxLot(e.href);
      const choice = lotChoice(e.href);
      if (lot !== null) window.dispatchEvent(new CustomEvent("bv-mailbox", { detail: { lot } }));
      else if (choice !== null) window.dispatchEvent(new CustomEvent("bv-lots", { detail: { lot: choice } }));
      else router.push(e.href === "login" ? "/" : e.href);
    };

    // 화면 배율(devicePixelRatio)만큼 캔버스를 키워 고해상도 화면에서도 또렷하게. 그리는 좌표는 CSS px
    let dpr = 1;
    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const onKeyDown = (event: KeyboardEvent) => {
      // 게임이 보이지 않으면(휴대폰 폭으로 줄인 사이) 키를 가져가지 않는다
      if (canvas.clientWidth === 0 || yieldsKey(event)) return;
      if (MOVE_KEYS[event.code]) {
        held.add(event.code);
        target = null;
        event.preventDefault();
      } else if (event.code === "Space" || event.code === "Enter") {
        enterNext = true;
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      // Cmd를 누른 동안에는 다른 키를 뗀 신호가 오지 않아(macOS) Cmd를 떼면 모두 비운다
      if (event.key === "Meta") held.clear();
      else held.delete(event.code);
    };
    const onBlur = () => held.clear();
    const toWorld = (event: PointerEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: event.clientX - rect.left + camera.x,
        y: event.clientY - rect.top + camera.y,
      };
    };
    const onPointer = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const p = toWorld(event);
      // 걷는 이웃을 누르면 그 집 우체통 (TOWN-19)
      const npc = npcAt(p);
      if (npc) {
        fromNpc(npc.lot);
        return;
      }
      // 건물·집을 눌렀으면 그 입구로 (가까우면 바로 들어간다)
      const hit = structures.find((s) => {
        const { width, height } = artSize(s.art);
        return p.x >= s.x - width / 2 && p.x <= s.x + width / 2 && p.y >= s.y - height && p.y <= s.y;
      });
      const door = hit && entrances.filter((e) => e.id === hit.id || (hit.id === "board" && (e.id === "feed" || e.id === "attendance")));
      if (door && door.length > 0) {
        const e = door.length === 1 ? door[0] : p.x < hit.x ? door[0] : door[1];
        if (Math.hypot(e.x - pos.x, e.y - pos.y) <= 90) return go(e);
        target = { x: e.x, y: e.y };
      } else {
        target = p;
      }
    };
    const fromNpc = (lot: number) => window.dispatchEvent(new CustomEvent("bv-mailbox", { detail: { lot } }));
    const onHover = (event: PointerEvent) => {
      hover = toWorld(event);
      canvas.style.cursor = npcAt(hover) ? "pointer" : "";
    };
    const onLeave = () => {
      hover = null;
    };
    const onTeleport = (event: Event) => {
      const { x, y } = (event as CustomEvent<Point>).detail;
      pos = { x, y };
      target = null;
    };
    // 헤더 🏘 마을 링크에 포커스가 남아 있으면 Space·Enter가 그 링크로 가므로 놓아 준다
    if (document.activeElement instanceof HTMLElement && !document.activeElement.closest("[data-town]")) document.activeElement.blur();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    canvas.addEventListener("pointerdown", onPointer);
    canvas.addEventListener("pointermove", onHover);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("bv-teleport", onTeleport);

    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // 움직이기: 키보드가 클릭 목표보다 먼저
      let dx = 0;
      let dy = 0;
      for (const code of held) {
        dx += MOVE_KEYS[code].x;
        dy += MOVE_KEYS[code].y;
      }
      if (dx === 0 && dy === 0 && target) {
        if (Math.hypot(target.x - pos.x, target.y - pos.y) < 4) target = null;
        else {
          dx = target.x - pos.x;
          dy = target.y - pos.y;
        }
      }
      const dir = normalize(dx, dy);
      const moving = dir.x !== 0 || dir.y !== 0;
      if (moving) {
        // 계단에서는 조금 느리게 (TOWN-05)
        const speed = onStairs(pos) ? SPEED * STAIR_SLOW : SPEED;
        const next = step(pos, { x: dir.x * speed * dt, y: dir.y * speed * dt }, bodies);
        // 클릭 목표로 가다 막히면 멈춘다
        stuck = Math.hypot(next.x - pos.x, next.y - pos.y) < 0.5 ? stuck + dt : 0;
        if (stuck > 0.25) target = null;
        facing = walkDir(dir.x, dir.y, facing);
        // 벽에 막혀 제자리면 걷지 않는다
        walking = Math.hypot(next.x - pos.x, next.y - pos.y) > 0.01;
        pos = next;
        if (walking) walkTime += dt;
      } else {
        walking = false;
        walkTime = 0;
      }
      updateNpcs(npcs, graph, dt, Math.random);
      for (const n of npcs) npcTime.set(n.lot, n.walking ? (npcTime.get(n.lot) ?? 0) + dt : 0);
      const pose = `${walking ? "walk" : "idle"}-${facing}`;
      if (canvas.dataset.walk !== pose) canvas.dataset.walk = pose;

      // 입구 안내, 그리고 Space·Enter (멀리서 누른 것은 버린다)
      const near = nearestEntrance(pos, entrances);
      const text = near ? entrancePrompt(near) : null;
      if (text !== shown) {
        shown = text;
        setPrompt(text);
      }
      if (enterNext) {
        enterNext = false;
        if (near) go(near);
      }

      // 카메라
      const vw = canvas.clientWidth;
      const vh = canvas.clientHeight;
      camera.x = vw >= WORLD.width ? (WORLD.width - vw) / 2 : Math.min(Math.max(pos.x - vw / 2, 0), WORLD.width - vw);
      camera.y = vh >= WORLD.height ? (WORLD.height - vh) / 2 : Math.min(Math.max(pos.y - vh / 2, 0), WORLD.height - vh);
      camera.x = Math.round(camera.x);
      camera.y = Math.round(camera.y);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#5fa34f";
      ctx.fillRect(0, 0, vw, vh);
      ctx.drawImage(ground, camera.x / GROUND_CELL, camera.y / GROUND_CELL, vw / GROUND_CELL, vh / GROUND_CELL, 0, 0, vw, vh);

      // 아랫변 y 순서로 그린다 (앞에 있는 것이 위에)
      type Item = { y: number; draw: () => void };
      const items: Item[] = [];
      for (const s of structures) {
        const { width, height } = artSize(s.art);
        const left = s.x - width / 2 - camera.x;
        const top = s.y - height - camera.y;
        if (left > vw || top > vh || left + width < 0 || top + height + 40 < 0) continue;
        items.push({
          y: s.y,
          draw: () => {
            ctx.fillStyle = "rgba(0,0,0,0.12)";
            ctx.beginPath();
            ctx.ellipse(left + width / 2, top + height - 2, width * 0.42, 8, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.drawImage(sprites.get(s.art)!, Math.round(left), Math.round(top));
          },
        });
      }
      const walkStep = walking ? 1 + (Math.floor(walkTime * WALK_FPS) % WALK_FRAMES) : 0;
      const sprite = walkSheet.get(`${facing}:${walkStep}`);
      items.push({
        y: pos.y + 8,
        draw: () => {
          const px = Math.round(pos.x - camera.x);
          const py = Math.round(pos.y - camera.y);
          ctx.fillStyle = "rgba(0,0,0,0.18)";
          ctx.beginPath();
          ctx.ellipse(px, py, 16, 6, 0, 0, Math.PI * 2);
          ctx.fill();
          if (sprite) ctx.drawImage(sprite, px - PLAYER_SIZE / 2, py - PLAYER_SIZE + 4);
        },
      });
      for (const n of npcs) {
        const nx = Math.round(n.pos.x - camera.x);
        const ny = Math.round(n.pos.y - camera.y);
        if (nx < -40 || nx > vw + 40 || ny < -10 || ny > vh + PLAYER_SIZE) continue;
        const frameNo = n.walking ? 1 + (Math.floor((npcTime.get(n.lot) ?? 0) * WALK_FPS) % WALK_FRAMES) : 0;
        const look = npcSheets.get(n.lot)?.get(`${n.facing}:${frameNo}`);
        items.push({
          y: n.pos.y + 8,
          draw: () => {
            ctx.fillStyle = "rgba(0,0,0,0.18)";
            ctx.beginPath();
            ctx.ellipse(nx, ny, 16, 6, 0, 0, Math.PI * 2);
            ctx.fill();
            if (look) ctx.drawImage(look, nx - PLAYER_SIZE / 2, ny - PLAYER_SIZE + 4);
          },
        });
      }
      items.sort((a, b) => a.y - b.y);
      for (const item of items) item.draw();
      // 이름표는 맨 위에
      for (const s of structures) {
        if (!s.label) continue;
        const height = artVisibleHeight(s.art);
        const x = s.x - camera.x;
        const y = s.y - height - camera.y - 4;
        if (x < -150 || x > vw + 150 || y < -20 || y > vh + 60) continue;
        drawTag(ctx, s.label, x, y, s.id === "house:0", s.sub);
      }
      // 이웃 이름표: 가까이 가거나 마우스를 올렸을 때만
      const hovered = hover ? npcAt(hover) : undefined;
      for (const n of npcs) {
        if (n !== hovered && Math.hypot(n.pos.x - pos.x, n.pos.y - pos.y) > NPC_TAG_DISTANCE) continue;
        drawTag(ctx, shortName(n.name), n.pos.x - camera.x, n.pos.y - camera.y - PLAYER_SIZE, false);
      }
      drawTag(ctx, name, pos.x - camera.x, pos.y - camera.y - PLAYER_SIZE, true);
      lastPos.current = { from, pos };
      if (frame++ % 3 === 0) {
        canvas.dataset.feet = `${Math.round(pos.x)},${Math.round(pos.y)}`;
        // 시험 훅: 지금 걷는 이웃 수, 화면에 보이는 이웃의 자리 번호와 몸 가운데 (캔버스 안 좌표)
        canvas.dataset.npcWalking = String(npcs.filter((n) => n.walking).length);
        canvas.dataset.npcAt = npcs
          .map((n) => ({ lot: n.lot, x: Math.round(n.pos.x - camera.x), y: Math.round(n.pos.y - camera.y - PLAYER_SIZE / 2) }))
          .filter((n) => n.x > 0 && n.x < vw && n.y > 0 && n.y < vh)
          .map((n) => `${n.lot}:${n.x},${n.y}`)
          .join(" ");
      }
      raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);
    canvas.dataset.ready = "1";
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      canvas.removeEventListener("pointerdown", onPointer);
      canvas.removeEventListener("pointermove", onHover);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("bv-teleport", onTeleport);
      delete canvas.dataset.ready;
    };
  }, [data, phone, router]);

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none select-none"
        aria-label={`${place} 지도. 방향키로 걷고 Space로 들어가요`}
        data-feet={`${start.x},${start.y}`}
        // 시험 훅: 집 자리마다 지붕 색 (TOWN-07)
        data-roofs={houses.map((h) => `${h.lot}:${h.roof}`).join(" ")}
        data-mail-flag={mailFlag ? "1" : "0"}
        // 시험 훅: 내 정원 타원 `가운데x,가운데y,가로 반지름,세로 반지름` (TOWN-20)
        data-garden={`${GARDEN.cx},${GARDEN.cy},${GARDEN.rx},${GARDEN.ry}`}
        // 시험 훅: 계단마다 `위x,위y,아래x,아래y` (TOWN-05, 마지막은 정원 계단)
        data-stairs={STAIRS.map((st) => {
          const { top, bottom } = stairEnds(st);
          return `${top.x},${top.y},${bottom.x},${bottom.y}`;
        }).join(" ")}
      />
      <p
        role="status"
        className={`pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-sm font-semibold text-white ${prompt ? "" : "hidden"}`}
        data-town-prompt
      >
        {prompt}
      </p>
      <p className="pointer-events-none absolute bottom-3 right-3 rounded-lg bg-white/85 px-3 py-1.5 text-xs text-[#5a4a3a]" data-town-hint>
        {touch ? "탭으로 이동 · 건물을 탭해서 들어가기" : "방향키·WASD 또는 클릭으로 이동 · 건물 앞에서 Space로 들어가기"}
      </p>
    </div>
  );
}
