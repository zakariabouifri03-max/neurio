// ── Carton Craft — Realistic Cardboard Builder  ──────────────────────────
import * as THREE from 'three';

// dev error overlay
addEventListener('error', e=>{
  const el=document.getElementById('errLog');
  el.style.display='block';
  el.textContent='⚠️ '+e.message+` ${e.filename?.split('/').pop()}:${e.lineno}`;
});

// ——— Utilities ———
const $ = id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;

// ——— Textures ———
function makeCanvas(w,h,fn){
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const g=c.getContext('2d'); fn(g,w,h);
  const t=new THREE.CanvasTexture(c);
  t.colorSpace=THREE.SRGBColorSpace;
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.anisotropy=4;
  return t;
}

function makeKraftTexture(){
  return makeCanvas(512,512,(g,w,h)=>{
    g.fillStyle='#d4b48e'; g.fillRect(0,0,w,h);
    // fibers
    for(let i=0;i<9000;i++){
      const x=Math.random()*w, y=Math.random()*h;
      const len= 2+Math.random()*10, wid= Math.random()*0.8+0.3;
      const a= Math.random()*Math.PI;
      g.fillStyle=`rgba(${90+Math.random()*40|0},${70+Math.random()*30|0},${45+Math.random()*25|0},${0.04+Math.random()*0.07})`;
      g.beginPath();
      g.ellipse(x,y,len,wid,a,0,Math.PI*2); g.fill();
    }
    // subtle noise
    for(let i=0;i<3000;i++){
      g.fillStyle=`rgba(0,0,0,${Math.random()*0.03})`;
      g.fillRect(Math.random()*w, Math.random()*h, 1,1);
    }
    // paper speckles light
    for(let i=0;i<1200;i++){
      g.fillStyle=`rgba(255,255,255,${0.04+Math.random()*0.05})`;
      g.fillRect(Math.random()*w, Math.random()*h, Math.random()*2+0.5, Math.random()*2+0.5);
    }
  });
}
function makeCorrugatedTexture(){
  return makeCanvas(512,512,(g,w,h)=>{
    g.fillStyle='#c9a67a'; g.fillRect(0,0,w,h);
    // vertical corrugated flutes
    const flutes=32;
    const fw=w/flutes;
    for(let i=0;i<flutes;i++){
      const x=i*fw;
      const grad=g.createLinearGradient(x,0,x+fw,0);
      grad.addColorStop(0,'rgba(0,0,0,0.18)');
      grad.addColorStop(0.25,'rgba(255,255,255,0.12)');
      grad.addColorStop(0.5,'rgba(0,0,0,0.08)');
      grad.addColorStop(0.75,'rgba(255,255,255,0.06)');
      grad.addColorStop(1,'rgba(0,0,0,0.15)');
      g.fillStyle=grad;
      g.fillRect(x,0,fw,h);
      // highlight line
      g.fillStyle='rgba(255,255,255,0.08)';
      g.fillRect(x+fw*0.3,0,1,h);
    }
    // horizontal shadow every few cm to show waves
    g.fillStyle='rgba(80,50,20,0.06)';
    for(let y=0;y<h;y+=16){
      g.fillRect(0,y,w,1);
    }
  });
}
function makeWoodTexture(){
  return makeCanvas(1024,512,(g,w,h)=>{
    g.fillStyle='#8d6e63'; g.fillRect(0,0,w,h);
    // planks
    const planks=6; const ph=h/planks;
    for(let p=0;p<planks;p++){
      const y=p*ph;
      // plank base
      const shade = 0.92 + Math.random()*0.12;
      g.fillStyle=`rgba(${Math.floor(141*shade)},${Math.floor(110*shade)},${Math.floor(99*shade)},1)`;
      g.fillRect(0,y,w,ph);
      // wood grain
      for(let i=0;i<80;i++){
        const gx=Math.random()*w, gy=y+Math.random()*ph;
        g.strokeStyle=`rgba(60,40,20,${0.05+Math.random()*0.08})`;
        g.lineWidth=0.5+Math.random()*1.2;
        g.beginPath();
        let lx=gx, ly=gy;
        g.moveTo(lx,ly);
        for(let k=0;k<5;k++){
          lx+= (Math.random()-0.5)*60 + 40;
          ly+= (Math.random()-0.5)*2;
          g.lineTo(lx,ly);
        }
        g.stroke();
      }
      // plank gap
      g.fillStyle='rgba(30,20,10,0.25)';
      g.fillRect(0,y+ph-3,w,3);
      g.fillStyle='rgba(255,255,255,0.15)';
      g.fillRect(0,y,w,1);
    }
  });
}
function makeCardboardEdgeTexture(){
  return makeCanvas(512,64,(g,w,h)=>{
    g.fillStyle='#b08968'; g.fillRect(0,0,w,h);
    // wavy corrugation side view
    g.fillStyle='#9c6644';
    g.beginPath();
    g.moveTo(0, h/2);
    for(let x=0;x<=w;x+=4){
      const y= h/2 + Math.sin(x*0.18)* (h*0.35);
      g.lineTo(x,y);
    }
    g.lineTo(w, h); g.lineTo(0,h); g.closePath(); g.fill();
    g.fillStyle='#e6ccb2';
    g.beginPath();
    g.moveTo(0, h*0.15);
    for(let x=0;x<=w;x+=4){
      const y= h*0.5 + Math.sin(x*0.18)* (h*0.35) - h*0.35;
      g.lineTo(x,y);
    }
    g.lineTo(w,0); g.lineTo(0,0); g.closePath(); g.fill();
  });
}

// ——— Piece definitions ———
const PIECE_TYPES = [
  { id:'sheetBig', name:'ورقة كبيرة', en:'Large Sheet', icon:'📄', size:[2.2,0.04,1.4], kind:'sheet', color:'#d7b48e', price:0, desc:'2.2m × 1.4m' },
  { id:'sheetMed', name:'ورقة متوسطة', en:'Medium Sheet', icon:'📃', size:[1.4,0.04,0.9], kind:'sheet', color:'#d2a679', desc:'1.4m × 0.9m' },
  { id:'sheetSmall', name:'ورقة صغيرة', en:'Small Sheet', icon:'🗒️', size:[0.8,0.04,0.6], kind:'sheet', color:'#c9a67a', desc:'0.8m × 0.6m' },
  { id:'boxClosed', name:'صندوق مسدود', en:'Closed Box', icon:'📦', size:[0.9,0.6,0.7], kind:'boxClosed', desc:'0.9×0.6×0.7m' },
  { id:'boxOpen', name:'صندوق مفتوح', en:'Open Box', icon:'📭', size:[0.9,0.5,0.7], kind:'boxOpen', desc:'مفتوح من فوق' },
  { id:'boxLong', name:'صندوق طويل', en:'Tall Box', icon:'🧱', size:[0.6,1.2,0.6], kind:'boxClosed', desc:'عمود 1.2m' },
  { id:'tube', name:'أنبوب كرطون', en:'Tube', icon:'🧻', size:[0.5,1.0,0.5], kind:'tube', desc:'قطر 0.5m' },
  { id:'plank', name:'لوحة سميكة', en:'Thick Plank', icon:'🪵', size:[1.6,0.08,0.25], kind:'plank', desc:'1.6m عارضة' },
  { id:'corner', name:'زاوية L', en:'L Corner', icon:'📐', size:[1.0,1.0,0.04], kind:'corner', desc:'زاوية 1m' },
  { id:'ramp', name:'منحدر', en:'Ramp', icon:'📈', size:[1.4,0.04,0.8], kind:'ramp', desc:'منحدر' },
];

