# Cognitive foundations: rationale for R1–R36

This is background material and is not loaded at runtime. The operational rules live in `../references/design-rules.md`. This document gives the research basis for each rule and notes how the engine and the skill implement it.

---

## 1. Working memory and cognitive load

**Basis**
- *Cognitive Load Theory* (Sweller, 1988; Sweller, van Merriënboer & Paas, 1998/2019) splits load into three kinds. *Intrinsic* load comes from the task itself. *Extraneous* load comes from how the material is presented. *Germane* load goes into building schemas. A designer can only remove extraneous load.
- Working memory holds about 4±1 chunks (Cowan, 2001). Treat Miller's (1956) 7±2 as an upper bound.
- In code review, reviewers' working-memory capacity relates to their performance, and so does the order in which change parts are presented (Baum, Schneider & Bacchelli, *EMSE* 2019).

**Rules**
- **R1. One idea per scene.** Introduce at most about 4 new identifiers, files, or concepts per scene.
  → engine warnings: narration over 600 characters, more than 12 steps in a scene, more than 7 scenes in a chapter.
- **R2. Remove extraneous load.** Collapse lines whose only change is whitespace, and show word-level diffs so only the changed tokens stand out. Keep lock files and generated files out of the narration. Fold large files (`context`) or `focus` the relevant part.
  → engine: whitespace-only pair detection and word diff (`src/shared/diff.ts`). Skill: `isGeneratedFile`.
- **R3. Chunk repetitive mechanical edits.** When one pattern repeats (for example, 30 call sites updated for a new signature), show one representative instance and a `refs` list, and say that the rest follow the same pattern.

## 2. Multimedia learning principles (Mayer, *Multimedia Learning*, 3rd ed., 2021)

| Principle | Finding | Application |
|---|---|---|
| Segmenting | Learner-paced segments improve understanding | Scenes are segments. The player pauses at each scene end by default and supports speed control, scene jumps, and scrubbing (**R4**) |
| Pre-training | Learning the names and key concepts first reduces load later | Open with a big-picture scene (`graph`) and provide a `glossary` (**R5**) |
| Signaling | Cues to what matters cut search cost | `highlight` with a `label`, `focus` (dims the rest), the Cmd-hover underline (**R6**) |
| Spatial contiguity | Put explanations next to what they explain | `note` renders inline, directly under the code line it refers to (**R7**) |
| Temporal contiguity | Words and the visuals they describe should coincide | Order the steps the same way as the narration's sentences, and use `say` for captions in the middle of a scene (**R8**) |
| Coherence | Interesting but extraneous material hurts | No decorative motion. Files outside the narration are available for exploration only (see R2) |
| Redundancy | Don't repeat on-screen content in text | The narration explains **intent, reasons, and relations**. It never reads code aloud (**R9**) |

## 3. When animation helps

**Basis**
- Tversky, Morrison & Bétrancourt (2002), *Animation: can it facilitate?* Animation beats static graphics only when it satisfies *congruence* (the change shown on screen mirrors the change in the concept) and *apprehension* (it is slow and clear enough to perceive). Interactivity, such as pausing and replaying, helps.
- Lowe (2003): learners attend to what is perceptually salient, which is not necessarily what is thematically relevant.

**Rules**
- **R10. Animate only real IDE actions, plus replaying the key edit itself (`type`):** opening a file, scrolling, going to a definition (Cmd+Click), finding references. These are the actions developers actually perform while comprehending code, so the motion is congruent with the meaning. No flourishes or decorative transitions.
- **R11. The most salient thing must be the most relevant thing.** Keep 1–2 highlights at a time, and use `focus` to dim everything else.
- **R12. Give the learner control:** play, pause, speed, scrubbing, scene jumps, and free exploration while paused (file tree, Cmd+Click).
  → engine: the player renders `state(T)` as a pure function of time, so any seek gives an identical frame.

## 4. Program comprehension models

**Basis**
- **Top-down, hypothesis-driven** (Brooks, 1983): comprehension starts from a hypothesis about what the code does and verifies it through *beacons*, characteristic code that reveals intent.
- **Bottom-up, program model then situation model** (Pennington, 1987): with unfamiliar code, readers first build a control-flow model, then the domain meaning.
- **Plans and rules of discourse** (Soloway & Ehrlich, 1984): experts recognise familiar programming plans, and code that violates conventions badly hurts comprehension.
- **Why, how, and what questions, and conjectures** (Letovsky, 1987): comprehenders keep forming conjectures about what the code does, why, and how.
- **Integrated metamodel** (von Mayrhauser & Vans, 1995): readers switch between top-down, bottom-up, and situation models depending on how familiar the code is.
- **Linearity** (Busjahn et al., 2015): novices read code more linearly than experts, and experts follow execution order.

