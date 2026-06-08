import type { SiteAdapter } from "./types";

/**
 * YouTube 어댑터.
 * - 영상 ID: URL 쿼리 ?v= 또는 /shorts/<id> 경로
 * - 컨테이너: #movie_player (전체화면에서도 자막 유지)
 */
export const youtubeAdapter: SiteAdapter = {
  platform: "youtube",

  matches(url) {
    try {
      return /(^|\.)youtube\.com$/.test(new URL(url).hostname);
    } catch {
      return false;
    }
  },

  getVideoId(url) {
    try {
      const u = new URL(url);
      const v = u.searchParams.get("v");
      if (v) return v;
      // Shorts: /shorts/<id>
      const shorts = u.pathname.match(/\/shorts\/([\w-]+)/);
      if (shorts) return shorts[1];
      return null;
    } catch {
      return null;
    }
  },

  getVideoElement() {
    return (
      (document.querySelector("video.html5-main-video") as HTMLVideoElement | null) ??
      (document.querySelector("#movie_player video") as HTMLVideoElement | null) ??
      (document.querySelector("video") as HTMLVideoElement | null)
    );
  },

  getOverlayContainer() {
    return (
      (document.querySelector("#movie_player") as HTMLElement | null) ??
      (document.querySelector(".html5-video-player") as HTMLElement | null)
    );
  },
};
