import { describe, it, expect } from "vitest";
import { detectLiveFromVideo } from "./liveDetection";

/**
 * detectLiveFromVideo: video.duration으로 실시간 라이브/녹화(replay)를 구분.
 * 광고·라이브 오판이 반복된 영역이라 핵심 점검 대상.
 */
describe("detectLiveFromVideo 라이브 판별", () => {
  it("duration이 무한이면 실시간 라이브", () => {
    expect(detectLiveFromVideo({ duration: Infinity }, false)).toBe(true);
  });

  it("duration이 유한하면 녹화(replay) — URL이 라이브여도 false", () => {
    // Weverse 종료된 라이브: URL은 /live/지만 다시보기이므로 라이브가 아니다
    expect(detectLiveFromVideo({ duration: 3600 }, true)).toBe(false);
  });

  it("메타데이터 로딩 전(NaN)이면 URL 힌트를 따른다", () => {
    expect(detectLiveFromVideo({ duration: NaN }, true)).toBe(true);
    expect(detectLiveFromVideo({ duration: NaN }, false)).toBe(false);
  });

  it("duration이 0이면 URL 힌트를 따른다", () => {
    expect(detectLiveFromVideo({ duration: 0 }, true)).toBe(true);
  });
});
