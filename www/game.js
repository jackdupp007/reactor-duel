// Built by tools/bundle.py from www/src. Edit the files there, not this one.
(() => {
'use strict';
// ---- 01-core.js ----
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

// ---- 02-sim.js ----
// ---------- Battle simulation ----------
// The fight is worked out on a flat plane: positions, headings, power, shields, shots. Rendering only reads it.

const RANGE = 700;
const SHIP_R = 28;               // collision radius of a ship hull
let P = null, E = null;          // player ship and opponent (in the menu both fly themselves)
let shots = [], parts = [], rocks = [], fieldKind = 'rock';
let stats = { dealt: 0, taken: 0, evaded: 0, bumps: 0 };
let state = 'idle';              // battle sim: 'idle' | 'run' | 'paused'
let time = 0, contact = false, outcome = null, endTimer = 0;

const eff = (s, k) => Math.min(s.actual[k], s.def.parts[k].cap) * s.def.parts[k].eff;
const shieldMax = s => { const e = eff(s, 'shields'); return e < 0.4 ? 0 : 10 + 6 * e; };
const regen = s => (0.8 + 0.3 * eff(s, 'shields')) * s.mods.regen;
const rebootRate = s => (0.6 + 0.15 * eff(s, 'shields')) * s.mods.reboot;
const resist = s => Math.min(0.3, eff(s, 'shields') * 0.05);
const evasion = s => clamp(eff(s, 'engines') * 0.08 + s.mods.evade, 0, 0.6);
const jumpRate = s => eff(s, 'engines') * 0.45 * s.mods.jump;     // % per second
const turnRate = s => (22 + eff(s, 'engines') * 7) * s.mods.turn;  // degrees per second
const distance = () => Math.hypot(P.x - E.x, P.y - E.y);
const inRange = () => distance() <= RANGE;
const weaponOnline = (s, w) => eff(s, 'weapons') >= w.min - 1e-6;
const weaponDmg = (s, w) => w.base + w.per * (Math.min(eff(s, 'weapons'), w.cap) - w.min);
// Turrets traverse faster with spare power: +10% per point above the weapon's minimum.
const traverse = (s, w) => w.traverse * (1 + 0.1 * Math.max(0, Math.min(eff(s, 'weapons'), w.cap) - w.min));
const bearing = (s, foe) => Math.atan2(foe.y - s.y, foe.x - s.x);
const muzzleBase = (s, w) => w.mount === 'turret' ? { x: s.x + Math.cos(s.ang) * w.mountX, y: s.y + Math.sin(s.ang) * w.mountX } : { x: s.x, y: s.y };
const weaponAim = (s, w, i) => w.mount === 'turret' ? s.ang + s.tr[i] : s.ang;
// Unguided accuracy falls off with range and the target's evasion.
const hitChance = (s, w, foe) => clamp(w.acc - (Math.hypot(foe.x - s.x, foe.y - s.y) / RANGE) * w.falloff - evasion(foe), 0.05, 0.98);
const inArc = (s, w, i, foe) => Math.abs(angDiff(bearing(s, foe), weaponAim(s, w, i))) <= (w.arc / 2) * DEG;
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
// Line of fire: blocked if the straight line between the ships passes through an asteroid.
const clearShot = (s, foe) => rocks.every(r => segDist(r.x, r.y, s.x, s.y, foe.x, foe.y) > r.cr * 0.9);
const bigGun = s => s.weapons[1];

function makeShip(key, x, y, crewSel, withBrain) {
  const def = SHIPS[key], m = crewMods(crewSel);
  // Crew bonuses that change a weapon are baked into the ship's own copy of it.
  const weapons = def.weapons.map(w => {
    const c = { ...w };
    if (w.mount === 'fixed') { c.base *= m.bigDmg; c.per *= m.bigDmg; c.interval *= m.bigInterval; }
    else { c.traverse *= m.traverse; c.acc += m.turretAcc; }
    return c;
  });
  const s = {
    key, def, weapons, mods: m, transfer: def.transfer * m.transfer,
    hull: def.hullMax, shield: 0, down: false, downT: 0, sinceHit: 9,
    target: { ...def.alloc }, actual: { ...def.alloc },
    x, y, h: 0, vx: 0, vy: 0, ang: 0, bank: 0, pitchV: 0,
    orbit: rand(0, Math.PI * 2), orbitDir: Math.random() < 0.5 ? 1 : -1, radius: rand(320, 460), retune: rand(6, 12),
    mode: 'orbit', modeT: 0, speed: 60, slipX: 0, slipY: 0, jumping: 0, bumpT: 0, breakX: 0, breakY: 0, runShot: 0,
    wt: weapons.map(() => rand(0, 0.4)), tr: weapons.map(() => 0),
    lock: weapons.map(() => 0), burst: weapons.map(() => 0), burstT: weapons.map(() => 0),
    yawV: 0, jolt: null, dmgFx: 0,
    flash: 0, spool: 0, dead: false, trail: [], warp: 0, hidden: false, manual: false,
    brain: withBrain ? { phase: 'skirmish', t: rand(def.ai.skirmish[0] - 4, def.ai.skirmish[1] - 6) } : null
  };
  if (withBrain) { s.target = { ...def.ai.base }; s.actual = { ...def.ai.base }; }
  s.shield = shieldMax(s);
  return s;
}

// ---------- Battlefield: asteroids ----------
// r = visual radius, cr = collision radius. Starting spots and room to fly between rocks are kept clear.
const FIELD_KINDS = { rock: ['rock-1', 'rock-2'], ice: ['ice-2', 'ice-crystal'] };
function makeField(kind) {
  fieldKind = kind;
  rocks = [];
  const kinds = FIELD_KINDS[kind];
  const add = (k, r) => {
    for (let t = 0; t < 80; t++) {
      const x = rand(-1150, 1150), y = rand(-760, 760);
      if (Math.hypot(x + 1300, y - 220) < r + 300 || Math.hypot(x - 1300, y + 220) < r + 300) continue;
      if (rocks.some(o => Math.hypot(o.x - x, o.y - y) < o.r + r + 160)) continue;
      rocks.push({ kind: k, x, y, r, cr: r * 0.8, rx: rand(0, 6.28), ry: rand(0, 6.28), rz: rand(0, 6.28), spin: rand(-0.15, 0.15) });
      return;
    }
  };
  if (kind === 'rock') add('rock-industrial', rand(115, 145));
  else add('ice-crystal', rand(120, 150));
  for (let i = 0; i < 10; i++) add(pick(kinds), rand(48, 100));
}

// A fresh fight. opts: field kind, whether the player flies itself (menu), carried-over hull.
function newBattle(pKey, eKey, opts) {
  opts = opts || {};
  if (shots) shots.forEach(p => disposeShot(p));
  P = makeShip(pKey, -1300, 220, opts.auto ? null : run.crew, !!opts.auto);
  E = makeShip(eKey, 1300, -220, null, true);
  P.ang = Math.atan2(E.y - P.y, E.x - P.x); E.ang = P.ang + Math.PI;
  P.orbitDir = 1; E.orbitDir = -1;
  if (opts.hull != null) P.hull = Math.min(P.def.hullMax, opts.hull);
  shots = []; parts = [];
  stats = { dealt: 0, taken: 0, evaded: 0, bumps: 0 };
  endTimer = 0; outcome = null; time = 0; contact = false;
  makeField(opts.field || pick(['rock', 'ice']));
  if (GL) { buildShips(); buildRockVis(); }
}

// ---------- Power transfer ----------
function updatePower(s, dt) {
  const rate = s.transfer * dt;
  SYS.forEach(k => { if (s.actual[k] > s.target[k]) s.actual[k] = Math.max(s.target[k], s.actual[k] - rate); });
  let free = s.def.reactor - SYS.reduce((a, k) => a + s.actual[k], 0);
  SYS.forEach(k => {
    if (s.actual[k] < s.target[k] && free > 0) {
      const inc = Math.min(s.target[k] - s.actual[k], rate, free);
      s.actual[k] += inc; free -= inc;
    }
  });
}

function adjust(k, d) {
  if (!P || P.brain || (state !== 'run' && state !== 'paused')) return;
  const T = P.target, sum = T.shields + T.weapons + T.engines;
  if (d > 0) {
    if (sum >= P.def.reactor) { nudge('No free power. Lower another system first.'); flashReactor(); SFX.deny(); return; }
    if (T[k] >= P.def.reactor) return;
    T[k]++;
    if (T[k] > P.def.parts[k].cap) nudge(`${P.def.parts[k].name} can't use more than ${P.def.parts[k].cap}`);
    SFX.click(true);
  } else {
    if (T[k] <= 0) return;
    T[k]--;
    SFX.click(false);
  }
}

// ---------- Shields ----------
function updateShields(s, dt) {
  const mx = shieldMax(s), e = eff(s, 'shields');
  s.sinceHit += dt;
  s.flash = Math.max(0, s.flash - dt * 2.5);
  if (s.down) {
    if (e >= 0.4) s.downT -= dt * rebootRate(s);
    if (s.downT <= 0) {
      s.downT = 0; s.down = false; s.shield = mx * 0.3;
      crewEvent(s === P ? 'pShieldsUp' : 'eShieldsUp');
    }
  } else {
    if (s.shield > mx) s.shield = Math.max(mx, s.shield - dt * 12);
    else if (s.sinceHit > 2.5) s.shield = Math.min(mx, s.shield + regen(s) * dt);
  }
}

// ---------- Weapons: charge, track, fire when in arc with a clear line ----------
// Bursts (autocannon) fire their rounds a short gap apart. Torpedoes, once charged, build a lock while the target
// stays in their arc, and launch by themselves when the lock completes.
function updateWeapons(s, foe, dt) {
  if (s.dead || s.warp > 0) return;
  const close = inRange() && !foe.dead && foe.warp === 0 && !foe.hidden;
  s.weapons.forEach((w, i) => {
    const online = weaponOnline(s, w);
    if (w.mount === 'turret' && online) {
      const want = angDiff(bearing(s, foe), s.ang);
      const step = traverse(s, w) * DEG * dt;
      s.tr[i] += clamp(angDiff(want, s.tr[i]), -step, step);
      s.tr[i] = angDiff(s.tr[i], 0);
    }
    if (!online) {
      s.wt[i] = Math.max(0, s.wt[i] - dt * (w.kind === 'torpedo' ? 0.4 : 0.15)); // unpowered weapons hold most of their charge
      s.lock[i] = Math.max(0, s.lock[i] - dt / 2); s.burst[i] = 0;
      return;
    }
    const ready = () => close && inArc(s, w, i, foe) && clearShot(s, foe);
    if (s.burst[i] > 0) {                                     // rest of a burst
      s.burstT[i] -= dt;
      if (s.burstT[i] <= 0) {
        if (ready()) { fire(s, foe, w, i); s.burst[i]--; s.burstT[i] = w.gap; }
        else s.burst[i] = 0;
      }
      return;
    }
    s.wt[i] = Math.min(w.interval, s.wt[i] + dt);
    if (s.wt[i] < w.interval) return;
    if (w.kind === 'torpedo') {
      const was = s.lock[i];
      s.lock[i] = ready() ? Math.min(1, s.lock[i] + dt / w.lockT) : Math.max(0, s.lock[i] - dt / (w.lockT * 0.75));
      if (was === 0 && s.lock[i] > 0 && s === E) crewEvent('enemyLock');
      if (s.lock[i] >= 1) { s.lock[i] = 0; s.wt[i] = 0; fire(s, foe, w, i); }
      return;
    }
    if (ready()) {
      s.wt[i] = 0;
      if (w.burst) { s.burst[i] = w.burst - 1; s.burstT[i] = w.gap; }
      fire(s, foe, w, i);
    }
  });
}

function weaponStatus(s, w, i, foe) {
  if (!weaponOnline(s, w)) return { text: `needs ${w.min}`, off: true };
  if (s.burst[i] > 0) return { text: 'firing' };
  if (s.wt[i] < w.interval) return { text: `charging ${Math.floor(s.wt[i] / w.interval * 100)}%` };
  if (!inRange()) return { text: 'out of range' };
  if (!clearShot(s, foe)) return { text: 'blocked' };
  if (!inArc(s, w, i, foe)) return { text: w.mount === 'turret' ? 'tracking' : 'lining up' };
  if (w.kind === 'torpedo') return { text: `locking ${Math.floor(s.lock[i] * 100)}%` };
  return { text: 'firing' };
}

function fire(s, foe, w, i) {
  const dmg = weaponDmg(s, w);
  const a0 = weaponAim(s, w, i);
  const mb = muzzleBase(s, w), reach = w.mount === 'turret' ? 7 : 30;
  const ox = mb.x + Math.cos(a0) * reach, oy = mb.y + Math.sin(a0) * reach;
  burst(ox, oy, w.burst ? 3 : 5, w.color, 70);
  let p;
  if (w.kind === 'torpedo') {
    // Guided, but physical: it hits only if it actually reaches the target before its fuel runs out.
    p = { x: ox, y: oy, src: s, tgt: foe, w, dmg, life: w.fuel, age: 0, homing: true, trail: [] };
    p.vx = Math.cos(a0) * w.boostSpeed; p.vy = Math.sin(a0) * w.boostSpeed;
    burst(ox, oy, 14, '#ffd0a0', 120);
    stats.torps = (stats.torps || 0) + 1;
  } else {
    // Unguided: aim at where the target will be; a miss is aimed deliberately to one side. Flight is a straight line.
    const hit = Math.random() < hitChance(s, w, foe);
    let lx = foe.x, ly = foe.y;
    for (let k = 0; k < 2; k++) { const tt = Math.hypot(lx - ox, ly - oy) / w.speed; lx = foe.x + foe.vx * tt; ly = foe.y + foe.vy * tt; }
    let a = Math.atan2(ly - oy, lx - ox);
    if (!hit) a += Math.atan2((Math.random() < 0.5 ? -1 : 1) * rand(42, 80), Math.hypot(lx - ox, ly - oy));
    p = { x: ox, y: oy, src: s, tgt: foe, w, dmg, hit, life: (RANGE * 1.5) / w.speed, age: 0, homing: false, minD: 1e9, passed: false, trail: [] };
    p.vx = Math.cos(a) * w.speed; p.vy = Math.sin(a) * w.speed;
  }
  shots.push(p);
  s.muzzle = 1;
  SFX.shot(w.kind, s === P, ox, oy);
  if (w.kind === 'rail') { camShake(4); if (s === P) buzz('light'); }
  if (w.mount === 'fixed') {
    if (s === E) crewEvent('inBigLaunch');
    if (s.brain) { s.brain.phase = 'recover'; s.brain.t = s.def.ai.recoverT; s.target = { ...s.def.ai.recover }; }
  }
}

function evaded(t, p) {
  if (p.w.burst) { if (time - (t.evTick || -9) < 1) return; t.evTick = time; }   // one "evaded" per burst is plenty
  hudTick(t === P ? 'p' : 'e', 'evade', 'evaded');
  if (t === P) { stats.evaded++; if (p.w.mount === 'fixed') crewEvent('inBigEvaded'); }
  if (p.src === P && p.w.mount === 'fixed') crewEvent('bigMiss');
}

function updateShots(dt) {
  for (const p of shots) {
    p.life -= dt; p.age += dt;
    const t = p.tgt;
    const alive = !t.dead && t.warp === 0;
    if (p.w.kind === 'torpedo') {
      // Boost straight out, then ease down to cruise speed and chase with a limited turn rate.
      const cur = Math.atan2(p.vy, p.vx), w = p.w;
      let na = cur, sp = w.boostSpeed;
      if (p.age > w.boost) {
        sp = w.speed + (w.boostSpeed - w.speed) * Math.exp(-(p.age - w.boost) * 3);
        if (alive) na = cur + clamp(angDiff(Math.atan2(t.y - p.y, t.x - p.x), cur), -w.turn * dt, w.turn * dt);
      }
      p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.trail.push(p.x, p.y); if (p.trail.length > 40) p.trail.splice(0, 2);
      if (Math.random() < dt * 14) smoke(p.x - p.vx * 0.03, p.y - p.vy * 0.03, 1, 0.5);
      const hitRock = rocks.find(r => Math.hypot(p.x - r.x, p.y - r.y) < r.cr);
      if (hitRock) { rockHit(p, hitRock); continue; }
      if (alive && Math.hypot(t.x - p.x, t.y - p.y) < SHIP_R) { stats.torpHit = (stats.torpHit || 0) + 1; applyDamage(t, p.dmg, w.pierce, p); p.life = 0; continue; }
      if (p.life <= 0) torpFizzle(p, alive);
      continue;
    }
    const ax = p.x, ay = p.y;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const hitRock = rocks.find(r => segDist(r.x, r.y, ax, ay, p.x, p.y) < r.cr);
    if (hitRock) { rockHit(p, hitRock); continue; }
    if (!alive) continue;
    const d = segDist(t.x, t.y, ax, ay, p.x, p.y);
    if (d < 26) { applyDamage(t, p.dmg, p.w.pierce, p); p.life = 0; continue; }
    if (d < p.minD) p.minD = d;
    else if (!p.passed) { p.passed = true; if (p.minD < 90) evaded(t, p); }
  }
  shots = shots.filter(p => { if (p.life > 0) return true; disposeShot(p); return false; });
}

// Out of fuel: the torpedo blows itself up, harmlessly.
function torpFizzle(p, alive) {
  stats.torpFizz = (stats.torpFizz || 0) + 1;
  impact(p.x, p.y, 1, null);
  SFX.boom(true, p.x, p.y);
  if (alive) evaded(p.tgt, p);
}

// A shot strikes an asteroid: sparks and rock dust, and the shot is spent.
function rockHit(p, r) {
  const big = p.w.kind !== 'bolt';
  const rockCol = fieldKind === 'ice' ? '#bfe6ff' : '#8d8a86';
  if (p.w.kind === 'torpedo') impact(p.x, p.y, 1.2, rockCol);
  else if (big) impact(p.x, p.y, 0.6, rockCol);
  else { burst(p.x, p.y, 8, p.w.color, 110); burst(p.x, p.y, 4, rockCol, 90); }
  p.life = 0;
  SFX.rock(big, p.x, p.y);
  if (p.w.kind === 'torpedo') { camShake(5); if (p.tgt === P) crewEvent('torpRock'); }
}

function applyDamage(t, dmg, pierce, p) {
  let hullD = 0, shD = 0;
  const shielded = t.shield > 0 && !t.down;
  if (shielded) {
    const r = resist(t);
    const sPart = dmg * (1 - pierce) * (1 - r);
    hullD = dmg * pierce;
    shD = Math.min(sPart, t.shield);
    if (sPart >= t.shield) {
      hullD += (sPart - t.shield) / (1 - r);
      t.shield = 0; t.down = true; t.downT = 9;
      crewEvent(t === P ? 'pShieldsDown' : 'eShieldsDown');
    } else t.shield -= sPart;
    t.flash = 1;
  } else hullD = dmg;
  t.hull = Math.max(0, t.hull - hullD);
  t.sinceHit = 0;
  if (t === P) stats.taken += hullD; else stats.dealt += dmg;
  const big = p.w.mount === 'fixed';
  if (shielded && hullD < 0.5) burst(p.x, p.y, big ? 30 : 6, C.shield, big ? 240 : 120);
  else if (big) impact(p.x, p.y, p.w.kind === 'torpedo' ? 2.2 : 1.6, null, p.vx, p.vy);
  else if (p.w.kind === 'ram') impact(p.x, p.y, 0.5, null);
  else { burst(p.x, p.y, 10, '#ffcf9e', 200); sparks(p.x, p.y, 10, 1); smoke(p.x, p.y, 2, 0.7); }
  if (shielded && hullD >= 0.5) burst(p.x, p.y, 10, C.shield, 160);
  if (big) knock(t, p, shielded && hullD < 0.5 ? 0.45 : 1);
  const who = t === P ? 'p' : 'e';
  if (shD > 0.2) hudTick(who, 'sh', shD);
  if (hullD > 0.2) hudTick(who, 'hull', hullD);
  SFX.hit(shielded && hullD < 0.5, t === P, p.x, p.y);
  if (big && t === P) { camShake(p.w.kind === 'torpedo' ? 12 : 9); crewEvent('inBigHit'); buzz('heavy'); }
  else if (big) camShake(4);
  if (p.w.kind === 'ram' && t === P) buzz('medium');
  if (p.src === P && p.w.mount === 'fixed') crewEvent('bigHit');
  if (p.w.kind === 'ram') camShake(6);
  if (t.hull <= 0 && !t.dead) kill(t);
}

// A heavy hit shoves the ship along the shot's path and spins it, harder the further off-centre the hit lands.
function knock(t, p, k) {
  const v = Math.hypot(p.vx, p.vy) || 1, dx = p.vx / v, dy = p.vy / v;
  const kick = (p.w.kind === 'torpedo' ? 1.2 : 0.9) * k;
  t.slipX += dx * 110 * kick; t.slipY += dy * 110 * kick;
  const rx = p.x - t.x, ry = p.y - t.y, off = clamp((rx * dy - ry * dx) / 22, -1, 1);   // which side of centre it struck
  const spin = (Math.abs(off) < 0.15 ? (Math.random() < 0.5 ? -0.3 : 0.3) : off) * 1.9 * kick;
  t.yawV += spin;
  t.jolt = { r: clamp(-off, -1, 1) * 0.45 * kick, p: 0.18 * kick, t: 0 };
}

function kill(s) {
  s.dead = true;
  for (let i = 0; i < 4; i++) setTimeout(() => impact(s.x + rand(-14, 14), s.y + rand(-14, 14), 1, null), i * 160);
  if (s === P) buzz('death');
  camShake(14);
  SFX.boom(false, s.x, s.y);
  crewEvent(s === P ? 'lose' : 'win');
  outcome = s === P ? 'lose' : 'win';
  endTimer = 2.4;
}

function jink(s) {
  if (s.dead || s.warp > 0) return;
  const e = eff(s, 'engines');
  const a = s.ang + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
  const imp = 50 + e * 10;
  s.slipX += Math.cos(a) * imp; s.slipY += Math.sin(a) * imp;
}

// ---------- Effects particles ----------
// Each particle: position (x, h, y), velocity, life, size, colour, and a type that decides how it is drawn:
//   glow  - additive dot (muzzle flash, shield fizz, general sparks)
//   spark - additive streak that falls and fades fast
//   ember - slow, bright, long-lived floating spark
//   fire  - additive puff that grows and goes from yellow to red
//   smoke - dark puff that grows and fades slowly
//   debris- dark chunk tumbling out
function burst(x, y, n, color, sp) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), v = rand(sp * 0.2, sp);
    parts.push({ k: 'glow', x, y, h: rand(-4, 6), vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: 0, life: rand(0.3, 0.8), max: 0.8, size: 2, color });
  }
}
function sparks(x, y, n, k) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), v = rand(90, 460) * k;
    parts.push({ k: 'spark', x, y, h: rand(0, 8), vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: rand(20, 160) * k, life: rand(0.25, 0.7), max: 0.7, size: rand(2, 3.6), color: pick(['#fff3d6', '#ffd27a', '#ffb15c']) });
  }
}
function smoke(x, y, n, k) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), v = rand(8, 40) * k, life = rand(1.2, 2.6) * (0.6 + k * 0.4);
    parts.push({ k: 'smoke', x: x + rand(-4, 4), y: y + rand(-4, 4), h: rand(4, 12), vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: rand(6, 22), life, max: life, size: rand(12, 20) * (0.6 + k * 0.5), grow: rand(14, 28) * k, color: '#77726c' });
  }
}
// A big hit: a flash, a fireball, sparks, embers, debris and a rolling cloud of smoke. dirX/dirY tilt the spray along the shot.
function impact(x, y, k, debrisCol, dirX, dirY) {
  const v = Math.hypot(dirX || 0, dirY || 0) || 1, bx = (dirX || 0) / v, by = (dirY || 0) / v;
  burst(x, y, Math.round(26 * k), '#fff3d6', 260 * k);
  sparks(x, y, Math.round(40 * k), k);
  for (let i = 0; i < 14 * k; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(10, 70) * k, life = rand(0.4, 0.9);
    parts.push({ k: 'fire', x, y, h: rand(0, 10), vx: Math.cos(a) * sp + bx * 40, vy: Math.sin(a) * sp + by * 40, vh: rand(5, 30), life, max: life, size: rand(14, 26) * k, grow: 40 * k, color: '#ffb35a' });
  }
  for (let i = 0; i < 12 * k; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(30, 120) * k, life = rand(1.4, 3);
    parts.push({ k: 'ember', x, y, h: rand(0, 10), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vh: rand(0, 40), life, max: life, size: rand(1.8, 3), color: '#ff9a3c' });
  }
  for (let i = 0; i < 10 * k; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(60, 220) * k, life = rand(1.2, 2.4);
    parts.push({ k: 'debris', x, y, h: rand(0, 10), vx: Math.cos(a) * sp + bx * 80, vy: Math.sin(a) * sp + by * 80, vh: rand(-20, 80), life, max: life, size: rand(2.5, 5), color: debrisCol || pick(['#4a4f58', '#2e3238', '#6b6258']) });
  }
  smoke(x, y, Math.round(12 * k), k);
  if (GL) { GL.flash.position.set(x, 50, y); GL.flash.intensity = Math.max(GL.flash.intensity, 3 * k); }
}

