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

// ---------- Cutscene flight paths ----------
// A smooth curve (Catmull-Rom) through [x, height, z] points, walked by distance travelled.
function makePath(pts) {
  const ext = (a, b) => a.map((v, k) => 2 * v - b[k]);
  const Q = [ext(pts[0], pts[1]), ...pts, ext(pts[pts.length - 1], pts[pts.length - 2])];
  const smp = [];
  for (let i = 1; i < Q.length - 2; i++) for (let j = 0; j < 40; j++) {
    const t = j / 40, t2 = t * t, t3 = t2 * t, p0 = Q[i - 1], p1 = Q[i], p2 = Q[i + 1], p3 = Q[i + 2];
    smp.push([0, 1, 2].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
  }
  smp.push(pts[pts.length - 1].slice());
  const dist = [0];
  for (let i = 1; i < smp.length; i++) dist.push(dist[i - 1] + Math.hypot(smp[i][0] - smp[i - 1][0], smp[i][1] - smp[i - 1][1], smp[i][2] - smp[i - 1][2]));
  const len = dist[dist.length - 1];
  const at = d => {
    d = clamp(d, 0, len);
    let i = 1; while (i < dist.length - 1 && dist[i] < d) i++;
    const k = (d - dist[i - 1]) / Math.max(1e-6, dist[i] - dist[i - 1]);
    return [0, 1, 2].map(c => smp[i - 1][c] + (smp[i][c] - smp[i - 1][c]) * k);
  };
  return { len, at };
}
// Put a cutscene ship at distance d along a path: position, heading, banking into turns, nose following the climb.
function flyPath(s, path, d, dt) {
  const a = path.at(d), b = path.at(Math.min(path.len, d + 6)), a0 = path.at(Math.max(0, d - 6));
  const ox = s.x, oy = s.y;
  s.x = a[0]; s.h = a[1]; s.y = a[2];
  const ang = Math.atan2(b[2] - a0[2], b[0] - a0[0]);
  const turn = angDiff(ang, s.ang) / Math.max(dt, 1e-3);
  s.ang = ang;
  s.bank += (clamp(turn * 0.9, -0.7, 0.7) - s.bank) * Math.min(1, dt * 3);
  s.pitchV = clamp(-(b[1] - a0[1]) / 12 * 0.25, -0.2, 0.2);
  s.vx = (s.x - ox) / Math.max(dt, 1e-3); s.vy = (s.y - oy) / Math.max(dt, 1e-3); s.speed = Math.hypot(s.vx, s.vy);
}
// Chase view for the fly-bys: behind the ship and out to the side away from the station, so the station fills the background.
function chasePose(pos, look) {
  const k = portrait() ? 1.5 : 1, fx = Math.cos(P.ang), fz = Math.sin(P.ang);
  let sx = -fz, sz = fx;                                     // a side, flipped to point away from the station
  if (sx * (P.x - STATION_CENTRE.x) + sz * (P.y - STATION_CENTRE.y) < 0) { sx = -sx; sz = -sz; }
  pos.set(P.x - fx * 115 * k + sx * 95 * k, P.h + 34 * k, P.y - fz * 115 * k + sz * 95 * k);
  const across = portrait() ? 18 : 45;                       // looking across the ship toward the station (less on a narrow screen)
  look.set(P.x + fx * 40 - sx * across, P.h + 4, P.y + fz * 40 - sz * across);
}
// Arrival skims over the pad arms in front of the town; departure lifts off and runs up the station's right flank.
const LAND_PATH = [[-1250, 170, 260], [-750, 125, 110], [-380, 105, 60], [-170, 80, 40], [-60, 22, 8], [0, 0.6, 0]];
const TAKEOFF_PATH = [[0, 55, 0], [160, 70, -20], [235, 95, -280], [235, 120, -650], [150, 160, -1100]];

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
      cam.rate = 2.2; cam.off = 0; SFX.thrust(7);
      this.path = makePath(TAKEOFF_PATH); this.T = 4.6;
    },
    update(dt) {
      const t = sceneT;
      P.boost = clamp(t / 0.8, 0, 1) * 3;
      if (t < 2.3) {                                           // lift off the pad, swinging the nose out to open space
        P.ang = HANGAR_ANG * (1 - ease(clamp((t - 0.8) / 1.4, 0, 1)));
        const k = ease(clamp((t - 0.6) / 1.7, 0, 1)); P.h = 0.6 + k * 54.4; P.pitchV = -0.07 * Math.sin(k * Math.PI);
        P.vx = P.vy = 0; P.speed = 0;
      } else {                                                 // then away, picking up speed past the station
        const u = clamp((t - 2.3) / this.T, 0, 1);
        flyPath(P, this.path, this.path.len * Math.pow(u, 1.7), dt);
        cam.rate = 2.2 + u * 6;                                  // the camera keeps up as the ship speeds away
      }
      if (t > 2.3 + this.T - 0.4) openMap(false);
    },
    pose(pos, look) {
      if (sceneT >= 2.3) return chasePose(pos, look);
      const d = portrait() ? 420 : 250;
      pos.set(PAD.x - 30, 58 + P.h * 0.5, PAD.y + d); look.set(PAD.x + 10, P.h * 0.8 + 4, P.y);
    }
  },

  // System map, shown over the live view. At Fortune the ship cruises away from the station; in a field it idles over the wreck.
  map: {
    enter(o) {
      this.inField = !!(o && o.inField);
      hud(false); cam.rate = 1.4;
      if (!this.inField) { P.manual = true; P.speed = Math.max(70, P.speed || 0); P.pitchV = 0; P.boost = 0; P.bank = 0; }
      cam.off = portrait() ? 0.18 : 0;
    },
    update(dt) {
      if (this.inField) { if (state === 'run') battleTick(dt); updateMove(P, E, dt); collisions(); }
      else { P.speed += (70 - P.speed) * Math.min(1, dt); integrate(P, dt); }
    },
    pose(pos, look) {
      if (this.inField) return battlePose(pos, look);
      const k = portrait() ? 1.7 : 1, fx = Math.cos(P.ang), fz = Math.sin(P.ang);
      pos.set(P.x - fx * 230 * k - fz * 170 * k, P.h + 80 * k, P.y - fz * 230 * k + fx * 170 * k); look.set(P.x + fx * 120, P.h, P.y + fz * 120);
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
      this.path = makePath(LAND_PATH); this.T = 6.5; this.landedAng = null;
      puppet(run.ship, LAND_PATH[0][0], LAND_PATH[0][2]); P.boost = 2; P.bank = 0;
      flyPath(P, this.path, 0, 1 / 60); P.trailReset = true;
      setStage({ station: true }); hud(false); cam.rate = 2.6; cam.off = 0; SFX.thrust(6);
      banner('Fortune Station', 'Docking', 2400);
    },
    update(dt) {
      const u = clamp(sceneT / this.T, 0, 1);
      if (u < 1) {                                             // in fast past the pads and town, slowing all the way to the pad
        flyPath(P, this.path, this.path.len * (1 - Math.pow(1 - u, 2.4)), dt);
        P.boost = 2 * (1 - u) + 0.3;
      } else {                                                 // down: settle into the parking spot
        const k = ease(clamp((sceneT - this.T) / 1.6, 0, 1));
        if (!this.landedAng && this.landedAng !== 0) this.landedAng = P.ang;
        P.ang = this.landedAng + angDiff(HANGAR_ANG, this.landedAng) * k;
        P.h = 0.6; P.bank *= 0.9; P.pitchV *= 0.9; P.boost = 0; P.vx = P.vy = 0; P.speed = 0;
        cam.rate = 1.3;
      }
      if (sceneT > this.T + 2.6) { this.landedAng = null; run.hull = SHIPS[run.ship].hullMax; go('hangar', { note: 'Repairs complete. The ship is good as new.' }); }
    },
    pose(pos, look) {
      if (sceneT > this.T - 0.6) return hangarPose(pos, look);   // touching down: pan round to the front of the ship
      return chasePose(pos, look);
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
  const turretDps = (turret.base + turret.per * (turret.cap - turret.min)) * (turret.burst || 1) / turret.interval;   // at full power, every round of a burst
  const rows = [
    ['Hull', def.hullMax, 160, def.hullMax],
    ['Reactor', def.reactor, 12, def.reactor + ' units'],
    ['Power transfer', def.transfer, 1, def.transfer.toFixed(1) + '/s'],
    ['Shields', def.parts.shields.cap, 7, 'up to ' + def.parts.shields.cap],
    ['Engines', def.parts.engines.cap * def.parts.engines.eff, 6, Math.round(def.parts.engines.eff * 100) + '% · up to ' + def.parts.engines.cap],
    [turret.name, turretDps, 4, turretDps.toFixed(1) + ' dmg/s' + (turret.burst ? ` · ${turret.burst}-round bursts` : '')],
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
window.__duel = () => ({ P, E, stats, shots, rocks, scene, sceneT, state, run, cam, GL, go, openMap, SCENES });

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
