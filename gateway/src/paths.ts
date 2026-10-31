import { realpathSync } from "node:fs";
import path from "node:path";

export function resolveProjectPath(candidate: string, roots: string[]): string {
  const resolvedRoots = roots.map((root) => realpathSync(root));
  const resolved = realpathSync(candidate);
  const allowed = resolvedRoots.some((root) => {
    const relative = path.relative(root, resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  if (!allowed) {
    throw new Error("项目路径不在允许的根目录内");
  }
  return resolved;
}
