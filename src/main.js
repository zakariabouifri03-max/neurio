// ── VICE CARTON — GTA 6 Style Carton Anime ─────────────────────────────
// GTA 6 open world but everything is cardboard + anime cel-shading
import * as THREE from 'three';

addEventListener('error', e=>{
  const el=document.getElementById('errLog');
  el.style.display='block';
  el.textContent='⚠️ '+e.message+` ${e.filename?.split('/').pop()}:${e.lineno}`;
});
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;

// —— Textures ———
function makeCanvas(w,h,fn){
  const c=document.createElement('canvas'); c.width=w;c.height=h;
  const g=c.getContext('2d'); fn(g,w,h);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=4; return t;
}
function makeKraft(){
  return makeCanvas(512,512,(g,w,h)=>{
    g.fillStyle='#d4b48e'; g.fillRect(0,0,w,h);
    for(let i=0;i<8000;i++){
      const x=Math.random()*w, y=Math.random()*h, len=2+Math.random()*10, wid=Math.random()*0.7+0.3, a=Math.random()*Math.PI;
      g.fillStyle=`rgba(${90+Math.random()*35|0},${70+Math.random()*30|0},${45+Math.random()*20|0},${0.05+Math.random()*0.06})`;
      g.beginPath(); g.ellipse(x,y,len,wid,a,0,7); g.fill();
    }
    for(let i=0;i<2000;i++){ g.fillStyle=`rgba(0,0,0,${Math.random()*0.025})`; g.fillRect(Math.random()*w,Math.random()*h,1,1); }
  });
}
function makeCorr(){
  return makeCanvas(512,512,(g,w,h)=>{
    g.fillStyle='#c9a67a'; g.fillRect(0,0,w,h);
    const fw=w/32; for(let i=0;i<32;i++){
      const x=i*fw, grd=g.createLinearGradient(x,0,x+fw,0);
      grd.addColorStop(0,'rgba(0,0,0,.18)'); grd.addColorStop(0.3,'rgba(255,255,255,.1)'); grd.addColorStop(0.5,'rgba(0,0,0,.08)'); grd.addColorStop(1,'rgba(0,0,0,.15)');
      g.fillStyle=grd; g.fillRect(x,0,fw,h);
    }
  });
}
function makeRoad(){
  return makeCanvas(512,512,(g,w,h)=>{
    g.fillStyle='#2b2b2b'; g.fillRect(0,0,w,h);
    for(let i=0;i<600;i++){ g.fillStyle=`rgba(255,255,255,${0.02+Math.random()*0.02})`; g.fillRect(Math.random()*w,Math.random()*h, Math.random()*3+1,1); }
    g.fillStyle='#ffcc00'; g.fillRect(w/2-2,0,4,h);
    g.fillStyle='#ffffff'; g.fillRect(0,0,8,h); g.fillRect(w-8,0,8,h);
  });
}
function makeToonGradient(){
  const c=document.createElement('canvas'); c.width=256;c.height=1;
  const g=c.getContext('2d');
  for(let i=0;i<256;i++){
    const t=i/256; let v= t<0.3?0.45 : t<0.6?0.75 : 1.0;
    g.fillStyle=`rgb(${v*255|0},${v*255|0},${v*255|0})`; g.fillRect(i,0,1,1);
  }
  const tex=new THREE.CanvasTexture(c); tex.minFilter=THREE.NearestFilter; tex.magFilter=THREE.NearestFilter; return tex;
}

// —— Scene ———
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x0b0820);
scene.fog=new THREE.FogExp2(0x1a0f2e, 0.008);

const camera=new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.1, 800);
camera.position.set(0,10,18);

