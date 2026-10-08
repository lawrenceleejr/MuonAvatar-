/*!
 * Mu — an animated wave-packet mascot for a muon collider.
 * Requires p5.js (instance mode). No other dependencies.
 *
 *   const mu = MuonMascot.mount(document.getElementById('stage'), { voiceBase: 'voices/' });
 *   mu.birth();  mu.wander();  mu.hop();  mu.say('hello');  mu.morph('ring');  mu.collide();
 *
 * The line is the character. Each muon is a Gaussian wave packet riding the line:
 *
 *   d(s) = g(s) · [ A cos(k s − ω t)  +  G · a_LP(s) ]
 *
 * where g is the envelope (skewed toward the direction of travel), and a_LP is the low-passed speech waveform around the playhead,
 * stretched across the packet. Speaking therefore animates itself.
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const N = 520;                  // samples along the line
  const DW = 1000, DH = 420;      // design space; everything scales from here
  const BASE_Y = 265;
  const AMP = 42, SIG = 38;      // the packet at rest: height and width (design px)

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mod = (x, m) => ((x % m) + m) % m;
  let seed = 0x9e3779b9;
  const rnd = () => {   // mulberry32: reproducible, so a rendered video is the same every time
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rand = (a, b) => a + rnd() * (b - a);

  const Ease = {
    linear: t => t,
    inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: t => 1 - Math.pow(1 - t, 3),
    in: t => t * t * t,
    outBack: t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    outElastic: t => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * TAU / 3) + 1),
    jelly: t => (t >= 1 ? 1 : 1 - Math.exp(-5.5 * t) * Math.cos(9.5 * t)),
  };

  // ------------------------------------------------------------------ shapes
  // Each shape is a dense polyline in design space, resampled to N points uniform in arc length.

  function resample(pts) {
    const S = [0];
    for (let i = 1; i < pts.length; i++) {
      S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const L = S[S.length - 1];
    const out = new Float32Array(N * 2);
    let j = 0;
    for (let i = 0; i < N; i++) {
      const s = (i / (N - 1)) * L;
      while (j < pts.length - 2 && S[j + 1] < s) j++;
      const t = (s - S[j]) / Math.max(1e-9, S[j + 1] - S[j]);
      out[2 * i] = lerp(pts[j][0], pts[j + 1][0], t);
      out[2 * i + 1] = lerp(pts[j][1], pts[j + 1][1], t);
    }
    return out;
  }

  function sampleFn(f, n = 3000) {
    const p = [];
    for (let i = 0; i <= n; i++) p.push(f(i / n));
    return p;
  }

  function catmull(ctrl, per = 40) {
    const p = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      for (let k = 0; k < per; k++) {
        const t = k / per, t2 = t * t, t3 = t2 * t;
        p.push([0, 1].map(d => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t +
          (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
      }
    }
    p.push(ctrl[ctrl.length - 1]);
    return p;
  }

  const X0 = 60, X1 = 940;
  const SHAPES = {
    flat: { pts: sampleFn(u => [lerp(X0, X1, u), BASE_Y]) },
    hills: {
      pts: sampleFn(u => {
        const x = lerp(X0, X1, u);
        return [x, BASE_Y - 120 * Math.exp(-Math.pow((x - 500) / 120, 2)) - 45 * Math.exp(-Math.pow((x - 215) / 70, 2)) - 45 * Math.exp(-Math.pow((x - 785) / 70, 2))];
      }),
    },
    wave: { pts: sampleFn(u => [lerp(X0, X1, u), BASE_Y - 55 * Math.sin(TAU * 2.5 * u)]) },
    ring: { closed: true, pts: sampleFn(u => { const a = Math.PI / 2 - TAU * u; return [500 + 150 * Math.cos(a), 205 + 150 * Math.sin(a)]; }) },
    loop: {
      pts: (() => {
        const p = sampleFn(u => [lerp(X0, 455, u), BASE_Y], 400);
        for (let i = 1; i <= 800; i++) {
          const f = (i / 800) * TAU;
          p.push([455 + 90 * f / TAU + 100 * Math.sin(f), BASE_Y - 100 * (1 - Math.cos(f))]);
        }
        return p.concat(sampleFn(u => [lerp(545, X1, u), BASE_Y], 400).slice(1));
      })(),
    },
    mu: {
      // the letter μ, written in one stroke
      // repeated points make sharp corners, so stems are drawn down-and-back like a pen would
      pts: catmull([
        [X0, BASE_Y], [300, BASE_Y], [350, BASE_Y + 4], [378, BASE_Y + 40], [384, BASE_Y + 88], [384, BASE_Y + 88],
        [392, 150], [392, 150], [394, BASE_Y - 40], [410, BASE_Y - 2], [440, BASE_Y + 4], [466, BASE_Y - 14],
        [478, BASE_Y - 50], [482, 150], [482, 150], [484, BASE_Y - 22], [494, BASE_Y + 2], [520, BASE_Y - 4],
        [560, BASE_Y], [700, BASE_Y], [X1, BASE_Y],
      ], 60),
    },
    heart: {
      closed: true,
      pts: sampleFn(u => {
        const t = Math.PI - TAU * u, s = Math.sin(t);
        return [500 + 9.5 * 16 * s * s * s, 140 - 9.5 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))];
      }),
    },
  };
  for (const k in SHAPES) SHAPES[k].xy = resample(SHAPES[k].pts);
  // where the μ glyph sits along the line; riders keep off it so their packet stays legible
  SHAPES.mu.avoid = (() => {
    const xy = SHAPES.mu.xy; let a = 1, b = 0;
    for (let i = 0; i < N; i++) if (Math.abs(xy[2 * i + 1] - BASE_Y) > 3) { a = Math.min(a, i / (N - 1)); b = Math.max(b, i / (N - 1)); }
    return [a - 0.06, b + 0.06];
  })();

  // ------------------------------------------------------------------ tweens & cancellable acts
  const CANCEL = { cancelled: true };

  class Clock {
    constructor() { this.t = 0; this.items = []; }
    to(obj, props, dur, ease = Ease.inOut, delay = 0) {
      return new Promise(res => this.items.push({ obj, props, dur: Math.max(1e-4, dur), ease, start: this.t + delay, from: null, res }));
    }
    wait(sec) { return new Promise(res => this.items.push({ start: this.t + sec, dur: 0, res })); }
    until(fn) { return new Promise(res => this.items.push({ until: fn, res })); }
    clear() { const it = this.items; this.items = []; it.forEach(i => i.res()); }
    update(dt) {
      this.t += dt;
      const items = this.items, keep = [];
      this.items = [];
      for (const it of items) {
        if (it.until) { if (it.until()) it.res(); else keep.push(it); continue; }
        if (this.t < it.start) { keep.push(it); continue; }
        if (!it.props) { it.res(); continue; }
        if (!it.from) { it.from = {}; for (const k in it.props) it.from[k] = it.obj[k]; }
        const p = clamp((this.t - it.start) / it.dur, 0, 1), e = it.ease(p);
        for (const k in it.props) it.obj[k] = lerp(it.from[k], it.props[k], e);
        if (p >= 1) it.res(); else keep.push(it);
      }
      // promise callbacks run as microtasks, so anything added now lands after this frame
      this.items = keep.concat(this.items);
    }
  }

  // ------------------------------------------------------------------ audio
  // Speech is decoded once, low-passed in JS (two cascaded RBJ biquads = 4 poles), and read back at the
  // playhead every frame. Reading by playhead rather than from an AnalyserNode keeps the animation
  // frame-exact, which is what lets capture mode render video in sync with the voice.
  function lowpass(x, sr, fc, Q = 0.6) {
    const w = TAU * Math.min(fc, sr * 0.45) / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * Q), a0 = 1 + al;
    const b0 = (1 - cw) / 2 / a0, b1 = (1 - cw) / a0, b2 = b0, a1 = -2 * cw / a0, a2 = (1 - al) / a0;
    let y = x;
    for (let pass = 0; pass < 2; pass++) {
      const out = new Float32Array(y.length);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < y.length; i++) {
        const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = y[i]; y2 = y1; y1 = v; out[i] = v;
      }
      y = out;
    }
    return y;
  }

  class Voice {
    constructor(base, opts) {
      this.base = base.endsWith('/') ? base : base + '/';
      this.opts = opts;
      this.ctx = null;
      this.cache = {};
      this.filt = {};
      this.lines = {};
      this.ready = fetch(this.base + 'manifest.json')
        .then(r => r.json())
        .then(list => { list.forEach(l => (this.lines[l.id] = l)); return list; })
        .catch(() => []);
    }
    unlock() {
      if (this.opts.capture) return null;
      if (!this.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    buffer(id) {
      const line = this.lines[id];
      if (!line) return Promise.reject(new Error('unknown voice line: ' + id));
      if (!this.cache[id]) {
        const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
        const dec = new OAC(1, 1, 24000);
        this.cache[id] = fetch(this.base + line.file).then(r => r.arrayBuffer()).then(b => dec.decodeAudioData(b));
      }
      return this.cache[id];
    }
    preload() { return this.ready.then(list => Promise.all(list.map(l => this.buffer(l.id)))); }
    filtered(sp) {
      const fc = Math.round(this.opts.lowpass / 10) * 10, key = sp.id + '@' + fc;
      if (!this.filt[key]) this.filt[key] = lowpass(sp.buffer.getChannelData(0), sp.sr, fc);
      return this.filt[key];
    }
    async start(id, scene) {
      await this.ready;
      const buffer = await this.buffer(id);
      const pitch = this.opts.pitch;
      const sp = { id, line: this.lines[id], buffer, sr: buffer.sampleRate, dur: buffer.duration / pitch, src: null };
      const ctx = this.unlock();
      if (ctx && ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 300))]);
      if (ctx && ctx.state === 'running') {
        const src = ctx.createBufferSource();
        src.buffer = buffer; src.playbackRate.value = pitch; src.connect(ctx.destination);
        const t0 = ctx.currentTime + 0.02;
        src.start(t0);
        sp.src = src;
        sp.pos = () => Math.max(0, (ctx.currentTime - t0) * pitch);
        sp.ended = new Promise(res => (src.onended = res));
      } else {
        // silent (capture, or before the visitor has clicked): run on the scene clock
        const t0 = scene.t;
        sp.pos = () => (scene.t - t0) * pitch;
        sp.ended = scene.until(() => scene.t >= t0 + sp.dur);
        scene.log.push({ id, file: sp.line.file, t: t0, pitch });
      }
      return sp;
    }
  }

  // ------------------------------------------------------------------ faces
  // Each mood is a target pose; the face springs toward it, so changes overshoot and settle.
  // lid/low: upper and lower eyelid cover (0–1); tilt: lid slant (+ = inner corner down);
  // browY: brow lift (px); browA: brow slant (+ = angry); asym: extra lift on one brow.
  const MOODS = {
    normal:     { lid: 0.16, tilt: 0,     low: 0,    browY: 0,   browA: 0.05,  pupil: 1,    size: 1,    asym: 0, omega: 9 },
    happy:      { lid: 0.04, tilt: -0.05, low: 0.56, browY: 5,   browA: -0.15, pupil: 1.05, size: 1.02, asym: 0, omega: 15 },
    surprised:  { lid: 0,    tilt: 0,     low: 0,    browY: 12,  browA: -0.08, pupil: 0.6,  size: 1.18, asym: 0, omega: 12 },
    determined: { lid: 0.38, tilt: 0.4,   low: 0.2,  browY: -4,  browA: 0.55,  pupil: 0.85, size: 0.95, asym: 0, omega: 13 },
    sleepy:     { lid: 0.56, tilt: -0.1,  low: 0.12, browY: -2,  browA: -0.1,  pupil: 0.95, size: 0.98, asym: 0, omega: 4.5 },
    sad:        { lid: 0.3,  tilt: -0.34, low: 0,    browY: 3,   browA: -0.5,  pupil: 1.18, size: 1,    asym: 0, omega: 6 },
    smug:       { lid: 0.44, tilt: 0.04,  low: 0.26, browY: 0,   browA: 0.12,  pupil: 0.9,  size: 1,    asym: 9, omega: 8 },
    dizzy:      { lid: 0.12, tilt: 0,     low: 0,    browY: 6,   browA: -0.3,  pupil: 1,    size: 1.05, asym: 0, omega: 18 },
  };

  // ------------------------------------------------------------------ one muon
  class Muon {
    constructor(name, sign, color) {
      this.name = name; this.sign = sign; this.color = color;
      this.u = 0.5; this.vel = 0; this.target = null; this.maxSpeed = 0.22; this.accel = 6;
      this.dir = 1; this.lean = 0; this.leanV = 0; this.spin = 0; this.flip = null; this.crouch = false; this.bob = 0;
      this.amp = 0; this.sigma = 34; this.k = 0.19; this.omega = 9; this.phase = rand(0, TAU);
      this.eye = 0; this.eyeLift = 0; this.blink = 0; this.nextBlink = rand(1, 3);
      this.sx = 1; this.sy = 1; this.svx = 0; this.svy = 0;
      this.mood = 'normal'; this.dizzy = 0;
      this.look = { x: 0, y: 0 }; this.lookAt = null;
      this.jump = 0; this.jumpV = 0; this.airborne = false;
      this.alive = false;
      this.speech = null; this.win = null; this.peak = 0.05; this.rms = 0; this.talk = 0;
      this.ex = {}; this.exv = {};
      for (const k in MOODS.normal) { this.ex[k] = MOODS.normal[k]; this.exv[k] = 0; }
      this.wink = 0; this.sacc = { x: 0, y: 0 }; this.nextSacc = 1;
      this.caption = ''; this.captionA = 0;
    }
    get speaking() { return !!this.speech; }
  }

  // ------------------------------------------------------------------ the scene
  class Scene {
    constructor(el, opts) {
      this.el = el;
      this.o = Object.assign({
        voiceBase: 'voices/',
        lowpass: 420,          // Hz, speech low-pass before it is added to the packet
        speechGain: 1.0,       // G: speech amplitude relative to the packet amplitude
        speechWindow: 40,      // ms of low-passed speech stretched across the packet
        wobble: 1.8,           // hand-drawn line: jitter (design px)
        boilFps: 10,           // how often the hand-drawn wobble is redrawn
        inkWeight: 2.6,        // line weight (design px)
        capture: null,         // { fps } renders on demand for video; see tools/render_videos.js
        background: null,      // fill colour; null keeps the canvas transparent
        seed: 7,
        pitch: 1.0,            // playbackRate for voice lines
        carrier: 0.19,         // k, rad per design px
        captions: true,
        autoBirth: false,
        colors: null,
      }, opts || {});
      seed = this.o.seed >>> 0;
      this.log = [];
      this.clock = new Clock();
      this.voice = new Voice(this.o.voiceBase, this.o);
      this.epoch = 0;
      this.t = 0;
      this.reveal = 0;
      this.mu = [new Muon('μ⁻', -1, 'mu'), new Muon('μ⁺', +1, 'anti')];
      this.mu[1].u = 0.8;
      this.cur = Float32Array.from(SHAPES.flat.xy);
      this.shape = 'flat';
      this.closed = false;
      this.morphState = null;
      this.ripples = [];
      this.events = [];
      this.mouse = null;
      this.shake = 0;
      this._buf = { bx: new Float32Array(N), by: new Float32Array(N), nx: new Float32Array(N), ny: new Float32Array(N),
        S: new Float32Array(N), D: new Float32Array(N), W: new Float32Array(N), C: new Int8Array(N) };
      this.readColors();
      const mq = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)');
      if (mq && mq.addEventListener) mq.addEventListener('change', () => this.readColors());
      new global.p5(p => this.sketch(p), el);
    }

    readColors() {
      const cs = getComputedStyle(this.el);
      const v = (name, fb) => (cs.getPropertyValue(name) || '').trim() || fb;
      const dark = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches &&
        document.documentElement.getAttribute('data-theme') !== 'light';
      const c = Object.assign({
        ink: v('--mu-ink', dark ? '#e8e6df' : '#1d1d1b'),
        paper: v('--mu-paper', dark ? '#1b1b19' : '#fffff8'),
        mu: v('--mu-minus', dark ? '#ff7a63' : '#b33a2a'),
        anti: v('--mu-plus', dark ? '#6fb2ff' : '#2a64a0'),
        font: v('--mu-font', '"EB Garamond", Georgia, serif'),
      }, this.o.colors || {});
      c.family = c.font.split(',')[0].replace(/["']/g, '').trim();
      this.c = c;
      // canvas text never triggers a web font's lazily loaded subsets (Greek, here), so ask for them
      this.fontsReady = document.fonts && document.fonts.load
        ? Promise.all(['italic 20px', '20px'].map(f => document.fonts.load(`${f} "${c.family}"`, 'μ⁻⁺“”'))).catch(() => null)
        : Promise.resolve();
    }

    // ---------------- acts: one choreography at a time; a new act cancels the old
    act(fn) {
      const ep = ++this.epoch;
      this.clock.clear();
      this.mu.forEach(m => {
        if (!m.alive) return;
        m.target = null; m.maxSpeed = 0.22; m.accel = 6; m.lookAt = null;
        if (m.mood !== 'dizzy') m.mood = 'normal';
        this.clock.to(m, { amp: AMP, sigma: SIG, eye: 1, blink: 0 }, 0.4, Ease.out);
      });
      const guard = p => Promise.resolve(p).then(v => { if (ep !== this.epoch) throw CANCEL; return v; });
      const run = (async () => { await null; return fn(guard); })();
      return run.catch(e => { if (e !== CANCEL) throw e; });
    }
    wait(s) { return this.clock.wait(s); }
    tween(o, p, d, e, delay) { return this.clock.to(o, p, d, e, delay); }
    until(f) { return this.clock.until(f); }

    // ---------------- geometry
    morph(name, dur = 1.3) {
      if (!SHAPES[name] || name === this.shape) return Promise.resolve();
      this.morphState = { from: Float32Array.from(this.cur), to: SHAPES[name].xy, t: 0, dur };
      const wasClosed = this.closed;
      this.shape = name;
      this.closed = !!SHAPES[name].closed;
      if (wasClosed && !this.closed) this.mu.forEach(m => { m.u = mod(m.u, 1); if (m.target != null) m.target = clamp(mod(m.target, 1), 0.05, 0.95); });
      // the line jiggles the riders when it moves
      this.mu.forEach(m => {
        if (!m.alive) return;
        m.svy += 4;
        if (!m.airborne && !m.crouch) {
          m.airborne = true; m.jumpV = 260; m.sy = 1.25;
          const was = m.mood; m.mood = 'surprised';
          this.clock.wait(0.7).then(() => { if (m.mood === 'surprised') m.mood = was === 'surprised' ? 'normal' : 'happy'; })
            .then(() => this.clock.wait(0.8)).then(() => { if (m.mood === 'happy') m.mood = 'normal'; });
        }
        const av = SHAPES[name].avoid;
        if (av && m.u > av[0] && m.u < av[1]) { m.target = this.offGlyph(m.u); m.maxSpeed = 0.5; }
      });
      return this.until(() => !this.morphState);
    }

    offGlyph(u) {
      const av = SHAPES[this.shape].avoid;
      if (!av || u < av[0] || u > av[1]) return u;
      return u - av[0] < av[1] - u ? av[0] : av[1];
    }

    pos(m) { return this.closed ? mod(m.u, 1) : clamp(m.u, 0.02, 0.98); }

    // ---------------- muon behaviours (all return promises)
    async _birth(m, g, at = 0.5, quick = false) {
      m.u = at; m.amp = 0; m.sigma = 6; m.eye = 0; m.blink = 1; m.alive = true; m.mood = 'normal';
      m.k = this.o.carrier; m.vel = 0; m.target = null; m.jump = 0;
      if (!quick) {
        // a tremor in the line first
        this.ripple(at, 7, 0.9, 0.012);
        await g(this.wait(0.9));
      }
      await g(Promise.all([
        this.tween(m, { amp: AMP, sigma: SIG }, quick ? 0.6 : 1.1, Ease.outElastic),
      ]));
      m.mood = quick ? 'normal' : 'sleepy';
      await g(this.tween(m, { eye: 1 }, 0.5, Ease.outBack));
      await g(this.tween(m, { blink: 0 }, 0.18, Ease.out));
      if (!quick) { await g(this.wait(0.35)); m.mood = 'surprised'; await g(this.wait(0.5)); m.mood = 'normal'; }
      if (!quick) {
        m.lookAt = { x: -1, y: 0 }; await g(this.wait(0.45));
        m.lookAt = { x: 1, y: 0 }; await g(this.wait(0.45));
        m.lookAt = { x: 0, y: -0.6 }; await g(this.wait(0.3));
        m.lookAt = null;
      }
      m.mood = 'happy'; m.svy += 6;
      await g(this.wait(0.6));
      m.mood = 'normal';
    }

    moveTo(m, u, speed = 0.22) {
      // lean back before setting off, like winding up
      if (Math.abs(u - m.u) > 0.03 && Math.abs(m.vel) < 0.05) m.leanV -= Math.sign(u - m.u) * 7;
      m.target = u; m.maxSpeed = speed;
      return this.until(() => !m.alive || (Math.abs(m.target - m.u) < 0.004 && Math.abs(m.vel) < 0.03));
    }

    async hopOnce(m, h = 1, flip = false) {
      if (!m.alive || m.airborne || m.crouch) return;
      // anticipation: crouch into the line first
      m.crouch = true; m.sx = 1.3; m.sy = 0.68; m.svx = m.svy = 0;
      await this.tween(m, { amp: 20 }, 0.13, Ease.out);
      m.crouch = false;
      m.airborne = true; m.jumpV = 370 * h; m.sx = 0.8; m.sy = 1.32;
      if (flip) m.flip = { t: 0, dur: 0.32 + 0.12 * h, dir: m.dir || 1 };
      this.tween(m, { amp: AMP * 1.6 }, 0.12, Ease.out).then(() => this.tween(m, { amp: AMP }, 0.75, Ease.outElastic));
      await this.until(() => !m.airborne);
    }

    async shimmy(m, n = 4) {
      for (let i = 0; i < n; i++) { m.leanV += (i % 2 ? 1 : -1) * 11; m.svx += 3; await this.wait(0.13); }
    }

    async speak(m, id) {
      if (!m.alive) return;
      this.stopSpeech(m);
      let s = null;
      try { s = await this.voice.start(id, this); } catch (e) { console.warn(e); }
      if (!s) return;
      m.speech = s; m.peak = 0.05;
      m.caption = this.o.captions && s.line ? s.line.text : ''; m.captionQuote = true;
      await s.ended;
      if (m.speech === s) m.speech = null;
    }

    stopSpeech(m) {
      if (m.speech) { try { m.speech.src && m.speech.src.stop(); } catch (e) { /* already stopped */ } m.speech = null; }
    }

    ripple(u, amp = 10, life = 1.6, k = 0.08) { this.ripples.push({ u, amp, life, age: 0, k, c: 380 }); }

    burst(x, y) {
      const tracks = [];
      const n = 14;
      for (let i = 0; i < n; i++) {
        const charged = rnd() < 0.8;
        tracks.push({
          a: rand(0, TAU), k: charged ? rand(-0.012, 0.012) : 0, kk: charged ? rand(-0.00004, 0.00004) : 0,
          L: rand(80, 260), col: charged ? (rnd() < 0.5 ? 'mu' : 'anti') : 'ink', dashed: !charged,
        });
      }
      this.events.push({ x, y, age: 0, life: 2.6, tracks });
      this.shake = 1;
    }

    // ---------------- public choreography
    birth() {
      return this.act(async g => {
        this.mu.forEach(m => this.stopSpeech(m));
        const live = this.mu.filter(m => m.alive);
        if (live.length) {
          await g(Promise.all(live.map(m => this.tween(m, { amp: 0, eye: 0, sigma: 8 }, 0.45, Ease.in))));
          live.forEach(m => (m.alive = false));
          await g(this.morph('flat', 0.9));
        }
        if (this.reveal < 1) await g(this.tween(this, { reveal: 1 }, 1.0, Ease.inOut));
        await this._birth(this.mu[0], g, 0.5);
        this.speak(this.mu[0], 'hello');
        await g(this.wait(2.2));
        return this._wander(g);
      });
    }

    async _ensureAlive(g) {
      if (!this.reveal) await g(this.tween(this, { reveal: 1 }, 0.8));
      if (!this.mu[0].alive) await this._birth(this.mu[0], g, 0.5, true);
    }

    wander() { return this.act(async g => { await this._ensureAlive(g); return this._wander(g); }); }

    async _wander(g) {
      const loops = this.mu.filter(m => m.alive).map(m => (async () => {
        for (;;) {
          const r = rnd();
          if (r < 0.12) { await g(this.hopOnce(m, rand(0.7, 1.2))); }
          else if (r < 0.2) { m.mood = 'happy'; await g(this.hopOnce(m, 1.35, true)); await g(this.wait(0.5)); m.mood = 'normal'; }
          else if (r < 0.27) { m.mood = 'happy'; await g(this.shimmy(m, 6)); m.mood = 'normal'; }
          else if (r < 0.33) {
            m.mood = 'surprised'; m.lookAt = { x: 0, y: -1 }; await g(this.wait(0.5));
            m.lookAt = { x: -1, y: -0.2 }; await g(this.wait(0.35)); m.lookAt = { x: 1, y: -0.2 }; await g(this.wait(0.35));
            m.lookAt = null; m.mood = 'normal';
          }
          else if (r < 0.39) { m.mood = 'happy'; for (let i = 0; i < 3; i++) await g(this.hopOnce(m, 0.45)); m.mood = 'normal'; }
          else if (r < 0.43) { m.mood = 'sleepy'; await g(this.wait(rand(1, 1.8))); m.mood = 'surprised'; await g(this.shimmy(m, 4)); m.mood = 'normal'; }
          else {
            let tgt = this.closed ? m.u + rand(-0.6, 0.6) : rand(0.08, 0.92);
            tgt = this.offGlyph(tgt);
            await g(this.moveTo(m, tgt, rand(0.12, 0.3)));
            if (rnd() < 0.3) await g(this.hopOnce(m, rand(0.5, 1)));
          }
          await g(this.wait(rand(0.3, 1.4)));
        }
      })());
      return Promise.all(loops);
    }

    hop() {
      return this.act(async g => {
        await this._ensureAlive(g);
        const ms = this.mu.filter(m => m.alive);
        for (let i = 0; i < 3; i++) await g(Promise.all(ms.map(m => this.hopOnce(m, 0.8 + i * 0.25))));
        ms.forEach(m => (m.mood = 'happy'));
        await g(this.wait(0.8));
        ms.forEach(m => (m.mood = 'normal'));
        return this._wander(g);
      });
    }

    say(id) {
      this.voice.unlock();
      return this.act(async g => {
        await this._ensureAlive(g);
        await this.voice.ready;
        const line = this.voice.lines[id];
        let m = this.mu[line && line.who === 'mu+' ? 1 : 0];
        if (!m.alive) await this._birth(m, g, this.closed ? mod(this.mu[0].u + 0.5, 1) : (this.mu[0].u < 0.5 ? 0.8 : 0.2), true);
        m.target = null;
        const other = this.mu.find(o => o !== m && o.alive);
        if (other) other.lookAt = null;
        await g(this.speak(m, id));
        await g(this.wait(0.4));
        return this._wander(g);
      });
    }

    ride() {
      // a short tour: ride the line while it morphs underneath
      this.voice.unlock();
      return this.act(async g => {
        await this._ensureAlive(g);
        const m = this.mu[0];
        const two = this.mu[1].alive;
        if (two) { this.mu[1].target = null; }
        await g(this.moveTo(m, 0.12, 0.35));
        this.speak(m, 'wheee');
        const legs = [['hills', 0.88], ['wave', 0.15], ['loop', 0.9], ['ring', 1.6], ['mu', 0.9], ['flat', 0.5]];
        for (const [shape, to] of legs) {
          this.morph(shape);
          if (shape === 'ring') { this.speak(m, 'ring'); m.mood = 'happy'; }
          if (shape === 'loop') { m.mood = 'surprised'; this.clock.wait(1.2).then(() => (m.mood = 'normal')); }
          if (shape === 'mu') { m.u = mod(m.u, 1); this.speak(m, 'mu'); }
          await g(this.moveTo(m, to, 0.32));
          if (shape === 'mu') { m.lookAt = { x: -1, y: -0.3 }; m.mood = 'happy'; await g(this.wait(1.2)); m.mood = 'normal'; m.lookAt = null; }
          await g(this.hopOnce(m, 0.7));
          await g(this.wait(0.5));
        }
        return this._wander(g);
      });
    }

    collide() {
      this.voice.unlock();
      return this.act(async g => {
        await this._ensureAlive(g);
        if (SHAPES[this.shape].avoid) await g(this.morph('flat'));
        let [a, b] = this.mu;
        a.u = mod(a.u, 1);
        if (!b.alive) {
          await this._birth(b, g, this.closed ? mod(a.u + 0.5, 1) : (a.u < 0.5 ? 0.85 : 0.15), true);
          await g(this.speak(b, 'anti'));
        }
        b.u = mod(b.u, 1);
        if (a.u > b.u) [a, b] = [b, a];   // whoever is on the left starts on the left
        const self = this.mu[0], anti = this.mu[1];
        await g(Promise.all([this.moveTo(a, 0.16, 0.4), this.moveTo(b, 0.84, 0.4)]));
        a.lookAt = { x: 1, y: 0 }; b.lookAt = { x: -1, y: 0 };
        a.mood = b.mood = 'determined';
        await g(this.speak(anti, 'anti_ready'));
        this.speak(self, 'ready');
        await g(this.wait(0.7));
        // wind up
        await g(Promise.all([this.tween(a, { u: 0.11, amp: 22, sigma: 26 }, 0.5, Ease.out), this.tween(b, { u: 0.89, amp: 22, sigma: 26 }, 0.5, Ease.out)]));
        await g(this.wait(0.6));
        this.tween(a, { amp: AMP * 1.15 }, 0.3); this.tween(b, { amp: AMP * 1.15 }, 0.3);
        a.target = 0.5; b.target = 0.5; a.maxSpeed = b.maxSpeed = 0.9; a.accel = b.accel = 4;
        a.lookAt = b.lookAt = null;
        await g(this.until(() => {
          const L = this._buf.S[N - 1] || 880;
          return Math.abs(this.pos(a) - this.pos(b)) * L < (a.sigma + b.sigma) * 0.55;
        }));
        // contact!
        const uc = (this.pos(a) + this.pos(b)) / 2, i = Math.round(uc * (N - 1));
        const B = this._buf;
        this.burst(B.bx[i] + B.nx[i] * 20, B.by[i] + B.ny[i] * 20);
        this.ripple(uc, 16, 2.2, 0.05);
        a.mood = b.mood = 'surprised';
        this.clock.wait(0.25).then(() => { if (a.mood === 'surprised') { a.mood = b.mood = 'dizzy'; a.dizzy = b.dizzy = 1; } });
        a.accel = b.accel = 6;
        a.vel = -0.7; b.vel = 0.7;
        a.target = uc - 0.24; b.target = uc + 0.24; a.maxSpeed = b.maxSpeed = 0.5;
        a.jumpV = 280; b.jumpV = 280; a.airborne = b.airborne = true;
        this.tween(a, { amp: AMP, sigma: SIG }, 0.9, Ease.outElastic); this.tween(b, { amp: AMP, sigma: SIG }, 0.9, Ease.outElastic);
        await g(this.wait(1.6));
        self.mood = 'sad'; anti.mood = 'normal';
        await g(this.speak(self, 'ouch'));
        anti.mood = 'smug'; self.mood = 'normal';
        await g(this.speak(anti, 'anti_ouch'));
        a.mood = b.mood = 'happy';
        await g(this.wait(1));
        a.mood = b.mood = 'normal';
        return this._wander(g);
      });
    }

    faces() {
      // a tour of the expressions, each labelled, for design review
      return this.act(async g => {
        await this._ensureAlive(g);
        const m = this.mu[0];
        await g(this.moveTo(m, 0.5, 0.4));
        const show = async (mood, sec, lookAt = null) => {
          m.mood = mood; m.lookAt = lookAt; m.caption = mood; m.captionQuote = false; m.captionHold = sec;
          await g(this.wait(sec));
        };
        await show('normal', 1.4);
        await show('happy', 1.4);
        await show('surprised', 1.3);
        await show('determined', 1.4, { x: 1, y: 0 });
        await show('sleepy', 1.6);
        await show('sad', 1.4, { x: -0.3, y: 0.5 });
        await show('smug', 1.2, { x: 0.8, y: -0.1 });
        m.caption = 'wink'; m.captionQuote = false; m.captionHold = 1.4;
        await g(this.tween(m, { wink: 1 }, 0.12, Ease.in)); await g(this.wait(0.25));
        await g(this.tween(m, { wink: 0 }, 0.18, Ease.out)); await g(this.wait(0.7));
        await show('dizzy', 1.6); m.dizzy = 1;
        m.lookAt = null;
        await show('normal', 1.0);
        for (const [x, y] of [[-1, 0], [1, -0.6], [0.2, 0.8], [0, 0]]) { m.lookAt = { x, y }; await g(this.wait(0.35)); }
        m.lookAt = null;
        return this._wander(g);
      });
    }

    emote(mood) { this.mu.forEach(m => { if (m.alive && MOODS[mood]) m.mood = mood; }); }

    stop() {
      return this.act(async () => { this.mu.forEach(m => this.stopSpeech(m)); });
    }

    // ------------------------------------------------------------------ p5
    sketch(p) {
      this.p = p;
      p.setup = () => {
        const w = this.el.clientWidth || 800;
        p.createCanvas(w, Math.round((w * DH) / DW));
        p.noiseSeed(this.o.seed); p.noiseDetail(2, 0.45);
        if (this.o.capture) { p.pixelDensity(1); p.resizeCanvas(w, Math.round((w * DH) / DW)); p.noLoop(); }
        p.strokeCap(p.ROUND);
        p.strokeJoin(p.ROUND);
        if (this.o.autoBirth) this.birth();
        else if (!this.o.capture) this.tween(this, { reveal: 1 }, 1.2, Ease.inOut);
      };
      p.windowResized = () => {
        const w = this.el.clientWidth || 800;
        p.resizeCanvas(w, (w * DH) / DW);
      };
      p.mouseMoved = () => {
        const s = p.width / DW;
        this.mouse = (p.mouseX >= 0 && p.mouseY >= 0 && p.mouseX <= p.width && p.mouseY <= p.height) ? { x: p.mouseX / s, y: p.mouseY / s } : null;
      };
      p.mousePressed = () => {
        const s = p.width / DW;
        if (p.mouseX < 0 || p.mouseY < 0 || p.mouseX > p.width || p.mouseY > p.height) return;
        this.voice.unlock();
        this.mu.forEach(m => {
          if (!m.alive) return;
          const a = this.anchor(m);
          if (Math.hypot(p.mouseX / s - a.x, p.mouseY / s - a.y) > 55) return;
          const was = m.mood;
          m.mood = 'happy';
          this.hopOnce(m, 1.3, true).then(() => this.clock.wait(0.6)).then(() => { if (m.mood === 'happy') m.mood = was === 'happy' ? 'normal' : was; });
        });
      };
      p.draw = () => {
        const dt = this.o.capture ? 1 / (this.o.capture.fps || 30) : Math.min(0.05, p.deltaTime / 1000 || 1 / 60);
        this.update(dt);
        this.render(p);
      };
    }

    update(dt) {
      this.t += dt;
      this.clock.update(dt);
      const B = this._buf;

      // morph
      if (this.morphState) {
        const ms = this.morphState;
        ms.t += dt;
        const e = Ease.jelly(clamp(ms.t / ms.dur, 0, 1));
        for (let i = 0; i < 2 * N; i++) this.cur[i] = lerp(ms.from[i], ms.to[i], e);
        if (ms.t >= ms.dur) { this.cur.set(ms.to); this.morphState = null; }
      }

      // base geometry, normals, arc length
      for (let i = 0; i < N; i++) { B.bx[i] = this.cur[2 * i]; B.by[i] = this.cur[2 * i + 1]; }
      B.S[0] = 0;
      for (let i = 1; i < N; i++) B.S[i] = B.S[i - 1] + Math.hypot(B.bx[i] - B.bx[i - 1], B.by[i] - B.by[i - 1]);
      const L = B.S[N - 1];
      const loopEnds = Math.hypot(B.bx[0] - B.bx[N - 1], B.by[0] - B.by[N - 1]) < 1;
      for (let i = 0; i < N; i++) {
        let i0 = i - 2, i1 = i + 2;
        if (loopEnds) { i0 = mod(i0, N - 1); i1 = mod(i1, N - 1); } else { i0 = Math.max(0, i0); i1 = Math.min(N - 1, i1); }
        const tx = B.bx[i1] - B.bx[i0], ty = B.by[i1] - B.by[i0], l = Math.hypot(tx, ty) || 1;
        B.nx[i] = ty / l; B.ny[i] = -tx / l;
      }
      B.D.fill(0); B.W.fill(0); B.C.fill(-1);

      // ripples
      for (const r of this.ripples) {
        r.age += dt;
        const s0 = r.u * L, front = r.c * r.age, fade = Math.exp(-2.2 * r.age / r.life);
        for (let i = 0; i < N; i++) {
          let d = Math.abs(B.S[i] - s0);
          if (this.closed) d = Math.min(d, L - d);
          if (d > front) continue;
          const lag = front - d;
          B.D[i] += r.amp * fade * Math.sin(r.k * lag) * Math.exp(-lag / 120) * Math.min(1, lag / 10);
        }
      }
      this.ripples = this.ripples.filter(r => r.age < r.life);
      this.events.forEach(e => (e.age += dt));
      this.events = this.events.filter(e => e.age < e.life);
      this.shake = Math.max(0, this.shake - dt * 2.5);

      // muons
      this.mu.forEach((m, mi) => {
        if (!m.alive) return;
        const other = this.mu[1 - mi];
        // locomotion
        if (m.target != null) {
          const want = clamp((m.target - m.u) * 3.2, -m.maxSpeed, m.maxSpeed);
          m.vel += (want - m.vel) * Math.min(1, dt * m.accel);
        } else {
          m.vel *= Math.exp(-dt * 4);
        }
        m.u += m.vel * dt;
        if (!this.closed && (m.u < 0.02 || m.u > 0.98)) { m.u = clamp(m.u, 0.02, 0.98); m.vel *= -0.4; }
        if (Math.abs(m.vel) > 0.02) m.dir = Math.sign(m.vel);
        // the packet's weight leans into its motion; an underdamped spring so it sloshes when it stops
        const leanTo = clamp(m.vel * 3.2, -0.7, 0.7);
        m.leanV += ((leanTo - m.lean) * 70 - m.leanV * 6) * dt;
        m.lean = clamp(m.lean + m.leanV * dt, -0.85, 0.85);
        // the packet rolls: phase follows travel, plus its own beat
        m.phase += m.ex.omega * dt + m.vel * L * m.k * dt * 0.6;

        // jump
        if (m.airborne || m.jump > 0) {
          m.jumpV -= 1100 * dt; m.jump += m.jumpV * dt;
          if (m.jump <= 0) {
            m.jump = 0; m.jumpV = 0;
            if (m.airborne) { m.airborne = false; m.sx = 1.25; m.sy = 0.7; this.ripple(this.pos(m), 6, 1.0, 0.09); }
          }
        }
        if (m.flip) {
          m.flip.t += dt;
          const q = clamp(m.flip.t / m.flip.dur, 0, 1);
          m.spin = m.flip.dir * TAU * Ease.inOut(q);
          if (q >= 1) { m.spin = 0; m.flip = null; }
        }
        // squash & stretch springs
        const kS = 180, dS = 11;
        m.svx += (-(m.sx - 1) * kS - m.svx * dS) * dt; m.sx += m.svx * dt;
        m.svy += (-(m.sy - 1) * kS - m.svy * dS) * dt; m.sy += m.svy * dt;
        if (m.airborne) { m.sy = Math.max(m.sy, 1 + Math.min(0.2, m.jumpV / 2000)); }

        // blink
        m.nextBlink -= dt;
        if (m.nextBlink <= 0 && m.eye > 0.9 && m.mood !== 'dizzy') {
          m.nextBlink = rand(2, 5.5) * (rnd() < 0.15 ? 0.1 : 1);
          this.tween(m, { blink: 1 }, 0.07, Ease.in).then(() => this.tween(m, { blink: 0 }, 0.11, Ease.out));
        }
        if (m.dizzy > 0 && m.mood !== 'dizzy') m.dizzy = Math.max(0, m.dizzy - dt);

        // gaze
        let lx = m.dir * 0.8, ly = 0.1;
        if (m.lookAt) { lx = m.lookAt.x; ly = m.lookAt.y; }
        else if (Math.abs(m.vel) < 0.03) {
          if (this.mouse) {
            const c = this.anchor(m);
            const dx = this.mouse.x - c.x, dy = this.mouse.y - c.y, l = Math.hypot(dx, dy) || 1;
            lx = dx / l * Math.min(1, l / 60); ly = dy / l * Math.min(1, l / 60);
          } else if (other.alive) {
            lx = Math.sign(this.pos(other) - this.pos(m)) * 0.7; ly = 0;
          } else { lx = 0.2 * Math.sin(this.t * 0.7); ly = 0.15; }
          // saccades: small quick darts, the way real eyes rest
          m.nextSacc -= dt;
          if (m.nextSacc <= 0) { m.nextSacc = rand(0.5, 1.8); m.sacc = { x: rand(-0.25, 0.25), y: rand(-0.2, 0.2) }; }
          lx += m.sacc.x; ly += m.sacc.y;
        }
        m.look.x += (lx - m.look.x) * Math.min(1, dt * 18);
        m.look.y += (ly - m.look.y) * Math.min(1, dt * 18);

        // face springs toward the mood's pose
        const pose = MOODS[m.mood] || MOODS.normal;
        for (const k in pose) {
          let tgt = pose[k];
          if (k === 'browY') tgt += m.rms * 90 + (m.airborne ? 4 : 0);
          if (k === 'size') tgt += m.rms * 0.5;
          if (k === 'omega') { m.ex[k] += (tgt - m.ex[k]) * Math.min(1, dt * 3); continue; }
          m.exv[k] += ((tgt - m.ex[k]) * 160 - m.exv[k] * 13) * dt;
          m.ex[k] += m.exv[k] * dt;
        }

        // speech: the low-passed waveform just behind the playhead
        m.win = null;
        if (m.speech) {
          const sp = m.speech, data = this.voice.filtered(sp);
          const W = Math.max(8, Math.round(this.o.speechWindow / 1000 * sp.sr));
          const end = Math.floor(sp.pos() * sp.sr), start = end - W;
          let pk = 0, ss = 0;
          for (let i = Math.max(0, start); i < Math.min(data.length, end); i++) { const v = data[i]; ss += v * v; if (Math.abs(v) > pk) pk = Math.abs(v); }
          m.rms += (Math.sqrt(ss / W) - m.rms) * Math.min(1, dt * 25);
          m.peak = Math.max(pk, m.peak * Math.exp(-dt / 1.2), 0.04);
          m.win = { data, start, W };
        } else { m.rms *= Math.exp(-dt * 10); }
        m.talk += ((m.speech ? 1 : 0) - m.talk) * Math.min(1, dt * 8);
        m.captionHold = m.speech ? Math.max(1.1, m.captionHold || 0) : (m.captionHold || 0) - dt;
        m.captionA += ((m.captionHold > 0 ? 1 : 0) - m.captionA) * Math.min(1, dt * 6);

        // superpose this packet onto the line
        // lopsided envelope: the peak runs ahead, the front steepens, the tail stretches out behind
        const off = m.lean * m.sigma * 0.8;
        const s0 = this.pos(m) * L + off;
        const reach = 4 * m.sigma * (1 + 0.62 * Math.abs(m.lean)) + Math.abs(off);
        const w = m.win;
        const G = this.o.speechGain * m.talk;
        const breath = 1 + 0.09 * Math.sin(this.t * 2.2 + m.sign);
        const A = m.amp * (1 - 0.35 * m.talk) * breath * (1 + m.rms * 2);
        for (let i = 0; i < N; i++) {
          let ds = B.S[i] - s0;
          if (this.closed) ds = mod(ds + L / 2, L) - L / 2;
          if (ds < -reach || ds > reach) continue;
          const sg = m.sigma * (1 - 0.62 * m.lean * Math.sign(ds));
          const gsn = Math.exp(-(ds * ds) / (2 * sg * sg));
          let d = A * Math.cos(this.o.carrier * ds - m.phase);
          if (G > 0.001 && w) {
            // stretch the window across ±reach; the newest sample leads in the direction of travel
            const f = clamp(((ds * m.dir) / reach + 1) / 2, 0, 0.9999) * (w.W - 1);
            const j = w.start + (f | 0), fr = f - (f | 0);
            const at = q => (q >= 0 && q < w.data.length ? w.data[q] : 0);
            const a = (at(j) * (1 - fr) + at(j + 1) * fr) / m.peak;
            d += G * m.amp * 1.7 * a;
          }
          B.D[i] += gsn * d;
          if (gsn > B.W[i]) { B.W[i] = gsn; B.C[i] = mi; }
        }
        // the eyes sit on the packet and bob with it, softened so they don't buzz
        const ic = clamp(Math.round(mod(s0 / L, 1) * (N - 1)), 0, N - 1);
        m.bob = (m.bob || 0) + (B.D[ic] * 0.3 - (m.bob || 0)) * Math.min(1, dt * 9);
      });
    }

    anchor(m) {
      const B = this._buf;
      const L = B.S[N - 1] || 1;
      let u = this.pos(m) + (m.lean * m.sigma * 0.8) / L;
      u = this.closed ? mod(u, 1) : clamp(u, 0, 1);
      const f = u * (N - 1), i = Math.min(N - 2, f | 0), fr = f - i;
      const x = lerp(B.bx[i], B.bx[i + 1], fr), y = lerp(B.by[i], B.by[i + 1], fr);
      const nx = lerp(B.nx[i], B.nx[i + 1], fr), ny = lerp(B.ny[i], B.ny[i + 1], fr);
      const lift = m.amp * 0.42 + (m.bob || 0) + m.jump + m.rms * 30;
      return { x: x + nx * lift, y: y + ny * lift, nx, ny, bx: x, by: y };
    }

    // ------------------------------------------------------------------ drawing
    render(p) {
      const B = this._buf, c = this.c, s = p.width / DW;
      if (this.o.background) p.background(this.o.background === true ? c.paper : this.o.background); else p.clear();
      p.push();
      p.scale(s);
      if (this.shake > 0) p.translate(rand(-1, 1) * 4 * this.shake, rand(-1, 1) * 4 * this.shake);

      // detector rings & tracks from collisions: drawn beneath the line
      for (const e of this.events) this.drawEvent(p, e);

      // the line itself, hand-drawn: the wobble is re-drawn a few times a second ("boil"),
      // pen pressure varies along the stroke, and a faint pencil line runs underneath
      const ctx = p.drawingContext, L = B.S[N - 1];
      const tb = Math.floor(this.t * this.o.boilFps), wob = this.o.wobble;
      const half = this.reveal / 2, sLo = (0.5 - half) * L, sHi = (0.5 + half) * L;
      const seamless = this.closed && this.reveal >= 1 && !this.morphState;
      const rgb = h => { const q = p.color(h); return [p.red(q), p.green(q), p.blue(q)]; };
      const ink = rgb(c.ink), cols = [rgb(c.mu), rgb(c.anti)];
      const X = B.X || (B.X = new Float32Array(N)), Y = B.Y || (B.Y = new Float32Array(N));
      const X2 = B.X2 || (B.X2 = new Float32Array(N)), Y2 = B.Y2 || (B.Y2 = new Float32Array(N));
      for (let i = 0; i < N; i++) {
        const sv = B.S[i], d = B.D[i];
        const j = (p.noise(sv * 0.011, tb * 3.1) - 0.5) * 5 * wob;
        const j2 = (p.noise(sv * 0.017 + 300, tb * 2.3) - 0.5) * 7 * wob;
        X[i] = B.bx[i] + B.nx[i] * (d + j); Y[i] = B.by[i] + B.ny[i] * (d + j);
        X2[i] = B.bx[i] + B.nx[i] * (d + j2) + 0.6; Y2[i] = B.by[i] + B.ny[i] * (d + j2) + 0.8;
      }
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // pencil underdraw, a little shorter than the inked line at each end
      const pad = 18 + 14 * p.noise(tb * 0.7);
      ctx.strokeStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},0.28)`; ctx.lineWidth = 0.9;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < N; i++) {
        if (B.S[i] < sLo + pad || B.S[i] > sHi - pad) { started = false; continue; }
        if (!started) { ctx.moveTo(X2[i], Y2[i]); started = true; } else ctx.lineTo(X2[i], Y2[i]);
      }
      ctx.stroke();
      // ink
      for (let i = 0; i < N - 1; i++) {
        const sv = B.S[i];
        if (sv < sLo || B.S[i + 1] > sHi + 1e-3) continue;
        const dEnd = seamless ? 1e9 : Math.min(sv - sLo, sHi - sv);
        const taper = Math.pow(clamp(dEnd / 45, 0.12, 1), 0.6);
        const pressure = 0.72 + 0.6 * p.noise(sv * 0.004 + 40, tb * 0.7);
        const w = B.W[i], ci = B.C[i];
        const k = w > 0.02 && ci >= 0 ? Math.min(1, w * 1.6) : 0, cc = k ? cols[ci] : ink;
        ctx.strokeStyle = `rgb(${lerp(ink[0], cc[0], k) | 0},${lerp(ink[1], cc[1], k) | 0},${lerp(ink[2], cc[2], k) | 0})`;
        ctx.lineWidth = this.o.inkWeight * pressure * taper * (1 + 0.45 * w);
        ctx.beginPath(); ctx.moveTo(X[i], Y[i]); ctx.lineTo(X[i + 1], Y[i + 1]); ctx.stroke();
      }
      ctx.restore();

      this.mu.forEach(m => m.alive && this.drawFace(p, m));
      p.pop();
    }

    drawEvent(p, e) {
      const c = this.c, t = e.age;
      const grow = Ease.out(clamp(t / 0.7, 0, 1)), fade = 1 - clamp((t - 1.2) / (e.life - 1.2), 0, 1);
      p.noFill();
      // detector layers
      const ring = p.color(c.ink); ring.setAlpha(45 * fade);
      p.stroke(ring); p.strokeWeight(0.7);
      [36, 80, 140].forEach((r, i) => p.circle(e.x, e.y, 2 * r * Ease.outBack(clamp((t - i * 0.06) / 0.5, 0, 1))));
      // tracks
      for (const tr of e.tracks) {
        const col = p.color(c[tr.col]); col.setAlpha(230 * fade);
        p.stroke(col); p.strokeWeight(tr.dashed ? 0.9 : 1.3);
        let x = e.x, y = e.y, a = tr.a, k = tr.k;
        const steps = Math.floor((tr.L * grow) / 4);
        if (tr.dashed) p.drawingContext.setLineDash([4, 5]);
        p.beginShape();
        p.vertex(x, y);
        for (let j = 0; j < steps; j++) { a += k * 4; k += tr.kk * 4 * Math.sign(k || 1) * 40; x += Math.cos(a) * 4; y += Math.sin(a) * 4; p.vertex(x, y); }
        p.endShape();
        if (tr.dashed) p.drawingContext.setLineDash([]);
      }
      // vertex flash
      const fl = p.color(c.paper); fl.setAlpha(255 * Math.max(0, 1 - t * 3));
      p.noStroke(); p.fill(fl); p.circle(e.x, e.y, 60 * (1 - Math.max(0, 1 - t * 3)) + 8);
    }

    drawFace(p, m) {
      const c = this.c, a = this.anchor(m), ex = m.ex;
      const tilt = clamp(Math.atan2(-a.nx, a.ny) + Math.PI, -Math.PI, Math.PI);
      const up = Math.abs(tilt) > Math.PI / 2 ? tilt - Math.sign(tilt) * Math.PI : tilt; // keep faces roughly upright
      const t = this.t;
      const bob = Math.sin(t * 2.4 + m.phase * 0.05) * 1.5;
      const lean = m.lean * 0.4;                               // lean with the packet, slosh included
      p.push();
      p.translate(a.x, a.y + bob);
      p.rotate(clamp(-up * 0.85, -0.95, 0.95) + lean + (m.spin || 0));
      const st = Math.abs(m.lean);
      p.scale(m.eye * m.sx * (1 + st * 0.14), m.eye * m.sy * (1 - st * 0.08));
      const ctx = p.drawingContext;
      const tb = Math.floor(t * this.o.boilFps);
      const paper = c.paper, ink = c.ink;
      const lidCol = p.lerpColor(p.color(paper), p.color(c[m.color]), 0.55).toString();
      const R = 13.5, gap = 17 + Math.abs(m.lean) * 3;
      for (const side of [-1, 1]) {
        // the leading eye is a touch bigger, and the two are never quite identical
        const lead = 1 + 0.1 * side * m.lean;
        const sz = ex.size * lead * (side < 0 ? 1 : 0.94);
        const rx = R * 0.88 * sz, ry = R * 1.12 * sz;
        ctx.save();
        ctx.translate(side * gap, side > 0 ? 1 : 0);
        // wobbly outline, boiling with the line
        const eyePath = new Path2D();
        for (let q = 0; q <= 30; q++) {
          const th = (q / 30) * TAU, w = 1 + (p.noise(q % 30 * 0.4 + side * 17, tb * 1.9) - 0.5) * 0.11;
          const x = Math.cos(th) * rx * w, y = Math.sin(th) * ry * w;
          q ? eyePath.lineTo(x, y) : eyePath.moveTo(x, y);
        }
        eyePath.closePath();
        ctx.fillStyle = paper; ctx.fill(eyePath);
        ctx.save();
        ctx.clip(eyePath);
        // pupil
        if (m.mood === 'dizzy' || m.dizzy > 0.3) {
          ctx.strokeStyle = c[m.color]; ctx.lineWidth = 1.5; ctx.beginPath();
          for (let q = 0; q < 36; q++) {
            const th = q * 0.55 + t * 9 * side, rr = q * 0.27;
            q ? ctx.lineTo(Math.cos(th) * rr, Math.sin(th) * rr) : ctx.moveTo(0, 0);
          }
          ctx.stroke();
        } else {
          const pr = rx * 0.56 * ex.pupil;
          // a slight inward pull when looking close makes the gaze feel focused
          const px = m.look.x * (rx - pr * 0.75) - side * 0.6, py = m.look.y * (ry - pr * 0.8);
          ctx.fillStyle = ink; ctx.beginPath(); ctx.ellipse(px, py, pr, pr * 1.06, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = paper;
          ctx.beginPath(); ctx.arc(px + pr * 0.34, py - pr * 0.4, pr * 0.32, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.arc(px - pr * 0.32, py + pr * 0.36, pr * 0.13, 0, TAU); ctx.fill();
        }
        ctx.strokeStyle = ink; ctx.lineWidth = 1.8; ctx.fillStyle = lidCol;
        // upper lid: sweeps down to blink, slants with the mood
        const wink = side > 0 ? m.wink : 0;
        const lid = Math.max(ex.lid, m.blink, wink);
        if (lid > 0.01) {
          ctx.save();
          ctx.translate(0, -ry + 2.05 * ry * lid);
          ctx.rotate(-side * ex.tilt);
          ctx.beginPath();
          ctx.moveTo(-2 * rx, -4 * ry); ctx.lineTo(2 * rx, -4 * ry); ctx.lineTo(2 * rx, 0);
          ctx.quadraticCurveTo(0, 2.2 * Math.min(1, lid * 3), -2 * rx, 0); ctx.closePath();
          ctx.fill();
          ctx.beginPath(); ctx.moveTo(-2 * rx, 0); ctx.quadraticCurveTo(0, 2.2 * Math.min(1, lid * 3), 2 * rx, 0); ctx.stroke();
          ctx.restore();
        }
        // lower lid: rises into a smile
        if (ex.low > 0.01) {
          const yb = ry * (1 - 1.75 * ex.low);
          ctx.beginPath();
          ctx.moveTo(-2 * rx, ry * 2); ctx.lineTo(-1.2 * rx, ry * 0.9);
          ctx.quadraticCurveTo(0, yb - ry * 0.55 * ex.low, 1.2 * rx, ry * 0.9);
          ctx.lineTo(2 * rx, ry * 2); ctx.closePath();
          ctx.fill(); ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = ink; ctx.lineWidth = 2.1; ctx.stroke(eyePath);
        // brow: a tapered stroke that lifts with loud syllables
        const by = -ry - 7 - ex.browY - (side > 0 ? ex.asym : 0);
        ctx.save();
        ctx.translate(side * 1.5, by);
        ctx.rotate(-side * ex.browA);
        const bw = rx * 1.05, arch = 3 + ex.browY * 0.15;
        const jy = (p.noise(side * 5, tb * 1.3) - 0.5) * 1.6;
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.moveTo(-bw, 1 + jy);
        ctx.quadraticCurveTo(0, -arch - 2.2, bw, 1 - jy);
        ctx.quadraticCurveTo(0, -arch + 1.4, -bw, 1 + jy);
        ctx.fill();
        ctx.restore();
        ctx.restore();
      }
      p.pop();

      // caption
      if (m.captionA > 0.01 && m.caption) {
        const col = p.color(c.ink); col.setAlpha(255 * m.captionA);
        p.noStroke(); p.fill(col);
        p.textFont(c.family); p.textStyle(p.ITALIC); p.textSize(19);
        const cx = clamp(a.x, 170, DW - 170);
        const above = a.y > 110;
        p.textAlign(p.CENTER, above ? p.BOTTOM : p.TOP);
        p.text(m.captionQuote === false ? m.caption : '“' + m.caption + '”', cx, above ? a.y - 50 - 6 * m.captionA : a.y + 40);
      }
    }
  }

  // ------------------------------------------------------------------ public API
  function mount(el, opts) {
    const scene = new Scene(el, opts);
    return {
      scene,
      shapes: Object.keys(SHAPES),
      birth: () => scene.birth(),
      wander: () => scene.wander(),
      hop: () => scene.hop(),
      say: id => scene.say(id),
      ride: () => scene.ride(),
      faces: () => scene.faces(),
      emote: mood => scene.emote(mood),
      moods: Object.keys(MOODS),
      morph: name => scene.morph(name),
      collide: () => scene.collide(),
      stop: () => scene.stop(),
      lines: () => scene.voice.ready,
      set: (k, v) => { scene.o[k] = v; if (k === 'colors') scene.readColors(); },
      refreshColors: () => scene.readColors(),
    };
  }

  global.MuonMascot = { mount, shapes: Object.keys(SHAPES) };
})(typeof window !== 'undefined' ? window : this);
