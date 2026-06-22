/**
 * 실제 라이브 여부를 video.duration으로 판정한다.
 * Weverse는 종료된 라이브(다시보기)도 URL이 `/live/`로 유지되어 URL만으론 구분이 안 된다.
 * duration이 Infinity면 실시간 라이브, 유한하면 녹화(replay)다.
 * 메타데이터 로딩 전(NaN)이면 URL 힌트로 폴백한다.
 *
 * 순수 함수로 분리해 영상 없이도 단위 테스트가 가능하다.
 */
export function detectLiveFromVideo(
  video: Pick<HTMLVideoElement, "duration">,
  urlHint: boolean,
): boolean {
  const d = video.duration;
  if (Number.isFinite(d) && d > 0) return false; // 유한 길이 = 녹화(replay)
  if (d === Infinity) return true; // 무한 = 실시간 라이브
  return urlHint; // 판단 불가 → URL 힌트
}
