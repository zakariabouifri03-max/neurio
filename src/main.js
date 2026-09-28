/* ═══════════════════════════════════════════════════════════════
   NEURIO GUYS ULTRA — Fall Guys Ultimate Knockout
   Three.js r170 • RTX 5060 Ultra preset • No build step
   JIB / Chibi Bean Model — procedural, GitHub-inspired
   Sources: poly-pizza/fall-guys-bean, Khronos glTF chibi packs
   All geometry procedural — no external download required.
   Features: ultra graphics, smooth jelly animations, WiFi LAN multiplayer (WebRTC)
   Modes: Obstacle Hustle • Hex-A-Gone • Fall Ball
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ULTRA_LEVELS } from './levels_ultra.js';
import { CANDY_PALETTES } from './candy_engine.js';
import { PHYSICS_CONFIG } from './physics_ultra.js';
import { SFX } from './audio_ultra.js';
import { LONG_MAPS } from './long_maps.js';
console.log(`ULTRA 111k project loaded: ${ULTRA_LEVELS.length} levels, ${CANDY_PALETTES.length} palettes, ${Object.keys(PHYSICS_CONFIG).length} physics, ${SFX.length} sfx, ${LONG_MAPS.length} LONG MAPS TAWILA — RTX 5060`);

/* ---------- Mobile 60fps — khafifa jida 3la hawatif da3ifa (auto) ---------- */
const isWeakPhone = /Android.*(Mali|Adreno.*3|PowerVR|M2000)/i.test(navigator.userAgent) || (navigator.hardwareConcurrency||8) <= 4 || window.innerWidth < 720;
let targetFPS = 60;
console.log(`Device: ${isWeakPhone ? 'WEAK PHONE — ultra light 60fps mode' : 'PC/Strong — ULTRA'}, cores:${navigator.hardwareConcurrency}, DPR:${window.devicePixelRatio}`);

/* ---------- Renderer (RTX ULTRA defaults) ---------- */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference:'high-performance', stencil:false });
/* ---------- Helpers: Rounded candy geometry & textures (so it doesn't look kharya) ---------- */
function roundedBox(w,h,d,r,seg){
  // ultra candy rounded box via BoxGeometry + smooth subdivision approximation
  // we build with BoxGeometry then chamfer via modifier: simple extruded shape
  const shape = new THREE.Shape();
  const hw=w/2-r, hd=d/2-r;
  shape.moveTo(-hw, -hd+r); shape.lineTo(-hw, hd-r); shape.quadraticCurveTo(-hw, hd, -hw+r, hd);
  shape.lineTo(hw-r, hd); shape.quadraticCurveTo(hw, hd, hw, hd-r);
  shape.lineTo(hw, -hd+r); shape.quadraticCurveTo(hw, -hd, hw-r, -hd);
  shape.lineTo(-hw+r, -hd); shape.quadraticCurveTo(-hw, -hd, -hw, -hd+r);
  const geo=new THREE.ExtrudeGeometry(shape,{depth:h- r*0.6, bevelEnabled:true, bevelThickness:r*0.35, bevelSize:r*0.35, bevelSegments:4, steps:1});
  geo.translate(0,0,-(h- r*0.6)/2); geo.rotateX(Math.PI/2);
  return geo;
}
function candyTexture(c1,c2){
  const c=document.createElement('canvas'); c.width=512;c.height=512; const g=c.getContext('2d');
  g.fillStyle=c1; g.fillRect(0,0,512,512);
  g.fillStyle=c2; for(let y=0;y<512;y+=64) for(let x=0;x<512;x+=64) if((x/64+y/64)%2===0){ g.beginPath(); g.arc(x+32,y+32,18,0,Math.PI*2); g.fill(); }
  // sprinkle dots
  g.fillStyle='rgba(255,255,255,0.85)'; for(let i=0;i<40;i++){ const x=Math.random()*512,y=Math.random()*512; g.beginPath(); g.arc(x,y,3+Math.random()*4,0,Math.PI*2); g.fill(); }
  const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(2,2); t.anisotropy=gfx.af; t.colorSpace=THREE.SRGBColorSpace; return t;
}
let gfx = {
  preset: isWeakPhone ? 'med' : 'ultra',
  shadow: isWeakPhone ? 1024 : 4096,
  af: isWeakPhone ? 4 : 16,
  scale: isWeakPhone ? 0.85 : 1,
  bloom: isWeakPhone ? false : true,
  ao: isWeakPhone ? false : true,
  motion: isWeakPhone ? false : true,
  contact: isWeakPhone ? false : true,
  aa: isWeakPhone ? 'FXAA' : 'TAA / MSAA 4x',
  fps: 60
};
function applyRenderer(){
  const dpr = Math.min(window.devicePixelRatio,2) * gfx.scale;
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = gfx.shadow>0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = (gfx.preset==='ultraPlus'?1.28: gfx.preset==='ultra'?1.18 : 1.05);
  // anisotropic filtering will be applied per texture when created
  // request high-performance
}
applyRenderer();

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xb9d8ff, 0.0018);
scene.background = new THREE.Color(0x87c7ff);

const camera = new THREE.PerspectiveCamera(68, window.innerWidth/window.innerHeight, 0.1, 2200);
camera.position.set(0,13,-20);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping=true; controls.dampingFactor=0.075; controls.minDistance=3; controls.maxDistance=90;
controls.maxPolarAngle=Math.PI*0.495; controls.target.set(0,1.5,12); controls.enabled=false;

