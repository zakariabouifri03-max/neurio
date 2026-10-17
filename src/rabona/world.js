import * as THREE from 'three';
import { createPitch, createGoal, createStadium } from './models.js';
import { PITCH_LENGTH, PITCH_WIDTH, seeded } from './rules.js';

export function createEnvironment(renderer, scene) {
  // bright desert sky
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0,0,0,512);
  grad.addColorStop(0, '#5ab8ff');
  grad.addColorStop(0.45, '#87ceff');
  grad.addColorStop(0.7, '#b8e0ff');
  grad.addColorStop(1, '#e8d5a8');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,1024,512);
  // clouds
  const rand = seeded(123);
  for(let i=0;i<12;i++){
    const x = rand()*1024, y = 60+rand()*120, w= 40+rand()*120, h=12+rand()*18;
    ctx.fillStyle = `rgba(255,255,255,${0.5+rand()*0.4})`;
    ctx.beginPath();
    ctx.ellipse(x,y,w,h,0,0,Math.PI*2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.7;
  pmrem.dispose();
  return env;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const pitch = createPitch();
  group.add(pitch);

  const goalLeft = createGoal(-PITCH_LENGTH/2, true);
  const goalRight = createGoal(PITCH_LENGTH/2, false);
  group.add(goalLeft);
  group.add(goalRight);

  const stadium = createStadium();
  group.add(stadium.group);

  // lights
  scene.fog = new THREE.Fog(0xd8c8a0, 80, 200);
  const hemi = new THREE.HemisphereLight(0x87ceff, 0xc8b080, 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff5e0, 2.2);
  sun.position.set(20, 35, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048,2048);
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  // follow shadow
  function followShadow(x,z){
    sun.position.set(x+18, 35, z+12);
    sun.target.position.set(x,0,z);
    sun.shadow.needsUpdate = true;
  }

  return {
    group,
    pitch,
    goals: [goalLeft, goalRight],
    stadium,
    sun,
    followShadow,
    setLobby(on){
      // nothing special for lobby vs game
    },
    updateScoreTexture(scoreBlue, scoreRed, timeStr){
      const ctx = stadium.sctx;
      const canvas = stadium.scoreCanvas;
      ctx.fillStyle = '#111111';
      ctx.fillRect(0,0,256,128);
      ctx.fillStyle = '#ff3333';
      ctx.font = 'bold 54px monospace';
      ctx.textAlign='center';
      ctx.fillText(String(scoreBlue).padStart(2,'0'), 64, 68);
      ctx.fillStyle = '#3333ff';
      ctx.fillText(String(scoreRed).padStart(2,'0'), 192, 68);
      ctx.fillStyle = '#ffdd55';
      ctx.font = '18px monospace';
      ctx.fillText(timeStr, 128, 110);
      stadium.scoreTex.needsUpdate = true;
    },
    animate(t){
      // slight light flicker?
    }
  };
}
