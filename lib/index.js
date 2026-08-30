// dsh 插件：余额与当前会话消耗
// 服务端：注册 /balance 命令 + /balance-api HTTP 接口（供 Web UI 插件直接渲染）
export const name = "balance-dsh";

let legacySessionInspector;
let legacySessionInspectorLoaded = false;

/**
 * 跨 DSH 版本读取会话，且不在模块加载阶段绑定可能被删除的命名导出。
 * 新版优先使用 sessionController；其次直接使用 sessionQuery；旧版最后回退
 * @deepseek-ai/dsh-api-remotes.inspectApiRemoteSession。接口全部不可用时抛错，
 * 由子代理统计调用方跳过该会话，不影响余额插件本身启动。
 */
async function inspectPersistedSession(ctx, sessionId) {
  const getService = typeof ctx?.get === "function" ? ctx.get.bind(ctx) : null;

  const sessionController = getService?.("sessionController");
  if (typeof sessionController?.inspect === "function") {
    return sessionController.inspect(sessionId);
  }

  const sessionQuery = getService?.("sessionQuery");
  if (typeof sessionQuery?.observeSession === "function") {
    const observation = await sessionQuery.observeSession(sessionId, { projectionMode: "none" });
    try {
      return {
        meta: observation.header,
        events: [...(observation.events ?? [])],
      };
    } finally {
      observation?.[Symbol.dispose]?.();
    }
  }

  if (!legacySessionInspectorLoaded) {
    legacySessionInspectorLoaded = true;
    try {
      const remotes = await import("@deepseek-ai/dsh-api-remotes");
      if (typeof remotes.inspectApiRemoteSession === "function") {
        legacySessionInspector = remotes.inspectApiRemoteSession;
      }
    } catch {
      // 新版可能不再提供旧模块或旧导出；由下方统一处理。
    }
  }
  if (typeof legacySessionInspector === "function") {
    return legacySessionInspector(ctx, sessionId);
  }

  throw new Error("当前 DSH 未提供兼容的持久化会话读取接口");
}

const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";

// DeepSeek 目录价（人民币/百万 tokens），按模型区分。默认取 2026-08-17 生效的
// V4 峰谷定价之空闲时段价；高峰时段（每日 9:00 / 14:00）价格为下表 2 倍，
// 可在 config.peak: true 时统一翻倍，或在 config.price 中逐项覆盖。
// V4-Flash 空闲：输入未命中 1.5 / 命中 0.05 / 输出 4.5
// V4-Pro   空闲：输入未命中 4.5 / 命中 0.15 / 输出 13.5
const MODEL_PRICING = {
  "deepseek-v4-flash": { inputCnyPerMillion: 1.5, cacheReadCnyPerMillion: 0.05, cacheWriteCnyPerMillion: 0, outputCnyPerMillion: 4.5 },
  "deepseek-v4-pro": { inputCnyPerMillion: 4.5, cacheReadCnyPerMillion: 0.15, cacheWriteCnyPerMillion: 0, outputCnyPerMillion: 13.5 },
  // 旧模型兜底（V3.2 时代目录价）
  "deepseek-chat": { inputCnyPerMillion: 2, cacheReadCnyPerMillion: 0.5, cacheWriteCnyPerMillion: 0, outputCnyPerMillion: 3 },
  "deepseek-reasoner": { inputCnyPerMillion: 4, cacheReadCnyPerMillion: 1, cacheWriteCnyPerMillion: 0, outputCnyPerMillion: 16 },
};
const FALLBACK_PRICING = MODEL_PRICING["deepseek-v4-flash"];

// 高峰/空闲时段（V4 峰谷定价，2026-08-17 生效）：高峰价 = 空闲价 × 2。
// 官方高峰窗口（北京时间）为 周一至周五 09:00-12:00、14:00-18:00；周末全天空闲。
// 可用 config.peakWindows 覆盖小时窗口（如 [{start:9,end:12},{start:14,end:18}]），
// 可用 config.peakWeekdays 覆盖周几（1=周一 … 5=周五，默认 [1,2,3,4,5]，0/6=周末）。
const DEFAULT_PEAK_WINDOWS = [
  { start: 9, end: 12 },
  { start: 14, end: 18 },
];
const DEFAULT_PEAK_WEEKDAYS = [1, 2, 3, 4, 5];

