/**
 * Offscreen document for live tab audio capture.
 * Receives streamId from the service worker (via tabCapture.getMediaStreamId),
 * resamples audio to 16 kHz PCM-16, and streams it to the Kaptik backend
 * over a WebSocket. Forwards STT/translation messages back to the SW.
 */

import { shouldMuteReplay, isInsideCachedRange, mergeRange, type TimeRange } from "./replayMute";

interface CaptureTabMsg {
  type: "CAPTURE_TAB";
  streamId: string;
  sessionId: string;
  serverUrl: string;
  authToken: string;
  targetLang: string;
  videoTitle?: string;
  videoUrl?: string;
  /** 캡처 시작 시점의 영상 재생 위치(초) — 서버가 자막 ts 앵커로 사용 */
  captureStartSec?: number;
  /** 캡처 시작 시점에 이미 광고가 재생 중이면 true — 처음부터 무음 처리 */
  initialMuted?: boolean;
  /** 이미 자막이 있는 영상 구간(ms) 목록. 이 구간 재생 시 STT로 무음 전송해 재전사를 막는다. */
  cachedRanges?: TimeRange[];
}

let activeStream: MediaStream | null = null;
let activeWs: WebSocket | null = null;
let audioCtx: AudioContext | null = null;
let scriptProcessor: ScriptProcessorNode | null = null;
let activeSessionId: string | null = null;
// 탭 캡처 시 원본 탭이 음소거되므로 Audio 요소로 원음질 복원
let playbackEl: HTMLAudioElement | null = null;
// 광고 재생 중이면 true — 서버로 보내는 오디오만 무음(0)으로 채운다.
// (사용자가 듣는 소리/탭 재생에는 영향 없음. 서버 전송 복사본만 무음 처리)
let adMuted = false;
// 무음을 시작한 시각(ms). 신호가 꼬여 무음이 비정상적으로 오래 지속되면 강제 해제하기 위함.
let adMutedSince = 0;
// 무음 최대 지속 시간(ms). 실제 광고는 15~30초이므로 이를 넘으면 신호 꼬임으로 보고 해제.
const MAX_AD_MUTE_MS = 60000;

// ── 타임싱크: 자막을 영상의 정확한 위치에 꽂기 위한 상태 ──
// 캡처 시작부터 서버로 보낸 누적 오디오 길이(ms). 서버의 Soniox start_ms와 같은 기준.
let sentAudioMs = 0;
// background가 주기적으로 알려주는 현재 영상 재생 위치(ms). 점프 시 즉시 반영됨.
let latestVideoMs = 0;
// 마지막으로 time_sync 마커를 보낸 시점의 sentAudioMs (전송 주기 제어용)
let lastSyncAudioMs = 0;
// 지금까지 도달한 최대 영상 위치(ms) = 라이브 최전방. 되감기 판정 기준.
let maxVideoMs = 0;
// 되감기(DVR rewind)로 이미 자막이 만들어진 구간을 다시 듣는 중이면 true →
// 그 오디오를 무음으로 전송해 재전사(중복 자막)를 막는다.
let replayMuted = false;
// 이미 자막이 있는 영상 구간(ms). 재생 위치가 이 안에 들어오면 replayMuted 처리한다.
// 캡처 시작 시 이전 세션의 저장 cue로 seed하고, 세션 중 새 cue가 확정될 때마다 ADD_CACHED_RANGE로 확장한다.
let cachedRanges: TimeRange[] = [];

