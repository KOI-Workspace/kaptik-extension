import { describe, it, expect } from "vitest";
import { pickText } from "./pickText";

/**
 * pickText: 자막에서 보여줄 언어를 고르는 함수.
 * 가운데 오버레이와 우측 패널이 반드시 같은 결과를 내야 하므로 핵심 점검 대상.
 */
describe("pickText 언어 폴백", () => {
  it("선택 언어가 있으면 그 언어를 보여준다", () => {
    expect(pickText({ ko: "안녕", en: "hi", id: "halo" }, "id")).toBe("halo");
  });

  it("선택 언어가 없으면 영어로 폴백한다", () => {
    expect(pickText({ ko: "안녕", en: "hi" }, "id")).toBe("hi");
  });

  it("선택 언어도 영어도 없으면 첫 번째 언어로 폴백한다", () => {
    expect(pickText({ ko: "안녕" }, "id")).toBe("안녕");
  });

  it("선택 언어가 빈 문자열이면 다음 언어로 폴백한다 (번역 미완료 케이스)", () => {
    // 인니어(id) 번역이 아직 비어 있을 때 빈 칸이 아니라 영어로 폴백해야 한다
    expect(pickText({ ko: "안녕", en: "hi", id: "" }, "id")).toBe("hi");
  });

  it("모두 비어 있으면 null을 반환한다", () => {
    expect(pickText({ id: "", en: "" }, "id")).toBeNull();
    expect(pickText({}, "id")).toBeNull();
  });
});
