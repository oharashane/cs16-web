import { defineConfig } from '@playwright/test';

// The tests drive the built client through the running relay (cs16-relay user unit) and a
// live game server: they are an end-to-end check of this machine, not a unit suite.
export default defineConfig({
    testDir: 'tests',
    timeout: 180_000,
    use: {
        baseURL: process.env.RELAY_URL ?? 'http://127.0.0.1:27100',
        launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    },
    reporter: 'list',
});
