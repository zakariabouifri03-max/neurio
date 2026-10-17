import * as THREE from 'three';
import { PRODUCTS, BASE_COLORS, SIZES, formatPrice, createMonkeyCanvas, seeded } from './rules.js';
import { createTShirtModel, applyMonkeyTexture } from './models.js';
import { MonkeyStore } from './store.js';

const $ = id => document.getElementById(id);
const store = new MonkeyStore();
let renderer, scene, camera, heroTShirt, modalTShirt;
let heroScene, heroCamera, heroRenderer;
let activeProduct = null;
let selectedColor = 'white';
let selectedSize = 'M';
let qty = 1;

const rand = seeded(123);

function toast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translate(-50%,10px)'; setTimeout(()=>el.remove(),300); }, 2800);
}

function colorHex(id) {
  return BASE_COLORS.find(c=>c.id===id)?.hex || '#ffffff';
}

function initThree() {
  // hero 3D
  const heroCanvas = $('hero-canvas');
  if (heroCanvas) {
    heroScene = new THREE.Scene();
    heroCamera = new THREE.PerspectiveCamera(28, heroCanvas.clientWidth / heroCanvas.clientHeight, 0.1, 100);
    heroCamera.position.set(0, 0.2, 2.6);
    heroRenderer = new THREE.WebGLRenderer({ canvas: heroCanvas, antialias:true, alpha:true, powerPreference:'high-performance' });
    heroRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    heroRenderer.setSize(heroCanvas.clientWidth, heroCanvas.clientHeight, false);
    heroRenderer.shadowMap.enabled = true;
    heroRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    heroRenderer.outputColorSpace = THREE.SRGBColorSpace;
    heroRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    heroRenderer.toneMappingExposure = 1.15;

    heroScene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(2, 3, 2);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024,1024);
    heroScene.add(dir);
    const fill = new THREE.DirectionalLight(0xffe0a0, 0.5);
    fill.position.set(-2, 1, -1);
    heroScene.add(fill);

    heroTShirt = createTShirtModel();
    heroScene.add(heroTShirt.group);
    heroTShirt.group.rotation.y = -0.4;
    heroTShirt.group.position.y = -0.15;

    const canvas = createMonkeyCanvas('banana', 512, '#ffffff');
    applyMonkeyTexture(heroTShirt, canvas, '#ffffff');

    const animate = () => {
      heroTShirt.group.rotation.y += 0.004;
      heroTShirt.group.rotation.x = Math.sin(Date.now()*0.0006)*0.08;
      heroRenderer.render(heroScene, heroCamera);
      requestAnimationFrame(animate);
    };
    animate();

    window.addEventListener('resize', ()=>{
      if(!heroCanvas) return;
      heroCamera.aspect = heroCanvas.clientWidth / heroCanvas.clientHeight;
      heroCamera.updateProjectionMatrix();
      heroRenderer.setSize(heroCanvas.clientWidth, heroCanvas.clientHeight, false);
    });
  }

  // modal 3D
  const modalCanvas = $('modal-canvas');
  if (modalCanvas) {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(26, modalCanvas.clientWidth / modalCanvas.clientHeight, 0.1, 100);
    camera.position.set(0, 0.15, 2.4);
    renderer = new THREE.WebGLRenderer({ canvas: modalCanvas, antialias:true, alpha:true, powerPreference:'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(modalCanvas.clientWidth, modalCanvas.clientHeight, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(2, 3, 2);
    dir.castShadow = true;
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0xffe0a0, 0.45);
    fill.position.set(-2, 1, -1);
    scene.add(fill);

    modalTShirt = createTShirtModel();
    scene.add(modalTShirt.group);
    modalTShirt.group.rotation.y = -0.3;

    const animate = () => {
      if (modalTShirt) {
        modalTShirt.group.rotation.y += 0.005;
      }
      if (renderer && scene && camera) renderer.render(scene, camera);
      requestAnimationFrame(animate);
    };
    animate();

    window.addEventListener('resize', ()=>{
      if(!modalCanvas) return;
      camera.aspect = modalCanvas.clientWidth / modalCanvas.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(modalCanvas.clientWidth, modalCanvas.clientHeight, false);
    });

    // drag to rotate
    let dragging=false, lastX=0;
    modalCanvas.addEventListener('pointerdown', e=>{ dragging=true; lastX=e.clientX; modalCanvas.setPointerCapture(e.pointerId); });
    modalCanvas.addEventListener('pointermove', e=>{
      if(!dragging) return;
      modalTShirt.group.rotation.y += (e.clientX-lastX)*0.01;
      lastX=e.clientX;
    });
    window.addEventListener('pointerup', ()=>{ dragging=false; });
  }
}

