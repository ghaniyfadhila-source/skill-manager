import { Command, InvalidArgumentError } from "commander";
import { APP_VERSION } from "../server/app.js";
import type { RunningServer } from "../server/index.js";
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

  /**
   * Semua perintah selain serve masih berupa stub sampai ticket pemiliknya
   * mendarat. Kontrak CLI: kode galat stabil + exit code 1.
   */
  function notImplemented(name: string, options: JsonOption): void {
    const message = `Perintah "${name}" belum diimplementasikan pada v0.1 scaffold.`;
    if (wantsJson(options)) {
      console.log(
        JSON.stringify({ error: { code: "not_implemented", message, details: { command: name } } }),
      );
    } else {
      console.error(`skill-manager: [not_implemented] ${message}`);
    }
    process.exitCode = 1;
  }

  withJson(program.command("detect"))
    .description("Deteksi harness yang terpasang di mesin ini")
    .action((options: JsonOption) => {
      notImplemented("detect", options);
    });

  withJson(program.command("add"))
    .description("Impor skill dari folder, URL git, atau file zip")
    .argument("<sumber>", "folder, URL git, atau file zip")
    .option("--ref <ref>", "ref git yang dipin")
    .action((_sumber: string, options: JsonOption) => {
      notImplemented("add", options);
    });

  withJson(program.command("list"))
    .description("Daftar skill di Library")
    .action((options: JsonOption) => {
      notImplemented("list", options);
    });

  withJson(program.command("install"))
    .description("Pasang skill ke satu atau lebih target")
    .argument("<skill>", "nama skill di Library")
    .requiredOption("--to <targets>", "target dipisah koma, mis. claude-code/global")
    .option("--shared", "pasang lewat grup shared")
    .action((_skill: string, options: JsonOption) => {
      notImplemented("install", options);
    });

  withJson(program.command("uninstall"))
    .description("Cabut skill dari satu atau lebih target")
    .argument("<skill>", "nama skill di Library")
    .requiredOption("--from <targets>", "target dipisah koma, mis. claude-code/global")
    .action((_skill: string, options: JsonOption) => {
      notImplemented("uninstall", options);
    });

  withJson(program.command("sync"))
    .description("Sinkronkan installation yang drift dengan Library")
    .option("--skill <nama>", "batasi ke satu skill")
    .action((options: JsonOption) => {
      notImplemented("sync", options);
    });

  withJson(program.command("doctor"))
    .description("Laporkan installation hilang, direktori unmanaged, dan sisa temp")
    .action((options: JsonOption) => {
      notImplemented("doctor", options);
    });

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
