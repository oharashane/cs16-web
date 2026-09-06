import { defineConfig } from 'vite';

// Built into dist/ and served by the relay at /client. The base path keeps the hashed
// assets under /client/assets, away from the 2025 client's /assets.
export default defineConfig({
    base: '/client/',
    build: { target: 'es2022', sourcemap: true },
    server: { proxy: { '/api': 'http://127.0.0.1:27100', '/ws': { target: 'ws://127.0.0.1:27100', ws: true }, '/valve.zip': 'http://127.0.0.1:27100' } },
});
