import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let _version: string | null = null;

export function getVersion(): string {
  if (_version) return _version;
  try {
    // Try to read from package.json at publish time
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    _version = pkg.version;
  } catch {
    _version = "0.1.0";
  }
  return _version!;
}
