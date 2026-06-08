import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  getSettings,
  updateSettings,
  type KaptikSettings,
} from "@/shared/settings";
import { requestStatus, startGeneration } from "@/shared/messaging";
import { resolveAdapter } from "@/content/siteAdapters";
import {
  LANGUAGE_LABELS,
  type LanguageCode,
  type Platform,
  type SubtitleStatus,
} from "@/types/subtitle";

/** 현재 탭에서 식별된 영상 */
interface Target {
  platform: Platform;
  videoId: string;
}

/** 토글 스위치 */
function Switch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-track" />
    </label>
  );
}

/** 미리보기용 샘플 자막 (현재 선택 언어로 표시) */
const PREVIEW_TEXT: Record<LanguageCode, string> = {
  ko: "여러분, 드디어 우리 모였어요!",
  en: "Hey everyone, we're finally here!",
  ja: "みなさん、やっと来ましたよ！",
  "zh-CN": "大家好，我们终于来了！",
  id: "Hai semua, kita akhirnya di sini!",
};

export function Popup() {
  // undefined: 확인 중, null: 지원 안 함, Target: 영상 식별됨
  const [target, setTarget] = useState<Target | null | undefined>(undefined);
  const [status, setStatus] = useState<SubtitleStatus | null>(null);
  const [settings, setSettings] = useState<KaptikSettings>(DEFAULT_SETTINGS);
  const pollRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    (async () => {
      const s = await getSettings();
      if (active) setSettings(s);

      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const url = tab?.url ?? "";
      const adapter = resolveAdapter(url);
      const videoId = adapter?.getVideoId(url) ?? null;
      if (!adapter || !videoId) {
        if (active) setTarget(null);
        return;
      }
      const t: Target = { platform: adapter.platform, videoId };
      if (active) setTarget(t);

      const st = await requestStatus(t.platform, t.videoId);
      if (active) setStatus(st);
    })();

    return () => {
      active = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const patch = (next: Partial<KaptikSettings>) => {
    setSettings((prev) => ({ ...prev, ...next }));
    void updateSettings(next);
  };

  /** 생성 진행 중 1초마다 상태 폴링 */
  const startPolling = (t: Target) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      const st = await requestStatus(t.platform, t.videoId);
      setStatus(st);
      if (st?.state === "available" || st?.state === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 1000);
  };

  const onGenerate = async () => {
    if (!target) return;
    const eta = await startGeneration(target.platform, target.videoId);
    setStatus({ state: "generating", etaSeconds: eta ?? 12, progress: 0 });
    startPolling(target);
  };

  // ── 렌더 ──
  return (
    <div className="popup">
      <header className="popup-header">
        <div className="popup-brand">
          <div className="popup-logo">
            Kapti<span>k</span>
          </div>
          <div className="popup-subtitle">K-pop 자막</div>
        </div>
        {target && status?.state === "available" && (
          <Switch
            checked={settings.enabled}
            onChange={(v) => patch({ enabled: v })}
            ariaLabel="자막 켜기/끄기"
          />
        )}
      </header>

      {target === undefined && <CheckingView />}
      {target === null && <UnsupportedView />}
      {target && status === null && <CheckingView />}

      {target && status?.state === "available" && (
        <AvailableView settings={settings} patch={patch} />
      )}
      {target && status?.state === "none" && (
        <NoneView onGenerate={onGenerate} />
      )}
      {target && status?.state === "generating" && (
        <GeneratingView
          status={status}
          notify={settings.notifyOnReady}
          onToggleNotify={(v) => patch({ notifyOnReady: v })}
        />
      )}
      {target && status?.state === "failed" && (
        <FailedView onRetry={onGenerate} />
      )}

      <footer className="popup-footer">
        YouTube · Weverse 영상에서 자동으로 자막을 띄워요
      </footer>
    </div>
  );
}

/* ── 상태별 뷰 ── */

function CheckingView() {
  return <div className="state-block state-checking">상태 확인 중…</div>;
}

function UnsupportedView() {
  return (
    <div className="state-block">
      <div className="state-emoji">🎬</div>
      <div className="state-title">지원하는 영상 페이지가 아니에요</div>
      <div className="state-desc">
        YouTube 또는 Weverse 영상을 연 뒤 다시 눌러주세요.
      </div>
    </div>
  );
}

