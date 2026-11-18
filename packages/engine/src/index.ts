// Library entry: compile IR, render the standalone player, serve it, and collect change context.
export { compile, compileFile, IR_VERSION } from './compile/index.ts';
export type { CompileOptions, CompileResult, CompileStats, ResolvedAnchor } from './compile/index.ts';
export { render } from './render/render.ts';
export { serve } from './serve/serve.ts';
export type { ServeOptions, Server } from './serve/serve.ts';
export { collect, digest } from './analyze/collect.ts';
export type { ChangeContext, CollectOptions } from './analyze/collect.ts';
export type * from './ir/types.ts';