async function startCapture(msg: CaptureTabMsg): Promise<void> {
  stopCapture();
  activeSessionId = msg.sessionId;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // @ts-expect-error — Chrome-specific mandatory constraints
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: msg.streamId,
        },
      },
      video: false,
    });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: "LIVE_STREAM_ERROR",
      message: `getUserMedia failed: ${String(err)}`,
    });
    return;
  }

  activeStream = stream;

  // 캡처 시작 시 무음 상태 초기화.
  // initialMuted=true이면 처음부터 광고 구간 → 즉시 무음으로 시작해 첫 오디오 청크부터 차단.
  adMuted = msg.initialMuted ?? false;
  adMutedSince = adMuted ? Date.now() : 0;

  // 타임싱크 상태 초기화 (캡처 시작 위치를 첫 영상 위치로)
  sentAudioMs = 0;
  lastSyncAudioMs = 0;
  latestVideoMs = (msg.captureStartSec ?? 0) * 1000;
  maxVideoMs = latestVideoMs;
  replayMuted = false;
  // 정렬·병합 상태를 보장하기 위해 seed 구간도 mergeRange로 정규화한다.
  cachedRanges = (msg.cachedRanges ?? []).reduce<TimeRange[]>((acc, r) => mergeRange(acc, r), []);

  // 탭 캡처 시 원본 탭이 음소거됨 → Audio 요소로 원음질 그대로 복원
  playbackEl = new Audio();
  playbackEl.srcObject = stream;
  void playbackEl.play();

  const token = msg.authToken
    ? `?token=${encodeURIComponent(msg.authToken)}`
    : "";
  const wsUrl = `${msg.serverUrl}/ws/${msg.sessionId}${token}`;
  const ws = new WebSocket(wsUrl);
  activeWs = ws;

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: "init",
        video_type: "live",
        target_lang: msg.targetLang,
        video_title: msg.videoTitle ?? null,
        video_url: msg.videoUrl ?? null,
        capture_start_sec: msg.captureStartSec ?? 0,
      }),
    );

    // init 직후 즉시 첫 time_sync 전송.
    // 500ms 오디오 누적 후 전송하는 주기 time_sync보다 STT 결과가 먼저 도착하면
    // 서버가 시간 기준 없이 ts=0을 보내는 문제를 방지한다.
    ws.send(
      JSON.stringify({
        type: "time_sync",
        audio_ms: 0,
        video_ms: Math.round(latestVideoMs),
      }),
    );

    // 16 kHz mono AudioContext for PCM-16 resampling (STT 전용)
    audioCtx = new AudioContext({ sampleRate: 16000 });
    const source = audioCtx.createMediaStreamSource(stream);
    // 4 096-sample frames @ 16 kHz ≈ 256 ms per chunk
    scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);

    scriptProcessor.onaudioprocess = (e) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const f32 = e.inputBuffer.getChannelData(0);
      const i16 = new Int16Array(f32.length);
      // 안전장치: 무음이 비정상적으로 오래(60초+) 지속되면 신호 꼬임으로 보고 강제 해제.
      // (광고 종료 신호 유실 등으로 본편 자막이 영영 안 만들어지는 최악 상황 방지)
      if (adMuted && adMutedSince > 0 && Date.now() - adMutedSince > MAX_AD_MUTE_MS) {
        adMuted = false;
  adMutedSince = 0;
      }
      // 광고 중이거나 되감기로 이미 본 구간을 다시 듣는 중이 아닐 때만 실제 오디오를 채운다.
      // 둘 중 하나라도 해당하면 i16은 0(무음)인 채로 전송 → 그 음성이 STT로 가지 않아
      // 중복 자막/광고 자막이 생기지 않는다. 오디오 시계(sentAudioMs)는 계속 진행해 타임싱크 유지.
      if (!adMuted && !replayMuted) {
        for (let i = 0; i < f32.length; i++) {
          i16[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)));
        }
      }
      ws.send(i16.buffer);
      // 16 kHz mono → 16 samples = 1 ms. 누적 오디오 길이 추적
      sentAudioMs += f32.length / 16;
      // 약 500 ms마다 (오디오 위치, 영상 위치) 마커 전송 → 서버가 자막 ts를 영상 위치로 역산
      if (sentAudioMs - lastSyncAudioMs >= 500) {
        lastSyncAudioMs = sentAudioMs;
        ws.send(
          JSON.stringify({
            type: "time_sync",
            audio_ms: Math.round(sentAudioMs),
            video_ms: Math.round(latestVideoMs),
          }),
        );
      }
    };

    source.connect(scriptProcessor);
    // onaudioprocess를 트리거하려면 destination 연결 필요.
    // GainNode gain=0으로 묵음 처리해 Audio 요소와 중복 재생 방지
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    scriptProcessor.connect(silentGain);
    silentGain.connect(audioCtx.destination);
  };

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data as string) as unknown;
      chrome.runtime.sendMessage({ type: "LIVE_CUE_MSG", sessionId: msg.sessionId, data });
    } catch {
      /* malformed JSON — ignore */
    }
  };

  ws.onerror = () => {
    chrome.runtime.sendMessage({
      type: "LIVE_STREAM_ERROR",
      sessionId: msg.sessionId,
      message: "WebSocket error",
    });
  };

  ws.onclose = (ev) => {
    chrome.runtime.sendMessage({
      type: "LIVE_WS_CLOSED",
      sessionId: msg.sessionId,
      code: ev.code,
      reason: ev.reason,
    });
  };
}

