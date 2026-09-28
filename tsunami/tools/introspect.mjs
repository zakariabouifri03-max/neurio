const stubCtx = new Proxy({}, { get: (t,k) => {
  if (k === 'canvas') return { width: 8, height: 8 };
  if (k === 'createImageData' || k === 'getImageData') return (a,b,c,d)=> ({data:new Uint8ClampedArray((c||a)*(d||b||1)*4), width:c||a, height:d||b||1});
  if (k === 'putImageData') return ()=>{};
  return ()=>{}; } , set: ()=>true });
globalThis.document = { createElement: (t)=> t==='canvas' ? { width:8, height:8, getContext: ()=>stubCtx, style:{}, classList:{add(){},remove(){},toggle(){}} , addEventListener(){}, appendChild(){}} : {style:{},classList:{add(){},remove(){}},appendChild(){},querySelector:()=>null,addEventListener(){},dataset:{}}, getElementById: ()=>null, addEventListener(){}, body:{appendChild(){},style:{}}, querySelector:()=>null };
globalThis.window = { innerWidth:800, innerHeight:600, devicePixelRatio:1, addEventListener(){}, location:{href:''}, navigator:{userAgent:'node'}, requestAnimationFrame:()=>0 };
Object.defineProperty(globalThis,'navigator',{value:{userAgent:'node',maxTouchPoints:0,hardwareConcurrency:8,deviceMemory:8},configurable:true});
globalThis.localStorage = { getItem:()=>null, setItem(){}, removeItem(){} };
globalThis.self = globalThis;
const path = await import('node:path');
const files = process.argv.slice(2).map(f => path.resolve(process.cwd(), f));
for (const f of files) {
  try {
    const m = await import(f);
    const out = [];
    for (const [k,v] of Object.entries(m)) {
      if (typeof v === 'function' && v.prototype) out.push(`${k}{${Object.getOwnPropertyNames(v.prototype).filter(n=>n!=='constructor').join(',')}}`);
      else if (typeof v === 'object') out.push(`${k}:obj`);
    }
    console.log(`\n## ${path.basename(f)}\n` + out.join('\n'));
  } catch (e) { console.log(`\n## ${f} IMPORT ERROR: ${e.message}`); }
}