const renderer=new THREE.WebGLRenderer({antialias:true, powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.15;
renderer.outputColorSpace=THREE.SRGBColorSpace;
$('app').appendChild(renderer.domElement);

// Lights — Vice City sunset
scene.add(new THREE.HemisphereLight(0xffd1a8, 0x1a0f2e, 1.2));
const sun=new THREE.DirectionalLight(0xff7a00, 1.4); sun.position.set(60,40,-30); sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048); sun.shadow.camera.left=-120; sun.shadow.camera.right=120; sun.shadow.camera.top=120; sun.shadow.camera.bottom=-120; sun.shadow.camera.near=1; sun.shadow.camera.far=300; sun.shadow.bias=-0.0004;
scene.add(sun);
const neonPink=new THREE.PointLight(0xff2e90, 12, 40); neonPink.position.set(0,6,0); scene.add(neonPink);
const neonBlue=new THREE.PointLight(0x00e6ff, 10, 50); neonBlue.position.set(40,5,40); scene.add(neonBlue);
scene.add(new THREE.AmbientLight(0xffb3d9, 0.35));

// Textures / Mats
const kraftTex=makeKraft(), corrTex=makeCorr(), roadTex=makeRoad();
roadTex.repeat.set(4,4); kraftTex.repeat.set(1,1);
const toonGrad=makeToonGradient();

const matKraft=new THREE.MeshStandardMaterial({map:kraftTex, roughness:0.88, metalness:0});
const matKraftLight=new THREE.MeshStandardMaterial({map:kraftTex, color:0xffe8c8, roughness:0.9});
const matCorr=new THREE.MeshStandardMaterial({map:corrTex, roughness:0.85});
const matRoad=new THREE.MeshStandardMaterial({map:roadTex, roughness:0.9, metalness:0.05});
const matCartonToon=new THREE.MeshToonMaterial({map:kraftTex, color:0xffffff, gradientMap:toonGrad});
const matNeonPink=new THREE.MeshStandardMaterial({color:0xff2e90, emissive:0xff2e90, emissiveIntensity:1.2});
const matNeonBlue=new THREE.MeshStandardMaterial({color:0x00e6ff, emissive:0x00e6ff, emissiveIntensity:1.0});
const matNeonYellow=new THREE.MeshStandardMaterial({color:0xffcc00, emissive:0xffcc00, emissiveIntensity:1.1});
const matGlass=new THREE.MeshStandardMaterial({color:0x9de8ff, roughness:0.15, metalness:0.4, transparent:true, opacity:0.65});

// Sky dome — GTA sunset gradient
{
  const skyGeo=new THREE.SphereGeometry(400,32,32);
  const skyMat=new THREE.ShaderMaterial({
    side:THREE.BackSide,
    uniforms:{top:{value:new THREE.Color(0xff2e90)}, mid:{value:new THREE.Color(0xff6a00)}, bot:{value:new THREE.Color(0x1a0a3a)}},
    vertexShader:`varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
      void main(){ float h=normalize(vP).y; vec3 c=mix(bot, mid, smoothstep(-0.2,0.3,h)); c=mix(c, top, smoothstep(0.3,0.9,h)); gl_FragColor=vec4(c,1.);}`
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  // sun disc
  const sunMesh=new THREE.Mesh(new THREE.CircleGeometry(18,32), new THREE.MeshBasicMaterial({color:0xff6a00}));
  sunMesh.position.set(80,70,-280); sunMesh.lookAt(0,70,-280); scene.add(sunMesh);
}

// Ground — city plane + ocean
const ground=new THREE.Mesh(new THREE.PlaneGeometry(600,600), new THREE.MeshStandardMaterial({color:0x0f0a18, roughness:1}));
ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);
// ocean south — Vice Beach
const ocean=new THREE.Mesh(new THREE.PlaneGeometry(600,120), new THREE.MeshStandardMaterial({color:0x00a8ff, roughness:0.3, metalness:0.2, transparent:true, opacity:0.85}));
ocean.rotation.x=-Math.PI/2; ocean.position.set(0,-0.5,160); scene.add(ocean);
const sand=new THREE.Mesh(new THREE.PlaneGeometry(600,40), new THREE.MeshStandardMaterial({map:kraftTex, color:0xffe8b3, roughness:1}));
sand.rotation.x=-Math.PI/2; sand.position.set(0,-0.2,110); sand.receiveShadow=true; scene.add(sand);

// —— City Generation ———
const cityGroup=new THREE.Group(); scene.add(cityGroup);
const ROADS=[];
const buildings=[];
const roadW=12, blockS=42;

function addRoad(x,z,w,h){
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h), matRoad);
  m.rotation.x=-Math.PI/2; m.position.set(x,0.02,z); m.receiveShadow=true; cityGroup.add(m); ROADS.push(m);
}
function addBuilding(x,z,w,d,h){
  const g=new THREE.Group();
  const base=new THREE.Mesh(new THREE.BoxGeometry(w,h,d), matKraft); base.position.y=h/2; base.castShadow=true; base.receiveShadow=true; g.add(base);
  // corrugation edges
  const edge=new THREE.Mesh(new THREE.BoxGeometry(w+0.04, h*0.98, 0.06), matCorr); edge.position.set(0,h/2,d/2); g.add(edge);
  const edge2=edge.clone(); edge2.position.z=-d/2; g.add(edge2);
  // windows — cardboard cutouts with neon
  const floors=Math.floor(h/3); for(let f=0;f<floors;f++){
    const y=2 + f*3.2;
    const winMat=Math.random()<0.5? matNeonPink : (Math.random()<0.6? matNeonBlue: matNeonYellow);
    for(let k=0;k<2;k++){
      const win=new THREE.Mesh(new THREE.PlaneGeometry(w*0.32,1.1), winMat); win.position.set((k?0.22:-0.22)*w, y, d/2+0.02); g.add(win);
      win.userData.isNeon=true;
    }
  }
  // rooftop AC — little boxes
  if(Math.random()<0.6){
    const ac=new THREE.Mesh(new THREE.BoxGeometry(1.2,0.8,1.2), matKraftLight); ac.position.set((Math.random()-0.5)*w*0.5, h+0.4, (Math.random()-0.5)*d*0.5); ac.castShadow=true; g.add(ac);
  }
  // neon sign
  if(Math.random()<0.45){
    const signText=['VICE','CARTON','MOTEL','PIZZA','TATTOO','BEACH','24H','GTA VI'][Math.floor(Math.random()*8)];
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(signText.length*0.9,1.6), Math.random()<0.5? matNeonPink: matNeonBlue);
    sign.position.set(0, h-1, d/2+0.6); g.add(sign);
    const glow=new THREE.PointLight(sign.material.color, 6, 12); glow.position.copy(sign.position); glow.position.z+=0.5; g.add(glow);
  }
  g.position.set(x,0,z); cityGroup.add(g); buildings.push(g);
  return g;
}
function addPalm(x,z){
  const g=new THREE.Group();
  const trunkH=5+Math.random()*3; const trunk=new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.28,trunkH,8), matKraft); trunk.position.y=trunkH/2; trunk.castShadow=true; g.add(trunk);
  // corrugation rings on trunk
  for(let i=0;i<3;i++){ const r=new THREE.Mesh(new THREE.TorusGeometry(0.26,0.04,6,10), matCorr); r.position.y=1+i*1.5; r.rotation.x=Math.PI/2; g.add(r); }
  // leaves — cardboard sheets
  const leaves=new THREE.Group(); leaves.position.y=trunkH;
  for(let i=0;i<6;i++){
    const leaf=new THREE.Mesh(new THREE.PlaneGeometry(2.2,0.6), new THREE.MeshStandardMaterial({color:0x7cff7c, roughness:0.8, side:THREE.DoubleSide}));
    leaf.position.y=0.2; leaf.rotation.y=i*Math.PI/3; leaf.rotation.z=0.35; leaf.position.x=Math.cos(i*Math.PI/3)*0.6; leaf.position.z=Math.sin(i*Math.PI/3)*0.6; leaves.add(leaf);
  }
  g.add(leaves);
  g.position.set(x,0,z); cityGroup.add(g);
}