**Rules**
- **R13. State the intent (the hypothesis) first.** `meta.summary` and the first scene say "this change does X so that Y". Later scenes confirm it in code.
- **R14. Follow execution or dependency order, not file order.** Trace the execution path (entry point → callee) or the data flow. Never use alphabetical or diff order as is.
- **R15. Point out beacons and convention breaks.** Mark lines that reveal intent with `highlight` and a label. Mark unusual code with `note tone:"risk"`.
- **R16. Each scene explicitly answers at least one of what, why, or how.** Note tones (`why`, `risk`, `tip`) make the kind of answer visible.
- **R17. Adapt to the audience's familiarity.** → playbook, "Audience".

## 5. Information foraging and developers' questions

**Basis**
- *Information Foraging Theory* (Pirolli & Card, 1999), applied to programmers by Lawrance et al. (2013): developers follow *information scent*, and navigation cost breaks comprehension.
- Ko, Myers, Coblenz & Aung (2006): a large share of maintenance time goes to navigating and to seeking, relating, and collecting relevant information.
- Sillito, Murphy & De Volder (2006): developers ask 44 kinds of questions during change tasks, in four categories: (1) finding focus points, (2) expanding focus points (callers, callees, types), (3) understanding a connected subgraph, and (4) relating subgraphs to each other.

**Rules**
- **R18. Give scent before moving.** Before a `goto` or `refs`, say where you are going and why, in the narration or a `say`.
- **R19. The player pays the navigation cost.** Go to definition, reference lists, and side-by-side panes (`layout: columns`) happen automatically.
- **R20. Match scene types to Sillito's question categories.**

| Question category | Scene type | Typical actions |
|---|---|---|
| Finding focus points | entry-point introduction | `open` + `focus` |
| Expanding focus points | follow a definition or caller | `goto`, `refs` |
| Understanding a subgraph | trace a flow | chained `goto`, `columns` |
| Relating subgraphs | structure | `graph`, `refs` |
| "What will be affected by this change?" | impact (§11) | `impact` |

## 6. Code review research

**Basis**
- Bacchelli & Bird (2013): the central challenge of modern code review is *understanding the change*.
- Baum et al. (ICSME 2017): the order in which change parts are read matters, and related parts (call relations, declaration and use) should sit close together.
- Barnett et al. (2015, *ClusterChanges*) and Tao & Kim (2015): splitting a tangled change into independent partitions makes review easier.

**Rules**
- **R21. Partition the change into clusters and map them to chapters.** Start from `suggestions.clusters` in the collect output (connected components of changed files by imports and references). Independent clusters become separate chapters.
- **R22. Keep related parts adjacent.** Show a definition, then its usages; an implementation, then its tests.

## 7. Overview, recap, and self-explanation

**Basis**
- *Advance organizers* (Ausubel, 1960): seeing the high-level structure first gives new detail something to attach to.
- *Expertise reversal* (Kalyuga et al., 2003): scaffolding that helps novices adds load for experts.
- Self-explanation (Chi et al., 1994) and retrieval practice (Roediger & Karpicke, 2006): a closing summary and questions improve retention.

**Rules**
- **R23. Start with a map.** The overview card shows the summary, the strategy, and the agenda. Scene 1 shows the change as a `graph`.
- **R24. End with a recap and open questions.** Use `meta.takeaways` (2–4 points) and `meta.reviewFocus` (questions the reviewer must decide).
- **R25. Scale scaffolding to the audience.** → playbook, "Audience".

## 8. Visual comparison

**Basis**
- Gleicher et al. (2011), *Visual comparison for information visualization*: there are three ways to show a comparison. *Juxtaposition* places items side by side. *Superposition* overlays them. *Explicit encoding* draws the differences themselves.

**Rules (choosing the diff view)**
- **R26. In-place rewrites call for split (juxtaposition).** Use unified (superposition) when additions or deletions dominate or the edits are scattered. Always encode differences explicitly at word level.
- **R27. Use patience for moved blocks and brace-heavy code.** Its unique-line anchors match the correspondence a human expects. Use myers for short edits where a minimal edit script matters.
- **R28. Open new files in `after`, not `diff`,** because all-green carries no information. Open deleted files in `before`.

