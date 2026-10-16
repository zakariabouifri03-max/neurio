import { RELAYS, SAFEHOUSE } from './rules.js';

// North-up tactical maps are drawn from the same geometry and state as the city.
export function drawMap(canvas, world, player, mission, yaw, { large = false, waypoint = null, scan = false, time = 0 } = {}) {
  const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  const span = large ? 280 : 95, scale = w / span;
  const cx = large ? 0 : player.x, cz = large ? 0 : player.z - 9;
  const point = (x, z) => [(x - cx) * scale + w / 2, (z - cz) * scale + h / 2];
  g.clearRect(0, 0, w, h); g.fillStyle = '#12272d'; g.fillRect(0, 0, w, h);
  g.save(); g.translate(w / 2 - cx * scale, h / 2 - cz * scale); g.scale(scale, scale);
  g.lineWidth = 1 / scale;
  g.strokeStyle = '#91c0a309';
  for (let x = -160; x <= 160; x += 8) { g.beginPath(); g.moveTo(x, -160); g.lineTo(x, 160); g.stroke(); g.beginPath(); g.moveTo(-160, x); g.lineTo(160, x); g.stroke(); }
  for (let ix = -2; ix < 2; ix++) for (let iz = -2; iz < 2; iz++) {
    const x = ix * 64 + 9.6, z = iz * 64 + 9.6;
    g.fillStyle = '#253c3e'; g.fillRect(x, z, 44.8, 44.8); g.strokeStyle = '#88a7972b'; g.strokeRect(x, z, 44.8, 44.8);
  }
  for (const b of world.buildings) { g.fillStyle = '#39504c'; g.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d); g.strokeStyle = '#93ad8e36'; g.strokeRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d); }
  g.strokeStyle = '#9bae8a20'; g.setLineDash([1.5, 2.5]);
  for (const r of [-128, -64, 0, 64, 128]) { g.beginPath(); g.moveTo(r, -145); g.lineTo(r, 145); g.stroke(); g.beginPath(); g.moveTo(-145, r); g.lineTo(145, r); g.stroke(); }
  g.setLineDash([]);
  const next = waypoint || (mission.extracting ? SAFEHOUSE : RELAYS.find(r => !mission.breached.has(r.id)));
  if (next && mission.active) { g.strokeStyle = '#d1ed7277'; g.lineWidth = (large ? 2 : 2) / scale; g.setLineDash([1.1, 1.6]); g.beginPath(); g.moveTo(player.x, player.z); g.lineTo(next.x, next.z); g.stroke(); g.setLineDash([]); }
  if (large) {
    g.fillStyle = '#bed8b458'; g.font = '2.2px Plex, monospace'; g.textAlign = 'center';
    g.fillText('WATERLOO', -32, -62); g.fillText('SOUTH BANK', 32, 1.1); g.fillText('BOROUGH', 92, -62);
    g.save(); g.rotate(-Math.PI / 2); g.fillText('NEXUS AVENUE', -62, -1.4); g.restore();
  }
  for (const d of world.drones) {
    g.fillStyle = '#d38d7055'; g.beginPath(); g.arc(d.x, d.z, 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#dba388'; g.beginPath(); g.arc(d.x, d.z, .6, 0, Math.PI * 2); g.fill();
  }
  if (scan) for (const c of world.cameras) { g.strokeStyle = '#8cccc8'; g.strokeRect(c.x - .65, c.z - .65, 1.3, 1.3); }
  g.restore();
  // Markers keep a constant screen size, independent of map zoom.
  const size = large ? 11 : 8;
  for (const r of RELAYS) {
    const [x, y] = point(r.x, r.z), breached = mission.breached.has(r.id);
    g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillStyle = breached ? '#97c1a7' : '#162a2b'; g.strokeStyle = breached ? '#a8d2b7' : '#d9c497'; g.lineWidth = 1.5; g.fillRect(-size / 2, -size / 2, size, size); g.strokeRect(-size / 2, -size / 2, size, size); g.restore();
    if (!breached) { g.fillStyle = '#e0cfa1'; g.fillRect(x - 1.2, y - 1.2, 2.4, 2.4); }
    if (large) { g.fillStyle = '#d3dfba'; g.font = '11px Plex, monospace'; g.textAlign = 'center'; g.fillText(r.code, x, y - 15); }
  }
  if (mission.extracting || large || mission.completed) {
    const [x, y] = point(SAFEHOUSE.x, SAFEHOUSE.z); g.strokeStyle = '#91bea1'; g.lineWidth = 1.5; g.strokeRect(x - size / 2, y - size / 2, size, size);
    if (mission.extracting) { g.globalAlpha = .5 + Math.sin(time * 3) * .3; g.beginPath(); g.arc(x, y, size + 6, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; }
    if (large) { g.font = '10px Plex, monospace'; g.fillStyle = '#8eb997'; g.textAlign = 'left'; g.fillText('SAFEHOUSE', x + 14, y + 4); }
  }
  if (waypoint) {
    const [x, y] = point(waypoint.x, waypoint.z); g.strokeStyle = '#ebdfb1'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke(); g.beginPath(); g.moveTo(x - 11, y); g.lineTo(x + 11, y); g.moveTo(x, y - 11); g.lineTo(x, y + 11); g.stroke();
  }
  const [px, py] = point(player.x, player.z);
  g.save(); g.translate(px, py); g.rotate(-yaw);
  const radius = large ? 12 : 13;
  g.fillStyle = '#cefa7244'; g.beginPath(); g.arc(0, 0, radius * 1.5, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#c1e97288'; g.lineWidth = 1; g.beginPath(); g.arc(0, 0, radius * 1.45, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#d6fb82'; g.beginPath(); g.moveTo(0, -radius); g.lineTo(radius * .68, radius * .65); g.lineTo(0, radius * .3); g.lineTo(-radius * .68, radius * .65); g.closePath(); g.fill(); g.restore();
  if (large) { g.fillStyle = '#92aa8c'; g.textAlign = 'right'; g.font = '13px Plex, monospace'; g.fillText('N ↑', w - 30, 34); g.font = '9px Plex, monospace'; g.fillText('SECTOR 04 / ENCRYPTED', w - 30, 52); }
  else { const gradient = g.createRadialGradient(w / 2, h / 2, w * .17, w / 2, h / 2, w * .6); gradient.addColorStop(0, '#091a2000'); gradient.addColorStop(1, '#091a2099'); g.fillStyle = gradient; g.fillRect(0, 0, w, h); }
}