// Generate grid city  -6..6
for(let gx=-3; gx<=3; gx++){
  for(let gz=-2; gz<=3; gz++){
    const cx=gx*(blockS+roadW), cz=gz*(blockS+roadW);
    // roads
    addRoad(cx,0, roadW, 600); addRoad(0,cz, 600, roadW);
    // inside block buildings — 1-3 per block
    const cnt= 1+Math.floor(Math.random()*3);
    for(let i=0;i<cnt;i++){
      const bx=cx + (Math.random()-0.5)*(blockS-10);
      const bz=cz + (Math.random()-0.5)*(blockS-10);
      if(Math.hypot(bx,bz)<12) continue; // keep center open for player
      const w=7+Math.random()*8, d=7+Math.random()*7, h=5+Math.random()*18;
      addBuilding(bx,bz,w,d,h);
    }
  }
}
// Beach palms line
for(let i=-5;i<=5;i++){ if(Math.random()<0.7) addPalm(i*10 + (Math.random()-0.5)*4, 95+Math.random()*8); }
// Ocean pier — cardboard pier
{
  const pier=new THREE.Mesh(new THREE.BoxGeometry(6,0.6,40), matKraft); pier.position.set(30,0.3,130); pier.receiveShadow=true; cityGroup.add(pier);
  for(let i=0;i<4;i++){ const p=new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,6,8), matKraft); p.position.set(30+ (i%2?1:-1)*2, -2, 115+i*8); cityGroup.add(p); }
}

// City lights points for atmosphere
for(let i=0;i<12;i++){
  const l=new THREE.PointLight(Math.random()<0.5?0xff2e90:0x00e6ff, 8, 25); l.position.set((Math.random()-0.5)*200, 4+Math.random()*8, (Math.random()-0.5)*200); scene.add(l);
}

// —— Car builder — carton anime ———
function buildCartonCar(color='#ff2e90'){
  const g=new THREE.Group();
  const paint=new THREE.MeshToonMaterial({color:new THREE.Color(color), gradientMap:toonGrad});
  const dark=new THREE.MeshStandardMaterial({color:0x1a0a14, roughness:0.9});
  const glass=new THREE.MeshStandardMaterial({color:0x9de8ff, roughness:0.2, metalness:0.3, transparent:true, opacity:0.6});
  // base box
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.9,0.7,3.8), paint); body.position.y=0.7; body.castShadow=true; g.add(body);
  const cabin=new THREE.Mesh(new THREE.BoxGeometry(1.7,0.7,1.8), paint); cabin.position.set(0,1.25,-0.2); cabin.castShadow=true; g.add(cabin);
  const wind=new THREE.Mesh(new THREE.BoxGeometry(1.65,0.65,0.08), glass); wind.position.set(0,1.2,0.7); wind.rotation.x=0.35; g.add(wind);
  // corrugation detail
  const corr=new THREE.Mesh(new THREE.BoxGeometry(1.92,0.08,3.82), matCorr); corr.position.y=0.55; g.add(corr);
  // wheels — cardboard reels
  function wheel(x,z){
    const w=new THREE.Group(); const tire=new THREE.Mesh(new THREE.CylinderGeometry(0.38,0.38,0.5,14), dark); tire.rotation.z=Math.PI/2; const hub=new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.18,0.52,10), matKraftLight); hub.rotation.z=Math.PI/2; w.add(tire,hub); w.position.set(x,0.38,z); return w;
  }
  const w1=wheel(-1.05,1.2), w2=wheel(1.05,1.2), w3=wheel(-1.05,-1.2), w4=wheel(1.05,-1.2); g.add(w1,w2,w3,w4); g.userData.wheels=[w1,w2,w3,w4];
  // neon underglow
  const glowM=new THREE.Mesh(new THREE.PlaneGeometry(1.6,3.6), new THREE.MeshStandardMaterial({color:new THREE.Color(color), emissive:new THREE.Color(color), emissiveIntensity:0.9, transparent:true, opacity:0.5})); glowM.rotation.x=-Math.PI/2; glowM.position.y=0.06; g.add(glowM);
  // anime outline — slightly larger black mesh with backface
  const outline=new THREE.Mesh(new THREE.BoxGeometry(2.0,0.75,3.9), new THREE.MeshBasicMaterial({color:0x000000, side:THREE.BackSide})); outline.position.y=0.7; outline.scale.set(1.04,1.04,1.04); g.add(outline); outline.renderOrder=1;
  g.userData.paintMat=paint;
  return g;
}

