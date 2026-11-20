# Walkthrough IR v1: reference

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

The compiled IR also carries the repository's **file tree** at `head` (`tree`), so the player's explorer shows the real directory structure, not only the changed files. Folders start closed; picking a file has the pointer click the old file's folders closed and the new one's open, one at a time, and the compiler times the pick by the walk: how far the pointer travels and how many rows each folder shows or hides (`_walk`). Only the files listed in `files` (plus the other changed files) have content. Opening any other file shows a "content not embedded" placeholder. Very large repositories (over 25,000 files) are pruned to the directories that lead to embedded files.

---

## Top level

```jsonc
{
  "version": 1,
  "meta": {
    "title": "One-line title",
    "summary": "What changed and why, 1–3 sentences (inline markdown)",
    "intent": "feature | bugfix | refactor | api-change | perf | config | mixed",  // free text, shown as a badge
    "language": "en",                 // BCP-47; picks the UI string table (see "UI strings") and reading-time estimates
    "audience": "reviewer | newcomer | author",
    "strategy": {
      "order": "top-down | bottom-up | data-flow | symptom-cause-fix | before-after | clusters",
      "rationale": "Why this order, 1–2 sentences (shown on the overview card)"
    },
    "takeaways": ["2–4 key points shown on the recap screen"],
    "reviewFocus": ["Open questions the reviewer must decide"],
    "impact": [                       // what outside the diff the change reaches; `check` warns when empty
      { "text": "Callers of request(): GET now retried", "effect": "check", "files": ["src/users/service.ts"] }
    ]                                 // effect: safe | check | breaks | updated; files: optional, must be in `files`
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
  "tour": {                          // optional; the tour is ON by default ("tour": false turns it off)
    "order": ["path/a.ts", "path/b.ts"],               // file order of the replay (the narrative order)
    "tempo": { "path/a.ts": "skim", "path/b.ts#2": "key" },  // per file or per hunk: key | normal | skim
    "questions": { "path/b.ts": "What changes in the query?" } // optional question shown while a file replays
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
      "question": "The question the viewer has now, which this scene answers (shown above the code all scene long)",
      "at": { "file": "path/to/file.ts", "hunk": 2 },   // play right after the tour replays this hunk (or this file)
      "bridge": "Why this comes next: how the previous scene's answer raises this question (shown in the heading band when the scene starts)",
      "narration": "One lead sentence (why).\n\n- one bullet per visual beat\n- … (supports `code`, **bold**, *italic*)",
      "steps": [ /* Step */ ]
    }
  ]
}
```

## The tour: the whole diff is the spine

By default the compiler builds a **tour** that replays every changed hunk of every changed file exactly once, so nothing in the change can be skipped. Generated files and lock files are left out.

- **Order.** `tour.order` comes first. Files that are not listed follow in the order the author's scenes first touch them, then the remaining changed files, with tests last.
- **A file is written before it is shown, and after what it uses.** Every changed file a scene shows (opens, goes to, hovers, lists) is replayed before that scene, so a file is never visited and then created. Before a file is replayed, the changed files it uses (imports, and names declared on their added lines) are replayed first when they have no explanation scene of their own (an enum, a type, a constant); a barrel comes after the files it re-exports. A file used by another but explained later stays with its explanation, and `check` warns once with the pairs: order the scenes definitions first so the writing follows the dependencies.
- **Explanations attach to the tour.** A scene with `"at": { "file": "…", "hunk": 2 }` is played right after the tour has replayed that hunk; without `hunk`, after the whole file. Scenes without `at`, such as an overview graph, play where they are. The tour inserts the replay segments it needs before each attached scene. Hunks that no scene reaches are replayed in a final **Remaining changes** chapter.
- **Tempo per hunk.**

  | Tempo | Replay | Default for |
  |---|---|---|
  | `key` | typed character by character at a constant cadence (up to ~400 characters; longer hunks fall back to `normal` instead of typing faster) | a hunk a scene is attached to |
  | `normal` | lines arrive one by one (~107 ms per line) | everything else |
  | `skim` | the block appears at once | wiring: imports, re-exports, registrations, barrel files |

  Removed lines always turn red first.
