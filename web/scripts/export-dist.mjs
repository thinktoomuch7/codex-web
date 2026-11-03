import { cpSync, existsSync, rmSync } from "node:fs";

if (!existsSync("out")) {
  console.error("next export did not write out/");
  process.exit(1);
}
rmSync("dist", { recursive: true, force: true });
cpSync("out", "dist", { recursive: true });
rmSync("out", { recursive: true, force: true });
