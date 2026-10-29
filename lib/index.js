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

  throw new Error("当前 DeepSeek Harness 未提供兼容的持久化会话读取接口");
}

const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";

// DeepSeek 目录价（人民币/百万 tokens），按模型区分。默认取 2026-08-17 生效的
// V4 峰谷定价之空闲时段价；高峰时段（每日 9:00 / 14:00）价格为下表 2 倍，
// 可在 config.peak: true 时统一翻倍，或在 config.price 中逐项覆盖。
// V4-Flash 空闲：输入未命中 1 / 命中 0.02 / 输出 4（北京时间 2026-09-10 12:00 起的新价）
// V4-Pro   空闲：输入未命中 4.5 / 命中 0.15 / 输出 13.5（官方 2026-09-14 后继续提供，计费不变）
const MODEL_PRICING = {
  "deepseek-v4-flash": { inputCnyPerMillion: 1, cacheReadCnyPerMillion: 0.02, cacheWriteCnyPerMillion: 0, outputCnyPerMillion: 4 },
  "deepseek-v4-pro": { inputCnyPerMillion: 4.5, cacheReadCnyPerMillion: 0.15, cacheWriteCnyPerMillion: 0, outputCnyPerMillion: 13.5 },
  // 旧模型兜底（V3.2 时代目录价）
  "deepseek-chat": { inputCnyPerMillion: 2, cacheReadCnyPerMillion: 0.5, cacheWriteCnyPerMillion: 0, outputCnyPerMillion: 3 },
  "deepseek-reasoner": { inputCnyPerMillion: 4, cacheReadCnyPerMillion: 1, cacheWriteCnyPerMillion: 0, outputCnyPerMillion: 16 },
};
const FALLBACK_PRICING = MODEL_PRICING["deepseek-v4-flash"];

// 定价历史：官方自北京时间 2026-09-10 12:00 起下调 flash 系列价格。
// 调价前产生的 token 仍按当时旧价计算（历史消耗金额不因后续调价而改变），
// 之后的消耗用 MODEL_PRICING（新价）。按每条 usage 的事件时间戳自动选择。
const FLASH_REPRICED_AT = Date.parse("2026-09-10T12:00:00+08:00");
const LEGACY_MODEL_PRICING = {
  "deepseek-v4-flash": { inputCnyPerMillion: 1.5, cacheReadCnyPerMillion: 0.05, cacheWriteCnyPerMillion: 0, outputCnyPerMillion: 4.5 },
};
/** 事件时间在调价前返回 "legacy"（旧价），之后返回 "current"（新价）。 */
function pricingEraAt(time) {
  return Number(time) < FLASH_REPRICED_AT ? "legacy" : "current";
}

// 高峰/空闲时段（V4 峰谷定价，2026-08-17 生效）：高峰价 = 空闲价 × 2。
// 官方高峰窗口（北京时间）为 工作日 09:00-12:00、14:00-18:00；
// 周末与法定节假日全天空闲，但**调休上班的周末**按工作日算（2026-09-20 DeepSeek 明确此规则）。
// 可用 config.peakWindows 覆盖小时窗口（如 [{start:9,end:12},{start:14,end:18}]），
// 可用 config.peakWeekdays 覆盖周几（1=周一 … 5=周五，默认 [1,2,3,4,5]，0/6=周末）。
const DEFAULT_PEAK_WINDOWS = [
  { start: 9, end: 12 },
  { start: 14, end: 18 },
];
const DEFAULT_PEAK_WEEKDAYS = [1, 2, 3, 4, 5];

// 中国大陆法定节假日与调休（日期为北京时区）。来源：国务院办公厅《关于2026年部分节假日安排的通知》
// （国办发明电〔2025〕7号）。holiday = 法定节假日（全天按空闲计费）；workday = 调休上班的周末（按工作日峰谷计费）。
// ⚠️ 国务院每年 11 月前后公布次年安排，届时需补录。lib/client.js 有一份同样的表（用于时段标签），两处必须同步。
const CN_CALENDAR = {
  // 元旦：1/1-1/3 放假，1/4(周日) 上班
  "2026-01-01": "holiday", "2026-01-02": "holiday", "2026-01-03": "holiday", "2026-01-04": "workday",
  // 春节：2/15-2/23 放假，2/14(周六)、2/28(周六) 上班
  "2026-02-14": "workday",
  "2026-02-15": "holiday", "2026-02-16": "holiday", "2026-02-17": "holiday", "2026-02-18": "holiday",
  "2026-02-19": "holiday", "2026-02-20": "holiday", "2026-02-21": "holiday", "2026-02-22": "holiday",
  "2026-02-23": "holiday", "2026-02-28": "workday",
  // 清明节：4/4-4/6 放假（无调休）
  "2026-04-04": "holiday", "2026-04-05": "holiday", "2026-04-06": "holiday",
  // 劳动节：5/1-5/5 放假，5/9(周六) 上班
  "2026-05-01": "holiday", "2026-05-02": "holiday", "2026-05-03": "holiday", "2026-05-04": "holiday",
  "2026-05-05": "holiday", "2026-05-09": "workday",
  // 端午节：6/19-6/21 放假（无调休）
  "2026-06-19": "holiday", "2026-06-20": "holiday", "2026-06-21": "holiday",
  // 国庆节调休：9/20(周日) 上班
  "2026-09-20": "workday",
  // 中秋节：9/25-9/27 放假（无调休）
  "2026-09-25": "holiday", "2026-09-26": "holiday", "2026-09-27": "holiday",
  // 国庆节：10/1-10/7 放假，10/10(周六) 上班
  "2026-10-01": "holiday", "2026-10-02": "holiday", "2026-10-03": "holiday", "2026-10-04": "holiday",
  "2026-10-05": "holiday", "2026-10-06": "holiday", "2026-10-07": "holiday", "2026-10-10": "workday",
};

// 节假日自动补录：内置表仅作**离线兜底**，运行时从社区维护的源拉取（其 papers 字段直接引用国务院公告）。
// 源不可用/无网络/被 CSP 拦截时静默失败，继续用内置表；拉取结果按日期覆盖同键条目。
const CN_CALENDAR_SOURCE = "https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master";
const cnCalendarYears = new Set();

/** 拉取指定年份的节假日安排并合并进 CN_CALENDAR（幂等；失败静默，不阻塞调用方）。 */
async function ensureCnCalendar(year) {
  if (cnCalendarYears.has(year)) return;
  cnCalendarYears.add(year); // 先占位，避免并发重复请求
  try {
    const res = await fetch(CN_CALENDAR_SOURCE + "/" + year + ".json", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data?.days)) return;
    for (const item of data.days) {
      if (item && typeof item.date === "string" && typeof item.isOffDay === "boolean") {
        CN_CALENDAR[item.date] = item.isOffDay ? "holiday" : "workday";
      }
    }
  } catch {
    // 网络不可用：保留内置表（该年调休会退化为「周末全天空闲」）
  }
}

/** 北京时区日期键 YYYY-MM-DD（传入已 +8h 偏移的 Date）。 */
function cnDateKey(d) {
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}