function renderProducts(filter='all') {
  const grid = $('product-grid');
  if (!grid) return;
  grid.innerHTML='';
  const filtered = filter==='all' ? PRODUCTS : PRODUCTS.filter(p=> (filter==='new'&&p.new) || (filter==='bestseller'&&p.bestseller) || (filter==='sale') || p.type===filter);
  filtered.forEach(product=>{
    const card = document.createElement('div');
    card.className='card';
    const canvas = createMonkeyCanvas(product.type, 256, '#ffffff');
    const img = document.createElement('canvas');
    img.width=img.height=256;
    const ctx=img.getContext('2d');
    // t-shirt preview 2D
    ctx.fillStyle='#1e1e1e';
    ctx.fillRect(0,0,256,256);
    // draw t-shirt shape
    ctx.fillStyle='#ffffff';
    ctx.beginPath();
    ctx.moveTo(70,40); ctx.lineTo(50,50); ctx.lineTo(65,70); ctx.lineTo(78,60); ctx.lineTo(78,200); ctx.lineTo(178,200); ctx.lineTo(178,60); ctx.lineTo(191,70); ctx.lineTo(206,50); ctx.lineTo(186,40); ctx.bezierCurveTo(158,55,98,55,70,40);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle='#00000022'; ctx.lineWidth=2; ctx.stroke();
    // monkey
    ctx.drawImage(canvas, 78, 60, 100, 100);
    // tag
    ctx.fillStyle='#0f0f0f'; ctx.font='bold 10px Barlow'; ctx.textAlign='center'; ctx.fillText('MONKEY CO.',128,188);

    card.innerHTML=`
      <div class="card-media">
        <div style="width:92%;height:92%;display:grid;place-items:center">${img.outerHTML}</div>
        <div class="card-badges">
          ${product.new?'<span class="badge new">NEW</span>':''}
          ${product.bestseller?'<span class="badge best">BESTSELLER</span>':''}
          <span class="badge sale">-${Math.round((1-product.price/product.originalPrice)*100)}%</span>
        </div>
        <div class="card-actions">
          <button class="mini-btn quick-view" title="Quick view">👁️</button>
          <button class="mini-btn add-cart" title="Add to cart">🛒</button>
        </div>
      </div>
      <div class="card-body">
        <div class="card-title"><span>${product.emoji}</span> ${product.name}</div>
        <p class="card-desc">${product.description}</p>
        <div class="card-meta">
          <div class="price"><b>${formatPrice(product.price)}</b><s>${formatPrice(product.originalPrice)}</s></div>
          <div class="rating">★ <b>${product.rating.toFixed(1)}</b> (${product.reviews})</div>
        </div>
      </div>
    `;
    // replace canvas placeholder with actual canvas
    const mediaDiv = card.querySelector('.card-media > div');
    mediaDiv.innerHTML='';
    mediaDiv.appendChild(img);

    card.querySelector('.quick-view').onclick = ()=>openProduct(product.id);
    card.querySelector('.add-cart').onclick = ()=>{
      store.addToCart(product.id, product.colors[0], 'M', 1);
      toast(`Added ${product.name} to cart`);
    };
    card.onclick = (e)=>{
      if(e.target.closest('.mini-btn')) return;
      openProduct(product.id);
    };
    grid.appendChild(card);
  });
}

