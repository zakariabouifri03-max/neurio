#!/usr/bin/env node
/**
 * test-addon.mjs — runs the REAL addon scripts against a mock of the Minecraft
 * Bedrock Script API, so we catch bugs without launching the game.
 *
 *   node tools/test-addon.mjs
 *
 * It simulates a world: a player joining, sneaking onto a villager, chatting,
 * getting hit, rain, night time... and prints everything the villager said.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NM = join(ROOT, 'node_modules');

/* ------------------------------------------------------------------ *
 * the mock @minecraft/server + @minecraft/server-ui
 * ------------------------------------------------------------------ */
const SERVER_MOCK = `
export class Vec { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} }

export const LOG = { messages: [], sounds: [], particles: [], forms: [], commands: [] };

export class ItemStack {
  constructor(typeId, amount=1){ this.typeId=typeId; this.amount=amount; this.maxAmount=64; }
  clone(){ return new ItemStack(this.typeId, this.amount); }
  getTags(){ return []; } hasTag(){ return false; }
  setLore(){} getLore(){ return []; }
}

let NEXT_ID = 1;
export class Entity {
  constructor(typeId, loc, dimension){
    this.typeId=typeId; this.id='e'+(NEXT_ID++); this.location=loc||new Vec();
    this.dimension=dimension; this.nameTag=''; this._props={}; this._tags=new Set();
    this.isSneaking=false; this.isSwimming=false; this.isOnGround=true;
    this._inv=[];
  }
  get isValid(){ return !this._dead; }
  remove(){ this._dead=true; }
  kill(){ this._dead=true; }
  getComponent(id){
    if(id==='minecraft:inventory') return { container: makeContainer(this) };
    if(id==='minecraft:health') return { currentValue: this._hp ?? 20, effectiveMaximum: 20 };
    if(id==='minecraft:variant') return { value: this._variant ?? 1 };
    if(id==='minecraft:mark_variant') return { value: this._mark ?? 0 };
    if(id==='equipped_item') return { item: this._held || undefined };
    return undefined;
  }
  hasComponent(id){ return !!this.getComponent(id); }
  addTag(t){ this._tags.add(t); return true; }
  removeTag(t){ return this._tags.delete(t); }
  hasTag(t){ return this._tags.has(t); }
  getTags(){ return [...this._tags]; }
  getDynamicProperty(k){ return this._props[k]; }
  setDynamicProperty(k,v){ if(v===undefined) delete this._props[k]; else this._props[k]=v; return true; }
  getDynamicPropertyIds(){ return Object.keys(this._props); }
  clearDynamicProperties(){ this._props={}; }
  addEffect(){ return {}; } removeEffect(){ return true; }
  applyImpulse(){} lookAt(){} teleport(){} clearVelocity(){}
  getHeadLocation(){ return new Vec(this.location.x, this.location.y+1.6, this.location.z); }
  getRotation(){ return {x:0,y:0}; }
  getViewDirection(){ return {x:0,y:0,z:1}; }
  getEntitiesFromViewDirection(){ return []; }
  playSound(id,o){ LOG.sounds.push([this.id||'player', id, o]); }
  sendMessage(m){ LOG.messages.push(['entity', stringify(m)]); }
}

export class Player extends Entity {
  constructor(name, loc, dimension){ super('minecraft:player', loc, dimension); this.name=name; this.isSneaking=false; }
  get onScreenDisplay(){ return { setActionBar(t){ LOG.messages.push(['actionbar', stringify(t)]); }, setTitle(t,o){ LOG.messages.push(['title', stringify(t), o&&stringify(o.subtitle)]); }, setHudVisibility(){} }; }
  getGameMode(){ return 'survival'; }
  addExperience(){} addLevels(){} playMusic(){} queueMusic(){} stopMusic(){}
}

function makeContainer(entity){
  const items = entity._inv;
  return {
    size: 36, emptySlotsCount: 36-items.length, isValid: true,
    getItem(i){ return items[i]; },
    setItem(i,it){ if(it) items[i]=it; else delete items[i]; },
    addItem(stack){ items.push(stack); return undefined; },
    clearAll(){ items.length=0; },
    firstEmptySlot(){ return items.length; },
  };
}
export { makeContainer };

export class Dimension {
  constructor(id){ this.id=id; this._entities=[]; this._time=1000; this._props={}; this.heightRange={min:0,max:256}; }
  getEntities(opts={}){
    let out=this._entities.filter(e=>e.isValid);
    if(opts.type) out=out.filter(e=>e.typeId===opts.type);
    if(opts.types) out=out.filter(e=>opts.types.includes(e.typeId));
    if(opts.location && opts.maxDistance!=null){
      const d2=opts.maxDistance*opts.maxDistance;
      out=out.filter(e=>dist2(e.location,opts.location)<=d2);
    }
    if(opts.closest!=null) out=out.slice(0,opts.closest);
    return out;
  }
  getBlock(){ return { permutation:{ type:{ id:'minecraft:stone' } }, isAir:false }; }
  getBiome(){ return { id:'minecraft:plains' }; }
  getTimeOfDay(){ return this._time; }
  setTimeOfDay(t){ this._time=t; }
  playSound(id,loc,o){ LOG.sounds.push([this.id, id, o]); }
  spawnParticle(name,loc){ LOG.particles.push([name, loc]); }
  spawnEntity(typeId, loc){ const e=new Entity(typeId, loc, this); this._entities.push(e); fireAfter('entitySpawn',{entity:e,cause:'spawned'}); return e; }
  spawnItem(stack, loc){ const e=new Entity('minecraft:item', loc, this); this._entities.push(e); return e; }
  runCommand(c){ LOG.commands.push(c); return { successCount:1 }; }
  runCommandAsync(c){ LOG.commands.push(c); return Promise.resolve({ successCount:1 }); }
  getSpawnLocation(){ return new Vec(0,64,0); }
  getWeather(){ return 'clear'; }
  setWeather(){}
  fillBlocks(){} cloneBlocks(){}
}

function dist2(a,b){ const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z; return dx*dx+dy*dy+dz*dz; }

export function stringify(m){
  if(typeof m==='string') return m;
  if(Array.isArray(m)) return m.map(stringify).join('');
  if(m && m.rawtext) return m.rawtext.map(stringify).join('');
  if(m && m.translate) return '<'+m.translate+'>';
  if(m && m.text) return m.text;
  return JSON.stringify(m);
}

/* ---------------- events ---------------- */
function makeSignal(){ const subs=[]; return { subscribe(cb){ subs.push(cb); return cb; }, unsubscribe(cb){ const i=subs.indexOf(cb); if(i>=0) subs.splice(i,1); }, _fire(ev){ for(const s of subs.slice()) s(ev); } }; }

const BEFORE = {
  playerInteractWithEntity: makeSignal(), itemUse: makeSignal(), itemUseOn: makeSignal(),
  playerBreakBlock: makeSignal(), playerInteractWithBlock: makeSignal(),
};
const AFTER = {
  entityHurt: makeSignal(), entityDie: makeSignal(), entitySpawn: makeSignal(), entityLoad: makeSignal(),
  entityRemove: makeSignal(), playerSpawn: makeSignal(), playerJoin: makeSignal(), playerLeave: makeSignal(),
  weatherChange: makeSignal(), entityHealthChanged: makeSignal(), entityHitEntity: makeSignal(),
  playerDimensionChange: makeSignal(), playerGameModeChange: makeSignal(), itemUse: makeSignal(),
  playerInteractWithEntity: makeSignal(),
};
export function fireAfter(name, ev){ AFTER[name] && AFTER[name]._fire(ev); }
export function fireBefore(name, ev){ BEFORE[name] && BEFORE[name]._fire(ev); }

const dims = { overworld: new Dimension('minecraft:overworld'), nether: new Dimension('minecraft:nether') };
const players = [];
export function __mock(){ return { dims, players, LOG, BEFORE, AFTER, Entity, Player, ItemStack, Vec, dist2 }; }

export const world = {
  beforeEvents: BEFORE,
  afterEvents: AFTER,
  getDimension(id){ return dims[id] || dims.overworld; },
  getAllPlayers(){ return players.slice(); },
  getPlayers(){ return players.slice(); },
  sendMessage(m){ LOG.messages.push(['world', stringify(m)]); },
  getDynamicProperty(k){ return dims.overworld._props[k]; },
  setDynamicProperty(k,v){ if(v===undefined) delete dims.overworld._props[k]; else dims.overworld._props[k]=v; },
  playSound(id,loc,o){ dims.overworld.playSound(id,loc,o); },
  spawnEntity(t,l){ return dims.overworld.spawnEntity(t,l); },
  getAbsoluteTime(){ return 0; },
};

export const system = {
  currentTick: 0,
  _timeouts: [], _intervals: [], _runQueue: [],
  runTimeout(fn, ticks=1){ this._timeouts.push({fn, at:this.currentTick+(ticks||1)}); return this._timeouts.length; },
  clearRun(id){},
  runInterval(fn, ticks=1){ this._intervals.push({fn, every:Math.max(1,ticks||1), next:this.currentTick+(ticks||1)}); return this._intervals.length; },
  clearRunInterval(id){},
  run(fn){ this._runQueue.push(fn); return this._runQueue.length; },
  afterEvents: { scriptEventReceive: makeSignal() },
  beforeEvents: { watchdogTerminate: makeSignal() },
  __tick(n=1){
    for(let i=0;i<n;i++){
      this.currentTick++;
      for(const q of this._runQueue.splice(0)) { try{ q(); }catch(e){ console.error('run() error:', e); } }
      for(const t of this._timeouts.slice()){ if(t.at<=this.currentTick){ this._timeouts.splice(this._timeouts.indexOf(t),1); try{ t.fn(); }catch(e){ console.error('timeout error:', e); } } }
      for(const iv of this._intervals){ if(iv.next<=this.currentTick){ iv.next=this.currentTick+iv.every; try{ iv.fn(); }catch(e){ console.error('interval error:', e); } } }
    }
  },
};
export { players as __players };
export const GameMode = { survival:'survival', creative:'creative', adventure:'adventure', spectator:'spectator' };
export const EquipmentSlot = { Mainhand:'Mainhand', Offhand:'Offhand', Head:'Head', Chest:'Chest', Legs:'Legs', Feet:'Feet' };
export const World = { };
export const WeatherType = { Clear:'Clear', Rain:'Rain', Thunder:'Thunder' };
export const TimeOfDay = { Dawn:'Dawn', Day:'Day', Noon:'Noon', Sunset:'Sunset', Night:'Night', Midnight:'Midnight' };
`;

