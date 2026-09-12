import { defineConfig } from 'vite';

// Built into dist/ and served by the relay at /play. The base path keeps the hashed
// assets under /play/assets, away from the 2025 client's /assets.
//
// The engine and the game come from the packages engine/build.sh compiles — our own build,
// with the memory-growth and fragment patches (docs/engine/journal.md). That is the
// default since 9 September 2026. ENGINE=vendored resolves them to the withdrawn npm
// tarballs in vendor/ instead, kept as the archived reference for an A/B; same import
// paths in src/, different bytes.
const built = process.env.ENGINE !== 'vendored';
// ENGINE_REF=gl4es: the renderer the page loads under the shim's name
// is gl4es instead. The engine dlopens whatever file carries that name; both export the
// same ref API. An experiment's switch, not a setting anyone should need.
const gl4es = built && process.env.ENGINE_REF === 'gl4es';

export default defineConfig({
    resolve: built ? { alias: [
        // a regex, because the import carries a ?url query and a string find will not match it
        ...(gl4es ? [{ find: /^xash3d-fwgs\/libref_webgl2\.wasm/, replacement: 'xash3d-fwgs-built/libref_gl4es.wasm' }] : []),
        { find: /^xash3d-fwgs(\/|$)/, replacement: 'xash3d-fwgs-built$1' },
        { find: /^cs16-client(\/|$)/, replacement: 'cs16-client-built$1' },
    ] } : undefined,
    base: '/play/',
    // Two pages: the play page, and the tour at /tour (the relay serves dist/tour.html there).
    build: { target: 'es2022', sourcemap: true, rollupOptions: { input: { main: 'index.html', tour: 'tour.html' } } },
    server: { proxy: { '/api': 'http://127.0.0.1:27100', '/ws': { target: 'ws://127.0.0.1:27100', ws: true }, '/valve.zip': 'http://127.0.0.1:27100' } },
});
