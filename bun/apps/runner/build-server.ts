#!/usr/bin/env bun
import { existsSync } from "fs";
import { rm } from "fs/promises";
import path from "path";

console.log("\n🚀 Starting build process...\n");

const outdir = path.join(process.cwd(), "dist");

if (existsSync(outdir)) {
  console.log(`🗑️ Cleaning previous build at ${outdir}`);
  await rm(outdir, { recursive: true, force: true });
}

const start = performance.now();

const entrypoints = ["./index.ts"];

const result = await Bun.build({
  entrypoints,
  outdir,
  plugins: [],
  target: "bun",
  compile: true,
  bytecode: true, // Decrease startup time
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

const end = performance.now();

console.log(`Output file path: ${path.relative(process.cwd(), result.outputs[0]!.path)}`);
const buildTime = (end - start).toFixed(2);

console.log(`\n✅ Build completed in ${buildTime}ms\n`);
