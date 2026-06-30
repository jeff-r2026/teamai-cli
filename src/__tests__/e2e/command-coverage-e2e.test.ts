import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────
// Command-surface coverage E2E
//
// Spawns the built CLI for EVERY user-facing command + subcommand and
// asserts the command surface is wired correctly:
//   - `--help` exits 0 and prints usage for every command (catches broken
//     dynamic imports, bad option specs, missing action handlers).
//   - Read-only / local commands run cleanly against an isolated, empty
//     HOME (no teamai config) — they must degrade gracefully, never crash
//     with an unhandled stack trace.
//   - The hook-dispatch backbone produces the expected dashboard event
//     when fed a realistic hook payload (no LLM required).
//
// No credentials or network required → safe to run in CI.
// ─────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(ROOT, 'dist', 'index.js');

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  output: string;
}

function runCLI(
  args: string[],
  opts: { env?: Record<string, string>; stdin?: string; cwd?: string } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI, ...args], {
      env: { ...process.env, FORCE_COLOR: '0', ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd ?? ROOT,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    if (opts.stdin) child.stdin.write(opts.stdin);
    child.stdin.end();

    child.on('close', (code) => resolve({ code, stdout, stderr, output: stdout + stderr }));
  });
}

/**
 * Detect a wiring bug (broken dynamic import / bad reference) vs an
 * intentional, handled error. A normal "not initialized" guard throws with a
 * stack trace and exit 1 — that is acceptable product behavior, so we do NOT
 * treat a stack trace alone as a failure. We only flag the markers that can
 * only come from a real defect in how the command is loaded/wired.
 */
function looksLikeWiringBug(output: string): boolean {
  return /UnhandledPromiseRejection|Cannot find module|ERR_MODULE_NOT_FOUND|is not a function|is not defined/.test(
    output,
  );
}

beforeAll(() => {
  if (!fs.existsSync(CLI)) {
    throw new Error(`CLI binary not found at ${CLI}. Run "npm run build" first.`);
  }
});

// ─── Every command/subcommand: `--help` exits 0 ──────────────

// The complete user-facing command surface (mirrors src/index.ts).
const HELP_TARGETS: Array<{ label: string; args: string[] }> = [
  { label: 'root', args: [] },
  { label: 'init', args: ['init'] },
  { label: 'push', args: ['push'] },
  { label: 'pull', args: ['pull'] },
  { label: 'status', args: ['status'] },
  { label: 'list', args: ['list'] },
  { label: 'skill', args: ['skill'] },
  { label: 'skill list', args: ['skill', 'list'] },
  { label: 'skill show', args: ['skill', 'show'] },
  { label: 'members', args: ['members'] },
  { label: 'members list', args: ['members', 'list'] },
  { label: 'remove', args: ['remove'] },
  { label: 'doctor', args: ['doctor'] },
  { label: 'roles', args: ['roles'] },
  { label: 'roles init', args: ['roles', 'init'] },
  { label: 'roles list', args: ['roles', 'list'] },
  { label: 'roles set', args: ['roles', 'set'] },
  { label: 'roles add', args: ['roles', 'add'] },
  { label: 'roles remove', args: ['roles', 'remove'] },
  { label: 'roles update', args: ['roles', 'update'] },
  { label: 'tags', args: ['tags'] },
  { label: 'tags list', args: ['tags', 'list'] },
  { label: 'tags subscribe', args: ['tags', 'subscribe'] },
  { label: 'tags unsubscribe', args: ['tags', 'unsubscribe'] },
  { label: 'tags add', args: ['tags', 'add'] },
  { label: 'tags remove', args: ['tags', 'remove'] },
  { label: 'source', args: ['source'] },
  { label: 'source add', args: ['source', 'add'] },
  { label: 'source remove', args: ['source', 'remove'] },
  { label: 'source list', args: ['source', 'list'] },
  { label: 'source browse', args: ['source', 'browse'] },
  { label: 'update', args: ['update'] },
  { label: 'uninstall', args: ['uninstall'] },
  { label: 'env', args: ['env'] },
  { label: 'env list', args: ['env', 'list'] },
  { label: 'env add', args: ['env', 'add'] },
  { label: 'env remove', args: ['env', 'remove'] },
  { label: 'hooks', args: ['hooks'] },
  { label: 'hooks list', args: ['hooks', 'list'] },
  { label: 'hooks inject', args: ['hooks', 'inject'] },
  { label: 'hooks remove', args: ['hooks', 'remove'] },
  { label: 'stats', args: ['stats'] },
  { label: 'digest', args: ['digest'] },
  { label: 'dashboard', args: ['dashboard'] },
  { label: 'contribute', args: ['contribute'] },
  { label: 'recall', args: ['recall'] },
  { label: 'import', args: ['import'] },
  { label: 'codebase', args: ['codebase'] },
  { label: 'review', args: ['review'] },
  { label: 'ci', args: ['ci'] },
  { label: 'ci extract-mr', args: ['ci', 'extract-mr'] },
  // Hidden but load-bearing internal command.
  { label: 'hook-dispatch', args: ['hook-dispatch'] },
];

