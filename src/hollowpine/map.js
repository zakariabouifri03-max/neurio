import {
  CAMP,
  WATER_SITE,
  RESOURCE_DEFS,
  heightAt,
  shoreX,
  distance,
} from "./rules.js";
export const MAP_CENTER = { x: -15, z: 7 };
export const MAP_SPAN = 150;
export function drawMap(
  canvas,
  world,
  player,
  state,
  yaw,
  { large = false, waypoint = null, time = 0 } = {},
) {
  const g = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height,
    scale = w / (large ? MAP_SPAN : 55),
    cx = large ? MAP_CENTER.x : player.x,
    cz = large ? MAP_CENTER.z : player.z - 6;
  const point = (x, z) => [(x - cx) * scale + w / 2, (z - cz) * scale + h / 2];
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#304532";
  g.fillRect(0, 0, w, h);
  g.save();
  g.translate(w / 2 - cx * scale, h / 2 - cz * scale);
  g.scale(scale, scale);
  g.strokeStyle = "#b2b99312";
  g.lineWidth = 1 / scale;
  for (let x = -100; x < 130; x += 8) {
    g.beginPath();
    g.moveTo(x, -100);
    g.lineTo(x, 130);
    g.stroke();
    g.beginPath();
    g.moveTo(-100, x);
    g.lineTo(130, x);
    g.stroke();
  }
  // A rough contour survey, rather than a street-map skin.
  for (let i = 0; i < 11; i++) {
    g.beginPath();
    g.strokeStyle = "#a9b1881b";
    for (let j = 0; j <= 60; j++) {
      const a = (j / 60) * Math.PI * 2,
        r = 9 + i * 4.9;
      const x = -26 + Math.cos(a) * r * (1 + Math.sin(a * 3) * 0.1),
        z = -14 + Math.sin(a) * r * 0.83;
      if (j === 0) g.moveTo(x, z);
      else g.lineTo(x, z);
    }
    g.stroke();
  }
  g.beginPath();
  g.moveTo(140, -130);
  for (let z = -130; z <= 140; z += 2) g.lineTo(shoreX(z), z);
  g.lineTo(140, 140);
  g.closePath();
  g.fillStyle = "#33544f";
  g.fill();
  g.strokeStyle = "#b1c6ae52";
  g.lineWidth = 1.5 / scale;
  g.stroke();
  g.save();
  g.strokeStyle = "#b4bf9b19";
  g.lineWidth = 1 / scale;
  for (let z = -120; z < 130; z += 7) {
    g.beginPath();
    g.moveTo(shoreX(z) + 4, z);
    g.quadraticCurveTo(48, z + 2, 92, z);
    g.stroke();
  }
  g.restore();
  for (const t of world.mapTrees) {
    g.fillStyle = "#6b815247";
    g.beginPath();
    g.arc(t.x, t.z, 0.8, 0, 7);
    g.fill();
  }
  g.beginPath();
  for (let z = -62; z <= 65; z += 2) {
    const x = -1 + Math.sin(z * 0.115) * 2.6;
    if (z === -62) g.moveTo(x, z);
    else g.lineTo(x, z);
  }
  g.strokeStyle = "#c0ad7652";
  g.lineWidth = 2.8;
  g.stroke();
  g.strokeStyle = "#d0b98c66";
  g.lineWidth = 0.3;
  g.setLineDash([1, 1.7]);
  g.stroke();
  g.setLineDash([]);
  for (const r of world.rockPoints) {
    g.fillStyle = "#75827455";
    g.beginPath();
    g.ellipse(r.x, r.z, r.radius, r.radius * 0.7, 0.4, 0, 7);
    g.fill();
  }
  for (const r of RESOURCE_DEFS) {
    if (state.collected.has(r.id)) continue;
    g.fillStyle =
      r.type === "berries"
        ? "#c39b7799"
        : r.type === "stone"
          ? "#b7c1a999"
          : "#b7c88fbb";
    g.beginPath();
    g.arc(r.x, r.z, large ? 0.45 : 0.33, 0, 7);
    g.fill();
  }
  if (waypoint) {
    g.beginPath();
    g.moveTo(player.x, player.z);
    g.lineTo(waypoint.x, waypoint.z);
    g.strokeStyle = "#deca9580";
    g.lineWidth = 1.7 / scale;
    g.setLineDash([1, 1.3]);
    g.stroke();
    g.setLineDash([]);
  }
  if (state.night)
    for (const wolf of world.wolves) {
      if (distance(player, wolf.root.position) > 35) continue;
      g.fillStyle = "#cc947c";
      g.beginPath();
      g.arc(wolf.root.position.x, wolf.root.position.z, 0.55, 0, 7);
      g.fill();
    }
  g.restore();
  const [campX, campY] = point(CAMP.x, CAMP.z),
    size = large ? 11 : 9;
  g.strokeStyle = "#ddc398";
  g.lineWidth = 1.6;
  g.fillStyle = "#42533b";
  g.beginPath();
  g.moveTo(campX, campY - size);
  g.lineTo(campX + size, campY + size * 0.65);
  g.lineTo(campX - size, campY + size * 0.65);
  g.closePath();
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(campX, campY - size * 0.25);
  g.lineTo(campX + size * 0.4, campY + size * 0.65);
  g.stroke();
  const [waterX, waterY] = point(WATER_SITE.x, WATER_SITE.z);
  g.fillStyle = "#afccc3";
  g.beginPath();
  g.arc(waterX, waterY, large ? 5 : 4, 0, 7);
  g.fill();
  g.strokeStyle = "#afccc366";
  g.beginPath();
  g.arc(waterX, waterY, large ? 9 : 7, 0, 7);
  g.stroke();
  if (large) {
    g.textAlign = "center";
    g.fillStyle = "#c4cea6";
    g.font = "11px Plex";
    g.fillText("CAMP CLEARING", campX, campY - 22);
    g.fillStyle = "#9ebbae";
    g.fillText("LAKESIDE SPRING", waterX, waterY - 19);
    g.fillStyle = "#b2bd8e66";
    g.font = "12px Plex";
    const [tx, ty] = point(-37, -30);
    g.fillText("BLACKWATER WOODS", tx, ty);
    const [lx, ly] = point(39, 25);
    g.save();
    g.translate(lx, ly);
    g.rotate(-Math.PI / 2);
    g.fillStyle = "#9db4a269";
    g.fillText("MIRROR LAKE", 0, 0);
    g.restore();
  }
  if (waypoint) {
    const [x, y] = point(waypoint.x, waypoint.z);
    g.strokeStyle = "#f0d19d";
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(x, y, 7, 0, 7);
    g.stroke();
    g.beginPath();
    g.moveTo(x - 11, y);
    g.lineTo(x + 11, y);
    g.moveTo(x, y - 11);
    g.lineTo(x, y + 11);
    g.stroke();
  }
  const [px, py] = point(player.x, player.z);
  g.save();
  g.translate(px, py);
  g.rotate(-yaw);
  g.fillStyle = "#eee3c338";
  g.beginPath();
  g.arc(0, 0, 17, 0, 7);
  g.fill();
  g.strokeStyle = "#dfcaa366";
  g.lineWidth = 1;
  g.beginPath();
  g.arc(0, 0, 17, 0, 7);
  g.stroke();
  g.fillStyle = "#f3e6bd";
  g.beginPath();
  g.moveTo(0, -11);
  g.lineTo(7, 8);
  g.lineTo(0, 4);
  g.lineTo(-7, 8);
  g.closePath();
  g.fill();
  g.restore();
  if (large) {
    g.fillStyle = "#c1caa7";
    g.font = "14px Plex";
    g.textAlign = "right";
    g.fillText("N ↑", w - 27, 37);
    g.fillStyle = "#99ad87";
    g.font = "9px Plex";
    g.fillText("APPROXIMATE TERRAIN / 150 M", w - 27, 56);
  } else {
    const v = g.createRadialGradient(
      w / 2,
      h / 2,
      w * 0.18,
      w / 2,
      h / 2,
      w * 0.6,
    );
    v.addColorStop(0, "#12281a00");
    v.addColorStop(1, "#12281a88");
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
  }
}
