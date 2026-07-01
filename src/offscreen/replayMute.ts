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

// 이미 자막이 만들어진 영상 구간(ms). [start, end] 쌍. 재생 위치가 이 안이면 재전사를 막기 위해 무음 처리한다.
export type TimeRange = [number, number];

// 재생 위치가 캐시 구간 경계에서 이 여유(ms) 안에 있으면 구간 내부로 본다.
// UPDATE_VIDEO_TIME 폴링 지연(최대 500ms)으로 경계에서 오디오가 새는 것을 흡수한다.
export const CACHED_RANGE_PAD_MS = 500;
// 겹치거나 이 간격(ms) 이내로 인접한 구간은 하나로 병합한다. 리스트가 조각나거나 무한히 커지지 않게 한다.
const RANGE_MERGE_GAP_MS = 500;

/**
 * 정렬(start 오름차순) + 병합(비중첩) 상태를 유지하며 새 구간을 삽입한다.
 * 겹치거나 gap이 RANGE_MERGE_GAP_MS 이내인 이웃과 하나로 합친다.
 * 순수 함수 — 입력을 변형하지 않고 새 배열을 반환한다.
 */
export function mergeRange(ranges: TimeRange[], range: TimeRange): TimeRange[] {
  const [start, end] = range;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return ranges;
  const all: TimeRange[] = [...ranges, [start, end] as TimeRange].sort((a, b) => a[0] - b[0]);
  const out: TimeRange[] = [];
  for (const [s, e] of all) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + RANGE_MERGE_GAP_MS) {
      last[1] = Math.max(last[1], e);
    } else {
      out.push([s, e]);
    }
  }
  return out;
}

/**
 * 현재 재생 위치(ms)가 캐시된 자막 구간 안에 있으면(경계는 CACHED_RANGE_PAD_MS 여유) true.
 * ranges는 mergeRange로 정렬·병합된 상태라고 가정한다.
 */
export function isInsideCachedRange(latestVideoMs: number, ranges: TimeRange[]): boolean {
  if (!Number.isFinite(latestVideoMs) || latestVideoMs <= 0) return false;
  return ranges.some(
    ([s, e]) => latestVideoMs >= s - CACHED_RANGE_PAD_MS && latestVideoMs <= e + CACHED_RANGE_PAD_MS,
  );
}
