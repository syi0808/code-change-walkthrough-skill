#!/usr/bin/env node
// Creates a tiny TypeScript repo whose last commit adds retry-with-backoff,
// matching examples/retry/walkthrough.json. Cross-platform (Node + git only).
//   node make-demo-repo.mjs <dir>
//   node ../../bin/code-walkthrough.mjs build walkthrough.json --repo <dir> -o demo.html
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = process.argv[2];
if (!dir) { console.error('usage: node make-demo-repo.mjs <dir>'); process.exit(2); }
const D = path.resolve(dir);
fs.rmSync(D, { recursive: true, force: true });
fs.mkdirSync(D, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: D, stdio: ['ignore', 'ignore', 'inherit'] });
const write = (p, text) => { fs.mkdirSync(path.join(D, path.dirname(p)), { recursive: true }); fs.writeFileSync(path.join(D, p), text); };
git('init', '-q');
git('config', 'user.email', 'demo@example.com');
git('config', 'user.name', 'demo');
git('config', 'core.autocrlf', 'false');

const STEPS = [
 [
  "file",
  "src/api/client.ts",
  "import { config } from '../config';\n\nexport interface RequestOptions {\n  method?: string;\n  body?: unknown;\n}\n\nexport async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {\n  const res = await fetch(config.baseUrl + path, {\n    method: opts.method ?? 'GET',\n    body: opts.body ? JSON.stringify(opts.body) : undefined,\n  });\n  if (!res.ok) {\n    throw new Error(`Request failed: ${res.status}`);\n  }\n  return (await res.json()) as T;\n}\n"
 ],
 [
  "file",
  "src/config.ts",
  "export const config = {\n  baseUrl: process.env.API_URL ?? 'http://localhost:3000',\n  timeoutMs: 5000,\n};\n"
 ],
 [
  "file",
  "src/users/service.ts",
  "import { request } from '../api/client';\n\nexport interface User {\n  id: string;\n  name: string;\n}\n\nexport async function fetchUser(id: string): Promise<User> {\n  return request<User>(`/users/${id}`);\n}\n\nexport async function renameUser(id: string, name: string): Promise<User> {\n  return request<User>(`/users/${id}`, { method: 'PATCH', body: { name } });\n}\n"
 ],
 [
  "file",
  "src/users/profile.ts",
  "import { fetchUser } from './service';\n\nexport async function loadProfile(id: string) {\n  const user = await fetchUser(id);\n  return { title: user.name, id: user.id };\n}\n"
 ],
 [
  "file",
  "test/service.test.ts",
  "import { fetchUser } from '../src/users/service';\n\ntest('fetchUser returns a user', async () => {\n  const u = await fetchUser('1');\n  expect(u.id).toBe('1');\n});\n"
 ],
 [
  "commit",
  "initial"
 ],
 [
  "file",
  "src/api/retry.ts",
  "export interface RetryPolicy {\n  retries: number;\n  baseDelayMs: number;\n}\n\nconst sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));\n\n/** Retries `fn` on transient failures with exponential backoff. */\nexport async function withRetry<T>(fn: () => Promise<T>, policy: RetryPolicy): Promise<T> {\n  let attempt = 0;\n  for (;;) {\n    try {\n      return await fn();\n    } catch (err) {\n      if (!isTransient(err) || attempt >= policy.retries) throw err;\n      await sleep(policy.baseDelayMs * 2 ** attempt);\n      attempt++;\n    }\n  }\n}\n\nexport function isTransient(err: unknown): boolean {\n  return err instanceof HttpError && (err.status >= 500 || err.status === 429);\n}\n\nexport class HttpError extends Error {\n  constructor(public status: number) {\n    super(`Request failed: ${status}`);\n  }\n}\n"
 ],
 [
  "file",
  "src/api/client.ts",
  "import { config } from '../config';\nimport { HttpError, withRetry } from './retry';\n\nexport interface RequestOptions {\n  method?: string;\n  body?: unknown;\n  idempotent?: boolean;\n}\n\nexport async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {\n  const method = opts.method ?? 'GET';\n  const send = async () => {\n    const res = await fetch(config.baseUrl + path, {\n      method,\n      body: opts.body ? JSON.stringify(opts.body) : undefined,\n    });\n    if (!res.ok) {\n      throw new HttpError(res.status);\n    }\n    return (await res.json()) as T;\n  };\n  const idempotent = opts.idempotent ?? method === 'GET';\n  return idempotent ? withRetry(send, config.retry) : send();\n}\n"
 ],
 [
  "file",
  "src/config.ts",
  "export const config = {\n  baseUrl: process.env.API_URL ?? 'http://localhost:3000',\n  timeoutMs: 5000,\n  retry: { retries: 3, baseDelayMs: 200 },\n};\n"
 ],
 [
  "file",
  "test/retry.test.ts",
  "import { HttpError, withRetry } from '../src/api/retry';\n\ntest('retries transient errors', async () => {\n  let calls = 0;\n  const v = await withRetry(async () => {\n    if (++calls < 3) throw new HttpError(503);\n    return 'ok';\n  }, { retries: 3, baseDelayMs: 0 });\n  expect(v).toBe('ok');\n  expect(calls).toBe(3);\n});\n\ntest('does not retry 4xx', async () => {\n  await expect(withRetry(async () => { throw new HttpError(404); }, { retries: 3, baseDelayMs: 0 })).rejects.toThrow();\n});\n"
 ],
 [
  "commit",
  "feat(api): retry idempotent requests with exponential backoff"
 ]
];

for (const [kind, a, b] of STEPS) {
  if (kind === 'file') write(a, b);
  else { git('add', '-A'); git('commit', '-qm', a); }
}
console.log(`demo repo ready: ${D}`);
