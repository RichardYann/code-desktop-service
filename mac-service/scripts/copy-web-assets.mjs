import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(scriptDir, "..");

export function copyWebAssets(root = serviceRoot) {
  const sourceDir = path.join(root, "src", "web");
  const targetDir = path.join(root, "dist", "web");
  fs.mkdirSync(targetDir, { recursive: true });
  for (const fileName of ["index.html", "main.js"]) {
    fs.copyFileSync(path.join(sourceDir, fileName), path.join(targetDir, fileName));
  }
}

copyWebAssets();
