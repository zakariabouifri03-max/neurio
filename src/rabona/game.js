import * as THREE from 'three';
import { createWobblyPlayer, createBall } from './models.js';
import { PITCH_LENGTH, PITCH_WIDTH, GOAL_WIDTH, GOAL_HEIGHT, BALL_RADIUS, MATCH_DURATION, clamp, dist, stepBall, kickBall, stepPlayer, formatTime, seeded, TEAMS } from './rules.js';

const $ = id => document.getElementById(id);

export class RabonaGame {
  constructor({ scene, camera, world, audio, onPause, onFinish, onGoal }) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.audio = audio;
    this.onPause = onPause;
    this.onFinish = onFinish;
    this.onGoal = onGoal;
    this.state = 'lobby'; // lobby, playing, paused, finished, goal
    this.keys = new Set();
    this.touch = { left:false, right:false, up:false, down:false, kick:false, sprint:false, slide:false, rabona:false };
    this.random = seeded(99);
    this.players = [];
    this.ball = { x:0, y:BALL_RADIUS, z:0, vx:0, vy:0, vz:0, spinX:0, spinY:0, spinZ:0, rotationX:0, rotationY:0, rotationZ:0 };
    this.ballModel = null;
    this.time = 0;
    this.scoreBlue = 0;
    this.scoreRed = 0;
    this.possessor = null;
    this.activePlayerIndex = 0; // index in blue team for player control
    this.cameraMode = 'follow'; // follow, ball, wide
    this.bindInput();
    this.setupBallModel();
  }

  setupBallModel() {
    const m = createBall();
    this.ballModel = m;
    this.scene.add(m.root);
  }

  bindInput() {
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape' && this.state === 'playing') { e.preventDefault(); this.pause(); return; }
      if (this.state !== 'playing') return;
      if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','KeyE','KeyQ','KeyC','KeyR'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'KeyE') this.tryKick(false);
      if (e.code === 'KeyQ') this.tryKick(true); // rabona
      if (e.code === 'Space') this.trySlide();
      if (e.code === 'KeyC') { this.cameraMode = this.cameraMode==='follow' ? 'ball' : 'follow'; }
      if (e.code === 'KeyR') this.switchPlayer();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { if (this.state==='playing') this.pause(); this.keys.clear(); Object.keys(this.touch).forEach(k=>this.touch[k]=false); });
    document.addEventListener('visibilitychange', ()=>{ if(document.hidden && this.state==='playing') this.pause(); });

    const bindHold = (id, key) => {
      const btn = $(id);
      if(!btn) return;
      btn.addEventListener('pointerdown', ev=>{ ev.preventDefault(); btn.setPointerCapture(ev.pointerId); this.touch[key]=true; });
      const stop=()=>{ this.touch[key]=false; };
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointercancel', stop);
      btn.addEventListener('pointerleave', stop);
    };
    bindHold('touch-left','left');
    bindHold('touch-right','right');
    bindHold('touch-up','up');
    bindHold('touch-down','down');
    bindHold('touch-kick','kick');
    bindHold('touch-sprint','sprint');
    bindHold('touch-slide','slide');
    bindHold('touch-rabona','rabona');

    $('touch-kick')?.addEventListener('pointerdown', e=>{ e.preventDefault(); this.tryKick(false); });
    $('touch-rabona')?.addEventListener('pointerdown', e=>{ e.preventDefault(); this.tryKick(true); });
    $('touch-slide')?.addEventListener('pointerdown', e=>{ e.preventDefault(); this.trySlide(); });
  }

  makePlayer(teamId, isGK, x, z, angle, isUser=false, variant=0) {
    const model = createWobblyPlayer(teamId, isGK, variant);
    this.scene.add(model.root);
    const player = {
      team: teamId,
      isGoalkeeper: isGK,
      x, z, y:0,
      vx:0, vz:0,
      angle,
      isUser,
      variant,
      state: 'idle',
      stateTimer: 0,
      runCycle: Math.random()*Math.PI,
      wobbleX:0, wobbleZ:0, wobbleY:0,
      hasBall:false,
      model,
      skill: 0.6 + this.random()*0.35,
      possessionTime:0,
      name: isGK ? 'GK' : (teamId==='blue'?'BLUE '+(variant+1):'RED '+(variant+1)),
    };
    this.players.push(player);
    return player;
  }

  start(options={}) {
    this.options = { mode:'quick', difficulty:'normal', ...options };
    // clear previous
    this.players.forEach(p=>{ this.scene.remove(p.model.root); });
    this.players = [];
    this.random = seeded(123 + Math.floor(Math.random()*1000));
    this.time = 0;
    this.scoreBlue = 0;
    this.scoreRed = 0;
    this.state = 'playing';
    this.ball = { x:0, y:BALL_RADIUS, z:0, vx:0, vy:0, vz:0, spinX:0, spinY:0, spinZ:0, rotationX:0, rotationY:0, rotationZ:0 };
    this.possessor = null;
    this.goalTimer = 0;
    this.kickCooldown = 0;
    this.keys.clear();
    Object.keys(this.touch).forEach(k=>this.touch[k]=false);

    // teams: 3v3 (2 field + GK)
    // Blue (player team) at left side (-x)
    this.makePlayer('blue', false, -12, -4, 0, true, 0); // user
    this.makePlayer('blue', false, -18, 6, 0.3, false, 1);
    this.makePlayer('blue', true, -PITCH_LENGTH/2 + 1.2, 0, 0, false, 2);

    // Red (AI) at right side
    this.makePlayer('red', false, 12, 3, Math.PI, false, 3);
    this.makePlayer('red', false, 18, -5, Math.PI, false, 4);
    this.makePlayer('red', true, PITCH_LENGTH/2 -1.2, 0, Math.PI, false, 5);

    this.activePlayerIndex = 0;
    this.activePlayer = this.players[0];

    $('lobby').hidden = true;
    $('hud').hidden = false;
    document.body.classList.add('playing');

    this.updateHUD();
    this.updateCamera(1);
    this.world.updateScoreTexture(this.scoreBlue, this.scoreRed, formatTime(this.time));
    this.say('Kick-off! WASD to move, E to kick, Q for Rabona, Space to slide tackle.');
  }

  pause() {
    if (this.state!=='playing') return;
    this.state='paused';
    this.keys.clear();
    Object.keys(this.touch).forEach(k=>this.touch[k]=false);
    this.audio?.stop?.();
    this.onPause?.();
  }
  resume() {
    if (this.state!=='paused') return;
    this.state='playing';
    this.keys.clear();
  }
  lobby() {
    this.state='lobby';
    this.players.forEach(p=>{ p.model.root.visible=false; });
    $('hud').hidden = true;
    $('lobby').hidden = false;
    document.body.classList.remove('playing');
  }

  switchPlayer() {
    // switch to closest blue field player to ball
    const blueField = this.players.filter(p=>p.team==='blue' && !p.isGoalkeeper);
    if (blueField.length<2) return;
    let best = null, bestDist = Infinity;
    for (const p of blueField) {
      if (p===this.activePlayer) continue;
      const d = dist(p.x,p.z,this.ball.x,this.ball.z);
      if (d<bestDist) { bestDist=d; best=p; }
    }
    if (best) {
      this.activePlayer.isUser = false;
      best.isUser = true;
      this.activePlayer = best;
      this.say(`Switched to ${best.name}. Go get the ball!`, 2.5);
    }
  }

  tryKick(isRabona) {
    if (this.state!=='playing' || this.kickCooldown>0) return;
    const player = this.activePlayer;
    if (!player) return;
    if (player.state==='fall' || player.state==='slide' || player.state==='getup') return;
    const d = dist(player.x, player.z, this.ball.x, this.ball.z);
    const hasBall = d < 1.6 || player.hasBall;

    if (!hasBall && d>2.2) return; // too far

    this.kickCooldown = 0.25;
    const targetGoalX = player.team==='blue' ? PITCH_LENGTH/2 : -PITCH_LENGTH/2;
    // aim with some spread, or aim towards mouse? Use player facing + slight random
    let aimX = targetGoalX + (Math.random()-0.5)*6;
    let aimZ = (Math.random()-0.5)*GOAL_WIDTH*0.8;
    // if close to goal, aim more precise
    if (Math.abs(this.ball.x - targetGoalX) < 20) {
      aimZ = (Math.random()-0.5)*GOAL_WIDTH*0.6;
    } else {
      // otherwise aim forward in facing direction
      aimX = player.x + Math.sin(player.angle)*18;
      aimZ = player.z + Math.cos(player.angle)*18;
    }

    // power
    const power = isRabona ? 16 + this.random()*3 : 13 + this.random()*5;
    const height = isRabona ? 3.5 : 2.0 + Math.random()*1.2;
    const curve = isRabona ? (Math.random()>0.5?1:-1)* (0.8+this.random()*0.6) : (Math.random()-0.5)*0.4;

    kickBall(this.ball, player.x, player.z, aimX, aimZ, power, height, curve);

    player.state = isRabona ? 'rabona' : 'kick';
    player.stateTimer = isRabona ? 0.55 : 0.35;
    player.hasBall = false;
    this.possessor = null;
    this.audio?.kick?.(isRabona);

    // wobble
    player.wobbleX = (Math.random()-0.5)*0.6;
    player.wobbleZ = (Math.random()-0.5)*0.6;

    // camera shake
    this.cameraShake = 0.18;
  }

  trySlide() {
    if (this.state!=='playing') return;
    const player = this.activePlayer;
    if (!player || player.state==='slide' || player.state==='fall' || player.state==='getup') return;
    player.state = 'slide';
    player.stateTimer = 0.8;
    // boost forward
    player.vx += Math.sin(player.angle)*6;
    player.vz += Math.cos(player.angle)*6;
    player.wobbleX = 0.8;
    this.audio?.slide?.();
  }

  say(msg, duration=4) {
    const el = $('commentary');
    if(!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(this._sayTimer);
    this._sayTimer = setTimeout(()=>{ el.style.opacity='0'; }, duration*1000);
  }

  checkGoal() {
    const b = this.ball;
    // left goal (blue defends, red scores)
    if (b.x < -PITCH_LENGTH/2 + 0.2) {
      if (Math.abs(b.z) < GOAL_WIDTH/2 && b.y < GOAL_HEIGHT) {
        // red scores? Actually ball in blue goal -> red scores
        return 'red';
      }
    }
    if (b.x > PITCH_LENGTH/2 -0.2) {
      if (Math.abs(b.z) < GOAL_WIDTH/2 && b.y < GOAL_HEIGHT) {
        return 'blue';
      }
    }
    return null;
  }

  resetAfterGoal(scoringTeam) {
    if (scoringTeam==='blue') this.scoreBlue++;
    else this.scoreRed++;
    this.world.updateScoreTexture(this.scoreBlue, this.scoreRed, formatTime(this.time));
    this.say(`GOAL! ${scoringTeam.toUpperCase()} scores! ${this.scoreBlue} - ${this.scoreRed}`, 3);
    this.audio?.goal?.();
    // celebrate
    this.players.forEach(p=>{
      if (p.team===scoringTeam) { p.state='celebrate'; p.stateTimer=2.2; }
      else { p.state='idle'; }
    });
    // reset ball after delay
    this.state = 'goal';
    this.goalTimer = 2.5;
    this.goalScorer = scoringTeam;
  }

  resetPositions() {
    this.ball.x=0; this.ball.y=BALL_RADIUS; this.ball.z=0;
    this.ball.vx=0; this.ball.vy=0; this.ball.vz=0;
    this.ball.spinX=0; this.ball.spinY=0; this.ball.spinZ=0;
    const positionsBlue = [[-12,-4], [-18,6], [-PITCH_LENGTH/2+1.2,0]];
    const positionsRed = [[12,3],[18,-5],[PITCH_LENGTH/2-1.2,0]];
    let bi=0, ri=0;
    this.players.forEach(p=>{
      if(p.team==='blue'){
        const [x,z]=positionsBlue[bi++%positionsBlue.length];
        p.x=x; p.z=z; p.vx=0; p.vz=0; p.angle=0; p.state='idle'; p.stateTimer=0; p.hasBall=false;
      } else {
        const [x,z]=positionsRed[ri++%positionsRed.length];
        p.x=x; p.z=z; p.vx=0; p.vz=0; p.angle=Math.PI; p.state='idle'; p.stateTimer=0; p.hasBall=false;
      }
    });
    this.possessor=null;
  }

  updateAI(player, dt) {
    if (player.isUser) return;
    if (player.state==='fall' || player.state==='getup' || player.state==='slide' || player.state==='kick' || player.state==='rabona' || player.state==='celebrate') {
      stepPlayer(player, {mx:0,mz:0,sprint:false}, dt, this.ball);
      return;
    }

    const ball = this.ball;
    const isGK = player.isGoalkeeper;
    let mx=0, mz=0, sprint=false, wantKick=false, wantRabona=false;

    const distToBall = dist(player.x, player.z, ball.x, ball.z);

    if (isGK) {
      // goalkeeper stays near goal
      const goalX = player.team==='blue' ? -PITCH_LENGTH/2+1.2 : PITCH_LENGTH/2-1.2;
      const targetZ = clamp(ball.z*0.7, -GOAL_WIDTH/2+0.5, GOAL_WIDTH/2-0.5);
      const targetX = goalX + (player.team==='blue'?0.6:-0.6) * Math.min(1, Math.abs(ball.x-goalX)/18);
      const dx = targetX - player.x;
      const dz = targetZ - player.z;
      mx = dx*1.2; mz = dz*1.2;
      // dive if ball close and heading to goal
      if (distToBall < 3.2 && Math.abs(ball.x - goalX) < 8 && ball.y < 2.5) {
        // dive towards ball
        mx = (ball.x - player.x)*2;
        mz = (ball.z - player.z)*2;
        if (distToBall < 1.8 && Math.random()<0.08) {
          // try to punch
          wantKick = true;
        }
      }
    } else {
      // field player
      if (distToBall < 18) {
        // chase ball
        const dx = ball.x - player.x;
        const dz = ball.z - player.z;
        mx = dx;
        mz = dz;
        sprint = distToBall > 4;
        if (distToBall < 1.5) {
          // has chance to kick
          if (Math.random()<0.04 + player.skill*0.02) {
            wantKick = true;
            if (Math.random()<0.18) wantRabona = true;
          }
        }
      } else {
        // positioning: stay in zone
        const baseX = player.team==='blue' ? -10 + (player.variant%2)*8 : 10 - (player.variant%2)*8;
        const baseZ = (player.variant%2===0? -5:5) + Math.sin(this.time*0.3+player.variant)*2;
        mx = (baseX - player.x)*0.6;
        mz = (baseZ - player.z)*0.6;
      }
    }

    // avoid crowding teammates
    for(const other of this.players){
      if(other===player) continue;
      if(other.team!==player.team) continue;
      const d = dist(player.x, player.z, other.x, other.z);
      if(d<1.8 && d>0.01){
        const nx = (player.x-other.x)/d;
        const nz = (player.z-other.z)/d;
        mx += nx*0.8;
        mz += nz*0.8;
      }
    }

    stepPlayer(player, {mx, mz, sprint}, dt, ball);

    if (wantKick && distToBall < 1.8) {
      // kick towards goal
      const targetGoalX = player.team==='blue' ? PITCH_LENGTH/2 : -PITCH_LENGTH/2;
      const aimZ = (Math.random()-0.5)*GOAL_WIDTH*0.9;
      const power = 12 + player.skill*6 + Math.random()*3;
      const height = 1.5 + Math.random()*1.8;
      const curve = (Math.random()-0.5)*0.7 + (wantRabona? (Math.random()>0.5?1:-1)*0.8 : 0);
      kickBall(ball, player.x, player.z, targetGoalX, aimZ, power, height, curve);
      player.state = wantRabona ? 'rabona' : 'kick';
      player.stateTimer = wantRabona ? 0.55 : 0.35;
      player.hasBall = false;
      this.possessor = null;
      this.audio?.kick?.(wantRabona);
      player.wobbleX = (Math.random()-0.5)*0.5;
    }
  }

  update(dt) {
    if (this.state==='paused' || this.state==='lobby') return;

    if (this.state==='goal') {
      this.goalTimer -= dt;
      this.time += 0; // pause time during celebration? Let time continue slightly?
      // animate players
      this.players.forEach(p=>{
        stepPlayer(p, {mx:0,mz:0}, dt, this.ball);
        p.model.update(p, dt, this.time);
      });
      this.updateCamera(dt);
      if (this.goalTimer<=0) {
        this.resetPositions();
        this.state='playing';
      }
      return;
    }

    if (this.state==='playing') {
      this.time += dt;
      if (this.time >= MATCH_DURATION) {
        this.finish();
        return;
      }

      // input for active player
      const active = this.activePlayer;
      if (active) {
        let mx=0, mz=0;
        const k = this.keys;
        const t = this.touch;
        if (k.has('KeyW') || k.has('ArrowUp') || t.up) mz -= 1;
        if (k.has('KeyS') || k.has('ArrowDown') || t.down) mz += 1;
        if (k.has('KeyA') || k.has('ArrowLeft') || t.left) mx -= 1;
        if (k.has('KeyD') || k.has('ArrowRight') || t.right) mx += 1;
        const sprint = k.has('ShiftLeft') || k.has('ShiftRight') || t.sprint;
        // normalize diagonal
        if (mx!==0 && mz!==0) { mx*=0.707; mz*=0.707; }

        // if player is in slide/fall/getup, ignore move
        if (['fall','getup','slide'].includes(active.state)) { mx=0; mz=0; }

        stepPlayer(active, {mx, mz, sprint}, dt, this.ball);

        // auto rabona with touch
        if (t.rabona) { this.tryKick(true); t.rabona=false; }
        if (t.kick) { this.tryKick(false); t.kick=false; }
        if (t.slide) { this.trySlide(); t.slide=false; }
      }

      // update other players AI
      for(const p of this.players) {
        if (p!==this.activePlayer) this.updateAI(p, dt);
        else if (!p.isUser) this.updateAI(p, dt); // if active but not user? shouldn't
      }

      // possession logic
      this.possessor = null;
      let closestDist = Infinity;
      for(const p of this.players) {
        const d = dist(p.x, p.z, this.ball.x, this.ball.z);
        if (d<1.4 && this.ball.y < 1.2) {
          if (d<closestDist) { closestDist=d; this.possessor=p; }
        }
        p.hasBall = false;
      }
      if (this.possessor) {
        this.possessor.hasBall = true;
        // attach ball slightly in front
        if (this.possessor.state!=='kick' && this.possessor.state!=='rabona' && this.possessor.state!=='slide' && this.possessor.state!=='fall') {
          const fwdX = Math.sin(this.possessor.angle)*0.85;
          const fwdZ = Math.cos(this.possessor.angle)*0.85;
          const targetX = this.possessor.x + fwdX;
          const targetZ = this.possessor.z + fwdZ;
          this.ball.x = THREE.MathUtils.lerp(this.ball.x, targetX, dt*8);
          this.ball.z = THREE.MathUtils.lerp(this.ball.z, targetZ, dt*8);
          this.ball.y = THREE.MathUtils.lerp(this.ball.y, BALL_RADIUS+0.05, dt*8);
          // damp ball velocity when possessed
          this.ball.vx *= 0.85;
          this.ball.vz *= 0.85;
          this.ball.vy *= 0.85;
        }
      }

      // ball physics
      stepBall(this.ball, dt);

      // collisions player vs ball (if not possessed, push)
      for(const p of this.players) {
        if (p===this.possessor) continue;
        const d = dist(p.x, p.z, this.ball.x, this.ball.z);
        if (d < 1.0 && this.ball.y < 1.5) {
          // push ball away
          const nx = (this.ball.x - p.x) / (d||1);
          const nz = (this.ball.z - p.z) / (d||1);
          this.ball.vx += nx * 2.5;
          this.ball.vz += nz * 2.5;
          // cause wobble
          p.wobbleX += (Math.random()-0.5)*0.4;
          // if sliding player hits ball carrier, make carrier fall
          if (p.state==='slide' && this.possessor && dist(p.x,p.z,this.possessor.x,this.possessor.z)<1.3) {
            this.possessor.state='fall';
            this.possessor.stateTimer=0.9;
            this.possessor.hasBall=false;
            this.possessor=null;
            this.audio?.bump?.();
          }
        }
        // player vs player collision - cause fall if high speed
        for(const other of this.players) {
          if (other===p) continue;
          if (other.team===p.team) continue;
          const pd = dist(p.x,p.z,other.x,other.z);
          if (pd<0.9) {
            const nx = (p.x-other.x)/(pd||1);
            const nz = (p.z-other.z)/(pd||1);
            p.x += nx*0.04;
            p.z += nz*0.04;
            other.x -= nx*0.04;
            other.z -= nz*0.04;
            // if one is sliding, other falls
            if (p.state==='slide' && other.state!=='fall' && other.state!=='slide') {
              other.state='fall';
              other.stateTimer=0.8;
              this.audio?.bump?.();
            }
          }
        }
      }

      // check goal
      const goal = this.checkGoal();
      if (goal) {
        this.resetAfterGoal(goal);
      }

      // update models
      for(const p of this.players) {
        p.model.update(p, dt, this.time);
      }

      // ball model
      if (this.ballModel) {
        this.ballModel.root.position.set(this.ball.x, this.ball.y, this.ball.z);
        this.ballModel.mesh.rotation.x = this.ball.rotationX;
        this.ballModel.mesh.rotation.y = this.ball.rotationY;
        this.ballModel.mesh.rotation.z = this.ball.rotationZ;
        // shadow
        this.ballModel.shadowMesh.position.set(this.ball.x, 0.02, this.ball.z);
        this.ballModel.shadowMesh.material.opacity = clamp(0.5 - this.ball.y*0.15, 0.05, 0.5);
        this.ballModel.shadowMesh.scale.setScalar(clamp(1 - this.ball.y*0.12, 0.3, 1));
      }

      this.kickCooldown = Math.max(0, this.kickCooldown - dt);
      this.cameraShake = Math.max(0, (this.cameraShake||0) - dt*2);

      this.updateCamera(dt);
      this.updateHUD();

      // auto switch active player if ball far and active not near
      if (this.activePlayer && !this.activePlayer.hasBall) {
        const dActive = dist(this.activePlayer.x, this.activePlayer.z, this.ball.x, this.ball.z);
        if (dActive > 12) {
          // find closest blue
          const blueField = this.players.filter(p=>p.team==='blue' && !p.isGoalkeeper);
          let best=null, bestD=Infinity;
          for(const p of blueField){
            const d = dist(p.x,p.z,this.ball.x,this.ball.z);
            if(d<bestD){ bestD=d; best=p; }
          }
          if (best && best!==this.activePlayer && bestD < dActive - 2) {
            this.activePlayer.isUser=false;
            best.isUser=true;
            this.activePlayer=best;
          }
        }
      }

      this.world.followShadow(this.ball.x, this.ball.z);
    }
  }

  updateCamera(dt) {
    if (!this.activePlayer) return;
    const ball = this.ball;
    const player = this.activePlayer;
    const time = this.time;

    let target = new THREE.Vector3();
    let pos = new THREE.Vector3();

    if (this.cameraMode==='ball' || this.state==='goal') {
      // wide broadcast view
      const midX = (ball.x + player.x*0.2)/1.2;
      const midZ = (ball.z + player.z*0.2)/1.2;
      target.set(midX, 0.5, midZ);
      const height = 18 + Math.abs(ball.x)*0.08;
      const dist = 22;
      // side camera: look from side, slightly behind ball
      pos.set(midX - 2, height, midZ + dist*0.6);
      // orbit a bit during goal
      if (this.state==='goal') {
        const ang = time*0.6;
        pos.x = midX + Math.sin(ang)*12;
        pos.z = midZ + Math.cos(ang)*12;
        pos.y = 8 + Math.sin(ang*0.7)*2;
      }
    } else {
      // follow player
      const fwdX = Math.sin(player.angle);
      const fwdZ = Math.cos(player.angle);
      // camera behind player
      const behind = 7.5 + Math.hypot(player.vx, player.vz)*0.15;
      const height = 4.2 + Math.hypot(player.vx, player.vz)*0.08;
      pos.set(player.x - fwdX*behind, height, player.z - fwdZ*behind);
      // look at point ahead of player towards ball
      const lookX = (player.x*0.4 + ball.x*0.6);
      const lookZ = (player.z*0.4 + ball.z*0.6);
      target.set(lookX, 0.6, lookZ);
      // add wobble when running
      if (player.state==='run') {
        pos.y += Math.sin(player.runCycle*2)*0.08;
      }
    }

    // smooth
    const lerpFactor = dt>=0.5?1:1-Math.exp(-dt* (this.state==='goal'?2.2:5));
    this.camera.position.lerp(pos, lerpFactor);
    // look at
    const currentLook = new THREE.Vector3();
    this.camera.getWorldDirection(currentLook);
    // we need to lerp look target
    if (!this._lookTarget) this._lookTarget = target.clone();
    this._lookTarget.lerp(target, lerpFactor*1.2);
    this.camera.lookAt(this._lookTarget);

    // shake
    if (this.cameraShake>0) {
      this.camera.position.x += (Math.random()-0.5)*this.cameraShake;
      this.camera.position.y += (Math.random()-0.5)*this.cameraShake;
      this.camera.position.z += (Math.random()-0.5)*this.cameraShake;
    }

    // fov based on speed
    const speed = Math.hypot(player.vx, player.vz);
    const desiredFov = 58 + speed*0.8 + (this.cameraShake>0?5:0);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, desiredFov, dt*3);
    this.camera.updateProjectionMatrix();
  }

  updateHUD() {
    const timeLeft = Math.max(0, MATCH_DURATION - this.time);
    const timeStr = formatTime(timeLeft);
    const scoreStr = `${this.scoreBlue} - ${this.scoreRed}`;
    const elTime = $('hud-time');
    const elScore = $('hud-score');
    const elBlue = $('score-blue');
    const elRed = $('score-red');
    if (elTime) elTime.textContent = timeStr;
    if (elScore) elScore.textContent = scoreStr;
    if (elBlue) elBlue.textContent = String(this.scoreBlue);
    if (elRed) elRed.textContent = String(this.scoreRed);
    if (this.world) this.world.updateScoreTexture(this.scoreBlue, this.scoreRed, timeStr);

    // possession indicator
    const possEl = $('possession');
    if (possEl) {
      if (this.possessor) {
        possEl.textContent = this.possessor.team==='blue' ? 'BLUE POSSESSION' : 'RED POSSESSION';
        possEl.className = this.possessor.team;
      } else {
        possEl.textContent = 'LOOSE BALL';
        possEl.className = '';
      }
    }

    // active player name
    const activeEl = $('active-player');
    if (activeEl && this.activePlayer) {
      activeEl.textContent = this.activePlayer.name;
    }
  }

  finish() {
    this.state='finished';
    const won = this.scoreBlue > this.scoreRed;
    const draw = this.scoreBlue === this.scoreRed;
    this.onFinish?.({
      won,
      draw,
      scoreBlue: this.scoreBlue,
      scoreRed: this.scoreRed,
      time: this.time,
    });
  }
}