let selectedId = 'sheetBig';
let rotationY = 0;
let heightOffset = 0;
let snapOn = true;
let physicsEnabled = false;

// ——— Scene setup ———
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a120c);
scene.fog = new THREE.Fog(0x1a120c, 18, 42);

const camera = new THREE.PerspectiveCamera(62, innerWidth/innerHeight, 0.1, 100);
camera.position.set(6,5,8);

const renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.05;
renderer.outputColorSpace=THREE.SRGBColorSpace;
$('app').appendChild(renderer.domElement);

// Lights
scene.add(new THREE.HemisphereLight(0xffe0b2, 0x3e2723, 1.1));
const dir = new THREE.DirectionalLight(0xfff8e1, 1.6);
dir.position.set(6,10,4);
dir.castShadow=true;
dir.shadow.mapSize.set(2048,2048);
dir.shadow.camera.near=0.5; dir.shadow.camera.far=30;
dir.shadow.camera.left=-12; dir.shadow.camera.right=12; dir.shadow.camera.top=12; dir.shadow.camera.bottom=-12;
dir.shadow.bias=-0.0005;
scene.add(dir);
const fill = new THREE.DirectionalLight(0xffcc80, 0.5); fill.position.set(-4,6,-3); scene.add(fill);
scene.add(new THREE.AmbientLight(0xffe0b2, 0.35));

// Textures & Materials
const kraftTex = makeKraftTexture(); kraftTex.repeat.set(1,1);
const corrTex = makeCorrugatedTexture(); corrTex.repeat.set(1,1);
const woodTex = makeWoodTexture(); woodTex.repeat.set(2,2);
const edgeTex = makeCardboardEdgeTexture(); edgeTex.repeat.set(2,1);

const matKraft = new THREE.MeshStandardMaterial({ map:kraftTex, color:0xffffff, roughness:0.88, metalness:0.0 });
const matKraftDark = new THREE.MeshStandardMaterial({ map:kraftTex, color:0xd8c0a0, roughness:0.9 });
const matCorr = new THREE.MeshStandardMaterial({ map:corrTex, color:0xffffff, roughness:0.85, metalness:0.02 });
const matEdge = new THREE.MeshStandardMaterial({ map:edgeTex, color:0xffffff, roughness:0.9 });
const matWood = new THREE.MeshStandardMaterial({ map:woodTex, roughness:0.75, metalness:0.02 });
const matTape = new THREE.MeshStandardMaterial({ color:0xc49a6c, roughness:0.6, transparent:true, opacity:0.9 });

// Ground — large workshop floor
const groundGeo = new THREE.PlaneGeometry(40,40);
const groundMat = new THREE.MeshStandardMaterial({ map:woodTex, color:0xffffff, roughness:0.8, metalness:0.05 });
const ground = new THREE.Mesh(groundGeo, matWood);
ground.rotation.x=-Math.PI/2;
ground.receiveShadow=true;
scene.add(ground);
// grid helper subtle
const grid = new THREE.GridHelper(20,20,0x5d4037,0x8d6e63); grid.position.y=0.01; scene.add(grid);
// table edge shadow decal
const table = new THREE.Mesh(new THREE.BoxGeometry(12,0.12,12), new THREE.MeshStandardMaterial({ color:0x5d4037, roughness:0.85 }));
table.position.y=-0.06; table.receiveShadow=true; scene.add(table);

// walls distant
const wallMat = new THREE.MeshStandardMaterial({ color:0x2a1d14, roughness:0.95 });
const wallBack = new THREE.Mesh(new THREE.PlaneGeometry(40,12), wallMat); wallBack.position.set(0,6,-12); scene.add(wallBack);
const wallSide = new THREE.Mesh(new THREE.PlaneGeometry(40,12), wallMat); wallSide.rotation.y=Math.PI/2; wallSide.position.set(-15,6,0); scene.add(wallSide);
// windows light
for(let i=0;i<3;i++){
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2,3), new THREE.MeshStandardMaterial({ color:0xffe0b2, emissive:0xffcc80, emissiveIntensity:0.6 }));
  win.position.set(-14.9,5,-6+i*5); win.rotation.y=Math.PI/2; scene.add(win);
  const glow = new THREE.PointLight(0xffcc80, 8, 10); glow.position.set(-12,5,-6+i*5); scene.add(glow);
}

// ——— Simple Orbit Controls ———
class SimpleOrbit{
  constructor(camera, dom){
    this.camera=camera; this.dom=dom;
    this.target=new THREE.Vector3(0,0.6,0);
    this.yaw= -0.7; this.pitch=0.65; this.dist=9;
    this.minDist=1.5; this.maxDist=22;
    this.minPitch=0.05; this.maxPitch=1.45;
    this.panX=0; this.panZ=0;
    this.dragging=false; this.mode=null; this.lastX=0; this.lastY=0;
    this.damping=0.08;
    dom.addEventListener('pointerdown', e=>{
      if(e.button===2 || (e.shiftKey && e.button===0)){ this.mode='pan'; } else if(e.button===0){ this.mode='orbit'; } else return;
      this.dragging=true; this.lastX=e.clientX; this.lastY=e.clientY; dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', e=>{
      if(!this.dragging) return;
      const dx=e.clientX-this.lastX, dy=e.clientY-this.lastY;
      this.lastX=e.clientX; this.lastY=e.clientY;
      if(this.mode==='orbit'){
        this.yaw -= dx*0.004; this.pitch += dy*0.004;
        this.pitch=clamp(this.pitch,this.minPitch,this.maxPitch);
      } else if(this.mode==='pan'){
        const s=this.dist*0.0012;
        const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0), new THREE.Vector3().subVectors(camera.position,this.target).normalize()).normalize();
        const fwd=new THREE.Vector3().subVectors(this.target,camera.position).normalize(); fwd.y=0; fwd.normalize();
        this.target.addScaledVector(right, -dx*s*1.2);
        this.target.addScaledVector(fwd, dy*s*1.2);
      }
    });
    dom.addEventListener('pointerup', e=>{
      this.dragging=false; dom.releasePointerCapture(e.pointerId);
    });
    dom.addEventListener('wheel', e=>{
      e.preventDefault();
      this.dist = clamp(this.dist + e.deltaY*0.01, this.minDist, this.maxDist);
    }, {passive:false});
    dom.addEventListener('contextmenu', e=>e.preventDefault());
    // touch pinch zoom
    let lastTouchDist=0;
    dom.addEventListener('touchstart', e=>{
      if(e.touches.length===2){
        lastTouchDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
      }
    }, {passive:false});
    dom.addEventListener('touchmove', e=>{
      if(e.touches.length===2){
        e.preventDefault();
        const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
        this.dist = clamp(this.dist - (d-lastTouchDist)*0.02, this.minDist, this.maxDist);
        lastTouchDist=d;
      }
    }, {passive:false});
  }
  update(){
    const sinY=Math.sin(this.yaw), cosY=Math.cos(this.yaw);
    const sinP=Math.sin(this.pitch), cosP=Math.cos(this.pitch);
    const off=new THREE.Vector3(sinY*cosP, sinP, cosY*cosP).multiplyScalar(this.dist);
    const desired = new THREE.Vector3().copy(this.target).add(off);
    camera.position.lerp(desired, 0.18);
    camera.lookAt(this.target);
  }
}
const controls = new SimpleOrbit(camera, renderer.domElement);

