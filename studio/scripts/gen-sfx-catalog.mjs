/**
 * Generates src/library/sfxSamples.ts from public/sfx/** (Kenney CC0 packs).
 * Usage: node scripts/gen-sfx-catalog.mjs [durations.json]
 * durations.json (optional): { "<pack>/<file>.ogg": [durationSeconds, peak] } produced by decoding in a browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', 'public', 'sfx');
const durations = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : {};

const PACK_LABEL = {
  'casino-audio': 'Casino', 'digital-audio': 'Digital', 'impact-sounds': 'Impacts', 'interface-sounds': 'Interface', 'music-jingles': 'Jingles',
  'rpg-audio': 'RPG', 'sci-fi-sounds': 'Sci-Fi', 'ui-audio': 'UI', 'ui-pack': 'UI', 'voiceover-pack': 'Voiceover', 'voiceover-pack-fighter': 'Fighter voiceover',
};
const SPLIT = [
  ['impactbell', 'bell impact'], ['impactgeneric', 'generic impact'], ['impactglass', 'glass impact'], ['impactmetal', 'metal impact'], ['impactmining', 'mining pickaxe impact'],
  ['impactplank', 'plank impact'], ['impactplate', 'plate impact'], ['impactpunch', 'punch impact'], ['impactsoft', 'soft impact'], ['impacttin', 'tin impact'], ['impactwood', 'wood impact'],
  ['footstep', 'footstep'], ['highdown', 'high tone down'], ['highup', 'high tone up'], ['lowdown', 'low tone down'], ['lowrandom', 'low random tone'], ['lowthreetone', 'low three-tone'],
  ['pepsound', 'pep blip'], ['phasejump', 'phase jump'], ['phaserdown', 'phaser down'], ['phaserup', 'phaser up'], ['powerup', 'power-up'], ['spacetrash', 'space debris'],
  ['threetone', 'three-tone'], ['twotone', 'two-tone'], ['zapthreetonedown', 'zap three-tone down'], ['zapthreetoneup', 'zap three-tone up'], ['zaptwotone', 'zap two-tone'],
  ['belthandle', 'belt handle'], ['bookclose', 'book close'], ['bookflip', 'book page flip'], ['bookopen', 'book open'], ['bookplace', 'book place'], ['clothbelt', 'cloth belt'],
  ['doorclose', 'door close'], ['dooropen', 'door open'], ['drawknife', 'draw knife'], ['dropleather', 'drop leather'], ['handlecoins', 'handle coins'], ['handlesmallleather', 'handle small leather'],
  ['knifeslice', 'knife slice'], ['metalclick', 'metal click'], ['metallatch', 'metal latch'], ['metalpot', 'metal pot'], ['computernoise', 'computer noise'], ['enginecircular', 'circular engine'],
  ['explosioncrunch', 'explosion crunch'], ['forcefield', 'force field'], ['laserlarge', 'large laser'], ['laserretro', 'retro laser'], ['lasersmall', 'small laser'],
  ['lowfrequency-explosion', 'low frequency explosion'], ['spaceenginelarge', 'large space engine'], ['spaceenginelow', 'low space engine'], ['spaceenginesmall', 'small space engine'],
  ['spaceengine', 'space engine'], ['thrusterfire', 'thruster fire'], ['mouseclick', 'mouse click'], ['mouserelease', 'mouse release'], ['rollover', 'rollover'],
];
const NUM_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function classify(pack, base) {
  // returns [category, tags[]]
  const t = new Set([PACK_LABEL[pack].toLowerCase()]);
  if (pack === 'casino-audio') { ['card', 'chip', 'dice', 'die'].forEach((k) => base.includes(k) && t.add(k === 'die' ? 'dice' : k + 's')); t.add('game'); return ['Casino', [...t]]; }
  if (pack === 'digital-audio') {
    t.add('8-bit'); t.add('retro');
    if (base.startsWith('laser') || base.startsWith('zap')) { t.add('laser'); t.add('shoot'); return ['Weapons', [...t]]; }
    if (base.startsWith('powerup')) { t.add('power-up'); t.add('bonus'); return ['Gaming', [...t]]; }
    if (base.startsWith('spacetrash')) { t.add('space'); return ['Sci-Fi', [...t]]; }
    if (base.startsWith('phase')) { t.add('teleport'); return ['Sci-Fi', [...t]]; }
    t.add('blip'); return ['Gaming', [...t]];
  }
  if (pack === 'impact-sounds') {
    if (base.startsWith('footstep')) { t.add('walk'); t.add('steps'); t.add(base.split('-')[1]); return ['Footsteps', [...t]]; }
    t.add('hit'); ['glass', 'metal', 'wood', 'punch', 'bell', 'plate', 'tin', 'plank', 'soft', 'mining'].forEach((k) => base.includes(k) && t.add(k)); ['heavy', 'medium', 'light'].forEach((k) => base.includes(k) && t.add(k));
    return ['Impact', [...t]];
  }
  if (pack === 'interface-sounds') {
    if (/error|confirmation|question|bong/.test(base)) { t.add('alert'); return ['Notification', [...t]]; }
    if (base.startsWith('glitch')) { t.add('digital'); return ['Glitch', [...t]]; }
    t.add('app'); t.add(base.split('-')[0]); return ['UI', [...t]];
  }
  if (pack === 'music-jingles') { t.add('jingle'); t.add('win'); t.add('stinger'); t.add(base.startsWith('8-bit') ? '8-bit' : base.split('-')[0]); return ['Music stingers', [...t]]; }
  if (pack === 'rpg-audio') {
    if (base.startsWith('footstep')) { t.add('walk'); t.add('steps'); t.add('leather'); return ['Footsteps', [...t]]; }
    t.add('fantasy'); ['book', 'cloth', 'belt', 'leather', 'creak', 'door', 'knife', 'metal', 'coins', 'chop', 'pot'].forEach((k) => base.includes(k) && t.add(k));
    return ['Foley', [...t]];
  }
  if (pack === 'sci-fi-sounds') {
    t.add('space'); t.add('futuristic');
    if (base.includes('explosion')) { t.add('explosion'); t.add('boom'); return ['Impact', [...t]]; }
    if (base.includes('laser')) { t.add('laser'); t.add('shoot'); return ['Weapons', [...t]]; }
    if (base.includes('engine') || base.includes('thruster')) { t.add('engine'); t.add('spaceship'); return ['Vehicles', [...t]]; }
    return ['Sci-Fi', [...t]];
  }
  if (pack === 'ui-audio' || pack === 'ui-pack') { t.add('app'); t.add('button'); t.add(base.replace(/^sounds-/, '').replace(/[-0-9]+.*$/, '')); return ['UI', [...t]]; }
  if (pack === 'voiceover-pack') { t.add('announcer'); t.add('game'); t.add(base.startsWith('female') ? 'female' : 'male'); if (base.includes('-war-')) t.add('war'); return ['Voice', [...t]]; }
  if (pack === 'voiceover-pack-fighter') { t.add('announcer'); t.add('fighting'); t.add('arcade'); t.add('male'); return ['Voice', [...t]]; }
  return ['Foley', [...t]];
}

function humanize(pack, base) {
  let b = base;
  if (pack === 'music-jingles') {
    const m = b.match(/^([a-z0-9-]+?)-jingles-jingles-[a-z]+(\d+)$/);
    if (m) return `${cap(m[1] === 'nes' ? '8-bit' : m[1])} jingle ${Number(m[2]) + 1}`;
  }
  if (pack === 'voiceover-pack') {
    const m = b.match(/^(female|male)-(\d+)$/);
    if (m) return `${cap(m[1])} voice: "${cap(NUM_WORDS[Number(m[2])])}"`;
    const [who, ...rest] = b.split('-');
    const phrase = rest.filter((w) => w !== 'war').join(' ').replace(/^its a tie$/, "it's a tie").replace(/supressing/, 'suppressing');
    return `${cap(who)} voice: "${cap(phrase)}"`;
  }
  if (pack === 'voiceover-pack-fighter') {
    if (/^\d+$/.test(b)) return `Announcer: "${cap(NUM_WORDS[Number(b)])}"`;
    return `Announcer: "${cap(b.replace(/^it-s-a-tie$/, "it's a tie").replace(/-/g, ' '))}"`;
  }
  b = b.replace(/^sounds-/, '');
  for (const [k, v] of SPLIT) if (b.startsWith(k)) { b = v + b.slice(k.length); break; }
  b = b.replace(/-?0*(\d+)$/, (_, n) => ` ${Number(n) + (pack === 'impact-sounds' || pack === 'sci-fi-sounds' ? 1 : 0)}`);
  b = b.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  return cap(b);
}

const rows = [];
for (const pack of fs.readdirSync(root).sort()) {
  const dir = path.join(root, pack);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    if (!f.endsWith('.ogg')) continue;
    const base = f.slice(0, -4);
    const [category, tags] = classify(pack, base);
    const d = durations[`${pack}/${f}`];
    rows.push([`${pack}/${f}`, humanize(pack, base), category, tags.filter(Boolean), d ? d[0] : 0]);
  }
}
const out = `/* AUTO-GENERATED by scripts/gen-sfx-catalog.mjs — do not edit by hand.
 * Real recorded/produced sound effects by Kenney (https://kenney.nl), CC0 1.0 (public domain).
 * Files live in public/sfx/<pack>/… Tuple: [path, name, category, tags, durationSeconds]. */
import type { SfxCategory } from './sfx';
export type SfxSampleRow = [path: string, name: string, category: SfxCategory, tags: string[], duration: number];
export const SFX_SAMPLE_ROWS: SfxSampleRow[] = [
${rows.map((r) => '  ' + JSON.stringify(r)).join(',\n')}
];
`;
fs.writeFileSync(path.join(here, '..', 'src', 'library', 'sfxSamples.ts'), out);
const byCat = {};
for (const r of rows) byCat[r[2]] = (byCat[r[2]] || 0) + 1;
console.log(rows.length, 'samples', byCat);