// Phone buzz on big moments: the native haptics plugin in the app, the browser's vibrate otherwise.
let hapt;
function buzz(kind) {
  if (reduceMotion) return;
  try {
    if (hapt === undefined) {
      const cap = window.Capacitor;
      hapt = (cap && cap.isNativePlatform && cap.isNativePlatform() && ((cap.Plugins && cap.Plugins.Haptics) || (cap.registerPlugin && cap.registerPlugin('Haptics')))) || null;
    }
    const ms = { light: 25, medium: 60, heavy: 160, death: 450 }[kind] || 40;
    if (hapt) {
      if (kind === 'light') hapt.impact({ style: 'LIGHT' });
      else hapt.vibrate({ duration: ms });
    } else if (navigator.vibrate) navigator.vibrate(kind === 'death' ? [200, 80, 250] : kind === 'heavy' ? [90, 40, 70] : ms);
  } catch (e) { /* no vibration on this device */ }
}

// ---------- Piloting ----------
// Three modes:
//   orbit - circle the enemy at a chosen radius, now and then switching direction and radius.
//   run   - the big gun (rail, torpedo) is nearly charged: slow down, swing the nose onto the enemy and hold it there until it fires.
//   break - after the shot (or if the run gets too close), fly clear for a few seconds before circling again.
// Rocks: if one blocks the way, aim for its edge and keep to that side until clear. Turn rate (engine power) limits how fast the nose swings.
function shouldRun(s, other) {
  const w = bigGun(s);
  if (!weaponOnline(s, w) || !contact || other.dead) return false;
  const remaining = w.interval - s.wt[1] + (w.lockT ? (1 - s.lock[1]) * w.lockT * 0.5 : 0);
  const swing = Math.abs(angDiff(bearing(s, other), s.ang)) / (turnRate(s) * DEG * 0.8);
  return remaining <= swing + 1.5 && Math.hypot(other.x - s.x, other.y - s.y) > 260;
}

function updateMove(s, other, dt) {
  const e = eff(s, 'engines');
  if (s.manual) return;                                  // cutscenes drive the ship directly
  if (s.warp > 0) {
    s.warp += dt;
    const sp = 300 + s.warp * 2400;
    s.vx = Math.cos(s.ang) * sp; s.vy = Math.sin(s.ang) * sp;
    s.x += s.vx * dt; s.y += s.vy * dt;
    return;
  }
  if (s.dead) { s.vx *= 0.98; s.vy *= 0.98; s.x += s.vx * dt; s.y += s.vy * dt; s.ang += dt * 0.8; return; }
  s.bumpT = Math.max(0, s.bumpT - dt);

  const d2o = Math.hypot(other.x - s.x, other.y - s.y);
  const w = bigGun(s), online = weaponOnline(s, w);
  s.modeT -= dt;
  if (s.mode === 'orbit' && shouldRun(s, other)) { s.mode = 'run'; s.modeT = 14; s.runShot = s.wt[1]; }
  if (s.mode === 'run') {
    const fired = !online || s.wt[1] < s.runShot - 0.5;     // charge dropped back: the shot went off
    s.runShot = Math.max(s.runShot, s.wt[1]);
    if (fired || d2o < 170 || s.modeT <= 0 || other.dead) {
      s.mode = 'break'; s.modeT = rand(2.5, 3.5);
      const away = bearing(other, s) + rand(-0.5, 0.5);
      s.breakX = other.x + Math.cos(away) * 700; s.breakY = other.y + Math.sin(away) * 700;
    }
  }
  if (s.mode === 'break' && s.modeT <= 0) { s.mode = 'orbit'; s.orbit = Math.atan2(s.y - other.y, s.x - other.x); s.radius = rand(340, 460); }

  let gx, gy, speedK = 1;
  const torp = shots.find(p => p.w.kind === 'torpedo' && p.tgt === s && p.life > 0);
  if (torp && s.mode !== 'run') {
    // A torpedo is chasing us: run straight away from it. Enough engine power and it runs out of fuel first.
    const d = Math.hypot(s.x - torp.x, s.y - torp.y) || 1;
    gx = s.x + (s.x - torp.x) / d * 600; gy = s.y + (s.y - torp.y) / d * 600;
    if (Math.hypot(gx, gy) > 1500) { gx -= gx * 0.6; gy -= gy * 0.6; }
    steer(s, gx, gy, other, 1.15, dt);
    return;
  }
  if (s.mode === 'run') {
    const lead = d2o / w.speed;                              // aim at where the enemy will be when the shot arrives
    gx = other.x + other.vx * lead; gy = other.y + other.vy * lead;
    speedK = 0.7;                                            // slower = tighter turns while lining up
  } else if (s.mode === 'break') {
    gx = s.breakX; gy = s.breakY; speedK = 1.1;
  } else {
    s.retune -= dt;
    if (s.retune <= 0) { s.retune = rand(7, 12); if (Math.random() < 0.4) s.orbitDir *= -1; s.radius = rand(320, 460); }
    s.orbit += dt * (0.12 + e * 0.03) * s.orbitDir;
    gx = other.x + Math.cos(s.orbit) * s.radius;
    gy = other.y + Math.sin(s.orbit) * s.radius;
  }
  if (Math.hypot(s.x, s.y) > 1400) { gx -= s.x * 0.5; gy -= s.y * 0.5; }
  steer(s, gx, gy, other, speedK, dt);
}

// Point the ship toward (gx, gy), going around rocks and keeping a little room from the other ship.
function steer(s, gx, gy, other, speedK, dt) {
  const e = eff(s, 'engines');
  const dl = Math.hypot(gx - s.x, gy - s.y) || 1;
  let head = Math.atan2(gy - s.y, gx - s.x), block = null, bestD = Infinity;
  for (const r of rocks) {
    const clear = r.cr + SHIP_R + 45, dr = Math.hypot(r.x - s.x, r.y - s.y);
    if (dr > dl + clear || dr >= bestD) continue;
    if (segDist(r.x, r.y, s.x, s.y, gx, gy) < clear) { block = r; bestD = dr; }
  }
  if (block) {
    const clear = block.cr + SHIP_R + 45, toRock = Math.atan2(block.y - s.y, block.x - s.x);
    if (s.avoidRock !== block) {
      s.avoidRock = block;
      const gs = angDiff(head, toRock);
      s.avoidSide = Math.abs(gs) > 0.05 ? Math.sign(gs) : (angDiff(s.ang, toRock) >= 0 ? 1 : -1);
    }
    head = toRock + s.avoidSide * (bestD > clear ? Math.asin(clear / bestD) + 0.08 : Math.PI / 2 + 0.35);
  } else s.avoidRock = null;
  let ax = Math.cos(head), ay = Math.sin(head);
  if (other && !other.dead && !other.hidden) {
    const rx = s.x - other.x, ry = s.y - other.y, d = Math.hypot(rx, ry) || 1, reach = s.mode === 'run' ? 140 : 230;
    if (d < reach) { const k = Math.pow(1 - d / reach, 2) * 2.2; ax += (rx / d) * k; ay += (ry / d) * k; }
  }
  const tr = turnRate(s) * DEG;
  const desired = Math.atan2(ay, ax);
  const da = angDiff(desired, s.ang);
  const turn = clamp(da, -tr * dt, tr * dt);
  s.ang = angDiff(s.ang + turn, 0);
  const targetSpeed = speedK * (55 + e * 16) * (Math.abs(da) > 1.6 ? 0.7 : 1);
  s.speed += (targetSpeed - s.speed) * Math.min(1, dt * 0.8);
  integrate(s, dt);
  s.bank += (clamp(turn / Math.max(1e-6, tr * dt), -1, 1) * 0.7 - s.bank) * Math.min(1, dt * 3);
}
function integrate(s, dt) {
  if (s.yawV) {                                              // spin from a heavy hit, which the pilot fights back out of
    s.ang = angDiff(s.ang + s.yawV * dt, 0);
    s.yawV *= Math.exp(-dt * 2.2);
    if (Math.abs(s.yawV) < 0.01) s.yawV = 0;
  }
  const slipDecay = Math.exp(-dt * 1.5);
  s.slipX *= slipDecay; s.slipY *= slipDecay;
  s.vx = Math.cos(s.ang) * s.speed + s.slipX;
  s.vy = Math.sin(s.ang) * s.speed + s.slipY;
  s.x += s.vx * dt; s.y += s.vy * dt;
  s.muzzle = Math.max(0, (s.muzzle || 0) - dt * 4);
  s.trail.push(s.x - Math.cos(s.ang) * 30, s.y - Math.sin(s.ang) * 30);
  if (s.trail.length > 56) s.trail.splice(0, 2);
}

