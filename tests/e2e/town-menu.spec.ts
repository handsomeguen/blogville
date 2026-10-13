import { expect, test, type Page } from "./fixtures";
import { insertPosts, PASSWORD, signIn, signUpOk, sql, uid } from "./helpers";

// ☰ 마을 메뉴·로그인 뒤 마을·첫 마을 환영 (TOWN-01·12), specs/039-town-menu
test.describe.configure({ timeout: 120_000 });

const canvas = (page: Page) => page.locator("[data-town] canvas");
const feet = async (page: Page) => (await canvas(page).getAttribute("data-feet"))!.split(",").map(Number);
const menuButton = (page: Page) => page.locator("[data-town-menu]");
const panel = (page: Page) => page.locator("[data-town-panel]");
async function openTown(page: Page, url = "/town") {
  if (url) await page.goto(url);
  await expect(canvas(page)).toHaveAttribute("data-ready", "1");
}
const userId = async (username: string) => (await sql`select id from users where username = ${username}`)[0].id as string;

test.describe("TOWN-12 ☰ 마을 메뉴", () => {
  test("로그인하면 마을: 헤더 막대 없이 Blogville 글자와 ☰ 메뉴, 내 프로필의 코인은 원장 합계, Esc로 닫으면 ☰로 초점", async ({ page }) => {
    const username = await signUpOk(page);
    await page.context().clearCookies();
    await signIn(page, username, PASSWORD);
    await expect(page).toHaveURL("/town");
    await openTown(page, "");
    await expect(page.locator("body > header")).toBeHidden();
    await expect(page.getByRole("link", { name: "Blogville" })).toHaveAttribute("href", "/town");

    await menuButton(page).click();
    await expect(panel(page)).toHaveAttribute("data-town-panel", "menu");
    const [{ coin, exp }] = await sql`select sum(coin_delta)::int as coin, sum(exp_delta)::int as exp from point_ledger where user_id = ${await userId(username)}`;
    await expect(panel(page).getByRole("button", { name: /👤 내 프로필/ })).toContainText(`Lv.1 · 🪙 ${coin}`);
    await expect(panel(page).getByRole("button", { name: /👫 친구 목록/ })).toContainText("이웃 0명");
    await expect(panel(page).getByRole("link", { name: "⚙️ 내 정보" })).toHaveAttribute("href", "/settings/account");
    await expect(panel(page).getByRole("button", { name: "로그아웃" })).toBeVisible();
    await expect(panel(page).getByRole("link", { name: "👑 관리자" })).toHaveCount(0);
    // 헤더가 없어 바로 가기 링크
    await expect(panel(page).getByRole("navigation", { name: "바로 가기" }).getByRole("link")).toHaveText(["✏️ 글쓰기", "📋 마을 소식", "🏪 상점", "👗 옷가게", "💇 미용실", "📮 출석", "🐮 동물 농장", "🎣 낚시터"]);

    await panel(page).getByRole("button", { name: /👤 내 프로필/ }).click();
    await expect(panel(page).getByRole("heading")).toHaveText("👤 내 프로필");
    await expect(panel(page).locator("[data-town-coin]")).toHaveText(String(coin));
    await expect(panel(page).locator("[data-town-exp]")).toHaveText(new RegExp(`^${exp} / \\d+$`));
    await expect(panel(page).getByRole("link", { name: "🏠 내 블로그" })).toHaveAttribute("href", `/@${username}`);
    // 메뉴가 열려 있는 동안 게임은 방향키를 쓰지 않는다
    const before = await feet(page);
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(400);
    await page.keyboard.up("ArrowLeft");
    expect(await feet(page)).toEqual(before);
    await panel(page).getByRole("button", { name: "메뉴로" }).click();
    await expect(panel(page)).toHaveAttribute("data-town-panel", "menu");
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(menuButton(page)).toBeFocused();
    // ☰는 키보드로도 열린다
    await page.keyboard.press("Enter");
    await expect(panel(page)).toBeVisible();
    await panel(page).getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL("/");
  });

  test("텔레포트: 마을 5곳 + 집 11자리, 빈 집터는 누를 수 없고 ⭐ 안내, 고르면 닫히고 그 앞으로", async ({ page }) => {
    await signUpOk(page);
    await openTown(page);
    await menuButton(page).click();
    await panel(page).getByRole("button", { name: /✨ 텔레포트/ }).click();
    await expect(panel(page).getByRole("button", { name: /광장 분수|마을 게시판|상점$|동물 농장|낚시터/ })).toHaveCount(5);
    const lots = panel(page).locator("[data-spot]");
    await expect(lots).toHaveCount(11);
    await expect(lots.first()).toContainText("🏠 내 집");
    await expect(lots.nth(1)).toBeDisabled();
    await expect(lots.nth(1)).toHaveText("빈 집터친구 목록에서 ⭐를 누르면 집이 생겨요");

    await panel(page).getByRole("button", { name: "🏪 상점" }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator("[data-town-prompt]")).toHaveText("🏪 상점 · Space 들어가기");
    await menuButton(page).click();
    await panel(page).getByRole("button", { name: /✨ 텔레포트/ }).click();
    await lots.first().click();
    await expect.poll(() => feet(page)).toEqual([1870, 770]);
    // ✨ 내 집은 동쪽 내 정원 안 (TOWN-20)
    const [x, y] = await feet(page);
    const [cx, cy, rx, ry] = (await canvas(page).getAttribute("data-garden"))!.split(",").map(Number);
    expect(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2).toBeLessThan(1);
    await expect(page.locator("[data-town-prompt]")).toHaveText("🏠 내 집 · Space 들어가기");
  });

  test("알림: 안 읽은 수가 ☰에 붙고, 최근 알림을 누르면 읽고 그 글로, 알림함 전체 보기", async ({ page, browser }) => {
    const username = await signUpOk(page);
    const other = await browser.newPage();
    const actor = await signUpOk(other);
    await other.close();
    await openTown(page);
    await menuButton(page).click();
    await panel(page).getByRole("button", { name: /🔔 알림/ }).click();
    await expect(panel(page)).toContainText("아직 알림이 없어요.");
    await expect(panel(page).getByRole("link", { name: "알림함 전체 보기 ›" })).toHaveAttribute("href", "/notifications");

    const title = uid("글");
    await insertPosts(username, 1);
    const [{ id: postId }] = await sql`update posts set title = ${title} where id = (select max(p.id) from posts p join blogs b on b.id = p.blog_id where b.slug = ${username}) returning id`;
    await sql`insert into notifications (user_id, kind, actor_id, post_id) values (${await userId(username)}, 'like', ${await userId(actor)}, ${postId})`;
    await openTown(page);
    await expect(menuButton(page)).toContainText("1");
    await menuButton(page).click();
    await expect(panel(page).getByRole("button", { name: /🔔 알림/ })).toContainText("안 읽은 알림 1개");
    await panel(page).getByRole("button", { name: /🔔 알림/ }).click();
    const row = panel(page).locator('[data-notification="unread"]');
    await expect(row).toContainText(title);
    await row.click();
    await expect(page).toHaveURL(`/@${username}/${postId}`);
    expect((await sql`select read_at from notifications where post_id = ${postId}`)[0].read_at).not.toBeNull();
  });

  test("친구 목록: ⭐를 켜면 그 집이 마을에 서고(서 있던 자리는 그대로) ✨로 그 집 앞에 간다", async ({ page, browser }) => {
    const username = await signUpOk(page);
    const other = await browser.newPage();
    const neighbor = await signUpOk(other);
    await other.close();
    await sql`insert into follows (follower_id, followee_id) values (${await userId(username)}, ${await userId(neighbor)})`;
    await openTown(page);
    await menuButton(page).click();
    await panel(page).getByRole("button", { name: /✨ 텔레포트/ }).click();
    await panel(page).getByRole("button", { name: "🏪 상점" }).click();
    await expect(page.locator("[data-town-prompt]")).toHaveText("🏪 상점 · Space 들어가기");
    await expect.poll(() => feet(page)).toEqual([1400, 800]);
    const atShop = await feet(page);

    await menuButton(page).click();
    await panel(page).getByRole("button", { name: /👫 친구 목록/ }).click();
    const friend = panel(page).locator(`[data-friend="${neighbor}"]`);
    await expect(friend).toBeVisible();
    await expect(friend.getByRole("button", { name: `${neighbor}의 집으로 텔레포트` })).toHaveCount(0);
    await friend.getByRole("button", { name: `${neighbor} 즐겨찾기` }).click();
    await expect(friend.getByRole("button", { name: `${neighbor} 즐겨찾기` })).toHaveAttribute("aria-pressed", "true");
    await expect(friend.getByRole("button", { name: `${neighbor}의 집으로 텔레포트` })).toBeVisible();
    expect(await feet(page)).toEqual(atShop);
    await friend.getByRole("button", { name: `${neighbor}의 집으로 텔레포트` }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(() => feet(page)).toEqual([300, 420]);
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(`/@${neighbor}`);
  });

  test("방문자 메뉴는 텔레포트·마을 소식·로그인, 빈 집터에 ⭐ 안내가 없다", async ({ page }) => {
    await openTown(page);
    await expect(page.getByRole("link", { name: "Blogville" })).toHaveAttribute("href", "/");
    await menuButton(page).click();
    // [✕]와 텔레포트, 그리고 로그인 링크
    await expect(panel(page).getByRole("button")).toHaveCount(2);
    await expect(panel(page).getByRole("button", { name: /✨ 텔레포트/ })).toBeVisible();
    await expect(panel(page).getByRole("link", { name: "🔑 로그인하고 내 집 만들기" })).toHaveAttribute("href", "/");
    await expect(panel(page).getByRole("link", { name: "📋 마을 소식" })).toHaveAttribute("href", "/feed");
    await panel(page).getByRole("button", { name: /✨ 텔레포트/ }).click();
    await expect(panel(page).locator("[data-spot]").first()).toHaveText(/^(내 집 자리|🏠 .+)$/);
    await expect(panel(page)).not.toContainText("친구 목록에서 ⭐를 누르면 집이 생겨요");
  });
});

test.describe("TOWN-01 첫 마을 환영", () => {
  test("가입 직후 블로그의 🚪 밖으로(깜빡임) → 내 집 앞에서 환영 한 번, 주소에서 welcome이 지워지고 새로고침하면 없다", async ({ page }) => {
    test.setTimeout(150_000);
    const username = await signUpOk(page);
    const other = await page.context().browser()!.newPage();
    const neighbor = await signUpOk(other);
    await other.close();
    await sql`insert into follows (follower_id, followee_id) values (${await userId(username)}, ${await userId(neighbor)})`;
    await page.goto(`/@${username}?welcome=1`);
    await expect(page.getByText("아래 우리 집의 🚪 밖으로를 눌러 마을을 구경해 보세요.")).toBeVisible();
    const door = page.getByRole("link", { name: "🚪 밖으로" });
    await expect(door).toHaveAttribute("href", "/town?welcome=1");
    await expect(door).toHaveClass(/door-welcome/);
    await door.click();
    await openTown(page, "");
    await expect(page.locator("[data-town-welcome]")).toContainText(`${username}님, 마을에 처음 나왔어요!`);
    expect(await feet(page)).toEqual([1870, 770]);
    await expect(page).toHaveURL("/town");
    // 주소에서 welcome을 지운 뒤 화면을 다시 그려도(⭐) 환영과 서 있던 자리는 그대로
    await menuButton(page).click();
    await panel(page).getByRole("button", { name: /👫 친구 목록/ }).click();
    await panel(page).getByRole("button", { name: `${neighbor} 즐겨찾기` }).click();
    await expect(panel(page).getByRole("button", { name: `${neighbor}의 집으로 텔레포트` })).toBeVisible();
    await expect(page.locator("[data-town-welcome]")).toBeVisible();
    expect(await feet(page)).toEqual([1870, 770]);
    await page.reload();
    await openTown(page, "");
    await expect(page.locator("[data-town-welcome]")).toHaveCount(0);

    // 평소의 🚪 밖으로는 그 집 앞으로
    await page.goto(`/@${username}`);
    await expect(page.getByRole("link", { name: "🚪 밖으로" })).toHaveAttribute("href", `/town?at=${username}`);
    await expect(page.getByRole("link", { name: "🚪 밖으로" })).not.toHaveClass(/door-welcome/);
  });
});
