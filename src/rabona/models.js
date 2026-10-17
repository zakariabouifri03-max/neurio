import * as THREE from 'three';
import { GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH, BALL_RADIUS, TEAMS, GK_COLOR, seeded } from './rules.js';

const materials = new Map();
function mat(color, roughness=0.7, metalness=0.05) {
  const key = `${color}-${roughness}-${metalness}`;
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  return materials.get(key);
}
function capsule(radius, height) {
  return new THREE.CapsuleGeometry(radius, height, 4, 10);
}
function sphere(radius) {
  return new THREE.SphereGeometry(radius, 16, 12);
}
function whiteJoint(radius=0.11) {
  return new THREE.Mesh(sphere(radius), mat(0xffffff, 0.5, 0.1));
}

// Wobbly player
export function createWobblyPlayer(teamId, isGoalkeeper=false, variant=0) {
  const team = TEAMS[teamId.toUpperCase()] || TEAMS.BLUE;
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);

  const kitColor = isGoalkeeper ? GK_COLOR : team.kit;
  const skin = 0xf5d6b8;
  const white = 0xffffff;

  // torso
  const torsoGroup = new THREE.Group();
  torsoGroup.position.y = 0.38;
  hips.add(torsoGroup);

  const torsoGeo = capsule(0.22, 0.52);
  const torsoMesh = new THREE.Mesh(torsoGeo, mat(kitColor, 0.65, 0.05));
  torsoMesh.castShadow = true;
  torsoMesh.receiveShadow = true;
  torsoGroup.add(torsoMesh);

  // belly stripe
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.12, 12), mat(white, 0.6, 0.05));
  stripe.position.y = -0.08;
  torsoGroup.add(stripe);

  // head
  const headGroup = new THREE.Group();
  headGroup.position.y = 0.52;
  torsoGroup.add(headGroup);

  const headMesh = new THREE.Mesh(sphere(0.26), mat(0xffffff, 0.4, 0.02));
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  // face simple eyes
  const eyeMat = mat(0x222222, 0.9, 0);
  const leftEye = new THREE.Mesh(sphere(0.035), eyeMat);
  leftEye.position.set(-0.09, 0.02, 0.20);
  headGroup.add(leftEye);
  const rightEye = new THREE.Mesh(sphere(0.035), eyeMat);
  rightEye.position.set(0.09, 0.02, 0.20);
  headGroup.add(rightEye);

  // hair - stylized
  const hairColors = [0x2b2b2b, 0x5a3a22, 0xd8b65c, 0xff8ab0, 0x444444];
  const hairColor = hairColors[variant % hairColors.length];
  const hairGeo = new THREE.SphereGeometry(0.28, 14, 10, 0, Math.PI*2, 0, Math.PI*0.62);
  const hairMesh = new THREE.Mesh(hairGeo, mat(hairColor, 0.8, 0));
  hairMesh.position.y = 0.12;
  hairMesh.rotation.x = -0.2;
  hairMesh.castShadow = true;
  headGroup.add(hairMesh);

  // add some hair tuft for style
  if (variant % 2 === 0) {
    const tuft = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.18, 3, 6), mat(hairColor, 0.8, 0));
    tuft.position.set(0, 0.28, -0.05);
    tuft.rotation.x = 0.5;
    headGroup.add(tuft);
  }

  // arms
  function createArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.31, 0.22, 0);
    torsoGroup.add(shoulder);
    const joint = whiteJoint(0.11);
    shoulder.add(joint);

    const upperArmGroup = new THREE.Group();
    upperArmGroup.position.y = -0.06;
    shoulder.add(upperArmGroup);

    const upperArm = new THREE.Mesh(capsule(0.09, 0.34), mat(kitColor, 0.65, 0.05));
    upperArm.position.y = -0.19;
    upperArm.castShadow = true;
    upperArmGroup.add(upperArm);

    const elbow = new THREE.Group();
    elbow.position.y = -0.38;
    upperArmGroup.add(elbow);
    const elbowJoint = whiteJoint(0.095);
    elbow.add(elbowJoint);

    const lowerArmGroup = new THREE.Group();
    elbow.add(lowerArmGroup);

    const lowerArm = new THREE.Mesh(capsule(0.08, 0.30), mat(kitColor, 0.65, 0.05));
    lowerArm.position.y = -0.17;
    lowerArm.castShadow = true;
    lowerArmGroup.add(lowerArm);

    const hand = new THREE.Mesh(sphere(0.09), mat(white, 0.6, 0.05));
    hand.position.y = -0.36;
    hand.castShadow = true;
    lowerArmGroup.add(hand);

    // glove for keeper
    if (isGoalkeeper) {
      const glove = new THREE.Mesh(sphere(0.11), mat(0xffffff, 0.5, 0.1));
      glove.position.y = -0.38;
      lowerArmGroup.add(glove);
    }

    return { shoulder, upperArmGroup, elbow, lowerArmGroup };
  }

  const leftArm = createArm(-1);
  const rightArm = createArm(1);

  // legs
  function createLeg(side) {
    const hipJoint = new THREE.Group();
    hipJoint.position.set(side * 0.14, -0.05, 0);
    hips.add(hipJoint);
    const joint = whiteJoint(0.12);
    hipJoint.add(joint);

    const upperLegGroup = new THREE.Group();
    hipJoint.add(upperLegGroup);

    const upperLeg = new THREE.Mesh(capsule(0.12, 0.40), mat(kitColor, 0.65, 0.05));
    upperLeg.position.y = -0.24;
    upperLeg.castShadow = true;
    upperLegGroup.add(upperLeg);

    const knee = new THREE.Group();
    knee.position.y = -0.46;
    upperLegGroup.add(knee);
    const kneeJoint = whiteJoint(0.11);
    knee.add(kneeJoint);

    const lowerLegGroup = new THREE.Group();
    knee.add(lowerLegGroup);

    const lowerLeg = new THREE.Mesh(capsule(0.105, 0.38), mat(kitColor, 0.65, 0.05));
    lowerLeg.position.y = -0.22;
    lowerLeg.castShadow = true;
    lowerLegGroup.add(lowerLeg);

    const footGroup = new THREE.Group();
    footGroup.position.y = -0.44;
    lowerLegGroup.add(footGroup);

    const footGeo = new THREE.BoxGeometry(0.16, 0.11, 0.28);
    const footMat = mat(side === -1 ? 0xff6b6b : 0x6bff8a, 0.6, 0.1);
    // alternate foot colors like reference: pink, yellow, white
    const footColors = [0xff6b8a, 0x6be0ff, 0xffe86b, 0xffffff, 0x8aff6b];
    const footColor = footColors[(variant + (side===1?2:0)) % footColors.length];
    footMat.color.setHex(footColor);
    const foot = new THREE.Mesh(footGeo, footMat);
    foot.position.set(0, -0.02, 0.08);
    foot.castShadow = true;
    footGroup.add(foot);

    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.03, 0.29), mat(0xffffff, 0.7, 0));
    sole.position.set(0, -0.08, 0.08);
    footGroup.add(sole);

    return { hipJoint, upperLegGroup, knee, lowerLegGroup, footGroup, foot };
  }

  const leftLeg = createLeg(-1);
  const rightLeg = createLeg(1);

  // shadow
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 64;
  const sctx = shadowCanvas.getContext('2d');
  const grad = sctx.createRadialGradient(32,32,5,32,32,28);
  grad.addColorStop(0, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0,0,64,64);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), shadowMat);
  shadowMesh.rotation.x = -Math.PI/2;
  shadowMesh.position.y = 0.02;
  root.add(shadowMesh);

  root.traverse(o => { if (o.isMesh) o.frustumCulled = false; });

  // animation state
  const state = {
    root, hips, torsoGroup, headGroup,
    leftArm, rightArm, leftLeg, rightLeg,
    shadowMesh,
    kitColor,
    isGoalkeeper,
    update: null, // will be set
  };

  // animation function
  state.update = (player, dt, time) => {
    const { x, z, angle, state: pState, runCycle, wobbleX, wobbleZ, stateTimer } = player;
    root.position.set(x, 0, z);
    root.rotation.y = angle;

    // wobble
    hips.rotation.x = wobbleX * 0.5;
    hips.rotation.z = wobbleZ * 0.5;
    hips.position.y = 0.92 + Math.sin(runCycle*2)*0.04 * (pState==='run'?1:0.2) + wobbleZ*0.1;

    torsoGroup.rotation.x = 0;
    torsoGroup.rotation.z = 0;
    torsoGroup.rotation.y = 0;

    // default arm/leg rotations
    leftArm.shoulder.rotation.x = 0;
    leftArm.shoulder.rotation.z = 0;
    rightArm.shoulder.rotation.x = 0;
    rightArm.shoulder.rotation.z = 0;
    leftArm.elbow.rotation.x = 0;
    rightArm.elbow.rotation.x = 0;
    leftLeg.hipJoint.rotation.x = 0;
    rightLeg.hipJoint.rotation.x = 0;
    leftLeg.knee.rotation.x = 0;
    rightLeg.knee.rotation.x = 0;

    if (pState === 'run') {
      const swing = Math.sin(runCycle);
      const swing2 = Math.sin(runCycle + Math.PI);
      leftLeg.hipJoint.rotation.x = swing * 0.7;
      rightLeg.hipJoint.rotation.x = swing2 * 0.7;
      leftLeg.knee.rotation.x = Math.max(0, -swing*0.9);
      rightLeg.knee.rotation.x = Math.max(0, -swing2*0.9);
      leftArm.shoulder.rotation.x = swing2 * 0.6;
      rightArm.shoulder.rotation.x = swing * 0.6;
      leftArm.elbow.rotation.x = -0.6;
      rightArm.elbow.rotation.x = -0.6;
      torsoGroup.rotation.x = 0.15;
      torsoGroup.rotation.z = Math.sin(runCycle)*0.08;
      headGroup.rotation.x = -0.1;
    } else if (pState === 'idle') {
      const idleSway = Math.sin(time*0.8 + variant)*0.08;
      torsoGroup.rotation.z = idleSway;
      leftArm.shoulder.rotation.x = -0.15 + Math.sin(time*0.6)*0.1;
      rightArm.shoulder.rotation.x = -0.15 + Math.sin(time*0.6+1)*0.1;
      leftArm.elbow.rotation.x = -0.3;
      rightArm.elbow.rotation.x = -0.3;
      headGroup.rotation.y = Math.sin(time*0.5 + variant)*0.25;
    } else if (pState === 'kick') {
      const t = 1 - (stateTimer / 0.35); // 0..1
      const kickPhase = Math.sin(t * Math.PI);
      // kicking leg = right leg (dominant)
      rightLeg.hipJoint.rotation.x = -0.8 + kickPhase*1.8;
      rightLeg.knee.rotation.x = -0.2 + kickPhase*0.8;
      leftLeg.hipJoint.rotation.x = -0.2;
      torsoGroup.rotation.x = -0.25 * kickPhase;
      torsoGroup.rotation.z = -0.15 * kickPhase;
      leftArm.shoulder.rotation.x = -0.5;
      rightArm.shoulder.rotation.x = 0.8;
      leftArm.shoulder.rotation.z = -0.3;
    } else if (pState === 'rabona') {
      const t = 1 - (stateTimer / 0.55);
      const phase = t < 0.5 ? t*2 : 2 - t*2;
      const dir = t < 0.5 ? 1 : -1;
      // rabona: right leg crosses behind left
      rightLeg.hipJoint.rotation.x = -0.6 + phase*1.2;
      rightLeg.hipJoint.rotation.y = phase * 0.9; // cross behind
      rightLeg.hipJoint.rotation.z = phase * 0.5;
      rightLeg.knee.rotation.x = -0.3 + phase*0.5;
      leftLeg.hipJoint.rotation.x = -0.15;
      torsoGroup.rotation.y = phase * 0.6 * dir;
      torsoGroup.rotation.x = -0.2;
      torsoGroup.rotation.z = phase * 0.4;
      leftArm.shoulder.rotation.x = -0.8;
      rightArm.shoulder.rotation.x = 0.9;
      headGroup.rotation.y = phase * -0.5;
    } else if (pState === 'slide') {
      const t = 1 - (stateTimer / 0.8);
      hips.rotation.x = -1.2 * t;
      hips.position.y = 0.92 - t*0.7;
      leftLeg.hipJoint.rotation.x = -0.2 + t*0.5;
      rightLeg.hipJoint.rotation.x = -0.2 + t*0.5;
      leftLeg.knee.rotation.x = -0.1;
      rightLeg.knee.rotation.x = -0.1;
      torsoGroup.rotation.x = -0.5 * t;
      leftArm.shoulder.rotation.x = 0.6;
      rightArm.shoulder.rotation.x = 0.6;
    } else if (pState === 'fall') {
      const t = 1 - (stateTimer / 0.9);
      hips.rotation.x = -1.4 * t;
      hips.rotation.z = Math.sin(t*6)*0.3 * (1-t);
      hips.position.y = 0.92 - t*0.75;
      torsoGroup.rotation.x = -0.8 * t;
      leftLeg.hipJoint.rotation.x = Math.sin(t*8)*0.5;
      rightLeg.hipJoint.rotation.x = Math.sin(t*8+1)*0.5;
      leftArm.shoulder.rotation.x = Math.sin(t*7)*0.8;
      rightArm.shoulder.rotation.x = Math.sin(t*7+1)*0.8;
    } else if (pState === 'getup') {
      const t = 1 - (stateTimer / 0.7);
      hips.position.y = 0.17 + t*0.75;
      hips.rotation.x = -1.2 * (1-t);
      torsoGroup.rotation.x = -0.5 * (1-t);
    } else if (pState === 'celebrate') {
      const t = time*3;
      hips.position.y = 0.92 + Math.abs(Math.sin(t))*0.25;
      leftArm.shoulder.rotation.x = -1.2 + Math.sin(t)*0.3;
      rightArm.shoulder.rotation.x = -1.2 + Math.sin(t+1)*0.3;
      leftArm.shoulder.rotation.z = -0.3;
      rightArm.shoulder.rotation.z = 0.3;
      torsoGroup.rotation.y = Math.sin(t*0.5)*0.3;
    }

    // shadow scale based on height
    const h = hips.position.y;
    const scale = Math.max(0.4, 1 - h*0.15);
    shadowMesh.scale.setScalar(scale);
    shadowMesh.material.opacity = Math.max(0.15, 0.55 - h*0.3);
  };

  return state;
}

