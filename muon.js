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
 * where g is the envelope, and a_LP is the low-passed speech waveform from the Web Audio
 * analyser stretched across the packet. Speaking therefore animates itself.
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const N = 520;                  // samples along the line
  const DW = 1000, DH = 420;      // design space; everything scales from here
  const BASE_Y = 265;

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mod = (x, m) => ((x % m) + m) % m;
  const rand = (a, b) => a + Math.random() * (b - a);

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
      pts: catmull([
        [X0, BASE_Y], [250, BASE_Y], [330, BASE_Y + 8], [372, BASE_Y + 60], [392, BASE_Y + 92],
        [400, BASE_Y + 40], [404, 190], [408, 128], [412, 190], [416, BASE_Y - 30],
        [440, BASE_Y + 2], [478, BASE_Y + 4], [506, BASE_Y - 30], [516, 190], [522, 128],
        [528, 190], [534, BASE_Y - 20], [548, BASE_Y + 4], [580, BASE_Y], [700, BASE_Y], [X1, BASE_Y],
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
  class Voice {
    constructor(base, opts) {
      this.base = base.endsWith('/') ? base : base + '/';
      this.opts = opts;
      this.ctx = null;
      this.cache = {};
      this.lines = {};
      this.ready = fetch(this.base + 'manifest.json')
        .then(r => r.json())
        .then(list => { list.forEach(l => (this.lines[l.id] = l)); return list; })
        .catch(() => []);
    }
    unlock() {
      if (!this.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    async buffer(id) {
      const line = this.lines[id];
      if (!line) throw new Error('unknown voice line: ' + id);
      if (!this.cache[id]) {
        this.cache[id] = fetch(this.base + line.file).then(r => r.arrayBuffer()).then(b => this.ctx.decodeAudioData(b));
      }
      return this.cache[id];
    }
    async play(id) {
      await this.ready;
      const ctx = this.unlock();
      if (!ctx) return null;
      const buf = await this.buffer(id);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = this.opts.pitch;
      // two cascaded biquads = a 4-pole low-pass: keep the fundamental and the first harmonics
      const lp1 = ctx.createBiquadFilter(), lp2 = ctx.createBiquadFilter();
      lp1.type = lp2.type = 'lowpass';
      lp1.frequency.value = lp2.frequency.value = this.opts.lowpass;
      lp1.Q.value = lp2.Q.value = 0.6;
      const an = ctx.createAnalyser();
      an.fftSize = this.opts.speechWindow;
      src.connect(ctx.destination);
      src.connect(lp1); lp1.connect(lp2); lp2.connect(an);
      const ended = new Promise(res => (src.onended = res));
      src.start();
      return { src, analyser: an, filters: [lp1, lp2], ended, line: this.lines[id] };
    }
  }

  // ------------------------------------------------------------------ one muon
  class Muon {
    constructor(name, sign, color) {
      this.name = name; this.sign = sign; this.color = color;
      this.u = 0.5; this.vel = 0; this.target = null; this.maxSpeed = 0.22; this.accel = 6;
      this.dir = 1;
      this.amp = 0; this.sigma = 34; this.k = 0.19; this.omega = 9; this.phase = rand(0, TAU);
      this.eye = 0; this.eyeLift = 0; this.blink = 0; this.nextBlink = rand(1, 3);
      this.sx = 1; this.sy = 1; this.svx = 0; this.svy = 0;
      this.mood = 'normal'; this.dizzy = 0;
      this.look = { x: 0, y: 0 }; this.lookAt = null;
      this.jump = 0; this.jumpV = 0; this.airborne = false;
      this.alive = false;
      this.speech = null; this.buf = null; this.peak = 0.05; this.rms = 0; this.talk = 0;
      this.caption = ''; this.captionA = 0;
      this.label = 0;
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
        speechWindow: 1024,    // analyser samples stretched across the packet
        pitch: 1.0,            // playbackRate for voice lines
        carrier: 0.19,         // k, rad per design px
        showEnvelope: true,
        captions: true,
        labels: true,
        autoBirth: false,
        colors: null,
      }, opts || {});
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
      this.c = c;
    }

    // ---------------- acts: one choreography at a time; a new act cancels the old
    act(fn) {
      const ep = ++this.epoch;
      this.clock.clear();
      this.mu.forEach(m => {
        if (!m.alive) return;
        m.target = null; m.maxSpeed = 0.22; m.accel = 6; m.lookAt = null;
        if (m.mood !== 'dizzy') m.mood = 'normal';
        this.clock.to(m, { amp: 34, sigma: 34, eye: 1, blink: 0 }, 0.4, Ease.out);
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
      this.mu.forEach(m => { if (m.alive) { m.svy += 4; } });
      return this.until(() => !this.morphState);
    }

    pos(m) { return this.closed ? mod(m.u, 1) : clamp(m.u, 0.02, 0.98); }

    // ---------------- muon behaviours (all return promises)
    async _birth(m, g, at = 0.5, quick = false) {
      m.u = at; m.amp = 0; m.sigma = 6; m.eye = 0; m.blink = 1; m.alive = true; m.mood = 'normal'; m.label = 0;
      m.k = this.o.carrier; m.vel = 0; m.target = null; m.jump = 0;
      if (!quick) {
        // a tremor in the line first
        this.ripple(at, 7, 0.9, 0.012);
        await g(this.wait(0.9));
      }
      await g(Promise.all([
        this.tween(m, { amp: 34, sigma: 34 }, quick ? 0.6 : 1.1, Ease.outElastic),
      ]));
      await g(this.tween(m, { eye: 1 }, 0.5, Ease.outBack));
      await g(this.tween(m, { blink: 0 }, 0.18, Ease.out));
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
      m.target = u; m.maxSpeed = speed;
      return this.until(() => !m.alive || (Math.abs(m.target - m.u) < 0.004 && Math.abs(m.vel) < 0.03));
    }

    hopOnce(m, h = 1) {
      if (!m.alive || m.airborne) return Promise.resolve();
      m.airborne = true; m.jumpV = 330 * h; m.sx = 1.15; m.sy = 0.75; m.svy = 6;
      m.amp *= 1.0;
      this.tween(m, { amp: 52 }, 0.15, Ease.out).then(() => this.tween(m, { amp: 34 }, 0.6, Ease.outElastic));
      return this.until(() => !m.airborne);
    }

    async speak(m, id) {
      if (!m.alive) return;
      this.stopSpeech(m);
      let s = null;
      try { s = await this.voice.play(id); } catch (e) { console.warn(e); }
      if (!s) return;
      m.speech = s; m.buf = new Float32Array(s.analyser.fftSize); m.peak = 0.05;
      m.caption = this.o.captions && s.line ? s.line.text : '';
      await s.ended;
      if (m.speech === s) m.speech = null;
    }

    stopSpeech(m) {
      if (m.speech) { try { m.speech.src.stop(); } catch (e) { /* already stopped */ } m.speech = null; }
    }

    ripple(u, amp = 10, life = 1.6, k = 0.08) { this.ripples.push({ u, amp, life, age: 0, k, c: 380 }); }

    burst(x, y) {
      const tracks = [];
      const n = 14;
      for (let i = 0; i < n; i++) {
        const charged = Math.random() < 0.8;
        tracks.push({
          a: rand(0, TAU), k: charged ? rand(-0.012, 0.012) : 0, kk: charged ? rand(-0.00004, 0.00004) : 0,
          L: rand(80, 260), col: charged ? (Math.random() < 0.5 ? 'mu' : 'anti') : 'ink', dashed: !charged,
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
        this.voice.unlock() && this.speak(this.mu[0], 'hello');
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
          const r = Math.random();
          if (r < 0.2) { await g(this.hopOnce(m, rand(0.7, 1.2))); }
          else if (r < 0.32) { m.mood = 'happy'; await g(this.wait(rand(0.6, 1.2))); m.mood = 'normal'; }
          else {
            const tgt = this.closed ? m.u + rand(-0.6, 0.6) : rand(0.08, 0.92);
            await g(this.moveTo(m, tgt, rand(0.12, 0.3)));
            if (Math.random() < 0.3) await g(this.hopOnce(m, rand(0.5, 1)));
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
        const legs = [['hills', 0.88], ['wave', 0.15], ['loop', 0.9], ['ring', 1.6], ['mu', 0.5], ['flat', 0.5]];
        for (const [shape, to] of legs) {
          this.morph(shape);
          if (shape === 'ring') this.speak(m, 'ring');
          if (shape === 'mu') { m.u = mod(m.u, 1); this.speak(m, 'mu'); }
          await g(this.moveTo(m, to, 0.32));
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
        const [a, b] = this.mu;
        a.u = mod(a.u, 1);
        if (!b.alive) {
          await this._birth(b, g, this.closed ? mod(a.u + 0.5, 1) : (a.u < 0.5 ? 0.85 : 0.15), true);
          await g(this.speak(b, 'anti'));
        }
        b.u = mod(b.u, 1);
        await g(Promise.all([this.moveTo(a, 0.16, 0.4), this.moveTo(b, 0.84, 0.4)]));
        a.lookAt = { x: 1, y: 0 }; b.lookAt = { x: -1, y: 0 };
        a.mood = b.mood = 'determined';
        this.speak(a, 'ready');
        await g(this.wait(0.7));
        // wind up
        await g(Promise.all([this.tween(a, { u: 0.11, amp: 22, sigma: 26 }, 0.5, Ease.out), this.tween(b, { u: 0.89, amp: 22, sigma: 26 }, 0.5, Ease.out)]));
        await g(this.wait(0.6));
        this.tween(a, { amp: 40 }, 0.3); this.tween(b, { amp: 40 }, 0.3);
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
        a.mood = b.mood = 'dizzy'; a.dizzy = b.dizzy = 1;
        a.accel = b.accel = 6;
        a.vel = -0.7; b.vel = 0.7;
        a.target = uc - 0.24; b.target = uc + 0.24; a.maxSpeed = b.maxSpeed = 0.5;
        a.jumpV = 280; b.jumpV = 280; a.airborne = b.airborne = true;
        this.tween(a, { amp: 34, sigma: 34 }, 0.9, Ease.outElastic); this.tween(b, { amp: 34, sigma: 34 }, 0.9, Ease.outElastic);
        await g(this.wait(1.6));
        await g(this.speak(a, 'ouch'));
        await g(this.speak(b, 'anti_ouch'));
        a.mood = b.mood = 'happy';
        await g(this.wait(1));
        a.mood = b.mood = 'normal';
        return this._wander(g);
      });
    }

    stop() {
      return this.act(async () => { this.mu.forEach(m => this.stopSpeech(m)); });
    }

    // ------------------------------------------------------------------ p5
    sketch(p) {
      this.p = p;
      p.setup = () => {
        const w = this.el.clientWidth || 800;
        p.createCanvas(w, (w * DH) / DW);
        p.strokeCap(p.ROUND);
        p.strokeJoin(p.ROUND);
        if (this.o.autoBirth) this.birth();
        else this.tween(this, { reveal: 1 }, 1.2, Ease.inOut);
      };
      p.windowResized = () => {
        const w = this.el.clientWidth || 800;
        p.resizeCanvas(w, (w * DH) / DW);
      };
      p.mouseMoved = () => {
        const s = p.width / DW;
        this.mouse = (p.mouseX >= 0 && p.mouseY >= 0 && p.mouseX <= p.width && p.mouseY <= p.height) ? { x: p.mouseX / s, y: p.mouseY / s } : null;
      };
      p.draw = () => {
        const dt = Math.min(0.05, p.deltaTime / 1000 || 1 / 60);
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
        // the packet rolls: phase follows travel, plus its own beat
        m.phase += m.omega * dt + m.vel * L * m.k * dt * 0.6;

        // jump
        if (m.airborne || m.jump > 0) {
          m.jumpV -= 1100 * dt; m.jump += m.jumpV * dt;
          if (m.jump <= 0) {
            m.jump = 0; m.jumpV = 0;
            if (m.airborne) { m.airborne = false; m.sx = 1.25; m.sy = 0.7; this.ripple(this.pos(m), 6, 1.0, 0.09); }
          }
        }
        // squash & stretch springs
        const kS = 180, dS = 11;
        m.svx += (-(m.sx - 1) * kS - m.svx * dS) * dt; m.sx += m.svx * dt;
        m.svy += (-(m.sy - 1) * kS - m.svy * dS) * dt; m.sy += m.svy * dt;
        if (m.airborne) { m.sy = Math.max(m.sy, 1 + Math.min(0.2, m.jumpV / 2000)); }

        // blink
        m.nextBlink -= dt;
        if (m.nextBlink <= 0 && m.eye > 0.9 && m.mood !== 'dizzy') {
          m.nextBlink = rand(2, 5.5) * (Math.random() < 0.15 ? 0.1 : 1);
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
        }
        m.look.x += (lx - m.look.x) * Math.min(1, dt * 10);
        m.look.y += (ly - m.look.y) * Math.min(1, dt * 10);

        // speech: low-passed waveform from the analyser
        if (m.speech) {
          m.speech.analyser.getFloatTimeDomainData(m.buf);
          let pk = 0, ss = 0;
          for (let i = 0; i < m.buf.length; i++) { const v = m.buf[i]; ss += v * v; if (Math.abs(v) > pk) pk = Math.abs(v); }
          m.rms = Math.sqrt(ss / m.buf.length);
          m.peak = Math.max(pk, m.peak * Math.exp(-dt / 1.2), 0.04);
          m.speech.filters.forEach(f => (f.frequency.value = this.o.lowpass));
        } else { m.rms *= Math.exp(-dt * 10); }
        m.talk += ((m.speech ? 1 : 0) - m.talk) * Math.min(1, dt * 8);
        m.captionHold = m.speech ? 1.1 : (m.captionHold || 0) - dt;
        m.captionA += ((m.captionHold > 0 ? 1 : 0) - m.captionA) * Math.min(1, dt * 6);
        m.label += ((m.eye > 0.9 ? 1 : 0) - m.label) * Math.min(1, dt * 2);

        // superpose this packet onto the line
        const s0 = this.pos(m) * L;
        const reach = 4 * m.sigma;
        const win = m.buf ? m.buf.length : 0;
        const G = this.o.speechGain * m.talk;
        const A = m.amp * (1 - 0.45 * m.talk);
        for (let i = 0; i < N; i++) {
          let ds = B.S[i] - s0;
          if (this.closed) ds = mod(ds + L / 2, L) - L / 2;
          if (ds < -reach || ds > reach) continue;
          const gsn = Math.exp(-(ds * ds) / (2 * m.sigma * m.sigma));
          let d = A * Math.cos(this.o.carrier * ds - m.phase);
          if (G > 0.001 && win) {
            // stretch the analyser window across ±reach; samples flow toward the direction of travel
            const f = clamp(((ds * m.dir) / reach + 1) / 2, 0, 0.9999) * (win - 1);
            const j = f | 0, fr = f - j;
            const a = (m.buf[j] * (1 - fr) + m.buf[j + 1] * fr) / m.peak;
            d += G * m.amp * 1.25 * a;
          }
          B.D[i] += gsn * d;
          if (gsn > B.W[i]) { B.W[i] = gsn; B.C[i] = mi; }
        }
      });
    }

    anchor(m) {
      const B = this._buf;
      const f = this.pos(m) * (N - 1), i = Math.min(N - 2, f | 0), fr = f - i;
      const x = lerp(B.bx[i], B.bx[i + 1], fr), y = lerp(B.by[i], B.by[i + 1], fr);
      const nx = lerp(B.nx[i], B.nx[i + 1], fr), ny = lerp(B.ny[i], B.ny[i + 1], fr);
      const lift = m.amp * 1.05 + 20 + m.jump + m.rms * 40;
      return { x: x + nx * lift, y: y + ny * lift, nx, ny, bx: x, by: y };
    }

    // ------------------------------------------------------------------ drawing
    render(p) {
      const B = this._buf, c = this.c, s = p.width / DW;
      p.clear();
      p.push();
      p.scale(s);
      if (this.shake > 0) p.translate(rand(-1, 1) * 4 * this.shake, rand(-1, 1) * 4 * this.shake);

      // detector rings & tracks from collisions: drawn beneath the line
      for (const e of this.events) this.drawEvent(p, e);

      // faint envelope ±A·g(s): the packet's anatomy
      if (this.o.showEnvelope) {
        this.mu.forEach(m => {
          if (!m.alive || m.amp < 1) return;
          const col = p.color(c[m.color]); col.setAlpha(70 * Math.min(1, m.eye));
          p.stroke(col); p.strokeWeight(0.8); p.noFill();
          const L = B.S[N - 1], s0 = this.pos(m) * L;
          for (const sgn of [1, -1]) {
            p.beginShape();
            let open = false;
            for (let i = 0; i < N; i += 2) {
              let ds = B.S[i] - s0;
              if (this.closed) ds = mod(ds + L / 2, L) - L / 2;
              if (Math.abs(ds) > 3 * m.sigma) { if (open) { p.endShape(); p.beginShape(); open = false; } continue; }
              const e = sgn * (m.amp + 3) * Math.exp(-(ds * ds) / (2 * m.sigma * m.sigma));
              p.vertex(B.bx[i] + B.nx[i] * e, B.by[i] + B.ny[i] * e); open = true;
            }
            p.endShape();
          }
        });
      }

      // the line itself
      const half = this.reveal / 2;
      const ink = p.color(c.ink), cols = [p.color(c.mu), p.color(c.anti)];
      p.noFill();
      for (let i = 0; i < N - 1; i++) {
        const u = i / (N - 1);
        if (Math.abs(u - 0.5) > half) continue;
        const w = B.W[i];
        const col = w > 0.02 && B.C[i] >= 0 ? p.lerpColor(ink, cols[B.C[i]], Math.min(1, w * 1.6)) : ink;
        p.stroke(col);
        p.strokeWeight(2 + 1.6 * w);
        p.line(B.bx[i] + B.nx[i] * B.D[i], B.by[i] + B.ny[i] * B.D[i], B.bx[i + 1] + B.nx[i + 1] * B.D[i + 1], B.by[i + 1] + B.ny[i + 1] * B.D[i + 1]);
      }

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
      const c = this.c, a = this.anchor(m);
      const tilt = clamp(Math.atan2(-a.nx, a.ny) + Math.PI, -Math.PI, Math.PI);
      const up = Math.abs(tilt) > Math.PI / 2 ? tilt - Math.sign(tilt) * Math.PI : tilt; // keep faces roughly upright
      const t = this.t;
      const bob = Math.sin(t * 2.4 + m.phase * 0.05) * 1.5;
      p.push();
      p.translate(a.x, a.y + bob);
      p.rotate(clamp(-up * 0.45, -0.5, 0.5));
      p.scale(m.eye * m.sx, m.eye * m.sy);

      const gap = 15, R = 11.5;
      const ink = p.color(c.ink), paper = p.color(c.paper), tint = p.color(c[m.color]);
      for (const side of [-1, 1]) {
        p.push();
        p.translate(side * gap, 0);
        const mood = m.mood;
        p.strokeWeight(2); p.stroke(ink);
        if (mood === 'happy') {
          p.noFill();
          p.arc(0, 3, R * 1.7, R * 1.6, Math.PI + 0.25, TAU - 0.25);
        } else {
          const open = 1 - m.blink;
          const big = mood === 'surprised' ? 1.25 : 1;
          const rx = R * big, ry = R * big * Math.max(0.08, open) * (1 + m.talk * 0.12 * Math.sin(t * 22));
          p.fill(paper);
          p.ellipse(0, 0, rx * 2, ry * 2);
          if (open > 0.2) {
            if (mood === 'dizzy' || m.dizzy > 0.3) {
              p.noFill(); p.stroke(tint); p.strokeWeight(1.4);
              p.beginShape();
              for (let q = 0; q < 34; q++) {
                const th = q * 0.55 + t * 9 * side, rr = q * 0.24;
                p.vertex(Math.cos(th) * rr, Math.sin(th) * rr * open);
              }
              p.endShape();
            } else {
              const px = m.look.x * R * 0.45, py = m.look.y * R * 0.4 * open;
              const pr = mood === 'surprised' ? 3.4 : 5.2;
              p.noStroke(); p.fill(ink);
              p.ellipse(px, py, pr * 2, pr * 2 * Math.min(1, open * 1.3));
              p.fill(paper);
              p.circle(px + 1.8, py - 1.8 * open, 2.2);
            }
          }
          if (mood === 'determined') {
            p.stroke(ink); p.strokeWeight(2.4);
            p.line(-R * 0.9, -R * 1.15 - side * 2, R * 0.9, -R * 1.15 + side * 4);
          }
        }
        p.pop();
      }
      p.pop();

      // direct label beneath the packet (Tufte: label the thing, skip the legend)
      if (this.o.labels && m.label > 0.01) {
        const col = p.color(c[m.color]); col.setAlpha(255 * m.label * 0.85);
        p.noStroke(); p.fill(col);
        p.textFont(c.font); p.textStyle(p.ITALIC); p.textSize(17); p.textAlign(p.CENTER, p.CENTER);
        const off = m.amp + 26;
        p.text(m.name, a.bx - a.nx * off, a.by - a.ny * off);
      }
      // caption
      if (m.captionA > 0.01 && m.caption) {
        const col = p.color(c.ink); col.setAlpha(255 * m.captionA);
        p.noStroke(); p.fill(col);
        p.textFont(c.font); p.textStyle(p.ITALIC); p.textSize(19);
        const cx = clamp(a.x, 170, DW - 170);
        const above = a.y > 90;
        p.textAlign(p.CENTER, above ? p.BOTTOM : p.TOP);
        p.text('“' + m.caption + '”', cx, above ? a.y - 30 - 6 * m.captionA : a.y + 40);
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