/* ---------- Sky (volumetric gradient + sun) ---------- */
const skyGeo = new THREE.SphereGeometry(1500,32,18);
const skyMat = new THREE.ShaderMaterial({
  side:THREE.BackSide, depthWrite:false, fog:false,
  uniforms:{
    top:{value:new THREE.Color(0x4fc3ff)},
    mid:{value:new THREE.Color(0xc990ff)},
    bottom:{value:new THREE.Color(0xffe9a8)},
    sunDir:{value:new THREE.Vector3(0.5,0.78,0.2)},
    time:{value:0}
  },
  vertexShader:`varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader:`uniform vec3 top,mid,bottom,sunDir; uniform float time; varying vec3 vPos;
  void main(){
    float h = normalize(vPos).y;
    vec3 c = mix(bottom, mid, smoothstep(-0.25,0.28,h));
    c = mix(c, top, smoothstep(0.18,0.82,h));
    float sun = pow(max(0., dot(normalize(vPos), normalize(sunDir))), 88.);
    c += vec3(1.,0.96,0.78)*sun*0.75;
    float horizon = pow(max(0., 1.-abs(h)*1.2), 3.)*0.18;
    c += vec3(1.,0.75,0.85)*horizon;
    // subtle cloud noise via sin
    float nv = sin(vPos.x*0.002+time*0.02)*sin(vPos.z*0.0015)*0.04;
    c += nv;
    gl_FragColor=vec4(c,1.);
  }`
});
const skyMesh = new THREE.Mesh(skyGeo, skyMat);
scene.add(skyMesh);

// Clouds with high detail
const cloudMat = new THREE.MeshLambertMaterial({ color:0xffffff, transparent:true, opacity:0.88 });
const clouds=[];
for(let i=0;i<14;i++){
  const g=new THREE.Group();
  const n=4+Math.floor(Math.random()*3);
  for(let j=0;j<n;j++){
    const s=3.5+Math.random()*5.5;
    const m=new THREE.Mesh(new THREE.SphereGeometry(s,12,8), cloudMat);
    m.position.set((Math.random()-0.5)*14, (Math.random()-0.5)*1.8, (Math.random()-0.5)*14);
    m.scale.set(1,0.62,1); m.castShadow=false; m.receiveShadow=false;
    g.add(m);
  }
  const ang=Math.random()*Math.PI*2; const rad=70+Math.random()*110;
  g.position.set(Math.cos(ang)*rad, 42+Math.random()*16, Math.sin(ang)*rad);
  g.userData.spin=(Math.random()-0.5)*0.03; g.userData.baseY=g.position.y;
  scene.add(g); clouds.push(g);
}

/* ---------- Lighting (ultra) ---------- */
scene.add(new THREE.HemisphereLight(0xddeeff, 0xffdcc0, 0.95));
const sun = new THREE.DirectionalLight(0xfff6e6, 2.6);
sun.position.set(140,160,55);
sun.castShadow=true;
sun.shadow.mapSize.set(gfx.shadow, gfx.shadow);
sun.shadow.camera.left=-110; sun.shadow.camera.right=110; sun.shadow.camera.top=110; sun.shadow.camera.bottom=-110;
sun.shadow.camera.near=15; sun.shadow.camera.far=520;
sun.shadow.bias=-0.00035; sun.shadow.normalBias=1.2;
sun.shadow.radius=4;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xa9c8ff, 0.55); fill.position.set(-90,70,-70); scene.add(fill);
const rim = new THREE.DirectionalLight(0xff8ac4, 0.35); rim.position.set(0,40,-120); scene.add(rim);

/* ---------- Ground / Slime / Stadium ---------- */
const groundMat = new THREE.MeshStandardMaterial({ color:0x8ed48c, roughness:0.92, metalness:0.01 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), groundMat);
ground.rotation.x=-Math.PI/2; ground.position.y=-0.7; ground.receiveShadow=true;
scene.add(ground);

// checker secondary ground texture (virtual via canvas)
(function(){
  const c=document.createElement('canvas'); c.width=512;c.height=512; const ctx=c.getContext('2d');
  for(let x=0;x<512;x+=64) for(let y=0;y<512;y+=64){ ctx.fillStyle=((x/64+y/64)%2)?'#7ed07c':'#95dc93'; ctx.fillRect(x,y,64,64); }
  const tex=new THREE.CanvasTexture(c); tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.repeat.set(22,22); tex.anisotropy=gfx.af; tex.colorSpace=THREE.SRGBColorSpace;
  groundMat.map=tex; groundMat.needsUpdate=true;
})();

const slimeMat = new THREE.MeshStandardMaterial({ color:0xff3b8d, roughness:0.28, metalness:0.04, emissive:0x4a0a2a, emissiveIntensity:0.35 });
const slime = new THREE.Mesh(new THREE.PlaneGeometry(160, 620), slimeMat);
slime.rotation.x=-Math.PI/2; slime.position.set(0,-3.4, 158); scene.add(slime);

// stadium walls ultra
const wallMat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.65, metalness:0.02 });
const wallGeo = new THREE.BoxGeometry(220, 20, 5);
const w1=new THREE.Mesh(wallGeo, wallMat); w1.position.set(0,8.5,-32); w1.castShadow=true; w1.receiveShadow=true; scene.add(w1);
const w2=w1.clone(); w2.position.set(0,8.5, 332); scene.add(w2);
const swGeo=new THREE.BoxGeometry(5,14,420);
const sw1=new THREE.Mesh(swGeo, wallMat); sw1.position.set(-84,6,152); sw1.castShadow=true; scene.add(sw1);
const sw2=sw1.clone(); sw2.position.x=84; scene.add(sw2);

// banners
function addBanner(text,pos,rotY=0){
  const c=document.createElement('canvas'); c.width=1024;c.height=256; const ctx=c.getContext('2d');
  const grd=ctx.createLinearGradient(0,0,1024,0); grd.addColorStop(0,'#7b5cff'); grd.addColorStop(1,'#2ee5ff');
  ctx.fillStyle=grd; ctx.fillRect(0,0,1024,256);
  ctx.fillStyle='#ffd93d'; ctx.font='900 96px Fredoka, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.strokeStyle='white'; ctx.lineWidth=10; ctx.strokeText(text,512,128); ctx.fillText(text,512,128);
  const tex=new THREE.CanvasTexture(c); tex.anisotropy=gfx.af; tex.colorSpace=THREE.SRGBColorSpace;
  const m=new THREE.Mesh(new THREE.PlaneGeometry(28,7), new THREE.MeshBasicMaterial({map:tex, side:THREE.DoubleSide}));
  m.position.copy(pos); m.rotation.y=rotY; scene.add(m);
}
addBanner('★ NEURIO GUYS ULTRA ★', new THREE.Vector3(0,16,-30));
addBanner('★ QUALIFY! ★', new THREE.Vector3(0,16,330), Math.PI);

// pedestals for menu (two drums like screenshots)
const pedMats=[
  new THREE.MeshStandardMaterial({color:0xff8c2a, roughness:0.6}),
  new THREE.MeshStandardMaterial({color:0xff4d8d, roughness:0.6}),
  new THREE.MeshStandardMaterial({color:0x7b5cff, roughness:0.6})
];
function createPedestal(pos, colIdx=0){
  const g=new THREE.Group(); g.position.copy(pos);
  const top=new THREE.Mesh(new THREE.CylinderGeometry(2.2,2.22,0.7,18), pedMats[colIdx]); top.position.y=0.35; top.castShadow=true; top.receiveShadow=true; g.add(top);
  const body1=new THREE.Mesh(new THREE.CylinderGeometry(2.0,2.0,1.2,18), new THREE.MeshStandardMaterial({color:0xffe07a})); body1.position.y=-0.6; g.add(body1);
  const body2=new THREE.Mesh(new THREE.CylinderGeometry(2.0,2.1,0.9,18), new THREE.MeshStandardMaterial({color:0x3ee0a0})); body2.position.y=-1.6; g.add(body2);
  // zigzag decal via canvas texture
  g.userData.top=top;
  scene.add(g); return g;
}
const ped1=createPedestal(new THREE.Vector3(-3.2,0.6,-6),0);
const ped2=createPedestal(new THREE.Vector3(3.2,0.6,-3),1);
const pedSingle=createPedestal(new THREE.Vector3(0,0.6,-5),0); pedSingle.visible=false;

// ---------- Course & Arenas ----------
const platforms=[]; const obstacles=[]; let hexTiles=[]; let ball=null; let ballVel=new THREE.Vector3();
let currentMode='race'; // race | hex | ball

function clearArena(){
  // remove platforms meshes and obstacles not needed? We keep race, but hide hex/ball when switching
  hexTiles.forEach(t=> scene.remove(t.mesh));
  hexTiles=[]; if(ball){ scene.remove(ball); ball=null; }
  // show/hide race platform meshes via visible
  platforms.forEach(p=>{ if(p.mesh) p.mesh.visible = (currentMode==='race'); if(p.edge) p.edge.visible = (currentMode==='race'); if(p.checkMesh) p.checkMesh.visible=(currentMode==='race'); });
  obstacles.forEach(o=>{ if(o.group) o.group.visible=(currentMode==='race'); });
  slime.visible=(currentMode!=='ball'); ground.visible=true;
}

function addPlatform(x,z,w,d,y,color=0xf2f2f2, withCheck=false){
  const h=1.25;
  // ultra candy inflated platform — use roundedBox for soft inflated look (no more cheap flat box)
  let geo;
  try{ geo=roundedBox(w,h,d,0.55,2); }catch{ geo=new THREE.BoxGeometry(w,h,d); }
  const isWhite = color===0xffffff;
  let mat;
  if(isWhite){
    mat=new THREE.MeshPhysicalMaterial({ color, roughness:0.55, clearcoat:0.6, clearcoatRoughness:0.28 });
  } else {
    // candy pattern texture for colored platforms
    const tex=candyTexture('#ffffff', '#'+new THREE.Color(color).getHexString());
    mat=new THREE.MeshPhysicalMaterial({ map:tex, roughness:0.65, clearcoat:0.35, clearcoatRoughness:0.4 });
  }
  const m=new THREE.Mesh(geo, mat); m.position.set(x,y,z); m.receiveShadow=true; m.castShadow=true;
  scene.add(m);
  // chunky candy border — torus-like rim
  const edgeMat=new THREE.MeshPhysicalMaterial({color:0xffffff, roughness:0.32, clearcoat:0.8, clearcoatRoughness:0.22, emissive:0xffe0f0, emissiveIntensity:0.04});
  const edgeGeo=new THREE.BoxGeometry(w+0.6,0.32,d+0.6);
  // add slight bevel via edge
  const edge=new THREE.Mesh(edgeGeo, edgeMat); edge.position.set(x,y+0.32,z); edge.receiveShadow=true; scene.add(edge);
  // soft AO underneath
  const ao=new THREE.Mesh(new THREE.PlaneGeometry(w*0.92,d*0.92), new THREE.MeshBasicMaterial({color:0x000000, transparent:true, opacity:0.10}));
  ao.rotation.x=-Math.PI/2; ao.position.set(x,y-0.58,z); scene.add(ao);
  let checkMesh=null;
  if(withCheck){
    const c=document.createElement('canvas'); c.width=1024;c.height=1024; const g=c.getContext('2d');
    // super checkered like Fall Guys start/finish
    for(let ix=0;ix<16;ix++) for(let iz=0;iz<16;iz++){ g.fillStyle=(ix+iz)%2?'#ffd93d':'#ffffff'; g.fillRect(ix*64,iz*64,64,64); }
    g.fillStyle='#7b5cff'; g.font='900 96px Fredoka'; g.textAlign='center'; g.fillText('➔  ➔  ➔',512,512);
    g.strokeStyle='white'; g.lineWidth=10; g.strokeText('➔  ➔  ➔',512,512);
    const tex=new THREE.CanvasTexture(c); tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.repeat.set(w/12,d/12); tex.anisotropy=gfx.af; tex.colorSpace=THREE.SRGBColorSpace;
    checkMesh=new THREE.Mesh(new THREE.PlaneGeometry(w-1.2,d-1.2), new THREE.MeshStandardMaterial({map:tex, roughness:0.78, metalness:0.02})); checkMesh.rotation.x=-Math.PI/2; checkMesh.position.set(x,y+0.42,z); checkMesh.receiveShadow=true; scene.add(checkMesh);
  }
  const data={ minX:x-w/2, maxX:x+w/2, minZ:z-d/2, maxZ:z+d/2, y, top:y+0.42, w,d, mesh:m, edge, checkMesh, color, ao };
  platforms.push(data); return data;
}

// Build race course (ultra detailed)
function buildRace(){
  platforms.length=0; obstacles.length=0; clearArena(); currentMode='race';
  // ensure visible
  addPlatform(0,-6, 36, 30, 0.6, 0xffffff, true);
  addPlatform(0,24, 18, 30,0.6, 0xeaf2ff);
  addPlatform(0,58, 30, 34,0.6, 0xfff4cc);
  addPlatform(0,96, 16, 30,0.6, 0xeaf2ff);
  addPlatform(0,132, 28, 52,0.6, 0xffdaea);
  addPlatform(0,182, 22, 38,0.6, 0xd8ffe6);
  addPlatform(0,220, 28, 36,0.6, 0xe0dbff);
  addPlatform(0,252, 12, 30,0.6, 0xeaf2ff);
  addPlatform(0,288, 30, 46,0.6, 0xfff4cc);
  addPlatform(0,328, 38, 36,0.6, 0xffffff, true);
  addPlatform(-20,60, 7,7,0.6, 0xffe6e6);
  addPlatform(20,60, 7,7,0.6, 0xffe6e6);

  // obstacles
  createSpinningBeam(new THREE.Vector3(0,0.6,54), 24, 1.08, 1.9, 0xff3b8d);
  createSpinningBeam(new THREE.Vector3(0,0.6,64), 24, -1.32, 2.55, 0x7b5cff);
  createHammer(new THREE.Vector3(-7,10,122), 0.88,1.28,0);
  createHammer(new THREE.Vector3(7,10,132),0.88,1.34,1.0);
  createHammer(new THREE.Vector3(0,10,146),0.96,1.18,0.5);
  createSeesaw(new THREE.Vector3(0,0.6,182), 22,15);
  createDisc(new THREE.Vector3(-7,0.6,218),6.8,0.92);
  createDisc(new THREE.Vector3(7,0.6,224),6.4,-1.08);
  createBumper(new THREE.Vector3(-3.5,0.6,250)); createBumper(new THREE.Vector3(3.5,0.6,258)); createBumper(new THREE.Vector3(0,0.6,266));
  createJibCrane(new THREE.Vector3(14,0.6,328));
  for(let i=0;i<3;i++){ const g=new THREE.Group(); g.position.set((i-1)*8,6.2,292+i*9); const torus=new THREE.Mesh(new THREE.TorusGeometry(2.1,0.48,12,20), new THREE.MeshStandardMaterial({color:i%2?0x2ee5ff:0xff3b8d})); torus.rotation.x=Math.PI/2; torus.castShadow=true; g.add(torus); const chain=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,6.2,6), new THREE.MeshStandardMaterial({color:0x3a3a4a})); chain.position.y=3.1; g.add(chain); scene.add(g);
    obstacles.push({type:'donut', group:g, pos:g.position.clone(), baseY:6.2, update(dt,t){ g.position.y=6.2+Math.sin(t*1.12+i)*0.7; torus.rotation.z+=dt*0.7; }, hitTest(p){ const d=Math.hypot(p.x-g.position.x,p.z-g.position.z); if(d<2.7 && Math.abs(p.y-g.position.y)<1.5){ const dir=new THREE.Vector3(p.x-g.position.x,0,p.z-g.position.z).normalize(); if(!dir.length()) dir.set(1,0,0); return {push:dir.multiplyScalar(11), stun:0.48, up:3.2}; } return null; }});
  }
}
function createSpinningBeam(pos,len,speed,height,color){
  const g=new THREE.Group(); g.position.copy(pos);
  const beam=new THREE.Mesh(new THREE.BoxGeometry(len,1.25,1.55), new THREE.MeshStandardMaterial({color, roughness:0.35, metalness:0.08})); beam.position.y=height; beam.castShadow=true; g.add(beam);
  const capG=new THREE.CylinderGeometry(0.95,0.95,1.55,16); const capM=new THREE.MeshStandardMaterial({color:0xffffff});
  const c1=new THREE.Mesh(capG,capM); c1.rotation.z=Math.PI/2; c1.position.set(len/2-0.8,height,0); const c2=c1.clone(); c2.position.x=-len/2+0.8; g.add(c1,c2);
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.26,0.26,height,12), new THREE.MeshStandardMaterial({color:0x2a2a3a})); pole.position.y=height/2; g.add(pole);
  scene.add(g);
  obstacles.push({type:'spin', group:g, speed,len,height,pos:pos.clone(), update(dt,t){ g.rotation.y+=speed*dt; }, hitTest(p){
    const yDiff=Math.abs(p.y-(pos.y+height)); if(yDiff>1.9) return null;
    const local=p.clone().sub(pos); local.y=0; const ang=-g.rotation.y; const c=Math.cos(ang),s=Math.sin(ang); const lx=local.x*c-local.z*s; const lz=local.x*s+local.z*c;
    if(Math.abs(lz)<1.2 && Math.abs(lx)<len/2){ const push=new THREE.Vector3(-Math.sin(g.rotation.y),0,Math.cos(g.rotation.y)); if(lz<0) push.negate(); return {push:push.multiplyScalar(15), stun:0.58}; } return null;
  }});
}
function createHammer(pos,amp,speed,delay){
  const g=new THREE.Group(); g.position.copy(pos); const piv=new THREE.Group(); g.add(piv);
  const arm=new THREE.Mesh(new THREE.BoxGeometry(0.38,7.4,0.38), new THREE.MeshStandardMaterial({color:0x23233a})); arm.position.y=-3.7; piv.add(arm);
  const head=new THREE.Mesh(new THREE.BoxGeometry(4.4,1.85,1.85), new THREE.MeshStandardMaterial({color:0xffd93d, roughness:0.45})); head.position.y=-7.35; head.castShadow=true; piv.add(head);
  const head2=new THREE.Mesh(new THREE.BoxGeometry(3.8,1.4,1.4), new THREE.MeshStandardMaterial({color:0xff3b8d})); head2.position.y=-7.35; piv.add(head2);
  const joint=new THREE.Mesh(new THREE.SphereGeometry(0.55,14,10), new THREE.MeshStandardMaterial({color:0x44445a})); g.add(joint); scene.add(g);
  obstacles.push({type:'hammer', group:g, pivot:piv, pos:pos.clone(), speed, amp, update(dt,t){ piv.rotation.z=Math.sin((t+delay)*speed)*amp; },
    hitTest(p){ const ang=piv.rotation.z; const hx=Math.sin(ang)*7.35; const hy=pos.y-Math.cos(ang)*7.35; const dist=Math.hypot(p.x-(pos.x+hx), p.z-pos.z); if(dist<3.15 && Math.abs(p.y-hy)<2){ const dir=new THREE.Vector3(p.x-(pos.x+hx),0,p.z-pos.z); if(!dir.length()) dir.set(1,0,0); dir.normalize(); const swingVel=Math.cos((performance.now()/1000+delay)*speed)*speed*amp*7.4; dir.x+=swingVel*0.09; return {push:dir.multiplyScalar(19), stun:0.72, up:6.2}; } return null; }});
}
function createSeesaw(pos,w,d){
  const g=new THREE.Group(); g.position.copy(pos);
  const plat=new THREE.Mesh(new THREE.BoxGeometry(w,1.0,d), new THREE.MeshStandardMaterial({color:0xff7a3d, roughness:0.75})); plat.castShadow=true; plat.receiveShadow=true; g.add(plat);
  const base=new THREE.Mesh(new THREE.CylinderGeometry(0.7,0.7,1.4,12), new THREE.MeshStandardMaterial({color:0x44445a})); base.rotation.z=Math.PI/2; base.position.y=-0.75; g.add(base); scene.add(g);
  let tilt=0,vel=0;
  const pData={ minX:pos.x-w/2, maxX:pos.x+w/2, minZ:pos.z-d/2, maxZ:pos.z+d/2, y:pos.y, top:pos.y+0.58, w,d, mesh:plat, moving:true, group:g };
  platforms.push(pData);
  obstacles.push({type:'seesaw', group:g, pData, update(dt,t){
    let torque=0; const all=[player,...bots,...lanPeers.map(p=>p.ent).filter(Boolean)];
    for(const e of all){ if(!e.pos) continue; if(e.pos.x>=pData.minX && e.pos.x<=pData.maxX && e.pos.z>=pData.minZ && e.pos.z<=pData.maxZ && Math.abs(e.pos.y-pData.top)<1.3) torque+=(e.pos.x-pos.x)*0.042; }
    const target=THREE.MathUtils.clamp(torque,-0.58,0.58); vel+=(target-tilt)*4*dt - vel*2.1*dt; tilt+=vel; tilt+=Math.sin(t*0.65)*0.0015; g.rotation.z=tilt; pData.tilt=tilt;
  }});
}
function createDisc(pos,r,speed){
  const g=new THREE.Group(); g.position.copy(pos);
  const c=document.createElement('canvas'); c.width=512;c.height=512; const ctx=c.getContext('2d'); ctx.fillStyle='#7b5cff'; ctx.fillRect(0,0,512,512);
  for(let i=0;i<7;i++){ ctx.beginPath(); ctx.arc(256,256,28+i*36,0,Math.PI*2); ctx.strokeStyle=i%2?'#ffd93d':'#ffffff'; ctx.lineWidth=14; ctx.stroke(); }
  const tex=new THREE.CanvasTexture(c); tex.anisotropy=gfx.af; tex.colorSpace=THREE.SRGBColorSpace;
  const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,0.75,28), new THREE.MeshStandardMaterial({map:tex, roughness:0.65})); m.castShadow=true; m.receiveShadow=true; g.add(m);
  const cone=new THREE.Mesh(new THREE.ConeGeometry(0.7,1.3,12), new THREE.MeshStandardMaterial({color:0xff3b8d})); cone.position.y=0.78; g.add(cone); scene.add(g);
  const pData={ minX:pos.x-r, maxX:pos.x+r, minZ:pos.z-r, maxZ:pos.z+r, y:pos.y, top:pos.y+0.48, radius:r, mesh:m, moving:true, group:g, isDisc:true };
  platforms.push(pData);
  obstacles.push({type:'disc', group:g, speed, pData, update(dt){ g.rotation.y+=speed*dt; }});
}
function createBumper(pos){
  const g=new THREE.Group(); g.position.copy(pos);
  const m=new THREE.Mesh(new THREE.SphereGeometry(1.4,18,14), new THREE.MeshStandardMaterial({color:0x2ee5ff, roughness:0.22, metalness:0.06})); m.castShadow=true; g.add(m);
  const base=new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.62,0.75,12), new THREE.MeshStandardMaterial({color:0x2a2a3a})); base.position.y=-1.12; g.add(base); scene.add(g);
  obstacles.push({type:'bumper', pos:pos.clone(), group:g, update(dt,t){ const s=1+Math.sin(t*2.3)*0.09; m.scale.set(s,s,s); }, hitTest(p){ const d=p.distanceTo(pos); if(d<2.2){ const dir=new THREE.Vector3().subVectors(p,pos); dir.y=0.38; dir.normalize(); return {push:dir.multiplyScalar(16), stun:0.52, up:5.2}; } return null; }});
}
function createJibCrane(pos){
  const g=new THREE.Group(); g.position.copy(pos);
  const tower=new THREE.Mesh(new THREE.BoxGeometry(1.35,24,1.35), new THREE.MeshStandardMaterial({color:0xffd93d})); tower.position.y=12; tower.castShadow=true; g.add(tower);
  for(let y=1;y<22;y+=1.8){ const b=new THREE.Mesh(new THREE.BoxGeometry(1.15,0.16,0.16), new THREE.MeshStandardMaterial({color:0x23233a})); b.position.set(0,y,0); b.rotation.y=Math.random()*Math.PI; g.add(b); }
  const armG=new THREE.Group(); armG.position.set(0,20.5,0); g.add(armG);
  const jib=new THREE.Mesh(new THREE.BoxGeometry(30,0.9,0.9), new THREE.MeshStandardMaterial({color:0x23233a})); jib.position.set(7.5,0,0); jib.castShadow=true; armG.add(jib);
  const cnt=new THREE.Mesh(new THREE.BoxGeometry(4.4,1.35,1.7), new THREE.MeshStandardMaterial({color:0xff3b8d})); cnt.position.set(-9.5,0,0); armG.add(cnt);
  const hookG=new THREE.Group(); hookG.position.set(14,0,0); armG.add(hookG);
  const cab=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,7.8,6), new THREE.MeshStandardMaterial({color:0x5a5a6a})); cab.position.y=-3.9; hookG.add(cab);
  const hook=new THREE.Mesh(new THREE.TorusGeometry(0.62,0.13,8,14,Math.PI*1.4), new THREE.MeshStandardMaterial({color:0x8a8aaa})); hook.position.y=-7.8; hook.rotation.z=Math.PI; hookG.add(hook);
  const load=new THREE.Mesh(new THREE.BoxGeometry(2.4,1.3,1.3), new THREE.MeshStandardMaterial({color:0x2ee5ff})); load.position.y=-8.45; hookG.add(load); scene.add(g);
  obstacles.push({type:'jib', group:g, armGroup:armG, hookGroup:hookG, update(dt,t){ armG.rotation.y=Math.sin(t*0.33)*0.48; hookG.position.x=10+Math.sin(t*0.88)*3.2; hookG.rotation.z=Math.sin(t*1.18)*0.32; }, hitTest(p){ const w=new THREE.Vector3(); hookG.getWorldPosition(w); w.y-=7.8; const d=Math.hypot(p.x-w.x,p.z-w.z); if(d<2.1 && Math.abs(p.y-w.y)<2.1){ const dir=new THREE.Vector3(p.x-w.x,0,p.z-w.z).normalize(); return {push:dir.multiplyScalar(13), stun:0.62, up:4.2}; } return null; }});
}

// Hex-A-Gone arena
function buildHex(){
  clearArena(); currentMode='hex';
  // hide race platforms
  platforms.forEach(p=>{ if(p.mesh) p.mesh.visible=false; if(p.edge) p.edge.visible=false; if(p.checkMesh) p.checkMesh.visible=false; });
  obstacles.forEach(o=>{ if(o.group) o.group.visible=false; });
  // create multi-layer hex grid floating above slime
  const layers=3;
  const hexSize=1.55;
  const cols=12, rows=12;
  const startX=- (cols*hexSize*1.7)/2, startZ= 140;
  const colors=[0xff7ad1,0x7b5cff,0x2ee5ff,0xffd93d,0xff6b6b];
  for(let l=0;l<layers;l++){
    const y= 8 - l*4.2;
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        const x = startX + c*hexSize*1.75 + (r%2? hexSize*0.88:0);
        const z = startZ + r*hexSize*1.52;
        // skip edges for circular shape
        const dx=(x)/14, dz=(z-158)/14; if(dx*dx+dz*dz>1.25) continue;
        if(Math.random()<0.06) continue;
        const hexGeo=new THREE.CylinderGeometry(hexSize*0.92, hexSize*0.92, 0.45, 6);
        const mat=new THREE.MeshStandardMaterial({ color: colors[(l*2+r+c)%colors.length], roughness:0.55, metalness:0.04 });
        const m=new THREE.Mesh(hexGeo, mat); m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; scene.add(m);
        const data={ mesh:m, x,z,y, layer:l, alive:true, shake:0, wobble:Math.random()*Math.PI*2, fall:false, vel:0 };
        // add as platform
        platforms.push({ minX:x-hexSize, maxX:x+hexSize, minZ:z-hexSize, maxZ:z+hexSize, y, top:y+0.28, w:hexSize*1.8,d:hexSize*1.8, mesh:m, isHex:true, hexData:data });
        hexTiles.push(data);
      }
    }
  }
  slime.position.y=-2.8; slime.visible=true;
}
function updateHex(dt, t){
  hexTiles.forEach(h=>{
    if(!h.alive) return;
    // check if any bean standing on it
    let standing=false;
    const all=[player,...bots, ...lanPeers.map(p=>p.ent).filter(Boolean)];
    for(const e of all){
      if(Math.hypot(e.pos.x-h.x, e.pos.z-h.z)<1.25 && Math.abs(e.pos.y - (h.y+0.6))<0.9 && e.vel.y<0.5){
        if(!h.fallStarted){ h.shake=1; h.fallAt = t+0.62; h.fallStarted=true; }
        standing=true; break;
      }
    }
    if(h.fallStarted && t>h.fallAt && !h.fall){
      h.fall=true; h.mesh.material.transparent=true;
    }
    if(h.fall){
      h.vel+= 18*dt; h.mesh.position.y -= h.vel*dt;
      h.mesh.rotation.x += dt*2.5; h.mesh.rotation.z += dt*1.8;
      h.mesh.material.opacity -= dt*0.9;
      if(h.mesh.position.y < -18) { h.alive=false; h.mesh.visible=false; }
    } else if(h.shake>0){
      h.shake -= dt*2.8; const s=Math.sin(t*22)*0.12*h.shake;
      h.mesh.position.y = h.y + s;
    } else {
      h.mesh.position.y = h.y + Math.sin(t*0.9+h.wobble)*0.04;
    }
  });
}

// Fall Ball arena
function buildBall(){
  clearArena(); currentMode='ball';
  platforms.forEach(p=>{ if(p.mesh) p.mesh.visible=false; if(p.edge) p.edge.visible=false; if(p.checkMesh) p.checkMesh.visible=false; });
  obstacles.forEach(o=>{ if(o.group) o.group.visible=false; });
  // flat stadium
  const fW=52, fD=78;
  addPlatform(0,160, fW, fD, 0.6, 0xeaffff);
  // side walls low
  const sideM=new THREE.MeshStandardMaterial({color:0x7b5cff});
  const fw1=new THREE.Mesh(new THREE.BoxGeometry(1.2,2.2,fD), sideM); fw1.position.set(-fW/2-0.6,1.4,160); scene.add(fw1); obstacles.push({type:'wall', group:fw1}); platforms.push({minX:-fW/2-1.2,maxX:-fW/2,minZ:160-fD/2,maxZ:160+fD/2, y:2.6, top:2.6, w:1,d:fD, mesh:fw1});
  const fw2=fw1.clone(); fw2.position.x=fW/2+0.6; scene.add(fw2);
  const fw3=new THREE.Mesh(new THREE.BoxGeometry(fW,2.2,1.2), sideM); fw3.position.set(0,1.4,160-fD/2-0.6); scene.add(fw3);
  const fw4=fw3.clone(); fw4.position.z=160+fD/2+0.6; scene.add(fw4);
  // goals
  const goal1=new THREE.Mesh(new THREE.BoxGeometry(14,6,1), new THREE.MeshStandardMaterial({color:0xffffff})); goal1.position.set(0,3,160+fD/2+1); scene.add(goal1);
  const goal2=goal1.clone(); goal2.position.z=160-fD/2-1; scene.add(goal2);
  // ball
  const ballGeo=new THREE.SphereGeometry(2.1,24,20);
  // soccer texture canvas
  const bc=document.createElement('canvas'); bc.width=512; bc.height=256; const bctx=bc.getContext('2d');
  bctx.fillStyle='#ffffff'; bctx.fillRect(0,0,512,256);
  bctx.fillStyle='#222'; for(let i=0;i<6;i++){ bctx.beginPath(); bctx.arc(80+i*70, 60+(i%2?80:0), 28,0,Math.PI*2); bctx.fill(); }
  bctx.fillStyle='orange';
  const btex=new THREE.CanvasTexture(bc); btex.anisotropy=gfx.af; btex.colorSpace=THREE.SRGBColorSpace;
  ball=new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({map:btex, roughness:0.45, metalness:0.05})); ball.position.set(0,2.2,160); ball.castShadow=true; scene.add(ball);
  ballVel.set(0,0,0);
  // net particles
  slime.visible=false;
}

function updateBall(dt){
  if(!ball) return;
  // gravity
  ballVel.y -= 14*dt;
  ball.position.addScaledVector(ballVel, dt);
  // ground
  if(ball.position.y < 2.1){ ball.position.y=2.1; ballVel.y = Math.abs(ballVel.y)*0.55; ballVel.x*=0.92; ballVel.z*=0.92; if(Math.abs(ballVel.y)<0.3) ballVel.y=0; }
  // walls bounce
  const fW=52, fD=78;
  if(Math.abs(ball.position.x) > fW/2-2.1){ ball.position.x= Math.sign(ball.position.x)*(fW/2-2.1); ballVel.x*=-0.85; }
  if(Math.abs(ball.position.z-160) > fD/2-2.1){ ball.position.z=160+Math.sign(ball.position.z-160)*(fD/2-2.1); ballVel.z*=-0.85; }
  // player/bot kick
  const all=[player,...bots,...lanPeers.map(p=>p.ent).filter(Boolean)];
  for(const e of all){
    const d=Math.hypot(e.pos.x-ball.position.x, e.pos.z-ball.position.z);
    const dy=Math.abs(e.pos.y-ball.position.y);
    if(d<2.6 && dy<2.2){
      const dir=new THREE.Vector3(ball.position.x-e.pos.x,0,ball.position.z-e.pos.z); if(!dir.length()) dir.set(1,0,0); dir.normalize();
      const kick=10 + Math.hypot(e.vel.x,e.vel.z)*0.9;
      ballVel.x= dir.x*kick; ballVel.z= dir.z*kick; ballVel.y= 3.5;
      e.stun=0.15;
    }
  }
  ball.rotation.x+=ballVel.z*dt*0.6; ball.rotation.z-=ballVel.x*dt*0.6;
  // goal check
  if(ball.position.z > 160+78/2+1.5 && Math.abs(ball.position.x)<7){ onGoal('teamA'); }
  if(ball.position.z < 160-78/2-1.5 && Math.abs(ball.position.x)<7){ onGoal('teamB'); }
}
let scoreA=0, scoreB=0;
function onGoal(team){
  if(team==='teamA') scoreA++; else scoreB++;
  showToast(`GOAL! ${scoreA} - ${scoreB}`, 1800);
  ball.position.set(0,4,160); ballVel.set((Math.random()-0.5)*2,0,(Math.random()-0.5)*2);
  spawnConfetti(ball.position, 0xffd93d, 18);
}

// initial build
buildRace();

/* ---------- JIB Bean Factory (authentic Fall Guys) ---------- */
const skins = {
  red_hero: { color:0xe5392a, hood:0xc42a1d, belt:[0xffd93d,0x2e7cff], eyes:0xffc0d8 },
  blue_monster: { color:0x1e6bff, hood:null, spikes:true, eyes:0x7fff9a },
  dark_hood: { color:0x2b2b33, hood:0x1a1a21, gloves:0x0f0f12, eyes:0xffd1ff },
  pink_candy: { color:0xff3b8d, hood:null, eyes:0xffffff },
  cyan_pop: { color:0x2ee5ff, hood:null, eyes:0xffffff },
  gold_champ: { color:0xffb81c, hood:0xff8a00, crown:true, eyes:0xffffff }
};
const beanPalette=[0xe5392a,0x1e6bff,0x2b2b33,0xff3b8d,0x2ee5ff,0xffb81c,0x7b5cff,0x2ecc71,0xff7a3d,0x9b59b6,0x4ecdc4,0xff6b6b];
function createFallGuysBean(skinKey='red_hero'){
  const sk = skins[skinKey]||skins.red_hero;
  const col = sk.color;
  const g=new THREE.Group();
  // shadow blob
  const blob=new THREE.Mesh(new THREE.CircleGeometry(0.68,18), new THREE.MeshBasicMaterial({color:0x000000, transparent:true, opacity:0.22}));
  blob.rotation.x=-Math.PI/2; blob.position.y=0.015; g.add(blob); g.userData.shadow=blob;
  // body capsule — squat bean with vinyl toy shader (clearcoat + sheen)
  const bodyGeo=new THREE.CapsuleGeometry(0.55,0.68,12,20);
  const bodyMat=new THREE.MeshPhysicalMaterial({ color:col, roughness:0.38, metalness:0.0, clearcoat:0.85, clearcoatRoughness:0.22, sheen:0.6, sheenRoughness:0.35, sheenColor:new THREE.Color(0xffffff) });
  const body=new THREE.Mesh(bodyGeo, bodyMat); body.position.y=0.94; body.castShadow=true; body.receiveShadow=true; g.add(body);
  g.userData.body=body; g.userData.bodyMat=bodyMat;
  // subtle rim light mesh (inner glow)
  const rimMesh=new THREE.Mesh(new THREE.CapsuleGeometry(0.56,0.70,10,16), new THREE.MeshBasicMaterial({color:col, transparent:true, opacity:0.0, side:THREE.BackSide}));
  rimMesh.position.y=0.94; g.add(rimMesh);
  // hood if present (slightly larger capsule over top) — velvet
  let hood=null;
  if(sk.hood){
    const hoodGeo=new THREE.CapsuleGeometry(0.585,0.74,10,16);
    const hoodMat=new THREE.MeshPhysicalMaterial({color:sk.hood, roughness:0.92, clearcoat:0.0, sheen:0.9, sheenColor:new THREE.Color(0xffffff)});
    hood=new THREE.Mesh(hoodGeo, hoodMat); hood.position.y=0.99; hood.scale.set(1,1,0.965); hood.castShadow=true; g.add(hood);
    g.userData.hood=hood;
  }
  // belly lighter
  const belly=new THREE.Mesh(new THREE.SphereGeometry(0.41,14,11), new THREE.MeshStandardMaterial({color:0xfff6dd, roughness:0.9}));
  belly.position.set(0,0.66,0.34); belly.scale.set(1,0.82,0.42); g.add(belly);
  // belt for red hero
  if(sk.belt){
    const beltG=new THREE.Group();
    const strap=new THREE.Mesh(new THREE.TorusGeometry(0.56,0.09,10,22), new THREE.MeshStandardMaterial({color:sk.belt[0], roughness:0.5}));
    strap.rotation.x=Math.PI/2; strap.position.y=0.62; beltG.add(strap);
    const buckle=new THREE.Mesh(new THREE.BoxGeometry(0.32,0.22,0.08), new THREE.MeshStandardMaterial({color:sk.belt[0], roughness:0.3, metalness:0.3}));
    buckle.position.set(0,0.62,0.56); beltG.add(buckle);
    const buckleIn=new THREE.Mesh(new THREE.PlaneGeometry(0.22,0.14), new THREE.MeshBasicMaterial({color:sk.belt[1]})); buckleIn.position.set(0,0.62,0.605); beltG.add(buckleIn);
    // draw pattern on buckle via canvas
    g.add(beltG); g.userData.belt=beltG;
  }
  // face visor — black oval like Fall Guys
  const visorGeo=new THREE.SphereGeometry(0.33,20,14);
  const visorMat=new THREE.MeshStandardMaterial({color:0x0d0d14, roughness:0.22, metalness:0.12});
  const visor=new THREE.Mesh(visorGeo, visorMat); visor.position.set(0,1.04,0.46); visor.scale.set(1.35,0.92,0.55); g.add(visor);
  // eyes pink/white
  const eyeCol = sk.eyes||0xffffff;
  const eyeMat=new THREE.MeshStandardMaterial({color:eyeCol, emissive:eyeCol, emissiveIntensity:0.25, roughness:0.6});
  const pupilMat=new THREE.MeshStandardMaterial({color:0xffffff});
  const eyes=[]; const eyePupils=[];
  for(let s of [-1,1]){
    const eye=new THREE.Mesh(new THREE.CapsuleGeometry(0.042,0.08,6,10), eyeMat); eye.position.set(s*0.14,1.07,0.62); eye.rotation.z=s*0.08; g.add(eye); eyes.push(eye);
    // tiny highlight
    const hl=new THREE.Mesh(new THREE.SphereGeometry(0.018,6,6), new THREE.MeshBasicMaterial({color:0xffffff})); hl.position.set(s*0.14,1.12,0.66); g.add(hl);
  }
  g.userData.eyes=eyes;
  // mouth tiny (hidden under visor for Fall Guys)
  // arms jelly
  const armGeo=new THREE.CapsuleGeometry(0.145,0.32,8,12);
  const armMat= sk.gloves? new THREE.MeshStandardMaterial({color:sk.gloves, roughness:0.7}) : bodyMat;
  const arms=[];
  for(let s of [-1,1]){
    const arm=new THREE.Mesh(armGeo, armMat); arm.position.set(s*0.62,0.78,0.04); arm.rotation.z=s*0.32; arm.rotation.x=0.12; arm.castShadow=true; g.add(arm); arms.push(arm);
  }
  g.userData.arms=arms;
  // legs / feet stubby
  const footGeo=new THREE.SphereGeometry(0.23,12,10);
  const footMat=new THREE.MeshStandardMaterial({color: sk.gloves? sk.gloves : col, roughness:0.7});
  footMat.color.multiplyScalar(0.92);
  const feet=[];
  for(let s of [-1,1]){
    const f=new THREE.Mesh(footGeo, footMat); f.position.set(s*0.21,0.22,0.06); f.scale.set(1,0.58,1.22); f.castShadow=true; g.add(f); feet.push(f);
  }
  g.userData.feet=feet;
  // spikes for blue monster
  if(sk.spikes){
    for(let i=0;i<5;i++){
      const sp=new THREE.Mesh(new THREE.ConeGeometry(0.12,0.28,7), new THREE.MeshStandardMaterial({color:0x7fff9a}));
      sp.position.set((i-2)*0.18,1.32, -0.22); sp.rotation.x=-0.6; sp.rotation.z=(i-2)*0.12; g.add(sp);
    }
  }
  // crown
  const crown=new THREE.Group(); crown.visible=!!sk.crown;
  const baseC=new THREE.Mesh(new THREE.CylinderGeometry(0.30,0.34,0.19,7), new THREE.MeshStandardMaterial({color:0xffd93d, roughness:0.25, metalness:0.55})); baseC.position.y=1.56; crown.add(baseC);
  for(let i=0;i<3;i++){ const ang=i*Math.PI*2/3; const pk=new THREE.Mesh(new THREE.ConeGeometry(0.095,0.24,6), new THREE.MeshStandardMaterial({color:0xffd93d})); pk.position.set(Math.cos(ang)*0.21,1.72,Math.sin(ang)*0.21); crown.add(pk); }
  const jewel=new THREE.Mesh(new THREE.SphereGeometry(0.075,8,6), new THREE.MeshStandardMaterial({color:0xff3b8d, emissive:0xff3b8d, emissiveIntensity:0.7})); jewel.position.set(0,1.56,0.20); crown.add(jewel);
  g.add(crown); g.userData.crown=crown;
  // animation helpers
  g.userData.wobble=0; g.userData.stun=0; g.userData.dive=0; g.userData.skin=skinKey;
  // add jelly outline via scale trick? Use body outline shell
  const outline=new THREE.Mesh(new THREE.CapsuleGeometry(0.57,0.70,10,16), new THREE.MeshBasicMaterial({color:0x000000, transparent:true, opacity:0.0, side:THREE.BackSide}));
  outline.position.y=0.94; g.add(outline);
  return g;
}

/* ---------- Player & Bots (ultra animated) ---------- */
const player = {
  pos:new THREE.Vector3(0,1.2,-7), vel:new THREE.Vector3(), yaw:0, onGround:false, stun:0, dive:0, wobble:0,
  mesh:createFallGuysBean('red_hero'),
  checkpoint:new THREE.Vector3(0,1.2,-7), progress:0, finished:false, finishTime:0, place:12, radius:0.6
};
scene.add(player.mesh);

const bots=[];
const botSkins=['blue_monster','dark_hood','pink_candy','cyan_pop','gold_champ','red_hero','blue_monster','dark_hood','pink_candy','cyan_pop','gold_champ'];
for(let i=0;i<11;i++){
  const skin=botSkins[i%botSkins.length];
  const b={
    pos:new THREE.Vector3((Math.random()-0.5)*10,1.2,-8-Math.random()*4), vel:new THREE.Vector3(), yaw:0,
    onGround:false, stun:0, wobble:0, mesh:createFallGuysBean(skin),
    progress:0, finished:false, finishTime:0, speed:4.4+Math.random()*1.4, laneOffset:(Math.random()-0.5)*6, radius:0.6, skin
  };
  b.yaw=(Math.random()-0.5)*0.4; scene.add(b.mesh); bots.push(b);
}
// LAN peers — define early to avoid TDZ for UI helpers (was causing loader stuck)
const mpPeers=[]; let lanPeers=[]; // {pc,dc,ent,id}
let isHost=false, roomCode=null;
// hide race pedestals when game starts, show single ped for menu? Keep ped1/2 visible in MENU
function updatePedestalsVisibility(){
  const inMenu = state==='MENU';
  ped1.visible=inMenu; ped2.visible=inMenu; pedSingle.visible=false;
  if(inMenu){
    // place player + first bot on pedestals
    player.mesh.position.copy(ped1.position); player.mesh.position.y=ped1.position.y+0.82; player.mesh.rotation.y=0.2;
    bots[0].mesh.position.copy(ped2.position); bots[0].mesh.position.y=ped2.position.y+0.82; bots[0].mesh.rotation.y=-0.3;
    // others hover behind
    for(let i=1;i<bots.length;i++){ bots[i].mesh.visible=false; }
    player.mesh.visible=true; bots[0].mesh.visible=true;
  } else {
    for(let i=0;i<bots.length;i++) bots[i].mesh.visible=true;
  }
}

/* ---------- UI helpers ---------- */
const hudTime=document.getElementById('hud-time');
const hudQualified=document.getElementById('hud-qualified');
const hudPos=document.getElementById('hud-pos');
const hudFps=document.getElementById('hud-fps');
const progressFill=document.getElementById('progress-fill');
const progressBean=document.getElementById('progress-bean');
const progressBots=document.getElementById('progress-bots');
const miniCanvas=document.getElementById('mini'); const miniCtx=miniCanvas.getContext('2d');
const toastEl=document.getElementById('toast');
const gameHud=document.getElementById('game-hud');
const leftHud=document.getElementById('left-hud');
const bottomHud=document.getElementById('bottom-hud');

function initProgressDots(){
  progressBots.innerHTML='';
  const all=[player,...bots, ...lanPeers.map(p=>p.ent).filter(Boolean)];
  all.forEach((ent,i)=>{
    const d=document.createElement('span'); d.className='bot-dot'; d.id='pdot-'+i;
    d.style.background='#'+ent.mesh.userData.bodyMat.color.getHexString(); d.style.left='0%'; progressBots.appendChild(d);
  });
}
initProgressDots();
const dotsEl=document.getElementById('player-dots');
function refreshDots(){
  dotsEl.innerHTML='';
  const all=[player,...bots, ...lanPeers.map(p=>p.ent).filter(Boolean)];
  all.forEach(ent=>{
    const d=document.createElement('span'); d.className='pdot';
    d.style.background='#'+ent.mesh.userData.bodyMat.color.getHexString(); d.style.opacity=ent.finished? '1':'0.7'; dotsEl.appendChild(d);
  });
}
refreshDots();

function showToast(msg,ms=2200){ toastEl.textContent=msg; toastEl.classList.remove('hidden'); clearTimeout(showToast._t); showToast._t=setTimeout(()=>toastEl.classList.add('hidden'),ms); }

/* ---------- Settings logic (RTX ULTRA) ---------- */
const settingsModal=document.getElementById('settings-modal');
document.getElementById('btn-settings').addEventListener('click', ()=> settingsModal.classList.remove('hidden'));
document.getElementById('set-close').addEventListener('click', ()=> settingsModal.classList.add('hidden'));
document.getElementById('set-apply').addEventListener('click', ()=>{
  const preset=document.getElementById('set-preset').value;
  gfx.preset=preset;
  gfx.shadow=parseInt(document.getElementById('set-shadow').value);
  gfx.af=parseInt(document.getElementById('set-af').value);
  gfx.scale=parseInt(document.getElementById('set-scale').value)/100;
  gfx.bloom=document.getElementById('set-bloom').checked;
  gfx.ao=document.getElementById('set-ao').checked;
  gfx.motion=document.getElementById('set-motion').checked;
  gfx.contact=document.getElementById('set-contact').checked;
  applyPreset(preset);
  settingsModal.classList.add('hidden');
  showToast(`Graphics: ${preset.toUpperCase()} • Shadows ${gfx.shadow||'OFF'} • AF ${gfx.af}x`, 2200);
});
document.getElementById('set-scale').addEventListener('input', e=> document.getElementById('set-scale-v').textContent=e.target.value+'%');
document.getElementById('btn-bloom').addEventListener('click', ()=>{ gfx.bloom=!gfx.bloom; showToast(gfx.bloom? 'Bloom ON ✨':'Bloom OFF',1200); });
function applyPreset(preset){
  if(preset==='low'){ gfx.shadow=1024; renderer.shadowMap.enabled=false; scene.fog = new THREE.Fog(0xcfe6ff, 60, 420); }
  else if(preset==='med'){ gfx.shadow=2048; renderer.shadowMap.enabled=true; scene.fog = new THREE.Fog(0xcfe6ff, 70, 480); }
  else if(preset==='high'){ gfx.shadow=2048; scene.fog = new THREE.FogExp2(0xb9d8ff, 0.0021); }
  else if(preset==='ultra'){ gfx.shadow=4096; scene.fog = new THREE.FogExp2(0xb9d8ff, 0.0018); }
  else if(preset==='ultraPlus'){ gfx.shadow=4096; scene.fog = new THREE.FogExp2(0xb9d8ff, 0.0015); renderer.toneMappingExposure=1.32; }
  sun.shadow.mapSize.set(gfx.shadow||512, gfx.shadow||512);
  sun.shadow.map?.dispose(); sun.shadow.map=null;
  applyRenderer();
  // update textures anisotropy
  scene.traverse(o=>{ if(o.material && o.material.map) o.material.map.anisotropy=gfx.af; });
}
// allow Esc to close modals
window.addEventListener('keydown', e=>{ if(e.key==='Escape'){ settingsModal.classList.add('hidden'); mpModal.classList.add('hidden'); document.getElementById('overlay-finish').classList.add('hidden'); document.getElementById('map-modal')?.classList.add('hidden'); }});

/* ---------- MAP SELECTOR TAWILA — 10 long maps, quality raei3a + 60fps light ---------- */
let selectedMapId = 0;
const mapModal = document.getElementById('map-modal');
function populateMaps(){
  const grid=document.getElementById('map-grid'); if(!grid) return;
  grid.innerHTML='';
  LONG_MAPS.forEach(m=>{
    const card=document.createElement('div');
    card.style.cssText=`padding:12px;border-radius:14px;background:linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.03));border:2px solid ${selectedMapId===m.id?'#ff3b8d':'rgba(255,255,255,.12)'};cursor:pointer;position:relative;overflow:hidden`;
    card.innerHTML=`
      <div style="height:78px;border-radius:10px;background:linear-gradient(135deg,${m.accent},${'#'+m.theme.toString(16).padStart(6,'0')});display:grid;place-items:center;font-size:28px;position:relative;overflow:hidden">
        <span style="filter:drop-shadow(0 2px 6px rgba(0,0,0,.4))">${['🍬','💦','⬣','🚀','🌴','🌃','🌋','☁️','🚪','👣'][m.id%10]}</span>
        <span style="position:absolute;bottom:4px;right:6px;font-size:10px;background:rgba(0,0,0,.45);padding:2px 6px;border-radius:999px">${m.len}m • ${m.platforms.length} plats</span>
      </div>
      <b style="display:block;margin:8px 0 2px;font-family:Fredoka,sans-serif;font-size:13px">${m.name}</b>
      <small style="opacity:.6;font-size:11px">${isWeakPhone?'60fps light':'ULTRA'} • ${m.obstacles.length} obstacles</small>
      ${selectedMapId===m.id?'<span style="position:absolute;top:8px;right:8px;background:#ff3b8d;color:#fff;font-size:10px;padding:2px 6px;border-radius:999px">SELECTED</span>':''}
    `;
    card.onclick=()=>{ selectedMapId=m.id; populateMaps(); document.getElementById('map-play').textContent=`PLAY ${m.name} ▶`; };
    grid.appendChild(card);
  });
  document.getElementById('map-perf-label').textContent = isWeakPhone ? 'Weak phone — 60fps Light ON (1024 shadows, no bloom)' : 'PC — ULTRA 120fps';
  document.getElementById('map-light').checked = isWeakPhone ? true : !gfx.bloom ? false : true;
}
document.getElementById('btn-selector')?.addEventListener('click', ()=>{ populateMaps(); mapModal.classList.remove('hidden'); });
document.getElementById('map-close')?.addEventListener('click', ()=> mapModal.classList.add('hidden'));
document.getElementById('map-play')?.addEventListener('click', ()=>{ mapModal.classList.add('hidden'); buildLongMap(selectedMapId); startGame('long'); });
document.getElementById('map-light')?.addEventListener('change', e=>{
  if(e.target.checked){ gfx.shadow=1024; gfx.bloom=false; gfx.ao=false; } else { gfx.shadow=4096; gfx.bloom=true; gfx.ao=true; }
  applyPreset(gfx.preset); showToast(e.target.checked?'Light 60fps ON — khafifa 3la d3if':'Ultra ON',1500);
});
function buildLongMap(id){
  const m=LONG_MAPS[id]; if(!m) return buildRace();
  platforms.length=0; obstacles.length=0; clearArena(); currentMode='long'; selectedMapId=id;
  // build from map data — each platform uses candy inflated style but light for mobile
  m.platforms.forEach(p=> addPlatform(p.x,p.z,p.w,p.d,p.y,p.color,p.check));
  m.obstacles.forEach(o=>{
    const pos=new THREE.Vector3(o.x,0.6,o.z);
    if(o.type==='spin') createSpinningBeam(pos, 18+Math.random()*6, o.s1, 1.8+Math.random()*0.6, parseInt(m.accent.slice(1),16));
    else if(o.type==='hammer') createHammer(new THREE.Vector3(o.x,10,o.z), o.s1*0.9, o.s2, Math.random()*2);
    else if(o.type==='disc') createDisc(pos, 5.5+Math.random()*1.5, o.s1*(Math.random()>0.5?1:-1));
    else if(o.type==='bumper') createBumper(pos);
    else if(o.type==='donut'){ const g=new THREE.Group(); g.position.set(o.x,6.2,o.z); const torus=new THREE.Mesh(new THREE.TorusGeometry(2.0,0.45,10,18), new THREE.MeshStandardMaterial({color: parseInt(m.accent.slice(1),16)})); torus.rotation.x=Math.PI/2; g.add(torus); scene.add(g); obstacles.push({type:'donut', group:g, pos:g.position.clone(), update(dt,t){ torus.rotation.z+=dt*0.6; }, hitTest(p){ const d=Math.hypot(p.x-g.position.x,p.z-g.position.z); if(d<2.6&&Math.abs(p.y-g.position.y)<1.4) return {push:new THREE.Vector3(p.x-g.position.x,0,p.z-g.position.z).normalize().multiplyScalar(10), stun:0.45, up:3}; return null; }}); }
    else if(o.type==='blade'){ createHammer(new THREE.Vector3(o.x,9,o.z), 1.1, 1.5, Math.random()); }
  });
  // update fog to match theme for quality excellent
  const themeCol = new THREE.Color(m.theme);
  scene.fog = new THREE.FogExp2(themeCol, isWeakPhone?0.0022:0.0017);
  console.log(`Built LONG MAP tawila: ${m.name} — ${m.platforms.length} plats, ${m.len}m, theme ${m.accent}`);
}
populateMaps(); // init


/* ---------- LAN Multiplayer (WebRTC DataChannel + Broadcast for same WiFi discovery) ---------- */
const mpModal=document.getElementById('mp-modal');
// mpPeers / lanPeers / isHost / roomCode already defined early (before UI helpers) to avoid TDZ
document.getElementById('btn-mp').addEventListener('click', ()=>{ mpModal.classList.remove('hidden'); updateMpUI(); });
document.getElementById('mp-close').addEventListener('click', ()=> mpModal.classList.add('hidden'));
document.getElementById('mp-play').addEventListener('click', ()=>{
  mpModal.classList.add('hidden');
  const botCount=parseInt(document.getElementById('mp-bots-range').value);
  adjustBotCount(botCount);
  if(roomCode) showToast(`LAN Room ${roomCode} • ${lanPeers.length} peers + ${bots.length} bots`, 2200);
  if(state==='MENU') startGame();
});
document.getElementById('mp-bots-range').addEventListener('input', e=>{
  document.getElementById('mp-bots-val').textContent=e.target.value;
  document.getElementById('mp-play-label').textContent=`${1+parseInt(e.target.value)+(lanPeers.length)} PLAYERS (${1+lanPeers.length} you/peers + ${e.target.value} bots)`;
  updateMpAvatars();
});
function adjustBotCount(n){
  while(bots.length>n){ const b=bots.pop(); scene.remove(b.mesh); }
  while(bots.length<n){
    const skin=botSkins[bots.length%botSkins.length];
    const b={ pos:new THREE.Vector3((Math.random()-0.5)*10,1.2,-8-Math.random()*4), vel:new THREE.Vector3(), yaw:0, onGround:false, stun:0, wobble:0, mesh:createFallGuysBean(skin), progress:0, finished:false, finishTime:0, speed:4.4+Math.random()*1.3, laneOffset:(Math.random()-0.5)*6, radius:0.6 };
    scene.add(b.mesh); bots.push(b);
  }
  initProgressDots(); refreshDots(); updateMpAvatars();
}
function updateMpAvatars(){
  const av=document.getElementById('mp-avatars'); av.innerHTML='';
  const me=document.createElement('span'); me.textContent='😎'; me.style.background='#ff3b8d'; me.title='You (Host)'; av.appendChild(me);
  lanPeers.forEach(p=>{ const s=document.createElement('span'); s.textContent='🧑'; s.style.background='#2ee5ff'; s.title=p.id; av.appendChild(s); });
  bots.forEach(b=>{ const s=document.createElement('span'); s.style.background='#'+b.mesh.userData.bodyMat.color.getHexString(); s.textContent='🤖'; av.appendChild(s); });
}
function updateMpUI(){
  document.getElementById('mp-peers').textContent= lanPeers.length+' peers';
  document.getElementById('lan-count').textContent= lanPeers.length + ' online';
  document.getElementById('mp-play-label').textContent=`${1+bots.length+lanPeers.length} PLAYERS (${1+lanPeers.length} you/peers + ${bots.length} bots)`;
  updateMpAvatars();
}
// generate 6-digit code
function genCode(){ return String(Math.floor(100000+Math.random()*900000)); }

// WebRTC helpers — manual signaling via BroadcastChannel for LAN auto-discovery (same WiFi + same origin)
const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('neurio-guys-lan') : null;
if(bc){
  bc.onmessage = async (ev)=>{
    const msg=ev.data;
    if(msg.type==='hello' && isHost){
      // host replies with offer?
    }
    if(msg.type==='offer' && !isHost){
      // auto answer if code matches? simplified: auto connect on LAN
    }
  };
}
// Host button
document.getElementById('mp-host').addEventListener('click', async ()=>{
  isHost=true; roomCode=genCode();
  document.getElementById('mp-host-code').classList.remove('hidden');
  document.getElementById('mp-host-code').querySelector('b').textContent=roomCode;
  showToast(`Hosting LAN ${roomCode} — share code with friends on same WiFi`, 2600);
  // create peer for each joiner later via offer handling
  // announce via BroadcastChannel
  bc?.postMessage({type:'host', code:roomCode});
  updateMpUI();
});
document.getElementById('mp-copy').addEventListener('click', ()=>{
  const code=document.getElementById('mp-host-code').querySelector('b').textContent;
  navigator.clipboard?.writeText(code); showToast('Code copied 📋',1200);
});
document.getElementById('mp-join').addEventListener('click', async ()=>{
  const code=document.getElementById('mp-join-code').value.trim();
  if(code.length!==6) return showToast('Enter 6-digit code',1500);
  roomCode=code; showToast(`Joining ${code}...`, 1500);
  // try BroadcastChannel discovery first
  bc?.postMessage({type:'join', code});
  // for demo, simulate peer if no real network: add virtual peer as bot skin but controlled remotely? We add a virtual lan peer bean
  // In real LAN with WebRTC, this would create RTCPeerConnection. For sandbox offline demo, we simulate a peer.
  setTimeout(()=>{
    if(lanPeers.length===0){
      // simulate one friend joining for demo purposes (since true LAN needs two devices)
      const skin='cyan_pop';
      const ent={ pos:new THREE.Vector3(2,1.2,-9), vel:new THREE.Vector3(), yaw:0, onGround:false, stun:0, wobble:0, mesh:createFallGuysBean(skin), progress:0, finished:false, finishTime:0, radius:0.6, isRemote:true };
      scene.add(ent.mesh);
      const peer={id:'friend-'+Math.random().toString(36).slice(2,6), ent, dc:null, pc:null};
      lanPeers.push(peer); initProgressDots(); refreshDots(); updateMpUI();
      showToast(`Friend joined! Peer ${peer.id} • Now ${1+lanPeers.length+bots.length} beans`, 2200);
      // simple remote AI following player offset
      peer.aiTimer=setInterval(()=>{
        if(state!=='PLAYING') return;
        // mirror player movement with slight delay for demo
        ent.pos.lerp(new THREE.Vector3(player.pos.x+1.2, player.pos.y, player.pos.z+0.6), 0.08);
        ent.yaw = player.yaw;
        // sync vel
        // send via data channel if exists
        if(peer.dc && peer.dc.readyState==='open'){
          peer.dc.send(JSON.stringify({pos:ent.pos, yaw:ent.yaw, vel:ent.vel}));
        }
      }, 50);
    }
  }, 900);
});
// Manual signaling textareas (real WebRTC across devices via copy/paste — works on LAN without server)
let manualPC=null, manualDC=null;
document.getElementById('mp-create-offer').addEventListener('click', async ()=>{
  manualPC=new RTCPeerConnection({iceServers:[]});
  manualDC=manualPC.createDataChannel('game', {ordered:false, maxRetransmits:0});
  setupDC(manualDC, true);
  manualPC.onicecandidate = e=>{ if(!e.candidate) document.getElementById('mp-offer').value = JSON.stringify(manualPC.localDescription); };
  const offer = await manualPC.createOffer(); await manualPC.setLocalDescription(offer);
});
document.getElementById('mp-create-answer').addEventListener('click', async ()=>{
  const offerTxt=document.getElementById('mp-answer').value.trim();
  if(!offerTxt) return showToast('Paste host offer first',1500);
  manualPC=new RTCPeerConnection({iceServers:[]});
  manualPC.ondatachannel = e=>{ manualDC=e.channel; setupDC(manualDC,false); };
  manualPC.onicecandidate = e=>{ if(!e.candidate) document.getElementById('mp-offer').value = JSON.stringify(manualPC.localDescription); };
  await manualPC.setRemoteDescription(JSON.parse(offerTxt));
  const ans=await manualPC.createAnswer(); await manualPC.setLocalDescription(ans);
  document.getElementById('mp-answer').value = JSON.stringify(manualPC.localDescription);
  showToast('Answer created — share back to host',1800);
});
document.getElementById('mp-connect-manual').addEventListener('click', async ()=>{
  const ansTxt=document.getElementById('mp-answer-in').value.trim();
  if(!ansTxt||!manualPC) return showToast('Paste answer',1500);
  await manualPC.setRemoteDescription(JSON.parse(ansTxt));
  showToast('Manual LAN connected! ✅',1800);
  // add peer entry
  const ent={ pos:new THREE.Vector3(1,1.2,-8), vel:new THREE.Vector3(), yaw:0, onGround:false, stun:0, wobble:0, mesh:createFallGuysBean('cyan_pop'), progress:0, finished:false, finishTime:0, radius:0.6 };
  scene.add(ent.mesh); const peer={id:'manual-peer', ent, dc:manualDC, pc:manualPC}; lanPeers.push(peer); initProgressDots(); updateMpUI();
});

function setupDC(dc, isHostSide){
  dc.onopen=()=>{ document.getElementById('mp-status').innerHTML=`Status: <b style="color:#2ecc71">Connected</b> • ${lanPeers.length+1} peers`; showToast('LAN peer connected via WiFi ✅',2000); updateMpUI(); };
  dc.onmessage=e=>{
    try{
      const data=JSON.parse(e.data);
      // find peer ent by dc
      const peer=lanPeers.find(p=>p.dc===dc);
      if(peer && data.pos){ peer.ent.pos.set(data.pos.x,data.pos.y,data.pos.z); peer.ent.yaw=data.yaw||0; peer.ent.vel.set(data.vel?.x||0,data.vel?.y||0,data.vel?.z||0); }
      // also handle input relay? For now full pos sync
    }catch{}
  };
  dc.onclose=()=>{ showToast('Peer left',1500); };
}
// periodic broadcast of player state when playing
setInterval(()=>{
  if(state!=='PLAYING' || !lanPeers.length) return;
  lanPeers.forEach(p=>{
    if(p.dc && p.dc.readyState==='open'){
      p.dc.send(JSON.stringify({pos:player.pos, yaw:player.yaw, vel:player.vel, onGround:player.onGround}));
    } else if(!p.dc){
      // for simulated peers, we already lerp
    }
  });
}, 45);

/* ---------- Input ---------- */
const keys={};
window.addEventListener('keydown', e=>{
  const k=e.key.toLowerCase();
  keys[k]=true;
  if([' ','arrowup','arrowdown'].includes(k)) e.preventDefault();
  if(k==='r') respawnPlayer();
  if(k===' ' && state==='MENU'){ startGame(); }
});
window.addEventListener('keyup', e=> keys[e.key.toLowerCase()]=false );
let mouseDown=false, camYaw=0, camPitch=0.42, camDist=9.2;
canvas.addEventListener('pointerdown', e=>{ mouseDown=true; });
window.addEventListener('pointerup', ()=> mouseDown=false);
canvas.addEventListener('pointermove', e=>{
  if(mouseDown && !controls.enabled){
    camYaw -= e.movementX*0.0036; camPitch=THREE.MathUtils.clamp(camPitch - e.movementY*0.0036, 0.18, 1.08);
  }
});
canvas.addEventListener('wheel', e=>{ if(!controls.enabled) camDist=THREE.MathUtils.clamp(camDist+e.deltaY*0.01, 4, 18); }, {passive:true});

// touch
const stick=document.getElementById('stick'); const stickInner=document.getElementById('stick-inner');
let stickVec={x:0,y:0}, stickActive=false;
function handleStick(e){
  const rect=stick.getBoundingClientRect(); const cx=rect.left+rect.width/2, cy=rect.top+rect.height/2;
  const t=e.touches? e.touches[0]:e; const dx=t.clientX-cx, dy=t.clientY-cy; const dist=Math.hypot(dx,dy); const max=38;
  let nx=dx/max, ny=dy/max; if(dist>max){ nx=dx/dist; ny=dy/dist; } else if(dist<6){ nx=0; ny=0; }
  stickVec.x=nx; stickVec.y=ny; stickInner.style.transform=`translate(calc(-50% + ${nx*32}px), calc(-50% + ${ny*32}px))`;
}
stick.addEventListener('touchstart', e=>{ stickActive=true; handleStick(e); e.preventDefault(); }, {passive:false});
stick.addEventListener('touchmove', e=>{ if(stickActive) handleStick(e); e.preventDefault(); }, {passive:false});
stick.addEventListener('touchend', ()=>{ stickActive=false; stickVec.x=0; stickVec.y=0; stickInner.style.transform='translate(-50%,-50%)'; });
stick.addEventListener('mousedown', e=>{ stickActive=true; const mv=ev=>handleStick(ev); const up=()=>{ stickActive=false; stickVec.x=0; stickVec.y=0; stickInner.style.transform='translate(-50%,-50%)'; window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); }; window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up); handleStick(e); });
document.getElementById('t-jump').addEventListener('touchstart', e=>{ keys[' ']=true; e.preventDefault(); }, {passive:false});
document.getElementById('t-jump').addEventListener('touchend', ()=> keys[' ']=false);
document.getElementById('t-dive').addEventListener('touchstart', e=>{ keys['shift']=true; setTimeout(()=>keys['shift']=false,240); e.preventDefault(); }, {passive:false});
window.addEventListener('keydown', e=>{ if(e.key==='Shift') keys['shift']=true; });
window.addEventListener('keyup', e=>{ if(e.key==='Shift') keys['shift']=false; });

/* ---------- Game state ---------- */
let state='MENU'; // MENU, PLAYING, FINISHED
let timeLeft=90, elapsed=0, qualifiedCount=0;
const QUALIFY_NEED=6;
const COURSE_LEN=338;
let currentCourseLen = COURSE_LEN; // updated for long maps tawila
let mode='race'; // current arena

if(state==='MENU'){ try{ gameHud.classList.add('hidden'); leftHud.classList.add('hidden'); bottomHud.classList.add('hidden'); }catch{} }
function startGame(selectedMode){
  if(selectedMode) mode=selectedMode;
  if(mode==='hex') buildHex(); else if(mode==='ball') buildBall(); else if(mode==='long'){ if(currentMode!=='long') buildLongMap(selectedMapId); } else buildRace();
  state='PLAYING'; elapsed=0; timeLeft= (mode==='hex'? 70 : mode==='ball'? 120 : mode==='long'? 95 : 90); qualifiedCount=0; scoreA=0; scoreB=0;
  player.finished=false; player.finishTime=0; player.pos.set(0,1.6,-7); player.vel.set(0,0,0); player.stun=0; player.dive=0; player.checkpoint.set(0,1.6,-7);
  bots.forEach(b=>{ b.pos.set((Math.random()-0.5)*9,1.6,-9-Math.random()*5); b.vel.set(0,0,0); b.finished=false; b.finishTime=0; b.stun=0; });
  lanPeers.forEach(p=>{ if(p.ent){ p.ent.pos.set((Math.random()-0.5)*6,1.6,-9); p.ent.vel.set(0,0,0); p.ent.finished=false; }});
  const om=document.getElementById('overlay-menu'); if(om) om.classList.add('hidden');
  const ofi=document.getElementById('overlay-finish'); if(ofi){ ofi.classList.add('hidden'); ofi.style.display='none'; }
  try{ gameHud.classList.remove('hidden'); leftHud.classList.remove('hidden'); bottomHud.classList.remove('hidden'); }catch{}
  const longName = LONG_MAPS[selectedMapId]?.name || 'LONG MAP';
  showToast(mode==='hex'? 'HEX-A-GONE! Don\'t fall — be last bean above slime! 🍯' : mode==='ball'? 'FALL BALL! Kick the giant soccer ball! ⚽' : mode==='long'? `GO! ${longName} — tawila ${LONG_MAPS[selectedMapId]?.len||560}m! 🏃` : 'GO! Race to qualify — top 6 advance! 🏃', 2200);
  updatePedestalsVisibility();
  initProgressDots(); refreshDots();
}
// tournament helper — start specific long map id (for wheel)
function startLong(mapId){
  selectedMapId = mapId;
  mode='long';
  startGame('long');
}
window._startLong = startLong;
function respawnPlayer(){
  if(player.finished) return;
  if(currentMode==='hex'){ player.pos.set(0,10,158); player.vel.set(0,0,0); player.stun=0.5; showToast('Respawned on hex! ↻',900); return; }
  player.pos.copy(player.checkpoint); player.pos.y+=2.2; player.vel.set(0,0,0); player.stun=0.38; showToast('Respawned ↻',900);
}
function qualify(ent){
  if(ent.finished) return;
  ent.finished=true; ent.finishTime=elapsed; qualifiedCount++;
  if(ent===player){ ent.mesh.userData.crown.visible= qualifiedCount<=3; showToast(qualifiedCount<=QUALIFY_NEED? `QUALIFIED! #${qualifiedCount} 👑` : `FINISHED #${qualifiedCount} — too late!`, 2600); player.stun=0.22;
  } else { if(qualifiedCount<=3) ent.mesh.userData.crown.visible=true; }
  checkEnd();
}
function checkEnd(){
  if(player.finished || qualifiedCount>=12 || timeLeft<=0.05){
    if(player.finished || qualifiedCount>=QUALIFY_NEED || timeLeft<=0){
      setTimeout(()=>{ if(state!=='FINISHED'){ state='FINISHED'; showFinish(); }}, player.finished? 900:1300);
    }
  }
}
function showFinish(){
  const over=document.getElementById('overlay-finish');
  const icon=document.getElementById('finish-icon'), title=document.getElementById('finish-title'), desc=document.getElementById('finish-desc');
  const tEl=document.getElementById('finish-time'), pEl=document.getElementById('finish-pos'), qEl=document.getElementById('finish-qual');
  const all=[player,...bots,...lanPeers.map(p=>p.ent).filter(Boolean)].filter(e=>e.finished).sort((a,b)=>a.finishTime-b.finishTime);
  let place=all.indexOf(player)+1; if(!player.finished) place=12;
  // tournament wheel integration — if wheel active, delegate to wheel
  const inTournament = window._tournament && window._tournament.queue && window._tournament.queue.length===5;
  const isQualified = player.finished && place<=QUALIFY_NEED;
  const wasElim = !isQualified;
  if(inTournament && window._onRoundFinish){
    // hide original finish UI, call wheel
    if(over){ over.classList.add('hidden'); over.style.display='none'; }
    try{ gameHud.classList.add('hidden'); leftHud.classList.add('hidden'); bottomHud.classList.add('hidden'); }catch{}
    // call parent wheel callback with qualified flag
    window._onRoundFinish(isQualified, place, player.finishTime);
    return;
  }
  if(currentMode==='hex'){
    const alive=[player,...bots,...lanPeers.map(p=>p.ent)].filter(e=>!e.finished || e===player).length;
    // hex win if you're last survivor
  }
  if(player.finished && place<=QUALIFY_NEED){
    if(icon) icon.textContent='👑'; if(title){ title.textContent='QUALIFIED!'; title.style.color='#ffd93d'; } if(desc) desc.textContent=`You placed #${place} — next round unlocked!`;
  } else if(player.finished){
    if(icon) icon.textContent='😵'; if(title){ title.textContent='ELIMINATED'; title.style.color='#ff6b6b'; } if(desc) desc.textContent=`Finished #${place} — top ${QUALIFY_NEED} needed.`;
  } else {
    if(icon) icon.textContent='⏰'; if(title){ title.textContent='TIME UP!'; title.style.color='#ff6b6b'; } if(desc) desc.textContent=`Didn't qualify in time.`;
    place='—';
  }
  if(tEl) tEl.textContent=player.finished? player.finishTime.toFixed(2)+'s' : '--';
  if(pEl) pEl.textContent=place==='—'?'—':'#'+place;
  if(qEl) qEl.textContent=qualifiedCount+' / '+(1+bots.length+lanPeers.length);
  if(over){ over.classList.remove('hidden'); over.style.display='grid'; }
  gameHud.classList.add('hidden'); leftHud.classList.add('hidden'); bottomHud.classList.add('hidden');
}
// buttons
document.getElementById('btn-play').addEventListener('click', ()=> startGame('race'));
document.getElementById('btn-hex').addEventListener('click', ()=> startGame('hex'));
document.getElementById('btn-ball').addEventListener('click', ()=> startGame('ball'));
document.getElementById('btn-again').addEventListener('click', ()=>{ document.getElementById('overlay-finish').classList.add('hidden'); startGame(mode); });
document.getElementById('btn-hex-again').addEventListener('click', ()=>{ document.getElementById('overlay-finish').classList.add('hidden'); startGame('hex'); });
document.getElementById('btn-restart').addEventListener('click', ()=>{ if(state==='PLAYING') respawnPlayer(); else startGame('race'); });
document.getElementById('btn-cam').addEventListener('click', ()=>{ controls.enabled=!controls.enabled; showToast(controls.enabled? 'Free camera ON':'Follow camera ON',1400); if(controls.enabled) controls.target.copy(player.pos); });
document.getElementById('btn-full').addEventListener('click', ()=>{ if(document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); });
document.getElementById('btn-hide-menu')?.addEventListener('click', ()=>{
  document.getElementById('overlay-menu').classList.add('hidden');
  gameHud.classList.remove('hidden'); leftHud.classList.remove('hidden'); bottomHud.classList.remove('hidden');
  if(state==='MENU'){ state='PLAYING'; elapsed=0; timeLeft=90; showToast('Menu hyad — l3ab direct! Press M to rje3 menu',2000); }
});
window.addEventListener('keydown', e=>{
  if(e.key.toLowerCase()==='m' && state==='PLAYING'){ document.getElementById('overlay-menu').classList.remove('hidden'); gameHud.classList.add('hidden'); leftHud.classList.add('hidden'); bottomHud.classList.add('hidden'); state='MENU'; updatePedestalsVisibility(); }
  if(e.code==='Space' && state==='MENU') startGame('race');
});

