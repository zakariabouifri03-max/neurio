// ── Persistence (localStorage) ───────────────────────────────────────────────

const KEY = 'bashbaqi_save_v1';

export function defaultSave() {
  return {
    v: 1,
    coins: 500,
    gems: 5,
    trophies: 0,
    ownedCars: ['c01'],
    selectedCar: 'c01',
    ownedDrivers: ['dr01'],
    selectedDriver: 'dr01',
    upgrades: {},          // carId -> {spd,acc,hnd} levels 0..5
    paints: {},            // carId -> hex color
    ownedPaints: [0, 1, 2, 3, 4, 5, 6, 7],
    wheelColor: '#23262e',
    ownedHorns: [0],
    horn: 0,
    standings: null,       // {player:pts, riv0..riv4:pts}
    seasonRace: 0,
    seasonNum: 1,
    wins: 0,
    races: 0,
    music: true,
    sfx: true,
  };
}

export function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === 'object') {
      const d = defaultSave();
      const out = Object.assign(d, s);
      out.v = 1;
      return out;
    }
  } catch (e) { /* corrupted save → fresh start */ }
  return defaultSave();
}

export function persist(s) {
  s.v = 1;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
}
