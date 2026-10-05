// ============================================================
// GameHub.js — Playable In-Game Games (Velocity Rush, BattleGrid)
// ============================================================

import { streamEngine } from '../streaming/StreamEngine.js';
import { soundEngine } from '../audio/SoundEngine.js';

export class VelocityRushGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.isRunning = false;
    this.score = 0;
    this.combo = 1;
    this.playerX = 200;
    this.roadWidth = 320;
    this.roadX = 40;
    this.speed = 280;
    this.obstacles = [];
    this.boosts = [];
    this.spawnTimer = 0;
    this.lastTime = performance.now();
    this.keys = { left: false, right: false };

    this.onKeyDown = (e) => {
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.keys.left = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keys.right = true;
    };
    this.onKeyUp = (e) => {
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.keys.left = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keys.right = false;
    };
  }

  start() {
    this.isRunning = true;
    this.score = 0;
    this.combo = 1;
    this.playerX = this.canvas.width / 2;
    this.obstacles = [];
    this.boosts = [];
    this.lastTime = performance.now();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.loop();
  }

  stop() {
    this.isRunning = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  loop() {
    if (!this.isRunning) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    this.update(dt);
    this.render();

    requestAnimationFrame(() => this.loop());
  }

  update(dt) {
    const steerSpeed = 340;
    if (this.keys.left) this.playerX -= steerSpeed * dt;
    if (this.keys.right) this.playerX += steerSpeed * dt;

    // Bounds check
    const minX = this.roadX + 25;
    const maxX = this.roadX + this.roadWidth - 25;
    this.playerX = Math.max(minX, Math.min(maxX, this.playerX));

    // Score accumulation
    this.score += Math.round(this.speed * dt * this.combo * 0.1);

    // Spawning obstacles & turbo boosts
    this.spawnTimer += dt;
    if (this.spawnTimer > 0.8) {
      this.spawnTimer = 0;
      const ox = this.roadX + 30 + Math.random() * (this.roadWidth - 60);
      if (Math.random() < 0.3) {
        // Boost item
        this.boosts.push({ x: ox, y: -20, r: 12 });
      } else {
        // Traffic obstacle
        this.obstacles.push({ x: ox, y: -40, w: 32, h: 48, speed: this.speed * 0.45 });
      }
    }

    // Move & collide obstacles
    const playerY = this.canvas.height - 70;
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      o.y += this.speed * dt;

      // Collision with player
      if (Math.abs(this.playerX - o.x) < 28 && Math.abs(playerY - o.y) < 36) {
        // Crash!
        soundEngine.playClick(0.3, 150);
        this.combo = 1;
        this.speed = Math.max(180, this.speed - 80);
        this.obstacles.splice(i, 1);
        streamEngine.onGameplayFail();
        continue;
      }

      if (o.y > this.canvas.height + 50) {
        this.obstacles.splice(i, 1);
      }
    }

    // Move & collect boosts
    for (let i = this.boosts.length - 1; i >= 0; i--) {
      const b = this.boosts[i];
      b.y += this.speed * dt;

      if (Math.abs(this.playerX - b.x) < 25 && Math.abs(playerY - b.y) < 25) {
        soundEngine.playClick(0.2, 1200);
        this.combo += 1;
        this.speed = Math.min(500, this.speed + 30);
        this.score += 250;
        this.boosts.splice(i, 1);

        if (this.combo >= 4) {
          streamEngine.onGameplayWin();
        }
        continue;
      }

      if (b.y > this.canvas.height + 20) {
        this.boosts.splice(i, 1);
      }
    }
  }

  render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dark synth track background
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Neon Road
    ctx.fillStyle = '#1e1b4b';
    ctx.fillRect(this.roadX, 0, this.roadWidth, canvas.height);

    // Road glowing borders
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(this.roadX, 0);
    ctx.lineTo(this.roadX, canvas.height);
    ctx.moveTo(this.roadX + this.roadWidth, 0);
    ctx.lineTo(this.roadX + this.roadWidth, canvas.height);
    ctx.stroke();

    // Dashed center lines
    const offset = (performance.now() * 0.4) % 60;
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 3;
    ctx.setLineDash([25, 20]);
    ctx.lineDashOffset = -offset;
    ctx.beginPath();
    ctx.moveTo(this.roadX + this.roadWidth / 2, 0);
    ctx.lineTo(this.roadX + this.roadWidth / 2, canvas.height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Render Boosts
    this.boosts.forEach(b => {
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⚡', b.x, b.y + 4);
    });

    // Render Obstacles (enemy cars)
    this.obstacles.forEach(o => {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
      // Windshield
      ctx.fillStyle = '#18181b';
      ctx.fillRect(o.x - o.w / 2 + 4, o.y - o.h / 2 + 8, o.w - 8, 12);
    });

    // Render Player Race Car
    const playerY = canvas.height - 70;
    ctx.fillStyle = '#06b6d4'; // Cyan racer
    ctx.fillRect(this.playerX - 16, playerY - 24, 32, 48);

    // Spoiler & headlights
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(this.playerX - 14, playerY - 28, 8, 6);
    ctx.fillRect(this.playerX + 6, playerY - 28, 8, 6);
    ctx.fillStyle = '#f43f5e';
    ctx.fillRect(this.playerX - 16, playerY + 20, 32, 4);

    // HUD / Score
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE: ${this.score}`, 15, 30);
    ctx.fillStyle = '#facc15';
    ctx.fillText(`COMBO: x${this.combo}`, 15, 52);
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`SPEED: ${Math.round(this.speed)} KM/H`, 15, 74);
  }
}