// ——— Piece Builder ———
function createPieceMesh(type){
  const g=new THREE.Group();
  const s=type.size;
  const w=s[0], h=s[1], d=s[2];

  function box(w,h,d, mat){
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
    m.castShadow=true; m.receiveShadow=true; return m;
  }
  function plane(w,h, mat){
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h), mat);
    m.castShadow=true; m.receiveShadow=true; return m;
  }

  if(type.kind==='sheet'){
    // main sheet + edge flutes visible on sides
    const main=box(w,h,d, matKraft); g.add(main);
    // edge strips with corrugation
    const edgeThick=0.02;
    const e1=box(w, h*1.1, edgeThick, matCorr); e1.position.z= d/2; g.add(e1);
    const e2=e1.clone(); e2.position.z=-d/2; g.add(e2);
    const e3=box(edgeThick, h*1.1, d, matCorr); e3.position.x= w/2; g.add(e3);
    const e4=e3.clone(); e4.position.x=-w/2; g.add(e4);
    // tape strips on top
    if(w>1){
      const tape=box(w*0.08, 0.005, d*0.9, matTape); tape.position.y=h/2+0.003; g.add(tape);
    }
  } else if(type.kind==='plank'){
    const main=box(w,h,d, matKraft); g.add(main);
    const edge=box(w, h*0.95, 0.015, matCorr); edge.position.z=d/2; g.add(edge);
    const edge2=edge.clone(); edge2.position.z=-d/2; g.add(edge2);
  } else if(type.kind==='boxClosed'){
    const th=0.04;
    // bottom
    const bot=box(w,th,d, matKraft); bot.position.y=-h/2+th/2; g.add(bot);
    const top=box(w,th,d, matKraft); top.position.y=h/2-th/2; g.add(top);
    // sides
    const front=box(w, h-th*2, th, matKraft); front.position.z=d/2-th/2; g.add(front);
    const back=front.clone(); back.position.z=-d/2+th/2; g.add(back);
    const left=box(th, h-th*2, d-th*2, matKraft); left.position.x=-w/2+th/2; g.add(left);
    const right=left.clone(); right.position.x=w/2-th/2; g.add(right);
    // inner corrugation visible via inner planes
    const innerF=plane(w*0.9, h*0.7, matCorr); innerF.position.z=d/2-th-0.01; innerF.rotation.y=Math.PI; // inside
    // tape on top
    const tape1=box(w*0.12,0.006,d*0.95, matTape); tape1.position.y=h/2+0.004; g.add(tape1);
    const tape2=box(w*0.95,0.006,d*0.12, matTape); tape2.position.y=h/2+0.004; g.add(tape2);
    // edges corrugated outer small
    const edgeV=box(th, h, 0.015, matEdge); edgeV.position.set(w/2,0,d/2); g.add(edgeV);
  } else if(type.kind==='boxOpen'){
    const th=0.04;
    const bot=box(w,th,d, matKraft); bot.position.y=-h/2+th/2; g.add(bot);
    const front=box(w,h,th, matKraft); front.position.z=d/2-th/2; front.position.y=th/2; g.add(front);
    const back=front.clone(); back.position.z=-d/2+th/2; g.add(back);
    const left=box(th,h,d-th*2, matKraft); left.position.x=-w/2+th/2; left.position.y=th/2; g.add(left);
    const right=left.clone(); right.position.x=w/2-th/2; g.add(right);
    // inner corrugation
    const inner=box(w-th*2, h*0.9, d-th*2, matCorr); inner.scale.set(0.98,0.98,0.98); inner.position.y=0.02; inner.material.transparent=true; inner.material.opacity=0.0; // placeholder
    // flaps open slightly outward for realism
    const flapW=w*0.45, flapH=0.35;
    const flap1=box(flapW, 0.02, flapH, matKraft); flap1.position.set(-w*0.25, h/2+0.02, d/2+flapH/2-0.02); flap1.rotation.x=0.25; g.add(flap1);
    const flap2=flap1.clone(); flap2.position.x=w*0.25; g.add(flap2);
    const flap3=box(flapH,0.02,flapW, matKraft); flap3.position.set(w/2+flapH/2-0.02, h/2+0.02,0); flap3.rotation.z=-0.25; g.add(flap3);
    const flap4=flap3.clone(); flap4.position.x=-w/2-flapH/2+0.02; flap4.rotation.z=0.25; g.add(flap4);
  } else if(type.kind==='tube'){
    const radius=w/2;
    const tubeGeo=new THREE.CylinderGeometry(radius,radius,h,24,1,true);
    const tube=new THREE.Mesh(tubeGeo, matKraft); tube.castShadow=true; tube.receiveShadow=true; g.add(tube);
    const capGeo=new THREE.CircleGeometry(radius,24);
    const capTop=new THREE.Mesh(capGeo, matKraft); capTop.rotation.x=-Math.PI/2; capTop.position.y=h/2; capTop.receiveShadow=true; g.add(capTop);
    const capBot=capTop.clone(); capBot.rotation.x=Math.PI/2; capBot.position.y=-h/2; g.add(capBot);
    // inner corrugation rings
    for(let i=0;i<3;i++){
      const ring=new THREE.Mesh(new THREE.TorusGeometry(radius*0.98,0.015,6,24), matCorr);
      ring.rotation.x=Math.PI/2; ring.position.y=-h/2 + (i+1)*h/4; g.add(ring);
    }
  } else if(type.kind==='corner'){
    const th=0.04;
    const a=box(w,th,th, matKraft); // actually L: two perpendicular planes
    const v1=box(w,1.0,th, matKraft); v1.position.set(0,0, -0.5+th/2); // vertical
    const v2=box(w,th,1.0, matKraft); v2.position.set(0,-0.5+th/2,0); // horizontal
    // but we want L shape with height 1.0, depth 1.0
    g.add(v1); g.add(v2);
    // inner edge corrugation
    const e=box(w*0.98,0.02,0.02, matCorr); e.position.set(0,0,0); g.add(e);
  } else if(type.kind==='ramp'){
    // wedge ramp: box with sloped top via custom geometry
    const geom=new THREE.BufferGeometry();
    const hw=w/2, hd=d/2, hh=0.28;
    const verts=new Float32Array([
      -hw,0,-hd,  hw,0,-hd,  hw,0,hd,  -hw,0,hd, // bottom
      -hw,hh,-hd,  hw,hh,-hd,  hw,0,hd,  -hw,0,hd, // sloped top
    ]);
    const idx=[
      0,1,2, 0,2,3, // bottom
      4,5,6, 4,6,7, // top slope
      0,4,5, 0,5,1, // back
      1,5,6, 1,6,2, // right
      2,6,7, 2,7,3, // front (low)
      3,7,4, 3,4,0, // left
    ];
    geom.setAttribute('position', new THREE.BufferAttribute(verts,3));
    geom.setIndex(idx); geom.computeVertexNormals();
    const ramp=new THREE.Mesh(geom, matKraft); ramp.castShadow=true; ramp.receiveShadow=true; g.add(ramp);
    // corrugation side
    const side=box(w,0.02,d, matCorr); side.position.y=0.01; g.add(side);
  }
  g.userData.size=[w,h,d];
  g.userData.type=type.id;
  return g;
}

