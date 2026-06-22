# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 커뮤니케이션 스타일

이 프로젝트의 주 대화 상대는 **기획자 포함 비개발자**다. 설명 시 아래 원칙을 반드시 지킨다.

- 기술 용어(Shadow DOM, WebSocket, Service Worker 등)를 쓸 때는 반드시 괄호로 쉬운 말을 붙인다. 예: "WebSocket(서버와 실시간으로 데이터를 주고받는 연결)"
- "왜 이게 필요한지", "사용자 입장에서 어떤 효과인지"를 먼저 설명하고 기술 구현은 나중에
- 코드 파일명·함수명은 꼭 필요한 경우만 언급하고, 언급 시에는 역할을 한 줄로 설명
- 아키텍처 다이어그램·기술 흐름보다 **사용자 경험 흐름** 중심으로 설명
- 결론·영향을 먼저 말하고, 원인·구현 상세는 그다음에

## 명령어

```bash
npm run dev          # 개발 빌드 (HMR, localhost 권한 포함)
npm run build        # 로컬/스테이징 빌드 (localhost:8000 권한 포함)
npm run build:prod   # 프로덕션 빌드 (localhost 권한 없음)
npx tsc --noEmit     # 타입 체크만
npm test             # 자동 점검기(테스트) 1회 실행 — 로직 회귀 확인
npm run test:watch   # 코드 바꿀 때마다 자동 점검기 재실행
npm run icons        # 아이콘 재생성
```

빌드 후 Chrome `chrome://extensions` → 개발자 모드 → `dist/` 폴더 로드. 코드 변경 시 확장 새로고침 + 해당 탭 새로고침 필요 (content script는 탭 새로고침 없이 반영 안 됨).

## 아키텍처

MV3 Chrome 확장으로 4개의 독립 실행 컨텍스트가 메시지로 통신한다.

```
popup ──┐
        ├──(RequestMessage)──→ background SW ──→ Kaptik 서버
content ─┘        │
    ↑              └──(BroadcastMessage)──→ content
    │                                           │
offscreen ←── tabCapture ────────────────────── │ (라이브만)
```

**메시지 규약**: `src/shared/messaging.ts`가 단일 진실 소스. `RequestMessage`(content/popup → background), `ResponseMessage`(동기 응답), `BroadcastMessage`(background → content 단방향) 세 종류.

### Background (`src/background/index.ts`)

서비스 워커. 자막 생성 Job 관리, WebSocket 스트리밍 세션, 탭 캐시 담당.

- **`generationStore.ts`**: `chrome.storage.local`로 Job 상태 추적 (`kaptik:jobs`, `kaptik:available`, `kaptik:cues_ready`, `kaptik:gen_lang`). `gen_lang`이 핵심 — 어떤 언어로 생성했는지 기록해 언어 불일치 시 "none"으로 처리함.
- **언어 race condition 패턴**: `GET_STATUS`, `START_GENERATION`, `START_STREAMING` 메시지는 모두 `language?` 필드를 받아 `getSettings().language`보다 우선 사용한다. 팝업이 `patch({ language })` (비동기 storage 저장)와 동시에 메시지를 보내기 때문.

### Content Script (`src/content/index.tsx`)

`SubtitleController` 단일 클래스가 자막 UI 생명주기 전체를 관리.

- **`evaluate()`**: 현재 URL/상태에 맞게 마운트/언마운트 결정. `evaluating` 플래그로 중복 실행 방지. 1500ms 주기 + URL 변경 + 설정 변경 시 호출됨.
- **`requestStatus` 호출 시 반드시 `this.settings.language`를 전달**해야 함. `onSettingsChanged`가 즉시 `this.settings`를 업데이트하므로 storage 저장 완료 전에도 올바른 언어 기준으로 상태를 체크할 수 있다.
- **언어 변경 시 흐름**: `onSettingsChanged` → `teardown()` → `evaluate()` → status가 "generating"이면 대기 → `SUBTITLES_READY` 브로드캐스트 수신 → 재마운트.

### 자막 UI (`src/content/ui/`)

Shadow DOM으로 사이트 CSS와 완전 격리. `mountDisplay()`가 두 개의 독립 Shadow DOM을 생성:
- 가운데 오버레이: 영상 플레이어 위에 absolute
- 우측 패널: 사이드 컬럼에 `prepend` (없으면 오버레이로 폴백)

단일 React root에서 `createPortal`로 두 위치를 동시에 렌더하므로 상태 공유.

**`pickText(cue.text, language)`** (`src/content/ui/pickText.ts`): `text[language] || text.en || 첫 번째 값` 순서로 폴백. `||`라서 **빈 문자열("")은 값 없음으로 취급**해 다음 언어로 넘어간다(번역 미완료 시 빈 칸 대신 영어로라도 표시). 가운데 오버레이·우측 패널이 반드시 같은 결과를 내야 하므로 **이 함수 하나만 공유**한다 — 절대 각 컴포넌트에 복붙하지 말 것(과거 `||`/`??`가 어긋나 두 위치가 다르게 동작한 버그 있음).

### WebSocket 스트리밍 (`src/api/wsClient.ts`)

2-stage 구조: Stage1(한국어 원문) → Stage2(번역 완료). cue 빌드 시 번역 텍스트를 `{ [this.targetLang]: text }` 로 저장 — `en`으로 하드코딩하면 인도네시아어(`id`) 등 라틴 문자 언어가 영어로 폴백됨.

