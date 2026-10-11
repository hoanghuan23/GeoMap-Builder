export async function requestAnalysis(payload, { signal, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetchImpl("/api/analyze-data", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Không kết nối được AI.");
    return body;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (controller.signal.aborted) throw new Error("AI quá thời gian 30 giây.");
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
