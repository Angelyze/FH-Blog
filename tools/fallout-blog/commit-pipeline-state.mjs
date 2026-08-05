/**
 * Commit feed-health, story-history, and posts/ after a CI generate run.
 * Retries rebase/push races so concurrent main updates do not fail the job.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
/** Paths relative to repo root (files or directories). */
const PATHS = [
  'data/story-history.json',
  'data/feed-health.json',
  'posts'
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
  const result = run('git', ['status', '--porcelain', '--', ...PATHS], { allowFail: true });
  return Boolean((result.stdout || '').trim());
}

function copyPathRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyPathRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function removePathRecursive(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

function snapshotPaths(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of PATHS) {
    const src = path.join(ROOT, rel);
    const dest = path.join(dir, rel);
    removePathRecursive(dest);
    copyPathRecursive(src, dest);
  }
}

function restoreSnapshot(dir) {
  for (const rel of PATHS) {
    const snap = path.join(dir, rel);
    const dest = path.join(ROOT, rel);
    removePathRecursive(dest);
    copyPathRecursive(snap, dest);
  }
}

function configureGit() {
  run('git', ['config', 'user.name', 'github-actions[bot]']);
  run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
}

function commitIfNeeded(message) {
  run('git', ['add', '--', ...PATHS], { allowFail: true });
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
  snapshotPaths(snapDir);
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