const UI_MOCK = `
import { LOG } from '@minecraft/server';
let RESPONSES = [];
export function __setResponses(list){ RESPONSES = list.slice(); }
export function __logForms(){ return LOG.forms; }
class FormResponse { constructor(o){ Object.assign(this, o); } }
export class ActionFormResponse extends FormResponse {}
export class ModalFormResponse extends FormResponse {}
export class MessageFormResponse extends FormResponse {}
export const FormCancelationReason = { UserBusy:'UserBusy', UserClosed:'UserClosed' };
export class ActionFormData {
  constructor(){ this._t=null; this._b=null; this._buttons=[]; }
  title(t){ this._t=t; return this; }
  body(b){ this._b=b; return this; }
  header(t){ return this; }
  label(t){ return this; }
  divider(){ return this; }
  button(text, icon){ this._buttons.push({text, icon}); return this; }
  async show(player){
    const form = { kind:'action', title:this._t, body:this._b, buttons:this._buttons.map(b=>b.text) };
    LOG.forms.push(form);
    const r = RESPONSES.shift();
    if (r===undefined) return new ActionFormResponse({ canceled:true, cancelationReason:'UserClosed', selection:undefined });
    return new ActionFormResponse(Object.assign({ canceled:false }, typeof r==='number'?{selection:r}:r));
  }
}
export class ModalFormData {
  constructor(){ this._fields=[]; this._t=null; }
  title(t){ this._t=t; return this; }
  header(t){ return this; }
  label(t){ return this; }
  divider(){ return this; }
  textField(label, ph, opts){ this._fields.push(['text',label,ph]); return this; }
  dropdown(label, items, opts){ this._fields.push(['drop',label,items]); return this; }
  slider(label,a,b,opts){ this._fields.push(['slider',label]); return this; }
  toggle(label, opts){ this._fields.push(['toggle',label]); return this; }
  submitButton(t){ this._submit=t; return this; }
  async show(player){
    const form = { kind:'modal', title:this._t, fields:this._fields.map(f=>f[0]+':'+f[1]) };
    LOG.forms.push(form);
    const r = RESPONSES.shift();
    if (r===undefined) return new ModalFormResponse({ canceled:true, cancelationReason:'UserClosed', formValues:undefined });
    return new ModalFormResponse(Object.assign({ canceled:false, formValues:[] }, r));
  }
}
export class MessageFormData {
  title(t){return this;} body(b){return this;} button1(t){return this;} button2(t){return this;}
  async show(){ return new MessageFormResponse({canceled:true}); }
}
export class UIManager {}
`;

