"""Offline templates: every game / app is ONE self-contained HTML file.

No CDN, no API, no build step — each file runs by double-clicking it.
Each template is registered in TEMPLATES with the keywords that trigger it
(English, French, Arabic and Darija spellings). Keywords are normalised by
engine.normalize() before matching.
"""
from dataclasses import dataclass
from typing import Callable, Dict, List
import html as _html
import json


BASE_CSS = """
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;font-family:system-ui,"Segoe UI",Tahoma,Arial,sans-serif;background:var(--bg);color:var(--fg);text-align:center}
h1{margin:0;font-size:28px}
h2{margin:0;font-size:20px}
button{background:var(--accent);color:#fff;border:0;border-radius:10px;padding:10px 16px;font-size:15px;cursor:pointer;margin:2px}
button:hover{filter:brightness(1.1)}
button:disabled{opacity:.5;cursor:default}
input,select{padding:8px 10px;border-radius:8px;border:1px solid #334155;background:var(--panel);color:var(--fg);font-size:15px}
"""

# Shared helpers injected into every template's <script>.
COMMON_JS = """
const store={
  get(k,d){try{const v=localStorage.getItem(k);return v===null?d:JSON.parse(v);}catch(e){return d;}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
};
const $=id=>document.getElementById(id);
"""


# Themes: colours + emoji. Picked from words in the prompt ("space", "beach", "نار"...).
THEMES = {
    "default": dict(key="default", name="Classic", bg="#0b1020", panel="#111827", fg="#e5e7eb",
                    accent="#6366f1", accent2="#22c55e", field="#0f172a", icon="🚗", enemy="👾", item="⭐"),
    "space": dict(key="space", name="Space", bg="#05010f", panel="#0f0a24", fg="#e9d5ff",
                  accent="#a855f7", accent2="#22d3ee", field="#06021a", icon="🚀", enemy="👾", item="⭐"),
    "beach": dict(key="beach", name="Beach", bg="#0c4a6e", panel="#075985", fg="#ecfeff",
                  accent="#f59e0b", accent2="#38bdf8", field="#0e7490", icon="🏄", enemy="🦀", item="🐚"),
    "jungle": dict(key="jungle", name="Jungle", bg="#052e16", panel="#14532d", fg="#ecfccb",
                   accent="#84cc16", accent2="#facc15", field="#022c22", icon="🐒", enemy="🐍", item="🍌"),
    "night": dict(key="night", name="Night", bg="#020617", panel="#0f172a", fg="#e2e8f0",
                  accent="#6366f1", accent2="#eab308", field="#020617", icon="🦉", enemy="🦇", item="🌟"),
    "desert": dict(key="desert", name="Desert", bg="#451a03", panel="#78350f", fg="#fef3c7",
                   accent="#f59e0b", accent2="#fb7185", field="#7c2d12", icon="🐪", enemy="🦂", item="🌵"),
    "candy": dict(key="candy", name="Candy", bg="#3b0764", panel="#581c87", fg="#fdf4ff",
                  accent="#f472b6", accent2="#60a5fa", field="#4a044e", icon="🍭", enemy="🍫", item="🍬"),
    "snow": dict(key="snow", name="Snow", bg="#0f172a", panel="#1e293b", fg="#f1f5f9",
                 accent="#38bdf8", accent2="#e2e8f0", field="#1e3a5f", icon="⛷️", enemy="🥶", item="❄️"),
    "fire": dict(key="fire", name="Fire", bg="#1c0202", panel="#450a0a", fg="#fee2e2",
                 accent="#f97316", accent2="#facc15", field="#2a0505", icon="🔥", enemy="👹", item="💎"),
}

THEME_WORDS = {
    "space": ["space", "espace", "galaxy", "fadha", "fadaa", "فضاء", "فضا", "الفضاء", "فضائي"],
    "beach": ["beach", "plage", "shati", "chati", "شاطئ", "شاطي", "بحر", "sea", "ocean", "mer"],
    "jungle": ["jungle", "forest", "foret", "forêt", "ghaba", "ghabat", "غابة", "غابه", "جنغل"],
    "night": ["night", "nuit", "lil", "ليل", "الليل", "dark"],
    "desert": ["desert", "désert", "sahra", "sahara", "صحراء", "صحرا"],
    "candy": ["candy", "bonbon", "bonbons", "halwa", "halwiyat", "حلوى", "حلويات", "سكر"],
    "snow": ["snow", "neige", "tlej", "thalj", "ثلج", "الثلج", "winter", "hiver"],
    "fire": ["fire", "feu", "nar", "نار", "النار", "lava", "volcano"],
}
HARD_WORDS = ["hard", "difficile", "difficult", "expert", "sa3ba", "saba", "صعب", "صعبة", "صعيب"]
EASY_WORDS = ["easy", "facile", "simple", "sahl", "sahla", "سهل", "سهلة", "ساهل"]


