#!/usr/bin/env python3
"""
Kaptik Extension — 실제 자막 생성 end-to-end 테스트
전제: dist/ 빌드 완료, localhost:8000 백엔드 실행 중
새 Chrome 프로필 사용 → 캐시 없는 상태에서 시작
"""
import sys
import time
import pathlib
import json
import asyncio
import threading
import websockets
from playwright.sync_api import sync_playwright, Page, BrowserContext

DIST = pathlib.Path(__file__).parent / "dist"
PROFILE = pathlib.Path("/tmp/kaptik-gentest-profile")  # 새 프로필
SERVER_URL = "ws://localhost:8000"
HTTP_URL = "http://localhost:8000"

PRO_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJlbWFpbDp0ZXN0cHJvIiwicGxhbiI6InBybyIsImV4cCI6MTc4Mzc3NTM5NSwiaWF0IjoxNzgxMTgzMzk1fQ.3uNozqIBnN4K1ULvCs5VJs8BMEmmBfSymHUVaWfuw58"

# 2분 이내 BTS 영상 - 짧은 클립
YT_VIDEO = "https://www.youtube.com/watch?v=WNeLUngb-Xg"

def log(msg):   print(f"  ✅ {msg}")
def warn(msg):  print(f"  ⚠️  {msg}")
def probe(msg): print(f"  🔍 {msg}")
def info(msg):  print(f"  ℹ️  {msg}")

def get_extension_id(ctx: BrowserContext) -> str:
    for sw in ctx.service_workers:
        if "chrome-extension://" in sw.url:
            return sw.url.split("/")[2]
    sw = ctx.wait_for_event("serviceworker", timeout=15_000)
    return sw.url.split("/")[2]

def seed_settings(ctx: BrowserContext, ext_id: str):
    """Extension에 pro 토큰 + serverUrl 주입."""
    p = ctx.new_page()
    p.goto(f"chrome-extension://{ext_id}/src/popup/index.html", wait_until="domcontentloaded")
    settings = {
        "plan": "pro", "language": "en",
        "enabled": True, "showSpeaker": True, "fontScale": 1,
        "overlayLineCount": 2, "overlayOpacity": 0.7,
        "showPanel": True, "notifyOnReady": True,
        "serverUrl": SERVER_URL, "authToken": PRO_TOKEN,
    }
    p.evaluate("(s) => chrome.storage.local.set({ 'kaptik:settings': s })", settings)
    time.sleep(0.3)
    log(f"Settings seeded: plan=pro, serverUrl={SERVER_URL}, token=...{PRO_TOKEN[-10:]}")
    p.close()

def open_popup(ctx: BrowserContext, ext_id: str, video_page: Page) -> Page:
    popup = ctx.new_page()
    video_page.bring_to_front()
    time.sleep(0.3)
    popup.goto(f"chrome-extension://{ext_id}/src/popup/index.html", wait_until="domcontentloaded")
    try:
        popup.wait_for_load_state("networkidle", timeout=5_000)
    except Exception:
        pass
    return popup

def get_popup_text(popup: Page, timeout=8_000) -> str:
    try:
        popup.wait_for_selector(".state-block, .state-checking, .card", timeout=timeout)
    except Exception:
        pass
    return popup.evaluate("() => document.body.innerText").strip()

def watch_job_ws(job_id: str, results: list):
    """백그라운드 스레드에서 /ws-job WebSocket 진행 상황 구독."""
    import websocket as ws_lib
    url = f"ws://localhost:8000/ws-job/{job_id}?token={PRO_TOKEN}"
    events = []

    def on_message(ws, msg):
        try:
            d = json.loads(msg)
            events.append(d)
            t = d.get("type", "")
            step = d.get("step", "")
            pct = d.get("pct", 0)
            if t == "progress":
                print(f"  📊 [WS-Job] progress: step={step} {pct*100:.0f}%")
            elif t == "done":
                print(f"  📊 [WS-Job] done — total_cues={d.get('total_cues')}")
            elif t == "error":
                print(f"  📊 [WS-Job] error: {d.get('message')}")
        except Exception:
            pass

    def on_error(ws, err):
        print(f"  📊 [WS-Job] WS error: {err}")

    def on_close(ws, *args):
        results.extend(events)

    app = ws_lib.WebSocketApp(url, on_message=on_message, on_error=on_error, on_close=on_close)
    app.run_forever(ping_interval=20)

