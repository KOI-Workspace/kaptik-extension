/**
 * YouTube 인증 자격증명 수집.
 * yt-dlp가 클라우드 서버 IP 차단을 우회할 수 있도록
 * 실제 사용자 브라우저 세션 정보를 백엔드에 전달한다.
 */

/** YouTube 도메인 쿠키 수집 (yt-dlp cookiefile용) */
export async function getYtCookies(): Promise<chrome.cookies.Cookie[]> {
  try {
    return await chrome.cookies.getAll({ domain: ".youtube.com" });
  } catch (e) {
    console.warn("[Kaptik] YouTube 쿠키 수집 실패:", e);
    return [];
  }
}

/**
 * YouTube 페이지의 PO Token 추출 시도.
 * 현재 활성 YouTube 탭 content script에 메시지를 보내
 * 페이지 JS 컨텍스트에서 `ytcfg` PO Token을 읽어온다.
 * 실패 시 undefined 반환 (yt-dlp는 없어도 동작하나 차단 가능성 높아짐).
 */
export async function getPoToken(): Promise<string | undefined> {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
      url: "*://*.youtube.com/*",
    });
    if (!tab?.id) return undefined;
    const result = await chrome.tabs.sendMessage(tab.id, { type: "GET_PO_TOKEN" });
    return typeof result === "string" && result.length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
}
