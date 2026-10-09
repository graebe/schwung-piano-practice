// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
/*
 * The practice page, end to end: the built app in Chrome, driven by mouse and
 * keyboard as a person would, with the session running in the page.
 */
import { test, expect, openPath, closeInfo } from './fixtures.mjs';
import { createSession } from '../../src/session.mjs';
import { viewModel, encodeViewModel } from '../../src/view_model.mjs';
import { readFileSync, existsSync } from 'node:fs';

const SCALE = ['Basics', 'Scales', 'Major', 'Up & down'];
/* A lit key's spoken name ("C sharp 4") as the options print it ("C#4"). */
const asLabel = (spoken) => spoken.replace(' sharp ', '#').replace(' flat ', 'b').replace(/ /g, '');

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.waitForSelector('.row');
});

test('the lesson list opens folders and steps back out', async ({ page }) => {
  await expect(page.locator('.row')).toHaveCount(8);
  await page.locator('.row', { hasText: 'Basics' }).click();
  await expect(page.locator('#list-title')).toHaveText(/basics/i);
  await expect(page.locator('.row')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await expect(page.locator('.row')).toHaveCount(8);
  await expect(page.locator('.row.on')).toHaveText(/Basics/, { message: 'back where it came from' });
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.row.on')).toHaveText(/Quiz/);
  await page.keyboard.press('Enter');
  await expect(page.locator('#list-title')).toHaveText(/quiz/i);
});

test('arming a drill: the staff, its stage, and Listen lighting the keys', async ({ page }) => {
  await openPath(page, SCALE);
  await expect(page.locator('#piece-title')).toHaveText(/C Major/i);
  await expect(page.locator('.staff-wrap svg')).toBeVisible();
  await page.getByRole('button', { name: 'Stage 2 · read' }).click();
  await expect(page.getByRole('button', { name: 'Stage 2 · read' })).toHaveClass(/on/);
  await page.getByRole('button', { name: 'Stage 1 · lit' }).click();
  await page.getByRole('button', { name: 'Listen' }).click();
  await expect(page.locator('.count-in')).toBeVisible();
  await expect(page.locator('.kb-key.lit')).toHaveCount(1, { timeout: 6000 });
  await page.getByRole('button', { name: 'Listen' }).click();
  await expect(page.locator('.staff-badge')).toHaveText(/paused/i);
});

test('practising from the computer keyboard: a right note scores, a wrong one is counted', async ({ page }) => {
  await openPath(page, SCALE);
  await page.keyboard.press('Space');                      /* practise */
  await expect(page.locator('.practice-head .t-hint')).toContainText('bar 1', { timeout: 6000 });
  await page.keyboard.down('KeyA');                         /* C4, the first note */
  await page.keyboard.up('KeyA');
  await page.keyboard.down('KeyW');                         /* C#4: not in C major */
  await page.keyboard.up('KeyW');
  await expect(page.locator('.score')).toContainText(/1\/15 hit · 1 wrong/);
  await page.keyboard.press('Escape');                      /* restart */
  await expect(page.locator('.practice-head .t-hint')).toContainText('from the top');
});

test('the on-screen keyboard plays, and Wait holds the scroll on an unplayed note', async ({ page }) => {
  await openPath(page, SCALE);
  await page.getByRole('button', { name: 'Practice' }).click();
  await expect(page.locator('.staff-badge')).toHaveText(/waiting/i, { timeout: 9000 });
  const lit = page.locator('.kb-key.lit').first();
  const name = await lit.getAttribute('aria-label');
  await lit.click();
  await expect(page.locator('.staff-badge')).toHaveCount(0);
  expect(name).toMatch(/^C 4$/);
});

test('scrubbing picks the start; tempo follows the knob-less stepper', async ({ page }) => {
  await openPath(page, SCALE);
  const slider = page.locator('.scrub input');
  await slider.fill('8');
  await expect(page.locator('.practice-head .t-hint')).toContainText('bar 3');
  await page.getByRole('button', { name: 'Faster' }).click();
  await expect(page.locator('.tempo .pp-value')).toHaveText('85');
});

test('a Name round answered from the lit keys runs to its result, and Progress charts it', async ({ page }) => {
  /* Settings first: a round of ten. */
  await page.getByRole('button', { name: 'Settings' }).click();
  const round = page.locator('.setting', { hasText: 'Round' });
  await round.getByRole('button', { name: 'Less Round' }).click();
  await expect(round.locator('.setting-value')).toHaveText('10');
  await page.keyboard.press('Escape');
  await openPath(page, ['Quiz', 'Name', 'Notes']);
  await expect(page.locator('#quiz-title')).toHaveText(/name the note/i);
  for (let i = 0; i < 40; i++) {
    if (await page.locator('.result-screen').count()) break;
    const lit = page.locator('.kb-key.lit').first();
    if (!(await lit.count())) { await page.waitForTimeout(150); continue; }
    const want = asLabel(await lit.getAttribute('aria-label'));
    const option = page.locator('.option:not([disabled])', { hasText: new RegExp(`^${want.replace('#', '\\#')}$`) });
    if (await option.count()) await option.first().click();
    await page.waitForTimeout(520);
  }
  await expect(page.locator('.result-screen')).toBeVisible();
  await expect(page.locator('.hero-number')).toContainText('/min');
  await expect(page.locator('.result-screen svg[role="img"]')).toHaveCount(2);
  for (let i = 0; i < 4; i++) await page.keyboard.press('Escape');
  await page.locator('.row', { hasText: 'Progress' }).click();
  await page.locator('.progress-screen .row', { hasText: 'Overall' }).click();
  await expect(page.locator('.progress-detail .chart')).toBeVisible();
  await page.locator('.progress-screen .row').last().click();
  await expect(page.locator('.progress-detail svg[role="img"]').first()).toBeVisible();
});

test('settings are remembered across a reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  const tempo = page.locator('.setting', { hasText: 'Tempo' });
  await tempo.getByRole('button', { name: 'More Tempo' }).click();
  await tempo.getByRole('button', { name: 'More Tempo' }).click();
  await expect(tempo.locator('.setting-value')).toHaveText('82');
  await expect(page.locator('.setting', { hasText: 'MIDI out' })).toHaveCount(0);
  await page.waitForTimeout(1200);                        /* the lazy save */
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('.setting', { hasText: 'Tempo' }).locator('.setting-value')).toHaveText('82');
});

