import type {
  BroadcastMessage,
  RequestMessage,
  ResponseMessage,
} from "@/shared/messaging";
import type { Platform, SubtitleCue, SubtitleTrack } from "@/types/subtitle";
import {
  fetchSubtitleTrack,
  createJob,
} from "@/api/client";
import { getSettings } from "@/shared/settings";
import {
  getLocalStatus,
} from "./generationStore";
import { StreamingSession } from "@/api/wsClient";
import { getYtCookies, getPoToken } from "./ytCredentials";

/** 자막 트랙 메모리 캐시 (서비스 워커 생존 동안 유효) */
const trackCache = new Map<string, SubtitleTrack>();

/** tabId → 현재 스트리밍 세션 + 누적 cue 배열 */
const streamingSessions = new Map<number, { session: StreamingSession; cues: SubtitleCue[] }>();

/** jobId → 진행 모니터링 WebSocket */
const jobSockets = new Map<string, WebSocket>();

function cacheKey(platform: string, videoId: string): string {
  return `${platform}:${videoId}`;
}

// ── 자막 트랙 ─────────────────────────────────────────────
async function handleGetSubtitles(
  platform: Platform,
  videoId: string,
): Promise<ResponseMessage> {
  const key = cacheKey(platform, videoId);
  const cached = trackCache.get(key);
  if (cached) return { type: "SUBTITLES_OK", track: cached };

  const track = await fetchSubtitleTrack(platform, videoId);
  trackCache.set(key, track);
  return { type: "SUBTITLES_OK", track };
}

// ── 상태 조회 ─────────────────────────────────────────────
async function handleGetStatus(
  platform: Platform,
  videoId: string,
): Promise<ResponseMessage> {
  // 폴백: 로컬 시뮬레이션 (실제 백엔드는 ws-job으로 진행 추적)
  const status = await getLocalStatus(platform, videoId);
  return { type: "STATUS_OK", status };
}

// ── 자막 생성 시작 ────────────────────────────────────────
async function handleStartGeneration(
  platform: Platform,
  videoId: string,
): Promise<ResponseMessage> {
  const settings = await getSettings();
  const { serverUrl, authToken, language } = settings;

  // YouTube만 지원 (타 플랫폼은 라이브 스트리밍 경로)
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const [ytCookies, poToken] = await Promise.all([getYtCookies(), getPoToken()]);

  let jobId: string;
  try {
    const result = await createJob({ serverUrl, authToken, url, targetLang: language, ytCookies, poToken });
    jobId = result.jobId;
  } catch (e) {
    console.error("[Kaptik BG] Job 생성 실패:", e);
    return { type: "ERR", error: e instanceof Error ? e.message : "Job 생성 실패" };
  }

  openJobSocket(jobId, platform, videoId, serverUrl, authToken);
  return { type: "GENERATION_STARTED", etaSeconds: 0 };
}

/** /ws-job/{jobId} WebSocket을 열어 진행 상황을 모니터링한다. */
function openJobSocket(
  jobId: string,
  platform: Platform,
  videoId: string,
  serverUrl: string,
  authToken: string,
): void {
  const token = authToken ? `?token=${encodeURIComponent(authToken)}` : "";
  const ws = new WebSocket(`${serverUrl}/ws-job/${jobId}${token}`);
  jobSockets.set(jobId, ws);

  ws.onmessage = (e: MessageEvent<string>) => {
    try {
      const msg = JSON.parse(e.data) as Record<string, unknown>;
      if (msg.type === "progress") {
        console.info(`[Kaptik BG] Job ${jobId} 진행: step=${String(msg.step ?? "")} pct=${String(msg.pct ?? 0)}`);
      } else if (msg.type === "done") {
        console.info(`[Kaptik BG] Job ${jobId} 완료 total_cues=${String(msg.total_cues ?? 0)}`);
        ws.close();
        jobSockets.delete(jobId);
        void onGenerationComplete(platform, videoId);
      } else if (msg.type === "error") {
        console.error(`[Kaptik BG] Job ${jobId} 오류:`, String(msg.message ?? ""));
        ws.close();
        jobSockets.delete(jobId);
      }
    } catch { /* malformed JSON */ }
  };

  ws.onerror = () => {
    console.error(`[Kaptik BG] Job socket 오류 jobId=${jobId}`);
    jobSockets.delete(jobId);
  };

  ws.onclose = () => {
    jobSockets.delete(jobId);
  };
}

