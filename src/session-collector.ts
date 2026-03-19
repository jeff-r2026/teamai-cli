import fs from 'node:fs';
import path from 'node:path';
import { log } from './utils/logger.js';
import { ensureDir } from './utils/fs.js';
import type { SessionRecord } from './types.js';

/** Get sessions dir (evaluated at call time). */
function getSessionsDir(): string {
  return path.join(process.env.HOME ?? '', '.teamai', 'sessions');
}

// ─── Session collection flow ───────────────────────────
//
//  teamai save-session [--summary "..."]
//      │
//      ▼
//  [collect session metadata]
//      │
//      ▼
//  [evaluate value: errors? retries? creative solutions?]
//      │
//      ├── has value → mark pushable, write to monthly MD
//      └── no value  → write to monthly MD (local only)
//

/**
 * Get the monthly session file path (e.g., ~/.teamai/sessions/2026-03.md).
 */
function getMonthlySessionPath(): string {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return path.join(getSessionsDir(), `${yearMonth}.md`);
}

/**
 * Evaluate whether a session has value worth sharing with the team.
 *
 * Value evaluation rules (v1):
 * - Valuable: contains tool errors, retries, rollbacks, AI self-correction
 * - Valuable: discovered new patterns, creative solutions
 * - Not valuable: pure chat, simple file operations, routine edits
 */
export function evaluateSessionValue(summary: string): boolean {
  const valuablePatterns = [
    /error/i,
    /fail/i,
    /retry/i,
    /rollback/i,
    /revert/i,
    /fix/i,
    /bug/i,
    /workaround/i,
    /self-correct/i,
    /wrong tool/i,
    /误用/,
    /重试/,
    /回退/,
    /修复/,
    /踩坑/,
    /发现/,
  ];

  return valuablePatterns.some((pattern) => pattern.test(summary));
}

/**
 * Format a session record as markdown for the monthly file.
 */
function formatSessionEntry(record: SessionRecord): string {
  const lines: string[] = [];
  lines.push(`### ${record.date}`);
  lines.push('');
  lines.push(record.summary);
  lines.push('');

  if (record.toolsUsed.length > 0) {
    lines.push(`**Tools used:** ${record.toolsUsed.join(', ')}`);
  }

  if (record.errors && record.errors.length > 0) {
    lines.push(`**Errors encountered:** ${record.errors.join('; ')}`);
  }

  lines.push(`**Value:** ${record.hasValue ? '✅ Valuable (pushable)' : '⚪ Routine (local only)'}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

/**
 * Save a session record to the monthly file.
 */
export async function saveSession(summary?: string): Promise<void> {
  const sessionSummary = summary || 'Session ended (no summary provided).';

  const record: SessionRecord = {
    date: new Date().toISOString(),
    summary: sessionSummary,
    toolsUsed: [], // Would be populated from actual session data
    hasValue: evaluateSessionValue(sessionSummary),
    errors: [],
  };

  try {
    const filePath = getMonthlySessionPath();
    await ensureDir(path.dirname(filePath));

    const entry = formatSessionEntry(record);
    await fs.promises.appendFile(filePath, entry, 'utf-8');

    if (record.hasValue) {
      log.success('Session saved (marked as valuable — will be pushed to team)');
    } else {
      log.info('Session saved (routine — local only)');
    }
  } catch (e) {
    log.warn(`Failed to save session: ${(e as Error).message}`);
  }
}
