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
/** The example with a drill-down in it: `transient` goes to HttpError and comes back, instead of peeking at it. */
const withDrillDown = (): Walkthrough => {
  const ir = load();
  const sc = scenesOf(ir).find((x) => x.id === 'transient')!;
  const i = sc.steps!.findIndex((st) => st.do === 'peek');
  sc.steps!.splice(i, 1,
    { do: 'goto', from: { at: { find: 'err instanceof HttpError' }, token: 'HttpError' }, to: { file: 'src/api/retry.ts', at: { symbol: 'HttpError' } }, cue: 2 },
    { do: 'highlight', range: { find: 'constructor(public status' }, tone: 'info', label: 'status' },
    { do: 'back' });
  return ir;
};

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
    const peek = byId(res.ir, 'transient').steps!.find((st) => st.do === 'peek')!;
    assert.deepEqual([peek._peek?.file, peek._peek?.from, peek._peek?.to, peek._peek?.mark?.from], ['src/api/retry.ts', 26, 30, 27]);
    assert.ok(res.stats.estimatedSeconds > 30 && res.stats.estimatedSeconds < 240, `estimate ${res.stats.estimatedSeconds}s`);
    assert.deepEqual(res.stats.unnarratedFiles, []);
    const dd = compile(withDrillDown(), { repo });
    assert.ok(dd.resolved.some((r) => r.path.endsWith('.to') && r.file === 'src/api/retry.ts' && r.from === 26), 'resolved report includes goto targets');
    assert.equal(res.ir.tree?.root, 'repo');
    assert.ok(res.ir.tree?.files.some(([d, n]) => res.ir.tree!.dirs[d] === 'src/users' && n === 'profile.ts'), 'explorer tree includes unchanged files');
  });

  test('diagnostics say what is wrong and how to fix it', () => {
    const broken = load();
    byId(broken, 'request-diff').steps![1].range = { find: 'this text does not exist' };
    byId(broken, 'transient').steps!.find((st) => st.do === 'peek')!.from!.token = 'nope';
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
    const res = compileFile(example, { repo });
    assert.equal(res.ok, true, JSON.stringify(res.errors));
    const st = stepsOf(res.ir).find((x) => x.do === 'impact')!;
    assert.deepEqual(st._items?.map((x) => [x.effect, x.outside]), [['check', true], ['safe', true]], 'callers in service.ts: unchanged, so outside the diff');
    assert.ok(!res.warnings.some((w) => w.path === 'meta.impact'), 'meta.impact given: no warning');
    assert.ok(res.stats.outsideDiff.includes('src/users/service.ts'));
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
    // one click on the outermost folder of the old branch folds everything under it
    assert.deepEqual(foldMoves(ix, 'src/lib/x/y.ts', 'README.md').map((m) => `${m.kind}:${m.path}`), ['close:src', 'file:README.md']);
  });
  test('a walk takes as long as its travel: a row farther away takes longer; a folder opens in a fixed time', async () => {
    const { dirIndex, walkPlan } = await import('../src/shared/tree-path.ts');
    const few = dirIndex(['a/x.ts', 'b/y.ts']);
    const many = dirIndex(['a/x.ts', 'b/y.ts', ...Array.from({ length: 30 }, (_, i) => `b/f${String(i).padStart(2, '0')}.ts`)]);
    const ms = (ix: ReturnType<typeof dirIndex>) => walkPlan(ix, 'a/x.ts', 'b/y.ts').reduce((s, x) => s + x.ms, 0);
    assert.ok(ms(many) > ms(few) + 500, `${ms(many)} vs ${ms(few)}`);
    const toggle = (ix: ReturnType<typeof dirIndex>) => { const g = walkPlan(ix, 'a/x.ts', 'b/y.ts')[1]; return g.ms * (1 - g.click); };
    assert.equal(Math.round(toggle(many)), Math.round(toggle(few)));
    // a deep path is not squeezed: every folder click keeps at least its own time
    const dirs = Array.from({ length: 12 }, (_, i) => Array.from({ length: i + 1 }, (_, j) => `d${j}`).join('/'));
    const deep = dirIndex([...dirs.map((d) => `${d}/f.ts`), 'z/g.ts']);
    const plan = walkPlan(deep, 'z/g.ts', `${dirs[11]}/f.ts`);
    assert.equal(plan.length, 1 + 1 + 12);
    assert.ok(plan.slice(0, -1).every((x) => x.ms >= 800));
  });
  test('file operations: a drag only opens folders; a walk from a folder starts at its row', async () => {
    const { dirIndex, foldMoves, walkPlan, inFolder } = await import('../src/shared/tree-path.ts');
    const ix = dirIndex(['src/lib/a.ts', 'src/lib/b.ts', 'src/api/c.ts', 'src/api/d.ts', ...Array.from({ length: 20 }, (_, i) => `src/api/z${i}.ts`)]);
    assert.deepEqual(foldMoves(ix, 'src/lib/a.ts', inFolder('src/api'), true).map((m) => m.kind), ['open', 'file']);
    // from the folder's row to a file far down in it takes longer than to one near the top
    const ms = (to: string) => walkPlan(ix, inFolder('src/api'), to).reduce((a, x) => a + x.ms, 0);
    assert.ok(ms('src/api/z9.ts') > ms('src/api/c.ts') + 300);
  });
  test('tree picks are timed by their walk', () => {
    const res = compileFile(example, { repo });
    const picks = stepsOf(res.ir).filter((st) => st.do === 'open' && st._openKind === 'tree');
    assert.ok(picks.length > 0 && picks.every((st) => typeof st._walk === 'number' && st._walk >= 0));
  });
});

