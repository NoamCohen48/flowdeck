/**
 * Where the CLI keeps what it knows: per user, the server and the name to act as
 * (`~/.config/flowdeck/config.json`); per folder, which product it is and the
 * suite as last pulled (`.flowdeck/`). The pulled copy is the merge base — it is
 * how `status` knows what you changed and how `pull` keeps your edits.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Suite } from "@flowdeck/domain";

export interface UserConfig {
  url?: string;
  actor?: string;
}

export interface ProjectState {
  url: string;
  product: string;
  productId: string;
  revision: string;
  pulledAt: string;
}

const configPath = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "flowdeck", "config.json");

export async function readConfig(): Promise<UserConfig> {
  try { return JSON.parse(await readFile(configPath(), "utf8")) as UserConfig; } catch { return {}; }
}

export async function writeConfig(c: UserConfig) {
  await mkdir(dirname(configPath()), { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(c, null, 2)}\n`);
}

export { configPath };

/** The nearest folder at or above `from` with a `.flowdeck/state.json`, like git finds `.git`. */
export function findRoot(from = process.cwd()): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, ".flowdeck", "state.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

export async function readState(root: string): Promise<ProjectState> {
  return JSON.parse(await readFile(join(root, ".flowdeck", "state.json"), "utf8")) as ProjectState;
}

export async function readBase(root: string): Promise<Suite | undefined> {
  try { return JSON.parse(await readFile(join(root, ".flowdeck", "base.json"), "utf8")) as Suite; } catch { return undefined; }
}

export async function writeState(root: string, state: ProjectState, base: Suite) {
  await mkdir(join(root, ".flowdeck"), { recursive: true });
  await writeFile(join(root, ".flowdeck", "state.json"), `${JSON.stringify(state, null, 2)}\n`);
  await writeFile(join(root, ".flowdeck", "base.json"), `${JSON.stringify(base, null, 2)}\n`);
  // Per checkout, not per team: two people sharing the folder in git each have their own base.
  await writeFile(join(root, ".flowdeck", ".gitignore"), "*\n");
}
