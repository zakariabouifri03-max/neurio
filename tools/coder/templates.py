"""Offline templates: every game / app is ONE self-contained HTML file.

No CDN, no API, no build step — each file runs by double-clicking it.
Each template is registered in TEMPLATES with the keywords that trigger it
(English, French, Arabic and Darija spellings). Keywords are normalised by
engine.normalize() before matching.
"""
from dataclasses import dataclass
from typing import Callable, Dict, List
import html as _html


BASE_CSS = """
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;font-family:system-ui,"Segoe UI",Tahoma,Arial,sans-serif;background:#0b1020;color:#e5e7eb;text-align:center}
h1{margin:0;font-size:28px}
h2{margin:0;font-size:20px}
button{background:#6366f1;color:#fff;border:0;border-radius:10px;padding:10px 16px;font-size:15px;cursor:pointer;margin:2px}
button:hover{filter:brightness(1.1)}
button:disabled{opacity:.5;cursor:default}
input,select{padding:8px 10px;border-radius:8px;border:1px solid #334155;background:#111827;color:#e5e7eb;font-size:15px}
"""

# Shared helpers injected into every template's <script>.
COMMON_JS = """
const store={
  get(k,d){try{const v=localStorage.getItem(k);return v===null?d:JSON.parse(v);}catch(e){return d;}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
};
const $=id=>document.getElementById(id);
"""


def _page(title: str, css: str, body: str, script: str) -> str:
    return (
        '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        f"<title>{_html.escape(title)}</title>\n"
        f"<style>{BASE_CSS}\n{css}</style>\n</head>\n<body>\n{body}\n"
        f"<script>{COMMON_JS}\n{script}\n</script>\n</body>\n</html>\n"
    )


# ---------------------------------------------------------------- GAMES

def snake() -> str:
    css = """
canvas{border:3px solid #334155;border-radius:12px;max-width:95vw;height:auto;touch-action:none;background:#0f172a}
"""
    body = """
<h1>🐍 Snake</h1>
<canvas id="c" width="400" height="400"></canvas>
<p>Score: <b id="score">0</b> · Arrows / WASD / swipe · R = restart</p>
<button onclick="reset()">Restart</button>
"""
    script = r"""
const canvas=$('c'),ctx=canvas.getContext('2d');
const G=20,S=canvas.width/G;
let snake,dir,next,food,score,timer,over;
const KEYS={ArrowUp:[0,-1],w:[0,-1],W:[0,-1],ArrowDown:[0,1],s:[0,1],S:[0,1],
            ArrowLeft:[-1,0],a:[-1,0],A:[-1,0],ArrowRight:[1,0],d:[1,0],D:[1,0]};

function placeFood(){
  do{ food={x:Math.floor(Math.random()*G),y:Math.floor(Math.random()*G)}; }
  while(snake.some(p=>p.x===food.x&&p.y===food.y));
}
function setDir(x,y){
  if(x===-dir.x&&y===-dir.y) return;   // no instant reverse
  next={x:x,y:y};
}
function reset(){
  snake=[{x:10,y:10},{x:9,y:10},{x:8,y:10}];
  dir={x:1,y:0}; next={x:1,y:0};
  score=0; over=false; placeFood();
  $('score').textContent=score;
  clearInterval(timer); timer=setInterval(tick,110);
  draw();
}
function tick(){
  dir=next;
  const h={x:snake[0].x+dir.x,y:snake[0].y+dir.y};
  if(h.x<0||h.y<0||h.x>=G||h.y>=G||snake.some(p=>p.x===h.x&&p.y===h.y)){
    over=true; clearInterval(timer); draw(); return;
  }
  snake.unshift(h);
  if(h.x===food.x&&h.y===food.y){ score++; $('score').textContent=score; placeFood(); }
  else snake.pop();
  draw();
}
function draw(){
  ctx.fillStyle='#0f172a'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#f43f5e'; ctx.fillRect(food.x*S+3,food.y*S+3,S-6,S-6);
  snake.forEach((p,i)=>{ ctx.fillStyle=i===0?'#86efac':'#22c55e'; ctx.fillRect(p.x*S+1,p.y*S+1,S-2,S-2); });
  if(over){
    ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#fff'; ctx.textAlign='center';
    ctx.font='bold 30px sans-serif'; ctx.fillText('Game Over',200,190);
    ctx.font='16px sans-serif'; ctx.fillText('Press R or tap Restart',200,220);
  }
}
addEventListener('keydown',e=>{
  if(e.key==='r'||e.key==='R'){ reset(); return; }
  const k=KEYS[e.key]; if(!k) return;
  e.preventDefault(); setDir(k[0],k[1]);
});
let tx=0,ty=0;
canvas.addEventListener('touchstart',e=>{tx=e.touches[0].clientX;ty=e.touches[0].clientY;},{passive:true});
canvas.addEventListener('touchend',e=>{
  const dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty;
  if(Math.max(Math.abs(dx),Math.abs(dy))<20) return;
  if(Math.abs(dx)>Math.abs(dy)) setDir(Math.sign(dx),0); else setDir(0,Math.sign(dy));
});
reset();
"""
    return _page("Snake", css, body, script)


