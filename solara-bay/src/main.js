import * as THREE from 'three';

// ——— Error overlay
addEventListener('error', e=>{
  const el=document.getElementById('errLog');
  el.style.display='block';
  el.textContent='⚠️ '+(e.message||'Error')+' '+(e.filename?e.filename.split('/').pop()+':'+e.lineno:'');
});

// ——— DOM
const $=id=>document.getElementById(id);
const canvas=$('canvas');
const loadFill=$('loadFill'), loadTip=$('loadTip'), loading=$('loading');
const hudMoney=$('hudMoney'), hudHealth=$('hudHealth'), hudTime=$('hudTime'), hudDay=$('hudDay'), hudStars=$('hudStars'), hudMissions=$('hudMissions');
const cross=$('cross'), promptEl=$('prompt'), promptText=$('promptText'), wantBanner=$('wantBanner');
const missionTitle=$('missionTitle'), missionProg=$('missionProg');
const minimap=$('minimap'), mctx=minimap.getContext('2d');
const speedo=$('speedo'), speedVal=$('speedVal'), gearVal=$('gearVal');
const shopModal=$('shopModal'), shopBody=$('shopBody'), shopTitle=$('shopTitle'), shopDesc=$('shopDesc');
const pauseModal=$('pauseModal'), missionModal=$('missionModal');
const districtLabel=$('districtLabel'), districtName=$('districtName'), districtSub=$('districtSub');

function toast(msg, ms=2400){
  const t=document.createElement('div'); t.className='toastItem'; t.textContent=msg;
  $('toast').appendChild(t); setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateY(-6px)'; setTimeout(()=>t.remove(),300)}, ms);
}
function setLoad(p, tip){
  loadFill.style.width=p+'%';
  if(tip) loadTip.textContent=tip;
}

// ——— Renderer / Scene / Camera
const renderer=new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.05;
renderer.outputColorSpace=THREE.SRGBColorSpace;

const scene=new THREE.Scene();
scene.fog=new THREE.FogExp2(0x1a1a2e, 0.0022);
// Sky gradient via background color + fog, plus hemi light
scene.background=new THREE.Color(0x1a1a2e);

const camera=new THREE.PerspectiveCamera(72, innerWidth/innerHeight, 0.1, 2000);
camera.position.set(0,12,28);

const clock=new THREE.Clock();

// ——— Lights (sunset cinematic)
const sun=new THREE.DirectionalLight(0xff8a4a, 2.2);
sun.position.set(120, 90, 60);
sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.near=1; sun.shadow.camera.far=500;
sun.shadow.camera.left=-160; sun.shadow.camera.right=160; sun.shadow.camera.top=160; sun.shadow.camera.bottom=-160;
sun.shadow.bias=-0.0006;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xffd6b8, 0x1a2a44, 0.9));
const ambient=new THREE.AmbientLight(0xfff0e0, 0.35); scene.add(ambient);

// neon point lights array
const neonLights=[];
function addNeon(pos, color=0x00ffd0, intensity=12){
  const l=new THREE.PointLight(color, intensity, 40, 1.8);
  l.position.copy(pos); l.decay=2;
  scene.add(l); neonLights.push(l);
  // visible voxel glow box
  const g=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.6,0.2), new THREE.MeshStandardMaterial({color, emissive:color, emissiveIntensity:3}));
  g.position.copy(pos); scene.add(g);
}

// ——— Sun position for day/night
let timeOfDay=18.5; // 0-24
const daySpeed=0.018; // ~24 min per full day (tuned)

// ——— City generation
// We build a 1.5km prototype that feels like 5km via districts; expanded later to tiles
const CITY_SIZE=520; // 520x520
const ROAD_W=11;
const BLOCK=78;
setLoad(10,'نُنشئ الشوارع voxel...');

// ground
const groundGeo=new THREE.PlaneGeometry(CITY_SIZE+200, CITY_SIZE+200);
const groundMat=new THREE.MeshStandardMaterial({color:0x2a2a33, roughness:0.9, metalness:0.02});
const ground=new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);

// water around marina (south side)
const waterGeo=new THREE.PlaneGeometry(CITY_SIZE+400, 260);
const waterMat=new THREE.MeshStandardMaterial({color:0x1e6a8a, roughness:0.2, metalness:0.1, transparent:true, opacity:0.92});
const water=new THREE.Mesh(waterGeo, waterMat);
water.rotation.x=-Math.PI/2; water.position.set(0,-0.4,-CITY_SIZE/2-30); water.receiveShadow=false; scene.add(water);
// water edge voxel sand
const beachGeo=new THREE.PlaneGeometry(CITY_SIZE+120, 30);
const beachMat=new THREE.MeshStandardMaterial({color:0xe8dcc6, roughness:1});
const beach=new THREE.Mesh(beachGeo, beachMat);
beach.rotation.x=-Math.PI/2; beach.position.set(0,0.02,-CITY_SIZE/2+12); beach.receiveShadow=true; scene.add(beach);

// roads - grid
const roadMat=new THREE.MeshStandardMaterial({color:0x1e1e24, roughness:0.85});
const lineMat=new THREE.MeshStandardMaterial({color:0xf0e6d2, emissive:0xf0e6d2, emissiveIntensity:0.15});
const roads=[];

function addRoad(x,z,w,h){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,0.05,h), roadMat);
  m.position.set(x,0.06,z); m.receiveShadow=true; scene.add(m); roads.push(m);
  // center dashed line
  if(w>h){
    for(let i=-w/2+6;i<w/2-6;i+=10){
      const line=new THREE.Mesh(new THREE.BoxGeometry(4,0.07,0.5), lineMat);
      line.position.set(x+i,0.09,z); scene.add(line);
    }
  } else {
    for(let i=-h/2+6;i<h/2-6;i+=10){
      const line=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.07,4), lineMat);
      line.position.set(x,0.09,z+i); scene.add(line);
    }
  }
}

// create grid 6x6 blocks
const gridN=6;
const half=CITY_SIZE/2 - BLOCK/2;
for(let gx=0; gx<gridN; gx++){
  for(let gz=0; gz<gridN; gz++){
    const cx = -half + gx*(BLOCK+ROAD_W);
    const cz = -half + gz*(BLOCK+ROAD_W);
  }
}
// horizontal roads
for(let i=0;i<=gridN;i++){
  const z = -half + i*(BLOCK+ROAD_W) - ROAD_W/2 - BLOCK/2;
  if(Math.abs(z)<CITY_SIZE/2+40) addRoad(0, z, CITY_SIZE+60, ROAD_W);
}
for(let i=0;i<=gridN;i++){
  const x = -half + i*(BLOCK+ROAD_W) - ROAD_W/2 - BLOCK/2;
  if(Math.abs(x)<CITY_SIZE/2+40) addRoad(x, 0, ROAD_W, CITY_SIZE+60);
}
setLoad(22,'نبني الأبراج والبيوت...');

// voxel building helper
const voxelMats={};
function matFor(hex){
  if(!voxelMats[hex]) voxelMats[hex]=new THREE.MeshStandardMaterial({color:hex, roughness:0.78, metalness:0.04});
  return voxelMats[hex];
}
const glassMat=new THREE.MeshStandardMaterial({color:0x9fd8ff, roughness:0.15, metalness:0.25, transparent:true, opacity:0.42});
const neonEmissiveMat=(hex)=> new THREE.MeshStandardMaterial({color:hex, emissive:hex, emissiveIntensity:2.2, roughness:0.6});

// districts definition
const districts=[
  {name:'MARINA BAY', sub:'الشاطئ • رمال ونيون', color:0x00ffd0, yRange:[-260,-120], xRange:[-260,260], palette:[0xffe8cc,0xbedff0,0xffd6b8,0xffffff,0xf7c59f], h:[6,18]},
  {name:'NEON DOWNTOWN', sub:'وسط المدينة • أبراج ونيون', color:0xff3b82, yRange:[-120,80], xRange:[-120,120], palette:[0x1a1a24,0x2a2a3a,0x3a3a4a,0x6a6a7a,0x0f1a2e], h:[22,52]},
  {name:'PALMETTO SUBURBS', sub:'الضواحي • هدوء وحدائق', color:0x7dff7a, yRange:[80,260], xRange:[-260,260], palette:[0xe8e0d0,0xd8cfb8,0xc9b8a0,0xe8dcc6,0xffffff], h:[5,12]},
  {name:'CORAL INDUSTRIAL', sub:'الصناعية • مصانع وحاويات', color:0xff7a3d, yRange:[-260,260], xRange:[140,260], palette:[0x6a3a2a,0x8a4a3a,0x4a2a1a,0x7a7a7a,0x2a2a2a], h:[10,24]},
];

const buildings=[]; // {mesh, interact, type, district, pos}
const interactables=[]; // for raycast
const shopData=[
  {id:'diner', name:'SunBite Diner', icon:'🍔', color:0xff7a3d, desc:'برغر سولارا الشهير — +25 صحة', price:25, func:'food'},
  {id:'threads', name:'Aqua Threads', icon:'👕', color:0x00ffd0, desc:'ملابس شاطئية — غيّر مظهرك', price:180, func:'clothes'},
  {id:'cuts', name:'Neon Cuts', icon:'💈', color:0xff4d8a, desc:'حلاقة نيون — تسريحة جديدة', price:90, func:'hair'},
  {id:'garage', name:'Bay Motors', icon:'🔧', color:0xffea00, desc:'ورشة — تصليح + نيترو', price:350, func:'repair'},
  {id:'freshmart', name:'FreshMart', icon:'🛒', color:0x7dff7a, desc:'سوبرماركت — مشروبات وطاقة', price:35, func:'food'},
  {id:'tech', name:'TechHaven', icon:'📱', color:0x00b8ff, desc:'إلكترونيات — كاميرا للمهام', price:420, func:'camera'},
  {id:'pawn', name:'Harbor Pawn', icon:'💎', color:0xffea00, desc:'رهن — بع الأغراض', price:0, func:'sell'},
  {id:'fuel', name:'FuelPro', icon:'⛽', color:0xff3b30, desc:'محطة وقود — تعبئة', price:40, func:'fuel'},
  {id:'pharma', name:'PharmaPlus', icon:'💊', color:0xffffff, desc:'صيدلية — ضمادات + صحة', price:60, func:'health'},
  {id:'vinyl', name:'Vinyl & Vibes', icon:'🎵', color:0x9d4edd, desc:'تسجيلات — غيّر الراديو', price:75, func:'radio'},
  {id:'bank', name:'City Bank', icon:'🏦', color:0xc9b037, desc:'بنك — مهمة سطو رئيسية', price:0, func:'bank'},
  {id:'realty', name:'Sunset Realty', icon:'🏠', color:0x5a2a83, desc:'عقارات — شقة صغيرة $18k', price:18000, func:'house'},
];