/** 判断某时间戳（毫秒）是否处于高峰时段（按北京时间 UTC+8 计算，含周几判断）。 */
function isPeakAt(timeMs, config) {
  const windows = (Array.isArray(config?.peakWindows) && config.peakWindows.length > 0
    ? config.peakWindows
    : DEFAULT_PEAK_WINDOWS
  ).map((w) => ({ start: Number(w.start), end: Number(w.end) }));
  const weekdays = Array.isArray(config?.peakWeekdays) && config.peakWeekdays.length > 0
    ? config.peakWeekdays.map(Number)
    : DEFAULT_PEAK_WEEKDAYS;
  const d = new Date(Number(timeMs) + 8 * 60 * 60 * 1000); // 北京时间
  const hour = d.getUTCHours();
  const weekday = d.getUTCDay(); // 0=周日 … 6=周六
  return weekdays.includes(weekday) && windows.some((w) => hour >= w.start && hour < w.end);
}

/** 把模型字符串规整到定价表键；未识别返回 ""（用 Flash 价兜底）。 */
function modelKey(model) {
  const m = String(model || "").toLowerCase();
  if (m.includes("v4-pro") || m.includes("v4pro")) return "deepseek-v4-pro";
  if (m.includes("v4-flash") || m.includes("v4flash")) return "deepseek-v4-flash";
  if (m.includes("reasoner")) return "deepseek-reasoner";
  if (m.includes("chat")) return "deepseek-chat";
  return "";
}

/** 解析价格：模型基价 + config.price 覆盖，config.peak: true 时按高峰价翻倍。 */
function resolvePricing(config, model = "") {
  const base = MODEL_PRICING[modelKey(model)] ?? FALLBACK_PRICING;
  const price = config?.price ?? {};
  const multiplier = config?.peak === true ? 2 : 1;
  const pick = (name, fallback) => Number(price[name] ?? fallback) * multiplier;
  return {
    inputCnyPerMillion: pick("inputCnyPerMillion", base.inputCnyPerMillion),
    cacheReadCnyPerMillion: pick("cacheReadCnyPerMillion", base.cacheReadCnyPerMillion),
    cacheWriteCnyPerMillion: pick("cacheWriteCnyPerMillion", base.cacheWriteCnyPerMillion),
    outputCnyPerMillion: pick("outputCnyPerMillion", base.outputCnyPerMillion),
  };
}

/** 从会话中识别实际使用的模型。
 *  优先用 DSH 会话的 requestHeader()/requestContext() 折叠结果（即官方 session.models 取 current 的同一来源），
 *  取不到再回退遍历 session.events 找 request/header / request/context 事件。 */
function detectModel(session) {
  if (!session) return "";
  // 1) DSH 官方折叠 API：requestHeader().config.model 或 requestContext().model
  if (typeof session.requestHeader === "function") {
    const header = session.requestHeader();
    const m = header?.config?.model;
    if (typeof m === "string" && m !== "") return m;
  }
  if (typeof session.requestContext === "function") {
    const ctx = session.requestContext();
    const m = ctx?.model;
    if (typeof m === "string" && m !== "") return m;
  }
  // 2) 兜底：遍历事件
  let model = "";
  for (const event of session?.events ?? []) {
    if (event.type === "request/header") {
      const m = event.data?.header?.config?.model;
      if (typeof m === "string" && m !== "") model = m;
    } else if (event.type === "request/context") {
      const m = event.data?.model;
      if (typeof m === "string" && m !== "") model = m;
    }
  }
  return model;
}