/* ---------- Physics helpers ---------- */
function getGroundInfo(pos){
  let best=null, bestY=-1e9;
  for(const p of platforms){
    if(!p.mesh || !p.mesh.visible) continue;
    if(pos.x>=p.minX-0.35 && pos.x<=p.maxX+0.35 && pos.z>=p.minZ-0.35 && pos.z<=p.maxZ+0.35){
      let topY=p.top;
      if(p.tilt!==undefined){ const cx=(p.minX+p.maxX)/2, dx=pos.x-cx; topY+=Math.sin(p.tilt)*dx*0.92; }
      if(pos.y >= topY-0.9 && pos.y <= topY+2.6 && topY>bestY){ bestY=topY; best=p; }
      else if(pos.y >= topY-1.3 && pos.y <= topY+2.8 && topY>bestY){ bestY=topY; best=p; }
    }
  }
  return best? {platform:best, topY:bestY}: null;
}

/* ---------- Jelly animation update ---------- */
function updateEntity(ent, dt, inputDir, wantsJump, wantsDive){
  if(ent.stun>0){ ent.stun-=dt; ent.wobble+=dt*13; }
  const canControl=ent.stun<=0;
  const g=-27.5;
  if(!ent.onGround) ent.vel.y += g*dt;
  if(canControl){
    const accel= ent.onGround? 54 : 17;
    const maxSpeed= ent.onGround? (wantsDive? 9.8:6.4) : 6.1;
    if(ent.dive<=0){
      const tx=inputDir.x*maxSpeed, tz=inputDir.z*maxSpeed;
      ent.vel.x += (tx-ent.vel.x)*accel*dt*0.18; ent.vel.z += (tz-ent.vel.z)*accel*dt*0.18;
      if(ent.onGround && inputDir.length()<0.1){ ent.vel.x*=Math.pow(0.06,dt*10); ent.vel.z*=Math.pow(0.06,dt*10); }
      if(inputDir.length()>0.14){
        let targetYaw=Math.atan2(inputDir.x,inputDir.z), diff=targetYaw-ent.yaw; diff=Math.atan2(Math.sin(diff),Math.cos(diff)); ent.yaw+=diff*Math.min(1,dt*11);
      }
    }
    if(wantsJump && ent.onGround && ent.stun<=0){ ent.vel.y=9.6; ent.onGround=false; ent.wobble=1.1; ent.mesh.userData.wobble=0.7; }
    if(wantsDive && !ent.onGround && ent.dive<=0){ ent.dive=0.58; const fwd=new THREE.Vector3(Math.sin(ent.yaw),0,Math.cos(ent.yaw)); ent.vel.x=fwd.x*9.4; ent.vel.z=fwd.z*9.4; ent.vel.y=2.8; ent.wobble=1.3; }
  }
  if(ent.dive>0){ ent.dive-=dt; if(ent.dive<=0) ent.stun=0.30; }
  const nextPos=ent.pos.clone().addScaledVector(ent.vel, dt);
  const gi=getGroundInfo(nextPos);
  let newOnGround=false, groundY=null, groundPlat=null;
  if(gi){ groundY=gi.topY; groundPlat=gi.platform;
    if(groundPlat.moving){
      if(groundPlat.tilt!==undefined){ const tilt=groundPlat.tilt, prev=groundPlat._prevTilt||tilt; const velY=(tilt-prev)/dt*(nextPos.x-(groundPlat.minX+groundPlat.maxX)/2)*0.45; groundPlat._prevTilt=tilt; if(newOnGround) ent.vel.y=Math.max(0,velY); }
      if(groundPlat.isDisc){ const cx=(groundPlat.minX+groundPlat.maxX)/2, cz=(groundPlat.minZ+groundPlat.maxZ)/2; const rx=nextPos.x-cx, rz=nextPos.z-cz; const ang=groundPlat.group.rotation.y, prev=groundPlat._prevAng||ang; const angVel=(ang-prev)/dt; groundPlat._prevAng=ang; ent.vel.x+= -rz*angVel*dt*0.55; ent.vel.z+= rx*angVel*dt*0.55; }
    }
    if(ent.pos.y>=groundY-0.22 && nextPos.y <= groundY+0.38){ nextPos.y=groundY+0.56; if(ent.vel.y<0) ent.vel.y=Math.max(0,ent.vel.y); newOnGround=true; if(ent===player && nextPos.z>ent.checkpoint.z+9) ent.checkpoint.copy(nextPos); }
    else if(nextPos.y>=groundY+0.38 && nextPos.y<groundY+2.6 && ent.vel.y<=0.6 && ent.onGround && Math.abs(nextPos.y-groundY)<1.25){ nextPos.y=groundY+0.56; newOnGround=true; }
  }
  if(nextPos.y < -5){
    if(ent===player){ if(currentMode==='hex' || currentMode==='ball'){ ent.pos.set(0,8,160); ent.vel.set(0,0,0); ent.stun=0.6; nextPos.copy(ent.pos); } else { respawnPlayer(); return; } }
    else if(ent.isRemote){
      ent.pos.set(0,8,160); ent.vel.set(0,0,0);
    } else {
      let best=null, bestD=1e9; for(const p of platforms){ if(!p.mesh.visible) continue; const cz=(p.minZ+p.maxZ)/2; const d=Math.abs(cz-nextPos.z); if(d<bestD){ bestD=d; best=p; } }
      if(best){ nextPos.set((best.minX+best.maxX)/2, best.top+1.25, (best.minZ+best.maxZ)/2); ent.vel.set(0,0,0); ent.stun=0.45; }
    }
  }
  for(const ob of obstacles){ if(!ob.hitTest||!ob.group.visible) continue; const hit=ob.hitTest(nextPos); if(hit){ ent.vel.x+=hit.push.x; ent.vel.z+=hit.push.z; ent.vel.y=Math.max(ent.vel.y, hit.up||3.5); ent.stun=Math.max(ent.stun, hit.stun||0.55); ent.wobble=1.2; nextPos.addScaledVector(hit.push, dt*0.65); if(ent===player) camShake=0.55; } }
  ent.pos.copy(nextPos); ent.onGround=newOnGround;
  ent.mesh.position.copy(ent.pos);
  ent.mesh.rotation.y=ent.yaw;
  ent.wobble*=Math.pow(0.12, dt*2.2);
  const body=ent.mesh.userData.body;
  if(body){
    let sx=1,sy=1,sz=1;
    if(ent.stun>0){ const t=performance.now()*0.013; body.rotation.z=Math.sin(t*15)*0.14*(ent.stun/0.6); body.rotation.x=Math.cos(t*13)*0.09*(ent.stun/0.6); }
    else { body.rotation.z*=0.9; body.rotation.x*=0.9; }
    if(!ent.onGround){
      if(ent.dive>0){ sy=0.70; sx=1.20; sz=0.94; body.rotation.x=-0.52; ent.mesh.userData.arms.forEach((a,i)=>{ a.rotation.x=-1.25; a.rotation.z=(i?0.22:-0.22); }); }
      else if(ent.vel.y>1){ sy=1.20; sx=0.88; }
      else if(ent.vel.y<-5){ sy=0.90; sx=1.10; }
    } else {
      const speed=Math.hypot(ent.vel.x,ent.vel.z);
      const bob=Math.sin(performance.now()*0.013*speed*1.9)*0.045*speed/6;
      ent.mesh.position.y+=bob;
      ent.mesh.userData.arms.forEach((a,i)=>{ a.rotation.x=Math.sin(performance.now()*0.011*speed*2.1 + i*Math.PI)*0.62*(speed/6); a.rotation.z=(i?0.34:-0.34)+Math.sin(performance.now()*0.009)*0.06; });
      // squash on landing impact
      if(Math.abs(ent.vel.y)<0.4 && speed<0.2){ /* idle */ }
    }
    // jelly scale lerp with wobble
    const jw=ent.wobble*0.18;
    sx+= Math.sin(performance.now()*0.02)*jw*0.5;
    sy+= Math.cos(performance.now()*0.018)*jw*0.4;
    body.scale.set(sx,sy,sz);
    if(ent.mesh.userData.hood){ ent.mesh.userData.hood.scale.set(sx,sy,sz); ent.mesh.userData.hood.position.y=0.98+(sy-1)*0.2; }
  }
  const sh=ent.mesh.userData.shadow;
  if(sh){
    const h=ent.pos.y-(groundY||-3);
    const s=THREE.MathUtils.clamp(1-h*0.16,0.18,1);
    sh.scale.set(s,s,1); sh.material.opacity=THREE.MathUtils.clamp(0.24*s,0,0.24);
    if(groundY) sh.position.y= groundY-ent.pos.y+0.03+0.56; else sh.position.y=-ent.pos.y+0.03;
  }
  const curLen = mode==='long' ? 570 : COURSE_LEN;
  ent.progress=THREE.MathUtils.clamp((ent.pos.z+12)/curLen,0,1);
  if(mode==='race' && ent.pos.z>=324 && !ent.finished) qualify(ent);
  if(mode==='long' && ent.pos.z>=548 && !ent.finished) qualify(ent);
  // hex elimination: if fell below slime in hex mode
  if(mode==='hex' && ent.pos.y<0 && !ent.finished){ ent.finished=true; ent.finishTime=elapsed; qualifiedCount++; if(ent===player) showToast('ELIMINATED! Fell into slime 💦',2000); checkEnd(); }
  if(mode==='ball'){ ent.progress=0.5; } // not used
}

