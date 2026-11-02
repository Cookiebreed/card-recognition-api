// Builds the Claude Desktop extension (MCP Bundle): mcpb/manifest.json + icon, the built server and its production
// dependencies, packed with @anthropic-ai/mcpb into neosatoshi-card-mcp-<version>.mcpb. The version comes from package.json.
//
// Run: npm run build:mcpb
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const stage = path.join(root, "mcpb-build");
// A fixed name, so https://github.com/Cookiebreed/card-recognition-api/releases/latest/download/neosatoshi-card-mcp.mcpb
// always points at the newest release asset.
const out = path.join(root, "neosatoshi-card-mcp.mcpb");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, "server"), { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(root, "mcpb", "manifest.json"), "utf8"));
manifest.version = pkg.version;
fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.copyFileSync(path.join(root, "mcpb", "icon.png"), path.join(stage, "icon.png"));
fs.cpSync(path.join(root, "dist"), path.join(stage, "server", "dist"), { recursive: true });
for (const f of ["package.json", "package-lock.json", "LICENSE", "README.md"]) fs.copyFileSync(path.join(root, f), path.join(stage, "server", f));
run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], path.join(stage, "server"));
run("npx", ["-y", "@anthropic-ai/mcpb@2.1.2", "validate", path.join(stage, "manifest.json")], root);
run("npx", ["-y", "@anthropic-ai/mcpb@2.1.2", "pack", stage, out], root);
fs.rmSync(stage, { recursive: true, force: true });
console.log(`Built ${path.relative(root, out)}`);