// —— Anime Character ———
function buildAnimeChar(){
  const g=new THREE.Group();
  // head — big anime
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.45,16,16), new THREE.MeshToonMaterial({color:0xffe0b2, gradientMap:toonGrad})); head.position.y=1.45; head.castShadow=true; g.add(head);
  const hair=new THREE.Mesh(new THREE.SphereGeometry(0.48,12,12), new THREE.MeshToonMaterial({color:0xff2e90, gradientMap:toonGrad})); hair.position.y=1.6; hair.scale.set(1,0.6,1); g.add(hair);
  // eyes — large anime
  const eyeW=new THREE.Mesh(new THREE.CircleGeometry(0.12,12), new THREE.MeshBasicMaterial({color:0xffffff})); eyeW.position.set(-0.16,1.48,0.38); eyeW.rotation.y=-0.3; g.add(eyeW);
  const eyeW2=eyeW.clone(); eyeW2.position.x=0.16; eyeW2.rotation.y=0.3; g.add(eyeW2);
  const pupil=new THREE.Mesh(new THREE.CircleGeometry(0.06,12), new THREE.MeshBasicMaterial({color:0x1a0a2e})); pupil.position.set(-0.16,1.48,0.39); g.add(pupil);
  const pupil2=pupil.clone(); pupil2.position.x=0.16; g.add(pupil2);
  const shine=new THREE.Mesh(new THREE.CircleGeometry(0.022,8), new THREE.MeshBasicMaterial({color:0xffffff})); shine.position.set(-0.14,1.5,0.395); g.add(shine);
  const shine2=shine.clone(); shine2.position.x=0.18; g.add(shine2);
  // body — cardboard anime uniform (Vice Carton shirt)
  const body=new THREE.Mesh(new THREE.BoxGeometry(0.55,0.7,0.32), new THREE.MeshToonMaterial({color:0x00e6ff, gradientMap:toonGrad})); body.position.y=0.85; body.castShadow=true; g.add(body);
  const jacket=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.55,0.34), new THREE.MeshToonMaterial({color:0xfff, gradientMap:toonGrad})); jacket.position.y=0.95; g.add(jacket);
  // arms
  const armL=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,0.55,8), new THREE.MeshToonMaterial({color:0xffe0b2, gradientMap:toonGrad})); armL.position.set(-0.38,0.85,0); g.add(armL);
  const armR=armL.clone(); armR.position.x=0.38; g.add(armR);
  // legs — cardboard jeans
  const legL=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.6,0.24), new THREE.MeshToonMaterial({color:0x2a0a4a, gradientMap:toonGrad})); legL.position.set(-0.16,0.25,0); g.add(legL);
  const legR=legL.clone(); legR.position.x=0.16; g.add(legR);
  // outline
  g.traverse(o=>{ if(o.isMesh && o.material.isMeshToonMaterial){ o.material.outline=1; }});
  return g;
}

// —— Game State ———
let playerCar=buildCartonCar('#ff2e90'); playerCar.position.set(0,0.2,0); scene.add(playerCar);
let playerChar=buildAnimeChar(); playerChar.position.set(2,0,2); playerChar.visible=false; scene.add(playerChar);
let inCar=true;
let carPos=playerCar.position, carYaw=0, carSpeed=0, carSteer=0;
let charPos=playerChar.position, charYaw=0, charVel=new THREE.Vector3();
let velocity=0; // for car
let wanted=0, money=1250, deliveries=0, maxWanted=0;
let targetPos=null, targetMarker=null;
let cops=[];
let keys={};
let cameraMode='car'; // car vs foot
let buildMode=false;

// Build mode pieces
let buildPieces=[], ghost=null, selectedBuildId='sheetBig';
const BUILD_TYPES=[
  {id:'sheetBig', name:'ورقة كبيرة', icon:'📄', size:[2.2,0.04,1.4]},
  {id:'boxClosed', name:'صندوق', icon:'📦', size:[0.9,0.6,0.7]},
  {id:'boxOpen', name:'مفتوح', icon:'📭', size:[0.9,0.5,0.7]},
  {id:'plank', name:'عارضة', icon:'🪵', size:[1.6,0.08,0.25]},
  {id:'tube', name:'أنبوب', icon:'🧻', size:[0.5,1,0.5]},
  {id:'ramp', name:'منحدر', icon:'📈', size:[1.4,0.04,0.8]},
];
let buildRot=0;
let ghostMatOpacity=0.5;

// Simple car physics
function updateCar(dt){
  if(!inCar || buildMode) return;
  const accel= keys['w']||keys['arrowup'] ? 1 : keys['s']||keys['arrowdown'] ? -1 : 0;
  const turn= keys['a']||keys['arrowleft'] ? 1 : keys['d']||keys['arrowright'] ? -1 : 0;
  const brake= keys[' '] ? 1:0;
  const turbo= keys['shift'] ? 1:0;

  // steer lerp
  carSteer = lerp(carSteer, turn*0.9, 5*dt);
  // speed
  const maxSpeed= 18 + turbo*8;
  const acc= 22;
  if(accel>0) carSpeed += acc*dt*(turbo?1.6:1);
  else if(accel<0) carSpeed += -acc*0.6*dt;
  else carSpeed *= (1 - 1.2*dt); // friction

  if(brake) carSpeed *= (1 - 6*dt);
  carSpeed= clamp(carSpeed, -maxSpeed*0.5, maxSpeed);

  // yaw
  const steerEffect = Math.abs(carSpeed)/maxSpeed;
  carYaw += carSteer * steerEffect * 2.2 * dt * Math.sign(carSpeed||1);
  // move
  const fwdX=Math.sin(carYaw), fwdZ=Math.cos(carYaw);
  carPos.x += fwdX * carSpeed * dt;
  carPos.z += fwdZ * carSpeed * dt;
  playerCar.position.copy(carPos); playerCar.position.y=0.2;
  playerCar.rotation.y=carYaw;
  // wheel spin
  const spin=carSpeed*dt*4; playerCar.userData.wheels.forEach(w=> w.rotation.x+=spin);
  // sway
  playerCar.rotation.z = -carSteer*0.18*steerEffect;
  // dust when turbo
  if(turbo && Math.abs(carSpeed)>8){
    if(Math.random()<0.3) spawnDust(carPos.x, 0.2, carPos.z);
  }
  // collision with buildings — simple push back
  for(const b of buildings){
    const dx=carPos.x-b.position.x, dz=carPos.z-b.position.z;
    const bx=b.children[0].geometry.parameters.width/2+1.4, bz=b.children[0].geometry.parameters.depth/2+1.4;
    if(Math.abs(dx)<bx && Math.abs(dz)<bz){
      // push out
      const pushX= (bx - Math.abs(dx)) * Math.sign(dx);
      const pushZ= (bz - Math.abs(dz)) * Math.sign(dz);
      if(Math.abs(pushX)<Math.abs(pushZ)){ carPos.x+=pushX; carSpeed*=-0.2; }
      else { carPos.z+=pushZ; carSpeed*=-0.2; }
      playerCar.position.copy(carPos);
      if(Math.abs(carSpeed)>6){ wanted=Math.min(5, wanted+0.02); updateWanted(); }
    }
  }
  // keep in bounds
  carPos.x=clamp(carPos.x,-140,140); carPos.z=clamp(carPos.z,-110,140);
}
function spawnDust(x,y,z){
  const d=new THREE.Mesh(new THREE.SphereGeometry(0.18,6,6), new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.5}));
  d.position.set(x+ (Math.random()-0.5)*1, y, z+ (Math.random()-0.5)*1); scene.add(d);
  let t=0; function tick(){ t+=0.06; d.position.y+=0.04; d.material.opacity-=0.05; d.scale.multiplyScalar(1.04); if(d.material.opacity<=0) scene.remove(d); else requestAnimationFrame(tick); } tick();
}

