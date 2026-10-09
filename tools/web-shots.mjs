// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * web-shots.mjs — the pictures in docs/web.md, taken from the real page.
 *
 *   npm run web:build && npx vite preview --config web/vite.config.js &
 *   node tools/web-shots.mjs            -> docs/media/web-*.png
 *
 * Taken, not drawn, so the tutorial shows what the page is. Re-run whenever
 * a screen changes and commit what it writes.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../docs/media/', import.meta.url));
const URL_ = process.env.PP_URL || 'http://localhost:47332/';

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

async function open(viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    localStorage.setItem('ultraviolet.motion.piano-practice', '0');
    localStorage.setItem('piano-practice:settings.json', JSON.stringify({ version: 7, autoInfo: false, roundSize: 10 }));
  });
  await page.goto(URL_);
  await page.waitForSelector('.row');
  return page;
}
const row = (page, label) => page.locator('.row', { hasText: new RegExp(`^${label}`) }).first().click();

/* The list. */
let page = await open({ width: 1280, height: 760 });
await page.mouse.move(1, 1);
await page.screenshot({ path: OUT + 'web-list.png' });

/* Listening to a drill: the staff scrolls and the keys light. */
for (const l of ['Basics', 'Scales', 'Major', 'Up & down']) await row(page, l);
await page.getByRole('button', { name: 'Listen' }).click();
await page.waitForTimeout(5300);
await page.mouse.move(1, 1);
await page.screenshot({ path: OUT + 'web-listen.png' });

/* Practising with a wrong note, waiting on the next. */
await page.getByRole('button', { name: 'Practice' }).click();     /* from listening to practising */
await page.locator('.staff-badge', { hasText: /waiting/i }).waitFor({ timeout: 12000 });
await page.keyboard.down('KeyW');
await page.keyboard.up('KeyW');
await page.waitForTimeout(150);
await page.screenshot({ path: OUT + 'web-wait.png' });
await page.close();

/* A hearing drill. */
page = await open({ width: 1280, height: 640 });
for (const l of ['Quiz', 'Hear', '5 Major or minor 3rd']) await row(page, l);
await page.locator('.row').first().click();
await page.waitForTimeout(1200);
await page.mouse.move(1, 1);
await page.screenshot({ path: OUT + 'web-hear.png' });
await page.close();

/* A result: a drill played twice, by the lit keys, at a brisk tempo. */
page = await open({ width: 1280, height: 640 });
await page.evaluate(() => localStorage.setItem('piano-practice:settings.json',
  JSON.stringify({ version: 7, autoInfo: false, bpm: 160, countIn: 1 })));
await page.reload();
await page.waitForSelector('.row');
for (const l of ['Basics', 'Scales', 'Major', 'Up']) await row(page, l);
for (let round = 0; round < 2; round++) {
  await page.getByRole('button', { name: round ? 'Again' : 'Practice' }).click();
  for (let i = 0; i < 80 && !(await page.locator('.result-screen').count()); i++) {
    const lit = page.locator('.kb-key.lit, .kb-key.target').first();
    if (await lit.count()) await lit.click();
    await page.waitForTimeout(160);
  }
  await page.locator('.result-screen').waitFor({ timeout: 20000 });
}
await page.mouse.move(1, 1);
await page.screenshot({ path: OUT + 'web-result.png' });
await page.close();

/* A phone. */
page = await open({ width: 390, height: 844 });
for (const l of ['Classics', 'Ode to Joy', 'L1 RH melody']) await row(page, l);
await page.mouse.move(1, 1);
await page.screenshot({ path: OUT + 'web-phone.png' });

await browser.close();
console.log('wrote docs/media/web-*.png');
