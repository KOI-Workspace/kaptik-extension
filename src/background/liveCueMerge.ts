import type { LanguageCode, SubtitleCue } from "@/types/subtitle";

function normalizeCueEnds(cues: SubtitleCue[]): SubtitleCue[] {
  return cues.map((cue, index) => {
    const next = cues[index + 1];
    if (!next) return cue;
    const nextBoundedEnd = Math.max(cue.start + 1.2, next.start - 0.1);
    const newEnd = Math.min(cue.end, nextBoundedEnd);
    if (newEnd === cue.end) return cue;
    return { ...cue, end: newEnd };
  });
}

/**
 * 라이브 cue를 시간순 목록에 추가한다.
 * 서버가 같은 발화를 부분/반복 업데이트로 보내도 한 줄로 합쳐 패널 중복과 클릭 오차를 줄인다.
 */
export function upsertLiveCue(cues: SubtitleCue[], cue: SubtitleCue, language: string): SubtitleCue[] {
  const nextCues = [...cues];
  
  // uid 우선 매칭, 실패 시 timestamp+speakerId fallback (uid 없는 구형 cue 포함)
  let existingIdx = cue.utteranceId
    ? nextCues.findIndex((c) => c.utteranceId === cue.utteranceId)
    : -1;
  if (existingIdx < 0) {
    existingIdx = nextCues.findIndex(
      (c) => Math.abs(c.start - cue.start) < 0.1 && c.speakerId === cue.speakerId,
    );
  }
  // 텍스트 유사도 매칭: ASR 점진적 업데이트와 짧은 간격 재전송을 병합한다.
  // 번역이 다르면 ASR 수정으로 간주해 8초 이내 병합, 같으면 2초 이내 재전송만 병합(진짜 반복 발화 보존).
  if (existingIdx < 0) {
    const lang = language as LanguageCode;
    existingIdx = nextCues.findIndex((c) => {
      if (c.speakerId !== cue.speakerId) return false;
      const aKo = c.text.ko ?? "";
      const bKo = cue.text.ko ?? "";
      const shorter = Math.min(aKo.length, bKo.length);
      const longer = Math.max(aKo.length, bKo.length);
      if (shorter < 3 || longer === 0 || shorter / longer < 0.5) return false;
      if (!aKo.startsWith(bKo) && !bKo.startsWith(aKo)) return false;
      const timeDiff = Math.abs(c.start - cue.start);
      if (timeDiff > 8) return false;
      return c.text[lang] !== cue.text[lang] || timeDiff < 2;
    });
  }

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
