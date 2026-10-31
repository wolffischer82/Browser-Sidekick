// Store T23: checks the zips `npm run zip` writes to dist/.
//   1. The unpacked Chrome and Firefox zips equal dist/chrome-ext and dist/firefox-ext.
//   2. The sources zip contains none of the excluded paths (spec store-publishing 4.3).
//   3. The sources zip, unpacked into an empty directory, rebuilds dist/firefox-ext
//      byte for byte with `npm ci && npm run build:firefox`.
//   4. `web-ext lint` reports no errors on the unpacked Firefox zip.
//   5. `git status` is clean afterwards.
// Uses Node built-ins and the system `unzip` and `diff`. Run `npm run zip` first.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { name, version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const zipPath = (suffix) => join(root, 'dist', `${name}-${version}-${suffix}.zip`);
const zips = {
  chrome: zipPath('chrome'),
  firefox: zipPath('firefox'),
  sources: zipPath('sources'),
};

// Paths the sources zip must not contain: dependencies, builds, test output,
// agent and git metadata, logs, local env files, and hidden files in general.
const EXCLUDED = [
  /(^|\/)node_modules(\/|$)/,
  /^dist(\/|$)/,
  /^(test-results|playwright-report|coverage|web-ext-artifacts|\.output|build)(\/|$)/,
  /(^|\/)\.claude(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /\.log$/,
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\./,
  /\.(zip|xpi|crx|pem)$/,
];

const failures = [];
const work = mkdtempSync(join(tmpdir(), 'verify-zips-'));

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...options });
}

function unpack(zip, dir) {
  run('mkdir', ['-p', dir]);
  run('unzip', ['-q', zip, '-d', dir]);
  return dir;
}

function sameTree(label, expected, actual) {
  try {
    run('diff', ['-r', expected, actual]);
    process.stdout.write(`ok   ${label}\n`);
  } catch (error) {
    failures.push(`${label}:\n${error.stdout || error.message}`);
    process.stdout.write(`FAIL ${label}\n`);
  }
}

try {
  for (const [key, file] of Object.entries(zips)) {
    if (!existsSync(file)) throw new Error(`missing ${key} zip: ${file} (run \`npm run zip\`)`);
  }

  // 1. Packaged builds equal the committed dist/ folders.
  for (const browser of ['chrome', 'firefox']) {
    const dir = unpack(zips[browser], join(work, browser));
    sameTree(
      `${browser} zip equals dist/${browser}-ext`,
      join(root, 'dist', `${browser}-ext`),
      dir,
    );
  }

  // 2. Sources zip contains no excluded path.
  const entries = run('unzip', ['-Z1', zips.sources]).split('\n').filter(Boolean);
  const bad = entries.filter((entry) => EXCLUDED.some((pattern) => pattern.test(entry)));
  if (bad.length > 0) {
    failures.push(`sources zip contains excluded paths:\n${bad.join('\n')}`);
    process.stdout.write('FAIL sources zip excludes forbidden paths\n');
  } else {
    process.stdout.write(`ok   sources zip excludes forbidden paths (${entries.length} files)\n`);
  }

  // 3. Sources zip rebuilds dist/firefox-ext.
  const src = unpack(zips.sources, join(work, 'sources'));
  try {
    run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: src });
    run('npm', ['run', 'build:firefox'], { cwd: src });
    sameTree(
      'sources zip rebuilds dist/firefox-ext',
      join(root, 'dist', 'firefox-ext'),
      join(src, 'dist', 'firefox-ext'),
    );
  } catch (error) {
    failures.push(
      `rebuild from sources zip failed:\n${error.stdout || ''}${error.stderr || error.message}`,
    );
    process.stdout.write('FAIL sources zip rebuilds dist/firefox-ext\n');
  }

  // 4. web-ext lint on the unpacked Firefox zip: errors fail (exit code), warnings do not.
  try {
    const out = run(join(root, 'node_modules', '.bin', 'web-ext'), [
      'lint',
      '--source-dir',
      join(work, 'firefox'),
      '--output',
      'json',
    ]);
    const summary = JSON.parse(out.slice(out.indexOf('{'))).summary;
    if (summary.errors > 0) throw Object.assign(new Error('lint errors'), { stdout: out });
    process.stdout.write(
      `ok   web-ext lint on firefox zip (${summary.errors} errors, ${summary.warnings} warnings)\n`,
    );
  } catch (error) {
    failures.push(`web-ext lint on firefox zip:\n${error.stdout || error.message}`);
    process.stdout.write('FAIL web-ext lint on firefox zip\n');
  }

  // 5. Zipping left the working tree clean (zips are git-ignored).
  const status = run('git', ['status', '--porcelain'], { cwd: root });
  if (status.trim()) {
    failures.push(`git status is not clean:\n${status}`);
    process.stdout.write('FAIL git status clean\n');
  } else {
    process.stdout.write('ok   git status clean\n');
  }
} catch (error) {
  failures.push(error.message);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(`\n${failures.join('\n\n')}\n`);
  process.exit(1);
}
process.stdout.write('All zip checks passed.\n');
