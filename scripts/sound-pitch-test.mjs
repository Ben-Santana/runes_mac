import assert from 'node:assert/strict';
import {build} from 'esbuild';

// Record the oscillator pitches actually scheduled by the sound renderer.
const notes = [];
const parameter = () => ({setValueAtTime() {}, exponentialRampToValueAtTime() {}});
globalThis.window = {AudioContext: class {
 currentTime = 0;
 destination = {};
 resume() { return Promise.resolve(); }
 createGain() { return {gain: parameter(), connect() {}}; }
 createOscillator() {
  const note = {};
  return {
   frequency: {...parameter(), setValueAtTime(value) { note.frequency = value; }},
   connect() {}, start(when) { notes.push({...note, when}); }, stop() {},
  };
 }
}};
const storage = new Map();
globalThis.localStorage = {
 getItem: key => storage.get(key) ?? null,
 setItem: (key, value) => storage.set(key, value),
};
const bundle = await build({entryPoints: ['src/connectBell.ts'], bundle: true, write: false, platform: 'node', format: 'esm'});
const sounds = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const configure = change => localStorage.setItem('runes.sounds.v1', JSON.stringify({step: 'whole', success: 'whole', radial: 'whole', connection: 'whole', ...change}));
const checkScale = (count, label) => {
 assert.equal(notes.length, count, label);
 for (let i = 1; i < notes.length; i++) {
  const semitones = 12 * Math.log2(notes[i].frequency / notes[i - 1].frequency);
  assert.ok(Math.abs(semitones - 2) < 1e-9, `${label}: interval ${i} was ${semitones} semitones`);
 }
 notes.length = 0;
};
configure({});
for (const count of [2, 3, 5]) {
 sounds.noteComboProgress([], () => count);
 for (let matched = 1; matched < count; matched++) {
  const candidate = [{id: 'combo', attemptId: `attempt-${count}`, matched}];
  sounds.noteComboProgress(candidate, () => count);
  sounds.noteComboProgress(candidate, () => count); // Timer updates must not repeat notes.
 }
 sounds.noteComboOutcome(`attempt-${count}`, count);
 checkScale(count, `${count}-step combo including completion`);
}
// Concurrent candidates should contribute one note per input, at the furthest progress.
sounds.noteComboProgress([{id: 'long', attemptId: 'long', matched: 1}, {id: 'short', attemptId: 'short', matched: 1}], () => 5);
sounds.noteComboProgress([{id: 'long', attemptId: 'long', matched: 2}, {id: 'short', attemptId: 'new', matched: 1}], () => 5);
checkScale(2, 'overlapping combos');
for (const count of [4, 8, 12]) {
 for (let index = 0; index < count; index++) sounds.playRadialClick(index, count, true);
 checkScale(count, `${count}-item radial`);
}
for (const kind of ['step', 'success', 'radial', 'connection']) {
 sounds.previewSound(kind);
 assert.ok(notes.every((note, i) => i === 0 || note.when > notes[i - 1].when), 'Preview notes must play in order');
 checkScale(3, `${kind} preview`);
}
configure({enabled: false});
sounds.noteComboProgress([{id: 'muted', attemptId: 'muted', matched: 1}], () => 3);
sounds.noteComboOutcome('muted', 3);
assert.equal(notes.length, 0, 'Disabled sounds stay silent');
console.log('Sound pitches passed: two-semitone combo intervals, completion, overlapping candidates, radial positions, previews, and mute.');