def pong() -> str:
    css = """
canvas{border:3px solid #334155;border-radius:12px;max-width:95vw;height:auto;background:#052e16}
"""
    body = """
<h1>🏓 Pong</h1>
<p>Score <b id="s">0 : 0</b> · first to 7 wins · You: W/S, ↑/↓ or mouse</p>
<canvas id="c" width="640" height="400"></canvas>
<p id="msg"></p>
<button onclick="reset()">New game</button>
"""
    script = r"""
const c=$('c'),ctx=c.getContext('2d');
const W=c.width,H=c.height,PH=80,PW=12,WIN=7;
let L,R,ball,vx,vy,sl,sr,over;
const keys={};

function clamp(v){ return Math.max(0,Math.min(H-PH,v)); }
function serve(d){
  ball={x:W/2,y:H/2,r:8};
  const a=(Math.random()-0.5)*0.8;
  vx=d*5*Math.cos(a); vy=5*Math.sin(a);
}
function showScore(){ $('s').textContent=sl+' : '+sr; }
function reset(){
  L=R=H/2-PH/2; sl=0; sr=0; over=false;
  $('msg').textContent=''; serve(Math.random()<0.5?1:-1); showScore();
}
function bounce(top,dir){
  const rel=(ball.y-(top+PH/2))/(PH/2);          // -1 (top edge) .. 1 (bottom edge)
  const sp=Math.min(Math.hypot(vx,vy)*1.05,13);
  const a=rel*0.7;
  vx=dir*sp*Math.cos(a); vy=sp*Math.sin(a);
}
function endGame(text){ over=true; $('msg').textContent=text+' — press New game'; }
function update(){
  if(over) return;
  if(keys.w||keys.W||keys.ArrowUp) L-=8;
  if(keys.s||keys.S||keys.ArrowDown) L+=8;
  L=clamp(L);
  // computer paddle tracks the ball (slower than the player)
  const diff=(ball.y-PH/2)-R;
  R=clamp(R+Math.max(-4.2,Math.min(4.2,diff)));

  ball.x+=vx; ball.y+=vy;
  if(ball.y-ball.r<0){ ball.y=ball.r; vy=Math.abs(vy); }
  if(ball.y+ball.r>H){ ball.y=H-ball.r; vy=-Math.abs(vy); }

  // left paddle (player)
  if(vx<0 && ball.x-ball.r<=10+PW && ball.x-ball.r>=10 && ball.y>=L-ball.r && ball.y<=L+PH+ball.r){
    ball.x=10+PW+ball.r; bounce(L,1);
  }
  // right paddle (computer)
  if(vx>0 && ball.x+ball.r>=W-10-PW && ball.x+ball.r<=W-10 && ball.y>=R-ball.r && ball.y<=R+PH+ball.r){
    ball.x=W-10-PW-ball.r; bounce(R,-1);
  }
  if(ball.x<-ball.r){ sr++; showScore(); if(sr>=WIN) endGame('Computer wins 🤖'); else serve(-1); }
  if(ball.x>W+ball.r){ sl++; showScore(); if(sl>=WIN) endGame('You win 🎉'); else serve(1); }
}
function draw(){
  ctx.fillStyle='#052e16'; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='rgba(255,255,255,.35)'; ctx.setLineDash([10,12]);
  ctx.beginPath(); ctx.moveTo(W/2,0); ctx.lineTo(W/2,H); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle='#4ade80'; ctx.fillRect(10,L,PW,PH);
  ctx.fillStyle='#f97316'; ctx.fillRect(W-10-PW,R,PW,PH);
  ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(ball.x,ball.y,ball.r,0,Math.PI*2); ctx.fill();
}
function loop(){ update(); draw(); requestAnimationFrame(loop); }
addEventListener('keydown',e=>{ keys[e.key]=true; if(e.key.startsWith('Arrow')) e.preventDefault(); });
addEventListener('keyup',e=>{ keys[e.key]=false; });
c.addEventListener('mousemove',e=>{
  const r=c.getBoundingClientRect();
  L=clamp((e.clientY-r.top)*(H/r.height)-PH/2);
});
reset(); loop();
"""
    return _page("Pong", css, body, script)


