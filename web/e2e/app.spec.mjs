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
import { homeLayout } from '../../src/home/render.mjs';

const SCALE = ['Practice', 'Scales', 'Learn', 'Major', 'Up & down'];
/* Settings is one short page; Advanced on it lists the groups, each a page. */
async function openSettings(page, group) {
  await page.getByRole('button', { name: 'Settings' }).click();
  if (!group) return;
  await page.locator('.setting').getByRole('button', { name: 'Advanced' }).click();
  await page.locator('.row', { hasText: new RegExp(`^${group}`) }).click();
}
/* A lit key's spoken name ("C sharp 4") as the options print it ("C#4"). */
const asLabel = (spoken) => spoken.replace(' sharp ', '#').replace(' flat ', 'b').replace(/ /g, '');

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.waitForSelector('.screen');
});

test('home is five circles: a click opens one, Back finds it selected', async ({ page }) => {
  await expect(page.locator('.home-screen')).toBeVisible();
  await expect(page.locator('.home .home-item')).toHaveCount(5);
  await expect(page.locator('.home-rows .row-label')).toHaveText(['Learning Path', 'Practice', 'Quiz', 'Progress', 'Settings']);
  await expect(page.locator('.home .home-item.on')).toHaveAttribute('data-key', 'program');
  await expect(page.getByRole('button', { name: 'Back' })).toBeDisabled();
  await expect(page.locator('.move-hint')).toContainText('JOG choose');
  /* The arrows are the jog: the next circle grows. */
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.home .home-item.on')).toHaveAttribute('data-key', 'basics');
  await expect(page.locator('.home-screen .screen-head .t-hint')).toHaveText('Practice');
  await page.waitForTimeout(250);                          /* the grow, 160 ms */
  const r = await page.locator('.home .home-item.on circle').evaluate((c) => getComputedStyle(c).r);
  expect(parseFloat(r)).toBeCloseTo(12.5, 1);
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('home.png', { fullPage: true });
  await page.locator('.home .home-item[data-key="quiz"]').click();
  await expect(page.locator('#home-title')).toHaveText('Quiz');
  await page.keyboard.press('Escape');
  await expect(page.locator('.home .home-item.on')).toHaveAttribute('data-key', 'quiz', { message: 'its circle' });
  /* Options: home as a list for the session; Back is the circles again. */
  await page.getByRole('button', { name: 'Options' }).click();
  await page.locator('.sheet-screen .row', { hasText: 'Show as list' }).click();
  await expect(page.locator('#list-title')).toHaveText(/piano/i);
  await expect(page.locator('.rows .row')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Back' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.home-screen')).toBeVisible();
});

/*
 * Every read waits for the ring it expects, by the state the picture states
 * on its element (data-ring, data-count, data-xs, data-selected), never by
 * time: a loaded machine draws the ring later, not differently. The circles'
 * places are compared as the engine lays them out (homeLayout), retried
 * until the picture shows that ring.
 */