- **Files appear and disappear.** An added file appears in the explorer when the tour (or a scene) first reaches it. A deleted file is struck through after its replay. A file's later hunks look unwritten until the tour reaches them.
- **Segments are light.** Replay segments carry no narration, no bridge, and no end-of-scene pause. The strip shows the file, `hunk i/n`, and a question ("What changed in …?", or `tour.questions`). The walkthrough panel lists them as file rows with one dot per hunk, and its header counts the hunks seen.
- **Returning to a file.** When an explanation scene continues in a file the tour has since left, the compiler inserts an `open` (a tab click) so that the switch is visible.

A `replay` step (`{ "do": "replay", "file", "hunk", "tempo" }`) is what the tour generates. Authors rarely write it themselves.

**How the player presents a scene** (see `design-rationale.md`):
1. Every scene after the first opens with a short **bridge** in the heading band at the top of the code: what was just seen, the `bridge`, and the file it goes to, right under the `question` this scene answers (marked in the strip). The code stays visible, receding a little, and the structure map marks the next stop.
2. While the scene plays, the strip above the code shows the scene number, the **question**, and the file in view.
3. Only **one explanation is visible at a time**: the current narration item or the latest `note`, whichever is newer. It is attached right under the code range most recently highlighted. When there is no code to attach to, for example the lead sentence or a graph, it appears in the heading band at the top of the code, under the scene's question.
4. Only the two most recent highlights stay fully salient; older ones recede to a thin bar.

**Narration items.** The narration is split into *items*: each sentence of a prose paragraph, and each `- ` bullet of a list paragraph. Items appear one by one as the scene plays. The current item is emphasised, earlier items stay, and later items are faint. A step can pin an item with **`cue: n`** (1-based), which makes item *n* appear when that step starts. Pin the items that name something on screen. An unpinned item arrives with the last unpinned highlight, focus, note, goto, back, peek, trace, refs, type, reveal or graph step before the next pin; the rest are spread by reading time. Every item and every `note` stays for its reading time: a step that brings in the next item or a note waits until then (they share one voice).

**Scene boundaries.** When a scene ends, highlights, focus, notes, hovers, debug sessions, the pointer, the references panel, the graph and the `say` caption are cleared. Open tabs, scroll positions and diff settings carry over, the same way they persist in an IDE. A split does not: the scene that opens the right pane closes it at its end (the pointer clicks its tab closed and the group slides out), unless the next scene's first step is in pane 1.