// ——— State ———
let pieces=[]; // {id, type, mesh, pos, rotY, h, vel, ...}
let nextId=1;
let ghost=null;
let ghostType=null;
let raycaster=new THREE.Raycaster();
let mouse=new THREE.Vector2();
let mousePos3D=new THREE.Vector3();
let hoverDelete=null;
let isPlacing=false;
let lastPlaceTime=0;

function createGhost(type){
  if(ghost) scene.remove(ghost);
  const m=createPieceMesh(type);
  m.traverse(o=>{ if(o.isMesh){ o.material=o.material.clone(); o.material.transparent=true; o.material.opacity=0.55; o.material.depthWrite=false; }});
  ghost=m; ghostType=type; ghost.visible=false; scene.add(ghost);
}
function updateGhostPosition(){
  if(!ghost || !ghostType) return;
  raycaster.setFromCamera(mouse, camera);
  // intersect ground plane y=0
  const plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  const hit=new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, hit);
  if(!hit) { ghost.visible=false; return; }
  // snap to grid
  if(snapOn){
    const gs=0.2;
    hit.x=Math.round(hit.x/gs)*gs;
    hit.z=Math.round(hit.z/gs)*gs;
    // snap to existing piece edges
    let best=null, bestDist=0.45;
    for(const p of pieces){
      const s=p.type.size; const hw=s[0]/2, hd=s[2]/2;
      // check 4 edges
      const cx=p.mesh.position.x, cz=p.mesh.position.z;
      const edges=[
        {x:cx+hw, z:cz, ax:'x'}, {x:cx-hw, z:cz, ax:'x'},
        {x:cx, z:cz+hd, ax:'z'}, {x:cx, z:cz-hd, ax:'z'},
      ];
      for(const e of edges){
        const dx=hit.x-e.x, dz=hit.z-e.z;
        const d=Math.hypot(dx,dz);
        if(d<bestDist){
          bestDist=d;
          if(e.ax==='x') hit.x=e.x + (hit.x>e.x ? ghostType.size[0]/2+0.02 : -ghostType.size[0]/2-0.02);
          else hit.z=e.z + (hit.z>e.z ? ghostType.size[2]/2+0.02 : -ghostType.size[2]/2-0.02);
        }
      }
    }
  }
  // height: base on ground + stacked? find support height under hit
  let supportY=0;
  // if over existing piece top, raise
  for(const p of pieces){
    const s=p.type.size; const hw=s[0]/2, hd=s[2]/2;
    const px=p.mesh.position.x, pz=p.mesh.position.z, py=p.mesh.position.y, ph=s[1]/2;
    if(Math.abs(hit.x-px)<hw+ghostType.size[0]/2-0.02 && Math.abs(hit.z-pz)<hd+ghostType.size[2]/2-0.02){
      const top=py+ph;
      if(top>supportY && top <= hit.y+5) {
        // check if within horizontal stack
        if(Math.abs(hit.x-px)<hw*0.9 && Math.abs(hit.z-pz)<hd*0.9) supportY=top;
      }
    }
  }
  // clamp inside table
  hit.x=clamp(hit.x, -5.5, 5.5);
  hit.z=clamp(hit.z, -5.5, 5.5);
  const h=ghostType.size[1]/2;
  const y = supportY + h + heightOffset*0.05; // heightOffset 0-40 => 0-2m
  ghost.position.set(hit.x, y, hit.z);
  ghost.rotation.y= rotationY * Math.PI/180;
  ghost.visible=true;
  mousePos3D.copy(hit); mousePos3D.y=y;

  // check overlap invalid (red)
  let overlapping=false;
  for(const p of pieces){
    if(boxesOverlap(ghost.position, ghostType.size, ghost.rotation.y, p.mesh.position, p.type.size, p.mesh.rotation.y)){
      // allow stacking vertically: if y difference > sum half heights, not overlap
      const dy=Math.abs(ghost.position.y - p.mesh.position.y);
      const sumH=(ghostType.size[1]+p.type.size[1])/2;
      if(dy < sumH - 0.02) overlapping=true;
    }
  }
  ghost.traverse(o=>{
    if(o.isMesh){
      if(overlapping){ o.material.color.setHex(0xff5555); o.material.opacity=0.65; }
      else { o.material.color.setHex(0xffffff); o.material.opacity=0.55; }
    }
  });
  ghost.userData.overlapping=overlapping;
}
function boxesOverlap(posA,sizeA,rotA,posB,sizeB,rotB){
  // simple AABB after Y rotation (only Y axis)
  // transform to axis aligned by approximating oriented bounding box as AABB with rotation
  // For Y rotation only, AABB extents: |cos|*hw + |sin|*hd
  const ca=Math.cos(rotA), sa=Math.sin(rotA), cb=Math.cos(rotB), sb=Math.sin(rotB);
  const ahw=sizeA[0]/2, ahd=sizeA[2]/2, bhw=sizeB[0]/2, bhd=sizeB[2]/2;
  const aEx=Math.abs(ca)*ahw + Math.abs(sa)*ahd;
  const aEz=Math.abs(ca)*ahd + Math.abs(sa)*ahw;
  const bEx=Math.abs(cb)*bhw + Math.abs(sb)*bhd;
  const bEz=Math.abs(cb)*bhd + Math.abs(sb)*bhw;
  return Math.abs(posA.x-posB.x) < (aEx+bEx) && Math.abs(posA.z-posB.z) < (aEz+bEz);
}

