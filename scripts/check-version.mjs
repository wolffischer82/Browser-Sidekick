import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const README_VERSION_RE = /^Status:.*\bversion (\d+\.\d+\.\d+)\b/m;
const FEAT_SUBJECT_RE = /^feat(\([^)]+\))?!?:/i;

/** Parse an `x.y.z` version string into numeric components, or `null` if invalid. */
export function parseSemver(version) {
  if (typeof version !== 'string') return null;
  const match = SEMVER_RE.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemver(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Verify that `package.json`, `package-lock.json`, both built `manifest.json` files,
 * and `README.md` all declare the exact same valid `x.y.z` version.
 */
export function validateVersionConsistency({
  packageVersion,
  lockVersion,
  lockRootVersion,
  chromeManifestVersion,
  firefoxManifestVersion,
  readmeText,
}) {
  const errors = [];
  if (!parseSemver(packageVersion)) {
    errors.push(`package.json version "${packageVersion}" must follow x.y.z format.`);
    return errors;
  }
  if (lockVersion !== packageVersion) {
    errors.push(`package-lock.json version "${lockVersion}" != package.json "${packageVersion}".`);
  }
  if (lockRootVersion !== packageVersion) {
    errors.push(
      `package-lock.json packages[""].version "${lockRootVersion}" != package.json "${packageVersion}".`,
    );
  }
  if (chromeManifestVersion !== packageVersion) {
    errors.push(
      `dist/chrome-ext/manifest.json version "${chromeManifestVersion}" != package.json "${packageVersion}".`,
    );
  }
  if (firefoxManifestVersion !== packageVersion) {
    errors.push(
      `dist/firefox-ext/manifest.json version "${firefoxManifestVersion}" != package.json "${packageVersion}".`,
    );
  }
  const readmeMatch = README_VERSION_RE.exec(readmeText);
  if (!readmeMatch) {
    errors.push('README.md Status line must include "version x.y.z".');
  } else if (readmeMatch[1] !== packageVersion) {
    errors.push(`README.md version "${readmeMatch[1]}" != package.json "${packageVersion}".`);
  }
  return errors;
}

function isRuntimeFile(file) {
  return file.startsWith('src/') || file.startsWith('public/') || file === 'wxt.config.ts';
}

/**
 * Determine the required semver bump (`'none'`, `'patch'`, or `'minor'`) from
 * changed file paths, commit subjects, and PR title.
 */
export function classifyRequiredBump(changedFiles, commitSubjects = [], prTitle = '') {
  if (!changedFiles.some(isRuntimeFile)) return 'none';
  const titles = [...commitSubjects, prTitle].filter(Boolean);
  return titles.some((title) => FEAT_SUBJECT_RE.test(title.trim())) ? 'minor' : 'patch';
}

/**
 * Enforce `x.y.z` bump rules relative to `baseVersion`:
 * - Major (`x`) bumps require explicit `allowMajor`.
 * - Feature changes require a minor (`y`) bump (`x.(y+1).0`).
 * - Bugfixes/other runtime changes require at least a patch (`z`) bump.
 */
export function validateVersionBump({
  baseVersion,
  currentVersion,
  requiredBump,
  allowMajor = false,
}) {
  const base = parseSemver(baseVersion);
  if (!base) return [`Base version "${baseVersion}" is not valid x.y.z.`];
  const cur = parseSemver(currentVersion);
  if (!cur) return [`Current version "${currentVersion}" is not valid x.y.z.`];

  if (compareSemver(cur, base) < 0) {
    return [`Version cannot decrease (${baseVersion} -> ${currentVersion}).`];
  }

  if (cur.major !== base.major) {
    if (!allowMajor) {
      return [
        `Major version (x) bumps are owner-decided only (${baseVersion} -> ${currentVersion}); add the \`major-release\` PR label to approve.`,
      ];
    }
    if (cur.major !== base.major + 1 || cur.minor !== 0 || cur.patch !== 0) {
      return [
        `Invalid major version bump (${baseVersion} -> ${currentVersion}); expected ${base.major + 1}.0.0.`,
      ];
    }
    return [];
  }

  const isUnchanged = cur.minor === base.minor && cur.patch === base.patch;
  const isNextPatch = cur.minor === base.minor && cur.patch === base.patch + 1;
  const isNextMinor = cur.minor === base.minor + 1 && cur.patch === 0;

  if (requiredBump === 'none') {
    if (isUnchanged || isNextPatch || isNextMinor) return [];
    return [
      `Invalid version jump from ${baseVersion} to ${currentVersion}; expected unchanged, ${base.major}.${base.minor}.${base.patch + 1}, or ${base.major}.${base.minor + 1}.0.`,
    ];
  }

  if (requiredBump === 'minor') {
    if (isNextMinor) return [];
    return [
      `Feature changes require a minor version (y) bump from ${baseVersion} to ${base.major}.${base.minor + 1}.0 (found ${currentVersion}). Run \`npm version minor --no-git-tag-version && npm run build\` and update README.md.`,
    ];
  }

  if (isNextPatch || isNextMinor) return [];
  return [
    `Runtime/bugfix changes require a patch version (z) bump from ${baseVersion} to ${base.major}.${base.minor}.${base.patch + 1} (found ${currentVersion}). Run \`npm version patch --no-git-tag-version && npm run build\` and update README.md.`,
  ];
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runGit(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function resolveBaseRef(root, rawBase) {
  const candidates = rawBase.startsWith('origin/') ? [rawBase] : [`origin/${rawBase}`, rawBase];
  for (const ref of candidates) {
    try {
      runGit(root, ['rev-parse', '--verify', '--quiet', ref]);
      return ref;
    } catch {
      // Try next candidate.
    }
  }
  throw new Error(`Base git ref "${rawBase}" could not be resolved.`);
}

function getArgValue(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  const prefix = `${flag}=`;
  const eqArg = argv.find((arg) => arg.startsWith(prefix));
  return eqArg ? eqArg.slice(prefix.length) : '';
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const root = resolve(import.meta.dirname, '..');
  const pkg = readJson(resolve(root, 'package.json'));
  const lock = readJson(resolve(root, 'package-lock.json'));
  const chromeManifest = readJson(resolve(root, 'dist/chrome-ext/manifest.json'));
  const firefoxManifest = readJson(resolve(root, 'dist/firefox-ext/manifest.json'));
  const readmeText = readFileSync(resolve(root, 'README.md'), 'utf8');

  const errors = validateVersionConsistency({
    packageVersion: pkg.version,
    lockVersion: lock.version,
    lockRootVersion: lock.packages?.['']?.version,
    chromeManifestVersion: chromeManifest.version,
    firefoxManifestVersion: firefoxManifest.version,
    readmeText,
  });

  const rawBase = getArgValue(argv, '--base') || env.GITHUB_BASE_REF || '';
  if (rawBase) {
    const baseRef = resolveBaseRef(root, rawBase);
    const basePkg = JSON.parse(runGit(root, ['show', `${baseRef}:package.json`]));
    const changedFiles = runGit(root, ['diff', '--name-only', `${baseRef}...HEAD`])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const commitSubjects = runGit(root, ['log', '--format=%s', `${baseRef}..HEAD`])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const prTitle = env.PR_TITLE || '';
    const allowMajor = argv.includes('--allow-major') || env.ALLOW_MAJOR_BUMP === 'true';
    const requiredBump = classifyRequiredBump(changedFiles, commitSubjects, prTitle);

    errors.push(
      ...validateVersionBump({
        baseVersion: basePkg.version,
        currentVersion: pkg.version,
        requiredBump,
        allowMajor,
      }),
    );

    if (errors.length === 0) {
      process.stdout.write(
        `ok   version ${pkg.version} (base ${basePkg.version}, required bump: ${requiredBump})\n`,
      );
    }
  } else if (errors.length === 0) {
    process.stdout.write(`ok   version ${pkg.version} is consistent across manifests and README\n`);
  }

  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`FAIL ${error}\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
