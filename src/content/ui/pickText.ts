import type { LanguageCode } from "@/types/subtitle";

/**
 * 자막 cue의 다국어 텍스트에서 보여줄 문자열을 고른다.
 * 선택 언어 → 영어(en) → 첫 번째 언어 순으로 폴백한다.
 *
 * 빈 문자열("")은 "값 없음"으로 취급해 다음 언어로 넘어간다(`||` 사용).
 * 번역이 아직 비어 있을 때 인니어(id) 등 라틴 문자 언어가 빈 칸으로 멈추지 않고
 * 영어로라도 폴백되도록 하기 위함이다.
 *
 * 가운데 오버레이(CenterSubtitle)와 우측 패널(SidePanel)이 반드시 같은 결과를
 * 보여주도록, 이 함수 하나만 공유한다. (과거 두 곳에 복붙되어 ||/?? 가 어긋났던 버그 방지)
 */
export function pickText(
  text: Partial<Record<LanguageCode, string>>,
  language: LanguageCode,
): string | null {
  return text[language] || text.en || Object.values(text)[0] || null;
}
