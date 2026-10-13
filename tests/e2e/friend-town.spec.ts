import { expect, test, type Page } from "./fixtures";
import { signUpOk, sql } from "./helpers";

// 친구 마을 구경 (TOWN-15), specs/047-friend-town
test.describe.configure({ timeout: 90_000 });

const canvas = (page: Page) => page.locator("[data-town] canvas");
const feet = async (page: Page) => (await canvas(page).getAttribute("data-feet"))!.split(",").map(Number);
const userId = async (username: string) => (await sql`select id from users where username = ${username}`)[0].id as string;
const short = (name: string) => ([...name].length > 12 ? `${[...name].slice(0, 12).join("")}…` : name);
const menu = (page: Page) => page.locator("[data-town-menu]");
const panel = (page: Page) => page.locator("[data-town-panel]");

test.describe("TOWN-15 친구 마을 구경", () => {
  test("블로그의 [🏘 마을 구경] → 그 회원의 마을: 위에 마을 이름·내 마을로, 그 집 앞에서 시작, 텔레포트 0번은 그 회원의 집", async ({ page, browser }) => {
    const me = await signUpOk(page);
    const pages = [await browser.newPage(), await browser.newPage()];
    const host = await signUpOk(pages[0]);
    const friend = await signUpOk(pages[1]);
    for (const p of pages) await p.close();
    // host가 friend와 나를 즐겨찾기
    await sql`insert into follows (follower_id, followee_id, is_favorite, created_at) values
      (${await userId(host)}, ${await userId(friend)}, true, now() - interval '2 minutes'),
      (${await userId(host)}, ${await userId(me)}, true, now() - interval '1 minute')`;

    await page.goto(`/@${host}`);
    await page.locator("[data-friend-town]").click();
    await expect(page).toHaveURL(new RegExp(`/town/${host}$`));
    await expect(page).toHaveTitle(`${host}님의 마을 | Blogville`);
    await expect(page.locator(`[data-town-host="${host}"]`)).toContainText(`🏘 ${host}님의 마을`);
    await expect(canvas(page)).toHaveAttribute("data-ready", "1");
    expect(await feet(page)).toEqual([1870, 770]);
    await expect(page.locator("[data-town-prompt]")).toHaveText(`🏠 ${short(host)}의 집 · Space 들어가기`);
    await expect(canvas(page)).toHaveAttribute("aria-label", `${host}님의 마을 지도. 방향키로 걷고 Space로 들어가요`);

    await menu(page).click();
    await panel(page).getByRole("button", { name: /✨ 텔레포트/ }).click();
    await expect(panel(page)).toContainText(`집 (${host}님 집 + 즐겨찾기 이웃 10자리)`);
    const lots = panel(page).locator("[data-spot]");
    await expect(lots.nth(0)).toContainText(`🏠 ${short(host)}의 집`);
    await expect(lots.nth(1)).toContainText(`🏠 ${short(friend)}의 집`);
    await expect(lots.nth(2)).toContainText("🏠 내 집");
    await page.keyboard.press("Escape");

    await page.locator(`[data-town-host="${host}"]`).getByRole("link", { name: "🏠 내 마을로" }).click();
    await expect(page).toHaveURL(/\/town$/);
  });

  test("친구 목록 🏘·우체통 [마을 구경]으로도 간다. 내 주소는 내 마을, 없는 주소·공지 블로그는 404, 방문자는 첫 화면", async ({ page, browser }) => {
    const me = await signUpOk(page);
    const other = await browser.newPage();
    const host = await signUpOk(other);
    await other.close();
    await sql`insert into follows (follower_id, followee_id, is_favorite) values (${await userId(me)}, ${await userId(host)}, true)`;

    await page.goto("/town");
    await expect(canvas(page)).toHaveAttribute("data-ready", "1");
    await menu(page).click();
    await panel(page).getByRole("button", { name: /👫 친구 목록/ }).click();
    await panel(page).getByRole("link", { name: `${host}님의 마을 구경` }).click();
    await expect(page).toHaveURL(new RegExp(`/town/${host}$`));

    // 내 마을의 1번 집 우체통
    await page.goto("/town");
    await expect(canvas(page)).toHaveAttribute("data-ready", "1");
    await canvas(page).evaluate((c) => c.dispatchEvent(new CustomEvent("bv-teleport", { detail: { x: 418, y: 420 } })));
    await page.keyboard.press("Space");
    await page.locator('[data-town-panel="mailbox"]').getByRole("link", { name: `🏘 ${host}님의 마을 구경` }).click();
    await expect(page).toHaveURL(new RegExp(`/town/${host}$`));

    await page.goto(`/town/${me}`);
    await expect(page).toHaveURL(/\/town$/);
    for (const slug of ["no-such-blog-zz", "notice"]) {
      const res = await page.goto(`/town/${slug}`);
      expect(res?.status()).toBe(404);
    }
    // 공지 블로그와 내 블로그에는 [🏘 마을 구경]이 없다
    await page.goto(`/@${me}`);
    await expect(page.locator("[data-friend-town]")).toHaveCount(0);

    const guest = await browser.newPage();
    await guest.goto(`/town/${host}`);
    await expect(guest).toHaveURL(/\/$/);
    await guest.close();
  });

  test("휴대폰(375px)에서는 그 회원의 블로그로 가고, 블로그에 [🏘 마을 구경]이 안 보인다", async ({ browser }) => {
    const other = await browser.newPage();
    const host = await signUpOk(other);
    await other.close();
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await signUpOk(page);
    await page.goto(`/town/${host}`);
    await expect(page).toHaveURL(new RegExp(`/@${host}$`));
    await expect(page.locator("[data-friend-town]")).toBeHidden();
    await ctx.close();
  });
});