function rand(a,b){return a+Math.random()*(b-a)}
function pick(arr){return arr[Math.floor(Math.random()*arr.length)]}

let shopIndex=0;
for(let ix=0; ix<gridN; ix++){
 for(let iz=0; iz<gridN; iz++){
  const baseX = -half + ix*(BLOCK+ROAD_W);
  const baseZ = -half + iz*(BLOCK+ROAD_W);
  // skip water area south extreme
  // Determine district by position
  let d = districts[1];
  if(baseZ < -110) d=districts[0];
  else if(baseZ>80) d=districts[2];
  if(baseX>130) d=districts[3];
  // number of buildings per block 2-4
  const n = 2 + Math.floor(Math.random()*3);
  for(let b=0;b<n;b++){
    const pad=8;
    const bx = baseX + rand(-BLOCK/2+pad, BLOCK/2-pad);
    const bz = baseZ + rand(-BLOCK/2+pad, BLOCK/2-pad);
    // avoid roads
    const hVox = Math.floor(rand(d.h[0], d.h[1]));
    const w = rand(10,18), depth=rand(10,18);
    const col = pick(d.palette);
    const group=new THREE.Group();
    group.position.set(bx,0,bz);

    // voxel stack - subdivided for AO illusion
    const floors = Math.max(1, Math.floor(hVox/2));
    const floorH = hVox / floors * 1.6;
    for(let f=0; f<floors; f++){
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(w, floorH-0.2, depth), matFor(col));
      mesh.position.y = f*floorH + floorH/2;
      mesh.castShadow=true; mesh.receiveShadow=true;
      group.add(mesh);
      // windows - emissive at night handled via userData
      if(d.name.includes('DOWNTOWN') && Math.random()<0.7){
        for(let wx=-1; wx<=1; wx++){
          for(let wy=0; wy<2; wy++){
            if(Math.random()<0.5){
              const win=new THREE.Mesh(new THREE.BoxGeometry(1.4,1.2,0.2), new THREE.MeshStandardMaterial({color:0xffeaa0, emissive:0xffeaa0, emissiveIntensity: Math.random()<0.5?1.2:0, transparent:true, opacity:0.9}));
              win.position.set(wx*3, f*floorH+1+wy*1.8, depth/2+0.12);
              win.userData.isWindow=true;
              group.add(win);
            }
          }
        }
      }
    }
    // roof neon
    if(d.name.includes('DOWNTOWN') || Math.random()<0.25){
      const neonColor = pick([0x00ffd0,0xff4d8a,0xffea00,0x00b8ff,0xff7a3d]);
      const neon=new THREE.Mesh(new THREE.BoxGeometry(w+0.6,0.5,depth+0.6), neonEmissiveMat(neonColor));
      neon.position.y=hVox*1.6+0.4;
      group.add(neon);
      if(Math.random()<0.6) addNeon(new THREE.Vector3(bx, hVox*1.6+2, bz), neonColor, 10);
      // sign
      if(Math.random()<0.4){
        const sign=new THREE.Mesh(new THREE.BoxGeometry(6,2,0.3), neonEmissiveMat(neonColor));
        sign.position.set(0, 6, depth/2+1.2);
        group.add(sign);
      }
    }
    // ground shop front if low building
    let isShop=false;
    if(hVox<14 && Math.random()<0.45 && shopIndex<shopData.length*2){
      isShop=true;
      const s = shopData[shopIndex % shopData.length];
      // door
      const door=new THREE.Mesh(new THREE.BoxGeometry(3,4,0.2), new THREE.MeshStandardMaterial({color:0x111111, roughness:0.9}));
      door.position.set(0,2, depth/2+0.18);
      group.add(door);
      // awning
      const awning=new THREE.Mesh(new THREE.BoxGeometry(w+1,0.4,3), matFor(s.color));
      awning.position.set(0,4.6, depth/2+1);
      group.add(awning);
      // icon sprite simulated with canvas texture later, for now emissive plane
      const iconMat=new THREE.MeshStandardMaterial({color:0xffffff, emissive:0xffffff, emissiveIntensity:0.3});
      const icon=new THREE.Mesh(new THREE.PlaneGeometry(3,3), iconMat);
      icon.position.set(0,5.2, depth/2+1.02);
      // we'll add text via canvas texture
      group.add(icon);
      group.userData.shop=s;
      shopIndex++;
    } else {
      // generic door
      const door=new THREE.Mesh(new THREE.BoxGeometry(1.8,3.2,0.15), new THREE.MeshStandardMaterial({color:0x2a1a0a}));
      door.position.set( (Math.random()-0.5)*w*0.4,1.6, depth/2+0.1);
      group.add(door);
    }

    scene.add(group);
    buildings.push({group, x:bx, z:bz, h:hVox*1.6, w, depth, district:d, isShop});
    if(isShop){
      // invisible trigger box for interaction
      const trig=new THREE.Mesh(new THREE.BoxGeometry(w+4,6,6), new THREE.MeshBasicMaterial({visible:false}));
      trig.position.set(bx,3,bz+depth/2+3);
      trig.userData.isShopTrigger=true; trig.userData.shop=group.userData.shop; trig.userData.building=group;
      scene.add(trig);
      interactables.push(trig);
    }
  }
 }
}
setLoad(45,'نزرع النخيل والزينة...');

// decor: palms, props voxel
function addPalm(x,z,s=1){
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(0.35*s,0.5*s,6*s,6), matFor(0x5a3a1a));
  trunk.position.set(x,3*s,z); trunk.castShadow=true; scene.add(trunk);
  const leaves=new THREE.Mesh(new THREE.BoxGeometry(3*s,0.6*s,3*s), matFor(0x2a7a2a));
  leaves.position.set(x,6.2*s,z); leaves.castShadow=true; scene.add(leaves);
  const l2=new THREE.Mesh(new THREE.BoxGeometry(2.2*s,0.5*s,2.2*s), matFor(0x3a9a3a));
  l2.position.set(x,6.8*s,z); l2.rotation.y=Math.PI/4; scene.add(l2);
}
for(let i=0;i<32;i++){
  addPalm(rand(-CITY_SIZE/2+10,CITY_SIZE/2-10), -CITY_SIZE/2+6+Math.random()*18, rand(0.9,1.4));
  if(Math.random()<0.5) addPalm(rand(-CITY_SIZE/2+10,CITY_SIZE/2-10), rand(-CITY_SIZE/2+20,CITY_SIZE/2-20), rand(0.7,1.1));
}
// containers industrial
for(let i=0;i<12;i++){
  const c=new THREE.Mesh(new THREE.BoxGeometry(8,3,3), matFor(pick([0xff3b30,0x00b8ff,0x7dff7a,0xffea00])));
  c.position.set(160+rand(-30,70),1.5, rand(-80,80)); c.castShadow=true; scene.add(c);
}
// benches, lights
for(let i=0;i<40;i++){
  const lp=new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.15,6,6), matFor(0x2a2a2a));
  const x=rand(-CITY_SIZE/2,CITY_SIZE/2), z=rand(-CITY_SIZE/2,CITY_SIZE/2);
  lp.position.set(x,3,z); scene.add(lp);
  if(Math.random()<0.3) addNeon(new THREE.Vector3(x,5.6,z), 0xffffff, 6);
}

// roads border curbs
setLoad(58,'نُجهز المركبات...');

// ——— Vehicles (voxel style)
function makeVoxelCar(type='sedan', color=0xff3b30){
  const g=new THREE.Group();
  const bodyMat=matFor(color);
  const darkMat=matFor(0x111111);
  const glassM=new THREE.MeshStandardMaterial({color:0x9fd8ff, roughness:0.2, transparent:true, opacity:0.6});
  // base
  let body;
  if(type==='sports'){
    body=new THREE.Mesh(new THREE.BoxGeometry(5.2,1.2,10), bodyMat); body.position.y=1.1; g.add(body);
    const cabin=new THREE.Mesh(new THREE.BoxGeometry(4,1,4.5), glassM); cabin.position.set(0,2, -0.5); g.add(cabin);
    const spoiler=new THREE.Mesh(new THREE.BoxGeometry(5,0.3,1), darkMat); spoiler.position.set(0,1.8, -4.5); g.add(spoiler);
  } else if(type==='suv'){
    body=new THREE.Mesh(new THREE.BoxGeometry(5.6,1.8,10.5), bodyMat); body.position.y=1.4; g.add(body);
    const cabin=new THREE.Mesh(new THREE.BoxGeometry(5,1.4,6), glassM); cabin.position.set(0,2.9,0); g.add(cabin);
  } else if(type==='van'){
    body=new THREE.Mesh(new THREE.BoxGeometry(5.4,2.2,11), bodyMat); body.position.y=1.7; g.add(body);
    const cabin=new THREE.Mesh(new THREE.BoxGeometry(5,1.2,3), glassM); cabin.position.set(0,3.1,3); g.add(cabin);
  } else if(type==='bike'){
    const frame=new THREE.Mesh(new THREE.BoxGeometry(1.2,1,5), bodyMat); frame.position.y=1.2; g.add(frame);
    const wheelF=new THREE.Mesh(new THREE.CylinderGeometry(1,1,0.4,10), darkMat); wheelF.rotation.z=Math.PI/2; wheelF.position.set(0,0.9,2.2); g.add(wheelF);
    const wheelR=new THREE.Mesh(new THREE.CylinderGeometry(1,1,0.4,10), darkMat); wheelR.rotation.z=Math.PI/2; wheelR.position.set(0,0.9,-2.2); g.add(wheelR);
    g.userData.isBike=true;
  } else { // sedan
    body=new THREE.Mesh(new THREE.BoxGeometry(5,1.4,10), bodyMat); body.position.y=1.2; g.add(body);
    const cabin=new THREE.Mesh(new THREE.BoxGeometry(4.6,1.2,5), glassM); cabin.position.set(0,2.5,0.3); g.add(cabin);
  }
  if(type!=='bike'){
    const wheelGeo=new THREE.CylinderGeometry(0.9,0.9,0.7,10);
    const wMat=matFor(0x0a0a0a);
    const wPos=[[2.2,0.7,3.2],[-2.2,0.7,3.2],[2.2,0.7,-3.2],[-2.2,0.7,-3.2]];
    g.userData.wheels=[];
    wPos.forEach(p=>{
      const w=new THREE.Mesh(wheelGeo, wMat); w.rotation.z=Math.PI/2; w.position.set(...p); w.castShadow=true; g.add(w); g.userData.wheels.push(w);
    });
    // lights
    const headMat=new THREE.MeshStandardMaterial({color:0xffffff, emissive:0xffffff, emissiveIntensity:2});
    const headL=new THREE.Mesh(new THREE.BoxGeometry(0.8,0.5,0.2), headMat); headL.position.set(1.6,1.1,5.05); g.add(headL);
    const headR=headL.clone(); headR.position.x=-1.6; g.add(headR);
    const tailMat=new THREE.MeshStandardMaterial({color:0xff1a1a, emissive:0xff1a1a, emissiveIntensity:2});
    const tailL=new THREE.Mesh(new THREE.BoxGeometry(0.8,0.5,0.2), tailMat); tailL.position.set(1.6,1.1,-5.05); g.add(tailL);
    const tailR=tailL.clone(); tailR.position.x=-1.6; g.add(tailR);
    g.userData.lights=[headL,headR,tailL,tailR];
  }
  g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; }});
  g.userData.type=type; g.userData.color=color;
  return g;
}

