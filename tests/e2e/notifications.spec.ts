import { expect, test, type Browser, type Page } from "./fixtures";
import { signUpOk, sql, writePost } from "./helpers";

// 알림함과 헤더 🔔 (GAME-08의 공감·댓글·답글), specs/017-notifications
test.describe.configure({ timeout: 60_000 });

async function member(browser: Browser, viewport?: { width: number; height: number }) {
  const page = viewport ? await (await browser.newContext({ viewport })).newPage() : await browser.newPage();
  const username = await signUpOk(page);
  const [{ id }] = await sql`select id from users where username = ${username}`;
  return { page, username, userId: id as string };
}

const bell = (page: Page) => page.getByRole("navigation", { name: "메뉴" }).getByRole("link", { name: /^알림/ });
const badge = (page: Page) => bell(page).locator("[data-unread]");
/** 댓글 보상 등으로 생긴 레벨업 알림 (GAME-06) 지우기 */
const clearLevelUps = (userId: string) => sql`delete from notifications where user_id = ${userId} and kind = 'level_up'`;
const rows = (page: Page) => page.getByRole("list", { name: "알림" }).getByRole("listitem");
const section = (page: Page) => page.locator("#comments");

async function comment(page: Page, text: string) {
  const box = section(page).getByRole("textbox", { name: "댓글", exact: true });
  await box.fill(text);
  await section(page).getByRole("button", { name: "댓글 등록" }).click();
  await expect(box).toHaveValue("");
}

async function reply(page: Page, parentText: string, text: string) {
  const parent = section(page).getByRole("listitem").filter({ hasText: parentText }).first();
  await parent.getByRole("button", { name: "답글", exact: true }).click();
  await parent.getByRole("textbox", { name: "답글", exact: true }).fill(text);
  await parent.getByRole("button", { name: "답글 등록" }).click();
  await expect(parent.getByRole("list", { name: "답글" }).getByText(text)).toBeVisible();
}

const like = (page: Page) => page.getByRole("button", { name: /공감 \d+$/ });

/** 공감 버튼은 먼저 바뀌어 보이고 저장이 끝나면 다시 눌 수 있다 */
async function toggleLike(page: Page, shown: string) {
  await like(page).click();
  await expect(like(page)).toHaveText(shown);
  await expect(like(page)).toBeEnabled();
}

const kindsFor = async (userId: string) =>
  (
    await sql`select n.kind, u.username as actor from notifications n join users u on u.id = n.actor_id
      where n.user_id = ${userId} order by n.id`
  ).map((r) => `${r.kind}:${r.actor}`);

