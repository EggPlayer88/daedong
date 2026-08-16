import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  // ⚠ 포트 고정 (DECISIONS.md 교훈 1)
  //   chunha-sim 등 다른 Vite 프로젝트가 5173 을 쓰는 중에 이 앱을 띄우면
  //   포트가 자동으로 밀리고, OAuth 리디렉션이 "조용히" 깨진다.
  //   strictPort: true → 5175 가 점유돼 있으면 밀리는 대신 즉시 에러.
  //   Google OAuth 승인 원본 / Supabase Redirect URL 도 전부 5175 기준으로 등록한다.
  server: {
    port: 5175,
    strictPort: true,
  },

  // 워크스페이스 패키지는 소스 그대로 사용 (사전 번들링 제외)
  optimizeDeps: {
    exclude: ['@daedong/shared', '@daedong/timetable'],
  },
})