// ---------- Collisions ----------
// Ships bounce off asteroids and each other. The bounce goes into the sideways "slip" velocity, so the ship slides back
// with its nose unchanged and the pilot steers away. Damage scales with the closing speed; shields take part of it.
function ram(t, dmg, x, y) {
  if (state !== 'run' || dmg <= 0 || t.dead || t.warp > 0) return;
  applyDamage(t, dmg, 0.4, { x, y, w: { kind: 'ram', mount: 'none' }, src: null });
}
function collisions() {
  for (const s of [P, E]) {
    if (!s || s.dead || s.warp > 0 || s.hidden) continue;
    for (const r of rocks) {
      const dx = s.x - r.x, dy = s.y - r.y, d = Math.hypot(dx, dy) || 1, min = r.cr + SHIP_R;
      if (d >= min) continue;
      const nx = dx / d, ny = dy / d;
      s.x = r.x + nx * min; s.y = r.y + ny * min;
      const vn = s.vx * nx + s.vy * ny;                        // negative when moving into the rock
      if (vn < 0) { s.slipX -= nx * vn * 1.6; s.slipY -= ny * vn * 1.6; s.speed *= 0.45; }
      if (vn < -10 && s.bumpT <= 0) {
        s.bumpT = 0.6;
        const cx = r.x + nx * r.cr, cy = r.y + ny * r.cr;
        burst(cx, cy, 18, '#ffcf9e', 160); burst(cx, cy, 10, fieldKind === 'ice' ? '#bfe6ff' : '#8d8a86', 80);
        SFX.bump(-vn, cx, cy);
        ram(s, (-vn - 10) * 0.12, cx, cy);
        if (state === 'run') { if (s === P) { stats.bumps++; crewEvent('bumpRock'); } else crewEvent('enemyRock'); }
      }
    }
  }
  if (!P || !E || P.dead || E.dead || P.warp > 0 || E.warp > 0 || P.hidden || E.hidden) return;
  const dx = P.x - E.x, dy = P.y - E.y, d = Math.hypot(dx, dy) || 1, min = SHIP_R * 2;
  if (d >= min) return;
  const nx = dx / d, ny = dy / d, push = (min - d) / 2;
  P.x += nx * push; P.y += ny * push; E.x -= nx * push; E.y -= ny * push;
  const vrel = (P.vx - E.vx) * nx + (P.vy - E.vy) * ny;       // negative when closing
  if (vrel < 0) {
    P.slipX -= nx * vrel * 0.9; P.slipY -= ny * vrel * 0.9; E.slipX += nx * vrel * 0.9; E.slipY += ny * vrel * 0.9;
    P.speed *= 0.5; E.speed *= 0.5;
  }
  if (vrel < -10 && P.bumpT <= 0) {
    P.bumpT = E.bumpT = 0.8;
    const cx = (P.x + E.x) / 2, cy = (P.y + E.y) / 2;
    burst(cx, cy, 30, '#ffd7a0', 220);
    SFX.bump(-vrel * 1.4, cx, cy);
    ram(P, (-vrel - 10) * 0.1, cx, cy); ram(E, (-vrel - 10) * 0.1, cx, cy);
    if (state === 'run') { stats.bumps++; crewEvent('bumpShip'); }
  }
}

// ---------- Ship brains (the enemy, and both ships on the menu) ----------
// skirmish: everyday power split. charge: pull power into the big gun (shields go thin). recover: back into shields after it fires.
function updateBrain(s, dt) {
  const b = s.brain;
  if (!b || s.dead || !contact) return;
  b.t -= dt;
  if (b.phase === 'skirmish' && b.t <= 0) {
    b.phase = 'charge'; s.target = { ...s.def.ai.charge };
    if (s === E) crewEvent('enemyCharge');
  } else if (b.phase === 'recover' && b.t <= 0) {
    b.phase = 'skirmish'; b.t = rand(...s.def.ai.skirmish); s.target = { ...s.def.ai.base };
  }
}

// ---------- Jump drive: charges with engine power; the "Get us out of here" order starts a short countdown ----------
function updateJump(dt) {
  if (P.dead || P.warp > 0) return;
  if (P.jumping > 0) {
    P.jumping -= dt;
    if (P.jumping <= 0) {
      P.jumping = 0; P.warp = 0.01; outcome = 'escaped'; endTimer = 1.2;
      burst(P.x, P.y, 24, C.engine, 260);
      SFX.warp();
    }
    return;
  }
  const r = jumpRate(P);
  if (r > 0.02) P.spool = Math.min(100, P.spool + dt * r);
  else P.spool = Math.max(0, P.spool - dt * 0.5);
}

// ---------- One battle tick ----------
function battleTick(dt) {
  time += dt;
  if (!contact && inRange()) { contact = true; crewEvent('inRange'); }
  updatePower(P, dt); updatePower(E, dt);
  updateBrain(P, dt); updateBrain(E, dt);
  updateShields(P, dt); updateShields(E, dt);
  updateWeapons(P, E, dt); updateWeapons(E, P, dt);
  updateShots(dt);
  if (!P.brain) updateJump(dt);
}

function updateFx(dt) {
  const f = Math.pow(0.96, dt * 60), fs = Math.pow(0.985, dt * 60);
  for (const q of parts) {
    q.life -= dt;
    const drag = q.k === 'smoke' || q.k === 'debris' || q.k === 'ember' ? fs : f;
    q.x += q.vx * dt; q.y += q.vy * dt; q.h += (q.vh || 0) * dt;
    q.vx *= drag; q.vy *= drag;
    if (q.k === 'spark' || q.k === 'debris') q.vh -= 140 * dt;
    else if (q.vh) q.vh *= drag;
    if (q.grow) q.size += q.grow * dt;
  }
  parts = parts.filter(q => q.life > 0);
  if (parts.length > 2400) parts.splice(0, parts.length - 2400);
  [P, E].forEach(s => { if (s && !s.hidden && !s.blown && s.warp === 0) damageFx(s, dt); });
}
// Damage shows on the hull as it builds up: smoke from about a quarter down, sparks past half, flames when it's nearly gone.
function damageFx(s, dt) {
  const d = 1 - s.hull / s.def.hullMax;
  s.dmgFx += (d - s.dmgFx) * Math.min(1, dt * 2);
  if (d < 0.22) return;
  const side = Math.random() < 0.5 ? -1 : 1, back = rand(-22, 10);
  const px = s.x + Math.cos(s.ang) * back - Math.sin(s.ang) * side * rand(0, 12), py = s.y + Math.sin(s.ang) * back + Math.cos(s.ang) * side * rand(0, 12);
  if (Math.random() < dt * (5 + d * 22)) smoke(px, py, 1, 0.5 + d * 0.6);
  if (d > 0.45 && Math.random() < dt * (d * 7)) sparks(px, py, 5, 0.6);
  if (d > 0.75 && Math.random() < dt * 8) {
    const life = rand(0.3, 0.6);
    parts.push({ k: 'fire', x: px, y: py, h: rand(8, 14), vx: rand(-10, 10), vy: rand(-10, 10), vh: rand(10, 30), life, max: life, size: rand(7, 12), grow: 16, color: '#ff9a3c' });
  }
}

// ---- 03-audio.js ----
// ---------- Sound ----------
// Every effect is built from oscillators and filtered noise with Web Audio, so no files are needed yet.
// Each effect is one function here; swapping one for a recorded sound later only means changing that function.
const SFX = (() => {
  let ctx = null, master = null, noiseBuf = null;
  let muted = store.get('muted', false);
  const recent = {};                                      // light rate-limiting per sound

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 4;
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.55;
      master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function limit(key, gap) {
    const now = performance.now();
    if (recent[key] && now - recent[key] < gap) return false;
    recent[key] = now; return true;
  }
  // Pan and volume from where a sound happens relative to the camera's view (battle sounds only).
  function place(x, y) {
    if (x === undefined || !GL) return { pan: 0, vol: 1 };
    const v = new THREE.Vector3(x, 0, y).project(GL.camera);
    const off = Math.max(0, Math.hypot(v.x, v.y) - 1);
    return { pan: clamp(v.x * 0.6, -0.8, 0.8), vol: clamp(1 - off * 0.6, 0.25, 1) };
  }
  function out(vol, pan) {
    const g = ctx.createGain(); g.gain.value = 0;
    let node = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan || 0; g.connect(p); p.connect(master); }
    else g.connect(master);
    return node;
  }
  // A pitched blip: wave, start/end frequency, length, volume, optional filter.
  function tone(o) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + (o.delay || 0), dur = o.dur || 0.2;
    const osc = ctx.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
    const g = out(o.vol, o.pan);
    const a = o.attack || 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol || 0.2), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let src = osc;
    if (o.filter) { const f = ctx.createBiquadFilter(); f.type = o.ftype || 'lowpass'; f.frequency.value = o.filter; f.Q.value = o.q || 1; osc.connect(f); src = f; }
    src.connect(g);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  // A burst of filtered noise, for hits, thumps and whooshes.
  function noise(o) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + (o.delay || 0), dur = o.dur || 0.3;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.ftype || 'lowpass'; f.Q.value = o.q || 0.8;
    f.frequency.setValueAtTime(o.f0 || 1200, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t + dur);
    const g = out(o.vol, o.pan);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol || 0.2), t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  const api = {
    unlock() { ensure(); },
    get muted() { return muted; },
    toggle() {
      muted = !muted; store.set('muted', muted);
      if (ensure()) master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.05);
      return muted;
    },
    // ---- weapons ----
    shot(kind, mine, x, y) {
      const { pan, vol } = place(x, y), v = vol * (mine ? 1 : 0.7);
      if (kind === 'bolt') {
        if (mine && P && P.key === 'kestrel') {                                // pulse laser: bright falling zap
          tone({ type: 'square', f0: 1500, f1: 260, dur: 0.16, vol: 0.12 * v, pan, filter: 3200 });
          tone({ type: 'sine', f0: 2400, f1: 900, dur: 0.08, vol: 0.06 * v, pan });
        } else {                                                                 // autocannon / enemy laser: chunky thud
          noise({ f0: 1400, f1: 200, dur: 0.12, vol: 0.22 * v, pan });
          tone({ type: 'triangle', f0: 180, f1: 70, dur: 0.12, vol: 0.18 * v, pan });
        }
      } else if (kind === 'rail') {                                              // rail: crack plus a ringing tail
        noise({ ftype: 'highpass', f0: 2600, dur: 0.07, vol: 0.32 * v, pan });
        tone({ type: 'sawtooth', f0: 2200, f1: 90, dur: 0.45, vol: 0.14 * v, pan, filter: 4000 });
        tone({ type: 'sine', f0: 120, f1: 40, dur: 0.5, vol: 0.28 * v, pan });
      } else if (kind === 'torpedo') {                                           // torpedo: launch whoosh
        noise({ ftype: 'bandpass', f0: 300, f1: 1800, dur: 0.7, vol: 0.25 * v, pan, attack: 0.08, q: 2 });
        tone({ type: 'triangle', f0: 90, f1: 140, dur: 0.6, vol: 0.18 * v, pan });
      }
    },
    hit(onShield, mine, x, y) {
      if (!limit('hit' + mine, 70)) return;
      const { pan, vol } = place(x, y), v = vol * (mine ? 1 : 0.65);
      if (onShield) {                                                            // shield: fizz
        noise({ ftype: 'bandpass', f0: 3200, f1: 1600, dur: 0.22, vol: 0.14 * v, pan, q: 3 });
        tone({ type: 'sine', f0: 900, f1: 600, dur: 0.18, vol: 0.06 * v, pan });
      } else {                                                                   // hull: metal clang
        noise({ f0: 900, f1: 120, dur: 0.3, vol: 0.28 * v, pan });
        tone({ type: 'square', f0: 220, f1: 140, dur: 0.25, vol: 0.08 * v, pan, filter: 900 });
        tone({ type: 'sine', f0: 523, dur: 0.4, vol: 0.05 * v, pan });
      }
    },
    rock(big, x, y) {
      if (!limit('rock', 90)) return;
      const { pan, vol } = place(x, y);
      noise({ f0: big ? 600 : 1500, f1: 100, dur: big ? 0.5 : 0.12, vol: (big ? 0.3 : 0.1) * vol, pan });
    },
    bump(force, x, y) {
      const { pan, vol } = place(x, y), v = clamp(force / 80, 0.3, 1.2) * vol;
      noise({ f0: 500, f1: 60, dur: 0.45, vol: 0.4 * v, pan });
      tone({ type: 'sine', f0: 90, f1: 40, dur: 0.4, vol: 0.4 * v, pan });
    },
    boom(small, x, y) {
      const { pan, vol } = place(x, y);
      noise({ f0: 2200, f1: 60, dur: small ? 0.6 : 1.8, vol: (small ? 0.3 : 0.5) * vol, pan });
      tone({ type: 'sine', f0: 70, f1: 28, dur: small ? 0.6 : 1.6, vol: 0.45 * vol, pan });
      if (!small) noise({ f0: 900, f1: 80, dur: 1.2, vol: 0.3 * vol, pan, delay: 0.35 });
    },
    lockBeep(locked) {
      if (!limit('lock', locked ? 180 : 600)) return;
      tone({ type: 'square', f0: locked ? 1320 : 880, dur: 0.07, vol: 0.05, filter: 3000 });
    },
    // ---- ship and interface ----
    warp() {
      noise({ ftype: 'bandpass', f0: 200, f1: 3000, dur: 1.6, vol: 0.3, attack: 0.5, q: 1.5 });
      tone({ type: 'sawtooth', f0: 60, f1: 600, dur: 1.6, vol: 0.12, attack: 0.4, filter: 1200 });
      tone({ type: 'sine', f0: 40, f1: 90, dur: 2, vol: 0.3, attack: 0.3 });
    },
    warpOut() {
      noise({ f0: 4000, f1: 200, dur: 0.9, vol: 0.32 });
      tone({ type: 'sine', f0: 300, f1: 40, dur: 1.1, vol: 0.3 });
    },
    thrust(dur) {
      noise({ f0: 400, f1: 900, dur: dur || 2.5, vol: 0.22, attack: 0.6 });
      tone({ type: 'sawtooth', f0: 50, f1: 75, dur: dur || 2.5, vol: 0.08, attack: 0.5, filter: 300 });
    },
    click(up) { tone({ type: 'triangle', f0: up ? 900 : 620, f1: up ? 1200 : 480, dur: 0.06, vol: 0.07 }); },
    deny() { tone({ type: 'square', f0: 180, f1: 140, dur: 0.14, vol: 0.06, filter: 800 }); },
    ui() { tone({ type: 'sine', f0: 700, f1: 1050, dur: 0.09, vol: 0.08 }); },
    confirm() { tone({ type: 'sine', f0: 520, dur: 0.1, vol: 0.08 }); tone({ type: 'sine', f0: 780, dur: 0.16, vol: 0.08, delay: 0.09 }); },
    swipe() { noise({ ftype: 'bandpass', f0: 800, f1: 2400, dur: 0.16, vol: 0.06, q: 1.5 }); },
    charge(p) { if (limit('charge', 110)) tone({ type: 'sine', f0: 300 + p * 700, dur: 0.1, vol: 0.05 }); },
    // ---- crew gibberish: a run of short pitched syllables in each crew member's own voice ----
    babble(voice, text) {
      if (!ensure() || muted || !voice) return;
      const n = clamp(Math.round(text.length / 5), 3, 12), step = 1 / voice.rate;
      for (let i = 0; i < n; i++) {
        const f = voice.base * Math.pow(2, rand(-voice.spread, voice.spread));
        const last = i === n - 1;
        tone({ type: voice.wave, f0: f, f1: f * (last ? 0.82 : rand(0.92, 1.1)), dur: step * rand(0.55, 0.85), vol: 0.07,
          delay: i * step + rand(0, step * 0.15), attack: 0.012, filter: voice.filter || 2000, q: 2 });
      }
    }
  };
  return api;
})();

// ---- 04-render.js ----
// ---------- 3D renderer (visual only: reads the flat simulation, never feeds back into it) ----------
// Sim (x, y) maps to world (x, height, y). A ship's yaw is -ang about the Y axis; local +X is the nose.
const VIS = {
  kestrel: {
    hull: 'models/kestrel.json', rotY: Math.PI, scale: 63, glow: 0xc8aaff, trail: [0.7, 0.55, 1], shieldR: 40,
    tint: 0x3a4d63, outline: [[26, 0], [-6, 13], [-16, 15], [-10, 5], [-18, 4], [-18, -4], [-10, -5], [-16, -15], [-6, -13]],
    engines: [[-31, 8.9, -5.1], [-31, 8.9, 5.1]],
    mounts: [
      { weapon: 0, turret: true, model: 'models/laser-turret.json', rotY: Math.PI / 2, scale: 8, centre: [0, -0.053], at: [-17.1, 12.4, 0] },
      { weapon: 1, turret: false, model: 'models/railgun.json', rotY: Math.PI, scale: 15, at: [13.5, 10.4, 0] }
    ]
  },
  corsair: {
    hull: 'models/corsair.json', rotY: Math.PI / 2, scale: 66, glow: 0xffaa78, trail: [1, 0.55, 0.4], shieldR: 42,
    tint: 0x5c3b2c, outline: [[22, 5], [22, -5], [10, -9], [6, -18], [-14, -18], [-22, -8], [-22, 8], [-14, 18], [6, 18], [10, 9]],
    engines: [[-32.4, 11.4, -8.2], [-32.4, 11.4, 0], [-32.4, 11.4, 8.2], [-32.4, 5.3, -9.9], [-32.4, 5.3, 0], [-32.4, 5.3, 9.9]],
    mounts: [{ weapon: 0, turret: true, model: 'models/autocannon.json', rotY: Math.PI / 2, scale: 9.4, centre: [0.025, -0.116], at: [-11.9, 16, 0] }]
  }
};
const ROCK_FILES = {
  'rock-1': 'models/rock-1.json', 'rock-2': 'models/rock-2.json', 'rock-industrial': 'models/rock-industrial.json',
  'ice-2': 'models/ice-2.json', 'ice-crystal': 'models/ice-crystal.json'
};
const LOD_FILES = { rock: ['models/rock-1-lod.json', 'models/rock-2-lod.json'], ice: ['models/ice-2-lod.json', 'models/ice-crystal-lod.json'] };
const SHOT_Y = 9;
const tpl = {};                     // loaded model templates by url

