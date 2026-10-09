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
function updateWeapons(s, foe, dt) {
  if (s.dead || s.warp > 0) return;
  const close = inRange() && !foe.dead && foe.warp === 0;
  s.weapons.forEach((w, i) => {
    const online = weaponOnline(s, w);
    if (w.mount === 'turret' && online) {
      const want = angDiff(bearing(s, foe), s.ang);
      const step = traverse(s, w) * DEG * dt;
      s.tr[i] += clamp(angDiff(want, s.tr[i]), -step, step);
      s.tr[i] = angDiff(s.tr[i], 0);
    }
    if (online) {
      s.wt[i] = Math.min(w.interval, s.wt[i] + dt);
      if (s.wt[i] >= w.interval && close && inArc(s, w, i, foe) && clearShot(s, foe)) { s.wt[i] = 0; fire(s, foe, w, i); }
    } else {
      s.wt[i] = Math.max(0, s.wt[i] - dt * (w.kind === 'torpedo' ? 0.4 : 0.15)); // unpowered weapons hold most of their charge
    }
  });
}

function weaponStatus(s, w, i, foe) {
  if (!weaponOnline(s, w)) return { text: `needs ${w.min}`, off: true };
  if (s.wt[i] < w.interval) return { text: `charging ${Math.floor(s.wt[i] / w.interval * 100)}%` };
  if (!inRange()) return { text: 'out of range' };
  if (!clearShot(s, foe)) return { text: 'blocked' };
  if (!inArc(s, w, i, foe)) return { text: w.mount === 'turret' ? 'tracking' : 'lining up' };
  return { text: 'firing' };
}

function fire(s, foe, w, i) {
  const dmg = weaponDmg(s, w);
  const a0 = weaponAim(s, w, i);
  const mb = muzzleBase(s, w), reach = w.mount === 'turret' ? 9 : 30;
  const ox = mb.x + Math.cos(a0) * reach, oy = mb.y + Math.sin(a0) * reach;
  burst(ox, oy, 5, w.color, 70);
  let p;
  if (w.kind === 'torpedo') {
    // Guided: target lock, so only the target's engines can shake it.
    const hit = Math.random() >= evasion(foe) * w.evadeMult;
    p = { x: ox, y: oy, src: s, tgt: foe, w, dmg, hit, life: 24, age: 0, homing: true, missOff: (Math.random() < 0.5 ? -1 : 1) * rand(55, 95), trail: [] };
    p.vx = Math.cos(a0) * w.speed; p.vy = Math.sin(a0) * w.speed;
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
  if (w.kind === 'rail') camShake(3);
  if (w.mount === 'fixed') {
    if (s === E) crewEvent('inBigLaunch');
    if (s.brain) { s.brain.phase = 'recover'; s.brain.t = s.def.ai.recoverT; s.target = { ...s.def.ai.recover }; }
  }
}

function evaded(t, p) {
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
      let tx = t.x, ty = t.y;
      if (!p.hit) {
        const pa = Math.atan2(t.y - p.y, t.x - p.x) + Math.PI / 2;
        tx += Math.cos(pa) * p.missOff; ty += Math.sin(pa) * p.missOff;
      }
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
      if (p.homing) {
        const cur = Math.atan2(p.vy, p.vx), want = Math.atan2(dy, dx);
        const turn = (p.age > 4 ? 4 : 1.2) * dt;
        const na = cur + clamp(angDiff(want, cur), -turn, turn);
        p.vx = Math.cos(na) * p.w.speed; p.vy = Math.sin(na) * p.w.speed;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.trail.push(p.x, p.y); if (p.trail.length > 40) p.trail.splice(0, 2);
      const hitRock = rocks.find(r => Math.hypot(p.x - r.x, p.y - r.y) < r.cr);
      if (hitRock) { rockHit(p, hitRock); continue; }
      if (p.homing) {
        if (p.hit && d < 16) { if (alive) applyDamage(t, p.dmg, p.w.pierce, p); p.life = 0; }
        else if (!p.hit && d < 110) { p.homing = false; jink(t); evaded(t, p); }
      }
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

// A shot strikes an asteroid: sparks and rock dust, and the shot is spent.
function rockHit(p, r) {
  const big = p.w.kind !== 'bolt';
  burst(p.x, p.y, big ? 26 : 8, big ? '#ffd7a0' : p.w.color, big ? 220 : 110);
  burst(p.x, p.y, big ? 14 : 4, fieldKind === 'ice' ? '#bfe6ff' : '#8d8a86', 90);
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
  const col = shielded ? C.shield : (p.w.kind === 'torpedo' ? C.danger : '#ffcf9e');
  burst(p.x, p.y, shielded ? 6 : 12, col, shielded ? 120 : 200);
  const who = t === P ? 'p' : 'e';
  if (shD > 0.2) hudTick(who, 'sh', shD);
  if (hullD > 0.2) hudTick(who, 'hull', hullD);
  SFX.hit(shielded && hullD < 0.5, t === P, p.x, p.y);
  if (p.w.kind === 'torpedo' && t === P) { camShake(9); crewEvent('inBigHit'); }
  if (p.w.kind === 'rail' && t === P) crewEvent('inBigHit');
  if (p.src === P && p.w.mount === 'fixed') crewEvent('bigHit');
  if (p.w.kind === 'ram') camShake(6);
  if (t.hull <= 0 && !t.dead) kill(t);
}

function kill(s) {
  s.dead = true;
  for (let i = 0; i < 4; i++) setTimeout(() => burst(s.x + rand(-12, 12), s.y + rand(-12, 12), 30, i % 2 ? C.weapon : '#fff3d6', 320), i * 140);
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

function burst(x, y, n, color, sp) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), v = rand(sp * 0.2, sp);
    parts.push({ x, y, h: rand(-4, 6), vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.3, 0.8), max: 0.8, color });
  }
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
  const remaining = w.interval - s.wt[1];
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
  const f = Math.pow(0.96, dt * 60);
  for (const q of parts) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= f; q.vy *= f; }
  parts = parts.filter(q => q.life > 0);
}