// ——— Placement ———
function placePiece(){
  if(!ghost || !ghost.visible || ghost.userData.overlapping) { toast('ما يمكنش تحط هنا — كاين تداخل!', true); return; }
  if(performance.now()-lastPlaceTime<120) return;
  lastPlaceTime=performance.now();
  const type=ghostType;
  const mesh=createPieceMesh(type);
  mesh.position.copy(ghost.position);
  mesh.rotation.y=ghost.rotation.y;
  mesh.castShadow=true; mesh.receiveShadow=true;
  scene.add(mesh);
  const id=nextId++;
  const rec={ id, type, mesh, pos:mesh.position.clone(), rotY:rotationY, vel:new THREE.Vector3(0,0,0), angVel:0, supported:false };
  pieces.push(rec);
  // physics reset
  rec.mesh.userData.pieceId=id;
  // click sound
  playSound('place');
  updateStats();
  checkChallenges();
  saveState();
  // push away ghost slightly to allow rapid building
  animatePlace(mesh);
}
function removePieceAtMouse(){
  raycaster.setFromCamera(mouse,camera);
  const meshes=[]; pieces.forEach(p=> p.mesh.traverse(o=>{ if(o.isMesh) meshes.push(o); }));
  const hits=raycaster.intersectObjects(meshes, false);
  if(hits.length){
    let obj=hits[0].object;
    while(obj.parent && !obj.userData.pieceId && obj.parent!==scene) obj=obj.parent;
    // find piece by traversing up to group
    let piece=null;
    for(const p of pieces){
      if(p.mesh===obj || p.mesh.children.includes(obj) || obj.parent===p.mesh){
        piece=p; break;
      }
      // more robust: check if obj is descendant of p.mesh
      let cur=hits[0].object;
      while(cur){
        if(cur===p.mesh){ piece=p; break; }
        cur=cur.parent;
      }
      if(piece) break;
    }
    if(!piece){
      // fallback: find by proximity
      const pt=hits[0].point;
      let best=null, bestD=1e9;
      for(const p of pieces){
        const d=p.mesh.position.distanceTo(pt);
        if(d<bestD){ bestD=d; best=p; }
      }
      piece=best;
    }
    if(piece){
      scene.remove(piece.mesh);
      pieces=pieces.filter(p=>p!==piece);
      updateStats(); saveState(); playSound('remove');
      toast('🗑️ تم المسح');
    }
  }
}
function animatePlace(mesh){
  const s=mesh.scale.clone(); mesh.scale.set(0.1,0.1,0.1);
  let t=0;
  function tick(){
    t+=0.16; mesh.scale.lerpVectors(s, new THREE.Vector3(1,1,1), Math.min(1, t));
    // use lerp
    mesh.scale.set( lerp(0.1,1, Math.min(1, t*1.2)), lerp(0.1,1, Math.min(1, t*1.2)), lerp(0.1,1, Math.min(1,t*1.2)));
    if(t<1) requestAnimationFrame(tick);
    else mesh.scale.set(1,1,1);
  }
  tick();
}

// ——— Cannon ———
let cannonBalls=[];
function fireCannon(){
  playSound('cannon');
  toast('💥 باااام! كرة حديد!');
  const dir=new THREE.Vector3(); camera.getWorldDirection(dir);
  const start=new THREE.Vector3().copy(camera.position).addScaledVector(dir, 1.2);
  const ballGeo=new THREE.SphereGeometry(0.18,16,16);
  const ballMat=new THREE.MeshStandardMaterial({ color:0x3e2723, roughness:0.3, metalness:0.6 });
  const ball=new THREE.Mesh(ballGeo, ballMat); ball.position.copy(start); ball.castShadow=true;
  scene.add(ball);
  const vel=dir.clone().multiplyScalar(14 + Math.random()*2);
  vel.y+=1.5;
  cannonBalls.push({ mesh:ball, vel, life:5, bounces:0 });
}
function updateCannon(dt){
  for(let i=cannonBalls.length-1;i>=0;i--){
    const b=cannonBalls[i];
    b.vel.y -= 9.8*dt;
    b.mesh.position.addScaledVector(b.vel, dt);
    b.life -= dt;
    // ground bounce
    if(b.mesh.position.y < 0.18){
      b.mesh.position.y=0.18;
      b.vel.y = -b.vel.y*0.55;
      b.vel.x *=0.85; b.vel.z*=0.85;
      b.bounces++;
      if(b.bounces>3) b.vel.set(0,0,0);
    }
    // collide with pieces
    for(const p of pieces){
      const s=p.type.size; const hw=s[0]/2, hh=s[1]/2, hd=s[2]/2;
      const pos=p.mesh.position;
      // sphere AABB
      const closestX=clamp(b.mesh.position.x, pos.x-hw, pos.x+hw);
      const closestY=clamp(b.mesh.position.y, pos.y-hh, pos.y+hh);
      const closestZ=clamp(b.mesh.position.z, pos.z-hd, pos.z+hd);
      const dx=b.mesh.position.x-closestX, dy=b.mesh.position.y-closestY, dz=b.mesh.position.z-closestZ;
      const dist2=dx*dx+dy*dy+dz*dz;
      if(dist2 < 0.18*0.18){
        // impulse
        const n=new THREE.Vector3(dx,dy,dz).normalize();
        if(n.lengthSq()<0.001) n.set(0,1,0);
        // push piece
        if(physicsEnabled){
          p.vel.addScaledVector(n, 6);
          p.vel.y+=1.2;
        } else {
          // nudge position
          p.mesh.position.addScaledVector(n, 0.15);
          p.vel.addScaledVector(n, 4);
          // enable temporary physics for this piece
          p._kickedTime=performance.now();
        }
        b.vel.addScaledVector(n, -1.2);
        spawnParticles(closestX,closestY,closestZ);
      }
    }
    if(b.life<=0){
      scene.remove(b.mesh);
      cannonBalls.splice(i,1);
    }
  }
}
function spawnParticles(x,y,z){
  const g=new THREE.Group(); scene.add(g);
  for(let i=0;i<6;i++){
    const m=new THREE.Mesh(new THREE.BoxGeometry(0.04,0.04,0.04), matKraft);
    m.position.set(x,y,z);
    g.add(m);
    const v=new THREE.Vector3((Math.random()-0.5)*4, Math.random()*4+1, (Math.random()-0.5)*4);
    let t=0;
    function tick(){
      t+=0.02; m.position.addScaledVector(v,0.02); v.y-=9.8*0.02; m.rotation.x+=0.2; m.rotation.z+=0.15;
      if(t>1){ scene.remove(g); } else requestAnimationFrame(tick);
    }
    tick();
  }
}