test.describe("GAME-08 알림", () => {
  test("남이 공감·댓글을 하면 숫자와 알림이 생기고, 누르면 댓글 자리로 가며 읽음, 모두 읽음이면 숫자가 사라진다", async ({ browser }) => {
    const owner = await member(browser);
    const id = await writePost(owner.page, "알림 글", "본문");
    // 내 글에 내가 한 공감·댓글은 알림이 아니다
    await comment(owner.page, "내가 단 댓글");
    await toggleLike(owner.page, "♥ 공감 1");
    await expect(bell(owner.page)).toHaveAccessibleName("알림");
    await expect(badge(owner.page)).toHaveCount(0);

    const g = await member(browser);
    await g.page.goto(`/@${owner.username}/${id}`);
    await toggleLike(g.page, "♥ 공감 2");
    await comment(g.page, "반가워요");

    await owner.page.goto(`/@${owner.username}`);
    await expect(badge(owner.page)).toHaveText("2");
    await expect(bell(owner.page)).toHaveAccessibleName("알림, 안 읽은 알림 2개");
    await bell(owner.page).click();
    await expect(owner.page).toHaveURL(/\/notifications$/);
    await expect(owner.page.getByRole("heading", { level: 1 })).toHaveText("🔔 알림함");
    await expect(owner.page).toHaveTitle("알림함 | Blogville");
    await expect(rows(owner.page)).toHaveCount(2);
    const newest = rows(owner.page).nth(0).getByRole("button");
    await expect(newest).toContainText(`💬 ${g.username}님이 「알림 글」에 댓글을 달았어요`);
    await expect(newest).toContainText(/\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}/);
    await expect(rows(owner.page).nth(1).getByRole("button")).toContainText(`❤️ ${g.username}님이 「알림 글」에 공감했어요`);
    await expect(newest).toHaveAttribute("data-notification", "unread");
    await expect(newest).toHaveCSS("background-color", "rgb(255, 243, 214)");
    expect((await newest.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await newest.click();
    await expect(owner.page).toHaveURL(new RegExp(`/@${owner.username}/${id}#comments$`));
    await expect(section(owner.page)).toBeInViewport();
    await expect(badge(owner.page)).toHaveText("1");

    await bell(owner.page).click();
    await expect(rows(owner.page).nth(0).getByRole("button")).toHaveAttribute("data-notification", "read");
    await expect(rows(owner.page).nth(1).getByRole("button")).toHaveAttribute("data-notification", "unread");
    await owner.page.getByRole("button", { name: "모두 읽음" }).click();
    await expect(rows(owner.page).nth(1).getByRole("button")).toHaveAttribute("data-notification", "read");
    await expect(owner.page.getByRole("button", { name: "모두 읽음" })).toHaveCount(0);
    await expect(badge(owner.page)).toHaveCount(0);

    expect(await kindsFor(owner.userId)).toEqual([`like:${g.username}`, `comment:${g.username}`]);
    expect(await kindsFor(g.userId)).toEqual([]);
  });

  test("공감→취소→공감은 1개, 답글 알림은 원댓글 작성자에게만(글 주인에게는 없음), 내 댓글에 내 답글은 없음", async ({ browser }) => {
    const owner = await member(browser);
    const id = await writePost(owner.page, "답글 글", "본문");
    const a = await member(browser);
    const b = await member(browser);
    await a.page.goto(`/@${owner.username}/${id}`);
    await comment(a.page, "에이의 원댓글");
    await reply(a.page, "에이의 원댓글", "내가 단 답글");

    await b.page.goto(`/@${owner.username}/${id}`);
    await reply(b.page, "에이의 원댓글", "비의 답글");
    for (const text of ["♥ 공감 1", "♡ 공감 0", "♥ 공감 1"]) await toggleLike(b.page, text);
    await owner.page.goto(`/@${owner.username}/${id}`);
    await reply(owner.page, "에이의 원댓글", "주인의 답글");

    expect(await kindsFor(owner.userId)).toEqual([`comment:${a.username}`, `like:${b.username}`]);
    expect(await kindsFor(a.userId)).toEqual([`reply:${b.username}`, `reply:${owner.username}`]);
    expect(await kindsFor(b.userId)).toEqual([]);

    // 댓글 보상으로 오른 레벨업 알림(GAME-06)은 이 시험과 관계없어 지운다
    await clearLevelUps(a.userId);
    await a.page.goto("/notifications");
    await expect(rows(a.page)).toHaveCount(2);
    await expect(rows(a.page).nth(0)).toContainText(`💬 ${owner.username}님이 내 댓글에 답글을 달았어요`);
    await expect(rows(a.page).nth(1)).toContainText(`💬 ${b.username}님이 내 댓글에 답글을 달았어요`);
  });

  test("빈 알림함, 방문자는 🔔 없이 /로, 22개면 9+·20개씩 쪽, 이상한 쪽 번호는 1쪽, 남의 알림 ID 조작은 무시", async ({ browser }) => {
    const owner = await member(browser);
    await owner.page.goto("/notifications");
    await expect(owner.page.getByText("아직 알림이 없어요")).toBeVisible();
    await expect(owner.page.getByRole("button", { name: "모두 읽음" })).toHaveCount(0);

    const visitor = await browser.newPage();
    await visitor.goto("/feed");
    await expect(bell(visitor)).toHaveCount(0);
    await visitor.goto("/notifications");
    await expect(visitor).toHaveURL(/\/$/);

    const actor = await member(browser);
    const postId = await writePost(owner.page, "많은 알림 글", "본문");
    await sql`insert into notifications (user_id, kind, actor_id, post_id, created_at)
      select ${owner.userId}, 'comment', ${actor.userId}, ${postId}, now() - make_interval(mins => g) from generate_series(1, 22) g`;
    await owner.page.goto(`/@${owner.username}`);
    await expect(badge(owner.page)).toHaveText("9+");

    await owner.page.goto("/notifications");
    await expect(rows(owner.page)).toHaveCount(20);
    await expect(rows(owner.page).first()).toContainText(/\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}/);
    await owner.page.getByRole("navigation", { name: "페이지" }).getByRole("link", { name: "2", exact: true }).click();
    await expect(owner.page).toHaveURL(/\/notifications\?page=2$/);
    await expect(rows(owner.page)).toHaveCount(2);
    await expect(rows(owner.page).last()).toContainText(/\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}/);
    await owner.page.goto("/notifications?page=99999999999999999999");
    await expect(rows(owner.page)).toHaveCount(20);

    // 행동한 회원이 자기 알림 줄의 ID를 주인의 알림 ID로 바꿔 보낸다
    const theirs = (await sql`select id from notifications where user_id = ${owner.userId} order by id limit 1`)[0].id as number;
    const mine = await writePost(actor.page, "행동한 회원의 글", "본문");
    await owner.page.goto(`/@${actor.username}/${mine}`);
    await toggleLike(owner.page, "♥ 공감 1");
    await actor.page.goto("/notifications");
    await expect(rows(actor.page)).toHaveCount(1);
    await rows(actor.page).locator('input[name="id"]').evaluate((el, v) => ((el as HTMLInputElement).value = v), String(theirs));
    // 같은 주소로 돌아오므로 Server Action 응답을 기다린 뒤 DB를 본다
    await Promise.all([
      actor.page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"]),
      rows(actor.page).getByRole("button").click(),
    ]);
    await expect(actor.page).toHaveURL(/\/notifications$/);
    expect((await sql`select read_at from notifications where id = ${theirs}`)[0].read_at).toBeNull();
    await expect(rows(actor.page).getByRole("button")).toHaveAttribute("data-notification", "unread");
  });

  test("처음 숫자가 0이었어도 화면을 옮기면 새 알림 숫자가 보이고, 모두 읽음·마지막보다 큰 쪽·읽는 화면의 안 읽음 표시", async ({ browser }) => {
    const owner = await member(browser);
    const actor = await member(browser);
    const postId = await writePost(owner.page, "늦게 온 알림 글", "본문");
    await owner.page.goto(`/@${owner.username}`);
    await expect(badge(owner.page)).toHaveCount(0);
    await sql`insert into notifications (user_id, kind, actor_id, post_id) values (${owner.userId}, 'comment', ${actor.userId}, ${postId})`;
    // 헤더(레이아웃)는 다시 그려지지 않고, 주소가 바뀔 때 숫자를 새로 받는다
    await owner.page.getByRole("navigation", { name: "메뉴" }).getByRole("link", { name: "마을 소식" }).click();
    await expect(owner.page).toHaveURL(/\/feed$/);
    await expect(badge(owner.page)).toHaveText("1");
    await bell(owner.page).click();
    await expect(rows(owner.page)).toHaveCount(1);
    await expect(rows(owner.page).getByRole("button")).toHaveAccessibleName(new RegExp(`^안 읽음, 💬 ${actor.username}님이 「늦게 온 알림 글」에 댓글을 달았어요 \\d{4}\\.\\d{2}\\.\\d{2} \\d{2}:\\d{2}$`));
    await owner.page.getByRole("button", { name: "모두 읽음" }).click();
    await expect(owner.page.getByRole("button", { name: "모두 읽음" })).toHaveCount(0);
    await expect(badge(owner.page)).toHaveCount(0);
    await expect(rows(owner.page).getByRole("button")).toHaveAccessibleName(new RegExp(`^💬 ${actor.username}님이 「늦게 온 알림 글」에 댓글을 달았어요 \\d{4}\\.\\d{2}\\.\\d{2} \\d{2}:\\d{2}$`));

    await owner.page.goto("/notifications?page=2");
    await expect(owner.page.getByText("아직 알림이 없어요")).toBeVisible();
    await expect(owner.page.getByRole("list", { name: "알림" })).toHaveCount(0);
  });

  test("글이 지워지거나 행동한 회원이 탈퇴하면 알림도 없어지고, 나중에 비공개가 된 글의 답글 알림은 숨는다", async ({ browser }) => {
    const owner = await member(browser);
    const keep = await writePost(owner.page, "남는 글", "본문");
    const gone = await writePost(owner.page, "지울 글", "본문");
    const a = await member(browser);
    for (const id of [keep, gone]) {
      await a.page.goto(`/@${owner.username}/${id}`);
      await comment(a.page, `에이 댓글 ${id}`);
    }
    await owner.page.goto(`/@${owner.username}/${keep}`);
    await reply(owner.page, `에이 댓글 ${keep}`, "주인 답글");
    expect(await kindsFor(owner.userId)).toHaveLength(2);
    expect(await kindsFor(a.userId)).toEqual([`reply:${owner.username}`]);

    await sql`delete from posts where id = ${gone}`;
    expect(await kindsFor(owner.userId)).toEqual([`comment:${a.username}`]);

    // 주인이 글을 비공개로 바꾸면 에이에게는 그 글의 답글 알림이 보이지 않는다
    await sql`update posts set is_public = false where id = ${keep}`;
    await clearLevelUps(a.userId);
    await a.page.goto("/notifications");
    await expect(a.page.getByText("아직 알림이 없어요")).toBeVisible();
    await expect(badge(a.page)).toHaveCount(0);

    await sql`delete from users where id = ${a.userId}`;
    expect(await kindsFor(owner.userId)).toEqual([]);
  });

  test("375px: 🔔은 헤더 대신 아래 탭에 숫자와 함께, 44px, 알림함에 긴 제목이 있어도 가로 스크롤이 없다", async ({ browser }) => {
    const owner = await member(browser, { width: 375, height: 800 });
    const actor = await member(browser);
    const long = "아주긴제목".repeat(19);
    const postId = await writePost(owner.page, long, "본문");
    await sql`insert into notifications (user_id, kind, actor_id, post_id) values (${owner.userId}, 'like', ${actor.userId}, ${postId})`;
    await owner.page.goto("/notifications");
    await expect(rows(owner.page)).toHaveCount(1);
    // 휴대폰 회원의 🔔은 아래 탭에 있다 (TOWN-11, specs/040-phone-tabs)
    await expect(bell(owner.page)).toBeHidden();
    const tab = owner.page.getByRole("navigation", { name: "아래 탭" }).getByRole("link", { name: "알림, 안 읽은 알림 1개" });
    await expect(tab.locator("[data-unread]")).toHaveText("1");
    expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await owner.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
});
