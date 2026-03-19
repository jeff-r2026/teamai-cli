import fs from 'node:fs';
import path from 'node:path';
import { log } from './utils/logger.js';
import {
  SKILL_NAME_REGEX,
  TEAMAI_SESSIONS_DIR,
  type UsageEvent,
} from './types.js';
import { ensureDir } from './utils/fs.js';

/** Get the usage JSONL path (evaluated at call time to respect HOME changes in tests). */
function getUsagePath(): string {
  return path.join(process.env.HOME ?? '', '.teamai', 'usage.jsonl');
}

// ─── Data flow ─────────────────────────────────────────
//
//  PostToolUse hook
//      │
//      ▼
//  teamai track $CLAUDE_TOOL_NAME $CLAUDE_TOOL_INPUT
//      │
//      ▼
//  [tool == "Skill"?] ──No──▶ exit(0)
//      │Yes
//      ▼
//  [extract & validate skill name]
//      │
//      ▼
//  appendFile(usage.jsonl, JSON line)
//

/**
 * Extract skill name from the Skill tool's JSON input.
 * Claude Code passes the tool input as a JSON string with a `skill` field.
 */
function extractSkillName(toolInput: string): string | null {
  try {
    const parsed = JSON.parse(toolInput);
    const skill = parsed?.skill ?? parsed?.name ?? null;
    if (typeof skill !== 'string') return null;
    // The skill field may contain a qualified name like "pkg:skill-name"
    return skill.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Validate a skill name against allowed characters.
 * Prevents path traversal and overly long names.
 */
export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_REGEX.test(name);
}

/**
 * Append a usage event to the local JSONL file.
 * Silently fails on I/O errors (disk full, permission denied, etc.)
 * to avoid disrupting the AI coding session.
 */
export async function appendUsageEvent(event: UsageEvent): Promise<void> {
  try {
    await ensureDir(path.dirname(getUsagePath()));
    const line = JSON.stringify(event) + '\n';
    await fs.promises.appendFile(getUsagePath(), line, 'utf-8');
    log.debug(`Tracked skill: ${event.skill}`);
  } catch (e) {
    log.debug(`Failed to write usage event: ${(e as Error).message}`);
  }
}

/**
 * Read all usage events from the JSONL file.
 * Skips corrupted lines gracefully.
 */
export async function readUsageEvents(): Promise<UsageEvent[]> {
  try {
    const content = await fs.promises.readFile(getUsagePath(), 'utf-8');
    const events: UsageEvent[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as UsageEvent;
        if (parsed.skill && parsed.timestamp) {
          events.push(parsed);
        }
      } catch {
        log.debug(`Skipping corrupted JSONL line: ${trimmed.slice(0, 50)}`);
      }
    }
    return events;
  } catch {
    return [];
  }
}

/**
 * Truncate the usage JSONL file, keeping only events after `afterTimestamp`.
 * Used after successful auto-report to keep the file small.
 */
export async function truncateUsageAfterReport(reportedCount: number): Promise<void> {
  try {
    const content = await fs.promises.readFile(getUsagePath(), 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    if (reportedCount >= lines.length) {
      // All lines were reported — clear file
      await fs.promises.writeFile(getUsagePath(), '', 'utf-8');
    } else {
      // Keep unreported lines
      const remaining = lines.slice(reportedCount).join('\n') + '\n';
      await fs.promises.writeFile(getUsagePath(), remaining, 'utf-8');
    }
    log.debug(`Truncated usage.jsonl: removed ${reportedCount} reported events`);
  } catch (e) {
    log.debug(`Failed to truncate usage.jsonl: ${(e as Error).message}`);
  }
}

/**
 * Handle the `teamai track` CLI command.
 * Called by PostToolUse hook with environment variables.
 */
export async function track(toolName: string, toolInput: string): Promise<void> {
  // Only track Skill tool calls
  if (toolName !== 'Skill') {
    return;
  }

  const skillName = extractSkillName(toolInput);
  if (!skillName) {
    log.debug('Could not extract skill name from tool input');
    return;
  }

  if (!isValidSkillName(skillName)) {
    log.debug(`Invalid skill name rejected: ${skillName.slice(0, 50)}`);
    return;
  }

  const event: UsageEvent = {
    skill: skillName,
    timestamp: new Date().toISOString(),
    tool: 'claude',
  };

  await appendUsageEvent(event);
}
