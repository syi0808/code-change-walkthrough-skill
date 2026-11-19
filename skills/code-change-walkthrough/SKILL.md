---
name: code-change-walkthrough
description: "Turn a code change (PR, branch, commit range, or uncommitted work) into an animated, IDE-like walkthrough that explains it in the best order for human understanding. Analyses the change in whole-codebase context (callers, dependencies, impact), designs the explanation with cognitive-science-based rules, writes Walkthrough IR, and has the code-walkthrough engine validate it and export a standalone HTML player or serve it on localhost. Use for requests like 'make a walkthrough of this PR', 'explain this diff visually', 'animate this change for review', 'onboarding walkthrough of my branch', 'visualize what this commit does', in any language."
compatibility: Requires Node.js 18+ and git. Runs on macOS, Linux and Windows (no shell scripts; every command is `node <script>`).
---

# Code Change Walkthrough

Your job is to **author Walkthrough IR**. The engine replays the **whole diff** (every hunk of every changed file) as the spine of the walkthrough, so coverage is automatic. Your IR decides the **order** of that replay and the **explanation stops** along it: where to pause, what question each stop answers, and what to point at. The IR is a plan that says which code to show, in which order, with which view, and what to say about it, so that a person understands a code change quickly and correctly. A separate engine (`code-walkthrough`) executes that plan. It fetches file contents, resolves anchors to lines, computes diffs, animates the IDE, and handles playback. You never write HTML, CSS, or timing.

```
 collect.mjs ─► context digest ─► you read the code ─► strategy ─► walkthrough.json (IR)
                                                                         │
                         engine: check ─► build (standalone .html) / serve (localhost)
```

**Running commands (all platforms).** `<skill>` below means this skill's base directory. Run every script as `node "<skill>/scripts/<name>.mjs" …` and quote paths. Don't rely on shebangs, the executable bit, or shell-specific variables: the same command line works in bash, zsh, PowerShell, and cmd. Run the engine through `node "<skill>/scripts/engine.mjs" <command>`.

## Principles

1. **Comprehension over spectacle.** Every motion must be a real IDE action (open, scroll, go to definition, find references). Nothing decorative.
2. **Evidence-based design.** Follow the design rules R1–R36 in `references/design-rules.md`.
3. **Whole-codebase context.** A diff shows what was edited, not what the edit reaches or answers to. Explain through call, dependency, and data relations and the intent of the change, not file by file. Bring in unchanged code a reviewer needs (R34–R36): the dependents of every changed contract, and the constraints an edit answers.
4. **Only verified claims.** Confirm every statement in the narration by reading the code. If an intent is unverified, turn it into a `reviewFocus` question instead of asserting it.
5. **Language- and framework-agnostic.** The analysis script uses heuristics. Treat its output as leads, and confirm them in the code.
6. **Write for the user, in note form.** Write the IR's prose in the user's language (`meta.language`), even though this skill is written in English, and in note form: Korean 개조식, English telegraphic style (R32).

## Workflow

### 0. Determine the range

| Request | Range |
|---|---|
| nothing specific | uncommitted changes vs `HEAD` (`--head WORKTREE`) if the tree is dirty, otherwise the last commit (`HEAD~1..HEAD`) |
| a branch | `--range origin/main...<branch>` (merge-base) |
| a PR number or URL | `gh pr view <N> --json number,title,body,baseRefName,headRefName,url`. If the head is not local: `git fetch origin pull/<N>/head:pr-<N>`, then `--range origin/<base>...pr-<N>`. Use the PR body as intent evidence |
| a commit range | `--range A..B` |

If the request is ambiguous, pick the default and tell the user which range you used. Also settle the **audience**: `reviewer` by default, `newcomer` if the user mentions onboarding or unfamiliarity, `author` for self-review or PR descriptions.

### 0b. Install the player's UI language (first use per language)

The player's buttons and labels come from a string table per language. English is built in. For any other `meta.language`, install its table once:

```bash
node "<skill>/scripts/engine.mjs" i18n <lang>
```

It downloads `i18n/<lang>.json` from the skill's GitHub repository into `<skill>/i18n/`, validates it, and exits 0; afterwards `check`, `build`, and `serve` pick it up offline. If the table is already installed it does nothing. Exit code 3 means no table is published for that language: translate the values of `engine.mjs i18n --template` into the language (keep every key and `{placeholder}`, set `"language"`, use the note-form register of R32), save it at the path the command printed, and tell the user it can be contributed upstream. Without a table the walkthrough still works, with an English UI, and `check` warns.

### 1. Collect context

