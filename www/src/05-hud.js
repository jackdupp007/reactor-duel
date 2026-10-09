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
