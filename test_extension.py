#!/usr/bin/env python3
"""
Kaptik Extension — Playwright smoke test
테스트 전제: dist/ 빌드 완료, localhost:8000 백엔드 실행 중
"""
import sys
import time
import pathlib
from playwright.sync_api import sync_playwright, Page, BrowserContext

DIST = pathlib.Path(__file__).parent / "dist"
PROFILE = pathlib.Path("/tmp/kaptik-test-profile")

# 2분 이내 BTS 영상 — 변경 가능
YT_VIDEO = "https://www.youtube.com/watch?v=WNeLUngb-Xg"

AUTH_TOKEN = ""   # Pro JWT 토큰 입력 (비워두면 plan="pro" fallback)
SERVER_URL = "ws://localhost:8000"

# ── helpers ──────────────────────────────────────────────────────────────────

def get_extension_id(ctx: BrowserContext) -> str:
    """서비스 워커 URL에서 Extension ID를 추출한다."""
    for sw in ctx.service_workers:
        if "chrome-extension://" in sw.url:
            return sw.url.split("/")[2]
    # 아직 등록 안 됐으면 잠깐 기다린다
    sw = ctx.wait_for_event("serviceworker", timeout=15_000)
    return sw.url.split("/")[2]

def open_popup(ctx: BrowserContext, ext_id: str, page: Page) -> Page:
    """팝업을 새 탭으로 열고 로드를 기다린다.

    chrome.tabs.query({active: true}) 가 page를 인식하도록,
    page를 active 상태로 유지한 채 popup을 background에서 로드한다.
    """
    # 팝업 탭 미리 생성 (현재 탭이 바뀌지 않도록 about:blank로 시작)
    popup = ctx.new_page()
    # YouTube/video page를 다시 active로 만든다
    page.bring_to_front()
    time.sleep(0.3)
    # popup 탭은 background에서 URL 로드 (page가 active 상태 유지)
    popup.goto(f"chrome-extension://{ext_id}/src/popup/index.html", wait_until="domcontentloaded")
    try:
        popup.wait_for_load_state("networkidle", timeout=5_000)
    except Exception:
        pass
    return popup

def log(msg: str, ok: bool = True):
    icon = "✅" if ok else "❌"
    print(f"  {icon} {msg}")

def warn(msg: str):
    print(f"  ⚠️  {msg}")

def probe(msg: str):
    print(f"  🔍 {msg}")

# ── test steps ────────────────────────────────────────────────────────────────

def step_configure(popup: Page):
    """Server URL + Auth Token 설정 (팝업 dev 입력란)."""
    print("\n[Setup] Server URL / Auth Token 설정")
    # server URL 필드가 있으면 채운다
    su = popup.locator('input[placeholder*="ws://"]')
    if su.count() > 0:
        su.fill(SERVER_URL)
        log(f"serverUrl = {SERVER_URL}")
    else:
        warn("serverUrl 입력란 없음 — 기본값 사용")

    if AUTH_TOKEN:
        at = popup.locator('input[placeholder*="token"], input[type="password"]')
        if at.count() > 0:
            at.fill(AUTH_TOKEN)
            log(f"authToken 입력 완료")
        else:
            warn("authToken 입력란 없음")
    else:
        warn("AUTH_TOKEN 비어있음 — 로컬 plan='pro' 설정 시도")
        # storage에 직접 plan=pro 심기 (SETTINGS_KEY = 'kaptik:settings')
        settings = {
            "plan": "pro", "language": "en",
            "enabled": True, "showSpeaker": True, "fontScale": 1,
            "overlayLineCount": 2, "overlayOpacity": 0.7,
            "showPanel": True, "notifyOnReady": False,
            "serverUrl": SERVER_URL, "authToken": "",
        }
        popup.evaluate("(s) => chrome.storage.local.set({ 'kaptik:settings': s })", settings)
        log("chrome.storage.local에 plan=pro 설정")
    time.sleep(0.5)

