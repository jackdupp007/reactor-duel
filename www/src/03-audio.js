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
