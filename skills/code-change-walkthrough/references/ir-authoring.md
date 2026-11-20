# Authoring Walkthrough IR

This guide covers *how to write good IR*. The authoritative contract is whatever the installed engine prints:

```bash
node "<skill>/scripts/engine.mjs" spec     # IR v1 reference (fields, actions, anchors, diagnostics)
node "<skill>/scripts/engine.mjs" schema   # JSON Schema (structural)
```

The engine's `examples/retry/walkthrough.json` is a complete worked example: 4 chapters, 8 scenes, in dependency order, with a peek, a trace, a split, an impact list and a replayed rewrite.

## The tour and its stops

The engine replays every changed hunk; you decide the order and where to stop.

```json
"tour": {
  "order": ["src/api/client.ts", "src/api/retry.ts", "src/config.ts", "test/retry.test.ts"],
  "tempo": { "src/api/client.ts#3": "key", "src/index.ts": "skim" }
},
"chapters": [{ "title": "What callers see", "scenes": [
  { "id": "request", "at": { "file": "src/api/client.ts", "hunk": 3 }, "question": "What happens now when a request fails?", … }
] }]
```

- **Every changed file goes in `order`**, following the question chain. Unlisted files are appended, but you want them where they make sense.
- **Order by dependency (R14):** after the map, definitions first (enums, types, DTOs, helpers, the new module), then the code that uses them, the entry point that assembles them last. The tour writes each file when its scene comes, so this is the order the code is written in. The engine already writes a file before any scene shows it, and writes a file's unexplained dependencies (an enum, a constant, a type) right before it; `check` warns when a file is written before code it uses that is explained later.
- **`at` makes a scene a stop**: it plays right after the tour replays that hunk (or the whole file, without `hunk`). The hunk you attach to defaults to `key` tempo (typed).
- **Don't add `type` steps for code the tour replays**; use `tempo: "key"` instead. Don't explain wiring; let it `skim`.
- Keep stops for what needs words, typically one per idea from your question chain. Plain hunks between stops need no explanation.
- `check --json` → `stats.tour` gives `{hunks, files}`, and `stats.unnarratedFiles` should be empty.

## Every scene: question, bridge, then steps

```json
{ "id": "transient", "title": "What counts as transient",
  "at": { "file": "src/api/retry.ts" },
  "question": "Which failures are worth retrying?",
  "bridge": "② the retry condition: which failures qualify",
  "goal": "Only 5xx and 429 retried",
  "narration": "Retries: server-side and rate-limit failures only\n\n- `isTransient`: `HttpError` with status 5xx or 429\n- 404 fails at once: a retry would get the same answer",
  "steps": [ … ] }
```

`question` stays above the code for the whole scene. `bridge` is shown in the heading band above the code when the scene starts, next to the chapter and the map node of the scene's file, so skip it for the first scene. Write it as the scene's place on the scene-1 map (its part number) and what it settles there, never as a recap of the previous scene (R30). `check` warns when either one is missing.

## Scene 1: walk the map

```json
{ "id": "map", "question": "What does this change add, and where?",
  "narration": "Change in three parts, read in this order\n\n- ① **client.ts** `request()`: entry, failures now go to retry (chapter 2)\n- ② **retry.ts** `withRetry`: when and how long, policy from **config.ts** (chapter 3)\n- ③ **service.ts**: existing caller outside the diff, inherits the retry (chapter 4)",
  "steps": [
    { "do": "graph", "title": "Dependencies", "nodes": [ … every node with its \"file\" … ],
      "edges": [ { "from": "client", "to": "retry", "label": "② new import" }, … ], "cue": 1 },
    { "do": "graph", "highlight": ["client"], "cue": 2 },
    { "do": "graph", "highlight": ["retry", "config"], "cue": 3 },
    { "do": "graph", "highlight": ["svc"], "cue": 4 } ] }
```

One bullet per part of the map, in chapter order, each lighting its nodes (R23). The numbers on the edges are the ones the bridges use later.

## Shape to aim for

