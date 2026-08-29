import { AI_API_KEY, AI_BASE_URL, AI_MODEL } from "../../ai-config";

type Phase = "scene" | "self" | "person";
const requestWindows = new Map<string, { count: number; startedAt: number }>();

function text(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function parseJson(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || value.match(/\{[\s\S]*\}/)?.[0];
  if (!raw) throw new Error("AI 没有返回可解析的资料");
  return JSON.parse(raw) as Record<string, unknown>;
}

function cleanList(value: unknown, max = 5) {
  return Array.isArray(value) ? value.map((item) => text(item, 80)).filter(Boolean).slice(0, max) : [];
}

function cleanResult(value: Record<string, unknown>, phase: Phase) {
  const people = Array.isArray(value.detectedPeople)
    ? value.detectedPeople.map((item) => {
        const row = item as { name?: unknown; relation?: unknown; roleClue?: unknown; power?: unknown; persona?: unknown; difficulty?: unknown; isKeyPerson?: unknown; kpReason?: unknown; confidence?: unknown };
        return { name: text(row.name, 30), relation: text(row.relation, 40), roleClue: text(row.roleClue, 80), power: text(row.power, 70), persona: text(row.persona, 100), difficulty: text(row.difficulty, 120), isKeyPerson: row.isKeyPerson === true, kpReason: text(row.kpReason, 100), confidence: text(row.confidence, 20) };
      }).filter((item) => item.name).slice(0, 3)
    : [];
  const summary = text(value.summary, 220);
  if (!summary || !value.profile || typeof value.profile !== "object") throw new Error("AI 没有返回完整的资料解析");
  if (phase === "self" && (people.length !== 3 || people.filter((person) => person.isKeyPerson).length !== 1)) throw new Error("AI 没有完整识别三类角色和关键 KP");
  return {
    phase,
    summary,
    tags: cleanList(value.tags, 6),
    detectedPeople: people,
    suggestedInput: text(value.suggestedInput, 220),
    profile: value.profile && typeof value.profile === "object" ? value.profile : {},
  };
}

function isRateLimited(request: Request) {
  const address = request.headers.get("cf-connecting-ip") || "anonymous";
  const now = Date.now();
  const entry = requestWindows.get(address);
  if (!entry || now - entry.startedAt > 60_000) {
    requestWindows.set(address, { count: 1, startedAt: now });
    return false;
  }
  entry.count += 1;
  return entry.count > 12;
}

export async function POST(request: Request) {
  if (isRateLimited(request)) return Response.json({ error: "请求有点频繁，请稍后再试" }, { status: 429 });
  try {
    const body = (await request.json()) as { phase?: Phase; input?: string; context?: unknown };
    const phase = body.phase;
    const input = text(body.input, 2000);
    if (!phase || !["scene", "self", "person"].includes(phase)) return Response.json({ error: "无效的解析步骤" }, { status: 400 });
    if (!input) return Response.json({ error: "请先说一点真实信息" }, { status: 400 });
    const key = AI_API_KEY;
    if (!key) return Response.json({ error: "AI 解析服务尚未配置" }, { status: 503 });

    const phaseRules: Record<Phase, string> = {
      scene: "解析沟通事件。profile 包含 coreConflict、goal、facts、unknowns。此步只梳理事件与用户痛点，不需要产出人物卡；不得编造人物、职级或动机。",
      self: "在解析用户本人后，结合 context 中的 scene，识别本次沟通对象。profile 包含 currentRole、careerStage、currentStyle、desiredPersona、communicationGoal、painPoint、strengths、risks；不得凭空补充资历或性格。detectedPeople 必须恰好三项：1 个主沟通对象（关键 KP）和最多 2 个相关可选角色。优先使用用户明确提到的人名或称谓；不足三人时可用‘待确认·拍板人/验收人/协作者’，confidence 必须标为‘待确认’，不得编造姓名。每项必须包含 name、relation、roleClue、power、persona（对方的人设/沟通风格，推断须标“可能”）、difficulty（与此人沟通的难点）、isKeyPerson、kpReason、confidence。isKeyPerson 必须且只能有一项为 true，选择最可能影响沟通结果的人。",
      person: "解析主要沟通对象。profile 包含 name、relationship、power、communicationStyle、priorities、boundaries、evidence；推断必须标注为可能，不能把猜测当事实。",
    };
    const system = `你是职场沟通产品的资料解析助手。只整理用户明确提供的信息，不做参谋结论，不输出话术。${phaseRules[phase]}
只输出合法 JSON：summary（1-3句确认性摘要）、tags（短标签数组）、detectedPeople（self 阶段必须为 3 项，每项包含 name、relation、roleClue、power、persona、difficulty、isKeyPerson、kpReason、confidence）、suggestedInput（可供用户继续编辑的文本）、profile（按本步骤规则）。不要 Markdown。`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35_000);
    try {
      const response = await fetch(AI_BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: AI_MODEL, temperature: 0.2, messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify({ input, context: body.context || null }) }] }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || `模型服务返回 ${response.status}`);
      return Response.json({ result: cleanResult(parseJson(payload.choices?.[0]?.message?.content || ""), phase) });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "AI 解析超时，请重试" : error instanceof Error ? error.message : "AI 解析暂时不可用";
    return Response.json({ error: message }, { status: 502 });
  }
}