export function createBall() {
  const group = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(BALL_RADIUS, 2);
  // color the ball with yellow/black pattern like reference: we need vertex colors or texture
  // create canvas texture with yellow base and black pentagons
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  // yellow base with noise
  ctx.fillStyle = '#e8c84a';
  ctx.fillRect(0,0,512,256);
  // draw black shapes
  ctx.fillStyle = '#1a1a2a';
  const spots = [[80,60,45],[200,100,38],[320,60,42],[420,120,36],[150,190,30],[300,180,35]];
  spots.forEach(([x,y,r])=>{
    ctx.beginPath();
    for(let i=0;i<5;i++){
      const ang = i/5*Math.PI*2;
      const px = x + Math.cos(ang)*r;
      const py = y + Math.sin(ang)*r;
      if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2a3a5a';
    ctx.lineWidth = 4;
    ctx.stroke();
  });
  // add some blue lines
  ctx.strokeStyle = '#2a3a6a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0,0);
  ctx.lineTo(512,256);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(512,0);
  ctx.lineTo(0,256);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const matBall = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, matBall);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // shadow
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 64;
  const sctx = shadowCanvas.getContext('2d');
  const grad = sctx.createRadialGradient(32,32,5,32,32,28);
  grad.addColorStop(0, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0,0,64,64);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2,1.2), shadowMat);
  shadowMesh.rotation.x = -Math.PI/2;
  shadowMesh.position.y = 0.02;
  group.add(shadowMesh);

  return { root: group, mesh, shadowMesh };
}