## 9. Text structure of the narration (lead line + note-form bullets)

**Basis**
- **Signaling with structure.** Headings, lists, and enumeration help readers find a text's structure and remember it (Lorch, 1989). For *procedural* content, a step-by-step format improves comprehension and execution over continuous prose (Ganier, 2004).
- **Reading competes with looking.** The narration is read while the code moves (the split-attention and redundancy findings in Mayer, 2021). Every word spent on sentence frame (subject, auxiliaries, politeness endings) is time not spent on the code. Reading time grows with length and with the number of words to integrate (Just & Carpenter, 1980), and a short line can be taken in with few fixations (Rayner, 1998).
- **Cohesion still matters.** Explicit relations ("because", "so", "instead") help readers with less domain knowledge most (McNamara, Kintsch, Songer & Kintsch, 1996), and fragments that drop the relation hide the reasoning (Tufte, 2003, a critical essay rather than an experiment).
- **Segmenting and temporal contiguity** (Mayer, 2021): one segment per visual beat, presented together with that beat.

**Rule.** R8 and R32 combine these. A lead line carries the *why*; bullets carry the procedure, one per visual beat, revealed in sync with its step (`cue`). All of it is written in note form (Korean 개조식, English telegraphic style): the sentence frame goes, the relation stays, written as a symbol (`→` cause or sequence, `:` definition, `/` contrast). The reasoning remains explicit, as cohesion research asks, at a fraction of the reading cost. `question` is the exception: it is the viewer's own question, so it stays a question.

## 10. Question chains and event boundaries (R29–R31)

**Basis**
- Program comprehension is driven by questions and hypotheses (Brooks, 1983; Letovsky, 1987). Developers' questions follow from what they just learned, moving from focus points to connected code (Sillito et al., 2006).
- People segment continuous experience into events. Boundaries are where mental models get updated, and a clear transition at a boundary improves comprehension and memory (Zacks et al., 2007).
- Working memory holds about four chunks (Cowan, 2001), and words placed next to the thing they describe beat words placed elsewhere (spatial contiguity; Mayer, 2021).

**Rules.**
- R29: each scene answers a stated question.
- R30: each boundary carries a bridge from the last answer to the next question.
- R31: one explanation at a time, written to sit under the code it explains.

## 11. Context outside the diff (R34–R36)

**Basis**
- Understanding the change is the main challenge of code review, and reviewers say what they lack most is context: the code around the change and what it affects (Bacchelli & Bird, 2013). Review tools show the edited lines and little else.
- "What will be (directly or indirectly) affected by this change?" is one of the questions developers ask during change tasks, and one of the hardest to answer with the tools at hand (Sillito, Murphy & De Volder, 2006; 2008). Developers analyse a change's impact mostly by navigating dependencies by hand (Tao, Dang, Xie, Zhang & Kim, 2012).
- Comprehension builds a *situation model* that integrates the text with what it refers to (Pennington, 1987; Kintsch, 1998). A hunk read without the code it serves gives the reader the text model only: what the lines say, not what they do to the system.
- What is out of view has no information scent, so it is not foraged (Pirolli & Card, 1999). An unchanged caller never appears in a diff, so a reviewer does not go looking for it.
- *Source monitoring* (Johnson, Hashtroudi & Lindsay, 1993): people misattribute where information came from unless the source is marked. Unchanged code shown next to changed code must say that it is unchanged.

**Rules and implementation**
- **R34.** An `impact` step lists the unchanged dependents of a changed contract with a relation and a verdict, and the player walks through them like references, lighting each line in the verdict's colour. The authoring workflow derives the list from the whole repository (collect's import-linked fan-in), not from the diff.
- **R35.** A `goto` to the constraint before the edit that answers it: the edit then reads as a response, not as an arbitrary change.
- **R36.** `meta.impact` states the reach (or its absence) in the overview, as an advance organizer for risk (Ausubel, 1960). `check` warns when it is empty.
- Every unchanged file is badged *outside the diff* in the editor path and in the impact list (source monitoring).

---

