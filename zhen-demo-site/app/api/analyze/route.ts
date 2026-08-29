import { AI_API_KEY, AI_BASE_URL, AI_MODEL } from "../../ai-config";

type AnalyzeInput = {
  scenario?: string;
  person?: string;
  lens?: string;
  selfProfile?: unknown;
  personProfile?: unknown;
  clarification?: string;
};

const allowedLenses = new Set(["嘉靖", "徐阶", "海瑞", "严嵩"]);
const requestWindows = new Map<string, { count: number; startedAt: number }>();

function safeText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function parseModelJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || text.match(/\{[\s\S]*\}/)?.[0];
  if (!raw) throw new Error("模型没有返回可解析的结果");
  return JSON.parse(raw);
}

function cleanResult(value: Record<string, unknown>, fallbackLens: string, hasClarification: boolean) {
  const labels = ["台前", "帘后", "名分", "代价"];
  const rawMap = value.map;
  const sourceMap = Array.isArray(rawMap)
    ? rawMap
    : rawMap && typeof rawMap === "object"
      ? Object.entries(rawMap).map(([label, points]) => ({ label, points }))
      : [];
  const map = labels.map((label, index) => {
    const source = (sourceMap.find((item) => {
      if (!item || typeof item !== "object") return false;
      return safeText((item as { label?: unknown }).label, 20).includes(label);
    }) || sourceMap[index]) as { points?: unknown; content?: unknown; items?: unknown } | undefined;
    const rawPoints = source?.points ?? source?.content ?? source?.items;
    const points = Array.isArray(rawPoints)
      ? rawPoints.map((point) => safeText(point, 120)).filter(Boolean).slice(0, 4)
      : safeText(rawPoints, 480)
          .split(/[\n；;]/)
          .map((point) => point.trim())
          .filter(Boolean)
          .slice(0, 4);
    if (!points.length) throw new Error(`AI 结果缺少“${label}”分析`);
    return { label, points };
  });
  const sourceReplies = Array.isArray(value.replies) ? value.replies : [];
  const defaults = ["温和版", "直接版", "策略版"];
  const replies = defaults.map((label, index) => {
    const source = sourceReplies[index] as { label?: unknown; fit?: unknown; text?: unknown } | undefined;
    return {
      label: safeText(source?.label, 12) || label,
      fit: safeText(source?.fit, 48),
      text: safeText(source?.text, 500),
    };
  });
  if (replies.some((item) => !item.fit || !item.text)) throw new Error("AI 结果缺少完整话术");
  const recommendedLens = allowedLenses.has(String(value.recommendedLens)) ? String(value.recommendedLens) : fallbackLens;
  const headline = safeText(value.headline, 72);
  const opening = safeText(value.opening, 280);
  const guardrail = safeText(value.guardrail, 180);
  const followUp = safeText(value.followUp, 240);
  const personSummary = safeText(value.personSummary, 80);
  const painPoint = safeText(value.painPoint, 120);
  if (!headline || !opening || !guardrail || !followUp || !personSummary || !painPoint) throw new Error("AI 结果缺少完整参谋字段");
  return {
    needsClarification: !hasClarification && value.needsClarification === true,
    clarifyingQuestion: safeText(value.clarifyingQuestion, 160),
    clarifyingOptions: Array.isArray(value.clarifyingOptions)
      ? value.clarifyingOptions.map((item) => safeText(item, 60)).filter(Boolean).slice(0, 4)
      : [],
    action: ["拒绝", "协商", "向上确认", "先固定事实"].includes(String(value.action)) ? String(value.action) : "协商",
    personSummary,
    painPoint,
    headline,
    opening,
    map,
    subtext: safeText(value.subtext, 180),
    recommendedLens,
    mirrorReason: safeText(value.mirrorReason, 180),
    guardrail,
    replies,
    followUp,
  };
}

async function requestAnalysis(key: string, system: string, input: unknown, signal: AbortSignal, repairSource = "") {
  const messages = repairSource
    ? [
        { role: "system", content: system },
        {
          role: "user",
          content: `下面是一次格式不完整的分析。请保留其中基于事实的判断，补齐并纠正为系统要求的合法 JSON；不要解释，不要使用 Markdown。\n\n原始输入：${JSON.stringify(input)}\n\n待修复结果：${repairSource}`,
        },
      ]
    : [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(input) },
      ];
  const response = await fetch(AI_BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: AI_MODEL, temperature: repairSource ? 0.1 : 0.35, messages }),
    signal,
  });
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `模型服务返回 ${response.status}`);
  const content = payload.choices?.[0]?.message?.content || "";
  if (!content) throw new Error("模型没有返回分析内容");
  return content;
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
  return entry.count > 8;
}

