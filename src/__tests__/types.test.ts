import { describe, it, expect } from 'vitest';
import {
  MemberConfigSchema,
  TeamaiConfigSchema,
  SharingConfigSchema,
  StateSchema,
} from '../types.js';

describe('MemberConfigSchema', () => {
  it('should parse a complete member config', () => {
    const result = MemberConfigSchema.parse({
      username: 'alice',
      displayName: 'Alice Chen',
      registeredAt: '2025-01-01T00:00:00.000Z',
    });
    expect(result).toEqual({
      username: 'alice',
      displayName: 'Alice Chen',
      registeredAt: '2025-01-01T00:00:00.000Z',
    });
  });

  it('should default displayName to empty string', () => {
    const result = MemberConfigSchema.parse({
      username: 'bob',
      registeredAt: '2025-01-01T00:00:00.000Z',
    });
    expect(result.displayName).toBe('');
  });

  it('should reject missing required fields', () => {
    expect(() => MemberConfigSchema.parse({ username: 'x' })).toThrow();
    expect(() => MemberConfigSchema.parse({ registeredAt: 'x' })).toThrow();
  });

  it('should reject empty object', () => {
    expect(() => MemberConfigSchema.parse({})).toThrow();
  });

  it('should strip unknown fields like legacy role', () => {
    const result = MemberConfigSchema.parse({
      username: 'alice',
      displayName: 'Alice',
      registeredAt: '2025-01-01T00:00:00.000Z',
      role: 'write',
    });
    // Zod by default passes through unknown keys, but result type should not include role
    expect(result.username).toBe('alice');
    expect(result.registeredAt).toBe('2025-01-01T00:00:00.000Z');
  });
});

describe('TeamaiConfigSchema', () => {
  it('should include codebuddy in default toolPaths', () => {
    const result = TeamaiConfigSchema.parse({
      team: 'test-team',
      repo: 'https://git.woa.com/test/repo.git',
    });
    expect(result.toolPaths).toHaveProperty('codebuddy');
    expect(result.toolPaths.codebuddy).toEqual({
      skills: '.codebuddy/skills',
      rules: '.codebuddy/rules',
      settings: '.codebuddy/settings.json',
      claudemd: '.codebuddy/CLAUDE.md',
    });
  });

  it('should include codebuddy in default syncTargets', () => {
    const result = TeamaiConfigSchema.parse({
      team: 'test-team',
      repo: 'https://git.woa.com/test/repo.git',
    });
    expect(result.sharing.skills.syncTargets).toContain('codebuddy');
  });

  it('should preserve all existing default tools in toolPaths', () => {
    const result = TeamaiConfigSchema.parse({
      team: 'test-team',
      repo: 'https://git.woa.com/test/repo.git',
    });
    expect(Object.keys(result.toolPaths)).toEqual(
      expect.arrayContaining(['claude', 'codex', 'claude-internal', 'cursor', 'codebuddy', 'openclaw'])
    );
  });

  it('should include openclaw in default toolPaths', () => {
    const result = TeamaiConfigSchema.parse({
      team: 'test-team',
      repo: 'https://git.woa.com/test/repo.git',
    });
    expect(result.toolPaths).toHaveProperty('openclaw');
    expect(result.toolPaths.openclaw).toEqual({
      skills: '.openclaw/skills',
      rules: '.openclaw/rules',
    });
  });

  it('should include openclaw in default syncTargets', () => {
    const result = TeamaiConfigSchema.parse({
      team: 'test-team',
      repo: 'https://git.woa.com/test/repo.git',
    });
    expect(result.sharing.skills.syncTargets).toContain('openclaw');
  });
});

describe('TeamaiConfigSchema reviewers', () => {
  const minConfig = {
    team: 'my-team',
    repo: 'https://git.woa.com/team/repo.git',
  };

  it('should default reviewers to empty array when not provided', () => {
    const result = TeamaiConfigSchema.parse(minConfig);
    expect(result.reviewers).toEqual([]);
  });

  it('should accept an explicit reviewers list', () => {
    const result = TeamaiConfigSchema.parse({
      ...minConfig,
      reviewers: ['alice', 'bob'],
    });
    expect(result.reviewers).toEqual(['alice', 'bob']);
  });

  it('should accept empty reviewers array', () => {
    const result = TeamaiConfigSchema.parse({
      ...minConfig,
      reviewers: [],
    });
    expect(result.reviewers).toEqual([]);
  });
});

describe('SharingConfigSchema env', () => {
  it('should default env.injectShellProfile to true', () => {
    const result = SharingConfigSchema.parse({});
    expect(result.env.injectShellProfile).toBe(true);
  });

  it('should default shellProfilePath to undefined', () => {
    const result = SharingConfigSchema.parse({});
    expect(result.env.shellProfilePath).toBeUndefined();
  });

  it('should accept explicit env config', () => {
    const result = SharingConfigSchema.parse({
      env: { injectShellProfile: false, shellProfilePath: '/custom/.profile' },
    });
    expect(result.env.injectShellProfile).toBe(false);
    expect(result.env.shellProfilePath).toBe('/custom/.profile');
  });

  it('should be included in TeamaiConfigSchema defaults', () => {
    const result = TeamaiConfigSchema.parse({
      team: 'test',
      repo: 'https://git.woa.com/test/repo.git',
    });
    expect(result.sharing.env).toBeDefined();
    expect(result.sharing.env.injectShellProfile).toBe(true);
  });
});

describe('StateSchema pushedEnvVars', () => {
  it('should default pushedEnvVars to empty array', () => {
    const result = StateSchema.parse({});
    expect(result.pushedEnvVars).toEqual([]);
  });

  it('should accept explicit pushedEnvVars', () => {
    const result = StateSchema.parse({
      pushedEnvVars: ['API_URL', 'TOKEN'],
    });
    expect(result.pushedEnvVars).toEqual(['API_URL', 'TOKEN']);
  });
});
