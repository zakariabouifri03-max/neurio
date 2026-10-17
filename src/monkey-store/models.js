import * as THREE from 'three';

export function createTShirtModel() {
  const group = new THREE.Group();

  // front panel - slightly curved via shape
  const shape = new THREE.Shape();
  shape.moveTo(-0.6, 0.8);
  shape.lineTo(-0.8, 0.8);
  shape.lineTo(-1.1, 0.55);
  shape.lineTo(-0.85, 0.45);
  shape.lineTo(-0.65, 0.7);
  shape.lineTo(-0.65, -0.9);
  shape.lineTo(0.65, -0.9);
  shape.lineTo(0.65, 0.7);
  shape.lineTo(0.85, 0.45);
  shape.lineTo(1.1, 0.55);
  shape.lineTo(0.8, 0.8);
  shape.lineTo(0.6, 0.8);
  shape.bezierCurveTo(0.3, 0.95, -0.3, 0.95, -0.6, 0.8);

  const extrudeSettings = { depth:0.12, bevelEnabled:true, bevelThickness:0.02, bevelSize:0.015, bevelSegments:3 };
  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geometry.center();
  geometry.computeVertexNormals();

  const material = new THREE.MeshPhysicalMaterial({ 
    color:0xffffff, 
    roughness:0.65, 
    metalness:0.02, 
    clearcoat:0.3, 
    clearcoatRoughness:0.5,
    side:THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow=true;
  mesh.receiveShadow=true;
  mesh.position.y=0.1;
  group.add(mesh);

  // sleeves as separate for better shading
  const sleeveGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.45, 16);
  sleeveGeo.rotateZ(Math.PI/2);
  const leftSleeve = new THREE.Mesh(sleeveGeo, material);
  leftSleeve.position.set(-0.92, 0.45, 0);
  leftSleeve.rotation.z = -0.35;
  leftSleeve.castShadow=true;
  group.add(leftSleeve);
  const rightSleeve = leftSleeve.clone();
  rightSleeve.position.set(0.92, 0.45, 0);
  rightSleeve.rotation.z = 0.35;
  group.add(rightSleeve);

  // neckline
  const neckGeo = new THREE.TorusGeometry(0.32, 0.035, 12, 24, Math.PI*1.2);
  neckGeo.rotateX(Math.PI/2);
  neckGeo.rotateZ(Math.PI*0.6);
  const neckMat = new THREE.MeshPhysicalMaterial({ color:0xffffff, roughness:0.7 });
  const neck = new THREE.Mesh(neckGeo, neckMat);
  neck.position.set(0, 0.82, 0);
  group.add(neck);

  // shadow
  const shadowCanvas=document.createElement('canvas');
  shadowCanvas.width=shadowCanvas.height=128;
  const sctx=shadowCanvas.getContext('2d');
  const grad=sctx.createRadialGradient(64,64,10,64,64,60);
  grad.addColorStop(0,'rgba(0,0,0,0.35)'); grad.addColorStop(1,'rgba(0,0,0,0)');
  sctx.fillStyle=grad; sctx.fillRect(0,0,128,128);
  const shadowTex=new THREE.CanvasTexture(shadowCanvas);
  const shadowMat=new THREE.MeshBasicMaterial({ map:shadowTex, transparent:true, depthWrite:false });
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(2.2,1.6), shadowMat);
  shadow.rotation.x=-Math.PI/2;
  shadow.position.y=-0.95;
  group.add(shadow);

  group.traverse(o=>{ if(o.isMesh) o.frustumCulled=false; });

  return { group, mesh, leftSleeve, rightSleeve, neck, material, shadow };
}

export function applyMonkeyTexture(tshirt, monkeyCanvas, baseColorHex) {
  const tex = new THREE.CanvasTexture(monkeyCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // create combined texture: base color + monkey in center
  const combined = document.createElement('canvas');
  combined.width=1024; combined.height=1024;
  const ctx=combined.getContext('2d');
  ctx.fillStyle = baseColorHex;
  ctx.fillRect(0,0,1024,1024);
  // fabric noise
  for(let i=0;i<15000;i++){
    ctx.fillStyle=`rgba(0,0,0,${Math.random()*0.04})`;
    ctx.fillRect(Math.random()*1024, Math.random()*1024, 2,2);
  }
  // draw monkey in center, scaled
  const scale=0.58;
  const w=monkeyCanvas.width*scale, h=monkeyCanvas.height*scale;
  ctx.drawImage(monkeyCanvas, (1024-w)/2, (1024-h)/2 - 40, w, h);
  // add RABONA tag at bottom
  ctx.fillStyle='rgba(0,0,0,0.85)';
  ctx.font='bold 36px Barlow, Arial';
  ctx.textAlign='center';
  ctx.fillText('MONKEY CO. — RABONA', 512, 920);

  const finalTex=new THREE.CanvasTexture(combined);
  finalTex.colorSpace=THREE.SRGBColorSpace;
  finalTex.anisotropy=16;
  tshirt.material.map=finalTex;
  tshirt.material.needsUpdate=true;
  // also update sleeves to base color but slightly darker
  const baseMat = tshirt.material;
  // sleeves keep same base but no monkey
  const sleeveCanvas=document.createElement('canvas');
  sleeveCanvas.width=256; sleeveCanvas.height=256;
  const sctx=sleeveCanvas.getContext('2d');
  sctx.fillStyle=baseColorHex;
  sctx.fillRect(0,0,256,256);
  for(let i=0;i<2000;i++){ sctx.fillStyle=`rgba(0,0,0,${Math.random()*0.05})`; sctx.fillRect(Math.random()*256, Math.random()*256,1,1); }
  const sleeveTex=new THREE.CanvasTexture(sleeveCanvas);
  sleeveTex.colorSpace=THREE.SRGBColorSpace;
  tshirt.leftSleeve.material = baseMat.clone();
  tshirt.leftSleeve.material.map=sleeveTex;
  tshirt.rightSleeve.material = tshirt.leftSleeve.material;
  tshirt.neck.material = tshirt.leftSleeve.material.clone();
}