async function resolveApiKey(ctx, config) {
  if (typeof config?.apiKey === "string" && config.apiKey.trim() !== "") {
    return config.apiKey.trim();
  }
  const credentials = ctx.get("credentials");
  if (credentials !== void 0) {
    const resolved = await credentials.resolve("DEEPSEEK_API_KEY");
    if (resolved !== void 0 && resolved.value.length > 0) {
      return resolved.value;
    }
  }
  if (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim() !== "") {
    return process.env.DEEPSEEK_API_KEY.trim();
  }
  return "";
}

async function fetchBalance(apiKey, signal) {
  const response = await fetch(DEEPSEEK_BALANCE_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    signal,
  });
  if (response.status === 401) {
    throw new Error("DeepSeek API Key 无效或未授权");
  }
  if (response.status === 402) {
    throw new Error("DeepSeek 账户余额不足或 API 未开通");
  }
  if (!response.ok) {
    throw new Error(`余额查询失败：HTTP ${response.status}`);
  }
  return response.json();
}

function normalizeBalance(data) {
  if (data?.is_available === false) {
    return {
      is_available: false,
      currency: "",
      total_balance: "0.00",
      granted_balance: "0.00",
      topped_up_balance: "0.00",
    };
  }
  const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
  if (infos.length === 0) {
    return {
      is_available: data?.is_available !== false,
      currency: "",
      total_balance: "0.00",
      granted_balance: "0.00",
      topped_up_balance: "0.00",
    };
  }
  const info = infos[0];
  return {
    is_available: data?.is_available !== false,
    currency: info.currency || "",
    total_balance: info.total_balance ?? "0.00",
    granted_balance: info.granted_balance ?? "0.00",
    topped_up_balance: info.topped_up_balance ?? "0.00",
  };
}

function formatBalance(balance) {
  if (!balance.is_available) {
    return "余额不可用：账户当前没有可用余额。";
  }
  if (!balance.total_balance || balance.total_balance === "0.00") {
    return "余额查询成功，但暂无余额明细。";
  }
  return `余额（${balance.currency || "CNY"}）：${balance.total_balance}\n  充值余额：${balance.topped_up_balance}\n  赠送余额：${balance.granted_balance}`;
}

/** 构建模型切换点列表（按时间升序）。request/header、request/context 都在模型或请求设置变化时写入，
 *  故可用它们把会话切成若干"模型段"，每条 assistant/message 归属到"它之前最近一个切换点"的模型。
 *  这样换不同价模型时（如 flash→pro）金额能按各段模型分别计价，而不是整会话用最后一个模型。 */
function collectModelSwitches(events) {
  const switches = [];
  for (const event of events ?? []) {
    if (event.type === "request/header") {
      const m = event.data?.header?.config?.model;
      if (typeof m === "string" && m !== "") switches.push({ time: event.time ?? 0, model: m });
    } else if (event.type === "request/context") {
      const m = event.data?.model;
      if (typeof m === "string" && m !== "") switches.push({ time: event.time ?? 0, model: m });
    }
  }
  switches.sort((a, b) => a.time - b.time);
  return switches;
}

/** 找到 time 之前最近一次模型切换点的模型；无切换点（或早于第一个）返回 ""（调用方回退到后备模型）。 */
function modelAtTime(switches, time) {
  let model = "";
  for (const sp of switches) {
    if (sp.time <= time) model = sp.model;
    else break;
  }
  return model;
}

/** 从事件数组汇总 usage（按模型分段 + 跨时段分桶）。
 *  供 live 会话与持久化（子代理）会话复用。返回按模型拆分的 byModel，及跨模型聚合字段。 */
