import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fse from 'fs-extra';

vi.mock('../utils/logger.js', () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    dim: vi.fn(),
  },
}));

import {
  isValidSkillName,
  appendUsageEvent,
  readUsageEvents,
  truncateUsageAfterReport,
  track,
} from '../usage-tracker.js';
import { aggregateUsage } from '../stats.js';
import { evaluateSessionValue } from '../session-collector.js';
import { calculateSkillHealth, scoreToStars, calculateTeamHealth } from '../skill-health.js';
import { getRecommendations } from '../skill-recommend.js';
import type { UsageEvent, UserStats } from '../types.js';

// ─── Test helpers ──────────────────────────────────────

let tmpDir: string;
const origHome = process.env.HOME;

beforeEach(async () => {
  tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-test-'));
  process.env.HOME = tmpDir;
});

afterEach(async () => {
  process.env.HOME = origHome;
  await fse.remove(tmpDir);
});

// ─── usage-tracker tests ───────────────────────────────

describe('isValidSkillName', () => {
  it('accepts valid skill names', () => {
    expect(isValidSkillName('code-review')).toBe(true);
    expect(isValidSkillName('tdd')).toBe(true);
    expect(isValidSkillName('plan-eng-review')).toBe(true);
    expect(isValidSkillName('everything-claude-code:tdd')).toBe(true);
    expect(isValidSkillName('my_skill.v2')).toBe(true);
  });

  it('rejects path traversal attempts', () => {
    expect(isValidSkillName('../../etc/passwd')).toBe(false);
    expect(isValidSkillName('../secret')).toBe(false);
    expect(isValidSkillName('skill/../../etc')).toBe(false);
  });

  it('rejects empty and overly long names', () => {
    expect(isValidSkillName('')).toBe(false);
    expect(isValidSkillName('a'.repeat(201))).toBe(false);
  });

  it('rejects names with special characters', () => {
    expect(isValidSkillName('skill name')).toBe(false);
    expect(isValidSkillName('skill\n')).toBe(false);
    expect(isValidSkillName('<script>')).toBe(false);
  });
});

describe('appendUsageEvent', () => {
  it('appends a valid event to JSONL', async () => {
    const event: UsageEvent = {
      skill: 'code-review',
      timestamp: '2026-03-19T10:30:00Z',
      tool: 'claude',
    };
    await appendUsageEvent(event);

    const usagePath = path.join(tmpDir, '.teamai', 'usage.jsonl');
    const content = await fs.promises.readFile(usagePath, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.skill).toBe('code-review');
    expect(parsed.timestamp).toBe('2026-03-19T10:30:00Z');
  });

  it('appends multiple events as separate lines', async () => {
    await appendUsageEvent({ skill: 'tdd', timestamp: '2026-03-19T10:00:00Z', tool: 'claude' });
    await appendUsageEvent({ skill: 'code-review', timestamp: '2026-03-19T11:00:00Z', tool: 'claude' });

    const events = await readUsageEvents();
    expect(events).toHaveLength(2);
    expect(events[0].skill).toBe('tdd');
    expect(events[1].skill).toBe('code-review');
  });
});

describe('readUsageEvents', () => {
  it('returns empty array for missing file', async () => {
    const events = await readUsageEvents();
    expect(events).toEqual([]);
  });

  it('skips corrupted JSONL lines', async () => {
    const usagePath = path.join(tmpDir, '.teamai', 'usage.jsonl');
    await fse.ensureDir(path.dirname(usagePath));
    await fs.promises.writeFile(
      usagePath,
      '{"skill":"good","timestamp":"2026-01-01T00:00:00Z","tool":"claude"}\nNOT_JSON\n{"skill":"also-good","timestamp":"2026-01-02T00:00:00Z","tool":"claude"}\n',
    );

    const events = await readUsageEvents();
    expect(events).toHaveLength(2);
    expect(events[0].skill).toBe('good');
    expect(events[1].skill).toBe('also-good');
  });

  it('handles empty file', async () => {
    const usagePath = path.join(tmpDir, '.teamai', 'usage.jsonl');
    await fse.ensureDir(path.dirname(usagePath));
    await fs.promises.writeFile(usagePath, '');

    const events = await readUsageEvents();
    expect(events).toEqual([]);
  });
});

describe('truncateUsageAfterReport', () => {
  it('clears file when all events reported', async () => {
    await appendUsageEvent({ skill: 'a', timestamp: '2026-01-01T00:00:00Z', tool: 'claude' });
    await appendUsageEvent({ skill: 'b', timestamp: '2026-01-02T00:00:00Z', tool: 'claude' });

    await truncateUsageAfterReport(2);

    const events = await readUsageEvents();
    expect(events).toEqual([]);
  });

  it('keeps unreported events', async () => {
    await appendUsageEvent({ skill: 'a', timestamp: '2026-01-01T00:00:00Z', tool: 'claude' });
    await appendUsageEvent({ skill: 'b', timestamp: '2026-01-02T00:00:00Z', tool: 'claude' });
    await appendUsageEvent({ skill: 'c', timestamp: '2026-01-03T00:00:00Z', tool: 'claude' });

    await truncateUsageAfterReport(2);

    const events = await readUsageEvents();
    expect(events).toHaveLength(1);
    expect(events[0].skill).toBe('c');
  });
});

