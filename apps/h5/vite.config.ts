import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
            '@gen': resolve(__dirname, 'src/gen'),
        },
    },
    server: {
        host: '0.0.0.0',
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:8080',
                changeOrigin: true,
            },
            '/ws': {
                target: 'ws://127.0.0.1:8080',
                ws: true,
                changeOrigin: true,
            },
        },
    },
    build: {
        target: 'es2020',
        minify: 'esbuild',
    },
});
