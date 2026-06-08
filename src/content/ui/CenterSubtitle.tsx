import type { CSSProperties } from "react";
import type { LanguageCode, SubtitleTrack } from "@/types/subtitle";
import type { KaptikSettings } from "@/shared/settings";
import { resolveMember } from "@/shared/members";
import { Avatar } from "./Avatar";

interface CenterSubtitleProps {
  track: SubtitleTrack;
  activeIndex: number;
  settings: KaptikSettings;
}

/** 선택 언어 → 영어 → 첫 언어 순으로 텍스트를 고른다. */
function pickText(
  text: Partial<Record<LanguageCode, string>>,
  language: LanguageCode,
): string | null {
  return text[language] ?? text.en ?? Object.values(text)[0] ?? null;
}

/**
 * 영상 가운데 하단 자막 오버레이.
 * 설정한 문장 수만큼 최근 발화를 아바타+멤버명+대사 형태로 보여준다.
 * 가장 최근(활성) 줄은 또렷하게, 이전 줄은 흐리게 표시한다.
 */
export function CenterSubtitle({
  track,
  activeIndex,
  settings,
}: CenterSubtitleProps) {
  if (activeIndex < 0) return null;

  const count = Math.max(1, Math.min(3, settings.overlayLineCount));
  const startIdx = Math.max(0, activeIndex - count + 1);
  const recent = track.cues.slice(startIdx, activeIndex + 1);

  const style = { "--font-scale": settings.fontScale } as CSSProperties;

  return (
    <div className="kaptik-center" style={style}>
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
            {member && (
              <Avatar member={member} size={28 * settings.fontScale} />
            )}
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
  );
}