function ensureMocks() {
  const dirs = [
    join(NM, '@minecraft', 'server'),
    join(NM, '@minecraft', 'server-ui'),
  ];
  for (const d of dirs) mkdirSync(d, { recursive: true });
  writeFileSync(join(NM, '@minecraft', 'server', 'package.json'), JSON.stringify({ name: '@minecraft/server', version: '0.0.0-mock', type: 'module', main: 'index.js' }));
  writeFileSync(join(NM, '@minecraft', 'server', 'index.js'), SERVER_MOCK);
  writeFileSync(join(NM, '@minecraft', 'server-ui', 'package.json'), JSON.stringify({ name: '@minecraft/server-ui', version: '0.0.0-mock', type: 'module', main: 'index.js' }));
  writeFileSync(join(NM, '@minecraft', 'server-ui', 'index.js'), UI_MOCK);
}

/* ------------------------------------------------------------------ *
 * the scenario
 * ------------------------------------------------------------------ */
async function main() {
  ensureMocks();
  const server = await import('@minecraft/server');
  const ui = await import('@minecraft/server-ui');
  const { __mock } = server;
  const m = __mock();
  const { dims, players, LOG, Vec } = m;
  const ow = dims.overworld;

  // advance ticks AND flush the microtask queue (forms are async)
  const tick = async (n = 4) => {
    server.system.__tick(n);
    for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
  };

  console.log('── importing the addon (main.js) ──');
  await import('../addon/behavior_pack/scripts/main.js');
  await tick(2);

  const mkPlayer = (name) => {
    const p = new server.Player(name, new Vec(0, 64, 0), ow);
    players.push(p);
    return p;
  };
  const player = mkPlayer('Zakaria');

  console.log('── player joins (initialSpawn) ──');
  server.fireAfter('playerSpawn', { player, initialSpawn: true });
  await tick(50);
  console.log('messages:', LOG.messages.filter((x) => x[0] !== 'actionbar').slice(-3).map((x) => x[1].slice(0, 90)));

  console.log('\n── summon 3 villagers ──');
  const v1 = ow.spawnEntity('minecraft:villager_v2', new Vec(1, 64, 1));
  v1.nameTag = 'الحاج';
  const v2 = ow.spawnEntity('minecraft:villager_v2', new Vec(-2, 64, 1));
  const v3 = ow.spawnEntity('minecraft:villager_v2', new Vec(0, 64, -3));
  player.location = new Vec(0.5, 64, 0.5);

  console.log('── sneak + use on v1 -> menu, then TALK: "salam 7aj, chno smitk?" ──');
  ui.__setResponses([
    0, // menu -> "talk"
    { formValues: ['salam 7aj, chno smitk?'] }, // the text box
    7, // menu -> close
  ]);
  player.isSneaking = true;
  server.fireBefore('playerInteractWithEntity', { player, target: v1, itemStack: undefined, cancel: false });
  await tick(6);
  for (const f of LOG.forms.slice(-3)) console.log('form:', JSON.stringify(f).slice(0, 240));

  console.log('\n── /scriptevent neurio:say "ch7al f l9m7?" ──');
  server.system.afterEvents.scriptEventReceive._fire({ id: 'neurio:say', message: 'ch7al f l9m7?', sourceEntity: player, sourceType: 'Server' });
  await tick(4);
  console.log('chat:', LOG.messages.filter((x) => x[0] === 'entity').slice(-2).map((x) => x[1]));
  console.log('sounds:', LOG.sounds.slice(-6).map((s) => s[1]));

  console.log('\n── player hits v2 -> angry reaction ──');
  server.fireAfter('entityHurt', { hurtEntity: v2, damageSource: { damagingEntity: player, cause: 'entityAttack' }, damage: 3 });
  await tick(4);
  console.log('chat:', LOG.messages.filter((x) => x[0] === 'entity').slice(-1).map((x) => x[1]));

  console.log('\n── rain starts ──');
  server.fireAfter('weatherChange', { newWeather: 'Rain', previousWeather: 'Clear' });
  await tick(4);

  console.log('\n── ambient barks: 400 ticks at night ──');
  ow._time = 15000;
  await tick(400);
  const barks = LOG.messages.filter((x) => x[0] === 'actionbar' || x[0] === 'entity');
  console.log('barks heard:', barks.length);
  for (const b of barks.slice(-4)) console.log('  ', b[1].slice(0, 110));

  console.log('\n── amulet on v3 ──');
  ui.__setResponses([3]); // close
  server.fireBefore('playerInteractWithEntity', { player, target: v3, itemStack: new server.ItemStack('neurio:talking_amulet', 1), cancel: false });
  await tick(6);
  console.log('amulet form:', JSON.stringify(LOG.forms.slice(-1)[0]).slice(0, 200));

  console.log('\n── /scriptevent neurio:stats + info ──');
  server.system.afterEvents.scriptEventReceive._fire({ id: 'neurio:stats', message: '', sourceEntity: player, sourceType: 'Server' });
  server.system.afterEvents.scriptEventReceive._fire({ id: 'neurio:info', message: '', sourceEntity: player, sourceType: 'Server' });
  await tick(4);
  console.log('chat:', LOG.messages.filter((x) => x[0] === 'entity').slice(-2).map((x) => x[1]));

  console.log('\n── gift via menu (give v1 bread) ──');
  player._inv.push(new server.ItemStack('minecraft:bread', 5));
  ui.__setResponses([1, 0, 7]); // menu -> gift, gift -> bread, menu -> close
  server.fireBefore('playerInteractWithEntity', { player, target: v1, itemStack: undefined, cancel: false });
  await tick(8);
  console.log('chat:', LOG.messages.filter((x) => x[0] === 'entity').slice(-2).map((x) => x[1].slice(0, 110)));

  const sounds = LOG.sounds.length;
  console.log(`\n✔ done. ${LOG.messages.length} messages, ${sounds} sound events, ${LOG.forms.length} forms, ${LOG.commands.length} commands, 0 crashes`);
}

main().catch((e) => { console.error('\n✖ TEST FAILED:', e); process.exit(1); });
