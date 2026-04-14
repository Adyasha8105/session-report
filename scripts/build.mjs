import * as esbuild from 'esbuild';
import { writeFileSync, chmodSync } from 'fs';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/index.cjs',
  external: [
    'better-sqlite3',
  ],
  banner: {
    js: '#!/usr/bin/env node',
  },
  minify: false,
  sourcemap: true,
});

// Make the output executable
chmodSync('dist/index.cjs', 0o755);

console.log('Build complete: dist/index.cjs');