const vehicleColors=[0xff3b30,0x00ffd0,0xffea00,0x00b8ff,0xff4d8a,0x7dff7a,0xffffff,0x2a2a2a,0x8a5a44];
const vehicles=[];
const vehiclePhysics=[];

// spawn vehicles on roads
for(let i=0;i<14;i++){
  const type=pick(['sedan','sedan','suv','sports','van','bike']);
  const col=pick(vehicleColors);
  const mesh=makeVoxelCar(type,col);
  // place near road intersections
  const x = rand(-CITY_SIZE/2+20, CITY_SIZE/2-20);
  const z = rand(-CITY_SIZE/2+20, CITY_SIZE/2-20);
  // snap to nearest road grid
  const snapX = Math.round(x/(BLOCK+ROAD_W))*(BLOCK+ROAD_W);
  const snapZ = Math.round(z/(BLOCK+ROAD_W))*(BLOCK+ROAD_W);
  // choose road aligned
  const onH = Math.random()<0.5;
  mesh.position.set(onH? rand(-CITY_SIZE/2,CITY_SIZE/2): snapX, 0, onH? snapZ: rand(-CITY_SIZE/2,CITY_SIZE/2));
  mesh.rotation.y= onH ? (Math.random()<0.5?0:Math.PI) : (Math.random()<0.5?Math.PI/2:-Math.PI/2);
  mesh.rotation.y+= rand(-0.1,0.1);
  scene.add(mesh);
  vehicles.push(mesh);
  vehiclePhysics.push({vel:0, steer:0, angVel:0, occupied:false});
}

// player vehicle starter (near spawn)
const starterCar=makeVoxelCar('sports',0xff3b30);
starterCar.position.set(6,0,18); starterCar.rotation.y=Math.PI/6; scene.add(starterCar);
vehicles.push(starterCar); vehiclePhysics.push({vel:0,steer:0,angVel:0,occupied:false});

// ——— Player voxel character
function makePlayerVoxel(){
  const g=new THREE.Group();
  const skin=matFor(0xffd6b8), shirt=matFor(0x00ffd0), pants=matFor(0x2a2a3a), shoe=matFor(0x111111);
  const head=new THREE.Mesh(new THREE.BoxGeometry(1.4,1.4,1.4), skin); head.position.y=4.2; head.castShadow=true; g.add(head);
  const hair=new THREE.Mesh(new THREE.BoxGeometry(1.5,0.6,1.5), matFor(0x1a1a1a)); hair.position.y=5; g.add(hair);
  const torso=new THREE.Mesh(new THREE.BoxGeometry(1.8,2,1), shirt); torso.position.y=2.6; torso.castShadow=true; g.add(torso);
  const armL=new THREE.Mesh(new THREE.BoxGeometry(0.6,1.6,0.6), skin); armL.position.set(-1.2,2.6,0); g.add(armL);
  const armR=armL.clone(); armR.position.x=1.2; g.add(armR);
  const legL=new THREE.Mesh(new THREE.BoxGeometry(0.7,1.6,0.7), pants); legL.position.set(-0.45,0.8,0); g.add(legL);
  const legR=legL.clone(); legR.position.x=0.45; g.add(legR);
  const footL=new THREE.Mesh(new THREE.BoxGeometry(0.8,0.4,1), shoe); footL.position.set(-0.45,0.2,0.2); g.add(footL);
  const footR=footL.clone(); footR.position.x=0.45; g.add(footR);
  g.userData.parts={head, torso, armL, armR, legL, legR};
  return g;
}
const playerMesh=makePlayerVoxel();
playerMesh.position.set(0,0,0);
scene.add(playerMesh);

// player physics
const player={
  pos:new THREE.Vector3(0,0,6),
  vel:new THREE.Vector3(),
  yaw:0, pitch:0,
  onGround:true, health:100, money:2500,
  isInVehicle:false, vehicle:null, vehicleIndex:-1,
  speed:0, wanted:0, wantedTimer:0,
  isFPS:false,
  input:{w:0,a:0,s:0,d:0, shift:0, space:0},
  camDist:7, camHeight:3.2
};
playerMesh.position.copy(player.pos);

// camera control
let isPointerLocked=false;
canvas.addEventListener('click', ()=>{
  if(shopModal.classList.contains('show')||pauseModal.classList.contains('show')||missionModal.classList.contains('show')) return;
  if(!isPointerLocked) canvas.requestPointerLock();
});
document.addEventListener('pointerlockchange', ()=>{
  isPointerLocked=document.pointerLockElement===canvas;
  cross.style.display=isPointerLocked? 'block':'none';
});
document.addEventListener('mousemove', e=>{
  if(!isPointerLocked) return;
  const sens=0.0022;
  player.yaw -= e.movementX*sens;
  player.pitch -= e.movementY*sens;
  player.pitch=Math.max(-1.2, Math.min(1.2, player.pitch));
});

// Input
const keys={};
addEventListener('keydown', e=>{
  keys[e.code]=true;
  if(e.code==='KeyV'){ toggleCamera(); }
  if(e.code==='KeyF'){ tryEnterExitVehicle(); }
  if(e.code==='KeyE'){ tryInteract(); }
  if(e.code==='Escape'){ togglePause(); }
  if(e.code==='KeyG'){ cycleRadio(); toast('🎵 راديو: '+radioNames[radioIdx]); }
  // prevent pointer lock exit on esc when not paused? handled
});
addEventListener('keyup', e=> keys[e.code]=false);

// ——— NPC pedestrians (voxel)
setLoad(68,'ننشر السكان...');
const npcs=[];
function makeNPC(){
  const g=makePlayerVoxel();
  // recolor
  const shirtCol=pick([0xff7a3d,0x00ffd0,0xff4d8a,0x7dff7a,0xffffff,0x9d4edd]);
  g.userData.parts.torso.material=matFor(shirtCol);
  g.scale.setScalar(rand(0.95,1.05));
  g.userData.state='walk';
  g.userData.timer=rand(2,6);
  g.userData.speed=rand(1.2,2.0);
  g.userData.dir=new THREE.Vector3(rand(-1,1),0,rand(-1,1)).normalize();
  g.userData.target=new THREE.Vector3();
  g.userData.isNPC=true;
  return g;
}
for(let i=0;i<34;i++){
  const n=makeNPC();
  n.position.set(rand(-CITY_SIZE/2+10,CITY_SIZE/2-10),0, rand(-CITY_SIZE/2+10,CITY_SIZE/2-10));
  scene.add(n); npcs.push(n);
}

// Traffic AI cars (separate from parked)
const trafficCars=[];
for(let i=0;i<10;i++){
  const t=makeVoxelCar(pick(['sedan','suv']), pick(vehicleColors));
  t.position.set(rand(-CITY_SIZE/2,CITY_SIZE/2),0, rand(-CITY_SIZE/2,CITY_SIZE/2));
  t.userData.ai={dir: Math.random()<0.5?0:1, speed: rand(6,11), target: new THREE.Vector3(), wait:0};
  // snap to road
  scene.add(t); trafficCars.push(t);
}

// police
const policeCars=[];
function spawnPolice(pos){
  const p=makeVoxelCar('suv',0x0a3a8a);
  // police livery: white + blue stripe, lights
  const stripe=new THREE.Mesh(new THREE.BoxGeometry(5.61,0.4,8), matFor(0xffffff)); stripe.position.y=1.6; p.add(stripe);
  const lightBar=new THREE.Mesh(new THREE.BoxGeometry(3,0.5,1.2), new THREE.MeshStandardMaterial({color:0xff0000, emissive:0xff0000, emissiveIntensity:3})); lightBar.position.set(0,3.2,1); p.add(lightBar);
  const lightBar2=lightBar.clone(); lightBar2.material=new THREE.MeshStandardMaterial({color:0x0000ff, emissive:0x0000ff, emissiveIntensity:3}); lightBar2.position.x=0; lightBar2.position.z=0.4; p.add(lightBar2);
  p.position.copy(pos); p.position.y=0;
  p.userData.isPolice=true; p.userData.siren=0;
  scene.add(p); policeCars.push(p);
  return p;
}

// ——— HUD helpers
function updateHUD(){
  hudMoney.textContent='$'+player.money.toLocaleString();
  hudHealth.textContent=Math.round(player.health);
  hudHealth.parentElement.style.background= player.health<35 ? 'linear-gradient(135deg,#ff3b30,#ff7a3d)': 'var(--glass)';
  // time
  const h=Math.floor(timeOfDay), m=Math.floor((timeOfDay-h)*60);
  hudTime.textContent= String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
  let dayName='نهار';
  if(timeOfDay>5 && timeOfDay<7) dayName='فجر';
  else if(timeOfDay>=7 && timeOfDay<17) dayName='نهار';
  else if(timeOfDay>=17 && timeOfDay<19.5) dayName='غروب';
  else dayName='ليل';
  hudDay.textContent=dayName;
  // wanted
  [...hudStars.children].forEach((s,i)=> s.classList.toggle('on', i<player.wanted));
  $('wantedChip').style.display= player.wanted>0? 'flex':'none';
  wantBanner.style.display= player.wanted>0? 'block':'none';
  if(player.wanted>0) wantBanner.textContent='🚨 مطلوب — مستوى '+player.wanted+' — اهرب!';
  // missions
  hudMissions.textContent= currentMission+1 +'/12';
  // speedo
  if(player.isInVehicle){
    speedo.style.display='block';
    const v=Math.abs(vehiclePhysics[player.vehicleIndex]?.vel||0)*3.6*4;
    speedVal.textContent=Math.round(v);
    const g = v<1?'PARK': v<35?'1ST': v<70?'2ND': v<110?'3RD':'TURBO';
    gearVal.textContent=g+' • '+(player.isFPS?'FIRST PERSON':'THIRD PERSON');
  } else speedo.style.display='none';
}

