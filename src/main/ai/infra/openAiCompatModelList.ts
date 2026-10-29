import {
  applyOpenAiCompatAuthHeaders,
  openAiCompatModelsUrl,
} from "@shared/apiEndpointPresets";

/** OpenAI 兼容 `GET {baseUrl}/models`（对话与向量远程拉模型列表共用） */
export async function fetchOpenAiCompatModelIds(opts: {
  baseUrl: string;
  apiKey: string;
}): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  const url = openAiCompatModelsUrl(opts.baseUrl);
  if (!url) return { ok: false, error: "缺少接口地址" };
  try {
    const headers: Record<string, string> = {};
    applyOpenAiCompatAuthHeaders(headers, opts.baseUrl, opts.apiKey);
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 200)}` };
    }
    const json = (await res.json()) as {
      data?: Array<{ id?: string }>;
    };
    const models = (json.data ?? [])
      .map((x) => x.id)
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    return { ok: true, models };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
