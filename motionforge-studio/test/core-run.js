const { launch } = require('./launch'); const path=require('path'); const fs=require('fs');
(async()=>{
  const b = await launch(); const p = await b.newPage();
  p.on('console', m=>console.log('[page]', m.text())); p.on('pageerror', e=>console.log('[pageerror]', e.message));
  await p.goto('file://'+path.join(__dirname,'core-test.html'));
  const r = await p.evaluate(()=>window.run()); console.log(r.join('\n'));
  const png = await p.evaluate(()=>window.__png); fs.mkdirSync('.test-out',{recursive:true});
  fs.writeFileSync('.test-out/core.png', Buffer.from(png.split(',')[1],'base64'));
  await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
