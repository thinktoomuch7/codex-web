import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type GitResult = { stdout: string; stderr: string };
export type GitRunner = (cwd: string, args: string[]) => Promise<GitResult>;

function defaultRunner(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const failure = error as Error & { stderr?: string };
        failure.message = [failure.message, stderr].filter(Boolean).join("\n");
        reject(failure);
        return;
      }
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

let runner: GitRunner = defaultRunner;

export function setGitRunner(next: GitRunner | null): void {
  runner = next ?? defaultRunner;
}

export function runGit(cwd: string, args: string[]): Promise<GitResult> {
  return runner(cwd, args);
}

export function runCommand(command: string, args: string[], cwd: string): Promise<GitResult> {
  if (command === "git") return runner(cwd, args);
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const failure = error as NodeJS.ErrnoException;
        if (failure.code === "ENOENT") {
          reject(new Error(`${command} 不存在`));
          return;
        }
        failure.message = redactSecrets([failure.message, stderr].filter(Boolean).join("\n"));
        reject(failure);
        return;
      }
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const result = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return result.stdout.trim() === "true";
  } catch {
    return false;
  }
}

export function worktreeCheckoutPath(repo: string, branch: string): string {
  const leaf = branch.replaceAll("/", "-").replaceAll("\\", "-");
  return path.join(path.dirname(repo), `${path.basename(repo)}-worktrees`, leaf);
}

export function assertWorktreeAllowed(target: string, repo: string, projects: string[]): void {
  if (projects.some((project) => isInside(project, target)) || isInside(repo, target)) {
    throw new Error("检出不能放进已登记项目或仓库里面");
  }
}

export async function addWorktree(repo: string, target: string, branch: string): Promise<void> {
  mkdirSync(path.dirname(target), { recursive: true });
  await runGit(repo, ["worktree", "add", "-b", branch, target]);
}

export async function moveWorktree(repo: string, from: string, to: string): Promise<void> {
  mkdirSync(path.dirname(to), { recursive: true });
  await runGit(repo, ["worktree", "move", from, to]);
}

export async function removeWorktree(repo: string, target: string): Promise<void> {
  await runGit(repo, ["worktree", "remove", "--force", target]);
}

export function safeRelative(cwd: string, candidate: string): string {
  if (!candidate || path.isAbsolute(candidate) || candidate.split(/[\\/]/).includes("..")) {
    throw new Error("路径不合法");
  }
  const resolved = path.resolve(cwd, candidate);
  if (!isInside(cwd, resolved)) throw new Error("路径不合法");
  return candidate;
}

export function redactSecrets(message: string): string {
  return message
    .replace(/ghp_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}