```jsonc
{
  "version": 1,
  "meta": { "title", "summary", "intent", "language", "audience",
            "strategy": { "order", "rationale" }, "takeaways": [], "reviewFocus": [],
            "impact": [ { "text", "effect": "safe|check|breaks|updated", "files": [] } ] },   // what outside the diff the change reaches
  "source": { "range": "<base>...<head>" },              // same range as collect; or { "base", "head" | "WORKTREE" }
  "files": { "<path>": { "role": "2–4 word role" } },   // only files your steps use
  "glossary": [],                                       // domain terms a newcomer would not know
  "chapters": [ { "id", "title", "goal", "scenes": [ { "id", "title", "goal", "narration", "steps": [] } ] } ]
}
```

Write the outline (chapter and scene `title` and `goal`) first, read it top to bottom as if you were the viewer, and only then fill in the steps.

## Scene recipes

Each recipe is one scene that serves one comprehension goal. Combine them; don't cram two into one scene.

**Big-picture map** (scene 1; pre-training and advance organizer)
```json
[{ "do": "graph", "title": "How the pieces relate", "nodes": [
   { "id": "a", "label": "api/client.ts", "sub": "request()", "file": "src/api/client.ts" },
   { "id": "b", "label": "api/retry.ts",  "sub": "withRetry", "file": "src/api/retry.ts" },
   { "id": "c", "label": "users/service.ts", "sub": "callers", "file": "src/users/service.ts", "status": "context" }],
  "edges": [{ "from": "c", "to": "a", "label": "calls" }, { "from": "a", "to": "b", "label": "new import" }] },
 { "do": "graph", "highlight": ["a", "b"], "hold": 1500 }]
```
Use 3–7 nodes. Nodes are files or key symbols, and edges carry verbs. Build the nodes from the collect digest (graph and clusters), not from guesses. This first graph is shown full screen. It then docks as the **structure map** that stays at the top of the walkthrough panel and lights up the node of the file in view. **Give every node its `file`** so that the map can track the viewer's position.

**Entry-point change** (focusing on a point)
```json
[{ "do": "open", "file": "src/api/client.ts", "view": "diff" },
 { "do": "focus", "range": { "symbol": "request" } },
 { "do": "highlight", "range": { "find": "return idempotent" }, "tone": "focus", "label": "key line" },
 { "do": "note", "at": { "find": "const idempotent" }, "text": "Only GET is retried unless `idempotent` is set.", "tone": "why" }]
```

**Follow the call** (expanding the focus point; Cmd+Click)
```json
[{ "do": "goto", "from": { "at": { "find": "withRetry(send" }, "token": "withRetry" },
   "to": { "file": "src/api/retry.ts", "at": { "symbol": "withRetry" } } },
 { "do": "highlight", "range": { "find": "if (!isTransient(err)" }, "tone": "warn", "label": "exit condition" }]
```
The `token` must appear literally on the `from` line. Say "let's jump into `withRetry`" in the narration first.

**Peek at a short definition** (⌘-hover, the line stays; R39)
```json
"narration": "Query parameters: page size + 2 filters\n\n- `source`: `SandboxWorkSource` only, 2 values → `ai_assignment` / `ai_literacy`\n- Any other value: 400 from `@IsEnum`",
"steps": [
  { "do": "peek", "from": { "at": { "find": "@IsEnum(SandboxWorkSource)" }, "token": "SandboxWorkSource" },
    "to": { "file": "libs/shared/src/enums/sandbox-work/index.ts", "at": { "symbol": "SandboxWorkSource" } },
    "range": { "find": "ai_assignment = 'ai_assignment'", "span": 2 }, "cue": 2 },
  { "do": "highlight", "range": { "find": "@IsEnum(SandboxWorkSource)", "span": 2 }, "tone": "warn", "label": "else 400", "cue": 3 }
]
```
The definition opens in a hover over the line (enums, types, constants, short signatures: up to ~8 lines), `range` lights the lines the bullet is about, and the line never leaves the screen. `to.file` defaults to the pane's file. Pin the bullet that says what the definition means for the line to the `peek`.