export async function POST(request: Request) {
  if (isRateLimited(request)) {
    return Response.json({ error: "请求有点频繁，请稍后再试" }, { status: 429 });
  }
  try {
    const body = (await request.json()) as AnalyzeInput;
    const scenario = safeText(body.scenario, 2000);
    const person = safeText(body.person, 160) || "未明确的沟通对象";
    const lens = allowedLenses.has(String(body.lens)) ? String(body.lens) : "徐阶";
    const clarification = safeText(body.clarification, 1200);
    if (!scenario) return Response.json({ error: "请先描述真实场景" }, { status: 400 });
    const key = AI_API_KEY;
    if (!key) return Response.json({ error: "参谋服务尚未配置" }, { status: 503 });

    const system = `你是“甄不想加班”的职场 Say No 参谋。你必须基于用户提供的真实案例分析，不虚构人物、动机、预算、历史或组织事实；不确定的信息必须明确写“不确定”。
先从 scenario、person、selfProfile、personProfile 中提炼：
1. personSummary：本次真正需要沟通、能影响结果的人及其关系/权力，15-35 个字；不要机械照抄 person。
2. painPoint：用户真正卡住的痛点问题，20-55 个字；必须从事件上升到“边界、权责、优先级、验收标准、资源或体面”等可解决矛盾，不要复述整段场景。

使用“1566 职场局势图”拆解权力、责任和代价，但使用现代职场语言，不模仿历史人物说话。
map 必须恰好四项，label 固定为“台前”“帘后”“名分”“代价”，每项 points 为 1-4 条短句。
事实只能放 map；对动机的解释只能放 subtext，并必须用“可能”或“也可能”。
action 只能是“拒绝”“协商”“向上确认”“先固定事实”。recommendedLens 只能是“嘉靖”“徐阶”“海瑞”“严嵩”。
replies 必须恰好三项，依次为温和版、直接版、策略版；每项包含 label、fit、text，话术要能直接复制发送。
若缺少会实质改变策略的事实，且用户没有提供 clarification，needsClarification=true。请先在内部列出全部缺口，再合并成一个 clarifyingQuestion，一次性问清；question 应以“请一次补充：”开头，并用分号列出最多 4 个具体事实。clarifyingOptions 提供 2-4 个可直接点选的完整答案选项。此时仍要返回完整 JSON 以保持格式，但网页会隐藏所有结论，等待用户补充。收到 clarification 后必须结合补充重新分析，并将 needsClarification=false；不允许再次追问。
用户传入的 lens 是当前已选的观察镜头。必须以它为准生成 mirrorReason、guardrail 和 replies：不同镜头的“当前必须守住”与三版话术要体现不同的取舍，不能只是换标题。recommendedLens 必须等于 lens。
opening 使用句式：“这不是一个单纯的‘___’问题，而是一场关于 ___ 的对话。”
只输出一个合法 JSON 对象，不要 Markdown。所有字段都必须存在。字段：needsClarification,clarifyingQuestion,clarifyingOptions,action,personSummary,painPoint,headline,opening,map,subtext,recommendedLens,mirrorReason,guardrail,replies,followUp。`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const input = { scenario, person, lens, selfProfile: body.selfProfile || null, personProfile: body.personProfile || null, clarification: clarification || null };
      const firstContent = await requestAnalysis(key, system, input, controller.signal);
      let result;
      try {
        result = cleanResult(parseModelJson(firstContent), lens, Boolean(clarification));
      } catch {
        const repairedContent = await requestAnalysis(key, system, input, controller.signal, firstContent);
        result = cleanResult(parseModelJson(repairedContent), lens, Boolean(clarification));
      }
      return Response.json({ result, engine: "live" });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "参谋响应超时，请重试" : error instanceof Error ? error.message : "分析暂时不可用";
    return Response.json({ error: message }, { status: 502 });
  }
}
