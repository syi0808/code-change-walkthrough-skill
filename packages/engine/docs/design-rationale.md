# Player design rationale: rules M1–M32

## Design diagnosis: why viewers lose the thread

Viewers watch a walkthrough the way they watch a video: attention follows one thread, at the centre of the code. Feedback from early versions fell into three patterns, and all three come from the same mismatch.

1. **Things changed outside the point of gaze.** The cursor left the viewport, the active file was parked at the edge of the explorer, and the explanation and structure lived in side panels. Peripheral information is not taken in unless the viewer reads it deliberately (split attention; *useful field of view*).
2. **The point of gaze changed without a causal link.** Scene boundaries cut to a different file, files appeared already open, and the cursor clicked into dimmed code. Without a visible cause, a change is a surprise to recover from instead of a step to follow (event segmentation; change blindness).
3. **Too much was salient at once.** Every explorer row, several highlights, notes, labels, and overlapping graph edges all competed for attention. Each one costs a slice of a four-chunk working memory.

The mismatch: early versions reproduced **what an IDE does**, while the viewer needs **what to look at now and why, delivered where they are already looking**. Rules M13–M16 address this directly, and the other rules serve it.

A second round of feedback (speed not applying to the cursor, file switches, or captions; layout jumping when an explanation appeared; several animations at once while switching files) also had one cause: **the viewer predicts the next frame, and the player broke the prediction.** The player had two clocks. Timeline time followed the speed control, but a large share of the motion (CSS fades, browser smooth-scrolling, elements inserted into the flow) ran on wall-clock time, overlapped the timeline's steps, and pushed content instantly. Measured on a real walkthrough, two or more screen regions moved at once in 69% of frames. Rules M19–M22 make one clock and one moving region the structure of the player, not a convention.

The player's visual design and animation follow rules taken from research on perception, attention, and learning. Every rule below names its basis and the place in the player that implements it. These rules govern the **engine**. The rules for planning an explanation (R1–R33) belong to the authoring skill.

## Orientation: knowing where you are

**M1. One spatial layout that stays put.** The explorer is on the left, the code in the middle, and the walkthrough on the right, and no panel ever jumps or swaps place. Viewers build a spatial map of the screen and rely on it. *Visual momentum* (Woods, 1984): the cost of each view change drops when the new view keeps landmarks from the old one.
→ `styles/frame.css` grid; panels collapse with a sliding transition instead of disappearing.

**M2. Overview and detail together.** The first relationship graph is shown full screen as the advance organizer. When its scene ends, it docks into the top of the walkthrough panel as a **structure map** for the rest of the walkthrough, and the node for the file in view lights up. The map never covers code. Basis: *overview+detail* interfaces (Cockburn, Karlson & Bederson, 2009), advance organizers (Ausubel, 1960), and signaling (Mayer).
→ `ui/Graph.svelte`: the same element moves between `full`, `mini` (the `.gd-map` slot), and `panel`; the move finishes before the next scene's pointer sets off (M20). Viewers can toggle it with `M`.

**M3. Navigation is shown, not teleported.** Opening a file is a procedure of separate events (`openPhases`):
1. *locate*: the explorer walks to the file (M28), scrolls each row it steps on into view, and dims the rest. Only the explorer moves.
2. *travel*: the cursor moves to the row, which is now still.
3. *press*: the click.
4. *beat*: a short pause, so cause and effect read as two events.
5. *swap*: the tab opens and the code fades in, already at its first change. The orientation strip and the outline change in this same moment.
6. *reveal* (when asked): the file's changes sweep in from top to bottom.

