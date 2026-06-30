# Chrome Web Store — 권한 사유 (Permission Justifications)

크롬 개발자 대시보드 > "Privacy practices" 탭의 각 권한 입력란에 아래 영어 문구를 그대로 붙여넣으세요.
(코드 감사 결과 기준 — 2026-06-30. 권한이 추가/삭제되면 이 파일도 갱신할 것)

## Permissions

| 권한 | 대시보드에 붙여넣을 사유 (영어) |
|---|---|
| `storage` | Stores the user's subtitle settings and the status of subtitle-generation jobs locally so they persist across sessions. |
| `tabs` | Detects which supported video the user is watching and routes subtitle data to the correct tab. |
| `tabCapture` | Captures the active tab's audio for live streams so it can be transcribed into real-time subtitles. |
| `offscreen` | Creates an offscreen document to process captured tab audio, as required by Manifest V3. |
| `activeTab` | Grants temporary access to the active tab when the user clicks the extension, which is required to start audio capture. |
| `notifications` | Notifies the user when their subtitles are ready. |
| `alarms` | Schedules background tasks reliably, since the Manifest V3 service worker can be terminated when idle. |
| `cookies` | Detects and maintains the user's sign-in session. |

## Host permissions

| 호스트 | 사유 (영어) |
|---|---|
| `*://*.youtube.com/*` | Displays the subtitle overlay on YouTube video pages. |
| `*://*.weverse.io/*` | Displays the subtitle overlay on Weverse video pages. |
| `*://*.instagram.com/*` | Displays the subtitle overlay on Instagram video pages. |
| `*://*.kaptik.site/*` | Communicates with the Kaptik backend to fetch and generate subtitles. |

## 추가로 체크할 항목 (대시보드)

- [ ] Privacy policy URL 입력: `https://kaptik.site/privacy`
- [ ] "I do not sell or transfer user data to third parties, outside of the approved use cases" 체크
- [ ] "I do not use or transfer user data for purposes that are unrelated to my item's single purpose" 체크
- [ ] "I do not use or transfer user data to determine creditworthiness or for lending purposes" 체크
- [ ] Single purpose 설명 입력 (예: "Kaptik provides real-time subtitles and translation for Korean video content.")

## 감사 결과 요약

- 코드 추적 결과 **8개 permission + 4개 host permission 모두 실제로 사용 중**. 제거 대상 없음.
- `manifest.config.ts` 수정 불필요.
