#!/usr/bin/env bash
set -euo pipefail

MODE="${MODE:-prod}"
DURATION_SEC="${DURATION_SEC:-180}"
SCENARIO="${SCENARIO:-table_active}"
OUT_DIR="${OUT_DIR:-.local/perf/phase0-$(date +%Y%m%d-%H%M%S)-${SCENARIO}}"

mkdir -p "${OUT_DIR}"
OUT_DIR_ABS="$(cd "${OUT_DIR}" && pwd)"
PERF_FILE="${OUT_DIR_ABS}/perf-samples.jsonl"
CPU_FILE="${OUT_DIR_ABS}/cpu-pidstat.txt"
GPU_FILE="${OUT_DIR_ABS}/gpu-nvidia.csv"
SESSION_LOG="${OUT_DIR_ABS}/session.log"

cleanup() {
  set +e
  if [[ -n "${PIDSTAT_PID:-}" ]]; then kill "${PIDSTAT_PID}" >/dev/null 2>&1 || true; fi
  if [[ -n "${GPU_PID:-}" ]]; then kill "${GPU_PID}" >/dev/null 2>&1 || true; fi
  if [[ -n "${APP_PID:-}" ]]; then kill "${APP_PID}" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

echo "[phase0] out dir: ${OUT_DIR_ABS}"
echo "[phase0] mode=${MODE} duration=${DURATION_SEC}s scenario=${SCENARIO}"
echo "[phase0] perf samples: ${PERF_FILE}"
echo "[phase0] this script expects a desktop GUI session."

if [[ "${MODE}" == "prod" ]]; then
  echo "[phase0] building desktop renderer bundle..."
  pnpm --filter desktop build:renderer
  pnpm --filter desktop prepare:renderer

  (
    cd apps/desktop
    ELECTRON_RENDERER_QUERY="perf=1&perfExport=1&scenario=${SCENARIO}" \
    ELECTRON_PERF_LOG_FILE="${PERF_FILE}" \
    node scripts/start-electron.cjs
  ) >"${SESSION_LOG}" 2>&1 &
  APP_PID=$!
elif [[ "${MODE}" == "dev" ]]; then
  ELECTRON_RENDERER_QUERY="perf=1&perfExport=1&scenario=${SCENARIO}" \
  ELECTRON_PERF_LOG_FILE="${PERF_FILE}" \
  pnpm desktop:dev >"${SESSION_LOG}" 2>&1 &
  APP_PID=$!
else
  echo "Unsupported MODE=${MODE}. Use MODE=prod or MODE=dev."
  exit 1
fi

echo "[phase0] started app pid=${APP_PID}"
echo "[phase0] waiting for first perf sample..."
for _ in $(seq 1 120); do
  if [[ -s "${PERF_FILE}" ]]; then
    break
  fi
  sleep 1
done

if [[ ! -s "${PERF_FILE}" ]]; then
  echo "[phase0] no perf samples written after timeout. Check ${SESSION_LOG}"
  exit 1
fi

RENDERER_PID="$(node -e "const fs=require('fs');const f='${PERF_FILE}';const line=fs.readFileSync(f,'utf8').split(/\\r?\\n/).find(Boolean);const row=JSON.parse(line);process.stdout.write(String(row.rendererPid||''));")"
if [[ -z "${RENDERER_PID}" ]]; then
  echo "[phase0] failed to parse renderer pid from perf file"
  exit 1
fi
echo "[phase0] renderer pid=${RENDERER_PID}"

echo "[phase0] sampling renderer CPU via pidstat..."
pidstat -h -u -r -p "${RENDERER_PID}" 1 "${DURATION_SEC}" >"${CPU_FILE}" &
PIDSTAT_PID=$!

if command -v nvidia-smi >/dev/null 2>&1; then
  echo "[phase0] sampling GPU via nvidia-smi..."
  nvidia-smi --query-gpu=timestamp,utilization.gpu,utilization.memory --format=csv,noheader,nounits -l 1 >"${GPU_FILE}" &
  GPU_PID=$!
else
  echo "[phase0] nvidia-smi not found; skipping GPU collection" | tee -a "${SESSION_LOG}"
fi

echo "[phase0] run scenario now for ${DURATION_SEC}s..."
wait "${PIDSTAT_PID}"
PIDSTAT_PID=""

if [[ -n "${GPU_PID:-}" ]]; then
  kill "${GPU_PID}" >/dev/null 2>&1 || true
  GPU_PID=""
fi

if [[ -n "${APP_PID:-}" ]]; then
  kill "${APP_PID}" >/dev/null 2>&1 || true
  APP_PID=""
fi

echo "[phase0] summarizing..."
node scripts/phase0-summarize.mjs "${OUT_DIR_ABS}" > "${OUT_DIR_ABS}/summary.log"

echo "[phase0] done."
echo "[phase0] summary: ${OUT_DIR_ABS}/summary.json"
echo "[phase0] raw logs:"
echo "  - ${PERF_FILE}"
echo "  - ${CPU_FILE}"
if [[ -f "${GPU_FILE}" ]]; then
  echo "  - ${GPU_FILE}"
fi
echo "  - ${SESSION_LOG}"