function updateFoot(dt){
  if(inCar || buildMode) return;
  const fwd=new THREE.Vector3(), right=new THREE.Vector3();
  const camDir=new THREE.Vector3(); camera.getWorldDirection(camDir); camDir.y=0; camDir.normalize();
  fwd.copy(camDir); right.crossVectors(fwd, new THREE.Vector3(0,1,0)).normalize().negate();
  let moveX=0, moveZ=0;
  if(keys['w']||keys['arrowup']) { moveX+=fwd.x; moveZ+=fwd.z; }
  if(keys['s']||keys['arrowdown']) { moveX-=fwd.x; moveZ-=fwd.z; }
  if(keys['a']||keys['arrowleft']) { moveX+=right.x; moveZ+=right.z; }
  if(keys['d']||keys['arrowright']) { moveX-=right.x; moveZ-=right.z; }
  const len=Math.hypot(moveX,moveZ);
  if(len>0){ moveX/=len; moveZ/=len; charYaw=Math.atan2(moveX,moveZ); playerChar.rotation.y=charYaw; }
  const sprint= keys['shift']?1:0;
  const speed= 3.2 + sprint*2.2;
  charVel.x= moveX*speed; charVel.z= moveZ*speed;
  if(keys[' '] && charPos.y<0.1){ charVel.y=5; } // jump
  charVel.y -= 12*dt;
  charPos.x += charVel.x*dt; charPos.y += charVel.y*dt; charPos.z += charVel.z*dt;
  if(charPos.y<0){ charPos.y=0; charVel.y=0; }
  playerChar.position.copy(charPos);
  // bob walk
  if(len>0) playerChar.position.y = Math.abs(Math.sin(performance.now()*0.01*speed))*0.08;
}

function updateCops(dt){
  for(const c of cops){
    const dx=carPos.x-c.pos.x, dz=carPos.z-c.pos.z; const dist=Math.hypot(dx,dz);
    if(dist<60){
      c.yaw=Math.atan2(dx,dz); c.pos.x+=Math.sin(c.yaw)*8*dt; c.pos.z+=Math.cos(c.yaw)*8*dt;
      c.mesh.position.copy(c.pos); c.mesh.rotation.y=c.yaw;
      if(dist<3 && inCar){ carSpeed*=0.7; wanted=Math.min(5,wanted+0.05); updateWanted(); banner('💥 COP HIT!', true); }
    }
  }
}

// Missions
function spawnTarget(){
  if(targetMarker) scene.remove(targetMarker);
  const x=(Math.random()-0.5)*180, z=(Math.random()-0.5)*180;
  targetPos=new THREE.Vector3(x,0,z);
  targetMarker=new THREE.Group();
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,6,8), matNeonPink); pole.position.y=3; targetMarker.add(pole);
  const flag=new THREE.Mesh(new THREE.PlaneGeometry(2,1.2), matNeonPink); flag.position.set(1,5,0); targetMarker.add(flag);
  const glow=new THREE.PointLight(0xff2e90, 10, 18); glow.position.set(0,2,0); targetMarker.add(glow);
  const arrow=new THREE.Mesh(new THREE.ConeGeometry(0.9,1.8,8), matNeonYellow); arrow.position.y=7; arrow.rotation.x=Math.PI; targetMarker.add(arrow);
  targetMarker.position.copy(targetPos); scene.add(targetMarker);
  $('missionTitle').textContent='DELIVER 📦 PACKAGE';
  $('missionDesc').textContent='Follow pink marker — drive fast!';
}
function checkDeliver(){
  if(!targetPos) return;
  const dist= Math.hypot(carPos.x-targetPos.x, carPos.z-targetPos.z);
  const prog= clamp(1 - dist/180, 0,1); $('missionProgFill').style.width=(prog*100)+'%';
  if(dist<4){
    money+= 350+ Math.floor(Math.random()*200); deliveries++; updateHUD();
    banner('DELIVERED! +$'+money%1000, false); confetti(); playSound('win');
    wanted=Math.max(0,wanted-0.8); updateWanted();
    spawnTarget();
    if(deliveries%3===0){ // spawn cop chase every 3
      spawnCop();
    }
  }
}
function spawnCop(){
  const cpos=new THREE.Vector3(carPos.x + (Math.random()-0.5)*40, 0.2, carPos.z + (Math.random()-0.5)*40);
  const car=buildCartonCar('#00e6ff'); car.position.copy(cpos); car.scale.set(0.95,0.95,0.95); scene.add(car);
  cops.push({pos:cpos, mesh:car, yaw:0});
  wanted=Math.min(5, wanted+1); updateWanted(); banner('🚔 COPS ALERT!', true);
}

