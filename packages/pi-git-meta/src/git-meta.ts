import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
type Exec = Pick<ExtensionAPI, "exec">;
export class GitMeta {
  constructor(
    private pi: Exec,
    private command: string,
    private cwd: string,
  ) {}
  async run(args: string[]) {
    const r = await this.pi.exec(this.command, args, { cwd: this.cwd, timeout: 30000 });
    if (r.code !== 0) throw new Error(r.stderr.trim() || `${this.command} failed`);
    return r.stdout.trim();
  }
  set(target: string, key: string, value: string) {
    return this.run(["set", target, key, value]);
  }
  add(target: string, key: string, value: string) {
    return this.run(["set:add", target, key, value]);
  }
  remove(target: string, key: string, value: string) {
    return this.run(["set:rm", target, key, value]);
  }
}
