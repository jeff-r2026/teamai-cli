import { z } from 'zod';

// ─── Tool path config ───────────────────────────────────

export const ToolPathsSchema = z.object({
  skills: z.string().optional(),
  rules: z.string().optional(),
  settings: z.string().optional(),
  claudemd: z.string().optional(),
});

// ─── Team config (teamai.yaml) ───────────────────────────

export const SharingConfigSchema = z.object({
  skills: z.object({}).default({}),
  rules: z.object({
    enforced: z.array(z.string()).default([]),
  }).default({}),
  docs: z.object({
    localDir: z.string().default('~/.teamai/docs'),
  }).default({}),
  env: z.object({
    injectShellProfile: z.boolean().default(true),
    shellProfilePath: z.string().optional(),
  }).default({}),
});

export const TeamaiConfigSchema = z.object({
  team: z.string(),
  description: z.string().default(''),
  repo: z.string(),
  reviewers: z.array(z.string()).default([]),
  sharing: SharingConfigSchema.default({}),
  toolPaths: z.record(z.string(), ToolPathsSchema).default({
    claude: { skills: '.claude/skills', rules: '.claude/rules', settings: '.claude/settings.json', claudemd: '.claude/CLAUDE.md' },
    codex: { skills: '.codex/skills', rules: '.codex/rules' },
    'claude-internal': { skills: '.claude-internal/skills', rules: '.claude-internal/rules', settings: '.claude-internal/settings.json', claudemd: '.claude-internal/CLAUDE.md' },
    cursor: { skills: '.cursor/skills', rules: '.cursor/rules', settings: '.cursor/hooks.json' },
    codebuddy: { skills: '.codebuddy/skills', rules: '.codebuddy/rules', settings: '.codebuddy/settings.json', claudemd: '.codebuddy/CLAUDE.md' },
    openclaw: { skills: '.openclaw/skills', rules: '.openclaw/rules' },
  }),
});

export type TeamaiConfig = z.infer<typeof TeamaiConfigSchema>;

// ─── Member config (members/<user>.yaml) ────────────────

export const MemberConfigSchema = z.object({
  username: z.string(),
  displayName: z.string().default(''),
  registeredAt: z.string(),
});

export type MemberConfig = z.infer<typeof MemberConfigSchema>;

// ─── Local config (~/.teamai/config.yaml) ──────────────────

export const LocalConfigSchema = z.object({
  repo: z.object({
    localPath: z.string(),
    remote: z.string(),
  }),
  username: z.string(),
  updatePolicy: z.enum(['auto', 'prompt', 'skip']).default('auto'),
});

export type LocalConfig = z.infer<typeof LocalConfigSchema>;

// ─── Local state (~/.teamai/state.json) ────────────────────

export const StateSchema = z.object({
  lastPush: z.string().nullable().default(null),
  lastPull: z.string().nullable().default(null),
  pushedRules: z.array(z.string()).default([]),
  pushedSkills: z.array(z.string()).default([]),
  pushedEnvVars: z.array(z.string()).default([]),
  lastUpdateCheck: z.string().nullable().default(null),
  availableUpdate: z.string().nullable().default(null),
});

export type State = z.infer<typeof StateSchema>;

// ─── Resource types ─────────────────────────────────────

export type ResourceType = 'skills' | 'rules' | 'docs' | 'env';

export type ResourceItemStatus = 'new' | 'modified';

export interface ResourceItem {
  name: string;
  type: ResourceType;
  sourcePath: string;
  relativePath: string;
  status?: ResourceItemStatus;
}

export interface ResourceDiff {
  added: ResourceItem[];
  modified: ResourceItem[];
  removed: ResourceItem[];
}

// ─── Global options ─────────────────────────────────────

export interface GlobalOptions {
  dryRun?: boolean;
  verbose?: boolean;
  silent?: boolean;
}

// ─── Constants ──────────────────────────────────────────

export const TEAMAI_HOME = `${process.env.HOME}/.teamai`;
export const TEAMAI_CONFIG_PATH = `${TEAMAI_HOME}/config.yaml`;
export const TEAMAI_STATE_PATH = `${TEAMAI_HOME}/state.json`;
export const TEAMAI_TOKEN_PATH = `${TEAMAI_HOME}/token`;
export const TEAMAI_UPDATE_LOCK_PATH = `${TEAMAI_HOME}/.update-lock`;

export const RESOURCE_TYPES: ResourceType[] = ['skills', 'rules', 'docs', 'env'];

export const TEAMAI_RULES_START = '<!-- [teamai:rules:start] -->';
export const TEAMAI_RULES_END = '<!-- [teamai:rules:end] -->';

export const TEAMAI_HOOK_DESCRIPTION_PREFIX = '[teamai]';

export const TEAMAI_ENV_START = '# [teamai:env:start]';
export const TEAMAI_ENV_END = '# [teamai:env:end]';

// ─── Usage tracking ────────────────────────────────────

/** Regex for valid skill names: alphanumeric, hyphens, underscores, colons, dots. Max 200 chars. */
export const SKILL_NAME_REGEX = /^[a-zA-Z0-9_\-:.]{1,200}$/;

export const TEAMAI_USAGE_PATH = `${TEAMAI_HOME}/usage.jsonl`;
export const TEAMAI_KNOWN_SKILLS_PATH = `${TEAMAI_HOME}/known-skills.json`;
export const TEAMAI_SESSIONS_DIR = `${TEAMAI_HOME}/sessions`;

export interface UsageEvent {
  skill: string;
  timestamp: string;
  tool: string;
}

export const UsageEventSchema = z.object({
  skill: z.string().regex(SKILL_NAME_REGEX),
  timestamp: z.string(),
  tool: z.string(),
});

// ─── Stats YAML (team repo: stats/<user>.yaml) ─────────

export interface UserStats {
  username: string;
  updatedAt: string;
  skills: Record<string, { count: number; lastUsed: string }>;
}

// ─── Session records ───────────────────────────────────

export interface SessionRecord {
  date: string;
  summary: string;
  toolsUsed: string[];
  hasValue: boolean;
  errors?: string[];
};
