import { z } from "zod";
import type { HarnessCapability, Scope } from "../core/types.js";

/**
 * Skema manifest adapter (spec §8). Adapter adalah data: menambah harness berarti
 * menambah file JSON, bukan menambah kode.
 */

const httpUrl = z.string().regex(/^https?:\/\/\S+$/, "harus URL http(s)");

const storeSchema = z.object({
  scope: z.enum(["global", "project"]),
  path: z.string().min(1),
  exclusive: z.boolean(),
  members: z.array(z.string().min(1)).optional(),
});

const detectSchema = z.object({
  paths: z.array(z.string().min(1)),
  binaries: z.array(z.string().min(1)),
  versionArgs: z.array(z.string()),
});

export const adapterSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id hanya huruf kecil, angka, dan tanda hubung"),
  name: z.string().min(1),
  tier: z.enum(["managed", "detected-only"]),
  detect: detectSchema,
  stores: z.array(storeSchema),
  readsShared: z.boolean(),
  connect: z.object({ installUrl: httpUrl, docsUrl: httpUrl.optional() }).optional(),
  verified: z
    .object({
      at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "format tanggal harus YYYY-MM-DD"),
      source: httpUrl,
    })
    .optional(),
  notes: z.string().min(1).optional(),
});

export type Adapter = z.infer<typeof adapterSchema>;
export type AdapterStore = Adapter["stores"][number];
export type AdapterTier = Adapter["tier"];
export type AdapterScope = Scope;

export function adapterCapability(adapter: Adapter): HarnessCapability {
  return adapter.tier === "managed" && adapter.verified !== undefined ? "managed" : "detected";
}