def get_popup_state(popup: Page, timeout: int = 8_000) -> str:
    """팝업 state-block 텍스트를 읽어 현재 상태를 반환한다."""
    try:
        popup.wait_for_selector(".state-block, .state-checking, .card", timeout=timeout)
    except Exception:
        pass
    return popup.evaluate("() => document.body.innerText").strip()[:400]

def step_unsupported(ctx: BrowserContext, ext_id: str):
    """Phase 1-a: 유튜브 아닌 탭에서 팝업 → Unsupported 확인."""
    print("\n[P1-a] Unsupported 상태")
    # 팝업을 별도 탭으로 열면 active tab이 popup 자체가 되어 unsupported가 뜬다
    popup = ctx.new_page()
    popup.goto(f"chrome-extension://{ext_id}/src/popup/index.html", wait_until="domcontentloaded")
    time.sleep(2)
    state_text = get_popup_state(popup)
    if "Not a supported" in state_text or "지원되지" in state_text or "🎬" in state_text:
        log(f"Unsupported 뷰 확인: {state_text[:80]!r}")
    else:
        warn(f"예상 외 팝업 텍스트: {state_text[:120]!r}")
    popup.close()

def step_none(ctx: BrowserContext, ext_id: str) -> tuple[Page, Page]:
    """Phase 1-b: 자막 없는 YouTube VOD → None 상태."""
    print("\n[P1-b] YouTube 영상 로드 + None 상태 확인")
    page = ctx.new_page()
    page.goto(YT_VIDEO, wait_until="domcontentloaded")
    try:
        page.wait_for_selector("video", timeout=15_000)
        log(f"YouTube 영상 로드: {YT_VIDEO}")
    except Exception:
        warn("video 엘리먼트 없음 — 영상 로드 실패 가능")

    # YouTube 탭이 active인 상태에서 팝업 열기
    # popup을 같은 window에서 열어야 chrome.tabs.query({active: true})가 video page를 인식한다
    popup = open_popup(ctx, ext_id, page)
    time.sleep(2)
    state_text = get_popup_state(popup, timeout=10_000)
    log(f"팝업 현재 텍스트: {state_text[:150]!r}")

    if "Generate subtitles" in state_text or "자막 생성" in state_text:
        log("None 상태 → Generate 버튼 확인")
    elif "No translation" in state_text or "번역" in state_text:
        log("None 상태 확인 (noneTitle 텍스트)")
    elif "Subtitles are ready" in state_text or "자막" in state_text:
        log("Available 상태 — 이미 자막 있음")
    else:
        warn(f"상태 불명: {state_text[:200]!r}")
    return page, popup

def step_generate(popup: Page, video_page: Page):
    """Phase 2: Generate 클릭 → Generating 상태 확인."""
    print("\n[P2] 자막 생성 플로우")
    state_text = get_popup_state(popup, timeout=3_000)

    # 이미 available이면 skip
    if "Subtitles are ready" in state_text or "자막 보기" in state_text or "View subtitles" in state_text:
        log("이미 자막 있음 — Generate 생략")
        return False

    try:
        btn = popup.locator("button.btn-primary").first
        btn.click()
        log(f"Generate 버튼 클릭 (텍스트: {btn.inner_text()!r})")
    except Exception as e:
        warn(f"Generate 버튼 클릭 실패: {e}")
        return False

    time.sleep(1)
    # Generating 뷰 대기 (progress bar)
    try:
        popup.wait_for_selector(".progress-bar", timeout=8_000)
        log("Generating 뷰 progress-bar 확인")
    except Exception:
        state_now = get_popup_state(popup, timeout=3_000)
        warn(f"Progress bar 미표시 — 현재 상태: {state_now[:150]!r}")

    # step label 확인
    for label in ["analyze", "captions", "stt", "translate"]:
        try:
            popup.wait_for_selector(f".state-step:has-text('{label}')", timeout=20_000)
            log(f"step label '{label}' 표시됨")
            break
        except Exception:
            pass

    return True

