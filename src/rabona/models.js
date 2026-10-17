import * as THREE from 'three';
import { GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH, BALL_RADIUS, TEAMS, GK_COLOR, seeded } from './rules.js';

const matCache = new Map();
function mat(color, roughness=0.6, metalness=0.02, opts={}) {
  const key = `${color}-${roughness}-${metalness}-${JSON.stringify(opts)}`;
  if (!matCache.has(key)) {
    const m = new THREE.MeshPhysicalMaterial({ color, roughness, metalness, ...opts });
    matCache.set(key, m);
  }
  return matCache.get(key);
}
function capsule(radius, height, radial=10, heightSeg=12) {
  return new THREE.CapsuleGeometry(radius, height, radial, heightSeg);
}
function sphere(radius, w=20, h=14) {
  return new THREE.SphereGeometry(radius, w, h);
}
function whiteJoint(radius=0.11) {
  return new THREE.Mesh(sphere(radius, 16, 12), mat(0xffffff, 0.35, 0.05, { clearcoat:0.6, clearcoatRoughness:0.25 }));
}

function makeKitTexture(baseColor, variant, isGK=false) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `#${baseColor.toString(16).padStart(6,'0')}`;
  ctx.fillRect(0,0,512,512);
  // add fabric weave noise
  for(let i=0;i<8000;i++){
    ctx.fillStyle = `rgba(255,255,255,${Math.random()*0.06})`;
    ctx.fillRect(Math.random()*512, Math.random()*512, 1, 2);
  }
  // shoulder pattern
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(0,0,512,90);
  ctx.fillStyle = `rgba(0,0,0,0.12)`;
  ctx.fillRect(0,90,512,8);
  // number
  ctx.fillStyle = isGK ? '#1a1a1a' : '#ffffff';
  ctx.font = 'bold 180px Barlow, Arial';
  ctx.textAlign='center';
  ctx.fillText(String((variant%9)+1), 256, 320);
  // small RABONA text
  ctx.font = 'bold 24px Barlow, Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('RABONA', 256, 420);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createWobblyPlayer(teamId, isGoalkeeper=false, variant=0) {
  const team = TEAMS[teamId.toUpperCase()] || TEAMS.BLUE;
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.94;
  root.add(hips);

  const kitColor = isGoalkeeper ? GK_COLOR : team.kit;
  const kitTex = makeKitTexture(kitColor, variant, isGoalkeeper);
  const kitMat = new THREE.MeshPhysicalMaterial({ map: kitTex, roughness:0.55, metalness:0.05, clearcoat:0.3, clearcoatRoughness:0.4, sheen:0.4, sheenRoughness:0.6, sheenColor:0xffffff });

  // torso - high poly
  const torsoGroup = new THREE.Group();
  torsoGroup.position.y = 0.40;
  hips.add(torsoGroup);

  const torsoGeo = capsule(0.24, 0.56, 12, 14);
  const torsoMesh = new THREE.Mesh(torsoGeo, kitMat);
  torsoMesh.castShadow = true;
  torsoMesh.receiveShadow = true;
  torsoGroup.add(torsoMesh);

  // head - high poly
  const headGroup = new THREE.Group();
  headGroup.position.y = 0.56;
  torsoGroup.add(headGroup);

  const headGeo = sphere(0.275, 24, 18);
  const headMat = new THREE.MeshPhysicalMaterial({ color:0xfff6e8, roughness:0.45, metalness:0, clearcoat:0.2, sheen:0.8, sheenColor:0xffd6b0 });
  const headMesh = new THREE.Mesh(headGeo, headMat);
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  // eyes with reflection
  const eyeWhite = new THREE.Mesh(sphere(0.055, 16, 12), mat(0xffffff, 0.2, 0));
  eyeWhite.position.set(-0.10, 0.04, 0.21);
  headGroup.add(eyeWhite);
  const eyeWhiteR = eyeWhite.clone();
  eyeWhiteR.position.set(0.10, 0.04, 0.21);
  headGroup.add(eyeWhiteR);
  const eyeIrisMat = new THREE.MeshPhysicalMaterial({ color:0x3a2a1a, roughness:0.2, metalness:0, clearcoat:0.8 });
  const leftIris = new THREE.Mesh(sphere(0.028, 12, 10), eyeIrisMat);
  leftIris.position.set(-0.10, 0.04, 0.25);
  headGroup.add(leftIris);
  const rightIris = leftIris.clone();
  rightIris.position.set(0.10, 0.04, 0.25);
  headGroup.add(rightIris);
  const pupilMat = mat(0x0a0a0a, 0.1, 0);
  const leftPupil = new THREE.Mesh(sphere(0.014, 10, 8), pupilMat);
  leftPupil.position.set(-0.10, 0.04, 0.27);
  headGroup.add(leftPupil);
  const rightPupil = leftPupil.clone();
  rightPupil.position.set(0.10, 0.04, 0.27);
  headGroup.add(rightPupil);

  // hair - more realistic
  const hairColors = [0x1a1a1a, 0x4a2f1a, 0xc9a86a, 0xff6b9e, 0x3a3a3a, 0x8a5a3a];
  const hairColor = hairColors[variant % hairColors.length];
  const hairMat = new THREE.MeshPhysicalMaterial({ color:hairColor, roughness:0.85, metalness:0, sheen:0.5, sheenRoughness:0.8 });
  const hairBase = new THREE.Mesh(new THREE.SphereGeometry(0.295, 22, 16, 0, Math.PI*2, 0, Math.PI*0.66), hairMat);
  hairBase.position.y = 0.14;
  hairBase.rotation.x = -0.15;
  hairBase.castShadow = true;
  headGroup.add(hairBase);
  // hair strands / tufts
  for(let i=0;i<3;i++){
    const tuft = new THREE.Mesh(capsule(0.06+Math.random()*0.02, 0.18+Math.random()*0.08, 6, 8), hairMat);
    tuft.position.set((Math.random()-0.5)*0.18, 0.30+Math.random()*0.06, -0.08+Math.random()*0.08);
    tuft.rotation.set(Math.random()*0.5, Math.random()*0.5, Math.random()*0.4);
    tuft.castShadow = true;
    headGroup.add(tuft);
  }

  // arms - high poly, with muscles
  function createArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side*0.33, 0.24, 0);
    torsoGroup.add(shoulder);
    const joint = whiteJoint(0.12);
    shoulder.add(joint);

    const upperArmGroup = new THREE.Group();
    upperArmGroup.position.y = -0.07;
    shoulder.add(upperArmGroup);

    const upperArm = new THREE.Mesh(capsule(0.10, 0.36, 10, 10), kitMat);
    upperArm.position.y = -0.20;
    upperArm.castShadow = true;
    upperArm.receiveShadow = true;
    upperArmGroup.add(upperArm);

    const elbow = new THREE.Group();
    elbow.position.y = -0.40;
    upperArmGroup.add(elbow);
    const elbowJoint = whiteJoint(0.105);
    elbow.add(elbowJoint);

    const lowerArmGroup = new THREE.Group();
    elbow.add(lowerArmGroup);

    const lowerArm = new THREE.Mesh(capsule(0.088, 0.32, 10, 10), kitMat);
    lowerArm.position.y = -0.18;
    lowerArm.castShadow = true;
    lowerArm.receiveShadow = true;
    lowerArmGroup.add(lowerArm);

    const handMat = new THREE.MeshPhysicalMaterial({ color:0xfff0d6, roughness:0.5, metalness:0, sheen:0.6 });
    const hand = new THREE.Mesh(sphere(0.095, 16, 12), handMat);
    hand.position.y = -0.38;
    hand.castShadow = true;
    lowerArmGroup.add(hand);

    if (isGoalkeeper) {
      const gloveMat = new THREE.MeshPhysicalMaterial({ color:0xffe066, roughness:0.4, metalness:0.05, clearcoat:0.5 });
      const glove = new THREE.Mesh(sphere(0.12, 16, 12), gloveMat);
      glove.position.y = -0.40;
      glove.castShadow = true;
      lowerArmGroup.add(glove);
    }

    return { shoulder, upperArmGroup, elbow, lowerArmGroup };
  }

  const leftArm = createArm(-1);
  const rightArm = createArm(1);

  // legs - high poly with muscles
  function createLeg(side) {
    const hipJoint = new THREE.Group();
    hipJoint.position.set(side*0.15, -0.06, 0);
    hips.add(hipJoint);
    const joint = whiteJoint(0.13);
    hipJoint.add(joint);

    const upperLegGroup = new THREE.Group();
    hipJoint.add(upperLegGroup);

    const upperLeg = new THREE.Mesh(capsule(0.135, 0.44, 12, 12), kitMat);
    upperLeg.position.y = -0.26;
    upperLeg.castShadow = true;
    upperLeg.receiveShadow = true;
    upperLegGroup.add(upperLeg);

    const knee = new THREE.Group();
    knee.position.y = -0.50;
    upperLegGroup.add(knee);
    const kneeJoint = whiteJoint(0.12);
    knee.add(kneeJoint);

    const lowerLegGroup = new THREE.Group();
    knee.add(lowerLegGroup);

    const lowerLeg = new THREE.Mesh(capsule(0.115, 0.42, 12, 12), kitMat);
    lowerLeg.position.y = -0.24;
    lowerLeg.castShadow = true;
    lowerLeg.receiveShadow = true;
    lowerLegGroup.add(lowerLeg);

    const footGroup = new THREE.Group();
    footGroup.position.y = -0.47;
    lowerLegGroup.add(footGroup);

    // high detail boots
    const footColors = [0xff3a6a, 0x3a9eff, 0xffd93a, 0xffffff, 0x3aff7a, 0xff8a3a];
    const footColor = footColors[(variant + (side===1?2:0)) % footColors.length];
    const bootMat = new THREE.MeshPhysicalMaterial({ color:footColor, roughness:0.35, metalness:0.15, clearcoat:0.7, clearcoatRoughness:0.25 });
    const footGeo = new THREE.BoxGeometry(0.18, 0.13, 0.32, 2, 1, 2);
    // bevel via subdivision? keep box
    const foot = new THREE.Mesh(footGeo, bootMat);
    foot.position.set(0, -0.02, 0.10);
    foot.castShadow = true;
    foot.receiveShadow = true;
    footGroup.add(foot);

    // sole with studs
    const soleMat = new THREE.MeshPhysicalMaterial({ color:0xffffff, roughness:0.6, metalness:0.05 });
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.04, 0.34), soleMat);
    sole.position.set(0, -0.09, 0.10);
    sole.receiveShadow = true;
    footGroup.add(sole);
    // studs
    const studGeo = new THREE.CylinderGeometry(0.018, 0.022, 0.04, 8);
    const studMat = mat(0x222222, 0.4, 0.2);
    for(let sx of [-0.06,0.06]) for(let sz of [-0.12, -0.02, 0.08, 0.14]) {
      const stud = new THREE.Mesh(studGeo, studMat);
      stud.position.set(sx, -0.12, 0.10+sz);
      footGroup.add(stud);
    }
    // laces
    const lace = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.14), mat(0xffffff, 0.8, 0));
    lace.position.set(0, 0.04, 0.12);
    footGroup.add(lace);

    return { hipJoint, upperLegGroup, knee, lowerLegGroup, footGroup, foot };
  }

  const leftLeg = createLeg(-1);
  const rightLeg = createLeg(1);

  // ultra shadow - soft PCF with two layers
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const sctx = shadowCanvas.getContext('2d');
  const grad = sctx.createRadialGradient(64,64,8,64,64,56);
  grad.addColorStop(0, 'rgba(0,0,0,0.45)');
  grad.addColorStop(0.4, 'rgba(0,0,0,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0,0,128,128);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  shadowTex.anisotropy = 4;
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity:0.85 });
  const shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), shadowMat);
  shadowMesh.rotation.x = -Math.PI/2;
  shadowMesh.position.y = 0.015;
  shadowMesh.receiveShadow = true;
  root.add(shadowMesh);

  // second smaller sharp shadow for ultra
  const shadowMesh2 = new THREE.Mesh(new THREE.PlaneGeometry(0.7,0.7), new THREE.MeshBasicMaterial({ map: shadowTex, transparent:true, depthWrite:false, opacity:0.5 }));
  shadowMesh2.rotation.x = -Math.PI/2;
  shadowMesh2.position.y = 0.016;
  root.add(shadowMesh2);

  root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; } });

  const state = {
    root, hips, torsoGroup, headGroup,
    leftArm, rightArm, leftLeg, rightLeg,
    shadowMesh, shadowMesh2,
    kitColor,
    isGoalkeeper,
    update: null,
  };

  state.update = (player, dt, time) => {
    const { x, z, angle, state: pState, runCycle, wobbleX, wobbleZ, stateTimer } = player;
    root.position.set(x, 0, z);
    root.rotation.y = angle;

    hips.rotation.x = wobbleX * 0.55;
    hips.rotation.z = wobbleZ * 0.55;
    hips.position.y = 0.94 + Math.sin(runCycle*2)*0.05 * (pState==='run'?1:0.22) + wobbleZ*0.12;

    torsoGroup.rotation.x = 0; torsoGroup.rotation.z = 0; torsoGroup.rotation.y = 0;
    leftArm.shoulder.rotation.set(0,0,0);
    rightArm.shoulder.rotation.set(0,0,0);
    leftArm.elbow.rotation.x = 0; rightArm.elbow.rotation.x = 0;
    leftLeg.hipJoint.rotation.x = 0; rightLeg.hipJoint.rotation.x = 0;
    leftLeg.knee.rotation.x = 0; rightLeg.knee.rotation.x = 0;
    leftLeg.hipJoint.rotation.y = 0; rightLeg.hipJoint.rotation.y = 0;
    leftLeg.hipJoint.rotation.z = 0; rightLeg.hipJoint.rotation.z = 0;

    if (pState === 'run') {
      const swing = Math.sin(runCycle);
      const swing2 = Math.sin(runCycle + Math.PI);
      leftLeg.hipJoint.rotation.x = swing * 0.75;
      rightLeg.hipJoint.rotation.x = swing2 * 0.75;
      leftLeg.knee.rotation.x = Math.max(0, -swing*1.0);
      rightLeg.knee.rotation.x = Math.max(0, -swing2*1.0);
      leftArm.shoulder.rotation.x = swing2 * 0.65;
      rightArm.shoulder.rotation.x = swing * 0.65;
      leftArm.elbow.rotation.x = -0.65;
      rightArm.elbow.rotation.x = -0.65;
      torsoGroup.rotation.x = 0.18;
      torsoGroup.rotation.z = Math.sin(runCycle)*0.10;
      headGroup.rotation.x = -0.12;
      headGroup.rotation.y = Math.sin(runCycle*0.5)*0.12;
    } else if (pState === 'idle') {
      const idleSway = Math.sin(time*0.7 + variant)*0.09;
      torsoGroup.rotation.z = idleSway;
      leftArm.shoulder.rotation.x = -0.18 + Math.sin(time*0.55)*0.12;
      rightArm.shoulder.rotation.x = -0.18 + Math.sin(time*0.55+1.2)*0.12;
      leftArm.elbow.rotation.x = -0.35;
      rightArm.elbow.rotation.x = -0.35;
      headGroup.rotation.y = Math.sin(time*0.45 + variant)*0.28;
      headGroup.rotation.x = Math.sin(time*0.35)*0.06;
    } else if (pState === 'kick') {
      const t = 1 - (stateTimer / 0.35);
      const kickPhase = Math.sin(t * Math.PI);
      rightLeg.hipJoint.rotation.x = -0.85 + kickPhase*1.95;
      rightLeg.knee.rotation.x = -0.25 + kickPhase*0.9;
      leftLeg.hipJoint.rotation.x = -0.22;
      torsoGroup.rotation.x = -0.28 * kickPhase;
      torsoGroup.rotation.z = -0.18 * kickPhase;
      leftArm.shoulder.rotation.x = -0.55;
      rightArm.shoulder.rotation.x = 0.85;
      leftArm.shoulder.rotation.z = -0.35;
      headGroup.rotation.x = -0.15 * kickPhase;
    } else if (pState === 'rabona') {
      const t = 1 - (stateTimer / 0.55);
      const phase = t < 0.5 ? t*2 : 2 - t*2;
      const dir = t < 0.5 ? 1 : -1;
      rightLeg.hipJoint.rotation.x = -0.65 + phase*1.3;
      rightLeg.hipJoint.rotation.y = phase * 1.0;
      rightLeg.hipJoint.rotation.z = phase * 0.6;
      rightLeg.knee.rotation.x = -0.35 + phase*0.6;
      leftLeg.hipJoint.rotation.x = -0.18;
      torsoGroup.rotation.y = phase * 0.7 * dir;
      torsoGroup.rotation.x = -0.24;
      torsoGroup.rotation.z = phase * 0.45;
      leftArm.shoulder.rotation.x = -0.9;
      rightArm.shoulder.rotation.x = 1.0;
      headGroup.rotation.y = phase * -0.6;
    } else if (pState === 'slide') {
      const t = 1 - (stateTimer / 0.8);
      hips.rotation.x = -1.25 * t;
      hips.position.y = 0.94 - t*0.72;
      leftLeg.hipJoint.rotation.x = -0.22 + t*0.55;
      rightLeg.hipJoint.rotation.x = -0.22 + t*0.55;
      torsoGroup.rotation.x = -0.55 * t;
      leftArm.shoulder.rotation.x = 0.65;
      rightArm.shoulder.rotation.x = 0.65;
    } else if (pState === 'fall') {
      const t = 1 - (stateTimer / 0.9);
      hips.rotation.x = -1.45 * t;
      hips.rotation.z = Math.sin(t*6.5)*0.32 * (1-t);
      hips.position.y = 0.94 - t*0.78;
      torsoGroup.rotation.x = -0.85 * t;
      leftLeg.hipJoint.rotation.x = Math.sin(t*8.5)*0.55;
      rightLeg.hipJoint.rotation.x = Math.sin(t*8.5+1.1)*0.55;
      leftArm.shoulder.rotation.x = Math.sin(t*7.2)*0.85;
      rightArm.shoulder.rotation.x = Math.sin(t*7.2+1)*0.85;
    } else if (pState === 'getup') {
      const t = 1 - (stateTimer / 0.7);
      hips.position.y = 0.18 + t*0.76;
      hips.rotation.x = -1.25 * (1-t);
      torsoGroup.rotation.x = -0.55 * (1-t);
    } else if (pState === 'celebrate') {
      const t = time*3.2;
      hips.position.y = 0.94 + Math.abs(Math.sin(t))*0.28;
      leftArm.shoulder.rotation.x = -1.3 + Math.sin(t)*0.32;
      rightArm.shoulder.rotation.x = -1.3 + Math.sin(t+1.1)*0.32;
      leftArm.shoulder.rotation.z = -0.32;
      rightArm.shoulder.rotation.z = 0.32;
      torsoGroup.rotation.y = Math.sin(t*0.55)*0.32;
    }

    const h = hips.position.y;
    const scale = Math.max(0.45, 1 - h*0.16);
    shadowMesh.scale.setScalar(scale*1.15);
    shadowMesh.material.opacity = Math.max(0.18, 0.62 - h*0.32);
    shadowMesh2.scale.setScalar(scale*0.6);
    shadowMesh2.material.opacity = Math.max(0.12, 0.45 - h*0.28);
  };

  return state;
}

