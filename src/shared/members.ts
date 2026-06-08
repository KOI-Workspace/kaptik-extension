import type { Member, SubtitleCue, SubtitleTrack } from "@/types/subtitle";

/**
 * 기본 멤버 레지스트리 (데모용 BTS).
 * 실제 서비스에서는 Kaptik API가 멤버 메타데이터(이름/컬러/프로필)를 내려준다.
 * 색상은 멤버별로 구분되며, Weverse 브랜드 그린(#05F048)은 사용하지 않는다.
 */
export const DEFAULT_MEMBERS: Record<string, Member> = {
  rm: { id: "rm", name: "RM", color: "#7E8AFF" },
  jin: { id: "jin", name: "Jin", color: "#FF74A6" },
  suga: { id: "suga", name: "Suga", color: "#F5A03C" },
  jhope: { id: "jhope", name: "j-hope", color: "#FFD45C" },
  jimin: { id: "jimin", name: "Jimin", color: "#5BC0EB" },
  v: { id: "v", name: "V", color: "#3FB9A8" },
  jungkook: { id: "jungkook", name: "Jungkook", color: "#B488FF" },
};

/** 알 수 없는 화자를 위한 폴백 컬러 팔레트 */
const FALLBACK_COLORS = [
  "#7E8AFF",
  "#FF74A6",
  "#F5A03C",
  "#5BC0EB",
  "#3FB9A8",
  "#B488FF",
  "#FFD45C",
];

/** 문자열을 안정적인 색상 인덱스로 변환 */
function hashColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

/**
 * 큐의 화자 멤버 정보를 해석한다.
 * track.members 에 없으면 id를 이름으로 쓰는 폴백 멤버를 생성한다.
 */
export function resolveMember(
  track: SubtitleTrack,
  cue: SubtitleCue,
): Member | null {
  if (!cue.speakerId) return null;
  const found = track.members[cue.speakerId];
  if (found) return found;
  return {
    id: cue.speakerId,
    name: cue.speakerId,
    color: hashColor(cue.speakerId),
  };
}

/** 아바타 이니셜 (이미지 없을 때 사용) */
export function memberInitial(member: Member): string {
  return member.name.trim().charAt(0).toUpperCase();
}
