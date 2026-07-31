import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
const dir = (gitDir: string) => join(gitDir, "pi-git-meta-spool");
export async function writeSpool(gitDir: string, traceId: string, body: string) {
  await mkdir(dir(gitDir), { recursive: true, mode: 0o700 });
  const target = join(dir(gitDir), `${traceId}.json`),
    temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, body, { mode: 0o600 });
  await rename(temporary, target);
  return target;
}
export async function removeSpool(path: string) {
  await rm(path, { force: true });
}
export async function recoverSpool(gitDir: string) {
  try {
    return (await readdir(dir(gitDir)))
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(dir(gitDir), name));
  } catch {
    return [];
  }
}
