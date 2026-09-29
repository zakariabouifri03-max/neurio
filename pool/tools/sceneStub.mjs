// A Scene3D stand-in for the boot-path test: same public surface, no WebGL.
import { deepStub, tgt } from './stubs.mjs';
export const QUALITY = {
  low: { name: 'Low', dpr: 0.7, shadows: false, shadowSize: 0, bloom: false, hallDetail: 0, envSize: 64, lamps: 1, msaa: 0 },
  medium: { name: 'Medium', dpr: 1.0, shadows: true, shadowSize: 1024, bloom: false, hallDetail: 1, envSize: 128, lamps: 2, msaa: 0 },
  high: { name: 'High', dpr: 1.35, shadows: true, shadowSize: 1536, bloom: true, hallDetail: 2, envSize: 256, lamps: 3, msaa: 2 },
  ultra: { name: 'Ultra', dpr: 2.0, shadows: true, shadowSize: 2048, bloom: true, hallDetail: 3, envSize: 256, lamps: 3, msaa: 4 },
};
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];
export const detectQuality = () => 'high';
export const CLOTH_COLORS = { blue: { name: 'Tournament Blue', base: '#1d5c8a' }, green: { name: 'Club Green', base: '#1d6b45' } };
export const WOOD_FINISHES = { tournament: { name: 'Tournament', base: '#5a3a22' }, onyx: { name: 'Onyx', base: '#22262e' } };
export class Scene3D {
  constructor(canvas, settings = {}) {
    const s = deepStub('scene');
    s.canvas = canvas; s.settings = settings;
    s.quality = 'high'; s.Q = QUALITY.high; s.auto = false;
    s.width = 1440; s.height = 900; s.fps = 60;
    s.renderer = { capabilities: { isWebGL2: true }, shadowMap: { enabled: true, type: 2 }, setPixelRatio() {}, setSize() {}, compile() {} };
    s.camera = { aspect: 1.6, updateProjectionMatrix() {}, getWorldPosition(v) { return v; }, getWorldDirection(v) { return v; }, position: { x: 0, y: 1, z: 2 } };
    s.groups = {}; for (const k of ['root', 'hall', 'table', 'balls', 'props', 'guides', 'fx', 'people']) s.groups[k] = deepStub('g.' + k);
    s.cam = Object.assign(deepStub('cam'), {
      orbit: { yaw: 0, pitch: 0.2, dist: 2 }, mode: 'free',
      setMode(m) { this.mode = m; }, setGoal() {}, kick() {}, cycle() { return this.mode; },
      aimTarget: (c, dx, dz) => tgt(c.x, 1, c.z, c.x + dx, 0.8, c.z + dz, 44),
      topTarget: () => tgt(0, 3, 0, 0, 0, 0, 40), closeTarget: (c) => tgt(c.x, 1, c.z, c.x, 0.8, c.z, 50),
      actionTarget: () => tgt(0, 1.4, 1.6, 0, 0.8, 0, 50), freeTarget: () => tgt(0, 1.4, 2.2, 0, 0.8, 0, 46),
      hallTarget: (x, y, z) => tgt(x, y + 1.6, z + 2, x, y + 0.9, z, 62),
    });
    s.guides = Object.assign(deepStub('guides'), { level: 2, setLevel(l) { this.level = l; }, setData() {}, clear() {}, clearSimPaths() {}, setSimPaths() {}, update() {} });
    s.buildTable = () => s; s.buildLights = () => s; s.buildHall = () => s; s.setShowHall = () => {};
    s.buildCue = () => ({}); s.syncBalls = () => {}; s.resize = () => {}; s.setQuality = () => true;
    s.tickQuality = () => {}; s.render = () => {}; s.setHeadString = () => {}; s.setCue = () => {};
    s.pickCloth = () => null; s.worldToScreen = () => ({ x: 100, y: 100, behind: false });
    return s;
  }
}
export default Scene3D;