def breakout() -> str:
    css = """
canvas{border:3px solid #334155;border-radius:12px;max-width:95vw;height:auto;background:#0f172a;touch-action:none}
"""
    body = """
<h1>🧱 Breakout</h1>
<p id="hud"></p>
<canvas id="c" width="480" height="340"></canvas>
<p>← → / A D / mouse to move · Space or click to launch</p>
<button onclick="init()">New game</button>
"""
    script = r"""
const c=$('c'),ctx=c.getContext('2d');
const W=c.width,H=c.height,PW=90,PH=12,BR=7,ROWS=5,COLS=8,BH=16,GAP=6;
const BW=(W-20-GAP*(COLS-1))/COLS;
const COLORS=['#f43f5e','#f97316','#eab308','#22c55e','#3b82f6'];
let px,ball,vx,vy,bricks,lives,score,started,over;
const keys={};

function newBall(){ ball={x:px+PW/2,y:H-44}; vx=0; vy=0; started=false; }
function init(){
  px=W/2-PW/2; lives=3; score=0; over=false;
  bricks=[];
  for(let r=0;r<ROWS;r++) for(let k=0;k<COLS;k++)
    bricks.push({x:10+k*(BW+GAP),y:40+r*(BH+GAP),w:BW,h:BH,col:COLORS[r],alive:true});
  newBall(); hud();
}
function hud(){
  $('hud').textContent='Score '+score+' · Lives '+lives+' · Bricks '+bricks.filter(b=>b.alive).length;
}
function launch(){
  if(over) return;
  if(!started){
    started=true;
    const a=-Math.PI/2+(Math.random()-0.5)*0.6;
    vx=Math.cos(a)*5; vy=Math.sin(a)*5;
  }
}
function update(){
  if(keys.ArrowLeft||keys.a||keys.A) px-=9;
  if(keys.ArrowRight||keys.d||keys.D) px+=9;
  px=Math.max(0,Math.min(W-PW,px));
  if(over) return;
  if(!started){ ball.x=px+PW/2; return; }

  ball.x+=vx; ball.y+=vy;
  if(ball.x<BR){ ball.x=BR; vx=Math.abs(vx); }
  if(ball.x>W-BR){ ball.x=W-BR; vx=-Math.abs(vx); }
  if(ball.y<BR){ ball.y=BR; vy=Math.abs(vy); }

  // paddle
  const py=H-30;
  if(vy>0 && ball.y+BR>=py && ball.y+BR<=py+PH+Math.abs(vy) && ball.x>=px-BR && ball.x<=px+PW+BR){
    vx=Math.max(-4.5,Math.min(4.5,((ball.x-(px+PW/2))/(PW/2))*5));
    vy=-Math.sqrt(Math.max(4,25-vx*vx));
    ball.y=py-BR;
  }
  // bricks
  for(const b of bricks){
    if(!b.alive) continue;
    if(ball.x+BR>b.x && ball.x-BR<b.x+b.w && ball.y+BR>b.y && ball.y-BR<b.y+b.h){
      b.alive=false; score+=10;
      const ox=Math.min(ball.x+BR-b.x, b.x+b.w-(ball.x-BR));
      const oy=Math.min(ball.y+BR-b.y, b.y+b.h-(ball.y-BR));
      if(ox<oy) vx=-vx; else vy=-vy;
      break;
    }
  }
  // fell below
  if(ball.y>H+BR){
    lives--;
    if(lives<=0){ over=true; }
    else newBall();
  }
  if(bricks.every(b=>!b.alive)) over=true;
  hud();
}
function draw(){
  ctx.fillStyle='#0f172a'; ctx.fillRect(0,0,W,H);
  for(const b of bricks){ if(!b.alive) continue; ctx.fillStyle=b.col; ctx.fillRect(b.x,b.y,b.w,b.h); }
  ctx.fillStyle='#e2e8f0'; ctx.fillRect(px,H-30,PW,PH);
  ctx.beginPath(); ctx.arc(ball.x,ball.y,BR,0,Math.PI*2); ctx.fill();
  ctx.textAlign='center'; ctx.fillStyle='#fff'; ctx.font='bold 20px sans-serif';
  if(!started && !over) ctx.fillText('Space / click to launch',W/2,H/2+40);
  if(over){
    ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#fff'; ctx.font='bold 26px sans-serif';
    ctx.fillText(bricks.every(b=>!b.alive)?'You win! 🎉':'Game over',W/2,H/2);
    ctx.font='16px sans-serif'; ctx.fillText('Press "New game"',W/2,H/2+30);
  }
}
function loop(){ update(); draw(); requestAnimationFrame(loop); }
addEventListener('keydown',e=>{
  keys[e.key]=true;
  if(e.key===' '){ e.preventDefault(); launch(); }
  if(e.key.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup',e=>{ keys[e.key]=false; });
c.addEventListener('mousemove',e=>{
  const r=c.getBoundingClientRect();
  px=(e.clientX-r.left)*(W/r.width)-PW/2;
});
c.addEventListener('click',launch);
init(); loop();
"""
    return _page("Breakout", css, body, script)


