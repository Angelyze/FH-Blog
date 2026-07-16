import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const zipPath = process.argv[2] || 'C:\\Users\\win11\\Desktop\\logs_79951333428.zip';
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'logs-79951333428');
const reportPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'logs-79951333428-REPORT.txt');

fs.mkdirSync(outDir, { recursive: true });
execFileSync('powershell.exe', [
  '-NoProfile',
  '-Command',
  `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`
], { stdio: 'inherit' });

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
}
walk(outDir);

const keywords = /error|fail|skip|success|bootstrap|discord|blogger|reddit|story history|feed|draft|commit|warning|##\[|npm run/i;
const lines = [`Extracted ${files.length} file(s) from ${zipPath}`, ''];

for (const file of files.sort()) {
  lines.push(`=== ${path.relative(outDir, file)} ===`);
  try {
    const text = fs.readFileSync(file, 'utf8');
    const matched = text.split(/\r?\n/).filter((line) => keywords.test(line));
    if (matched.length) lines.push(...matched.slice(0, 200));
    else lines.push(text.slice(0, 4000));
  } catch (error) {
    lines.push(`[unreadable: ${error.message}]`);
  }
  lines.push('');
}

fs.writeFileSync(reportPath, lines.join('\n'));
console.log(`Wrote ${reportPath}`);