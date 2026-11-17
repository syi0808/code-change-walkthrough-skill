# Player design rationale: motion and layout rules M1–M12

The player's visual design and animation follow rules taken from research on perception, attention, and learning. Every rule below names its basis and the place in the player that implements it. These rules govern the **engine**. The rules for planning an explanation (R1–R28) belong to the authoring skill.

## Orientation: knowing where you are

**M1. One spatial layout that stays put.** The explorer is on the left, the code in the middle, and the walkthrough on the right, and no panel ever jumps or swaps place. Viewers build a spatial map of the screen and rely on it. *Visual momentum* (Woods, 1984): the cost of each view change drops when the new view keeps landmarks from the old one.
→ `player.css` frame grid; panels collapse with a sliding transition instead of disappearing.

**M2. Overview and detail together.** The first relationship graph is shown full screen as the advance organizer. When its scene ends, it docks into the top of the walkthrough panel as a **structure map** for the rest of the walkthrough, and the node for the file in view lights up. The map never covers code. Basis: *overview+detail* interfaces (Cockburn, Karlson & Bederson, 2009), advance organizers (Ausubel, 1960), and signaling (Mayer).
→ `renderGraph` / `placeGraph`: the same element moves between `full`, `mini` (the `.gd-map` slot), and `panel`; a CSS transition animates the move. Viewers can toggle it with `M`.

**M3. Navigation is shown, not teleported.** Opening a file is a procedure:
1. The file is revealed in the explorer (folders expand, the row scrolls to the centre and is marked as being selected).
2. The cursor moves to it and clicks.
3. The tab opens and the code fades in.
4. The file's changes sweep in from top to bottom.

