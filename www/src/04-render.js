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
const SHOT_Y = SHOT_H;
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
// The station model is a disc with a town on top and four landing pads on arms; the ship uses the outer right pad.
// The model is placed so that pad's deck sits at PAD, height 0. A simple pad stands in if the model didn't load.
const PAD = { x: 0, y: 0 };
// pad: the chosen pad's deck centre in model units (outer right of the four pads on the front arms).
const STATION = { url: 'models/station.json', scale: 900, pad: [0.300, 0.238, 0.316] };
const STATION_CENTRE = { x: PAD.x - STATION.pad[0] * STATION.scale, y: PAD.y - STATION.pad[2] * STATION.scale };
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
    p.mesh.position.set(p.x, p.sy ? SHOT_Y + (p.sy - SHOT_Y) * Math.exp(-p.age * 7) : SHOT_Y, p.y);   // turret rounds leave the barrel, then settle
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
