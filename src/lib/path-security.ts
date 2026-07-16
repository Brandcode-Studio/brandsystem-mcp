import { isAbsolute, relative, resolve, dirname, join, basename } from "node:path";
import { realpathSync } from "node:fs";

export function isPathWithinBase(targetPath: string, basePath: string): boolean {
  const resolvedTarget = resolve(targetPath);
  const resolvedBase = resolve(basePath);
  const relativeTarget = relative(resolvedBase, resolvedTarget);

  return relativeTarget === "" || (!relativeTarget.startsWith("..") && !isAbsolute(relativeTarget));
}

/**
 * Resolve a path through the real filesystem (following symlinks) so that a
 * symlink inside the base pointing outside it cannot pass the containment
 * check. For paths that do not exist yet, the deepest existing ancestor is
 * realpath-resolved and the remaining (not-yet-created) tail is re-appended.
 */
export function realResolve(targetPath: string): string {
  let current = resolve(targetPath);
  const tail: string[] = [];

  // Walk up until we find an existing ancestor we can realpath.
  // Bounded by path depth; dirname("/") === "/" terminates the loop.
  for (;;) {
    try {
      const real = realpathSync(current);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(targetPath);
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Symlink-aware containment check: both sides are resolved through the real
 * filesystem before comparison. Use this for any path derived from tool input
 * or untrusted content; the lexical isPathWithinBase alone is not sufficient.
 */
export function isRealPathWithinBase(targetPath: string, basePath: string): boolean {
  return isPathWithinBase(realResolve(targetPath), realResolve(basePath));
}

export function assertPathWithinBase(targetPath: string, basePath: string, label: string): string {
  const resolvedTarget = resolve(targetPath);
  if (!isPathWithinBase(resolvedTarget, basePath)) {
    throw new Error(`Path traversal blocked: ${label}`);
  }
  if (!isRealPathWithinBase(resolvedTarget, basePath)) {
    throw new Error(`Path traversal blocked (symlink escape): ${label}`);
  }

  return resolvedTarget;
}