describe('procedures', () => {
  test('the screen moves only after the sentence on it has been read, and that sentence leaves first', async () => {
    const { layoutScene, CLEAR_MS, stepPhases } = await import('../src/shared/procedure.ts');
    const { dwellMs } = await import('../src/shared/timing.ts');
    const lead = 'One endpoint, two stages';
    const sc = { narration: `${lead}\n\n- the check\n- the query`, steps: [
      { do: 'goto', from: { token: 'x' }, _from: { file: 'a.ts', side: 'after', line: 3 }, _to: { file: 'b.ts', pane: 0, line: 9, side: 'after' }, _walk: 900 },
      { do: 'highlight', _move: 600, cue: 2 },
      { do: 'highlight', _move: 0, cue: 3 },
    ] } as unknown as Parameters<typeof layoutScene>[0];
    const lay = layoutScene(sc, 0);
    const read = dwellMs(lead);
    // the goto (a motion, no cue) waits for the lead to be read, behind a gate, plus the time the lead takes to close
    assert.equal(lay.gates[0], read);
    assert.equal(lay.timed[0].start, read + CLEAR_MS);
    // a sentence arrives with its mark, after the scroll that brings its code in
    const ph = stepPhases(sc.steps![1]);
    const scroll = ph.find((x) => x.name === 'scroll')!.ms;
    assert.ok(scroll > 600, `scroll ${scroll} ms for 600 px`);
    assert.equal(Math.round(lay.cues.times[1]), Math.round(lay.timed[1].start + scroll));
  });
  test('a motion takes the time its amount needs; an act takes a fixed time', async () => {
    const { stepPhases } = await import('../src/shared/procedure.ts');
    const near = stepPhases({ do: 'highlight', _move: 40 } as never), far = stepPhases({ do: 'highlight', _move: 700 } as never);
    const ms = (ph: { name: string; ms: number }[], n: string) => ph.find((x) => x.name === n)!.ms;
    assert.ok(ms(far, 'scroll') > ms(near, 'scroll') * 2);
    assert.equal(ms(far, 'mark'), ms(near, 'mark'));
    const walk = stepPhases({ do: 'highlight', _walk: 1500 } as never);
    assert.equal(walk[0].name, 'walk'); assert.equal(walk[0].ms, 1500);
  });
});

describe('preview', () => {
  test('an explanation attached to a file is announced before the file is replayed', () => {
    const res = compileFile(example, { repo });
    const scs = scenesOf(res.ir);
    const i = scs.findIndex((x) => x._previewed);
    assert.ok(i > 0, 'some scene is previewed');
    const sc = scs[i];
    // the tour scene right before it replays its file, and opens with its bridge and question
    let k = i - 1;
    while (k > 0 && scs[k - 1].auto && scs[k - 1].tour?.file === sc.at!.file) k--;
    assert.equal(scs[k].tour?.file, sc.at!.file);
    assert.equal(scs[k].bridge, sc.bridge);
    assert.equal(scs[k].question, sc.question);
  });
});

