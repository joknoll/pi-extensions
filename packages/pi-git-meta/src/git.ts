import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GitState } from "./types.ts";
type Exec = Pick<ExtensionAPI, "exec">;
async function run(pi: Exec, cwd: string, args: string[]) {
  const r = await pi.exec("git", args, { cwd, timeout: 5000 });
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git ${args[0]} failed`);
  return r.stdout.trim();
}
export async function discoverGit(pi: Exec, cwd: string): Promise<GitState | undefined> {
  try {
    const root = await run(pi, cwd, ["rev-parse", "--show-toplevel"]);
    const gitDir = await run(pi, root, ["rev-parse", "--path-format=absolute", "--git-dir"]);
    const head = await run(pi, root, ["rev-parse", "--verify", "HEAD"]).catch(() => undefined);
    const branch = await run(pi, root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(
      () => undefined,
    );
    return { root, gitDir, head, branch };
  } catch {
    return undefined;
  }
}
export async function commitsSince(
  pi: Exec,
  cwd: string,
  base: string | undefined,
  head: string | undefined,
) {
  if (!head || head === base) return [] as string[];
  if (!base)
    return (await run(pi, cwd, ["rev-list", "--reverse", head])).split("\n").filter(Boolean);
  try {
    const ancestor = await run(pi, cwd, ["merge-base", "--is-ancestor", base, head])
      .then(() => true)
      .catch(() => false);
    return ancestor
      ? (await run(pi, cwd, ["rev-list", "--reverse", `${base}..${head}`]))
          .split("\n")
          .filter(Boolean)
      : [];
  } catch {
    return [];
  }
}