// Wanted / HUD
function updateWanted(){
  const stars=$('wantedStars'); stars.innerHTML='';
  for(let i=0;i<5;i++){ const s=document.createElement('span'); s.textContent='★'; s.className= i<Math.floor(wanted) ? 'on':'off'; stars.appendChild(s); }
  $('wantedLevelMenu').textContent=Math.floor(wanted);
  maxWanted=Math.max(maxWanted, wanted);
  $('statMaxWanted').textContent=Math.floor(maxWanted);
  $('wantedFlash').classList.toggle('on', wanted>=3);
  if(wanted>0) wanted= Math.max(0, wanted - 0.008); // decay slowly but cops keep it
}
function updateHUD(){
  $('hudMoney').textContent=money.toLocaleString();
  $('statCashMenu').textContent='$'+money.toLocaleString();
  $('statDelivs').textContent=deliveries;
  $('money').textContent=money; // keep
  $('hudMoney').textContent=money;
  const mph=Math.abs(Math.round(carSpeed*2.2)); $('speedoNum').textContent=inCar?mph: Math.round(Math.hypot(charVel.x,charVel.z)*2.2);
  $('hudGear').textContent= carSpeed>0?'D': carSpeed<0?'R':'N';
}

// Minimap
function drawMinimap(){
  const c=$('minimap'), g=c.getContext('2d');
  g.fillStyle='#070a1a'; g.fillRect(0,0,160,160);
  // roads grid
  g.strokeStyle='rgba(255,255,255,.12)'; g.lineWidth=2;
  for(let x=-140;x<=140;x+=54){ const sx=80 + (x - (inCar?carPos.x:charPos.x))*0.6; g.beginPath(); g.moveTo(sx,0); g.lineTo(sx,160); g.stroke(); }
  for(let z=-140;z<=140;z+=54){ const sy=80 + (z - (inCar?carPos.z:charPos.z))*0.6; g.beginPath(); g.moveTo(0,sy); g.lineTo(160,sy); g.stroke(); }
  // buildings
  g.fillStyle='rgba(255,204,0,.25)';
  for(const b of buildings){
    const bx=80 + (b.position.x - (inCar?carPos.x:charPos.x))*0.6, bz=80 + (b.position.z - (inCar?carPos.z:charPos.z))*0.6;
    if(bx>-5&&bx<165&&bz>-5&&bz<165) g.fillRect(bx-2,bz-2,4,4);
  }
  // target
  if(targetPos){
    const tx=80 + (targetPos.x - (inCar?carPos.x:charPos.x))*0.6, tz=80 + (targetPos.z - (inCar?carPos.z:charPos.z))*0.6;
    g.fillStyle='#ff2e90'; g.beginPath(); g.arc(tx,tz,5,0,7); g.fill();
    g.fillStyle='#fff'; g.fillText('📦',tx-6,tz+4);
  }
  // player
  g.fillStyle='#00e6ff'; g.beginPath(); g.arc(80,80,5,0,7); g.fill(); g.fillStyle='#fff'; g.beginPath(); g.moveTo(80,70); g.lineTo(76,78); g.lineTo(84,78); g.fill();
}

// Banner
let bannerT=null;
function banner(txt, warn=false){
  const b=$('banner'); b.textContent=txt; b.className= warn?'small':'';
  b.classList.add('pop'); clearTimeout(bannerT); bannerT=setTimeout(()=>{ b.textContent=''; b.className=''; },1800);
}
function toast(msg, warn=false){
  const t=$('toast'); t.textContent=msg; t.classList.toggle('warn',warn); t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200);
}
function confetti(){
  const c=$('confetti'); for(let i=0;i<14;i++){ const s=document.createElement('span'); s.textContent=['📦','⭐','💰','🎉'][i%4]; s.style.left=Math.random()*100+'vw'; s.style.fontSize=14+Math.random()*10+'px'; c.appendChild(s); setTimeout(()=>s.remove(),3500); }
}
function playSound(kind){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const o=ctx.createOscillator(), g=ctx.createGain(); o.connect(g); g.connect(ctx.destination);
    if(kind==='win'){ o.frequency.value=880; o.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime+0.15); g.gain.setValueAtTime(0.3,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime+0.3); o.start(); o.stop(ctx.currentTime+0.31); }
    else { o.frequency.value=200; o.frequency.linearRampToValueAtTime(120, ctx.currentTime+0.12); g.gain.setValueAtTime(0.25,ctx.currentTime); g.gain.linearRampToValueAtTime(0.01, ctx.currentTime+0.14); o.start(); o.stop(ctx.currentTime+0.15); }
  }catch(e){}
}

