// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The page, end to end, in Chrome: the built app served by `vite preview` on
 * this suite's own port, so nothing else on the machine can answer in its
 * place. The installed Chrome where there is one (as the plugin repo's suite
 * runs), Playwright's Chromium otherwise.
 *
 *   npx playwright test --config web/e2e/playwright.config.mjs
 *   PP_E2E_COVERAGE=1 ...   also writes build/coverage/e2e.lcov
 */
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = 47333;
const coverage = process.env.PP_E2E_COVERAGE === '1';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  outputDir: `${ROOT}/build/e2e-results`,
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{projectName}-{platform}{ext}',
  fullyParallel: true,
  workers: 4,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  globalTeardown: coverage ? './coverage-teardown.mjs' : undefined,
  expect: { toHaveScreenshot: { maxDiffPixels: 40, animations: 'disabled' } },
  use: {
    baseURL: `http://localhost:${PORT}/`,
    channel: process.env.PP_E2E_CHROMIUM ? undefined : 'chrome',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium', isMobile: false } },
  ],
  webServer: {
    command: `sh scripts/build-wasm.sh && ${coverage ? 'PP_SOURCEMAP=1 ' : ''}npx vite build --config web/vite.config.js --logLevel error && npx vite preview --config web/vite.config.js --port ${PORT} --strictPort`,
    cwd: ROOT,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
