// Real-browser tests for MONKEY CO. store
import { chromium } from '@playwright/test';
import bundled, { inflate } from '@sparticuz/chromium';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
await inflate('node_modules/@sparticuz/chromium/bin/al2023.tar.br');
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || await bundled.executablePath(),
  args: bundled.args,
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: [join(tmpdir(),'al2023','lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
});
const base = process.env.TEST_URL || 'http://127.0.0.1:8000';
const page = await browser.newPage({ viewport:{ width:1280, height:800 }, deviceScaleFactor:1 });
page.setDefaultTimeout(60000);
await page.addInitScript(()=>{ localStorage.setItem('monkey-store-cart-v1','[]'); });
const errors=[];
page.on('pageerror', e=>errors.push(e.message));
page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
await mkdir('.cache/screenshots',{recursive:true});
const shot = async name => { if(process.env.SCREENSHOTS==='1') await page.screenshot({path:`.cache/screenshots/${name}.png`, timeout:60000}); };

try {
  await page.goto(`${base}/?test=1`, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(()=>document.getElementById('loading').hidden);
  assert.equal(await page.locator('.brand').isVisible(), true);
  assert.match(await page.locator('.brand').textContent(), /MONKEY/);
  console.log('PASS: header and loading');

  await shot('store-lobby');
  assert.equal(await page.locator('#product-grid .card').count() >= 6, true);
  console.log('PASS: product grid');

  // open first product
  await page.locator('#product-grid .card').first().click();
  await page.waitForFunction(()=>!document.getElementById('product-modal').hidden);
  assert.equal(await page.locator('#modal-name').isVisible(), true);
  const modalName = await page.locator('#modal-name').textContent();
  assert.ok(modalName.includes('Tee'));
  console.log('PASS: product modal open', modalName);

  // check 3D canvas
  assert.equal(await page.locator('#modal-canvas').count(), 1);
  await page.waitForTimeout(500);
  await shot('store-modal');

  // select color and size
  const colorCount = await page.locator('#modal-colors .color').count();
  assert.ok(colorCount >= 2);
  await page.locator('#modal-colors .color').nth(1).click();
  assert.equal(await page.locator('#modal-colors .color.active').count(), 1);
  await page.locator('#modal-sizes .size').nth(2).click();
  assert.equal(await page.locator('#modal-sizes .size.active').count(), 1);

  // add to cart
  await page.locator('#modal-add').click();
  await page.waitForFunction(()=>!document.getElementById('cart').hidden);
  assert.equal(await page.locator('#cart-body .cart-item').count(), 1);
  console.log('PASS: add to cart');

  // add another
  await page.locator('#cart-close').click();
  await page.locator('#product-grid .card').nth(1).click();
  await page.waitForFunction(()=>!document.getElementById('product-modal').hidden);
  await page.locator('#modal-add').click();
  await page.waitForFunction(()=>document.querySelectorAll('#cart-body .cart-item').length===2);
  assert.equal(await page.locator('#cart-body .cart-item').count(), 2);
  console.log('PASS: second product to cart');

  // update qty
  await page.locator('#cart-body .cart-item').first().locator('.inc').click();
  await page.waitForFunction(()=>{
    const el=document.querySelector('#cart-body .cart-item');
    return el && el.textContent.includes('2');
  });
  console.log('PASS: qty increment');

  // checkout
  await page.locator('#checkout-btn').click();
  await page.waitForFunction(()=>!document.getElementById('checkout-modal').hidden);
  assert.equal(await page.locator('#checkout-form').isVisible(), true);
  await shot('store-checkout');

  await page.locator('#field-email').fill('test@monkey.co');
  await page.locator('#field-name').fill('John Banana');
  await page.locator('#field-address').fill('123 Jungle St');
  await page.locator('#field-city').fill('Banana City');
  await page.locator('#field-zip').fill('90210');
  await page.locator('#field-card').fill('4242 4242 4242 4242');
  await page.locator('#checkout-form button[type="submit"]').click();
  await page.waitForFunction(()=>!document.getElementById('success-modal').hidden);
  assert.match(await page.locator('#order-id').textContent(), /MNK-/);
  console.log('PASS: checkout and order success');

  await page.locator('#success-close').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('monkey-store-cart-v1')).length), 0);
  console.log('PASS: cart cleared after checkout');

  // mobile
  await page.setViewportSize({ width:390, height:844 });
  await shot('store-mobile');
  assert.equal(await page.locator('#product-grid').isVisible(), true);
  assert.equal(await page.evaluate(()=>document.body.scrollWidth>innerWidth), false);
  console.log('PASS: mobile layout');

  // offline
  const context = page.context();
  await page.setViewportSize({ width:1280, height:800 });
  await page.goto(`${base}/`, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(()=>document.getElementById('loading').hidden);
  await page.waitForTimeout(1500);
  const swReady = await page.evaluate(async()=>{
    if(!('serviceWorker' in navigator)) return false;
    try{ await navigator.serviceWorker.ready; }catch{ return false; }
    try{
      const cache=await caches.open('monkey-v1');
      const keys=await cache.keys();
      return keys.length>=5;
    }catch{ return false; }
  });
  console.log('SW cached?', swReady);
  await context.setOffline(true);
  await page.reload({ waitUntil:'domcontentloaded' });
  await page.waitForFunction(()=>document.getElementById('loading').hidden, { timeout:15000 }).catch(()=>{});
  assert.equal(await page.locator('.brand').isVisible(), true);
  console.log('PASS: offline reload');

  assert.deepEqual(errors, []);
  console.log('PASS: zero runtime errors');

} finally {
  await browser.close();
}
