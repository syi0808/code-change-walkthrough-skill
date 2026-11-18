// The UI string table, in English: the built-in default and the source of truth for keys.
// Other languages are JSON tables with the same keys (i18n/<lang>.json at the repository
// root), downloaded by the skill on first use and given to the engine at compile time.
// `{name}` placeholders are filled in at runtime and must be kept as they are.
export const EN = {
  // ---- compiler: names of the tour's generated scenes
  'tour.cont': '{name} (cont.)',
  'tour.question': 'What changed in {name}?',
  'tour.rest.title': 'Remaining changes',
  'tour.rest.goal': 'Every change not yet shown',

  // ---- start screen and top bar
  'start.summary': '{n} scenes · ~{time} · Space to start',
  'top.explorer': 'Explorer',
  'top.workingTree': 'working tree',
  'top.map': 'Structure map',
  'top.theme': 'Theme',
  'top.shortcuts': 'Shortcuts',
  'top.guide': 'Walkthrough panel',

  // ---- explorer
  'explorer.title': 'Explorer',
  'explorer.changedOnly': 'Show changed files only',
  'explorer.collapseAll': 'Collapse all',
  'explorer.repository': 'repository',
  'explorer.omitted': '(some files omitted)',
  'explorer.notEmbedded': 'content not embedded',

  // ---- editor panes
  'pane.empty': 'No file open',
  'pane.stub': 'File content not included',
  'pane.stubHint': 'Only files related to the change are included',
  'pane.after': 'after',
  'pane.before': 'before',
  'pane.unfold': 'Click to expand',
  'pane.hiddenLines': '{n} hidden lines',
  'pane.outside': 'Outside the diff',
  'pane.outsideHint': 'Unchanged in this change: shown for context',

  // ---- heading band (between scenes)
  'bridge.chapter': 'Chapter {n} · {title}',
  'bridge.justSaw': 'Just saw: {title}',
  'bridge.next': 'Next',

  // ---- notes
  'note.info': 'note',
  'note.why': 'why',
  'note.risk': 'risk',
  'note.tip': 'tip',

  // ---- navigation overlays
  'goto.toast': 'Go to Definition  {token} → {to}',
  'graph.title': 'Relationships',
  'graph.size': 'Expand / dock',
  'graph.close': 'Close',
  'refs.count': '{n} references',
  'pointer.click': 'Click',

  // ---- impact (what outside the diff the change reaches)
  'impact.title': 'Impact',
  'impact.summary': '{outside} outside the diff · {n} places',
  'impact.outside': 'outside the diff',
  'impact.inDiff': 'changed here',
  'impact.safe': 'unaffected',
  'impact.check': 'check',
  'impact.breaks': 'breaks',
  'impact.updated': 'updated here',

  // ---- walkthrough panel
  'guide.title': 'Walkthrough',
  'guide.changes': 'Changes {seen}/{n} hunks · {time}',
  'guide.scenes': '{n} scenes · {time}',
  'guide.overview': 'Overview',
  'guide.order': 'How this is ordered',
  'guide.impact': 'Impact outside the diff',
  'guide.goal': 'Goal',
  'guide.recap': 'Recap',
  'guide.takeaways': 'Key takeaways',
  'guide.review': 'Review checklist',
  'guide.explore': 'While paused: open files from the explorer, ⌘/Ctrl+Click to go to a definition',
  'guide.glossary': 'Glossary ({n})',

  // ---- controls
  'controls.prev': 'Previous scene',
  'controls.play': 'Play/Pause',
  'controls.next': 'Next scene',
  'controls.restart': 'Restart',
  'controls.timeline': 'Timeline',
  'controls.speed': 'Speed',
  'controls.segPause': 'Pause per scene',
  'controls.segPauseHint': 'Pause at the end of each scene (P)',
  'controls.sceneEnd': 'End of scene: Space to continue',
  'controls.hintPlay': 'play/pause',
  'controls.hintScene': 'scene',
  'controls.hintSpeed': 'speed',
  'controls.hintDefinition': 'Click: definition',
  'controls.exploring': 'Exploring: play to return to the walkthrough',

  // ---- keyboard help
  'help.title': 'Keyboard shortcuts',
  'help.play': 'Play / pause',
  'help.seek': 'Seek ±5s',
  'help.scene': 'Previous / next scene',
  'help.speed': 'Slower / faster',
  'help.segPause': 'Toggle pause per scene',
  'help.chapter': 'Jump to chapter N',
  'help.panels': 'Explorer / walkthrough panel / structure map',
  'help.definition': 'Go to definition (while paused)',
} as const;

export type Key = keyof typeof EN;
