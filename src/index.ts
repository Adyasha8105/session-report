import { createProgram } from './cli/program.js';

const program = createProgram();
program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
