# Walkthrough IR v1 — reference

The IR is the only contract between whoever **plans** an explanation (an agent, a person, a tool) and the **engine** that plays it. It describes *what to show, in which order, and why*. The engine handles everything mechanical:

| Concern | Who |
|---|---|
| Choosing files, order, views, narration | IR author |
| Fetching file contents (git or inline) | engine (`compile`) |
| Turning anchors (`find`, `symbol`, `hunk`) into line numbers, and checking them | engine |
| Timing (step durations, reading time from text length) | engine (player) |
| Diff computation, layout, animation, controls | engine (player) |

So an IR never contains copied source code (unless the code is not in git), rarely contains line numbers, and never contains timestamps.

Pipeline: `authoring IR ──compile──► compiled IR (self-contained) ──render──► standalone HTML` (`code-walkthrough build`), or the same HTML served on localhost (`code-walkthrough serve`).

The compiled IR also carries the repository's **file tree** at `head` (`tree`), so the player's explorer shows the real directory structure, not only the changed files. Only the files listed in `files` (plus the other changed files) have content. Opening any other file shows a "content not embedded" placeholder. Very large repositories (over 25,000 files) are pruned to the directories that lead to embedded files.

---

## Top level

```jsonc
{
  "version": 1,
  "meta": {
    "title": "One-line title",
    "summary": "What changed and why, 1–3 sentences (inline markdown)",
    "intent": "feature | bugfix | refactor | api-change | perf | config | mixed",  // free text, shown as a badge
    "language": "en",                 // BCP-47; drives player UI strings (ko/en) and reading-time estimates
    "audience": "reviewer | newcomer | author",
    "strategy": {
      "order": "top-down | bottom-up | data-flow | symptom-cause-fix | before-after | clusters",
      "rationale": "Why this order, 1–2 sentences (shown on the overview card)"
    },
    "takeaways": ["2–4 key points shown on the recap screen"],
    "reviewFocus": ["Open questions the reviewer must decide"]
  },
  "source": {
    "repo": "path (optional; relative to the IR file; --repo overrides)",
    "range": "A...B | A..B",         // preferred: same syntax as git; A...B diffs from the merge-base (what a PR shows)
    "base": "git ref",               // or explicit refs (used when range is absent)
    "head": "git ref | WORKTREE"     // WORKTREE = uncommitted working tree, including untracked files
  },
  "files": {
    "path/from/repo/root.ext": {
      "status": "added | modified | deleted | renamed | copied | context",  // optional; detected from git
      "oldPath": "previous path for renames (optional; detected from git)",
      "role": "short role label shown in tabs/breadcrumbs (optional)",
      "language": "override language detection (optional)",
      "before": "inline content (optional; only for code not in git)",
      "after": "inline content (optional)"
    }
  },
  "glossary": [{ "term": "…", "definition": "one sentence" }],
  "chapters": [ /* Chapter */ ]
}
```

- `files` only needs the files your steps use. With a git source, every other changed file is added automatically as *un-narrated* so viewers can still explore it (disable with `--no-extra-files`). Lock files and generated files are skipped when their content cannot be read.
- A file used by a step but missing from `files` is registered as `context` and reported as a warning.
- `context` means "unchanged, shown for reference". Its `before` and `after` are the same.

## Chapter and Scene

```jsonc
{
  "id": "entry",
  "title": "What callers see",
  "goal": "Chapter goal (shown on the overview and recap)",
  "scenes": [
    {
      "id": "request-diff",            // unique; deep link: player.html#scene=request-diff
      "title": "request() now wraps send",
      "goal": "What the viewer knows after this scene (one sentence)",
      "narration": "One lead sentence (why).\n\n- one bullet per visual beat\n- … (supports `code`, **bold**, *italic*)",
      "steps": [ /* Step */ ]
    }
  ]
}
```

**Narration items.** The narration is split into *items*: each sentence of a prose paragraph, and each `- ` bullet of a list paragraph. Items appear one by one as the scene plays. The current item is emphasised, earlier items stay, and later items are faint. By default the items are spread over the scene's steps by text length. A step can pin an item with **`cue: n`** (1-based), which makes item *n* appear when that step starts. Pin the items that name something on screen.

**Scene boundaries.** When a scene ends, highlights, focus, notes, the pointer, the references panel, the graph and the `say` caption are cleared. Open tabs, layout, scroll positions and diff settings carry over, the same way they persist in an IDE.