export function createBall() {
  const group = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(BALL_RADIUS, 4); // ultra high poly

  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f0d24a';
  ctx.fillRect(0,0,1024,512);
  // add fabric texture
  for(let i=0;i<20000;i++){
    ctx.fillStyle = `rgba(0,0,0,${Math.random()*0.04})`;
    ctx.fillRect(Math.random()*1024, Math.random()*512, 1, 1);
  }
  // black pentagons ultra
  ctx.fillStyle = '#101018';
  const spots = [[120,100,68],[340,160,62],[560,110,66],[780,190,60],[200,360,52],[480,340,58],[820,360,54],[650,80,48]];
  spots.forEach(([x,y,r])=>{
    ctx.beginPath();
    for(let i=0;i<5;i++){
      const ang = i/5*Math.PI*2 - Math.PI/2;
      const px = x + Math.cos(ang)*r;
      const py = y + Math.sin(ang)*r;
      if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2a2a3a';
    ctx.lineWidth = 6;
    ctx.stroke();
    // inner highlight
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(x-r*0.25, y-r*0.25, r*0.35, 0, Math.PI*2);
    ctx.fill();
  });
  // blue curved lines
  ctx.strokeStyle = '#1a2a5a';
  ctx.lineWidth = 5;
  ctx.lineCap='round';
  for(let i=0;i<3;i++){
    ctx.beginPath();
    ctx.moveTo(0, 80+i*120);
    ctx.bezierCurveTo(300, 40+i*120, 700, 180+i*80, 1024, 120+i*100);
    ctx.stroke();
  }
  // RABONA logo small
  ctx.fillStyle = '#1a1a2a';
  ctx.font = 'bold 32px Barlow, Arial';
  ctx.fillText('RABONA', 420, 40);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  // bump map for realism
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 512; bumpCanvas.height = 256;
  const bctx = bumpCanvas.getContext('2d');
  bctx.fillStyle = '#808080';
  bctx.fillRect(0,0,512,256);
  spots.forEach(([x,y,r])=>{
    const bx = x*0.5, by=y*0.5, br=r*0.5;
    const grad = bctx.createRadialGradient(bx,by,br*0.3,bx,by,br);
    grad.addColorStop(0,'#a0a0a0');
    grad.addColorStop(1,'#505050');
    bctx.fillStyle = grad;
    bctx.beginPath();
    bctx.arc(bx,by,br,0,Math.PI*2);
    bctx.fill();
  });
  const bumpTex = new THREE.CanvasTexture(bumpCanvas);

  const matBall = new THREE.MeshPhysicalMaterial({ map: tex, roughness:0.32, metalness:0.05, clearcoat:0.6, clearcoatRoughness:0.25, bumpMap:bumpTex, bumpScale:0.02 });
  const mesh = new THREE.Mesh(geo, matBall);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // ultra shadow
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const sctx = shadowCanvas.getContext('2d');
  const grad = sctx.createRadialGradient(64,64,6,64,64,56);
  grad.addColorStop(0, 'rgba(0,0,0,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0,0,128,128);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent:true, depthWrite:false });
  const shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.4,1.4), shadowMat);
  shadowMesh.rotation.x = -Math.PI/2;
  shadowMesh.position.y = 0.015;
  group.add(shadowMesh);

  return { root: group, mesh, shadowMesh };
}