// —— Camera ———
let camYaw= -0.6, camPitch=0.35, camDist=10, camTarget=new THREE.Vector3();
function updateCamera(dt){
  const targetPosWorld = inCar ? carPos : charPos;
  if(!buildMode){
    // chase cam lerp
    camTarget.lerp(targetPosWorld, 6*dt);
    // auto yaw follow car direction when driving
    if(inCar && Math.abs(carSpeed)>1){
      const desiredYaw= carYaw + Math.PI; // behind
      let diff= ((desiredYaw - camYaw + Math.PI)%(Math.PI*2))-Math.PI;
      camYaw += diff * 1.5*dt;
    }
    const sinY=Math.sin(camYaw), cosY=Math.cos(camYaw), sinP=Math.sin(camPitch), cosP=Math.cos(camPitch);
    const off=new THREE.Vector3(sinY*cosP, sinP, cosY*cosP).multiplyScalar(camDist);
    const desired=new THREE.Vector3().copy(camTarget).add(off); desired.y+= inCar?1.8:1.4;
    camera.position.lerp(desired, 5*dt);
    camera.lookAt(camTarget.x, camTarget.y+0.8, camTarget.z);
  } else {
    // build cam orbit
    const sinY=Math.sin(camYaw), cosY=Math.cos(camYaw), sinP=Math.sin(camPitch), cosP=Math.cos(camPitch);
    const off=new THREE.Vector3(sinY*cosP, sinP, cosY*cosP).multiplyScalar(camDist);
    const desired=new THREE.Vector3().copy(camTarget).add(off); desired.y+=3;
    camera.position.lerp(desired, 8*dt);
    camera.lookAt(camTarget);
  }
}

// —— Build Mode (Carton Builder inside GTA) ———
function createGhostBuild(type){
  if(ghost) scene.remove(ghost);
  const g=new THREE.Group();
  const s=type.size, w=s[0],h=s[1],d=s[2];
  const box=new THREE.Mesh(new THREE.BoxGeometry(w,h,d), matKraft.clone()); box.material.transparent=true; box.material.opacity=0.55; box.castShadow=true; g.add(box);
  const edge=new THREE.Mesh(new THREE.BoxGeometry(w+0.02,h*1.02,0.04), matCorr.clone()); edge.material.transparent=true; edge.material.opacity=0.4; edge.position.z=d/2; g.add(edge);
  const edge2=edge.clone(); edge2.position.z=-d/2; g.add(edge2);
  ghost=g; ghost.visible=false; scene.add(ghost);
}
function updateGhostBuild(){
  if(!ghost||!buildMode) return;
  const ray=new THREE.Raycaster(); ray.setFromCamera(mouse, camera);
  const plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  const hit=new THREE.Vector3(); ray.ray.intersectPlane(plane, hit);
  if(!hit){ ghost.visible=false; return; }
  hit.x=Math.round(hit.x/0.2)*0.2; hit.z=Math.round(hit.z/0.2)*0.2;
  hit.x=clamp(hit.x,-140,140); hit.z=clamp(hit.z,-120,160);
  const h=BUILD_TYPES.find(t=>t.id===selectedBuildId).size[1]/2;
  ghost.position.set(hit.x, h, hit.z); ghost.rotation.y=buildRot*Math.PI/180; ghost.visible=true;
}
function placeBuild(){
  const type=BUILD_TYPES.find(t=>t.id===selectedBuildId);
  const m=new THREE.Group(); const s=type.size;
  const box=new THREE.Mesh(new THREE.BoxGeometry(s[0],s[1],s[2]), matKraft); box.castShadow=true; box.receiveShadow=true; m.add(box);
  const edge=new THREE.Mesh(new THREE.BoxGeometry(s[0]+0.02,s[1]*1.02,0.04), matCorr); edge.position.z=s[2]/2; m.add(edge);
  const edge2=edge.clone(); edge2.position.z=-s[2]/2; m.add(edge2);
  m.position.copy(ghost.position); m.rotation.y=ghost.rotation.y; scene.add(m); buildPieces.push(m); playSound('win');
}
function removeBuildAtMouse(){
  const ray=new THREE.Raycaster(); ray.setFromCamera(mouse,camera);
  const meshes=[]; buildPieces.forEach(p=> p.traverse(o=>{ if(o.isMesh) meshes.push(o); }));
  const hits=ray.intersectObjects(meshes,false);
  if(hits.length){
    let cur=hits[0].object; while(cur.parent && !buildPieces.includes(cur)) cur=cur.parent;
    const piece=buildPieces.find(p=>p===cur||cur.parent===p);
    if(piece){ scene.remove(piece); buildPieces=buildPieces.filter(x=>x!==piece); }
  }
}

