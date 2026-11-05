import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli/index.ts",
    server: "src/server/index.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  splitting: false,
  // Manifest adapter adalah modul JSON (kontrak §8a): esbuild menyisipkan
  // isinya ke bundel, jadi tidak ada file runtime yang dibaca relatif ke cwd.
  loader: { ".json": "json" },
  sourcemap: false,
  dts: false,
  treeshake: true,
});