// ——— Shake / Earthquake ———
function shakeAll(){
  playSound('shake');
  toast('🌪️ زلزال! واش البناء غيصمد؟');
  for(const p of pieces){
    p.vel.set((Math.random()-0.5)*3, Math.random()*1.5+0.5, (Math.random()-0.5)*3);
    p.angVel=(Math.random()-0.5)*6;
  }
  // camera shake
  let t=0;
  const origTarget=controls.target.clone();
  function tick(){
    t+=0.05; controls.target.x=origTarget.x + Math.sin(t*20)*0.08*Math.exp(-t*2);
    controls.target.z=origTarget.z + Math.cos(t*18)*0.08*Math.exp(-t*2);
    if(t<2) requestAnimationFrame(tick);
    else controls.target.copy(origTarget);
  }
  tick();
}

// ——— Simple Physics ———
function updatePhysics(dt){
  if(!physicsEnabled && cannonBalls.length===0){
    // still settle kicked pieces
    let anyKicked=false;
    for(const p of pieces) if(p._kickedTime && performance.now()-p._kickedTime<3000) anyKicked=true;
    if(!anyKicked) return;
  }
  const gravity=9.8;
  // sort by y ascending so lower pieces settle first
  pieces.sort((a,b)=>a.mesh.position.y-b.mesh.position.y);
  for(const p of pieces){
    const s=p.type.size; const hh=s[1]/2;
    // apply gravity unless supported
    // check support: find highest support surface under piece within footprint
    let supportY=0;
    let supported=false;
    // ground
    if(p.mesh.position.y - hh <= 0.02){
      supportY=hh; supported=true;
    } else {
      // check other pieces below
      for(const q of pieces){
        if(q===p) continue;
        if(q.mesh.position.y >= p.mesh.position.y) continue;
        const qs=q.type.size; const qhw=qs[0]/2, qhd=qs[2]/2, qhh=qs[1]/2;
        const qtop=q.mesh.position.y + qhh;
        // is p footprint overlapping q top?
        const pw=s[0]/2, pd=s[2]/2;
        // oriented extents approx
        const dx=Math.abs(p.mesh.position.x - q.mesh.position.x);
        const dz=Math.abs(p.mesh.position.z - q.mesh.position.z);
        const overlapX= (pw+qhw) - dx;
        const overlapZ= (pd+qhd) - dz;
        if(overlapX>0.05 && overlapZ>0.05){
          // q is below, check if p bottom near q top
          const bottom=p.mesh.position.y - hh;
          if(Math.abs(bottom - qtop) < 0.18 || bottom < qtop+0.05){
            if(qtop > supportY) supportY=qtop+hh;
            supported=true;
          }
        }
      }
      // if not supported, fall
      if(!supported){
        p.vel.y -= gravity*dt;
      } else {
        // snap to support if falling
        if(p.mesh.position.y - hh > supportY+0.02){
          p.vel.y -= gravity*dt;
        } else {
          // rest on support
          p.mesh.position.y = supportY;
          if(p.vel.y<0) p.vel.y *= -0.15; // bounce small
          if(Math.abs(p.vel.y)<0.1) p.vel.y=0;
          // friction
          p.vel.x *= (1 - 4*dt);
          p.vel.z *= (1 - 4*dt);
          if(Math.abs(p.vel.x)<0.01) p.vel.x=0;
          if(Math.abs(p.vel.z)<0.01) p.vel.z=0;
        }
      }
    }
    // if supported and low velocity, lock
    if(supported && p.vel.length()<0.05){
      p.vel.set(0,0,0);
    }

    // integrate
    p.mesh.position.addScaledVector(p.vel, dt);
    // angular wobble when falling
    if(p.angVel){
      p.mesh.rotation.y += p.angVel*dt;
      p.angVel *= (1 - 2*dt);
      if(Math.abs(p.angVel)<0.01) p.angVel=0;
    }
    // ground clamp
    if(p.mesh.position.y - hh < 0){
      p.mesh.position.y=hh;
      p.vel.y=Math.abs(p.vel.y)*0.25;
      if(p.vel.y<0.2) p.vel.y=0;
      // topple chance if horizontal velocity high
      if(Math.abs(p.vel.x)>1 || Math.abs(p.vel.z)>1){
        p.angVel+=(p.vel.x+p.vel.z)*0.3;
      }
    }
    // interpenetration push apart (horizontal)
    for(const q of pieces){
      if(q===p) continue;
      const dx=p.mesh.position.x - q.mesh.position.x;
      const dz=p.mesh.position.z - q.mesh.position.z;
      const dy=Math.abs(p.mesh.position.y - q.mesh.position.y);
      const sumH=(s[1]+q.type.size[1])/2;
      if(dy < sumH -0.02){
        const distXZ=Math.hypot(dx,dz);
        const minDist=(s[0]+q.type.size[0])/2*0.55; // approx
        if(distXZ < minDist && distXZ>0.001){
          const push=(minDist - distXZ)*0.5;
          const nx=dx/distXZ, nz=dz/distXZ;
          p.mesh.position.x += nx*push*0.5;
          p.mesh.position.z += nz*push*0.5;
          q.mesh.position.x -= nx*push*0.5;
          q.mesh.position.z -= nz*push*0.5;
          // friction exchange
          const tmp=p.vel.clone(); p.vel.lerp(q.vel,0.1); q.vel.lerp(tmp,0.1);
        }
      }
    }
    // keep inside table
    p.mesh.position.x=clamp(p.mesh.position.x,-5.8,5.8);
    p.mesh.position.z=clamp(p.mesh.position.z,-5.8,5.8);
  }
}

// ——— Stats & Challenges ———
const CHALLENGES=[
  {id:'first', icon:'🎉', name:'أول قطعة', desc:'حط أول كرطونة', check:()=>pieces.length>=1},
  {id:'tower3', icon:'🗼', name:'برج 3m', desc:'بني علو 3 متر', check:()=>getMaxHeight()>=3},
  {id:'tower5', icon:'🏗️', name:'ناطحة 5m', desc:'وصل 5 متر!', check:()=>getMaxHeight()>=5},
  {id:'ten', icon:'📦', name:'10 قطع', desc:'جمع 10 قطع', check:()=>pieces.length>=10},
  {id:'house', icon:'🏠', name:'دار صغيرة', desc:'4 حيطان + سقف', check:()=>pieces.filter(p=>p.type.kind==='boxClosed'||p.type.kind==='boxOpen').length>=4 && pieces.filter(p=>p.type.kind==='sheet').length>=1},
  {id:'bridge', icon:'🌉', name:'قنطرة', desc:'قنطرة فوق 1.5m', check:()=>detectBridge()},
  {id:'fifty', icon:'💪', name:'مهندس كرطون', desc:'50 قطعة', check:()=>pieces.length>=50},
];
let doneChallenges=new Set(JSON.parse(localStorage.getItem('cartonDone')||'[]'));

