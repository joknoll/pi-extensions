import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

export function countChanges(diff: string): { additions: number; removals: number } {
  let additions = 0;
  let removals = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) removals++;
  }
  return { additions, removals };
}

export function displayPath(path: string, cwd: string): string {
  const absolutePath = resolve(cwd, path);
  const relativePath = relative(cwd, absolutePath);
  if (relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
    return relativePath;
  }
  const home = homedir();
  return absolutePath === home || absolutePath.startsWith(`${home}/`)
    ? `~${absolutePath.slice(home.length)}`
    : path;
}