def tictactoe() -> str:
    css = """
#board{display:grid;grid-template-columns:repeat(3,96px);gap:8px}
.cell{width:96px;height:96px;font-size:44px;font-weight:700;background:#1f2937;color:#f9fafb;border-radius:12px;padding:0}
.cell.win{background:#16a34a}
label{font-size:15px}
"""
    body = """
<h1>❌⭕ Tic-Tac-Toe</h1>
<label><input type="checkbox" id="ai" checked onchange="newGame()"> Play vs computer</label>
<div id="board"></div>
<p id="msg"></p>
<p>X: <b id="sx">0</b> · O: <b id="so">0</b> · Draws: <b id="sd">0</b></p>
<button onclick="newGame()">New game</button>
"""
    script = r"""
const WIN=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const boardEl=$('board');
let board,turn,over;
const scores={X:0,O:0,D:0};

for(let i=0;i<9;i++){
  const b=document.createElement('button');
  b.className='cell'; b.onclick=()=>play(i);
  boardEl.appendChild(b);
}
function winner(b){
  for(const line of WIN){
    const [x,y,z]=line;
    if(b[x]&&b[x]===b[y]&&b[x]===b[z]) return {p:b[x],line:line};
  }
  return b.every(Boolean)?{p:'D',line:[]}:null;
}
function minimax(b,isO){
  const w=winner(b);
  if(w) return w.p==='O'?10:(w.p==='X'?-10:0);
  let best=isO?-Infinity:Infinity;
  for(let i=0;i<9;i++) if(!b[i]){
    b[i]=isO?'O':'X';
    const s=minimax(b,!isO);
    b[i]='';
    best=isO?Math.max(best,s):Math.min(best,s);
  }
  return best;
}
function bestMove(b){
  let best=-Infinity,mv=-1;
  for(let i=0;i<9;i++) if(!b[i]){
    b[i]='O'; const s=minimax(b,false); b[i]='';
    if(s>best){ best=s; mv=i; }
  }
  return mv;
}
function msg(t){ $('msg').textContent=t; }
function render(){
  [...boardEl.children].forEach((el,i)=>{
    el.textContent=board[i]||'';
    el.disabled=!!board[i]||over;
  });
}
function newGame(){
  board=Array(9).fill(''); turn='X'; over=false;
  msg(vsAI()?'Your turn (X)':'X to play');
  render();
}
function vsAI(){ return $('ai').checked; }
function finish(){
  const w=winner(board);
  if(!w) return false;
  over=true; render();
  if(w.p==='D'){ scores.D++; msg('Draw 🤝'); }
  else{
    scores[w.p]++;
    w.line.forEach(i=>boardEl.children[i].classList.add('win'));
    msg(vsAI()?(w.p==='X'?'You win! 🎉':'Computer wins 🤖'):w.p+' wins! 🎉');
  }
  $('sx').textContent=scores.X; $('so').textContent=scores.O; $('sd').textContent=scores.D;
  return true;
}
function play(i){
  if(over||board[i]) return;
  if(vsAI() && turn==='O') return;
  board[i]=turn;
  if(finish()) return;
  turn=turn==='X'?'O':'X';
  if(vsAI()){
    msg('Computer is thinking…');
    setTimeout(()=>{
      if(over||turn!=='O') return;
      board[bestMove(board.slice())]='O';
      turn='X';
      if(!finish()) msg('Your turn (X)');
      render();
    },350);
  } else msg(turn+' to play');
  render();
}
[...boardEl.children].forEach(el=>el.classList.remove('win'));
newGame();
"""
    return _page("Tic-Tac-Toe", css, body, script)


