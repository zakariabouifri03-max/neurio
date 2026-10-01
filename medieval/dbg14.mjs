import './node_modules/three/three.module.js';
await import('/tmp/domstub.mjs');
const { buildWeapon } = await import('./src/weapons.js');
const { WEAPONS } = await import('./src/data.js');
for (const w of WEAPONS) {
  const ud = buildWeapon(w).userData;
  console.log(`${w.id.padEnd(11)} reach=${String(w.reach).padEnd(5)} reachTip=${ud.reachTip.toFixed(3)} tipY=${ud.parts.tipY.toFixed(3)} gripY=${ud.gripY.toFixed(3)} gripY2=${(ud.gripY2??0).toFixed(3)} butt=${ud.segs[0].a.y.toFixed(3)} hands=${w.hands} mass=${w.mass}`);
}