export function createPitch() {
  const group = new THREE.Group();
  // grass texture with stripes
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  for(let i=0;i<512;i+=32){
    ctx.fillStyle = i%64===0 ? '#5cb36b' : '#6bc47a';
    ctx.fillRect(0,i,512,32);
  }
  // add noise
  for(let i=0;i<8000;i++){
    ctx.fillStyle = Math.random()>0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
    ctx.fillRect(Math.random()*512, Math.random()*512, 2, 8);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const groundGeo = new THREE.PlaneGeometry(90, 60);
  groundGeo.rotateX(-Math.PI/2);
  const groundMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.05 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  group.add(ground);

  // white lines
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  function line(x, z, w, d, rot=0) {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI/2);
    if(rot) g.rotateY(rot);
    const m = new THREE.Mesh(g, lineMat);
    m.position.set(x, 0.02, z);
    m.receiveShadow = true;
    group.add(m);
  }
  // outer
  const PITCH_LENGTH = 70, PITCH_WIDTH = 44;
  const halfL = PITCH_LENGTH/2, halfW = PITCH_WIDTH/2;
  // we need lines slightly above
  line(0, halfW, PITCH_LENGTH, 0.15);
  line(0, -halfW, PITCH_LENGTH, 0.15);
  line(halfL, 0, 0.15, PITCH_WIDTH);
  line(-halfL, 0, 0.15, PITCH_WIDTH);
  // center line
  line(0,0,0.12, PITCH_WIDTH);
  // center circle
  const circleGeo = new THREE.RingGeometry(4.5, 4.65, 64);
  circleGeo.rotateX(-Math.PI/2);
  const circle = new THREE.Mesh(circleGeo, lineMat);
  circle.position.y = 0.021;
  group.add(circle);
  // center spot
  line(0,0,0.5,0.5);
  // penalty areas
  const penW = 16.5, penD = 40.3;
  // left
  line(-halfL + penW/2, 0, penW, 0.12);
  line(-halfL + penW, 0, 0.12, penD);
  line(-halfL + 11, 0, 0.12, 18);
  // right
  line(halfL - penW/2, 0, penW, 0.12);
  line(halfL - penW, 0, 0.12, penD);
  line(halfL - 11, 0, 0.12, 18);
  // goal areas
  const goalAreaW = 5.5, goalAreaD = 18.32;
  line(-halfL + goalAreaW/2, 0, goalAreaW, 0.12);
  line(-halfL + goalAreaW, 0, 0.12, goalAreaD);
  line(halfL - goalAreaW/2, 0, goalAreaW, 0.12);
  line(halfL - goalAreaW, 0, 0.12, goalAreaD);
  // penalty spots
  line(-halfL + 11, 0, 0.35, 0.35);
  line(halfL - 11, 0, 0.35, 0.35);

  return group;
}

