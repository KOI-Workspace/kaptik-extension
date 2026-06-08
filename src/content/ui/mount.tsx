import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SubtitleTrack } from "@/types/subtitle";
import { Display } from "./Display";
// CSS를 문자열로 가져와 Shadow DOM에 주입 (외부 사이트와 격리)
import displayCss from "./display.css?inline";

const HOST_ID = "kaptik-display-host";

/** 마운트 결과 핸들 — 정리(unmount)에 사용 */
export interface DisplayHandle {
  destroy(): void;
}

/**
 * 자막 UI(가운데 오버레이 + 우측 패널)를 플레이어 위에 Shadow DOM으로 마운트한다.
 * @param container 플레이어 래퍼 (상대 위치 보장 처리)
 * @param video 자막 동기화 기준 video
 * @param track 자막 트랙
 */
export function mountDisplay(
  container: HTMLElement,
  video: HTMLVideoElement,
  track: SubtitleTrack,
): DisplayHandle {
  // 중복 마운트 방지
  container.querySelector(`#${HOST_ID}`)?.remove();

  // 자막 UI가 컨테이너 기준으로 절대 배치되도록 보장
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText =
    "position:absolute;inset:0;pointer-events:none;border:0;margin:0;padding:0;";

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = displayCss;
  shadow.appendChild(style);

  const mountPoint = document.createElement("div");
  shadow.appendChild(mountPoint);

  container.appendChild(host);

  let root: Root | null = createRoot(mountPoint);
  root.render(
    <StrictMode>
      <Display video={video} track={track} />
    </StrictMode>,
  );

  return {
    destroy() {
      root?.unmount();
      root = null;
      host.remove();
    },
  };
}