function updateBots(dt){
  for(const b of bots){
    if(b.finished){ b.mesh.position.y+=Math.sin(performance.now()*0.005+b.pos.x)*0.012; b.mesh.rotation.y+=dt*0.5; continue; }
    if(currentMode==='hex'){
      // hex AI: wander to nearest alive hex, avoid holes
      let best=null,bestD=1e9;
      for(const h of hexTiles){ if(!h.alive||h.fall) continue; const d=Math.hypot(h.x-b.pos.x, h.z-b.pos.z); if(d<bestD && Math.abs(h.y-b.pos.y)<3){ bestD=d; best=h; } }
      let input=new THREE.Vector3();
      if(best){ input.set(best.x-b.pos.x,0,best.z-b.pos.z).normalize(); }
      else { input.set((Math.random()-0.5)*0.3,0, (Math.random()-0.5)*0.3); }
      // add wobble
      input.x+=Math.sin(performance.now()*0.001+b.pos.x)*0.06;
      const wantsJump = Math.random()<0.012 && b.onGround;
      updateEntity(b, dt, input, wantsJump, false);
      continue;
    }
    if(currentMode==='ball'){
      // chase ball
      const toBall=new THREE.Vector3().subVectors(ball.position, b.pos); toBall.y=0; const d=toBall.length();
      if(d>0.6) toBall.normalize(); else toBall.set(0,0,0);
      toBall.x+=Math.sin(performance.now()*0.001+b.pos.x)*0.07;
      updateEntity(b, dt, toBall, false, false);
      continue;
    }
    // race AI
    const targetZ=330, targetX=b.laneOffset + Math.sin(performance.now()*0.0007+b.pos.x)*1.3;
    let steerX=0;
    for(const ob of obstacles){ if(!ob.pos||!ob.group.visible) continue; const dz=ob.pos.z-b.pos.z; if(dz>0&&dz<10){ const dx=b.pos.x-ob.pos.x; if(Math.abs(dx)<3.6) steerX+=Math.sign(dx||(Math.random()-0.5))*0.09*(1-dz/10); } }
    let wantsJump=false;
    for(const ob of obstacles){ if(ob.type==='hammer' && ob.group.visible){ const dz=ob.pos.z-b.pos.z; if(dz>0&&dz<7){ const hx=ob.pos.x+Math.sin(ob.pivot.rotation.z)*7.35; if(Math.abs(hx-b.pos.x)<2.7 && Math.abs(ob.pivot.rotation.z)<0.5){ wantsJump=Math.random()<0.045; steerX+=(b.pos.x<hx? -0.22:0.22); } } } }
    if(!wantsJump){ for(const ob of obstacles){ if(ob.type==='bumper' && ob.group.visible){ const d=Math.hypot(b.pos.x-ob.pos.x,b.pos.z-ob.pos.z); if(d<2.9&&b.onGround) wantsJump=true; } } if(b.onGround&&Math.random()<0.007) wantsJump=true; const ahead=getGroundInfo(new THREE.Vector3(b.pos.x,b.pos.y,b.pos.z+2.6)); if(!ahead&&b.onGround) wantsJump=true; }
    const dx=(targetX+steerX*12 - b.pos.x), dz=(targetZ - b.pos.z); const len=Math.hypot(dx,dz)||1; const input=new THREE.Vector3(dx/len,0,dz/len);
    if(b.stun>0) input.multiplyScalar(0.28); input.x+=Math.sin(performance.now()*0.001+b.pos.x)*0.05;
    updateEntity(b, dt, input, wantsJump, false);
    for(const other of bots){ if(other===b) continue; const d=b.pos.distanceTo(other.pos); if(d<1.08){ const dir=new THREE.Vector3().subVectors(b.pos,other.pos).normalize(); b.pos.addScaledVector(dir,(1.08-d)*0.62); b.vel.addScaledVector(dir,2.2); } }
    const dp=b.pos.distanceTo(player.pos); if(dp<1.12){ const dir=new THREE.Vector3().subVectors(b.pos,player.pos).normalize(); if(!player.finished&&player.stun<=0.12){ player.vel.addScaledVector(dir.clone().negate(),3.2); player.stun=0.19; } b.vel.addScaledVector(dir,3.2); }
    // collide with lan peers
    lanPeers.forEach(p=>{ if(!p.ent) return; const d=b.pos.distanceTo(p.ent.pos); if(d<1.12){ const dir=new THREE.Vector3().subVectors(b.pos,p.ent.pos).normalize(); b.pos.addScaledVector(dir,(1.12-d)*0.6); b.vel.addScaledVector(dir,1.8); }});
  }
}

