import type { SubtitleCue } from "@/types/subtitle";

const DUPLICATE_WINDOW_SEC = 0.5;
// send_cached_subtitles 재전송 시 ts가 기존 cue와 이 범위(ms) 내에 있으면 중복으로 처리한다.
const CACHED_TS_MATCH_MS = 1000;

export interface PendingLiveCue {
  text_ko: string;
  startMs: number;
  utteranceId?: string;
}

function normalizeCueText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isSameCueText(a: string, b: string): boolean {
  const normalizedA = normalizeCueText(a);
  const normalizedB = normalizeCueText(b);
  return normalizedA.length > 0 && normalizedA === normalizedB;
}

/**
 * cached=true Stage1이 이미 같은 ts의 cue로 저장돼 있는지 확인한다.
 * send_cached_subtitles 재전송(재연결·언어 변경)으로 인한 중복을 차단한다.
 */
export function isCachedTsDuplicate(params: {
  existingCues: SubtitleCue[];
  startMs: number;
}): boolean {
  const startSec = params.startMs / 1000;
  return params.existingCues.some(
    (cue) => Math.abs(cue.start - startSec) * 1000 < CACHED_TS_MATCH_MS,
  );
}

/**
 * 라이브 Stage1 중복 여부를 판정한다.
 * 시간만 가까운 다른 문장은 새 자막으로 인정하고, 같은 문장이 같은 시간대에 다시 온 경우만 중복으로 본다.
 */
export function isDuplicateLiveStage1(params: {
  existingCues: SubtitleCue[];
  pendingCues: PendingLiveCue[];
  startMs: number;
  textKo: string;
  utteranceId?: string;
}): boolean {
  // uid 정확 매칭: 같은 uid가 이미 처리됐거나 pending 중이면 중복
  if (params.utteranceId) {
    if (params.existingCues.some((c) => c.utteranceId === params.utteranceId)) return true;
    if (params.pendingCues.some((c) => c.utteranceId === params.utteranceId)) return true;
  }

  const startSec = params.startMs / 1000;

  const duplicatedExisting = params.existingCues.some((cue) =>
    Math.abs(cue.start - startSec) < DUPLICATE_WINDOW_SEC &&
    isSameCueText(cue.text.ko ?? "", params.textKo)
  );
  if (duplicatedExisting) return true;

  return params.pendingCues.some((cue) =>
    Math.abs(cue.startMs / 1000 - startSec) < DUPLICATE_WINDOW_SEC &&
    isSameCueText(cue.text_ko, params.textKo)
  );
}
