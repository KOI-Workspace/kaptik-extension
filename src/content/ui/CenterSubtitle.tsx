import { useState, type CSSProperties, type PointerEvent } from "react";
import type { LanguageCode, SubtitleTrack } from "@/types/subtitle";
import type { KaptikSettings } from "@/shared/settings";
import { updateSettings } from "@/shared/settings";
import { resolveMember } from "@/shared/members";
import { Avatar } from "./Avatar";

interface CenterSubtitleProps {
  track: SubtitleTrack;
  activeIndex: number;
  settings: KaptikSettings;
}

/** 한 줄 높이 추정값(px) — 드래그 거리 → 줄 수 환산에 사용 */
const LINE_DRAG_PX = 42;
const MIN_LINES = 1;
const MAX_LINES = 5;

/** 선택 언어 → 영어 → 첫 언어 순으로 텍스트를 고른다. */
function pickText(
  text: Partial<Record<LanguageCode, string>>,
  language: LanguageCode,
): string | null {
  return text[language] ?? text.en ?? Object.values(text)[0] ?? null;
}

/**
 * 영상 가운데 하단 자막 오버레이.
 * 검은 반투명 배경 박스 하나에 최근 발화를 표시한다 (기본 1줄).
 * 박스 상단 핸들을 위/아래로 드래그하면 보이는 줄 수를 조절할 수 있다.
 */
export function CenterSubtitle({
  track,
  activeIndex,
  settings,
}: CenterSubtitleProps) {
  // 드래그 중 임시 줄 수 (놓으면 설정에 저장)
  const [dragLines, setDragLines] = useState<number | null>(null);

  const lineCount =
    dragLines ??
    Math.max(MIN_LINES, Math.min(MAX_LINES, settings.overlayLineCount));

  // 핸들 드래그 → 줄 수 조절 (위로 끌면 늘어남)
  const onHandleDown = (e: PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startCount = lineCount;

    const onMove = (ev: globalThis.PointerEvent) => {
      const delta = startY - ev.clientY; // 위로 이동하면 양수
      const next = Math.max(
        MIN_LINES,
        Math.min(MAX_LINES, startCount + Math.round(delta / LINE_DRAG_PX)),
      );
      setDragLines(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragLines((cur) => {
        if (cur != null) void updateSettings({ overlayLineCount: cur });
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (activeIndex < 0) return null;

  const startIdx = Math.max(0, activeIndex - lineCount + 1);
  const recent = track.cues.slice(startIdx, activeIndex + 1);

  const style = {
    "--font-scale": settings.fontScale,
    "--overlay-opacity": settings.overlayOpacity,
  } as CSSProperties;

  return (
    <div className="kaptik-center" style={style}>
      <div className="kaptik-center-box">
        <button
          type="button"
          className="kaptik-center-handle"
          aria-label="자막 크기 조절 (위아래로 드래그)"
          onPointerDown={onHandleDown}
        />
        {recent.map((cue, i) => {
          const member = resolveMember(track, cue);
          const text = pickText(cue.text, settings.language);
          if (!text) return null;
          const isActive = startIdx + i === activeIndex;
          return (
            <div
              key={cue.start}
              className={"kaptik-center-line" + (isActive ? " is-active" : "")}
            >
              {member && <Avatar member={member} size={26 * settings.fontScale} />}
              <div className="kaptik-center-body">
                {settings.showSpeaker && member && (
                  <span
                    className="kaptik-center-name"
                    style={{ color: member.color }}
                  >
                    {member.name}
                  </span>
                )}
                <span className="kaptik-center-text">{text}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