function stopCapture(): void {
  playbackEl?.pause();
  playbackEl = null;
  scriptProcessor?.disconnect();
  scriptProcessor = null;
  void audioCtx?.close();
  audioCtx = null;
  activeWs?.close();
  activeWs = null;
  activeStream?.getTracks().forEach((t) => t.stop());
  activeStream = null;
  activeSessionId = null;
  sentAudioMs = 0;
  lastSyncAudioMs = 0;
  latestVideoMs = 0;
  maxVideoMs = 0;
  replayMuted = false;
  cachedRanges = [];
  adMuted = false;
  adMutedSince = 0;
}

chrome.runtime.onMessage.addListener(
  (msg: { type: string; videoMs?: number; muted?: boolean; language?: string; sessionId?: string; start?: number; end?: number } & Partial<CaptureTabMsg>) => {
    if (msg.type === "CAPTURE_TAB") {
      void startCapture(msg as CaptureTabMsg);
    } else if (msg.type === "STOP_CAPTURE") {
      stopCapture();
    } else if (msg.type === "ADD_CACHED_RANGE") {
      // 세션 중 새로 확정된 자막 구간을 추가 → 이후 그 구간을 재생하면 재전사 없이 무음 처리.
      // 정렬·병합 상태를 유지한다. replayMuted은 다음 UPDATE_VIDEO_TIME(최대 500ms)에서 갱신된다.
      if (typeof msg.start === "number" && typeof msg.end === "number") {
        cachedRanges = mergeRange(cachedRanges, [msg.start, msg.end]);
      }
    } else if (msg.type === "UPDATE_VIDEO_TIME") {
      // background가 0.5초마다 보내는 현재 영상 위치 — 점프 시 즉시 반영
      if (typeof msg.videoMs === "number" && Number.isFinite(msg.videoMs)) {
        const prevVideoMs = latestVideoMs;
        latestVideoMs = msg.videoMs;

        // 되감기 판정: 라이브 최전방(maxVideoMs)보다 충분히 뒤면(shouldMuteReplay),
        // 또는 이미 자막이 있는 구간(isInsideCachedRange)을 재생 중이면 무음 처리해 재전사를 막는다.
        replayMuted =
          shouldMuteReplay(latestVideoMs, maxVideoMs) ||
          isInsideCachedRange(latestVideoMs, cachedRanges);
        // 되감기가 아니면 최전방 갱신 (앞으로 나아간 만큼만 올라간다)
        if (!replayMuted) {
          maxVideoMs = Math.max(maxVideoMs, latestVideoMs);
        }

        // 큰 점프(seek) 감지 시 즉시 time_sync 1회 전송 → resolve_ts 마커가 다음 주기(최대 500ms)를
        // 기다리지 않고 바로 정정돼 점프 직후 자막이 엉뚱한 위치에 찍히는 것을 줄인다.
        if (
          activeWs?.readyState === WebSocket.OPEN &&
          Math.abs(latestVideoMs - prevVideoMs) > 2000
        ) {
          lastSyncAudioMs = sentAudioMs;
          activeWs.send(
            JSON.stringify({
              type: "time_sync",
              audio_ms: Math.round(sentAudioMs),
              video_ms: Math.round(latestVideoMs),
            }),
          );
        }
      }
    } else if (msg.type === "SET_CAPTURE_MUTED") {
      // 광고 구간 무음 처리 on/off
      const next = Boolean(msg.muted);
      if (next && !adMuted) adMutedSince = Date.now(); // 무음 시작 시각 기록
      adMuted = next;
    } else if (msg.type === "SET_LANG") {
      // 라이브 캡처 중 언어 변경 — 서버가 이후 자막부터 새 언어로 번역
      if (
        activeSessionId &&
        (!msg.sessionId || msg.sessionId === activeSessionId) &&
        activeWs?.readyState === WebSocket.OPEN &&
        typeof msg.language === "string"
      ) {
        activeWs.send(JSON.stringify({ type: "set_lang", target_lang: msg.language }));
      }
    }
  },
);
