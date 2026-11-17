# Design rules R1–R28

Apply these rules when you design a walkthrough. When two choices seem equally good, the rule decides. Other references cite them as R#.

## Load: what goes into a scene
- **R1. One idea per scene.** Introduce at most about 4 new identifiers, files, or concepts per scene. Write 2–4 sentences of narration and 3–8 steps.
- **R2. Remove noise.** Keep the default `whitespace: "collapse"` and `granularity: "word"`. Leave lock files and generated files out of the narration. Fold or `focus` large files.
- **R3. Chunk mechanical repetition.** For a pattern that repeats, show one representative instance plus a `refs` list, and say "the rest follow the same pattern".

## Pacing and signaling
- **R4. Segment.** Scene boundaries are pause points, so end each scene at a natural "got it" moment.
- **R5. Pre-train.** Scene 1 is a big-picture `graph`. Define unfamiliar domain terms in `glossary`.
- **R6. Signal what matters.** Use `highlight` with a short `label` on key lines, and `focus` to dim the rest.
- **R7. Explain in place.** Put a remark about a specific line in a `note` on that line, not in the narration.
- **R8. Keep words and visuals in sync.** Narration items (sentences or bullets) appear one by one. Order them like the steps, and pin each one to the step it describes with `cue`. Shape: a prose lead sentence (the why), then 2–4 bullets, each one visual beat written as a full sentence with its connective.
- **R9. Don't read code aloud.** The narration covers intent, reasons, and relations.

## Motion
- **R10. Animate only real IDE actions** (`open`, `reveal`, `goto`, `refs`) **and the edit itself** (`type`, which replays a key hunk being written). Nothing decorative. Replaying an edit is congruent motion: the change over time *is* the concept. Keep it for the few edits that carry the change.
- **R11. Keep 1–2 simultaneous highlights.** The most salient thing on screen must be the most relevant.
- **R12. Leave room for viewer control.** Keep scenes short enough that a viewer can pause, step back, or explore.

## Order and content
- **R13. State the intent first.** The summary and scene 1 say "this change does X so that Y". Later scenes confirm it in code.
- **R14. Follow execution or dependency order,** never file or diff order.
- **R15. Mark beacons and convention breaks.** Give lines that reveal intent a `highlight` with a label. Give unusual code a `note` with `tone: "risk"`.
- **R16. Answer what, why, or how in every scene.** Use note tones to show which: `why`, `risk`, `tip`.
- **R17. Adapt to the audience's familiarity.** See the playbook, "Audience".

## Navigation
- **R18. Announce before moving.** Before a `goto` or `refs`, say where you are going and why.
- **R19. Let the player navigate.** Use `goto`, `refs`, and `layout: "columns"` instead of describing locations in words.
- **R20. Fit each scene to a question type:**

| Question | Scene type | Actions |
|---|---|---|
| Where does it start? | entry point | `open` + `focus` |
| What does this call or who calls it? | expand | `goto`, `refs` |
| How does the flow work? | trace | chained `goto`, `columns` |
| How do the parts relate? | structure, impact | `graph`, `refs` |

## Structure
- **R21. Make one chapter per independent cluster.** Start from `clusters` in the collect output.
- **R22. Keep related parts adjacent.** A definition comes right before its usages, and an implementation right before its tests.
- **R23. Open with a map:** the summary, `strategy.rationale`, chapter goals, and the scene-1 graph.
- **R24. Close with a recap:** `takeaways` (2–4) and `reviewFocus` (open questions for the reviewer).
- **R25. Scale scaffolding to the audience.** Newcomers get more pre-training. Reviewers get less.

## Diff views
- **R26. Split for in-place rewrites, unified for additions, deletions, and scattered edits.**
- **R27. `patience` (the default) for moved blocks and brace-heavy code; `myers` for short edits.**
- **R28. Open new files in `after` and deleted files in `before`, never in `diff`.**
