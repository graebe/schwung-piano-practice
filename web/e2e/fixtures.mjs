// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The suite's page: Chrome's coverage recorded around every test when asked,
 * every console error and page error collected and failed on, and the Ground's
 * motion off so screenshots hold still.
 */
import { test as base, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAW = fileURLToPath(new URL('../../build/coverage/e2e-raw/', import.meta.url));
const coverage = process.env.PP_E2E_COVERAGE === '1';

/* A learner already welcomed, with every first-visit tip seen: the cards
 * would otherwise sit over the screens the tests are about. A test of the
 * welcome itself says `test.use({ welcomed: false })`. */
const SEEN = JSON.stringify({ tips: ['welcome', 'sheet', 'practice', 'quiz', 'map', 'island', 'placement', 'cells'] });

export const test = base.extend({
  welcomed: [true, { option: true }],
  page: async ({ page, welcomed }, use, info) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(([seen, on]) => {
      try { localStorage.setItem('ultraviolet.motion.piano-practice', '0'); } catch (e) { /* none */ }
      /* Only when nothing is stored yet, so a reload keeps what the test did. */
      try {
        if (on && !localStorage.getItem('piano-practice:progress.json')) localStorage.setItem('piano-practice:progress.json', seen);
      } catch (e) { /* none */ }
    }, [SEEN, welcomed]);
    if (coverage) await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await use(page);
    if (coverage) {
      const entries = await page.coverage.stopJSCoverage();
      mkdirSync(RAW, { recursive: true });
      const name = `${info.project.name}-${info.titlePath.join('-')}`.replace(/[^a-z0-9-]+/gi, '_');
      writeFileSync(`${RAW}${name}.json`, JSON.stringify(entries.filter((e) => e.url.includes('/assets/'))));
    }
    expect(errors.filter((e) => !/MIDI/i.test(e)), 'console errors').toEqual([]);
  },
});

export { expect };

/* Open rows by their labels, closing a first-time Info page on the way. */
export async function openPath(page, labels) {
  for (const label of labels) {
    await page.locator('.row', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click();
  }
  await closeInfo(page);
}

export async function closeInfo(page) {
  await page.waitForTimeout(50);
  if (await page.locator('.info-screen').count()) await page.getByRole('button', { name: 'Close' }).click();
}