function sumEventsUsage(events, config, fallbackModel = "") {
  const switches = collectModelSwitches(events);
  const fallback = fallbackModel !== "" ? fallbackModel : "deepseek-v4-flash";
  const latestByStep = new Map();
  for (const event of events ?? []) {
    if (event.type !== "assistant/message") continue;
    const usage = event.data?.usage;
    if (usage === void 0 || usage === null) continue;
    const turn = event.data?.turn;
    const step = event.data?.step;
    if (turn === void 0 || step === void 0) continue;
    latestByStep.set(`${turn}/${step}`, { usage, time: event.time ?? Date.now() });
  }
  const add = (bucket, usage) => {
    bucket.inputTokens += usage.inputTokens ?? 0;
    bucket.outputTokens += usage.outputTokens ?? 0;
    bucket.cacheReadTokens += usage.cacheReadTokens ?? 0;
    bucket.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
  };
  const empty = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  const byModel = new Map(); // model -> { model, peak, offpeak }
  for (const { usage, time } of latestByStep.values()) {
    const model = modelAtTime(switches, time) || fallback;
    let e = byModel.get(model);
    if (!e) { e = { model, peak: empty(), offpeak: empty() }; byModel.set(model, e); }
    add(isPeakAt(time, config) ? e.peak : e.offpeak, usage);
  }
  // 聚合 + 转换 byModel（按金额未在前面算，这里只分桶 + 汇总字段）
  const peak = empty();
  const offpeak = empty();
  const modelList = [];
  for (const e of byModel.values()) {
    modelList.push({ model: e.model, peak: e.peak, offpeak: e.offpeak });
    peak.inputTokens += e.peak.inputTokens;
    peak.outputTokens += e.peak.outputTokens;
    peak.cacheReadTokens += e.peak.cacheReadTokens;
    peak.cacheWriteTokens += e.peak.cacheWriteTokens;
    offpeak.inputTokens += e.offpeak.inputTokens;
    offpeak.outputTokens += e.offpeak.outputTokens;
    offpeak.cacheReadTokens += e.offpeak.cacheReadTokens;
    offpeak.cacheWriteTokens += e.offpeak.cacheWriteTokens;
  }
  const inputTokens = peak.inputTokens + offpeak.inputTokens;
  const outputTokens = peak.outputTokens + offpeak.outputTokens;
  const cacheReadTokens = peak.cacheReadTokens + offpeak.cacheReadTokens;
  const cacheWriteTokens = peak.cacheWriteTokens + offpeak.cacheWriteTokens;
  const billedInputTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    billedInputTokens,
    totalTokens: billedInputTokens + outputTokens,
    peak,
    offpeak,
    byModel: modelList,
  };
}

function sumSessionUsage(session, config) {
  if (session == null) return null;
  // fallbackModel = detectModel(session)：当 message 早于所有模型切换点时兜底，避免落到默认 flash 价。
  return sumEventsUsage(session.events ?? [], config, detectModel(session));
}

function estimateCost(usage, pricing) {
  const costOf = (u) =>
    (u.inputTokens * pricing.inputCnyPerMillion +
      u.cacheReadTokens * pricing.cacheReadCnyPerMillion +
      u.cacheWriteTokens * pricing.cacheWriteCnyPerMillion) /
      1_000_000 +
    (u.outputTokens * pricing.outputCnyPerMillion) / 1_000_000;
  // 跨时段精确计费：高峰桶按高峰价（= 目录价 × 2）、空闲桶按目录价。
  // 注意：若 config.peak:true（resolvePricing 已统一翻倍），高峰桶会再乘一次，两种方式不要同时用。
  return costOf(usage.peak) * 2 + costOf(usage.offpeak);
}

const STATS_DAYS = 90;
const STATS_MAX_SESSIONS = 200;
const STATS_CACHE_MS = 5 * 60 * 1000;

