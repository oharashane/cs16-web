import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** The site's password, from the file the relay itself reads it from. */
function readPassword(): string {
    try {
        const env = readFileSync(new URL('../.relay.env', import.meta.url), 'utf8');
        return /^RELAY_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim() ?? '';
    } catch {
        return '';
    }
}

// The tests drive the built client through the running relay (cs16-relay user unit) and a
// live game server: they are an end-to-end check of this machine, not a unit suite.
export default defineConfig({
    testDir: 'tests',
    timeout: 180_000,
    use: {
        baseURL: process.env.RELAY_URL ?? 'http://127.0.0.1:27100',
        // The whole site is behind the family's login now; the tests knock like anyone else.
        httpCredentials: {
            username: process.env.RELAY_USER ?? 'ohara',
            password: process.env.RELAY_PASSWORD ?? readPassword(),
        },
        launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    },
    reporter: 'list',
});