test('a hearing drill answers by colour, then shows where the answer sits', async ({ page }) => {
  await openPath(page, ['Quiz', 'Hear', '1 Higher or lower', 'Hear High/low wide']);
  await expect(page.locator('#quiz-title')).toHaveText(/higher or lower/i);
  await expect(page.locator('.option .chip')).toHaveCount(3);
  for (const option of await page.locator('.option').all()) {
    if (await option.isDisabled()) break;
    await option.click();
  }
  await expect(page.locator('.kb-key.hit')).not.toHaveCount(0);
  await page.getByRole('button', { name: /Help/ }).click();
});

test('Info explains what is in front of you, and Escape closes it', async ({ page }) => {
  await page.keyboard.press('KeyI');
  await expect(page.locator('.info-screen')).toBeVisible();
  await expect(page.locator('.info-text p').first()).not.toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(page.locator('.info-screen')).toHaveCount(0);
});

test('the pads play the Move\'s grid', async ({ page }) => {
  await openPath(page, SCALE);
  await page.getByRole('button', { name: 'Pads' }).click();
  await expect(page.locator('.pad')).toHaveCount(32);
  await page.getByRole('button', { name: 'Practice' }).click();
  await page.waitForTimeout(3300);
  await page.locator('.pad').first().click();
  await expect(page.locator('.score')).toContainText(/wrong|hit/);
});

