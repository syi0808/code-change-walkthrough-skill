// Modules the build provides (scripts/build.mjs): the compiled player and the docs,
// inlined as strings so the bundled CLI is a single self-contained file.
declare module 'virtual:player' {
  /** HTML shell with {{TITLE}}, {{CSS}}, {{JS}}, {{IR}} placeholders. */
  export const template: string;
  /** Minified player stylesheet. */
  export const css: string;
  /** Minified player script (an IIFE). */
  export const js: string;
}
declare module 'virtual:docs' {
  export const spec: string;
  export const schema: string;
  export const version: string;
}

/** Stylesheets imported for bundling. */
declare module '*.css';