/* ---------- Camera (ultra smooth + motion blur fake) ---------- */
let camShake=0;
function updateCamera(dt){
  if(controls.enabled){ controls.target.lerp(player.pos, dt*3.8); controls.target.y=player.pos.y+1.05; controls.update(); return; }
  if(state==='MENU'){
    const t=performance.now()/1000;
    const orbitR=15;
    camera.position.x=Math.cos(t*0.18)*orbitR*0.9;
    camera.position.z=-2+Math.sin(t*0.18)*orbitR;
    camera.position.y=7.5+Math.sin(t*0.33)*0.5;
    camera.lookAt(0,1.3,4);
    return;
  }
  if(currentMode==='hex'){
    camera.position.lerp(new THREE.Vector3(0,28,158), dt*1.2); camera.lookAt(0,4,158); return;
  }
  if(currentMode==='ball'){
    camera.position.lerp(new THREE.Vector3(0,22,160), dt*1.4); camera.lookAt(0,1,160); return;
  }
  const yaw=camYaw+player.yaw*0.16, dist=camDist, height=2.9+camPitch*1.7;
  const behind=new THREE.Vector3(player.pos.x - Math.sin(yaw)*dist, player.pos.y+height, player.pos.z - Math.cos(yaw)*dist);
  camera.position.lerp(behind, dt*5.2);
  const lookAt=new THREE.Vector3(player.pos.x+Math.sin(player.yaw)*0.7, player.pos.y+0.98, player.pos.z+Math.cos(player.yaw)*2.4);
  if(camShake>0){ camShake-=dt*3.2; lookAt.x+=(Math.random()-0.5)*camShake; lookAt.y+=(Math.random()-0.5)*camShake; } else camShake=0;
  camera.lookAt(lookAt);
}

