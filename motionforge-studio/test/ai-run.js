const { launch } = require('./launch'); const path=require('path'); const fs=require('fs');
const cases = [
  ['walk from left to right, stop in the middle, wave, then continue walking', [0,12,36,60,72,84,100,120,140,160,180,200]],
  ['Make the character run for 3 seconds', [0,10,20,30,40,50,60,72]],
  ['A character walks into a room, sits on a chair and waves', [0,12,30,50,70,90,110,130,150,170,190,210]],
];
(async()=>{
  const b = await launch(); const p = await b.newPage();
  p.on('console', m=>console.log('[page]', m.text())); p.on('pageerror', e=>console.log('[pageerror]', e.message));
  await p.goto('file://'+path.join(__dirname,'ai-test.html'));
  fs.mkdirSync('.test-out',{recursive:true});
  let i=0;
  for (const [prompt, frames] of cases) {
    const r = await p.evaluate((pr,fr)=>window.run(pr,fr), prompt, frames).catch(e=>({error:String(e)}));
    console.log('\n=== '+prompt); if(r.error){console.log('ERROR',r.error);continue;}
    console.log(r.desc.map(d=>d.k+': '+d.d).join('\n')); console.log('warnings', JSON.stringify(r.plan.warnings)); console.log('report', JSON.stringify(r.report)); console.log('dur', r.dur, 'layers', r.layers.join(', ')); console.log('x/y/sx', JSON.stringify(r.xs));
    fs.writeFileSync(`.test-out/ai${i++}.png`, Buffer.from(r.png.split(',')[1],'base64'));
  }
  await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
