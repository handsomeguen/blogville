import { expect, test } from "./fixtures";

// 🍽 식당 상세의 블로그 후기 카드: 대표 사진·협찬/내돈내산 표시·[협찬 빼고]. 시험 서버에 네이버 열쇠가 없으면 건너뛴다.
// 협찬 판별 규칙은 tests/unit/food.test.ts (analyzeReviewPage)
test("후기 카드에 사진·협찬 표시가 있고 [협찬 빼고]로 거른다", async ({ page }) => {
  await page.goto("/food?tab=search&q=%EC%98%81%EB%AF%B8%EC%98%A4%EB%A6%AC%ED%83%95&place=100");
  const list = page.locator("[data-food-reviews]");
  test.skip((await list.count()) === 0, "열쇠가 없는 시험 서버");
  const all = await list.locator("li").count();
  const sponsored = await list.locator("[data-sponsored]").count();
  test.skip(sponsored === 0, "협찬 글이 없는 자료");
  await expect(list.locator('a[target="_blank"]').first()).toHaveAttribute("rel", /noopener/);
  await page.locator("[data-hide-sponsored]").click();
  await expect(list.locator("li")).toHaveCount(all - sponsored);
  await expect(list.locator("[data-sponsored]")).toHaveCount(0);
});