export function createGoal(x, isLeft) {
  const group = new THREE.Group();
  group.position.set(x, 0, 0);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1 });
  const postRadius = 0.08;
  // posts
  const postGeo = new THREE.CylinderGeometry(postRadius, postRadius, GOAL_HEIGHT, 12);
  const leftPost = new THREE.Mesh(postGeo, postMat);
  leftPost.position.set(0, GOAL_HEIGHT/2, -GOAL_WIDTH/2);
  leftPost.castShadow = true;
  group.add(leftPost);
  const rightPost = new THREE.Mesh(postGeo, postMat);
  rightPost.position.set(0, GOAL_HEIGHT/2, GOAL_WIDTH/2);
  rightPost.castShadow = true;
  group.add(rightPost);
  const crossbarGeo = new THREE.CylinderGeometry(postRadius, postRadius, GOAL_WIDTH + postRadius*2, 12);
  crossbarGeo.rotateX(Math.PI/2);
  const crossbar = new THREE.Mesh(crossbarGeo, postMat);
  crossbar.position.set(0, GOAL_HEIGHT, 0);
  crossbar.castShadow = true;
  group.add(crossbar);

  // net
  const netMat = new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.7 });
  const netGroup = new THREE.Group();
  // simple grid net using lines
  const depth = GOAL_DEPTH;
  const dir = isLeft ? -1 : 1;
  // back posts
  const backLeft = new THREE.Mesh(postGeo, postMat);
  backLeft.position.set(dir*depth, GOAL_HEIGHT/2, -GOAL_WIDTH/2);
  backLeft.castShadow = true;
  group.add(backLeft);
  const backRight = new THREE.Mesh(postGeo, postMat);
  backRight.position.set(dir*depth, GOAL_HEIGHT/2, GOAL_WIDTH/2);
  group.add(backRight);
  const backCross = new THREE.Mesh(crossbarGeo, postMat);
  backCross.position.set(dir*depth, GOAL_HEIGHT, 0);
  group.add(backCross);

  // create net lines
  function netLine(p1, p2) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...p1), new THREE.Vector3(...p2)]);
    const line = new THREE.Line(geo, netMat);
    netGroup.add(line);
  }
  // vertical and horizontal grid
  for(let z=-GOAL_WIDTH/2; z<=GOAL_WIDTH/2; z+=0.35){
    netLine([0,0,z],[dir*depth,0,z]);
    netLine([0,GOAL_HEIGHT,z],[dir*depth,GOAL_HEIGHT,z]);
  }
  for(let y=0; y<=GOAL_HEIGHT; y+=0.35){
    netLine([0,y,-GOAL_WIDTH/2],[0,y,GOAL_WIDTH/2]);
    netLine([dir*depth,y,-GOAL_WIDTH/2],[dir*depth,y,GOAL_WIDTH/2]);
    netLine([0,y,-GOAL_WIDTH/2],[dir*depth,y,-GOAL_WIDTH/2]);
    netLine([0,y,GOAL_WIDTH/2],[dir*depth,y,GOAL_WIDTH/2]);
  }
  group.add(netGroup);

  return group;
}

