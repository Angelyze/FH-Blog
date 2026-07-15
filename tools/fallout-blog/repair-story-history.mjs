import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { salvageConflictedStoryHistory } from './generate.mjs';

const HISTORY_FILE = path.join(process.cwd(), 'data', 'story-history.json');

function dedupeStoryHistoryEntries(entries = []) {
  const latestByFingerprint = new Map();

  for (const entry of entries) {
    if (!entry?.fingerprint) continue;
    const previous = latestByFingerprint.get(entry.fingerprint);
    if (!previous || (entry.coveredAt || 0) >= (previous.coveredAt || 0)) {
      latestByFingerprint.set(entry.fingerprint, entry);
    }
  }

  return [...latestByFingerprint.values()].sort((a, b) => (b.coveredAt || 0) - (a.coveredAt || 0));
}

async function main() {
  const raw = await fs.readFile(HISTORY_FILE, 'utf8');
  const hasConflictMarkers = /^<<<<<<< /m.test(raw);

  if (!hasConflictMarkers) {
    JSON.parse(raw);
    console.log('Story history is valid JSON with no conflict markers.');
    return;
  }

  const salvaged = salvageConflictedStoryHistory(raw);
  if (salvaged.length === 0) {
    throw new Error('Could not repair story-history.json from conflict markers.');
  }

  const entries = dedupeStoryHistoryEntries(salvaged);
  const payload = JSON.stringify({ entries }, null, 2);
  JSON.parse(payload);

  const tempFile = `${HISTORY_FILE}.tmp`;
  await fs.writeFile(tempFile, payload);
  await fs.rename(tempFile, HISTORY_FILE);
  console.log(`Repaired story history: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});