def step_await_subtitles(popup: Page, video_page: Page):
    """Phase 2: 완료 대기 → Available 상태 + 오버레이 확인."""
    print("\n[P2] 자막 완료 대기 (최대 3분)")
    try:
        # 완료 → Available 상태 ("View subtitles" btn or settings card)
        popup.wait_for_selector(".btn-primary, .card", timeout=180_000)
        time.sleep(0.5)
        state_text = get_popup_state(popup, timeout=3_000)
        if "View subtitles" in state_text or "Subtitles are ready" in state_text:
            log("Available-OFF 상태 → View subtitles 버튼 확인")
        elif "Creating subtitles" in state_text:
            warn("여전히 Generating 중...")
            return False
        else:
            log(f"팝업 상태: {state_text[:100]!r}")
    except Exception as e:
        warn(f"완료 대기 타임아웃: {e}")
        return False

    # View subtitles 클릭 (Available-OFF인 경우)
    try:
        btn = popup.locator("button.btn-primary:has-text('View subtitles'), button.btn-primary:has-text('자막 보기')").first
        if btn.count() > 0 and btn.is_visible():
            btn.click()
            log("View subtitles 클릭 → Available-ON 상태")
    except Exception:
        pass
    time.sleep(1)
    return True

def step_overlay(video_page: Page):
    """Phase 3: 영상 페이지에서 자막 오버레이 확인."""
    print("\n[P3] 자막 오버레이 & 패널 확인")
    video_page.bring_to_front()

    # Shadow DOM 탐색 — 모든 shadow root를 순회
    result = video_page.evaluate("""() => {
        const findings = [];
        const walk = (root) => {
            for (const el of root.querySelectorAll('*')) {
                if (el.shadowRoot) {
                    const sr = el.shadowRoot;
                    // Kaptik 클래스명 기준으로 탐색
                    const kaptikRoot = sr.querySelector('.kaptik-root');
                    const kaptikCenter = sr.querySelector('.kaptik-center');
                    const kaptikPanel = sr.querySelector('.kaptik-panel');
                    const kaptikLines = sr.querySelectorAll('.kaptik-center-line');
                    if (kaptikRoot) findings.push({
                        type: 'overlay-root',
                        hasPanel: !!kaptikRoot.classList.contains('has-panel'),
                        centerText: kaptikCenter?.textContent?.slice(0, 120) ?? '(empty)',
                        activeLines: kaptikRoot.querySelectorAll('.kaptik-center-line.is-active').length,
                        totalLines: kaptikLines.length,
                    });
                    if (kaptikPanel) findings.push({
                        type: 'panel',
                        docked: kaptikPanel.classList.contains('kaptik-panel--docked'),
                        bodyText: kaptikPanel.querySelector('.kaptik-panel-body')?.textContent?.slice(0, 200) ?? '(empty)',
                        isEmpty: !!kaptikPanel.querySelector('.kaptik-panel-empty'),
                    });
                    walk(sr);
                }
            }
        };
        walk(document);
        return findings;
    }""")
    if result:
        for item in result:
            t = item.get('type', '?')
            if t == 'overlay-root':
                has_panel = item.get('hasPanel')
                active = item.get('activeLines', 0)
                total = item.get('totalLines', 0)
                center = item.get('centerText', '')
                log(f"오버레이(.kaptik-root) 마운트됨 — has-panel={has_panel}, 활성 라인={active}/{total}")
                if center.strip():
                    log(f"  현재 자막 텍스트: {center!r}")
                else:
                    probe("  현재 자막 텍스트 없음 (스트리밍 미연결 또는 타임스탬프 미매칭)")
            elif t == 'panel':
                docked = item.get('docked')
                body = item.get('bodyText', '')
                empty = item.get('isEmpty')
                log(f"패널(.kaptik-panel) 마운트됨 — docked={docked}, empty={empty}")
                if body.strip():
                    log(f"  패널 내용: {body[:120]!r}")
    else:
        warn("kaptik Shadow DOM 없음 — content script 미주입 가능성")

    # kaptik 관련 DOM 직접 탐색
    kaptik_nodes = video_page.evaluate("""() => {
        const sel = [
            '#movie_player > *[class*="kaptik"]',
            '#secondary-inner > *',
            '.kaptik-overlay',
        ];
        const results = [];
        for (const s of sel) {
            const el = document.querySelector(s);
            if (el) results.push({ sel: s, tag: el.tagName, cls: el.className });
        }
        return results;
    }""")
    if kaptik_nodes:
        for n in kaptik_nodes:
            log(f"DOM 직접 발견: {n}")
    else:
        probe("일반 DOM에서 kaptik 노드 없음 (Shadow DOM 안에만 있는 경우 정상)")


