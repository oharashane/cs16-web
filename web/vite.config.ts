import { defineConfig } from 'vite';

// Built into dist/ and served by the relay at /play. The base path keeps the hashed
// assets under /play/assets, away from the 2025 client's /assets.
// ENGINE=built resolves the engine and the game to the packages engine/build.sh produces
// instead of the vendored tarballs — same import paths in src/, different bytes. The relay
// serves that build at /next, beside /play, so the two can be compared in the same tab.
const built = process.env.ENGINE === 'built';
// ENGINE_REF=gl4es (with ENGINE=built): the renderer the page loads under the shim's name
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
    build: { target: 'es2022', sourcemap: true },
    server: { proxy: { '/api': 'http://127.0.0.1:27100', '/ws': { target: 'ws://127.0.0.1:27100', ws: true }, '/valve.zip': 'http://127.0.0.1:27100' } },
});
