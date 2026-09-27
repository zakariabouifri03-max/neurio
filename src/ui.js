import { PAINTS, setPaint, setFinish, setLights } from './car.js';

/**
 * Wires the DOM control dock + HUD to the scene API.
 */
export function initUI(carState, { cycleView, toggleTurntable, onIgnite, engine }) {
  const $ = (id) => document.getElementById(id);

  // ---------------- paint swatches ----------------
  const swatchWrap = $('swatches');
  PAINTS.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'swatch' + (i === 0 ? ' active' : '');
    b.style.background = `radial-gradient(circle at 32% 28%, ${lighten(p.hex, 55)}, ${p.hex} 58%, ${darken(p.hex, 45)})`;
    b.title = p.name;
    b.dataset.id = p.id;
    b.addEventListener('click', () => {
      setPaint(carState, p.hex);
      swatchWrap.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
      b.classList.add('active');
    });
    swatchWrap.appendChild(b);
  });

  // ---------------- finish segmented ----------------
  document.querySelectorAll('#finishes .seg').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#finishes .seg').forEach((s) => s.classList.remove('active'));
      btn.classList.add('active');
      setFinish(carState, btn.dataset.finish);
    });
  });

  // ---------------- icon buttons ----------------
  const btnLights = $('btn-lights');
  btnLights.addEventListener('click', () => {
    setLights(carState, !carState.lightsOn);
    btnLights.classList.toggle('active', carState.lightsOn);
  });

  const btnTurn = $('btn-turntable');
  btnTurn.addEventListener('click', () => {
    const on = toggleTurntable();
    btnTurn.classList.toggle('active', on);
  });

  const btnView = $('btn-view');
  const viewLabel = $('view-label');
  btnView.addEventListener('click', () => {
    viewLabel.textContent = cycleView();
  });

  const btnSound = $('btn-sound');
  btnSound.classList.add('active');
  btnSound.addEventListener('click', () => {
    const on = engine.toggleEnabled();
    btnSound.classList.toggle('active', on);
  });

  // ---------------- ignite ----------------
  const btnIgnite = $('btn-ignite');
  let driving = false;
  btnIgnite.addEventListener('click', () => {
    driving = !driving;
    btnIgnite.classList.toggle('active', driving);
    btnIgnite.textContent = driving ? 'STOP' : 'IGNITE';
    $('hud').classList.toggle('visible', driving);
    if (driving) {
      engine.start();
      if (!carState.lightsOn) {
        setLights(carState, true);
        btnLights.classList.add('active');
      }
    } else {
      engine.silence();
    }
    onIgnite(driving);
  });

  // ---------------- HUD ----------------
  const speedEl = $('speed-value');
  const rpmEl = $('rpm-fill');
  const gearEl = $('gear-value');
  let lastGear = 'N';
  let lastSpeed = -1;

  function setHUD(kmh, rpm01, gear) {
    const r = Math.round(kmh);
    if (r !== lastSpeed) {
      speedEl.textContent = r;
      lastSpeed = r;
    }
    rpmEl.style.width = `${Math.min(100, rpm01 * 100).toFixed(1)}%`;
    const g = gear === 0 ? 'N' : String(gear);
    if (g !== lastGear) {
      gearEl.textContent = g;
      lastGear = g;
    }
  }

  // ---------------- reveal after loader ----------------
  function reveal() {
    document.querySelectorAll('.ui').forEach((el, i) => {
      el.classList.remove('hidden');
      // HUD only appears once the engine is ignited
      if (el.id === 'hud') return;
      setTimeout(() => el.classList.add('visible'), 250 + i * 110);
    });
  }

  return { setHUD, reveal };
}

/* ---------- tiny color helpers for swatch gradients ---------- */
function clamp(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function lighten(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${clamp(r + amt)},${clamp(g + amt)},${clamp(b + amt)})`;
}
function darken(hex, amt) {
  return lighten(hex, -amt);
}
