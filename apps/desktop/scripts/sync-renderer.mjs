import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const desktopRoot = path.resolve(__dirname, '..');
const rendererDist = path.resolve(desktopRoot, '..', 'h5', 'dist-desktop');
const targetDist = path.resolve(desktopRoot, 'renderer-dist');

async function main() {
    await rm(targetDist, { recursive: true, force: true });
    await mkdir(targetDist, { recursive: true });
    await cp(rendererDist, targetDist, { recursive: true });
    console.log(`[desktop] Copied renderer bundle: ${rendererDist} -> ${targetDist}`);
}

main().catch((error) => {
    console.error('[desktop] Failed to copy renderer bundle', error);
    process.exitCode = 1;
});
