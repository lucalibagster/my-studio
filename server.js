// Private image + video studio. Password login, Replicate proxy, optional ffmpeg stitching.
// No npm dependencies. Node 18+.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.REPLICATE_API_TOKEN;
const PASSWORD = process.env.SITE_PASSWORD;
const SECRET = process.env.SESSION_SECRET || PASSWORD;
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'black-forest-labs/flux-schnell';
const VIDEO_MODEL = process.env.VIDEO_MODEL || 'bytedance/seedance-2.0';
const API = 'https://api.replicate.com/v1';
const TMP = path.join(os.tmpdir(), 'studio'); fs.mkdirSync(TMP, { recursive: true });
const SESSION_MS = 30 * 864e5;

if (!TOKEN || !PASSWORD) { console.error('Set REPLICATE_API_TOKEN and SITE_PASSWORD.'); process.exit(1); }

const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const mint = () => { const e = String(Date.now() + SESSION_MS); return e + '.' + sign(e); };
const cookie = (req, n) => { const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(n + '=')); return m ? decodeURIComponent(m.slice(n.length + 1)) : null; };
const authed = req => { const t = cookie(req, 'sid'); if (!t) return false; const [e, s] = t.split('.'); return !!s && eq(s, sign(e)) && +e > Date.now(); };

const tries = new Map();
const locked = ip => { const l = (tries.get(ip) || []).filter(t => Date.now() - t < 9e5); tries.set(ip, l); return l.length >= 8; };

const body = (req, max = 1e6) => new Promise((ok, no) => { let d = ''; req.on('data', c => { d += c; if (d.length > max) { no(new Error('big')); req.destroy(); } }); req.on('end', () => ok(d)); req.on('error', no); });
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

async function rep(method, p, payload) {
  const r = await fetch(API + p, { method, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { detail: t }; }
  return { status: r.status, j };
}
const okHost = u => { try { const x = new URL(u); return x.protocol === 'https:' && (x.hostname === 'replicate.delivery' || x.hostname.endsWith('.replicate.delivery')); } catch { return false; } };
const urls = o => (typeof o === 'string' ? [o] : Array.isArray(o) ? o.filter(x => typeof x === 'string') : []);

function serveFile(req, res, f, dl) {
  const st = fs.statSync(f), r = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  let s = 0, e = st.size - 1, code = 200;
  const h = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };
  if (dl) h['Content-Disposition'] = 'attachment; filename="video.mp4"';
  if (r) { s = r[1] ? +r[1] : 0; e = r[2] ? Math.min(+r[2], e) : e; code = 206; h['Content-Range'] = `bytes ${s}-${e}/${st.size}`; }
  h['Content-Length'] = e - s + 1; res.writeHead(code, h);
  fs.createReadStream(f, { start: s, end: e }).pipe(res);
}

