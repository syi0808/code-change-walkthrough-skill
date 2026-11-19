# code-walkthrough engine

The engine executes **Walkthrough IR v1**. It validates the IR, resolves it against a git repository, and plays it as an animated, IDE-like code walkthrough. You can export the player as one standalone HTML file or serve it on localhost.

The engine does not decide *what* to explain. Its input is IR written by a person, an agent (see `skills/code-change-walkthrough`), or another tool. It also ships `collect`, the change analysis an authoring agent reads before writing IR.

## CLI

```
code-walkthrough check  <ir.json> [--repo DIR] [--json] [--resolve]
code-walkthrough build  <ir.json> [-o out.html] [--repo DIR] [--json]
code-walkthrough serve  <ir.json|player.html> [--port 4173] [--host 127.0.0.1] [--repo DIR] [--open] [--no-watch]
code-walkthrough i18n   <lang> [--force] [--dir DIR] [--from URL] | --template
code-walkthrough spec | schema | version
code-walkthrough-collect [--repo DIR] [--range A..B | A...B] [--out DIR|FILE.json] [--json]
```

| Command | What it does |
|---|---|
| `check` | Compiles without writing anything. Exits 1 on IR errors. With `--json`, prints `{ok, errors:[{path,message}], warnings, stats}` |
| `build` | Writes a single offline HTML file (player, styles, and compiled IR inlined; no external requests) |
| `serve` | Serves exactly that HTML at `http://127.0.0.1:<port>/`. With an IR input, it recompiles on every save and reloads open tabs at the same scene. If the IR becomes invalid, the tab keeps the last valid build and shows the diagnostics in an overlay. It also accepts a prebuilt `.html` |
| `i18n` | Installs the player's UI string table for a language (one download from `i18n/<lang>.json` in this repository, validated, then used offline). `check` / `build` / `serve` pick it up for `meta.language`, or take `--i18n FILE`. `--template` prints the English table to translate |
| `spec` / `schema` | Print the IR reference (`docs/ir-v1.md`) and the JSON Schema (`schema/walkthrough-ir.v1.schema.json`) |
| `collect` | Change context: changed symbols, fan-in and fan-out, clusters, reading orders. Writes JSON outside the repository and prints a digest |

`serve` also exposes `/walkthrough.json` (the compiled IR) and `/__diagnostics`.

## Pipeline

```
                    (engine build, once)
  src/player  ──Svelte + esbuild──►  player template (JS + CSS, minified)
                                              │ inlined
authoring IR ──compile──► compiled IR ──render┴─► standalone HTML ──(serve)──► localhost
             src/compile               src/render                 src/serve
```

Compiling an IR never builds the player: `render` only fills the prebuilt template with the compiled IR.

- **compile** fetches `before` and `after` contents from git (`source.base` / `source.head`, where `WORKTREE` means uncommitted changes) unless they are given inline. It expands the tour (every changed hunk), resolves anchors (`find`, `regex`, `symbol`, `hunk`, lines) to concrete lines, checks them, adds un-narrated changed files for exploration, and strips local paths.
- **player** is a Svelte 5 app on one clock. The visible state is a pure function of timeline time, `state(T) = reduce(scene snapshot, steps started by T)`, so playing, pausing, scrubbing, speed changes, and scene jumps all produce identical frames, and every motion follows the speed control. It includes:
  - IDE chrome: file tree, tabs, breadcrumbs, split panes
  - files created, renamed, moved and deleted in the explorer the way a person does it (New File and a typed name, F2, drag and drop, right click Delete)
  - unified and split diffs: Myers or Patience, word-level highlighting, whitespace-only changes collapsed, context folding
  - the whole diff replayed (typed, line by line, or as a block), with explanation scenes as stops
  - simulated ⌘+Click go-to-definition, a references panel, and a layered relationship graph
  - learner-paced playback, light and dark themes, and a mobile layout
  - captions read aloud with the browser's speech synthesis (opt-in, `V`); the timeline waits for a sentence to end
  - free exploration while paused: browse files, ⌘/Ctrl+Click to go to a definition

## Source layout

```
src/
  ir/types.ts         the IR as TypeScript types (authoring fields + compiler "_" fields)
  shared/             used by both the compiler and the player: diff, highlight, timing, tree paths
  i18n/               UI string keys (English built in) and table validation
  repo/               git access and language heuristics
  compile/            context, anchors, tour, steps, tree, index (compile / compileFile)
  render/  serve/     standalone HTML, localhost server
  analyze/collect.ts  change context for authors
  cli/                engine and collect command lines
  player/
    core/             pure state: timeline, state(T), code models, decorations, voice, notes
    app/              the playback controller (one clock; one DOM update then ordered layout steps)
    ui/               Svelte components (App, Explorer, Stage, Pane, Guide, Graph, Pointer, ...)
    styles/           tokens and per-area CSS
scripts/build.mjs     player -> bundles -> dist/ and the skill's scripts/
```

## Design

The player's layout and motion follow rules M1–M32 grounded in perception and learning research: visual momentum, overview+detail, procedural navigation, one clock, one moving region at a time, room before content, a steady rhythm, lines uncovered in place while the page carries the write head, reading that paces the scene, a selection that moves instead of blinking, explanations read at the top next to the question, an explorer that walks the path, the outside of the diff shown and labelled, words kept as data, frames that depend on their time only, and explanations placed where they hide nothing. See [`docs/design-rationale.md`](docs/design-rationale.md).

## Library use

```js
import { compileFile, render } from 'code-walkthrough-engine';
const res = compileFile('walkthrough.json', { repo: '/path/to/repo' });
if (res.ok) fs.writeFileSync('out.html', render(res.ir));
```

## Develop

```bash
npm install
npm run build        # player, dist/ (npm package + types), and the skill's bundled scripts
npm run typecheck    # TypeScript and Svelte (svelte-check)
npm test             # build, then test/*.test.ts with node:test (Node 22.18+ runs TypeScript directly)
```

The bundles in `skills/code-change-walkthrough/scripts/` are build output: commit them with the source change. `npm run check:skill` fails when they are stale.