The scene duration is the longer of two values: the time its steps take, and the reading time of its narration. By default the player pauses at the end of every scene.

## Step — common fields

| Field | Meaning |
|---|---|
| `do` | action name (see below) |
| `pane` | `0` (left) or `1` (right). Defaults to the pane used last. Using `1` switches the layout to `columns` |
| `file` | switch the pane to this file before acting, so you can skip an `open` step |
| `view` | `after` · `before` · `diff` |
| `ms` | duration override (ms at 1× speed) |
| `hold` | extra dwell time after the step (ms) |
| `with` | `true` starts this step together with the previous step |
| `cue` | `n`: narration item *n* appears when this step starts (see *Narration items*) |

## Actions

| `do` | Fields | Effect |
|---|---|---|
| `open` | `file`, `view?`, `at?` (anchor), `diff?` `{mode, algorithm, granularity, context, whitespace}` | Opens or switches to a file, **as a procedure**. A file not yet open is revealed in the explorer, the cursor clicks it, the tab opens, and its changes sweep in from top to bottom. A file already in a tab is clicked in the tab bar. The duration is derived. Default view: `after` for added and context files, `before` for deleted files, `diff` otherwise |
| `close` | `file` | Closes the tab |
| `layout` | `mode`: `single` · `columns` | One pane, or two panes side by side |
| `diffView` | `mode?` `unified`·`split`, `algorithm?` `patience`·`myers`, `granularity?` `word`·`line`, `context?` number or `null`, `whitespace?` `collapse`·`show` | Changes how the diff is rendered and switches the pane to `diff` view. Like GitHub, unchanged runs are folded behind `@@` hunk headers, keeping `context` lines (default **3**) around each change; `null` shows the whole file. Folds the walkthrough points at (highlights, notes, focus, scroll targets, typing) open automatically, and viewers can click a fold to open it |
| `reveal` | `at`, `align?` `center`·`top` | Smooth-scrolls to the anchor |
| `highlight` | `range`, `tone?` `focus`·`add`·`remove`·`info`·`warn`, `label?`, `reveal?` (default `true`) | Highlights lines. Highlights accumulate within a scene, and the pane scrolls only if the range is off-screen |
| `focus` | `range` | Dims everything outside the range and the current highlights |
| `unfocus` | `pane?` | Clears the focus |
| `note` | `at`, `text` (≤ 220 chars, inline markdown), `tone?` `info`·`why`·`risk`·`tip` | Shows an inline callout under the last line of the anchor |
| `type` | `range` | **Replays an edit.** Until this step runs (within its scene), the range looks *unwritten*: its added lines are hidden and its removed lines look unchanged. When the step runs, removed lines turn red one by one, then added text is typed in with a caret. The duration is derived from the amount of text (about 38 chars/s at 1×, capped at 7 s). Works in `diff` (unified or split) and in `after` (for example, a new file). Use it for the 1–3 key edits of a walkthrough, each ≤ ~15 lines |
| `goto` | `from: {at, token}`, `to: {file, at?, view?, pane?}` | Simulates Go to Definition: the pointer moves to `token`, holds ⌘ with the token underlined, clicks, jumps to the target, then flashes and highlights it. `to.at` defaults to `{symbol: token}`. `to.view` defaults to the view already open for that file in the target pane, otherwise `after` (like an IDE, a jump lands in the current code); `before` if the file was deleted. Set `"view": "diff"` to land in the diff |
| `refs` | `symbol`, `items: [{file, at, label?, view?}]`, `title?` | Opens a "N references" panel and visits each item in order |
| `graph` | `pin?` (default `true`), `unpin?` with `hide`, `nodes: [{id, label, sub?, file?, status?}]` (`status`: `added`·`modified`·`deleted`·`renamed`·`context`; defaults to the file's status, else `context`. Nodes without `file` are fine for external things such as a cron, a queue or an S3 path), `edges: [{from, to, label?, style?: "dashed"}]`, `highlight?: [nodeId \| "from->to"]`, `title?`, `size?` `panel`·`full`. Alternatives: only `highlight` to update the current graph, or `hide: true` | Draws a layered relationship graph, **full screen by default** (`size: "panel"` for a card). When its scene ends, a pinned graph docks as the **structure map** at the top of the walkthrough panel and stays for the rest of the walkthrough, lighting up the node whose `file` is in view. So give nodes a `file`. A later pinned graph replaces the map; `{ "do": "graph", "hide": true, "unpin": true }` removes it. Clicking a node with `file` opens that file |
| `say` | `text` | Replaces the caption under the narration and dwells for its reading time |
| `wait` | `ms` | Pause |
| `clear` | `pane?` | Clears highlights, notes and focus |

## Anchors

`at` (a point) and `range` (a span) share one syntax.

| Form | Meaning |
|---|---|
| `12` or `[12, 18]` | line, or inclusive line range |
| `{ "line": 12, "span": 3 }` / `{ "lines": [12, 18] }` | same, object form (`span` = total lines, so this is 12–14) |
| `{ "find": "substring", "nth": 1, "span": 1, "block": false }` | the n-th line containing the substring (matched within a single line). `span: N` makes the range N lines in **total**, starting at the match. `block: true` takes the whole block that starts on that line |
| `{ "regex": "^export function \\w+", "nth": 1 }` | the same, matched with a JavaScript regular expression |
| `{ "symbol": "withRetry", "nth": 1, "head": false }` | the definition's whole block (`head: true`: only its first line) |
| `{ "hunk": 2 }` | the file's 2nd change block. Uses the after side, or the before side for a pure deletion |

Every form accepts `"side": "before" | "after"`. The default is the pane's view: `before` view → `before`, otherwise `after`. In a `diff` view, use `"side": "before"` to point at removed lines. In an `after` or `before` view, an anchor on the other side is an error.

Prefer `find` and `symbol`. They survive small code edits, and when they don't match, the compiler reports exactly which file, side and text failed. A `find` string should be unique in its file; if it isn't, add `nth`.

## Diagnostics

`code-walkthrough check ir.json [--json]` reports:

**Errors** (the build fails):
- unknown `do`, unknown file, invalid enum value
- anchor not found, line out of range, anchor on a side the pane does not show
- `goto.from.token` not present on the anchor line
- duplicate scene id
- no chapters
- source refs that cannot be resolved

**Warnings** (cognitive-load guards and authoring hazards):
- more than 7 scenes in a chapter
- more than 12 steps in a scene
- narration over 600 characters
- note over 220 characters
- scene without narration
- auto-registered files
- `cue` out of range (an **error**: it must be within the narration's item count)
- **ambiguous anchors**: a `find` or `regex` without `nth` that matches more than one line (the first match is used)

With `--json`, the output on stdout is `{ ok, errors: [{path, message}], warnings: [...], stats, resolved?, out? }`. Each `path` looks like `chapters[1].scenes[0](request-diff).steps[3]`.

- `stats`: `chapters`, `scenes`, `files`, `estimatedSeconds` (playback length at 1×, from the same timing model the player uses), `unnarratedFiles` (changed files that no step or graph node touches)
- `resolved` (with `--resolve`): one entry per anchor, `{path, do, file, side, from, to, text}`, where `text` is the first resolved line. A passing check proves anchors *exist*. `resolved` shows whether they are the *intended* lines
- Error messages for a `find` that does not match also look on the other side ("it is on the before side (line N)") and for whitespace- or case-insensitive near matches

## Minimal example

```json
{
  "version": 1,
  "meta": { "title": "Fix crash on users without a profile", "summary": "…", "intent": "bugfix", "language": "en",
            "strategy": { "order": "symptom-cause-fix", "rationale": "…" } },
  "source": { "base": "main", "head": "HEAD" },
  "files": { "src/user.ts": { "role": "user lookup" } },
  "chapters": [{ "id": "fix", "title": "Cause and fix", "scenes": [
    { "id": "cause", "title": "Where it crashes", "goal": "Know the failing line",
      "narration": "`.name` is read from `profile`, which is optional.",
      "steps": [
        { "do": "open", "file": "src/user.ts", "view": "before" },
        { "do": "highlight", "range": { "find": "user.profile.name" }, "tone": "warn", "label": "cause" },
        { "do": "note", "at": { "find": "user.profile.name" }, "text": "`profile` is optional in the schema.", "tone": "why" }
      ] },
    { "id": "fix", "title": "The fix", "goal": "Know how it is guarded", "narration": "…",
      "steps": [
        { "do": "diffView", "mode": "split" },
        { "do": "highlight", "range": { "hunk": 1 }, "tone": "add" }
      ] }
  ] }]
}
```

The full worked example is `examples/retry/walkthrough.json`; build its demo repository with `node examples/retry/make-demo-repo.mjs <dir>`.