function radialTex(stops, size) {
  size = size || 128;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function initGL() {
  if (typeof THREE === 'undefined') return null;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' }); }
  catch (err) { return null; }
  renderer.setPixelRatio(DPR);
  renderer.setSize(W, H, false);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070c);
  const camera = new THREE.PerspectiveCamera(32, W / H, 5, 30000);

  scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x14121c, 0.55));
  const key = new THREE.DirectionalLight(0xfff0dd, 1.5); key.position.set(-300, 600, -220); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9a7bff, 1.1); rim.position.set(420, 160, 520); scene.add(rim);
  const fill = new THREE.DirectionalLight(0x4fb8ff, 0.45); fill.position.set(220, 300, -520); scene.add(fill);
  const flash = new THREE.PointLight(0xffc890, 0, 900, 2); flash.position.set(0, 40, 0); scene.add(flash);

  // Stars: soft round dots in depth layers below and around the battle plane.
  const starTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']], 32);
  [[-700, 900, 1.6, 0.55], [-1800, 900, 2.0, 0.7], [-3600, 1100, 2.6, 0.85]].forEach(([y, n, sz, op]) => {
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = rand(-9000, 9000); pos[i * 3 + 1] = y + rand(-200, 200); pos[i * 3 + 2] = rand(-9000, 9000); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfe0ff, map: starTex, size: sz, sizeAttenuation: false, transparent: true, opacity: op, depthWrite: false })));
  });
  // A far sphere of stars too, for the low camera angles (menu, take-off, warp).
  {
    const n = 1400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const v = new THREE.Vector3(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).normalize().multiplyScalar(rand(9000, 14000)); pos.set([v.x, v.y, v.z], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8e4ff, map: starTex, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.8, depthWrite: false })));
  }
  const nebTex = radialTex([[0, 'rgba(255,255,255,0.9)'], [0.4, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']], 256);
  const nebs = [[0x3c2870, -2600, -1400, 9000], [0x14506e, 2800, 1600, 8000]].map(([col, x, z, s]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ map: nebTex, color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, -5200, z); scene.add(m); return m;
  });

  const glowTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.22, 'rgba(255,255,255,0.65)'], [1, 'rgba(255,255,255,0)']]);

  // Particles: one glowing (additive) system for sparks and fire, one ordinary system for smoke and debris.
  const psAdd = makeParticles(scene, 2000, true), psDark = makeParticles(scene, 1400, false);

  const shieldGeo = new THREE.SphereGeometry(1, 40, 20);
  const shieldVS = 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }';
  const shieldFS = 'uniform vec3 color; uniform float opacity; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.4); gl_FragColor = vec4(color * (f * 1.5 + 0.05), opacity); }';

  GL = { renderer, scene, camera, flash, nebs, glowTex, psAdd, psDark, shieldGeo, shieldVS, shieldFS, mats: {}, colors: {} };
  GL.fieldGroup = new THREE.Group(); scene.add(GL.fieldGroup);
  GL.station = buildStation();
  GL.tunnel = buildTunnel();
  GL.aim = { P: makeAimLine(0xfff1c2), E: makeAimLine(0xff5468) };
  GL.shotGeo = {
    bolt: new THREE.BoxGeometry(14, 1.1, 1.1).translate(-7, 0, 0),
    railCore: new THREE.BoxGeometry(50, 1.4, 1.4).translate(-25, 0, 0),
    railGlow: new THREE.BoxGeometry(50, 4.5, 4.5).translate(-25, 0, 0),
    torp: new THREE.SphereGeometry(2.6, 16, 10)
  };
  return GL;
}

// Round soft points with their own size (world units) and alpha. "hard" sharpens the edge (debris).
const PS_VS = [
  'attribute float size; attribute vec4 rgba; attribute float hard; uniform float scale;',
  'varying vec4 vC; varying float vH;',
  'void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vC = rgba; vH = hard;',
  '  gl_PointSize = max(1.5, size * scale / -mv.z); gl_Position = projectionMatrix * mv; }'].join('\n');
const PS_FS = [
  'varying vec4 vC; varying float vH;',
  'void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;',
  '  float a = mix(pow(1.0 - d, 1.6), 1.0 - smoothstep(0.6, 1.0, d), vH);',
  '  gl_FragColor = vec4(vC.rgb, vC.a * a); }'].join('\n');
function makeParticles(scene, cap, additive) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(cap * 3), rgba = new Float32Array(cap * 4), size = new Float32Array(cap), hard = new Float32Array(cap);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('rgba', new THREE.BufferAttribute(rgba, 4));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('hard', new THREE.BufferAttribute(hard, 1));
  const mat = new THREE.ShaderMaterial({ uniforms: { scale: { value: 1 } }, vertexShader: PS_VS, fragmentShader: PS_FS,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = additive ? 3 : 2; scene.add(pts);
  return { geo, pos, rgba, size, hard, cap, mat, n: 0 };
}

const colorOf = c => GL.colors[c] || (GL.colors[c] = new THREE.Color(c));
function addMat(color, opacity) {
  const k = color + '|' + (opacity || 1);
  return GL.mats[k] || (GL.mats[k] = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity || 1, blending: THREE.AdditiveBlending, depthWrite: false }));
}

// ---- model loading: everything is fetched once at start, then cloned where needed ----
function loadModel(url) {
  return new Promise((res, rej) => new THREE.GLTFLoader().load(url, g => res(g.scene), undefined, rej));
}
function preloadModels(onProgress) {
  if (!GL || !THREE.GLTFLoader) return Promise.resolve(0);
  const urls = new Set();
  Object.values(VIS).forEach(v => { urls.add(v.hull); v.mounts.forEach(m => m.model && urls.add(m.model)); });
  Object.values(ROCK_FILES).forEach(u => urls.add(u));
  urls.add(STATION.url);
  Object.values(LOD_FILES).forEach(l => l.forEach(u => urls.add(u)));
  let done = 0, failed = 0;
  const all = [...urls];
  return Promise.all(all.map(u => loadModel(u).then(obj => {
    obj.traverse(o => { if (o.isMesh && o.material) o.material.metalness = Math.min(o.material.metalness, 0.45); });
    tpl[u] = obj;
  }).catch(() => { failed++; }).then(() => { done++; onProgress && onProgress(done / all.length); }))).then(() => failed);
}
// Wrap a template clone with its orientation and scale.
// centre: the model-space (x, z) point that should sit on the group's origin (a turret's base, so it spins on its ring).
function fitModel(url, rotY, scale, tint, centre) {
  const src = tpl[url]; if (!src) return null;
  const obj = src.clone();
  if (tint) obj.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(tint)); } });
  obj.rotation.y = rotY; obj.scale.setScalar(scale);
  if (centre) obj.position.copy(new THREE.Vector3(centre[0], 0, centre[1]).applyEuler(obj.rotation).multiplyScalar(-scale));
  const g = new THREE.Group(); g.add(obj); return g;
}

// ---- placeholders (used if a model failed to load) ----
function placeholderHull(vis) {
  const shape = new THREE.Shape();
  vis.outline.forEach(([x, y], i) => i ? shape.lineTo(x * 1.35, -y * 1.35) : shape.moveTo(x * 1.35, -y * 1.35));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 8, bevelEnabled: true, bevelSize: 1.2, bevelThickness: 1.2, bevelSegments: 2 });
  geo.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: vis.tint, metalness: 0.6, roughness: 0.45 }));
}
function placeholderPart() {
  return new THREE.Mesh(new THREE.CylinderGeometry(5, 5.6, 4, 16), new THREE.MeshStandardMaterial({ color: 0x3e4955, metalness: 0.4, roughness: 0.55 }));
}

// ---- ships ----
function buildShipVis(s, isPlayer) {
  const vis = VIS[s.key];
  const tint = !isPlayer && P && E && P.key === E.key ? 0xffb6a6 : null;   // mirror match: give the enemy a reddish cast
  const root = new THREE.Group(), tilt = new THREE.Group(), hullSlot = new THREE.Group();
  root.add(tilt); tilt.add(hullSlot);
  hullSlot.add(fitModel(vis.hull, vis.rotY, vis.scale, tint) || placeholderHull(vis));
  // Own copies of the hull materials, so damage can scorch this ship only.
  const hullMats = [];
  hullSlot.traverse(o => { if (o.isMesh && o.material) { o.material = o.material.clone(); hullMats.push({ m: o.material, base: o.material.color.clone() }); } });
  const fires = [0, 1, 2].map(() => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GL.glowTex, color: 0xff7a2a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    sp.position.set(rand(-22, 8), rand(10, 15), rand(-9, 9)); sp.visible = false; tilt.add(sp); return sp;
  });
  const mounts = vis.mounts.map(m => {
    const pivot = new THREE.Group(); pivot.position.set(m.at[0], m.at[1], m.at[2]); tilt.add(pivot);
    pivot.add((m.model && fitModel(m.model, m.rotY, m.scale, tint, m.centre)) || placeholderPart());
    return { m, pivot };
  });
  const engines = vis.engines.map(p => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GL.glowTex, color: vis.glow, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    sp.position.set(p[0], p[1], p[2]); tilt.add(sp); return sp;
  });
  const shieldMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0x52c8ff) }, opacity: { value: 0 } },
    vertexShader: GL.shieldVS, fragmentShader: GL.shieldFS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
  });
  const shield = new THREE.Mesh(GL.shieldGeo, shieldMat);
  shield.scale.set(vis.shieldR, vis.shieldR * 0.42, vis.shieldR * 0.78); shield.position.y = 8;
  root.add(shield);
  const TN = 30;
  const trails = engines.map(() => {
    const pos = new Float32Array(TN * 3), col = new Float32Array(TN * 3), geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    line.frustumCulled = false; GL.scene.add(line);
    return { line, geo, pos, col, pts: [] };
  });
  GL.scene.add(root);
  return { s, vis, root, tilt, mounts, engines, shield, trails, TN, sampleT: 0, pitch: 0, lastSpeed: 0, phase: rand(0, 6), spin: 0, hullMats, fires, scorch: -1 };
}
function disposeShipVis(vs) {
  if (!vs) return;
  GL.scene.remove(vs.root);
  vs.trails.forEach(t => { GL.scene.remove(t.line); t.geo.dispose(); t.line.material.dispose(); });
}
function buildShips() {
  if (!GL) return;
  if (GL.ships) { disposeShipVis(GL.ships.P); disposeShipVis(GL.ships.E); }
  GL.ships = { P: buildShipVis(P, true), E: buildShipVis(E, false) };
}

function updateShipVis(vs, dt, t) {
  const s = vs.s;
  if (s.hidden || s.warp > 0.6 || s.blown) {
    vs.root.visible = false; vs.trails.forEach(tr => { tr.pts.length = 0; tr.geo.setDrawRange(0, 0); });
    return;
  }
  vs.root.visible = true;
  vs.root.position.set(s.x, (s.h || 0) + Math.sin(t * 0.9 + vs.phase) * (s.h > 0.5 && s.h < 2 ? 0 : 1.2), s.y);
  vs.root.rotation.y = -s.ang;
  vs.root.scale.set(1 + (s.warp > 0 ? s.warp * 6 : 0), 1, 1);
  // Pitch: nose dips under acceleration and lifts when slowing. Roll: bank into turns and slides.
  const accel = (s.speed - vs.lastSpeed) / Math.max(dt, 1e-3); vs.lastSpeed = s.speed;
  vs.pitch += (clamp(-accel * 0.004, -0.1, 0.1) - vs.pitch) * Math.min(1, dt * 3);
  const lat = s.slipX * -Math.sin(s.ang) + s.slipY * Math.cos(s.ang);
  let roll = (s.bank / 0.7) * 22 * DEG + clamp(lat / 140, -0.3, 0.3) + Math.sin(t * 0.7 + vs.phase) * 2 * DEG;
  roll = clamp(roll, -25 * DEG, 25 * DEG);
  let pitch = vs.pitch + (s.pitchV || 0) + Math.sin(t * 0.55 + vs.phase * 2) * 1.2 * DEG;
  if (s.jolt) {                                              // a heavy hit rocks the hull, then it settles
    const j = s.jolt; j.t += dt;
    const k = Math.exp(-j.t * 3) * Math.cos(j.t * 13);
    roll += j.r * k; pitch += j.p * k;
    if (j.t > 2) s.jolt = null;
  }
  if (s.dead) {
    vs.spin += dt * 1.8; roll = vs.spin; pitch = vs.spin * 0.4;
    s.deathT = (s.deathT || 0) + dt;
    if (s.deathT > 1.15 && !s.blown) {
      s.blown = true;
      burst(s.x, s.y, 70, '#fff3d6', 380); burst(s.x, s.y, 50, C.weapon, 260);
      GL.flash.position.set(s.x, 60, s.y); GL.flash.intensity = 6;
      camShake(16);
      SFX.boom(false, s.x, s.y);
    }
  }
  vs.tilt.rotation.set(roll, 0, pitch);
  // Damage: the hull darkens and scorches, and fires flicker on it when it's in a bad way.
  const dmg = s.dmgFx || 0;
  if (Math.abs(dmg - vs.scorch) > 0.01) {
    vs.scorch = dmg;
    const burnt = new THREE.Color(0x2b1d16), k = clamp((dmg - 0.1) * 0.9, 0, 0.72);
    vs.hullMats.forEach(h => { h.m.color.copy(h.base).lerp(burnt, k); });
  }
  vs.fires.forEach((f, i) => {
    f.visible = !s.dead && dmg > 0.55 + i * 0.13;
    if (f.visible) { const k = 13 + Math.random() * 8 + Math.sin(t * 17 + i * 3) * 3; f.scale.set(k, k, 1); f.material.opacity = 0.55 + Math.random() * 0.35; }
  });
  vs.mounts.forEach(mt => { if (mt.m.turret) mt.pivot.rotation.y = -s.tr[mt.m.weapon]; });
  const e = eff(s, 'engines') + (s.boost || 0);
  vs.engines.forEach(sp => {
    sp.visible = !s.dead;
    const k = 5 + e * 2.6 + Math.random() * 1 + (s.warp > 0 ? 24 : 0);
    sp.scale.set(k, k, 1); sp.material.opacity = 0.45 + e * 0.08;
  });
  const mx = shieldMax(s) || 1;
  const on = !s.dead && s.shield > 0 && !s.down && s.warp === 0 && state === 'run';
  vs.shield.visible = on;
  if (on) vs.shield.material.uniforms.opacity.value = 0.12 + 0.3 * (s.shield / mx) + 1.1 * s.flash;
  // One trail per engine nozzle, sampled about 30 times a second from the nozzle's real 3D position.
  vs.root.updateMatrixWorld(true);
  vs.sampleT += dt;
  const sample = vs.sampleT >= 1 / 30; if (sample) vs.sampleT = 0;
  const moving = !s.dead && Math.hypot(s.vx || 0, s.vy || 0) > 25;   // no trail while sitting still (on the pad, lifting off)
  const [r, g, b] = vs.vis.trail, wp = new THREE.Vector3();
  if (s.trailReset) { s.trailReset = false; vs.trails.forEach(tr => { tr.pts.length = 0; }); }
  vs.trails.forEach((tr, k) => {
    if (sample && moving) {
      vs.engines[k].getWorldPosition(wp);
      const L = tr.pts.length;
      if (L && Math.hypot(wp.x - tr.pts[L - 3], wp.z - tr.pts[L - 1]) > 120) tr.pts.length = 0;   // the ship was moved (new scene): start afresh
      tr.pts.push(wp.x, wp.y, wp.z); if (tr.pts.length > vs.TN * 3) tr.pts.splice(0, 3);
    }
    else if (sample && tr.pts.length) tr.pts.splice(0, 3);
    const n = tr.pts.length / 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * (0.18 + e * 0.09);
      tr.pos[i * 3] = tr.pts[i * 3]; tr.pos[i * 3 + 1] = tr.pts[i * 3 + 1]; tr.pos[i * 3 + 2] = tr.pts[i * 3 + 2];
      tr.col[i * 3] = r * a; tr.col[i * 3 + 1] = g * a; tr.col[i * 3 + 2] = b * a;
    }
    tr.geo.attributes.position.needsUpdate = true; tr.geo.attributes.color.needsUpdate = true;
    tr.geo.setDrawRange(0, n);
  });
}

// ---- rail aim line: one thin laser from the nose when the rail is charged ----
// Solid near the ship, breaking into dashes that fade with range. Drawn in a shader on a very thin sector.
const AIM_VS = 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const AIM_FS = [
  'uniform vec3 color; uniform float opacity; uniform float len; uniform float crawl; uniform float px;',
  'varying vec2 vP;',
  'void main(){',
  '  float r = vP.x; float d = clamp(r / len, 0.0, 1.0);',
  '  float off = abs(vP.y);',
  '  float core = 1.0 - smoothstep(0.0, 1.6 * px, off);',
  '  float halo = (1.0 - smoothstep(0.0, 8.0 * px, off)) * 0.3;',
  '  float gap = mix(1.0, 0.25, smoothstep(0.2, 0.95, d));',
  '  float dash = step(fract((r - crawl) / 30.0), gap);',
  '  float a = (core + halo) * mix(1.0, dash, smoothstep(0.15, 0.3, d)) * pow(1.0 - d, 1.2) * opacity;',
  '  gl_FragColor = vec4(color * a, a);',
  '}'].join('\n');
function makeAimLine(color) {
  const geo = new THREE.PlaneGeometry(RANGE, 40).translate(RANGE / 2, 0, 0);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 0 }, len: { value: RANGE }, crawl: { value: 0 }, px: { value: 1 } },
    vertexShader: AIM_VS, fragmentShader: AIM_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.visible = false; GL.scene.add(mesh);
  return mesh;
}
function updateAimLines(t) {
  const px = (2 * camDist() * Math.tan(GL.camera.fov * DEG / 2)) / Math.max(1, H);
  [['P', P, E], ['E', E, P]].forEach(([k, s, foe]) => {
    const m = GL.aim[k], w = s && bigGun(s);
    let show = !!(s && state === 'run' && !s.dead && !s.hidden && s.warp === 0 && w.kind === 'rail' && weaponOnline(s, w) && s.wt[1] >= w.interval);
    if (show && k === 'E' && s.brain && s.brain.phase !== 'charge') show = false;
    m.visible = show;
    if (!show) return;
    const onT = inArc(s, w, 1, foe) && inRange() && clearShot(s, foe), u = m.material.uniforms;
    m.position.set(s.x, 4, s.y); m.rotation.y = -s.ang;
    u.px.value = px; u.opacity.value = onT ? 1.3 : 0.75; u.crawl.value = t * 60;
  });
}