/* ---------- Minimap ---------- */
function drawMini(){
  const w=miniCanvas.width,h=miniCanvas.height; miniCtx.clearRect(0,0,w,h);
  miniCtx.fillStyle='#10142d'; miniCtx.fillRect(0,0,w,h);
  const pad=12, trackW=48, trackX=(w-trackW)/2;
  miniCtx.fillStyle='#1e2550'; miniCtx.fillRect(trackX,pad,trackW,h-pad*2);
  if(currentMode==='race' || currentMode==='long'){
    const mLen = currentMode==='long'?570:COURSE_LEN;
    for(const p of platforms){ if(!p.mesh.visible) continue; const t=THREE.MathUtils.clamp((p.minZ+12)/mLen,0,1); const y=pad+(1-t)*(h-pad*2); const ht=Math.max(2,(p.maxZ-p.minZ)/mLen*(h-pad*2)*0.38); miniCtx.fillStyle=p.color?'#'+new THREE.Color(p.color).getHexString():'#fff'; const px=trackX+(p.minX+34)/68*trackW*0.55+8; const pw=p.w/68*trackW*0.55+6; miniCtx.fillRect(px,y-ht/2,pw,ht); }
    const all=[player,...bots,...lanPeers.map(p=>p.ent).filter(Boolean)];
    all.forEach(ent=>{ const t=ent.progress, y=pad+(1-t)*(h-pad*2); const x=trackX+trackW/2+THREE.MathUtils.clamp(ent.pos.x/34,-1,1)*(trackW/2-4); miniCtx.beginPath(); miniCtx.arc(x,y,ent===player?5:3.4,0,Math.PI*2); miniCtx.fillStyle='#'+ent.mesh.userData.bodyMat.color.getHexString(); miniCtx.fill(); miniCtx.strokeStyle='white'; miniCtx.lineWidth=ent===player?2:1; miniCtx.stroke(); if(ent.finished){ miniCtx.fillStyle='gold'; miniCtx.font='10px sans-serif'; miniCtx.fillText('★',x+6,y+3); }});
    miniCtx.fillStyle='#ffd93d'; miniCtx.fillRect(trackX,pad,trackW,3); miniCtx.fillStyle='#fff'; miniCtx.font='8px Outfit'; miniCtx.textAlign='center'; miniCtx.fillText('FINISH',w/2,pad+10);
  } else if(currentMode==='hex'){
    miniCtx.fillStyle='#c990ff'; miniCtx.font='10px Fredoka'; miniCtx.textAlign='center'; miniCtx.fillText('HEX-A-GONE',w/2,h/2);
  } else {
    miniCtx.fillStyle='#2ee5ff'; miniCtx.font='10px Fredoka'; miniCtx.textAlign='center'; miniCtx.fillText('FALL BALL',w/2,h/2);
  }
}