/** 判断某时间戳（毫秒）是否处于高峰时段（北京时间；含周末、法定节假日与调休上班判断）。 */
function isPeakAt(timeMs, config) {
  const windows = (Array.isArray(config?.peakWindows) && config.peakWindows.length > 0
    ? config.peakWindows
    : DEFAULT_PEAK_WINDOWS
  ).map((w) => ({ start: Number(w.start), end: Number(w.end) }));
  const weekdays = Array.isArray(config?.peakWeekdays) && config.peakWeekdays.length > 0
    ? config.peakWeekdays.map(Number)
    : DEFAULT_PEAK_WEEKDAYS;
  const d = new Date(Number(timeMs) + 8 * 60 * 60 * 1000); // 北京时间
  const kind = CN_CALENDAR[cnDateKey(d)];
  if (kind === "holiday") return false; // 法定节假日：全天按空闲计费
  const hour = d.getUTCHours();
  const weekday = d.getUTCDay(); // 0=周日 … 6=周六
  // 官方定价页口径（2026-10 核对）：周一至周五为工作日高峰区，其余时段
  // 「包括周末及中国法定节假日全天」均为空闲。所以**调休上班的周末也按周末处理**，
  // 不参与峰谷判定（CN_CALENDAR 里的 workday 条目只保留作数据，不再影响计费）。
  return weekdays.includes(weekday) && windows.some((w) => hour >= w.start && hour < w.end);
}

/** 把模型字符串规整到定价表键；未识别返回 ""（用 Flash 价兜底）。
 *  注意：官方已把 Flash 主名改为 `deepseek-flash`，旧名 `deepseek-v4-flash` /
 *  `deepseek-v4-flash-vision-exp` 虽已退役但仍按 Flash 价计费，因此统一按 "flash" 匹配。 */
function modelKey(model) {
  const m = String(model || "").toLowerCase();
  if (m.includes("v4-pro") || m.includes("v4pro") || m.includes("-pro")) return "deepseek-v4-pro";
  if (m.includes("flash")) return "deepseek-v4-flash";
  if (m.includes("reasoner")) return "deepseek-reasoner";
  if (m.includes("chat")) return "deepseek-chat";
  return "";
}

/** 目录价（**不含峰谷倍率**）：模型基价 + 覆盖价（`config.priceByModel[模型]` 优先，其次 `config.price`）。
 *  era = "legacy" 时取调价前的历史价（目前仅 flash 系列与现价不同）。
 *  注意：用户在配置界面填了覆盖价时，该价对所有计费时代生效（他是主动要改价，不是历史重算）。
 *  ⚠️ 精确计费（estimateCost）必须用这个**原价**，否则会与高峰倍率重复相乘（见 estimateCost 注释）。 */
function catalogPricing(config, model = "", era = "current") {
  const key = modelKey(model);
  const base = (era === "legacy" && LEGACY_MODEL_PRICING[key]) || MODEL_PRICING[key] || FALLBACK_PRICING;
  const price = config?.priceByModel?.[key] ?? config?.price ?? {};
  const pick = (name, fallback) => Number(price[name] ?? fallback);
  return {
    inputCnyPerMillion: pick("inputCnyPerMillion", base.inputCnyPerMillion),
    cacheReadCnyPerMillion: pick("cacheReadCnyPerMillion", base.cacheReadCnyPerMillion),
    cacheWriteCnyPerMillion: pick("cacheWriteCnyPerMillion", base.cacheWriteCnyPerMillion),
    outputCnyPerMillion: pick("outputCnyPerMillion", base.outputCnyPerMillion),
  };
}

/** 高峰时段价格倍率：`config.peakMultiplier`（旧的 `config.peak: true` 等价于 ×2）。 */
function peakMultiplierOf(config) {
  const custom = Number(config?.peakMultiplier);
  if (Number.isFinite(custom) && custom > 0) return custom;
  return config?.peak === true ? 2 : 1;
}

/** 当前时段价 = 目录价 × 高峰倍率。**仅用于展示**（客户端按它估算"此刻"的单价）；
 *  精确计费请用 `catalogPricing` + `peakMultiplierOf` 组合，不要用这个函数的结果再乘倍率。 */
function resolvePricing(config, model = "", era = "current") {
  const base = catalogPricing(config, model, era);
  const multiplier = peakMultiplierOf(config);
  return {
    inputCnyPerMillion: base.inputCnyPerMillion * multiplier,
    cacheReadCnyPerMillion: base.cacheReadCnyPerMillion * multiplier,
    cacheWriteCnyPerMillion: base.cacheWriteCnyPerMillion * multiplier,
    outputCnyPerMillion: base.outputCnyPerMillion * multiplier,
  };
}

/** 取会话事件数组。DSH 2.0.4 起 live session **不再有 `.events` 属性**，改用 `snapshotEvents()` 方法
 *  （签名 `snapshotEvents(fromSeq = 0, toSeqExclusive = seq)`，可无参调用取全部事件）；
 *  旧版仍读 `.events` 属性。两者都拿不到时返回空数组（由调用方降级）。 */
function sessionEvents(session) {
  if (!session) return [];
  if (typeof session.snapshotEvents === "function") {
    try {
      const events = session.snapshotEvents();
      if (Array.isArray(events)) return events;
    } catch {
      // 落到旧属性兜底
    }
  }
  return Array.isArray(session.events) ? session.events : [];
}

