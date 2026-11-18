// Walkthrough IR v1 (docs/ir-v1.md). Authoring fields are what an author writes;
// fields starting with "_" are added by the compiler and only read by the player.

export type Side = 'before' | 'after';
export type View = 'after' | 'before' | 'diff';
export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied' | 'context';
export type Tone = 'focus' | 'info' | 'add' | 'remove' | 'warn' | 'why' | 'risk' | 'tip' | string;
export type Tempo = 'key' | 'normal' | 'skim';
export type ReplayMode = 'type' | 'lines' | 'block';
export type OpenKind = 'tree' | 'tab' | 'same';

export interface LineRange { side: Side; from: number; to: number }

export interface AnchorObject {
  side?: Side;
  line?: number;
  span?: number;
  lines?: [number, number?];
  find?: string;
  regex?: string;
  nth?: number;
  block?: boolean;
  symbol?: string;
  head?: boolean;
  hunk?: number;
}
export type Anchor = number | [number, number?] | AnchorObject;

export interface IRFile {
  status?: FileStatus;
  oldPath?: string;
  language?: string;
  before?: string | null;
  after?: string | null;
  role?: string;
  unnarrated?: boolean;
}

export interface GraphNode { id: string; label?: string; sub?: string; file?: string; status?: string }
export interface GraphEdge { from: string; to: string; label?: string; style?: 'solid' | 'dashed' }

export interface DiffSettings {
  mode: 'unified' | 'split';
  algorithm: 'myers' | 'patience';
  granularity: 'line' | 'word';
  context: number | null;
  whitespace: 'collapse' | 'show';
}

export interface RefItem { file: string; view: View; side: Side; line: number; label: string | null; text: string; effect?: Effect; relation?: string; outside?: boolean }

export type Action =
  | 'open' | 'layout' | 'diffView' | 'reveal' | 'highlight' | 'focus' | 'unfocus' | 'note'
  | 'type' | 'replay' | 'goto' | 'refs' | 'impact' | 'graph' | 'say' | 'wait' | 'clear' | 'close';

/** What a change does to a place that depends on it: still fine, needs a look, broken, or changed along with it. */
export type Effect = 'safe' | 'check' | 'breaks' | 'updated';

export interface Step {
  do: Action;
  pane?: number;
  file?: string;
  view?: View;
  ms?: number;
  with?: boolean;
  hold?: number;
  cue?: number;
  at?: Anchor;
  range?: Anchor;
  text?: string;
  tone?: Tone;
  label?: string;
  align?: 'center' | 'top';
  reveal?: boolean;
  mode?: string;
  algorithm?: DiffSettings['algorithm'];
  granularity?: DiffSettings['granularity'];
  context?: number | null;
  whitespace?: DiffSettings['whitespace'];
  diff?: Partial<DiffSettings>;
  from?: { file?: string; at?: Anchor; token?: string; view?: View };
  to?: { file?: string; at?: Anchor; pane?: number; view?: View };
  items?: { file: string; at?: Anchor; label?: string; view?: View; effect?: Effect; relation?: string }[];
  /** impact: the contract that changed, in a few words. */
  change?: string;
  symbol?: string;
  title?: string;
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  highlight?: string[];
  size?: 'full' | 'panel';
  pin?: boolean;
  hide?: boolean;
  unpin?: boolean;
  hunk?: number;
  tempo?: Tempo;
  noReveal?: boolean;
  fast?: boolean;

  // ---- added by the compiler
  _openKind?: OpenKind;
  /** Explorer folders closed and opened on the way to a file picked from the tree (see shared/tree-path). */
  _fold?: number;
  _reveal?: boolean;
  _r?: LineRange | null;
  _first?: LineRange;
  _file?: string;
  _pane?: number;
  _view?: View;
  _chars?: number;
  _dels?: number;
  _lines?: number;
  _mode?: ReplayMode;
  _from?: { file: string; side?: Side; line?: number; to?: number };
  _to?: { file: string; pane: number; view: View; side?: Side; line?: number; from?: number; to?: number };
  _items?: RefItem[];

  // ---- added by the timing model (player and compiler share it)
  _dp?: number;
  /** The narration item this step brings in: `cue`, or one inferred for an unpinned item (see inferCues). */
  _cue?: number;
  _id?: number;
  _start?: number;
}

export interface TourInfo { file: string; hunks: number[]; of: number }

export interface Scene {
  id?: string;
  title?: string;
  goal?: string;
  narration?: string;
  question?: string;
  bridge?: string;
  at?: { file: string; hunk?: number };
  steps?: Step[];
  auto?: boolean;
  tour?: TourInfo;
}

export interface Chapter { id?: string; title?: string; goal?: string; scenes?: Scene[] }

export interface TourConfig {
  order?: string[];
  tempo?: Record<string, Tempo>;
  questions?: Record<string, string>;
}

export interface Meta {
  title?: string;
  summary?: string;
  intent?: string;
  language?: string;
  audience?: string;
  strategy?: { order?: string; rationale?: string };
  takeaways?: string[];
  reviewFocus?: string[];
  /** What outside the diff the change reaches (callers, data, config, other services), and how. */
  impact?: ImpactNote[];
}

export interface ImpactNote { text: string; effect?: Effect; files?: string[] }

export interface Source {
  repo?: string;
  range?: string;
  base?: string;
  head?: string;
  baseSha?: string;
  headSha?: string;
}

export interface Tree { root: string; dirs: string[]; files: [number, string][]; partial: string[]; total: number }

export interface Walkthrough {
  $schema?: string;
  version: number;
  meta?: Meta;
  source?: Source;
  files: Record<string, IRFile>;
  chapters: Chapter[];
  glossary?: { term: string; definition: string }[];
  tour?: false | TourConfig;
  tree?: Tree;
  tourStats?: { hunks: number; files: number };
  compiled?: { engineIrVersion: number; at: string };
}

export interface Diagnostic { path: string; message: string }
