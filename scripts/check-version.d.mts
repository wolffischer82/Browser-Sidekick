export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export type BumpKind = 'none' | 'patch' | 'minor';

export interface VersionConsistencyInput {
  packageVersion: string;
  lockVersion: string | undefined;
  lockRootVersion: string | undefined;
  chromeManifestVersion: string | undefined;
  firefoxManifestVersion: string | undefined;
  readmeText: string;
}

export interface VersionBumpInput {
  baseVersion: string;
  currentVersion: string;
  requiredBump: BumpKind;
  allowMajor?: boolean;
}

export function parseSemver(version: unknown): Semver | null;
export function validateVersionConsistency(input: VersionConsistencyInput): string[];
export function classifyRequiredBump(
  changedFiles: string[],
  commitSubjects?: string[],
  prTitle?: string,
): BumpKind;
export function validateVersionBump(input: VersionBumpInput): string[];
export function main(argv?: string[], env?: Record<string, string | undefined>): number;
