export class DebugOverlay {
  constructor() {
    this.enabled = false;
    this.el = document.createElement('pre'); this.el.className = 'foundation-debug'; this.el.hidden = true;
    document.body.appendChild(this.el);
  }
  setEnabled(enabled) { this.enabled = !!enabled; this.el.hidden = !this.enabled; }
  update({ camera, voxel, state = 'unknown' } = {}) {
    if (!this.enabled) return;
    const p = camera?.position;
    this.el.textContent = [
      `STATE ${state}`,
      p ? `POS ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}` : 'POS —',
      `CHUNK ${p ? `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}` : '—'}`,
      `LOADED CHUNKS ${voxel?.loadedChunkCount ?? 0}`,
    ].join('\n');
  }
}
