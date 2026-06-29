import type { LanguageCode, SubtitleCue } from "@/types/subtitle";

function normalizeCueEnds(cues: SubtitleCue[]): SubtitleCue[] {
  return cues.map((cue, index) => {
    const next = cues[index + 1];
    if (!next) return cue;
    const nextBoundedEnd = Math.max(cue.start + 1.2, next.start - 0.1);
    return { ...cue, end: Math.min(cue.end, nextBoundedEnd) };
  });
}

/**
 * 라이브 cue를 시간순 목록에 추가한다.
 * 서버가 같은 발화를 부분/반복 업데이트로 보내도 한 줄로 합쳐 패널 중복과 클릭 오차를 줄인다.
 */
export function upsertLiveCue(cues: SubtitleCue[], cue: SubtitleCue, language: string): SubtitleCue[] {
  const nextCues = [...cues];
  
  const existingIdx = cue.utteranceId
    ? nextCues.findIndex((c) => c.utteranceId === cue.utteranceId)
    // fallback for legacy cues without utteranceId
    : nextCues.findIndex((c) => Math.abs(c.start - cue.start) < 0.1 && c.speakerId === cue.speakerId);

  if (existingIdx >= 0) {
    const existing = nextCues[existingIdx];
    const lang = language as LanguageCode;
    nextCues[existingIdx] = {
      ...existing,
      ...cue,
      start: Math.min(existing.start, cue.start),
      end: Math.max(existing.end, cue.end),
      text: {
        ...existing.text,
        ...cue.text,
        ko: cue.text.ko ?? existing.text.ko,
        [lang]: cue.text[lang] ?? existing.text[lang],
      }
    };
  } else {
    nextCues.push(cue);
  }

  nextCues.sort((a, b) => a.start - b.start);
  return normalizeCueEnds(nextCues);
}

export function compactLiveCues(cues: SubtitleCue[], language: string): SubtitleCue[] {
  return cues
    .slice()
    .sort((a, b) => a.start - b.start)
    .reduce<SubtitleCue[]>((acc, cue) => upsertLiveCue(acc, cue, language), []);
}