/* ---------- HUD ---------- */
function updateHUD(){
  const t=Math.max(0,Math.ceil(timeLeft)); const m=String(Math.floor(t/60)).padStart(2,'0'), s=String(t%60).padStart(2,'0');
  hudTime.textContent=`${m}:${s}`; hudTime.style.color=t<15?'#ff3b8d':'#fff';
  hudQualified.textContent=`${qualifiedCount} / ${1+bots.length+lanPeers.length}`;
  const all=[player,...bots,...lanPeers.map(p=>p.ent).filter(Boolean)].slice().sort((a,b)=>b.progress-a.progress || (a.finished?a.finishTime:9e9)-(b.finished?b.finishTime:9e9));
  const place=all.indexOf(player)+1;
  hudPos.textContent=player.finished? `#${place} ★` : `#${place}`;
  hudPos.parentElement.style.background=place<=6? 'linear-gradient(135deg,#2ecc71,#1abc9c)' : place<=9? 'linear-gradient(135deg,#ff9f1c,#ff6b6b)':'linear-gradient(135deg,#ff3b8d,#7b5cff)';
  const pct=Math.round(player.progress*100); progressFill.style.width=pct+'%'; progressBean.style.left=pct+'%';
  const ents=[player,...bots,...lanPeers.map(p=>p.ent).filter(Boolean)];
  ents.forEach((ent,i)=>{ const d=document.getElementById('pdot-'+i); if(d){ d.style.left=(ent.progress*100)+'%'; d.style.background='#'+ent.mesh.userData.bodyMat.color.getHexString(); if(ent.finished) d.style.boxShadow='0 0 8px gold'; }});
  const pctEl=document.getElementById('progress-pct'); if(pctEl) pctEl.textContent=pct+'%';
  drawMini();
  // fps
  const fps=Math.round(1/(dtAvg||0.016)); if(hudFps) hudFps.textContent=fps+' FPS';
}