def memory() -> str:
    css = """
#board{display:grid;grid-template-columns:repeat(4,80px);gap:10px}
.card{width:80px;height:80px;font-size:34px;background:#312e81;border-radius:12px;padding:0}
.card.open{background:#f1f5f9}
.card.done{background:#166534;opacity:.85}
"""
    body = """
<h1>🧠 Memory</h1>
<p>Moves: <b id="m">0</b> · Pairs left: <b id="p">8</b></p>
<div id="board"></div>
<p id="msg"></p>
<button onclick="newGame()">New game</button>
"""
    script = r"""
const SYMBOLS=['🍎','🍌','🍇','🍓','🍒','🍍','🥝','🍉'];
const boardEl=$('board');
let cards,flipped,lock,moves,matched;

function shuffle(a){
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function stats(){
  $('m').textContent=moves; $('p').textContent=SYMBOLS.length-matched;
}
function render(){
  boardEl.innerHTML='';
  cards.forEach((card,i)=>{
    const b=document.createElement('button');
    const show=card.open||card.done;
    b.className='card'+(card.open?' open':'')+(card.done?' done':'');
    b.textContent=show?card.s:'?';
    b.onclick=()=>flip(i);
    boardEl.appendChild(b);
  });
}
function newGame(){
  cards=shuffle([...SYMBOLS,...SYMBOLS]).map(s=>({s:s,open:false,done:false}));
  flipped=[]; lock=false; moves=0; matched=0;
  msg(''); render(); stats();
}
function msg(t){ $('msg').textContent=t; }
function flip(i){
  const card=cards[i];
  if(lock||card.open||card.done) return;
  card.open=true; flipped.push(i); render();
  if(flipped.length<2) return;
  moves++; stats(); lock=true;
  const [a,b]=flipped;
  if(cards[a].s===cards[b].s){
    cards[a].done=cards[b].done=true;
    cards[a].open=cards[b].open=false;
    matched++; flipped=[]; lock=false;
    render(); stats();
    if(matched===SYMBOLS.length) msg('You won in '+moves+' moves! 🎉');
  } else {
    setTimeout(()=>{
      cards[a].open=cards[b].open=false;
      flipped=[]; lock=false; render();
    },800);
  }
}
newGame();
"""
    return _page("Memory", css, body, script)


# ---------------------------------------------------------------- APPS

def todo() -> str:
    css = """
form{display:flex;gap:8px}
input[type=text]{width:260px}
.filters button.on{background:#0ea5e9}
ul{list-style:none;padding:0;margin:0;width:340px;max-width:92vw;text-align:left}
li{display:flex;align-items:center;gap:8px;background:#111827;border-radius:10px;padding:8px 10px;margin:6px 0}
li span{flex:1;word-break:break-word}
li span.done{text-decoration:line-through;opacity:.5}
li button{background:#7f1d1d;padding:4px 10px}
"""
    body = """
<h1>✅ To-Do</h1>
<form id="f"><input type="text" id="t" placeholder="New task…" autocomplete="off" required><button>Add</button></form>
<div class="filters">
  <button data-f="all" class="on">All</button><button data-f="todo">Active</button><button data-f="done">Done</button>
</div>
<ul id="list"></ul>
<p><span id="count"></span> · <button onclick="clearDone()">Clear completed</button></p>
"""
    script = r"""
let tasks=store.get('todo.tasks',[]), filter='all';
function save(){ store.set('todo.tasks',tasks); render(); }
$('f').onsubmit=e=>{
  e.preventDefault();
  const v=$('t').value.trim();
  if(!v) return;
  tasks.push({id:Date.now(),text:v,done:false});
  $('t').value=''; save();
};
document.querySelectorAll('.filters button').forEach(b=>{
  b.onclick=()=>{
    filter=b.dataset.f;
    document.querySelectorAll('.filters button').forEach(x=>x.classList.toggle('on',x===b));
    render();
  };
});
function render(){
  const ul=$('list'); ul.innerHTML='';
  tasks.filter(t=>filter==='all'||(filter==='done')===t.done).forEach(t=>{
    const li=document.createElement('li');
    const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=t.done;
    cb.onchange=()=>{ t.done=cb.checked; save(); };
    const sp=document.createElement('span'); sp.textContent=t.text; if(t.done) sp.className='done';
    const del=document.createElement('button'); del.textContent='✕';
    del.onclick=()=>{ tasks=tasks.filter(x=>x!==t); save(); };
    li.append(cb,sp,del); ul.appendChild(li);
  });
  $('count').textContent=tasks.filter(t=>!t.done).length+' left';
}
function clearDone(){ tasks=tasks.filter(t=>!t.done); save(); }
render();
"""
    return _page("To-Do", css, body, script)