test('a MIDI keyboard plays the page', async ({ page }) => {
  await page.addInitScript(() => {
    const input = { id: 'k', name: 'Test Keys', onmidimessage: null };
    window.__midi = (data) => input.onmidimessage && input.onmidimessage({ data });
    navigator.requestMIDIAccess = async () => ({ inputs: new Map([['k', input]]), onstatechange: null });
  });
  await page.reload();
  await expect(page.locator('.status-pill', { hasText: 'Test Keys' })).toBeVisible();
  await openPath(page, SCALE);
  await page.evaluate(() => window.__midi([0x90, 64, 100]));
  await expect(page.locator('.kb-key.held')).toHaveCount(1);
  await page.evaluate(() => window.__midi([0x80, 64, 0]));
  await expect(page.locator('.kb-key.held')).toHaveCount(0);
});

test('sound starts on the first gesture', async ({ page }) => {
  await page.locator('.row').first().click({ position: { x: 4, y: 4 } });
  await expect(page.locator('.status-pill', { hasText: 'sound on' })).toBeVisible();
});

test('on a phone the page never scrolls sideways', async ({ page }) => {
  for (const path of [[], SCALE]) {
    await openPath(page, path);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(wide).toBeLessThanOrEqual(0);
  }
});

/* ---- Steering a Move: the page with Schwung's bridge and the Move's state ---- */

function moveState() {
  const ex = new URL('../../src/exercises/', import.meta.url).pathname;
  const fx = {
    now: () => 1000, wallNow: () => Date.UTC(2026, 9, 9), strike() {}, release() {}, silence() {}, announce() {},
    readText: (n) => {
      if (n === 'settings.json') return JSON.stringify({ version: 7, autoInfo: false });
      return n.startsWith('exercises/') && existsSync(ex + n.slice(10)) ? readFileSync(ex + n.slice(10), 'utf8') : null;
    },
    writeText: () => true, exit() {}, settingChanged() {}, reveal() {},
  };
  const S = createSession(fx);
  S.init();
  for (const label of ['Classics', 'Marys Lamb', 'L1 RH melody']) {
    const top = S.nav[S.nav.length - 1];
    S.selectRow(top.node.children.findIndex((r) => r.label === label));
    S.activate(false);
  }
  return encodeViewModel(viewModel(S));
}

test('inside Schwung the page shows the Move\'s session and steers it', async ({ page }) => {
  const flat = moveState();
  await page.addInitScript((state) => {
    window.__sent = [];
    window.schwungRemote = {
      onParamChange(fn) {
        setTimeout(() => fn(Object.fromEntries(Object.entries(state).map(([k, v]) => ['overtake_dsp:' + k, v]))), 50);
        return () => {};
      },
      setParam(k, v) { window.__sent.push([k, v]); },
    };
  }, flat);
  await page.goto('./');
  await expect(page.locator('#piece-title')).toHaveText(/marys lamb/i);
  await expect(page.locator('.status-pill', { hasText: 'sound on the Move' })).toBeVisible();
  await page.getByRole('button', { name: 'Listen' }).click();
  const sent = await page.evaluate(() => window.__sent);
  expect(sent).toContainEqual(['overtake_dsp:action', '{"type":"listen"}']);
});

/* ---- The gallery: every component, for review ---------------------------- */

test('the component gallery renders', async ({ page }) => {
  await page.goto('./gallery.html');
  await expect(page.locator('.kb')).not.toHaveCount(0);
  await expect(page.locator('.pad')).not.toHaveCount(0);
});

/* ---- Screens as pictures ------------------------------------------------- */

test('screens look as designed', async ({ page }, info) => {
  await expect(page).toHaveScreenshot('list.png', { fullPage: true });
  await openPath(page, SCALE);
  await closeInfo(page);
  await expect(page).toHaveScreenshot('ready.png', { fullPage: true });
  test.info().annotations.push({ type: 'project', description: info.project.name });
});