export function createPitch() {
  const group = new THREE.Group();

  // ultra grass texture 1024 with detailed blades
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  // base
  ctx.fillStyle = '#3a9a4a';
  ctx.fillRect(0,0,1024,1024);
  // stripes with gradient
  for(let i=0;i<1024;i+=64){
    const isDark = (i/64)%2===0;
    const grad = ctx.createLinearGradient(0,i,0,i+64);
    if(isDark){
      grad.addColorStop(0,'#2f8a3e');
      grad.addColorStop(1,'#3a9e4e');
    } else {
      grad.addColorStop(0,'#4ab85e');
      grad.addColorStop(1,'#5ac46e');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0,i,1024,64);
  }
  // ultra grass blades noise
  for(let i=0;i<60000;i++){
    const x = Math.random()*1024, y=Math.random()*1024;
    const len = 2+Math.random()*10;
    const col = Math.random()>0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
    ctx.fillStyle = col;
    ctx.fillRect(x,y,1.5,len);
  }
  // subtle vignette
  const vign = ctx.createRadialGradient(512,512,400,512,512,750);
  vign.addColorStop(0,'rgba(0,0,0,0)');
  vign.addColorStop(1,'rgba(0,0,0,0.18)');
  ctx.fillStyle = vign;
  ctx.fillRect(0,0,1024,1024);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;

  // normal map for grass
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = 512; normalCanvas.height = 512;
  const nctx = normalCanvas.getContext('2d');
  nctx.fillStyle = '#8080ff';
  nctx.fillRect(0,0,512,512);
  for(let i=0;i<15000;i++){
    nctx.fillStyle = `rgba(${128+Math.random()*40},${128+Math.random()*40},255,0.5)`;
    nctx.fillRect(Math.random()*512, Math.random()*512, 2, 6);
  }
  const normalTex = new THREE.CanvasTexture(normalCanvas);
  normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.repeat.set(8,6);

  const groundGeo = new THREE.PlaneGeometry(92, 62, 64, 64);
  groundGeo.rotateX(-Math.PI/2);
  // slight displacement for realism
  const pos = groundGeo.attributes.position;
  const rand = seeded(1234);
  for(let i=0;i<pos.count;i++){
    const x = pos.getX(i), z=pos.getZ(i);
    if(Math.abs(x)<35 && Math.abs(z)<22) {
      pos.setY(i, (rand()-0.5)*0.04);
    }
  }
  groundGeo.computeVertexNormals();

  const groundMat = new THREE.MeshPhysicalMaterial({ map: tex, normalMap:normalTex, normalScale:new THREE.Vector2(0.6,0.6), roughness:0.85, metalness:0, clearcoat:0.05 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  ground.castShadow = false;
  group.add(ground);

  // ultra white lines with slight emissive and texture
  const lineCanvas = document.createElement('canvas');
  lineCanvas.width = 256; lineCanvas.height = 16;
  const lctx = lineCanvas.getContext('2d');
  lctx.fillStyle = '#ffffff';
  lctx.fillRect(0,0,256,16);
  for(let i=0;i<200;i++){
    lctx.fillStyle = `rgba(0,0,0,${Math.random()*0.08})`;
    lctx.fillRect(Math.random()*256, Math.random()*16, 4, 2);
  }
  const lineTex = new THREE.CanvasTexture(lineCanvas);
  lineTex.wrapS = THREE.RepeatWrapping;
  lineTex.repeat.set(4,1);
  lineTex.colorSpace = THREE.SRGBColorSpace;
  const lineMat = new THREE.MeshPhysicalMaterial({ map:lineTex, color:0xffffff, roughness:0.4, metalness:0, emissive:0x111111, emissiveIntensity:0.05 });

  function line(x,z,w,d){
    const g = new THREE.PlaneGeometry(w,d);
    g.rotateX(-Math.PI/2);
    const m = new THREE.Mesh(g, lineMat);
    m.position.set(x,0.025,z);
    m.receiveShadow = true;
    m.castShadow = false;
    group.add(m);
  }
  const PITCH_LENGTH=70, PITCH_WIDTH=44;
  const halfL=PITCH_LENGTH/2, halfW=PITCH_WIDTH/2;
  line(0,halfW,PITCH_LENGTH,0.18);
  line(0,-halfW,PITCH_LENGTH,0.18);
  line(halfL,0,0.18,PITCH_WIDTH);
  line(-halfL,0,0.18,PITCH_WIDTH);
  line(0,0,0.15,PITCH_WIDTH);
  const circleGeo = new THREE.RingGeometry(4.5,4.68,96);
  circleGeo.rotateX(-Math.PI/2);
  const circle = new THREE.Mesh(circleGeo, lineMat);
  circle.position.y=0.026;
  group.add(circle);
  line(0,0,0.55,0.55);
  const penW=16.5, penD=40.3;
  line(-halfL+penW/2,0,penW,0.15);
  line(-halfL+penW,0,0.15,penD);
  line(-halfL+11,0,0.15,18);
  line(halfL-penW/2,0,penW,0.15);
  line(halfL-penW,0,0.15,penD);
  line(halfL-11,0,0.15,18);
  const goalAreaW=5.5, goalAreaD=18.32;
  line(-halfL+goalAreaW/2,0,goalAreaW,0.15);
  line(-halfL+goalAreaW,0,0.15,goalAreaD);
  line(halfL-goalAreaW/2,0,goalAreaW,0.15);
  line(halfL-goalAreaW,0,0.15,goalAreaD);
  line(-halfL+11,0,0.4,0.4);
  line(halfL-11,0,0.4,0.4);

  // add subtle grass 3D blades via instanced mesh for ultra (only near camera area, low count for perf)
  const bladeGeo = new THREE.PlaneGeometry(0.04, 0.22);
  bladeGeo.translate(0,0.11,0);
  const bladeMat = new THREE.MeshStandardMaterial({ color:0x4ab85e, roughness:0.9, side:THREE.DoubleSide, alphaTest:0.5 });
  const blades = new THREE.InstancedMesh(bladeGeo, bladeMat, 1200);
  blades.castShadow = false;
  blades.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const bladeRand = seeded(777);
  for(let i=0;i<1200;i++){
    const x = (bladeRand()-0.5)*50;
    const z = (bladeRand()-0.5)*30;
    dummy.position.set(x,0.02,z);
    dummy.rotation.y = bladeRand()*Math.PI*2;
    dummy.rotation.x = (bladeRand()-0.5)*0.2;
    dummy.scale.setScalar(0.8+bladeRand()*0.6);
    dummy.updateMatrix();
    blades.setMatrixAt(i, dummy.matrix);
  }
  blades.instanceMatrix.needsUpdate = true;
  group.add(blades);

  return group;
}

export function createGoal(x, isLeft) {
  const group = new THREE.Group();
  group.position.set(x,0,0);
  const postMat = new THREE.MeshPhysicalMaterial({ color:0xffffff, roughness:0.25, metalness:0.15, clearcoat:0.8, clearcoatRoughness:0.2 });
  const postRadius=0.10;
  const postGeo = new THREE.CylinderGeometry(postRadius, postRadius, GOAL_HEIGHT, 24);
  const leftPost = new THREE.Mesh(postGeo, postMat);
  leftPost.position.set(0,GOAL_HEIGHT/2,-GOAL_WIDTH/2);
  leftPost.castShadow=true; leftPost.receiveShadow=true;
  group.add(leftPost);
  const rightPost = leftPost.clone();
  rightPost.position.set(0,GOAL_HEIGHT/2,GOAL_WIDTH/2);
  group.add(rightPost);
  const crossbarGeo = new THREE.CylinderGeometry(postRadius, postRadius, GOAL_WIDTH+postRadius*2, 24);
  crossbarGeo.rotateX(Math.PI/2);
  const crossbar = new THREE.Mesh(crossbarGeo, postMat);
  crossbar.position.set(0,GOAL_HEIGHT,0);
  crossbar.castShadow=true;
  group.add(crossbar);

  const depth=GOAL_DEPTH;
  const dir=isLeft?-1:1;
  const backLeft = new THREE.Mesh(postGeo, postMat);
  backLeft.position.set(dir*depth, GOAL_HEIGHT/2, -GOAL_WIDTH/2);
  group.add(backLeft);
  const backRight = new THREE.Mesh(postGeo, postMat);
  backRight.position.set(dir*depth, GOAL_HEIGHT/2, GOAL_WIDTH/2);
  group.add(backRight);
  const backCross = new THREE.Mesh(crossbarGeo, postMat);
  backCross.position.set(dir*depth, GOAL_HEIGHT, 0);
  group.add(backCross);

  // ultra net - with thickness and texture
  const netMat = new THREE.MeshStandardMaterial({ color:0xf0f0f0, roughness:0.8, metalness:0, transparent:true, opacity:0.92 });
  const netGroup = new THREE.Group();
  // create net as grid of thin cylinders for realism
  const netLineGeo = new THREE.CylinderGeometry(0.012,0.012,1,6);
  function netBeam(p1,p2){
    const dx=p2[0]-p1[0], dy=p2[1]-p1[1], dz=p2[2]-p1[2];
    const len=Math.hypot(dx,dy,dz);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.015,0.015,len,6), netMat);
    mesh.position.set((p1[0]+p2[0])/2, (p1[1]+p2[1])/2, (p1[2]+p2[2])/2);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), new THREE.Vector3(dx/len,dy/len,dz/len).normalize());
    netGroup.add(mesh);
  }
  // vertical
  for(let z=-GOAL_WIDTH/2; z<=GOAL_WIDTH/2+0.01; z+=0.28){
    netBeam([0,0,z],[dir*depth,0,z]);
    netBeam([0,GOAL_HEIGHT,z],[dir*depth,GOAL_HEIGHT,z]);
  }
  for(let y=0; y<=GOAL_HEIGHT+0.01; y+=0.28){
    netBeam([0,y,-GOAL_WIDTH/2],[0,y,GOAL_WIDTH/2]);
    netBeam([dir*depth,y,-GOAL_WIDTH/2],[dir*depth,y,GOAL_WIDTH/2]);
    netBeam([0,y,-GOAL_WIDTH/2],[dir*depth,y,-GOAL_WIDTH/2]);
    netBeam([0,y,GOAL_WIDTH/2],[dir*depth,y,GOAL_WIDTH/2]);
  }
  // diagonal for extra realism
  for(let i=0;i<8;i++){
    const y = (i/8)*GOAL_HEIGHT;
    netBeam([0,y,-GOAL_WIDTH/2],[dir*depth,y+0.15,GOAL_WIDTH/2]);
  }
  group.add(netGroup);

  // ground anchors
  const anchorMat = new THREE.MeshStandardMaterial({ color:0x333333, roughness:0.7 });
  const anchorGeo = new THREE.BoxGeometry(0.3,0.15,0.3);
  [[0,-GOAL_WIDTH/2],[0,GOAL_WIDTH/2],[dir*depth,-GOAL_WIDTH/2],[dir*depth,GOAL_WIDTH/2]].forEach(([dx,dz])=>{
    const a = new THREE.Mesh(anchorGeo, anchorMat);
    a.position.set(dx,0.05,dz);
    group.add(a);
  });

  return group;
}

