import type { SubtitleTrack } from "@/types/subtitle";
import { useActiveIndex, useSettings } from "../hooks";
import { CenterSubtitle } from "./CenterSubtitle";
import { SidePanel } from "./SidePanel";

interface DisplayProps {
  video: HTMLVideoElement;
  track: SubtitleTrack;
}

/**
 * 자막 UI 루트.
 * 단일 rAF(useActiveIndex)와 단일 설정 구독을 공유해
 * 가운데 오버레이와 우측 패널에 동시에 전달한다.
 */
export function Display({ video, track }: DisplayProps) {
  const settings = useSettings();
  const activeIndex = useActiveIndex(video, track.cues);

  if (!settings.enabled) return null;

  return (
    <div className={"kaptik-root" + (settings.showPanel ? " has-panel" : "")}>
      <CenterSubtitle track={track} activeIndex={activeIndex} settings={settings} />
      {settings.showPanel && (
        <SidePanel
          video={video}
          track={track}
          activeIndex={activeIndex}
          settings={settings}
        />
      )}
    </div>
  );
}
