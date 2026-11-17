# Strategy playbook

Use this playbook to decide the **order**, the **scenes**, and the **views** from the collect context and the code you read. The tables give defaults. When the change's actual shape calls for something different, deviate, and record why in `meta.strategy.rationale`. R# refers to the rules in `design-rules.md`.

## 1. Classify the change

Classify each cluster separately when a change mixes types (R21).

| Type | Signals |
|---|---|
| **Feature** | Many new files or symbols; a few call lines added at existing entry points |
| **Bug fix** | Small, local edits; conditions, bounds, or null handling changed; a regression test added; "fix" in the commit message |
| **Refactor** | Additions roughly equal deletions; renames or moves (rename similarity); same signatures with new internals; tests mostly unchanged |
| **API / signature change** | A changed symbol has large fan-in; many call sites edited mechanically |
| **Performance** | An algorithm or data structure is replaced; caching or batching introduced; behaviour is the same |
| **Data / config / schema** | A migration, schema, or config file changed, together with the code that reads or writes it |
| **Mixed (large)** | 2 or more clusters; complexity `large` |

## 2. Default strategy per type

| Type | Order | Chapter skeleton | Key views and actions |
|---|---|---|---|
| Feature | **top-down** (entry point → new modules → wiring) | big picture → entry-point change → inside the new module → impact and tests | `diff` for the entry point, `after` for new files, `goto` to descend |
| Bug fix | **symptom → cause → fix → regression test** | failing path (`before` view) → the faulty line → the fix → the test | the cause in `before` with `note tone:"why"`, the fix in `split` |
| Refactor | **invariant → correspondence** | what stays the same → old-to-new mapping → summary of mechanical edits | `patience`, `split`, `whitespace: collapse`, one `refs` for repeated edits (R3) |
| API change | **bottom-up** (definition → usages) | the new contract (signature, types) → 1–2 representative call sites → the remaining call-site patterns | `focus` the definition, `refs` labelled by pattern |
| Performance | **before ↔ after contrast** | the hot path → the old approach → the new approach → evidence the behaviour is unchanged | `columns` or `split`, trade-offs as `note tone:"risk"` |
| Data / config | **data shape first** | schema or config → writers → readers → migration and compatibility | `graph` (writers → data → readers) |
| Mixed | **cluster by cluster** | big picture (cluster map) → one chapter per cluster, in dependency order → mechanical edits summary | `graph` first, then one of the strategies above per chapter |

**Ordering rules** (R13, R14, R22)
- Use top-down when there is a clear entry point and the viewer needs the intent first. Start from `entry points`.
- Use bottom-up when a new primitive is used in several places. Follow `bottom-up order`.
- Use execution order when requests or data flow through a pipeline.
- In every case, put a definition right before its usages, and an implementation right before its tests.

## 3. Choosing views (R26–R28)

| Situation | Choice |
|---|---|
| New file | `view: "after"` (the change gutter marks every line as added) |
| Deleted file | `view: "before"` |
| Small scattered edits, mostly additions | `diff` + `mode: "unified"` + `granularity: "word"` |
| Many lines rewritten in place | `diff` + `mode: "split"` |
| Moved or re-indented blocks, brace-heavy code | `algorithm: "patience"` (default) + `whitespace: "collapse"` (default) |
| Short edit where a minimal edit script matters | `algorithm: "myers"` |
| Large file, few changes | nothing extra: diffs fold unchanged runs GitHub-style by default (`context: 3`), and folds the walkthrough points at open automatically. Use `context: null` to show the whole file |
| The one edit that *is* the change (a guard added, a call wrapped, a condition flipped) | `type` on that hunk, so the viewer watches it happen (≤ ~15 lines, 1–3 per walkthrough) |
| Unchanged related code | `view: "after"`; arrive there with `goto` when possible |
| Two places to compare (caller/callee, interface/implementation, test/code) | `layout: "columns"` + `pane: 1` |
| Impact, module relations | `graph` (3–7 nodes, labelled edges) |
| Many usages of one symbol | `refs` (at most 5–6 items, classified by label) |

## 4. Size budget (R1, R4)

| Complexity | Scenes | Chapters |
|---|---|---|
| small | 3–6 | 2–3 |
| medium | 6–12 | 3–5 |
| large | 12–20 | 4–7, with mechanical edits summarised in a single scene |

Per scene:
- one idea
- at most about 4 new identifiers
- 2–4 sentences of narration (about 60 words)
- 3–8 steps
- 1–2 simultaneous highlights

You do **not** have to narrate every changed file. Files left out of the narration stay browsable in the player's file tree, but always include the files a reviewer must not miss.

## 5. Audience (R17, R25)

The default audience is `reviewer`.

| Audience | Adjustments |
|---|---|
| Reviewer (knows the codebase) | Keep the big picture short and focus on intent and risk. Write a thorough `reviewFocus`. Use few `note`s |
| Newcomer (unfamiliar codebase) | More pre-training (the graph, a `glossary`). Add scenes that show the structure before the change (context files). Control flow first, domain meaning second (Pennington) |
| Author (self-review, PR description) | Intent → change → risks. `reviewFocus` lists what the author should double-check |

## 6. The question chain (R29, R30)

Before writing any steps, write the scenes' `question`s in order and read them as a list. Each one should follow from the previous answer. If a question comes out of nowhere, the order is wrong, or a bridging scene is missing.

| Scene | `question` | `bridge` (from the previous answer) |
|---|---|---|
| 1 | What does this change add, and where? | (none) |
| 2 | What does a request to the new endpoint look like? | The map shows one entry point, so start there. |
| 3 | Who is allowed to call it? | The controller checks access first, so that comes next. |
| 4 | What goes into the list? | Access is settled, so now the query itself. |
| 5 | What do the tests guarantee? | The behaviour is clear; check what is pinned down. |

## 7. Narration rules (R8, R9, R16, R18, R31, R32)

- **Shape: one lead sentence, then 2–4 bullets.** The lead sentence (prose) states the point or the *why*. Each bullet then describes one visual beat in the order it appears on screen. Pin each bullet to the step that shows it with `cue` (see ir-authoring). Every bullet is a full short sentence that keeps its connective ("so", "because", "instead of"). Don't reduce it to a noun-phrase fragment, which drops the causal link the viewer needs.
- Keep a short prose paragraph only where the whole scene is one causal chain that bullets would break apart.
- Never read code aloud. Say **why** it is done this way, **how** it relates to other code, and **what changes** as a result.
- Make the sentence order match the step order. The thing named first is highlighted first.
- Announce the destination before moving, for example "Now let's jump into `withRetry`."
- Don't state guesses as facts. Mark unverified intent ("appears to…") or move it to `reviewFocus`.
- Attach risks to the line they concern with `note tone:"risk"`, worded as something to check, not a verdict.
- Put identifiers in backticks. Use `**bold**` at most once or twice per scene.