export function createStadium() {
  const group = new THREE.Group();
  const rand = seeded(42);

  // ultra desert ground with displacement and detail
  const desertCanvas = document.createElement('canvas');
  desertCanvas.width = 1024; desertCanvas.height = 1024;
  const dctx = desertCanvas.getContext('2d');
  dctx.fillStyle = '#d9c39a';
  dctx.fillRect(0,0,1024,1024);
  for(let i=0;i<40000;i++){
    const x=rand()*1024, y=rand()*1024;
    const c = rand()>0.5 ? '#c9b48a' : '#e2d0a0';
    dctx.fillStyle = c;
    dctx.fillRect(x,y,2+rand()*3,2+rand()*3);
  }
  // add tire tracks
  dctx.strokeStyle = 'rgba(0,0,0,0.06)';
  dctx.lineWidth=2;
  for(let i=0;i<12;i++){
    dctx.beginPath();
    dctx.moveTo(rand()*1024, rand()*1024);
    dctx.bezierCurveTo(rand()*1024, rand()*1024, rand()*1024, rand()*1024, rand()*1024, rand()*1024);
    dctx.stroke();
  }
  const desertTex = new THREE.CanvasTexture(desertCanvas);
  desertTex.wrapS = desertTex.wrapT = THREE.RepeatWrapping;
  desertTex.repeat.set(24,24);
  desertTex.colorSpace = THREE.SRGBColorSpace;
  desertTex.anisotropy = 16;
  const desertNormalCanvas = document.createElement('canvas');
  desertNormalCanvas.width=512; desertNormalCanvas.height=512;
  const dnctx = desertNormalCanvas.getContext('2d');
  dnctx.fillStyle='#8080ff';
  dnctx.fillRect(0,0,512,512);
  for(let i=0;i<10000;i++){
    dnctx.fillStyle=`rgba(${120+rand()*40},${120+rand()*40},255,0.6)`;
    dnctx.fillRect(rand()*512, rand()*512, 3,3);
  }
  const desertNormal = new THREE.CanvasTexture(desertNormalCanvas);
  desertNormal.wrapS=desertNormal.wrapT=THREE.RepeatWrapping;
  desertNormal.repeat.set(24,24);

  const desertGeo = new THREE.PlaneGeometry(500,500,128,128);
  desertGeo.rotateX(-Math.PI/2);
  const dpos = desertGeo.attributes.position;
  for(let i=0;i<dpos.count;i++){
    const x=dpos.getX(i), z=dpos.getZ(i);
    const distFromCenter = Math.hypot(x,z);
    if(distFromCenter>40){
      dpos.setY(i, Math.sin(x*0.05)*0.6 + Math.cos(z*0.05)*0.6 + (rand()-0.5)*0.3);
    }
  }
  desertGeo.computeVertexNormals();
  const desertMat = new THREE.MeshPhysicalMaterial({ map:desertTex, normalMap:desertNormal, normalScale:new THREE.Vector2(0.8,0.8), roughness:0.95, metalness:0 });
  const desert = new THREE.Mesh(desertGeo, desertMat);
  desert.position.y=-0.25;
  desert.receiveShadow=true;
  group.add(desert);

  // ultra rocks with more detail and PBR
  for(let i=0;i<28;i++){
    const rockGeo = new THREE.IcosahedronGeometry(1.0+rand()*2.8, 1);
    const rockMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setHSL(0.08+rand()*0.05, 0.25+rand()*0.15, 0.55+rand()*0.15), roughness:0.85+rand()*0.15, metalness:0.02 });
    const rock = new THREE.Mesh(rockGeo, rockMat);
    const ang=rand()*Math.PI*2, r=48+rand()*110;
    rock.position.set(Math.cos(ang)*r, 0.2+rand()*0.5, Math.sin(ang)*r);
    rock.scale.set(1+rand()*0.8, 0.6+rand()*0.6, 1+rand()*0.8);
    rock.rotation.set(rand()*Math.PI, rand()*Math.PI, rand()*Math.PI);
    rock.castShadow=true; rock.receiveShadow=true;
    group.add(rock);
  }

  // ultra cactus with flowers
  function cactus(x,z,scale=1){
    const g=new THREE.Group();
    g.position.set(x,0,z);
    g.scale.setScalar(scale);
    const matC = new THREE.MeshPhysicalMaterial({ color:0x3a7a2a, roughness:0.75, metalness:0.02, clearcoat:0.1 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28,0.36,2.6,12), matC);
    trunk.position.y=1.3; trunk.castShadow=true; trunk.receiveShadow=true;
    g.add(trunk);
    for(let s of [-1,1]){
      if(rand()>0.25){
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.20,1.1,10), matC);
        arm.position.set(s*0.42, 1.1+rand()*0.5, 0);
        arm.rotation.z=s*0.65; arm.castShadow=true;
        g.add(arm);
        // flower
        if(rand()>0.5){
          const flower = new THREE.Mesh(sphere(0.12,12,10), new THREE.MeshPhysicalMaterial({ color:0xff4a8a, roughness:0.6, emissive:0xff1a4a, emissiveIntensity:0.15 }));
          flower.position.set(s*0.65, 1.6+rand()*0.3, 0);
          g.add(flower);
        }
      }
    }
    group.add(g);
  }
  cactus(40,30,1.3); cactus(-44,33,1.1); cactus(47,-28,1.4); cactus(-48,-31,1.2); cactus(52,12,1.0); cactus(-54,-10,1.1); cactus(60,-5,0.9); cactus(-60,18,1.0);

  // ultra stands with crowd
  function standsRow(z, xStart, xEnd, rows, colorSet) {
    const colors=colorSet;
    for(let r=0;r<rows;r++){
      const y=0.7+r*0.92;
      const zOff=z+(z>0?1:-1)*r*0.96;
      const count=28;
      for(let i=0;i<count;i++){
        const x=xStart+(xEnd-xStart)*i/count;
        const col=colors[Math.floor(rand()*colors.length)];
        // rounded seat via box with bevel
        const seatGeo = new THREE.BoxGeometry(0.95,0.72,0.95,2,2,2);
        const seatMat = new THREE.MeshPhysicalMaterial({ color:col, roughness:0.55, metalness:0.08, clearcoat:0.3, clearcoatRoughness:0.5 });
        const cube=new THREE.Mesh(seatGeo, seatMat);
        cube.position.set(x,y,zOff);
        cube.castShadow=true; cube.receiveShadow=true;
        group.add(cube);
        if(rand()>0.62){
          const decoCanvas=document.createElement('canvas');
          decoCanvas.width=128; decoCanvas.height=128;
          const ctx=decoCanvas.getContext('2d');
          ctx.fillStyle='rgba(255,255,255,0.95)';
          ctx.font='bold 72px Arial';
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText(rand()>0.5?'★':'✿',64,72);
          const tex=new THREE.CanvasTexture(decoCanvas);
          tex.colorSpace=THREE.SRGBColorSpace;
          const plane=new THREE.Mesh(new THREE.PlaneGeometry(0.62,0.62), new THREE.MeshBasicMaterial({ map:tex, transparent:true }));
          plane.position.set(0,0,0.48);
          cube.add(plane);
        }
      }
    }
  }
  const redWhite=[0xe8a0a0,0xffffff,0xd86a6a,0xf5d0d0,0xc94a4a];
  const blueWhite=[0x8aa0ff,0xffffff,0x6a7ad8,0xd0d8ff,0x4a5ac9];
  const mix1=[0xe8a0a0,0x8aa0ff,0xffffff,0xffd0a0,0x8affa0];
  standsRow(30,-42,42,7,redWhite);
  standsRow(-30,-42,42,7,blueWhite);
  standsRow(0,54,54,5,mix1);
  standsRow(0,-54,-54,5,mix1);

  // crowd instanced - ultra
  const crowdGeo = new THREE.CapsuleGeometry(0.18,0.45,4,8);
  const crowdMat = new THREE.MeshStandardMaterial({ roughness:0.8 });
  const crowdCount = 220;
  const crowdMesh = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdCount);
  crowdMesh.castShadow=false; crowdMesh.receiveShadow=true;
  const dummy = new THREE.Object3D();
  const crowdColors = [0xff6a6a,0x6a8aff,0xffe06a,0x6aff8a,0xffffff,0xff8ad0];
  for(let i=0;i<crowdCount;i++){
    const side = i%2===0?1:-1;
    const x = (rand()-0.5)*70;
    const y = 1.2 + Math.floor(rand()*6)*0.92 + 0.45;
    const z = 30*side + side*rand()*6;
    dummy.position.set(x,y,z);
    dummy.rotation.y = side>0? Math.PI : 0;
    dummy.scale.setScalar(0.8+rand()*0.3);
    dummy.updateMatrix();
    crowdMesh.setMatrixAt(i, dummy.matrix);
    crowdMesh.setColorAt(i, new THREE.Color(crowdColors[Math.floor(rand()*crowdColors.length)]));
  }
  crowdMesh.instanceMatrix.needsUpdate=true;
  if(crowdMesh.instanceColor) crowdMesh.instanceColor.needsUpdate=true;
  group.add(crowdMesh);

  // concrete base with PBR
  const baseMat = new THREE.MeshPhysicalMaterial({ color:0xd0d0d0, roughness:0.75, metalness:0.05 });
  const base1=new THREE.Mesh(new THREE.BoxGeometry(86,1.4,10), baseMat);
  base1.position.set(0,0.25,34); base1.receiveShadow=true; base1.castShadow=true;
  group.add(base1);
  const base2=base1.clone(); base2.position.set(0,0.25,-34); group.add(base2);
  const sideBase1=new THREE.Mesh(new THREE.BoxGeometry(10,1.4,68), baseMat);
  sideBase1.position.set(54,0.25,0); group.add(sideBase1);
  const sideBase2=sideBase1.clone(); sideBase2.position.set(-54,0.25,0); group.add(sideBase2);

  // ultra floodlights with volumetric beams
  function floodlight(x,z){
    const poleMat = new THREE.MeshPhysicalMaterial({ color:0x2a2a2a, roughness:0.4, metalness:0.6 });
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.18,16,12), poleMat);
    pole.position.set(x,8,z); pole.castShadow=true;
    group.add(pole);
    const headMat = new THREE.MeshPhysicalMaterial({ color:0x1a1a1a, roughness:0.3, metalness:0.8 });
    const head=new THREE.Mesh(new THREE.BoxGeometry(2.0,1.1,0.5), headMat);
    head.position.set(x,16.2,z); head.castShadow=true;
    group.add(head);
    // light
    const light=new THREE.SpotLight(0xffffff, 120, 80, Math.PI/6, 0.35, 1.2);
    light.position.set(x,15.5,z);
    light.target.position.set(0,0,0);
    light.castShadow=true;
    light.shadow.mapSize.set(1024,1024);
    light.shadow.bias=-0.0002;
    group.add(light); group.add(light.target);
    // beam visual
    const beamGeo=new THREE.CylinderGeometry(0.15,3.5,16,8,1,true);
    const beamMat=new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:0.06, side:THREE.DoubleSide, depthWrite:false });
    const beam=new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(x*0.5,7.5,z*0.5);
    beam.lookAt(0,0,0);
    group.add(beam);
  }
  floodlight(36,24); floodlight(-36,24); floodlight(36,-24); floodlight(-36,-24);

  // ultra billboards with emissive and high res
  function billboard(x,z,rot){
    const g=new THREE.Group();
    g.position.set(x,3.0,z); g.rotation.y=rot;
    const boardGeo=new THREE.PlaneGeometry(14,2.6,2,2);
    const canvas=document.createElement('canvas');
    canvas.width=1024; canvas.height=192;
    const ctx=canvas.getContext('2d');
    // gradient background
    const grad=ctx.createLinearGradient(0,0,1024,0);
    grad.addColorStop(0,'#ff3a6a'); grad.addColorStop(0.2,'#1a2a5a'); grad.addColorStop(0.5,'#1a2a5a'); grad.addColorStop(0.8,'#1a2a5a'); grad.addColorStop(1,'#3aff8a');
    ctx.fillStyle=grad; ctx.fillRect(0,0,1024,192);
    // pattern
    ctx.fillStyle='rgba(255,255,255,0.08)';
    for(let i=0;i<1024;i+=24){ ctx.fillRect(i,0,12,192); }
    ctx.fillStyle='#ffffff';
    ctx.font='900 96px Barlow, Arial';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('RABONA',512,104);
    // glow
    ctx.shadowColor='#ffffff'; ctx.shadowBlur=18;
    ctx.fillText('RABONA',512,104);
    const tex=new THREE.CanvasTexture(canvas);
    tex.colorSpace=THREE.SRGBColorSpace; tex.anisotropy=16;
    const matB=new THREE.MeshPhysicalMaterial({ map:tex, roughness:0.45, metalness:0.1, emissive:0xffffff, emissiveMap:tex, emissiveIntensity:0.18, clearcoat:0.4 });
    const board=new THREE.Mesh(boardGeo, matB);
    board.castShadow=true; board.receiveShadow=true;
    g.add(board);
    const legMat=new THREE.MeshPhysicalMaterial({ color:0x444444, roughness:0.6, metalness:0.5 });
    const leg1=new THREE.Mesh(new THREE.BoxGeometry(0.18,3.6,0.18), legMat);
    leg1.position.set(-6,-2.0,0); leg1.castShadow=true; g.add(leg1);
    const leg2=leg1.clone(); leg2.position.set(6,-2.0,0); g.add(leg2);
    group.add(g);
  }
  billboard(0,38,0); billboard(0,-38,Math.PI); billboard(48,0,-Math.PI/2); billboard(-48,0,Math.PI/2);

  // big RABONA hill sign ultra
  const bigBoardCanvas=document.createElement('canvas');
  bigBoardCanvas.width=1024; bigBoardCanvas.height=256;
  const bctx=bigBoardCanvas.getContext('2d');
  bctx.fillStyle='#ffffff'; bctx.fillRect(0,0,1024,256);
  bctx.fillStyle='#ff1a4a';
  bctx.font='900 132px Barlow, Arial'; bctx.textAlign='center'; bctx.fillText('RABONA',512,160);
  bctx.strokeStyle='#1a1a1a'; bctx.lineWidth=4; bctx.strokeText('RABONA',512,160);
  const bigTex=new THREE.CanvasTexture(bigBoardCanvas);
  bigTex.colorSpace=THREE.SRGBColorSpace; bigTex.anisotropy=16;
  const bigBoard=new THREE.Mesh(new THREE.PlaneGeometry(18,4.5), new THREE.MeshPhysicalMaterial({ map:bigTex, roughness:0.5, metalness:0.05, emissive:bigTex, emissiveIntensity:0.08 }));
  bigBoard.position.set(0,10,-56); bigBoard.castShadow=true;
  group.add(bigBoard);

  // ultra scoreboard with emissive and bloom
  const scoreCanvas=document.createElement('canvas');
  scoreCanvas.width=512; scoreCanvas.height=256;
  const sctx=scoreCanvas.getContext('2d');
  sctx.fillStyle='#0a0a0a'; sctx.fillRect(0,0,512,256);
  sctx.fillStyle='#ff2222'; sctx.shadowColor='#ff2222'; sctx.shadowBlur=18; sctx.font='900 96px monospace'; sctx.textAlign='center'; sctx.fillText('00',128,150);
  sctx.fillStyle='#2222ff'; sctx.shadowColor='#2222ff'; sctx.fillText('00',384,150);
  sctx.shadowBlur=0; sctx.fillStyle='#ffdd55'; sctx.font='24px monospace'; sctx.fillText('01:30',256,220);
  const scoreTex=new THREE.CanvasTexture(scoreCanvas);
  scoreTex.colorSpace=THREE.SRGBColorSpace;
  const scoreBoard=new THREE.Mesh(new THREE.PlaneGeometry(8,4), new THREE.MeshPhysicalMaterial({ map:scoreTex, emissive:scoreTex, emissiveIntensity:0.9, roughness:0.3 }));
  scoreBoard.position.set(0,11,52); scoreBoard.rotation.y=Math.PI; scoreBoard.castShadow=true;
  group.add(scoreBoard);

  return { group, scoreTex, scoreCanvas, sctx };
}
