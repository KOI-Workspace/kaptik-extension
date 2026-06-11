/**
 * 조건을 만족하는 값이 나올 때까지 폴링한다.
 * @param getter 값을 반환하는 함수 (null/undefined면 미충족)
 * @param timeoutMs 최대 대기 시간(ms)
 * @param intervalMs 폴링 간격(ms)
 * @returns 값 또는 timeout 시 null
 */
export function waitFor<T>(
  getter: () => T | null | undefined,
  timeoutMs = 10000,
  intervalMs = 250,
): Promise<T | null> {
  return new Promise((resolve) => {
    const immediate = getter();
    if (immediate != null) {
      resolve(immediate);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      const value = getter();
      if (value != null) {
        clearInterval(timer);
        resolve(value);
      } else if (Date.now() - start >= timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, intervalMs);
  });
}

/**
 * SPA 환경에서 URL 변경을 감지한다.
 * history.pushState/replaceState 패치 + popstate + YouTube 전용 이벤트를 함께 사용.
 * @param onChange URL이 바뀔 때 호출되는 콜백
 * @returns 구독 해제 함수
 */
export function watchUrlChanges(onChange: () => void): () => void {
  let lastUrl = location.href;

  const fire = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onChange();
    }
  };

  const originalPush = history.pushState;
  const originalReplace = history.replaceState;

  history.pushState = function (...args: Parameters<History["pushState"]>) {
    const result = originalPush.apply(this, args);
    fire();
    return result;
  };
  history.replaceState = function (...args: Parameters<History["replaceState"]>) {
    const result = originalReplace.apply(this, args);
    fire();
    return result;
  };

  const onPopState = () => fire();
  // YouTube SPA 네비게이션 완료 이벤트 — URL이 실제로 바뀐 경우에만 onChange 호출
  const onYtNavigate = () => fire();

  window.addEventListener("popstate", onPopState);
  window.addEventListener("yt-navigate-finish", onYtNavigate);

  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("yt-navigate-finish", onYtNavigate);
  };
}