// district detection
let currentDistrict=districts[0];
function checkDistrict(){
  const p= player.isInVehicle && player.vehicle ? player.vehicle.position : player.pos;
  let best=districts[0], bestDist=Infinity;
  districts.forEach(d=>{
    const cx=(d.xRange[0]+d.xRange[1])/2, cz=(d.yRange[0]+d.yRange[1])/2;
    const dist=Math.hypot(p.x-cx, p.z-cz);
    if(dist<bestDist){bestDist=dist; best=d}
  });
  if(best!==currentDistrict){
    currentDistrict=best;
    districtName.textContent=best.name;
    districtSub.textContent=best.sub;
    districtLabel.classList.add('show');
    setTimeout(()=>districtLabel.classList.remove('show'),2200);
  }
}

// ——— Missions
const missions=[
  {title:'أول توصيلة — أوصل الطرد إلى المارينا', pos:new THREE.Vector3(0,-CITY_SIZE/2+18,0), radius:14, reward:300, prog:15},
  {title:'رخصة سولارا — قد عبر الحواجز دون صدم', pos:new THREE.Vector3(80,-40,0), radius:12, reward:0, prog:30},
  {title:'ليلة النيون — أوصل لونا إلى Downtown ليلاً', pos:new THREE.Vector3(-40,20,0), radius:14, reward:800, prog:45},
  {title:'دَين الميناء — اجمع $2000', pos:new THREE.Vector3(180,-30,0), radius:18, reward:500, prog:55},
  {title:'سرقة الفانيليا — اسرق شاحنة الآيس كريم', pos:new THREE.Vector3(40,-100,0), radius:16, reward:1500, prog:65},
  {title:'حاجز الفجر — اهرب من حاجز الشرطة', pos:new THREE.Vector3(-120,60,0), radius:20, reward:0, prog:75},
  {title:'أضواء المارينا — صوّر 5 معالم', pos:new THREE.Vector3(-10,-220,0), radius:18, reward:1200, prog:85},
  {title:'سباق الغروب — اربح سباق الشارع', pos:new THREE.Vector3(30,0,0), radius:22, reward:3000, prog:92},
  {title:'سطو FreshMart — قرارك', pos:new THREE.Vector3(-80,120,0), radius:14, reward:2000, prog:96},
  {title:'خيانة الكورال — تسلل المصنع', pos:new THREE.Vector3(200,0,0), radius:18, reward:4000, prog:100},
  {title:'قمة Sunset Hills — اقتحم الفيلا', pos:new THREE.Vector3(-100,180,0), radius:16, reward:6000, prog:100},
  {title:'نهائي سولارا — الهروب الكبير 5 نجوم', pos:new THREE.Vector3(0,0,0), radius:26, reward:10000, prog:100},
];
let currentMission=0;
const missionMarker=new THREE.Mesh(new THREE.CylinderGeometry(8,8,0.5,16), new THREE.MeshStandardMaterial({color:0x00ffd0, emissive:0x00ffd0, emissiveIntensity:1.2, transparent:true, opacity:0.6}));
missionMarker.position.copy(missions[0].pos); missionMarker.position.y=0.3; scene.add(missionMarker);
const markerBeam=new THREE.Mesh(new THREE.CylinderGeometry(0.6,0.6,30,8), new THREE.MeshStandardMaterial({color:0x00ffd0, emissive:0x00ffd0, emissiveIntensity:1.5, transparent:true, opacity:0.5}));
markerBeam.position.copy(missions[0].pos); markerBeam.position.y=15; scene.add(markerBeam);

function updateMission(){
  const m=missions[currentMission];
  missionTitle.textContent=m.title;
  missionProg.style.width=m.prog+'%';
  missionMarker.position.copy(m.pos); missionMarker.position.y=0.3;
  markerBeam.position.copy(m.pos); markerBeam.position.y=15;
  hudMissions.textContent=(currentMission+1)+'/12';
}
function completeMission(){
  const m=missions[currentMission];
  player.money+=m.reward;
  const title=$('missionDoneTitle'), desc=$('missionDoneDesc'), rew=$('missionReward');
  title.textContent='🏆 مهمة مكتملة!';
  desc.textContent=m.title;
  rew.textContent='+ $'+m.reward.toLocaleString()+' • تقدم القصة';
  missionModal.classList.add('show');
  if(isPointerLocked) document.exitPointerLock();
  // next
  if(currentMission<missions.length-1){
    currentMission++;
    updateMission();
  } else {
    title.textContent='👑 أسطورة سولارا!';
    desc.textContent='أكملت كل المهام الرئيسية — المدينة لك الآن';
  }
  spawnPoliceCheer();
  toast('✅ تمت المهمة! +$'+m.reward);
}
$('missionNext').onclick=()=>{ missionModal.classList.remove('show'); };
function spawnPoliceCheer(){
  for(let i=0;i<4;i++) setTimeout(()=> addNeon(new THREE.Vector3(player.pos.x+rand(-8,8), 8, player.pos.z+rand(-8,8)), pick([0x00ffd0,0xffea00]), 14), i*120);
}

// check mission reach
function checkMissions(dt){
  const p= player.isInVehicle && player.vehicle ? player.vehicle.position : player.pos;
  const m=missions[currentMission];
  const dist=Math.hypot(p.x-m.pos.x, p.z-m.pos.z);
  if(dist<m.radius){
    markerBeam.material.emissiveIntensity=2.5+Math.sin(performance.now()*0.01)*1;
    if(dist< m.radius*0.7){
      // auto complete after 1 sec inside
      if(!checkMissions._t) checkMissions._t=0;
      checkMissions._t+=dt;
      if(checkMissions._t>1.2){ checkMissions._t=0; completeMission(); }
    }
  } else checkMissions._t=0;
}

