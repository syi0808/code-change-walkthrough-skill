# Design rules R1–R36

Apply these rules when you design a walkthrough. When two choices seem equally good, the rule decides. Other references cite them as R#.

## Load: what goes into a scene
- **R1. One idea per scene.** Introduce at most about 4 new identifiers, files, or concepts per scene. Write a lead line plus 2–4 bullets of narration and 3–8 steps.
- **R2. Remove noise.** Keep the default `whitespace: "collapse"` and `granularity: "word"`. Leave lock files and generated files out of the narration. Fold or `focus` large files.
- **R3. Chunk mechanical repetition.** For a pattern that repeats, show one representative instance plus a `refs` list, and say "the rest follow the same pattern".

## Pacing and signaling
- **R4. Segment.** Scene boundaries are pause points, so end each scene at a natural "got it" moment.
- **R5. Pre-train.** Scene 1 is a big-picture `graph`. Define unfamiliar domain terms in `glossary`.
- **R6. Signal what matters.** Use `highlight` with a short `label` on key lines, and `focus` to dim the rest.
- **R7. Explain in place.** Put a remark about a specific line in a `note` on that line, not in the narration.
- **R8. Keep words and visuals in sync.** Narration items (sentences or bullets) appear one by one. Order them like the steps, and pin each one to the step it describes with `cue`. Shape: a lead line (the why), then 2–4 bullets, each one visual beat in note form (R32).
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
| How do the parts relate? | structure | `graph`, `refs` |
| What else does this reach? | impact (R34) | `impact` |

## Structure
- **R21. Make one chapter per independent cluster.** Start from `clusters` in the collect output.
- **R22. Keep related parts adjacent.** A definition comes right before its usages, and an implementation right before its tests.
- **R23. Open with a map:** the summary, `strategy.rationale`, chapter goals, and the scene-1 graph.
- **R24. Close with a recap:** `takeaways` (2–4) and `reviewFocus` (open questions for the reviewer).
- **R25. Scale scaffolding to the audience.** Newcomers get more pre-training. Reviewers get less.

## Coverage
- **R33. Cover the whole diff, stop where it needs words.** The tour replays every hunk; order it by the question chain (`tour.order`) and attach explanation scenes as stops (`at`). Type key hunks (`tempo: "key"`), skim wiring (`"skim"`), and don't spend stops on code that speaks for itself.

## Narrative thread
- **R29. Every scene answers a question.** Give each scene a `question`: what the viewer is wondering at that moment, phrased the way they would ask it ("Who is allowed to see this list?"). The player keeps it above the code all scene long, so the code on screen always has a reason. The chain of questions *is* the order of the walkthrough.
- **R30. Bridge every boundary.** Give every scene after the first a `bridge`, one sentence on how the previous answer raises this question ("Access is settled, so now: what goes into the list?"). The player shows it in the heading band at the top of the code when the scene starts, under the new question.
- **R31. Write for one voice at a time.** The player shows one explanation at a time, attached under the newest highlight, and a `note` counts as that voice. Per scene, use one lead line, then one bullet or note per highlight, in the order of the highlights. Only the two newest highlights stay salient, so explain each as it appears and don't refer back to a third.
- **R32. Write in note form.** All prose except `question` is note form in the viewer's language: Korean 개조식 (noun or nominal endings, never `~다`/`~습니다`), English telegraphic style (no subject, articles, or "is"; verb-first or noun phrase; no period), or the bullet register of the viewer's language. One fact per line; `→`, `:`, `/` instead of connectives. No em dashes, stacked qualifiers, or filler. A reader takes in a note-form line in one fixation span and sees its structure without parsing a sentence; the time saved goes to the code. See `ir-authoring.md`, "Narration style".

## Context outside the diff
- **R34. Show what the diff hides.** A review tool shows edited lines only. For every changed contract (signature, return shape, error, data, config, event), find its unchanged dependents in the whole repository (collect's fan-in, then read them) and bring the ones a reviewer must judge into the walkthrough with an `impact` step. Give each a `relation` and an `effect` (`safe`, `check`, `breaks`, `updated`).
- **R35. Context before the edit when the edit answers it.** If a change only makes sense against code elsewhere (a caller's expectation, an invariant, a default, a helper it mirrors), show that code first (`goto`), then the edit.
- **R36. State the reach, even when it is nothing.** Fill `meta.impact` with what outside the diff the change reaches and how (callers, data, config, other services, clients), including "no existing behaviour changes" when that is the finding. The player shows it in the overview, so the reviewer knows the reach before reading a line.

## Diff views
- **R26. Split for in-place rewrites, unified for additions, deletions, and scattered edits.**
- **R27. `patience` (the default) for moved blocks and brace-heavy code; `myers` for short edits.**
- **R28. Open new files in `after` and deleted files in `before`, never in `diff`.**
