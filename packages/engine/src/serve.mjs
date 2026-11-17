// Local server for the player. It serves exactly the standalone HTML that
// `build` would write, plus a tiny live-reload channel used while an IR is
// being authored: edit walkthrough.json -> recompile -> the open tab reloads
// at the same scene (or shows the diagnostics if the IR is now invalid).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { compileFile, render } from './compile.mjs';

const LIVE = `<script>(function(){
  var es = new EventSource('/__events');
  function bar(d){
    var b = document.getElementById('__wt_diag');
    if(!b){ b = document.createElement('div'); b.id='__wt_diag';
      b.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-height:40vh;overflow:auto;background:#3b1219;color:#ffd8d8;border:1px solid #ff7b72;border-radius:8px;padding:10px 14px;font:12px/1.5 ui-monospace,Menlo,monospace;box-shadow:0 8px 30px rgba(0,0,0,.4)';
      document.body.appendChild(b); }
    b.innerHTML = '<b>IR has ' + d.errors.length + ' error(s) — showing the last valid build</b><br>' +
      d.errors.slice(0, 12).map(function(e){ return (e.path + ': ' + e.message).replace(/[&<]/g, function(c){ return c === '&' ? '&amp;' : '&lt;'; }); }).join('<br>');
  }
  es.onmessage = function(m){
    var d = JSON.parse(m.data);
    if (d.type === 'reload') {
      var w = window.__walkthrough;
      if (w && w.scenes) { var k = 0; for (var i = 0; i < w.scenes.length; i++) if (w.scenes[i].t0 <= w.T) k = i; location.hash = 'scene=' + encodeURIComponent(w.scenes[k].id); }
      location.reload();
    } else if (d.type === 'error') bar(d);
  };
})();</script>`;

function errorPage(diag, file) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Walkthrough — errors</title>
<style>:root{color-scheme:light dark}body{margin:0;padding:24px 16px;font:13px/1.6 ui-monospace,Menlo,monospace;background:#1b1d23;color:#d7dae0}@media (prefers-color-scheme:light){body{background:#fff;color:#1f2328}}h1{font:600 16px system-ui;margin:0 0 12px}li{margin:4px 0}.e{color:#ff7b72}.w{color:#d29922}</style></head>
<body><h1>${esc(path.basename(file))}: ${diag.errors.length} error(s)</h1><ul>${diag.errors.map((e) => `<li class="e">${esc(e.path)}: ${esc(e.message)}</li>`).join('')}${diag.warnings.map((w) => `<li class="w">warn ${esc(w.path)}: ${esc(w.message)}</li>`).join('')}</ul><p>Fix the IR and save — this page reloads automatically.</p>${LIVE}</body></html>`;
}

/**
 * @param {{input: string, repo?: string, port?: number, host?: string, watch?: boolean, open?: boolean, extraFiles?: boolean, log?: (m: string) => void}} o
 */
export function serve(o) {
  const log = o.log || ((m) => process.stderr.write(m + '\n'));
  const file = path.resolve(o.input);
  const isHtml = /\.html?$/i.test(file);
  const watch = o.watch !== false;
  const clients = new Set();
  let state = { html: '', ir: null, diag: { errors: [], warnings: [] } };

  function build() {
    if (isHtml) { state = { html: fs.readFileSync(file, 'utf8'), ir: null, diag: { errors: [], warnings: [] } }; return true; }
    let res;
    try { res = compileFile(file, { repo: o.repo, extraFiles: o.extraFiles }); }
    catch (e) { res = { ok: false, errors: [{ path: path.basename(file), message: e.message }], warnings: [] }; }
    const diag = { errors: res.errors, warnings: res.warnings };
    if (res.ok) state = { html: render(res.ir, { inject: watch ? LIVE : '' }), ir: res.ir, diag };
    else if (!state.ir) state = { html: errorPage(diag, file), ir: null, diag };
    else state = { ...state, diag };
    for (const w of res.warnings) log(`warn  ${w.path}: ${w.message}`);
    for (const e of res.errors) log(`error ${e.path}: ${e.message}`);
    log(res.ok ? `✓ compiled ${path.basename(file)} — ${res.stats.scenes} scenes, ${res.stats.files} files` : `✗ ${res.errors.length} error(s)`);
    return res.ok;
  }
  build();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(state.html);
    }
    if (url.pathname === '/walkthrough.json') {
      if (!state.ir) { res.writeHead(404); return res.end('no valid build'); }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(state.ir));
    }
    if (url.pathname === '/__diagnostics') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: state.diag.errors.length === 0, ...state.diag }));
    }
    if (url.pathname === '/__events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': connected\n\n');
      if (state.diag.errors.length && state.ir) res.write(`data: ${JSON.stringify({ type: 'error', errors: state.diag.errors })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/__health') { res.writeHead(200); return res.end('ok'); }
    res.writeHead(404); res.end('not found');
  });

  const send = (msg) => { for (const c of clients) c.write(`data: ${JSON.stringify(msg)}\n\n`); };
  if (watch) {
    let t = null;
    const dir = path.dirname(file), base = path.basename(file);
    fs.watch(dir, (ev, name) => {
      if (name && name !== base) return;
      clearTimeout(t);
      t = setTimeout(() => {
        if (!fs.existsSync(file)) return;
        const ok = build();
        send(ok || !state.ir ? { type: 'reload' } : { type: 'error', errors: state.diag.errors });
      }, 150);
    });
    setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000).unref();
  }

  const host = o.host || '127.0.0.1';
  let port = Number(o.port || 4173);
  const first = port;
  return new Promise((resolve, reject) => {
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE' && port < first + 20) { port++; server.listen(port, host); }
      else reject(e);
    });
    server.on('listening', () => {
      const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`;
      log(`serving ${path.basename(file)} at ${url}${watch ? '  (watching for changes)' : ''}`);
      if (o.open) openUrl(url);
      resolve({ url, port, server, close: () => new Promise((r) => { for (const c of clients) c.end(); server.close(r); }) });
    });
    server.listen(port, host);
  });
}

function openUrl(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* ignore */ }
}
