import type { Member } from "@/types/subtitle";
import { memberInitial } from "@/shared/members";

interface AvatarProps {
  member: Member;
  /** 지름(px) */
  size: number;
}

/**
 * 멤버 아바타. 프로필 이미지가 있으면 사용하고,
 * 없으면 시그니처 컬러 링 + 이니셜로 대체한다.
 */
export function Avatar({ member, size }: AvatarProps) {
  const style = {
    width: size,
    height: size,
    borderColor: member.color,
  } as const;

  if (member.avatarUrl) {
    return (
      <img
        className="kaptik-avatar"
        src={member.avatarUrl}
        alt={member.name}
        style={style}
      />
    );
  }

  return (
    <div
      className="kaptik-avatar kaptik-avatar--initial"
      style={{ ...style, color: member.color, fontSize: size * 0.42 }}
      aria-hidden
    >
      {memberInitial(member)}
    </div>
  );
}
