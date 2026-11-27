// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  classifyRequiredBump,
  parseSemver,
  validateVersionBump,
  validateVersionConsistency,
} from '../scripts/check-version.mjs';

describe('parseSemver', () => {
  it('parses valid x.y.z versions and rejects invalid strings', () => {
    expect(parseSemver('0.2.0')).toEqual({ major: 0, minor: 2, patch: 0 });
    expect(parseSemver('12.34.56')).toEqual({ major: 12, minor: 34, patch: 56 });
    expect(parseSemver('0.2')).toBeNull();
    expect(parseSemver('0.2.0-beta.1')).toBeNull();
    expect(parseSemver('v0.2.0')).toBeNull();
    expect(parseSemver('')).toBeNull();
  });
});

describe('validateVersionConsistency', () => {
  const validInput = {
    packageVersion: '0.2.0',
    lockVersion: '0.2.0',
    lockRootVersion: '0.2.0',
    chromeManifestVersion: '0.2.0',
    firefoxManifestVersion: '0.2.0',
    readmeText: '# Browser Sidekick\n\nStatus: MVP, version 0.2.0. It is not in the stores yet.\n',
  };

  it('passes when all manifests, lockfile entries, and README agree', () => {
    expect(validateVersionConsistency(validInput)).toEqual([]);
  });

  it('rejects invalid package.json semver', () => {
    expect(validateVersionConsistency({ ...validInput, packageVersion: '0.2' })).toEqual([
      'package.json version "0.2" must follow x.y.z format.',
    ]);
  });

  it('reports mismatches across lockfile, manifests, and README', () => {
    const errors = validateVersionConsistency({
      ...validInput,
      lockVersion: '0.1.0',
      lockRootVersion: '0.1.0',
      chromeManifestVersion: '0.1.0',
      firefoxManifestVersion: '0.1.1',
      readmeText: '# Browser Sidekick\n\nStatus: MVP, version 0.1.0.\n',
    });
    expect(errors).toHaveLength(5);
  });

  it('requires a Status line with version x.y.z in README.md', () => {
    const errors = validateVersionConsistency({
      ...validInput,
      readmeText: '# Browser Sidekick\n\nNo status line.\n',
    });
    expect(errors).toEqual(['README.md Status line must include "version x.y.z".']);
  });
});

describe('classifyRequiredBump', () => {
  it('returns none for docs, tests, and CI-only changes', () => {
    expect(
      classifyRequiredBump(
        ['README.md', 'tests/check-version.test.ts', '.github/workflows/ci.yml'],
        ['feat: add tests'],
      ),
    ).toBe('none');
  });

  it('returns patch for runtime bugfix or chore changes without feat:', () => {
    expect(classifyRequiredBump(['src/shared/model.ts'], ['fix(chat): handle empty tab'])).toBe(
      'patch',
    );
    expect(classifyRequiredBump(['wxt.config.ts'], ['chore: adjust manifest'])).toBe('patch');
  });

  it('returns minor when runtime files change and any commit or PR title starts with feat:', () => {
    expect(
      classifyRequiredBump(
        ['public/_locales/en/messages.json', 'tests/locales.test.ts'],
        ['fix: typo', 'feat(i18n)!: add option'],
      ),
    ).toBe('minor');
    expect(
      classifyRequiredBump(['src/entrypoints/background.ts'], ['chore: wip'], 'feat: new command'),
    ).toBe('minor');
  });
});

describe('validateVersionBump', () => {
  it('allows unchanged or single-step minor/patch bumps when requiredBump is none', () => {
    expect(
      validateVersionBump({ baseVersion: '0.1.0', currentVersion: '0.1.0', requiredBump: 'none' }),
    ).toEqual([]);
    expect(
      validateVersionBump({ baseVersion: '0.1.0', currentVersion: '0.2.0', requiredBump: 'none' }),
    ).toEqual([]);
    expect(
      validateVersionBump({ baseVersion: '0.1.0', currentVersion: '0.1.1', requiredBump: 'none' }),
    ).toEqual([]);
    expect(
      validateVersionBump({ baseVersion: '0.1.0', currentVersion: '0.3.0', requiredBump: 'none' }),
    ).toHaveLength(1);
  });

  it('requires a single patch or minor bump when requiredBump is patch', () => {
    expect(
      validateVersionBump({ baseVersion: '0.2.0', currentVersion: '0.2.0', requiredBump: 'patch' }),
    ).toHaveLength(1);
    expect(
      validateVersionBump({ baseVersion: '0.2.0', currentVersion: '0.2.1', requiredBump: 'patch' }),
    ).toEqual([]);
    expect(
      validateVersionBump({ baseVersion: '0.2.0', currentVersion: '0.3.0', requiredBump: 'patch' }),
    ).toEqual([]);
  });

  it('requires an exact minor bump (y+1, z=0) when requiredBump is minor', () => {
    expect(
      validateVersionBump({ baseVersion: '0.2.0', currentVersion: '0.2.0', requiredBump: 'minor' }),
    ).toHaveLength(1);
    expect(
      validateVersionBump({ baseVersion: '0.2.0', currentVersion: '0.2.1', requiredBump: 'minor' }),
    ).toHaveLength(1);
    expect(
      validateVersionBump({ baseVersion: '0.2.1', currentVersion: '0.3.0', requiredBump: 'minor' }),
    ).toEqual([]);
  });

  it('rejects decreasing versions', () => {
    expect(
      validateVersionBump({ baseVersion: '0.2.0', currentVersion: '0.1.9', requiredBump: 'none' }),
    ).toEqual(['Version cannot decrease (0.2.0 -> 0.1.9).']);
  });

  it('requires allowMajor for major version (x) bumps and validates x+1.0.0', () => {
    expect(
      validateVersionBump({
        baseVersion: '0.2.0',
        currentVersion: '1.0.0',
        requiredBump: 'minor',
        allowMajor: false,
      }),
    ).toHaveLength(1);
    expect(
      validateVersionBump({
        baseVersion: '0.2.0',
        currentVersion: '1.0.0',
        requiredBump: 'minor',
        allowMajor: true,
      }),
    ).toEqual([]);
    expect(
      validateVersionBump({
        baseVersion: '0.2.0',
        currentVersion: '1.1.0',
        requiredBump: 'minor',
        allowMajor: true,
      }),
    ).toHaveLength(1);
  });
});