```bash
node "<skill>/scripts/collect.mjs" --repo <repo> [--range A...B | --base X --head Y|WORKTREE] [--out <dir-or-file>]
```

It prints a digest and writes the full JSON to `--out` (a directory or a `.json` path). The default is `<OS temp dir>/code-walkthrough/<repo>-<sha>/context.json`. It never writes into the repository. `--help` lists all options. The digest lists:
- files with status, language, test/generated flags, hunks with their enclosing symbol, and imports added or removed
- **changed symbols with fan-in**: references across the whole repository, ranked by whether the referencing file actually imports the defining file. `[import]` marks import-linked references. Unlinked hits are counted as likely homonyms
- the dependency graph, clusters, `entry points`, `bottom-up order`, and complexity (small / medium / large)

### 2. Understand the change (do not skip)

Never write IR from the digest alone. Read:
- every changed hunk: `git diff <base> <head>` (or `git diff <base>` for `WORKTREE`)
- full files at the head revision: `git show <head>:<path>`. For `WORKTREE`, read the working-tree file. For the base version, use `git show <base>:<path>`. Copy `find` anchor text from this output, never from memory
- the **definitions** of changed symbols and their top **callers**, including unchanged files
- the related tests
- commit messages and the PR body

For a `large` change, or one with 3 or more clusters, you may delegate per-cluster summaries ("intent and key lines of these files") to Explore subagents. Do the synthesis and the IR authoring yourself.

Write down for yourself, before you design anything:
- **What** changed: behaviour, contract, data
- **Why**: the problem or requirement
- **How**: the mechanism, the critical path, and the beacon lines
- **Impact**: who is affected (callers, data, config), and what stays the same

Then map the **context outside the diff** (R34–R36), because a reviewer cannot see it in a code review tool:
- for each changed contract (signature, return shape, thrown errors, data written or read, config, events, routes): its unchanged dependents. Start from the digest's fan-in (`[import]` references), then read each one and decide its effect: `safe` (and why), `check`, `breaks`, or `updated`
- the constraints the change answers to that live elsewhere: the caller's expectation, an invariant, a default, an existing helper it mirrors or bypasses
- reach beyond the repository: other services, clients, schedulers, migrations
Keep the list; it becomes `meta.impact`, the `impact` step items, and `reviewFocus` entries for every `check` or `breaks`.
- **Risk**: what a reviewer must decide

### 3. Design the explanation

Read `references/strategy-playbook.md`, then decide:
1. the **change type** for each cluster
2. the **order strategy** (top-down, bottom-up, data-flow, symptom-cause-fix, before-after, clusters) and a one-sentence rationale
3. a **question chain**: for each scene, the `question` the viewer has at that point and the `bridge` that places it on the scene-1 map (playbook §6). Read the questions as a list: each must follow from the previous one. This list *is* the order.
4. an **outline**: chapter and scene titles with one-sentence `goal`s only. Check the flow before writing any steps. Scene 1 is the big picture: a `graph` walked part by part, one bullet per part in chapter order (R23). Put each definition right before its usages, and each implementation right before its tests. Stay within the size budget
5. for each scene, the **view** (after, before, diff; unified or split; single or columns) and the **actions**

### 4. Write the IR

Read `references/ir-authoring.md` for patterns and pitfalls. Run `node "<skill>/scripts/engine.mjs" spec` for the full contract the installed engine accepts. Write `walkthrough.json` next to the context JSON.
- In `source`, put **the same range you gave `collect`**: `"range": "A...B"` for a branch or PR (the engine resolves the merge-base the same way), or `base`/`head` for explicit refs or `WORKTREE`. Never write a branch tip as `base` when the change is a PR; you would pull in unrelated commits from the base branch. Pass the repository with `--repo`. Sanity check: the file count in `check` should match the digest
- Use `find` and `symbol` anchors; use line numbers only as a last resort
- Set `tour.order`: every changed file in the order of your question chain. Attach each explanation scene to the hunk or file it explains with `at` (it plays right after that hunk is replayed). Mark the hunks worth typing out with `tour.tempo` `"key"`, and anything that is wiring with `"skim"` (most wiring is detected automatically)
- Give every scene a `question` and every scene after the first a `bridge` that names its part of the map and what it settles, never a recap of the previous scene (R29, R30)
- Write every piece of prose in note form, without em dashes (R32): 개조식 in Korean, telegraphic style in English. Only `question` is a full question
- Write narration as **one lead line (the why) + 2–4 bullets**, one bullet per visual beat in step order, each pinned to its step with `cue`. Say where you are going before a `goto`, `refs`, or `impact`
- Show the context outside the diff (R34, R35): an `impact` scene after the change it is about (or at the end) with the unchanged dependents and their effects, and a `goto` to a constraint before an edit that answers it
- Give scene 1's graph nodes a `file`: the graph docks as a structure map that tracks the file in view
- Fill in `meta.summary` (note-form bullets), `strategy.rationale`, `takeaways`, `reviewFocus`, and `meta.impact` (R36; `check` warns when it is empty)