def step_seek_playback(video_page: Page):
    """Phase 4: 재생/일시정지/탐색 연동 확인."""
    print("\n[P4] 재생 제어 확인")
    video_page.bring_to_front()

    # 현재 재생 상태 확인
    ct = video_page.evaluate("() => { const v = document.querySelector('video'); return v ? {t: v.currentTime, paused: v.paused} : null }")
    if not ct:
        warn("video 엘리먼트 없음")
        return
    log(f"초기 상태: currentTime={ct['t']:.1f}s, paused={ct['paused']}")

    # YouTube 전용 video 셀렉터 (html5-main-video)
    VQ = 'document.querySelector("video.html5-main-video") || document.querySelector("#movie_player video") || document.querySelector("video")'

    # 일시정지
    video_page.evaluate(f"() => {{ ({VQ})?.pause() }}")
    time.sleep(0.5)
    paused = video_page.evaluate(f"() => ({VQ})?.paused")
    log(f"pause() 후 paused={paused}") if paused else warn("pause() 후 paused=False")

    # 재생
    video_page.evaluate(f"() => {{ ({VQ})?.play() }}")
    time.sleep(0.5)
    playing = video_page.evaluate(f"() => !({VQ})?.paused")
    log(f"play() 후 playing={playing}") if playing else warn("play() 후 재생 안됨")

    # Seek (30초로 이동)
    video_page.evaluate(f"() => {{ const v = {VQ}; if(v) v.currentTime = 30; }}")
    time.sleep(1)
    ct2 = video_page.evaluate(f"() => ({VQ})?.currentTime")
    if ct2 and abs(ct2 - 30) < 5:
        log(f"seek to 30s 성공 → currentTime={ct2:.1f}s")
    else:
        warn(f"seek 결과 예상 밖: currentTime={ct2}")

def step_settings(popup: Page):
    """Phase 5: 설정 패널 조작."""
    print("\n[P5] 설정 패널 확인")
    # 언어 select (드롭다운)
    lang_sel = popup.locator("select.select").first
    if lang_sel.count() > 0:
        for lang_code in ["ja", "zh-CN", "en"]:
            lang_sel.select_option(lang_code)
            time.sleep(0.3)
            log(f"언어 select → '{lang_code}' 변경")
    else:
        probe("언어 select 엘리먼트 미발견")

    # 슬라이더 — 존재 여부만 확인
    sliders = popup.locator('input[type="range"]').count()
    log(f"range 슬라이더 {sliders}개 확인") if sliders >= 2 else warn(f"슬라이더 {sliders}개 (기대 ≥2)")

    # 패널 토글
    toggles = popup.locator('[role="switch"], input[type="checkbox"]').count()
    log(f"토글 {toggles}개 확인") if toggles >= 1 else warn(f"토글 미발견")

