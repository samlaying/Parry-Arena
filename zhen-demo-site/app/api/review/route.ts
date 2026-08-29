import { AI_API_KEY, AI_BASE_URL, AI_MODEL } from "../../ai-config";

type ReviewInput = {
  transcript?: string;
  scenario?: string;
  person?: string;
  selfProfile?: unknown;
  personProfile?: unknown;
};

const requestWindows = new Map<string, { count: number; startedAt: number }>();

function safeText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function parseJson(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || value.match(/\{[\s\S]*\}/)?.[0];
  if (!raw) throw new Error("AI 没有返回可解析的复盘");
  return JSON.parse(raw) as Record<string, unknown>;
}

function textList(value: unknown, max = 4) {
  return Array.isArray(value) ? value.map((item) => safeText(item, 180)).filter(Boolean).slice(0, max) : [];
}

function cleanResult(value: Record<string, unknown>) {
  const summary = safeText(value.summary, 180);
  const doneWell = textList(value.doneWell, 2);
  const growth = textList(value.growth, 2);
  const nextActions = textList(value.nextActions, 2);
  const roles = Array.isArray(value.roleUpdates) ? value.roleUpdates.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      name: safeText(row.name, 40),
      relationship: safeText(row.relationship, 60),
      power: Math.max(10, Math.min(100, Number(row.power) || 50)),
      boundary: safeText(row.boundary, 40),
      update: safeText(row.update, 180),
      confidence: safeText(row.confidence, 20),
    };
  }).filter((item) => item.name && item.update).slice(0, 4) : [];
  const relations = Array.isArray(value.relationUpdates) ? value.relationUpdates.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      from: safeText(row.from, 40),
      to: safeText(row.to, 40),
      trustFrom: Math.max(0, Math.min(100, Number(row.trustFrom ?? row.trust) || 50)),
      trustTo: Math.max(0, Math.min(100, Number(row.trustTo ?? row.trust) || 50)),
      closeness: Math.max(0, Math.min(100, Number(row.closeness) || 50)),
      interest: safeText(row.interest, 80),
      interestStrength: Math.max(0, Math.min(100, Number(row.interestStrength) || 50)),
      kinship: safeText(row.kinship, 30),
      boundary: safeText(row.boundary, 80),
      change: safeText(row.change, 120),
    };
    }).filter((item) => item.from && item.to).slice(0, 5) : [];
  if (!summary || !doneWell.length || !growth.length || !nextActions.length || !roles.length || !relations.length) throw new Error("AI 返回的复盘字段不完整");
  return { summary, doneWell, growth, nextActions, roleUpdates: roles, relationUpdates: relations };
}

function limited(request: Request) {
  const address = request.headers.get("cf-connecting-ip") || "anonymous";
  const now = Date.now();
  const entry = requestWindows.get(address);
  if (!entry || now - entry.startedAt > 60_000) {
    requestWindows.set(address, { count: 1, startedAt: now });
    return false;
  }
  entry.count += 1;
  return entry.count > 8;
}

export async function POST(request: Request) {
  if (limited(request)) return Response.json({ error: "请求有点频繁，请稍后再试" }, { status: 429 });
  try {
    const body = (await request.json()) as ReviewInput;
    const transcript = safeText(body.transcript, 6000);
    if (!transcript) return Response.json({ error: "请先输入真实沟通过程" }, { status: 400 });
    const key = AI_API_KEY;
    if (!key) return Response.json({ error: "复盘服务尚未配置" }, { status: 503 });
    const system = `你是“甄不想加班”的职场沟通复盘助手。只基于用户输入的真实沟通过程以及上下文资料分析；不能虚构没有出现的承诺、人物动机或结果。对推断使用“可能”并在 confidence 标记“推断”。
请输出简明复盘：summary（60-120字，只写过程和结果）、doneWell（1-2条，援引用户确实做过的行为）、growth（1-2条，下一次具体怎么做）、nextActions（1-2条，留痕或跟进动作）。
roleUpdates：本次涉及的角色画像更新，2-4条，每条包含 name、relationship、power（0-100，权力/影响力）、boundary（边界状态，如清晰/模糊/待确认）、update、confidence；只更新输入中出现或上下文已有的角色。没有证据时用中性分值并标记“推断”。
relationUpdates：用于动态关系图谱的数据，2-5条，每条包含 from、to、trustFrom（from 对 to 的信任 0-100）、trustTo（to 对 from 的信任 0-100）、closeness（0-100）、interest（双方的利益/协作关系）、interestStrength（0-100）、kinship（如紧密协作/正式协作/弱联系/冲突对立）、boundary（边界状态）、change（本次事件如何改变该关系）。至少有一条是“我”与主沟通对象。所有人物和连线必须来自输入或上下文；不要虚构角色或关系。
只输出一个合法 JSON 对象，不要 Markdown。字段必须齐全：summary,doneWell,growth,nextActions,roleUpdates,relationUpdates。`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(AI_BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: AI_MODEL,
          temperature: 0.25,
          messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify({ transcript, scenario: body.scenario || null, person: body.person || null, selfProfile: body.selfProfile || null, personProfile: body.personProfile || null }) }],
        }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || `模型服务返回 ${response.status}`);
      return Response.json({ result: cleanResult(parseJson(payload.choices?.[0]?.message?.content || "")) });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "复盘响应超时，请重试" : error instanceof Error ? error.message : "复盘暂时不可用";
    return Response.json({ error: message }, { status: 502 });
  }
}
