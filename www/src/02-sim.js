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
