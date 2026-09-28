// المصيّر 2D — view2d.js (كيلفّ دوال render.js)
import * as R from './render.js';
import { TILE } from './world.js';
import { clamp, dist } from './util.js';

export class View2D {
  constructor() {
    this.type = '2d';
  }

  // كيتسمى ملي تبدل الجزيرة
  onWorld(game) {
    R.clearChunks();
  }

  init(game, canvas) {
    R.buildAtlas();
    this.ctx = canvas.getContext('2d', { alpha: false });
    game.ctx = this.ctx;
  }

  resize(game) {
    if (game.ctx) {
      game.canvas.width = Math.floor(game.W * game.dpr);
      game.canvas.height = Math.floor(game.H * game.dpr);
      game.ctx.setTransform(game.dpr, 0, 0, game.dpr, 0, 0);
      game.ctx.imageSmoothingEnabled = true;
    }
  }

  render(game) {
    const ctx = this.ctx, W = game.W, H = game.H;
    if (!ctx) return;
    ctx.setTransform(game.dpr, 0, 0, game.dpr, 0, 0);
    ctx.fillStyle = '#14476b';
    ctx.fillRect(0, 0, W, H);
    if (!game.world) return;

    R.beginChunks(game.time);
    const zoom = game.zoom;
    const cam = { x: game.cam.x + game.fx.shx, y: game.cam.y + game.fx.shy };

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-cam.x, -cam.y);

    const halfW = W / 2 / zoom, halfH = H / 2 / zoom;
    const CHPX = 8 * TILE;
    const c0x = Math.floor((cam.x - halfW) / CHPX), c1x = Math.floor((cam.x + halfW) / CHPX);
    const c0y = Math.floor((cam.y - halfH) / CHPX), c1y = Math.floor((cam.y + halfH) / CHPX);

    ctx.fillStyle = '#1b6f8f';
    ctx.fillRect(cam.x - halfW, cam.y - halfH, halfW * 2, halfH * 2);
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const cv = R.getChunk(game.world, cx, cy);
        if (cv) ctx.drawImage(cv, cx * CHPX, cy * CHPX);
      }

    R.drawFoam(ctx, game.world, cam, W, H, zoom, game.time);

    const objs = game.world.objsNear(cam.x, cam.y, Math.max(halfW, halfH) + 260);
    objs.sort((a, b) => a.y - b.y);
    for (const o of objs) R.drawObject(ctx, o, game.time, game.world);

    for (const it of game.items) R.drawItem(ctx, it, game.time);

    const actors = game.world.animals.map((a) => ({ y: a.y, a }));
    actors.push({ y: game.player.y, a: game.player });
    actors.sort((p, q) => p.y - q.y);
    for (const { a } of actors) {
      if (a === game.player) R.drawPlayer(ctx, game.player, game.time);
      else R.drawAnimal(ctx, a, game.time);
    }

    game.fx.draw(ctx);

    if (game.state === 'playing' && game.flags.escaped === 0) {
      const boat = game.world.struct('boat');
      if (boat) this.drawBoatPointer(ctx, game, boat);
    }
    ctx.restore();

    R.drawAtmosphere(ctx, game, W, H, cam, zoom);
  }

  drawBoatPointer(ctx, game, boat) {
    const p = game.player;
    const d = dist(p.x, p.y, boat.x, boat.y);
    if (d < 300) return;
    const a = Math.atan2(boat.y - p.y, boat.x - p.x);
    const r = 90 / game.zoom;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.translate(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
    ctx.rotate(a);
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