def step_plan_gating(ctx: BrowserContext, ext_id: str):
    """Phase 6: Basic 플랜 게이팅."""
    print("\n[P6] Basic 플랜 → Locked 상태 확인")
    # storage에 basic plan 설정
    tmp = ctx.new_page()
    tmp.goto(f"chrome-extension://{ext_id}/src/popup/index.html", wait_until="domcontentloaded")
    basic_settings = {
        "plan": "basic", "language": "en",
        "enabled": True, "showSpeaker": True, "fontScale": 1,
        "overlayLineCount": 2, "overlayOpacity": 0.7,
        "showPanel": True, "notifyOnReady": False,
        "serverUrl": "ws://localhost:8000", "authToken": "",
    }
    tmp.evaluate("(s) => chrome.storage.local.set({ 'kaptik:settings': s })", basic_settings)
    tmp.close()
    time.sleep(0.5)

    page = ctx.new_page()
    page.goto(YT_VIDEO, wait_until="domcontentloaded")
    try:
        page.wait_for_selector("video", timeout=15_000)
    except Exception:
        warn("video 엘리먼트 없음")

    popup2 = open_popup(ctx, ext_id, page)
    time.sleep(2)
    state_text = get_popup_state(popup2, timeout=8_000)
    log(f"Basic plan 팝업 상태: {state_text[:150]!r}")

    if "Pro plan required" in state_text or "Upgrade" in state_text or "🔒" in state_text:
        log("Basic plan + VOD → Locked 뷰 확인")
        probe("Upgrade CTA 버튼 확인")
        upgrade_btn = popup2.locator("button.upgrade-cta").first
        if upgrade_btn.count() > 0:
            log("upgrade-cta 버튼 존재")
        else:
            warn("upgrade-cta 버튼 미발견")
    else:
        warn(f"Locked 상태 미확인 — 텍스트: {state_text[:200]!r}")

    popup2.close()
    page.close()

# ── main ─────────────────────────────────────────────────────────────────────

def main():
    if not DIST.exists():
        print(f"❌ dist/ 없음: {DIST}\nnpm run build 먼저 실행하세요.")
        sys.exit(1)

    print(f"📦 dist/ 확인됨: {DIST}")

    with sync_playwright() as p:
        PROFILE.mkdir(parents=True, exist_ok=True)
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE),
            headless=False,
            args=[
                f"--disable-extensions-except={DIST}",
                f"--load-extension={DIST}",
                "--no-sandbox",
            ],
            slow_mo=200,
        )

        print("🚀 Chrome 실행 + 확장 프로그램 로드됨")

        # 기본 빈 탭 닫기
        if len(ctx.pages) > 0:
            ctx.pages[0].goto("about:blank")

        # Extension ID 확인
        try:
            ext_id = get_extension_id(ctx)
            log(f"Extension ID: {ext_id}")
        except Exception as e:
            print(f"❌ Extension ID 못 찾음: {e}")
            ctx.close()
            sys.exit(1)

        # 팝업 열어서 초기 설정
        init_popup = open_popup(ctx, ext_id, ctx.pages[0])
        step_configure(init_popup)
        init_popup.close()

        # Phase 1-a: Unsupported
        step_unsupported(ctx, ext_id)

        # Phase 1-b + 2 + 3: VOD 생성 플로우
        video_page, popup = step_none(ctx, ext_id)
        state_text = get_popup_state(popup, timeout=3_000)

        if "Subtitle language" in state_text or "Speaker Identification" in state_text:
            # Already Available-ON: subtitles cached from prior session
            log("Available-ON 상태 감지 — 자막 이미 존재함, 오버레이 확인으로 진행")
            time.sleep(3)  # content script 마운트 대기
            step_overlay(video_page)
            step_settings(popup)
            step_seek_playback(video_page)
        else:
            generated = step_generate(popup, video_page)
            if generated:
                completed = step_await_subtitles(popup, video_page)
                if completed:
                    time.sleep(3)
                    step_overlay(video_page)
                    step_settings(popup)
                    step_seek_playback(video_page)

        # Phase 6: Plan gating
        try:
            step_plan_gating(ctx, ext_id)
        except Exception as e:
            warn(f"Plan gating 테스트 오류: {e}")

        print("\n🏁 테스트 완료. 10초 후 브라우저 닫힘 (수동 확인 가능)")
        time.sleep(10)
        ctx.close()

if __name__ == "__main__":
    main()
