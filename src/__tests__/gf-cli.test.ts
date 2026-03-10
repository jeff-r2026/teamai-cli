import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    dim: vi.fn(),
  },
  spinner: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
  }),
}));

vi.mock('../types.js', () => ({
  TEAMAI_HOME: '/tmp/test-teamai-home',
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('../utils/fs.js', () => ({
  pathExists: vi.fn().mockResolvedValue(false),
  ensureDir: vi.fn(),
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock('node:fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  },
}));

import { gfGetOAuthToken } from '../utils/gf-cli.js';

describe('gfGetOAuthToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should read token from ~/.netrc for git.woa.com', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      'machine git.woa.com login jeffyxu password myOAuthToken123 refresh abc123 authTokenType accessToken',
    );

    const token = gfGetOAuthToken();
    expect(token).toBe('myOAuthToken123');
  });

  it('should return null when ~/.netrc does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const token = gfGetOAuthToken();
    expect(token).toBeNull();
  });

  it('should return null when ~/.netrc has no git.woa.com entry', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      'machine github.com login user password ghp_xxx',
    );

    const token = gfGetOAuthToken();
    expect(token).toBeNull();
  });

  it('should return null when reading ~/.netrc throws', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('permission denied');
    });

    const token = gfGetOAuthToken();
    expect(token).toBeNull();
  });

  it('should handle multiline netrc format', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      'machine github.com login user password ghp_xxx\nmachine git.woa.com login alice password AliceToken456 refresh r456',
    );

    const token = gfGetOAuthToken();
    expect(token).toBe('AliceToken456');
  });
});
