import { expect, test, type Page } from "./fixtures";
import { signUpOk, sql } from "./helpers";

// 마을 (TOWN-01~04), specs/038-town. 게임은 캔버스라 발 위치(`data-feet`)·입구 안내·`bv-teleport`로 본다.
test.describe.configure({ timeout: 90_000 });

const canvas = (page: Page) => page.locator("[data-town] canvas");
const prompt = (page: Page) => page.locator("[data-town-prompt]");
const feet = async (page: Page) => (await canvas(page).getAttribute("data-feet"))!.split(",").map(Number) as [number, number];
/** 발이 내 정원 타원 안인가 (`data-garden`, TOWN-20) */
const inGarden = async (page: Page, [x, y]: number[]) => {
  const [cx, cy, rx, ry] = (await canvas(page).getAttribute("data-garden"))!.split(",").map(Number);
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
};
const teleport = (page: Page, x: number, y: number) =>
  canvas(page).evaluate((c, d) => c.dispatchEvent(new CustomEvent("bv-teleport", { detail: d })), { x, y });
async function openTown(page: Page, url = "/town") {
  await page.goto(url);
  await expect(canvas(page)).toHaveAttribute("data-ready", "1");
}

test.describe("TOWN 마을", () => {
  test("방문자: 분수 아래에서 시작, 회색 주민, 상점·출석은 로그인 안내라 Space로 첫 화면, 마을 소식은 들어간다", async ({ page }) => {
    await openTown(page);
    await expect(page.getByRole("heading", { name: "중앙 광장" })).toBeAttached();
    await expect(page.locator("[data-town-hint]")).toHaveText("방향키·WASD 또는 클릭으로 이동 · 건물 앞에서 Space로 들어가기");
    expect(await feet(page)).toEqual([1050, 960]);
    await expect(prompt(page)).toBeHidden();
    // 멀리서 누른 Space는 버린다
    await page.keyboard.press("Space");
    await page.waitForTimeout(300);
    await expect(page).toHaveURL("/town");

    await teleport(page, 1400, 810);
    await expect(prompt(page)).toHaveText("🏪 상점 · Space 로그인하고 이용하기");
    await page.keyboard.press("Space");
    await expect(page).toHaveURL("/");

    await openTown(page);
    await teleport(page, 1060, 540);
    await expect(prompt(page)).toHaveText("📮 출석 체크 · Space 로그인하고 이용하기");
    await teleport(page, 940, 540);
    await expect(prompt(page)).toHaveText("📋 마을 소식 · Space 들어가기");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/feed");
  });

  test("방향키·WASD로 걷고 분수에 막힌다, 땅을 클릭하면 그쪽으로 걸어간다", async ({ page }) => {
    await openTown(page);
    const [x0, y0] = await feet(page);
    await page.keyboard.down("KeyA");
    await page.waitForTimeout(500);
    await page.keyboard.up("KeyA");
    await expect.poll(async () => (await feet(page))[0]).toBeLessThan(x0 - 40);
    // 위로 가면 분수(아랫변 840)에 막힌다
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(1200);
    await page.keyboard.up("ArrowUp");
    await expect.poll(async () => (await feet(page))[1]).toBeLessThan(y0);
    // 분수 바로 아래에서 위로 가면 분수 아랫변(840)에서 발(16px)만큼 아래에 멈춘다
    await teleport(page, 1000, 900);
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(800);
    await page.keyboard.up("ArrowUp");
    await expect.poll(async () => (await feet(page))[1]).toBeLessThan(864);
    expect((await feet(page))[1]).toBeGreaterThanOrEqual(856);

    // 캔버스 오른쪽 아래를 누르면 그쪽으로
    const before = await feet(page);
    const box = (await canvas(page).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2 + 150, box.y + box.height / 2 + 100);
    await expect.poll(async () => (await feet(page))[0], { timeout: 5000 }).toBeGreaterThan(before[0] + 60);
  });

  test("걷는 그림: 걷는 방향의 걷기 칸, 멈추면 그 방향으로 서 있고, 벽에 막혀 제자리면 걷지 않는다 (TOWN-17)", async ({ page }) => {
    await openTown(page);
    await expect(canvas(page)).toHaveAttribute("data-walk", "idle-down");
    await page.keyboard.down("ArrowLeft");
    await expect(canvas(page)).toHaveAttribute("data-walk", "walk-left");
    await page.keyboard.up("ArrowLeft");
    await expect(canvas(page)).toHaveAttribute("data-walk", "idle-left");
    await page.keyboard.down("ArrowDown");
    await expect(canvas(page)).toHaveAttribute("data-walk", "walk-down");
    await page.keyboard.up("ArrowDown");
    await expect(canvas(page)).toHaveAttribute("data-walk", "idle-down");
    // 분수 바로 아래에서 위로 밀면 막혀 서 있는 그림(뒷모습)
    await teleport(page, 1000, 857);
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(400);
    await expect(canvas(page)).toHaveAttribute("data-walk", "idle-up");
    await page.keyboard.up("ArrowUp");
  });

  test("높낮이: 절벽 앞면·정원 축대는 막히고 계단 4곳 + 정원 계단으로만 오르내린다 (TOWN-05·20)", async ({ page }) => {
    await openTown(page);
    const stairs = (await canvas(page).getAttribute("data-stairs"))!.split(" ").map((s) => s.split(",").map(Number));
    expect(stairs).toHaveLength(5);
    const hold = async (key: string, ms: number) => {
      await page.keyboard.down(key);
      await page.waitForTimeout(ms);
      await page.keyboard.up(key);
    };
    for (const [tx, ty, bx, by] of stairs) {
      await teleport(page, bx, by);
      await expect.poll(async () => (await feet(page))[1]).toBe(by);
      await hold("ArrowUp", 700);
      await expect.poll(async () => (await feet(page))[1]).toBeLessThanOrEqual(ty);
      expect(Math.abs((await feet(page))[0] - tx)).toBeLessThan(2);
      await teleport(page, tx, ty);
      await hold("ArrowDown", 700);
      await expect.poll(async () => (await feet(page))[1]).toBeGreaterThanOrEqual(by);
      // 계단 옆(앞면)으로는 못 올라간다: 앞면 아래에 멈춘다
      await teleport(page, tx + 200, by);
      await expect.poll(async () => (await feet(page))[0]).toBe(tx + 200);
      await hold("ArrowUp", 600);
      await page.waitForTimeout(100);
      // 정원 축대는 둥글어서 옆쪽 앞면이 계단 꼭대기보다 조금 위에서 끝난다
      expect((await feet(page))[1]).toBeGreaterThan(ty + 20);
    }
    // 정원 계단을 오르면 아치 문을 지나 정원 안
    const [gx, gy] = stairs[4];
    await teleport(page, gx, gy);
    await hold("ArrowUp", 400);
    expect(await inGarden(page, await feet(page))).toBe(true);
  });

  test("내 정원: 옆·뒤 돌 테로는 못 들어가고, 정원 안에서 집 앞·농장 앞으로 간다 (TOWN-20)", async ({ page }) => {
    await openTown(page);
    const [cx, cy, rx, ry] = (await canvas(page).getAttribute("data-garden"))!.split(",").map(Number);
    const hold = async (key: string, ms: number) => {
      await page.keyboard.down(key);
      await page.waitForTimeout(ms);
      await page.keyboard.up(key);
    };
    // 서쪽 옆에서 동쪽으로 밀면 돌 테에 막힌다
    await teleport(page, cx - rx - 60, cy + 10);
    await expect.poll(async () => (await feet(page))[0]).toBe(cx - rx - 60);
    await hold("ArrowRight", 700);
    expect(await inGarden(page, await feet(page))).toBe(false);
    // 뒤(북쪽)에서 남쪽으로 밀어도 막힌다
    await teleport(page, cx + 120, cy - ry - 40);
    await expect.poll(async () => (await feet(page))[1]).toBe(cy - ry - 40);
    await hold("ArrowDown", 700);
    expect(await inGarden(page, await feet(page))).toBe(false);
    // 아치 문 안쪽에서 위로 가면 집 앞·농장 앞 길
    await teleport(page, cx, cy + ry - 10);
    await hold("ArrowUp", 600);
    expect(await inGarden(page, await feet(page))).toBe(true);
    await teleport(page, 2150, 770);
    await expect(prompt(page)).toHaveText("🐮 동물 농장 · Space 로그인하고 이용하기");
  });

  test("회원: 블로그 🚪 밖으로 → 내 집 앞, Enter로 다시 블로그. 즐겨찾는 이웃의 집이 1번 자리에 서고 들어가면 그 블로그", async ({ page, browser }) => {
    const username = await signUpOk(page);
    const other = await browser.newPage();
    const neighbor = await signUpOk(other);
    await other.close();
    await sql`insert into follows (follower_id, followee_id, is_favorite)
      select a.id, b.id, true from users a, users b where a.username = ${username} and b.username = ${neighbor}`;

    await page.goto(`/@${username}`);
    const door = page.getByRole("link", { name: "🚪 밖으로" });
    await expect(door).toHaveAttribute("href", `/town?at=${username}`);
    await door.click();
    await expect(canvas(page)).toHaveAttribute("data-ready", "1");
    // 내 집은 동쪽 내 정원 안 (TOWN-20)
    expect(await feet(page)).toEqual([1870, 770]);
    expect(await inGarden(page, await feet(page))).toBe(true);
    await expect(prompt(page)).toHaveText("🏠 내 집 · Space 들어가기");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/@${username}`);

    await openTown(page, `/town?at=${neighbor}`);
    expect(await feet(page)).toEqual([300, 420]);
    await expect(prompt(page)).toHaveText(`🏠 ${neighbor.slice(0, 12)}${[...neighbor].length > 12 ? "…" : ""}의 집 · Space 들어가기`);
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(`/@${neighbor}`);

    // 회원의 상점·출석 체크 입구는 그 화면
    await openTown(page);
    await teleport(page, 1400, 810);
    await expect(prompt(page)).toHaveText("🏪 상점 · Space 들어가기");
    await page.keyboard.press("Space");
    await expect(page).toHaveURL("/shop");
    // 헤더의 🏘 마을로 와도 Space가 링크가 아니라 게임으로 간다
    await page.getByRole("link", { name: "마을", exact: true }).click();
    await expect(page).toHaveURL("/town");
    await expect(canvas(page)).toHaveAttribute("data-ready", "1");
    await teleport(page, 940, 540);
    await expect(prompt(page)).toHaveText("📋 마을 소식 · Space 들어가기");
    await page.keyboard.press("Space");
    await expect(page).toHaveURL("/feed");
  });

  test("글자 칸에 쓰는 동안에는 캐릭터가 움직이지 않는다", async ({ page }) => {
    await openTown(page);
    const start = await feet(page);
    // 버튼에 초점을 두고 누른 Enter는 그 버튼으로 (게임이 가져가지 않는다)
    await page.locator("[data-town-menu]").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-town-panel]")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await feet(page)).toEqual(start);
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "probe";
      document.body.append(input);
    });
    await page.locator("#probe").focus();
    await page.keyboard.type("wasd");
    await page.waitForTimeout(300);
    expect(await feet(page)).toEqual(start);
  });

  test("1280×800 회원 화면: 헤더 아래를 꽉 채우고 스크롤이 없다, 레벨업 같은 창이 열려 있으면 키를 가져가지 않는다", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signUpOk(page);
    await openTown(page);
    const size = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
    expect(size).toEqual([1280, 800]);
    const box = (await canvas(page).boundingBox())!;
    expect(box.y + box.height).toBeCloseTo(800, 0);
    expect(box.height).toBeGreaterThan(600);

    const start = await feet(page);
    await page.evaluate(() => {
      const d = document.createElement("dialog");
      d.id = "probe";
      d.textContent = "창";
      document.body.append(d);
      d.showModal();
    });
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(400);
    await page.keyboard.up("ArrowLeft");
    expect(await feet(page)).toEqual(start);
  });

  test("휴대폰(375px): 회원은 내 블로그로 가고 🚪 문·🏘 마을이 숨는다, 방문자는 간단 메뉴", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
    const username = await signUpOk(page);
    await page.goto(`/@${username}`);
    await expect(page.locator("[data-house]")).toBeVisible();
    await expect(page.locator(`a[href="/town?at=${username}"]`)).toBeAttached();
    await expect(page.locator(`a[href="/town?at=${username}"]`)).toBeHidden();
    await expect(page.locator('header a[href="/town"]')).toBeAttached();
    await expect(page.locator('header a[href="/town"]')).toBeHidden();
    await page.goto("/town");
    await expect(page).toHaveURL(`/@${username}`);
    await page.close();

    const guest = await browser.newPage({ viewport: { width: 375, height: 800 } });
    await guest.goto("/town");
    await expect(guest.getByRole("heading", { name: "🏘 Blogville 마을 구경" })).toBeVisible();
    await expect(guest.locator("[data-town]")).toBeHidden();
    expect(await guest.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await guest.close();
  });
});