def check_shadow_overlay(video_page: Page):
    """영상 페이지에서 kaptik Shadow DOM 오버레이/패널 확인."""
    result = video_page.evaluate("""() => {
        const findings = [];
        const walk = (root) => {
            for (const el of root.querySelectorAll('*')) {
                if (el.shadowRoot) {
                    const sr = el.shadowRoot;
                    const kaptikRoot = sr.querySelector('.kaptik-root');
                    const kaptikPanel = sr.querySelector('.kaptik-panel');
                    const activeCues = sr.querySelectorAll('.kaptik-center-line.is-active');
                    const allCues = sr.querySelectorAll('.kaptik-center-line');
                    if (kaptikRoot) findings.push({
                        type: 'overlay',
                        activeLines: activeCues.length,
                        totalLines: allCues.length,
                        centerText: sr.querySelector('.kaptik-center')?.textContent?.slice(0, 200) ?? '',
                        hasPanel: kaptikRoot.classList.contains('has-panel'),
                    });
                    if (kaptikPanel) findings.push({
                        type: 'panel',
                        docked: kaptikPanel.classList.contains('kaptik-panel--docked'),
                        bodyText: kaptikPanel.querySelector('.kaptik-panel-body')?.textContent?.slice(0, 300) ?? '',
                        isEmpty: !!kaptikPanel.querySelector('.kaptik-panel-empty'),
                        cueCnt: kaptikPanel.querySelectorAll('[class*="kaptik-cue"], [class*="cue-item"]').length,
                    });
                    walk(sr);
                }
            }
        };
        walk(document);
        return findings;
    }""")
    return result

