import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

const root = resolve(import.meta.dirname, "..");
const packageJson = readJson(resolve(root, "package.json"));
const packageLock = readJson(resolve(root, "package-lock.json"));
const serverJson = readJson(resolve(root, "server.json"));

const expectedVersion = packageJson.version;
const mismatches = [];

if (typeof serverJson.description !== "string" || serverJson.description.length > 100) {
  mismatches.push(
    `server.json description must be a string of at most 100 characters (received ${serverJson.description?.length ?? "missing"})`,
  );
}

if (packageLock.version !== expectedVersion) {
  mismatches.push(`package-lock.json version is ${packageLock.version}, expected ${expectedVersion}`);
}

if (packageLock.packages?.[""]?.version !== expectedVersion) {
  mismatches.push(`package-lock.json root package version is ${packageLock.packages?.[""]?.version}, expected ${expectedVersion}`);
}

if (serverJson.version !== expectedVersion) {
  mismatches.push(`server.json version is ${serverJson.version}, expected ${expectedVersion}`);
}

const packageEntry = serverJson.packages?.find((entry) => entry.identifier === packageJson.name);
if (!packageEntry) {
  mismatches.push(`server.json is missing a package entry for ${packageJson.name}`);
} else if (packageEntry.version !== expectedVersion) {
  mismatches.push(`server.json package entry version is ${packageEntry.version}, expected ${expectedVersion}`);
}

if (mismatches.length > 0) {
  console.error("Release metadata is out of sync:");
  for (const mismatch of mismatches) {
    console.error(`- ${mismatch}`);
  }
  process.exit(1);
}

console.log(`Release metadata OK: ${expectedVersion}`);