/** 생성 완료 처리: 알림 + 탭 브로드캐스트 */
async function onGenerationComplete(
  platform: Platform,
  videoId: string,
): Promise<void> {
  const settings = await getSettings();
  if (settings.notifyOnReady) {
    chrome.notifications.create(`kaptik:${platform}:${videoId}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title: "Kaptik 자막 준비 완료",
      message: "번역 자막이 생성됐어요. 영상에서 자막을 켜보세요!",
      priority: 2,
    });
  }

  await broadcastReady(platform, videoId);
}

/** 열려 있는 YouTube/Weverse 탭에 생성 완료를 알린다. */
async function broadcastReady(platform: Platform, videoId: string): Promise<void> {
  const message: BroadcastMessage = { type: "SUBTITLES_READY", platform, videoId };
  const tabs = await chrome.tabs.query({
    url: [
      "*://*.youtube.com/*",
      "*://*.weverse.io/*",
      "*://*.instagram.com/*",
    ],
  });
  for (const tab of tabs) {
    if (tab.id != null) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        /* content script 미주입 탭은 무시 */
      });
    }
  }
}

// ── 스트리밍 세션 관리 ────────────────────────────────────

async function handleStartStreaming(
  tabId: number,
  youtubeUrl: string,
  seekSec: number,
  serverUrl: string,
  keepCues: boolean,
): Promise<ResponseMessage> {
  const settings = await getSettings();
  const { authToken, language } = settings;

  // onDone → broadcastReady 용으로 videoId 추출
  let videoId: string;
  try {
    videoId = new URL(youtubeUrl).searchParams.get("v") ?? youtubeUrl;
  } catch {
    videoId = youtubeUrl;
  }

  const prev = streamingSessions.get(tabId);
  prev?.session.disconnect();

  const cues: SubtitleCue[] = keepCues ? (prev?.cues ?? []) : [];

  const session = new StreamingSession(
    youtubeUrl,
    seekSec,
    serverUrl,
    authToken,
    language,
    (newCue) => {
      cues.push(newCue);
      cues.sort((a, b) => a.start - b.start);
      for (let i = 0; i < cues.length - 1; i++) {
        cues[i] = { ...cues[i], end: Math.min(cues[i].end, cues[i + 1].start - 0.1) };
      }
      console.info(`[Kaptik BG] CUE #${cues.length} → tab ${tabId}: "${newCue.text.en}" (t=${newCue.start.toFixed(1)}s)`);
      const msg: BroadcastMessage = { type: "CUE_READY", cues: [...cues] };
      chrome.tabs.sendMessage(tabId, msg).catch((e: unknown) => {
        console.warn(`[Kaptik BG] sendMessage 실패 tabId=${tabId}:`, e);
      });
    },
    (err) => {
      console.error(`[Kaptik BG] 스트리밍 오류 tabId=${tabId}:`, err);
      const msg: BroadcastMessage = { type: "STREAMING_ERROR", message: err };
      chrome.tabs.sendMessage(tabId, msg).catch(() => {});
    },
    (totalCues) => {
      console.info(`[Kaptik BG] 스트리밍 완료 tabId=${tabId} totalCues=${totalCues}`);
      void broadcastReady("youtube", videoId);
    },
  );

  streamingSessions.set(tabId, { session, cues });
  session.connect();
  console.info(`[Kaptik BG] 스트리밍 시작 tabId=${tabId} seek=${seekSec}s`);
  return { type: "STREAMING_STARTED" };
}

// 탭이 닫히면 세션 정리
chrome.tabs.onRemoved.addListener((tabId) => {
  const entry = streamingSessions.get(tabId);
  if (entry) {
    entry.session.disconnect();
    streamingSessions.delete(tabId);
  }
});

// ── 메시지 라우팅 ─────────────────────────────────────────
chrome.runtime.onMessage.addListener(
  (message: RequestMessage, sender, sendResponse) => {
    const route = async (): Promise<ResponseMessage> => {
      try {
        switch (message.type) {
          case "GET_SUBTITLES":
            return await handleGetSubtitles(message.platform, message.videoId);
          case "GET_STATUS":
            return await handleGetStatus(message.platform, message.videoId);
          case "START_GENERATION":
            return await handleStartGeneration(message.platform, message.videoId);
          case "START_STREAMING": {
            const tabId = sender.tab?.id;
            if (!tabId) return { type: "ERR", error: "tabId 없음" };
            return await handleStartStreaming(
              tabId,
              message.youtubeUrl,
              message.seekSec,
              message.serverUrl,
              message.keepCues ?? false,
            );
          }
          case "STOP_STREAMING": {
            const tabId = sender.tab?.id;
            if (tabId) {
              streamingSessions.get(tabId)?.session.disconnect();
              streamingSessions.delete(tabId);
              console.info(`[Kaptik BG] 스트리밍 중단 tabId=${tabId}`);
            }
            return { type: "ERR", error: "" }; // 응답 불필요, 빈 응답
          }
          default:
            return { type: "ERR", error: "알 수 없는 메시지" };
        }
      } catch (error) {
        return {
          type: "ERR",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };
    route().then(sendResponse);
    return true; // 비동기 응답 채널 유지
  },
);

chrome.runtime.onInstalled.addListener((details) => {
  console.info(`[Kaptik] 설치/업데이트: ${details.reason}`);
});

// 스트리밍 세션이 활성 중일 때 서비스 워커가 sleep되지 않도록 20초마다 ping
// (MV3 SW는 30초 idle 후 종료되어 WS 연결이 끊김)
setInterval(() => {
  if (streamingSessions.size > 0) {
    console.debug(`[Kaptik BG] keepalive (활성 세션 ${streamingSessions.size}개)`);
  }
}, 20_000);

// 클릭 시 알림 닫기
chrome.notifications?.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
});
