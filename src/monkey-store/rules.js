export const MONKEY_TYPES = [
  { id:'banana', name:'Banana Bandit', emoji:'🍌', color:'#ffe066', desc:'Sneaky monkey stealing bananas' },
  { id:'skate', name:'Skate Monkey', emoji:'🛹', color:'#ff6b6b', desc:'Street king with a board' },
  { id:'dj', name:'DJ Monkey', emoji:'🎧', color:'#7a6bff', desc:'Dropping beats in the jungle' },
  { id:'astro', name:'Astro Monkey', emoji:'🚀', color:'#3ab0ff', desc:'First monkey on Mars' },
  { id:'ninja', name:'Ninja Monkey', emoji:'🥷', color:'#2a2a2a', desc:'Silent but silly' },
  { id:'chef', name:'Chef Monkey', emoji:'👨‍🍳', color:'#ff8a3a', desc:'Cooking up chaos' },
  { id:'gamer', name:'Gamer Monkey', emoji:'🎮', color:'#3aff7a', desc:'No lag, just bananas' },
  { id:'surf', name:'Surf Monkey', emoji:'🏄', color:'#3ad0ff', desc:'Riding waves and vines' },
];

export const BASE_COLORS = [
  { name:'Cloud White', hex:'#ffffff', id:'white' },
  { name:'Midnight Black', hex:'#0a0a0a', id:'black' },
  { name:'Banana Yellow', hex:'#ffe066', id:'yellow' },
  { name:'Jungle Green', hex:'#2ecc71', id:'green' },
  { name:'Sky Blue', hex:'#54a0ff', id:'blue' },
  { name:'Coral Pink', hex:'#ff6b9e', id:'pink' },
  { name:'Lava Red', hex:'#ff3a3a', id:'red' },
  { name:'Desert Sand', hex:'#e8d5a8', id:'sand' },
];

export const SIZES = ['XS','S','M','L','XL','XXL'];

export const PRODUCTS = MONKEY_TYPES.map((type, i) => ({
  id: type.id,
  name: `${type.name} Tee`,
  type: type.id,
  emoji: type.emoji,
  basePrice: 29 + (i%3)*6,
  price: 29 + (i%3)*6,
  originalPrice: 45 + (i%2)*10,
  rating: 4.6 + (Math.random()*0.4),
  reviews: 120 + Math.floor(Math.random()*380),
  colors: BASE_COLORS.slice(0, 4 + (i%4)).map(c=>c.id),
  sizes: SIZES,
  description: `${type.desc}. Ultra-soft organic cotton, wobbly monkey approved. Designed in the desert, worn everywhere.`,
  featured: i<3,
  new: i===0 || i===3,
  bestseller: i===1 || i===5,
  stock: 20 + Math.floor(Math.random()*80),
}));

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const formatPrice = (n) => `$${n.toFixed(2)}`;

export function seeded(seed=1337){
  return ()=>{
    seed|=0; seed=seed+0x6D2B79F5|0;
    let t=Math.imul(seed ^ seed>>>15, 1|seed);
    t=t+Math.imul(t ^ t>>>7,61|t) ^ t;
    return ((t ^ t>>>14)>>>0)/4294967296;
  };
}