A jump to a definition scrolls the source token into view first, then the cursor moves to it, then the jump happens, then the target flashes. Basis: change blindness (Rensink, O'Regan & Clark, 1997), because an instant swap hides what changed. Pre-cueing (Posner, 1980) points attention at the location before the event happens there.
→ `apply('open')` uses `_openKind` (`tree`, `tab`, `same`) from the compiler; `apply('goto')`; `s.reveal`.

**M4. One thing moves at a time.** Steps run in sequence, and each step owns the screen while it runs: the cursor travels only while nothing else animates, and highlights arrive only after the file has opened. Concurrent motion splits attention, and viewers cannot track more than a few moving objects at once (Pylyshyn & Storm, 1988). Animation that is too fast or too busy is not apprehended (Tversky, Morrison & Bétrancourt, 2002).
→ The timeline lays steps out back to back (`timing.js`). `with: true` is the explicit, rarely needed exception.

**M5. Reveal things where the eye already is.** A file or line being revealed is scrolled to the **centre** of its panel, never parked at an edge. Items at the periphery are often missed, because the useful field of view shrinks under load (Ball et al., 1988, on the *useful field of view*).
→ explorer reveal (`renderExplorer`) and editor `center` / `ensure` scrolling.

## Motion quality

**M6. Natural motion.** Scrolls and cursor movement use slow-in/slow-out easing, and the cursor travels on a gentle arc. Motion that follows physical expectations is easier to follow and to predict (Chang & Ungar, 1993, *cartoon animation principles for UIs*).
→ `ease()` (cubic in-out), the arc in `renderPointer`, and `--ease` in the CSS.

**M7. Durations are long enough to perceive and short enough not to stall.** Transitions run for 250–650 ms, and actions run for 0.6–2.7 s, which is enough to track an object's path (apprehension principle; Tversky et al., 2002). Highlights sweep in line by line instead of all at once, so their extent is read as a range.
→ the `BASE` durations in `timing.js`, the highlight sweep (`h.p`), and the CSS transition times.

**M8. Words arrive with the visuals they describe.** The narration is split into items (sentences or bullets). Each item appears when the step it describes runs. The current item is emphasised, past items stay readable, and upcoming items are faint, so the layout never jumps. Basis: temporal contiguity and segmenting (Mayer, 2021). Showing the whole text at once invites reading ahead of the visuals, which splits attention.
→ `WalkTiming.cueTimes`. An author can pin an item to a step with `cue: n`; otherwise items are spread by text length over the scene's steps.

**M9. The change itself can be replayed.** `type` shows an edit happening: removed lines turn red, then the new text is typed in. Until that step runs, the edit appears not yet written. When the motion is congruent with the concept, here a change over time, animation beats static graphics (Tversky et al., 2002). Seeing a state transition prevents the viewer from missing the difference (Rensink et al., 1997).
→ `apply('type')` and the `typ-*` classes.

## Salience

**M10. Only the target is salient.** Abrupt onsets capture attention involuntarily (Yantis & Jonides, 1984), so the player keeps abrupt changes for the intended target: the flash after a jump and the cursor's click ripple. Everything else fades. While a region is in focus, the rest dims.
The explorer applies the same rule as a spotlight. The file in focus is fully visible, the folders on its path stay legible so its location stays readable, and every other row recedes instead of disappearing (*focus+context*; Furnas, 1986). Hovering over the explorer restores everything for free exploration. Marking one row in a long, dense list adds yet another salient element; dimming the rest removes the competition instead (visual search slows as similar distractors increase; Treisman & Gelade, 1980).
→ `.flash`, `.ripple`, `.dim`, the explorer `.spot` / `.path` / `.target` classes, and fades on every other change.

**M11. Diff colours stay readable under emphasis.** Highlights are drawn as a ring with an accent bar and a faint tint, never as an opaque fill, so the add/delete colours stay visible underneath. The diff palette follows GitHub so that experienced reviewers use colour meanings they already know (pre-existing schemas; Sweller's element interactivity).
→ `.row.hl::before`, and the diff tokens at the top of `player.css`.

**M12. The viewer controls the pace.** Playback pauses at the end of each scene by default. Viewers can change speed, scrub, jump to a scene, and explore freely while paused. Learner-paced segments outperform system-paced ones (Mayer & Chandler, 2001), and interactivity is the main factor that makes animation useful (Tversky et al., 2002).
→ the controls, keyboard shortcuts, and `userOps` (exploration while paused).

---

### References
- Ausubel, D. P. (1960). The use of advance organizers in the learning and retention of meaningful verbal material. *J. Educational Psychology*.
- Ball, K., Beard, B. L., Roenker, D. L., Miller, R. L., & Griggs, D. S. (1988). Age and visual search: expanding the useful field of view. *JOSA A*.
- Chang, B.-W., & Ungar, D. (1993). Animation: from cartoons to the user interface. *UIST*.
- Cockburn, A., Karlson, A., & Bederson, B. B. (2009). A review of overview+detail, zooming, and focus+context interfaces. *ACM Computing Surveys*.
- Furnas, G. W. (1986). Generalized fisheye views. *CHI*.
- Mayer, R. E. (2021). *Multimedia Learning* (3rd ed.). Cambridge University Press.
- Mayer, R. E., & Chandler, P. (2001). When learning is just a click away: Does simple user interaction foster deeper understanding of multimedia messages? *J. Educational Psychology*.
- Posner, M. I. (1980). Orienting of attention. *Quarterly Journal of Experimental Psychology*.
- Pylyshyn, Z. W., & Storm, R. W. (1988). Tracking multiple independent targets. *Spatial Vision*.
- Rensink, R. A., O'Regan, J. K., & Clark, J. J. (1997). To see or not to see: The need for attention to perceive changes in scenes. *Psychological Science*.
- Treisman, A. M., & Gelade, G. (1980). A feature-integration theory of attention. *Cognitive Psychology*.
- Tversky, B., Morrison, J. B., & Bétrancourt, M. (2002). Animation: can it facilitate? *IJHCS*.
- Woods, D. D. (1984). Visual momentum: a concept to improve the cognitive coupling of person and computer. *IJMMS*.
- Yantis, S., & Jonides, J. (1984). Abrupt visual onsets and selective attention. *J. Experimental Psychology: HPP*.
