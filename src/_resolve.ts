import { accessSync, constants, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ResolveOptions {
  /** User-configured custom path */
  customPath?: string;
  /** Current platform (defaults to process.platform) */
  platform?: string;
  /** Home directory */
  home?: string;
  /** PATH environment variable */
  pathEnv?: string;
  /** Workspace root directories */
  workspaceDirs?: string[];
  /** File access check (defaults to fs.accessSync) */
  access?: (path: string, mode: number) => void;
  /** Directory listing (defaults to fs.readdirSync) */
  readdir?: (path: string) => string[];
}

export function resolvePiBinary(opts: ResolveOptions = {}): string {
  if (opts.customPath) return opts.customPath;

  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? process.env.HOME ?? process.env.USERPROFILE ?? "";
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? "";
  const workspaceDirs = opts.workspaceDirs ?? [];
  const access = opts.access ?? accessSync;
  const readdir = opts.readdir ?? readdirSync;

  const isWin = platform === "win32";
  // On Windows, npm/pnpm create .cmd shims; also check .exe and .ps1
  const names = isWin ? ["pi.cmd", "pi.exe", "pi.ps1"] : ["pi"];
  // Windows lacks Unix-style execute permission; just check the file exists
  const accessFlag = isWin ? constants.F_OK : constants.X_OK;

  // Well-known global paths — checked first
  const globalCandidates = isWin
    ? []
    : [`${home}/.bun/bin/pi`, `${home}/.local/bin/pi`, `${home}/.npm-global/bin/pi`];

  // OS PATH — covers most installs when the shell environment is inherited
  const pathCandidates = pathEnv
    .split(isWin ? ";" : ":")
    .filter(Boolean)
    .flatMap((dir) => names.map((n) => join(dir, n)));

  // Node version manager directories — VS Code launched from a desktop entry
  // won't have nvm/fnm/volta in PATH, so scan their directories directly.
  const versionManagerCandidates = isWin ? [] : findVersionManagerBins(home, readdir);

  // Workspace-local node_modules/.bin as last resort
  const workspaceCandidates = workspaceDirs.flatMap((dir) =>
    names.map((n) => join(dir, "node_modules", ".bin", n)),
  );

  const candidates = [
    ...globalCandidates,
    ...pathCandidates,
    ...versionManagerCandidates,
    ...workspaceCandidates,
  ];
  for (const c of candidates) {
    try {
      access(c, accessFlag);
      return c;
    } catch {}
  }

  return "pi";
}

/**
 * Returns the bin directory that contains the resolved pi binary,
 * or undefined if pi resolved to a bare name / custom path.
 * Useful for injecting node into the terminal PATH when VS Code
 * was launched without nvm/fnm/volta initialized.
 */
export function resolvePiBinDir(piPath: string): string | undefined {
  if (piPath === "pi" || !piPath.includes("/")) return undefined;
  return dirname(piPath);
}

/** Scan nvm, fnm, and volta directories for pi binaries. */
function findVersionManagerBins(home: string, readdir: (path: string) => string[]): string[] {
  const candidates: string[] = [];

  // volta — shims live directly in ~/.volta/bin
  candidates.push(`${home}/.volta/bin/pi`);

  // nvm — ~/.nvm/versions/node/<version>/bin/pi
  // Sort versions descending so newest is tried first.
  const nvmBase = join(home, ".nvm", "versions", "node");
  try {
    const versions = readdir(nvmBase).sort(compareSemverDesc);
    for (const v of versions) {
      candidates.push(join(nvmBase, v, "bin", "pi"));
    }
  } catch {}

  // fnm — ~/.local/share/fnm/node-versions/<version>/installation/bin/pi
  const fnmBase = join(home, ".local", "share", "fnm", "node-versions");
  try {
    const versions = readdir(fnmBase).sort(compareSemverDesc);
    for (const v of versions) {
      candidates.push(join(fnmBase, v, "installation", "bin", "pi"));
    }
  } catch {}

  return candidates;
}

/** Compare two semver-ish directory names (e.g. "v22.15.0") in descending order. */
function compareSemverDesc(a: string, b: string): number {
  const parse = (s: string) => s.replace(/^v/i, "").split(".").map(Number);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