A jump to a definition scrolls the source token into view first, then the cursor moves to it, then the jump happens, then the target flashes. Basis: change blindness (Rensink, O'Regan & Clark, 1997), because an instant swap hides what changed. Pre-cueing (Posner, 1980) points attention at the location before the event happens there.
→ `openPhases` in `src/shared/timing.ts` (shared by the compiler's duration estimate and the player), `applyOpen` and `apply('goto')` in `core/state.ts`.

**M4. One thing moves at a time.** Steps run in sequence, and each step owns the screen while it runs: the cursor travels only while nothing else animates, and highlights arrive only after the file has opened. Concurrent motion splits attention, and viewers cannot track more than a few moving objects at once (Pylyshyn & Storm, 1988). Animation that is too fast or too busy is not apprehended (Tversky, Morrison & Bétrancourt, 2002).
→ The timeline lays steps out back to back (`layoutScene` in `src/shared/timing.ts`). `with: true` is the explicit, rarely needed exception. M20 extends the rule to everything on screen.

**M5. Reveal things where the eye already is.** A file or line being revealed is scrolled to the **centre** of its panel, never parked at an edge. Items at the periphery are often missed, because the useful field of view shrinks under load (Ball et al., 1988, on the *useful field of view*).
→ explorer locate (`ui/Explorer.svelte`) and editor `center` / `ensure` scrolling (`core/scroll.ts`).

## Motion quality

**M6. Natural, responsive motion (Emil Kowalski's interface-motion practice).** Anything appearing or responding uses a strong ease-out (`cubic-bezier(0.23, 1, 0.32, 1)`), so it starts fast and settles gently and the interface feels immediate. Large surfaces moving (panels, the docking map) use a drawer curve (`cubic-bezier(0.32, 0.72, 0, 1)`). Movement between two on-screen states (scrolling, the cursor) uses ease-in-out, and the cursor travels on a gentle arc. Entrances combine a small translate (≤ 8 px), a slight scale (≥ 0.96, never from 0), and a short blur, rather than a long slide. Transitions are CSS transitions wherever they can be interrupted (highlights fade in *and* out). Pressed buttons scale to 0.97. Motion that follows physical expectations is easier to follow and predict (Chang & Ungar, 1993).
→ `--ease`, `--ease-drawer`, `--ease-in-out`, the `swapIn` keyframes, `.row::before`, and `ease()` / the arc in `ui/Pointer.svelte`.

**M7. Durations are long enough to perceive and short enough not to stall.** Interface responses run for 200–400 ms, surface moves for 600–800 ms, and actions run for 0.8–3.6 s, which is enough to track an object's path (apprehension principle; Tversky et al., 2002). Highlights sweep in line by line instead of all at once, so their extent is read as a range.
→ the `BASE` durations in `src/shared/timing.ts`, the highlight sweep (`h.p`), and the `--d-*` duration tokens.

**M8. Words arrive with the visuals they describe.** The narration is split into items (sentences or bullets). Each item appears when the step it describes runs. The current item is emphasised, past items stay readable, and upcoming items are faint, so the layout never jumps. Basis: temporal contiguity and segmenting (Mayer, 2021). Showing the whole text at once invites reading ahead of the visuals, which splits attention.
→ `cueTimes` and `inferCues` in `src/shared/timing.ts`. An author can pin an item to a step with `cue: n`. An unpinned item arrives with the last unpinned pointing step (highlight, focus, note, goto, ...) before the next pin, so it does not land seconds away from the code it is about. Items still without a step are spread by the time they need (M24).

**M9. The change itself can be replayed.** `type` shows an edit happening: removed lines turn red, then the new text is typed in. Until that step runs, the edit appears not yet written. When the motion is congruent with the concept, here a change over time, animation beats static graphics (Tversky et al., 2002). Seeing a state transition prevents the viewer from missing the difference (Rensink et al., 1997).
→ `apply('type')` and `core/decorate.ts` (the `typ-*` classes).

## Salience

**M10. Only the target is salient.** Abrupt onsets capture attention involuntarily (Yantis & Jonides, 1984), so the player keeps abrupt changes for the intended target: the flash after a jump and the cursor's click ripple. Everything else fades. While a region is in focus, the rest dims.
The explorer applies the same rule as a spotlight. The file in focus is fully visible, the folders on its path stay legible so its location stays readable, and every other row recedes instead of disappearing (*focus+context*; Furnas, 1986). Hovering over the explorer restores everything for free exploration. Marking one row in a long, dense list adds yet another salient element; dimming the rest removes the competition instead (visual search slows as similar distractors increase; Treisman & Gelade, 1980).
→ `.flash`, `.ripple`, `.dim`, the explorer `.spot` / `.path` / `.target` classes, and fades on every other change.

**M11. Diff colours stay readable under emphasis.** Highlights are drawn as a ring with an accent bar and a faint tint, never as an opaque fill, so the add/delete colours stay visible underneath. The diff palette follows GitHub so that experienced reviewers use colour meanings they already know (pre-existing schemas; Sweller's element interactivity).
→ `.row.hl::before`, and the diff tokens in `styles/tokens.css`.

**M12. The viewer controls the pace.** Playback pauses at the end of each scene by default. Viewers can change speed, scrub, jump to a scene, and explore freely while paused. Learner-paced segments outperform system-paced ones (Mayer & Chandler, 2001), and interactivity is the main factor that makes animation useful (Tversky et al., 2002).
→ the controls, keyboard shortcuts, and `userOps` (exploration while paused).

## Orientation and narrative

**M13. The answer to "why am I looking at this?" is always above the code.** A strip above the editor shows the scene number, the scene's **question** (the question the viewer has now, which the scene answers), and the file in view. Comprehension is driven by questions and hypotheses (Brooks, 1983; Letovsky, 1987; Sillito et al., 2006). A visible question turns watching into checking an answer, so code on screen always has a purpose.
→ `ui/Stage.svelte` (orientation strip), scene `question`.

**M14. An attention budget per screen.** Working memory holds about four chunks (Cowan, 2001), so the player caps what is salient at once:
- the strip (where and why): 1–2 chunks
- one explanation
- at most two fully salient highlights; older highlights recede to a thin bar
- one structure-map node lit

The explorer and the outline sit outside the budget because they are dimmed or peripheral.
→ `fresh` highlights in `core/decorate.ts`, the single voice, `.hl-old`.

**M15. One voice, at the point of focus.** Narration items and notes are one channel. Only the newest is shown, and it sits directly under the code range most recently highlighted (spatial contiguity, Mayer, 2021, at its strongest), so the viewer never has to look away from the code to learn why it is highlighted. When no code is in play, such as the lead sentence or a graph scene, the voice is read in the heading band at the top of the code (M27). The right panel stays a reference outline that is not needed to follow along.
→ `computeVoice` (`core/voice.ts`), `.note.callout`, `ui/Caption.svelte` (the heading band, M27).

**M16. Every scene boundary is bridged.** A boundary between scenes is an event boundary: viewers update their mental model there, and an unexplained cut forces them to rebuild it (event segmentation; Zacks et al., 2007). Each scene after the first opens with a short bridge: what was just seen, **why this comes next** (`bridge`), and the file it goes to, told in the heading band (M27) right under the new question, which is marked in the strip for that moment. The code stays visible and sharp, only receding a little, and the structure map pulses the next stop, so the move is previewed instead of cut (visual momentum; Woods, 1984).
→ `BRIDGE` lead-in (at least; a longer bridge sentence gets its reading time, up to `BRIDGE_MAX`), the bridge in `ui/Caption.svelte`, `.wt-stage.bridging`, `.g-node.next`.

## Coverage

**M17. The whole change is the spine, and explanations are stops on it.** A reviewer's first goal is confidence that they have seen *everything* that changed. A curated walkthrough that leaves changes for later makes the viewer reopen the diff to check, which defeats its purpose. So the tour replays every hunk, and the walkthrough panel counts the hunks seen. Explanations become stops on that path instead of a selection of it.
→ `expandTour` (compiler), `replay` steps, the `.gd-sc.auto` file rows and the hunk counter.

**M18. Spend time where there is information.** Animation helps only where the motion carries meaning (Tversky et al., 2002), and long stretches of low-information footage cause vigilance to drop (Mackworth, 1948). So time follows information:
- Key hunks are typed.
- Ordinary hunks arrive line by line, at roughly reading pace.
- Wiring appears as one block after a shortened walk to the explorer.
- Replay segments have no narration, no bridge, and no end-of-scene pause.

Total length matters less than wasted time, because viewers have speed control, ±5 s seeking (←/→), and scene jumps (Shift+←/→).
→ `replayMs`, `openPhases` (`fast`), the `auto` scene timing in `src/shared/timing.ts`.

## Motion integrity: one clock, one moving region

**M19. One clock.** Everything that carries meaning moves on timeline time: the cursor, the explorer and editor scrolling, the outline's scrolling, an explanation opening and closing, rows growing in, the code fading in after a click, and the flash after a jump. CSS motion that remains (entrances, fades) has its duration divided by the playback rate (`--rate`). So 2x is 2x everywhere, pausing freezes everything, and seeking shows the end state instead of animating across the jump. A control that only partly obeys breaks the viewer's sense of agency: the felt link between an action and its outcome (Haggard, 2017). Once some motion ignores the speed control, the viewer stops trusting the control.
→ `app/player.svelte.ts` (`T` advances by wall time × speed; `--rate`), `core/tween.ts`, `core/notes.ts`, `styles/tokens.css` (`--d-*`).

**M20. One region moves at a time; context changes ride on the event.** During a procedure (M3) each phase owns the screen. Peripheral panels (the outline, the structure map, the narration text) never move while the code is being written: they change in the same moment as the screen change they report, or they follow it after a beat (`transition-delay`). Nothing loops forever outside the point of focus (no pulsing markers). Two events within a few hundred milliseconds compete for one processing channel, and the second is processed late or missed (psychological refractory period, Pashler, 1994; attentional blink, Raymond, Shapiro & Arnell, 1992). Observers' eyes move to an action's target before the hand arrives (Flanagan & Johansson, 2003), so a target that is still scrolling defeats the prediction. Cause and effect read as causal only when they are distinct and close in time (Michotte, 1946).
→ `openPhases`, `State.shown` / `State.guideScene`, and `app/player.svelte.ts` (`commit()`: one DOM update, then layout steps in a fixed order: explorer, editor, decorations, outline, map, caption, pointer).

**M21. Make room first, then show; content is pushed, never jumps.** An explanation under a line is a layer over the code: it unfolds downwards from the line and fades in, and folds away the same way, without taking room in the code. (It used to open room in the code, which pushed every line below it down and up again with each sentence, and the scroll then moved to compensate: viewers felt it as the page shifting. Measured on a real walkthrough, no code line now moves when an explanation comes or goes.) It covers a few lines under the highlighted range, which are context, never the range itself. A row being written grows from zero height. Rows of a fold that opens grow in, as far as the pointing that opens it has come. Readers remember where text is on the screen and return to it (Rothkopf, 1971). The visual system treats the screen as an outside memory it can look back at (O'Regan, 1992), and an instant jump invalidates that memory. An object that moves continuously keeps its identity, while one that jumps is processed as a new object (object files; Kahneman, Treisman & Gibbs, 1992). So content may move, but only continuously.
The same holds for a state: what has not happened yet is never shown and then taken away. A file opened for a replay appears with its hunks unwritten (they were briefly shown finished, then removed, then written), and a file that sweeps its changes in shows them held back from the moment it appears. Pressing on what is already on screen changes nothing, so the walkthrough never clicks the tab of the file it is showing: how a file is reached is judged by what is on screen, not by what the author's scenes assume.
When the next explanation belongs under the same line (a note on the line a sentence just pointed at), the room stays open and only the words change: folding and reopening the same place reads as two events for one.
→ `core/notes.ts` (`noteViews`), `.row.grow` / `--g` in `core/decorate.ts`, `.row.unfold-in`, `fileSpan` in `core/timeline.ts`, `onScreen` in `src/compile/steps.ts`.

**M22. A steady rhythm at the point of focus.** Typing runs at one constant cadence (35 ms per character at 1x), and ordinary hunks arrive one line per beat (107 ms). A key hunk too long to type at that cadence is replayed line by line instead of being sped up. A steady, predictable rhythm lowers the attention needed to follow a stream of events (dynamic attending, Jones & Boltz, 1989). Terminal commit replays such as gitlogue feel easy to watch for the same reason: one caret, one rhythm, nothing else moving.
All timing values were later raised by 4/3, so that 1x plays at the pace viewers had chosen 0.75x for: reading code alongside an explanation is slower than the earlier values assumed.
→ `TYPE_CHAR_MS`, `LINE_MS` in `src/shared/timing.ts`; `TYPE_MAX_CHARS` in `src/compile/steps.ts`.

**M23. A new line is uncovered in place, and the page carries the write head.** A line arrives the way an editor inserts one: its slot opens top-down at a constant speed and the slot uncovers the text. It does not fade or slide. Motion direction carries meaning: a line sliding in from the left reads as coming from somewhere, which code being written does not (Michotte, 1946). Text at partial contrast is read slowly, and several half-faded lines at once are a shimmer rather than a sequence (reading speed falls steeply with contrast: Legge, Rubin & Luebker, 1987). What marks a line as new is colour: a brighter added colour that settles over a few beats, a short trail showing where writing just happened (M14), driven by the timeline. The editor follows the write edge, not line numbers. The edge moves continuously, also past removed or unchanged rows already on screen. The head first travels down the screen. Near the hold line (about 60% of the height) the page takes it over, picking up speed smoothly, and from then on the head stays still while the page carries the new lines up. Consecutive hunks share that hold, so the page does not settle and restart between them. The eye can track a target moving at a constant speed (smooth pursuit) or hold still on a fixed one, but steps of one row every beat force a saccade on every line (Lisberger, Morris & Tychsen, 1987). Measured on a real walkthrough of 26 tour scenes, the largest scroll change per frame went from 980 px to 4 px.
→ `Head` and `markNew` in `core/decorate.ts`, `.row.ln-fresh` in `styles/editor.css`, `writeEdge` and the `follow` base in `core/scroll.ts`.

**M24. Reading paces the scene, not the animation.** Narration items and notes are one voice, and each one stays on screen for the time it takes to read it (about 470 Hangul syllables or 1400 other characters per minute, plus 1.2 s to find the text). A sentence that names code gets another 0.67 s for the look at the code and back, and every item ends with a 0.4 s beat so the next one reads as a new event. A step that brings in the next item, or a note, waits for that time. (A note right after a cued highlight used to replace its sentence 0.65 s later.) Earlier versions laid the steps out by their animation length (a highlight takes 650 ms) and pinned the sentences to them, so a sentence that needed 3 s was replaced after 0.65 s. A playback speed control cannot repair that: it stretches animation and reading by the same factor, so at 0.5x the cursor dragged while the text still went by too fast. The ratio was wrong, not the speed. Pacing that the viewer does not control must leave time for reading, or the learner falls behind and stops reading altogether (transient information effect, Sweller, Ayres & Kalyuga, 2011; system-paced versus learner-paced, Mayer & Chandler, 2001). Measured on a real walkthrough: 52 of 65 items were shown for less than their reading time (the worst for 0.26 s out of 3.3 s). After the change, none were.
→ `readMs`, `dwellMs`, `inferCues`, and the pin wait in `layoutScene` (`src/shared/timing.ts`); `leadFor` for the bridge card.

**M25. The selection moves; it does not blink.** Opening another file used to remove the highlight from the old row and light up the new row in the same moment. Two changes at two places at once are a flicker, and the eye cannot tell what changed, or how far (change blindness, Rensink, O'Regan & Clark, 1997). Now the explorer has one selection bar that glides from the open file to the new one during the locate phase, so the eye follows a single object from A to B and sees where B is relative to A. A continuously moving object keeps its identity (object files; Kahneman, Treisman & Gibbs, 1992). The explorer scrolls only as far as needed (the row enters a quarter of the height from the edge), so the bar itself is what moves on screen, not the list under it. The old file stays readable while the bar leaves it. After a tab click the bar follows the screen change in the same way.
→ `exScroll.from` in `core/state.ts`, `place()` and `centred()` in `ui/Explorer.svelte`, `.ex-sel` in `styles/explorer.css`.

**M26. A scroll starts where the eye is, and a far one is cut, not rushed.** Three rules for moving the code. (1) A move starts from where the editor really is, and "keep in view" is judged from there too. Recomputing the start from the previous target can disagree with the screen (an explanation moved meanwhile), and the first frame then jumps, often the wrong way; a line already on screen was even scrolled away from, because a computed position said it was not visible. The same target set again by the next step (a note on the line just highlighted) is a new move from the current position, not a return to where the last move began. (2) Keeping a range in view is the least movement that shows it with a margin, a continuous function of the range and its explanation. An explanation growing under the line pushes the page gradually, instead of flipping the target to "centre" at a threshold (which made a 63 px jump halfway through a move). (3) A move of more than about a screen is not animated at full length. At a speed that fits a step (1700 px in 0.4 s) the code is a blur that no eye movement can follow, which reads as a teleport. Smooth pursuit tops out far below that (Lisberger, Morris & Tychsen, 1987). Such a move dims the code, cuts to just short of the target while dimmed, and glides the last 0.8 screen in: the viewer sees the direction and the arrival, and the cut falls inside the dip, the way a blink hides a jump (saccadic suppression; Matin, 1974).
→ `scrollFrame` and the `ensure` rule in `core/scroll.ts`; the captured start (`move`) and the dim in `ui/Pane.svelte`.

**M27. The voice without a code line is read at the top, next to the question.** The lead sentence, graph narration, and the bridge between scenes appear in one heading band at the top of the code, under the tabs and the path, left-aligned with the code. They used to appear as a caption at the bottom of the editor and, for the bridge, as a card over a blurred editor. A caption at the bottom works in film, where the eye takes in the whole frame. In code the eye works near the top and middle of the editor and starts each scene at the question in the strip, so the bottom is the periphery, where text is not read unless the viewer looks for it (useful field of view; Ball et al., 1988). It also sat next to the player controls, which viewers learn to ignore. A card over the code is an abrupt onset at the centre of gaze that captures attention (Yantis & Jonides, 1984), and blurring the code behind it takes away the context the viewer was holding: it reads as an interruption. The band unrolls downwards and rolls back, so it is seen as one thing coming and going rather than as something new popping up each time. The code under it stays sharp, only receding a little during a bridge. A full graph leaves a fixed room for the band, so it does not move when a sentence is one line longer.
→ `ui/Caption.svelte`, `.wt-caption` / `.cap-band` in `styles/orient.css`, the full-graph box in `ui/Graph.svelte`.

---

### References
- Ausubel, D. P. (1960). The use of advance organizers in the learning and retention of meaningful verbal material. *J. Educational Psychology*.
- Ball, K., Beard, B. L., Roenker, D. L., Miller, R. L., & Griggs, D. S. (1988). Age and visual search: expanding the useful field of view. *JOSA A*.
- Chang, B.-W., & Ungar, D. (1993). Animation: from cartoons to the user interface. *UIST*.
- Cockburn, A., Karlson, A., & Bederson, B. B. (2009). A review of overview+detail, zooming, and focus+context interfaces. *ACM Computing Surveys*.
- Brooks, R. (1983). Towards a theory of the comprehension of computer programs. *IJMMS*.
- Cowan, N. (2001). The magical number 4 in short-term memory. *Behavioral and Brain Sciences*.
- Furnas, G. W. (1986). Generalized fisheye views. *CHI*.
- Letovsky, S. (1987). Cognitive processes in program comprehension. *J. Systems and Software*.
- Sweller, J., Ayres, P., & Kalyuga, S. (2011). *Cognitive Load Theory*. Springer (the transient information effect).
- Legge, G. E., Rubin, G. S., & Luebker, A. (1987). Psychophysics of reading. V. The role of contrast in normal vision. *Vision Research*.
- Lisberger, S. G., Morris, E. J., & Tychsen, L. (1987). Visual motion processing and sensory-motor integration for smooth pursuit eye movements. *Annual Review of Neuroscience*.
- Matin, E. (1974). Saccadic suppression: a review and an analysis. *Psychological Bulletin*.
- Mackworth, N. H. (1948). The breakdown of vigilance during prolonged visual search. *Quarterly Journal of Experimental Psychology*.
- Mayer, R. E. (2021). *Multimedia Learning* (3rd ed.). Cambridge University Press.
- Mayer, R. E., & Chandler, P. (2001). When learning is just a click away: Does simple user interaction foster deeper understanding of multimedia messages? *J. Educational Psychology*.
- Posner, M. I. (1980). Orienting of attention. *Quarterly Journal of Experimental Psychology*.
- Pylyshyn, Z. W., & Storm, R. W. (1988). Tracking multiple independent targets. *Spatial Vision*.
- Rensink, R. A., O'Regan, J. K., & Clark, J. J. (1997). To see or not to see: The need for attention to perceive changes in scenes. *Psychological Science*.
- Sillito, J., Murphy, G. C., & De Volder, K. (2006). Questions programmers ask during software evolution tasks. *FSE*.
- Treisman, A. M., & Gelade, G. (1980). A feature-integration theory of attention. *Cognitive Psychology*.
- Tversky, B., Morrison, J. B., & Bétrancourt, M. (2002). Animation: can it facilitate? *IJHCS*.
- Woods, D. D. (1984). Visual momentum: a concept to improve the cognitive coupling of person and computer. *IJMMS*.
- Yantis, S., & Jonides, J. (1984). Abrupt visual onsets and selective attention. *J. Experimental Psychology: HPP*.
- Zacks, J. M., Speer, N. K., Swallow, K. M., Braver, T. S., & Reynolds, J. R. (2007). Event perception: a mind-brain perspective. *Psychological Bulletin*.
- Flanagan, J. R., & Johansson, R. S. (2003). Action plans used in action observation. *Nature*.
- Haggard, P. (2017). Sense of agency in the human brain. *Nature Reviews Neuroscience*.
- Jones, M. R., & Boltz, M. (1989). Dynamic attending and responses to time. *Psychological Review*.
- Kahneman, D., Treisman, A., & Gibbs, B. J. (1992). The reviewing of object files: object-specific integration of information. *Cognitive Psychology*.
- Michotte, A. (1946/1963). *The Perception of Causality*. Methuen.
- O'Regan, J. K. (1992). Solving the "real" mysteries of visual perception: the world as an outside memory. *Canadian Journal of Psychology*.
- Pashler, H. (1994). Dual-task interference in simple tasks: data and theory. *Psychological Bulletin*.
- Raymond, J. E., Shapiro, K. L., & Arnell, K. M. (1992). Temporary suppression of visual processing in an RSVP task: an attentional blink? *J. Experimental Psychology: HPP*.
- Rothkopf, E. Z. (1971). Incidental memory for location of information in text. *J. Verbal Learning and Verbal Behavior*.

## Context and language

**M28. The explorer walks the path.** Folders start closed, and only the path to the file in view is open. Picking a file is shown the way a person does it with the mouse: the pointer clicks the old file's folders closed, up to the folder both files share, then clicks the new file's folders open one by one, then clicks the file. Each folder is one 0.8 s step on the timeline: the pointer travels to the row (0.36 s), presses (0.12 s), and the folder opens or closes in the rest of the step while the selection moves onto the clicked row. The step is long enough that each opening is seen as its own event with its cause (the click) in front of it; at a third of that, the openings fused into one flicker. The compiler times the locate phase by the number of folders (`_fold`). A tree with every changed folder open is a long list in which the new file's position carries no meaning; a path that closes and opens shows where the new file is *relative to the old one* (how far up they part, how far down the new one sits), which is the spatial relation viewers use to build a map of a code base (Ko et al., 2006, on navigation as relating places). One closed tree also keeps the explorer to a handful of rows, so the spotlight competes with fewer distractors (Treisman & Gelade, 1980). Once the viewer opens or closes a folder while paused, the tree is theirs until playback resumes.
→ `shared/tree-path.ts` (`chain`, `foldMoves`, shared with the compiler), `ui/Explorer.svelte`, the locate pointer in `core/state.ts`, `FOLD_STEP` / `walkAt` / `locateMs` in `shared/timing.ts`.

**M29. The outside of the diff is shown and labelled.** An `impact` step walks the places a change reaches that the diff does not show, each with how it is connected and a verdict, lit in the verdict's colour; `meta.impact` states the reach in the overview. An unchanged file is badged *outside the diff* in the editor path and in the list, and its tab is set in italics: code next to the change must say it is not the change, or viewers attribute it to the wrong source (source monitoring; Johnson et al., 1993). Between two items of a list, the previous item stays on screen until the next is clicked, instead of the editor falling back to where the list started.
→ `ui/Stage.svelte` (`.wt-refs.impact`), `.crumbs .outside`, `case 'impact'` in `core/state.ts`, `gd-impact` in `ui/Guide.svelte`.

**M30. Words are data.** Every word the player says by itself comes from a string table by key, not from the code: English built in, other languages installed once and embedded in the page next to the IR. A viewer reads the interface in their own language, and the Korean table is written in 개조식 (note form), like the narration, so the interface and the explanation read in one register.
→ `src/i18n/`, `t()` in `core/env.ts`, `i18n/<lang>.json` at the repository root.

**M31. A frame depends on its time only.** What is on screen at time T is the same whether the viewer played into T, seeked to it, or stepped back to it: every scroll position, every row's height, every explanation's opening, and the selection are functions of the state at T, and nothing decides what to show from what the screen happened to show before. The explorer's scroll is part of the state (rows are a fixed height and which folders are open is a function of T, so a file's row and the scroll that keeps it in view are computed, not measured); its rows grow on the timeline, not on a wall-clock transition. An editor move starts where the previous target came to rest as computed from the state (a scene keeps the targets before it), never where the editor was read to be. An explanation's opening and closing depend only on the voice now, when it took its place, and the voice before it. (Before, each of these remembered what it had seen: after a seek, the explorer scrolled from a stale position and the pointer clicked a row off screen; measured on a real walkthrough, the explorer and the editor scroll differed at 6 of 8 sampled times depending on where the viewer came from. Folds that open used a wall-clock animation and were told apart by comparing with the previous frame, and the first frame after a mount measured explanations before their width was set; both are gone. Now the screen is the same at 12 of 12 times reached by playing and by seeking, at 112 of 112 times reached by seeking from far and from near, and at all 155 folder and file clicks the clicked row is on screen.) A viewer who scrubs back to look again must see what they saw; otherwise the screen stops being something they can return to (O'Regan, 1992), and the seek bar stops being trusted as a control (Haggard, 2017).
→ `core/explorer.ts` (`settleTop`, `walkTop`), `exTop` and `step()` in `core/state.ts`, `core/notes.ts` (`noteViews`), `voiceAt` in `core/voice.ts`, the scroll hook and `unfold` in `ui/Pane.svelte`, `pointedRanges` (with progress) in `core/decorate.ts`.

**M32. An explanation sits where it hides nothing and reads as one object.** When the code to the right of its line is empty for as far down as it reaches, an explanation sits on the line's own row, after its end, joined by a short leader: it reads as the line's continuation (like an end-of-line annotation) and covers no code. Otherwise it sits under the line, starting where the line's code starts, as wide as its words, with a notch pointing up at the line, so it covers as little as it can and points at what it explains (spatial contiguity; Mayer, 2021). Its bar and its tag are the same colour, the tone of the remark: a bar in one colour and a tag in another were read as two things (similarity grouping). The tag is a chip on the text's baseline; a small capital set above the baseline read as a stray mark.
→ `placeNotes` in `ui/Pane.svelte`, `.note.beside` / `.note.below` in `styles/notes.css`.

