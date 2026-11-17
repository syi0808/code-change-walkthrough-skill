---
name: code-change-walkthrough
description: "Turn a code change (PR, branch, commit range, or uncommitted work) into an animated, IDE-like walkthrough that explains it in the best order for human understanding. Analyses the change in whole-codebase context (callers, dependencies, impact), designs the explanation with cognitive-science-based rules, writes Walkthrough IR, and has the code-walkthrough engine validate it and export a standalone HTML player or serve it on localhost. Use for requests like 'make a walkthrough of this PR', 'explain this diff visually', 'animate this change for review', 'onboarding walkthrough of my branch', 'visualize what this commit does', in any language."
compatibility: Requires Node.js 18+ and git. Runs on macOS, Linux and Windows (no shell scripts; every command is `node <script>`).
---

# Code Change Walkthrough

Your job is to **author Walkthrough IR**. The IR is a plan that says which code to show, in which order, with which view, and what to say about it, so that a person understands a code change quickly and correctly. A separate engine (`code-walkthrough`) executes that plan. It fetches file contents, resolves anchors to lines, computes diffs, animates the IDE, and handles playback. You never write HTML, CSS, or timing.

```
 collect.mjs ─► context digest ─► you read the code ─► strategy ─► walkthrough.json (IR)
                                                                         │
                         engine: check ─► build (standalone .html) / serve (localhost)
```

**Running commands (all platforms).** `<skill>` below means this skill's base directory. Run every script as `node "<skill>/scripts/<name>.mjs" …` and quote paths. Don't rely on shebangs, the executable bit, or shell-specific variables: the same command line works in bash, zsh, PowerShell, and cmd. Run the engine through `node "<skill>/scripts/engine.mjs" <command>`. It finds the engine through `CODE_WALKTHROUGH_ENGINE`, then the copy next to this skill, then a global npm install, and runs it in-process.

## Principles

1. **Comprehension over spectacle.** Every motion must be a real IDE action (open, scroll, go to definition, find references). Nothing decorative.
2. **Evidence-based design.** Follow the design rules R1–R28 in `references/design-rules.md`.
3. **Whole-codebase context.** Explain through call, dependency, and data relations and the intent of the change, not file by file. Show unchanged code when understanding needs it.
4. **Only verified claims.** Confirm every statement in the narration by reading the code. If an intent is unverified, turn it into a `reviewFocus` question instead of asserting it.
5. **Language- and framework-agnostic.** The analysis script uses heuristics. Treat its output as leads, and confirm them in the code.
6. **Write for the user.** Write the IR's narration in the user's language (`meta.language`), even though this skill is written in English.

## Workflow

### 0. Determine the range

| Request | Range |
|---|---|
| nothing specific | uncommitted changes vs `HEAD` (`--head WORKTREE`) if the tree is dirty, otherwise the last commit (`HEAD~1..HEAD`) |
| a branch | `--range origin/main...<branch>` (merge-base) |
| a PR number or URL | `gh pr view <N> --json number,title,body,baseRefName,headRefName,url`. If the head is not local: `git fetch origin pull/<N>/head:pr-<N>`, then `--range origin/<base>...pr-<N>`. Use the PR body as intent evidence |
| a commit range | `--range A..B` |

If the request is ambiguous, pick the default and tell the user which range you used. Also settle the **audience**: `reviewer` by default, `newcomer` if the user mentions onboarding or unfamiliarity, `author` for self-review or PR descriptions.

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
- **Risk**: what a reviewer must decide

### 3. Design the explanation

Read `references/strategy-playbook.md`, then decide:
1. the **change type** for each cluster
2. the **order strategy** (top-down, bottom-up, data-flow, symptom-cause-fix, before-after, clusters) and a one-sentence rationale
3. an **outline**: chapter and scene titles with one-sentence `goal`s only. Check the flow before writing any steps. Scene 1 is the big picture (a `graph`). Put each definition right before its usages, and each implementation right before its tests. Stay within the size budget
4. for each scene, the **view** (after, before, diff; unified or split; single or columns) and the **actions**

