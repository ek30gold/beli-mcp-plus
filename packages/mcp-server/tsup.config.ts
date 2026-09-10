import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  target: "node18",
  // Bundle the workspace libraries so `npx beli-mcp` is self-contained.
  noExternal: [/^@beli\//],
  // `undici` is an optional runtime dep resolved via dynamic import; bundling
  // it would make it mandatory and defeat the graceful-degradation path.
  external: ["@modelcontextprotocol/sdk", "zod", "undici"],
});