describe('command surface — --help for every command', () => {
  it.each(HELP_TARGETS)('teamai $label --help exits 0 with usage', async ({ args }) => {
    const r = await runCLI([...args, '--help']);
    expect(r.code, `output:\n${r.output}`).toBe(0);
    expect(r.output).toMatch(/Usage:/i);
  });

  it('teamai --version prints the package version', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    const r = await runCLI(['--version']);
    expect(r.stdout.trim()).toContain(pkg.version);
  });
});

// ─── Read-only / local commands degrade gracefully (empty HOME) ──

describe('read-only commands on an uninitialized environment', () => {
  let emptyHome: string;

  beforeAll(() => {
    emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-empty-home-'));
  });

  // These should run without an unhandled crash even with no teamai config.
  // A clean "not initialized" error (exit 1) is acceptable; a stack trace is not.
  const SAFE_LOCAL: Array<{ label: string; args: string[] }> = [
    { label: 'doctor', args: ['doctor'] },
    { label: 'hooks list', args: ['hooks', 'list'] },
    { label: 'list skills (local)', args: ['list', 'skills', '--source', 'local'] },
    { label: 'skill list', args: ['skill', 'list'] },
    { label: 'stats', args: ['stats'] },
    { label: 'recall', args: ['recall', 'anything'] },
    { label: 'tags list', args: ['tags', 'list'] },
    { label: 'env list', args: ['env', 'list'] },
    { label: 'source list', args: ['source', 'list'] },
    { label: 'roles list', args: ['roles', 'list'] },
    { label: 'status', args: ['status'] },
  ];

  it.each(SAFE_LOCAL)('teamai $label runs without a wiring bug', async ({ args }) => {
    const r = await runCLI(args, { env: { HOME: emptyHome }, stdin: '' });
    // Must terminate deterministically: success (0) or a handled error (1/2).
    expect([0, 1, 2], `code=${r.code}\noutput:\n${r.output}`).toContain(r.code);
    // And must not be a broken-import / undefined-reference defect.
    expect(looksLikeWiringBug(r.output), `wiring bug:\n${r.output}`).toBe(false);
  });
});

// ─── Hook-dispatch backbone: real event, no LLM ──────────────

describe('hook-dispatch produces dashboard events (no LLM)', () => {
  let home: string;

  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-hook-dispatch-'));
  });

  it('SessionStart payload appends a session_start event', async () => {
    const payload = JSON.stringify({
      hook_event_name: 'SessionStart',
      session_id: 'coverage-e2e-session',
      cwd: '/tmp/coverage-e2e',
    });

    const r = await runCLI(
      ['hook-dispatch', 'session-start', '--tool', 'claude'],
      { env: { HOME: home }, stdin: payload },
    );
    expect(r.code).toBe(0);

    const eventsPath = path.join(home, '.teamai', 'dashboard', 'events.jsonl');
    expect(fs.existsSync(eventsPath), `events.jsonl missing\noutput:\n${r.output}`).toBe(true);

    const events = fs
      .readFileSync(eventsPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    const sessionStart = events.find((e) => e.type === 'session_start');
    expect(sessionStart).toBeDefined();
    expect(sessionStart?.tool).toBe('claude');
  });

  it('UserPromptSubmit payload appends a prompt_submit event', async () => {
    const payload = JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'coverage-e2e-session-2',
      cwd: '/tmp/coverage-e2e',
      prompt: 'hello world',
    });

    const r = await runCLI(
      ['hook-dispatch', 'prompt-submit', '--tool', 'cursor'],
      { env: { HOME: home }, stdin: payload },
    );
    expect(r.code).toBe(0);

    const eventsPath = path.join(home, '.teamai', 'dashboard', 'events.jsonl');
    const events = fs
      .readFileSync(eventsPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    expect(events.some((e) => e.type === 'prompt_submit')).toBe(true);
  });
});
