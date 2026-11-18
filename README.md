# Code Change Walkthrough

This repository turns a code change into an animated, IDE-like walkthrough. The walkthrough explains the change in the order that is easiest to understand, using whole-codebase context and rules taken from cognitive science.

It has two independent parts. The **Walkthrough IR** is the only contract between them.

```
┌──────────── skills/code-change-walkthrough  (authoring) ────────────┐
│ An agent reads a PR, diff, or branch and writes IR:                 │
│   scripts/      collect.mjs (change analysis) and engine.mjs:       │
│                 built bundles, self-contained (no install needed)   │
│   references/   design rules R1–R36, strategy playbook,             │
│                 IR authoring guide          (loaded on demand)      │
│   docs/         research rationale          (background only)       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │  walkthrough.json  (Walkthrough IR v1)
┌────────────────────────────────▼────────────────────────────────────┐
│ packages/engine  (TypeScript source): `code-walkthrough` CLI       │
│   tour     replays the WHOLE diff (every hunk) as the spine;         │
│            the author's explanation scenes are stops on it          │
│   check    validate IR, resolve anchors against git                 │
│   build    standalone offline HTML player (single file)             │
│   serve    the same player on localhost, live-reloading as the      │
│            IR changes                                               │
│   spec / schema   the IR contract, for authors                      │
└─────────────────────────────────────────────────────────────────────┘
```

- **Engine**: executes any valid IR. It does not plan explanations. Its source is TypeScript in [`packages/engine`](packages/engine/README.md), maintained independently of the skill: the player is Svelte 5, the compiler, server, and change analysis are plain TypeScript modules.
- **Skill**: teaches an agent to produce good IR from real changes. It is written in English and is self-contained: its `scripts/` are bundles built from the engine (compiled and minified, the player inlined), so it runs with nothing but Node and git. See [`skills/code-change-walkthrough/SKILL.md`](skills/code-change-walkthrough/SKILL.md).

## Install

```bash
node install.mjs            # links the skill into ~/.claude/skills (or $CLAUDE_SKILLS_DIR)
node install.mjs --cli      # also installs the `code-walkthrough` CLI globally (builds the engine first)
```

Or link it by hand:

```bash
ln -s "$PWD/skills/code-change-walkthrough" ~/.claude/skills/code-change-walkthrough      # macOS / Linux
mklink /J "%USERPROFILE%\.claude\skills\code-change-walkthrough" skills\code-change-walkthrough   # Windows (cmd)
```

The skill folder can also be copied anywhere on its own: its scripts do not depend on this repository.

Requirements to run: Node.js 18 or later and git, on **macOS, Linux, or Windows**. The network is used once per UI language (`engine.mjs i18n <lang>` downloads the player's string table from `i18n/` in this repository); everything else runs offline. Developing the engine needs Node.js 22.18 or later (the tests run TypeScript directly) and `npm install` in `packages/engine`.

**Cross-platform by construction.** There are no shell scripts: every entry point is a `.mjs` run with `node`, and it calls git through `execFileSync` without a shell. Line endings are normalised, so CRLF checkouts don't show as whole-file changes. Non-ASCII paths are kept verbatim (`core.quotepath=false`). The skill is installed as a junction on Windows, which needs no admin rights. `.gitattributes` keeps the repository's files LF.

## Try it

```bash
node packages/engine/examples/retry/make-demo-repo.mjs /tmp/demo-repo
node skills/code-change-walkthrough/scripts/engine.mjs serve packages/engine/examples/retry/walkthrough.json --repo /tmp/demo-repo --open
# or
node skills/code-change-walkthrough/scripts/engine.mjs build packages/engine/examples/retry/walkthrough.json --repo /tmp/demo-repo -o /tmp/demo.html
```

Then ask Claude Code something like "make a walkthrough of PR #123" or "explain my uncommitted changes visually".

## Develop

```bash
cd packages/engine && npm install
npm run build        # player (Svelte) -> engine bundles -> dist/ and the skill's scripts/
npm run typecheck    # TypeScript + Svelte
npm test             # build, then the test suite (node:test)
```

From the repository root, `npm test` runs the engine tests and checks that the skill's bundled scripts match the source (`npm run build` refreshes them). Commit the rebuilt bundles together with the source change.