def _page(title: str, css: str, body: str, script: str, theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
    full_title = title if theme["key"] == "default" else f"{theme['name']} {title}"
    root = (":root{--bg:%s;--panel:%s;--fg:%s;--accent:%s;--accent2:%s}"
            % (theme["bg"], theme["panel"], theme["fg"], theme["accent"], theme["accent2"]))
    # THEME (colours / emoji) and LEVEL (speed multiplier) are available to every script.
    js_prefix = f"const THEME={json.dumps(theme)};\nconst LEVEL={float(level)};\n"
    return (
        '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        f"<title>{_html.escape(full_title)}</title>\n"
        f"<style>{root}\n{BASE_CSS}\n{css}</style>\n</head>\n<body>\n{body}\n"
        f"<script>{js_prefix}{COMMON_JS}\n{script}\n</script>\n</body>\n</html>\n"
    )


# ---------------------------------------------------------------- GAMES

def snake(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
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
  clearInterval(timer); timer=setInterval(tick,110/LEVEL);
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
  ctx.fillStyle=THEME.field; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle=THEME.accent2; ctx.fillRect(food.x*S+3,food.y*S+3,S-6,S-6);
  snake.forEach((p,i)=>{ ctx.fillStyle=i===0?THEME.accent:'#22c55e'; ctx.fillRect(p.x*S+1,p.y*S+1,S-2,S-2); });
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
    return _page("Snake", css, body, script, theme, level)


def pong(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
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
  vx=d*5*LEVEL*Math.cos(a); vy=5*LEVEL*Math.sin(a);
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
  ctx.fillStyle=THEME.field; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='rgba(255,255,255,.35)'; ctx.setLineDash([10,12]);
  ctx.beginPath(); ctx.moveTo(W/2,0); ctx.lineTo(W/2,H); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle=THEME.accent; ctx.fillRect(10,L,PW,PH);
  ctx.fillStyle=THEME.accent2; ctx.fillRect(W-10-PW,R,PW,PH);
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
    return _page("Pong", css, body, script, theme, level)


def breakout(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
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
    vx=Math.cos(a)*5*LEVEL; vy=Math.sin(a)*5*LEVEL;
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
  ctx.fillStyle=THEME.field; ctx.fillRect(0,0,W,H);
  for(const b of bricks){ if(!b.alive) continue; ctx.fillStyle=b.col; ctx.fillRect(b.x,b.y,b.w,b.h); }
  ctx.fillStyle=THEME.fg; ctx.fillRect(px,H-30,PW,PH);
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
    return _page("Breakout", css, body, script, theme, level)


def tictactoe(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
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
    return _page("Tic-Tac-Toe", css, body, script, theme, level)


def memory(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
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
    return _page("Memory", css, body, script, theme, level)


# ---------------------------------------------------------------- APPS

def todo(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
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
    return _page("To-Do", css, body, script, theme, level)


def calculator(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
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
    return _page("Calculator", css, body, script, theme, level)


def pomodoro(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
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
    return _page("Pomodoro", css, body, script, theme, level)


def expenses(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
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
    return _page("Expenses", css, body, script, theme, level)


def password(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
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
    return _page("Password Generator", css, body, script, theme, level)


# ---------------------------------------------------------------- MORE GAMES

def flappy(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
    css = """
canvas{border:3px solid #334155;border-radius:12px;max-width:95vw;height:auto;touch-action:none}
"""
    body = """
<h1>🐦 Flappy</h1>
<p>Score: <b id="score">0</b> · Best: <b id="best">0</b> · Space / tap to flap · R = restart</p>
<canvas id="c" width="360" height="540"></canvas>
<button onclick="reset()">Restart</button>
"""
    script = r"""
const c=$('c'),ctx=c.getContext('2d'),W=c.width,H=c.height;
let bird,pipes,score,best=store.get('flappy.best',0),state,frame;
$('best').textContent=best;
function reset(){ bird={x:90,y:H/2,vy:0,r:14}; pipes=[]; score=0; state='ready'; frame=0; $('score').textContent=0; }
function flap(){
  if(state==='over') { reset(); return; }
  if(state==='ready') state='play';
  bird.vy=-7.5;
}
function die(){
  state='over';
  if(score>best){ best=score; store.set('flappy.best',best); $('best').textContent=best; }
}
function update(){
  if(state!=='play') return;
  bird.vy+=0.4; bird.y+=bird.vy; frame++;
  if(frame%90===0){
    const gap=150, top=60+Math.random()*(H-220-gap);
    pipes.push({x:W,top:top,gap:gap,passed:false});
  }
  for(const p of pipes){
    p.x-=2.4*LEVEL;
    if(!p.passed && p.x+50<bird.x){ p.passed=true; score++; $('score').textContent=score; }
    if(bird.x+bird.r>p.x && bird.x-bird.r<p.x+50 && (bird.y-bird.r<p.top || bird.y+bird.r>p.top+p.gap)) die();
  }
  pipes=pipes.filter(p=>p.x>-60);
  if(bird.y+bird.r>H || bird.y-bird.r<0) die();
}
function emoji(ch,x,y,size){ ctx.font=size+'px serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(ch,x,y); }
function draw(){
  ctx.fillStyle=THEME.field; ctx.fillRect(0,0,W,H);
  ctx.fillStyle=THEME.accent;
  for(const p of pipes){
    ctx.fillRect(p.x,0,50,p.top);
    ctx.fillRect(p.x,p.top+p.gap,50,H-p.top-p.gap);
  }
  emoji(THEME.icon,bird.x,bird.y,30);
  ctx.fillStyle=THEME.fg; ctx.textAlign='center';
  if(state==='ready'){ ctx.font='bold 20px sans-serif'; ctx.fillText('Tap / Space to start',W/2,H/2+60); }
  if(state==='over'){
    ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#fff'; ctx.font='bold 28px sans-serif'; ctx.fillText('Game over',W/2,H/2-10);
    ctx.font='16px sans-serif'; ctx.fillText('Tap / Space to retry',W/2,H/2+20);
  }
}
function loop(){ update(); draw(); requestAnimationFrame(loop); }
addEventListener('keydown',e=>{
  if(e.key==='r'||e.key==='R'){ reset(); return; }
  if(e.key===' '||e.key==='ArrowUp'||e.key==='w'||e.key==='W'){ e.preventDefault(); flap(); }
});
c.addEventListener('mousedown',flap);
c.addEventListener('touchstart',e=>{ e.preventDefault(); flap(); },{passive:false});
reset(); loop();
"""
    return _page("Flappy", css, body, script, theme, level)


def shooter(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
    css = """
canvas{border:3px solid #334155;border-radius:12px;max-width:95vw;height:auto;touch-action:none}
"""
    body = """
<h1>🚀 Shooter</h1>
<p id="hud"></p>
<canvas id="c" width="400" height="520"></canvas>
<p>← → / A D to move · Space to shoot · R = restart</p>
<button onclick="reset()">New game</button>
"""
    script = r"""
const c=$('c'),ctx=c.getContext('2d'),W=c.width,H=c.height;
const stars=Array.from({length:60},()=>({x:Math.random()*W,y:Math.random()*H,s:Math.random()*2+0.5}));
let ship,bullets,enemies,score,lives,over,tick,cool;
const keys={};
function hud(){ $('hud').textContent='Score '+score+' · Lives '+'❤️'.repeat(Math.max(0,lives)); }
function reset(){
  ship={x:W/2,y:H-44}; bullets=[]; enemies=[]; score=0; lives=3; over=false; tick=0; cool=0;
  hud();
}
function shoot(){ if(over||cool>0) return; bullets.push({x:ship.x,y:ship.y-18}); cool=12; }
function loseLife(){
  lives--; hud();
  if(lives<=0) over=true;
}
function update(){
  if(over) return;
  tick++; if(cool>0) cool--;
  const sp=6*LEVEL;
  if(keys.ArrowLeft||keys.a||keys.A) ship.x-=sp;
  if(keys.ArrowRight||keys.d||keys.D) ship.x+=sp;
  ship.x=Math.max(20,Math.min(W-20,ship.x));
  if(keys[' ']) shoot();
  const every=Math.max(12,Math.round(45/LEVEL));
  if(tick%every===0) enemies.push({x:24+Math.random()*(W-48),y:-20,vy:(0.8+Math.random()*0.9)*LEVEL,r:16});
  for(const b of bullets) b.y-=9;
  for(const e of enemies) e.y+=e.vy;
  for(const b of bullets){
    for(const e of enemies){
      if(!b.dead && !e.dead && Math.hypot(e.x-b.x,e.y-b.y)<e.r+4){ b.dead=true; e.dead=true; score+=10; hud(); }
    }
  }
  for(const e of enemies){
    if(e.dead) continue;
    if(Math.hypot(e.x-ship.x,e.y-ship.y)<e.r+14){ e.dead=true; loseLife(); }
    else if(e.y>H+20){ e.dead=true; loseLife(); }
  }
  bullets=bullets.filter(b=>!b.dead && b.y>-10);
  enemies=enemies.filter(e=>!e.dead);
}
function emoji(ch,x,y,size){ ctx.font=size+'px serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(ch,x,y); }
function draw(){
  ctx.fillStyle=THEME.field; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='rgba(255,255,255,.6)';
  for(const s of stars){ ctx.fillRect(s.x,s.y,s.s,s.s); s.y+=s.s*0.5; if(s.y>H){ s.y=0; s.x=Math.random()*W; } }
  ctx.fillStyle=THEME.accent2;
  for(const b of bullets) ctx.fillRect(b.x-2,b.y,4,12);
  emoji(THEME.icon,ship.x,ship.y,32);
  for(const e of enemies) emoji(THEME.enemy,e.x,e.y,30);
  if(over){
    ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#fff'; ctx.font='bold 28px sans-serif'; ctx.textAlign='center';
    ctx.fillText('Game over',W/2,H/2-10);
    ctx.font='16px sans-serif'; ctx.fillText('Press R or "New game"',W/2,H/2+20);
  }
}
function loop(){ update(); draw(); requestAnimationFrame(loop); }
addEventListener('keydown',e=>{
  if(e.key==='r'||e.key==='R'){ reset(); return; }
  keys[e.key]=true;
  if(e.key===' '||e.key.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup',e=>{ keys[e.key]=false; });
c.addEventListener('mousemove',e=>{ const r=c.getBoundingClientRect(); ship.x=(e.clientX-r.left)*(W/r.width); });
c.addEventListener('click',shoot);
reset(); loop();
"""
    return _page("Shooter", css, body, script, theme, level)


def catch(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
    css = """
canvas{border:3px solid #334155;border-radius:12px;max-width:95vw;height:auto;touch-action:none}
"""
    body = """
<h1>🧺 Catch</h1>
<p id="hud"></p>
<canvas id="c" width="400" height="480"></canvas>
<p>← → / A D / mouse to move · catch the good ones, dodge the bad ones</p>
<button onclick="reset()">New game</button>
"""
    script = r"""
const c=$('c'),ctx=c.getContext('2d'),W=c.width,H=c.height;
let basket,items,score,lives,over,tick;
const keys={};
function hud(){ $('hud').textContent='Caught '+score+' · Lives '+'❤️'.repeat(Math.max(0,lives)); }
function reset(){ basket={x:W/2,w:90}; items=[]; score=0; lives=3; over=false; tick=0; hud(); }
function update(){
  if(over) return;
  tick++;
  const sp=7*LEVEL;
  if(keys.ArrowLeft||keys.a||keys.A) basket.x-=sp;
  if(keys.ArrowRight||keys.d||keys.D) basket.x+=sp;
  basket.x=Math.max(basket.w/2,Math.min(W-basket.w/2,basket.x));
  const every=Math.max(15,Math.round(50/LEVEL));
  if(tick%every===0) items.push({x:20+Math.random()*(W-40),y:-20,vy:(1.5+Math.random()*1.5)*LEVEL,bad:Math.random()<0.3});
  for(const it of items){
    if(it.dead) continue;
    it.y+=it.vy;
    if(Math.abs(it.x-basket.x)<basket.w/2 && it.y>H-70 && it.y<H-30){
      it.dead=true;
      if(it.bad){ lives--; if(lives<=0) over=true; }
      else score++;
      hud();
    } else if(it.y>H+20){ it.dead=true; }
  }
  items=items.filter(it=>!it.dead);
}
function emoji(ch,x,y,size){ ctx.font=size+'px serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(ch,x,y); }
function draw(){
  ctx.fillStyle=THEME.field; ctx.fillRect(0,0,W,H);
  for(const it of items) emoji(it.bad?THEME.enemy:THEME.item,it.x,it.y,28);
  emoji(THEME.icon,basket.x,H-40,44);
  if(over){
    ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#fff'; ctx.font='bold 28px sans-serif'; ctx.textAlign='center';
    ctx.fillText('Game over',W/2,H/2-10);
    ctx.font='16px sans-serif'; ctx.fillText('Press R or "New game"',W/2,H/2+20);
  }
}
function loop(){ update(); draw(); requestAnimationFrame(loop); }
addEventListener('keydown',e=>{
  if(e.key==='r'||e.key==='R'){ reset(); return; }
  keys[e.key]=true;
  if(e.key.startsWith('Arrow')||e.key===' ') e.preventDefault();
});
addEventListener('keyup',e=>{ keys[e.key]=false; });
function moveTo(clientX){ const r=c.getBoundingClientRect(); basket.x=(clientX-r.left)*(W/r.width); }
c.addEventListener('mousemove',e=>moveTo(e.clientX));
c.addEventListener('touchmove',e=>{ e.preventDefault(); moveTo(e.touches[0].clientX); },{passive:false});
reset(); loop();
"""
    return _page("Catch", css, body, script, theme, level)


def whack(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
    css = """
#board{display:grid;grid-template-columns:repeat(3,96px);gap:10px}
.hole{width:96px;height:96px;font-size:48px;background:var(--panel);border-radius:50%;padding:0;border:3px solid var(--accent)}
"""
    body = """
<h1>🔨 Whack-a-Mole</h1>
<p>Time: <b id="t">30</b> · Score: <b id="s">0</b> · Best: <b id="b">0</b></p>
<div id="board"></div>
<button id="go" onclick="start()">Start</button>
<p id="msg"></p>
"""
    script = r"""
const board=$('board'),holes=[];
for(let i=0;i<9;i++){
  const h=document.createElement('button'); h.className='hole';
  h.onclick=()=>hit(i); board.appendChild(h); holes.push(h);
}
let score=0,time=30,timers=[],moleAt=-1,running=false,best=store.get('whack.best',0);
$('b').textContent=best;
function setMole(i){
  if(moleAt>=0) holes[moleAt].textContent='';
  moleAt=i;
  if(i>=0) holes[i].textContent=THEME.enemy;
}
function spawn(){
  if(!running) return;
  let i; do{ i=Math.floor(Math.random()*9); }while(i===moleAt);
  setMole(i);
}
function hit(i){
  if(!running||i!==moleAt) return;
  score++; $('s').textContent=score; setMole(-1);
}
function stopAll(){ timers.forEach(clearInterval); timers=[]; running=false; setMole(-1); }
function finish(){
  stopAll();
  if(score>best){ best=score; store.set('whack.best',best); $('b').textContent=best; }
  $('msg').textContent='Time! You scored '+score;
  $('go').textContent='Play again';
}
function start(){
  stopAll(); score=0; time=30; running=true;
  $('s').textContent=0; $('t').textContent=time; $('msg').textContent=''; $('go').textContent='Restart';
  timers.push(setInterval(spawn,Math.max(350,900/LEVEL)));
  timers.push(setInterval(()=>{ time--; $('t').textContent=time; if(time<=0) finish(); },1000));
  spawn();
}
"""
    return _page("Whack-a-Mole", css, body, script, theme, level)


def simon(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
    css = """
#pads{display:grid;grid-template-columns:repeat(2,130px);gap:14px}
.pad{width:130px;height:130px;border-radius:20px;padding:0;opacity:.55;transition:opacity .1s,transform .1s}
.pad.lit{opacity:1;transform:scale(1.06)}
"""
    body = """
<h1>🎵 Simon</h1>
<p>Score: <b id="s">0</b> · Best: <b id="b">0</b></p>
<div id="pads"></div>
<button id="go" onclick="startGame()">Start</button>
<p id="msg">Press Start, then repeat the colours</p>
"""
    script = r"""
const COLORS=['#ef4444','#22c55e','#3b82f6','#eab308'];
const padsEl=$('pads'),pads=[];
COLORS.forEach((col,i)=>{
  const b=document.createElement('button'); b.className='pad'; b.style.background=col;
  b.onclick=()=>press(i); padsEl.appendChild(b); pads.push(b);
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let seq=[],input=[],busy=false,started=false,best=store.get('simon.best',0);
$('b').textContent=best;
function flash(i){
  pads[i].classList.add('lit');
  return sleep(320/LEVEL).then(()=>pads[i].classList.remove('lit'));
}
async function playBack(){
  busy=true; $('msg').textContent='Watch…';
  await sleep(600);
  for(const i of seq){ await flash(i); await sleep(180/LEVEL); }
  busy=false; input=[]; $('msg').textContent='Your turn';
}
function startGame(){
  seq=[Math.floor(Math.random()*4)]; input=[]; started=true;
  $('s').textContent=0; playBack();
}
function gameOver(){
  started=false; busy=false;
  const score=seq.length-1;
  if(score>best){ best=score; store.set('simon.best',best); $('b').textContent=best; }
  $('msg').textContent='Wrong! Score '+score+' — press Start';
}
function press(i){
  if(!started||busy) return;
  flash(i); input.push(i);
  const k=input.length-1;
  if(input[k]!==seq[k]){ gameOver(); return; }
  if(input.length===seq.length){
    $('s').textContent=seq.length;
    seq.push(Math.floor(Math.random()*4));
    busy=true; $('msg').textContent='Nice! Next…';
    sleep(700).then(playBack);
  }
}
"""
    return _page("Simon", css, body, script, theme, level)


# ---------------------------------------------------------------- MORE APPS

def notes(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
    css = """
.row{display:flex;gap:8px;justify-content:center}
.wrap{display:flex;gap:12px;width:min(820px,95vw)}
ul{list-style:none;padding:0;margin:0;width:220px;max-height:60vh;overflow:auto;text-align:left}
li{padding:8px 10px;border-radius:8px;cursor:pointer;background:var(--panel);margin-bottom:6px;word-break:break-word}
li.on{outline:2px solid var(--accent)}
textarea{flex:1;height:60vh;border-radius:12px;padding:12px;background:var(--panel);color:var(--fg);border:1px solid #334155;font:16px system-ui,sans-serif;resize:none}
"""
    body = """
<h1>📝 Notes</h1>
<div class="row"><button onclick="newNote()">+ New note</button><button onclick="delNote()">Delete</button></div>
<div class="wrap"><ul id="list"></ul><textarea id="txt" placeholder="Write something… (first line = title)"></textarea></div>
"""
    script = r"""
let notes=store.get('notes.list',[]), cur=notes.length?0:-1;
function title(n){ return (n.text.split('\n')[0].trim()||'Untitled').slice(0,30); }
function save(){ store.set('notes.list',notes); render(); }
function render(){
  const ul=$('list'); ul.innerHTML='';
  notes.forEach((n,i)=>{
    const li=document.createElement('li'); li.textContent=title(n);
    if(i===cur) li.className='on';
    li.onclick=()=>{ cur=i; render(); };
    ul.appendChild(li);
  });
  $('txt').value=cur>=0?notes[cur].text:'';
  $('txt').disabled=cur<0;
}
$('txt').oninput=()=>{
  if(cur<0) return;
  notes[cur].text=$('txt').value; notes[cur].updated=Date.now();
  store.set('notes.list',notes);
  const li=$('list').children[cur]; if(li) li.textContent=title(notes[cur]);
};
function newNote(){ notes.unshift({text:'',updated:Date.now()}); cur=0; save(); $('txt').focus(); }
function delNote(){
  if(cur<0) return;
  notes.splice(cur,1);
  cur=notes.length?Math.min(cur,notes.length-1):-1;
  save();
}
render();
"""
    return _page("Notes", css, body, script, theme, level)


def converter(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
    css = """
.row{display:flex;gap:8px;align-items:center;justify-content:center}
input[type=number]{width:160px;font-size:18px}
"""
    body = """
<h1>📏 Converter</h1>
<div class="row"><select id="cat"></select></div>
<div class="row"><input id="a" type="number" value="1" oninput="fromA()"><select id="ua" onchange="fromA()"></select></div>
<div>=</div>
<div class="row"><input id="b" type="number" oninput="fromB()"><select id="ub" onchange="fromA()"></select></div>
"""
    script = r"""
const CATS={
  length:{m:1,km:1000,cm:0.01,mm:0.001,mi:1609.344,ft:0.3048,in:0.0254},
  weight:{kg:1,g:0.001,mg:0.000001,lb:0.45359237,oz:0.028349523125},
  temperature:{C:1,F:1,K:1}
};
function conv(v,from,to){
  if(cat==='temperature'){
    const c=from==='C'?v:from==='F'?(v-32)*5/9:v-273.15;
    return to==='C'?c:to==='F'?c*9/5+32:c+273.15;
  }
  const f=CATS[cat];
  return v*f[from]/f[to];
}
function fmt(n){ return Number.isFinite(n)?String(+n.toPrecision(8)):''; }
let cat='length';
function fillUnits(){
  cat=$('cat').value;
  for(const id of ['ua','ub']){
    const s=$(id); s.innerHTML='';
    Object.keys(CATS[cat]).forEach(u=>{ const o=document.createElement('option'); o.value=u; o.textContent=u; s.appendChild(o); });
  }
  $('ub').selectedIndex=1; fromA();
}
function fromA(){ const v=parseFloat($('a').value); $('b').value=Number.isFinite(v)?fmt(conv(v,$('ua').value,$('ub').value)):''; }
function fromB(){ const v=parseFloat($('b').value); $('a').value=Number.isFinite(v)?fmt(conv(v,$('ub').value,$('ua').value)):''; }
Object.keys(CATS).forEach(k=>{ const o=document.createElement('option'); o.value=k; o.textContent=k; $('cat').appendChild(o); });
$('cat').onchange=fillUnits;
fillUnits();
"""
    return _page("Converter", css, body, script, theme, level)


def dice(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
    css = """
.row{display:flex;gap:8px;align-items:center;justify-content:center}
.faces{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;min-height:76px}
.die{width:72px;height:72px;border-radius:16px;background:var(--panel);display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;border:2px solid var(--accent)}
ul{list-style:none;padding:0;margin:0;text-align:left;width:300px}
li{padding:4px 0;border-bottom:1px solid rgba(255,255,255,.1)}
"""
    body = """
<h1>🎲 Dice</h1>
<div class="row">Dice <select id="n"></select> Sides <select id="s"></select></div>
<button onclick="roll()">Roll! (Space)</button>
<div id="faces" class="faces"></div>
<p>Total: <b id="tot">0</b></p>
<h3>History</h3>
<ul id="hist"></ul>
"""
    script = r"""
for(let i=1;i<=6;i++) $('n').add(new Option(String(i),String(i)));
[4,6,8,10,12,20].forEach(s=>$('s').add(new Option('d'+s,String(s))));
$('n').value='2'; $('s').value='6';
let hist=store.get('dice.hist',[]);
function renderHist(){
  const ul=$('hist'); ul.innerHTML='';
  hist.forEach(h=>{ const li=document.createElement('li'); li.textContent=h; ul.appendChild(li); });
}
function roll(){
  const n=+$('n').value, sides=+$('s').value, rolls=[];
  for(let i=0;i<n;i++) rolls.push(1+Math.floor(Math.random()*sides));
  const total=rolls.reduce((a,b)=>a+b,0);
  $('faces').innerHTML='';
  rolls.forEach(r=>{ const d=document.createElement('div'); d.className='die'; d.textContent=r; $('faces').appendChild(d); });
  $('tot').textContent=total;
  hist.unshift(n+'d'+sides+': '+rolls.join(', ')+'  = '+total);
  hist=hist.slice(0,10); store.set('dice.hist',hist); renderHist();
}
addEventListener('keydown',e=>{ if(e.key===' '){ e.preventDefault(); roll(); } });
renderHist();
"""
    return _page("Dice", css, body, script, theme, level)


def stopwatch(theme=None, level=1.0) -> str:
    theme = theme or THEMES["default"]
    css = """
#t{font-size:64px;font-weight:700;font-variant-numeric:tabular-nums}
ol{text-align:left;width:260px;max-height:40vh;overflow:auto;padding-left:40px}
"""
    body = """
<h1>⏱️ Stopwatch</h1>
<div id="t">00:00.00</div>
<div><button id="go" onclick="toggle()">Start</button><button onclick="lap()">Lap</button><button onclick="reset()">Reset</button></div>
<ol id="laps"></ol>
"""
    script = r"""
const pad=(n,w=2)=>String(n).padStart(w,'0');
let base=0,startedAt=0,running=false,timer=null;
function now(){ return running?base+(performance.now()-startedAt):base; }
function fmt(ms){
  const t=Math.floor(ms);
  return pad(Math.floor(t/60000))+':'+pad(Math.floor(t/1000)%60)+'.'+pad(Math.floor(t%1000/10));
}
function paint(){ $('t').textContent=fmt(now()); }
function toggle(){
  if(running){
    base=now(); running=false; clearInterval(timer); timer=null; $('go').textContent='Start';
  } else {
    startedAt=performance.now(); running=true; $('go').textContent='Stop';
    timer=setInterval(paint,30);
  }
  paint();
}
function lap(){
  if(!running) return;
  const li=document.createElement('li'); li.textContent=fmt(now()); $('laps').appendChild(li);
}
function reset(){
  running=false; clearInterval(timer); timer=null; base=0;
  $('laps').innerHTML=''; $('go').textContent='Start'; paint();
}
paint();
"""
    return _page("Stopwatch", css, body, script, theme, level)


# ---------------------------------------------------------------- REGISTRY

@dataclass(frozen=True)
class Template:
    key: str
    title: str
    kind: str                      # "game" | "app"
    keywords: List[str]            # matched after engine.normalize()
    build: Callable[..., str]      # build(theme=None, level=1.0) -> html


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
_reg("flappy", "Flappy", "game",
     ["flappy", "flap", "flappy bird", "fly bird", "bird", "طائر", "tayer", "tyar", "عصفور", "oiseau"],
     flappy)
_reg("shooter", "Shooter", "game",
     ["shooter", "shoot em up", "space invaders", "invaders", "shmup", "tireur", "tir", "vaisseau",
      "شوتر", "تصويب", "تيرو", "اطلاق النار"],
     shooter)
_reg("catch", "Catch", "game",
     ["catch", "basket", "panier", "attrape", "attraper", "ramasser", "سلة", "قفة", "صيد"],
     catch)
_reg("whack", "Whack-a-Mole", "game",
     ["whack", "whack a mole", "mole", "taupe", "taupes", "خلد", "الخلد", "hamster", "هامستر"],
     whack)
_reg("simon", "Simon", "game",
     ["simon", "simon says", "sim0n", "suite de couleurs", "تسلسل الالوان", "تسلسل"],
     simon)

_reg("todo", "To-Do", "app",
     ["todo", "to-do", "to do", "task", "tasks", "مهام", "مهمات", "tâches", "taches", "tache", "liste de"],
     todo)
_reg("calculator", "Calculator", "app",
     ["calculator", "calculatrice", "calc", "آلة حاسبة", "الة حاسبة", "حاسبة", "حاسبه", "machine a calcul"],
     calculator)
_reg("pomodoro", "Pomodoro Timer", "app",
     ["pomodoro", "timer", "minuterie", "minuteur", "مؤقت", "مؤقّت", "focus"],
     pomodoro)
_reg("expenses", "Expense Tracker", "app",
     ["expense", "expenses", "budget", "depense", "dépense", "depenses", "مصاريف", "المصاريف", "مصروف", "ميزانية", "finance"],
     expenses)
_reg("password", "Password Generator", "app",
     ["password", "mot de passe", "mot-de-passe", "mdp", "كلمة السر", "كلمة المرور", "باسوورد", "باسورد", "بسورد", "passe"],
     password)
_reg("notes", "Notes", "app",
     ["notes", "note", "notepad", "bloc-notes", "bloc notes", "ملاحظات", "ملاحظه", "mlahdat", "mlahdate"],
     notes)
_reg("converter", "Converter", "app",
     ["converter", "convert", "convertisseur", "conversion", "محول", "تحويل", "converti"],
     converter)
_reg("dice", "Dice", "app",
     ["dice", "dé", "zar", "زهر", "نرد", "lancer de"],
     dice)
_reg("stopwatch", "Stopwatch", "app",
     ["stopwatch", "chrono", "chronometre", "chronomètre", "stop watch", "ساعة ايقاف", "شرونو", "كرونو"],
     stopwatch)

# Generic words: used only when nothing specific matched.
GENERIC_GAME_WORDS = ["game", "games", "jeu", "jeux", "لعبة", "لعبه", "العاب", "ألعاب", "lo3ba", "l3iba", "l3ab", "3ab", "lo3bat"]
GENERIC_APP_WORDS = ["app", "apps", "application", "applications", "تطبيق", "تطبيقات", "tatbi9", "tatbik", "tbi9", "appli", "logiciel"]
DEFAULT_GAME = "snake"
DEFAULT_APP = "todo"