// ——— Interaction / Shop
let nearInteract=null;
function tryInteract(){
  if(!nearInteract) { toast('لا يوجد شيء قريب للتفاعل'); return; }
  const shop=nearInteract.userData.shop;
  openShop(shop);
}
function openShop(shop){
  if(!shop) return;
  shopModal.classList.add('show');
  if(isPointerLocked) document.exitPointerLock();
  shopTitle.textContent=shop.icon+' '+shop.name;
  shopDesc.textContent=shop.desc;
  // generate shop UI based on func
  let html='';
  if(shop.func==='food' || shop.func==='health'){
    html=`<div class="grid2">
      <div class="card" data-buy="25"><h3>🍔 وجبة سولارا</h3><p> +25 صحة — طعم غروب</p><div class="price">$25</div><button class="btn btnPrimary" style="width:100%;margin-top:8px" onclick="window._buy(25,25,'health')">شراء</button></div>
      <div class="card" data-buy="45"><h3>🥤 مشروب طاقة</h3><p>+50 صحة + سرعة 10 ثوانٍ</p><div class="price">$45</div><button class="btn btnPrimary" style="width:100%;margin-top:8px" onclick="window._buy(45,50,'health')">شراء</button></div>
      <div class="card" data-buy="15"><h3>🍦 آيس كريم مارينا</h3><p>+10 صحة — منعش</p><div class="price">$15</div><button class="btn btnGhost" style="width:100%;margin-top:8px" onclick="window._buy(15,10,'health')">شراء</button></div>
      <div class="card"><h3>🎯 مهمة جانبية</h3><p>توصيل طلبات — $80-180</p><div class="price">مكافأة</div><button class="btn btnGhost" style="width:100%;margin-top:8px" onclick="window._startSide('delivery')">ابدأ التوصيل</button></div>
    </div>`;
  } else if(shop.func==='clothes' || shop.func==='hair'){
    html=`<div class="shopGrid">
      <div class="shopItem" onclick="window._buy(180,0,'clothes')"><div class="ico">🧢</div><b>كاب نيون</b><small>$180</small></div>
      <div class="shopItem" onclick="window._buy(220,0,'clothes')"><div class="ico">👕</div><b>قميص شاطئي</b><small>$220</small></div>
      <div class="shopItem" onclick="window._buy(350,0,'clothes')"><div class="ico">👖</div><b>بنطلون Voxel</b><small>$350</small></div>
      <div class="shopItem" onclick="window._buy(90,0,'hair')"><div class="ico">💈</div><b>تسريحة جديدة</b><small>$90</small></div>
      <div class="shopItem" onclick="window._buy(500,0,'clothes')"><div class="ico">🧥</div><b>جاكيت غروب</b><small>$500</small></div>
      <div class="shopItem" onclick="window._buy(120,0,'clothes')"><div class="ico">🕶️</div><b>نظارة شمس</b><small>$120</small></div>
    </div>`;
  } else if(shop.func==='repair'){
    html=`<div class="grid2">
      <div class="card"><h3>🔧 تصليح كامل</h3><p>يصلح السيارة + يزيل النجوم</p><div class="price">$350</div><button class="btn btnPrimary" style="width:100%;margin-top:8px" onclick="window._buy(350,100,'repair')">تصليح</button></div>
      <div class="card"><h3>💨 نيترو</h3><p>سرعة إضافية 15 ثانية</p><div class="price">$180</div><button class="btn btnPrimary" style="width:100%;margin-top:8px" onclick="window._buy(180,0,'nitro')">شراء</button></div>
      <div class="card"><h3>🎨 لون جديد</h3><p>غيّر لون سيارتك الحالية</p><div class="price">$220</div><button class="btn btnGhost" style="width:100%;margin-top:8px" onclick="window._paintCar()">تلوين</button></div>
      <div class="card"><h3>🏁 سباق شارع</h3><p>تحدّي ليلي — $500-2000</p><div class="price">مكافأة</div><button class="btn btnGhost" style="width:100%;margin-top:8px" onclick="window._startSide('race')">ابدأ السباق</button></div>
    </div>`;
  } else if(shop.func==='camera'){
    html=`<div class="grid2">
      <div class="card"><h3>📸 كاميرا سولارا</h3><p>مطلوبة لمهمة التصوير — جودة voxel</p><div class="price">$420</div><button class="btn btnPrimary" style="width:100%;margin-top:8px" onclick="window._buy(420,0,'camera')">شراء</button></div>
      <div class="card"><h3>📱 هاتف مطوّر</h3><p>يقلل وقت استدعاء الشرطة</p><div class="price">$300</div><button class="btn btnGhost" style="width:100%;margin-top:8px" onclick="window._buy(300,0,'phone')">شراء</button></div>
    </div>`;
  } else if(shop.func==='fuel'){
    html=`<div class="grid2">
      <div class="card"><h3>⛽ تعبئة وقود</h3><p>خزان كامل — لا تتعطل</p><div class="price">$40</div><button class="btn btnPrimary" style="width:100%;margin-top:8px" onclick="window._buy(40,0,'fuel')">تعبئة</button></div>
      <div class="card"><h3>🧃 متجر صغير</h3><p>وجبة سريعة</p><div class="price">$20</div><button class="btn btnGhost" style="width:100%;margin-top:8px" onclick="window._buy(20,15,'health')">شراء</button></div>
    </div>`;
  } else if(shop.func==='bank'){
    html=`<div class="card" style="text-align:center"><h3>🏦 خزنة المدينة</h3><p>مهمة سطو رئيسية — تتطلب تخطيط. هل أنت مستعد؟</p><div class="price">مكافأة $6000 + 3 نجوم</div><button class="btn btnPrimary" style="width:100%;margin-top:10px" onclick="window._startHeist()">ابدأ السطو 🚨</button><p style="font-size:11px;opacity:.6;margin-top:8px">تحذير: سيزيد المستوى المطلوب فوراً</p></div>`;
  } else if(shop.func==='house'){
    html=`<div class="card" style="text-align:center"><h3>🏠 شقة Sunset Hills</h3><p>إطلالة بانورامية + كراج + نقطة حفظ</p><div class="price">$18,000</div><button class="btn btnPrimary" style="width:100%;margin-top:10px" onclick="window._buy(18000,0,'house')">شراء الشقة</button></div>`;
  } else if(shop.func==='radio'){
    html=`<div class="shopGrid">
      <div class="shopItem" onclick="window._setRadio(0)"><div class="ico">🌴</div><b>Lo-fi Sunset</b><small>هادئ</small></div>
      <div class="shopItem" onclick="window._setRadio(1)"><div class="ico">🌃</div><b>Neon Synth</b><small>نيون</small></div>
      <div class="shopItem" onclick="window._setRadio(2)"><div class="ico">🎺</div><b>Reggaeton Bay</b><small>حيوي</small></div>
    </div><p style="text-align:center;color:rgba(255,255,255,.6);font-size:12px;margin-top:10px">اضغط G داخل السيارة لتبديل الراديو</p>`;
  } else {
    html=`<div class="grid2">
      <div class="card"><h3>${shop.icon} ${shop.name}</h3><p>${shop.desc}</p><div class="price">${shop.price? '$'+shop.price: 'مجاني'}</div><button class="btn btnPrimary" style="width:100%;margin-top:8px" onclick="window._buy(${shop.price||0},0,'generic')">تفاعل</button></div>
      <div class="card"><h3>🎯 نشاط جانبي</h3><p>تاكسي / توصيل / تصوير</p><button class="btn btnGhost" style="width:100%;margin-top:8px" onclick="window._startSide('taxi')">ابدأ تاكسي</button></div>
    </div>`;
  }
  shopBody.innerHTML=html;
}
window._buy=(price, healthAdd, type)=>{
  if(player.money < price){ toast('❌ فلوسك لا تكفي! تحتاج $'+price); return; }
  player.money-=price;
  if(healthAdd) player.health=Math.min(100, player.health+healthAdd);
  if(type==='repair'){ player.wanted=Math.max(0, player.wanted-1); // hide inside garage
    if(player.vehicle){ /* recolor? */ }
    toast('🔧 تم التصليح! -1 نجمة مطلوب');
  } else if(type==='nitro'){ toast('💨 نيترو جاهز! اضغط SHIFT في السيارة'); nitroTime=15; }
  else if(type==='clothes'){ const col=pick([0x00ffd0,0xff4d8a,0xffea00,0x7dff7a]); playerMesh.userData.parts.torso.material=matFor(col); toast('👕 مظهر جديد!'); }
  else if(type==='hair'){ playerMesh.userData.parts.head.material=matFor(pick([0x1a1a1a,0x6a3a1a,0xd8b89a])); toast('💈 تسريحة جديدة!'); }
  else if(type==='house'){ toast('🏠 مبروك! اشتريت شقة Sunset Hills — نقطة حفظ جديدة'); addHouseMarker(); }
  else toast('✅ تم الشراء! -$'+price);
  if(healthAdd) toast('❤️ +'+healthAdd+' صحة');
  updateHUD();
};
window._paintCar=()=>{
  if(!player.isInVehicle){ toast('ادخل السيارة أولاً'); return; }
  if(player.money<220){ toast('تحتاج $220'); return; }
  player.money-=220; const col=pick(vehicleColors); player.vehicle.traverse(o=>{ if(o.isMesh && o.material && o.material.color) o.material.color?.set?.(col); }); updateHUD(); toast('🎨 لون جديد!');
};
window._startSide=(kind)=>{
  shopModal.classList.remove('show');
  if(kind==='delivery'){ toast('📦 توصيل: أوصل الطرد بسرعة! +$150'); setTimeout(()=>{player.money+=150; updateHUD(); toast('✅ توصيل مكتمل +$150'); checkMissions._t=99;}, 4000); }
  if(kind==='taxi'){ toast('🚕 تاكسي: خذ الراكب!'); setTimeout(()=>{player.money+=220; updateHUD(); toast('✅ تاكسي مكتمل +$220');}, 5000); }
  if(kind==='race'){ toast('🏁 سباق شارع يبدأ...'); startStreetRace(); }
};
window._startHeist=()=>{ shopModal.classList.remove('show'); player.wanted=Math.min(5, player.wanted+3); for(let i=0;i<3;i++) spawnPolice(player.pos.clone().add(new THREE.Vector3(rand(-40,40),0,rand(-40,40)))); toast('🚨 سطو! الشرطة قادمة — اهرب!'); updateHUD(); setTimeout(()=>{ if(player.wanted>=3){ player.money+=6000; updateHUD(); toast('💰 هروب ناجح! +$6000'); player.wanted=0; updateHUD(); }},9000); };
window._setRadio=(i)=>{ radioIdx=i; toast('🎵 راديو: '+radioNames[i]); shopModal.classList.remove('show'); };
let nitroTime=0;
function addHouseMarker(){
  const hm=new THREE.Mesh(new THREE.BoxGeometry(4,6,4), matFor(0xffffff)); hm.position.set(-90,4,190); scene.add(hm); addNeon(new THREE.Vector3(-90,8,190),0x00ffd0,12);
}
$('shopClose').onclick=()=> shopModal.classList.remove('show');
shopModal.addEventListener('click', e=>{ if(e.target===shopModal) shopModal.classList.remove('show'); });

// ——— Vehicle enter/exit
function getNearestVehicle(maxDist=7){
  let best=null, bestD=Infinity, bestIdx=-1;
  vehicles.forEach((v,i)=>{
    const d=v.position.distanceTo(player.pos);
    if(d<maxDist && d<bestD){ bestD=d; best=v; bestIdx=i; }
  });
  return {veh:best, idx:bestIdx, dist:bestD};
}
function tryEnterExitVehicle(){
  if(player.isInVehicle){
    // exit
    const v=player.vehicle;
    const idx=player.vehicleIndex;
    // find safe exit pos
    const exitPos=v.position.clone().add(new THREE.Vector3(3,0,0).applyQuaternion(v.quaternion));
    // check building collision simple
    player.pos.copy(exitPos); player.pos.y=0;
    playerMesh.position.copy(player.pos); playerMesh.visible=true;
    player.isInVehicle=false; player.vehicle=null; vehiclePhysics[idx].occupied=false;
    toast('🚪 نزلت من السيارة');
  } else {
    const {veh, idx, dist}=getNearestVehicle();
    if(!veh){ toast('لا توجد سيارة قريبة'); return; }
    player.isInVehicle=true; player.vehicle=veh; player.vehicleIndex=idx;
    vehiclePhysics[idx].occupied=true;
    playerMesh.visible=false;
    toast('🚗 ركبت السيارة — WASD للقيادة، SPACE درفت، V للمنظور');
  }
}

