/**
 * 라이브 되감기(DVR rewind) 구간 판정.
 *
 * 위버스 라이브는 탭 오디오를 캡처하므로, 사용자가 뒤로 되감으면 이미 자막이 만들어진 구간의
 * 소리가 다시 재생되고 그대로 서버로 전송되어 같은 발화가 다른 타임스탬프로 재전사된다.
 * 이를 막기 위해, 지금까지 도달한 최대 영상 위치(maxVideoMs, 라이브 최전방)보다 일정 이상
 * 뒤에 있으면 "되감아 다시 듣는 중"으로 보고 그 오디오를 서버에 보내지 않는다(무음 처리).
 *
 * 진짜 새 발화는 항상 최전방 위에 있으므로 텍스트 비교 없이 위치만으로 안전하게 구별된다.
 */

// 되감기로 판정하기 위한 최소 뒤처짐(ms). 버퍼링·미세한 currentTime 출렁임을 되감기로
// 오판하지 않도록 여유를 둔다.
export const REWIND_THRESHOLD_MS = 3000;

/**
 * 현재 영상 위치가 라이브 최전방보다 충분히 뒤에 있으면(되감기 재생 중) true.
 * @param latestVideoMs 현재 영상 재생 위치(ms)
 * @param maxVideoMs 지금까지 도달한 최대 영상 위치(ms)
 */
export function shouldMuteReplay(latestVideoMs: number, maxVideoMs: number): boolean {
  if (!Number.isFinite(latestVideoMs) || latestVideoMs <= 0) return false;
  return latestVideoMs < maxVideoMs - REWIND_THRESHOLD_MS;
}
