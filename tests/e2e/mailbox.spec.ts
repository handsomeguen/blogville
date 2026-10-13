import { expect, test, type Page } from "./fixtures";
import { signUpOk, sql } from "./helpers";

// 집 앞 우체통 (TOWN-13), specs/043-mailbox
test.describe.configure({ timeout: 90_000 });

const canvas = (page: Page) => page.locator("[data-town] canvas");
const prompt = (page: Page) => page.locator("[data-town-prompt]");
const panel = (page: Page) => page.locator('[data-town-panel="mailbox"]');
const feet = async (page: Page) => (await canvas(page).getAttribute("data-feet"))!.split(",").map(Number);
const teleport = (page: Page, x: number, y: number) =>
  canvas(page).evaluate((c, d) => c.dispatchEvent(new CustomEvent("bv-teleport", { detail: d })), { x, y });
const short = (name: string) => ([...name].length > 12 ? `${[...name].slice(0, 12).join("")}…` : name);
const userId = async (username: string) => (await sql`select id from users where username = ${username}`)[0].id as string;

async function openTown(page: Page) {
  await page.goto("/town");
  await expect(canvas(page)).toHaveAttribute("data-ready", "1");
}

test.describe("TOWN-13 집 앞 우체통", () => {
  test("이웃 집 우체통: 최근 공개 글 3개(비공개 없음)·글로 가기·집 앞으로, 글이 없으면 문구", async ({ page, browser }) => {
    const me = await signUpOk(page);
    const others = [await browser.newPage(), await browser.newPage()];
    const writer = await signUpOk(others[0]);
    const quiet = await signUpOk(others[1]);
    for (const o of others) await o.close();
    const [blog] = await sql`select id from blogs where slug = ${writer}`;
    // 아주 옛 날짜로 넣어 다른 시험의 목록 첫 쪽을 건드리지 않는다
    for (const [i, title, pub] of [
      [1, "첫 편지", true],
      [2, "둘째 편지", true],
      [3, "비밀 편지", false],
      [4, "셋째 편지", true],
      [5, "넷째 편지", true],
    ] as const) {
      await sql`insert into posts (blog_id, title, content_html, content_text, is_public, created_at)
        values (${blog.id}, ${title}, '<p>본문</p>', '본문', ${pub}, '2000-01-01'::timestamptz + make_interval(mins => ${i}))`;
    }
    await sql`insert into follows (follower_id, followee_id, is_favorite, created_at) values
      (${await userId(me)}, ${await userId(writer)}, true, now() - interval '2 minutes'),
      (${await userId(me)}, ${await userId(quiet)}, true, now() - interval '1 minute')`;

    await openTown(page);
    // 1번 자리(300, 380) 오른쪽 앞 우체통
    await teleport(page, 418, 420);
    await expect(prompt(page)).toHaveText(`📬 ${short(writer)}의 우체통 · Space 소식 보기`);
    await page.keyboard.press("Space");
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole("heading")).toHaveText(`📮 ${writer}님의 우체통`);
    await expect(panel(page)).toContainText(`${writer}의 블로그의 새 글`);
    const posts = panel(page).getByRole("list", { name: "새 글" }).getByRole("link");
    await expect(posts).toHaveText(["✉️넷째 편지", "✉️셋째 편지", "✉️둘째 편지"]);
    // 창이 열려 있는 동안 방향키로 걷지 않는다
    await page.keyboard.press("ArrowLeft");
    expect(await feet(page)).toEqual([418, 420]);

    await panel(page).getByRole("button", { name: "✨ 집 앞으로" }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(() => feet(page)).toEqual([300, 420]);

    // 2번 자리: 공개 글이 없다
    await teleport(page, 418, 680);
    await page.keyboard.press("Enter");
    await expect(panel(page)).toContainText("아직 공개 글이 없어요.");
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);

    await teleport(page, 418, 420);
    await page.keyboard.press("Space");
    await posts.first().click();
    await expect(page).toHaveURL(new RegExp(`/@${writer}/\\d+$`));
    await expect(page.getByRole("heading", { name: "넷째 편지" })).toBeVisible();
  });

  test("내 우체통은 파랑, 안 읽은 알림이 있으면 깃발, 열면 내 알림 5개와 알림함 링크", async ({ page, browser }) => {
    const me = await signUpOk(page);
    const other = await browser.newPage();
    const actor = await signUpOk(other);
    await other.close();
    await openTown(page);
    expect(await canvas(page).getAttribute("data-mail-flag")).toBe("0");
    await teleport(page, 1988, 770);
    await expect(prompt(page)).toHaveText("📬 내 우체통 · Space 소식 보기");
    await page.keyboard.press("Space");
    await expect(panel(page).getByRole("heading")).toHaveText("📮 내 우체통");
    await expect(panel(page)).toContainText("아직 알림이 없어요.");
    await page.keyboard.press("Escape");

    const [blog] = await sql`select id from blogs where slug = ${me}`;
    const [post] = await sql`insert into posts (blog_id, title, content_html, content_text, created_at)
      values (${blog.id}, '알림 받을 글', '<p>본문</p>', '본문', '2000-01-01') returning id`;
    await sql`insert into notifications (user_id, kind, actor_id, post_id) values (${await userId(me)}, 'like', ${await userId(actor)}, ${post.id})`;
    await openTown(page);
    expect(await canvas(page).getAttribute("data-mail-flag")).toBe("1");
    await teleport(page, 1988, 770);
    await page.keyboard.press("Space");
    await expect(panel(page).locator('[data-notification="unread"]')).toHaveCount(1);
    await expect(panel(page).getByRole("link", { name: "알림함 전체 보기 ›" })).toBeVisible();
  });
});