// ——— Camera toggle
function toggleCamera(){
  player.isFPS=!player.isFPS;
  toast(player.isFPS? '🎥 منظور أول':'🎮 منظور ثالث');
  cross.classList.toggle('dot', player.isFPS);
  player.camDist= player.isFPS? 0.2:7;
}
function togglePause(){
  const show=!pauseModal.classList.contains('show');
  pauseModal.classList.toggle('show', show);
  if(show && isPointerLocked) document.exitPointerLock();
}
$('btnPause').onclick=togglePause;
$('pauseClose').onclick=togglePause;
$('btnResume').onclick=togglePause;
$('btnRestart').onclick=()=> location.reload();
$('btnMap').onclick=()=> toast('🗺️ الخريطة الكاملة ستُفتح في التحديث القادم — استخدم الـ Minimap الآن');
$('btnDownload').onclick=()=>{
  toast('⬇️ التحميل: احفظ الصفحة كـ HTML أو اطلب مني حزمة EXE جاهزة');
  // trigger download of single file? we have build tool
  // For now, create a blob download of current page
  const html=document.documentElement.outerHTML;
  const blob=new Blob([html],{type:'text/html'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='SolaraBay.html'; a.click(); URL.revokeObjectURL(url);
};

// ——— Radio
const radioNames=['Lo-fi Sunset','Neon Synth','Reggaeton Bay'];
let radioIdx=0;
function cycleRadio(){ radioIdx=(radioIdx+1)%3; }

// ——— Traffic & NPC logic
function updateNPCs(dt){
  npcs.forEach(n=>{
    if(n.userData.state==='flee'){
      n.position.add(n.userData.dir.clone().multiplyScalar(n.userData.speed*1.8*dt));
      n.lookAt(n.position.clone().add(n.userData.dir));
      n.userData.timer-=dt;
      if(n.userData.timer<=0){ n.userData.state='walk'; n.userData.dir.set(rand(-1,1),0,rand(-1,1)).normalize(); }
      // bob
      n.position.y=Math.abs(Math.sin(performance.now()*0.01))*0.08;
      return;
    }
    // walk
    n.userData.timer-=dt;
    if(n.userData.timer<=0){
      n.userData.dir.set(rand(-1,1),0,rand(-1,1)).normalize();
      n.userData.timer=rand(3,7);
      if(Math.random()<0.08) n.userData.state='idle'; else n.userData.state='walk';
    }
    if(n.userData.state==='idle'){
      // occasional phone
      return;
    }
    // avoid buildings simple
    let next=n.position.clone().add(n.userData.dir.clone().multiplyScalar(n.userData.speed*dt));
    // clamp city
    next.x=Math.max(-CITY_SIZE/2+5, Math.min(CITY_SIZE/2-5, next.x));
    next.z=Math.max(-CITY_SIZE/2+5, Math.min(CITY_SIZE/2-5, next.z));
    // simple building avoidance: if near building, turn
    let blocked=false;
    for(let b of buildings){
      if(Math.abs(next.x-b.x)<8 && Math.abs(next.z-b.z)<8){ blocked=true; break; }
    }
    if(blocked){ n.userData.dir.set(rand(-1,1),0,rand(-1,1)).normalize(); } else {
      n.position.copy(next);
      n.lookAt(n.position.clone().add(n.userData.dir));
    }
    // animate legs
    const t=performance.now()*0.008;
    n.userData.parts.legL.rotation.x=Math.sin(t)*0.6;
    n.userData.parts.legR.rotation.x=Math.sin(t+Math.PI)*0.6;
    n.userData.parts.armL.rotation.x=Math.sin(t+Math.PI)*0.4;
    n.userData.parts.armR.rotation.x=Math.sin(t)*0.4;
    // flee if police near or player car hits
    const playerPos= player.isInVehicle? player.vehicle.position: player.pos;
    if(n.position.distanceTo(playerPos)<4 && (player.isInVehicle && (vehiclePhysics[player.vehicleIndex]?.vel||0)>0.6)){
      n.userData.state='flee';
      n.userData.dir.copy(n.position.clone().sub(playerPos).normalize()); n.userData.dir.y=0; n.userData.timer=4;
      if(Math.random()<0.3){ player.wanted=Math.min(5, player.wanted+1); toast('📞 مواطن اتصل بالشرطة!'); spawnPolice(n.position.clone().add(new THREE.Vector3(rand(-30,30),0,rand(-30,30)))); updateHUD(); }
    }
    // police near triggers flee
    for(let p of policeCars){ if(n.position.distanceTo(p.position)<18){ n.userData.state='flee'; n.userData.dir.copy(n.position.clone().sub(p.position).normalize()); n.userData.timer=3; } }
  });
}
function updateTraffic(dt){
  trafficCars.forEach(c=>{
    const ai=c.userData.ai;
    if(ai.wait>0){ ai.wait-=dt; return; }
    // move along road direction (keep on road)
    // simple: follow straight then turn at intersections
    const speed=ai.speed*(0.9+Math.sin(performance.now()*0.001 + c.position.x)*0.1);
    const forward=new THREE.Vector3(0,0,1).applyQuaternion(c.quaternion);
    c.position.add(forward.multiplyScalar(speed*dt));
    // wrap around city
    if(Math.abs(c.position.x)>CITY_SIZE/2+20 || Math.abs(c.position.z)>CITY_SIZE/2+20){
      c.position.set(rand(-CITY_SIZE/2,CITY_SIZE/2),0, rand(-CITY_SIZE/2,CITY_SIZE/2));
      c.rotation.y= Math.random()<0.5?0:Math.PI/2;
    }
    // avoid buildings
    for(let b of buildings){
      if(Math.hypot(c.position.x-b.x, c.position.z-b.z)<12){
        c.rotation.y+=0.6*dt* (Math.random()<0.5?1:-1);
      }
    }
    // intersection turn randomly
    const nearGrid = Math.abs(c.position.x % (BLOCK+ROAD_W))<5 || Math.abs(c.position.z % (BLOCK+ROAD_W))<5;
    if(nearGrid && Math.random()<0.008){
      c.rotation.y+= (Math.random()<0.5? Math.PI/2: -Math.PI/2);
    }
    // wheels
    if(c.userData.wheels) c.userData.wheels.forEach(w=> w.rotation.x+= speed*dt*2);
  });
  // police chase
  policeCars.forEach(p=>{
    if(!player.isInVehicle && player.wanted===0){
      // patrol slowly
      p.position.add(new THREE.Vector3(0,0,1).applyQuaternion(p.quaternion).multiplyScalar(3*dt));
      p.rotation.y+= Math.sin(performance.now()*0.0005 + p.position.x)*0.01;
      return;
    }
    const target= player.isInVehicle? player.vehicle.position: player.pos;
    const dir= target.clone().sub(p.position).normalize();
    const targetYaw=Math.atan2(dir.x, dir.z);
    let yawDiff= targetYaw - p.rotation.y;
    while(yawDiff>Math.PI) yawDiff-=Math.PI*2;
    while(yawDiff<-Math.PI) yawDiff+=Math.PI*2;
    p.rotation.y+= yawDiff*0.06;
    const dist= p.position.distanceTo(target);
    const spd= dist>30? 18: 14;
    p.position.add(new THREE.Vector3(0,0,1).applyQuaternion(p.quaternion).multiplyScalar(spd*dt));
    // siren flash
    p.userData.siren+=dt*8;
    const flash=p.userData.siren%2 <1 ? 0xff0000:0x0000ff;
    p.traverse(o=>{ if(o.material && o.material.emissiveIntensity>1 && o.geometry?.type==='BoxGeometry'){ o.material.color?.set?.(flash); o.material.emissive?.set?.(flash);} });
    // catch player
    if(dist<5.5){
      if(player.isInVehicle){
        // crash
        const phys=vehiclePhysics[player.vehicleIndex];
        phys.vel*=-0.5; // bounce
        player.health-=6*dt*5; // quick
        if(player.health<=0){ player.health=100; player.wanted=0; policeCars.forEach(pp=> scene.remove(pp)); policeCars.length=0; toast('💥 تم القبض عليك! — أُعيد إحياؤك في المستشفى'); player.pos.set(0,0, -80); if(player.vehicle){ player.vehicle.position.copy(player.pos).add(new THREE.Vector3(4,0,0)); } updateHUD();}
      } else {
        player.health-=12*dt;
        if(player.health<=0){ player.health=100; toast('🏥 نُقلت للمستشفى'); player.pos.set(10,0, -60); }
      }
      updateHUD();
    }
    if(p.userData.wheels) p.userData.wheels.forEach(w=> w.rotation.x+= spd*dt*2);
  });
}

// ——— Vehicle physics for player car
function updateVehicle(dt){
  if(!player.isInVehicle) return;
  const phys=vehiclePhysics[player.vehicleIndex];
  const mesh=player.vehicle;
  const inputV = (keys['KeyW']||keys['ArrowUp']?1:0) - (keys['KeyS']||keys['ArrowDown']?1:0);
  const inputH = (keys['KeyA']||keys['ArrowLeft']?1:0) - (keys['KeyD']||keys['ArrowRight']?1:0);
  const handbrake= keys['Space']?1:0;
  // engine
  let accel= inputV*28*dt;
  if(nitroTime>0){ accel*=1.8; nitroTime-=dt; }
  // friction / drag
  let drag= 1.2*dt + handbrake*2.5*dt;
  phys.vel += accel;
  phys.vel *= (1 - drag);
  // clamp reverse slower
  if(phys.vel>0) phys.vel=Math.min(phys.vel, 16);
  else phys.vel=Math.max(phys.vel, -7);
  // deadzone
  if(Math.abs(phys.vel)<0.02 && inputV===0) phys.vel=0;
  // steering - less at high speed? more drift
  let steerFactor= Math.abs(phys.vel)*0.08;
  let targetSteer= inputH * (0.9 - Math.min(0.5, Math.abs(phys.vel)*0.03));
  if(handbrake) targetSteer*=1.6;
  phys.steer += (targetSteer - phys.steer)*0.12;
  mesh.rotation.y += phys.steer * (phys.vel*0.045) * (handbrake?1.4:1);
  // move
  const forward=new THREE.Vector3(0,0,1).applyQuaternion(mesh.quaternion);
  mesh.position.add(forward.multiplyScalar(phys.vel*dt*4));
  // keep on ground y
  mesh.position.y=0;
  // collision with buildings
  for(let b of buildings){
    const d=Math.hypot(mesh.position.x-b.x, mesh.position.z-b.z);
    const limit= (b.w||10)/2 +3;
    if(d<limit){
      const push= mesh.position.clone().sub(new THREE.Vector3(b.x,0,b.z)).normalize().multiplyScalar((limit-d)*0.85);
      mesh.position.add(push);
      phys.vel*=-0.35; // bounce
      // damage
      player.health-=2; updateHUD();
      if(Math.random()<0.08){ // wanted for reckless
        if(player.wanted<2 && Math.random()<0.08){ player.wanted++; updateHUD(); spawnPolice(mesh.position.clone().add(new THREE.Vector3(rand(-30,30),0,rand(-30,30)))); toast('🚨 قيادة متهورة!'); }
      }
      break;
    }
  }
  // clamp city bounds
  mesh.position.x=Math.max(-CITY_SIZE/2+6, Math.min(CITY_SIZE/2-6, mesh.position.x));
  mesh.position.z=Math.max(-CITY_SIZE/2+6, Math.min(CITY_SIZE/2-6, mesh.position.z));
  // wheels spin
  if(mesh.userData.wheels) mesh.userData.wheels.forEach(w=> w.rotation.x+= phys.vel*dt*12);
  // engine sound pitch via toast? skip
  // update player pos to vehicle
  player.pos.copy(mesh.position);
}

// ——— Player foot movement
function updatePlayer(dt){
  if(player.isInVehicle) return;
  const forward=new THREE.Vector3();
  const right=new THREE.Vector3();
  // yaw based
  forward.set(Math.sin(player.yaw),0,Math.cos(player.yaw));
  right.set(Math.sin(player.yaw+Math.PI/2),0,Math.cos(player.yaw+Math.PI/2));
  let move=new THREE.Vector3();
  if(keys['KeyW']||keys['ArrowUp']) move.add(forward);
  if(keys['KeyS']||keys['ArrowDown']) move.sub(forward);
  if(keys['KeyA']||keys['ArrowLeft']) move.sub(right);
  if(keys['KeyD']||keys['ArrowRight']) move.add(right);
  const isMoving= move.length()>0;
  if(isMoving) move.normalize();
  const isRun= keys['ShiftLeft']||keys['ShiftRight'];
  const speed= isRun? 9: 5.2;
  // gravity / jump
  if(!player.onGround) player.vel.y -= 22*dt;
  if((keys['Space']) && player.onGround){ player.vel.y=7.2; player.onGround=false; }
  // apply move
  const wish= move.multiplyScalar(speed);
  // smooth velocity
  player.vel.x += (wish.x - player.vel.x)*0.18;
  player.vel.z += (wish.z - player.vel.z)*0.18;
  // integrate
  const nextPos= player.pos.clone().add(new THREE.Vector3(player.vel.x,0,player.vel.z).multiplyScalar(dt));
  nextPos.y += player.vel.y*dt;
  // ground
  if(nextPos.y<=0){ nextPos.y=0; player.vel.y=0; player.onGround=true; }
  else player.onGround=false;
  // building collision (foot)
  let blocked=false;
  for(let b of buildings){
    const dx=Math.abs(nextPos.x-b.x), dz=Math.abs(nextPos.z-b.z);
    if(dx< b.w/2+1.2 && dz< b.depth/2+1.2 && nextPos.y<6){
      // push out
      const pushX= (b.w/2+1.2) - dx, pushZ= (b.depth/2+1.2)-dz;
      if(pushX<pushZ) nextPos.x+= Math.sign(nextPos.x-b.x)*pushX;
      else nextPos.z+= Math.sign(nextPos.z-b.z)*pushZ;
      blocked=true; break;
    }
  }
  // clamp city
  nextPos.x=Math.max(-CITY_SIZE/2+2, Math.min(CITY_SIZE/2-2, nextPos.x));
  nextPos.z=Math.max(-CITY_SIZE/2+2, Math.min(CITY_SIZE/2-2, nextPos.z));
  player.pos.copy(nextPos);
  playerMesh.position.copy(player.pos);
  // rotate mesh to yaw when moving
  if(isMoving){
    const targetYaw= Math.atan2(move.x, move.z); // but move already scaled? use forward
    // Actually use player yaw
    playerMesh.rotation.y= player.yaw;
    // leg animation
    const t=performance.now()*(isRun?0.014:0.009);
    const amp=isRun?0.8:0.45;
    playerMesh.userData.parts.legL.rotation.x=Math.sin(t)*amp;
    playerMesh.userData.parts.legR.rotation.x=Math.sin(t+Math.PI)*amp;
    playerMesh.userData.parts.armL.rotation.x=Math.sin(t+Math.PI)*amp*0.7;
    playerMesh.userData.parts.armR.rotation.x=Math.sin(t)*amp*0.7;
    playerMesh.position.y= Math.abs(Math.sin(t*2))*0.08;
  } else {
    playerMesh.rotation.y= player.yaw;
    playerMesh.userData.parts.legL.rotation.x*=0.85;
    playerMesh.userData.parts.legR.rotation.x*=0.85;
  }
}

// ——— Wanted system update
function updateWanted(dt){
  if(player.wanted>0){
    // if no police near, timer counts down
    let seen=false;
    const pPos= player.isInVehicle? player.vehicle.position : player.pos;
    for(let p of policeCars){ if(p.position.distanceTo(pPos)<55) seen=true; }
    if(!seen){
      player.wantedTimer+=dt;
      if(player.wantedTimer> 18 - player.wanted*2){ // higher wanted harder to escape
        player.wanted=Math.max(0, player.wanted-1);
        player.wantedTimer=0;
        if(player.wanted===0){ toast('✅ هربت من الشرطة!'); policeCars.forEach(p=>{ /* fade */ }); // keep but will despawn
          // despawn police after escape
          setTimeout(()=>{ policeCars.forEach(p=> scene.remove(p)); policeCars.length=0; }, 4000);
        } else toast('⭐ انخفض المستوى المطلوب إلى '+player.wanted);
        updateHUD();
      }
    } else player.wantedTimer=0;
    // spawn more if needed
    if(policeCars.length < player.wanted*2 && Math.random()<0.02){
      spawnPolice(pPos.clone().add(new THREE.Vector3(rand(-70,70),0,rand(-70,70))));
    }
  }
}

// ——— Day/Night & weather
let rain=null, rainTime=0;
function initRain(){
  const geo=new THREE.BufferGeometry();
  const count=2200;
  const pos=new Float32Array(count*3);
  for(let i=0;i<count;i++){ pos[i*3]=rand(-CITY_SIZE,CITY_SIZE); pos[i*3+1]=rand(10,80); pos[i*3+2]=rand(-CITY_SIZE,CITY_SIZE); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  const mat=new THREE.PointsMaterial({color:0x9fd8ff, size:0.18, transparent:true, opacity:0.0});
  rain=new THREE.Points(geo, mat); scene.add(rain);
}
initRain();
let isRaining=false;
function updateWorld(dt){
  timeOfDay+= dt*daySpeed;
  if(timeOfDay>=24) timeOfDay-=24;
  // sun position arc (east to west)
  const sunAngle= (timeOfDay/24)*Math.PI*2 - Math.PI/2;
  const sunDist=200;
  sun.position.set(Math.cos(sunAngle)*sunDist, Math.sin(sunAngle)*sunDist+30, 80);
  // intensity
  const isDay= timeOfDay>6 && timeOfDay<19;
  const sunset= timeOfDay>17 && timeOfDay<19.5;
  if(sunset){
    const t= (timeOfDay-17)/2.5;
    sun.intensity= 2.2 - t*0.8;
    scene.background.setHSL(0.08 - t*0.02, 0.7, 0.18 + t*0.08);
    scene.fog.color.setHSL(0.08, 0.55, 0.16);
    ambient.color.setHSL(0.08, 0.6, 0.7);
  } else if(isDay){
    sun.intensity=2.2;
    scene.background.setHSL(0.58, 0.45, 0.62);
    scene.fog.color.set(0x9fd8ff);
    scene.fog.density=0.0016;
    ambient.intensity=0.75;
  } else {
    sun.intensity=0.12;
    scene.background.setHSL(0.68, 0.5, 0.06);
    scene.fog.color.set(0x0a0a1a);
    scene.fog.density=0.0032;
    ambient.intensity=0.22;
  }
  // shadows only day
  sun.castShadow= isDay || sunset;
  // neon lights intensity night only
  neonLights.forEach(l=> l.intensity= isDay? 0: 14);
  // random rain
  rainTime+=dt;
  if(!isRaining && rainTime> 45 && Math.random()<0.002){ isRaining=true; rainTime=0; rain.material.opacity=0.7; toast('🌧️ مطر خفيف — القيادة منزلقة قليلاً'); }
  if(isRaining){
    rain.material.opacity=0.6;
    const pos=rain.geometry.attributes.position;
    for(let i=0;i<pos.count;i++){
      pos.setY(i, pos.getY(i)- 22*dt);
      if(pos.getY(i)<0){ pos.setY(i, rand(30,70)); pos.setX(i, rand(-CITY_SIZE,CITY_SIZE)); pos.setZ(i, rand(-CITY_SIZE,CITY_SIZE)); }
    }
    pos.needsUpdate=true;
    // car slip handled in vehicle update via drag?
    if(rainTime>22){ isRaining=false; rain.material.opacity=0; rainTime=0; toast('☀️ توقف المطر'); }
  }
}

// ——— Camera follow
function updateCamera(dt){
  let targetPos, lookAt;
  if(player.isInVehicle){
    const v=player.vehicle;
    const speedFactor= Math.min(1, Math.abs(vehiclePhysics[player.vehicleIndex]?.vel||0)/14);
    if(player.isFPS){
      // inside car, at driver head
      const headLocal=new THREE.Vector3(0.7,2.4,1.2);
      headLocal.applyQuaternion(v.quaternion);
      targetPos= v.position.clone().add(headLocal);
      const fwd=new THREE.Vector3(0,0,1).applyQuaternion(v.quaternion);
      // add mouse look
      const yawQuat=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), player.yaw - v.rotation.y);
      // combine? simplest: FPS in car looks with vehicle yaw + small pitch
      lookAt= targetPos.clone().add(new THREE.Vector3(0,0,1).applyQuaternion(v.quaternion).multiplyScalar(22));
      // apply pitch offset
      lookAt.y+= player.pitch*6;
      camera.position.lerp(targetPos, 0.18);
      camera.lookAt(lookAt);
    } else {
      const dist= 8 + speedFactor*5;
      const height= 3.2 + speedFactor*1.2;
      const offset=new THREE.Vector3(0,height,-dist);
      // apply yaw
      offset.applyQuaternion(v.quaternion);
      targetPos= v.position.clone().add(offset);
      // add slight pitch based on speed
      // lerp
      camera.position.lerp(targetPos, 0.09);
      lookAt= v.position.clone().add(new THREE.Vector3(0,2,0));
      camera.lookAt(lookAt);
    }
  } else {
    if(player.isFPS){
      const headPos= player.pos.clone().add(new THREE.Vector3(0,1.62,0));
      targetPos=headPos;
      const fwd=new THREE.Vector3(0,0,1);
      // yaw/pitch
      fwd.applyAxisAngle(new THREE.Vector3(0,1,0), player.yaw);
      fwd.y= Math.sin(player.pitch);
      // normalize horizontal
      const horizLen=Math.cos(player.pitch);
      fwd.x=Math.sin(player.yaw)*horizLen;
      fwd.z=Math.cos(player.yaw)*horizLen;
      lookAt= headPos.clone().add(fwd.multiplyScalar(12));
      camera.position.copy(targetPos);
      camera.lookAt(lookAt);
    } else {
      const dist= player.camDist, h=player.camHeight;
      const offset=new THREE.Vector3(0,h,-dist);
      // rotate offset by yaw
      offset.applyAxisAngle(new THREE.Vector3(0,1,0), player.yaw);
      // apply pitch
      offset.y+= Math.sin(player.pitch)*2;
      // offset.z*= Math.cos(player.pitch);
      targetPos= player.pos.clone().add(offset);
      // avoid wall clipping: raycast to target?
      // simple sphere check against buildings
      let clipped=targetPos.clone();
      for(let b of buildings){
        const d=clipped.distanceTo(new THREE.Vector3(b.x, clipped.y, b.z));
        if(d< b.w/2+2){
          clipped= player.pos.clone().add(offset.normalize().multiplyScalar(Math.max(2, dist- (b.w/2+2 -d))));
        }
      }
      camera.position.lerp(clipped, 0.12);
      lookAt= player.pos.clone().add(new THREE.Vector3(0,1.4,0));
      camera.lookAt(lookAt);
    }
  }
  camera.updateMatrixWorld();
}

// ——— Interaction ray / proximity
function updateInteraction(){
  // find nearest shop trigger within 5 units on foot, 8 in car? only on foot
  if(player.isInVehicle){ promptEl.style.display='none'; nearInteract=null; return; }
  let best=null, bestD=Infinity;
  for(let t of interactables){
    const d=t.position.distanceTo(player.pos);
    if(d<6 && d<bestD){ bestD=d; best=t; }
  }
  nearInteract=best;
  if(best){
    promptEl.style.display='flex';
    promptText.textContent='ادخل '+best.userData.shop.name+' — '+best.userData.shop.desc;
  } else promptEl.style.display='none';
}

// ——— Minimap
function drawMinimap(){
  const s=168, pad=8;
  mctx.clearRect(0,0,s,s);
  // bg
  mctx.fillStyle='#0f0f14'; mctx.fillRect(0,0,s,s);
  // grid roads
  mctx.strokeStyle='rgba(255,255,255,.18)'; mctx.lineWidth=1.2;
  // transform world to minimap: city 520 -> 140
  const scale=(s-pad*2)/CITY_SIZE;
  const toMin=(x,z)=> [s/2 + x*scale, s/2 + z*scale];
  // roads lines already drawn via geometry, but draw simplified
  mctx.strokeStyle='#2a2a33'; mctx.lineWidth=2;
  for(let i=0;i<=gridN;i++){
    const z= -half + i*(BLOCK+ROAD_W) - ROAD_W/2 - BLOCK/2;
    const [x1,y1]=toMin(-CITY_SIZE/2, z); const [x2,y2]=toMin(CITY_SIZE/2, z);
    mctx.beginPath(); mctx.moveTo(x1,y1); mctx.lineTo(x2,y2); mctx.stroke();
    const x= -half + i*(BLOCK+ROAD_W) - ROAD_W/2 - BLOCK/2;
    const [x3,y3]=toMin(x, -CITY_SIZE/2); const [x4,y4]=toMin(x, CITY_SIZE/2);
    mctx.beginPath(); mctx.moveTo(x3,y3); mctx.lineTo(x4,y4); mctx.stroke();
  }
  // districts color blocks
  districts.forEach(d=>{
    const [x1,y1]=toMin(d.xRange[0], d.yRange[0]); const [x2,y2]=toMin(d.xRange[1], d.yRange[1]);
    mctx.fillStyle= '#'+d.color.toString(16).padStart(6,'0')+'22';
    mctx.fillRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
  });
  // buildings
  mctx.fillStyle='rgba(255,255,255,.55)';
  buildings.forEach(b=>{
    const [x,y]=toMin(b.x,b.z);
    const sz= Math.max(2, b.w*scale*0.6);
    mctx.fillRect(x-sz/2, y-sz/2, sz, sz);
    if(b.isShop){ mctx.fillStyle='rgba(0,255,208,.9)'; mctx.fillRect(x-2,y-2,4,4); mctx.fillStyle='rgba(255,255,255,.55)'; }
  });
  // mission marker
  const mm=missions[currentMission];
  const [mx,my]=toMin(mm.pos.x, mm.pos.z);
  const pulse= (Math.sin(performance.now()*0.005)+1)/2;
  mctx.fillStyle='rgba(0,255,208,'+(0.6+0.3*pulse)+')';
  mctx.beginPath(); mctx.arc(mx,my, 6+2*pulse,0,Math.PI*2); mctx.fill();
  mctx.fillStyle='#00ffd0'; mctx.beginPath(); mctx.arc(mx,my,3,0,Math.PI*2); mctx.fill();
  // NPCs
  mctx.fillStyle='rgba(120,200,255,.9)';
  npcs.forEach(n=>{ const [x,y]=toMin(n.position.x,n.position.z); mctx.fillRect(x-1,y-1,2,2); });
  // traffic
  mctx.fillStyle='rgba(255,255,255,.35)';
  trafficCars.forEach(c=>{ const [x,y]=toMin(c.position.x,c.position.z); mctx.fillRect(x-1.5,y-1.5,3,3); });
  // police
  mctx.fillStyle='#ff3b30';
  policeCars.forEach(p=>{ const [x,y]=toMin(p.position.x,p.position.z); mctx.beginPath(); mctx.arc(x,y,3,0,Math.PI*2); mctx.fill(); });
  // vehicles
  mctx.fillStyle='rgba(255,234,0,.9)';
  vehicles.forEach(v=>{ const [x,y]=toMin(v.position.x,v.position.z); mctx.fillRect(x-2,y-2,4,4); });
  // player
  const pPos= player.isInVehicle? player.vehicle.position : player.pos;
  const [px,py]=toMin(pPos.x,pPos.z);
  mctx.fillStyle='#ffffff'; mctx.beginPath(); mctx.arc(px,py,4,0,Math.PI*2); mctx.fill();
  mctx.strokeStyle='#00ffd0'; mctx.lineWidth=2; mctx.beginPath(); mctx.moveTo(px,py); const dirLen=10; const yaw= player.isInVehicle? player.vehicle.rotation.y: player.yaw; mctx.lineTo(px+Math.sin(yaw)*dirLen, py+Math.cos(yaw)*dirLen); mctx.stroke();
  // border
  mctx.strokeStyle='rgba(255,255,255,.12)'; mctx.lineWidth=2; mctx.strokeRect(4,4,s-8,s-8);
  // N arrow
  mctx.fillStyle='rgba(255,255,255,.6)'; mctx.font='8px monospace'; mctx.fillText('N', s/2-4, 12);
}

// ——— Street race simple
let raceActive=false;
function startStreetRace(){
  if(raceActive) return;
  raceActive=true;
  toast('🏁 سباق الشارع — 3 لفات حول Downtown!');
  let lap=0, checkpoints=[ new THREE.Vector3(80,0,80), new THREE.Vector3(-80,0,80), new THREE.Vector3(-80,0,-80), new THREE.Vector3(80,0,-80) ];
  let idx=0;
  const raceMarker=new THREE.Mesh(new THREE.CylinderGeometry(6,6,0.6,12), new THREE.MeshStandardMaterial({color:0xffea00, emissive:0xffea00, emissiveIntensity:1.2}));
  raceMarker.position.copy(checkpoints[0]); raceMarker.position.y=0.4; scene.add(raceMarker);
  const int=setInterval(()=>{
    if(!raceActive){ clearInterval(int); scene.remove(raceMarker); return; }
    const pPos= player.isInVehicle? player.vehicle.position: player.pos;
    if(pPos.distanceTo(checkpoints[idx])<12){
      idx=(idx+1)%checkpoints.length;
      if(idx===0){ lap++; toast('🔄 لفة '+lap+'/3'); if(lap>=3){ clearInterval(int); scene.remove(raceMarker); raceActive=false; player.money+=1800; updateHUD(); toast('🏆 فزت بالسباق! +$1800'); } }
      raceMarker.position.copy(checkpoints[idx]);
    }
  },200);
  // rivals: spawn 3 traffic as rivals
  for(let i=0;i<3;i++) spawnPolice(checkpoints[i].clone().add(new THREE.Vector3(rand(-10,10),0,rand(-10,10)))); // reuse police as rivals visually?
  // auto timeout 90s
  setTimeout(()=>{ if(raceActive){ raceActive=false; clearInterval(int); scene.remove(raceMarker); toast('⏱ انتهى السباق'); }}, 90000);
}

// ——— Random events timer
const randomEvents=[
  ()=>{ toast('👜 نشل في السوق! أمسك اللص قرب FreshMart'); spawnPolice(new THREE.Vector3(-30,0,100)); player.wanted=Math.min(5, player.wanted+1); updateHUD(); },
  ()=>{ toast('💥 حادث سير عند التقاطع — إسعاف قادم'); for(let i=0;i<2;i++) spawnPolice(new THREE.Vector3(rand(-40,40),0,rand(-40,40))); },
  ()=>{ toast('💼 حقيبة فلوس سقطت! التقطها = نجمتان'); const bag=new THREE.Mesh(new THREE.BoxGeometry(1.2,0.8,0.6), matFor(0xffea00)); bag.position.set(rand(-80,80),0.4,rand(-80,80)); scene.add(bag); let t=0; const iv=setInterval(()=>{ t+=0.5; bag.rotation.y+=0.1; bag.position.y=0.4+Math.sin(t)*0.2; if(bag.position.distanceTo(player.pos)<2.2){ clearInterval(iv); scene.remove(bag); player.money+=600; player.wanted=Math.min(5, player.wanted+2); updateHUD(); toast('💰 +$600 لكن الشرطة تطاردك!'); } if(t>30){ clearInterval(iv); scene.remove(bag);} },100); },
  ()=> toast('🐕 كلب ضائع في الضواحي — أعده لصاحبه +$200'),
  ()=> toast('🎉 حفل نيون في Downtown — ارقص واكسب ملابس'),
  ()=>{ toast('🚓 مطاردة عابرة — الشرطة تطارد مجرم NPC'); const p=spawnPolice(player.pos.clone().add(new THREE.Vector3(40,0,0))); p.position.y=0; },
  ()=> toast('⛽ سيارة معطلة تطلب المساعدة'),
  ()=> toast('📷 سائح تائه يطلب توصيله لنقطة تصوير'),
  ()=> toast('🌪️ رياح تطيّر صناديق — اجمعها! +$80'),
  ()=> toast('🍔 شجار في المقهى — تدخل؟'),
];
let eventTimer= 18;
function updateRandomEvents(dt){
  eventTimer-=dt;
  if(eventTimer<=0){
    eventTimer= rand(32,58);
    const ev=pick(randomEvents); ev();
  }
}

// ——— Resize
addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ——— Main loop
setLoad(82,'تحميل الأنيميشن والأصوات...');
let lastTime=performance.now();
let paused=false;

// initial HUD
updateHUD(); updateMission();
toast('🌴 مرحباً في SOLARA BAY — اضغط Click للعب، V لتغيير المنظور');
setTimeout(()=> toast('💡 اذهب إلى العلامة التركوازية للبدء — F للركوب، E للمتاجر'), 1800);

function animate(){
  requestAnimationFrame(animate);
  const now=performance.now();
  const dt=Math.min(0.033, (now-lastTime)/1000);
  lastTime=now;
  if(pauseModal.classList.contains('show')||shopModal.classList.contains('show')||missionModal.classList.contains('show')){
    renderer.render(scene, camera);
    drawMinimap();
    return;
  }
  // updates
  updateWorld(dt);
  updatePlayer(dt);
  updateVehicle(dt);
  updateNPCs(dt);
  updateTraffic(dt);
  updateWanted(dt);
  updateInteraction();
  checkDistrict();
  checkMissions(dt);
  updateRandomEvents(dt);
  updateCamera(dt);
  updateHUD();
  // marker bob
  const bob=Math.sin(now*0.002)*1.2;
  missionMarker.position.y=0.3+bob;
  markerBeam.position.y=15+bob;
  markerBeam.rotation.y+=dt*0.6;
  // animate beach water
  water.position.y=-0.4+Math.sin(now*0.001)*0.12;
  drawMinimap();
  renderer.render(scene, camera);
}
setLoad(100,'جاهز! اضغط للبدء ✨');
setTimeout(()=> loading.classList.add('hide'), 700);
animate();

// ——— Expose for shop inline handlers (needs global)
window.toast=toast;

// ——— Bonus: spawn a little drone for flair
const drone=new THREE.Group();
const droneBody=new THREE.Mesh(new THREE.BoxGeometry(1.2,0.3,1.2), matFor(0x2a2a2a)); drone.add(droneBody);
for(let i=0;i<4;i++){
  const prop=new THREE.Mesh(new THREE.BoxGeometry(0.8,0.1,0.2), matFor(0x9fd8ff)); const ang=i*Math.PI/2+Math.PI/4; prop.position.set(Math.cos(ang)*0.9,0.2,Math.sin(ang)*0.9); drone.add(prop);
}
drone.position.set(30,22,-40); scene.add(drone);
// animate drone separately in loop? add to animate via extra ticker
setInterval(()=>{ drone.position.x+= Math.sin(performance.now()*0.0006)*0.04; drone.rotation.y+=0.01; drone.position.y=22+Math.sin(performance.now()*0.001)*1.2; drone.children.forEach((c,i)=>{ if(i>0) c.rotation.y+=0.4; }); },16);

// ——— Prevent context menu on right click
canvas.addEventListener('contextmenu', e=> e.preventDefault());

// ——— Help: WASD etc already