// ---- asteroids ----
function rockTemplate(url) {
  const src = tpl[url]; if (!src) return null;
  const obj = src.clone();
  obj.traverse(o => { if (o.isMesh && o.material) { o.material.metalness = Math.min(o.material.metalness, 0.2); o.material.roughness = Math.max(o.material.roughness, 0.75); } });
  const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  obj.position.sub(c);
  const g = new THREE.Group(); g.add(obj);
  g.scale.setScalar(2 / Math.max(sz.x, sz.y, sz.z));        // radius 1
  return g;
}
function rockPlaceholder() {
  return new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x4a4b52, roughness: 0.95, metalness: 0, flatShading: true }));
}
const rockCache = {};
const rockModel = url => { if (!rockCache[url]) rockCache[url] = rockTemplate(url); return rockCache[url] ? rockCache[url].clone() : rockPlaceholder(); };
// Arena rocks follow the simulation's field and are rebuilt each battle, plus low-detail rocks far below for depth.
function buildRockVis() {
  GL.fieldGroup.clear();
  GL.rockVis = rocks.map(r => {
    const holder = new THREE.Group(), spin = new THREE.Group(), slot = new THREE.Group();
    holder.add(spin); spin.add(slot);
    holder.position.set(r.x, 0, r.y);
    if (r.kind === 'rock-industrial') spin.rotation.set(-Math.PI / 2 + 0.35, r.ry, 0);   // lay the ring face-up, tipped toward the camera
    else spin.rotation.set(r.rx, r.ry, r.rz);
    slot.scale.setScalar(r.r);
    slot.add(rockModel(ROCK_FILES[r.kind]));
    GL.fieldGroup.add(holder);
    return { r, spin };
  });
  GL.backdrop = [];
  const lods = LOD_FILES[fieldKind];
  for (let i = 0; i < 30; i++) {
    const holder = new THREE.Group(), slot = new THREE.Group();
    holder.add(slot);
    const depth = rand(260, 2400);
    holder.position.set(rand(-3600, 3600), -depth, rand(-2600, 2600));
    holder.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
    slot.scale.setScalar(rand(30, 70) + depth * rand(0.03, 0.08));
    slot.add(rockModel(lods[i % lods.length]));
    GL.fieldGroup.add(holder);
    GL.backdrop.push({ holder, ax: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(), sp: rand(-0.08, 0.08) });
  }
  // the sky takes on the field's colours
  const [a, b] = fieldKind === 'ice' ? [0x1c3f6e, 0x2a6f8a] : [0x3c2870, 0x5a3a1e];
  GL.nebs[0].material.color.set(a); GL.nebs[1].material.color.set(b);
}
function updateRockVis(dt) {
  (GL.rockVis || []).forEach(v => { v.spin.rotation.y += v.r.spin * dt; });
  (GL.backdrop || []).forEach(b => { b.holder.rotateOnAxis(b.ax, b.sp * dt); });
}

// ---- Fortune Station ----
// The station model has four landing pads; the ship uses the low front-right one, so it lifts off away from the hull.
// The model is placed so that pad's deck sits at PAD, height 0. A simple pad stands in if the model didn't load.
const PAD = { x: 0, y: 0 };
const STATION = { url: 'models/station.json', scale: 600, pad: [0.300, 0.165, 0.313] };
function buildStation() {
  const g = new THREE.Group();
  const fallback = new THREE.Group(); g.add(fallback);
  const metal = new THREE.MeshStandardMaterial({ color: 0x1b212b, metalness: 0.5, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x10141b, metalness: 0.3, roughness: 0.85 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(78, 84, 8, 48), metal); pad.position.y = -4; fallback.add(pad);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 0.6, 48), dark); deck.position.y = 0.3; fallback.add(deck);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(58, 0.9, 6, 64), new THREE.MeshBasicMaterial({ color: 0x52c8ff }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.7; fallback.add(ring);
  // landing lights around the pad edge
  const lights = [];
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb070 }));
    m.position.set(Math.cos(a) * 70, 1.5, Math.sin(a) * 70); g.add(m); lights.push({ m, a });
  }
  const lamp = new THREE.PointLight(0xffd0a0, 1.2, 420, 2); lamp.position.set(30, 120, 80); g.add(lamp);
  const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: GL.glowTex, color: 0xff5468, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  beacon.position.set(0, 26, -84); beacon.scale.set(18, 18, 1); g.add(beacon);
  g.position.set(PAD.x, 0, PAD.y);
  g.visible = false;
  GL.scene.add(g);
  return { g, lights, beacon, fallback, model: null };
}
// Once models are loaded: put the real station in, with the chosen pad's deck on the origin.
function attachStationModel() {
  const st = GL.station, src = tpl[STATION.url];
  if (!src || st.model) return;
  const obj = src.clone(), S = STATION.scale, [px, py, pz] = STATION.pad;
  obj.traverse(o => { if (o.isMesh && o.material) { o.material.metalness = 0.35; o.material.roughness = Math.max(o.material.roughness, 0.6); } });
  obj.scale.setScalar(S); obj.position.set(-px * S, -py * S, -pz * S);
  st.g.add(obj); st.model = obj; st.fallback.visible = false;
  st.lights.forEach(l => { l.m.visible = false; }); st.beacon.visible = false;   // the model has its own pad markings
  // a soft fill so the dark hull reads against space
  const fill = new THREE.PointLight(0x9fc4ff, 1.4, 1600, 1.5); fill.position.set(-200, 360, 300); st.g.add(fill);
}
function updateStation(t) {
  const st = GL.station; if (!st.g.visible) return;
  if (!st.model) st.lights.forEach(l => { const on = (Math.sin(t * 3 - l.a * 2) + 1) / 2; l.m.material.color.setRGB(1, 0.45 + 0.35 * on, 0.2 + 0.3 * on); l.m.scale.setScalar(0.7 + on * 0.6); });
  st.beacon.material.opacity = (Math.sin(t * 4) > 0.3) ? 1 : 0.15;
}

// ---- warp tunnel: a glowing cylinder of streaks around the ship ----
function buildTunnel() {
  const geo = new THREE.CylinderGeometry(200, 200, 9000, 40, 1, true);
  geo.rotateZ(Math.PI / 2);                                  // axis along +X, the ship's nose
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, opacity: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'uniform float time; uniform float opacity; varying vec2 vUv;',
      'float h(float n){ return fract(sin(n) * 43758.5453); }',
      'void main(){',
      '  float lane = floor(vUv.x * 64.0);',
      // uv.y runs from the nose (0) to the tail (1); subtracting time makes the streaks rush back past the ship
      '  float s = fract(vUv.y * (6.0 + h(lane) * 10.0) - time * (1.2 + h(lane + 7.0) * 1.8) + h(lane + 3.0));',
      '  float streak = smoothstep(0.65, 0.98, s) * (1.0 - smoothstep(0.98, 1.0, s));',      // bright head leads, tail trails toward the nose
      '  vec3 col = mix(vec3(0.45, 0.35, 1.0), vec3(0.3, 0.85, 1.0), h(lane + 11.0));',
      '  float ends = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);',
      '  float a = (streak * 0.9 + 0.06) * ends * opacity;',
      '  gl_FragColor = vec4(col * a, a);',
      '}'].join('\n'),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.visible = false; GL.scene.add(mesh);
  return mesh;
}
function updateTunnel(t, level) {
  const tn = GL.tunnel;
  tn.visible = level > 0.01;
  if (!tn.visible) return;
  tn.position.set(P.x, (P.h || 0) + 8, P.y); tn.rotation.y = -P.ang;
  tn.material.uniforms.time.value = t; tn.material.uniforms.opacity.value = level;
}

// ---- shots and particles ----
function shotMesh(p) {
  const g = new THREE.Group();
  if (p.w.kind === 'bolt') {
    g.add(new THREE.Mesh(GL.shotGeo.bolt, addMat(p.w.color)));
  } else if (p.w.kind === 'rail') {
    g.add(new THREE.Mesh(GL.shotGeo.railGlow, addMat('#ffe9b0', 0.35)));
    g.add(new THREE.Mesh(GL.shotGeo.railCore, addMat(p.w.color)));
  } else {
    g.add(new THREE.Mesh(GL.shotGeo.torp, addMat('#ff6a7c')));
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GL.glowTex, color: 0xff3b5c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    sp.scale.set(26, 26, 1); g.add(sp); g.userData.glow = sp;
    const n = 20, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    line.frustumCulled = false; GL.scene.add(line); p.tline = line;
  }
  GL.scene.add(g);
  return g;
}
function disposeShot(p) {
  if (!GL) return;
  if (p.mesh) { GL.scene.remove(p.mesh); p.mesh = null; }
  if (p.tline) { GL.scene.remove(p.tline); p.tline.geometry.dispose(); p.tline.material.dispose(); p.tline = null; }
}
function updateShotVis() {
  for (const p of shots) {
    if (!p.mesh) p.mesh = shotMesh(p);
    p.mesh.position.set(p.x, SHOT_Y, p.y);
    p.mesh.rotation.y = -Math.atan2(p.vy, p.vx);
    if (p.w.kind === 'torpedo') {
      const k = 22 + Math.sin(p.age * 18) * 6; p.mesh.userData.glow.scale.set(k, k, 1);
      const tr = p.trail, n = Math.min(20, tr.length / 2), off = tr.length / 2 - n;
      const pos = p.tline.geometry.attributes.position.array, col = p.tline.geometry.attributes.color.array;
      for (let i = 0; i < n; i++) {
        const j = off + i, a = (i / n) * 0.6;
        pos[i * 3] = tr[j * 2]; pos[i * 3 + 1] = SHOT_Y; pos[i * 3 + 2] = tr[j * 2 + 1];
        col[i * 3] = a; col[i * 3 + 1] = 0.45 * a; col[i * 3 + 2] = 0.4 * a;
      }
      p.tline.geometry.attributes.position.needsUpdate = true; p.tline.geometry.attributes.color.needsUpdate = true;
      p.tline.geometry.setDrawRange(0, n);
    }
  }
}
const PCOL = {};
const pcol = c => PCOL[c] || (PCOL[c] = new THREE.Color(c));
let FIRE_A, FIRE_B, FIRE_C, tmpC;
function updateParticleVis() {
  if (!tmpC) { FIRE_A = pcol('#fff0b8'); FIRE_B = pcol('#ff6a1e'); FIRE_C = pcol('#5a1a0a'); tmpC = new THREE.Color(); }
  const A = GL.psAdd, D = GL.psDark;
  A.n = 0; D.n = 0;
  const scale = (H * DPR) / (2 * Math.tan(GL.camera.fov * DEG / 2));
  A.mat.uniforms.scale.value = D.mat.uniforms.scale.value = scale;
  for (let i = parts.length - 1; i >= 0; i--) {            // newest first, so the cap drops the oldest
    const q = parts[i], f = Math.max(0, q.life / q.max), age = q.max - q.life;
    const k = q.k || 'glow', dark = k === 'smoke' || k === 'debris', S = dark ? D : A;
    if (S.n >= S.cap) continue;
    let c = pcol(q.color), a = f, hard = 0;
    if (k === 'spark') a = Math.pow(f, 0.6) * 1.4;
    else if (k === 'ember') a = f * (0.55 + 0.45 * Math.sin(age * 22 + i));
    else if (k === 'fire') { const u = 1 - f; c = u < 0.4 ? tmpC.copy(FIRE_A).lerp(FIRE_B, u / 0.4) : tmpC.copy(FIRE_B).lerp(FIRE_C, (u - 0.4) / 0.6); a = Math.min(1, f * 1.6) * 0.9; }
    else if (k === 'smoke') a = Math.min(1, age / 0.18) * Math.pow(f, 0.8) * 0.7;
    else if (k === 'debris') { a = Math.min(1, f * 3); hard = 1; }
    const j = S.n++;
    S.pos[j * 3] = q.x; S.pos[j * 3 + 1] = SHOT_Y + (q.h || 0); S.pos[j * 3 + 2] = q.y;
    S.rgba[j * 4] = c.r; S.rgba[j * 4 + 1] = c.g; S.rgba[j * 4 + 2] = c.b; S.rgba[j * 4 + 3] = a;
    S.size[j] = q.size || 4; S.hard[j] = hard;
  }
  [A, D].forEach(S => {
    const at = S.geo.attributes;
    at.position.needsUpdate = at.rgba.needsUpdate = at.size.needsUpdate = at.hard.needsUpdate = true;
    S.geo.setDrawRange(0, S.n);
  });
}

// ---------- Camera ----------
// Each scene asks for a pose (where the camera sits and what it looks at); the camera eases toward it.
// A slow ease (low rate) makes the long sweeps, like dropping from the warp chase view into the top-down battle view.
const CAM_TILT = 24 * DEG;
const cam = { pos: null, look: null, rate: 3, off: 0.07, curOff: null, shake: 0 };
function camShake(a) { cam.shake = Math.max(cam.shake, a); }
function camDist() { return GL ? GL.camera.position.distanceTo(cam.look) : 1000; }

// Battle: follow the player (with a little lag so its movement reads), zoomed to keep the enemy in view when it's close enough.
function battlePose(pos, look) {
  const camera = GL.camera, aspect = W / Math.max(1, H), tanH = Math.tan(camera.fov * DEG / 2), portrait = aspect < 1;
  const tx = P.x, ty = P.y;
  let D = portrait ? 560 / (tanH * 2.2) : 520 / (tanH * 2);
  if (E && !E.dead && !E.hidden && E.warp === 0) {
    const ex = Math.abs(E.x - tx), ey = Math.abs(E.y - ty);
    const need = portrait
      ? Math.max((ey + 150) / (tanH * aspect), (ex + 170) / (tanH * 0.62))
      : Math.max((ex + 170) / (tanH * aspect), (ey + 150) / (tanH * 0.62));
    D = Math.max(D, need);
  }
  D = clamp(D, 520, 1900);
  look.set(tx, 0, ty);
  if (portrait) pos.set(tx - D * Math.sin(CAM_TILT), D * Math.cos(CAM_TILT), ty);
  else pos.set(tx, D * Math.cos(CAM_TILT), ty + D * Math.sin(CAM_TILT));
}

function updateCamera(dt, pose) {
  const camera = GL.camera;
  if (!cam.pos) { cam.pos = new THREE.Vector3(0, 2000, 900); cam.look = new THREE.Vector3(); }
  const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
  pose(wantPos, wantLook);
  const k = cam.rate >= 50 ? 1 : 1 - Math.exp(-cam.rate * dt);
  cam.pos.lerp(wantPos, k); cam.look.lerp(wantLook, k);
  cam.shake = Math.max(0, cam.shake - dt * 20);
  const sh = reduceMotion ? 0 : cam.shake, sx = rand(-sh, sh), sz = rand(-sh, sh);
  camera.position.set(cam.pos.x + sx, cam.pos.y, cam.pos.z + sz);
  camera.lookAt(cam.look.x + sx, cam.look.y, cam.look.z + sz);
  // shift the picture up to make room for panels at the bottom
  if (cam.curOff === null) cam.curOff = cam.off;
  cam.curOff += (cam.off - cam.curOff) * Math.min(1, dt * 4);
  camera.setViewOffset(W, H, 0, H * cam.curOff, W, H);
  GL.flash.intensity = Math.max(0, GL.flash.intensity - dt * 9);
}

function renderFrame(dt, t, pose) {
  if (!GL) return;
  updateCamera(dt, pose);
  if (P) updateShipVis(GL.ships.P, dt, t);
  if (E) updateShipVis(GL.ships.E, dt, t);
  if (P && E) updateAimLines(t);
  updateShotVis();
  updateParticleVis();
  updateRockVis(dt);
  updateStation(t);
  GL.renderer.render(GL.scene, GL.camera);
}

// ---- 05-hud.js ----
// ---------- Battle HUD ----------
const $ = id => document.getElementById(id);
const hudEl = $('hud');
function setBar(id, val, max, text, warn) {
  const el = $(id);
  el.querySelector('.fill').style.width = (max > 0 ? clamp(val / max, 0, 1) * 100 : 0) + '%';
  el.querySelector('output').textContent = text;
  el.classList.toggle('warn', !!warn);
}
let nudgeT = 0;
function nudge(msg) { const n = $('nudge'); n.textContent = msg; n.classList.add('on'); nudgeT = 1.8; }
function flashReactor() { const r = $('free').parentElement; r.classList.add('flash'); setTimeout(() => r.classList.remove('flash'), 500); }

// Power pips are rebuilt for each ship (part limits differ).
const pipRows = {};
function buildPips() {
  document.querySelectorAll('#con-reactor .sys').forEach(sysEl => {
    const k = sysEl.dataset.sys, row = sysEl.querySelector('.pips');
    row.innerHTML = ''; pipRows[k] = [];
    for (let i = 0; i < P.def.reactor; i++) {
      const d = document.createElement('div'); d.className = 'pip';
      if (i >= P.def.parts[k].cap) d.classList.add('over');
      row.appendChild(d); pipRows[k].push(d);
    }
  });
  $('tag-shields').textContent = nm('eng'); $('tag-weapons').textContent = nm('wpn'); $('tag-engines').textContent = nm('pilot');
  $('reactor-total').textContent = P.def.reactor;
}