### 5. Validate until clean

```bash
node "<skill>/scripts/engine.mjs" check <dir>/walkthrough.json --repo <repo> --json --resolve
```

- **errors**: each one has a path (`chapters[i].scenes[j](id).steps[k]`) and a precise message, such as the text that was not found or the actual content of the line. Fix the IR and re-run until `ok: true`
- **warnings**: cognitive-load guards, and ambiguous anchors (a `find` that matches several lines without `nth`). Fix ambiguous anchors; split or trim scenes rather than ignoring load warnings
- **`resolved`** (with `--resolve`): every anchor's `file:line` and the line's text. Skim it to confirm each highlight, note, and `goto` lands where you meant. A clean `check` only proves the anchors exist, not that they are the right ones
- **`stats`**: `estimatedSeconds` (playback length at 1×), `unnarratedFiles` (changed files no step touches), and `outsideDiff` (unchanged files the walkthrough shows). Use them in the report

### 6. Deliver

Ask the user which delivery they want only if they have not said so. Default to **serve**.

- **Serve on localhost** (live: edits to the IR reload the open tab at the same scene):
  ```bash
  node "<skill>/scripts/engine.mjs" serve <dir>/walkthrough.json --repo <repo> --open
  ```
  Run it in the background. Give the user the printed URL. Mention that it stays running, and stop it when the user is done.
- **Standalone HTML** (one offline file you can share):
  ```bash
  node "<skill>/scripts/engine.mjs" build <dir>/walkthrough.json --repo <repo> -o <dir>/walkthrough.html
  ```
  Give the user the full absolute path.

In both cases, report:
- the range
- the number of scenes and the duration (`stats.estimatedSeconds`)
- the order strategy and its one-line rationale
- changed files left out of the narration (`stats.unnarratedFiles`; they are still browsable in the file tree)
- the context outside the diff: `meta.impact` in a line or two, and how many unchanged files are shown (`stats.outsideDiff`)
- the controls: Space play/pause, ←/→ scenes, `[`/`]` speed, and ⌘/Ctrl+Click to go to a definition while paused

The page embeds source code. Do not upload or publish it anywhere unless the user explicitly asks.

## Quality checklist (before delivering)

- [ ] Does the first scene alone convey what changed and why, walking the graph part by part in chapter order? (R13, R23)
- [ ] Does every `bridge` name its part of the map instead of recapping the last scene? (R30)
- [ ] Is the order an execution or dependency order, not file order? (R14)
- [ ] One idea per scene, and at most 1–2 simultaneous highlights? (R1, R11)
- [ ] New files open in `after`, deleted files in `before`, and in-place rewrites in `split`? (R26–R28)
- [ ] Is unchanged code that the reader needs (callers, definitions) connected through `goto`, `refs`, or `impact`? (principle 3, R34, R35)
- [ ] Does `meta.impact` say what outside the diff the change reaches, even if nothing? (R36)
- [ ] Is all prose except `question` in note form (개조식, telegraphic)? (R32)
- [ ] Are repetitive mechanical edits collapsed into one scene? (R3)
- [ ] Is every claim verified in code, and does the narration explain instead of reading code aloud? (principle 4, R9)
- [ ] Are `takeaways` and `reviewFocus` present? (R24)

## Files

| Path | Purpose |
|---|---|
| `scripts/collect.mjs` | Change analysis: range, symbols, fan-in and fan-out, graph, clusters, reading orders |
| `scripts/engine.mjs` | The `code-walkthrough` engine CLI: check, build, serve, spec, schema, i18n |
| `i18n/<lang>.json` | Installed UI string tables (created by `engine.mjs i18n`; not shipped) |

Both scripts are generated bundles (built from `packages/engine` in the source repository). They are self-contained: don't edit them, and don't look for an engine elsewhere.
| `references/design-rules.md` | Design rules R1–R36 |
| `references/strategy-playbook.md` | Change types → order, outline, views, size budget, audience |
| `references/ir-authoring.md` | How to write good IR: scene recipes, anchors, common errors |
| `docs/` | Background only (research rationale for the rules). Not needed to run the skill |

Requirements: Node.js 18 or later and git, on macOS, Linux, or Windows. Network access is needed only once per UI language, for `engine.mjs i18n`.
