# Code Change Walkthrough

This repository turns a code change into an animated, IDE-like walkthrough. The walkthrough explains the change in the order that is easiest to understand, using whole-codebase context and rules taken from cognitive science.

It has two independent parts. The **Walkthrough IR** is the only contract between them.

```
┌──────────── skills/code-change-walkthrough  (authoring) ────────────┐
│ An agent reads a PR, diff, or branch and writes IR:                 │
│   collect.mjs   change analysis: symbols, fan-in/out, clusters, order│
│   references/   design rules R1–R28, strategy playbook,             │
│                 IR authoring guide          (loaded on demand)      │
│   docs/         research rationale          (background only)       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │  walkthrough.json  (Walkthrough IR v1)
┌────────────────────────────────▼────────────────────────────────────┐
│ packages/engine  (execution) — `code-walkthrough` CLI               │
│   check    validate IR, resolve anchors against git                 │
│   build    standalone offline HTML player (single file)             │
│   serve    the same player on localhost, live-reloading as the      │
│            IR changes                                               │
│   spec / schema   the IR contract, for authors                      │
└─────────────────────────────────────────────────────────────────────┘
```

- **Engine**: executes any valid IR. It does not analyse code or plan explanations. See [`packages/engine/README.md`](packages/engine/README.md).
- **Skill**: teaches an agent to produce good IR from real changes. It is written in English and is self-contained. See [`skills/code-change-walkthrough/SKILL.md`](skills/code-change-walkthrough/SKILL.md).

## Install

```bash
node install.mjs            # installs the engine CLI globally (npm) and links the skill into ~/.claude/skills
node install.mjs --skill    # only link the skill; it then uses the engine in this repo
```

Or do it manually:

```bash
npm install -g ./packages/engine                                   # provides `code-walkthrough`
ln -s "$PWD/skills/code-change-walkthrough" ~/.claude/skills/code-change-walkthrough      # macOS / Linux
mklink /J "%USERPROFILE%\.claude\skills\code-change-walkthrough" skills\code-change-walkthrough   # Windows (cmd)
```

If the CLI is not installed globally, the skill can still find the engine next to it through `scripts/engine.mjs`, as long as the skill is linked from this repository.

Requirements: Node.js 18 or later and git, on **macOS, Linux, or Windows**. There are no npm dependencies, and nothing needs the network.

**Cross-platform by construction.** There are no shell scripts: every entry point is a `.mjs` run with `node`, and it calls git through `execFileSync` without a shell. Line endings are normalised, so CRLF checkouts don't show as whole-file changes. Non-ASCII paths are kept verbatim (`core.quotepath=false`). The skill is installed as a junction on Windows, which needs no admin rights. `.gitattributes` keeps the repository's files LF.

## Try it

```bash
node packages/engine/examples/retry/make-demo-repo.mjs /tmp/demo-repo
code-walkthrough serve packages/engine/examples/retry/walkthrough.json --repo /tmp/demo-repo --open
# or
code-walkthrough build packages/engine/examples/retry/walkthrough.json --repo /tmp/demo-repo -o /tmp/demo.html
```

Then ask Claude Code something like "make a walkthrough of PR #123" or "explain my uncommitted changes visually".

## Develop

```bash
npm test                          # engine smoke tests + skill lib drift check
node tools/sync-skill-lib.mjs     # after editing packages/engine/src/lib (the skill vendors it)
```
