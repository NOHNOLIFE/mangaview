import {fileURLToPath, URL} from 'node:url'

import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import {quasar, transformAssetUrls} from '@quasar/vite-plugin'
import {VitePWA} from "vite-plugin-pwa";

let showSourceMap = process.env.NODE_ENV === 'development';

export default defineConfig({
    base:'./',
    plugins: [vue({
        template: {transformAssetUrls},
    }),
        vueJsx(),
        quasar({}),
        VitePWA({
            registerType: 'autoUpdate',
            workbox: {
                globPatterns: ['**/*.{js,css,html,ttf,woff2,ico,png,jpg}'],
            },
            devOptions: {
                enabled: true
            },
            manifest: {
                "name": "MangaView easy view easy fun",
                "short_name": "MangaView",
                "description": "Manga explorer reader Viewer",
                "icons": [
                    {
                        "src": "/icons/icon-64.png",
                        "sizes": "64x64",
                        "type": "image/png"
                    },
                    {
                        "src": "/icons/icon-128.png",
                        "sizes": "128x128",
                        "type": "image/png"
                    },
                    {
                        "src": "/icons/icon-256.png",
                        "sizes": "256x256",
                        "type": "image/png"
                    },
                    {
                        "src": "/icons/icon-512.png",
                        "sizes": "512x512",
                        "type": "image/png"
                    }
                ],
                "start_url": "/index.html",
                "display": "fullscreen",
                "theme_color": "#212121",
                "background_color": "#212121"
            },
        })
    ],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    build: {sourcemap: showSourceMap},
    css: {devSourcemap: showSourceMap}
})