// ---------- Crew voices ----------
// Lines are written per station; the speaker's name and voice come from whoever is crewing that station.
// Every line appears as a chat bubble, rises and fades. Each line has a cooldown so nobody nags,
// and a crew member's lower-priority lines wait while they're mid-sentence.
const nm = role => (crewById(run.crew[role]) || { name: role }).name;
const nick = () => bigGun(P).nick;
const voice = {}, saidAt = {}, later = [];
let pollT = 0, crewLive = false;
function crewReset() {
  ROLES.forEach(r => { voice[r] = { until: -1, prio: 0 }; });
  for (const k in saidAt) delete saidAt[k];
  later.length = 0; pollT = 0;
}
crewReset();
function say(role, text, o) {
  if (!crewLive) return false;
  o = o || {};
  const key = o.key || text, cd = o.cd === undefined ? 15 : o.cd, prio = o.prio || 1, dur = o.dur || 5.5;
  if (saidAt[key] !== undefined && time - saidAt[key] < cd) return false;
  const v = voice[role];
  if (time < v.until && v.prio > prio) return false;
  v.until = time + Math.min(dur, 3); v.prio = prio; saidAt[key] = time;
  postBubble(role, text, prio, dur);
  return true;
}
const sayLater = (delay, role, text, o) => { if (crewLive) later.push({ at: time + delay, role, text, o }); };

// One-off moments, called from the battle code and the game flow.
function crewEvent(ev) {
  if (!crewLive || !P || !E) return;
  const eBig = bigGun(E), eTorp = eBig.kind === 'torpedo', N = nick(), big = bigGun(P);
  switch (ev) {
    case 'arrive':
      say('comms', pick([`Contact! One ${E.def.name}, ${E.def.cls.toLowerCase()}, coming our way.`, `Bandit ahead! ${E.def.name}. Ugly one, too.`]), { prio: 2 });
      sayLater(1.4, 'pilot', fieldKind === 'ice' ? pick(["Ice field. Mind the pointy bits.", "Brr. Everything out here is sharp."]) : pick(["Nice day for it.", "Seatbelts, everyone."]), { prio: 1, dur: 4 });
      sayLater(2.5, 'eng', "Shields are warm. Don't break them.", { prio: 1, dur: 4 });
      break;
    case 'inRange':
      say('comms', pick(["We're in range. Here we go!", "In range! Everyone look busy."]), { prio: 2 });
      break;
    case 'enemyCharge':
      say('comms', eTorp ? pick(["Ooh, they're pulling power off shields. That's a torpedo face.", "They're powering up something nasty. Torpedo, I reckon."])
        : pick(["They're spinning up a rail cannon. Their shields are thinning.", "Big power draw over there. Rail shot coming."]), { prio: 3 });
      if (weaponOnline(P, big)) sayLater(1.2, 'wpn', `Their shields are thinning. ${N} is interested.`, { prio: 2 });
      break;
    case 'enemyLock':
      say('comms', pick(["They're locking on! Keep moving!", "Lock warning! Bertha's cousin is looking at us."]), { prio: 3, key: 'eLock', cd: 12 });
      if (P.target.engines < 4) sayLater(1, 'pilot', "Give me engines and I'll keep us out of that lock.", { prio: 3, key: 'pLock', cd: 25 });
      break;
    case 'inBigLaunch':
      say('comms', eTorp ? pick(["Torpedo away! Incoming!", "Torpedo! Torpedo! That's the one!"]) : pick(["Rail shot!", "They fired the big one!"]), { prio: 4, dur: 4 });
      sayLater(5, 'comms', "They're putting it all back into shields. Window's closing.", { prio: 2, key: 'recover', cd: 20 });
      break;
    case 'inBigEvaded':
      say('pilot', eTorp ? pick(["Torpedo's out of puff. Hmm hmm hmm.", "Ran it dry. Bye bye, torpedo.", "Outran it! Did everyone see that?"])
        : pick(["Hmm hmm hmm... dodged.", "Not today.", "Missed by a mile. Well, a metre."]), { prio: 3, key: 'pEv', cd: 4 });
      sayLater(0.8, 'comms', "Missed us! Ha!", { prio: 2, key: 'cEv', cd: 4 });
      break;
    case 'inBigHit':
      say('comms', pick(["Ow. That one landed.", "Direct hit. On us. Wrong direction."]), { prio: 3, key: 'cHit', cd: 4 });
      sayLater(0.9, 'eng', pick(["She's still flying. Mostly.", "That's going to need tape."]), { prio: 3, key: 'eHit', cd: 4 });
      break;
    case 'eShieldsDown':
      say('comms', pick(["Their shields are down! Hit them!", `Shields down on the ${E.def.name}! Now's our chance!`]), { prio: 4, key: 'eDown', cd: 6 });
      if (P.target.weapons < 6) sayLater(0.7, 'wpn', "Their shields are down! More power to the guns!", { prio: 4, key: 'wKill', cd: 12 });
      break;
    case 'eShieldsUp':
      say('comms', "Their shields are back up. Boo.", { prio: 2, cd: 10 });
      break;
    case 'pShieldsDown':
      say('eng', `Shields are down! Feed her and she'll be back in ${Math.ceil(P.downT / Math.max(0.1, rebootRate(P)))}.`, { prio: 4, key: 'shDown', cd: 6 });
      break;
    case 'pShieldsUp':
      say('eng', pick(["Shields back up. Good girl.", "Shields are back. You're welcome."]), { prio: 2, cd: 8 });
      break;
    case 'bigHit':
      say('wpn', pick([`${N} says hello.`, `${N} connects!`, "Ooh, that one stung them."]), { prio: 2, key: 'bigHit', cd: 5 });
      break;
    case 'bigMiss':
      say('wpn', pick([`${N} missed. She's embarrassed.`, `Wide! ${N} blames the pilot.`]), { prio: 2, key: 'bigMiss', cd: 5 });
      if (Math.random() < 0.5) sayLater(1.1, 'pilot', "I heard that.", { prio: 1, key: 'heard', cd: 30, dur: 3 });
      break;
    case 'win':
      say('comms', pick(["Got 'em! Salvage time!", `${E.def.name} down! Drinks are on ${nm('eng')}!`]), { prio: 5, dur: 8 });
      sayLater(1, 'eng', `Drinks are not on ${nm('eng')}.`, { prio: 5, dur: 7 });
      sayLater(1.7, 'wpn', `Good work, ${N}.`, { prio: 5, dur: 7 });
      break;
    case 'lose':
      say('eng', "Abandon ship! Calmly! In an orderly fashion!", { prio: 5, dur: 8 });
      sayLater(0.6, 'comms', "Mayday, mayday!", { prio: 5, dur: 7 });
      break;
    case 'bumpRock':
      say('pilot', pick(["Rock! Sorry. Rock.", "Who put that there?", "That rock came out of nowhere. Space nowhere."]), { prio: 3, key: 'pRock', cd: 6 });
      sayLater(1, 'eng', pick([`She's not a pinball, ${nm('pilot')}!`, "I just painted that bit."]), { prio: 2, key: 'eRock', cd: 12 });
      break;
    case 'enemyRock':
      say('comms', pick(["Ha! They hit a rock!", `The ${E.def.name} just headbutted an asteroid. Rock wins.`]), { prio: 2, key: 'cRock', cd: 12 });
      break;
    case 'bumpShip':
      say('comms', pick(["We just bumped into them. Rude.", "Contact! Like, actual contact!"]), { prio: 3, key: 'cBump', cd: 8 });
      sayLater(0.9, 'pilot', pick(["They started it.", "Personal space, please."]), { prio: 2, key: 'pBump', cd: 8 });
      sayLater(1.8, 'eng', "Was that a ship or a wall?", { prio: 2, key: 'eBump', cd: 20 });
      break;
    case 'torpRock':
      say('comms', pick(["Torpedo hit a rock! The rock had it coming.", "Rock took the torpedo for us. Good rock."]), { prio: 3, key: 'cTorpRock', cd: 8 });
      break;
    case 'jumpOrder':
      say('comms', `${nm('pilot')}! Get us out of here!`, { prio: 5, dur: 4 });
      sayLater(0.8, 'pilot', pick(["Way ahead of you.", "Say no more. Hold onto something."]), { prio: 5, dur: 4 });
      sayLater(1.6, 'wpn', `${N} and I were just getting started...`, { prio: 5, dur: 4 });
      break;
    case 'clear':
      sayLater(1.5, 'comms', pick(["Area clear. Just us and the rocks now.", "Scanners are quiet. Area clear."]), { prio: 5, dur: 6 });
      sayLater(3.2, 'pilot', "Where to, Captain?", { prio: 5, dur: 6 });
      break;
  }
}

// Ongoing situations, checked a couple of times a second.
function crewPoll() {
  if (!contact) {
    if (time > 6) say('comms', `They're closing. ${Math.max(0, (distance() - RANGE) / 100).toFixed(0)} clicks to weapons range. Set us up, Captain.`, { key: 'closing', cd: 30 });
    return;
  }
  const eBig = bigGun(E), ePct = E.wt[1] / eBig.interval, eTorp = eBig.kind === 'torpedo';
  const inbound = shots.some(s => s.w.kind === 'torpedo' && s.tgt === P && s.homing);
  const charging = E.brain && E.brain.phase === 'charge' && weaponOnline(E, eBig);
  const threat = inbound || (charging && ePct >= 0.75);
  const T = P.target, turret = P.weapons[0], big = bigGun(P), N = nick(), full = P.mods.scan === 'full';
  const what = eTorp ? 'Torpedo' : 'Rail';

  // Comms: the enemy
  if (full && charging && ePct > 0.5 && ePct < 1) say('comms', `${what}'s half charged. Just saying.`, { key: 'eHalf', cd: 20, prio: 2 });
  if (charging && ePct >= 1) say('comms', eTorp ? "Torpedo armed! They're swinging their nose round." : "Their rail's charged! They're lining up.", { key: 'eArmed', cd: 20, prio: 3 });
  if (E.hull < E.def.hullMax * 0.3 && !E.dead) say('comms', pick(["They're smoking. Keep it up!", `The ${E.def.name}'s on fire. In space. Somehow.`]), { key: 'eLow', cd: 60, prio: 2 });

  // Pilot: engines
  if (inbound && (eff(P, 'engines') * 16 + 55) * 1.15 < bigGun(E).speed) say('pilot', "It's gaining on us! More engine and I can outrun it.", { key: 'pOutrun', cd: 10, prio: 4 });
  else if (threat && T.engines < 3) say('pilot', eTorp ? "Torpedo coming. Engines would be lovely, no pressure." : "Rail's about to fire. A bit more engine and I'll make us hard to hit.", { key: 'pThreat', cd: 18, prio: 3 });
  if (weaponOnline(P, big) && P.wt[1] >= big.interval && !inArc(P, big, 1, E) && eff(P, 'engines') < 1.8) say('pilot', `I can't line up ${N} on these engines.`, { key: 'pLine', cd: 30 });
  if (T.engines > P.def.parts.engines.cap) say('pilot', `The drive tops out at ${P.def.parts.engines.cap}. You're just making it warm.`, { key: 'engCap', cd: 25 });
  if (P.spool >= 100 && !P.jumping) say('pilot', "Jump drive's warm, Captain. Say the word.", { key: 'jumpReady', cd: 90, prio: 2 });

  // Weapons
  if (E.down && T.weapons < 6) say('wpn', "Their shields are down! More power to the guns!", { key: 'wKill', cd: 12, prio: 3 });
  else if (!weaponOnline(P, big) && T.weapons < big.min && !threat) say('wpn', big.kind === 'rail' ? `${N} needs ${big.min} power. She won't get out of bed for less.` : `${N} needs ${big.min} power. She's a big girl.`, { key: 'wBig', cd: 35 });
  if (T.weapons === 0) say('wpn', "Guns are cold. Just so you know.", { key: 'wCold', cd: 30 });
  if (weaponOnline(P, turret) && hitChance(P, turret, E) < 0.35) say('wpn', "Long shots only. One in three if I'm lucky.", { key: 'wFar', cd: 40 });
  if (inRange() && !clearShot(P, E) && P.wt[0] >= turret.interval) say('wpn', pick(["Rock in the way! I can't see them.", "There's an asteroid in my shot."]), { key: 'wBlocked', cd: 25 });
  if (T.weapons > P.def.parts.weapons.cap) say('wpn', `${N} maxes out at ${P.def.parts.weapons.cap}. The rest is just noise.`, { key: 'wCap', cd: 25 });

  // Engineer: shields
  if (P.down) { /* handled by the shields-down event */ }
  else if (T.shields === 0) say('eng', "No power to shields? Bold.", { key: 'shZero', cd: 30, prio: 2 });
  else if (threat && T.shields < 4) say('eng', `${what} incoming. Shields or engines, Captain. I know which I'd pick.`, { key: 'eThreat', cd: 20, prio: 3 });
  else if (P.shield < shieldMax(P) * 0.3 && T.shields < 5) say('eng', "Shields are sweating. Another point wouldn't hurt.", { key: 'shLow', cd: 25, prio: 2 });
  if (T.shields > P.def.parts.shields.cap) say('eng', `She can't use more than ${P.def.parts.shields.cap}. You're just warming the pipes.`, { key: 'shCap', cd: 25 });
  if (P.hull < P.def.hullMax * 0.3 && !P.dead) say('eng', "Hull's held together with tape and hope.", { key: 'hullLow', cd: 60, prio: 2 });
}

function crewUpdate(dt) {
  for (let i = later.length - 1; i >= 0; i--) if (time >= later[i].at) { const l = later.splice(i, 1)[0]; say(l.role, l.text, l.o); }
  pollT -= dt;
  if (pollT <= 0) { pollT = 0.5; if (state === 'run' && !outcome) crewPoll(); }
}

// ---- chatter bubbles ----
// Each bubble is placed by hand: a new one lands at the bottom and the older ones slide up by its height,
// so spacing stays even. They fade out after their time, and also as they near the top of the area.
const chatterEl = $('chatter');
let bubs = [];
function postBubble(role, text, prio, dur) {
  const c = crewById(run.crew[role]);
  const b = document.createElement('div');
  b.className = 'bub' + (prio >= 4 ? ' urgent' : '');
  b.style.setProperty('--c', ROLE_COLOR[role]);
  b.innerHTML = `<span class="f" aria-hidden="true">${c.name[0]}</span><span class="t"><b>${c.name}</b></span>`;
  b.querySelector('.t').appendChild(document.createTextNode(text));
  chatterEl.appendChild(b);
  const h = b.offsetHeight + 6;
  bubs.forEach(o => { o.off += h; o.el.style.transform = `translateY(${-o.off}px)`; });
  bubs.push({ el: b, off: 0, born: performance.now(), life: Math.max(3.4, dur) * 1000 });
  SFX.babble(c.voice, text);
  pruneBubbles();
}
function pruneBubbles() {
  const now = performance.now(), top = chatterEl.offsetHeight;
  bubs = bubs.filter(o => {
    const gone = o.off > top || now - o.born > o.life + 1400;
    if (now - o.born > o.life && !o.el.classList.contains('old')) o.el.classList.add('old');
    if (gone) o.el.remove();
    return !gone;
  });
}
function clearChatter() { bubs.forEach(o => o.el.remove()); bubs = []; }

// ---- damage ticks under the ship stats ----
const tickState = {};
function hudTick(who, stat, val) {
  if (!crewLive) return;
  const host = stat === 'evade' ? $(who + '-name') : $(who + '-' + stat);
  const k = who + stat, now = performance.now(), last = tickState[k];
  if (typeof val === 'number' && last && now - last.t < 450 && last.el.isConnected) {
    last.v += val; last.t = now; last.el.textContent = '−' + Math.round(last.v);
    return;
  }
  const el = document.createElement('span');
  el.className = 'tick';
  el.textContent = typeof val === 'number' ? '−' + Math.max(1, Math.round(val)) : val;
  host.appendChild(el);
  tickState[k] = { el, t: now, v: typeof val === 'number' ? val : 0 };
  setTimeout(() => el.remove(), 1500);
}

// ---- readouts ----
function intentText() {
  if (E.dead) return ['Destroyed', 'open'];
  if (!contact) return [`Closing · ${Math.max(0, distance() - RANGE).toFixed(0)} to range`, ''];
  const w = bigGun(E), label = w.label;
  if (E.brain && E.brain.phase === 'charge') {
    const pct = E.wt[1] / w.interval;
    if (!weaponOnline(E, w)) return [`Powering ${label.toLowerCase()}`, 'threat'];
    if (P.mods.scan !== 'full') return [pct < 1 ? `${label} charging` : `${label} ready`, 'threat'];
    if (pct >= 1 && w.kind === 'torpedo' && E.lock[1] > 0) return [`${label} locking ${Math.floor(E.lock[1] * 100)}%`, 'threat'];
    return [pct < 1 ? `${label} ${Math.floor(pct * 100)}%` : `${label} armed`, 'threat'];
  }
  if (E.down) return ['Shields down', 'open'];
  if (!clearShot(E, P)) return ['Behind a rock', ''];
  if (E.brain && E.brain.phase === 'recover') return ['Raising shields', ''];
  return [`${E.weapons[0].name} fire`, ''];
}
function statText(k) {
  if (k === 'shields') {
    if (eff(P, 'shields') < 0.4) return '<span class="off">offline</span>';
    if (P.down) return `<span class="off">down</span> · back in <b>${(P.downT / Math.max(0.1, rebootRate(P))).toFixed(1)}s</b>`;
    return `<b>${P.shield.toFixed(0)}/${shieldMax(P).toFixed(0)}</b> · +${regen(P).toFixed(1)}/s`;
  }
  if (k === 'weapons') {
    const [tw, bw] = P.weapons, ts = weaponStatus(P, tw, 0, E), bs = weaponStatus(P, bw, 1, E);
    const brief = st => st.text.startsWith('charging') ? '' : ' ' + st.text;
    const l = weaponOnline(P, tw) ? `${tw.short} <b>${(hitChance(P, tw, E) * 100).toFixed(0)}%</b>${brief(ts)}` : `<span class="off">${tw.short} off</span>`;
    const r = weaponOnline(P, bw) ? `${bw.nick}${brief(bs) || ' ' + Math.floor(P.wt[1] / bw.interval * 100) + '%'}` : `<span class="off">${bw.nick} needs ${bw.min}</span>`;
    return l + ' · ' + r;
  }
  return `evade <b>${(evasion(P) * 100).toFixed(0)}%</b> · jump <b>${Math.floor(P.spool)}%</b>`;
}

