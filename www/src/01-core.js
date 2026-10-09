// ===== Reactor Duel =====
// Source is split into numbered files in www/src and bundled into www/game.js by tools/bundle.py.
// Everything shares one scope (the bundle wraps the files in a single function).

const cv = document.getElementById('game');
let W = 0, H = 0, DPR = 1;
let GL = null;                              // WebGL state, once it is up
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const C = { shield: '#52c8ff', weapon: '#ff9442', engine: '#b48cff', danger: '#ff5468', good: '#6fe3a5', hull: '#e7edf2' };
const SYS = ['shields', 'weapons', 'engines'];
const DEG = Math.PI / 180;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const store = {
  get(k, d) { try { const v = localStorage.getItem('rd.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('rd.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};

// ---------- Ships ----------
// mount: 'turret' rotates (traverse °/s) and fires within its arc; 'fixed' fires only within its arc around the nose.
// The fixed weapon is each ship's "big gun", with a crew nickname.
const SHIPS = {
  kestrel: {
    key: 'kestrel', name: 'Kestrel', cls: 'Light gunship',
    blurb: 'Quick, nimble and well built. A pulse laser turret keeps up the pressure while the rail cannon, Doris, waits for a clean attack run.',
    hullMax: 110, reactor: 10, transfer: 0.8,
    parts: {
      shields: { name: 'Aegis deflector', eff: 1, cap: 6 },
      weapons: { name: 'Weapon bus', eff: 1, cap: 7 },
      engines: { name: 'Mk I drive', eff: 0.85, cap: 6 }
    },
    weapons: [
      { name: 'Pulse laser', short: 'laser', mount: 'turret', arc: 30, traverse: 70, mountX: -17,
        min: 1, cap: 3, base: 3, per: 1.5, interval: 2.2, speed: 600, acc: 0.95, falloff: 0.35, pierce: 0, color: '#ffb070', kind: 'bolt' },
      { name: 'Rail cannon', short: 'rail', nick: 'Doris', label: 'Rail', mount: 'fixed', arc: 20,
        min: 4, cap: 7, base: 30, per: 4, interval: 8, speed: 1000, acc: 0.95, falloff: 0.15, pierce: 0.35, color: '#fff1c2', kind: 'rail' }
    ],
    alloc: { shields: 4, weapons: 3, engines: 3 },
    ai: { base: { shields: 4, weapons: 3, engines: 3 }, charge: { shields: 2, weapons: 5, engines: 3 }, recover: { shields: 5, weapons: 3, engines: 2 }, skirmish: [10, 14], recoverT: 6 }
  },
  corsair: {
    key: 'corsair', name: 'Corsair', cls: 'Pirate gunship',
    blurb: 'A slab of salvaged armour. Tough and slow, with a cranky autocannon turret and a torpedo, Bertha, that hits like a falling building.',
    hullMax: 140, reactor: 10, transfer: 0.6,
    parts: {
      shields: { name: 'Salvaged screen', eff: 1, cap: 5 },
      weapons: { name: 'Weapon bus', eff: 1, cap: 6 },
      engines: { name: 'Worn thrusters', eff: 0.7, cap: 5 }
    },
    weapons: [
      // Fires bursts of 6: each round is weak but rolls its own hit, so damage arrives steadily rather than all-or-nothing.
      { name: 'Autocannon', short: 'autocannon', mount: 'turret', arc: 40, traverse: 45, mountX: -12, burst: 6, gap: 0.1,
        min: 1, cap: 3, base: 0.8, per: 0.35, interval: 2.6, speed: 560, acc: 0.97, falloff: 0.25, pierce: 0, color: '#ff7a55', kind: 'bolt' },
      { name: 'Torpedo', short: 'torpedo', nick: 'Bertha', label: 'Torpedo', mount: 'fixed', arc: 60,
        min: 5, cap: 6, base: 32, per: 3, interval: 14, pierce: 0.2, color: '#ff3b5c', kind: 'torpedo',
        // Once charged it needs lockT seconds of the target in its arc to lock, then launches by itself.
        // It boosts straight ahead, then chases (speed, turn rad/s) until its fuel runs out and it blows up harmlessly.
        lockT: 4, boost: 1.2, boostSpeed: 190, speed: 120, turn: 1.5, fuel: 11 }
    ],
    alloc: { shields: 4, weapons: 4, engines: 2 },
    ai: { base: { shields: 4, weapons: 4, engines: 2 }, charge: { shields: 1, weapons: 6, engines: 3 }, recover: { shields: 5, weapons: 3, engines: 2 }, skirmish: [14, 20], recoverT: 9 }
  }
};
const SHIP_KEYS = Object.keys(SHIPS);

// ---------- Crew ----------
// Two candidates per station, each with one bonus and one drawback. Modifiers only apply to the player's ship.
const ROLES = ['comms', 'eng', 'wpn', 'pilot'];
const ROLE_NAME = { comms: 'Comms', eng: 'Engineer', wpn: 'Weapons', pilot: 'Pilot' };
const ROLE_COLOR = { comms: 'var(--comms)', eng: 'var(--shield)', wpn: 'var(--weapon)', pilot: 'var(--engine)' };
const CREW = {
  comms: [
    { id: 'tally', name: 'Tally', blurb: 'Narrates every fight like a sports broadcast.',
      plus: 'Full scans: enemy power and exact weapon charge', minus: 'Chatterbox: jumping out takes 1.5 s longer',
      mods: { scan: 'full', jumpDelay: 1.5 }, voice: { base: 620, wave: 'triangle', rate: 16, spread: 0.35, filter: 2400 } },
    { id: 'wren', name: 'Wren', blurb: 'Calm, dry, and very hard to impress.',
      plus: 'Cool head: jump drive charges 15% faster', minus: 'Patchy scans: no enemy power readout or exact charge',
      mods: { scan: 'partial', jump: 1.15 }, voice: { base: 470, wave: 'sine', rate: 10, spread: 0.15, filter: 1800 } }
  ],
  eng: [
    { id: 'fergus', name: 'Fergus', blurb: 'Talks to the shields like an old dog.',
      plus: 'Shields reboot 35% faster', minus: 'By the book: power moves 15% slower',
      mods: { reboot: 1.35, transfer: 0.85 }, voice: { base: 150, wave: 'sawtooth', rate: 9, spread: 0.25, filter: 900 } },
    { id: 'pip', name: 'Pip', blurb: 'Fixes everything with whatever is in reach.',
      plus: 'Power moves 25% faster', minus: 'Rushed patches: shields regenerate 20% slower',
      mods: { transfer: 1.25, regen: 0.8 }, voice: { base: 760, wave: 'square', rate: 18, spread: 0.4, filter: 2600 } }
  ],
  wpn: [
    { id: 'dot', name: 'Dot', blurb: 'Names the big gun and talks to it.',
      plus: 'Big gun hits 15% harder', minus: 'Turret swivels 25% slower',
      mods: { bigDmg: 1.15, traverse: 0.75 }, voice: { base: 330, wave: 'square', rate: 13, spread: 0.3, filter: 1700 } },
    { id: 'rook', name: 'Rook', blurb: 'Deadpan. Has never missed a meal. Or a shot. Mostly.',
      plus: 'Turret hits 8% more often', minus: 'Big gun recharges 15% slower',
      mods: { turretAcc: 0.08, bigInterval: 1.15 }, voice: { base: 190, wave: 'triangle', rate: 8, spread: 0.12, filter: 1200 } }
  ],
  pilot: [
    { id: 'juno', name: 'Juno', blurb: 'Unflappable. Hums while dodging torpedoes.',
      plus: '+5% evasion', minus: 'In no hurry: jump drive charges 20% slower',
      mods: { evade: 0.05, jump: 0.8 }, voice: { base: 250, wave: 'sine', rate: 7, spread: 0.2, filter: 1500 } },
    { id: 'marlow', name: 'Marlow', blurb: 'Flies like everyone is watching.',
      plus: 'Turns 20% sharper, so attack runs line up faster', minus: 'Show-off: 4% less evasion',
      mods: { turn: 1.2, evade: -0.04 }, voice: { base: 380, wave: 'sawtooth', rate: 12, spread: 0.35, filter: 1400 } }
  ]
};
const crewById = id => { for (const r of ROLES) { const c = CREW[r].find(x => x.id === id); if (c) return c; } return null; };

// Combined modifiers for a chosen crew. Multipliers multiply, additive values add.
function crewMods(sel) {
  const m = { reboot: 1, transfer: 1, regen: 1, bigDmg: 1, traverse: 1, turretAcc: 0, bigInterval: 1, evade: 0, jump: 1, turn: 1, jumpDelay: 0, scan: 'full' };
  if (!sel) return m;
  ROLES.forEach(r => {
    const c = crewById(sel[r]); if (!c) return;
    for (const [k, v] of Object.entries(c.mods)) {
      if (k === 'scan') m.scan = v;
      else if (['turretAcc', 'evade', 'jumpDelay'].includes(k)) m[k] += v;
      else m[k] *= v;
    }
  });
  return m;
}

// ---------- Places ----------
const PLACES = {
  fortune: { key: 'fortune', name: 'Fortune Station', kind: 'station', desc: 'Home port. Repairs, upgrades and terrible coffee.', x: 0.2, y: 0.62 },
  kessler: { key: 'kessler', name: 'Kessler Belt', kind: 'rock', desc: 'A broken asteroid belt. Pirates hide among the rocks.', x: 0.74, y: 0.3 },
  rime: { key: 'rime', name: 'Rime Drift', kind: 'ice', desc: 'Frozen shards and ice crystals. Cold, quiet, rarely empty.', x: 0.7, y: 0.8 }
};

// The current run: chosen ship and crew, damage carried between fights, and where we are.
const run = { ship: 'kestrel', crew: { comms: 'tally', eng: 'fergus', wpn: 'dot', pilot: 'juno' }, hull: null, at: 'fortune' };