def calculator() -> str:
    css = """
#display{width:300px;min-height:70px;background:#111827;border-radius:12px;padding:12px;font-size:32px;text-align:right;overflow-x:auto;word-break:break-all}
#keys{display:grid;grid-template-columns:repeat(4,72px);gap:8px}
#keys button{height:60px;font-size:20px;margin:0;background:#1f2937}
#keys button.op{background:#6366f1}
#keys button.eq{grid-column:span 4;background:#16a34a}
"""
    body = """
<h1>🧮 Calculator</h1>
<div id="display">0</div>
<div id="keys"></div>
<p>Keyboard works too · Enter = · · Esc = C</p>
"""
    script = r"""
const LAYOUT=[
  ['C','⌫','(',')'],
  ['7','8','9','/'],
  ['4','5','6','*'],
  ['1','2','3','-'],
  ['0','.','%','+'],
];
// Tiny safe parser: numbers, + - * / %, parentheses, unary minus. No eval.
function evaluate(src){
  const t=src.match(/\d+\.?\d*|\.\d+|[()+\-*/%]/g)||[];
  if(t.join('')!==src.replace(/\s+/g,'')) throw new Error('bad input');
  let i=0;
  const peek=()=>t[i], next=()=>t[i++];
  function primary(){
    const tok=next();
    if(tok==='('){ const v=sum(); if(next()!==')') throw new Error('paren'); return v; }
    if(tok==='-') return -primary();
    if(tok==='+') return primary();
    const n=parseFloat(tok); if(Number.isNaN(n)) throw new Error('num'); return n;
  }
  function product(){
    let v=primary();
    while(peek()==='*'||peek()==='/'||peek()==='%'){
      const op=next(), r=primary();
      v = op==='*'? v*r : op==='/'? v/r : v%r;
    }
    return v;
  }
  function sum(){
    let v=product();
    while(peek()==='+'||peek()==='-'){
      const op=next(), r=product();
      v = op==='+'? v+r : v-r;
    }
    return v;
  }
  const result=sum();
  if(i!==t.length) throw new Error('trailing');
  return result;
}
let expr='';
function show(){ $('display').textContent=expr||'0'; }
function press(k){
  if(expr==='Error' && k!=='C') expr='';
  if(k==='C') expr='';
  else if(k==='⌫') expr=expr.slice(0,-1);
  else if(k==='='){
    try{
      const v=evaluate(expr);
      expr=Number.isFinite(v)?String(+v.toFixed(10)):'Error';
    }catch(e){ expr='Error'; }
  }
  else expr+=k;
  show();
}
const keysEl=$('keys');
LAYOUT.flat().forEach(k=>{
  const b=document.createElement('button');
  b.textContent=k;
  if('+-*/%'.includes(k)) b.className='op';
  b.onclick=()=>press(k);
  keysEl.appendChild(b);
});
const eq=document.createElement('button');
eq.textContent='=';
eq.className='eq';
eq.onclick=()=>press('=');
keysEl.appendChild(eq);

addEventListener('keydown',e=>{
  if(/^[0-9+\-*/%().]$/.test(e.key)) press(e.key);
  else if(e.key==='Enter'||e.key==='=') { e.preventDefault(); press('='); }
  else if(e.key==='Backspace') press('⌫');
  else if(e.key==='Escape') press('C');
});
show();
"""
    return _page("Calculator", css, body, script)


def pomodoro() -> str:
    css = """
#time{font-size:72px;font-weight:700;font-variant-numeric:tabular-nums}
#mode{font-size:20px;color:#a5b4fc}
label{font-size:14px}
label input{width:70px}
"""
    body = """
<h1>🍅 Pomodoro</h1>
<div id="mode">🎯 Focus</div>
<div id="time">25:00</div>
<div><button id="go" onclick="toggle()">Start</button><button onclick="resetT()">Reset</button><button onclick="skip()">Skip</button></div>
<p>Cycles done: <b id="cyc">0</b></p>
<p>
  <label>Focus (min) <input type="number" id="fm" value="25" min="1" max="120" onchange="resetT()"></label>
  <label>Break (min) <input type="number" id="bm" value="5" min="1" max="60" onchange="resetT()"></label>
</p>
"""
    script = r"""
let mode='focus', left=0, timer=null, cycles=0;
function len(){ return (mode==='focus'?+$('fm').value:+$('bm').value)*60; }
function fmt(s){
  return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
}
function paint(){
  $('time').textContent=fmt(left);
  $('mode').textContent=mode==='focus'?'🎯 Focus':'☕ Break';
  document.title=fmt(left)+' · Pomodoro';
}
function stop(){ clearInterval(timer); timer=null; $('go').textContent='Start'; }
function resetT(){ stop(); left=len(); paint(); }
function toggle(){
  if(timer){ stop(); return; }
  if(left<=0) left=len();
  $('go').textContent='Pause';
  timer=setInterval(tick,1000);
}
function beep(){
  try{
    const a=new AudioContext(), o=a.createOscillator(), g=a.createGain();
    o.connect(g); g.connect(a.destination);
    o.frequency.value=880; g.gain.value=0.2;
    o.start(); o.stop(a.currentTime+0.8);
  }catch(e){}
}
function tick(){
  left--;
  if(left<=0){
    beep();
    if(mode==='focus'){ cycles++; $('cyc').textContent=cycles; mode='break'; }
    else mode='focus';
    stop(); left=len();
  }
  paint();
}
function skip(){ mode=mode==='focus'?'break':'focus'; stop(); left=len(); paint(); }
left=len(); paint();
"""
    return _page("Pomodoro", css, body, script)