The scene duration is the longer of two values: the time its steps take, and the time its narration items need (each one's reading time, waited for before the next). By default the player pauses at the end of every scene.

## Step: common fields

| Field | Meaning |
|---|---|
| `do` | action name (see below) |
| `pane` | `0` (left) or `1` (right). Defaults to the pane used last. Using `1` opens a second group (see `open` and `layout`) |
| `file` | switch the pane to this file before acting, so you can skip an `open` step |
| `view` | `after` · `before` · `diff` |
| `ms` | duration override (ms at 1× speed) |
| `hold` | extra dwell time after the step (ms) |
| `with` | `true` starts this step together with the previous step |
| `cue` | `n`: narration item *n* appears when this step starts (see *Narration items*) |

## Actions

| `do` | Fields | Effect |
|---|---|---|
| `open` | `file`, `view?`, `at?` (anchor), `diff?` `{mode, algorithm, granularity, context, whitespace}` | Opens or switches to a file, **as a procedure**. A file not yet open is revealed in the explorer, the cursor clicks it, the tab opens, and its changes sweep in from top to bottom. A file already in a tab is clicked in the tab bar. The first time an added file is opened from the explorer, it is created first (New Folder for any folder it needs, then New File, each name typed, Enter); a renamed file is renamed (F2, the new name typed) or, when it changes folder, dragged onto the new folder (the compiler records it as `_fs`). The duration is derived. Default view: `after` for added and context files, `before` for deleted files, `diff` otherwise. With `pane: 1` and one group on screen, the file opens **to the side**: ⌥ is held for the click, a second group slides in, and `label` (what the two panes are read together for) is shown on the right pane; `check` warns when it is missing |
| `close` | `file` | Closes the tab |
| `delete` | `file` | Deletes the file from the explorer: right click on its row, Delete, the row folds away and its tab closes. The tour adds it after the last hunk of a deleted file; authors rarely need it |
| `layout` | `mode`: `single` · `columns` | One pane, or two panes side by side. Rarely needed: an `open` into pane 1 splits by itself, and the split closes when its scene ends. `single` closes a split early (the pointer clicks the right group's tab closed, the group slides out); where there is nothing to close it is dropped |
| `diffView` | `mode?` `unified`·`split`, `algorithm?` `patience`·`myers`, `granularity?` `word`·`line`, `context?` number or `null`, `whitespace?` `collapse`·`show` | Changes how the diff is rendered and switches the pane to `diff` view. Like GitHub, unchanged runs are folded behind `@@` hunk headers, keeping `context` lines (default **3**) around each change; `null` shows the whole file. Folds the walkthrough points at (highlights, notes, focus, scroll targets, typing) open automatically, and viewers can click a fold to open it |
| `reveal` | `at`, `align?` `center`·`top` | Smooth-scrolls to the anchor |
| `highlight` | `range`, `tone?` `focus`·`add`·`remove`·`info`·`warn`, `label?`, `reveal?` (default `true`) | Highlights lines. Highlights accumulate within a scene, and the pane scrolls only if the range is off-screen |
| `focus` | `range` | Dims everything outside the range and the current highlights |
| `unfocus` | `pane?` | Clears the focus |
| `note` | `at`, `text` (≤ 220 chars, inline markdown), `tone?` `info`·`why`·`risk`·`tip` | Shows an inline callout under the last line of the anchor |
| `type` | `range` | **Replays an edit.** Until this step runs (within its scene), the range looks *unwritten*: its added lines are hidden and its removed lines look unchanged. When the step runs, removed lines turn red one by one, then added text is typed in with a caret. The duration is derived from the amount of text at one constant cadence (about 29 chars/s at 1×), so a long edit takes longer instead of typing faster. Works in `diff` (unified or split) and in `after` (for example, a new file). Use it for the 1–3 key edits of a walkthrough, each ≤ ~15 lines |
| `goto` | `from: {at, token}`, `to: {file, at?, view?, pane?}` | Simulates Go to Definition: the pointer moves to `token`, holds ⌘ with the token underlined, clicks, jumps to the target, then flashes and highlights it. `to.at` defaults to `{symbol: token}`. `to.view` defaults to the view already open for that file in the target pane, otherwise `after` (like an IDE, a jump lands in the current code); `before` if the file was deleted. Set `"view": "diff"` to land in the diff |
| `back` | `pane?` | Go Back (⌃−): returns to the line the last `goto` was clicked on, lights it and flashes it. While away, the question strip shows the line it will return to. For a drill-down: `goto` a definition the line needs, 1 or 2 points, `back`. `check` warns about a `back` with no `goto` before it (an error), a drill-down inside a drill-down, a long one, or one that returns into another scene |
| `peek` | `from: {at, token}`, `to?: {file?, at?, view?}`, `range?` | ⌘-hover: the pointer rests on `token`, ⌘ is held, and the definition opens in a hover over the line (below it when there is no room above), syntax highlighted, with `range` (lines of the definition) lit. The line is never left. The hover stays while its sentence is read and closes when the next step moves on. `to.at` defaults to `{symbol: token}`, `to.file` to the pane's file. For a definition of up to ~8 lines; `check` warns above 14, and suggests `peek` for a `goto` to a short definition that is left again within a step or two |
| `trace` | `call?`, `frames: [{at, vars?}]`, `returns?`, `range?` | Steps through a function as a debugger does. `call` (the call with its arguments) starts a session: the debug toolbar appears on the editor's header and `range` (the function) stays lit while the rest dims. Per frame, Step Over moves the yellow stop to the frame's line (gliding, the editor keeping it in view) and its `vars` (`{"name": "value"}`, 1 to 3 short values) appear after the line's code, as VS Code's inline values; a value that differs from the one shown before for that name is outlined. `returns` shows the result on the last frame's line and ends the session. A `trace` without `call` continues the last session in its pane, so a run can be split across bullets (`cue`). While a session runs, the sentence is read at the top of the code. `check` warns above 10 frames, 4 values per frame, or long values |
| `refs` | `symbol`, `items: [{file, at, label?, view?}]`, `title?` | Opens a "N references" panel and visits each item in order |
| `impact` | `symbol?`, `change?`, `items: [{file, at, relation?, effect?, label?, view?}]`, `title?` | Like `refs`, for the places a change reaches outside the diff. The panel marks each item *outside the diff* (an unchanged file) or *changed here*, shows its `relation` and a verdict (`effect`: `safe`, `check`, `breaks`, `updated`), and lights each line in the verdict's colour. `check` warns when no item is outside the diff, and errors on an unknown `effect` |
| `graph` | `pin?` (default `true`), `unpin?` with `hide`, `nodes: [{id, label, sub?, file?, status?}]` (`status`: `added`·`modified`·`deleted`·`renamed`·`context`; defaults to the file's status, else `context`. Nodes without `file` are fine for external things such as a cron, a queue or an S3 path), `edges: [{from, to, label?, style?: "dashed"}]`, `highlight?: [nodeId \| "from->to"]`, `title?`, `size?` `panel`·`full`. Alternatives: only `highlight` to update the current graph, or `hide: true` | Draws a layered relationship graph, **full screen by default** (`size: "panel"` for a card). When its scene ends, a pinned graph docks as the **structure map** at the top of the walkthrough panel and stays for the rest of the walkthrough, lighting up the node whose `file` is in view. So give nodes a `file`. A later pinned graph replaces the map; `{ "do": "graph", "hide": true, "unpin": true }` removes it. Clicking a node with `file` opens that file |
| `say` | `text` | Replaces the caption under the narration and dwells for its reading time |
| `wait` | `ms` | Pause |
| `clear` | `pane?` | Clears highlights, notes and focus |

## UI strings

The player's own words (buttons, labels, tooltips, the names of generated tour scenes) come from a string table, never from the code. English is built in (`src/i18n/en.ts`, the source of truth for keys). A table for another language is a JSON file:

```json
{ "language": "ko", "strings": { "explorer.title": "탐색기", "refs.count": "참조 {n}곳" } }
```

- `code-walkthrough i18n <lang>` downloads the published table (`i18n/<lang>.json` at the repository root) once, validates it, and installs it next to the engine (`<engine dir>/../i18n/`, which is `<skill>/i18n/` for the skill). `check`, `build`, and `serve` then use the installed table for `meta.language` offline; `--i18n FILE` names one explicitly. `i18n --template` prints the English table to translate.
- Validation keeps only known keys with non-empty string values that keep their `{placeholders}`; anything missing falls back to English. Values are plain text and are always escaped.
- The compiler uses the table for the tour's generated scene titles and questions, and embeds it in the page as `<script type="application/json" id="walkthrough-i18n">`, separate from the IR, so a page can be given another language without recompiling the IR.
- `check` warns when `meta.language` is not English and no table was found.

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
