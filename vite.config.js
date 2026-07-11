import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    port: 3000,
    host: true
  },
  plugins: [
    VitePWA({
      // 자동으로 Service Worker를 생성하고 등록
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        // 앱 기본 정보
        name: '스트림스 보드게임',
        short_name: '스트림스',
        description: '초등학교 교실에서 다 함께 즐기는 실시간 스트림스 보드게임 웹 앱',
        lang: 'ko',
        // 앱 시작 URL
        start_url: '/',
        scope: '/',
        // 앱처럼 단독 실행 (주소창/브라우저 UI 없음)
        display: 'standalone',
        // 테마 색상
        theme_color: '#0f172a',
        background_color: '#0f172a',
        orientation: 'portrait-primary',
        // 아이콘 설정
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ],
        // 카테고리
        categories: ['games', 'education'],
        // 스크린샷 (선택사항)
        prefer_related_applications: false
      },
      // Workbox 캐싱 전략 설정
      workbox: {
        // 앱 Shell 캐싱 - 오프라인에서도 기본 UI 표시
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // 네트워크 우선 전략 (실시간 게임이라 최신 데이터 중요)
        runtimeCaching: [
          {
            // Supabase API는 네트워크 우선
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 // 1시간
              },
              networkTimeoutSeconds: 10
            }
          },
          {
            // Google Fonts 캐싱
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1년
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ]
});
