# Kaptik 확장 프로그램

글로벌 K-pop 팬을 위한 영상 자막 확장 프로그램입니다. **YouTube · Weverse** 영상 위에 화자 라벨 + 다국어 번역 자막을 오버레이로 띄웁니다.

## 기술 스택

- **Manifest V3** Chrome 확장 프로그램
- **React + TypeScript + Vite + CRXJS**

## 구조

```
src/
  types/subtitle.ts          # 자막/언어 공통 타입
  shared/
    settings.ts              # 사용자 설정 (chrome.storage.sync)
    messaging.ts             # content ↔ background 메시지 규약
  api/
    client.ts                # Kaptik API 클라이언트 (미연결 시 mock 폴백)
    mockSubtitles.ts         # 백엔드 개발 전 임시 자막
  background/index.ts        # 자막 요청 중계 + 메모리 캐시
  content/
    index.tsx                # 진입점: 영상 감지 → 오버레이 생명주기 관리
    siteAdapters/            # YouTube / Weverse 사이트별 DOM 접근 추상화
    overlay/                 # Shadow DOM 자막 오버레이 (외부 CSS 격리)
    hooks.ts                 # useSettings / useActiveCue
  popup/                     # 툴바 설정 팝업 UI
```

## 개발

```bash
npm install
npm run dev      # 개발 빌드 (HMR) → dist/ 생성
npm run build    # 타입체크 + 프로덕션 빌드
npm run icons    # 브랜드 아이콘 재생성
```

## 브라우저에 로드하는 법

1. `npm run dev` 또는 `npm run build` 실행
2. Chrome → `chrome://extensions` 접속
3. 우측 상단 **개발자 모드** 켜기
4. **압축해제된 확장 프로그램을 로드** → `dist/` 폴더 선택
5. YouTube 또는 Weverse 영상 페이지를 열면 자막이 자동 표시

## 자막 데이터

현재 백엔드(Kaptik API)는 개발 중이라, `api/client.ts`가 API 호출에 실패하면
`mockSubtitles.ts`의 샘플 자막으로 자동 폴백합니다. 백엔드가 준비되면
`API_BASE` 도메인만 교체하면 됩니다.

기대하는 API 응답 형태:

```jsonc
// GET https://api.kaptik.app/v1/subtitles?platform=youtube&videoId=...
{
  "cues": [
    {
      "start": 0, "end": 3.5, "speaker": "RM",
      "text": { "ko": "...", "en": "...", "ja": "...", "zh-CN": "...", "id": "..." },
      "contextNote": "선택: 문화 맥락 설명"
    }
  ],
  "availableLanguages": ["ko", "en", "ja", "zh-CN", "id"]
}
```

> 평면 형태(`{ "start":0, "en":"...", "ja":"..." }`)로 내려와도 클라이언트가 정규화합니다.
