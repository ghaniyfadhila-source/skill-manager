import type { DepCommand } from "../core/types.js";
import { type FileSystem, type FsResult, fsOk } from "../fs/types.js";
import { detectDependencies, IGNORE_SCRIPTS_FLAG } from "./detect.js";

export interface PlanDependenciesOptions {
  readonly dataRoot: string;
  readonly skillId: string;
  /** true melepas `--ignore-scripts`; pemanggil wajib meminta konfirmasi terpisah. */
  readonly allowScripts?: boolean;
  readonly platform?: NodeJS.Platform;
}

/**
 * Susun perintah PERSIS yang akan dijalankan (spec §10.6 poin 2-4).
 *
 * Default npm memakai `--ignore-scripts`. `allowScripts: true` melepas flag itu;
 * keputusan itu milik user dan tidak boleh dijalankan tanpa konfirmasi. Tidak
 * ada proses yang dijalankan di sini: plan murni menyusun argumen.
 */
export async function planDependencies(
  fs: FileSystem,
  skillDir: string,
  options: PlanDependenciesOptions,
): Promise<FsResult<readonly DepCommand[]>> {
  const detected = await detectDependencies(fs, skillDir, options);
  if (!detected.ok || options.allowScripts !== true) {
    return detected;
  }

  return fsOk(
    detected.value.map((command): DepCommand => {
      if (command.kind !== "npm") {
        return command;
      }
      return {
        ...command,
        args: command.args.filter((arg) => arg !== IGNORE_SCRIPTS_FLAG),
        reason: `${command.reason}; script lifecycle diizinkan`,
      };
    }),
  );
}