### References
- Ausubel, D. P. (1960). The use of advance organizers in the learning and retention of meaningful verbal material. *J. Educational Psychology*.
- Bacchelli, A., & Bird, C. (2013). Expectations, outcomes, and challenges of modern code review. *ICSE*.
- Barnett, M., Bird, C., Brunet, J., & Lahiri, S. K. (2015). Helping developers help themselves: Automatic decomposition of code review changesets. *ICSE*.
- Baum, T., Schneider, K., & Bacchelli, A. (2017). On the optimal order of reading source code changes for review. *ICSME*.
- Baum, T., Schneider, K., & Bacchelli, A. (2019). Associating working memory capacity and code change ordering with code review performance. *Empirical Software Engineering*.
- Brooks, R. (1983). Towards a theory of the comprehension of computer programs. *IJMMS*.
- Busjahn, T., et al. (2015). Eye movements in code reading: Relaxing the linear order. *ICPC*.
- Chi, M. T. H., et al. (1994). Eliciting self-explanations improves understanding. *Cognitive Science*.
- Cowan, N. (2001). The magical number 4 in short-term memory. *Behavioral and Brain Sciences*.
- Gleicher, M., et al. (2011). Visual comparison for information visualization. *Information Visualization*.
- Kalyuga, S., Ayres, P., Chandler, P., & Sweller, J. (2003). The expertise reversal effect. *Educational Psychologist*.
- Ko, A. J., Myers, B. A., Coblenz, M. J., & Aung, H. H. (2006). An exploratory study of how developers seek, relate, and collect relevant information during software maintenance tasks. *IEEE TSE*.
- Lawrance, J., Bogart, C., Burnett, M., Bellamy, R., Rector, K., & Fleming, S. D. (2013). How programmers debug, revisited: An information foraging theory perspective. *IEEE TSE*.
- Letovsky, S. (1987). Cognitive processes in program comprehension. *J. Systems and Software*.
- Lowe, R. K. (2003). Animation and learning: selective processing of information in dynamic graphics. *Learning and Instruction*.
- Zacks, J. M., Speer, N. K., Swallow, K. M., Braver, T. S., & Reynolds, J. R. (2007). Event perception: a mind-brain perspective. *Psychological Bulletin*.
- Ganier, F. (2004). Factors affecting the processing of procedural instructions: implications for document design. *IEEE Transactions on Professional Communication*.
- Lorch, R. F. (1989). Text-signaling devices and their effects on reading and memory processes. *Educational Psychology Review*.
- Mayer, R. E. (2021). *Multimedia Learning* (3rd ed.). Cambridge University Press.
- McNamara, D. S., Kintsch, E., Songer, N. B., & Kintsch, W. (1996). Are good texts always better? Interactions of text coherence, background knowledge, and levels of understanding in learning from text. *Cognition and Instruction*.
- Tufte, E. R. (2003). *The Cognitive Style of PowerPoint*. Graphics Press.
- Pennington, N. (1987). Stimulus structures and mental representations in expert comprehension of computer programs. *Cognitive Psychology*.
- Pirolli, P., & Card, S. (1999). Information foraging. *Psychological Review*.
- Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning. *Psychological Science*.
- Sillito, J., Murphy, G. C., & De Volder, K. (2006). Questions programmers ask during software evolution tasks. *FSE*.
- Soloway, E., & Ehrlich, K. (1984). Empirical studies of programming knowledge. *IEEE TSE*.
- Sweller, J. (1988). Cognitive load during problem solving. *Cognitive Science*.
- Tao, Y., & Kim, S. (2015). Partitioning composite code changes to facilitate code review. *MSR*.
- Tversky, B., Morrison, J. B., & Bétrancourt, M. (2002). Animation: can it facilitate? *IJHCS*.
- von Mayrhauser, A., & Vans, A. M. (1995). Program comprehension during software maintenance and evolution. *IEEE Computer*.
- Johnson, M. K., Hashtroudi, S., & Lindsay, D. S. (1993). Source monitoring. *Psychological Bulletin*.
- Just, M. A., & Carpenter, P. A. (1980). A theory of reading: From eye fixations to comprehension. *Psychological Review*.
- Kintsch, W. (1998). *Comprehension: A Paradigm for Cognition*. Cambridge University Press.
- Rayner, K. (1998). Eye movements in reading and information processing: 20 years of research. *Psychological Bulletin*.
- Sillito, J., Murphy, G. C., & De Volder, K. (2008). Asking and answering questions during a programming change task. *IEEE TSE*.
- Tao, Y., Dang, Y., Xie, T., Zhang, D., & Kim, S. (2012). How do software engineers understand code changes? An exploratory study in industry. *FSE*.
