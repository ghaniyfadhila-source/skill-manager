#!/usr/bin/env node
import { createProgram } from "./program.js";

export { createProgram } from "./program.js";

export async function main(argv: readonly string[]): Promise<void> {
  const program = createProgram();
  await program.parseAsync([...argv]);
}

if (import.meta.main) {
  main(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`skill-manager: ${message}`);
    process.exitCode = 1;
  });
}