// ---- lock-on boxes (torpedoes) and the off-screen enemy arrow ----
const v3 = () => new THREE.Vector3();
function screenOf(x, y, h) {
  const v = v3().set(x, h || 0, y).project(GL.camera);
  return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, behind: v.z > 1 };
}
function placeLock(el, attacker, target, color) {
  const w = bigGun(attacker);
  const show = state === 'run' && w.kind === 'torpedo' && weaponOnline(attacker, w) && !attacker.dead && !target.dead && !target.hidden && target.warp === 0 &&
    (attacker === P || (attacker.brain && attacker.brain.phase === 'charge'));
  el.hidden = !show;
  if (!show) return;
  const c = screenOf(target.x, target.y, 8), e1 = screenOf(target.x + 46, target.y, 8);
  const size = clamp(Math.hypot(e1.x - c.x, e1.y - c.y) * 2.2, 44, 150);
  const ready = attacker.wt[1] >= w.interval, lk = attacker.lock[1], locked = ready && lk > 0;
  el.style.transform = `translate(${c.x - size / 2}px, ${c.y - size / 2}px)`;
  el.style.width = el.style.height = size + 'px';
  el.style.setProperty('--c', color);
  el.classList.toggle('locked', locked);
  const lbl = el.querySelector('span');
  lbl.textContent = locked ? `LOCK ${Math.floor(lk * 100)}%` : ready ? 'ACQUIRING' : `${Math.floor(attacker.wt[1] / w.interval * 100)}%`;
  el.style.setProperty('--lk', locked ? lk.toFixed(3) : 0);
  if (locked && attacker === E) SFX.lockBeep(lk > 0.7);
}
function placeArrow() {
  const a = $('arrow');
  const show = state === 'run' && E && !E.dead && !E.hidden && E.warp === 0;
  if (!show) { a.hidden = true; return; }
  const s = screenOf(E.x, E.y, 0);
  const top = 110, bottom = H - (parseFloat(chatterEl.style.bottom) || 120) - 10, m = 26;
  const inside = !s.behind && s.x > m && s.x < W - m && s.y > top && s.y < bottom;
  a.hidden = inside;
  if (inside) return;
  const c = screenOf(P.x, P.y, 0);
  let dx = s.x - c.x, dy = s.y - c.y;
  if (s.behind) { dx = -dx; dy = -dy; }
  const ang = Math.atan2(dy, dx);
  const cx = W / 2, cy = (top + bottom) / 2, hw = W / 2 - m, hh = (bottom - top) / 2;
  const k = Math.min(hw / Math.max(1e-3, Math.abs(Math.cos(ang))), hh / Math.max(1e-3, Math.abs(Math.sin(ang))));
  a.style.transform = `translate(${cx + Math.cos(ang) * k - 18}px, ${cy + Math.sin(ang) * k - 18}px)`;
  a.querySelector('i').style.transform = `rotate(${ang}rad)`;
  a.querySelector('span').textContent = (distance() / 100).toFixed(0);
}

// ---------- Consoles: reactor (swipes off to the left) and orders (swipes off to the right) ----------
const ui = { reactor: true, orders: false };
const conR = $('con-reactor'), conO = $('con-orders');
function layoutConsoles() {
  const gap = 8, base = 10;
  let y = base;
  conR.style.transform = ui.reactor ? 'none' : 'translateX(calc(-50vw - 100%))';
  conR.style.bottom = y + 'px';
  if (ui.reactor) y += conR.offsetHeight + gap;
  conO.style.transform = ui.orders ? 'none' : 'translateX(calc(50vw + 100%))';
  conO.style.bottom = y + 'px';
  if (ui.orders) y += conO.offsetHeight + gap;
  chatterEl.style.bottom = y + 'px';
  $('tab-reactor').hidden = ui.reactor;
  $('tab-orders').hidden = ui.orders;
  $('tab-reactor').style.bottom = $('tab-orders').style.bottom = (base + 6) + 'px';
}
function setConsole(which, open) {
  if (ui[which] === open) return;
  ui[which] = open; SFX.swipe(); layoutConsoles();
}
$('tab-reactor').addEventListener('click', () => setConsole('reactor', true));
$('tab-orders').addEventListener('click', () => setConsole('orders', true));
// Swipes: on a console, swipe it away (reactor left, orders right). Elsewhere, swipe from the left half to the right to
// bring the reactor back, or from the right half to the left to bring the orders in.
{
  let sw = null;
  window.addEventListener('pointerdown', ev => {
    SFX.unlock();
    if (!hudEl.classList.contains('on')) return;
    sw = { x: ev.clientX, y: ev.clientY, t: performance.now(), on: ev.target.closest('#con-reactor') ? 'reactor' : ev.target.closest('#con-orders') ? 'orders' : null };
  }, { passive: true });
  window.addEventListener('pointerup', ev => {
    if (!sw) return;
    const dx = ev.clientX - sw.x, dy = ev.clientY - sw.y, dt = performance.now() - sw.t, s0 = sw; sw = null;
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.7 || dt > 900) return;
    if (s0.on === 'reactor' && dx < 0) return setConsole('reactor', false);
    if (s0.on === 'orders' && dx > 0) return setConsole('orders', false);
    if (!s0.on && dx > 0 && s0.x < W * 0.5 && !ui.reactor) return setConsole('reactor', true);
    if (!s0.on && dx < 0 && s0.x > W * 0.5 && !ui.orders) return setConsole('orders', true);
  }, { passive: true });
}
window.addEventListener('resize', () => layoutConsoles());

// ---------- Orders (given through comms) ----------
// Data-driven: each scene shows its own list. hold: seconds to hold before it goes (0 = a tap).
const ORDER_SETS = {
  battle: [{
    id: 'jump', label: 'Get us out of here', hold: 0.9,
    ready: () => state === 'run' && P.spool >= 100 && !P.jumping && !outcome && !P.dead,
    progress: () => P.spool / 100,
    hint: () => P.jumping ? 'Jumping…' : P.spool >= 100 ? 'Hold to jump · lose the salvage' : `Jump drive ${Math.floor(P.spool)}%`,
    run: () => { P.jumping = 2.2 + P.mods.jumpDelay; crewEvent('jumpOrder'); SFX.confirm(); }
  }],
  clear: [{
    id: 'plot', label: 'Plot a jump', hold: 0,
    ready: () => true, progress: () => 1, hint: () => 'Open the system map',
    run: () => openMap(false)
  }]
};
let orders = [], ordersKey = '';
function setOrders(key) {
  if (ordersKey === key) return;
  ordersKey = key; orders = ORDER_SETS[key] || [];
  const list = $('orders'); list.innerHTML = '';
  orders.forEach(o => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'order'; b.id = 'order-' + o.id;
    b.innerHTML = `<span class="lab">${o.label}</span><span class="hint"></span>`;
    o.el = b; o.hintEl = b.querySelector('.hint'); o.holding = null;
    const cancel = () => { o.holding = null; b.style.setProperty('--h', 0); };
    b.addEventListener('pointerdown', ev => {
      if (!o.ready()) { SFX.deny(); return; }
      if (!o.hold) { SFX.ui(); o.run(); return; }
      ev.preventDefault(); o.holding = performance.now(); try { b.setPointerCapture(ev.pointerId); } catch (e) { /* not supported */ }
    });
    b.addEventListener('pointerup', cancel); b.addEventListener('pointercancel', cancel); b.addEventListener('lostpointercapture', cancel);
    b.addEventListener('keydown', ev => { if ((ev.key === 'Enter' || ev.key === ' ') && o.ready()) { ev.preventDefault(); ev.stopPropagation(); o.run(); } });
    list.appendChild(b);
  });
  layoutConsoles();
}
function renderOrders() {
  orders.forEach(o => {
    const r = o.ready();
    if (o.holding && r) {
      const h = (performance.now() - o.holding) / 1000 / o.hold;
      o.el.style.setProperty('--h', Math.min(1, h).toFixed(3));
      SFX.charge(Math.min(1, h));
      if (h >= 1) { o.holding = null; o.el.style.setProperty('--h', 0); o.run(); }
    } else if (o.holding) { o.holding = null; o.el.style.setProperty('--h', 0); }
    o.el.classList.toggle('ready', r);
    o.el.setAttribute('aria-disabled', r ? 'false' : 'true');
    o.el.style.setProperty('--p', clamp(o.progress(), 0, 1).toFixed(3));
    const ht = o.hint(); if (o.hintEl.textContent !== ht) o.hintEl.textContent = ht;
  });
}

const lastHTML = {};
function updateHUD() {
  if (!hudEl.classList.contains('on')) return;
  const pmx = shieldMax(P), emx = shieldMax(E);
  setBar('p-hull', P.hull, P.def.hullMax, P.hull.toFixed(0), P.hull < P.def.hullMax * 0.3);
  setBar('p-sh', P.down ? 0 : P.shield, Math.max(pmx, 1), P.down ? 'DOWN' : P.shield.toFixed(0), P.down);
  setBar('e-hull', E.hull, E.def.hullMax, E.hull.toFixed(0), E.hull < E.def.hullMax * 0.3);
  setBar('e-sh', E.down ? 0 : E.shield, Math.max(emx, 1), E.down ? 'DOWN' : E.shield.toFixed(0), E.down);
  const full = P.mods.scan === 'full';
  $('scan').hidden = !full;
  if (full) [['s', 'shields'], ['w', 'weapons'], ['e', 'engines']].forEach(([c, k]) => { $('eb-' + c).style.width = (E.actual[k] / E.def.reactor * 100) + '%'; });
  const used = SYS.reduce((a, k) => a + P.target[k], 0);
  $('free').textContent = P.def.reactor - used;
  SYS.forEach(k => {
    (pipRows[k] || []).forEach((d, i) => { d.style.setProperty('--f', clamp(P.actual[k] - i, 0, 1).toFixed(3)); d.classList.toggle('tgt', i < P.target[k]); });
    const html = statText(k);
    if (lastHTML[k] !== html) { lastHTML[k] = html; $('stat-' + k).innerHTML = html; }
  });
  const [txt, cls] = intentText(), key = txt + cls;
  if (lastHTML.intent !== key) { lastHTML.intent = key; $('intent').textContent = txt; $('intent').className = 'intent ' + cls; }
  renderOrders();
  if (GL) { placeLock($('lock-p'), P, E, 'var(--weapon)'); placeLock($('lock-e'), E, P, 'var(--danger)'); placeArrow(); }
  pruneBubbles();
}
function hudForBattle() {
  $('p-name').firstChild.textContent = P.def.name;
  $('e-name').firstChild.textContent = E.def.name + (P.key === E.key ? ' (hostile)' : '');
  buildPips();
  ui.reactor = true; ui.orders = false;
  clearChatter();
  for (const k in lastHTML) delete lastHTML[k];
}

// ---- 06-flow.js ----
// ---------- Game flow ----------
// One scene at a time. Each scene has enter (set-up), update (per frame) and pose (where the camera wants to be).
// The 3D view never cuts away: menus sit over the live scene, and cutscenes move the ship and camera.
let scene = 'loading', sceneT = 0, clock = 0, tunnelLevel = 0, mockT = 0;
let mapState = null;
const portrait = () => W / Math.max(1, H) < 1;
const show = (id, on) => { $(id).hidden = !on; };
const OVERLAYS = ['loading', 'menu', 'shipsel', 'crewsel', 'hangar', 'map', 'towed'];

function setStage(o) {
  if (!GL) return;
  GL.station.g.visible = !!o.station;
  GL.fieldGroup.visible = !!o.field;
}
function hud(on) { hudEl.classList.toggle('on', on); if (on) layoutConsoles(); }
function banner(text, sub, ms) {
  const b = $('banner');
  b.querySelector('b').textContent = text; b.querySelector('span').textContent = sub || '';
  b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
  clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('on'), ms || 2600);
}
function flash(color) {
  const f = $('flash'); f.style.background = color || '#fff';
  f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
}
// The ship on its own, for the hangar and cutscenes (the opponent slot is hidden).
function puppet(key, x, y) {
  if (shots) shots.forEach(p => disposeShot(p));
  shots = []; parts = []; rocks = []; state = 'idle'; outcome = null;
  P = makeShip(key, x, y, run.crew, false); P.manual = true; P.h = 0.6; P.ang = -0.5;
  if (run.hull != null) P.hull = run.hull;
  E = makeShip('corsair', 99999, 99999, null, false); E.hidden = true;
  if (GL) buildShips();
}
// Offset a camera pose sideways (positive moves the subject left on screen) and keep both points together.
function sideShift(pos, look, amt) {
  const dir = look.clone().sub(pos).normalize(), right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  pos.addScaledVector(right, amt); look.addScaledVector(right, amt);
}
// Parked on the pad: a still, raised three-quarter view from in front of the nose, with the station behind the ship.
const HANGAR_ANG = 0.08;                                   // parked nose-out, seen three-quarters from the front
const hangarPose = (pos, look) => {
  const k = portrait() ? 1.75 : 1;
  pos.set(P.x + 150 * k, 38 * k + 8, P.y + 78 * k); look.set(P.x - 30, 24, P.y - 12);
  if (!portrait()) sideShift(pos, look, 46);
};