export function createMonkeyCanvas(type, size=512, bgColor='#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  // bg
  ctx.fillStyle = bgColor;
  ctx.fillRect(0,0,size,size);
  // subtle texture
  for(let i=0;i<2000;i++){
    ctx.fillStyle = `rgba(0,0,0,${Math.random()*0.04})`;
    ctx.fillRect(Math.random()*size, Math.random()*size, 2,2);
  }
  const cx=size/2, cy=size*0.52;
  // monkey face - cartoon ultra
  // ears
  ctx.fillStyle = '#e8b08a';
  ctx.beginPath();
  ctx.ellipse(cx-85, cy-10, 28, 36, -0.2, 0, Math.PI*2);
  ctx.ellipse(cx+85, cy-10, 28, 36, 0.2, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#d69a72';
  ctx.beginPath();
  ctx.ellipse(cx-85, cy-5, 14, 18, 0, 0, Math.PI*2);
  ctx.ellipse(cx+85, cy-5, 14, 18, 0, 0, Math.PI*2);
  ctx.fill();
  // head
  ctx.fillStyle = '#8a5a3a';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 78, 82, 0, 0, Math.PI*2);
  ctx.fill();
  // muzzle
  ctx.fillStyle = '#f5d6b8';
  ctx.beginPath();
  ctx.ellipse(cx, cy+32, 52, 42, 0, 0, Math.PI*2);
  ctx.fill();
  // eyes white
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(cx-24, cy-12, 22, 28, 0, 0, Math.PI*2);
  ctx.ellipse(cx+24, cy-12, 22, 28, 0, 0, Math.PI*2);
  ctx.fill();
  // iris
  const irisColors = { banana:'#7a4a1a', skate:'#1a1a1a', dj:'#6a3aff', astro:'#1a8aff', ninja:'#111111', chef:'#8a4a1a', gamer:'#1aff6a', surf:'#1a8aff' };
  ctx.fillStyle = irisColors[type] || '#3a2a1a';
  ctx.beginPath();
  ctx.arc(cx-24, cy-6, 11, 0, Math.PI*2);
  ctx.arc(cx+24, cy-6, 11, 0, Math.PI*2);
  ctx.fill();
  // pupils
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.arc(cx-24, cy-4, 5, 0, Math.PI*2);
  ctx.arc(cx+24, cy-4, 5, 0, Math.PI*2);
  ctx.fill();
  // highlight
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx-21, cy-10, 3, 0, Math.PI*2);
  ctx.arc(cx+27, cy-10, 3, 0, Math.PI*2);
  ctx.fill();
  // nose
  ctx.fillStyle = '#2a1a0a';
  ctx.beginPath();
  ctx.ellipse(cx-8, cy+22, 5, 4, 0, 0, Math.PI*2);
  ctx.ellipse(cx+8, cy+22, 5, 4, 0, 0, Math.PI*2);
  ctx.fill();
  // mouth - smile
  ctx.strokeStyle = '#2a1a0a';
  ctx.lineWidth = 4;
  ctx.lineCap='round';
  ctx.beginPath();
  ctx.arc(cx, cy+38, 18, 0.15*Math.PI, 0.85*Math.PI);
  ctx.stroke();
  // teeth
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx-10, cy+44, 20, 8);
  ctx.strokeStyle='#2a1a0a'; ctx.lineWidth=1; ctx.strokeRect(cx-10, cy+44, 20, 8);
  ctx.beginPath(); ctx.moveTo(cx, cy+44); ctx.lineTo(cx, cy+52); ctx.stroke();

  // accessories based on type
  ctx.save();
  ctx.translate(cx, cy);
  if(type==='banana'){
    ctx.font = `bold ${size*0.18}px Arial`;
    ctx.fillStyle='#ffe066';
    ctx.fillText('🍌', -size*0.32, -size*0.28);
    ctx.fillText('🍌', size*0.18, size*0.28);
  } else if(type==='skate'){
    ctx.fillStyle='#1a1a1a';
    ctx.fillRect(-60, -92, 120, 12);
    ctx.fillStyle='#ff3a3a';
    ctx.font = `bold ${size*0.08}px Arial`;
    ctx.fillText('SK8', -18, -72);
  } else if(type==='dj'){
    ctx.fillStyle='#1a1a1a';
    ctx.beginPath(); ctx.arc(-52, -8, 22, 0, Math.PI*2); ctx.arc(52, -8, 22, 0, Math.PI*2); ctx.fill();
    ctx.fillRect(-52, -18, 104, 12);
    ctx.fillStyle='#7a6bff'; ctx.font=`${size*0.07}px Arial`; ctx.fillText('♪', -70, -30); ctx.fillText('♫', 60, -32);
  } else if(type==='astro'){
    ctx.strokeStyle='#ffffff'; ctx.lineWidth=8;
    ctx.beginPath(); ctx.arc(0,0,88,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle='rgba(100,180,255,0.18)'; ctx.beginPath(); ctx.arc(0,0,88,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#ffffff'; ctx.font=`${size*0.06}px Arial`; ctx.fillText('NASA', -22, -78);
  } else if(type==='ninja'){
    ctx.fillStyle='#0a0a0a';
    ctx.fillRect(-84, -28, 168, 18);
    ctx.fillStyle='#ff3a3a'; ctx.beginPath(); ctx.arc(0, -18, 6,0,Math.PI*2); ctx.fill();
  } else if(type==='chef'){
    ctx.fillStyle='#ffffff';
    ctx.beginPath(); ctx.ellipse(0, -82, 52, 22, 0,0,Math.PI*2); ctx.fill();
    ctx.fillRect(-46, -82, 92, 18);
  } else if(type==='gamer'){
    ctx.fillStyle='#1a1a1a';
    ctx.fillRect(-42, 72, 84, 22);
    ctx.fillStyle='#3aff7a'; ctx.beginPath(); ctx.arc(-18,82,6,0,Math.PI*2); ctx.arc(0,82,6,0,Math.PI*2); ctx.arc(18,82,6,0,Math.PI*2); ctx.fill();
  } else if(type==='surf'){
    ctx.fillStyle='#ff6b3a';
    ctx.font=`${size*0.14}px Arial`; ctx.fillText('🌊', -size*0.3, size*0.32);
  }
  ctx.restore();

  // RABONA tiny tag for fun
  ctx.fillStyle='rgba(0,0,0,0.08)';
  ctx.font='bold 14px Barlow, Arial';
  ctx.fillText('MONKEY CO.', 18, size-18);

  return canvas;
}
