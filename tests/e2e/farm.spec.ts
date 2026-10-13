import { expect, test, type Page } from "./fixtures";
import { signUpOk, sql } from "./helpers";

// 동물 농장 (TOWN-09), specs/044-farm
test.describe.configure({ timeout: 90_000 });

const result = (page: Page) => page.locator("[data-farm-result]");
const animal = (page: Page) => page.locator("[data-animal]");
const userId = async (username: string) => (await sql`select id from users where username = ${username}`)[0].id as string;
const ledger = (username: string, reason: string) =>
  sql`select l.exp_delta, l.coin_delta from point_ledger l join users u on u.id = l.user_id where u.username = ${username} and l.reason = ${reason} order by l.id`;

test.describe("TOWN-09 동물 농장", () => {
  test("첫 알 받기 → 부화 → 밥·물·쓰다듬기(하루 한 번) → 다 키우면 보상과 카드", async ({ page }) => {
    const me = await signUpOk(page);
    await page.goto("/farm");
    await expect(page.getByText("아직 키우는 동물이 없어요.")).toBeVisible();
    await page.getByRole("button", { name: "🎁 농장 첫 알 (무료)" }).click();
    await expect(result(page)).toHaveText("🥚 농장 첫 알을 받았어요!");
    await expect(page.getByRole("button", { name: "🎁 농장 첫 알 (무료)" })).toHaveCount(0);
    await expect(page.getByText("(키우는 중 1/5)")).toBeVisible();

    await page.getByRole("button", { name: "🐣 부화시키기" }).click();
    await expect(result(page)).toContainText("태어났어요!");
    await expect(animal(page)).toHaveCount(1);
    const species = (await animal(page).getAttribute("data-animal"))!;
    const full = { chick: 60, rabbit: 90, piglet: 120, calf: 160 }[species]!;
    await expect(animal(page).locator("[data-growth]")).toHaveText(`0/${full}`);

    await animal(page).getByRole("button", { name: "🥕 밥 주기" }).click();
    await expect(result(page)).toHaveText("🥕 밥 주기 완료! 성장 +10, 경험치 +2");
    await expect(animal(page).locator("[data-growth]")).toHaveText(`10/${full}`);
    await expect(animal(page).getByRole("button", { name: "밥 주기 완료" })).toBeDisabled();
    expect(await ledger(me, "farm_care")).toEqual([{ exp_delta: 2, coin_delta: 0 }]);

    // 다 자라기 직전으로 옮겨 놓고 쓰다듬기 (+5)로 다 키운다
    const [row] = await sql`select a.id from animals a join users u on u.id = a.user_id where u.username = ${me}`;
    await sql`update animals set growth = ${full - 5} where id = ${row.id}`;
    await page.reload();
    await animal(page).getByRole("button", { name: "🤲 쓰다듬기" }).click();
    const names = { chick: "병아리가", rabbit: "토끼가", piglet: "아기 돼지가", calf: "송아지가" } as const;
    await expect(result(page)).toContainText(`🎉 ${names[species as keyof typeof names]} 다 자랐어요!`);
    await expect(animal(page)).toHaveCount(0);
    await expect(page.locator(`[data-grown="${species}"]`)).toHaveCount(1);
    expect(await ledger(me, "farm_grown")).toHaveLength(1);
  });

  test("알 사기(🪙 100)·코인 부족, 5마리면 자리가 꽉 참, 레벨 5 보상 알", async ({ page }) => {
    const me = await signUpOk(page);
    await page.goto("/farm");
    await page.getByRole("button", { name: "🪙 100으로 알 사기" }).click();
    await expect(result(page)).toHaveText("🥚 알을 샀어요! 🪙 −100");
    expect(await ledger(me, "egg_purchase")).toEqual([{ exp_delta: 0, coin_delta: -100 }]);
    await expect(page.getByRole("button", { name: "🪙 100으로 알 사기" })).toBeDisabled(); // 남은 코인 10

    const id = await userId(me);
    // 레벨 5 (누적 경험치) + 알 3개 더 → 5개
    await sql`insert into point_ledger (user_id, reason, exp_delta, coin_delta) values (${id}, 'farm_care', 2000, 0)`;
    await sql`insert into animals (user_id, source) values (${id}, 'buy'), (${id}, 'buy'), (${id}, 'first')`;
    await page.reload();
    await expect(page.getByRole("button", { name: /레벨 5 보상 알/ })).toBeVisible();
    await page.getByRole("button", { name: /레벨 5 보상 알/ }).click();
    await expect(result(page)).toHaveText("🥚 레벨 5 보상 알을 받았어요!");
    await expect(page.getByText("(키우는 중 5/5)")).toBeVisible();
    await expect(page.getByText("자리가 꽉 찼어요. 다 키운 뒤에 받을 수 있어요")).toBeVisible();
    await expect(page.locator("[data-egg]")).toHaveCount(5);
  });

  test("100자 이상 공개 글을 쓰면 키우는 동물이 모두 성장 +10", async ({ page }) => {
    const me = await signUpOk(page);
    const id = await userId(me);
    await sql`insert into animals (user_id, source, species, hatched_at) values (${id}, 'first', 'calf', now()), (${id}, 'buy', 'rabbit', now())`;
    await page.goto("/write");
    await page.getByLabel("제목", { exact: true }).fill("농장 글");
    await page.getByLabel("본문").click();
    await page.keyboard.insertText("가".repeat(120));
    await page.getByRole("button", { name: "발행하기" }).click();
    await expect(page).toHaveURL(/\/@[a-z0-9_]+\/\d+(\?new=1)?$/);
    // 다른 시험의 최신 글 목록에 걸리지 않게 옛 날짜로
    await sql`update posts set created_at = '2000-01-01' where blog_id = (select id from blogs where slug = ${me})`;
    expect((await sql`select growth from animals where user_id = ${id} order by id`).map((r) => r.growth)).toEqual([10, 10]);
  });

  test("마을의 동물 농장: 입구 안내 → Space로 들어간다, 방문자는 로그인 안내", async ({ page, browser }) => {
    await signUpOk(page);
    await page.goto("/town");
    const canvas = page.locator("[data-town] canvas");
    await expect(canvas).toHaveAttribute("data-ready", "1");
    await canvas.evaluate((c) => c.dispatchEvent(new CustomEvent("bv-teleport", { detail: { x: 2150, y: 770 } })));
    await expect(page.locator("[data-town-prompt]")).toHaveText("🐮 동물 농장 · Space 들어가기");
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/\/farm$/);
    await expect(page.getByRole("heading", { name: "🐮 동물 농장" })).toBeVisible();

    const guest = await browser.newPage();
    await guest.goto("/town");
    const gc = guest.locator("[data-town] canvas");
    await expect(gc).toHaveAttribute("data-ready", "1");
    await gc.evaluate((c) => c.dispatchEvent(new CustomEvent("bv-teleport", { detail: { x: 2150, y: 770 } })));
    await expect(guest.locator("[data-town-prompt]")).toHaveText("🐮 동물 농장 · Space 로그인하고 이용하기");
    await guest.close();
  });

  test("성장 아이템: 상점에서 두 번 사면 보유 2개, 농장에서 하나씩 먹이고 다 쓰면 버튼이 사라진다", async ({ page }) => {
    const me = await signUpOk(page);
    const id = await userId(me);
    await page.goto("/shop");
    const feed = page.locator('[data-item="동물 먹이"]');
    await feed.getByRole("button", { name: "사기" }).click();
    await expect(page.locator("[data-buy-result]")).toContainText("🎉 동물 먹이를 샀어요! 동물 농장에서 써 보세요.");
    await expect(page.locator("[data-buy-result]").getByRole("link", { name: "🐮 동물 농장으로" })).toHaveAttribute("href", "/farm");
    await feed.getByRole("button", { name: "사기" }).click();
    await expect(feed.locator("[data-quantity]")).toHaveText("보유 2개");
    await expect(page.locator("[data-shop-wallet]")).toHaveText("Lv.1 🪙 70");
    // 여러 번 사는 아이템은 사유 growth_purchase (purchase는 아이템마다 한 번)
    expect(await ledger(me, "growth_purchase")).toEqual([
      { exp_delta: 0, coin_delta: -20 },
      { exp_delta: 0, coin_delta: -20 },
    ]);
    // 촉진제는 Lv.3부터
    await expect(page.locator('[data-item="성장 촉진제"]').getByRole("button")).toHaveText("🔒 Lv.3");

    await sql`insert into animals (user_id, source, species, hatched_at) values (${id}, 'first', 'calf', now())`;
    await page.goto("/farm");
    const button = animal(page).getByRole("button", { name: "🌱 동물 먹이 ×2" });
    await button.click();
    await expect(result(page)).toHaveText("🌱 동물 먹이 먹였어요! 성장 +20");
    await expect(animal(page).locator("[data-growth]")).toHaveText("20/160");
    await animal(page).getByRole("button", { name: "🌱 동물 먹이 ×1" }).click();
    await expect(animal(page).locator("[data-growth]")).toHaveText("40/160");
    await expect(animal(page).getByRole("group", { name: "성장 아이템" })).toHaveCount(0);
    expect(await sql`select 1 from user_items ui join items i on i.id = ui.item_id where ui.user_id = ${id} and i.type = 'growth'`).toHaveLength(0);
  });
});
