let readyPromise = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureReady() {
  if (readyPromise) {
    return readyPromise;
  }
  readyPromise = (async () => {
    self.importScripts('/wasm/wasm_exec.js');
    const go = new self.Go();

    let instance;
    if (WebAssembly.instantiateStreaming) {
      try {
        const result = await WebAssembly.instantiateStreaming(fetch('/wasm/replay.wasm'), go.importObject);
        instance = result.instance;
      } catch (_) {
        const response = await fetch('/wasm/replay.wasm');
        const bytes = await response.arrayBuffer();
        const result = await WebAssembly.instantiate(bytes, go.importObject);
        instance = result.instance;
      }
    } else {
      const response = await fetch('/wasm/replay.wasm');
      const bytes = await response.arrayBuffer();
      const result = await WebAssembly.instantiate(bytes, go.importObject);
      instance = result.instance;
    }

    go.run(instance);

    for (let i = 0; i < 200; i++) {
      if (typeof self.__replayInit === 'function') {
        return;
      }
      await delay(10);
    }
    throw new Error('WASM bootstrap timeout: __replayInit not available');
  })();

  return readyPromise;
}

self.onmessage = async (event) => {
  const req = event.data || {};
  const id = req.id;
  try {
    if (req.type !== 'init') {
      throw new Error(`unsupported request type: ${req.type}`);
    }
    await ensureReady();
    const raw = self.__replayInit(JSON.stringify({ spec: req.spec }));
    const parsed = JSON.parse(raw);
    self.postMessage({ id, ...parsed });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: {
        step_index: -1,
        reason: 'worker_failed',
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
};

