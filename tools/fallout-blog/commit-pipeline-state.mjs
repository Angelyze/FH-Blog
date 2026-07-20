/**
 * Commit feed-health + story-history after a CI generate run.
 * Retries rebase/push races so concurrent main updates do not fail the job.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const FILES = [
  'data/story-history.json',
  'data/feed-health.json'
];
const BRANCH = process.env.GITHUB_REF_NAME || process.env.PIPELINE_STATE_BRANCH || 'main';
const MAX_ATTEMPTS = 6;

function run(command, args, { allowFail = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    shell: false
  });
  if (!allowFail && result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    const error = new Error(detail || `${command} ${args.join(' ')} failed (${result.status})`);
    error.status = result.status;
    throw error;
  }
  return result;
}

function hasLocalChanges() {
  const result = run('git', ['status', '--porcelain', ...FILES], { allowFail: true });
  return Boolean((result.stdout || '').trim());
}

function snapshotFiles(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const file of FILES) {
    const src = path.join(ROOT, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dir, path.basename(file)));
    }
  }
}

function restoreSnapshot(dir) {
  for (const file of FILES) {
    const snap = path.join(dir, path.basename(file));
    if (fs.existsSync(snap)) {
      fs.copyFileSync(snap, path.join(ROOT, file));
    }
  }
}

function configureGit() {
  run('git', ['config', 'user.name', 'github-actions[bot]']);
  run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
}

function commitIfNeeded(message) {
  run('git', ['add', ...FILES], { allowFail: true });
  const staged = run('git', ['diff', '--cached', '--name-only'], { allowFail: true });
  if (!(staged.stdout || '').trim()) {
    return false;
  }
  run('git', ['commit', '-m', message]);
  return true;
}

function abortRebase() {
  run('git', ['rebase', '--abort'], { allowFail: true });
}

function resetToOrigin() {
  run('git', ['fetch', 'origin', BRANCH]);
  run('git', ['reset', '--hard', `origin/${BRANCH}`]);
}

function pullRebase() {
  return run('git', ['pull', '--rebase', '--autostash', 'origin', BRANCH], { allowFail: true });
}

function push() {
  return run('git', ['push', 'origin', `HEAD:${BRANCH}`], { allowFail: true });
}

function repairHistory() {
  run(process.execPath, [path.join('tools', 'fallout-blog', 'repair-story-history.mjs')], { allowFail: true });
}

function sleep(ms) {
  spawnSync(process.execPath, ['-e', `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms})`], {
    stdio: 'ignore'
  });
}

function main() {
  repairHistory();

  if (!hasLocalChanges()) {
    console.log('No pipeline data changes to commit.');
    return;
  }

  const snapDir = path.join(ROOT, '.pipeline-state-snapshot');
  snapshotFiles(snapDir);
  configureGit();

  if (!commitIfNeeded('chore(blog): update pipeline state')) {
    console.log('No pipeline data changes to commit.');
    return;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    console.log(`Pipeline state push attempt ${attempt}/${MAX_ATTEMPTS}...`);

    const pull = pullRebase();
    if (pull.status !== 0) {
      console.warn('Rebase conflict while updating pipeline state; re-applying this run\'s files on latest main.');
      abortRebase();
      try {
        resetToOrigin();
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
      restoreSnapshot(snapDir);
      repairHistory();
      commitIfNeeded('chore(blog): update pipeline state');
      sleep(1000 * attempt);
      continue;
    }

    const pushResult = push();
    if (pushResult.status === 0) {
      console.log('Pipeline state committed to repository.');
      return;
    }

    console.warn('Push rejected (likely a concurrent update); retrying...');
    sleep(1000 * attempt);
  }

  console.error('Failed to commit pipeline state after retries.');
  process.exit(1);
}

main();
