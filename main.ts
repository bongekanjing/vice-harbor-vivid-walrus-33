// Vice Harbor — entry hand-in for make.fun gta6-01. Validates game/ and screenshots/ against the bounty's caps,
// stages both under MAKEFUN_OUTPUT_DIR (default /output) and writes the judge's dossier.json from what it staged.
// Standard library only, no network, deterministic: two runs over the same tree write byte-identical output.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The bounty's gate: the same numbers the judge recomputes the dossier with, named so a failure says which one.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

const ENTRY_DIR = fileURLToPath(new URL('.', import.meta.url));
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const GAME_DIR = join(ENTRY_DIR, 'game');
const SHOTS_DIR = join(ENTRY_DIR, 'screenshots');

// Every image a screenshot may be, by its first bytes: the dossier accepts PNG and JPEG only.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function fail(message: string): never {
  console.error('vice-harbor hand-in refused: ' + message);
  process.exit(1);
}

// Walks game/ once: how many files and directories it holds, how many bytes its files cost, and its longest path.
// Symbols links and special files are refused here rather than left for the dossier reader to trip over.
function surveyGame(dir: string) {
  const seen = { entries: 0, files: 0, bytes: 0, longestPath: 0 };
  const stack = [''];
  while (stack.length > 0) {
    const rel = stack.pop();
    const abs = rel === '' ? dir : join(dir, rel);
    let rows;
    try {
      rows = readdirSync(abs, { withFileTypes: true });
    } catch (err) {
      fail('game/' + rel + ' cannot be read (' + (err as Error).message + ')');
    }
    for (const row of rows) {
      const path = rel === '' ? row.name : rel + '/' + row.name;
      const full = join(dir, path);
      const stat = statSync(full);
      seen.entries += 1;
      if (seen.entries > CAPS.game_max_files) {
        fail('game/ holds more than ' + CAPS.game_max_files + ' files and directories');
      }
      if (stat.isSymbolicLink()) fail('game/' + path + ' is a symlink; game/ holds plain files only');
      seen.longestPath = Math.max(seen.longestPath, Buffer.byteLength(path, 'utf8'));
      if (seen.longestPath > CAPS.game_path_max_bytes) {
        fail('game/' + path + ' is a path over ' + CAPS.game_path_max_bytes + ' bytes');
      }
      if (stat.isDirectory()) {
        stack.push(path);
      } else if (stat.isFile()) {
        seen.files += 1;
        seen.bytes += stat.size;
        if (seen.bytes > CAPS.game_max_bytes) {
          fail('game/ files come to more than ' + CAPS.game_max_bytes + ' bytes');
        }
      } else {
        fail('game/' + path + ' is a special file; game/ holds plain files only');
      }
    }
  }
  return seen;
}

// The screenshots in the judge's order, each checked against the byte cap before anything is copied.
function surveyScreenshots(dir: string) {
  let names;
  try {
    names = readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
  } catch (err) {
    fail('no screenshots/ directory to hand in (' + (err as Error).message + ')');
  }
  if (names.length === 0) fail('screenshots/ holds no renders');
  if (names.length > CAPS.screenshots.max) {
    fail('screenshots/ holds ' + names.length + ' files, over the ' + CAPS.screenshots.max + ' allowed');
  }
  const shots = names.map((name: string) => {
    const full = join(dir, name);
    const stat = statSync(full);
    if (!stat.isFile()) fail('screenshots/' + name + ' is not a file');
    if (stat.size >= CAPS.screenshots.max_bytes) {
      fail('screenshots/' + name + ' is ' + stat.size + ' bytes, at or over the ' + CAPS.screenshots.max_bytes + ' byte cap');
    }
    return { name, bytes: stat.size };
  });
  return shots;
}

// A fresh copy of one directory tree, so a second run cannot inherit a stale file from the first.
function stage(source: string, target: string, label: string): void {
  if (!existsSync(source)) fail('nothing to hand in: ' + label + ' is missing');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
}

function main() {
  if (!existsSync(GAME_DIR)) fail('game/ is missing next to main.ts');
  const game = surveyGame(GAME_DIR);
  if (!existsSync(join(GAME_DIR, 'index.html'))) fail('game/index.html is missing, so there is no page to play');
  const shots = surveyScreenshots(SHOTS_DIR);

  mkdirSync(OUT_DIR, { recursive: true });
  stage(GAME_DIR, join(OUT_DIR, 'game'), 'game/');
  stage(SHOTS_DIR, join(OUT_DIR, 'screenshots'), 'screenshots/');

  let dossier;
  try {
    dossier = buildDossier(OUT_DIR, CAPS);
  } catch (err) {
    fail('the judge would refuse this entry: ' + (err as Error).message ?? String(err));
  }
  const dossierPath = join(OUT_DIR, 'dossier.json');
  writeFileSync(dossierPath, dossier);

  const shotBytes = shots.reduce((sum: number, s: { bytes: number }) => sum + s.bytes, 0);
  console.log('Vice Harbor — handed in to ' + OUT_DIR);
  console.log('  game/         ' + game.files + ' files, ' + game.entries + ' entries, ' + game.bytes + ' bytes');
  console.log('  screenshots/  ' + shots.length + ' renders, ' + shotBytes + ' bytes: ' + shots.map((s: { name: string }) => s.name).join(', '));
  console.log('  dossier.json  ' + dossier.length + ' bytes');
}

main();
