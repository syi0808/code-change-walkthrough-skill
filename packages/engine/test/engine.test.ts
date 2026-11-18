// Engine tests against the built package: compile + render the example on a demo repo,
// diagnostics on broken IR, the localhost server, collect, and cross-platform inputs.
// Run: npm test (builds first). Node runs this file directly (type stripping).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collect, compile, compileFile, render, serve, type Scene, type Step, type Walkthrough } from 'code-walkthrough-engine';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_SCRIPTS = path.join(ROOT, '..', '..', 'skills', 'code-change-walkthrough', 'scripts');
const example = path.join(ROOT, 'examples/retry/walkthrough.json');
let tmp = '', repo = '';
const scenesOf = (ir: Walkthrough): Scene[] => ir.chapters.flatMap((c) => c.scenes || []);
const stepsOf = (ir: Walkthrough): Step[] => scenesOf(ir).flatMap((s) => s.steps || []);
const byId = (ir: Walkthrough, id: string): Scene => scenesOf(ir).find((x) => x.id === id)!;
const load = (): Walkthrough => JSON.parse(fs.readFileSync(example, 'utf8'));

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-test-'));
  repo = path.join(tmp, 'repo');
  execFileSync(process.execPath, [path.join(ROOT, 'examples/retry/make-demo-repo.mjs'), repo], { stdio: 'ignore' });
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('compile', () => {
  test('the example compiles, and the tour replays every hunk once', () => {
    const res = compileFile(example, { repo });
    assert.equal(res.ok, true, JSON.stringify(res.errors));
    const all = scenesOf(res.ir);
    assert.equal(all.filter((x) => !x.auto).length, 8, 'author scenes kept');
    const replays = all.flatMap((x) => (x.steps || []).filter((st) => st.do === 'replay').map((st) => `${st.file}#${st.hunk}`));
    assert.equal(new Set(replays).size, replays.length, 'no hunk replayed twice');
    assert.equal(replays.length, res.stats.tour?.hunks, 'every hunk replayed');
    assert.ok(replays.includes('src/config.ts#1') && replays.includes('test/retry.test.ts#1'));
    const order = all.map((x) => x.id || '');
    assert.ok(order.indexOf('request-diff') > order.findIndex((id) => id.startsWith('tour-')), 'client.ts is replayed before it is explained');
    assert.ok(stepsOf(res.ir).some((st) => st.do === 'replay' && st._mode === 'block'), 'wiring hunks are skimmed');
    const rp = stepsOf(res.ir).find((st) => st.do === 'replay' && st.file === 'src/api/client.ts' && st.hunk === 3);
    assert.ok(rp && (rp._lines || 0) > 5 && (rp._dels || 0) >= 1 && rp._mode === 'lines', `replay resolved (${rp?._mode}, ${rp?._lines} lines)`);
  });

  test('files, anchors, report and tree', () => {
    const res = compileFile(example, { repo });
    assert.ok(res.ir.files['src/api/retry.ts'].after?.includes('withRetry'));
    assert.equal(res.ir.files['src/users/profile.ts'], undefined, 'unchanged, unreferenced files are not added');
    assert.ok(!('repo' in (res.ir.source || {})), 'local paths are stripped');
    const goto = byId(res.ir, 'goto-withretry').steps![0];
    assert.equal(goto._to?.file, 'src/api/retry.ts');
    assert.equal(goto._to?.line, 9);
    assert.ok(res.stats.estimatedSeconds > 30 && res.stats.estimatedSeconds < 240, `estimate ${res.stats.estimatedSeconds}s`);
    assert.deepEqual(res.stats.unnarratedFiles, []);
    assert.ok(res.resolved.some((r) => r.path.endsWith('.to') && r.file === 'src/api/retry.ts' && r.from === 9), 'resolved report includes goto targets');
    assert.equal(res.ir.tree?.root, 'repo');
    assert.ok(res.ir.tree?.files.some(([d, n]) => res.ir.tree!.dirs[d] === 'src/users' && n === 'profile.ts'), 'explorer tree includes unchanged files');
  });

  test('diagnostics say what is wrong and how to fix it', () => {
    const broken = load();
    byId(broken, 'request-diff').steps![1].range = { find: 'this text does not exist' };
    byId(broken, 'goto-withretry').steps![0].from!.token = 'nope';
    broken.chapters[0].scenes![0].steps!.push({ do: 'teleport' as Step['do'] });
    const bad = compile(broken, { repo });
    assert.equal(bad.ok, false);
    const msgs = bad.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
    assert.match(msgs, /not found in src\/api\/client\.ts/);
    assert.match(msgs, /token "nope"/);
    assert.match(msgs, /unknown action "teleport"/);
    const amb = load();
    byId(amb, 'request-diff').steps![2].range = { find: 'HttpError' }; // on several lines
    byId(amb, 'request-diff').steps![3].range = { find: 'throw new Error(`Request failed' }; // only on the before side
    const res = compile(amb, { repo });
    assert.match(res.warnings.map((w) => w.message).join('\n'), /ambiguous anchor: text "HttpError" matches \d+ lines/);
    assert.match(res.errors.map((e) => e.message).join('\n'), /it is on the before side \(line \d+\)/);
  });

  test('CRLF working tree (Windows autocrlf) and non-ASCII paths', () => {
    const client = path.join(repo, 'src/api/client.ts');
    const original = fs.readFileSync(client, 'utf8');
    fs.writeFileSync(client, original.replace("const method = opts.method ?? 'GET';", "const method = (opts.method ?? 'GET').toUpperCase();").replace(/\n/g, '\r\n'));
    fs.mkdirSync(path.join(repo, 'src/한글'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src/한글/파일.ts'), 'export const 값 = 1;\n');
    try {
      const wt: Walkthrough = {
        version: 1, meta: { title: 'crlf', language: 'en' }, source: { base: 'HEAD', head: 'WORKTREE' }, files: {}, tour: false,
        chapters: [{ title: 'c', scenes: [{ id: 's', title: 's', narration: 'n', steps: [
          { do: 'open', file: 'src/api/client.ts', view: 'diff' },
          { do: 'highlight', range: { hunk: 1 } },
          { do: 'open', file: 'src/한글/파일.ts' },
          { do: 'highlight', range: { find: '값' } },
        ] }] }],
      };
      const res = compile(wt, { repo });
      assert.equal(res.ok, true, JSON.stringify(res.errors));
      assert.ok(!res.ir.files['src/api/client.ts'].after?.includes('\r'), 'CRLF normalised');
      const hl = res.ir.chapters[0].scenes![0].steps![1]._r!;
      assert.equal(hl.to - hl.from, 0, `a CRLF-only rewrite must not look like a whole-file change (hunk 1 = ${hl.from}-${hl.to})`);
    } finally {
      fs.writeFileSync(client, original);
      fs.rmSync(path.join(repo, 'src/한글'), { recursive: true, force: true });
    }
  });
});

describe('render', () => {
  test('one standalone page, data and code inlined', () => {
    const res = compileFile(example, { repo });
    const html = render(res.ir);
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(!/<script[^>]+src=/.test(html), 'no external scripts');
    assert.ok(!/<link[^>]+href=/.test(html), 'no external styles');
    assert.ok(html.includes('"withRetry'));
    assert.ok(!html.includes('{{'), 'every placeholder filled');
  });
  test('content that looks like a placeholder or a closing tag stays data', () => {
    const res = compileFile(example, { repo });
    res.ir.meta!.title = '{{CSS}} </script><b>x';
    res.ir.files['src/config.ts'].after += '\n// {{JS}} </script> \n';
    const html = render(res.ir, { i18n: { language: 'xx', strings: { 'top.theme': '{{IR}} </script>' } } });
    assert.ok(html.includes('<title>{{CSS}} &lt;/script&gt;&lt;b&gt;x</title>'), 'title escaped, not substituted');
    assert.equal(html.split('{{').length - 1, 4, 'only the literal occurrences in data remain (title, its copy in the IR, the file, the string table)');
    assert.equal((html.match(/<\/script>/g) || []).length, 3, 'IR, string table and player scripts close once each');
  });
});

describe('serve', () => {
  test('page, compiled IR, diagnostics, live recompile', async () => {
    const work = path.join(tmp, 'walkthrough.json');
    fs.copyFileSync(example, work);
    const srv = await serve({ input: work, repo, port: 47310, log: () => {} });
    try {
      const get = async (p: string) => { const r = await fetch(srv.url.replace(/\/$/, '') + p); return { status: r.status, text: await r.text() }; };
      const page = await get('/');
      assert.equal(page.status, 200);
      assert.ok(page.text.includes('/__events'), 'live-reload client injected');
      assert.equal(JSON.parse((await get('/walkthrough.json')).text).version, 1);
      assert.equal(JSON.parse((await get('/__diagnostics')).text).ok, true);
      const broken = load();
      broken.chapters[0].scenes![0].steps!.push({ do: 'teleport' as Step['do'] });
      fs.writeFileSync(work, JSON.stringify(broken));
      await new Promise((ok) => setTimeout(ok, 600));
      assert.equal(JSON.parse((await get('/__diagnostics')).text).ok, false, 'recompiled on change');
      assert.ok((await get('/')).text.includes('withRetry'), 'keeps serving the last valid build');
    } finally { await srv.close(); }
  });
  test('a prebuilt html file is served as is', async () => {
    const html = render(compileFile(example, { repo }).ir);
    const file = path.join(tmp, 'player.html');
    fs.writeFileSync(file, html);
    const srv = await serve({ input: file, port: 47330, watch: false, log: () => {} });
    try { assert.equal(await (await fetch(srv.url)).text(), html); } finally { await srv.close(); }
  });
});

describe('collect', () => {
  test('change context: files, hunks, symbols, structure', () => {
    const c = collect({ repo });
    assert.ok(c.files.some((f) => f.path === 'src/api/retry.ts' && f.status === 'added'));
    assert.ok(c.symbols.some((s) => s.name === 'withRetry' && s.change === 'added'));
    assert.ok(c.suggestions.bottomUpOrder.indexOf('src/api/retry.ts') < c.suggestions.bottomUpOrder.indexOf('src/api/client.ts'), 'dependencies first');
  });
});

describe('skill scripts', () => {
  test('the bundled CLIs run on their own', () => {
    const out = execFileSync(process.execPath, [path.join(SKILL_SCRIPTS, 'engine.mjs'), 'check', example, '--repo', repo, '--json'], { encoding: 'utf8' });
    assert.equal(JSON.parse(out).ok, true);
    const digest = execFileSync(process.execPath, [path.join(SKILL_SCRIPTS, 'collect.mjs'), '--repo', repo, '--out', path.join(tmp, 'ctx')], { encoding: 'utf8' });
    assert.match(digest, /# Change context/);
    assert.ok(fs.existsSync(path.join(tmp, 'ctx', 'context.json')));
  });
});

describe('context outside the diff', () => {
  test('an impact step marks which places are outside the diff and carries verdicts', () => {
    const ir = load();
    const file = Object.keys(ir.files).find((f) => ir.files[f].status === 'context') || 'src/config.ts';
    ir.chapters[ir.chapters.length - 1].scenes!.push({ id: 'impact', question: 'Who else?', bridge: 'Then.', steps: [{ do: 'impact', symbol: 'request', change: 'retries now', items: [{ file, at: 1, effect: 'safe', relation: 'reads' }] }] });
    ir.meta = { ...(ir.meta || {}), impact: [{ text: 'callers unchanged', effect: 'safe' }] };
    const res = compile(ir, { repo });
    assert.equal(res.ok, true, JSON.stringify(res.errors));
    const st = stepsOf(res.ir).find((x) => x.do === 'impact')!;
    assert.equal(st._items?.[0].effect, 'safe');
    assert.equal(st._items?.[0].outside, res.ir.files[file].status === 'context');
    assert.ok(!res.warnings.some((w) => w.path === 'meta.impact'), 'meta.impact given: no warning');
  });
  test('a bad verdict is an error, and a missing meta.impact a warning', () => {
    const ir = load();
    delete ir.meta?.impact;
    ir.meta = { ...(ir.meta || {}), impact: undefined };
    ir.chapters[ir.chapters.length - 1].scenes!.push({ id: 'impact', steps: [{ do: 'impact', items: [{ file: 'src/config.ts', at: 1, effect: 'maybe' as never }] }] });
    const res = compile(ir, { repo });
    assert.match(res.errors.map((e) => e.message).join('\n'), /effect must be one of/);
    assert.ok(res.warnings.some((w) => w.path === 'meta.impact'));
  });
});

describe('explorer walk', () => {
  test('folders close up to the shared folder, then open down to the file; compact folders are one move', async () => {
    const { dirIndex, chain, foldMoves } = await import('../src/shared/tree-path.ts');
    const ix = dirIndex(['src/app/api/a.ts', 'src/app/api/b.ts', 'src/lib/x/y.ts', 'src/lib/z.ts', 'README.md']);
    assert.deepEqual(chain(ix, 'src/app/api/a.ts'), ['src', 'src/app/api']);
    assert.deepEqual(foldMoves(ix, 'src/app/api/a.ts', 'src/lib/x/y.ts').map((m) => `${m.kind}:${m.path}`), ['close:src/app/api', 'open:src/lib', 'open:src/lib/x', 'file:src/lib/x/y.ts']);
    assert.deepEqual(foldMoves(ix, null, 'README.md').map((m) => m.kind), ['file']);
  });
  test('tree picks are timed by the number of folder moves', () => {
    const res = compileFile(example, { repo });
    const picks = stepsOf(res.ir).filter((st) => st.do === 'open' && st._openKind === 'tree');
    assert.ok(picks.length > 0 && picks.every((st) => typeof st._fold === 'number' && st._fold >= 0));
  });
});

describe('i18n', () => {
  test('the published Korean table is complete and keeps every placeholder', async () => {
    const { validateTable, EN } = await import('../src/i18n/index.ts');
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, '..', '..', 'i18n', 'ko.json'), 'utf8'));
    const { table, problems } = validateTable(raw);
    assert.deepEqual(problems, []);
    assert.equal(Object.keys(table!.strings).length, Object.keys(EN).length);
  });
  test('the compiler names tour scenes from the table, and the page embeds it', () => {
    const ir = load();
    const table = { language: 'ko', strings: { 'tour.question': '{name}: 무엇이 바뀌었나' } };
    ir.meta = { ...(ir.meta || {}), language: 'ko' };
    const res = compile(ir, { repo, i18n: table });
    assert.ok(scenesOf(res.ir).some((x) => x.auto && /: 무엇이 바뀌었나$/.test(x.question || '')));
    const html = render(res.ir, { i18n: res.i18n });
    assert.match(html, /<script type="application\/json" id="walkthrough-i18n">\{"language":"ko"/);
    const noTable = compile(load(), { repo });
    assert.ok(!noTable.warnings.some((w) => w.path === 'meta.language') || /^en/.test(load().meta?.language || 'en') === false);
  });
  test('a table with unknown keys or broken placeholders keeps only what is valid', async () => {
    const { validateTable } = await import('../src/i18n/index.ts');
    const { table, problems } = validateTable({ language: 'xx', strings: { 'nope': 'a', 'refs.count': 'no hole', 'top.theme': 'T' } });
    assert.deepEqual(Object.keys(table!.strings), ['top.theme']);
    assert.ok(problems.some((p) => /unknown key/.test(p)) && problems.some((p) => /placeholders/.test(p)));
  });
});
