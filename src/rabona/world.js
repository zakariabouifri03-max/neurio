import * as THREE from 'three';
import { createPitch, createGoal, createStadium } from './models.js';
import { PITCH_LENGTH, PITCH_WIDTH, seeded } from './rules.js';

export function createEnvironment(renderer, scene) {
  // ultra sky - high res with realistic gradient, sun, clouds with depth
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0,0,0,1024);
  grad.addColorStop(0, '#0a4a8a');
  grad.addColorStop(0.15, '#1a7ac4');
  grad.addColorStop(0.35, '#4aa8ff');
  grad.addColorStop(0.55, '#87ceff');
  grad.addColorStop(0.75, '#b8e0ff');
  grad.addColorStop(0.85, '#e8d5a8');
  grad.addColorStop(1, '#d8c49a');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,2048,1024);

  // ultra sun with glow
  const sunX = 1400, sunY = 220;
  const sunGrad = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 280);
  sunGrad.addColorStop(0, '#ffffff');
  sunGrad.addColorStop(0.15, '#fff6d0');
  sunGrad.addColorStop(0.35, '#ffe8a0');
  sunGrad.addColorStop(0.6, 'rgba(255,220,120,0.25)');
  sunGrad.addColorStop(1, 'rgba(255,200,80,0)');
  ctx.fillStyle = sunGrad;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 280, 0, Math.PI*2);
  ctx.fill();

  // volumetric clouds with multiple layers
  const rand = seeded(123);
  for(let layer=0; layer<3; layer++){
    for(let i=0;i<18;i++){
      const x = rand()*2048, y = 80 + rand()*280 + layer*40, w= 80+rand()*240, h=16+rand()*28+layer*8;
      ctx.fillStyle = `rgba(255,255,255,${0.35+rand()*0.35 - layer*0.08})`;
      ctx.beginPath();
      ctx.ellipse(x,y,w,h,0,0,Math.PI*2);
      ctx.fill();
      // second puff
      ctx.beginPath();
      ctx.ellipse(x+w*0.3, y-h*0.2, w*0.6, h*0.7, 0, 0, Math.PI*2);
      ctx.fill();
    }
  }

  // distant mountains silhouette
  ctx.fillStyle = 'rgba(180,140,90,0.18)';
  ctx.beginPath();
  ctx.moveTo(0, 600);
  for(let x=0; x<=2048; x+=80){
    ctx.lineTo(x, 580 + Math.sin(x*0.01)*40 + rand()*20);
  }
  ctx.lineTo(2048, 1024);
  ctx.lineTo(0, 1024);
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  scene.background = tex;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(tex);
  scene.environment = env.texture;
  scene.environmentIntensity = 1.1;
  scene.backgroundIntensity = 1.0;
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

  // ultra lighting setup
  scene.fog = new THREE.FogExp2(0xd8c8a0, 0.012);
  // add regular fog as well for distance
  scene.fog = new THREE.Fog(0xc8b898, 70, 260);

  const hemi = new THREE.HemisphereLight(0x87ceff, 0xb8a080, 1.4);
  hemi.position.set(0, 30, 0);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d0, 3.2);
  sun.position.set(22, 38, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096,4096); // ultra shadow
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  sun.shadow.blurSamples = 12;
  scene.add(sun);
  scene.add(sun.target);

  // fill lights for ultra realism - soft bounce
  const fill1 = new THREE.DirectionalLight(0x8ab8ff, 0.65);
  fill1.position.set(-20, 15, -20);
  scene.add(fill1);
  const fill2 = new THREE.DirectionalLight(0xffc8a0, 0.45);
  fill2.position.set(15, 12, 20);
  scene.add(fill2);

  // ambient for base
  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(ambient);

  function followShadow(x,z){
    sun.position.set(x+22, 38, z+16);
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
    setLobby(on){},
    updateScoreTexture(scoreBlue, scoreRed, timeStr){
      const ctx = stadium.sctx;
      const canvas = stadium.scoreCanvas;
      ctx.clearRect(0,0,512,256);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0,0,512,256);
      // glow
      ctx.shadowColor = '#ff2222';
      ctx.shadowBlur = 22;
      ctx.fillStyle = '#ff3333';
      ctx.font = '900 96px monospace';
      ctx.textAlign='center';
      ctx.fillText(String(scoreBlue).padStart(2,'0'), 128, 150);
      ctx.shadowColor = '#2222ff';
      ctx.fillStyle = '#3333ff';
      ctx.fillText(String(scoreRed).padStart(2,'0'), 384, 150);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffdd55';
      ctx.font = 'bold 26px monospace';
      ctx.fillText(timeStr, 256, 220);
      // scanlines for LED realism
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      for(let y=0;y<256;y+=4) ctx.fillRect(0,y,512,1);
      stadium.scoreTex.needsUpdate = true;
    },
    animate(t){
      // animate crowd slightly, flicker lights
      if (stadium.group) {
        stadium.group.children.forEach((child, idx)=>{
          if(child.isInstancedMesh){
            // subtle bobbing via dummy? skip for perf
          }
        });
      }
    }
  };
}
