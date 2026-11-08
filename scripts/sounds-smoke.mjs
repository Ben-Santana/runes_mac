import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
 const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5190');
 await page.getByRole('button', {name: 'Device settings', exact: true}).click();
 await page.locator('.radial-settings summary').click();
 const fields = [
  ['step', 'Combo steps voice', 'Shimmer'],
  ['success', 'Combo success voice', 'Wood block'],
  ['connection', 'Connection voice', 'Arcade blip'],
  ['radial', 'Radial menus voice', 'Harp'],
 ];
 let library;
 for (const [, label, choice] of fields) {
  await page.getByRole('button', {name: label, exact: true}).click();
  const options = await page.getByRole('menuitemradio').allTextContents();
  assert.equal(options.length, 32);
  if (library) assert.deepEqual(options, library);
  library = options;
  await page.getByRole('menuitemradio', {name: choice, exact: true}).click();
 }
 await page.reload();
 await page.getByRole('button', {name: 'Device settings', exact: true}).click();
 await page.locator('.radial-settings summary').click();
 for (const [, label, choice] of fields) assert.equal(await page.getByRole('button', {name: label, exact: true}).textContent(), choice);
 // Exercise all voices through every preview path with the browser's actual audio engine.
 const audioChecks = await page.evaluate(async () => {
  const {soundOptions, saveSoundSettings, loadSoundSettings, defaultSoundSettings} = await import('/src/soundSettings.ts');
  const saved = loadSoundSettings();
  const OriginalContext = window.AudioContext;
  let renders = 0;
  try {
   for (const {value} of soundOptions) {
    for (const kind of ['step', 'success', 'radial', 'connection']) {
     const ctx = new OfflineAudioContext(1, 96000, 48000);
     ctx.resume = async () => {};
     window.AudioContext = function () { return ctx; };
     saveSoundSettings({[kind]: value, volume: 70});
     const module = await import(`/src/connectBell.ts?audio-test=${renders}`);
     module.previewSound(kind);
     const data = (await ctx.startRendering()).getChannelData(0);
     const peak = data.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
     if (!(peak > 0.0001 && peak < 1) || !data.every(Number.isFinite)) throw new Error(`${kind}/${value}: invalid audio (${peak})`);
     if (!data.slice(-4800).every(sample => sample === 0)) throw new Error(`${kind}/${value}: voice did not finish`);
     renders++;
    }
   }
   localStorage.setItem('runes.sounds.v1', JSON.stringify({...defaultSoundSettings, step: 'invalid', success: 'glass', radial: 'coin', connection: 'warm'}));
   const restored = loadSoundSettings();
   if (restored.step !== 'whole' || restored.success !== 'glass' || restored.radial !== 'coin' || restored.connection !== 'warm') throw new Error('Shared library validation failed');
  } finally {
   window.AudioContext = OriginalContext;
   saveSoundSettings(saved);
  }
  return renders;
 });
 assert.equal(audioChecks, 128);
 for (const width of [1440, 768, 390]) {
  await page.setViewportSize({width, height: 1000});
  await page.getByRole('button', {name: 'Combo steps voice', exact: true}).click();
  const menu = page.getByRole('menu', {name: 'Combo steps voice', exact: true});
  const bounds = await menu.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 1000);
  await page.getByRole('menuitemradio', {name: 'Shimmer', exact: true}).scrollIntoViewIfNeeded();
  await page.screenshot({path: `/tmp/runes-sounds-${width}.png`, fullPage: true});
  await page.getByRole('menuitemradio', {name: 'Shimmer', exact: true}).press('Escape');
 }
 assert.deepEqual(errors, []);
 console.log('Sounds passed: identical 32-option libraries, cross-category persistence, 128 audible renders, safe dropdown bounds at three widths.');
} finally {
 await browser.close();
}