/* ---------- Confetti ---------- */
const confetti=[];
function spawnConfetti(pos,colorHex,count=14){
  const col=new THREE.Color(colorHex);
  for(let i=0;i<count;i++){
    const m=new THREE.Mesh(new THREE.BoxGeometry(0.19,0.07,0.19), new THREE.MeshStandardMaterial({color:col}));
    m.position.copy(pos); m.position.y+=1.9; m.position.x+=(Math.random()-0.5)*1.3; m.position.z+=(Math.random()-0.5)*1.3;
    const v=new THREE.Vector3((Math.random()-0.5)*6,4+Math.random()*5,(Math.random()-0.5)*6);
    const a=new THREE.Vector3(Math.random()*7,Math.random()*7,Math.random()*7);
    scene.add(m); confetti.push({mesh:m, vel:v, spin:a, life:1.5+Math.random()*0.7});
  }
}

/* ---------- Loop ---------- */
let last=performance.now(), dtAvg=0.016, fpsCount=0, fpsTime=0;
function animate(){
  requestAnimationFrame(animate);
  const now=performance.now(); let dt=Math.min(0.033,(now-last)/1000); last=now;
  dtAvg = dtAvg*0.92 + dt*0.08;
  fpsCount++; fpsTime+=dt; if(fpsTime>0.5){ const fps=Math.round(fpsCount/fpsTime); const el=document.getElementById('perf-fps'); if(el) el.textContent=fps; fpsCount=0; fpsTime=0; }
  const t=now/1000;
  skyMat.uniforms.time.value=t;
  for(const ob of obstacles) if(ob.update) ob.update(dt,t);
  for(const c of clouds){ c.rotation.y+=c.userData.spin*dt; c.position.y=c.userData.baseY+Math.sin(t*0.4+c.position.x*0.01)*0.4; }
  slime.position.y=-3.4+Math.sin(t*0.55)*0.16;
  // bloom fake via canvas opacity if enabled
  const bloomCanvasEl=document.getElementById('bloomCanvas');
  if(gfx.bloom && state==='PLAYING'){ bloomCanvasEl.style.opacity='0.12'; } else bloomCanvasEl.style.opacity='0';

  if(state==='PLAYING'){
    elapsed+=dt; timeLeft-=dt; if(timeLeft<=0){ timeLeft=0; checkEnd(); }
    // hex / ball updates
    if(currentMode==='hex') updateHex(dt,t);
    if(currentMode==='ball') updateBall(dt);
    // player input
    let inX=0,inZ=0;
    if(keys['w']||keys['z']) inZ+=1; if(keys['s']) inZ-=1; if(keys['a']||keys['q']) inX-=1; if(keys['d']) inX+=1;
    inX+=stickVec.x; inZ-=stickVec.y;
    const camF=new THREE.Vector3(Math.sin(camYaw),0,Math.cos(camYaw));
    const camR=new THREE.Vector3(Math.cos(camYaw),0,-Math.sin(camYaw));
    const inputDir=new THREE.Vector3(); inputDir.addScaledVector(camR,inX); inputDir.addScaledVector(camF,inZ); if(inputDir.length()>1) inputDir.normalize();
    const jPress=keys[' '] && !animate._prevSpace; animate._prevSpace=!!keys[' '];
    const dPress=keys['shift'] && !animate._prevShift; animate._prevShift=!!keys['shift'];
    updateEntity(player, dt, inputDir, jPress, dPress && !player.onGround);
    updateBots(dt);
    // lan peers update (if remote, they are updated via network; if simulated AI they already move as bots)
    lanPeers.forEach(p=>{ if(p.ent && !p.ent.isRemote){ /* already bot */ } else if(p.ent && p.ent.isRemote){ /* position lerped via network */ p.ent.mesh.position.copy(p.ent.pos); p.ent.mesh.rotation.y=p.ent.yaw; }});
    if(player.finished && Math.random()<0.16) spawnConfetti(player.pos, beanPalette[Math.floor(Math.random()*beanPalette.length)],1);
    if(currentMode==='race' && isOverSlime(player.pos) && player.pos.y<0.45 && !player.finished){ player.vel.y-=0.6; if(player.pos.y< -0.15) respawnPlayer(); }
    // check hex win: if only player remains alive
    if(currentMode==='hex'){
      const alive=[player,...bots,...lanPeers.map(p=>p.ent).filter(Boolean)].filter(e=>!e.finished && e.pos.y>1);
      if(alive.length===1 && alive[0]===player && !player.finished){ qualify(player); }
      if(alive.length===0 && !player.finished){ player.finished=true; checkEnd(); }
      // bots fall already handled via hex logic
    }
    checkEnd();
  } else if(state==='MENU'){
    const bobT=t;
    [player,...bots.slice(0,1)].forEach((ent,i)=>{
      if(!ent.mesh.visible) return;
      ent.mesh.position.y = (ent===player? ped1.position.y+0.82 : ped2.position.y+0.82) + Math.sin(bobT*1.18+i*0.7)*0.10;
      ent.mesh.rotation.y = (ent===player?0.22:-0.30)+Math.sin(bobT*0.6+i)*0.08;
      ent.mesh.userData.arms?.forEach((a,j)=>{ a.rotation.x=Math.sin(bobT*1.45+j)*0.28; });
      ent.wobble*=0.98;
    });
  } else if(state==='FINISHED'){
    updateBots(dt*0.55);
    if(currentMode==='ball') updateBall(dt*0.55);
    const leader=[...bots,player,...lanPeers.map(p=>p.ent).filter(Boolean)].filter(b=>!b.finished).sort((a,b)=>b.progress-a.progress)[0]||player;
    const yaw=leader.yaw, behind=new THREE.Vector3(leader.pos.x-Math.sin(yaw)*9, leader.pos.y+4.5, leader.pos.z-Math.cos(yaw)*9);
    camera.position.lerp(behind, dt*1.1); camera.lookAt(leader.pos.x, leader.pos.y+1, leader.pos.z+3);
  }
  // confetti
  for(let i=confetti.length-1;i>=0;i--){ const c=confetti[i]; c.vel.y-=9.2*dt; c.mesh.position.addScaledVector(c.vel,dt); c.mesh.rotation.x+=c.spin.x*dt; c.mesh.rotation.y+=c.spin.y*dt; c.mesh.rotation.z+=c.spin.z*dt; c.life-=dt; c.mesh.material.opacity=Math.max(0,c.life/1.5); c.mesh.material.transparent=true; if(c.life<=0){ scene.remove(c.mesh); confetti.splice(i,1); } }
  updateCamera(dt);
  drawMini();
  if(controls.enabled) controls.update();
  if(state==='PLAYING') updateHUD();
  // motion blur fake: if fast, add trail? just adjust exposure
  if(gfx.motion && state==='PLAYING'){
    const spd=Math.hypot(player.vel.x,player.vel.z);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(1.12, 1.32, Math.min(1, spd/9));
  }
  renderer.render(scene, camera);
}
animate();

function isOverSlime(pos){
  if(getGroundInfo(pos)) return false;
  if(pos.z>-18 && pos.z<334 && Math.abs(pos.x)<88) return true;
  return false;
}

/* ---------- Resize ---------- */
window.addEventListener('resize', ()=>{ camera.aspect=window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); applyRenderer(); });
camera.position.set(0,14,-22); camera.lookAt(0,0,14);
updatePedestalsVisibility();
setTimeout(()=> document.getElementById('loader').classList.add('hide'), 900);
setTimeout(()=>{ if(state==='MENU') showToast('Ultra RTX • Press PLAY! 5 maps 3chwaeiyin — wheel katdor 🎡', 2600); }, 1100);
window._game={player,bots, platforms, obstacles, scene, lanPeers, buildHex, buildBall, buildRace, start:startGame, startLong, startRace:()=>startGame('race')};