function getMaxHeight(){
  let m=0;
  for(const p of pieces){
    const top=p.mesh.position.y + p.type.size[1]/2;
    if(top>m) m=top;
  }
  return m;
}
function detectBridge(){
  // simple: find a sheet/plank that is supported on both ends but not middle
  for(const p of pieces){
    if(p.type.kind!=='sheet' && p.type.kind!=='plank' && p.type.kind!=='ramp') continue;
    if(p.mesh.position.y<0.8) continue;
    // count supports under left and right
    let leftSup=false, rightSup=false;
    const hw=p.type.size[0]/2;
    for(const q of pieces){
      if(q===p) continue;
      if(Math.abs(q.mesh.position.y - (p.mesh.position.y - p.type.size[1]/2 - q.type.size[1]/2))>0.3) continue;
      const dx=q.mesh.position.x - p.mesh.position.x;
      if(dx < -hw*0.4) leftSup=true;
      if(dx > hw*0.4) rightSup=true;
    }
    if(leftSup && rightSup) return true;
  }
  return false;
}
function updateStats(){
  $('statPieces').textContent=pieces.length;
  const h=getMaxHeight(); $('statHeight').textContent=h.toFixed(1)+'m';
  const score=Math.floor(pieces.length*12 + h*28);
  $('statScore').textContent=score;
  // challenges
  renderChallenges();
}
function renderChallenges(){
  const wrap=$('challengesList'); wrap.innerHTML='';
  let newlyDone=false;
  for(const ch of CHALLENGES){
    const done=ch.check();
    if(done && !doneChallenges.has(ch.id)){ doneChallenges.add(ch.id); newlyDone=true; confettiEffect(); toast(`🏆 تحدي جديد: ${ch.name}!`); }
    const div=document.createElement('div'); div.className='challenge'+(done?' done':'');
    div.innerHTML=`<span class="icon">${ch.icon}</span><div class="info"><b>${ch.name}</b><span>${ch.desc}</span></div><span class="check">${done?'✓':''}</span>`;
    wrap.appendChild(div);
  }
  if(newlyDone){
    localStorage.setItem('cartonDone', JSON.stringify([...doneChallenges]));
    playSound('win');
  }
}
function checkChallenges(){ renderChallenges(); }
function confettiEffect(){
  const c=$('confetti');
  for(let i=0;i<18;i++){
    const s=document.createElement('span'); s.textContent=['📦','✨','🎉','⭐'][i%4];
    s.style.left=(Math.random()*100)+'vw'; s.style.animationDelay=(Math.random()*0.4)+'s';
    s.style.fontSize=(16+Math.random()*10)+'px';
    s.style.animationDuration=(2+Math.random()*1.5)+'s';
    c.appendChild(s); setTimeout(()=>s.remove(),4000);
  }
}

// ——— Save / Load ———
function saveState(){
  const data=pieces.map(p=>({id:p.type.id, x:p.mesh.position.x, y:p.mesh.position.y, z:p.mesh.position.z, r:p.mesh.rotation.y}));
  localStorage.setItem('cartonSave', JSON.stringify(data));
  localStorage.setItem('cartonNextId', String(nextId));
}
function loadState(){
  try{
    const raw=localStorage.getItem('cartonSave'); if(!raw) return;
    const arr=JSON.parse(raw);
    nextId=parseInt(localStorage.getItem('cartonNextId')||'1');
    for(const d of arr){
      const type=PIECE_TYPES.find(t=>t.id===d.id); if(!type) continue;
      const mesh=createPieceMesh(type); mesh.position.set(d.x,d.y,d.z); mesh.rotation.y=d.r;
      scene.add(mesh);
      pieces.push({ id:nextId++, type, mesh, pos:mesh.position.clone(), rotY:d.r*180/Math.PI, vel:new THREE.Vector3(0,0,0), angVel:0 });
    }
    updateStats();
  }catch(e){}
}

// ——— Sounds (Web Audio) ———
let audioCtx=null;
function ensureAudio(){ if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==='suspended') audioCtx.resume(); }
function playSound(kind){
  try{
    ensureAudio(); const ctx=audioCtx; const o=ctx.createOscillator(), g=ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    if(kind==='place'){ o.frequency.setValueAtTime(220,ctx.currentTime); o.frequency.exponentialRampToValueAtTime(440,ctx.currentTime+0.08); g.gain.setValueAtTime(0.25,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.18); o.start(); o.stop(ctx.currentTime+0.19); }
    else if(kind==='remove'){ o.frequency.setValueAtTime(180,ctx.currentTime); o.frequency.linearRampToValueAtTime(80,ctx.currentTime+0.12); g.gain.setValueAtTime(0.3,ctx.currentTime); g.gain.linearRampToValueAtTime(0.001,ctx.currentTime+0.15); o.start(); o.stop(ctx.currentTime+0.16); }
    else if(kind==='cannon'){ o.type='square'; o.frequency.setValueAtTime(120,ctx.currentTime); o.frequency.exponentialRampToValueAtTime(40,ctx.currentTime+0.25); g.gain.setValueAtTime(0.5,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.4); o.start(); o.stop(ctx.currentTime+0.41); }
    else if(kind==='shake'){ o.frequency.setValueAtTime(60,ctx.currentTime); o.frequency.linearRampToValueAtTime(180,ctx.currentTime+0.5); g.gain.setValueAtTime(0.35,ctx.currentTime); g.gain.linearRampToValueAtTime(0.001,ctx.currentTime+0.55); o.start(); o.stop(ctx.currentTime+0.56); }
    else if(kind==='win'){ [523,659,784,1046].forEach((f,i)=>{ const oo=ctx.createOscillator(), gg=ctx.createGain(); oo.frequency.value=f; oo.connect(gg); gg.connect(ctx.destination); gg.gain.setValueAtTime(0.18,ctx.currentTime+i*0.08); gg.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*0.08+0.3); oo.start(ctx.currentTime+i*0.08); oo.stop(ctx.currentTime+i*0.08+0.31); }); }
  }catch(e){}
}

// ——— Toast ———
let toastT=null;
function toast(html, warn=false){
  const t=$('toast'); t.innerHTML=html; t.classList.toggle('warn',warn); t.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'), 2400);
}

// ——— UI Wiring ———
function buildInventory(){
  const grid=$('invGrid'); grid.innerHTML='';
  for(const t of PIECE_TYPES){
    const div=document.createElement('button'); div.className='invItem'+(t.id===selectedId?' sel':'');
    div.innerHTML=`<div class="thumb">${t.icon}</div><b>${t.name}</b><i>${t.desc}</i>`;
    div.onclick=()=>{
      selectedId=t.id; rotationY=0; heightOffset=0;
      $('rotSlider').value=0; $('rotVal').textContent='0°'; $('heightSlider').value=0;
      document.querySelectorAll('.invItem').forEach(e=>e.classList.remove('sel')); div.classList.add('sel');
      createGhost(t); updateProps();
      playSound('place');
    };
    grid.appendChild(div);
  }
}
function updateProps(){
  const t=PIECE_TYPES.find(x=>x.id===selectedId);
  $('currentPiecePreview').textContent=t.icon;
  $('currentPieceName').textContent=t.name+' — '+t.desc;
}

