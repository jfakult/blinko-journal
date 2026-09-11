import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from 'path';
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const host = process.env.TAURI_DEV_HOST || '0.0.0.0';
const EXPRESS_PORT = 1111;
const isDev = process.env.NODE_ENV === 'development';

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(), 
    tailwindcss(),
    // PWA: Only enabled in production, disabled in development to avoid caching issues
    ...(!isDev && !process.env.DISABLE_PWA ? [
      VitePWA({
        // Disable in development mode
        devOptions: {
          enabled: false
        },
        // Auto update service worker when new version is available
        registerType: 'autoUpdate',
        includeAssets: ['icons/*.png'],
        // CUSTOM-JOURNAL: this is the manifest actually used by the
        // installed/production PWA (vite-plugin-pwa generates and injects
        // its own manifest at build time, superseding public/manifest.json
        // -- keep both in sync, see that file's own CUSTOM-JOURNAL note).
        // Was still upstream's literal "Blinko" name + Blinko's own icon
        // set + a plain white theme_color, which is why installing this app
        // showed "Blinko" with Blinko's icons and a blank white title bar
        // regardless of what public/manifest.json said.
        manifest: {
          name: 'Journal',
          short_name: 'Journal',
          description: 'A private, self-hosted personal journal',
          icons: [
            {
              src: './icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: './icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png'
            },
            {
              src: './icons/icon-512-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ],
          theme_color: '#15072B',
          background_color: '#15072B',
          start_url: './',
          display: 'standalone',
          orientation: 'portrait'
        },
        workbox: {
          // Maximum file size to cache (10MB)
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
          // Don't cache API requests
          navigateFallbackDenylist: [/\/api\/.*/, /\/v1\/.*/, /\/dist\/.*/, /\/plugins\/.*/],
          // Clean old caches automatically
          cleanupOutdatedCaches: true,
          // Runtime caching strategy for better update control
          runtimeCaching: [
            {
              // Cache API responses with network-first strategy
              urlPattern: /^https:\/\/api\..*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-cache',
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 5 * 60, // 5 minutes
                },
                networkTimeoutSeconds: 10,
              },
            },
            {
              // Cache images with cache-first strategy
              urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'image-cache',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
                },
              },
            },
          ],
        },
      })
    ] : [])
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared')
    }
  },
  build: {
    outDir: "../dist/public",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/react') || 
              id.includes('node_modules/react-dom') || 
              id.includes('node_modules/react-router-dom')) {
            return 'react-vendor';
          }
          
          if (id.includes('node_modules/@react-') || 
              id.includes('node_modules/react-') || 
              id.includes('node_modules/@ui-') || 
              id.includes('node_modules/@headlessui') || 
              id.includes('node_modules/headlessui')) {
            return 'ui-components';
          }
          
          if (id.includes('node_modules/lodash') || 
              id.includes('node_modules/axios') || 
              id.includes('node_modules/date-fns')) {
            return 'utils';
          }
        }
      }
    }
  },
  clearScreen: false,
  server: {
    port: EXPRESS_PORT,
    strictPort: false,
    host: host || false,
    allowedHosts: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/node_modules/**", "**/.git/**"],
    },
  },
  optimizeDeps: {
    force: false,
    include: ['react', 'react-dom', 'react-router-dom'],
    exclude: []
  },
  css: {
    devSourcemap: false
  },
  cacheDir: 'node_modules/.vite',
  experimental: {
    renderBuiltUrl: (filename) => ({ relative: true }),
    hmrPartialAccept: true
  }
});
