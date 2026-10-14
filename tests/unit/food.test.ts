import { describe, expect, it } from "vitest";
import {
  analyzeReviewPage,
  buzzLabel,
  cleanText,
  countRecent,
  dedupePlaces,
  distanceLabel,
  mobileBlogUrl,
  parseCoords,
  parseFoodQuery,
  parseKakaoPlaces,
  parseNaverPlaces,
  parseReviews,
  rankByBuzz,
  reviewWriteHref,
  shortCategory,
} from "@/lib/food";

describe("🍽 맛집 규칙", () => {
  it("검색어·좌표를 정리하고 한국 밖 좌표는 버린다", () => {
    expect(parseFoodQuery("  광주   오리탕 ")).toBe("광주 오리탕");
    expect(parseFoodQuery("   ")).toBeNull();
    expect(parseFoodQuery("가".repeat(40))).toHaveLength(30);
    expect(parseCoords("35.15987", "126.85123")).toEqual({ lat: 35.16, lng: 126.851 });
    expect(parseCoords("40.7", "-74")).toBeNull();
    expect(parseCoords(undefined, "126")).toBeNull();
  });

  it("카카오 장소를 식당으로 바꾼다 (도로명 우선, 시·도 줄임, https 지도)", () => {
    const [p] = parseKakaoPlaces({
      documents: [
        {
          id: "123",
          place_name: "영미오리탕",
          category_name: "음식점 > 한식 > 오리",
          road_address_name: "광주광역시 북구 경양로 126",
          address_name: "광주 북구 유동 1",
          phone: "062-000-0000",
          place_url: "http://place.map.kakao.com/123",
          x: "126.9",
          y: "35.1",
          distance: "420",
        },
        { id: 5, place_name: "" },
      ],
    });
    expect(p).toMatchObject({ id: "123", name: "영미오리탕", category: "한식 > 오리", address: "광주 북구 경양로 126", mapUrl: "https://place.map.kakao.com/123", lat: 35.1, lng: 126.9, distance: 420 });
    expect(parseKakaoPlaces(null)).toEqual([]);
  });

  it("네이버 지역 검색: <b> 지우고, 예전 정수 좌표도 받는다", () => {
    const [p] = parseNaverPlaces({ items: [{ title: "<b>광주</b> 송정떡갈비", category: "한식>육류,고기요리", roadAddress: "광주광역시 광산구 광산로29번길 1", mapx: "1267930000", mapy: "351390000" }] });
    expect(p.name).toBe("광주 송정떡갈비");
    expect(p.category).toBe("한식 > 육류,고기요리");
    expect(p.lng).toBeCloseTo(126.793);
    expect(p.lat).toBeCloseTo(35.139);
    expect(p.mapUrl).toContain("map.naver.com");
  });

  it("블로그 후기와 최근 30일 수", () => {
    const reviews = parseReviews({
      items: [
        { title: "맛있는 <b>오리탕</b> &amp; 미나리", link: "https://blog.naver.com/a/1", description: "국물이 진해요", bloggername: "먹보", postdate: "20261010" },
        { title: "예전 후기", link: "https://blog.naver.com/a/2", postdate: "20260801" },
        { title: "링크 없음", link: "javascript:alert(1)", postdate: "20261010" },
      ],
    });
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({ title: "맛있는 오리탕 & 미나리", date: "2026-10-10", blogger: "먹보" });
    expect(countRecent(reviews, "2026-10-14")).toBe(1);
  });

  it("같은 가게는 한 번만, 최근 언급 많은 순 (같으면 원래 순서)", () => {
    const base = { category: "", phone: "", mapUrl: "", lat: null, lng: null, distance: null };
    const list = dedupePlaces([
      { ...base, id: "a", name: "가 식당", address: "광주 북구 1" },
      { ...base, id: "b", name: "가식당", address: "광주 북구 2" },
      { ...base, id: "c", name: "나 식당", address: "광주 남구 1" },
    ]);
    expect(list.map((p) => p.id)).toEqual(["a", "c"]);
    const ranked = rankByBuzz([
      { ...list[0], recent: 3 },
      { ...list[1], recent: 9 },
      { ...list[0], id: "d", recent: 3 },
    ]);
    expect(ranked.map((p) => p.id)).toEqual(["c", "a", "d"]);
  });

  it("글자 모양", () => {
    expect(shortCategory("음식점 > 한식 > 국밥 > 순대국")).toBe("국밥 > 순대국");
    expect(cleanText("&#39;맛&#39;")).toBe("'맛'");
    expect(buzzLabel(0)).toBe("최근 한 달 블로그 글 없음");
    expect(buzzLabel(100)).toContain("100편 넘게");
    expect(distanceLabel(340)).toBe("340m");
    expect(distanceLabel(1234)).toBe("1.2km");
    expect(reviewWriteHref({ name: "가&나", address: "광주", mapUrl: "https://x", category: "한식" })).toBe(
      "/write?place_name=%EA%B0%80%26%EB%82%98&place_address=%EA%B4%91%EC%A3%BC&place_url=https%3A%2F%2Fx&place_category=%ED%95%9C%EC%8B%9D",
    );
  });
});

describe("블로그 후기 카드: 대표 사진·협찬 표시 (analyzeReviewPage)", () => {
  const page = (body: string, og = "https://blogthumb.pstatic.net/a/b.jpg?type=w2") =>
    `<html><head><meta property="og:image" content="${og}"/></head><body><div class="se-main-container">${body}</div></body></html>`;
  it("og:image는 네이버(pstatic) 사진만", () => {
    expect(analyzeReviewPage(page("맛있다")).image).toBe("https://blogthumb.pstatic.net/a/b.jpg?type=w2");
    expect(analyzeReviewPage(page("맛있다", "https://evil.example/x.jpg")).image).toBeNull();
  });
  it.each([
    ["업체로부터 제품을 제공받아 솔직하게 작성했습니다", "yes"],
    ["소정의 원고료를 받고 작성한 후기입니다", "yes"],
    ["#협찬 #광주맛집", "yes"],
    ["레뷰 체험단으로 다녀왔어요", "yes"],
    ["오늘은 협찬으로 다녀온 곳", "yes"],
    ["여긴 협찬 아니고 직접 구매해서 먹었는데도 진짜 인정한다", "no"],
    ["(아무리 협찬일지라도 맛없으면 티난다) 내돈내산 후기", "no"],
    ["그냥 맛있었다", null],
  ] as const)("%s → %s", (body, want) => {
    expect(analyzeReviewPage(page(body)).sponsored).toBe(want);
  });
  it("관련 글 목록 등 본문 앞부분(헤더)의 협찬은 보지 않는다", () => {
    expect(analyzeReviewPage(`<title>협찬 받은 글</title>${page("그냥 맛있었다")}`).sponsored).toBeNull();
  });
  it("네이버 블로그 주소만 모바일 주소로", () => {
    expect(mobileBlogUrl("https://blog.naver.com/abc_1/224436664230")).toBe("https://m.blog.naver.com/abc_1/224436664230");
    expect(mobileBlogUrl("https://m.blog.naver.com/abc/224436664230?x=1")).toBe("https://m.blog.naver.com/abc/224436664230");
    expect(mobileBlogUrl("https://tistory.com/abc/1")).toBeNull();
  });
});