function NoneView({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="state-block">
      <div className="state-emoji">✨</div>
      <div className="state-title">이 영상은 아직 번역이 없어요</div>
      <div className="state-desc">
        자막을 생성하면 화자별 번역과 문화 맥락까지 볼 수 있어요.
      </div>
      <button type="button" className="btn-primary" onClick={onGenerate}>
        자막 생성하기
      </button>
      <div className="state-note">
        영상 길이에 따라 1~2분 정도 걸릴 수 있어요.
      </div>
    </div>
  );
}

function GeneratingView({
  status,
  notify,
  onToggleNotify,
}: {
  status: Extract<SubtitleStatus, { state: "generating" }>;
  notify: boolean;
  onToggleNotify: (v: boolean) => void;
}) {
  const pct = Math.round(status.progress * 100);
  return (
    <div className="state-block">
      <div className="state-title">자막을 만들고 있어요</div>
      <div className="progress">
        <div className="progress-bar" style={{ width: `${Math.max(6, pct)}%` }} />
      </div>
      <div className="progress-meta">
        <span>{pct}%</span>
        <span>약 {status.etaSeconds}초 남음</span>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="row">
          <span className="row-label">완료되면 알림 받기</span>
          <Switch
            checked={notify}
            onChange={onToggleNotify}
            ariaLabel="완료 알림 받기"
          />
        </div>
      </div>
      <div className="state-note">
        팝업을 닫아도 괜찮아요. 완료되면 알림으로 알려드릴게요.
      </div>
    </div>
  );
}

function FailedView({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="state-block">
      <div className="state-emoji">⚠️</div>
      <div className="state-title">자막 생성에 실패했어요</div>
      <button type="button" className="btn-primary" onClick={onRetry}>
        다시 시도
      </button>
    </div>
  );
}

function AvailableView({
  settings,
  patch,
}: {
  settings: KaptikSettings;
  patch: (next: Partial<KaptikSettings>) => void;
}) {
  // 자막이 꺼져 있으면 '자막 보기'로 켜도록 유도
  if (!settings.enabled) {
    return (
      <div className="state-block">
        <div className="state-emoji">💬</div>
        <div className="state-title">자막이 준비됐어요</div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => patch({ enabled: true })}
        >
          자막 보기
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="preview" aria-hidden>
        {settings.showSpeaker && <div className="preview-speaker">RM</div>}
        <div
          className="preview-text"
          style={{ fontSize: `${15 * settings.fontScale}px` }}
        >
          {PREVIEW_TEXT[settings.language]}
        </div>
      </div>

      <div className="card">
        <div className="row">
          <span className="row-label">자막 언어</span>
          <select
            className="select"
            value={settings.language}
            onChange={(e) => patch({ language: e.target.value as LanguageCode })}
          >
            {(Object.keys(LANGUAGE_LABELS) as LanguageCode[]).map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_LABELS[code]}
              </option>
            ))}
          </select>
        </div>

        <div className="row">
          <span className="row-label">화자 이름 표시</span>
          <Switch
            checked={settings.showSpeaker}
            onChange={(v) => patch({ showSpeaker: v })}
            ariaLabel="화자 이름 표시"
          />
        </div>

        <div className="row">
          <span className="row-label">오른쪽 히스토리 패널</span>
          <Switch
            checked={settings.showPanel}
            onChange={(v) => patch({ showPanel: v })}
            ariaLabel="히스토리 패널 표시"
          />
        </div>

        <div className="row">
          <span className="row-label">한 번에 보일 문장 수</span>
          <div className="stepper">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                className={
                  "stepper-btn" + (settings.overlayLineCount === n ? " is-on" : "")
                }
                onClick={() => patch({ overlayLineCount: n })}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="row slider-row">
          <div className="slider-head">
            <span className="row-label">자막 크기</span>
            <span className="slider-value">
              {Math.round(settings.fontScale * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.8}
            max={1.6}
            step={0.05}
            value={settings.fontScale}
            aria-label="자막 글자 크기"
            onChange={(e) => patch({ fontScale: Number(e.target.value) })}
          />
        </div>
      </div>
    </>
  );
}