const SCENES = {
  loading: { pose: (pos, look) => { pos.set(0, 900, 900); look.set(0, 0, 0); } },

  // Main menu: two random ships fight it out, filmed low and close, an angle the game itself never uses.
  menu: {
    enter() {
      newBattle(pick(SHIP_KEYS), pick(SHIP_KEYS), { auto: true });
      P.x = -480; P.y = 120; E.x = 480; E.y = -120; contact = true;
      state = 'run'; crewLive = false; mockT = 0;
      setStage({ field: true }); hud(false); cam.rate = 1.2; cam.off = 0;
    },
    update(dt) {
      battleTick(dt); updateMove(P, E, dt); updateMove(E, P, dt); collisions();
      if (outcome) { mockT += dt; if (mockT > 4) { flash('#000'); SCENES.menu.enter(); } }
    },
    pose(pos, look) {
      const live = [P, E].filter(s => !s.blown);
      const mx = live.reduce((a, s) => a + s.x, 0) / Math.max(1, live.length), my = live.reduce((a, s) => a + s.y, 0) / Math.max(1, live.length);
      const a = clock * 0.06, d = clamp(distance() * 0.65 + 380, 520, 1300) * (portrait() ? 1.5 : 1);
      pos.set(mx + Math.cos(a) * d, d * 0.22, my + Math.sin(a) * d); look.set(mx, 10, my);
    }
  },

  shipsel: {
    enter() { puppet(run.ship, PAD.x, PAD.y); setStage({ station: true }); hud(false); state = 'idle'; cam.rate = 2; cam.off = portrait() ? 0.2 : 0; renderShipSel(); },
    update() { P.ang = HANGAR_ANG; },
    pose: hangarPose
  },
  crewsel: {
    enter() { cam.off = portrait() ? 0.26 : 0; renderCrewSel(); },
    update() { P.ang = HANGAR_ANG; },
    pose: hangarPose
  },
  hangar: {
    enter(o) {
      puppet(run.ship, PAD.x, PAD.y); setStage({ station: true }); hud(false); state = 'idle';
      cam.rate = 2; cam.off = portrait() ? 0.2 : 0; renderHangar(o && o.note);
    },
    update() { P.ang = HANGAR_ANG; },
    pose: hangarPose
  },

  // Take-off, side view: lift off the pad, nose up a touch, then away.
  takeoff: {
    enter() {
      puppet(run.ship, PAD.x, PAD.y); P.ang = HANGAR_ANG; P.boost = 0; setStage({ station: true }); hud(false);
      cam.rate = 2.2; cam.off = 0; SFX.thrust(5);
    },
    update(dt) {
      const t = sceneT;
      P.ang = HANGAR_ANG * (1 - ease(clamp((t - 0.8) / 1.6, 0, 1)));   // swing the nose out to open space while lifting
      P.boost = clamp(t / 0.8, 0, 1) * 3;
      if (t > 0.6 && t < 2.4) { const k = ease(clamp((t - 0.6) / 1.8, 0, 1)); P.h = 0.6 + k * 55; P.pitchV = -0.07 * Math.sin(k * Math.PI); }
      if (t > 2.2) { P.speed = Math.min(460, P.speed + dt * 260); P.pitchV = 0.04 * clamp((t - 2.2) / 0.5, 0, 1); }
      else P.speed = 0;
      P.slipX = P.slipY = 0; integrate(P, dt);
      if (t > 5.4) openMap(false);
    },
    pose(pos, look) {
      const fx = PAD.x + clamp(P.x - PAD.x, 0, 1e9) * 0.55, d = portrait() ? 420 : 250;
      pos.set(fx - 30, 58 + P.h * 0.5, PAD.y + d); look.set(fx + 10, P.h * 0.8 + 4, P.y);
    }
  },

  // System map, shown over the live view. At Fortune the ship cruises away from the station; in a field it idles over the wreck.
  map: {
    enter(o) {
      this.inField = !!(o && o.inField);
      hud(false); cam.rate = 1.4;
      if (!this.inField) { P.manual = true; P.speed = 70; P.h = 55; P.pitchV = 0; P.boost = 0; }
      cam.off = portrait() ? 0.18 : 0;
    },
    update(dt) {
      if (this.inField) { if (state === 'run') battleTick(dt); updateMove(P, E, dt); collisions(); }
      else { P.speed += (70 - P.speed) * Math.min(1, dt); integrate(P, dt); }
    },
    pose(pos, look) {
      if (this.inField) return battlePose(pos, look);
      const k = portrait() ? 1.7 : 1;
      pos.set(P.x - 230 * k, P.h + 80 * k, P.y + 170 * k); look.set(P.x + 120, P.h, P.y);
    }
  },

  // Warp tunnel. Normal jumps already know where they're going; an escape from battle picks a destination while in the tunnel.
  warp: {
    enter(o) {
      this.escape = !!(o && o.escape); this.dest = o && o.dest; this.leaving = -1;
      P.manual = true; P.warp = 0; P.hidden = false; P.blown = false; P.trailReset = true; P.h = 20; P.speed = 0; P.slipX = P.slipY = 0; P.pitchV = 0; P.boost = 2;
      E.hidden = true; state = 'idle'; hud(false); crewLive = false; clearChatter();
      shots.forEach(p => disposeShot(p)); shots = [];
      setStage({}); cam.rate = 4; cam.off = this.escape && portrait() ? 0.2 : 0;
      if (!this.escape) SFX.warp();
      if (this.escape) { mapState = { escape: true, sel: null }; renderMap(); show('map', true); }
    },
    update(dt) {
      tunnelLevel = Math.min(1, tunnelLevel + dt * 1.8);
      camShake(1.2);
      if (this.dest && this.leaving < 0 && sceneT > (this.escape ? 1.2 : 2.8)) this.leaving = 0.6;
      if (this.leaving >= 0) {
        this.leaving -= dt;
        if (this.leaving < 0) {
          flash('#fff'); SFX.warpOut(); tunnelLevel = 0;
          run.at = this.dest;
          go(PLACES[this.dest].kind === 'station' ? 'dock' : 'arrive', { dest: this.dest });
        }
      }
    },
    pose(pos, look) {
      // Chase view from behind and a little to the side, built from the ship's heading so it's always in shot.
      const pt = portrait(), k = pt ? 1.7 : 1, side = pt ? 14 : 48, fx = Math.cos(P.ang), fz = Math.sin(P.ang);
      pos.set(P.x - fx * 150 * k - fz * side * k, P.h + 40 * k, P.y - fz * 150 * k + fx * side * k);
      look.set(P.x + fx * 40, P.h + 4, P.y + fz * 40);
    }
  },

  // Drop out of warp into a field, then the camera sweeps from the chase view down to the battle view.
  arrive: {
    enter(o) {
      const place = PLACES[o.dest];
      newBattle(run.ship, pick(SHIP_KEYS), { field: place.kind, hull: run.hull });
      setStage({ field: true }); hud(false);
      P.manual = true; P.speed = 420; P.h = 0; P.ang = Math.atan2(-P.y, -P.x);
      // jump the camera to the chase view behind the ship's new position (hidden by the flash), then sweep
      if (cam.pos) { SCENES.warp.pose.call(SCENES.warp, cam.pos, cam.look); cam.pos.y = 64; }
      cam.rate = 0.75;
      cam.off = 0.06; state = 'idle'; crewReset(); crewLive = true;
      banner(place.name, place.kind === 'ice' ? 'Ice field' : 'Asteroid field', 2600);
    },
    update(dt) {
      if (P.manual) {
        P.speed += (90 - P.speed) * Math.min(1, dt * 1.2);
        P.slipX = P.slipY = 0; integrate(P, dt);
        if (sceneT > 2.2) P.manual = false;
      } else updateMove(P, E, dt);
      updateMove(E, P, dt); collisions();
      if (sceneT > 3.2) {
        hudForBattle(); setOrders('battle'); hud(true);
        state = 'run'; crewEvent('arrive'); go('battle');
      }
    },
    pose: battlePose
  },

  battle: {
    enter() { cam.rate = 2.4; cam.off = 0.06; },
    update(dt) {
      if (state === 'run') { battleTick(dt); updateMove(P, E, dt); updateMove(E, P, dt); collisions(); }
      crewUpdate(dt);
      if (outcome && state === 'run') {
        endTimer -= dt;
        if (endTimer <= 0) {
          if (outcome === 'win') go('clear');
          else if (outcome === 'lose') go('towed');
          else { run.hull = P.hull; go('warp', { escape: true }); }
        }
      }
    },
    pose: battlePose
  },

  clear: {
    enter() {
      run.hull = P.hull;
      banner('Area clear', `${E.def.name} destroyed`, 3200);
      setOrders('clear'); ui.orders = true; layoutConsoles();
      crewEvent('clear');
    },
    update(dt) { battleTick(dt); updateMove(P, E, dt); collisions(); crewUpdate(dt); },
    pose: battlePose
  },

  // Coming home: descend onto the pad, then the hangar with repairs done.
  dock: {
    enter() {
      puppet(run.ship, PAD.x - 460, PAD.y); P.ang = 0; P.h = 150; P.boost = 2;
      setStage({ station: true }); hud(false); cam.rate = 1.6; cam.off = 0; SFX.thrust(4);
      banner('Fortune Station', 'Docking', 2400);
    },
    update(dt) {
      const k = ease(clamp(sceneT / 4, 0, 1));
      P.x = PAD.x - 460 * (1 - k); P.h = 0.6 + 150 * Math.pow(1 - k, 1.6); P.pitchV = 0.06 * (1 - k);
      P.boost = 2 * (1 - k); P.speed = 0;
      if (sceneT > 4) { P.ang = HANGAR_ANG * ease(clamp((sceneT - 4) / 1.6, 0, 1)); cam.rate = 1.3; }   // settle into parking position
      if (sceneT > 6.6) { run.hull = SHIPS[run.ship].hullMax; go('hangar', { note: 'Repairs complete. The ship is good as new.' }); }
    },
    pose(pos, look) {
      if (sceneT > 4) return hangarPose(pos, look);           // touched down: pan round to the front of the ship
      const d = portrait() ? 560 : 320;
      pos.set(PAD.x + 80, 70, PAD.y + d); look.set(P.x * 0.6 + PAD.x * 0.4, P.h * 0.7 + 10, P.y);
    }
  },

  // Lost the ship: fade out, then the tow-home card.
  towed: {
    enter() { $('fade').classList.add('on'); hud(false); crewLive = false; setTimeout(() => { if (scene === 'towed') show('towed', true); }, 1400); },
    update(dt) { if (state === 'run') battleTick(dt); updateMove(E, P, dt); },
    pose: battlePose
  }
};

// Cut the camera straight to the current scene's pose (used behind a flash or fade).
function snapCam() { const sc = SCENES[scene]; if (cam.pos && P) sc.pose.call(sc, cam.pos, cam.look); }
function go(name, o) {
  const prev = scene;
  scene = name; sceneT = 0;
  OVERLAYS.forEach(id => show(id, false));
  const overlay = { menu: 'menu', shipsel: 'shipsel', crewsel: 'crewsel', hangar: 'hangar' }[name];
  if (overlay) show(overlay, true);
  if (name !== 'towed') $('fade').classList.remove('on');
  if (name === 'battle' || name === 'clear') hud(true);
  if (SCENES[name].enter) SCENES[name].enter.call(SCENES[name], o || {}, prev);
  // Jumps between places (menu to hangar, towed home, docking) cut rather than glide across the map.
  const cut = (name === 'shipsel' && prev === 'menu') || (name === 'hangar' && !['shipsel', 'crewsel', 'dock'].includes(prev)) || name === 'dock' || (name === 'menu' && prev !== 'loading');
  if (cut) { if (prev !== 'towed' && name !== 'dock') flash('#000'); snapCam(); }
  if (name === 'warp') snapCam();                         // straight into the chase view, so the camera never swings through the hull
}

// ---------- Menus ----------
function statRows(def) {
  const turret = def.weapons[0], big = def.weapons[1];
  const turretDps = (turret.base + turret.per * (turret.cap - turret.min)) / turret.interval;
  const rows = [
    ['Hull', def.hullMax, 160, def.hullMax],
    ['Reactor', def.reactor, 12, def.reactor + ' units'],
    ['Power transfer', def.transfer, 1, def.transfer.toFixed(1) + '/s'],
    ['Shields', def.parts.shields.cap, 7, 'up to ' + def.parts.shields.cap],
    ['Engines', def.parts.engines.cap * def.parts.engines.eff, 6, Math.round(def.parts.engines.eff * 100) + '% · up to ' + def.parts.engines.cap],
    [turret.name, turretDps, 3, turretDps.toFixed(1) + ' dmg/s'],
    [`${big.name} "${big.nick}"`, big.base, 36, big.base + ' dmg · needs ' + big.min]
  ];
  return rows.map(([l, v, m, t]) => `<div class="srow"><span>${l}</span><i><em style="width:${clamp(v / m, 0.04, 1) * 100}%"></em></i><b>${t}</b></div>`).join('');
}
function renderShipSel() {
  const def = SHIPS[run.ship];
  $('ss-name').textContent = def.name; $('ss-cls').textContent = def.cls; $('ss-blurb').textContent = def.blurb;
  $('ss-stats').innerHTML = statRows(def);
  $('ss-choose').textContent = `Fly the ${def.name}`;
  $('ss-count').textContent = `${SHIP_KEYS.indexOf(run.ship) + 1} / ${SHIP_KEYS.length}`;
}
function cycleShip(d) {
  const i = (SHIP_KEYS.indexOf(run.ship) + d + SHIP_KEYS.length) % SHIP_KEYS.length;
  run.ship = SHIP_KEYS[i]; run.hull = null; SFX.ui();
  puppet(run.ship, PAD.x, PAD.y); renderShipSel();
}
function renderCrewSel() {
  const host = $('cs-list'); host.innerHTML = '';
  ROLES.forEach(r => {
    const row = document.createElement('section'); row.className = 'crow'; row.style.setProperty('--c', ROLE_COLOR[r]);
    row.innerHTML = `<h3>${ROLE_NAME[r]}</h3>`;
    const cards = document.createElement('div'); cards.className = 'ccards';
    CREW[r].forEach(c => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ccard' + (run.crew[r] === c.id ? ' sel' : '');
      b.setAttribute('aria-pressed', run.crew[r] === c.id ? 'true' : 'false');
      b.innerHTML = `<span class="cface">${c.name[0]}</span><span class="cbody"><b>${c.name}</b><em>${c.blurb}</em><span class="plus">${c.plus}</span><span class="minus">${c.minus}</span></span>`;
      b.addEventListener('click', () => {
        run.crew[r] = c.id; SFX.babble(c.voice, 'Reporting for duty, Captain.'); renderCrewSel();
      });
      cards.appendChild(b);
    });
    row.appendChild(cards); host.appendChild(row);
  });
}
function renderHangar(note) {
  const def = SHIPS[run.ship];
  $('hg-name').textContent = def.name;
  $('hg-note').textContent = note || 'Docked at Fortune Station.';
  const hull = run.hull == null ? def.hullMax : run.hull;
  $('hg-hull').innerHTML = `<div class="srow"><span>Hull</span><i><em style="width:${hull / def.hullMax * 100}%"></em></i><b>${Math.round(hull)} / ${def.hullMax}</b></div>`;
  $('hg-crew').textContent = ROLES.map(r => `${nm(r)} (${ROLE_NAME[r].toLowerCase()})`).join(' · ');
}

// ---------- System map ----------
function openMap(escape) {
  mapState = { escape, sel: null };
  if (!escape) go('map', { inField: scene === 'clear' });
  renderMap(); show('map', true);
}
function renderMap() {
  const host = $('map-nodes'); host.innerHTML = '';
  const here = run.at;
  $('map-title').textContent = mapState.escape ? 'Jumping blind. Pick a destination.' : 'Where to, Captain?';
  // route lines from where we are
  const svg = $('map-lines'); svg.innerHTML = '';
  Object.values(PLACES).forEach(p => {
    if (p.key === here) return;
    const a = PLACES[here], l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', a.x * 100); l.setAttribute('y1', a.y * 100); l.setAttribute('x2', p.x * 100); l.setAttribute('y2', p.y * 100);
    l.setAttribute('class', mapState.sel === p.key ? 'route sel' : 'route');
    svg.appendChild(l);
  });
  Object.values(PLACES).forEach(p => {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'node ' + p.kind + (p.key === here ? ' here' : '') + (mapState.sel === p.key ? ' sel' : '');
    b.style.left = p.x * 100 + '%'; b.style.top = p.y * 100 + '%';
    b.innerHTML = `<i></i><span>${p.name}${p.key === here ? '<small>You are here</small>' : ''}</span>`;
    b.disabled = p.key === here;
    b.addEventListener('click', () => { mapState.sel = p.key; SFX.ui(); renderMap(); });
    host.appendChild(b);
  });
  const sel = mapState.sel && PLACES[mapState.sel];
  $('map-info').innerHTML = sel ? `<b>${sel.name}</b><span>${sel.desc}</span>` : '<span>Tap a destination.</span>';
  $('map-go').disabled = !sel;
  $('map-go').textContent = sel ? (mapState.escape ? `Jump to ${sel.name}` : 'Confirm jump') : 'Confirm jump';
  $('map-stay').hidden = mapState.escape || scene !== 'map' || !SCENES.map.inField;
}
$('map-go').addEventListener('click', () => {
  if (!mapState || !mapState.sel) return;
  SFX.confirm(); show('map', false);
  if (mapState.escape) SCENES.warp.dest = mapState.sel;
  else go('warp', { dest: mapState.sel });
});
$('map-stay').addEventListener('click', () => { show('map', false); SFX.ui(); go('clear'); });

// ---------- Buttons ----------
const bind = (id, fn) => $(id).addEventListener('click', ev => { SFX.unlock(); fn(ev); });
bind('m-start', () => { SFX.confirm(); run.hull = null; run.at = 'fortune'; go('shipsel'); });
bind('ss-prev', () => cycleShip(-1));
bind('ss-next', () => cycleShip(1));
bind('ss-back', () => { SFX.ui(); go('menu'); });
bind('ss-choose', () => { SFX.confirm(); run.hull = null; go('crewsel'); });
bind('cs-back', () => { SFX.ui(); go('shipsel'); });
bind('cs-go', () => { SFX.confirm(); go('takeoff'); });
bind('hg-go', () => { SFX.confirm(); go('takeoff'); });
bind('hg-menu', () => { SFX.ui(); go('menu'); });
bind('tw-go', () => { SFX.ui(); run.hull = SHIPS[run.ship].hullMax; run.at = 'fortune'; go('hangar', { note: 'A tug dragged what was left of you home. Repairs are on the house, just this once.' }); });
function syncMute() { document.querySelectorAll('.mute').forEach(b => { b.textContent = SFX.muted ? 'Sound off' : 'Sound on'; b.setAttribute('aria-pressed', SFX.muted ? 'false' : 'true'); }); }
document.querySelectorAll('.mute').forEach(b => b.addEventListener('click', () => { SFX.toggle(); syncMute(); SFX.ui(); }));
syncMute();
function togglePause() {
  if (scene !== 'battle') return;
  if (state === 'run') { state = 'paused'; $('pause').textContent = '▶'; $('pause').setAttribute('aria-label', 'Resume'); banner('Paused', 'Reallocate power, then resume', 99999); }
  else if (state === 'paused') { state = 'run'; $('pause').textContent = 'II'; $('pause').setAttribute('aria-label', 'Pause'); $('banner').classList.remove('on'); }
}
bind('pause', togglePause);
document.querySelectorAll('.pw').forEach(b => b.addEventListener('click', () => adjust(b.dataset.k, +b.dataset.d)));
const keymap = { q: ['shields', 1], a: ['shields', -1], w: ['weapons', 1], s: ['weapons', -1], e: ['engines', 1], d: ['engines', -1] };
window.addEventListener('keydown', ev => {
  if (ev.target && ev.target.classList && ev.target.classList.contains('order')) return;
  const k = ev.key.toLowerCase();
  if (ev.key === ' ' && scene === 'battle') { ev.preventDefault(); togglePause(); return; }
  if (k === 'r' && hudEl.classList.contains('on')) { setConsole('reactor', !ui.reactor); return; }
  if (k === 'o' && hudEl.classList.contains('on')) { setConsole('orders', !ui.orders); return; }
  if (k === 'j') { const o = orders.find(x => x.id === 'jump'); if (o && o.ready()) o.run(); return; }
  const m = keymap[k];
  if (m) adjust(m[0], m[1]);
});

// ---------- Boot + main loop ----------
function resize() {
  DPR = Math.min(1.75, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  if (GL) { GL.renderer.setPixelRatio(DPR); GL.renderer.setSize(W, H, false); GL.camera.aspect = W / H; GL.camera.updateProjectionMatrix(); }
}
window.addEventListener('resize', resize); resize();
window.__duel = () => ({ P, E, stats, shots, rocks, scene, state, run, cam, GL, go, openMap, SCENES });

GL = initGL(); resize();
puppet('kestrel', PAD.x, PAD.y);
if (GL) {
  preloadModels(p => { $('load-bar').style.width = Math.round(p * 100) + '%'; }).then(failed => {
    if (failed) $('load-note').textContent = 'Some models could not be loaded, so stand-in shapes are shown.';
    attachStationModel();
    go('menu');
  });
} else {
  $('load-note').textContent = 'This browser could not start 3D graphics.';
  go('menu');
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt; sceneT += dt;
  const sc = SCENES[scene];
  if (sc.update && P) sc.update.call(sc, dt);
  if (scene !== 'warp') tunnelLevel = Math.max(0, tunnelLevel - dt * 3);
  if (nudgeT > 0) { nudgeT -= dt; if (nudgeT <= 0) $('nudge').classList.remove('on'); }
  if (state !== 'paused') updateFx(dt);
  if (GL) { updateTunnel(clock, tunnelLevel); renderFrame(state === 'paused' ? 0.0001 : dt, clock, (pos, look) => sc.pose.call(sc, pos, look)); }
  if (P && E) updateHUD();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

})();
