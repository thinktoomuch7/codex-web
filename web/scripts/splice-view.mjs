import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

const appPath = new URL("../src/App.tsx", import.meta.url);
const tailPath = new URL("../src/workspace-return.tsx", import.meta.url);
const source = readFileSync(appPath, "utf8");
const marker = '  if (phase === "loading") {';
const index = source.indexOf(marker);
if (index < 0) throw new Error("marker missing");
writeFileSync(appPath, source.slice(0, index) + readFileSync(tailPath, "utf8"));
unlinkSync(tailPath);