def expenses() -> str:
    css = """
form{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
input[type=text],input[type=number]{width:170px}
#total{font-size:30px;font-weight:700;color:#4ade80}
#cats{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
#cats div{background:#111827;border-radius:10px;padding:6px 12px;font-size:14px}
ul{list-style:none;padding:0;margin:0;width:460px;max-width:94vw;text-align:left}
li{display:flex;gap:8px;align-items:center;background:#111827;border-radius:10px;padding:8px 10px;margin:6px 0}
li .d{flex:1;word-break:break-word}
li .dt{font-size:12px;color:#94a3b8}
li button{background:#7f1d1d;padding:4px 10px}
"""
    body = """
<h1>💰 Expenses</h1>
<form id="f">
  <input type="text" id="d" placeholder="What for?" required>
  <input type="number" id="a" step="0.01" min="0" placeholder="Amount" required>
  <select id="c"><option>Food</option><option>Transport</option><option>Bills</option><option>Fun</option><option>Other</option></select>
  <button>Add</button>
</form>
<div>Total: <span id="total">0.00</span></div>
<div id="cats"></div>
<ul id="list"></ul>
<button onclick="exportCSV()">Export CSV</button>
"""
    script = r"""
let items=store.get('expenses.items',[]);
const money=n=>n.toFixed(2);
function save(){ store.set('expenses.items',items); render(); }
$('f').onsubmit=e=>{
  e.preventDefault();
  const d=$('d').value.trim(), a=parseFloat($('a').value), cat=$('c').value;
  if(!d||!(a>=0)) return;
  items.unshift({id:Date.now(),desc:d,amt:a,cat:cat,date:new Date().toISOString().slice(0,10)});
  $('f').reset(); save();
};
function render(){
  const total=items.reduce((s,i)=>s+i.amt,0);
  $('total').textContent=money(total);
  const sums={};
  items.forEach(i=>{ sums[i.cat]=(sums[i.cat]||0)+i.amt; });
  const cats=$('cats'); cats.innerHTML='';
  Object.keys(sums).forEach(k=>{
    const d=document.createElement('div'); d.textContent=k+': '+money(sums[k]); cats.appendChild(d);
  });
  const ul=$('list'); ul.innerHTML='';
  items.forEach(i=>{
    const li=document.createElement('li');
    const d=document.createElement('div'); d.className='d';
    d.textContent=i.desc; const dt=document.createElement('div'); dt.className='dt'; dt.textContent=i.cat+' · '+i.date;
    d.appendChild(dt);
    const amt=document.createElement('b'); amt.textContent=money(i.amt);
    const del=document.createElement('button'); del.textContent='✕';
    del.onclick=()=>{ items=items.filter(x=>x!==i); save(); };
    li.append(d,amt,del); ul.appendChild(li);
  });
}
function exportCSV(){
  const rows=[['date','category','description','amount'],...items.map(i=>[i.date,i.cat,'"'+i.desc.replace(/"/g,'""')+'"',money(i.amt)])];
  const blob=new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='expenses.csv'; a.click();
}
render();
"""
    return _page("Expenses", css, body, script)


