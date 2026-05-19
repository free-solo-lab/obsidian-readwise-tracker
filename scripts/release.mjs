import { mkdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = new URL('..', import.meta.url);
const outDir = path.resolve(projectRoot.pathname, 'release', 'readwise-reading-tracker');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await copyFile(path.resolve(projectRoot.pathname, 'main.js'), path.resolve(outDir, 'main.js'));
await copyFile(path.resolve(projectRoot.pathname, 'manifest.json'), path.resolve(outDir, 'manifest.json'));
await copyFile(path.resolve(projectRoot.pathname, 'styles.css'), path.resolve(outDir, 'styles.css'));
await copyFile(path.resolve(projectRoot.pathname, 'versions.json'), path.resolve(outDir, 'versions.json'));

process.stdout.write(`Release ready: ${outDir}\n`);
