import { describe, it, expect, afterEach } from "vitest";
import { findVideoBox } from "./heuristics";

/**
 * findVideoBox: video 크기 기준으로 오버레이를 붙일 조상 요소를 추론한다.
 * 위버스처럼 새로고침 직후 video가 아직 레이아웃되지 않은(가로폭 0) 상태에서
 * 엉뚱한 작은 박스를 "찾음"으로 잘못 반환하던 버그의 회귀 방지용.
 */

/** rect를 가진 요소를 만들어 부모에 붙인다. */
function makeEl(rect: Partial<DOMRect>): HTMLDivElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {}, ...rect }) as DOMRect;
  return el;
}

describe("findVideoBox", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("video가 아직 레이아웃 전(가로폭 0)이면 null — 잘못된 작은 박스를 반환하지 않는다", () => {
    const outer = makeEl({ width: 640, height: 360 });
    const inner = makeEl({ width: 640, height: 360 });
    const video = document.createElement("video");
    video.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;

    document.body.appendChild(outer);
    outer.appendChild(inner);
    inner.appendChild(video);

    expect(findVideoBox(video)).toBeNull();
  });

  it("정상 레이아웃이면 video와 같은 크기인 가장 바깥 조상까지 끌어올린다", () => {
    const outer = makeEl({ width: 640, height: 360 });
    const inner = makeEl({ width: 640, height: 360 });
    const video = document.createElement("video");
    video.getBoundingClientRect = () => ({ width: 640, height: 360 }) as DOMRect;

    document.body.appendChild(outer);
    outer.appendChild(inner);
    inner.appendChild(video);

    expect(findVideoBox(video)).toBe(outer);
  });

  it("조상이 video보다 눈에 띄게 크면 더 이상 올라가지 않는다", () => {
    const outer = makeEl({ width: 1200, height: 800 });
    const inner = makeEl({ width: 640, height: 360 });
    const video = document.createElement("video");
    video.getBoundingClientRect = () => ({ width: 640, height: 360 }) as DOMRect;

    document.body.appendChild(outer);
    outer.appendChild(inner);
    inner.appendChild(video);

    expect(findVideoBox(video)).toBe(inner);
  });
});
