import { readUsageEvents } from './usage-tracker.js';
import type { UsageEvent } from './types.js';

interface SkillStats {
  name: string;
  count: number;
  lastUsed: Date;
}

/**
 * Aggregate usage events by skill name.
 */
export function aggregateUsage(events: UsageEvent[]): SkillStats[] {
  const map = new Map<string, SkillStats>();

  for (const event of events) {
    const existing = map.get(event.skill);
    const timestamp = new Date(event.timestamp);

    if (existing) {
      existing.count += 1;
      if (timestamp > existing.lastUsed) {
        existing.lastUsed = timestamp;
      }
    } else {
      map.set(event.skill, {
        name: event.skill,
        count: 1,
        lastUsed: timestamp,
      });
    }
  }

  // Sort by count descending
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/**
 * Format relative time for display (e.g., "2h ago", "yesterday").
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toISOString().slice(0, 10);
}

/**
 * CLI: Show local skill usage statistics.
 */
export async function showStats(): Promise<void> {
  const events = await readUsageEvents();

  if (events.length === 0) {
    console.log('No skill usage data yet.');
    console.log('Usage tracking starts automatically via PostToolUse hook.');
    return;
  }

  const stats = aggregateUsage(events);

  console.log('');
  console.log('Skill Usage Statistics:');
  console.log('');

  // Calculate column widths
  const maxNameLen = Math.max(...stats.map((s) => s.name.length), 4);
  const maxCountLen = Math.max(...stats.map((s) => String(s.count).length), 4);

  for (const stat of stats) {
    const name = stat.name.padEnd(maxNameLen);
    const count = String(stat.count).padStart(maxCountLen);
    const recency = formatRelativeTime(stat.lastUsed);
    console.log(`  ${name}  ${count} uses   last: ${recency}`);
  }

  console.log('');
  console.log(`Total: ${events.length} events across ${stats.length} skill(s)`);
}
