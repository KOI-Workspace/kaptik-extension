import type { SiteAdapter } from "./types";
import { findVideoBox, findDockColumn } from "./heuristics";

/**
 * Weverse 어댑터.
 * Weverse는 SPA이며 라이브/미디어/모먼트 등 경로 구조가 다양하고,
 * DOM 클래스명이 빌드마다 해시로 바뀐다. 그래서 고정 셀렉터 대신
 * video 요소 기준의 위치·크기 추론(heuristics)으로 견고성을 확보한다.
 */
export const weverseAdapter: SiteAdapter = {
  platform: "weverse",
  // 위버스는 yt-dlp 음성 추출이 불가능해 라이브/VOD 모두 오디오 캡처 경로를 사용한다
  alwaysCapture: true,

  matches(url) {
    try {
      return /(^|\.)weverse\.io$/.test(new URL(url).hostname);
    } catch {
      return false;
    }
  },

  getVideoId(url) {
    try {
      const pathname = new URL(url).pathname;
      // 예: /bts/live/2-12345, /bts/media/4-67890, /artist/moment/...
      const m = pathname.match(/([0-9]+-[0-9]+)/);
      if (m) return m[1];
      // 마지막 경로 세그먼트라도 식별자로 사용
      const segments = pathname.split("/").filter(Boolean);
      return segments.length ? segments[segments.length - 1] : null;
    } catch {
      return null;
    }
  },

  getVideoElement() {
    return document.querySelector("video") as HTMLVideoElement | null;
  },

  getOverlayContainer() {
    const video = this.getVideoElement();
    return video ? findVideoBox(video) : null;
  },

  getPanelContainer() {
    const video = this.getVideoElement();
    return video ? findDockColumn(video) : null;
  },

  isLive(url: string): boolean {
    try {
      return new URL(url).pathname.includes("/live/");
    } catch {
      return false;
    }
  },

  /**
   * 광고 재생 여부.
   * 위버스 본편 영상은 blob: URL(MSE)에서 재생되고, 광고는 일반 https URL(구글 광고 CDN 등)에서
   * 재생된다(실제 로그 확인: 본편=blob:weverse.io, 광고=https://redirector.gvt1.com).
   * 광고는 별도 video 요소를 쓰므로 페이지의 모든 video를 훑는다.
   *
   * 오판(본편/미리보기를 광고로 착각) 방지를 위해 아래를 모두 만족해야 광고로 본다:
   * - src가 blob:(위버스 본편)이 아님
   * - 실제 재생 중(일시정지/종료 아님)이고 미디어가 로딩됨
   * - 음소거가 아님(소리 남) — 음소거된 자동재생 썸네일 등을 광고로 오판하지 않도록.
   *   (음소거 광고는 탭 소리 자체가 무음이라 어차피 자막이 안 생기므로 제외해도 안전)
   * 이 방식은 구글이 아닌 광고 업체여도 "blob 아닌 소리나는 영상"으로 잡아낸다.
   */
  isAdPlaying() {
    const pageText = document.body?.innerText?.slice(0, 3000) ?? "";
    if (/\b(skip ad|sponsored|advertisement)\b/i.test(pageText) || /광고\s*건너뛰기/.test(pageText)) {
      return true;
    }

    const videos = Array.from(document.querySelectorAll("video"));
    return videos.some((v) => {
      const src = v.currentSrc || "";
      const isPlaying = !v.paused && !v.ended && !v.muted && v.readyState >= 2;
      if (!isPlaying) return false;

      const rect = v.getBoundingClientRect();
      const isVisible = rect.width > 80 && rect.height > 45;
      if (!isVisible) return false;

      if (/doubleclick|googlesyndication|gvt1|googlevideo|adservice/i.test(src)) return true;
      if (!src || src.startsWith("blob:")) return false; // 본편(weverse blob)
      return true;
    });
  },
};
