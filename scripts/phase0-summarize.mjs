#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function readLines(file) {
    if (!fs.existsSync(file)) {
        return [];
    }
    return fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

function percentile(values, p) {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
    return sorted[idx];
}

function median(values) {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[mid];
    }
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

function avg(values) {
    if (values.length === 0) {
        return null;
    }
    const total = values.reduce((acc, n) => acc + n, 0);
    return total / values.length;
}

function parsePerfJsonl(perfFile) {
    const lines = readLines(perfFile);
    const rows = [];
    for (const line of lines) {
        try {
            rows.push(JSON.parse(line));
        } catch {
            // Ignore malformed line.
        }
    }
    return rows;
}

function parsePidstatCpu(pidstatFile) {
    const lines = readLines(pidstatFile);
    const cpu = [];
    for (const line of lines) {
        if (!line.includes('Average:')) {
            continue;
        }
        if (line.includes('%CPU') || line.includes('Command')) {
            continue;
        }
        const fields = line.split(/\s+/);
        // Average: UID PID %usr %system %guest %wait %CPU CPU Command
        if (fields.length < 10) {
            continue;
        }
        const cpuPercent = Number(fields[7]);
        if (Number.isFinite(cpuPercent)) {
            cpu.push(cpuPercent);
        }
    }
    return cpu;
}

function parseNvidiaCsv(file) {
    const lines = readLines(file);
    const gpu = [];
    for (const line of lines) {
        const fields = line.split(',').map((part) => part.trim());
        if (fields.length < 2) {
            continue;
        }
        const util = Number(fields[1]);
        if (Number.isFinite(util)) {
            gpu.push(util);
        }
    }
    return gpu;
}

function round(value) {
    if (value === null || value === undefined) {
        return null;
    }
    return Math.round(value * 100) / 100;
}

function summarize(perfRows, cpuSamples, gpuSamples) {
    const fps = perfRows.map((r) => Number(r.fps)).filter((n) => Number.isFinite(n));
    const frameP95 = perfRows.map((r) => Number(r.frameMsP95)).filter((n) => Number.isFinite(n));
    const frameAvg = perfRows.map((r) => Number(r.frameMsAvg)).filter((n) => Number.isFinite(n));
    const longFrames = perfRows.map((r) => Number(r.longFrames)).filter((n) => Number.isFinite(n));

    const scenarios = Array.from(new Set(perfRows.map((r) => r.scenario).filter(Boolean)));
    const rendererPids = Array.from(new Set(perfRows.map((r) => r.rendererPid).filter((n) => Number.isFinite(Number(n)))));
    const rendererTypes = Array.from(new Set(perfRows.map((r) => r.rendererType).filter(Boolean)));

    return {
        sampleCount: perfRows.length,
        scenario: scenarios.length === 1 ? scenarios[0] : scenarios,
        rendererPids,
        rendererTypes,
        fps: {
            avg: round(avg(fps)),
            median: round(median(fps)),
            p95: round(percentile(fps, 0.95)),
            min: round(fps.length ? Math.min(...fps) : null),
            max: round(fps.length ? Math.max(...fps) : null),
        },
        frameMsAvg: {
            avg: round(avg(frameAvg)),
            median: round(median(frameAvg)),
            p95: round(percentile(frameAvg, 0.95)),
        },
        frameMsP95: {
            avg: round(avg(frameP95)),
            median: round(median(frameP95)),
            p95: round(percentile(frameP95, 0.95)),
        },
        longFrames: {
            avg: round(avg(longFrames)),
            median: round(median(longFrames)),
            p95: round(percentile(longFrames, 0.95)),
        },
        cpuPercent: {
            sampleCount: cpuSamples.length,
            median: round(median(cpuSamples)),
            p95: round(percentile(cpuSamples, 0.95)),
            max: round(cpuSamples.length ? Math.max(...cpuSamples) : null),
        },
        gpuPercent: {
            sampleCount: gpuSamples.length,
            median: round(median(gpuSamples)),
            p95: round(percentile(gpuSamples, 0.95)),
            max: round(gpuSamples.length ? Math.max(...gpuSamples) : null),
        },
    };
}

function main() {
    const outDir = process.argv[2];
    if (!outDir) {
        console.error('Usage: node scripts/phase0-summarize.mjs <output-dir>');
        process.exit(1);
    }
    const absDir = path.resolve(process.cwd(), outDir);
    const perfFile = path.join(absDir, 'perf-samples.jsonl');
    const cpuFile = path.join(absDir, 'cpu-pidstat.txt');
    const gpuFile = path.join(absDir, 'gpu-nvidia.csv');

    const perfRows = parsePerfJsonl(perfFile);
    const cpuSamples = parsePidstatCpu(cpuFile);
    const gpuSamples = parseNvidiaCsv(gpuFile);
    const summary = summarize(perfRows, cpuSamples, gpuSamples);

    const summaryPath = path.join(absDir, 'summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(summaryPath);
    console.log(JSON.stringify(summary, null, 2));
}

main();
