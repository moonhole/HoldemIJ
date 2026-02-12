import { fileURLToPath } from 'node:url';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), '..');
const wasmOutDir = join(repoRoot, 'apps', 'h5', 'public', 'wasm');
const wasmOutPath = join(wasmOutDir, 'replay.wasm');
const wasmExecOutPath = join(wasmOutDir, 'wasm_exec.js');

mkdirSync(wasmOutDir, { recursive: true });

const goEnv = spawnSync('go', ['env', 'GOROOT'], {
    cwd: repoRoot,
    encoding: 'utf8',
});
if (goEnv.status !== 0) {
    process.stderr.write(goEnv.stderr || 'failed to read GOROOT\n');
    process.exit(goEnv.status ?? 1);
}
const goroot = goEnv.stdout.trim();
const wasmExecCandidates = [
    join(goroot, 'lib', 'wasm', 'wasm_exec.js'),
    join(goroot, 'misc', 'wasm', 'wasm_exec.js'),
];
const wasmExecSrcPath = wasmExecCandidates.find((p) => existsSync(p));
if (!wasmExecSrcPath) {
    process.stderr.write('wasm_exec.js not found under GOROOT\n');
    process.exit(1);
}

const build = spawnSync('go', ['build', '-o', wasmOutPath, './cmd/replaywasm'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
        ...process.env,
        GOOS: 'js',
        GOARCH: 'wasm',
    },
});
if (build.status !== 0) {
    process.exit(build.status ?? 1);
}

copyFileSync(wasmExecSrcPath, wasmExecOutPath);
process.stdout.write(`built ${wasmOutPath}\n`);
process.stdout.write(`copied ${wasmExecOutPath}\n`);
