import type {
  Annotation,
  LanguageCode,
  Member,
  Platform,
  SubtitleCue,
  SubtitleStatus,
  SubtitleTrack,
} from "@/types/subtitle";
import { getMockTrack } from "./mockSubtitles";

/** Kaptik 백엔드 베이스 URL (개발 중 — 미연결 시 mock/시뮬레이션으로 대체) */
const API_BASE = "https://api.kaptik.app/v1";

/** API 호출 타임아웃(ms) */
const TIMEOUT_MS = 6000;

/** 알려진 언어 코드 집합 (응답 정규화에 사용) */
const KNOWN_LANGUAGES: LanguageCode[] = ["ko", "en", "ja", "zh-CN", "id"];

/** 서버가 내려줄 것으로 기대하는 원시 큐 형태 (언어 코드가 평면 키로 올 수 있음) */
type RawCue = {
  start: number;
  end: number;
  speaker?: string;
  speakerId?: string;
  contextNote?: string;
  annotations?: Annotation[];
  text?: Partial<Record<LanguageCode, string>>;
} & Partial<Record<LanguageCode, string>>;

type RawTrackResponse = {
  platform?: Platform;
  videoId?: string;
  cues: RawCue[];
  availableLanguages?: LanguageCode[];
  members?: Record<string, Member>;
  isLive?: boolean;
};

/** fetch에 타임아웃을 적용한 래퍼 */
async function fetchJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 이름을 멤버 id로 변환 (slug) */
function toMemberId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** 평면/중첩 응답을 SubtitleCue 로 정규화하고, 필요한 멤버를 수집한다. */
function normalizeCue(
  raw: RawCue,
  members: Record<string, Member>,
): SubtitleCue {
  const text: Partial<Record<LanguageCode, string>> = { ...(raw.text ?? {}) };
  for (const lang of KNOWN_LANGUAGES) {
    const flat = raw[lang];
    if (typeof flat === "string" && text[lang] === undefined) {
      text[lang] = flat;
    }
  }

  // 화자: speakerId 우선, 없으면 speaker 이름을 slug 처리
  let speakerId = raw.speakerId;
  if (!speakerId && raw.speaker) {
    speakerId = toMemberId(raw.speaker);
    if (!members[speakerId]) {
      members[speakerId] = { id: speakerId, name: raw.speaker, color: "#7E8AFF" };
    }
  }

  // 주석: annotations 우선, 없으면 contextNote를 단일 주석으로 변환
  const annotations: Annotation[] = raw.annotations ? [...raw.annotations] : [];
  if (!raw.annotations && raw.contextNote) {
    annotations.push({ title: "맥락", description: raw.contextNote });
  }

  return {
    start: raw.start,
    end: raw.end,
    speakerId,
    text,
    annotations: annotations.length ? annotations : undefined,
  };
}

/** 응답에서 실제 제공되는 언어 목록을 추론한다. */
function deriveLanguages(cues: SubtitleCue[]): LanguageCode[] {
  const set = new Set<LanguageCode>();
  for (const cue of cues) {
    for (const lang of Object.keys(cue.text) as LanguageCode[]) {
      if (cue.text[lang]) set.add(lang);
    }
  }
  return KNOWN_LANGUAGES.filter((l) => set.has(l));
}

/**
 * Kaptik API에서 자막 트랙을 가져온다.
 * 백엔드 미연결/오류 시 mock 데이터로 안전하게 대체한다.
 */
export async function fetchSubtitleTrack(
  platform: Platform,
  videoId: string,
): Promise<SubtitleTrack> {
  try {
    const data = await fetchJson<RawTrackResponse>(
      `/subtitles?platform=${encodeURIComponent(platform)}&videoId=${encodeURIComponent(videoId)}`,
    );
    const members: Record<string, Member> = { ...(data.members ?? {}) };
    const cues = (data.cues ?? [])
      .map((c) => normalizeCue(c, members))
      .sort((a, b) => a.start - b.start);
    return {
      platform,
      videoId,
      cues,
      availableLanguages: data.availableLanguages ?? deriveLanguages(cues),
      members,
      isLive: data.isLive,
    };
  } catch (error) {
    console.info(
      `[Kaptik] API 미연결 또는 오류로 mock 자막 사용 (${platform}/${videoId})`,
      error instanceof Error ? error.message : error,
    );
    return getMockTrack(platform, videoId);
  }
}

/**
 * 영상의 자막 제공 상태를 조회한다.
 * 백엔드 미연결 시 throw 하여, 호출 측(background)이 로컬 시뮬레이션으로 폴백하도록 한다.
 */
export async function fetchSubtitleStatus(
  platform: Platform,
  videoId: string,
): Promise<SubtitleStatus> {
  return fetchJson<SubtitleStatus>(
    `/subtitles/status?platform=${encodeURIComponent(platform)}&videoId=${encodeURIComponent(videoId)}`,
  );
}

/**
 * 자막 생성을 요청한다.
 * 백엔드 미연결 시 throw 하여, 호출 측이 로컬 시뮬레이션으로 폴백하도록 한다.
 * @returns 예상 소요 시간(초)
 */
export async function requestGeneration(
  platform: Platform,
  videoId: string,
): Promise<{ etaSeconds: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/subtitles/generate`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ platform, videoId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as { etaSeconds: number };
  } finally {
    clearTimeout(timer);
  }
}