function openProduct(productId) {
  const product = PRODUCTS.find(p=>p.id===productId);
  if(!product) return;
  activeProduct = product;
  selectedColor = product.colors[0];
  selectedSize = 'M';
  qty = 1;

  const modal = $('product-modal');
  modal.hidden = false;
  $('modal-name').textContent = product.name;
  $('modal-desc').textContent = product.description;
  $('modal-price').textContent = formatPrice(product.price);
  $('modal-original').textContent = formatPrice(product.originalPrice);
  $('modal-rating').textContent = `★ ${product.rating.toFixed(1)} (${product.reviews} reviews)`;
  $('modal-stock').textContent = `● ${product.stock} in stock • Free shipping over $50`;

  // colors
  const colorsDiv = $('modal-colors');
  colorsDiv.innerHTML='';
  product.colors.forEach(colorId=>{
    const col = BASE_COLORS.find(c=>c.id===colorId);
    const btn = document.createElement('button');
    btn.className='color'+(colorId===selectedColor?' active':'');
    btn.style.background=col.hex;
    btn.title=col.name;
    btn.innerHTML=`<b></b>`;
    btn.onclick=()=>{
      selectedColor=colorId;
      colorsDiv.querySelectorAll('.color').forEach(c=>c.classList.remove('active'));
      btn.classList.add('active');
      $('modal-color-name').textContent = col.name;
      updateModalTexture();
    };
    colorsDiv.appendChild(btn);
  });
  $('modal-color-name').textContent = BASE_COLORS.find(c=>c.id===selectedColor)?.name || '';

  // sizes
  const sizesDiv=$('modal-sizes');
  sizesDiv.innerHTML='';
  SIZES.forEach(size=>{
    const btn=document.createElement('button');
    btn.className='size'+(size===selectedSize?' active':'');
    btn.textContent=size;
    btn.disabled=!product.sizes.includes(size);
    btn.onclick=()=>{
      selectedSize=size;
      sizesDiv.querySelectorAll('.size').forEach(s=>s.classList.remove('active'));
      btn.classList.add('active');
    };
    sizesDiv.appendChild(btn);
  });

  $('modal-qty').textContent=qty;
  updateModalTexture();
}

function updateModalTexture() {
  if(!modalTShirt || !activeProduct) return;
  const monkeyCanvas = createMonkeyCanvas(activeProduct.type, 512, '#ffffff');
  applyMonkeyTexture(modalTShirt, monkeyCanvas, colorHex(selectedColor));
}

function closeProduct() {
  $('product-modal').hidden=true;
  activeProduct=null;
}

function renderCart() {
  const count = store.cartCount();
  $('cart-count').textContent=count;
  $('cart-count-2').textContent=count;
  const body=$('cart-body');
  const items=store.cartItemsDetailed();
  if(items.length===0){
    body.innerHTML=`<div class="empty"><b>Your cart is empty</b>Monkeys are sad. Add some tees!<br><br><button class="secondary" onclick="document.getElementById('cart').hidden=true">Continue Shopping</button></div>`;
    $('cart-total').textContent='$0.00';
    return;
  }
  body.innerHTML='';
  items.forEach(item=>{
    const div=document.createElement('div');
    div.className='cart-item';
    const canvas=createMonkeyCanvas(item.product.type, 128, '#ffffff');
    const preview=document.createElement('canvas');
    preview.width=preview.height=78;
    const ctx=preview.getContext('2d');
    ctx.fillStyle='#ffffff0a'; ctx.fillRect(0,0,78,78);
    ctx.fillStyle=colorHex(item.colorId);
    ctx.beginPath();
    ctx.moveTo(18,12); ctx.lineTo(12,16); ctx.lineTo(17,22); ctx.lineTo(21,19); ctx.lineTo(21,60); ctx.lineTo(57,60); ctx.lineTo(57,19); ctx.lineTo(61,22); ctx.lineTo(66,16); ctx.lineTo(60,12); ctx.bezierCurveTo(50,16,28,16,18,12);
    ctx.fill();
    ctx.drawImage(canvas, 21, 16, 36, 36);
    div.innerHTML=`
      <div class="cart-item-media"></div>
      <div class="cart-item-info">
        <strong>${item.product.name}</strong>
        <small>${item.color.name} • ${item.size}</small>
        <div class="cart-item-actions">
          <div class="qty"><button class="dec">−</button><span>${item.qty}</span><button class="inc">+</button></div>
          <button class="remove" style="font:10px var(--mono);color:var(--muted)">Remove</button>
        </div>
      </div>
      <div class="cart-item-price">${formatPrice(item.subtotal)}</div>
    `;
    div.querySelector('.cart-item-media').appendChild(preview);
    div.querySelector('.dec').onclick=()=>store.updateQty(item.index, item.qty-1);
    div.querySelector('.inc').onclick=()=>store.updateQty(item.index, item.qty+1);
    div.querySelector('.remove').onclick=()=>store.removeFromCart(item.index);
    body.appendChild(div);
  });
  $('cart-total').textContent=formatPrice(store.cartTotal());
}