### 4. Write the IR

Read `references/ir-authoring.md` for patterns and pitfalls. Run `node "<skill>/scripts/engine.mjs" spec` for the full contract the installed engine accepts. Write `walkthrough.json` next to the context JSON.
- In `source`, put **the same range you gave `collect`**: `"range": "A...B"` for a branch or PR (the engine resolves the merge-base the same way), or `base`/`head` for explicit refs or `WORKTREE`. Never write a branch tip as `base` when the change is a PR; you would pull in unrelated commits from the base branch. Pass the repository with `--repo`. Sanity check: the file count in `check` should match the digest
- Use `find` and `symbol` anchors; use line numbers only as a last resort
- Write narration as **one lead sentence (the why) + 2–4 bullets**, one bullet per visual beat in step order, each pinned to its step with `cue`. Say where you are going before a `goto` or `refs`
- Give scene 1's graph nodes a `file`: the graph docks as a structure map that tracks the file in view
- Fill in `meta.summary`, `strategy.rationale`, `takeaways`, and `reviewFocus`

### 5. Validate until clean

```bash
node "<skill>/scripts/engine.mjs" check <dir>/walkthrough.json --repo <repo> --json --resolve
```

- **errors**: each one has a path (`chapters[i].scenes[j](id).steps[k]`) and a precise message, such as the text that was not found or the actual content of the line. Fix the IR and re-run until `ok: true`
- **warnings**: cognitive-load guards, and ambiguous anchors (a `find` that matches several lines without `nth`). Fix ambiguous anchors; split or trim scenes rather than ignoring load warnings
- **`resolved`** (with `--resolve`): every anchor's `file:line` and the line's text. Skim it to confirm each highlight, note, and `goto` lands where you meant. A clean `check` only proves the anchors exist, not that they are the right ones
- **`stats`**: `estimatedSeconds` (playback length at 1×) and `unnarratedFiles` (changed files no step touches). Use both in the report

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
- the controls: Space play/pause, ←/→ scenes, `[`/`]` speed, and ⌘/Ctrl+Click to go to a definition while paused

The page embeds source code. Do not upload or publish it anywhere unless the user explicitly asks.

## Quality checklist (before delivering)

- [ ] Does the first scene alone convey what changed and why? (R13, R23)
- [ ] Is the order an execution or dependency order, not file order? (R14)
- [ ] One idea per scene, and at most 1–2 simultaneous highlights? (R1, R11)
- [ ] New files open in `after`, deleted files in `before`, and in-place rewrites in `split`? (R26–R28)
- [ ] Is unchanged code that the reader needs (callers, definitions) connected through `goto` or `refs`? (principle 3)
- [ ] Are repetitive mechanical edits collapsed into one scene? (R3)
- [ ] Is every claim verified in code, and does the narration explain instead of reading code aloud? (principle 4, R9)
- [ ] Are `takeaways` and `reviewFocus` present? (R24)

## Files

| Path | Purpose |
|---|---|
| `scripts/collect.mjs` | Change analysis: range, symbols, fan-in and fan-out, graph, clusters, reading orders |
| `scripts/lib/` | Language-agnostic git and code heuristics (vendored from the engine) |
| `scripts/engine.mjs` | Locates and runs the `code-walkthrough` engine CLI (in-process, cross-platform) |
| `references/design-rules.md` | Design rules R1–R28 |
| `references/strategy-playbook.md` | Change types → order, outline, views, size budget, audience |
| `references/ir-authoring.md` | How to write good IR: scene recipes, anchors, common errors |
| `docs/` | Background only (research rationale for the rules). Not needed to run the skill |

Requirements: Node.js 18 or later, git, and the `code-walkthrough` engine, on macOS, Linux, or Windows. No network access is needed.