export function createStadium() {
  const group = new THREE.Group();
  const rand = seeded(42);

  // desert ground outside pitch
  const desertCanvas = document.createElement('canvas');
  desertCanvas.width = desertCanvas.height = 256;
  const dctx = desertCanvas.getContext('2d');
  dctx.fillStyle = '#d8c4a0';
  dctx.fillRect(0,0,256,256);
  for(let i=0;i<5000;i++){
    dctx.fillStyle = rand()>0.5 ? '#c9b48f' : '#e0d0a8';
    dctx.fillRect(rand()*256, rand()*256, 2, 2);
  }
  const desertTex = new THREE.CanvasTexture(desertCanvas);
  desertTex.wrapS = desertTex.wrapT = THREE.RepeatWrapping;
  desertTex.repeat.set(20,20);
  desertTex.colorSpace = THREE.SRGBColorSpace;
  const desertGeo = new THREE.PlaneGeometry(400, 400);
  desertGeo.rotateX(-Math.PI/2);
  const desertMat = new THREE.MeshStandardMaterial({ map: desertTex, roughness: 1 });
  const desert = new THREE.Mesh(desertGeo, desertMat);
  desert.position.y = -0.1;
  desert.receiveShadow = true;
  group.add(desert);

  // rocks
  for(let i=0;i<18;i++){
    const rockGeo = new THREE.IcosahedronGeometry(1.2 + rand()*2.2, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xc9a87a, roughness: 0.9 });
    const rock = new THREE.Mesh(rockGeo, rockMat);
    const ang = rand()*Math.PI*2;
    const r = 45 + rand()*80;
    rock.position.set(Math.cos(ang)*r, 0.3, Math.sin(ang)*r);
    rock.scale.set(1+rand()*0.5, 0.6+rand()*0.4, 1+rand()*0.5);
    rock.rotation.set(rand()*Math.PI, rand()*Math.PI, rand()*Math.PI);
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }

  // cactus
  function cactus(x,z,scale=1){
    const g = new THREE.Group();
    g.position.set(x,0,z);
    g.scale.setScalar(scale);
    const matC = new THREE.MeshStandardMaterial({ color: 0x5a8a3a, roughness: 0.8 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.32,2.2,8), matC);
    trunk.position.y = 1.1;
    trunk.castShadow = true;
    g.add(trunk);
    for(let s of [-1,1]){
      if(rand()>0.4){
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.18,0.9,6), matC);
        arm.position.set(s*0.35, 0.9+rand()*0.4, 0);
        arm.rotation.z = s*0.6;
        arm.castShadow = true;
        g.add(arm);
      }
    }
    group.add(g);
  }
  cactus(38, 28, 1.2);
  cactus(-42, 31, 1.0);
  cactus(45, -26, 1.3);
  cactus(-46, -29, 1.1);
  cactus(50, 10, 0.9);
  cactus(-52, -8, 1.0);

  // stands - cube seats like reference
  function standsRow(z, xStart, xEnd, rows, colorSet) {
    const colors = colorSet;
    for(let r=0;r<rows;r++){
      const y = 0.6 + r*0.85;
      const zOff = z + (z>0?1:-1)*r*0.9;
      const count = 22;
      for(let i=0;i<count;i++){
        const x = xStart + (xEnd-xStart)*i/count;
        const col = colors[Math.floor(rand()*colors.length)];
        const cube = new THREE.Mesh(new THREE.BoxGeometry(0.9,0.7,0.9), new THREE.MeshStandardMaterial({ color: col, roughness: 0.7 }));
        cube.position.set(x, y, zOff);
        cube.castShadow = true;
        cube.receiveShadow = true;
        group.add(cube);
        // add star pattern like reference on some cubes
        if(rand()>0.7){
          const decoCanvas = document.createElement('canvas');
          decoCanvas.width = 64; decoCanvas.height = 64;
          const ctx = decoCanvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.font = '40px Arial';
          ctx.textAlign='center';
          ctx.textBaseline='middle';
          ctx.fillText(rand()>0.5?'★':'✿',32,36);
          const tex = new THREE.CanvasTexture(decoCanvas);
          const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.6,0.6), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
          plane.position.set(0,0,0.46);
          cube.add(plane);
        }
      }
    }
  }

  const redWhite = [0xe8a0a0, 0xffffff, 0xd86a6a, 0xf5d0d0];
  const blueWhite = [0x8aa0ff, 0xffffff, 0x6a7ad8, 0xd0d8ff];
  const mix1 = [0xe8a0a0, 0x8aa0ff, 0xffffff, 0xffd0a0];
  standsRow(28, -38, 38, 6, redWhite);
  standsRow(-28, -38, 38, 6, blueWhite);
  standsRow(0, 50, 50, 4, mix1); // side small
  standsRow(0, -50, -50, 4, mix1);

  // concrete base for stands
  const baseMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.8 });
  const base1 = new THREE.Mesh(new THREE.BoxGeometry(80, 1.2, 8), baseMat);
  base1.position.set(0,0.2,32);
  base1.receiveShadow = true;
  group.add(base1);
  const base2 = base1.clone();
  base2.position.set(0,0.2,-32);
  group.add(base2);

  // floodlights
  function floodlight(x,z){
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.15,14,8), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    pole.position.set(x,7,z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.8,1.0,0.4), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    head.position.set(x,14.2,z);
    group.add(head);
    const light = new THREE.PointLight(0xffffff, 0.6, 40);
    light.position.set(x,13,z);
    group.add(light);
  }
  floodlight(35, 22);
  floodlight(-35, 22);
  floodlight(35, -22);
  floodlight(-35, -22);

  // billboards RABONA
  function billboard(x,z,rot){
    const g = new THREE.Group();
    g.position.set(x,2.5,z);
    g.rotation.y = rot;
    const boardGeo = new THREE.PlaneGeometry(12, 2.2);
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a2a4a';
    ctx.fillRect(0,0,512,96);
    // colorful pattern sides
    ctx.fillStyle = '#ff4a6a';
    ctx.beginPath();
    ctx.moveTo(0,0); ctx.lineTo(80,0); ctx.lineTo(40,96); ctx.lineTo(0,96); ctx.fill();
    ctx.fillStyle = '#4aff8a';
    ctx.beginPath();
    ctx.moveTo(432,0); ctx.lineTo(512,0); ctx.lineTo(512,96); ctx.lineTo(472,96); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 54px Barlow, Arial';
    ctx.textAlign='center';
    ctx.fillText('RABONA',256,62);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const matB = new THREE.MeshStandardMaterial({ map: tex });
    const board = new THREE.Mesh(boardGeo, matB);
    board.castShadow = true;
    g.add(board);
    const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.15,3,0.15), new THREE.MeshStandardMaterial({ color: 0x444444 }));
    leg1.position.set(-5, -1.8, 0);
    g.add(leg1);
    const leg2 = leg1.clone();
    leg2.position.set(5, -1.8, 0);
    g.add(leg2);
    group.add(g);
  }
  billboard(0, 34, 0);
  billboard(0, -34, Math.PI);
  billboard(44, 0, -Math.PI/2);
  billboard(-44, 0, Math.PI/2);

  // big RABONA sign on hill
  const bigBoardCanvas = document.createElement('canvas');
  bigBoardCanvas.width = 512; bigBoardCanvas.height = 128;
  const bctx = bigBoardCanvas.getContext('2d');
  bctx.fillStyle = '#ffffff';
  bctx.fillRect(0,0,512,128);
  bctx.fillStyle = '#ff3a4a';
  bctx.font = 'bold 72px Barlow, Arial';
  bctx.textAlign='center';
  bctx.fillText('RABONA',256,80);
  const bigTex = new THREE.CanvasTexture(bigBoardCanvas);
  bigTex.colorSpace = THREE.SRGBColorSpace;
  const bigBoard = new THREE.Mesh(new THREE.PlaneGeometry(14,3.5), new THREE.MeshStandardMaterial({ map: bigTex }));
  bigBoard.position.set(0,8,-48);
  bigBoard.rotation.y = 0;
  group.add(bigBoard);

  // scoreboard
  const scoreCanvas = document.createElement('canvas');
  scoreCanvas.width = 256; scoreCanvas.height = 128;
  const sctx = scoreCanvas.getContext('2d');
  sctx.fillStyle = '#111111';
  sctx.fillRect(0,0,256,128);
  sctx.fillStyle = '#ff4444';
  sctx.font = 'bold 48px monospace';
  sctx.fillText('00',30,70);
  sctx.fillStyle = '#4444ff';
  sctx.fillText('00',150,70);
  const scoreTex = new THREE.CanvasTexture(scoreCanvas);
  const scoreBoard = new THREE.Mesh(new THREE.PlaneGeometry(6,3), new THREE.MeshStandardMaterial({ map: scoreTex, emissive: 0x222222 }));
  scoreBoard.position.set(0,9,48);
  scoreBoard.rotation.y = Math.PI;
  group.add(scoreBoard);

  return { group, scoreTex, scoreCanvas, sctx };
}
