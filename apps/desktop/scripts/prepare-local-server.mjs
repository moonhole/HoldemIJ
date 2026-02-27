import { chmod, cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const serverRoot = path.resolve(repoRoot, 'apps', 'server');
const dataRoot = path.resolve(repoRoot, 'data');
const outputRoot = path.resolve(desktopRoot, 'local-server-dist');
const outputBinDir = path.resolve(outputRoot, 'bin');
const outputDataDir = path.resolve(outputRoot, 'data');

function mapGoOs(nodePlatform) {
    switch (nodePlatform) {
        case 'win32':
            return 'windows';
        case 'darwin':
            return 'darwin';
        case 'linux':
            return 'linux';
        default:
            throw new Error(`Unsupported platform for local server build: ${nodePlatform}`);
    }
}

function mapGoArch(nodeArch) {
    switch (nodeArch) {
        case 'x64':
            return 'amd64';
        case 'arm64':
            return 'arm64';
        default:
            throw new Error(`Unsupported arch for local server build: ${nodeArch}`);
    }
}

function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: 'inherit',
            ...options,
        });

        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(
                new Error(
                    `Command failed: ${command} ${args.join(' ')} (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
                )
            );
        });
    });
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function main() {
    const goBinary = process.env.GO_BINARY && process.env.GO_BINARY.trim() !== '' ? process.env.GO_BINARY.trim() : 'go';
    const goos = process.env.ELECTRON_SERVER_GOOS && process.env.ELECTRON_SERVER_GOOS.trim() !== ''
        ? process.env.ELECTRON_SERVER_GOOS.trim()
        : mapGoOs(process.platform);
    const goarch = process.env.ELECTRON_SERVER_GOARCH && process.env.ELECTRON_SERVER_GOARCH.trim() !== ''
        ? process.env.ELECTRON_SERVER_GOARCH.trim()
        : mapGoArch(process.arch);
    const binaryName = goos === 'windows' ? 'holdem-server.exe' : 'holdem-server';
    const outputBinary = path.resolve(outputBinDir, binaryName);

    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(outputBinDir, { recursive: true });
    await mkdir(outputDataDir, { recursive: true });

    console.log(`[desktop] Building local server binary (${goos}/${goarch})...`);
    await runCommand(goBinary, ['build', '-trimpath', '-o', outputBinary, '.'], {
        cwd: serverRoot,
        env: {
            ...process.env,
            GOOS: goos,
            GOARCH: goarch,
            CGO_ENABLED: process.env.CGO_ENABLED ?? '0',
        },
    });

    if (goos !== 'windows') {
        await chmod(outputBinary, 0o755);
    }

    let binaryStat = null;
    try {
        binaryStat = await stat(outputBinary);
    } catch {
        throw new Error(
            `Local server binary is missing after build: ${outputBinary}. This usually means antivirus quarantined it.`
        );
    }
    if (!binaryStat.isFile() || binaryStat.size <= 0) {
        throw new Error(`Local server binary is invalid after build: ${outputBinary}`);
    }
    // Some antivirus products quarantine the binary immediately after creation.
    // Re-check after a short delay so we fail fast instead of packaging a broken app.
    await sleep(3000);
    try {
        binaryStat = await stat(outputBinary);
    } catch {
        throw new Error(
            `Local server binary was removed right after build: ${outputBinary}. Antivirus quarantine is likely.`
        );
    }
    if (!binaryStat.isFile() || binaryStat.size <= 0) {
        throw new Error(`Local server binary became invalid after build: ${outputBinary}`);
    }

    await cp(dataRoot, outputDataDir, { recursive: true });
    console.log(`[desktop] Prepared local server runtime: ${outputRoot}`);
}

main().catch((error) => {
    console.error('[desktop] Failed to prepare local server runtime', error);
    process.exitCode = 1;
});
