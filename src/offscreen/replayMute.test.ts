import { describe, expect, it } from "vitest";
import { REWIND_THRESHOLD_MS, shouldMuteReplay } from "./replayMute";

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