**Drill down and come back** (a definition the line needs, just in time; R37)
```json
"narration": "`isTransient`: true only for 5xx or 429\n\n- Check needs `HttpError` → its definition first\n- `HttpError`: keeps the response `status`\n- Back at the check: that `status` → 5xx or 429 retried",
"steps": [
  { "do": "focus", "range": { "symbol": "isTransient" } },
  { "do": "goto", "from": { "at": { "find": "err instanceof HttpError" }, "token": "HttpError" },
    "to": { "file": "src/api/retry.ts", "at": { "symbol": "HttpError" } }, "cue": 2 },
  { "do": "highlight", "range": { "find": "constructor(public status" }, "label": "status", "cue": 3 },
  { "do": "back" },
  { "do": "highlight", "range": { "find": "err.status >= 500" }, "tone": "warn", "label": "5xx · 429", "cue": 4 }
]
```
`back` returns to the line the last `goto` was clicked on (VS Code's Go Back, ⌃−). Keep the detour to what the line needs, one level deep, inside the scene, and make the bullet after `back` say what the definition means *for this line*: that is where the detour pays off. For a definition the walkthrough continues into, use `goto` without `back`. For a definition of a few lines, `peek` instead (above): `check` suggests it.

**Run a function once** (a debugger's trace: concrete values; R40)
```json
"narration": "`withRetry` run once: `fn` fails twice with 503, then succeeds\n\n- 1st failure: transient, retries left → waits 200 ms\n- 2nd failure: the wait doubles to 400 ms → 3rd call returns `'ok'`",
"steps": [
  { "do": "trace", "range": { "symbol": "withRetry" }, "call": "withRetry(send, { retries: 3, baseDelayMs: 200 })", "frames": [
      { "at": { "find": "let attempt = 0;" }, "vars": { "attempt": "0" } },
      { "at": { "find": "return await fn();" }, "vars": { "fn()": "throws HttpError(503)" } },
      { "at": { "find": "if (!isTransient(err)" }, "vars": { "isTransient(err)": "true", "attempt < retries": "0 < 3" } },
      { "at": { "find": "await sleep" }, "vars": { "wait": "200 ms" } },
      { "at": { "find": "attempt++;" }, "vars": { "attempt": "1" } }], "cue": 2 },
  { "do": "trace", "frames": [
      { "at": { "find": "await sleep" }, "vars": { "wait": "400 ms" } },
      { "at": { "find": "attempt++;" }, "vars": { "attempt": "2" } },
      { "at": { "find": "return await fn();" }, "vars": { "fn()": "'ok'" } }], "returns": "'ok'", "cue": 3 }
]
```
The debug toolbar comes up, the yellow stop steps from frame to frame (Step Over), each frame's values appear after its line as VS Code's inline values (a changed value is outlined), and `returns` closes the run. Use it for utilities, branchy helpers, calculations and loops, where reading leaves the viewer to simulate the values in their head. Rules: one concrete input that takes the path worth seeing (the edge case, the new branch); stops only where a value is set or a branch decided (3 to 8); 1 to 3 short values per stop (`{…3 items}`, `"abc…"`); every value derived from the code, never guessed. A second `trace` without `call` continues the same run, so each half gets its own bullet. While it runs the sentence sits at the top of the code, so keep the bullets about *why* the values matter.

**Compare two places** (old and new, caller and callee, code and its test; R38)
```json
[{ "do": "highlight", "file": "src/api/retry.ts", "range": { "find": "baseDelayMs * 2" }, "tone": "info", "label": "policy.baseDelayMs" },
 { "do": "open", "pane": 1, "file": "src/config.ts", "view": "diff", "label": "the policy withRetry is given" },
 { "do": "highlight", "pane": 1, "range": { "find": "retry:" }, "tone": "add" }]
```
Light the left side first, then open the right with a `label` saying what the two are read together for; the player opens it to the side (⌥-click, the group slides in) and shows the label on the right pane. The split closes by itself when the scene ends, so the next scene and the tour start in one pane again: no `layout` steps. Files read one after the other are not a comparison: open them in pane 0.

**Impact outside the diff** (what the change reaches that the diff does not show)
```json
[{ "do": "impact", "symbol": "request", "change": "GET now retried", "items": [
   { "file": "src/users/service.ts", "at": { "find": "request<User>(`/users/${id}`)" }, "relation": "caller", "effect": "check", "label": "GET → now retried" },
   { "file": "src/users/service.ts", "at": { "find": "method: 'PATCH'" }, "relation": "caller", "effect": "safe", "label": "PATCH → sent once" },
   { "file": "src/jobs/sync.ts", "at": { "find": "request(" }, "relation": "caller, loop", "effect": "check", "label": "retries multiply" }] }]
```
A code review shows only the edited lines; the places those lines reach are invisible unless you bring them in. List the unchanged dependents of each changed contract (signature, return shape, error, data, config, event): callers, consumers, readers of the same table, other implementations of the interface. Each item gets a `relation` (how it is connected) and an `effect`: `safe` (still holds; say why in `label`), `check` (the reviewer must decide), `breaks`, or `updated` (changed in this diff too). Unchanged files are badged **outside the diff** in the panel and the editor, so the viewer never mistakes them for the change. Show at most 5–6 items, `check` and `breaks` first; count the rest in the narration. Place the scene right after the change it is about, or close the walkthrough with it.

**Context before the change** (what the edit only makes sense against): when an edit answers a constraint that lives elsewhere (a caller's expectation, an invariant, a config default, an existing helper it mirrors), `goto` there *before* the edit, then come back. A diff alone gives no reason; one look at the constraint does.

**Mechanical set** (the same edit in many places)
```json
[{ "do": "refs", "symbol": "Logger", "items": [
   { "file": "src/a.ts", "at": { "find": "new Logger(" }, "label": "updated mechanically" },
   { "file": "src/b.ts", "at": { "find": "new Logger(" }, "label": "updated mechanically" }] }]
```

**Replay a key edit** (the change happening, instead of a static diff)
```json
[{ "do": "open", "file": "src/api/client.ts", "view": "diff" },
 { "do": "type", "range": { "find": "const idempotent", "span": 2 } },
 { "do": "highlight", "range": { "find": "return idempotent" }, "tone": "focus", "label": "key line" }]
```
Until the `type` step runs, its lines look unwritten: added lines are hidden and removed lines look unchanged. Then removed lines turn red and the new text is typed. Use it for the 1–3 edits that carry the change, each ≤ ~15 lines. `{ "hunk": n }` is a good range. Narrate *why* while it types; don't type boilerplate, wiring, or large blocks (highlight those instead). Works in `diff` and in `after` (new files).

**In-place rewrite / refactor**
```json
[{ "do": "open", "file": "src/x.ts", "view": "diff", "diff": { "mode": "split" } },
 { "do": "highlight", "range": { "hunk": 1 }, "tone": "info", "label": "same behaviour" },
 { "do": "highlight", "range": { "hunk": 2 }, "tone": "focus", "label": "real change" }]
```

**Bug: show the broken code before the fix**
```json
[{ "do": "open", "file": "src/user.ts", "view": "before" },
 { "do": "highlight", "range": { "find": "user.profile.name" }, "tone": "warn", "label": "crash" },
 { "do": "diffView", "mode": "split" },
 { "do": "highlight", "range": { "hunk": 1 }, "tone": "add", "label": "guard" }]
```

**Large file, small change**: nothing to add. Diffs fold unchanged runs behind GitHub-style `@@` headers (3 lines of context), and any fold your steps point at opens automatically. Use `"diff": { "context": null }` on `open` only when the whole file matters.

**Tests that pin the behaviour**
```json
[{ "do": "open", "file": "test/retry.test.ts", "view": "after" },
 { "do": "highlight", "range": { "find": "retries transient errors", "block": true }, "tone": "add", "label": "503 → ok" }]
```

## Anchors: choosing them well

- `{ "symbol": "name" }` takes the whole definition block, which suits `focus` and `goto.to`. Add `"head": true` for just the signature line.
- `{ "find": "..." }` matches a substring on one line. Pick a string that is **unique in the file**, such as a distinctive call or a string literal. Avoid `{`, `return`, or bare names. Copy it from the actual file content (`git show <head>:<path>`), not from memory.
- `{ "find": "...", "block": true }` takes the block that starts on the matched line, such as a test case or an `if` body.
- `{ "hunk": n }` takes the n-th change block of the file. It is good in diff and split views, but fragile if you guessed the count. Check the hunks in the digest.
- In a `diff` view, a removed line needs `"side": "before"`. In an `after` view you cannot point at removed lines; switch to `diff`.
- An anchor in a step applies to the pane's current file. Add `"file": "..."` to the step to switch files implicitly.

## Common compile errors and fixes

| Error | Fix |
|---|---|
| `text "…" not found in F (after)` | The text is not on any single line of F at `head`, or it sits on the before side. Re-read the file. Add `"side": "before"`, or switch the view |
| `anchor is on the before side but the pane shows "after"` | Use `"view": "diff"` or `"before"` for that file |
| `token "X" not on F:N` | The `goto.from.at` line does not contain the token. Point `at` at the line where the token appears |
| `symbol "X" not found` | The heuristics did not recognise the definition, for example in a macro or a dynamic definition. Use `find` on the declaration line |
| `no file open in this pane` | Add an `open` step, or put `"file"` on the step |
| warning `ambiguous anchor: … matches N lines` | The first match was used, which may not be the line you meant. Check `resolved` (`check --resolve`), then add `nth` or use a more specific `find` |
| `unknown file` | The path must be repo-relative and match exactly (case-sensitive), using the new path for renames |

## Narration style: note form

Write every piece of prose (narration, notes, labels, `bridge`, `goal`, `summary`, `rationale`, `takeaways`, `reviewFocus`, `impact`) in **note form**: one fact per line, no sentence padding. Only `question` stays a real question, because it is what the viewer is asking.

- **Korean: 개조식.** End on a noun or a nominal ending (`~함`, `~음`, `~임`, `확인`, `추가`), never `~다`, `~습니다`, `~요`. Drop particles a reader can infer.
- **English: telegraphic style** (also called note form; it has no single-word name like 개조식). Drop the subject when it is the code under discussion, drop articles and "is/are", start with a verb in the present tense ("Retries", "Throws") or a noun phrase. No closing period.
- **Other languages**: the equivalent bullet register of that language's technical writing (short, nominal or verb-first, no polite sentence endings).
- Relations get symbols instead of connective words: `→` for "so / then / leads to", `:` for "namely / is", `/` for a contrast, `=` for "means".

Each scene's narration is **a lead line plus bullets**, with each bullet cued to its step:

```json
{ "narration": "`request()`: retries only requests safe to repeat\n\n- Failures throw `HttpError` → retry logic can read the status\n- Idempotent requests only wrapped in `withRetry`, the rest sent once",
  "steps": [
    { "do": "open", "file": "src/api/client.ts", "view": "diff" },
    { "do": "highlight", "range": { "find": "throw new HttpError" }, "label": "① HttpError", "cue": 2 },
    { "do": "highlight", "range": { "find": "return idempotent" }, "label": "② retry gate", "cue": 3 }
  ] }
```

The items are numbered 1 (the lead), 2 (first bullet), 3, and so on. An item without a cue arrives with the last uncued highlight-like step before the next cued item. The engine gives every item its reading time and delays the step that brings in the next item until then, so do not add `hold` or `wait` for reading. `check` reports a `cue` that is out of range.

- Keep each scene to a lead line plus 2–4 bullets. Explain **why** and **how things relate**. Never read code aloud.
- Make the bullet order follow the step order. The thing named first is highlighted first.
- Put identifiers in backticks. Use at most 1–2 `**bold**` phrases per scene.
- Put risks in `note` with `tone: "risk"`, worded as something to check, not a verdict ("scope not allowed → every guardian lookup 503, check").
- Mark unverified intent as such ("looks like…"), or move it to `reviewFocus`.
- An `impact` step shows its own labels: keep its narration to the lead line and at most one bullet for the item that needs a decision.