def password() -> str:
    css = """
#pw{font:22px ui-monospace,Consolas,monospace;background:#111827;border-radius:12px;padding:16px;min-width:300px;word-break:break-all;color:#a5f3fc}
.opts{display:grid;gap:8px;text-align:left}
label{font-size:15px}
"""
    body = """
<h1>🔐 Password Generator</h1>
<div id="pw">—</div>
<label>Length: <b id="lv">16</b> <input type="range" id="len" min="6" max="64" value="16" oninput="gen()"></label>
<div class="opts">
  <label><input type="checkbox" id="up" checked onchange="gen()"> Uppercase A–Z</label>
  <label><input type="checkbox" id="lo" checked onchange="gen()"> Lowercase a–z</label>
  <label><input type="checkbox" id="nu" checked onchange="gen()"> Numbers 0–9</label>
  <label><input type="checkbox" id="sy" checked onchange="gen()"> Symbols !@#$</label>
</div>
<div><button onclick="gen()">Generate</button><button onclick="copyPw()">Copy</button></div>
<p id="strength"></p>
"""
    script = r"""
const SETS={up:'ABCDEFGHIJKLMNOPQRSTUVWXYZ',lo:'abcdefghijklmnopqrstuvwxyz',nu:'0123456789',sy:'!@#$%^&*()-_=+[]{};:,.?'};
function rnd(n){ const a=new Uint32Array(1); crypto.getRandomValues(a); return a[0]%n; }
function gen(){
  const L=+$('len').value;
  $('lv').textContent=L;
  let pool='', required=[];
  for(const k in SETS){
    if($(k).checked){ pool+=SETS[k]; required.push(SETS[k]); }
  }
  if(!pool){ $('pw').textContent='Pick at least one set'; $('strength').textContent=''; return; }
  const out=required.map(s=>s[rnd(s.length)]);
  while(out.length<L) out.push(pool[rnd(pool.length)]);
  for(let i=out.length-1;i>0;i--){ const j=rnd(i+1); [out[i],out[j]]=[out[j],out[i]]; }
  const pw=out.slice(0,L).join('');
  $('pw').textContent=pw;
  const bits=Math.round(L*Math.log2(pool.length));
  const label=bits<50?'Weak 🟥':bits<80?'Medium 🟨':'Strong 🟩';
  $('strength').textContent=label+' · ~'+bits+' bits of entropy';
}
function copyPw(){
  const t=$('pw').textContent;
  if(navigator.clipboard) navigator.clipboard.writeText(t).catch(()=>{});
  $('strength').textContent='Copied (if your browser allows clipboard access)';
}
gen();
"""
    return _page("Password Generator", css, body, script)


# ---------------------------------------------------------------- REGISTRY

@dataclass(frozen=True)
class Template:
    key: str
    title: str
    kind: str                      # "game" | "app"
    keywords: List[str]            # matched after engine.normalize()
    build: Callable[[], str]


TEMPLATES: Dict[str, Template] = {}


def _reg(key, title, kind, keywords, build):
    TEMPLATES[key] = Template(key, title, kind, keywords, build)


_reg("snake", "Snake", "game",
     ["snake", "snack", "serpent", "ثعبان", "سنيك", "سناك", "tha3ban", "ta3ban", "thaaban", "3ebban"],
     snake)
_reg("pong", "Pong", "game",
     ["pong", "ping pong", "ping-pong", "بونغ", "بينغ", "بنغ", "tennis", "تنس"],
     pong)
_reg("breakout", "Breakout", "game",
     ["breakout", "brick", "casse-brique", "casse brique", "كسر الطوب", "طوب", "بريك اوت", "بريكاوت"],
     breakout)
_reg("tictactoe", "Tic-Tac-Toe", "game",
     ["tic tac", "tic-tac", "tictac", "morpion", "xo", "إكس او", "اكس او", "اكس و او", "x et o"],
     tictactoe)
_reg("memory", "Memory", "game",
     ["memory", "memo", "ذاكرة", "dakira", "dakra", "mémoire", "memoire", "cartes"],
     memory)

_reg("todo", "To-Do", "app",
     ["todo", "to-do", "to do", "task", "tasks", "مهام", "مهمات", "tâches", "taches", "tache", "liste de"],
     todo)
_reg("calculator", "Calculator", "app",
     ["calculator", "calculatrice", "calc", "آلة حاسبة", "الة حاسبة", "حاسبة", "حاسبه", "machine a calcul"],
     calculator)
_reg("pomodoro", "Pomodoro Timer", "app",
     ["pomodoro", "timer", "minuterie", "minuteur", "مؤقت", "مؤقّت", "chrono", "focus"],
     pomodoro)
_reg("expenses", "Expense Tracker", "app",
     ["expense", "expenses", "budget", "depense", "dépense", "depenses", "مصاريف", "المصاريف", "مصروف", "ميزانية", "finance"],
     expenses)
_reg("password", "Password Generator", "app",
     ["password", "mot de passe", "mot-de-passe", "mdp", "كلمة السر", "كلمة المرور", "باسوورد", "باسورد", "بسورد", "passe"],
     password)

# Generic words: used only when nothing specific matched.
GENERIC_GAME_WORDS = ["game", "games", "jeu", "jeux", "لعبة", "لعبه", "العاب", "ألعاب", "lo3ba", "l3iba", "l3ab", "3ab", "lo3bat"]
GENERIC_APP_WORDS = ["app", "apps", "application", "applications", "تطبيق", "تطبيقات", "tatbi9", "tatbik", "tbi9", "appli", "logiciel"]
DEFAULT_GAME = "snake"
DEFAULT_APP = "todo"
