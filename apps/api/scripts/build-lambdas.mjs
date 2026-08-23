import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';
import { createWriteStream } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const repoRoot = path.resolve(apiRoot, '..', '..');
const outDir = path.join(apiRoot, 'dist');
const zipOutDir = path.join(repoRoot, 'dist');

const entries = {
  api: 'src/entries/api-lambda.ts',
  'ingest-orchestrator': 'src/entries/orchestrator-lambda.ts',
  'ingest-worker': 'src/entries/worker-lambda.ts',
};

await mkdir(outDir, { recursive: true });
await mkdir(zipOutDir, { recursive: true });

for (const [name, entry] of Object.entries(entries)) {
  await build({
    entryPoints: [path.join(apiRoot, entry)],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: path.join(outDir, `${name}.js`),
    sourcemap: false,
    minify: false,
    logLevel: 'info',
  });

  const zipPath = path.join(zipOutDir, `${name}.zip`);
  await new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(path.join(outDir, `${name}.js`), { name: `${name}.js` });
    void archive.finalize();
  });
  console.log(`built ${zipPath}`);
}

await rm(outDir, { force: true, recursive: true });
