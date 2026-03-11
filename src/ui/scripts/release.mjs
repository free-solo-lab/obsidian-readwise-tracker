import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = new URL('..', import.meta.url);
const outDir = path.resolve(projectRoot.pathname, 'release', 'obsidian-readwise-tracker');

await mkdir(outDir, { recursive: true });

await copyFile(path.resolve(projectRoot.pathname, 'main.js'), path.resolve(outDir, 'main.js'));
await copyFile(path.resolve(projectRoot.pathname, 'manifest.json'), path.resolve(outDir, 'manifest.json'));

process.stdout.write(`Release ready: ${outDir}\n`);
