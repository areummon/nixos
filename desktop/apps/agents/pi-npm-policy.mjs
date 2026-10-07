import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Keep Pi's dependency list mutable, but persist these targeted npm policies.
export function applyPolicy(manifest) {
  return {
    ...manifest,
    dependencies: { ...manifest.dependencies, "@earendil-works/gondolin": "^0.13.0" },
    overrides: { ...manifest.overrides, "@modelcontextprotocol/sdk": "1.32.1" },
    allowScripts: { ...manifest.allowScripts, "tree-sitter-bash": false },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2];
  if (!target) throw new Error("Expected npm package.json path");
  const original = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  const manifest = original ? JSON.parse(original) : { name: "pi-extensions", private: true };
  const result = JSON.stringify(applyPolicy(manifest), null, 2) + "\n";
  if (result !== original) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, result);
    console.log("changed");
  }
}