function wireUI(){
  buildInventory();
  updateProps();
  createGhost(PIECE_TYPES.find(x=>x.id===selectedId));
  renderChallenges();
  updateStats();
  loadState();

  // sliders
  $('rotSlider').addEventListener('input', e=>{
    rotationY=parseInt(e.target.value); $('rotVal').textContent=rotationY+'°';
  });
  $('heightSlider').addEventListener('input', e=>{
    heightOffset=parseInt(e.target.value);
  });
  // buttons
  $('btnPhysics').onclick=()=>{
    physicsEnabled=!physicsEnabled;
    const b=$('btnPhysics');
    b.textContent= physicsEnabled ? '🌬️ فيزياء: ON' : '🌬️ فيزياء: OFF';
    b.className='pillBtn physics '+(physicsEnabled?'on':'off');
    toast(physicsEnabled?'✅ الفيزياء شاعلة — البناء يقدر يطيح!':'⏸️ الفيزياء طافية — بناء حر');
    playSound('shake');
  };
  $('btnClear').onclick=()=>{
    if(pieces.length===0) return toast('حتى حاجة ما كاينة!',true);
    $('clearCount').textContent=pieces.length; $('clearModal').classList.add('open');
  };
  $('btnClearYes').onclick=()=>{
    for(const p of pieces) scene.remove(p.mesh);
    pieces=[]; nextId=1; updateStats(); saveState();
    $('clearModal').classList.remove('open'); toast('🗑️ تم المسح'); playSound('remove');
  };
  $('btnClearNo').onclick=()=> $('clearModal').classList.remove('open');
  $('btnSave').onclick=()=>{ saveState(); toast('💾 تم الحفظ!'); playSound('win'); };
  $('btnUndo').onclick=()=>{
    if(pieces.length===0) return;
    const last=pieces.pop(); scene.remove(last.mesh); updateStats(); saveState(); toast('↩️ تراجع'); playSound('remove');
  };
  $('btnSnap').onclick=(e)=>{
    snapOn=!snapOn; e.currentTarget.classList.toggle('on', snapOn); toast(snapOn?'🧲 السناب شاعل':'🧲 السناب طافي');
  };
  $('btnCannon').onclick=fireCannon;
  $('btnShake').onclick=shakeAll;
  $('btnHelp').onclick=()=> $('helpModal').classList.add('open');
  $('helpClose').onclick=()=> $('helpModal').classList.remove('open');
  $('helpStart').onclick=()=> $('helpModal').classList.remove('open');
  document.querySelectorAll('.modeBtn').forEach(b=>{
    b.onclick=()=>{
      document.querySelectorAll('.modeBtn').forEach(x=>x.classList.remove('on')); b.classList.add('on');
      const mode=b.dataset.mode;
      if(mode==='build'){ $('bottomHint').textContent='حرك الماوس فوق الأرض و كليكي باش تحط الكرطون — بني دار أحلامك!'; ghost&&(ghost.visible=true); }
      if(mode==='destroy'){ $('bottomHint').textContent='سيفط كرة حديد و شوف واش البناء قوي — 💥 كليكي على زر الكرة!'; }
      if(mode==='inspect'){ $('bottomHint').textContent='دور الكاميرا و شوف التفاصيل الواقعية للكرطون — تموجات، تيب، ألياف الورق!'; }
    };
  });

  // mouse move
  renderer.domElement.addEventListener('pointermove', e=>{
    const rect=renderer.domElement.getBoundingClientRect();
    mouse.x=((e.clientX-rect.left)/rect.width)*2-1;
    mouse.y=-((e.clientY-rect.top)/rect.height)*2+1;
    if(!controls.dragging) updateGhostPosition();
  });
  renderer.domElement.addEventListener('pointerdown', e=>{
    if(controls.dragging) return;
    if(e.button===0){
      // if over UI? already handled
      // place
      if(ghost && ghost.visible && !controls.dragging){
        placePiece();
      }
    } else if(e.button===2){
      e.preventDefault();
      removePieceAtMouse();
    }
  });
  renderer.domElement.addEventListener('contextmenu', e=> e.preventDefault());
  // keyboard
  addEventListener('keydown', e=>{
    if(e.key==='r' || e.key==='R' || e.key==='ق'){
      rotationY=(rotationY+90)%360; $('rotSlider').value=rotationY; $('rotVal').textContent=rotationY+'°';
    }
    if(e.key==='q' || e.key==='Q'){ rotationY=(rotationY-15+360)%360; $('rotSlider').value=rotationY; $('rotVal').textContent=rotationY+'°'; }
    if(e.key==='e' || e.key==='E'){ rotationY=(rotationY+15)%360; $('rotSlider').value=rotationY; $('rotVal').textContent=rotationY+'°'; }
    if(e.key==='Delete' || e.key==='Backspace'){ if(pieces.length) { const last=pieces.pop(); scene.remove(last.mesh); updateStats(); saveState(); } }
    if(e.key===' '){ e.preventDefault(); fireCannon(); }
    if(e.key==='p' || e.key==='P'){ $('btnPhysics').click(); }
    if(e.key==='g' || e.key==='G'){ $('btnSnap').click(); }
    if(e.key>='1' && e.key<='9'){
      const idx=parseInt(e.key)-1; if(PIECE_TYPES[idx]){ selectedId=PIECE_TYPES[idx].id; buildInventory(); createGhost(PIECE_TYPES[idx]); updateProps(); }
    }
  });

  // show help on first visit
  if(!localStorage.getItem('cartonSeenHelp')){
    setTimeout(()=> $('helpModal').classList.add('open'), 600);
    localStorage.setItem('cartonSeenHelp','1');
  }

  // resize
  addEventListener('resize', ()=>{
    camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

// ——— Loop ———
let lastT=performance.now();
function animate(){
  requestAnimationFrame(animate);
  const now=performance.now(); const dt=Math.min(0.05, (now-lastT)/1000); lastT=now;

  controls.update();
  updatePhysics(dt);
  updateCannon(dt);

  // gentle ghost bob if physics off
  if(ghost && ghost.visible && !physicsEnabled){
    ghost.position.y += Math.sin(now*0.002)*0.0008;
  }

  // auto height stats throttle
  // render
  renderer.render(scene,camera);
}

// boot
wireUI();
setTimeout(()=>{
  $('loading').classList.add('hide');
  setTimeout(()=> $('loading').remove(),700);
}, 900);
animate();