### SiteAdapter (`src/content/siteAdapters/`)

YouTube/Weverse/Instagram DOM 접근 추상화. `getVideoId(url)`는 DOM이 아닌 URL만으로 판단 (popup에서도 재사용).

### 라이브 스트리밍

탭 오디오 캡처 → Offscreen Document (`src/offscreen/recorder.ts`) → 백엔드 WebSocket. MV3 Service Worker 30초 idle 종료 대응으로 20초 keepalive interval 사용.

## 변경 전후 점검 (두더지잡기 방지) — ⚠️ 반드시 지킬 것

이 확장은 광고·언어·타임스탬프·라이브/VOD·팝업 상태가 서로 얽혀 있어, **한 곳을 고치면 다른 곳이 깨지기 쉽다.** 그래서 모든 코드 변경 후 아래 순서를 반드시 따른다.

### 1) 자동 점검기 (로직 회귀 — 컴퓨터가 잡아준다)

```bash
npm test        # 통과(✓)해야 커밋. 실패(✗)면 어디가 깨졌는지 콕 집어준다
npx tsc --noEmit
```

순수 로직(언어 폴백·URL→영상ID·라이브 판별 등)에 단위 테스트가 있다. 테스트 파일은 대상 옆에 `*.test.ts`로 둔다.
- `src/content/ui/pickText.test.ts` — 언어 폴백(빈 문자열·인니어 등)
- `src/content/siteAdapters/siteAdapters.test.ts` — getVideoId·isLive·resolveAdapter
- `src/content/liveDetection.test.ts` — duration 기반 라이브/녹화 판별

**새 로직(특히 광고 판별·언어·타임스탬프)을 건드리면 반드시 테스트를 함께 추가한다.** 테스트하기 어려우면 DOM/`chrome` 의존을 떼어내 순수 함수로 분리한 뒤 테스트한다(예: `detectLiveFromVideo`, `pickText`를 별도 파일로 뺀 것처럼).

### 2) 영상 수동 점검표 (화면 표시 — 사람 눈으로 확인)

자동 점검기는 "로직"만 잡고 "화면에 제대로 보이는지"는 못 잡는다. 빌드 후 `dist/` 로드 → 아래 표에서 **이번에 건드린 영역의 행 + 인접 행**을 눌러본다.

| 시나리오 | 확인할 것 |
|----------|-----------|
| YouTube VOD + 자막 ON | 가운데·우측 자막이 같은 내용으로 뜬다 |
| YouTube 광고 재생 중 | 광고 동안 자막이 **완전히 사라진다**, 광고 끝나면 복귀 |
| YouTube 라이브 | 실시간 자막이 뜬다, 지연 배지 표시 |
| Weverse 라이브 | 자막 뜬다 / 광고(blob+유한 duration) 중엔 안 뜬다 |
| Weverse 다시보기(/live/ 유지) | 라이브가 아닌 VOD로 동작 (자막 시간 정상) |
| **언어 전환** (예: en→id) | 이전 언어가 안 새고, 새 언어로 재생성된다 |
| 타임스탬프 클릭 | 해당 위치로 영상이 이동한다 |
| **새로고침 후** | 팝업이 올바른 상태 표시 (설정화면 오표시·패널 자동마운트 없음) |
| 팝업 열기/언어변경 직후 메시지 | 상태가 어긋나지 않는다 (language race condition) |

> 화면 확인이 필요하면: 빌드는 에이전트가 하고, 사용자가 클릭/캡처 → 캡처를 보고 에이전트가 판단하는 협업이 현실적이다.

### 3) 불변식 (깨지면 버그 — 코드 수정 시 어기지 말 것)

- **언어 출처**: `GET_STATUS`/`START_GENERATION`/`START_STREAMING`와 `requestStatus` 호출 시 **항상 명시적으로 `language`를 전달**한다. `getSettings().language`(비동기 storage)에만 의존하면 race condition.
- **단일 진실 소스**: 같은 정보(현재 언어·상태)를 여러 곳에 복제하지 않는다. `gen_lang`은 "생성 언어" 추적 전용.
- **자막 텍스트 선택은 `pickText` 하나만** 사용 — 컴포넌트별 복붙 금지.
- **번역 언어 키**: cue 빌드 시 `{ [targetLang]: text }` 사용. `en` 하드코딩 금지(라틴 문자 언어가 영어로 폴백됨).
- **광고 중 자막**: 광고 재생 중에는 가운데·우측 **둘 다** 자막을 숨긴다(`isAd`).
- **라이브 판별**: URL `/live/`만 믿지 말고 `duration`으로 최종 판정(Weverse 다시보기 대응).

## 설계 원칙

- **`chrome.storage.local` vs `sync`**: 즉시 반영을 위해 `local` 사용 (sync는 쓰기 제한/지연 있음).
- **`gen_lang` 키**: 언어별 자막을 서버에서 별도 job으로 관리하므로, 로컬에서도 "이 영상은 어떤 언어로 생성됐는가"를 `gen_lang`으로 추적해야 언어 전환이 올바르게 동작함.
- **`force=true` 재생성**: 언어 변경 시 항상 `force=true`로 호출해 `removeAvailable`로 이전 언어 상태를 초기화한 뒤 새 job 생성.
