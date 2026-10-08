#!/usr/bin/env node
// Render Mu's acts to MP4 with the voice lines mixed in at the frames they were spoken.
//
//   npm install            # playwright
//   node tools/render_videos.js [clip ...]     # default: all clips, plus reel.mp4
//
// Frames are rendered deterministically (fixed timestep, seeded randomness), so the same
// code always gives the same video. Output goes to videos/.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'videos');
const FPS = 30, WIDTH = 1280;

// pre: acts run before recording starts (not shown); calls: [seconds, method, arg]
const CLIPS = {
  birth:   { calls: [[0.3, 'birth']], dur: 10 },
  faces:   { pre: ['birth', 7], calls: [[0, 'faces']], dur: 19 },
  speech:  { pre: ['birth', 7], calls: [[0.3, 'say', 'heavy'], [5.0, 'say', 'lifetime']], dur: 8.8 },
  ride:    { pre: ['birth', 7], calls: [[0, 'ride']], dur: 30 },
  collide: { pre: ['birth', 7], calls: [[0, 'collide']], dur: 23 },
};

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg' };
  const srv = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, () => r(srv)));
}

async function renderClip(browser, port, name, spec) {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error(`[${name}] page error:`, e.message));
  await page.goto(`http://localhost:${port}/capture.html?w=${WIDTH}&fps=${FPS}`);
  await page.evaluate(() => window.__ready);
  if (spec.pre) {
    await page.evaluate(m => window.__mu[m](), spec.pre[0]);
    await page.evaluate(n => window.__step(n), Math.round(spec.pre[1] * FPS));
  }
  const t0 = await page.evaluate(() => window.__mu.scene.t);
  const frames = fs.mkdtempSync(path.join(require('os').tmpdir(), `mu-${name}-`));
  const total = Math.round(spec.dur * FPS);
  const calls = (spec.calls || []).slice();
  for (let f = 0; f < total; f++) {
    while (calls.length && calls[0][0] <= f / FPS) {
      const [, method, arg] = calls.shift();
      await page.evaluate(([m, a]) => { window.__mu[m](a); }, [method, arg]);
    }
    const url = await page.evaluate(() => window.__step(1, true));
    fs.writeFileSync(path.join(frames, String(f).padStart(5, '0') + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    if (f % FPS === 0) process.stdout.write(`\r${name}: ${(f / FPS).toFixed(0)}/${spec.dur}s `);
  }
  const log = (await page.evaluate(() => window.__mu.scene.log)).filter(e => e.t >= t0 - 1e-6);
  await page.close();

  const args = ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(frames, '%05d.png')];
  log.forEach(e => args.push('-i', path.join(ROOT, 'voices', e.file)));
  if (log.length) {
    const parts = log.map((e, i) => `[${i + 1}:a]adelay=${Math.round((e.t - t0) * 1000)}:all=1[a${i}]`);
    const mix = log.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${log.length}:normalize=0,apad[a]`;
    args.push('-filter_complex', parts.concat(mix).join(';'), '-map', '0:v', '-map', '[a]', '-c:a', 'aac', '-b:a', '160k');
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-map', '0:v', '-map', `${1}:a`, '-c:a', 'aac');
  }
  const out = path.join(OUT, `${name}.mp4`);
  args.push('-t', String(spec.dur), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', out);
  execFileSync('ffmpeg', args);
  fs.rmSync(frames, { recursive: true, force: true });
  process.stdout.write(`\r${name}: wrote ${path.relative(ROOT, out)} (${log.length} voice lines)\n`);
  return out;
}

(async () => {
  const want = process.argv.slice(2);
  const names = want.length ? want : Object.keys(CLIPS);
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await chromium.launch();
  const outs = [];
  try {
    for (const n of names) {
      if (!CLIPS[n]) { console.error('unknown clip:', n, '— choose from', Object.keys(CLIPS).join(', ')); continue; }
      outs.push(await renderClip(browser, srv.address().port, n, CLIPS[n]));
    }
  } finally { await browser.close(); srv.close(); }
  if (!want.length) {
    const list = path.join(OUT, 'reel.txt');
    fs.writeFileSync(list, outs.map(o => `file '${o}'`).join('\n'));
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', path.join(OUT, 'reel.mp4')]);
    fs.unlinkSync(list);
    console.log('reel: wrote videos/reel.mp4');
  }
})();
