import { fallbackComposition, normalizeCompositionInput, normalizeCompositionResult } from './map-composition-contract.js';

export function createCompositionClient({ fetchImpl = (...args) => fetch(...args), timeoutMs = 45_000 } = {}) {
  const cache = new Map();
  return async function requestComposition(raw, { signal } = {}) {
    const input = normalizeCompositionInput(raw);
    const key = JSON.stringify({ ...input, workspaceRevision: 0 });
    if (cache.has(key)) return cache.get(key);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetchImpl('/api/ai/analyze-map-composition', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input), signal: controller.signal });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `AI HTTP ${response.status}`);
      const result = normalizeCompositionResult(await response.json(), input);
      if (result.source === 'ai' && result.decisions.every(item => item.action !== 'undetermined')) {
        if (cache.size >= 30) cache.delete(cache.keys().next().value);
        cache.set(key, result);
      }
      return result;
    } catch (error) {
      if (signal?.aborted) throw error;
      return fallbackComposition(input, `Chưa xác định khả năng kết hợp: ${controller.signal.aborted ? 'hết thời gian chờ AI' : error.message}. Dữ liệu được giữ riêng.`);
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
    }
  };
}