// —— Wiring ———
let mouse=new THREE.Vector2(0,0);
function wire(){
  // inventory build
  const grid=$('invGrid'); BUILD_TYPES.forEach(t=>{
    const b=document.createElement('button'); b.className='invItem'+(t.id===selectedBuildId?' sel':'');
    b.innerHTML=`<div class="thumb">${t.icon}</div><b>${t.name}</b>`;
    b.onclick=()=>{ selectedBuildId=t.id; document.querySelectorAll('.invItem').forEach(e=>e.classList.remove('sel')); b.classList.add('sel'); $('buildPreview').textContent=t.icon; $('buildName').textContent=t.name; createGhostBuild(t); };
    grid.appendChild(b);
  });
  $('buildPreview').textContent='📄'; $('buildName').textContent='ورقة كبيرة';
  createGhostBuild(BUILD_TYPES[0]);

  $('buildRot').addEventListener('input',e=>{ buildRot=parseInt(e.target.value); });
  $('btnExitBuild').onclick=()=>{ buildMode=false; $('buildUI').classList.remove('on'); ghost.visible=false; toast('خرجت من البناء'); };
  $('btnBuildClear').onclick=()=>{ buildPieces.forEach(p=>scene.remove(p)); buildPieces=[]; toast('🗑️ مسح البناء'); };
  $('btnBuildSave').onclick=()=>{ toast('💾 تم حفظ البناء!'); };

  // HUD buttons
  $('btnResume').onclick=()=>{ $('menu').classList.remove('open'); };
  $('btnNewJob').onclick=()=>{ spawnTarget(); $('menu').classList.remove('open'); toast('📦 مهمة جديدة!'); };
  $('btnSpawnCar').onclick=()=>{
    playerCar.position.set(carPos.x+4,0.2,carPos.z); carPos.copy(playerCar.position); carSpeed=0;
    $('menu').classList.remove('open'); banner('🚗 CAR SPAWNED');
  };
  $('btnBuildMode').onclick=()=>{
    buildMode=true; $('buildUI').classList.add('on'); $('menu').classList.remove('open');
    camTarget.copy(inCar?carPos:charPos); camDist=12; camPitch=0.9;
    toast('🔨 وضع البناء — بني دارك في Vice Carton!');
  };
  $('btnWanted').onclick=()=>{ wanted=Math.min(5,wanted+1); updateWanted(); toast('⭐ WANTED +1'); };
  $('btnHelp').onclick=()=> $('helpModal').classList.add('open');
  $('helpClose').onclick=()=> $('helpModal').classList.remove('open');
  $('helpStart').onclick=()=> $('helpModal').classList.remove('open');
  $('btnRadio').onclick=()=>{ const tracks=['Cardboard Dreams','Vice Neon','Carton Anime OST','Sunset Drive']; $('radioTrack').textContent= tracks[Math.floor(Math.random()*tracks.length)]+' — Shuffle'; toast('📻 Radio next'); };

  // controls hint auto hide
  setTimeout(()=>{ const h=$('controlsHint'); if(h) h.style.opacity='0.25'; },4000);

  // input
  addEventListener('keydown',e=>{
    const k=e.key.toLowerCase(); keys[k]=true;
    if(k==='e'){
      // enter/exit car
      if(inCar){
        // exit
        const dist= playerCar.position.distanceTo(playerChar.position);
        if(buildMode) return;
        inCar=false; playerChar.visible=true; playerChar.position.copy(playerCar.position); playerChar.position.x+=1.5; charPos.copy(playerChar.position);
        camDist=6; banner('👟 ON FOOT');
      } else {
        // try enter if near car
        if(playerChar.position.distanceTo(playerCar.position)<3){
          inCar=true; playerChar.visible=false; camDist=10; banner('🚗 IN CAR');
        }
      }
    }
    if(k==='escape' || k==='p'){ $('menu').classList.toggle('open'); }
    if(k==='r' && buildMode){ buildRot=(buildRot+90)%360; $('buildRot').value=buildRot; }
    if(k===' ' && !buildMode && inCar){ /* brake handled */ }
  });
  addEventListener('keyup',e=>{ keys[e.key.toLowerCase()]=false; });

  // mouse for camera orbit & build
  let dragging=false, lastX=0, lastY=0, mode=null;
  renderer.domElement.addEventListener('pointerdown',e=>{
    if(buildMode && e.button===0){ placeBuild(); return; }
    if(buildMode && e.button===2){ removeBuildAtMouse(); return; }
    if(e.button===0){ dragging=true; mode='orbit'; lastX=e.clientX; lastY=e.clientY; renderer.domElement.setPointerCapture(e.pointerId); }
    if(e.button===2){ dragging=true; mode='pan'; lastX=e.clientX; lastY=e.clientY; }
  });
  renderer.domElement.addEventListener('pointermove',e=>{
    const rect=renderer.domElement.getBoundingClientRect();
    mouse.x=((e.clientX-rect.left)/rect.width)*2-1; mouse.y=-((e.clientY-rect.top)/rect.height)*2+1;
    if(!dragging) { if(buildMode) updateGhostBuild(); return; }
    const dx=e.clientX-lastX, dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY;
    if(mode==='orbit'){ camYaw -= dx*0.004; camPitch = clamp(camPitch + dy*0.004, 0.05, 1.35); }
    if(mode==='pan'){ camTarget.x -= dx*0.02; camTarget.z -= dy*0.02; }
  });
  renderer.domElement.addEventListener('pointerup',e=>{ dragging=false; try{renderer.domElement.releasePointerCapture(e.pointerId);}catch{}});
  renderer.domElement.addEventListener('contextmenu',e=> e.preventDefault());
  renderer.domElement.addEventListener('wheel',e=>{
    camDist= clamp(camDist + e.deltaY*0.015, 3, 22);
  }, {passive:false});

  // touch
  addEventListener('touchstart', e=>{ if(e.touches.length===2) e.preventDefault(); }, {passive:false});

  addEventListener('resize',()=>{
    camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight);
  });

  if(!localStorage.getItem('viceSeen')){ setTimeout(()=> $('helpModal').classList.add('open'),700); localStorage.setItem('viceSeen','1'); }
}

// —— Loop ———
let last=performance.now();
function tick(){
  requestAnimationFrame(tick);
  const now=performance.now(), dt=Math.min(0.05,(now-last)/1000); last=now;
  updateCar(dt); updateFoot(dt); updateCops(dt); checkDeliver(); updateCamera(dt); drawMinimap(); updateHUD(); updateWanted();
  // animate neon flicker
  if(Math.random()<0.04) neonPink.intensity= 8+Math.random()*6;
  if(targetMarker) targetMarker.rotation.y+= dt*0.8;
  renderer.render(scene,camera);
}

// boot
wire(); updateHUD(); updateWanted(); spawnTarget();
setTimeout(()=>{ $('loading').classList.add('hide'); setTimeout(()=>$('loading').remove(),700); banner('🌴 WELCOME TO VICE CARTON', false); },900);
tick();
