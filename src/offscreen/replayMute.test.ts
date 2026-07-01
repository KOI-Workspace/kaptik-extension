import { describe, expect, it } from "vitest";
import {
  CACHED_RANGE_PAD_MS,
  isInsideCachedRange,
  mergeRange,
  REWIND_THRESHOLD_MS,
  shouldMuteReplay,
  type TimeRange,
} from "./replayMute";

describe("shouldMuteReplay", () => {
  it("최전방과 같은 위치(라이브 시청)는 무음 처리하지 않는다", () => {
    expect(shouldMuteReplay(200_000, 200_000)).toBe(false);
  });

  it("최전방보다 임계값 이상 뒤(되감기)면 무음 처리한다", () => {
    // 2:49(169s)로 되감기, 최전방 3:52(232s) → 63초 뒤 → 무음
    expect(shouldMuteReplay(169_000, 232_000)).toBe(true);
  });

  it("임계값 이내의 미세한 뒤처짐(버퍼링 출렁임)은 무음 처리하지 않는다", () => {
    expect(shouldMuteReplay(200_000 - (REWIND_THRESHOLD_MS - 500), 200_000)).toBe(false);
  });

  it("임계값을 막 초과하면 무음 처리한다", () => {
    expect(shouldMuteReplay(200_000 - (REWIND_THRESHOLD_MS + 1), 200_000)).toBe(true);
  });

  it("최전방보다 앞(정상 전진)이면 무음 처리하지 않는다", () => {
    expect(shouldMuteReplay(210_000, 200_000)).toBe(false);
  });

  it("아직 영상 위치를 모르는 초기 상태(0)는 무음 처리하지 않는다", () => {
    expect(shouldMuteReplay(0, 0)).toBe(false);
    expect(shouldMuteReplay(0, 200_000)).toBe(false);
  });
});

describe("mergeRange", () => {
  it("빈 리스트에 구간을 추가한다", () => {
    expect(mergeRange([], [1000, 2000])).toEqual([[1000, 2000]]);
  });

  it("정렬 순서를 유지하며 삽입한다", () => {
    const ranges: TimeRange[] = [[5000, 6000]];
    expect(mergeRange(ranges, [1000, 2000])).toEqual([
      [1000, 2000],
      [5000, 6000],
    ]);
  });

  it("겹치는 구간을 하나로 병합한다", () => {
    expect(mergeRange([[1000, 3000]], [2000, 4000])).toEqual([[1000, 4000]]);
  });

  it("gap이 병합 허용치 이내로 인접하면 합친다", () => {
    // 3000 끝 → 3400 시작 (400ms gap < 500ms) → 병합
    expect(mergeRange([[1000, 3000]], [3400, 5000])).toEqual([[1000, 5000]]);
  });

  it("gap이 병합 허용치를 넘으면 별도 구간으로 둔다", () => {
    // 3000 끝 → 4000 시작 (1000ms gap > 500ms) → 분리
    expect(mergeRange([[1000, 3000]], [4000, 5000])).toEqual([
      [1000, 3000],
      [4000, 5000],
    ]);
  });

  it("여러 구간 사이에 걸치면 모두 하나로 합친다", () => {
    const ranges: TimeRange[] = [
      [1000, 2000],
      [3000, 4000],
      [6000, 7000],
    ];
    // [1500, 5000]은 앞의 두 구간과 겹침 → 하나로, 마지막은 별도
    expect(mergeRange(ranges, [1500, 5000])).toEqual([
      [1000, 5000],
      [6000, 7000],
    ]);
  });

  it("유효하지 않은 구간(end<=start, NaN)은 무시한다", () => {
    const ranges: TimeRange[] = [[1000, 2000]];
    expect(mergeRange(ranges, [3000, 3000])).toBe(ranges);
    expect(mergeRange(ranges, [NaN, 2000])).toBe(ranges);
  });

  it("입력 배열을 변형하지 않는다(순수 함수)", () => {
    const ranges: TimeRange[] = [[1000, 2000]];
    const snapshot = JSON.parse(JSON.stringify(ranges));
    mergeRange(ranges, [5000, 6000]);
    expect(ranges).toEqual(snapshot);
  });
});

describe("isInsideCachedRange", () => {
  const ranges: TimeRange[] = [
    [10_000, 15_000],
    [23_000, 28_000],
  ];

  it("캐시 구간 안이면 true", () => {
    expect(isInsideCachedRange(12_000, ranges)).toBe(true);
    expect(isInsideCachedRange(25_000, ranges)).toBe(true);
  });

  it("캐시되지 않은 gap(15~23s)은 false — 재전사 대상", () => {
    expect(isInsideCachedRange(19_000, ranges)).toBe(false);
  });

  it("모든 구간보다 앞선 새 콘텐츠는 false", () => {
    expect(isInsideCachedRange(30_000, ranges)).toBe(false);
  });

  it("경계는 CACHED_RANGE_PAD_MS 여유 안이면 포함으로 본다", () => {
    expect(isInsideCachedRange(15_000 + CACHED_RANGE_PAD_MS - 1, ranges)).toBe(true);
    expect(isInsideCachedRange(15_000 + CACHED_RANGE_PAD_MS + 100, ranges)).toBe(false);
  });

  it("빈 캐시/초기 상태(0)는 false", () => {
    expect(isInsideCachedRange(12_000, [])).toBe(false);
    expect(isInsideCachedRange(0, ranges)).toBe(false);
  });
});