describe('track', () => {
  it('tracks Skill tool calls', async () => {
    await track('Skill', JSON.stringify({ skill: 'code-review' }));

    const events = await readUsageEvents();
    expect(events).toHaveLength(1);
    expect(events[0].skill).toBe('code-review');
  });

  it('ignores non-Skill tool calls', async () => {
    await track('Bash', JSON.stringify({ command: 'ls' }));
    await track('Read', JSON.stringify({ path: '/tmp' }));

    const events = await readUsageEvents();
    expect(events).toEqual([]);
  });

  it('ignores invalid skill names', async () => {
    await track('Skill', JSON.stringify({ skill: '../../etc/passwd' }));

    const events = await readUsageEvents();
    expect(events).toEqual([]);
  });

  it('handles malformed JSON input', async () => {
    await track('Skill', 'not-json');

    const events = await readUsageEvents();
    expect(events).toEqual([]);
  });
});

// ─── stats tests ───────────────────────────────────────

describe('aggregateUsage', () => {
  it('aggregates events by skill', () => {
    const events: UsageEvent[] = [
      { skill: 'tdd', timestamp: '2026-03-19T10:00:00Z', tool: 'claude' },
      { skill: 'code-review', timestamp: '2026-03-19T11:00:00Z', tool: 'claude' },
      { skill: 'tdd', timestamp: '2026-03-19T12:00:00Z', tool: 'claude' },
    ];

    const stats = aggregateUsage(events);
    expect(stats).toHaveLength(2);
    expect(stats[0].name).toBe('tdd');
    expect(stats[0].count).toBe(2);
    expect(stats[1].name).toBe('code-review');
    expect(stats[1].count).toBe(1);
  });

  it('returns empty for no events', () => {
    expect(aggregateUsage([])).toEqual([]);
  });
});

// ─── session-collector tests ───────────────────────────

describe('evaluateSessionValue', () => {
  it('marks sessions with errors as valuable', () => {
    expect(evaluateSessionValue('Encountered an error when running tests')).toBe(true);
    expect(evaluateSessionValue('Had to retry the build 3 times')).toBe(true);
    expect(evaluateSessionValue('发现一个新的踩坑模式')).toBe(true);
  });

  it('marks routine sessions as not valuable', () => {
    expect(evaluateSessionValue('Updated README formatting')).toBe(false);
    expect(evaluateSessionValue('Added a new component')).toBe(false);
  });
});

// ─── skill-health tests ───────────────────────────────

describe('calculateSkillHealth', () => {
  it('returns 0 for unused skills', () => {
    expect(calculateSkillHealth(0, new Date(), 10)).toBe(0);
  });

  it('returns 0 when maxCount is 0', () => {
    expect(calculateSkillHealth(5, new Date(), 0)).toBe(0);
  });

  it('returns high score for frequently used, recent skills', () => {
    const score = calculateSkillHealth(100, new Date(), 100);
    expect(score).toBeGreaterThan(80);
  });

  it('returns lower score for stale skills', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const score = calculateSkillHealth(100, thirtyDaysAgo, 100);
    expect(score).toBeLessThanOrEqual(60); // Only usage score, no freshness
  });
});

describe('scoreToStars', () => {
  it('converts score to star rating', () => {
    expect(scoreToStars(100)).toBe('★★★★★');
    expect(scoreToStars(0)).toBe('☆☆☆☆☆');
    expect(scoreToStars(50)).toBe('★★★☆☆');
  });
});

describe('calculateTeamHealth', () => {
  it('aggregates stats across users', () => {
    const stats: UserStats[] = [
      {
        username: 'alice',
        updatedAt: '2026-03-19T10:00:00Z',
        skills: { 'code-review': { count: 10, lastUsed: new Date().toISOString() } },
      },
      {
        username: 'bob',
        updatedAt: '2026-03-19T10:00:00Z',
        skills: { 'code-review': { count: 5, lastUsed: new Date().toISOString() } },
      },
    ];

    const health = calculateTeamHealth(stats);
    expect(health).toHaveLength(1);
    expect(health[0].skill).toBe('code-review');
    expect(health[0].totalCount).toBe(15);
    expect(health[0].contributors).toBe(2);
  });

  it('handles empty stats', () => {
    expect(calculateTeamHealth([])).toEqual([]);
  });
});

// ─── skill-recommend tests ─────────────────────────────

describe('getRecommendations', () => {
  it('recommends skills user hasn\'t tried', async () => {
    // No local usage, so all team skills are recommendations
    const teamStats: UserStats[] = [
      {
        username: 'alice',
        updatedAt: '2026-03-19T10:00:00Z',
        skills: { 'code-review': { count: 10, lastUsed: new Date().toISOString() } },
      },
      {
        username: 'bob',
        updatedAt: '2026-03-19T10:00:00Z',
        skills: { 'code-review': { count: 5, lastUsed: new Date().toISOString() } },
      },
    ];

    const recs = await getRecommendations(teamStats);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].skill).toBe('code-review');
  });

  it('returns empty for no team data', async () => {
    const recs = await getRecommendations([]);
    expect(recs).toEqual([]);
  });
});
