#!/usr/bin/env bun
import plugin from "bun-plugin-tailwind";
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

const entrypoints = ["./src/index.ts"];

const result = await Bun.build({
  entrypoints,
  outdir,
  plugins: [
    plugin,
    {
      name: "Path shim",
      setup(build) {
        build.onResolve({ filter: /^path$/ }, (args) => {
          return { namespace: "node-shim", path: "path.js" };
        });
        build.onLoad(
          { namespace: "node-shim", filter: /^path.js$/ },
          (args) => {
            return {
              contents:
                "module.exports = {extname: (path) => {const split = path.split('/'); const dotSplit = split[split.length-1].split('.'); return '.' + dotSplit[dotSplit.length-1]}, join: (...segments) => segments.join('/') }",
            };
          },
        );
      },
    },
  ],
  minify: true,
  target: "bun",
  compile: true,
  bytecode: true, // Decrease startup time for the server
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

const end = performance.now();

console.log(
  `Output file path: ${path.relative(process.cwd(), result.outputs[0]!.path)}`,
);
const buildTime = (end - start).toFixed(2);

console.log(`\n✅ Build completed in ${buildTime}ms\n`);