def main():
    if not DIST.exists():
        print(f"❌ dist/ 없음. npm run build 먼저 실행하세요.")
        sys.exit(1)

    # 이전 프로필 삭제 (새 상태로 시작)
    import shutil
    if PROFILE.exists():
        shutil.rmtree(PROFILE)
        info("이전 test 프로필 삭제 → 새 상태로 시작")

    print(f"\n{'='*60}")
    print(f"Kaptik Extension 자막 생성 End-to-End 테스트")
    print(f"대상 영상: {YT_VIDEO}")
    print(f"서버: {SERVER_URL}")
    print(f"{'='*60}")

    with sync_playwright() as p:
        PROFILE.mkdir(parents=True, exist_ok=True)
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE),
            headless=False,
            args=[
                f"--disable-extensions-except={DIST}",
                f"--load-extension={DIST}",
                "--no-sandbox",
                "--autoplay-policy=no-user-gesture-required",
            ],
            slow_mo=150,
        )

        print("\n🚀 Chrome 실행됨")
        ext_id = get_extension_id(ctx)
        log(f"Extension ID: {ext_id}")

        # ── Phase 0: 설정 주입 ──
        print("\n[Phase 0] Pro 토큰 & Server URL 주입")
        seed_settings(ctx, ext_id)

        # ── Phase 1: YouTube 영상 열기 ──
        print(f"\n[Phase 1] YouTube 영상 로드")
        video_page = ctx.new_page()
        video_page.goto(YT_VIDEO, wait_until="domcontentloaded")
        try:
            video_page.wait_for_selector("video", timeout=20_000)
            dur = video_page.evaluate("() => document.querySelector('video')?.duration || 0")
            log(f"영상 로드 완료 — duration={dur:.0f}s")
        except Exception as e:
            warn(f"video 엘리먼트 대기 실패: {e}")

        # ── Phase 2: 팝업에서 생성 요청 ──
        print(f"\n[Phase 2] 팝업 → 자막 생성 요청")
        popup = open_popup(ctx, ext_id, video_page)
        time.sleep(2)

        popup_text = get_popup_text(popup, timeout=5_000)
        info(f"초기 팝업 상태:\n    {popup_text[:200]!r}")

        # 이미 Available이면 스트리밍으로 바로 진행
        if "Subtitle language" in popup_text or "Speaker Identification" in popup_text:
            warn("자막 이미 캐시됨 — 재생성 강제 불가 (새 영상 URL 필요)")
            print("\n[Phase 2b] 캐시된 자막으로 스트리밍 테스트")
            generation_tested = False
        elif "No translation" in popup_text or "Generate" in popup_text:
            log("None 상태 확인 → Generate 클릭")
            try:
                popup.locator("button.btn-primary").first.click()
                log("Generate 버튼 클릭 완료")
            except Exception as e:
                warn(f"Generate 클릭 실패: {e}")
            generation_tested = True
        else:
            warn(f"예상 외 상태: {popup_text[:200]!r}")
            generation_tested = False

        # ── Phase 3: 생성 중 팝업 UI 모니터링 ──
        if generation_tested:
            print(f"\n[Phase 3] 자막 생성 진행 상황 모니터링")
            time.sleep(1.5)

            # job_id 추출 (백그라운드 SW 로그 or 팝업 상태)
            job_id = None
            # WS-Job 모니터링을 위해 job_id 필요 — background SW console에서 추출 시도
            # SW 로그에서 job_id 읽기
            sw_workers = ctx.service_workers
            if sw_workers:
                sw = sw_workers[0]
                # SW console을 직접 읽을 수 없으므로 팝업 상태로 진행

            # Progress bar 확인
            try:
                popup.wait_for_selector(".progress-bar", timeout=10_000)
                log("Progress bar 표시됨")
            except Exception:
                warn("Progress bar 미표시 — 이미 완료됐거나 에러")

            # Step labels 모니터링
            print("  [생성 단계 추적]")
            for step in ["analyze", "captions", "stt", "translate"]:
                try:
                    popup.wait_for_selector(f".state-step", timeout=5_000)
                    step_text = popup.locator(".state-step").first.inner_text()
                    log(f"  step: {step_text}")
                    time.sleep(2)
                except Exception:
                    pass

            # 완료 대기 (최대 4분)
            print("  [완료 대기 — 최대 4분]")
            try:
                popup.wait_for_selector(
                    ".btn-primary:has-text('View'), .card",
                    timeout=240_000
                )
                time.sleep(0.5)
                final_text = get_popup_text(popup, timeout=3_000)
                if "View subtitles" in final_text or "Subtitle language" in final_text:
                    log("자막 생성 완료! Available 상태 전환 확인")
                elif "failed" in final_text.lower() or "error" in final_text.lower():
                    warn(f"생성 실패: {final_text[:200]!r}")
                else:
                    info(f"팝업 최종 상태: {final_text[:200]!r}")
            except Exception as e:
                final_text = get_popup_text(popup, timeout=3_000)
                warn(f"완료 대기 타임아웃 — 현재 상태: {final_text[:200]!r}")

        # ── Phase 4: 자막 스트리밍 & 오버레이 확인 ──
        print(f"\n[Phase 4] 자막 스트리밍 & 오버레이 확인")

        # View subtitles 클릭 (Available-OFF인 경우)
        try:
            btn = popup.locator("button.btn-primary:has-text('View subtitles')").first
            if btn.count() > 0 and btn.is_visible():
                btn.click()
                log("View subtitles 클릭")
                time.sleep(2)
        except Exception:
            pass

        video_page.bring_to_front()
        time.sleep(10)  # content script 마운트 + WS 연결 + 첫 cue 수신 대기

        overlay_info = check_shadow_overlay(video_page)
        if not overlay_info:
            warn("kaptik Shadow DOM 없음 — content script 미주입")
        else:
            for item in overlay_info:
                t = item.get("type")
                if t == "overlay":
                    active = item.get("activeLines", 0)
                    total = item.get("totalLines", 0)
                    center = item.get("centerText", "")
                    log(f"오버레이(.kaptik-root) 마운트 — 라인 {active}/{total}")
                    if center.strip():
                        log(f"  현재 자막: {center!r}")
                    else:
                        probe("  자막 텍스트 없음 (영상 위치 또는 스트리밍 지연)")
                elif t == "panel":
                    docked = item.get("docked")
                    body = item.get("bodyText", "")
                    empty = item.get("isEmpty")
                    log(f"패널(.kaptik-panel) 마운트 — docked={docked}, empty={empty}")
                    if body.strip():
                        log(f"  패널 내용 (처음 200자): {body[:200]!r}")

        # ── Phase 5: 영상 탐색 후 자막 재싱크 확인 ──
        print(f"\n[Phase 5] seek → 자막 재싱크")
        VQ = 'document.querySelector("video.html5-main-video") || document.querySelector("#movie_player video") || document.querySelector("video")'
        video_page.evaluate(f"() => {{ const v = {VQ}; if(v) v.currentTime = 30; }}")
        time.sleep(3)
        ct = video_page.evaluate(f"() => ({VQ})?.currentTime")
        log(f"seek to 30s → currentTime={ct:.1f}s") if ct and abs(ct-30) < 5 else warn(f"seek 이상: ct={ct}")

        overlay_after = check_shadow_overlay(video_page)
        for item in (overlay_after or []):
            if item.get("type") == "overlay":
                center = item.get("centerText", "")
                active = item.get("activeLines", 0)
                log(f"seek 후 오버레이 — active={active}, text={center!r}")

        # ── Phase 6: 화자 분리 확인 ──
        print(f"\n[Phase 6] 화자 분리(speaker) 표시 확인")
        speaker_check = video_page.evaluate("""() => {
            const speakers = new Set();
            const walk = (root) => {
                for (const el of root.querySelectorAll('*')) {
                    if (el.shadowRoot) {
                        el.shadowRoot.querySelectorAll('[class*="kaptik-center-name"], [class*="speaker"], [class*="name"]').forEach(e => {
                            if (e.textContent.trim()) speakers.add(e.textContent.trim());
                        });
                        walk(el.shadowRoot);
                    }
                }
            };
            walk(document);
            return [...speakers];
        }""")
        if speaker_check:
            log(f"화자 이름 표시: {speaker_check}")
        else:
            probe("화자 이름 미표시 (화자 식별 대기 중이거나 비활성화)")

        print(f"\n{'='*60}")
        print("테스트 완료. 15초 후 브라우저 닫힘 (수동 확인 가능)")
        print(f"{'='*60}")
        time.sleep(15)
        ctx.close()

if __name__ == "__main__":
    main()
