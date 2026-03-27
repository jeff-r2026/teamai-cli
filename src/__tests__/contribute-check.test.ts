import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readContributeState,
  writeContributeState,
  computeSmartScore,
} from '../contribute-check.js';
import type { ContributeState, DashboardEvent } from '../types.js';

// ─── Test helpers ──────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-contribute-test-'));
}

function makeEvent(overrides: Partial<DashboardEvent> = {}): DashboardEvent {
  return {
    type: 'tool_use',
    timestamp: new Date().toISOString(),
    sessionId: 'test-session-123',
    tool: 'claude',
    ...overrides,
  };
}

// ─── contributeState read/write (per-session files) ─────────

describe('contributeState', () => {
  let tmpDir: string;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('two sessions read/write without interfering', async () => {
    // Session A writes
    const stateA: ContributeState = {
      toolCount: 50,
      evaluated: false,
      contributed: false,
    };
    await writeContributeState('session-aaa', stateA);

    // Session B writes
    const stateB: ContributeState = {
      toolCount: 10,
      evaluated: false,
      contributed: false,
    };
    await writeContributeState('session-bbb', stateB);

    // Session A reads back its own state, unaffected by B
    const readA = await readContributeState('session-aaa');
    expect(readA.toolCount).toBe(50);

    // Session B reads back its own state, unaffected by A
    const readB = await readContributeState('session-bbb');
    expect(readB.toolCount).toBe(10);
  });

  it('returns defaults when session file does not exist', async () => {
    const state = await readContributeState('nonexistent-session');
    expect(state).toEqual({
      toolCount: 0,
      evaluated: false,
      contributed: false,
    });
  });

  it('returns defaults when session file contains corrupted JSON', async () => {
    const sessionsDir = path.join(tmpDir, '.teamai', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'broken-session.json'), '{not valid!!!}', 'utf-8');

    const state = await readContributeState('broken-session');
    expect(state).toEqual({
      toolCount: 0,
      evaluated: false,
      contributed: false,
    });
  });

  it('cleans up session files older than 24 hours on write', async () => {
    const sessionsDir = path.join(tmpDir, '.teamai', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    // Create an old session file with mtime 25 hours ago
    const oldFile = path.join(sessionsDir, 'old-session.json');
    fs.writeFileSync(oldFile, JSON.stringify({ toolCount: 5, evaluated: false, contributed: false }));
    const pastTime = Date.now() - 25 * 60 * 60 * 1000;
    fs.utimesSync(oldFile, new Date(pastTime), new Date(pastTime));

    // Create a recent session file
    const recentFile = path.join(sessionsDir, 'recent-session.json');
    fs.writeFileSync(recentFile, JSON.stringify({ toolCount: 3, evaluated: false, contributed: false }));

    // Writing a new session triggers cleanup
    await writeContributeState('new-session', { toolCount: 1, evaluated: false, contributed: false });

    // Old file should be gone
    expect(fs.existsSync(oldFile)).toBe(false);
    // Recent file should still exist
    expect(fs.existsSync(recentFile)).toBe(true);
    // New file should exist
    expect(fs.existsSync(path.join(sessionsDir, 'new-session.json'))).toBe(true);
  });
});

// ─── computeSmartScore ─────────────────────────────────────

describe('computeSmartScore', () => {
  it('returns 0 for empty events', () => {
    expect(computeSmartScore([])).toBe(0);
  });

  it('scores low for single-tool repetitive session', () => {
    // 100 calls of the same tool — low diversity
    const events = Array.from({ length: 100 }, () =>
      makeEvent({ toolName: 'Bash' }),
    );
    const score = computeSmartScore(events);
    // diversity: 1/20 * 30 = 1.5 → round to 2
    // No skills, no errors, no duration
    expect(score).toBeLessThan(30);
  });

  it('scores high for diverse session with skills and errors', () => {
    const now = Date.now();
    const events: DashboardEvent[] = [
      // 40 min ago
      makeEvent({ toolName: 'Read', timestamp: new Date(now - 40 * 60 * 1000).toISOString() }),
      makeEvent({ toolName: 'Edit', timestamp: new Date(now - 35 * 60 * 1000).toISOString() }),
      makeEvent({ toolName: 'Bash', timestamp: new Date(now - 30 * 60 * 1000).toISOString() }),
      makeEvent({ toolName: 'Skill', timestamp: new Date(now - 25 * 60 * 1000).toISOString() }),
      makeEvent({ toolName: 'Write', timestamp: new Date(now - 20 * 60 * 1000).toISOString() }),
      makeEvent({ toolName: 'Grep', timestamp: new Date(now - 15 * 60 * 1000).toISOString() }),
      makeEvent({ toolName: 'Agent', timestamp: new Date(now - 10 * 60 * 1000).toISOString() }),
      // Error in prompt
      makeEvent({
        type: 'prompt_submit',
        promptSummary: 'fix the build error',
        timestamp: new Date(now - 5 * 60 * 1000).toISOString(),
      }),
      // Recent
      makeEvent({ toolName: 'Edit', timestamp: new Date(now).toISOString() }),
    ];

    const score = computeSmartScore(events);
    // diversity: high (7 unique / 8 tool_use = 0.875 → 26)
    // hasSkills: +25
    // hasErrors: +25
    // duration > 30 min: +20
    // Total: ~96
    expect(score).toBeGreaterThanOrEqual(60);
  });

  it('gives 25 points for skill usage', () => {
    const base = [
      makeEvent({ toolName: 'Bash' }),
      makeEvent({ toolName: 'Read' }),
    ];
    const withSkill = [
      ...base,
      makeEvent({ toolName: 'Skill' }),
    ];

    const scoreBase = computeSmartScore(base);
    const scoreWithSkill = computeSmartScore(withSkill);
    expect(scoreWithSkill - scoreBase).toBeGreaterThanOrEqual(20); // ~25 but diversity changes too
  });

  it('detects error keywords in prompts', () => {
    const events: DashboardEvent[] = [
      makeEvent({ toolName: 'Bash' }),
      makeEvent({
        type: 'prompt_submit',
        promptSummary: 'there was an error in the build',
      }),
    ];
    const score = computeSmartScore(events);
    // error: +25, some diversity points
    expect(score).toBeGreaterThanOrEqual(25);
  });

  it('gives 20 points for long sessions', () => {
    const now = Date.now();
    const events: DashboardEvent[] = [
      makeEvent({ toolName: 'Bash', timestamp: new Date(now - 60 * 60 * 1000).toISOString() }),
      makeEvent({ toolName: 'Bash', timestamp: new Date(now).toISOString() }),
    ];
    const score = computeSmartScore(events);
    // 1 unique tool / 2 calls → diversity low
    // duration > 30 min → +20
    expect(score).toBeGreaterThanOrEqual(20);
  });
});