const loginPage = err => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px system-ui,sans-serif;background:#faf9f6;color:#1f1e1c}
@media(prefers-color-scheme:dark){body{background:#161618;color:#eee}input{background:#222;color:#eee;border-color:#444}}
form{width:min(320px,86vw);display:flex;flex-direction:column;gap:12px}input{padding:12px;border-radius:12px;border:1px solid #ccc;font:inherit}
button{padding:12px;border:0;border-radius:12px;background:#6c47ff;color:#fff;font:inherit}.e{color:#c0392b;font-size:14px;margin:0}</style></head>
<body><form method="POST" action="/login"><h2 style="margin:0">Studio</h2><input type="password" name="password" placeholder="Password" autofocus required>${err ? '<p class="e">Wrong password.</p>' : ''}<button>Sign in</button></form></body></html>`;

setInterval(() => { for (const f of fs.readdirSync(TMP)) { const p = path.join(TMP, f); try { if (Date.now() - fs.statSync(p).mtimeMs > 6 * 36e5) fs.rmSync(p, { recursive: true, force: true }); } catch {} } }, 36e5).unref();

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  try {
    if (url.pathname === '/login' && req.method === 'POST') {
      if (locked(ip)) { res.writeHead(429); return res.end('Too many attempts.'); }
      const f = new URLSearchParams(await body(req, 1e4));
      if (eq(f.get('password') || '', PASSWORD)) { res.writeHead(302, { 'Set-Cookie': `sid=${mint()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1e3}${secure}`, Location: '/' }); return res.end(); }
      tries.get(ip).push(Date.now()); res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(loginPage(true));
    }
    if (url.pathname === '/login') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(loginPage(false)); }
    if (url.pathname === '/logout') { res.writeHead(302, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0', Location: '/login' }); return res.end(); }
    if (!authed(req)) { if (/^\/(api|files)\//.test(url.pathname)) { res.writeHead(401); return res.end('Unauthorized'); } res.writeHead(302, { Location: '/login' }); return res.end(); }

    if (url.pathname === '/' ) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(path.join(__dirname, 'index.html'))); }

    if (url.pathname === '/api/create' && req.method === 'POST') {
      const b = JSON.parse(await body(req));
      const prompt = String(b.prompt || '').slice(0, 2000); if (!prompt) return json(res, 400, { error: 'Prompt is empty.' });
      const video = b.kind === 'video';
      const model = video ? VIDEO_MODEL : IMAGE_MODEL;
      const ar = String(b.aspect || (video ? '16:9' : '1:1'));
      const input = video
        ? { prompt, duration: Math.max(4, Math.min(15, parseInt(b.duration) || 15)), aspect_ratio: ar, resolution: '720p', generate_audio: true }
        : { prompt, aspect_ratio: ar, num_outputs: 1 };
      const [m, v] = model.split(':');
      const r = v ? await rep('POST', '/predictions', { version: v, input }) : await rep('POST', `/models/${m}/predictions`, { input });
      if (r.status >= 300) return json(res, r.status === 429 ? 429 : 502, { error: r.j.detail || r.j.title || 'Replicate error', status: r.status });
      return json(res, 200, { id: r.j.id });
    }

    const st = /^\/api\/status\/([a-z0-9]+)$/.exec(url.pathname);
    if (st) {
      const r = await rep('GET', '/predictions/' + st[1]);
      if (r.status >= 300) return json(res, 502, { error: r.j.detail || 'Replicate error' });
      return json(res, 200, { status: r.j.status, output: urls(r.j.output), error: r.j.error || null });
    }

    if (url.pathname === '/api/save') {
      const u = url.searchParams.get('u'); if (!okHost(u)) { res.writeHead(400); return res.end('Bad URL'); }
      const up = await fetch(u); if (!up.ok) { res.writeHead(502); return res.end('Fetch failed'); }
      res.writeHead(200, { 'Content-Type': up.headers.get('content-type') || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${(url.searchParams.get('name') || 'download').replace(/[^\w.-]/g, '')}"` });
      return Readable.fromWeb(up.body).pipe(res);
    }

    if (url.pathname === '/api/stitch' && req.method === 'POST') {
      const { clips } = JSON.parse(await body(req));
      if (!Array.isArray(clips) || !clips.length || clips.length > 8 || !clips.every(okHost)) return json(res, 400, { error: 'Bad clips.' });
      const id = crypto.randomBytes(8).toString('hex'), dir = path.join(TMP, id); fs.mkdirSync(dir);
      const list = [];
      for (let i = 0; i < clips.length; i++) { const r = await fetch(clips[i]); if (!r.ok) return json(res, 502, { error: 'Could not download a clip.' }); const f = path.join(dir, `c${i}.mp4`); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); list.push(`file '${f}'`); }
      fs.writeFileSync(path.join(dir, 'list.txt'), list.join('\n'));
      const out = path.join(TMP, id + '.mp4');
      const code = await new Promise(ok => { const p = spawn('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', out]); p.on('error', () => ok(-1)); p.on('close', ok); });
      fs.rmSync(dir, { recursive: true, force: true });
      if (code === -1) return json(res, 501, { error: 'ffmpeg is not installed on this server (use the included Dockerfile).' });
      if (code !== 0) return json(res, 500, { error: 'Joining the clips failed.' });
      return json(res, 200, { file: '/files/' + id + '.mp4' });
    }

    const fm = /^\/files\/([a-f0-9]{16})\.mp4$/.exec(url.pathname);
    if (fm) { const f = path.join(TMP, fm[1] + '.mp4'); if (!fs.existsSync(f)) { res.writeHead(404); return res.end('Expired'); } return serveFile(req, res, f, url.searchParams.has('dl')); }

    res.writeHead(404); res.end('Not found');
  } catch (e) { console.error(e); if (!res.headersSent) res.writeHead(500); res.end('Server error'); }
}).listen(PORT, () => console.log('Studio on port ' + PORT));