test('Practice and Quiz are rings: circles spaced by their count, a click opens, Back finds the circle', async ({ page }) => {
  const ring = page.locator('svg.home');
  const xsOf = (n) => homeLayout(n).join(' ');
  await page.locator('.row', { hasText: /^Practice/ }).click();
  await expect(ring).toHaveAttribute('data-ring', 'Practice');
  await expect(ring).toHaveAttribute('data-count', '5');
  await expect(ring).toHaveAttribute('data-xs', xsOf(5), { message: 'five, as home spaces them' });
  await expect(page.locator('#home-title')).toHaveText('Practice');
  await expect(page.locator('.home-rows .row-label')).toHaveText(['Scales', 'Chords', 'Progressions', 'Random', 'Songs']);
  await expect(page.locator('.home .home-item')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Back' })).toBeEnabled();
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('ring-practice.png', { fullPage: true });
  await page.locator('.home .home-item[data-key="songs"]').click();
  await expect(page.locator('#list-title')).toHaveText(/songs/i, { message: 'deeper levels stay lists' });
  await page.keyboard.press('Escape');
  await expect(ring).toHaveAttribute('data-ring', 'Practice');
  await expect(ring).toHaveAttribute('data-selected', 'songs', { message: 'its circle' });
  await page.keyboard.press('Escape');
  await expect(ring).toHaveAttribute('data-ring', 'Piano');
  await expect(ring).toHaveAttribute('data-selected', 'basics', { message: 'home, on Practice' });
  await page.keyboard.press('ArrowRight');
  await expect(ring).toHaveAttribute('data-selected', 'quiz');
  await page.keyboard.press('Enter');
  await expect(ring).toHaveAttribute('data-ring', 'Quiz');
  await expect(ring).toHaveAttribute('data-count', '3');
  await expect(ring).toHaveAttribute('data-xs', xsOf(3), { message: 'three, spaced for three' });
  await expect(page.locator('.home .home-item')).toHaveCount(3);
  await expect(page.locator('.home-rows .row-label')).toHaveText(['Ear', 'Reading', 'Keys']);
  /* And the circles stand where the element says. */
  await expect.poll(() => page.locator('.home .home-item circle')
    .evaluateAll((cs) => cs.map((c) => +c.getAttribute('cx') - 0.5).join(' '))).toBe(xsOf(3));
  expect(homeLayout(3)[0]).not.toBe(homeLayout(5)[0]);
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('ring-quiz.png', { fullPage: true });
  await page.locator('.home .home-item[data-key="keys"]').click();
  await expect(page.locator('.row .row-label')).toHaveText(['Notes by alphabet', 'Chords by name', 'Name notes', 'Name chords']);
});

test('the Learning Path is five stages, each ending on its Checkpoint; Continue opens the next step', async ({ page }) => {
  await page.locator('.row', { hasText: /^Learning Path/ }).click();
  await closeInfo(page);
  for (const name of ['1 Grid and staff', '2 Four chords', '3 Shapes and time', '4 Sevenths', '5 Colour']) {
    await expect(page.locator('.row', { hasText: name })).toHaveCount(1);
  }
  /* On the map a first click walks there, a second goes in. */
  await page.locator('.row', { hasText: '3 Shapes and time' }).click();
  await page.locator('.row', { hasText: '3 Shapes and time' }).click();
  await closeInfo(page);
  await expect(page.locator('.row').first()).toHaveText(/3\.1 Intervals II/);
  await expect(page.locator('.row').last()).toHaveText(/Checkpoint/);
  await expect(page.locator('.row', { hasText: /Start here|Check: skip/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Continue' }).click();     /* Play on the Move */
  await closeInfo(page);
  await expect(page.locator('#quiz-title')).toBeVisible();
});

test('the Learning Path is a map: click an island to walk there, again to go in, Back to come out', async ({ page }) => {
  await openPath(page, ['Learning Path']);
  await expect(page.locator('.map-screen')).toBeVisible();
  await expect(page.locator('.map-screen .screen-head .t-hint')).toHaveText(/^1 Grid and staff · 0%/);
  await expect(page.locator('.move-hint')).toContainText('PAD go  CLICK enter');
  const third = page.locator('.map .place-hit').nth(2);
  await third.click();
  await expect(page.locator('.map-screen .screen-head .t-hint')).toHaveText(/^3 Shapes and time/);
  await expect(page.locator('.map')).toHaveAttribute('data-walking', 'no');   /* the walk, at ~90 ms a cell */
  await page.mouse.move(0, 0);                            /* no hover in the picture */
  await expect(page).toHaveScreenshot('map.png', { fullPage: true });
  await third.click();
  await expect(page.locator('#map-title')).toHaveText(/3 Shapes and time/);
  await expect(page.locator('.map-places .row')).toHaveCount(9);
  await expect(page.locator('.map-places .row').last()).toHaveText(/Checkpoint/);
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('island.png', { fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.locator('#map-title')).toHaveText('Learning Path');
  await expect(page.locator('.map-places .row.on')).toHaveText(/3 Shapes and time/, { message: 'on the island it left' });
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.map-places .row.on')).toHaveText(/4 Sevenths/, { message: 'the arrows walk' });
});

/* A scene lasts a third of a second: a picture of it is taken as it plays and
 * attached to the report, not held to a baseline, which could only catch it
 * by luck. The screens either side of it are baselines. */
/*
 * A zoom lasts a third of a second: a loaded machine can be past it before an
 * assertion looks. So the page itself notes every scene it shows (a
 * MutationObserver set up first), and the test reads that after the screen
 * has settled on the map. That any key or pad skips a scene is held by the
 * session's tests: a click aimed at a third of a second would race.
 */
test('an island zooms in from the world, and Back zooms out', async ({ page }) => {
  await openPath(page, ['Learning Path']);
  await page.evaluate(() => {
    window.__scenes = [];
    new MutationObserver(() => {
      const s = document.querySelector('.anim-screen');
      if (!s) return;
      const entry = [s.getAttribute('data-kind'), document.querySelector('.anim-zoom-in') ? 'in'
        : document.querySelector('.anim-zoom-out') ? 'out' : '', (document.querySelector('#anim-title') || {}).textContent];
      if (JSON.stringify(window.__scenes.at(-1)) !== JSON.stringify(entry)) window.__scenes.push(entry);
    }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await page.locator('.map .place-hit').first().click();  /* the avatar is there: in */
  await expect(page.locator('#map-title')).toHaveText(/1 Grid and staff/);   /* then the island */
  await expect(page.locator('.map-places .row').first()).toHaveText(/1\.1 Find the notes/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#map-title')).toHaveText('Learning Path');
  const seen = await page.evaluate(() => window.__scenes);
  expect(seen).toContainEqual(['zoom', 'in', '1 Grid and staff.']);
  expect(seen).toContainEqual(['zoom', 'out', 'World map.']);
});

test('the options of a row: Test out: checkpoint plays the exam Solo', async ({ page }) => {
  await openPath(page, ['Learning Path']);
  await expect(page.locator('.row.on')).toHaveText(/1 Grid and staff/);
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('.sheet-screen')).toBeVisible();
  await expect(page.locator('.sheet-screen .row-label')).toHaveText(
    ['I know it all: skip', 'Start the path here', 'Test out: checkpoint', 'Show as list', 'Settings...']);
  await expect(page.locator('.move-hint')).toContainText('CLICK do it');
  await page.locator('.sheet-screen .row', { hasText: 'Test out: checkpoint' }).click();
  await closeInfo(page);
  await expect(page.locator('#piece-title')).toHaveText(/C Major/i);
  await expect(page.getByRole('button', { name: 'Solo', exact: true })).toHaveClass(/on/);
});

test('the Learning Path as a list starts with Continue; its options skip the step it names', async ({ page }) => {
  await openPath(page, ['Learning Path']);
  await page.getByRole('button', { name: 'Options' }).click();
  await page.locator('.sheet-screen .row', { hasText: 'Show as list' }).click();
  await expect(page.locator('.row').first()).toHaveText(/Continue.*Notes by alphabet/);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.row.on')).toHaveText(/^Continue/);
  await page.getByRole('button', { name: 'Options' }).click();
  await expect(page.locator('#sheet-title')).toHaveText('Continue');
  await expect(page.locator('.sheet-screen .row-label')).toHaveText(['I know this: skip', 'Show as map', 'Settings...']);
  await page.locator('.sheet-screen .row', { hasText: 'I know this: skip' }).click();
  await expect(page.locator('.row').first()).toHaveText(/Continue.*Name notes/, { message: 'the step after' });
});

test('the hint line names the Move\'s keys on every screen', async ({ page }) => {
  await expect(page.locator('.move-hint')).toContainText('JOG choose');
  await openPath(page, ['Practice']);
  await expect(page.locator('.move-hint')).toContainText('PAD open', { message: 'a ring' });
  await openPath(page, ['Scales', 'Learn']);
  await expect(page.locator('.move-hint')).toContainText('CLICK open  BACK up');
  await openPath(page, ['Major', 'Up & down']);
  await expect(page.locator('.move-hint')).toContainText('REC start');
});

test('arming a drill: the staff, its stage, and Listen lighting the keys', async ({ page }) => {
  await openPath(page, SCALE);
  await expect(page.locator('#piece-title')).toHaveText(/C Major/i);
  await expect(page.locator('.staff-wrap svg')).toBeVisible();
  /* The Move's ready box names knob 8 and the tempo; so does the page. */
  await expect(page.locator('.tempo-knob')).toHaveText('Knob 8:  80 bpm');
  await page.getByRole('button', { name: 'Faster' }).click();
  await expect(page.locator('.tempo-knob')).toHaveText('Knob 8:  85 bpm');
  await page.getByRole('button', { name: 'Slower' }).click();
  await expect(page.locator('.tempo-knob')).toHaveText('Knob 8:  80 bpm');
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Solo', exact: true })).toHaveClass(/on/);
  await page.getByRole('button', { name: 'Guided', exact: true }).click();
  await page.getByRole('button', { name: 'Listen' }).click();
  await expect(page.locator('.count-in')).toBeVisible();
  await expect(page.locator('.kb-key.lit')).toHaveCount(1, { timeout: 6000 });
  await page.getByRole('button', { name: 'Listen' }).click();
  await expect(page.locator('.staff-badge')).toHaveText(/paused/i);
});

test('a song is one row: it opens ready, and its level is chosen there', async ({ page }) => {
  await openPath(page, ['Practice', 'Songs', 'Classics', 'Ode to Joy']);
  await expect(page.locator('#piece-title')).toHaveText(/ode to joy/i);
  const levels = page.locator('.levels .btn');
  await expect(levels).toHaveCount(4);
  await expect(levels.first()).toHaveClass(/on/);
  await expect(page.locator('.move-hint')).toContainText('JOG level');
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('ready-song.png', { fullPage: true });
  /* The song's own tempo, for the session: slower, and kept by its levels. */
  await expect(page.locator('.tempo-knob')).toHaveText('Knob 8:  72 bpm');
  await page.getByRole('button', { name: 'Slower' }).click();
  await expect(page.locator('.tempo-knob')).toHaveText('Knob 8:  67 bpm');
  await levels.nth(3).click();
  await expect(page.locator('#piece-title')).toHaveText(/ode to joy l3/i);
  await expect(page.locator('.tempo-knob')).toHaveText('Knob 8:  67 bpm', { message: 'L3 of the same song keeps it' });
  await expect(levels.nth(3)).toHaveClass(/on/);
  await page.keyboard.press('ArrowLeft');                  /* the jog: L3 Guided to L2 Solo */
  await expect(levels.nth(2)).toHaveClass(/on/);
  await expect(page.getByRole('button', { name: 'Solo', exact: true })).toHaveClass(/on/);
});

test('practising from the computer keyboard: a right note scores, a wrong one is counted', async ({ page }) => {
  /* Grace to a whole beat, as for a new piece: the test presses once it has
   * seen the bar start, a reaction later than the default quarter beat. */
  await openSettings(page, 'Practice');
  const grace = page.locator('.setting', { hasText: 'Grace' });
  for (let i = 0; i < 3; i++) await grace.getByRole('button', { name: 'More Grace' }).click();
  await expect(grace.locator('.setting-value')).toHaveText('1');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');   /* the group, Advanced, the page */
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
  expect(name).toMatch(/^C 4$/);
  await lit.click();
  /* Played, the halt releases and the music moves on to the next note — which,
   * left unplayed, halts it again. So the proof is that the note it waits on
   * is no longer C 4, not that the badge is ever seen gone. */
  await expect(page.locator('.kb-key.lit').first()).not.toHaveAttribute('aria-label', name, { timeout: 8000 });
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
  await openSettings(page, 'Practice');
  const round = page.locator('.setting', { hasText: 'Round' });
  await round.getByRole('button', { name: 'Less Round' }).click();
  await expect(round.locator('.setting-value')).toHaveText('10');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
  await openPath(page, ['Quiz', 'Keys', 'Name notes']);
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
  await expect(page.locator('.hero-number').first()).toContainText('/min');
  await expect(page.locator('.hero-number').nth(1)).toContainText('% right');
  await expect(page.locator('.result-screen figcaption', { hasText: 'Right, of all attempts' })).toBeVisible();
  /* Each note asked gets a bar: every right answer is some note's. */
  const answers = page.locator('.result-screen figure', { hasText: 'Each answer' });
  await expect(answers).toBeVisible();
  expect(await answers.locator('rect.chart-bar').count()).toBeGreaterThan(1);
  await expect(page.locator('.result-screen svg[role="img"]')).toHaveCount(3);
  /* Learned at the first go: a star over the result, then the result itself. */
  await expect(page.locator('.anim-over')).toHaveCount(0);
  for (let i = 0; i < 4; i++) await page.keyboard.press('Escape');
  await page.locator('.row', { hasText: /^Progress/ }).click();
  await page.locator('.progress-screen .row', { hasText: 'Overall' }).click();
  await expect(page.locator('.progress-detail .chart')).toBeVisible();
  await page.locator('.progress-screen .row').last().click();
  await expect(page.locator('.progress-detail svg[role="img"]').first()).toBeVisible();
});

/* The keys for a name, in every octave: "F#" is spoken "F sharp 4", and "F"
 * must not match it. */
const spoken = (name) => new RegExp(`^${name[0]}${name.slice(1).replace('#', ' sharp').replace('b', ' flat')} \\d$`);

test('Notes by alphabet: a row of names, and a right note in any octave moves it on', async ({ page }) => {
  await openPath(page, ['Quiz', 'Keys', 'Notes by alphabet']);
  const head = page.locator('.name-row-name.head');
  await expect(head).toHaveAttribute('data-index', '0');
  expect(await page.locator('.name-row-name').count()).toBeGreaterThanOrEqual(6);
  for (let i = 0; i < 2; i++) {
    await expect(page.locator('.quiz-ask')).toHaveText(/any octave/);
    const name = (await head.textContent()).trim();
    const labels = await page.locator('.kb-key[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    const octaves = labels.filter((l) => spoken(name).test(l));
    expect(octaves.length, `a key for ${name}`).toBeGreaterThan(0);
    /* The lowest such key one round, the highest the next: either octave counts. */
    await page.locator(`.kb-key[aria-label="${i === 0 ? octaves[0] : octaves.at(-1)}"]`).click();
    await expect(head).toHaveAttribute('data-index', String(i + 1), { timeout: 3000 });
  }
  await expect(page.locator('.screen-head .t-hint')).toContainText(/^2 /);
});

test('Notes by staff: the next notes on the staff, no names until Help', async ({ page }) => {
  await openPath(page, ['Quiz', 'Reading', 'Notes by staff']);
  await expect(page.locator('.quiz-row svg')).toBeVisible();
  expect(await page.locator('.quiz-row .staff-event').count()).toBeGreaterThanOrEqual(4);
  await expect(page.locator('.quiz-ask')).toHaveText('Play what is written.');
  const help = page.getByRole('button', { name: /^Help/ });
  await help.click();
  await expect(page.locator('.quiz-ask')).toHaveText(/^It is [A-G]/);
  await help.click();
  await page.locator('.kb-key.lit').first().click();
  await expect(page.locator('.screen-head .t-hint')).toContainText(/^1 /, { timeout: 3000 });
  await expect(page.locator('.quiz-ask')).toHaveText('Play what is written.', { timeout: 3000 });
});

test('Chords by name: chord symbols in the row', async ({ page }) => {
  await openPath(page, ['Quiz', 'Keys', 'Chords by name']);
  const names = await page.locator('.name-row-name').allTextContents();
  expect(names.length).toBeGreaterThanOrEqual(6);
  for (const n of names) expect(n.trim()).toMatch(/^[A-G][#b]?(m|dim|aug)?$|^[A-G][#b]? /);
});

test('Settings is one short page, Advanced the rest; Back from Advanced is the page', async ({ page }) => {
  await openSettings(page);
  await expect(page.locator('#settings-title')).toHaveText('Settings');
  await expect(page.locator('.setting .row-label')).toHaveText(['Octave', 'Click', 'Key', 'Scale', 'Start at', 'Advanced']);
  await expect(page.locator('.settings-screen')).toContainText('This browser', { message: 'the browser\'s own inputs' });
  const octave = page.locator('.setting', { hasText: 'Octave' });
  await octave.getByRole('button', { name: 'More Octave' }).click();
  await expect(octave.locator('.setting-value')).toHaveText('+13', { message: 'edited in place' });
  await page.locator('.setting').getByRole('button', { name: 'Advanced' }).click();
  await expect(page.locator('#list-title')).toHaveText(/advanced/i);
  await expect(page.locator('.app-crumb')).toHaveText('Settings › Advanced');
  await expect(page.locator('.row .row-label')).toHaveText(['Practice', 'Sound', 'MIDI', 'Help']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-title')).toHaveText('Settings');
  await page.keyboard.press('Escape');
  await expect(page.locator('.home-screen')).toBeVisible();
});

test('settings are remembered across a reload', async ({ page }) => {
  await openSettings(page, 'Practice');
  const tempo = page.locator('.setting', { hasText: 'Tempo' });
  await tempo.getByRole('button', { name: 'More Tempo' }).click();
  await tempo.getByRole('button', { name: 'More Tempo' }).click();
  await expect(tempo.locator('.setting-value')).toHaveText('82');
  await expect(page.locator('.setting', { hasText: 'MIDI out' })).toHaveCount(0);
  await page.waitForTimeout(1200);                        /* the lazy save */
  await page.reload();
  await openSettings(page, 'Practice');
  await expect(page.locator('.setting', { hasText: 'Tempo' }).locator('.setting-value')).toHaveText('82');
});

test('a hearing drill answers by colour, then shows where the answer sits', async ({ page }) => {
  await openPath(page, ['Quiz', 'Ear', 'Pitch & melody', 'Higher or lower', 'wide']);
  await expect(page.locator('#quiz-title')).toHaveText(/higher or lower/i);
  await expect(page.locator('.option .chip')).toHaveCount(3);
  for (const option of await page.locator('.option').all()) {
    if (await option.isDisabled()) break;
    await option.click();
  }
  await expect(page.locator('.kb-key.hit')).not.toHaveCount(0);
  await page.getByRole('button', { name: /Help/ }).click();
});

/* Click through the options until one is right: the question stays until then. */
async function answerRight(page) {
  for (const option of await page.locator('.option').all()) {
    if (await option.isDisabled()) break;
    await option.click();
  }
}

for (const [course, unit, level, title, answers] of [
  [['Intervals', 'Identify intervals'], '1 2nds', 'up', /2nds/i, 2],
  [['Intervals', 'Compare intervals'], '9 6ths', 'fix up', /6ths/i, 3],
  [['Scales & keys', 'Identify scales'], '6 Seven modes', 'up', /seven modes/i, 7],
]) {
  test(`${course[1]}: a unit's level asks its own answers, and a right one counts`, async ({ page }) => {
    await openPath(page, ['Quiz', 'Ear', ...course, unit, level]);
    await expect(page.locator('#quiz-title')).toHaveText(title);
    await expect(page.locator('.option')).toHaveCount(answers);
    await answerRight(page);
    await expect(page.locator('.screen-head .t-hint')).toContainText(/^1 /);
  });
}

for (const [course, unit, level, answers, notes] of [
  ['Identify intervals', '9 Up to the octave', 'tog', 12, 2],
  ['Compare intervals', '9 6ths', 'fix up', 3, 4],
  ['Identify scales', '6 Seven modes', 'up', 7, 8],
]) {
  test(`Read ${course}: the prompt is on the staff, the answers below it`, async ({ page }) => {
    await openPath(page, ['Quiz', 'Reading', course, unit, level]);
    await expect(page.locator('.quiz-row svg')).toBeVisible();
    expect(await page.locator('.quiz-row .staff-note').count()).toBeGreaterThanOrEqual(notes);
    await expect(page.locator('.option')).toHaveCount(answers);
    await answerRight(page);
    await expect(page.locator('.screen-head .t-hint')).toContainText(/^1 /);
  });
}

test('Info explains what is in front of you, with its keys, and Escape closes it', async ({ page }) => {
  await page.keyboard.press('KeyI');
  await expect(page.locator('.info-screen')).toBeVisible();
  await expect(page.locator('.info-text p').first()).not.toBeEmpty();
  await expect(page.locator('.info-text h2', { hasText: 'Keys' })).toBeVisible();
  await expect(page.locator('.info-text p', { hasText: 'SHIFT+CLICK options' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.info-screen')).toHaveCount(0);
});

test.describe('a first visit', () => {
  test.use({ welcomed: false });

  test('the welcome, then "I already play" opens the Learning Path with a tip', async ({ page }) => {
    await expect(page.locator('#card-title')).toHaveText('Welcome');
    await expect(page.locator('.card-text p').first()).toHaveText(/Piano Practice takes you from your first note to pro/);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('.card-text p').first()).toHaveText('Lit pads can be pressed.');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('#card-title')).toHaveText('Keys');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#card-title')).toHaveText('New to piano?');
    await page.locator('.card-choices .row', { hasText: 'I already play' }).click();
    await expect(page.locator('.card-text p').first()).toHaveText(/^Know a stage already\?/);
    await page.getByRole('button', { name: 'Go on' }).click();
    /* The Learning Path is a map, and its own tip comes the first time it is seen. */
    await expect(page.locator('.card-text p').first()).toHaveText(/^Lit pads are places/);
    await page.getByRole('button', { name: 'Go on' }).click();
    await expect(page.locator('#map-title')).toHaveText('Learning Path');
    await page.reload();
    await page.waitForSelector('.screen');
    await expect(page.locator('.card-screen')).toHaveCount(0, { message: 'welcomed once' });
  });

  test('"From the start" lands on the Learning Path map; a first piece shows its tip once', async ({ page }) => {
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await page.locator('.card-choices .row', { hasText: 'From the start' }).click();
    await expect(page.locator('.card-text p').first()).toHaveText(/^Lit pads are places/);
    await page.getByRole('button', { name: 'Go on' }).click();
    await expect(page.locator('#map-title')).toHaveText('Learning Path');
    await page.keyboard.press('Escape');
    await openPath(page, SCALE);
    await expect(page.locator('.card-text p').first()).toHaveText(/^REC plays and scores it/);
    await page.keyboard.press('Escape');
    /* Factory settings: the piece's help comes by itself, under the tip. */
    await expect(page.locator('#info-title')).toHaveText(/C Major/i);
    await closeInfo(page);
    await expect(page.locator('#piece-title')).toHaveText(/C Major/i);
  });
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
      if (n === 'progress.json') return JSON.stringify({ tips: ['welcome', 'sheet', 'practice', 'quiz', 'map', 'island'] });
      return n.startsWith('exercises/') && existsSync(ex + n.slice(10)) ? readFileSync(ex + n.slice(10), 'utf8') : null;
    },
    writeText: () => true, exit() {}, settingChanged() {}, reveal() {},
  };
  const S = createSession(fx);
  S.init();
  for (const label of ['Practice', 'Songs', 'Classics', 'Marys Lamb']) {
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

/*
 * THE SCROLL ON A MOVE, THROUGH A NETWORK THAT DELAYS EVERY PICTURE
 * DIFFERENTLY. A fake Move in the page runs its own clock (an offset from the
 * page's), publishes its clock every 330 ms as ui.js does, and delivers each
 * picture 20 to 400 ms late. The staff's own transform is sampled every frame:
 * it must never step back, and must follow the Move's beat with no more
 * wobble than a frame's worth of pixels -- where the page used to be pulled
 * back by each picture's delay.
 */
test('on a Move the staff scrolls with the Move\'s beat, however late each picture is', async ({ page }) => {
  const flat = moveState();
  await page.addInitScript((state) => {
    const chart = JSON.parse(state.chart);
    const perBeatMs = 60000 / chart.bpm;
    const MOVE_OFFSET = 987654.321;             /* the Move's clock is not ours */
    const moveNow = () => performance.now() + MOVE_OFFSET;
    let start = null;
    let seed = 1234567;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    window.__beatAt = (pageMs) => (start === null ? 0 : (pageMs + MOVE_OFFSET - start) / perBeatMs);
    window.schwungRemote = {
      onParamChange(fn) {
        const send = (fields) => fn(Object.fromEntries(Object.entries(fields).map(([k, v]) => ['overtake_dsp:' + k, v])));
        const clock = JSON.parse(state.clock);
        setTimeout(() => {
          start = moveNow();
          send({ ...state, screen: JSON.stringify('running') });
          setInterval(() => {
            const t = moveNow();
            const c = { ...clock, t, perBeatMs, waitAt: null, beats: (t - start) / perBeatMs,
                        running: true, paused: false, blocked: false, countIn: false };
            const text = JSON.stringify(c);
            setTimeout(() => send({ clock: text }), 20 + rand() * 380);
          }, 330);
        }, 50);
        return () => {};
      },
      setParam() {},
    };
  }, flat);
  await page.goto('./');
  await expect(page.locator('#piece-title')).toHaveText(/marys lamb/i);
  await page.waitForTimeout(3000);              /* ten pictures: the clocks agree */
  /*
   * Each placement the page makes, at the moment it makes it: the lane's
   * transform is set right after the page reads its clock for that frame, so
   * the time read here is the time the position was worked out for. A frame
   * that comes late on a loaded machine is then measured against its own
   * time, not against when some other callback of the frame ran -- which is
   * what made the old sampler see wobble the page never drew.
   */
  const samples = await page.evaluate(() => new Promise((done) => {
    const lane = document.querySelector('.staff-bars').parentElement;
    const out = [];
    const set = lane.setAttribute.bind(lane);
    const finish = () => { lane.setAttribute = set; done(out); };
    lane.setAttribute = (name, value) => {
      set(name, value);
      if (name !== 'transform') return;
      out.push([window.__beatAt(performance.now()), Number(/translate\(([-\d.e]+)/.exec(value)[1])]);
      if (out.length >= 120) finish();
    };
    setTimeout(finish, 15000);
  }));
  expect(samples.length).toBeGreaterThan(60);
  for (let i = 1; i < samples.length; i++) {
    expect(samples[i][1], `stepped back at sample ${i}`).toBeLessThanOrEqual(samples[i - 1][1] + 0.5);
  }
  /* tx = a - beat * ppb: fit it, and the residual is the wobble. */
  const n = samples.length;
  const mb = samples.reduce((s, [b]) => s + b, 0) / n;
  const mx = samples.reduce((s, [, x]) => s + x, 0) / n;
  const slope = samples.reduce((s, [b, x]) => s + (b - mb) * (x - mx), 0) /
                samples.reduce((s, [b]) => s + (b - mb) ** 2, 0);
  const residual = samples.map(([b, x]) => x - (mx + slope * (b - mb)));
  const wobble = Math.max(...residual) - Math.min(...residual);
  const pxPerFrame = Math.abs(slope) * (1000 / 60) / (60000 / JSON.parse(flat.chart).bpm);
  /* A frame's motion, and the device pixel place() rounds the lane to. */
  expect(wobble, `the staff wobbles by ${wobble.toFixed(1)} px; a frame is ${pxPerFrame.toFixed(1)} px`)
    .toBeLessThanOrEqual(pxPerFrame + 1);
});

/* On the Move's list -- no piece, no practice -- a pad held on the Move lights
 * its key on the page: what the Move plays shows wherever you are. */
test('a note the Move plays lights the page\'s key on any screen', async ({ page }) => {
  const flat = moveState();
  await page.addInitScript((state) => {
    const send = (fn, fields) => fn(Object.fromEntries(Object.entries(fields).map(([k, v]) => ['overtake_dsp:' + k, v])));
    window.schwungRemote = {
      onParamChange(fn) {
        const cue = { ...JSON.parse(state.cue), playing: [60] };
        setTimeout(() => send(fn, { ...state, screen: JSON.stringify('menu'), chart: 'null', cue: JSON.stringify(cue) }), 50);
        return () => {};
      },
      setParam() {},
    };
  }, flat);
  await page.goto('./');
  await expect(page.locator('.kb-key.lit')).toHaveCount(1);
});

/* The page as it ships in the module: web_ui.html loads the manager's bridge
 * from the manager (/static/schwung-remote-api.js), and that alone must make
 * it the Move's. Here the manager is a route serving a fake bridge. */
test('web_ui.html, as Schwung serves it, drives the Move', async ({ page }) => {
  const flat = moveState();
  await page.route('**/static/schwung-remote-api.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `window.__sent = [];
      window.schwungRemote = {
        component: 'tool',
        onParamChange(fn) {
          setTimeout(() => fn(${JSON.stringify(Object.fromEntries(Object.entries(flat).map(([k, v]) => ['overtake_dsp:' + k, v])))}), 50);
          return () => {};
        },
        setParam(k, v) { window.__sent.push([k, v]); },
      };`,
  }));
  await page.goto('./web_ui.html');
  await expect(page.locator('#piece-title')).toHaveText(/marys lamb/i);
  await expect(page.locator('.status-pill', { hasText: 'sound on the Move' })).toBeVisible();
  await page.getByRole('button', { name: 'Practice' }).click();
  const sent = await page.evaluate(() => window.__sent);
  expect(sent).toContainEqual(['overtake_dsp:action', '{"type":"practice"}']);
});

/* ---- The gallery: every component, for review ---------------------------- */

test('the component gallery renders', async ({ page }) => {
  await page.goto('./gallery.html');
  await expect(page.locator('.kb')).not.toHaveCount(0);
  await expect(page.locator('.pad')).not.toHaveCount(0);
});

/* ---- Screens as pictures ------------------------------------------------- */

test('screens look as designed', async ({ page }, info) => {
  await expect(page).toHaveScreenshot('top.png', { fullPage: true });
  /* By the keys: a click would leave the pointer over the keyboard below. */
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');                     /* the Practice ring */
  await expect(page.locator('#home-title')).toHaveText('Practice');
  await page.keyboard.press('Enter');                     /* Scales: a list */
  await expect(page.locator('#list-title')).toHaveText(/scales/i);
  await expect(page).toHaveScreenshot('list.png', { fullPage: true });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await openPath(page, SCALE);
  await closeInfo(page);
  await expect(page).toHaveScreenshot('ready.png', { fullPage: true });
  test.info().annotations.push({ type: 'project', description: info.project.name });
});