function openCart() {
  $('cart').hidden=false;
  renderCart();
}
function closeCart(){ $('cart').hidden=true; }

function openCheckout() {
  if(store.cartCount()===0){ toast('Cart empty'); return; }
  closeCart();
  $('checkout-modal').hidden=false;
  const items=store.cartItemsDetailed();
  const summary=$('order-summary-items');
  summary.innerHTML='';
  items.forEach(item=>{
    const row=document.createElement('div');
    row.className='summary-row';
    row.innerHTML=`<span>${item.product.name} ×${item.qty}</span><b>${formatPrice(item.subtotal)}</b>`;
    summary.appendChild(row);
  });
  $('summary-total').textContent=formatPrice(store.cartTotal()+8);
  $('summary-subtotal').textContent=formatPrice(store.cartTotal());
}

function submitOrder(e){
  e.preventDefault();
  const formData={
    email:$('field-email').value,
    name:$('field-name').value,
    address:$('field-address').value,
    city:$('field-city').value,
    zip:$('field-zip').value,
    card:$('field-card').value,
  };
  const order=store.checkout(formData);
  $('checkout-modal').hidden=true;
  $('success-modal').hidden=false;
  $('order-id').textContent=order.id;
  $('order-total').textContent=formatPrice(order.total+8);
}

function initUI(){
  const bind = (id, event, fn) => { const el=$(id); if(el) el[event]=fn; };
  const on = (id, ev, fn) => { const el=$(id); if(el) el.addEventListener(ev, fn); };
  // filters
  document.querySelectorAll('.filter').forEach(btn=>{
    btn.onclick=()=>{
      document.querySelectorAll('.filter').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      renderProducts(btn.dataset.filter);
    };
  });
  // hero CTAs
  bind('hero-shop','onclick',()=>{ document.getElementById('products').scrollIntoView({behavior:'smooth'}); });
  bind('hero-custom','onclick',()=>{ openProduct('banana'); });
  // header
  bind('cart-btn','onclick',openCart);
  bind('cart-close','onclick',closeCart);
  bind('cart-backdrop','onclick',closeCart);
  bind('checkout-btn','onclick',openCheckout);
  bind('checkout-close','onclick',()=>{$('checkout-modal').hidden=true;});
  bind('checkout-backdrop','onclick',()=>{$('checkout-modal').hidden=true;});
  bind('checkout-form','onsubmit',submitOrder);
  bind('success-close','onclick',()=>{$('success-modal').hidden=true;});
  bind('success-backdrop','onclick',()=>{$('success-modal').hidden=true;});
  bind('continue-shopping','onclick',()=>{$('success-modal').hidden=true;});
  // product modal
  bind('modal-close','onclick',closeProduct);
  on('product-modal','click',(e)=>{ if(e.target.id==='product-modal') closeProduct(); });
  bind('modal-dec','onclick',()=>{ qty=Math.max(1,qty-1); const el=$('modal-qty'); if(el) el.textContent=qty; });
  bind('modal-inc','onclick',()=>{ qty++; const el=$('modal-qty'); if(el) el.textContent=qty; });
  bind('modal-add','onclick',()=>{
    if(!activeProduct) return;
    store.addToCart(activeProduct.id, selectedColor, selectedSize, qty);
    toast(`Added ${qty} × ${activeProduct.name} to cart`);
    closeProduct();
    openCart();
  });
  // search
  const search=$('search-input');
  if(search){
    search.oninput=()=>{
      const q=search.value.toLowerCase();
      if(!q){ renderProducts('all'); return; }
      const filtered=PRODUCTS.filter(p=>p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
      const grid=$('product-grid');
      grid.innerHTML='';
      filtered.forEach(p=>{
        const card=document.createElement('div');
        card.className='card';
        card.innerHTML=`<div class="card-body"><div class="card-title">${p.emoji} ${p.name}</div><div class="price"><b>${formatPrice(p.price)}</b></div></div>`;
        card.onclick=()=>openProduct(p.id);
        grid.appendChild(card);
      });
    };
  }

  store.onChange(renderCart);
  renderCart();
  renderProducts('all');
}

async function boot(){
  await document.fonts.ready;
  initThree();
  initUI();
  const loading=$('loading');
  if(loading){ loading.style.opacity='0'; setTimeout(()=>{ loading.hidden=true; }, 400); }
  if('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('./sw.js'); }catch(e){ console.warn('SW fail', e); }
  }
}

boot();
