# code-walkthrough engine

The engine executes **Walkthrough IR v1**. It validates the IR, resolves it against a git repository, and plays it as an animated, IDE-like code walkthrough. You can export the player as one standalone HTML file or serve it on localhost.

The engine does not decide *what* to explain. Its input is IR written by a person, an agent (see `skills/code-change-walkthrough`), or another tool.

## CLI

```
code-walkthrough check  <ir.json> [--repo DIR] [--json]
code-walkthrough build  <ir.json> [-o out.html] [--repo DIR] [--json]
code-walkthrough serve  <ir.json|player.html> [--port 4173] [--host 127.0.0.1] [--repo DIR] [--open] [--no-watch]
code-walkthrough spec | schema | version
```

| Command | What it does |
|---|---|
| `check` | Compiles without writing anything. Exits 1 on IR errors. With `--json`, prints `{ok, errors:[{path,message}], warnings, stats}` |
| `build` | Writes a single offline HTML file (player, styles, diff engine, and compiled IR inlined; no external requests) |
| `serve` | Serves exactly that HTML at `http://127.0.0.1:<port>/`. With an IR input, it recompiles on every save and reloads open tabs at the same scene. If the IR becomes invalid, the tab keeps the last valid build and shows the diagnostics in an overlay. It also accepts a prebuilt `.html` |
| `spec` / `schema` | Print the IR reference (`docs/ir-v1.md`) and the JSON Schema (`schema/walkthrough-ir.v1.schema.json`) |

`serve` also exposes `/walkthrough.json` (the compiled IR) and `/__diagnostics`.

## Pipeline

```
authoring IR ──compile──► compiled IR ──render──► standalone HTML ──(serve)──► localhost
              src/compile.mjs           src/compile.mjs#render     src/serve.mjs
```

- **compile** fetches `before` and `after` contents from git (`source.base` / `source.head`, where `WORKTREE` means uncommitted changes) unless they are given inline. It resolves anchors (`find`, `regex`, `symbol`, `hunk`, lines) to concrete lines, checks them, adds un-narrated changed files for exploration, and strips local paths.
- **player** (`player/`) is a self-contained page. The visible state is a pure function of time, `state(T) = reduce(scene snapshot, steps started by T)`, so playing, pausing, scrubbing, speed changes, and scene jumps all produce identical frames. It includes:
  - IDE chrome: file tree, tabs, breadcrumbs, split panes
  - unified and split diffs: Myers or Patience, word-level highlighting, whitespace-only changes collapsed, context folding
  - smooth reveal, highlight, focus, and inline notes
  - simulated ⌘+Click go-to-definition, a references panel, and a layered relationship graph
  - learner-paced playback, light and dark themes, and a mobile layout
  - free exploration while paused: browse files, ⌘/Ctrl+Click to go to a definition

## Design

The player's layout and motion follow rules M1–M12 grounded in perception and learning research. Examples are visual momentum, overview+detail, procedural navigation, one motion at a time, and narration synchronised with visuals. See [`docs/design-rationale.md`](docs/design-rationale.md).

## Library use

```js
import { compileFile, render } from 'code-walkthrough-engine';
const res = compileFile('walkthrough.json', { repo: '/path/to/repo' });
if (res.ok) fs.writeFileSync('out.html', render(res.ir));
```

## Test

```bash
npm test   # builds the demo repo, compiles and renders the example, checks diagnostics, exercises serve
```
