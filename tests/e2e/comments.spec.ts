import { expect, test, type Browser, type Locator, type Page } from "./fixtures";
import { signUpOk, sql, writePost } from "./helpers";

async function member(browser: Browser) {
  const page = await browser.newPage();
  const username = await signUpOk(page);
  return { page, username };
}

const section = (page: Page) => page.locator("#comments");
const title = (page: Page) => section(page).getByRole("heading", { level: 2 });
const box = (page: Page) => section(page).getByRole("textbox", { name: "댓글", exact: true });

async function comment(page: Page, text: string) {
  await box(page).fill(text);
  await section(page).getByRole("button", { name: "댓글 등록" }).click();
  await expect(box(page)).toHaveValue("");
}

// 회원 서너 명이 가입하고 오가는 시나리오라 기본 30초보다 넉넉히
test.describe.configure({ timeout: 60_000 });

const line = (page: Page, text: string): Locator => section(page).getByRole("article").filter({ hasText: text });

test.describe("US1 댓글 쓰기·삭제", () => {
  test("쓰면 맨 아래에 나오고 입력칸이 비고 N이 는다, 줄바꿈·HTML은 글자 그대로", async ({ browser }) => {
    const owner = await member(browser);
    const id = await writePost(owner.page, "댓글 글", "본문");
    const guest = await member(browser);
    await guest.page.goto(`/@${owner.username}/${id}`);
    await expect(title(guest.page)).toHaveText("💬 댓글 0");
    await expect(box(guest.page)).toHaveAttribute("maxlength", "1000");
    await expect(box(guest.page)).toHaveAttribute("placeholder", "따뜻한 댓글을 남겨 주세요 💬");

    await comment(guest.page, "  첫 댓글  ");
    await comment(guest.page, '<b>굵게</b> https://a.com\n둘째 줄');
    await expect(title(guest.page)).toHaveText("💬 댓글 2");
    const lines = section(guest.page).getByRole("article");
    await expect(lines.nth(0)).toContainText("첫 댓글");
    await expect(lines.nth(1).locator("p.whitespace-pre-wrap")).toHaveText('<b>굵게</b> https://a.com\n둘째 줄');
    await expect(lines.nth(1).locator("b, a[href='https://a.com']")).toHaveCount(0);
    await expect(lines.nth(0).getByRole("link")).toHaveAttribute("href", `/@${guest.username}`);
    await expect(lines.nth(0).locator("time")).toHaveText(/^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}$/);
    await expect(lines.nth(0).locator("time")).toHaveAttribute("title", /^\d{4}년 \d{1,2}월 \d{1,2}일 오[전후] \d{1,2}:\d{2} \(한국 시간\)$/);

    const [{ content }] = await sql`select content from comments where post_id = ${id} order by id limit 1`;
    expect(content).toBe("첫 댓글");

    // 목록 카드의 💬 N
    await guest.page.goto(`/@${owner.username}`);
    await expect(guest.page.getByLabel("댓글 2개")).toBeVisible();
  });

  test("빈 칸·1001자·없는 글·남의 비공개 글·이상한 ID는 문구, 쓴 내용은 남는다", async ({ browser }) => {
    const owner = await member(browser);
    const secretId = await writePost(owner.page, "비밀", "본문", { private: true });
    const openId = await writePost(owner.page, "공개", "본문");
    const guest = await member(browser);
    await guest.page.goto(`/@${owner.username}/${openId}`);

    await box(guest.page).fill("   ");
    await section(guest.page).getByRole("button", { name: "댓글 등록" }).click();
    await expect(section(guest.page).getByRole("alert")).toHaveText("댓글을 적어 주세요");

    await box(guest.page).evaluate((el: HTMLTextAreaElement) => el.removeAttribute("maxlength"));
    await box(guest.page).fill("가".repeat(1001));
    await section(guest.page).getByRole("button", { name: "댓글 등록" }).click();
    await expect(section(guest.page).getByRole("alert")).toHaveText("댓글은 1000자까지예요");
    await expect(box(guest.page)).toHaveValue("가".repeat(1001));

    // 글 ID를 바꿔 보내기: 요청 본문의 postId를 고친다
    const send = async (postId: string, expected: string) => {
      await guest.page.route("**/*", async (route) => {
        const req = route.request();
        if (req.method() === "POST" && req.headers()["next-action"]) {
          const body = req.postData()!.replace(new RegExp(`(name="_1_postId"\\r\\n\\r\\n)${openId}`), `$1${postId}`);
          return route.continue({ postData: body });
        }
        return route.continue();
      });
      await box(guest.page).fill("조작");
      const done = guest.page.waitForResponse((r) => r.request().method() === "POST");
      await section(guest.page).getByRole("button", { name: "댓글 등록" }).click();
      await done;
      await expect(section(guest.page).getByRole("alert")).toHaveText(expected);
      await guest.page.unroute("**/*");
    };
    await send(String(secretId), "글을 찾을 수 없어요");
    await send("2147483646", "글을 찾을 수 없어요");
    await send("abc", "잘못된 요청이에요");
    await expect(box(guest.page)).toHaveValue("조작");
    expect(await sql`select 1 from comments where post_id in ${sql([secretId, openId])}`).toHaveLength(0);

    // 주인은 자기 비공개 글에 쓸 수 있다
    await owner.page.goto(`/@${owner.username}/${secretId}`);
    await comment(owner.page, "내 비밀 글 메모");
    await expect(title(owner.page)).toHaveText("💬 댓글 1");
  });

  test("방문자는 로그인 안내만, 버튼 없음", async ({ browser }) => {
    const owner = await member(browser);
    const id = await writePost(owner.page, "공개", "본문");
    await comment(owner.page, "주인 댓글");
    const visitor = await browser.newPage();
    await visitor.goto(`/@${owner.username}/${id}`);
    await expect(section(visitor)).toContainText("로그인하면 댓글을 남길 수 있어요");
    const login = section(visitor).getByRole("link", { name: "로그인" });
    // 로그인하면 이 글의 댓글 자리로 돌아온다 (tests/e2e/login-next.spec.ts)
    await expect(login).toHaveAttribute("href", `/?next=${encodeURIComponent(`/@${owner.username}/${id}#comments`)}`);
    expect((await login.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(section(visitor).getByRole("button")).toHaveCount(0);
    await expect(section(visitor).getByRole("textbox")).toHaveCount(0);
  });

  test("삭제 권한: 작성자·블로그 주인만 [삭제], 취소하면 그대로, 지우면 자리가 남고 내용은 빈 글자", async ({ browser }) => {
    const owner = await member(browser);
    const id = await writePost(owner.page, "공개", "본문");
    const a = await member(browser);
    const b = await member(browser);
    await a.page.goto(`/@${owner.username}/${id}`);
    await comment(a.page, "A의 비밀 내용");
    await b.page.goto(`/@${owner.username}/${id}`);
    await comment(b.page, "B의 댓글");

    await expect(line(b.page, "A의 비밀 내용").getByRole("button", { name: "삭제" })).toHaveCount(0);
    await expect(line(b.page, "B의 댓글").getByRole("button", { name: "삭제" })).toHaveCount(1);
    await owner.page.reload();
    await expect(section(owner.page).getByRole("button", { name: "삭제" })).toHaveCount(2);

    a.page.once("dialog", (d) => d.dismiss());
    await a.page.reload();
    await line(a.page, "A의 비밀 내용").getByRole("button", { name: "삭제" }).click();
    await expect(title(a.page)).toHaveText("💬 댓글 2");

    owner.page.once("dialog", (d) => {
      expect(d.message()).toBe("댓글을 삭제할까요?");
      return d.accept();
    });
    await line(owner.page, "A의 비밀 내용").getByRole("button", { name: "삭제" }).click();
    await expect(title(owner.page)).toHaveText("💬 댓글 1");
    await expect(section(owner.page).getByText("삭제된 댓글이에요")).toBeVisible();
    const html = await (await owner.page.request.get(`/@${owner.username}/${id}`)).text();
    expect(html).not.toContain("A의 비밀 내용");
    const [row] = await sql`select content, deleted_at from comments where post_id = ${id} order by id limit 1`;
    expect(row.content).toBe("");
    expect(row.deleted_at).not.toBeNull();
  });

  test("권한 없는 삭제·이미 지운 댓글·이상한 ID는 아무것도 바꾸지 않는다", async ({ browser }) => {
    const owner = await member(browser);
    const id = await writePost(owner.page, "공개", "본문");
    await comment(owner.page, "주인 댓글");
    const [{ id: commentId }] = await sql`select id from comments where post_id = ${id}`;
    const b = await member(browser);
    await b.page.goto(`/@${owner.username}/${id}`);
    await comment(b.page, "B 댓글");
    // B의 [삭제] 요청을 주인 댓글 ID로 바꿔 보낸다
    await b.page.route("**/*", async (route) => {
      const req = route.request();
      if (req.method() === "POST" && req.headers()["next-action"]) {
        return route.continue({ postData: req.postData()!.replace(/(name="_1_id"\r\n\r\n)\d+/, `$1${commentId}`) });
      }
      return route.continue();
    });
    b.page.once("dialog", (d) => d.accept());
    const res = b.page.waitForResponse((r) => r.request().method() === "POST");
    await line(b.page, "B 댓글").getByRole("button", { name: "삭제" }).click();
    expect((await res).status()).toBe(200);
    const [row] = await sql`select deleted_at from comments where id = ${commentId}`;
    expect(row.deleted_at).toBeNull();
    await b.page.unroute("**/*");
  });

  test("로그인이 풀린 뒤 등록하면 첫 화면으로 가고 저장되지 않는다", async ({ browser }) => {
    const owner = await member(browser);
    const id = await writePost(owner.page, "공개", "본문");
    await box(owner.page).fill("늦은 댓글");
    await owner.page.context().clearCookies();
    await owner.page.getByRole("button", { name: "댓글 등록" }).click();
    await expect(owner.page).toHaveURL("/");
    expect(await sql`select 1 from comments where post_id = ${id}`).toHaveLength(0);
  });
});

test.describe("US2 답글", () => {
  test("답글 열고 닫기, 등록하면 들여쓰기로, 답글에는 [답글] 없음, N은 답글도 센다", async ({ browser }) => {
    const owner = await member(browser);
    const id = await writePost(owner.page, "공개", "본문");
    await comment(owner.page, "원댓글");
    const g = await member(browser);
    await g.page.goto(`/@${owner.username}/${id}`);

    const parent = section(g.page).getByRole("listitem").filter({ hasText: "원댓글" });
    await parent.getByRole("button", { name: "답글" }).click();
    const replyBox = parent.getByRole("textbox", { name: "답글", exact: true });
    await expect(replyBox).toHaveAttribute("placeholder", "답글을 남겨 주세요");
    await expect(replyBox).toHaveAttribute("rows", "2");
    await expect(replyBox).not.toBeFocused();
    await expect(parent.getByRole("button", { name: "답글", exact: true })).toHaveCount(0);
    await replyBox.fill("쓰다 만 답글");
    await parent.getByRole("button", { name: "답글 취소" }).click();
    await parent.getByRole("button", { name: "답글" }).click();
    await expect(parent.getByRole("textbox", { name: "답글", exact: true })).toHaveValue("");

    for (const text of ["첫 답글", "둘째 답글"]) {
      await parent.getByRole("textbox", { name: "답글", exact: true }).fill(text);
      await parent.getByRole("button", { name: "답글 등록" }).click();
      await expect(parent.getByRole("textbox", { name: "답글", exact: true })).toHaveCount(0);
      if (text === "첫 답글") await parent.getByRole("button", { name: "답글", exact: true }).click();
    }
    const list = parent.getByRole("list", { name: "답글" });
    await expect(list.getByRole("article")).toHaveCount(2);
    await expect(list.getByRole("article").nth(0)).toContainText("첫 답글");
    await expect(list.getByRole("article").nth(1)).toContainText("둘째 답글");
    await expect(list.getByRole("button", { name: "답글" })).toHaveCount(0);
    await expect(title(g.page)).toHaveText("💬 댓글 3");

    // 원댓글을 지우면 답글은 그대로, 지운 원댓글에는 [답글]이 없다
    owner.page.once("dialog", (d) => d.accept());
    await owner.page.reload();
    await line(owner.page, "원댓글").first().getByRole("button", { name: "삭제" }).click();
    await expect(title(owner.page)).toHaveText("💬 댓글 2");
    await g.page.reload();
    await expect(section(g.page).getByRole("list", { name: "답글" }).getByRole("article")).toHaveCount(2);
    await expect(section(g.page).getByText("삭제된 댓글이에요")).toBeVisible();
    await expect(section(g.page).getByRole("button", { name: "답글", exact: true })).toHaveCount(0);

    // 주인이 남의 답글을 지운다
    owner.page.once("dialog", (d) => d.accept());
    await line(owner.page, "첫 답글").getByRole("button", { name: "삭제" }).click();
    await expect(title(owner.page)).toHaveText("💬 댓글 1");
    const [r] = await sql`select r.content from replies r join comments c on c.id = r.comment_id where c.post_id = ${id} order by r.id limit 1`;
    expect(r.content).toBe("");
  });

  test("삭제된 원댓글·없는 댓글·다른 글의 댓글·빈 답글은 문구", async ({ browser }) => {
    const owner = await member(browser);
    const id = await writePost(owner.page, "공개", "본문");
    const otherId = await writePost(owner.page, "다른 글", "본문");
    await comment(owner.page, "다른 글 댓글");
    const [{ id: otherComment }] = await sql`select id from comments where post_id = ${otherId}`;
    await owner.page.goto(`/@${owner.username}/${id}`);
    await comment(owner.page, "원댓글");
    const [{ id: parentId }] = await sql`select id from comments where post_id = ${id}`;

    const parent = section(owner.page).getByRole("listitem").filter({ hasText: "원댓글" });
    await parent.getByRole("button", { name: "답글" }).click();
    const replyBox = parent.getByRole("textbox", { name: "답글", exact: true });
    const submit = () => parent.getByRole("button", { name: "답글 등록" }).click();

    await replyBox.fill("  ");
    await submit();
    await expect(parent.getByRole("alert")).toHaveText("댓글을 적어 주세요");

    const swap = async (commentId: string) => {
      await owner.page.route("**/*", async (route) => {
        const req = route.request();
        if (req.method() === "POST" && req.headers()["next-action"]) {
          return route.continue({ postData: req.postData()!.replace(new RegExp(`(name="_1_commentId"\\r\\n\\r\\n)${parentId}`), `$1${commentId}`) });
        }
        return route.continue();
      });
    };
    await replyBox.fill("조작 답글");
    await swap(String(otherComment));
    await submit();
    await expect(parent.getByRole("alert")).toHaveText("답글을 달 댓글이 없어요");
    await owner.page.unroute("**/*");
    await swap("abc");
    await submit();
    await expect(parent.getByRole("alert")).toHaveText("잘못된 요청이에요");
    await owner.page.unroute("**/*");

    // 입력칸을 연 사이 원댓글이 지워짐
    await sql`update comments set deleted_at = now(), content = '' where id = ${parentId}`;
    await submit();
    await expect(parent.getByRole("alert")).toHaveText("삭제된 댓글에는 답글을 달 수 없어요");
    await expect(replyBox).toHaveValue("조작 답글");
    expect(await sql`select 1 from replies where comment_id in ${sql([parentId, otherComment])}`).toHaveLength(0);
  });

  test("글을 지우면 댓글·답글 행도 지워지고, 지운 댓글에 내용을 넣으면 DB가 거부한다", async ({ browser }) => {
    const owner = await member(browser);
    const id = await writePost(owner.page, "지울 글", "본문");
    await comment(owner.page, "댓글");
    const parent = section(owner.page).getByRole("listitem").filter({ hasText: "댓글" }).first();
    await parent.getByRole("button", { name: "답글" }).click();
    await parent.getByRole("textbox", { name: "답글", exact: true }).fill("답글");
    await parent.getByRole("button", { name: "답글 등록" }).click();
    await expect(parent.getByRole("list", { name: "답글" })).toBeVisible();
    const [{ id: cid }] = await sql`select id from comments where post_id = ${id}`;

    await expect(sql`update comments set deleted_at = now() where id = ${cid}`).rejects.toMatchObject({ code: "23514" });

    owner.page.once("dialog", (d) => d.accept());
    await owner.page.locator("footer").getByRole("button", { name: "삭제" }).click();
    await expect(owner.page).toHaveURL(`/@${owner.username}`);
    expect(await sql`select 1 from comments where id = ${cid}`).toHaveLength(0);
    expect(await sql`select 1 from replies where comment_id = ${cid}`).toHaveLength(0);
  });

  test("375px에서 가로 스크롤 없고 버튼 높이 44px 이상", async ({ browser }) => {
    const owner = await member(browser);
    await writePost(owner.page, "모바일", "본문");
    await comment(owner.page, "아주 긴 댓글 ".repeat(30));
    await owner.page.setViewportSize({ width: 375, height: 812 });
    expect(await owner.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    for (const b of await section(owner.page).getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});
