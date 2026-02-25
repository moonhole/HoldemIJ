#!/usr/bin/env bash
set -euo pipefail

MODE="${MODE:-prod}"
DURATION_SEC="${DURATION_SEC:-180}"
SCENARIO="${SCENARIO:-table_active}"
OUT_DIR="${OUT_DIR:-.local/perf/phase0-$(date +%Y%m%d-%H%M%S)-${SCENARIO}}"
PRIMARY_USER="${PRIMARY_USER:-dev_admin}"
PRIMARY_PASS="${PRIMARY_PASS:-password}"
BOT_USER="${BOT_USER:-dev_player1}"
BOT_PASS="${BOT_PASS:-password}"
ENABLE_BOT="${ENABLE_BOT:-auto}"
AUTO_START_SERVER="${AUTO_START_SERVER:-auto}"

SCENARIO_AUTOPILOT_MODE="tableActive"
case "${SCENARIO}" in
  lobby_idle)
    SCENARIO_AUTOPILOT_MODE="lobbyIdle"
    ;;
  table_idle)
    SCENARIO_AUTOPILOT_MODE="tableIdle"
    ;;
  table_active|showdown_heavy)
    SCENARIO_AUTOPILOT_MODE="tableActive"
    ;;
esac

if [[ "${ENABLE_BOT}" == "auto" ]]; then
  if [[ "${SCENARIO_AUTOPILOT_MODE}" == "tableActive" ]]; then
    ENABLE_BOT="1"
  else
    ENABLE_BOT="0"
  fi
fi

if [[ "${AUTO_START_SERVER}" == "auto" ]]; then
  if [[ "${SCENARIO_AUTOPILOT_MODE}" == "lobbyIdle" ]]; then
    AUTO_START_SERVER="0"
  else
    AUTO_START_SERVER="1"
  fi
fi

mkdir -p "${OUT_DIR}"
OUT_DIR_ABS="$(cd "${OUT_DIR}" && pwd)"
PERF_FILE="${OUT_DIR_ABS}/perf-samples.jsonl"
CPU_FILE="${OUT_DIR_ABS}/cpu-pidstat.txt"
GPU_FILE="${OUT_DIR_ABS}/gpu-nvidia.csv"
SESSION_LOG="${OUT_DIR_ABS}/session.log"
BOT_SESSION_LOG="${OUT_DIR_ABS}/session-bot.log"
SERVER_SESSION_LOG="${OUT_DIR_ABS}/session-server.log"
PRIMARY_PROFILE_DIR="${OUT_DIR_ABS}/profile-primary"
BOT_PROFILE_DIR="${OUT_DIR_ABS}/profile-bot"

PRIMARY_QUERY="perf=1&perfExport=1&scenario=${SCENARIO}&perfAuto=1&perfAutoMode=${SCENARIO_AUTOPILOT_MODE}&perfUser=${PRIMARY_USER}&perfPass=${PRIMARY_PASS}"
BOT_QUERY="perf=0&perfAuto=1&perfAutoMode=tableActive&perfUser=${BOT_USER}&perfPass=${BOT_PASS}"

cleanup() {
  set +e
  if [[ -n "${PIDSTAT_PID:-}" ]]; then kill "${PIDSTAT_PID}" >/dev/null 2>&1 || true; fi
  if [[ -n "${GPU_PID:-}" ]]; then kill "${GPU_PID}" >/dev/null 2>&1 || true; fi
  if [[ -n "${SERVER_PID:-}" ]]; then kill "${SERVER_PID}" >/dev/null 2>&1 || true; fi
  if [[ -n "${BOT_PID:-}" ]]; then kill "${BOT_PID}" >/dev/null 2>&1 || true; fi
  if [[ -n "${APP_PID:-}" ]]; then kill "${APP_PID}" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

backend_is_healthy() {
  curl -fsS --max-time 1 "http://localhost:8080/health" >/dev/null 2>&1 ||
    curl -fsS --max-time 1 "http://127.0.0.1:8080/health" >/dev/null 2>&1
}

ensure_backend() {
  if backend_is_healthy; then
    echo "[phase0] backend 127.0.0.1:8080 is healthy."
    return
  fi

  if [[ "${AUTO_START_SERVER}" != "1" ]]; then
    if [[ "${SCENARIO_AUTOPILOT_MODE}" == "tableActive" || "${SCENARIO_AUTOPILOT_MODE}" == "tableIdle" ]]; then
      echo "[phase0] backend unavailable and AUTO_START_SERVER=0; cannot run ${SCENARIO_AUTOPILOT_MODE}."
      exit 1
    fi
    echo "[phase0] backend unavailable; continuing without server."
    return
  fi

  echo "[phase0] backend unavailable; starting local server in AUTH_MODE=memory..."
  AUTH_MODE=memory pnpm dev:server >"${SERVER_SESSION_LOG}" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 40); do
    if backend_is_healthy; then
      echo "[phase0] local backend started pid=${SERVER_PID}"
      return
    fi
    sleep 1
  done

  echo "[phase0] local backend failed to become healthy. Check ${SERVER_SESSION_LOG}"
  exit 1
}

echo "[phase0] out dir: ${OUT_DIR_ABS}"
echo "[phase0] mode=${MODE} duration=${DURATION_SEC}s scenario=${SCENARIO}"
echo "[phase0] autopilot mode=${SCENARIO_AUTOPILOT_MODE} bot=${ENABLE_BOT} autoServer=${AUTO_START_SERVER}"
echo "[phase0] perf samples: ${PERF_FILE}"
echo "[phase0] this script expects a desktop GUI session."
mkdir -p "${PRIMARY_PROFILE_DIR}" "${BOT_PROFILE_DIR}"
ensure_backend

if [[ "${MODE}" == "prod" ]]; then
  echo "[phase0] building desktop renderer bundle..."
  pnpm --filter desktop build:renderer
  pnpm --filter desktop prepare:renderer

  (
    cd apps/desktop
    ELECTRON_RENDERER_QUERY="${PRIMARY_QUERY}" \
    ELECTRON_USER_DATA_DIR="${PRIMARY_PROFILE_DIR}" \
    ELECTRON_PERF_LOG_FILE="${PERF_FILE}" \
    node scripts/start-electron.cjs
  ) >"${SESSION_LOG}" 2>&1 &
  APP_PID=$!

  if [[ "${ENABLE_BOT}" == "1" ]]; then
    (
      cd apps/desktop
      ELECTRON_RENDERER_QUERY="${BOT_QUERY}" \
      ELECTRON_USER_DATA_DIR="${BOT_PROFILE_DIR}" \
      node scripts/start-electron.cjs
    ) >"${BOT_SESSION_LOG}" 2>&1 &
    BOT_PID=$!
    echo "[phase0] started bot pid=${BOT_PID}"
  fi
elif [[ "${MODE}" == "dev" ]]; then
  if [[ "${ENABLE_BOT}" == "1" ]]; then
    echo "[phase0] MODE=dev does not support auto bot companion; continuing with single client."
  fi

  ELECTRON_RENDERER_QUERY="${PRIMARY_QUERY}" \
  ELECTRON_USER_DATA_DIR="${PRIMARY_PROFILE_DIR}" \
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
if [[ -f "${BOT_SESSION_LOG}" ]]; then
  echo "  - ${BOT_SESSION_LOG}"
fi
if [[ -f "${SERVER_SESSION_LOG}" ]]; then
  echo "  - ${SERVER_SESSION_LOG}"
fi
