// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * web-shots.mjs — the pictures in docs/web.md, taken from the real page.
 *
 *   npm run web:build && npx vite preview --config web/vite.config.js &
 *   node tools/web-shots.mjs            -> docs/media/web-*.png
 *   PP_URL=http://localhost:<port>/ node tools/web-shots.mjs   another server
 *
 * Taken, not drawn, so the tutorial shows what the page is. Re-run whenever
 * a screen changes and commit what it writes.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../docs/media/', import.meta.url));
const URL_ = process.env.PP_URL || 'http://localhost:47332/';

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

/* Welcomed, every first-visit tip seen: the cards would sit over the screens. */
const SEEN = JSON.stringify({ tips: ['welcome', 'sheet', 'practice', 'quiz', 'map', 'island', 'placement'] });

async function open(viewport, settings = { version: 8, autoInfo: false, roundSize: 10 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.addInitScript(([seen, s]) => {
    localStorage.setItem('ultraviolet.motion.piano-practice', '0');
    localStorage.setItem('piano-practice:settings.json', s);
    localStorage.setItem('piano-practice:progress.json', seen);
  }, [SEEN, JSON.stringify(settings)]);
  await page.goto(URL_);
  await page.waitForSelector('.home-screen');
  return page;
}

/* A row by its exact label: home's and a ring's rows, a folder's. */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function row(page, label) {
  await page.locator('.row').filter({ has: page.locator('.row-label', { hasText: new RegExp(`^${esc(label)}$`) }) })
    .first().click();
}
async function openPath(page, labels) {
  for (const l of labels) await row(page, l);
}
async function shoot(page, name) {
  await page.mouse.move(1, 1);
  await page.screenshot({ path: OUT + name });
  console.log('wrote docs/media/' + name);
}

/* Home; the Learning Path's world map, the avatar standing; the Practice ring. */
let page = await open({ width: 1280, height: 640 });
await shoot(page, 'web-home.png');
await page.keyboard.press('Enter');
await page.locator('.map[data-walking="no"]').waitFor();
await shoot(page, 'web-map.png');
await page.keyboard.press('Escape');
await page.locator('svg.home[data-ring="Piano"]').waitFor();
await row(page, 'Practice');
await page.locator('svg.home[data-ring="Practice"]').waitFor();
await shoot(page, 'web-ring.png');

/* Listening to a drill: the staff scrolls and the keys light. */
await openPath(page, ['Scales', 'Learn', 'Major', 'Up & down']);
await page.locator('#piece-title').waitFor();
await page.setViewportSize({ width: 1280, height: 760 });
await page.getByRole('button', { name: 'Listen' }).click();
await page.waitForTimeout(5300);
await shoot(page, 'web-listen.png');

/* Practising with a wrong note, waiting on the next. */
await page.getByRole('button', { name: 'Practice' }).click();     /* from listening to practising */
await page.locator('.staff-badge', { hasText: /waiting/i }).waitFor({ timeout: 12000 });
await page.keyboard.down('KeyW');
await page.keyboard.up('KeyW');
await page.waitForTimeout(150);
await page.screenshot({ path: OUT + 'web-wait.png' });
console.log('wrote docs/media/web-wait.png');
await page.close();

/* A song, ready: its levels above the staff. */
page = await open({ width: 1280, height: 760 });
await openPath(page, ['Songs', 'Classics', 'Ode to Joy']);
await page.locator('.levels .btn').first().waitFor();
await shoot(page, 'web-ready-song.png');
await page.close();

/* A trainer: its five circles, its setup box, a progression from its numerals. */
page = await open({ width: 1280, height: 640 });
await openPath(page, ['Practice', 'Progressions']);
await page.locator('svg.home[data-ring="Progressions"]').waitFor();
await shoot(page, 'web-trainer.png');
await row(page, 'Play');
await page.locator('.setup-screen').waitFor();
await shoot(page, 'web-setup.png');
await page.locator('.setup-box > .btn').click();
await page.locator('.chord-row').waitFor();
await shoot(page, 'web-progression.png');
await page.close();

/* A hearing drill, answered: where the answer sits on the keys. Notes ›
 * Hear, higher or lower. */
page = await open({ width: 1280, height: 640 });
await openPath(page, ['Practice', 'Notes', 'Hear']);
await page.locator('.setup-card[data-field="answer"]').getByRole('button', { name: /Answer: up$/ }).click();
await page.locator('.setup-box > .btn').click();
await page.locator('.option').first().waitFor();
for (const option of await page.locator('.option').all()) {
  if (await option.isDisabled()) break;
  await option.click();
}
await page.locator('.kb-key.hit').first().waitFor();
await shoot(page, 'web-hear.png');

/* Its Stats, after a round: what was asked, weakest first. */
for (let i = 0; i < 60 && !(await page.locator('.result-screen').count()); i++) {
  for (const option of await page.locator('.option').all()) {
    if (await option.isDisabled()) break;
    await option.click();
  }
  await page.waitForTimeout(1500);
}
await page.locator('.result-screen').waitFor();
for (let i = 0; i < 4 && !(await page.locator('svg.home[data-ring="Notes"]').count()); i++) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}
await row(page, 'Stats');
await page.locator('.stats-table tbody tr').first().click();
await page.locator('.stats-screen .progress-detail figure').waitFor();
await shoot(page, 'web-stats.png');
await page.close();

/* A result: a drill played twice, by the lit keys, at a brisk tempo. */
page = await open({ width: 1280, height: 640 }, { version: 8, autoInfo: false, bpm: 160, countIn: 1 });
await openPath(page, ['Practice', 'Scales', 'Learn', 'Major', 'Up']);
for (let round = 0; round < 2; round++) {
  await page.getByRole('button', { name: round ? 'Again' : 'Practice' }).click();
  for (let i = 0; i < 80 && !(await page.locator('.result-screen').count()); i++) {
    const lit = page.locator('.kb-key.lit, .kb-key.target').first();
    if (await lit.count()) await lit.click();
    await page.waitForTimeout(160);
  }
  await page.locator('.result-screen').waitFor({ timeout: 20000 });
  /* A level learned plays its star over the result first. */
  await page.locator('.anim-over').waitFor({ state: 'detached' });
}
await shoot(page, 'web-result.png');
await page.close();

/* Settings: the one short page. */
page = await open({ width: 1280, height: 640 });
await page.getByRole('button', { name: 'Settings' }).click();
await page.locator('#settings-title').waitFor();
await shoot(page, 'web-settings.png');
await page.close();

/* A phone. */
page = await open({ width: 390, height: 844 });
await openPath(page, ['Songs', 'Classics', 'Ode to Joy']);
await page.locator('.levels .btn').first().waitFor();
await shoot(page, 'web-phone.png');

await browser.close();
