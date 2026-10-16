import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_DEBUG_FILE = "test/ai-analysis-input-output.json";

let writeQueue = Promise.resolve();

export function aiAnalysisDebugFile(env = {}) {
  return resolve(env.AI_DEBUG_FILE || DEFAULT_DEBUG_FILE);
}

export async function appendAiAnalysisDebugLog(env, entry) {
  if (env.AI_DEBUG !== "true") return null;
  const filePath = aiAnalysisDebugFile(env);
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      let entries = [];
      try {
        const current = JSON.parse(await readFile(filePath, "utf8"));
        entries = Array.isArray(current) ? current : [current];
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      entries.push(entry);
      const temporaryFile = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporaryFile, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
      await rename(temporaryFile, filePath);
    });
  await writeQueue;
  return filePath;
}
