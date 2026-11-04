import antigravity from "./antigravity.json" with { type: "json" };
import claudeCode from "./claude-code.json" with { type: "json" };
import crush from "./crush.json" with { type: "json" };
import devin from "./devin.json" with { type: "json" };
import goose from "./goose.json" with { type: "json" };
import hermes from "./hermes.json" with { type: "json" };
import { type Adapter, adapterSchema } from "./manifest.js";
import opencode from "./opencode.json" with { type: "json" };
import shared from "./shared.json" with { type: "json" };

/**
 * Manifest bawaan, dibundel sebagai modul JSON (kontrak §8a): tidak ada file
 * runtime yang dibaca relatif terhadap cwd. Urutan ini juga urutan tampil di UI.
 * Manifest yang tidak valid menggagalkan impor modul, bukan diam-diam dilewati.
 */
export const BUNDLED_ADAPTERS: readonly Adapter[] = [
  claudeCode,
  opencode,
  antigravity,
  shared,
  hermes,
  goose,
  crush,
  devin,
].map((raw) => adapterSchema.parse(raw));