/** 从会话中识别实际使用的模型。
 *  优先用 DSH 会话的 requestHeader()/requestContext() 折叠结果（即官方 session.models 取 current 的同一来源），
 *  取不到再回退遍历会话事件找 request/header / request/context 事件。 */
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
  for (const event of sessionEvents(session)) {
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

// ── 官方 DeepSeek Harness 账号服务（ctx.deepseekAccount）──────────────────────
// 官方桌面版内置账号登录（系统浏览器 PKCE），登录后可直接读到官方余额，无需 API Key。
// 服务由 @deepseek-ai/dsh-deepseek-account-platform 提供，已被 dsh-base 默认依赖，故官方版开箱即有。
// 接口：getBalance(client) → { status:"ready", value: 充值钱包[], bonusWallets: 赠送钱包[] }
//                          | null                 （未登录 / 凭据已变更）
//                          | { status:"failed" }  （网络失败；官方明确“失败绝不变成 0 余额”）
// client 是 AccountClientMetadata（version / locale / timezoneOffsetSeconds），
// 缺字段会在平台侧组装请求头时抛错，所以三个字段都要给。
const PLUGIN_VERSION = "2.0.0";

/**
 * 读取官方账号余额并归一化成与 normalizeBalance 相同的形状。
 * 服务不存在、未登录、接口报错一律返回 null，由调用方回退 API Key，绝不因此抛错。
 */
async function fetchAccountBalance(ctx) {
  const account = typeof ctx.get === "function" ? ctx.get("deepseekAccount") : void 0;
  if (account === void 0 || account === null || typeof account.getBalance !== "function") return null;
  let result;
  try {
    result = await account.getBalance({
      version: PLUGIN_VERSION,
      locale: "zh-CN",
      // 平台要求“东为正”的整秒偏移；JS 的 getTimezoneOffset() 是西为正，故取反。
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    });
  } catch {
    return null;
  }
  if (result === null || result === void 0 || result.status !== "ready") return null;
  return normalizeAccountBalance(result);
}

/** 官方钱包结构 → 统一余额形状。value 是充值钱包，bonusWallets 是赠送钱包（官方不计入充值余额）。 */
function normalizeAccountBalance(result) {
  const pick = (list) => {
    const arr = Array.isArray(list) ? list.filter((w) => w && typeof w.balance === "string") : [];
    return arr.find((w) => w.currency === "CNY") ?? arr[0] ?? null;
  };
  const topped = pick(result.value);
  const granted = pick(result.bonusWallets);
  // 官方金额字符串遵循 big.js 文法（允许 0E-16 这类写法），Number() 能正确解析。
  const toppedRaw = Number(topped?.balance ?? 0);
  const grantedRaw = Number(granted?.balance ?? 0);
  const toppedUp = Number.isFinite(toppedRaw) ? toppedRaw : 0;
  const grantedAmount = Number.isFinite(grantedRaw) ? grantedRaw : 0;
  const total = toppedUp + grantedAmount;
  return {
    is_available: total > 0,
    currency: topped?.currency || granted?.currency || "CNY",
    total_balance: total.toFixed(2),
    granted_balance: grantedAmount.toFixed(2),
    topped_up_balance: toppedUp.toFixed(2),
    source: "account",
  };
}

/** 取余额：官方账号优先，回退 DeepSeek API Key。返回 { balance, error }，二者必有其一。 */
async function resolveBalance(ctx, config, signal) {  const fromAccount = await fetchAccountBalance(ctx);
  if (fromAccount !== null) return { balance: fromAccount, error: null };
  const apiKey = await resolveApiKey(ctx, config);
  if (apiKey === "") {
    return { balance: null, error: "未登录 DeepSeek 账号，也未设置 DEEPSEEK_API_KEY" };
  }
  try {
    const data = await fetchBalance(apiKey, signal);
    return { balance: { ...normalizeBalance(data), source: "apikey" }, error: null };
  } catch (error) {
    return { balance: null, error: error instanceof Error ? error.message : String(error) };
  }
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

/** 建立 `turn/step` → **请求发起时刻** 的映射（取自 step/start 事件）。
 *  峰谷判定、模型归属、价格时代都应该看"发起时刻"，而不是 assistant/message 的完成时刻：
 *  请求跨越时段边界时（如 11:59 发起、12:01 完成），按发起时刻归属才符合"按请求到达时刻计费"。
 *  实测平均请求耗时 5.6 秒、最长 127 秒，撞上边界的概率极低，但这样更严谨。
 *  拿不到 step/start（旧数据、部分子代理会话）时由调用方回退到完成时刻。 */
function stepStartTimes(events) {
  const starts = new Map();
  for (const event of events ?? []) {
    if (event.type !== "step/start") continue;
    const turn = event.data?.turn;
    const step = event.data?.step;
    if (turn === void 0 || step === void 0) continue;
    const time = Number(event.time);
    if (!Number.isFinite(time)) continue;
    starts.set(`${turn}/${step}`, time);
  }
  return starts;
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

/** 网页搜索 / 抓取工具按次计费（官方 2026-10-17 上线 Search/Fetch API 公告）：
 *  · Search 与 Fetch 同价：**每千次 ¥5**（= ¥0.005 / 次），结果条数不影响价格；
 *  · 只有 Search 返回非空结果、Fetch 返回正文且 HTTP 200 才计费，失败/空结果/超时不计费；
 *  · **北京时间 2026-11-01 00:00 起开始收费**，此前的调用免费。
 *  会话事件里 tool/call 带 { callId, name, arguments }（name = web_search / web_fetch），
 *  tool/result 带 { toolCallId, message: { isError, content } }，按 callId 配对就能算钱。 */
const WEB_TOOL_BILLING_START = Date.parse("2026-11-01T00:00:00+08:00");
const WEB_TOOL_PRICE_PER_CALL = 5 / 1000;

/** 统计网页工具调用：次数、可计费次数与金额。
 *  只认 tool/call 与 tool/result 配对成功、且 isError !== true 的调用（官方口径：失败不计费）。 */
function webToolUsage(events) {
  const calls = new Map(); // callId -> { name, time }
  for (const event of events ?? []) {
    if (event.type !== "tool/call") continue;
    const name = event.data?.name;
    if (name !== "web_search" && name !== "web_fetch") continue;
    const time = Number(event.time ?? 0);
    if (!Number.isFinite(time)) continue;
    const id = event.data?.callId;
    if (id === void 0 || id === null) continue;
    calls.set(String(id), { name, time });
  }
  let webSearchCalls = 0;
  let webFetchCalls = 0;
  let webSearchBillable = 0;
  let webFetchBillable = 0;
  let webSearchCost = 0;
  let webFetchCost = 0;
  const done = new Set();
  for (const event of events ?? []) {
    if (event.type !== "tool/result") continue;
    const id = event.data?.toolCallId ?? event.data?.message?.toolCallId;
    const key = id === void 0 || id === null ? "" : String(id);
    const call = calls.get(key);
    if (call === void 0 || done.has(key)) continue;
    done.add(key);
    if (event.data?.message?.isError === true) continue; // 失败不计费
    if (call.name === "web_search") webSearchCalls += 1;
    else webFetchCalls += 1;
    if (call.time >= WEB_TOOL_BILLING_START) {
      if (call.name === "web_search") {
        webSearchBillable += 1;
        webSearchCost += WEB_TOOL_PRICE_PER_CALL;
      } else {
        webFetchBillable += 1;
        webFetchCost += WEB_TOOL_PRICE_PER_CALL;
      }
    }
  }
  return {
    webSearchCalls,
    webFetchCalls,
    webSearchBillable,
    webFetchBillable,
    webSearchCost,
    webFetchCost,
    webToolCost: webSearchCost + webFetchCost,
  };
}

/** 从事件数组汇总 usage（按模型分段 + 跨时段分桶）。
 *  供 live 会话与持久化（子代理）会话复用。返回按模型拆分的 byModel，及跨模型聚合字段。 */
function sumEventsUsage(events, config, fallbackModel = "") {
  const switches = collectModelSwitches(events);
  const starts = stepStartTimes(events);
  const fallback = fallbackModel !== "" ? fallbackModel : "deepseek-v4-flash";
  // 网页搜索 / 抓取：次数 + 按次计费金额（2026-11-01 起才收费）
  const webTools = webToolUsage(events);
  const latestByStep = new Map();
  for (const event of events ?? []) {
    if (event.type !== "assistant/message") continue;
    const usage = event.data?.usage;
    if (usage === void 0 || usage === null) continue;
    const turn = event.data?.turn;
    const step = event.data?.step;
    if (turn === void 0 || step === void 0) continue;
    // 时刻取"请求发起时刻"（step/start），拿不到时回退 assistant/message 的完成时刻
    const time = starts.get(`${turn}/${step}`) ?? event.time ?? Date.now();
    latestByStep.set(`${turn}/${step}`, { usage, time });
  }
  const add = (bucket, usage) => {
    bucket.inputTokens += usage.inputTokens ?? 0;
    bucket.outputTokens += usage.outputTokens ?? 0;
    bucket.cacheReadTokens += usage.cacheReadTokens ?? 0;
    bucket.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
  };
  const empty = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  const byModel = new Map(); // `${model}\0${era}` -> { model, era, peak, offpeak }
  for (const { usage, time } of latestByStep.values()) {
    const model = modelAtTime(switches, time) || fallback;
    // 同一模型在调价前后的 token 分开分桶，各自用当时的价格计算（历史金额不变）。
    const era = pricingEraAt(time);
    const key = `${model}\u0000${era}`;
    let e = byModel.get(key);
    if (!e) { e = { model, era, peak: empty(), offpeak: empty() }; byModel.set(key, e); }
    add(isPeakAt(time, config) ? e.peak : e.offpeak, usage);
  }
  // 聚合 + 转换 byModel（按金额未在前面算，这里只分桶 + 汇总字段）
  const peak = empty();
  const offpeak = empty();
  const modelList = [];
  for (const e of byModel.values()) {
    modelList.push({ model: e.model, era: e.era, peak: e.peak, offpeak: e.offpeak, cost: estimateCost(e, catalogPricing(config, e.model, e.era), peakMultiplierOf(config)) });
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
    ...webTools,
  };
}

function sumSessionUsage(session, config) {
  if (session == null) return null;
  // fallbackModel = detectModel(session)：当 message 早于所有模型切换点时兜底，避免落到默认 flash 价。
  return sumEventsUsage(sessionEvents(session), config, detectModel(session));
}

/** 精确计费：高峰桶按**目录价 × 倍率**、空闲桶按目录价。
 *  ⚠️ `pricing` 必须是 `catalogPricing()` 的**原价**（不含倍率）。历史上这里收的是
 *  `resolvePricing()` 的结果（已含倍率），再乘一次 2 导致高峰 ×4、空闲 ×2 —— 金额虚高约 3 倍。 */
function estimateCost(usage, pricing, multiplier = 2) {
  const costOf = (u, factor) =>
    ((u.inputTokens * pricing.inputCnyPerMillion +
      u.cacheReadTokens * pricing.cacheReadCnyPerMillion +
      u.cacheWriteTokens * pricing.cacheWriteCnyPerMillion) /
      1_000_000 +
      (u.outputTokens * pricing.outputCnyPerMillion) / 1_000_000) *
    factor;
  return costOf(usage.peak, multiplier) + costOf(usage.offpeak, 1);
}

const STATS_DAYS = 90;
const STATS_MAX_SESSIONS = 200;
const STATS_CACHE_MS = 5 * 60 * 1000;

// ───────────────────────────────────────────────────────────────────────────
// 插件设置：由 DSH「插件」页 → balance-dsh 详情页的配置卡片读写（slot
// `plugins.bundle.config`，见 lib/client.js），落在 <dshHome>/balance-dsh.json。
// 刻意不接 DSH 的 settings / storageDomain 服务——那些内部 API 无兼容承诺，
// 而这个插件已经被 DSH 升级打断过多次；普通 JSON 文件不会因升级失效。
// ───────────────────────────────────────────────────────────────────────────

const SETTINGS_FILENAME = "balance-dsh.json";

/** 出厂默认值；同时是字段白名单（不在这里的键一律丢弃）。 */
const DEFAULT_SETTINGS = {
  // 余额
  refreshIntervalSec: 60, // 余额轮询间隔（秒）
  lowBalanceThreshold: 10, // 低于该金额用警示色
  apiKey: "", // 官方账号未登录时的回退凭据
  // 显示
  showBalanceRow: true, // 展开态侧栏底部的余额行
  showUsagePill: true, // 输入框下方「本会话消耗」胶囊
  showPeriodLabel: true, // 高峰/空闲标签
  showFab: true, // 收起态悬浮圆钮
  // 2.0.0：余额行外观。classic = 早期那版「钱包图标 + 余额 + 金额」纯文字行；
  // timeline = 现在的「meta 行 + 扁刻度条 + 金额」。
  footerStyle: "timeline",
  // 2.0.0：左侧导航栏里的插件设置入口（点一下直接打开插件配置页）
  showSidebarEntry: true,
  // 2.0.0：右键刷新时，余额行从左往右扫过一道泛光亮带
  refreshWave: true,
  // 侧栏「余额与用量」入口是否已被点开过。false = 显示红点。
  // 与版本号无关：只有用户真正点开过这个面板才会被写成 true，之后永不回退。
  entrySeen: false,
  // NEW 徽标的计时起点：记录「当前版本首次启动」的时间戳与版本号。
  // 版本一变（用户升级了）就重置计时；满 3 天后客户端自动不再显示 NEW。
  newTagVersion: "",
  newTagSince: 0,
  // 升级前的版本（用户上一次跑的是哪个版本）。
  // 客户端用它和「某项功能的引入版本」比较：只有比它新的功能才标 NEW。
  // 这样跨几个版本一次升上来的用户能看到中间所有新功能，
  // 已经跑过某个版本的用户不会被重复提示。
  newTagFrom: "",
  // 逐项计时：{ [配置项 key]: { v: 引入版本, t: 首次看到的时间戳 } }。
  // 每个新功能各自走自己的 3 天，互不影响：
  // 旧功能没过完 3 天时又升级，也不会被这次升级重新计时——
  // 因为它记录的版本已经是用户见过的版本了。
  newTagSeen: {},
  // 收起态圆钮外观
  fabSize: 60, // 直径（px）
  fabLeft: 44, // 距窗口左缘（px）
  // 统计
  statsSessionLimit: STATS_MAX_SESSIONS, // 统计扫描的最近会话数
  statsCacheSec: 300, // 统计结果缓存秒数
  // 计费
  peakMultiplier: 2, // 高峰时段倍率
  priceFlash: null, // flash 覆盖价（元/百万 token），四项全填才生效
  pricePro: null, // v4-pro 覆盖价
};

const PRICE_FIELDS = [
  "inputCnyPerMillion",
  "cacheReadCnyPerMillion",
  "cacheWriteCnyPerMillion",
  "outputCnyPerMillion",
];

/** 夹到合法区间；非有限数回退默认值。 */
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** NEW 逐项计时表：只收 { v: 非空版本串, t: 非负时间戳 } 的条目，
 *  其余一律丢弃（宁可丢一条记录重新计时，也不要带着脏数据跑）。 */
function normalizeNewTagSeen(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const key of Object.keys(raw)) {
    if (typeof key !== "string" || key === "") continue;
    const rec = raw[key];
    if (rec == null || typeof rec !== "object" || Array.isArray(rec)) continue;
    const v = typeof rec.v === "string" ? rec.v.trim() : "";
    const t = Number(rec.t);
    if (v === "" || !Number.isFinite(t) || t <= 0) continue;
    out[key] = { v, t: Math.floor(t) };
  }
  return out;
}

/** 一组覆盖价：逐个字段校验（有限非负数才收），不填的字段留空表示「用默认价」。
 *  四个字段都没填则整组丢弃（等价于不覆盖）。 */
function normalizePriceOverride(raw) {
  if (raw == null || typeof raw !== "object") return null;
  const out = {};
  for (const field of PRICE_FIELDS) {
    const input = raw[field];
    if (input == null || input === "") continue;
    const n = Number(input);
    if (!Number.isFinite(n) || n < 0) continue;
    out[field] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 校验并补全一份设置：未知键丢弃、越界值夹紧、类型不符回退默认。 */
function normalizeSettings(raw) {
  const src = raw != null && typeof raw === "object" ? raw : {};
  const d = DEFAULT_SETTINGS;
  const bool = (value, fallback) => (typeof value === "boolean" ? value : fallback);
  return {
    refreshIntervalSec: clampNumber(src.refreshIntervalSec, 5, 3600, d.refreshIntervalSec),
    lowBalanceThreshold: clampNumber(src.lowBalanceThreshold, 0, 100000, d.lowBalanceThreshold),
    apiKey: typeof src.apiKey === "string" ? src.apiKey.trim() : d.apiKey,
    showBalanceRow: bool(src.showBalanceRow, d.showBalanceRow),
    showUsagePill: bool(src.showUsagePill, d.showUsagePill),
    showPeriodLabel: bool(src.showPeriodLabel, d.showPeriodLabel),
    showFab: bool(src.showFab, d.showFab),
    footerStyle: src.footerStyle === "classic" ? "classic" : d.footerStyle,
    showSidebarEntry: bool(src.showSidebarEntry, d.showSidebarEntry),
    refreshWave: bool(src.refreshWave, d.refreshWave),
    entrySeen: bool(src.entrySeen, d.entrySeen),
    newTagVersion: typeof src.newTagVersion === "string" ? src.newTagVersion : d.newTagVersion,
    newTagFrom: typeof src.newTagFrom === "string" ? src.newTagFrom : d.newTagFrom,
    newTagSeen: normalizeNewTagSeen(src.newTagSeen),
    newTagSince: clampNumber(src.newTagSince, 0, Number.MAX_SAFE_INTEGER, d.newTagSince),
    fabSize: clampNumber(src.fabSize, 32, 120, d.fabSize),
    fabLeft: clampNumber(src.fabLeft, 0, 600, d.fabLeft),
    statsSessionLimit: clampNumber(src.statsSessionLimit, 10, 2000, d.statsSessionLimit),
    statsCacheSec: clampNumber(src.statsCacheSec, 0, 3600, d.statsCacheSec),
    peakMultiplier: clampNumber(src.peakMultiplier, 1, 10, d.peakMultiplier),
    priceFlash: normalizePriceOverride(src.priceFlash),
    pricePro: normalizePriceOverride(src.pricePro),
  };
}

/** 把设置折进 Cordis config，让既有的 resolvePricing / resolveApiKey / 统计逻辑无感读到。 */
function withSettings(config, settings) {
  const s = settings ?? DEFAULT_SETTINGS;
  const priceByModel = {};
  if (s.priceFlash) priceByModel["deepseek-v4-flash"] = s.priceFlash;
  if (s.pricePro) priceByModel["deepseek-v4-pro"] = s.pricePro;
  return {
    ...config,
    apiKey: s.apiKey !== "" ? s.apiKey : config?.apiKey,
    peakMultiplier: s.peakMultiplier,
    priceByModel,
    statsSessionLimit: s.statsSessionLimit,
    statsCacheMs: s.statsCacheSec * 1000,
  };
}

/** 设置文件路径：优先 DSH 自己的 home（dshHomePath 服务），再环境变量，最后 ~/.dsh。
 *  返回空串表示定位不到，此时读写一律静默降级为「用默认值、不落盘」。 */
function settingsFilePath(ctx) {
  let home = "";
  try {
    const svc = typeof ctx?.get === "function" ? ctx.get("dshHomePath") : null;
    if (typeof svc === "string") home = svc;
    else if (svc && typeof svc.path === "string") home = svc.path;
    else if (svc && typeof svc.value === "string") home = svc.value;
  } catch {
    // 服务不存在或形状变了：走下面的兜底
  }
  if (home === "") home = String(process.env.DSH_HOME ?? "");
  if (home === "") {
    const base = process.env.USERPROFILE || process.env.HOME || "";
    if (base !== "") home = `${base}${process.platform === "win32" ? "\\" : "/"}.dsh`;
  }
  if (home === "") return "";
  const sep = home.includes("\\") && !home.includes("/") ? "\\" : "/";
  return `${home.replace(/[\\/]+$/, "")}${sep}${SETTINGS_FILENAME}`;
}

/** 读设置文件；不存在 / JSON 损坏 / 无权限一律返回 null（调用方保持默认值）。
 *  额外做一件事：老版本写下的文件里没有 showSidebarEntry 这个键，
 *  读到这种「升级前」的文件时把侧边栏入口强制打开一次，让用户第一次升级后
 *  能在左侧导航看到新入口（用户要求：第一次更新的用户强制显示在侧边栏）。
 *  之后再关掉就按用户的选择来，不会反复弹回来。 */
async function readSettingsFile(file) {
  if (file === "") return null;
  try {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(file, "utf8");
    const parsed = JSON.parse(text);
    const settings = normalizeSettings(parsed);
    if (parsed == null || typeof parsed !== "object" || !("showSidebarEntry" in parsed)) {
      settings.showSidebarEntry = true;
    }
    // entrySeen 不按版本强制：文件里没写 true 的旧用户（升级上来的）
    // 读出来就是未读，红点 + NEW 会提示他「这版加了新东西」。
    return settings;
  } catch (error) {
    // 文件不存在 = 全新安装，这里不能当「未读」处理（否则新用户一装就看到一堆 NEW，
    // 对他来说每一项都是新的，标 NEW 毫无信息量）。用字符串标记区分于「读失败」。
    if (error && error.code === "ENOENT") return "missing";
    return null;
  }
}

/** 写设置文件：先写临时文件再改名，避免写一半把配置写坏。 */
async function writeSettingsFile(file, settings) {
  if (file === "") throw new Error("无法定位 DeepSeek Harness 配置目录");
  const { mkdir, writeFile, rename } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

/** 读 HTTP 请求体（限制大小，避免被超大 body 拖垮）。 */
function readRequestBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("请求体过大"));
        if (typeof req.destroy === "function") req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

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

/** 取（或建）某天的统计桶。 */
function ensureDay(days, key) {
  let day = days.get(key);
  if (day == null) {
    day = {
      date: key,
      ...emptyTokenBucket(),
      totalTokens: 0,
      cost: 0,
      sessionIds: new Set(),
      // —— 以下为细分维度，供统计面板展示；不改动上方总额口径 ——
      byModel: new Map(), // modelKey -> { model, tokens..., totalTokens, cost }
      peak: emptyTokenBucket(),
      offpeak: emptyTokenBucket(),
      peakCost: 0,
      offpeakCost: 0,
      // 网页搜索 / 抓取的工具调用次数与按次费用（官方 ¥5/千次，2026-11-01 起计费）
      webSearchCalls: 0,
      webFetchCalls: 0,
      webSearchBillable: 0,
      webFetchBillable: 0,
      webSearchCost: 0,
      webFetchCost: 0,
    };
    days.set(key, day);
  }
  return day;
}

/** 按北京时间把一个会话的最终 assistant/message usage 聚合到每日统计。 */
function collectDailyUsage(events, config, fallbackModel, cutoffMs, days, sessionId) {
  const switches = collectModelSwitches(events);
  const starts = stepStartTimes(events);
  const fallback = fallbackModel || "deepseek-v4-flash";
  const latestByStep = new Map();
  for (const event of events ?? []) {
    if (event.type !== "assistant/message") continue;
    const usage = event.data?.usage;
    const turn = event.data?.turn;
    const step = event.data?.step;
    if (usage == null || turn == null || step == null) continue;
    // 与 sumEventsUsage 同口径：按"请求发起时刻"归属日期与峰谷，拿不到才回退完成时刻
    latestByStep.set(`${turn}/${step}`, { usage, time: starts.get(`${turn}/${step}`) ?? Number(event.time ?? 0) });
  }
  // 网页搜索 / 抓取：按调用发生的北京日期归日，金额按官方「每千次 ¥5」、且只在
  // 2026-11-01 00:00（北京）之后计费。tool/call 与 tool/result 配对 + isError 过滤同 webToolUsage。
  const webCalls = new Map(); // callId -> { name, time }
  for (const event of events ?? []) {
    if (event.type !== "tool/call") continue;
    const name = event.data?.name;
    if (name !== "web_search" && name !== "web_fetch") continue;
    const time = Number(event.time ?? 0);
    const id = event.data?.callId;
    if (!Number.isFinite(time) || time < cutoffMs) continue;
    if (id === void 0 || id === null) continue;
    webCalls.set(String(id), { name, time });
  }
  if (webCalls.size > 0) {
    const seen = new Set();
    for (const event of events ?? []) {
      if (event.type !== "tool/result") continue;
      const id = event.data?.toolCallId ?? event.data?.message?.toolCallId;
      const key = id === void 0 || id === null ? "" : String(id);
      const call = webCalls.get(key);
      if (call === void 0 || seen.has(key)) continue;
      seen.add(key);
      if (event.data?.message?.isError === true) continue;
      const day = ensureDay(days, beijingDayKey(call.time));
      const billable = call.time >= WEB_TOOL_BILLING_START;
      if (call.name === "web_search") {
        day.webSearchCalls += 1;
        if (billable) {
          day.webSearchBillable += 1;
          day.webSearchCost += WEB_TOOL_PRICE_PER_CALL;
          day.cost += WEB_TOOL_PRICE_PER_CALL;
        }
      } else {
        day.webFetchCalls += 1;
        if (billable) {
          day.webFetchBillable += 1;
          day.webFetchCost += WEB_TOOL_PRICE_PER_CALL;
          day.cost += WEB_TOOL_PRICE_PER_CALL;
        }
      }
      day.sessionIds.add(sessionId);
    }
  }
  for (const { usage, time } of latestByStep.values()) {
    if (!Number.isFinite(time) || time < cutoffMs) continue;
    const day = ensureDay(days, beijingDayKey(time));
    const model = modelAtTime(switches, time) || fallback;
    const isPeak = isPeakAt(time, config);
    // 分时段精确计费：高峰桶按高峰价（= 目录价 ×2）、空闲桶按目录价
    const bucket = { peak: emptyTokenBucket(), offpeak: emptyTokenBucket() };
    addTokenUsage(isPeak ? bucket.peak : bucket.offpeak, usage);
    const stepCost = estimateCost(bucket, catalogPricing(config, model, pricingEraAt(time)), peakMultiplierOf(config));

    addTokenUsage(day, usage);
    const tokens = tokenTotal({
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    });
    day.totalTokens += tokens;
    day.cost += stepCost;
    day.sessionIds.add(sessionId);

    // 高峰 / 空闲拆分（token 与费用）
    addTokenUsage(isPeak ? day.peak : day.offpeak, usage);
    if (isPeak) day.peakCost += stepCost;
    else day.offpeakCost += stepCost;

    // 按模型拆分：复用同一步的 stepCost，保证各模型费用之和 = day.cost
    const mk = modelKey(model) || "deepseek-v4-flash";
    let entry = day.byModel.get(mk);
    if (entry == null) {
      entry = { model: mk, ...emptyTokenBucket(), totalTokens: 0, cost: 0 };
      day.byModel.set(mk, entry);
    }
    addTokenUsage(entry, usage);
    entry.totalTokens += tokens;
    entry.cost += stepCost;
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

/** 只算「今天」的消耗总额，供余额行上方的 meta 行用。
 *  与 buildUsageStats 的区别：只扫 updatedAt 落在今天的会话，通常只有几个，
 *  所以可以随余额行刷新（缓存 60s），不必等 5 分钟的完整统计。
 *  @returns {Promise<{ cost:number, totalTokens:number, sessions:number }>} */
async function buildTodayCost(ctx, config) {
  const getService = typeof ctx.get === "function" ? ctx.get.bind(ctx) : null;
  const controller = getService?.("sessionController");
  const persistence = getService?.("sessionPersistence");
  const now = Date.now();
  // 北京当日 0 点对应的真实时间戳（用 UTC 分量读北京日期，再减回去）
  const bj = new Date(now + 8 * 60 * 60 * 1000);
  const dayStart = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()) - 8 * 60 * 60 * 1000;
  const todayKey = bj.getUTCFullYear() + "-" + String(bj.getUTCMonth() + 1).padStart(2, "0") + "-" + String(bj.getUTCDate()).padStart(2, "0");
  // 只挑今天动过的会话
  let candidates = [];
  if (typeof controller?.list === "function") {
    const listed = await controller.list({});
    const items = Array.isArray(listed) ? listed : (listed?.items ?? []);
    candidates = items
      .map((item) => (item && typeof item === "object" ? { id: item.sessionId ?? item.id, at: Number(item.updatedAt ?? item.createdAt ?? 0) } : null))
      .filter((x) => x && typeof x.id === "string" && x.id !== "");
    // list() 已按活动降序；万一没有 updatedAt 字段就保守全扫（上限 STATS_MAX_SESSIONS）
    if (candidates.some((x) => x.at > 0)) {
      candidates = candidates.filter((x) => x.at >= dayStart);
    }
  } else if (typeof persistence?.list === "function") {
    const headers = await persistence.list();
    const list = Array.isArray(headers) ? headers : [];
    candidates = list
      .map((h) => (h && typeof h.id === "string" ? { id: h.id, at: Number(h.updatedAt ?? h.createdAt ?? 0) } : null))
      .filter(Boolean);
    if (candidates.some((x) => x.at > 0)) {
      candidates = candidates.filter((x) => x.at >= dayStart);
    }
  } else {
    throw new Error("会话持久化服务不可用");
  }
  const selected = candidates
    .slice(0, clampNumber(config?.statsSessionLimit, 10, 2000, STATS_MAX_SESSIONS))
    .map((x) => x.id);
  const daily = new Map();
  let cursor = 0;
  const worker = async () => {
    while (cursor < selected.length) {
      const sessionId = selected[cursor++];
      try {
        const inspected = await inspectPersistedSession(ctx, sessionId);
        collectDailyUsage(
          inspected?.events ?? [],
          config,
          detectModel({ requestHeader: () => void 0, requestContext: () => void 0, events: inspected?.events ?? [] }),
          dayStart,
          daily,
          sessionId,
        );
      } catch {
        // 单个会话读不出来不影响总额
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, () => worker()));
  const day = daily.get(todayKey);
  return {
    date: todayKey,
    cost: day?.cost ?? 0,
    totalTokens: day?.totalTokens ?? 0,
    sessions: day?.sessionIds?.size ?? 0,
  };
}

async function buildUsageStats(ctx, config) {
  const getService = typeof ctx.get === "function" ? ctx.get.bind(ctx) : null;
  const controller = getService?.("sessionController");
  const persistence = getService?.("sessionPersistence");
  const now = Date.now();
  const cutoffMs = now - (STATS_DAYS - 1) * 24 * 60 * 60 * 1000;
  // 列举会话要跨 DSH 版本：新版 sessionController.list() 返回 { items:[{ sessionId, updatedAt }] }
  // （已按活动降序，字段叫 sessionId）；旧版 sessionPersistence.list() 返回 [{ id, createdAt }]
  // （字段叫 id）。旧版 persistence 还提供 inspect()，新版改成 handle-based 的 open()，
  // 所以读取一律走已做三级兼容的 inspectPersistedSession，不再直接调 persistence.inspect。
  let sessionIds = [];
  let availableSessions = 0;
  if (typeof controller?.list === "function") {
    const listed = await controller.list({});
    const items = Array.isArray(listed) ? listed : (listed?.items ?? []);
    sessionIds = items.map((item) => (item && typeof item === "object" ? item.sessionId ?? item.id : void 0));
    availableSessions = sessionIds.length;
  } else if (typeof persistence?.list === "function") {
    const headers = await persistence.list();
    const list = Array.isArray(headers) ? headers : [];
    availableSessions = list.length;
    sessionIds = [...list]
      .filter((header) => header && typeof header.id === "string")
      .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
      .map((header) => header.id);
  } else {
    throw new Error("会话持久化服务不可用");
  }
  const selected = sessionIds
    .filter((id) => typeof id === "string" && id !== "")
    .slice(0, clampNumber(config?.statsSessionLimit, 10, 2000, STATS_MAX_SESSIONS));
  const daily = new Map();
  let cursor = 0;
  let scannedSessions = 0;
  let failedSessions = 0;
  const worker = async () => {
    while (cursor < selected.length) {
      const sessionId = selected[cursor++];
      try {
        const inspected = await inspectPersistedSession(ctx, sessionId);
        collectDailyUsage(
          inspected?.events ?? [],
          config,
          detectModel({ requestHeader: () => void 0, requestContext: () => void 0, events: inspected?.events ?? [] }),
          cutoffMs,
          daily,
          sessionId,
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
      return {
        date,
        ...emptyTokenBucket(),
        totalTokens: 0,
        cost: 0,
        sessions: 0,
        byModel: [],
        peak: emptyTokenBucket(),
        offpeak: emptyTokenBucket(),
        peakCost: 0,
        offpeakCost: 0,
      };
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
      byModel: [...day.byModel.values()],
      peak: day.peak,
      offpeak: day.offpeak,
      peakCost: day.peakCost,
      offpeakCost: day.offpeakCost,
      webSearchCalls: day.webSearchCalls,
      webFetchCalls: day.webFetchCalls,
      webSearchBillable: day.webSearchBillable,
      webFetchBillable: day.webFetchBillable,
      webSearchCost: day.webSearchCost,
      webFetchCost: day.webFetchCost,
      webToolCost: day.webSearchCost + day.webFetchCost,
    };
  });
  const total = rows.reduce((acc, day) => {
    acc.inputTokens += day.inputTokens;
    acc.outputTokens += day.outputTokens;
    acc.cacheReadTokens += day.cacheReadTokens;
    acc.cacheWriteTokens += day.cacheWriteTokens;
    acc.totalTokens += day.totalTokens;
    acc.cost += day.cost;
    // —— 细分维度：与上方总额同口径，只做拆分，不改变金额 ——
    addTokenUsage(acc.peak, day.peak);
    addTokenUsage(acc.offpeak, day.offpeak);
    acc.peakCost += day.peakCost;
    acc.offpeakCost += day.offpeakCost;
    acc.webSearchCalls += day.webSearchCalls;
    acc.webFetchCalls += day.webFetchCalls;
    acc.webSearchBillable += day.webSearchBillable;
    acc.webFetchBillable += day.webFetchBillable;
    acc.webSearchCost += day.webSearchCost;
    acc.webFetchCost += day.webFetchCost;
    acc.webToolCost += day.webToolCost;
    for (const item of day.byModel ?? []) {
      let entry = acc.byModel.get(item.model);
      if (entry == null) {
        entry = { model: item.model, ...emptyTokenBucket(), totalTokens: 0, cost: 0 };
        acc.byModel.set(item.model, entry);
      }
      addTokenUsage(entry, item);
      entry.totalTokens += item.totalTokens;
      entry.cost += item.cost;
    }
    return acc;
  }, {
    ...emptyTokenBucket(),
    totalTokens: 0,
    cost: 0,
    byModel: new Map(),
    peak: emptyTokenBucket(),
    offpeak: emptyTokenBucket(),
    peakCost: 0,
    offpeakCost: 0,
    webSearchCalls: 0,
    webFetchCalls: 0,
    webSearchBillable: 0,
    webFetchBillable: 0,
    webSearchCost: 0,
    webFetchCost: 0,
    webToolCost: 0,
  });
  return {
    days: rows,
    // byModel 内部用 Map 聚合，返回前转成可直接 JSON 序列化的数组
    total: { ...total, byModel: [...total.byModel.values()] },
    rangeDays: STATS_DAYS,
    scannedSessions,
    failedSessions,
    availableSessions,
    limited: availableSessions > selected.length,
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

function formatUsage(usage, pricing, multiplier = 2, model = "") {
  // 优先按 byModel 逐段累加（每段用各自模型 + 价格时代的价格，历史消耗不因调价而变）；
  // 无 byModel 时回退单一价格估算（兼容旧数据）。pricing 是**目录价**，倍率单独传。
  const cost =
    Array.isArray(usage.byModel) && usage.byModel.length > 0
      ? usage.byModel.reduce(
          (sum, b) => sum + (typeof b.cost === "number" && Number.isFinite(b.cost) ? b.cost : estimateCost(b, pricing, multiplier)),
          0,
        )
      : estimateCost(usage, pricing, multiplier);
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
  let todayCache = { expiresAt: 0, value: null };
  let statsCache = { expiresAt: 0, value: null };
  // 用户设置（「插件」页配置卡片读写）：先按出厂默认值跑，异步读到文件后热替换。
  // 读不到文件不是错误——全新安装就是没有文件，保持默认值即可。
  const settingsState = { value: { ...DEFAULT_SETTINGS }, file: "" };
  let effectiveConfig = withSettings(config, settingsState.value);
  void (async () => {
    settingsState.file = settingsFilePath(ctx);
    const loaded = await readSettingsFile(settingsState.file);
    let dirty = false;
    if (loaded === "missing") {
      // 全新安装：没有任何历史可回顾，红点不亮，
      // 并立即落盘固化，保证后续每次启动都走「已读」分支。
      settingsState.value = { ...DEFAULT_SETTINGS, entrySeen: true };
      dirty = true;
    } else if (loaded) {
      settingsState.value = loaded;
    }
    // NEW 徽标的计时：记下「这个版本首次启动」的时间。
    // 版本号变了（用户升级了）就重置，否则沿用上次记录的起点——
    // 否则每次启动都会把计时推到“现在”，永远过不了 3 天。
    const tagVersion = settingsState.value.newTagVersion || "";
    const tagSince = Number(settingsState.value.newTagSince) || 0;
    if (tagVersion !== PLUGIN_VERSION || !(tagSince > 0)) {
      // 升级：把「刚刚跑过的那个版本」存下来。首次安装时 tagVersion 为空串，
      // 客户端见空串就把所有 NEW_TAGS 都当新功能（新用户确实都没见过）。
      settingsState.value.newTagFrom = tagVersion || "";
      settingsState.value.newTagVersion = PLUGIN_VERSION;
      settingsState.value.newTagSince = Date.now();
      dirty = true;
    }
    effectiveConfig = withSettings(config, settingsState.value);
    if (dirty) {
      try {
        await writeSettingsFile(settingsState.file, settingsState.value);
      } catch {
        // 写盘失败（目录只读等）不影响这一次运行：内存里已经是最新值
      }
    }
  })();
  // DSH 热重载(reload)时会重新 apply 本插件；若旧实例注册的 /balance-api 路由
  // 未被清理，新实例再次 register 就会抛出 duplicate route，导致整个 apply 失败、
  // 余额不显示。这里收集每次 register 返回的 disposer，并在插件卸载(ctx.on("dispose"))
  // 时统一清理，保证重复 apply 不冲突。
  const disposers = [];

  // 后台补录节假日数据（当年 ±1 年，覆盖 90 天统计窗口与跨年场景）。
  // 故意不 await：拉取失败不能影响插件启动；isPeakAt 保持同步，未拉到时继续用内置表。
  {
    const y = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCFullYear();
    void ensureCnCalendar(y - 1);
    void ensureCnCalendar(y);
    void ensureCnCalendar(y + 1);
  }

  // 1) /balance 命令：保留命令行查询入口
  ctx.inject(["commands"], (commandCtx) => {
    commandCtx.commands.register({
      name: "balance",
      description: "查询 DeepSeek 余额与当前会话消耗",
      handler: async ({ agent, signal }) => {
        const usage = sumSessionUsage(agent.session, effectiveConfig);
        const model = detectModel(agent.session);
        const pricing = catalogPricing(effectiveConfig, model);
        const multiplier = peakMultiplierOf(effectiveConfig);
        // 余额来源：官方账号优先（官方版内置登录，无需 API Key），回退 API Key。
        const { balance, error } = await resolveBalance(ctx, effectiveConfig, signal);
        if (balance === null) {
          return {
            kind: "error",
            text: `${error}\n\n${formatUsage(usage, pricing, multiplier, model)}`,
          };
        }
        return {
          kind: "success",
          text: `${formatBalance(balance)}\n\n${formatUsage(usage, pricing, multiplier, model)}`,
        };
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
        // 配置读写：GET /balance-api?config=1 读设置，POST 同路径写设置。
        // DSH「插件」页 → balance-dsh → 配置卡片（lib/client.js 注册的
        // plugins.bundle.config）就走这两个入口。
        let configParams = null;
        try {
          configParams = new URL(req.url, "http://localhost").searchParams;
        } catch {
          configParams = null;
        }
        if (configParams?.get("config") === "1") {
          try {
            if (req.method === "GET") {
              writeJson(res, 200, { ok: true, settings: settingsState.value, version: PLUGIN_VERSION });
              return;
            }
            if (req.method !== "POST") {
              writeJson(res, 405, { ok: false, error: "method not allowed" });
              return;
            }
            const body = await readRequestBody(req);
            const parsed = body.trim() === "" ? {} : JSON.parse(body);
            const patch = parsed != null && typeof parsed === "object" && parsed.settings != null ? parsed.settings : parsed;
            const next = normalizeSettings({ ...settingsState.value, ...(patch ?? {}) });
            await writeSettingsFile(settingsState.file || settingsFilePath(ctx), next);
            settingsState.value = next;
            effectiveConfig = withSettings(config, next);
            // 价格与扫描范围可能变了，作废统计缓存
            statsCache = { expiresAt: 0, value: null };
            writeJson(res, 200, { ok: true, settings: next, version: PLUGIN_VERSION });
          } catch (error) {
            writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        if (req.method !== "GET") {
          writeJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        // 客户端把当前会话使用的模型通过 ?model= 传入，服务端按模型取价；
        // 可选 ?session= 传入会话 id，服务端返回该会话的分时段 usage（跨时段精确计费用）
        let model = "";
        let sessionParam = "";
        let wantStats = false;
        let wantToday = false;
        try {
          const search = new URL(req.url, "http://localhost").searchParams;
          model = search.get("model") ?? "";
          sessionParam = search.get("session") ?? "";
          wantStats = search.get("stats") === "1";
          wantToday = search.get("today") === "1";
        } catch {
          model = "";
          sessionParam = "";
          wantStats = false;
          wantToday = false;
        }
        let stats = null;
        let statsError = "";
        if (wantStats) {
          try {
            if (statsCache.value == null || statsCache.expiresAt <= Date.now()) {
              statsCache = {
                value: await buildUsageStats(httpCtx, effectiveConfig),
                expiresAt: Date.now() + (effectiveConfig.statsCacheMs ?? STATS_CACHE_MS),
              };
            }
            stats = statsCache.value;
          } catch (error) {
            statsError = error instanceof Error ? error.message : String(error);
          }
        }
        // 今日消耗：只扫今天动过的会话，60 秒缓存，供余额行上方的 meta 行随余额一起刷新
        let today = null;
        if (wantToday) {
          try {
            if (todayCache.value == null || todayCache.expiresAt <= Date.now()) {
              todayCache = { value: await buildTodayCost(httpCtx, effectiveConfig), expiresAt: Date.now() + 60 * 1000 };
            }
            today = todayCache.value;
          } catch {
            today = null; // 拿不到就不显示，不阻塞余额
          }
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
              usage = sumSessionUsage(session, effectiveConfig);
              detectedModel = detectModel(session);
            }
            // DSH 2.0.4 起 live session（sessions.get）可能拿不到 events，导致 usage 全 0。
            // 此时回退从持久化读事件，避免客户端拿到"空但非 null"的 usage 而把金额显示成 ¥0.0000。
            if (usage == null || usage.totalTokens === 0) {
              try {
                const persisted = await inspectPersistedSession(ctx, sessionParam);
                if (Array.isArray(persisted?.events) && persisted.events.length > 0) {
                  const persistedUsage = sumEventsUsage(persisted.events, effectiveConfig, detectedModel);
                  if (persistedUsage.totalTokens > 0) {
                    usage = persistedUsage;
                    if (detectedModel === "") {
                      const switches = collectModelSwitches(persisted.events);
                      if (switches.length > 0) detectedModel = switches[switches.length - 1].model;
                    }
                  }
                }
              } catch {
                // 持久化读取不可用：忽略，走下方统一降级
              }
            }
            // 仍无任何 token 就返回 null，让客户端回退本地投影估算（而不是当成 0 消耗显示 ¥0.0000）
            if (usage != null && usage.totalTokens === 0) usage = null;
            // 子代理枚举走持久化目录（不依赖 live 会话），即使父会话不在内存也能拿到
            const subRes = await sumSubagentUsage(httpCtx, sessionParam, effectiveConfig);
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
          usage.byModel = usage.byModel.map((b) => ({ ...b, cost: estimateCost(b, catalogPricing(effectiveConfig, b.model, b.era), peakMultiplierOf(effectiveConfig)) }));
        }
        if (subagentUsage && Array.isArray(subagentUsage.byModel)) {
          subagentUsage.byModel = subagentUsage.byModel.map((b) => ({ ...b, cost: estimateCost(b, catalogPricing(effectiveConfig, b.model, b.era), peakMultiplierOf(effectiveConfig)) }));
        }
        // 余额来源：官方账号优先（官方桌面版内置登录，无需 API Key），回退 DeepSeek API Key。
        const { balance, error: balanceError } = await resolveBalance(ctx, effectiveConfig);
        if (balance === null && !wantStats) {
          writeJson(res, 200, { ok: false, error: balanceError });
          return;
        }
        writeJson(res, 200, {
          ok: true,
          balance,
          balanceError: balance === null ? balanceError : null,
          // 传给客户端的是**目录价**（不含峰谷倍率）：客户端自己按高峰时段乘倍率，
          // 若这里给 resolvePricing（已乘倍率）客户端会再乘一次，金额虚高约 3 倍。
          pricing: catalogPricing(effectiveConfig, effectiveModel),
          model: effectiveModel,
          usage,
          subagentUsage,
          stats,
          statsError,
          today,
        });
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
