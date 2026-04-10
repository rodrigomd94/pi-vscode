import { constants } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePiBinary, resolvePiBinDir } from "../src/_resolve.ts";

function mockAccess(existing: Set<string>) {
  return (path: string, _mode: number) => {
    if (!existing.has(path)) throw new Error("ENOENT");
  };
}

function mockReaddir(dirs: Record<string, string[]>) {
  return (path: string) => {
    if (path in dirs) return dirs[path]!;
    throw new Error("ENOENT");
  };
}

describe("resolvePiBinary", () => {
  it("returns custom path when configured", () => {
    expect(resolvePiBinary({ customPath: "/custom/pi" })).toBe("/custom/pi");
  });

  it("finds pi in workspace node_modules/.bin on unix", () => {
    const wsDir = "/projects/myapp";
    const piPath = join(wsDir, "node_modules", ".bin", "pi");
    const result = resolvePiBinary({
      platform: "linux",
      workspaceDirs: [wsDir],
      access: mockAccess(new Set([piPath])),
      readdir: mockReaddir({}),
      pathEnv: "",
    });
    expect(result).toBe(piPath);
  });

  it("finds pi.cmd in workspace node_modules/.bin on windows", () => {
    const wsDir = "C:\\Users\\dev\\project";
    const piCmd = join(wsDir, "node_modules", ".bin", "pi.cmd");
    const result = resolvePiBinary({
      platform: "win32",
      workspaceDirs: [wsDir],
      access: mockAccess(new Set([piCmd])),
      pathEnv: "",
    });
    expect(result).toBe(piCmd);
  });

  it("finds pi in well-known global paths on unix", () => {
    const home = "/home/user";
    const bunPath = `${home}/.bun/bin/pi`;
    const result = resolvePiBinary({
      platform: "linux",
      home,
      workspaceDirs: [],
      access: mockAccess(new Set([bunPath])),
      readdir: mockReaddir({}),
      pathEnv: "",
    });
    expect(result).toBe(bunPath);
  });

  it("prefers global paths over workspace node_modules", () => {
    const home = "/home/user";
    const wsDir = "/projects/myapp";
    const globalPath = `${home}/.bun/bin/pi`;
    const wsPath = join(wsDir, "node_modules", ".bin", "pi");
    const result = resolvePiBinary({
      platform: "linux",
      home,
      workspaceDirs: [wsDir],
      access: mockAccess(new Set([globalPath, wsPath])),
      readdir: mockReaddir({}),
      pathEnv: "",
    });
    expect(result).toBe(globalPath);
  });

  it("prefers PATH over workspace node_modules", () => {
    const wsDir = "/projects/myapp";
    const pathPi = "/home/user/.nvm/versions/node/v22/bin/pi";
    const wsPi = join(wsDir, "node_modules", ".bin", "pi");
    const result = resolvePiBinary({
      platform: "linux",
      home: "/home/user",
      workspaceDirs: [wsDir],
      access: mockAccess(new Set([pathPi, wsPi])),
      readdir: mockReaddir({}),
      pathEnv: "/usr/bin:/home/user/.nvm/versions/node/v22/bin",
    });
    expect(result).toBe(pathPi);
  });

  it("finds pi in nvm versions when PATH lacks nvm", () => {
    const home = "/home/user";
    const nvmPi = `${home}/.nvm/versions/node/v22.15.0/bin/pi`;
    const result = resolvePiBinary({
      platform: "linux",
      home,
      workspaceDirs: [],
      access: mockAccess(new Set([nvmPi])),
      readdir: mockReaddir({
        [`${home}/.nvm/versions/node`]: ["v18.20.0", "v22.15.0", "v20.11.0"],
      }),
      pathEnv: "/usr/bin",
    });
    expect(result).toBe(nvmPi);
  });

  it("prefers newest nvm version", () => {
    const home = "/home/user";
    const v22Pi = `${home}/.nvm/versions/node/v22.15.0/bin/pi`;
    const v18Pi = `${home}/.nvm/versions/node/v18.20.0/bin/pi`;
    const result = resolvePiBinary({
      platform: "linux",
      home,
      workspaceDirs: [],
      access: mockAccess(new Set([v22Pi, v18Pi])),
      readdir: mockReaddir({
        [`${home}/.nvm/versions/node`]: ["v18.20.0", "v22.15.0"],
      }),
      pathEnv: "",
    });
    expect(result).toBe(v22Pi);
  });

  it("finds pi via fnm", () => {
    const home = "/home/user";
    const fnmPi = `${home}/.local/share/fnm/node-versions/v22.0.0/installation/bin/pi`;
    const result = resolvePiBinary({
      platform: "linux",
      home,
      workspaceDirs: [],
      access: mockAccess(new Set([fnmPi])),
      readdir: mockReaddir({
        [`${home}/.local/share/fnm/node-versions`]: ["v22.0.0"],
      }),
      pathEnv: "",
    });
    expect(result).toBe(fnmPi);
  });

  it("finds pi via volta", () => {
    const home = "/home/user";
    const voltaPi = `${home}/.volta/bin/pi`;
    const result = resolvePiBinary({
      platform: "linux",
      home,
      workspaceDirs: [],
      access: mockAccess(new Set([voltaPi])),
      readdir: mockReaddir({}),
      pathEnv: "",
    });
    expect(result).toBe(voltaPi);
  });

  it("skips global unix paths on windows", () => {
    const home = "C:\\Users\\dev";
    const result = resolvePiBinary({
      platform: "win32",
      home,
      workspaceDirs: [],
      access: mockAccess(new Set()),
      pathEnv: "",
    });
    expect(result).toBe("pi");
  });

  it("finds pi in PATH on unix", () => {
    const result = resolvePiBinary({
      platform: "linux",
      home: "/home/user",
      workspaceDirs: [],
      access: mockAccess(new Set(["/usr/local/bin/pi"])),
      readdir: mockReaddir({}),
      pathEnv: "/usr/bin:/usr/local/bin",
    });
    expect(result).toBe("/usr/local/bin/pi");
  });

  it("finds pi.cmd in PATH on windows", () => {
    const piCmd = join("C:\\Users\\dev\\scoop\\apps\\nodejs\\current\\bin", "pi.cmd");
    const result = resolvePiBinary({
      platform: "win32",
      home: "C:\\Users\\dev",
      workspaceDirs: [],
      access: mockAccess(new Set([piCmd])),
      pathEnv: "C:\\Windows\\system32;C:\\Users\\dev\\scoop\\apps\\nodejs\\current\\bin",
    });
    expect(result).toBe(piCmd);
  });

  it("uses F_OK on windows, X_OK on unix", () => {
    const modes: number[] = [];
    const access = (path: string, mode: number) => {
      modes.push(mode);
      if (path.includes("pi")) return;
      throw new Error("ENOENT");
    };

    resolvePiBinary({
      platform: "win32",
      workspaceDirs: [],
      pathEnv: "C:\\bin",
      access,
    });
    expect(modes.every((m) => m === constants.F_OK)).toBe(true);

    modes.length = 0;
    resolvePiBinary({
      platform: "linux",
      workspaceDirs: [],
      pathEnv: "/usr/bin",
      access,
      readdir: mockReaddir({}),
    });
    expect(modes.every((m) => m === constants.X_OK)).toBe(true);
  });

  it("falls back to 'pi' when nothing found", () => {
    const result = resolvePiBinary({
      platform: "linux",
      home: "/home/user",
      workspaceDirs: [],
      access: mockAccess(new Set()),
      readdir: mockReaddir({}),
      pathEnv: "/usr/bin:/usr/local/bin",
    });
    expect(result).toBe("pi");
  });
});

describe("resolvePiBinDir", () => {
  it("returns directory for absolute path", () => {
    expect(resolvePiBinDir("/home/user/.nvm/versions/node/v22/bin/pi")).toBe(
      "/home/user/.nvm/versions/node/v22/bin",
    );
  });

  it("returns undefined for bare name", () => {
    expect(resolvePiBinDir("pi")).toBeUndefined();
  });
});
