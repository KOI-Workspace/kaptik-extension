import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// 자동 점검기(테스트) 전용 설정.
// 빌드용 vite.config.ts와 분리해 crx/react 플러그인 없이 가볍게 돌린다.
// jsdom 환경을 써서 document 참조가 있는 로직(예: isLive DOM 폴백)도 테스트 가능.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