function beijingDayKey(timeMs) {
  return new Date(Number(timeMs) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function emptyTokenBucket() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

function addTokenUsage(target, usage) {
  target.inputTokens += usage.inputTokens ?? 0;
  target.outputTokens += usage.outputTokens ?? 0;
  target.cacheReadTokens += usage.cacheReadTokens ?? 0;
  target.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
}

function tokenTotal(usage) {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

/** 按北京时间把一个会话的最终 assistant/message usage 聚合到每日统计。 */
function collectDailyUsage(events, config, fallbackModel, cutoffMs, days, sessionId) {
  const switches = collectModelSwitches(events);
  const fallback = fallbackModel || "deepseek-v4-flash";
  const latestByStep = new Map();
  for (const event of events ?? []) {
    if (event.type !== "assistant/message") continue;
    const usage = event.data?.usage;
    const turn = event.data?.turn;
    const step = event.data?.step;
    if (usage == null || turn == null || step == null) continue;
    latestByStep.set(`${turn}/${step}`, { usage, time: Number(event.time ?? 0) });
  }
  for (const { usage, time } of latestByStep.values()) {
    if (!Number.isFinite(time) || time < cutoffMs) continue;
    const key = beijingDayKey(time);
    let day = days.get(key);
    if (day == null) {
      day = { date: key, ...emptyTokenBucket(), totalTokens: 0, cost: 0, sessionIds: new Set() };
      days.set(key, day);
    }
    addTokenUsage(day, usage);
    day.totalTokens += tokenTotal({
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    });
    day.sessionIds.add(sessionId);
    const model = modelAtTime(switches, time) || fallback;
    const bucket = { peak: emptyTokenBucket(), offpeak: emptyTokenBucket() };
    addTokenUsage(isPeakAt(time, config) ? bucket.peak : bucket.offpeak, usage);
    day.cost += estimateCost(bucket, resolvePricing(config, model));
  }
}

function recentDayKeys(days, now = Date.now()) {
  const result = [];
  const beijingNow = now + 8 * 60 * 60 * 1000;
  const current = new Date(beijingNow);
  current.setUTCHours(0, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset--) {
    result.push(new Date(current.getTime() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return result;
}

async function buildUsageStats(ctx, config) {
  const persistence = typeof ctx.get === "function" ? ctx.get("sessionPersistence") : void 0;
  if (persistence == null || typeof persistence.list !== "function" || typeof persistence.inspect !== "function") {
    throw new Error("会话持久化服务不可用");
  }
  const now = Date.now();
  const cutoffMs = now - (STATS_DAYS - 1) * 24 * 60 * 60 * 1000;
  const headers = await persistence.list();
  const selected = [...headers]
    .filter((header) => header && typeof header.id === "string")
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
    .slice(0, STATS_MAX_SESSIONS);
  const daily = new Map();
  let cursor = 0;
  let scannedSessions = 0;
  let failedSessions = 0;
  const worker = async () => {
    while (cursor < selected.length) {
      const header = selected[cursor++];
      try {
        const inspected = await persistence.inspect(header.id);
        collectDailyUsage(
          inspected?.events ?? [],
          config,
          detectModel({ requestHeader: () => void 0, requestContext: () => void 0, events: inspected?.events ?? [] }),
          cutoffMs,
          daily,
          header.id,
        );
        scannedSessions++;
      } catch {
        failedSessions++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, () => worker()));

  const rows = recentDayKeys(STATS_DAYS, now).map((date) => {
    const day = daily.get(date);
    if (day == null) {
      return { date, ...emptyTokenBucket(), totalTokens: 0, cost: 0, sessions: 0 };
    }
    return {
      date,
      inputTokens: day.inputTokens,
      outputTokens: day.outputTokens,
      cacheReadTokens: day.cacheReadTokens,
      cacheWriteTokens: day.cacheWriteTokens,
      totalTokens: day.totalTokens,
      cost: day.cost,
      sessions: day.sessionIds.size,
    };
  });
  const total = rows.reduce((acc, day) => {
    acc.inputTokens += day.inputTokens;
    acc.outputTokens += day.outputTokens;
    acc.cacheReadTokens += day.cacheReadTokens;
    acc.cacheWriteTokens += day.cacheWriteTokens;
    acc.totalTokens += day.totalTokens;
    acc.cost += day.cost;
    return acc;
  }, { ...emptyTokenBucket(), totalTokens: 0, cost: 0 });
  return {
    days: rows,
    total,
    rangeDays: STATS_DAYS,
    scannedSessions,
    failedSessions,
    availableSessions: headers.length,
    limited: headers.length > selected.length,
    generatedAt: now,
  };
}

/** 汇总某会话的所有子代理后代会话的 usage（跨时段精确计费，与主会话分开）。
 *  @param ctx DSH 上下文（用于 subagents 服务 + 跨版本持久化会话读取）
 *  @param sessionId 父会话 id
 *  @param config 插件配置
 *  说明：子代理会话结束后会被从 live 会话 store 移除，故不能用 store.list() 枚举；
 *  这里用 subagents 服务的 listDescendants（含已结束/嵌套子代理）取后代 id，
 *  再对每个子代理用兼容读取器取得持久化事件并计算 usage。无子代理返回 {usage:null,debug}。 */
async function sumSubagentUsage(ctx, sessionId, config) {
  if (ctx == null || sessionId === "") return { usage: null };
  // 用 ctx.get("subagents") 安全获取（非注入，可空）；不要直接读 ctx.subagents 属性，
  // 否则未声明注入时会抛 "cannot get property subagents without inject"。
  const subagentsSvc = typeof ctx.get === "function" ? ctx.get("subagents") : void 0;
  const listDescendants = subagentsSvc != null && typeof subagentsSvc.listDescendants === "function" ? subagentsSvc.listDescendants.bind(subagentsSvc) : void 0;
  // 1) 用 subagents.listDescendants 一次取完整后代树（含编号/层级/已结束）
  let descendants = [];
  if (listDescendants != null) {
    try {
      descendants = await listDescendants(sessionId);
    } catch {
      descendants = [];
    }
  }
  const childIds = new Set();
  for (const e of descendants) {
    if (e == null || typeof e !== "object") continue;
    if (typeof e.id !== "string" || e.id === "") continue;
    childIds.add(e.id);
  }
  if (childIds.size === 0) return { usage: null };

  // 2) 对每个子代理读取持久化事件并求和
  const empty = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  const peak = empty();
  const offpeak = empty();
  const byModelMap = new Map(); // model -> { model, peak, offpeak }
  let count = 0;
  for (const id of childIds) {
    try {
      const inspected = await inspectPersistedSession(ctx, id);
      const events = Array.isArray(inspected?.events) ? inspected.events : [];
      const u = sumEventsUsage(events, config);
      if (u === null || u === void 0) continue;
      count++;
      peak.inputTokens += u.peak.inputTokens;
      peak.outputTokens += u.peak.outputTokens;
      peak.cacheReadTokens += u.peak.cacheReadTokens;
      peak.cacheWriteTokens += u.peak.cacheWriteTokens;
      offpeak.inputTokens += u.offpeak.inputTokens;
      offpeak.outputTokens += u.offpeak.outputTokens;
      offpeak.cacheReadTokens += u.offpeak.cacheReadTokens;
      offpeak.cacheWriteTokens += u.offpeak.cacheWriteTokens;
      // 子代理也可能换模型，按模型同样分桶聚合
      for (const b of u.byModel ?? []) {
        let be = byModelMap.get(b.model);
        if (!be) { be = { model: b.model, peak: empty(), offpeak: empty() }; byModelMap.set(b.model, be); }
        be.peak.inputTokens += b.peak.inputTokens;
        be.peak.outputTokens += b.peak.outputTokens;
        be.peak.cacheReadTokens += b.peak.cacheReadTokens;
        be.peak.cacheWriteTokens += b.peak.cacheWriteTokens;
        be.offpeak.inputTokens += b.offpeak.inputTokens;
        be.offpeak.outputTokens += b.offpeak.outputTokens;
        be.offpeak.cacheReadTokens += b.offpeak.cacheReadTokens;
        be.offpeak.cacheWriteTokens += b.offpeak.cacheWriteTokens;
      }
    } catch {
      // 该子代理读取失败则跳过
    }
  }
  if (count === 0) return { usage: null };
  const inputTokens = peak.inputTokens + offpeak.inputTokens;
  const outputTokens = peak.outputTokens + offpeak.outputTokens;
  const cacheReadTokens = peak.cacheReadTokens + offpeak.cacheReadTokens;
  const cacheWriteTokens = peak.cacheWriteTokens + offpeak.cacheWriteTokens;
  const billedInputTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
  const usage = {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    billedInputTokens,
    totalTokens: billedInputTokens + outputTokens,
    peak,
    offpeak,
    byModel: [...byModelMap.values()],
    sessions: count,
  };
  return { usage };
}

function formatUsage(usage, pricing, model = "") {
  const cost = estimateCost(usage, pricing);
  const newTokens = usage.inputTokens + usage.outputTokens;
  const peakTokens = usage.peak.inputTokens + usage.peak.cacheReadTokens + usage.peak.cacheWriteTokens + usage.peak.outputTokens;
  const offpeakTokens = usage.offpeak.inputTokens + usage.offpeak.cacheReadTokens + usage.offpeak.cacheWriteTokens + usage.offpeak.outputTokens;
  const modelLine = model === "" ? "" : `（模型 ${model}）`;
  const lines = [
    `当前会话消耗${modelLine}：`,
    `  新增 tokens：${newTokens}（未缓存输入 ${usage.inputTokens} + 输出 ${usage.outputTokens}）`,
    `  计费 tokens：${usage.totalTokens}（含缓存重读 ${usage.cacheReadTokens}、缓存写入 ${usage.cacheWriteTokens}）`,
    `    - 未缓存输入：${usage.inputTokens}`,
    `    - 缓存读取：${usage.cacheReadTokens}`,
    `    - 缓存写入：${usage.cacheWriteTokens}`,
    `    - 输出 tokens：${usage.outputTokens}`,
    `  估算消耗：¥${cost.toFixed(4)}（按 ${modelKey(model) || "deepseek-v4-flash"} 目录价估算，实际以账单为准）`,
    `  时段拆分：高峰 ${peakTokens} tokens、空闲 ${offpeakTokens} tokens（跨时段按各自时段价计费）`,
  ];
  return lines.join("\n");
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

export function apply(ctx, config = {}) {
  let statsCache = { expiresAt: 0, value: null };
  // DSH 热重载(reload)时会重新 apply 本插件；若旧实例注册的 /balance-api 路由
  // 未被清理，新实例再次 register 就会抛出 duplicate route，导致整个 apply 失败、
  // 余额不显示。这里收集每次 register 返回的 disposer，并在插件卸载(ctx.on("dispose"))
  // 时统一清理，保证重复 apply 不冲突。
  const disposers = [];

  // 1) /balance 命令：保留命令行查询入口
  ctx.inject(["commands"], (commandCtx) => {
    commandCtx.commands.register({
      name: "balance",
      description: "查询 DeepSeek 余额与当前会话消耗",
      handler: async ({ agent, signal }) => {
        const apiKey = await resolveApiKey(ctx, config);
        if (apiKey === "") {
          return {
            kind: "error",
            text: "未找到 DeepSeek API Key，请设置环境变量 DEEPSEEK_API_KEY 后重试。",
          };
        }

        const usage = sumSessionUsage(agent.session, config);
        const model = detectModel(agent.session);
        const pricing = resolvePricing(config, model);

        try {
          const data = await fetchBalance(apiKey, signal);
          const balanceText = formatBalance(normalizeBalance(data));
          return {
            kind: "success",
            text: `${balanceText}\n\n${formatUsage(usage, pricing, model)}`,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            kind: "error",
            text: `${message}\n\n${formatUsage(usage, pricing, model)}`,
          };
        }
      },
    });
  });

  // 2) /balance-api HTTP 接口：供客户端插件直接渲染余额（不经过命令，不污染会话日志）
  // 注意：不要在这里声 inject ["subagents"] —— 它依赖 dsh-subagent 服务；
  //      若 balance-dsh 加载时该服务未就绪，Cordis 会跳过整个 callback，导致
  //      /balance-api 不注册（404）。改为只声 inject ["webServer"]，子代理在
  //      sumSubagentUsage 内部用可空 ctx.get("subagents") 获取。
  ctx.inject(["webServer"], (httpCtx) => {
    const balanceRouteDisposer = httpCtx.webServer.register({
      kind: "exact",
      path: "/balance-api",
      handler: async (req, res) => {
        if (req.method !== "GET") {
          writeJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        // 客户端把当前会话使用的模型通过 ?model= 传入，服务端按模型取价；
        // 可选 ?session= 传入会话 id，服务端返回该会话的分时段 usage（跨时段精确计费用）
        let model = "";
        let sessionParam = "";
        let wantStats = false;
        try {
          const search = new URL(req.url, "http://localhost").searchParams;
          model = search.get("model") ?? "";
          sessionParam = search.get("session") ?? "";
          wantStats = search.get("stats") === "1";
        } catch {
          model = "";
          sessionParam = "";
          wantStats = false;
        }
        let stats = null;
        let statsError = "";
        if (wantStats) {
          try {
            if (statsCache.value == null || statsCache.expiresAt <= Date.now()) {
              statsCache = {
                value: await buildUsageStats(httpCtx, config),
                expiresAt: Date.now() + STATS_CACHE_MS,
              };
            }
            stats = statsCache.value;
          } catch (error) {
            statsError = error instanceof Error ? error.message : String(error);
          }
        }
        const apiKey = await resolveApiKey(ctx, config);
        if (apiKey === "") {
          if (wantStats) {
            writeJson(res, 200, {
              ok: true,
              balance: null,
              balanceError: "未设置 DEEPSEEK_API_KEY",
              pricing: resolvePricing(config, model),
              stats,
              statsError,
            });
          } else {
            writeJson(res, 200, { ok: false, error: "未设置 DEEPSEEK_API_KEY" });
          }
          return;
        }
        // 按 session id 取会话并分时段汇总 usage（拿不到则返回 null，客户端回退用本地投影）
        let usage = null;
        // 子代理后代会话的 usage 汇总（与主会话分开）
        let subagentUsage = null;
        // 从会话事件识别实际使用模型（客户端未传 ?model= 时兜底）
        let detectedModel = "";
        if (sessionParam !== "") {
          try {
            const sessions = ctx.get("sessions");
            const session = sessions && typeof sessions.get === "function" ? sessions.get(sessionParam) : void 0;
            if (session !== void 0) {
              usage = sumSessionUsage(session, config);
              detectedModel = detectModel(session);
            }
            // 子代理枚举走持久化目录（不依赖 live 会话），即使父会话不在内存也能拿到
            const subRes = await sumSubagentUsage(httpCtx, sessionParam, config);
            subagentUsage = subRes.usage;
          } catch {
            usage = null;
            subagentUsage = null;
          }
        }
        // 客户端优先用自己解析的 model；为空则回退到服务端 detectModel
        const effectiveModel = model || detectedModel;
        // 逐模型标注 cost（高峰期×2、空闲期×1），客户端直接按各模型 cost 累加，无需自己定价。
        if (usage && Array.isArray(usage.byModel)) {
          usage.byModel = usage.byModel.map((b) => ({ ...b, cost: estimateCost(b, resolvePricing(config, b.model)) }));
        }
        if (subagentUsage && Array.isArray(subagentUsage.byModel)) {
          subagentUsage.byModel = subagentUsage.byModel.map((b) => ({ ...b, cost: estimateCost(b, resolvePricing(config, b.model)) }));
        }
        try {
          const data = await fetchBalance(apiKey);
          writeJson(res, 200, {
            ok: true,
            balance: normalizeBalance(data),
            pricing: resolvePricing(config, effectiveModel),
            model: effectiveModel,
            usage,
            subagentUsage,
            stats,
            statsError,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (wantStats) {
            writeJson(res, 200, {
              ok: true,
              balance: null,
              balanceError: message,
              pricing: resolvePricing(config, effectiveModel),
              stats,
              statsError,
            });
          } else {
            writeJson(res, 200, { ok: false, error: message });
          }
        }
      },
    });
    if (typeof balanceRouteDisposer === "function") disposers.push(balanceRouteDisposer);
  });

  // 插件卸载/dispose 时清理本实例注册的路由，避免 DSH 热重载时旧实例残留
  // 的路由导致新实例 register /balance-api 抛 duplicate route、插件启动失败。
  const release = () => {
    for (const d of disposers) {
      try { d(); } catch { /* ignore */ }
    }
  };
  if (typeof ctx.on === "function") ctx.on("dispose", release);
}
