import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

function removeAppleDoubleFiles(path) {
  if (!existsSync(path)) return;
  for (const name of readdirSync(path)) {
    const child = resolve(path, name);
    if (name.startsWith("._")) {
      rmSync(child, { recursive: true, force: true });
    } else if (statSync(child).isDirectory()) {
      removeAppleDoubleFiles(child);
    }
  }
}

export default async function cleanPackageMetadata(context) {
  const appDir = context.packager.projectDir;
  removeAppleDoubleFiles(resolve(appDir, "node_modules"));
  removeAppleDoubleFiles(resolve(appDir, "dist"));
  if (context.appOutDir) removeAppleDoubleFiles(context.appOutDir);
}
