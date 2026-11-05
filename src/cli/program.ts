import { Command, InvalidArgumentError } from "commander";
import { SkillManagerError } from "../core/errors.js";
import { APP_VERSION } from "../server/app.js";
import type { RunningServer } from "../server/index.js";
import {
  addCommand,
  type CliDeps,
  defaultCliDeps,
  detectCommand,
  doctorCommand,
  installCommand,
  listCommand,
  syncCommand,
  uninstallCommand,
} from "./commands.js";
import { serve } from "./serve.js";

interface JsonOption {
  json?: boolean;
}

interface ServeCliOptions extends JsonOption {
  port: number;
  open: boolean;
}

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new InvalidArgumentError(`Port harus bilangan bulat 0-65535, diterima: ${raw}`);
  }
  return port;
}

function registerShutdown(running: RunningServer): void {
  let closing = false;
  const shutdown = (): void => {
    if (closing) {
      return;
    }
    closing = true;
    void running.close().then(
      () => {
        process.exitCode = 0;
      },
      () => {
        process.exitCode = 1;
      },
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("skill-manager")
    .description("Kelola satu Library skill AI dan pasang salinannya ke banyak harness.")
    .version(APP_VERSION)
    .option("--json", "cetak hasil sebagai JSON");

  function withJson(command: Command): Command {
    return command.option("--json", "cetak hasil sebagai JSON");
  }

  function wantsJson(options: JsonOption): boolean {
    return options.json === true || program.opts().json === true;
  }

  /** Dependensi produksi; dibuat per-perintah agar tidak ada I/O saat impor. */
  function createDeps(): CliDeps {
    return defaultCliDeps();
  }

  /** Ringkasan satu baris untuk pemakaian manusia; `--json` memakai bentuk utuh. */
  function formatHuman(name: string, result: unknown): string {
    const value = result as Record<string, unknown>;
    if (name === "list" && Array.isArray(value.skills)) {
      if (value.skills.length === 0) {
        return "Library kosong. Tambahkan skill dengan `skill-manager add <sumber>`.";
      }
      return value.skills
        .map((skill) => {
          const entry = skill as Record<string, unknown>;
          return `${String(entry.name)} (${String(entry.source === undefined ? "-" : (entry.source as Record<string, unknown>).type)})`;
        })
        .join("\n");
    }
    if (name === "detect" && Array.isArray(value.harnesses)) {
      return value.harnesses
        .map((harness) => {
          const entry = harness as Record<string, unknown>;
          const mark = entry.detected === true ? "terdeteksi" : "tidak terdeteksi";
          return `${String(entry.id)}: ${mark}`;
        })
        .join("\n");
    }
    return JSON.stringify(result, null, 2);
  }

  /**
   * Jalankan perintah domain dan cetak hasilnya. Galat domain menjadi exit
   * code 1 dengan kode stabil (kontrak CLI), bukan stack trace.
   */
  async function run(
    name: string,
    options: JsonOption,
    action: (deps: CliDeps) => Promise<unknown>,
  ): Promise<void> {
    try {
      const result = await action(createDeps());
      if (wantsJson(options)) {
        console.log(JSON.stringify(result));
      } else {
        console.log(formatHuman(name, result));
      }
    } catch (error) {
      const code = error instanceof SkillManagerError ? error.code : "internal_error";
      const message = error instanceof Error ? error.message : String(error);
      if (wantsJson(options)) {
        console.log(JSON.stringify({ error: { code, message } }));
      } else {
        console.error(`skill-manager: [${code}] ${message}`);
      }
      process.exitCode = 1;
    }
  }
  withJson(program.command("detect"))
    .description("Deteksi harness yang terpasang di mesin ini")
    .action((options: JsonOption) => run("detect", options, (deps) => detectCommand(deps)));

  withJson(program.command("add"))
    .description("Impor skill dari folder, URL git, atau file zip")
    .argument("<sumber>", "folder, URL git, atau file zip")
    .option("--ref <ref>", "ref git yang dipin")
    .action((sumber: string, options: JsonOption & { ref?: string }) =>
      run("add", options, (deps) =>
        addCommand(deps, sumber, options.ref === undefined ? {} : { ref: options.ref }),
      ),
    );

  withJson(program.command("list"))
    .description("Daftar skill di Library")
    .action((options: JsonOption) => run("list", options, (deps) => listCommand(deps)));

  withJson(program.command("install"))
    .description("Pasang skill ke satu atau lebih target")
    .argument("<skill>", "nama skill di Library")
    .requiredOption("--to <targets>", "target dipisah koma, mis. claude-code/global")
    .option("--shared", "pasang lewat grup shared")
    .action((skill: string, options: JsonOption & { to: string; shared?: boolean }) =>
      run("install", options, (deps) =>
        installCommand(
          deps,
          skill,
          options.shared === true ? { to: options.to, shared: true } : { to: options.to },
        ),
      ),
    );

  withJson(program.command("uninstall"))
    .description("Cabut skill dari satu atau lebih target")
    .argument("<skill>", "nama skill di Library")
    .requiredOption("--from <targets>", "target dipisah koma, mis. claude-code/global")
    .option("--force", "hapus meski isi Store sudah diubah (drift)")
    .option("--shared", "izinkan mencabut dari grup shared")
    .action(
      (skill: string, options: JsonOption & { from: string; force?: boolean; shared?: boolean }) =>
        run("uninstall", options, (deps) =>
          uninstallCommand(deps, skill, {
            from: options.from,
            ...(options.force === true ? { force: true } : {}),
            ...(options.shared === true ? { acknowledgeShared: true } : {}),
          }),
        ),
    );

  withJson(program.command("sync"))
    .description("Sinkronkan installation yang drift dengan Library")
    .option("--skill <nama>", "batasi ke satu skill")
    .option("--adopt", "jadikan isi Store sebagai sumber kebenaran Library")
    .action((options: JsonOption & { skill?: string; adopt?: boolean }) =>
      run("sync", options, (deps) =>
        syncCommand(deps, {
          ...(options.skill === undefined ? {} : { skill: options.skill }),
          ...(options.adopt === true ? { adopt: true } : {}),
        }),
      ),
    );

  withJson(program.command("doctor"))
    .description("Laporkan installation hilang, direktori unmanaged, dan sisa temp")
    .action((options: JsonOption) => run("doctor", options, (deps) => doctorCommand(deps)));
  withJson(program.command("serve"))
    .description("Jalankan server lokal dan buka UI di browser")
    .option("--port <port>", "port TCP (0 = acak)", parsePort, 0)
    .option("--no-open", "jangan buka browser")
    .action(async (options: ServeCliOptions) => {
      const running = await serve({
        port: options.port,
        open: options.open,
        json: wantsJson(options),
      });
      registerShutdown(running);
    });

  return program;
}
