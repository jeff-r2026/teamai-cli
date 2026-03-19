import YAML from 'yaml';
import path from 'node:path';
import { readUsageEvents, truncateUsageAfterReport } from './usage-tracker.js';
import { aggregateUsage } from './stats.js';
import { pushRepoDirectly, pullRepo } from './utils/git.js';
import { writeFile, ensureDir } from './utils/fs.js';
import { log } from './utils/logger.js';
import type { UserStats } from './types.js';

// ─── Auto-report flow (during teamai pull) ─────────────
//
//  teamai pull
//      │
//      ▼
//  [pull team resources] ── existing flow ──
//      │
//      ▼
//  [reportUsageToTeam()]
//      │
//      ▼
//  [read ~/.teamai/usage.jsonl] ──missing/empty?──▶ SKIP
//      │
//      ▼
//  [aggregate to stats/<user>.yaml]
//      │
//      ▼
//  [git add + commit + push (5s timeout)]
//      │
//      ├──success──▶ truncate JSONL
//      └──fail──▶ log debug + skip (next pull retries)
//

/**
 * Aggregate local usage data into a YAML file for the team repo.
 */
function buildUserStats(username: string, events: { name: string; count: number; lastUsed: Date }[]): UserStats {
  const skills: Record<string, { count: number; lastUsed: string }> = {};
  for (const stat of events) {
    skills[stat.name] = {
      count: stat.count,
      lastUsed: stat.lastUsed.toISOString(),
    };
  }

  return {
    username,
    updatedAt: new Date().toISOString(),
    skills,
  };
}

/**
 * Auto-report usage data to team repo during pull.
 * Best-effort: silently fails on any error.
 * Timeout: 5 seconds max to avoid blocking session start.
 */
export async function reportUsageToTeam(
  repoPath: string,
  username: string,
): Promise<void> {
  try {
    const events = await readUsageEvents();
    if (events.length === 0) {
      log.debug('No usage events to report');
      return;
    }

    const stats = aggregateUsage(events);
    const userStats = buildUserStats(username, stats);

    // Write stats/<user>.yaml to team repo
    const statsDir = path.join(repoPath, 'stats');
    await ensureDir(statsDir);
    const statsPath = path.join(statsDir, `${username}.yaml`);
    await writeFile(statsPath, YAML.stringify(userStats));

    // Pull latest, commit, and push with timeout
    const pushPromise = (async () => {
      await pullRepo(repoPath);
      await pushRepoDirectly(
        repoPath,
        `[teamai] Update usage stats for ${username}`,
        [`stats/${username}.yaml`],
      );
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Auto-report timeout (5s)')), 5000),
    );

    await Promise.race([pushPromise, timeoutPromise]);

    // Success — truncate reported events
    await truncateUsageAfterReport(events.length);
    log.debug(`Reported ${events.length} usage events to team repo`);
  } catch (e) {
    log.debug(`Auto-report skipped: ${(e as Error).message}`);
  }
}
