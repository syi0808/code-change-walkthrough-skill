// Engine smoke test: build the demo repo, compile + render the example IR,
// check diagnostics on a broken IR, and exercise the localhost server.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, compileFile, render } from '../src/compile.mjs';
import { serve } from '../src/serve.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-smoke-'));
const repo = path.join(tmp, 'repo');
execFileSync(process.execPath, [path.join(ROOT, 'examples/retry/make-demo-repo.mjs'), repo], { stdio: 'ignore' });
const example = path.join(ROOT, 'examples/retry/walkthrough.json');

// 1. compile the example
const res = compileFile(example, { repo });
assert.equal(res.ok, true, JSON.stringify(res.errors));
assert.equal(res.stats.scenes, 8);
assert.ok(res.ir.files['src/api/retry.ts'].after.includes('withRetry'));
assert.ok(res.ir.files['src/users/profile.ts'] === undefined, 'unchanged, unreferenced files are not added');
assert.ok(!('repo' in res.ir.source), 'local paths are stripped');
const goto = res.ir.chapters[2].scenes[0].steps[0];
assert.equal(goto._to.file, 'src/api/retry.ts');
assert.equal(goto._to.line, 9);
assert.ok(res.stats.estimatedSeconds > 30 && res.stats.estimatedSeconds < 200, `estimate ${res.stats.estimatedSeconds}s`);
assert.deepEqual(res.stats.unnarratedFiles, []);
assert.ok(res.resolved.some((r) => r.path.endsWith('.to') && r.file === 'src/api/retry.ts' && r.from === 9), 'resolved report includes goto targets');
assert.equal(res.ir.tree.root, 'repo');
assert.ok(res.ir.tree.files.some(([d, n]) => res.ir.tree.dirs[d] === 'src/users' && n === 'profile.ts'), 'explorer tree includes unchanged files');
const typeStep = res.ir.chapters[1].scenes[0].steps.find((x) => x.do === 'type');
assert.ok(typeStep && typeStep._chars > 40 && typeStep._r.from === 22, `type resolved (${typeStep && typeStep._chars} chars)`);
console.log('✓ compile');

// 2. render is a standalone page
const html = render(res.ir);
assert.ok(html.startsWith('<!doctype html>'));
assert.ok(!/<script[^>]+src=/.test(html), 'no external scripts');
assert.ok(html.includes('"withRetry'));
console.log('✓ render');

// 3. diagnostics on a broken IR
const broken = JSON.parse(fs.readFileSync(example, 'utf8'));
broken.chapters[1].scenes[0].steps[1].range = { find: 'this text does not exist' };
broken.chapters[2].scenes[0].steps[0].from.token = 'nope';
broken.chapters[0].scenes[0].steps.push({ do: 'teleport' });
const brokenFile = path.join(tmp, 'broken.json');
fs.writeFileSync(brokenFile, JSON.stringify(broken));
const bad = compileFile(brokenFile, { repo });
assert.equal(bad.ok, false);
const msgs = bad.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
assert.match(msgs, /not found in src\/api\/client\.ts/);
assert.match(msgs, /token "nope"/);
assert.match(msgs, /unknown action "teleport"/);
const amb = JSON.parse(fs.readFileSync(example, 'utf8'));
amb.chapters[1].scenes[0].steps[2].range = { find: 'HttpError' };            // appears on several lines
amb.chapters[1].scenes[0].steps[3].range = { find: "throw new Error(`Request failed" }; // only on the before side
const ambRes = compile(amb, { repo });
assert.match(ambRes.warnings.map((w) => w.message).join('\n'), /ambiguous anchor: text "HttpError" matches \d+ lines/);
assert.match(ambRes.errors.map((e) => e.message).join('\n'), /it is on the before side \(line \d+\)/);
console.log(`✓ diagnostics (${bad.errors.length} errors, ambiguity + other-side hints)`);

// 4. serve: page, compiled IR, diagnostics, live recompile
const work = path.join(tmp, 'walkthrough.json');
fs.copyFileSync(example, work);
const srv = await serve({ input: work, repo, port: 47310, log: () => {} });
const get = async (p) => { const r = await fetch(srv.url.replace(/\/$/, '') + p); return { status: r.status, text: await r.text() }; };
let r = await get('/');
assert.equal(r.status, 200);
assert.ok(r.text.includes('/__events'), 'live-reload client injected');
assert.equal(JSON.parse((await get('/walkthrough.json')).text).version, 1);
assert.equal(JSON.parse((await get('/__diagnostics')).text).ok, true);
fs.writeFileSync(work, JSON.stringify(broken));
await new Promise((ok) => setTimeout(ok, 600));
const diag = JSON.parse((await get('/__diagnostics')).text);
assert.equal(diag.ok, false, 'recompiled on change');
r = await get('/');
assert.ok(r.text.includes('withRetry'), 'keeps serving the last valid build');
await srv.close();
console.log(`✓ serve (${srv.url})`);

// 5. serving a prebuilt html file
const htmlFile = path.join(tmp, 'player.html');
fs.writeFileSync(htmlFile, html);
const srv2 = await serve({ input: htmlFile, port: 47330, watch: false, log: () => {} });
const page = await (await fetch(srv2.url)).text();
assert.equal(page, html);
await srv2.close();
console.log('✓ serve prebuilt html');

// 6. cross-platform: CRLF working tree (Windows autocrlf) + non-ASCII path
const client = path.join(repo, 'src/api/client.ts');
const lf = fs.readFileSync(client, 'utf8');
fs.writeFileSync(client, lf.replace('timeoutMs', 'timeoutMs').replace("const method = opts.method ?? 'GET';", "const method = (opts.method ?? 'GET').toUpperCase();").replace(/\n/g, '\r\n'));
fs.mkdirSync(path.join(repo, 'src/한글'), { recursive: true });
fs.writeFileSync(path.join(repo, 'src/한글/파일.ts'), 'export const 값 = 1;\n');
const wt = {
  version: 1, meta: { title: 'crlf', language: 'en' }, source: { base: 'HEAD', head: 'WORKTREE' },
  chapters: [{ title: 'c', scenes: [{ id: 's', title: 's', narration: 'n', steps: [
    { do: 'open', file: 'src/api/client.ts', view: 'diff' },
    { do: 'highlight', range: { hunk: 1 } },
    { do: 'open', file: 'src/한글/파일.ts' },
    { do: 'highlight', range: { find: '값' } },
  ] }] }],
};
const wtRes = compile(wt, { repo });
assert.equal(wtRes.ok, true, JSON.stringify(wtRes.errors));
assert.ok(!wtRes.ir.files['src/api/client.ts'].after.includes('\r'), 'CRLF normalised');
const hl = wtRes.ir.chapters[0].scenes[0].steps[1]._r;
assert.equal(hl.to - hl.from, 0, `a CRLF-only rewrite must not look like a whole-file change (hunk 1 = ${hl.from}-${hl.to})`);
console.log('✓ CRLF working tree + non-ASCII paths');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('all engine smoke tests passed');
process.exit(0);