describe('drill-down', () => {
  test('back returns to the line its goto was clicked on, and marks that goto as a detour', () => {
    const res = compile(withDrillDown(), { repo });
    const steps = stepsOf(res.ir);
    const b = steps.findIndex((st) => st.do === 'back');
    assert.ok(b > 0, 'the example drills down');
    const g = steps.slice(0, b).reverse().find((st) => st.do === 'goto')!;
    assert.equal(g._detour, true);
    assert.equal(steps[b]._to?.file, g._from?.file);
    assert.equal(steps[b]._to?.line, g._from?.line);
    assert.ok(!res.warnings.some((w) => /drill-down/.test(w.message)), 'the example drill-down is short and one level deep');
  });
  test('a back with nothing to return to is an error; a drill-down inside a drill-down is warned', () => {
    const ir = load();
    const first = ir.chapters[0].scenes![0];
    first.steps = [...(first.steps || []), { do: 'back' }];
    assert.ok(compile(ir, { repo }).errors.some((e) => /"back" needs a "goto"/.test(e.message)));
    const ir2 = withDrillDown();
    const sc = ir2.chapters.flatMap((ch) => ch.scenes || []).find((x) => x.id === 'transient')!;
    const g = sc.steps!.find((st) => st.do === 'goto')!;
    const i = sc.steps!.indexOf(g);
    // a second goto (back to the same definition) before the first returns, then two backs
    sc.steps!.splice(i + 1, 0, { ...g, cue: undefined, from: { at: { find: 'constructor(public status' }, token: 'status' }, to: { file: 'src/api/retry.ts', at: { find: 'constructor(public status' } } }, { do: 'back' });
    assert.ok(compile(ir2, { repo }).warnings.some((w) => /drill-down inside a drill-down/.test(w.message)));
  });
});

describe('split', () => {
  test('a split opens to the side with its reason, and closes with its scene', () => {
    const res = compileFile(example, { repo });
    const sc = byId(res.ir, 'config');
    const open = sc.steps!.find((st) => st.do === 'open' && st.pane === 1)!;
    assert.equal(open._side, true, 'the first file in pane 1 opens to the side');
    const last = sc.steps![sc.steps!.length - 1];
    assert.deepEqual([last.do, last.mode, last._close], ['layout', 'single', true], 'the scene that split closes the split');
    assert.ok(!sc.steps!.some((st) => st.do === 'layout' && st.mode === 'columns'), 'no layout step is needed to split');
    assert.ok(!byId(res.ir, 'callers').steps!.some((st) => st.do === 'layout'));
    // tour scenes run in one group
    const scs = scenesOf(res.ir);
    const after = scs.slice(scs.indexOf(sc) + 1).filter((x) => x.auto);
    assert.ok(after.length && after.every((x) => (x.steps || []).every((st) => st._pane !== 1 && st.pane !== 1)));
  });
  test('a split without a reason is warned; a return to one pane with nothing to close is dropped', () => {
    const ir = load();
    const sc = scenesOf(ir).find((x) => x.id === 'config')!;
    delete sc.steps!.find((st) => st.do === 'open')!.label;
    scenesOf(ir).find((x) => x.id === 'tests')!.steps!.unshift({ do: 'layout', mode: 'single' });
    const res = compile(ir, { repo });
    assert.ok(res.warnings.some((w) => /a split needs a reason/.test(w.message)));
    assert.ok(!byId(res.ir, 'tests').steps!.some((st) => st.do === 'layout'));
  });
  test('the player closes the right group over time: the pointer clicks its tab, the group slides out', async () => {
    const { stepPhases } = await import('../src/shared/procedure.ts');
    assert.deepEqual(stepPhases({ do: 'layout', mode: 'single', _close: true } as never).map((x) => x.name), ['travel', 'click', 'collapse']);
    const side = stepPhases({ do: 'open', file: 'a.ts', _openKind: 'tree', _side: true } as never).map((x) => x.name);
    assert.ok(side.indexOf('split') > side.indexOf('press') && side.indexOf('split') < side.indexOf('swap'), side.join(','));
  });
});

