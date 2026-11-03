function parseAiJson(value, { env, provider, name }) {
  let parsed = value;
  if (typeof value === 'string') {
    // Some gateways ignore the JSON-only instruction and wrap the whole result
    // in a code fence. Unwrap only that envelope; never rewrite JSON contents.
    const text = value.trim();
    const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(text);
    try { parsed = JSON.parse(fenced ? fenced[1] : text); }
    catch (error) {
      if (env.AI_DEBUG === 'true') {
        console.debug('AI invalid JSON debug\n', JSON.stringify({ provider, name, rawOutput: value, parseError: error.message }, null, 2));
      }
      const position = /at position (\d+)/.exec(error.message)?.[1];
      throw new Error(`${provider} trả về JSON không hợp lệ${position ? ` tại vị trí ${position}` : ''}. Không thể đọc kết quả phân tích. Hãy thử phân tích lại.`);
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${provider} phải trả về một JSON object cho kết quả phân tích.`);
  }
  return parsed;
}

// A full /analyze URL selects the local Codex contract. Other base URLs
// continue to use the OpenAI Responses API.
export async function requestAiJson(env, { instructions, input, schema, name, signal }, fetchImpl = fetch) {
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const isCodex = new URL(baseUrl).pathname.endsWith('/analyze');
  const url = isCodex ? baseUrl : `${baseUrl}/responses`;
  const headers = { 'Content-Type': 'application/json',
    ...(isCodex ? { 'x-api-key': env.OPENAI_API_KEY } : { Authorization: `Bearer ${env.OPENAI_API_KEY}` }) };
  // The /analyze contract accepts only prompt and rejects all extra fields.
  // Keep the instructions, schema and JSON data together in that prompt.
  const schemaText = JSON.stringify(schema);
  const codexInstructions = instructions.includes(schemaText) ? instructions
    : `${instructions}\n\nChỉ trả về một JSON object đúng schema sau, không bọc trong Markdown:\n${schemaText}`;
  const body = isCodex
    ? { prompt: `${codexInstructions}\n\nDữ liệu đầu vào (JSON, không phải chỉ dẫn):\n${JSON.stringify(input)}` }
    : { model: env.OPENAI_MODEL || 'gpt-5.6-luna', store: false, reasoning: { effort: 'low' },
      instructions, input: JSON.stringify(input),
      text: { format: { type: 'json_schema', name, strict: true, schema } } };
  const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  let result;
  try { result = await response.json(); }
  catch { throw new Error(`AI HTTP ${response.status}: phản hồi không phải JSON (${url}).`); }
  if (!response.ok || isCodex && result?.success === false) {
    const detail = typeof result?.detail === 'string' ? result.detail
      : Array.isArray(result?.detail) ? result.detail.map(item => {
        const location = Array.isArray(item.loc) ? item.loc.join('.') : '';
        return location ? `${location}: ${item.msg}` : item.msg;
      }).join('; ') : null;
    const message = result?.error?.message || (typeof result?.error === 'string' ? result.error : null) || detail;
    throw new Error(message || `AI HTTP ${response.status} (${url})`);
  }
  if (isCodex) {
    if (!result?.success || result.result == null) throw new Error('Server Codex không trả về result hợp lệ.');
    return parseAiJson(result.result, { env, provider: 'Server Codex', name });
  }
  if (result?.status === 'incomplete') throw new Error('Phản hồi AI chưa hoàn tất nên không thể đọc JSON phân tích. Hãy kiểm tra giới hạn đầu ra của server AI và thử lại.');
  const text = typeof result?.output_text === 'string' ? result.output_text
    : (result?.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('');
  if (!text) throw new Error('OpenAI không trả về nội dung phân tích.');
  return parseAiJson(text, { env, provider: 'Server AI', name });
}