describe('peek and trace', () => {
  test('a short definition gone to and back is suggested as a peek', () => {
    const res = compile(withDrillDown(), { repo });
    assert.ok(res.warnings.some((w) => /definition is 5 lines: show it in a hover with "peek"/.test(w.message)));
    assert.ok(!compileFile(example, { repo }).warnings.some((w) => /peek/.test(w.message)));
  });
  test('a trace resolves its stops, continues its session, and ends it with the result', () => {
    const res = compileFile(example, { repo });
    const [a, b] = byId(res.ir, 'withretry').steps!.filter((st) => st.do === 'trace');
    assert.deepEqual(a._frames?.map((f) => f.line), [10, 13, 15, 16, 17]);
    assert.deepEqual(a._frames?.[0].vars, [['attempt', '0']]);
    assert.equal(b._session, a._session, 'a trace without a call continues the session');
    assert.equal(b.returns, "'ok'");
    const ir = load();
    const t = scenesOf(ir).find((x) => x.id === 'withretry')!.steps!.find((st) => st.do === 'trace')!;
    delete t.call;
    assert.ok(compile(ir, { repo }).errors.some((e) => /trace needs "call"/.test(e.message)));
  });
  test('a trace is timed per stop: the step to it as far as it is, the values read', async () => {
    const { stepPhases, valuesMs } = await import('../src/shared/procedure.ts');
    const st = { do: 'trace', call: 'f(1)', _frames: [{ side: 'after', line: 3, vars: [['x', '1']] }, { side: 'after', line: 40, vars: [['total', '120'], ['items', '[a, b, c]']] }], _frameMove: [0, 900], returns: '120' };
    const ph = stepPhases(st as never);
    assert.deepEqual(ph.map((x) => x.name), ['head', 'step', 'mark', 'hold', 'step', 'mark', 'hold', 'ret']);
    const step = ph.filter((x) => x.name === 'step');
    assert.ok(step[1].ms > step[0].ms * 2, 'a far stop takes longer to reach');
    assert.ok(valuesMs([['total', '120'], ['items', '[a, b, c]']]) > valuesMs([['x', '1']]));
  });
});

describe('writing order', () => {
  test('a file is written before a scene shows it, and after what it uses that has no scene of its own', () => {
    const res = compileFile(example, { repo });
    const files = scenesOf(res.ir).filter((x) => x.auto).map((x) => x.tour!.file);
    assert.deepEqual(files, ['src/api/retry.ts', 'src/config.ts', 'src/api/client.ts', 'test/retry.test.ts']);
    assert.ok(!res.warnings.some((w) => w.path === 'tour'), 'definitions first: no file is written before what it uses');
    // the example in the old order (the entry first): client.ts uses retry.ts, explained later → warned
    const ir = load();
    ir.tour = { order: ['src/api/client.ts', 'src/api/retry.ts', 'src/config.ts', 'test/retry.test.ts'] };
    const [ov, retry, entry, impact] = ir.chapters;
    ir.chapters = [ov, entry, retry, impact];
    const top = compile(ir, { repo });
    assert.match(top.warnings.find((w) => w.path === 'tour')?.message || '', /client\.ts → retry\.ts/);
    // a scene that shows a file before its own stop: the file is written before that scene
    const ir2 = load();
    scenesOf(ir2).find((x) => x.id === 'transient')!.steps!.push({ do: 'peek', from: { at: { find: 'return idempotent' }, file: 'src/api/client.ts', token: 'withRetry' }, to: { file: 'src/api/retry.ts', at: { symbol: 'isTransient' } } });
    const res2 = compile(ir2, { repo });
    const scs = scenesOf(res2.ir);
    const writes = (f: string) => scs.findIndex((x) => x.auto && x.tour?.file === f);
    assert.ok(writes('src/api/client.ts') < scs.findIndex((x) => x.id === 'transient'), 'client.ts is written before the scene that shows it');
  });
  test('dependencies: imports and names declared on added lines', () => {
    // a DTO uses an enum through a path alias (found by the name), a barrel re-exports the DTO
    const ir = { version: 1, tour: { order: ['src/dto.ts', 'src/index.ts', 'src/enum.ts'] }, files: {
      'src/enum.ts': { status: 'added', before: null, after: 'export enum Kind {\n  a = "a",\n}\n' },
      'src/dto.ts': { status: 'added', before: null, after: "import { Kind } from '@alias/enums';\nexport class Dto {\n  kind: Kind;\n}\n" },
      'src/index.ts': { status: 'added', before: null, after: "export * from './dto';\n" },
    }, chapters: [{ title: 'DTO', scenes: [{ id: 'dto', at: { file: 'src/dto.ts' }, question: 'q', narration: 'n', steps: [{ do: 'open', file: 'src/dto.ts' }] }] }] } as unknown as Walkthrough;
    const res = compile(ir, {});
    assert.equal(res.ok, true, JSON.stringify(res.errors));
    assert.deepEqual(scenesOf(res.ir).filter((x) => x.auto).map((x) => x.tour!.file), ['src/enum.ts', 'src/dto.ts', 'src/index.ts']);
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
    // detached from the explanation scenes, tour scenes keep their generated question (an attached one previews its scene's)
    for (const ch of ir.chapters || []) for (const sc of ch.scenes || []) delete sc.at;
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
