// dsh 插件：余额与当前会话消耗
// 服务端：注册 /balance 命令 + /balance-api HTTP 接口（供 Web UI 插件直接渲染）
// 只引 Node 标准库（不是 @deepseek-ai/dsh-*），用于读取磁盘上实际安装的版本号。
import { statSync, readFileSync } from "node:fs";

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

// ── 持久化读取缓存（掉帧与"加载慢"的根治点）──────────────────────────────────
// 一次 inspect 就是把整个 zstd 文件**逐帧解压 + 逐行 JSON.parse**。本机实测：
//   35.8 MB 的会话 = 19331 帧、解压后 134 MB、单次 **723 ms**（另外两个 689 / 735 ms）。
// 这是**同步 CPU**，而插件与 DSH 同进程 —— 它一跑，整个界面就掉帧；/balance-api
// 撞上它，插件就是"加载慢"。更糟的是每次轮询都会重放（主会话回读 + 每个子代理各一次）。
//
// 所以：**会话内容没变，就绝不解第二遍**。指纹取 sessionController.list() 的 updatedAt
// （只读 header，很便宜），变了才重读。轮询期因此是 0 磁盘开销。
const PERSIST_CACHE_MAX = 240;               // 最多缓存多少个会话
// ⚠️ 只管条数是不够的（2026-10-31 全量审查）：单个大会话解压后就有 134 MB
// （实测 35.8 MB zstd → 19331 帧），240 个就是几十 GB。插件和 DSH 同进程，
// 真撞上就是整个应用 OOM —— 不是掉帧、不是慢，是直接崩。
// 所以再加一道字节预算，两条谁先到就淘汰谁；Map 插入序 + 命中者挪尾 = LRU。
const PERSIST_CACHE_BYTES = 512 * 1024 * 1024;
const PERSIST_CACHE_TTL_MS = 30 * 60 * 1000;  // 指纹可用时：半小时没再访问就丢，别无限长
// 指纹拿不到（旧版 DSH 没有 sessionController.list）时只能用时间兜底 —— 此时必须
// 给一个很短的保质期，否则内容更新了也要等半小时才看见。代价是这种情况下仍会
// 每 5 秒重解压一次，但这已经是"能用"的下限了。
const PERSIST_STAMPLESS_TTL_MS = 5 * 1000;
const SESSION_STAMP_TTL_MS = 5 * 1000;        // 指纹来源（会话列表）缓存 5 秒
// `?session=` 走持久化回退时的最短重解压间隔。对话进行中会话每轮都在写，
// 指纹必然每次都变；不节流就是「每个 chunk 一轮 800 ms 同步解压」。
// 4 秒的滞后在这个场景里感知不到（余额轮询本身 60 秒一轮）。
const SESSION_REREAD_MIN_MS = 4 * 1000;

const persistCache = new Map();    // sessionId -> { stamp, at, value, size }（插入序 = LRU 序）
const persistInFlight = new Map(); // sessionId -> Promise（同会话并发单飞）
// 当前缓存里所有 events 的估算总字节（estimateBytes 的累加）。
// 维护成一个变量而不是每次遍历求和：淘汰循环里会反复用到，O(n) 不可接受。
let persistCacheBytes = 0;
let sessionStampCache = { at: 0, map: new Map() };

/** sessionId -> updatedAt 指纹表。列表很便宜（不读事件），但仍缓存 5 秒挡掉连打。 */
async function sessionStampMap(ctx) {
  const now = Date.now();
  if (now - sessionStampCache.at < SESSION_STAMP_TTL_MS) return sessionStampCache.map;
  const map = new Map();
  const collect = (res) => {
    const items = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
    for (const it of items) {
      const id = it?.sessionId ?? it?.id;
      if (typeof id !== "string" || id === "") continue;
      // 新版是 updatedAt，旧版是 createdAt；都没有就留空串（等于"可能变了"）
      map.set(id, String(it?.updatedAt ?? it?.createdAt ?? ""));
    }
  };
  try {
    const getService = typeof ctx?.get === "function" ? ctx.get.bind(ctx) : null;
    const controller = getService?.("sessionController");
    if (typeof controller?.list === "function") {
      collect(await controller.list());
    } else {
      const persistence = getService?.("sessionPersistence");
      if (typeof persistence?.list === "function") collect(await persistence.list());
    }
  } catch {
    // 列表拿不到：指纹退化成空串，缓存仍有效（只是内容变了也会命中，见下方注释）
  }
  sessionStampCache = { at: now, map };
  return map;
}

/** 带指纹缓存的持久化读取。所有需要「读某个会话全部事件」的地方都必须走这里。
 *
 *  `minIntervalMs`：同一会话两次**真正解压**之间的最短间隔。默认 0 = 只看指纹。
 *  跑 `?session=` 时必须传一个正值 —— 正在对话的会话每轮都在写，`updatedAt` 指纹
 *  每次都变，只看指纹等于「每来一次请求就把 46 MB zstd 重新解压一遍」（实测单次
 *  约 800 ms 同步 CPU，插件与 DSH 同进程，界面直接掉帧）。传 4 秒后最多滞后 4 秒
 *  拿到最新数字，而余额/今日本来就是几十秒一轮的节奏，感知不到。
 */
const persistReadAt = new Map(); // sessionId -> 上次真正解压的时刻
// 按会话增长的表一律夹上限（2026-10-31 第二十二轮审计）：Map 保持插入序，淘汰最旧的键。
const PERSIST_READ_MAX = 240;
function capSessionMap(map, max = PERSIST_READ_MAX) {
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done) return;
    map.delete(oldest.value);
  }
}
async function inspectPersistedCached(ctx, sessionId, minIntervalMs = 0) {
  if (typeof sessionId !== "string" || sessionId === "") return null;
  // 每帧按 7 KB 估算占用：实测 35.8 MB 的 zstd 会话 = 19331 帧 / 解压后 134 MB
  // （约 6.9 KB/帧）。⚠️ 2026-10-31 第二十二轮审计：原来写 4096，低估约 40% ——
  // 512 MB 的预算实际能吃到 ~800 MB 常驻，和 DSH 同进程时会 OOM。
  // 这个数只用来做淘汰决策，不参与任何计费。
  const estimateBytes = (value) => {
    const events = value?.events;
    return Array.isArray(events) ? events.length * 7000 : 0;
  };
  const dropEntry = (key) => {
    const rec = persistCache.get(key);
    if (rec !== undefined) {
      persistCache.delete(key);
      persistCacheBytes -= rec.size ?? 0;
    }
    // persistReadAt 也必须跟着删：否则跨月累积上千个会话 id 永远不会回收。
    persistReadAt.delete(key);
  };
  const now = Date.now();
  const stamps = await sessionStampMap(ctx);
  // ⚠️ 列表里有这条 id，但 updatedAt/createdAt 都是空（新版本 DSH 的某些条目如此）时，
  // 指纹恒为 ""，`hit.stamp === stamp` 永远成立 → 走 30 分钟长效 TTL，内容更新了也读到
  // 冻结的旧事件（2026-10-31 第二十二轮审计）。所以「空指纹」一律按拿不到指纹处理。
  const hasStamp = stamps.has(sessionId) && stamps.get(sessionId) !== "";
  const stamp = hasStamp ? stamps.get(sessionId) : "";

  const hit = persistCache.get(sessionId);
  // 命中条件：指纹相同 + 未过期。指纹可用时给 30 分钟长效（内容一变指纹就不同，
  // 立刻失效）；拿不到指纹时只有 5 秒保质期 —— 否则内容更新了也要等半小时才看见。
  const ttl = hasStamp ? PERSIST_CACHE_TTL_MS : PERSIST_STAMPLESS_TTL_MS;
  if (hit !== undefined && hit.stamp === stamp && now - hit.at < ttl) {
    // 命中要把这一项挪到 Map 末尾 —— Map 保持插入序，淘汰取第一个键，
    // 不挪就等于 FIFO：正在用的那个大会话会被后面进来的小会话挤掉，
    // 下一轮又得重解压一遍 134 MB。
    persistCache.delete(sessionId);
    persistCache.set(sessionId, hit);
    return hit.value;
  }
  // 指纹变了但还没到最短重读间隔：先把上一份给出去，别为了几秒的新鲜度去解压 46 MB。
  if (minIntervalMs > 0 && hit !== undefined) {
    const lastAt = persistReadAt.get(sessionId) ?? 0;
    if (now - lastAt < minIntervalMs) return hit.value;
  }

  const running = persistInFlight.get(sessionId);
  if (running !== undefined) return running;

  const task = (async () => {
    try {
      const value = await inspectPersistedSession(ctx, sessionId);
      // 覆盖同一会话时先把旧那份的字节数扣掉，否则总量只增不减。
      if (persistCache.has(sessionId)) dropEntry(sessionId);
      const size = estimateBytes(value);
      persistCache.set(sessionId, { stamp, at: Date.now(), value, size });
      persistCacheBytes += size;
      persistReadAt.set(sessionId, Date.now());
      // ⚠️ 淘汰必须同时看**条数**和**字节数**（2026-10-31 全量审查）。
      // 原来只看 240 条：单个大会话解压后就是 134 MB，240 个就是几十 GB，
      // 而插件和 DSH 同进程 —— 真撞上就是整个应用 OOM，不是掉几帧。
      // 条数保留是为了兜住「很多小会话」那种情况（字节预算对它们不敏感）。
      while (
        persistCache.size > PERSIST_CACHE_MAX ||
        (persistCacheBytes > PERSIST_CACHE_BYTES && persistCache.size > 1)
      ) {
        const oldest = persistCache.keys().next().value;
        if (oldest === undefined) break;
        // 最后一项即使超预算也不淘汰：否则大会话每次都被自己挤掉，等于没有缓存。
        if (oldest === sessionId && persistCache.size > 1) {
          const fallback = [...persistCache.keys()][1];
          if (fallback !== undefined) dropEntry(fallback);
          else break;
          continue;
        }
        dropEntry(oldest);
      }
      return value;
    } catch (err) {
      // ⚠️ 读失败必须把这个会话的缓存条目一并扔掉（2026-11-01 审计 P1-2）。
      // 命中判据在 try 之外：一旦成功过一份、之后文件损坏/被截断，命中分支会继续把
      // 那份旧事件发出去，最长 PERSIST_CACHE_TTL_MS（30 分钟）—— 用户看到的是「会话被清空了
      // 金额却还在」。失败即失效，下一次自然重读；节流仍由 persistReadAt 负责，不会打满磁盘。
      if (persistCache.has(sessionId)) dropEntry(sessionId);
      throw err;
    } finally {
      persistInFlight.delete(sessionId);
      // ⚠️ 失败也要记重读时刻（2026-10-31 第二十二轮审计）：这条只写在成功路径时，
      // 大会话文件损坏/被占的情况下 minIntervalMs 的节流永远不生效 ——
      // `?session=` 每次请求都完整解压一遍（约 800 ms 同步 CPU），切会话还会再试第二个 id。
      if (minIntervalMs > 0) persistReadAt.set(sessionId, Date.now());
      capSessionMap(persistReadAt);
    }
  })();
  persistInFlight.set(sessionId, task);
  return task;
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
// 节假日数据源（同一份数据、多个 CDN）。实测 cdn.jsdelivr.net 在国内经常连不上，
// fastly / gcore 那两个镜像反而稳定，所以按「先快后慢、逐个回退」排序，
// 任何一个能通就够 —— 这也让插件在某个 CDN 挂掉之后仍然能自己更新。
const CN_CALENDAR_SOURCES = [
  "https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master",
  "https://gcore.jsdelivr.net/gh/NateScarlet/holiday-cn@master",
  "https://raw.githubusercontent.com/NateScarlet/holiday-cn/master",
  "https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master",
];
const CN_CALENDAR_SOURCE = CN_CALENDAR_SOURCES[0]; // 兼容旧引用
const HOLIDAYS_FILENAME = "balance-holidays.json";
/** 缓存有效期：超过这个天数就在启动时后台重拉一次（用户什么都不用做）。 */
const CALENDAR_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const cnCalendarYears = new Set();
// 已同步的节假日数据。days = 「YYYY-MM-DD」→ holiday / workday，
// 落盘到 <dshHome>/balance-holidays.json —— 重启后直接用缓存，断网也不退化成内置表。
// missing = 连上了但还没有数据的年份（典型：国务院还没发次年的放假安排）。
// 这些年份**不受 30 天 TTL 约束**：缓存再新鲜也每次启动补试一次，
// 否则在「11 月发了次年公告、但上次同步刚好锁住 30 天」这个窗口里会白等一个月。
const cnCalendarState = { days: {}, fetchedAt: 0, years: [], missing: [], file: "", source: "" };

/** 节假日缓存文件路径（空串 = 定位不到 home，缓存功能静默降级为纯内存）。 */
function holidaysFilePath(ctx) {
  const home = dshHomeDir(ctx);
  if (home === "") return "";
  const sep = home.includes("\\") && !home.includes("/") ? "\\" : "/";
  return home.replace(/[\\/]+$/, "") + sep + HOLIDAYS_FILENAME;
}

/** 拉取单年节假日并合并进 CN_CALENDAR / cnCalendarState；返回条数，失败返回 -1。
 *  逐个试 CN_CALENDAR_SOURCES：某个 CDN 挂掉就换下一个，全挂才算失败。 */
async function fetchCalendarYear(year) {
  for (const base of CN_CALENDAR_SOURCES) {
    try {
      const res = await fetch(base + "/" + year + ".json", { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data?.days)) continue;
      let count = 0;
      for (const item of data.days) {
        // 键格式与总量都要校验（2026-10-31 审计 M11）：上游是第三方仓库，
        // 一个畸形 date 会以垃圾键写进 CN_CALENDAR 并落盘；无上限则一份超大响应能把表撑爆。
        if (count >= 400) break;
        if (
          item &&
          typeof item.date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
          typeof item.isOffDay === "boolean"
        ) {
          const kind = item.isOffDay ? "holiday" : "workday";
          CN_CALENDAR[item.date] = kind;
          cnCalendarState.days[item.date] = kind;
          count += 1;
        }
      }
      cnCalendarState.source = base;
      return count;
    } catch {
      // 这个源连不上：换下一个
    }
  }
  return -1;
}

/** 读本地缓存（启动时调一次）。文件不存在 / 损坏一律当「没有缓存」。 */
async function loadCalendarCache(ctx) {
  cnCalendarState.file = holidaysFilePath(ctx);
  if (cnCalendarState.file === "") return false;
  try {
    const { readFile } = await import("node:fs/promises");
    const parsed = JSON.parse(await readFile(cnCalendarState.file, "utf8"));
    const days = parsed && typeof parsed === "object" && parsed.days && typeof parsed.days === "object" ? parsed.days : null;
    if (days === null) return false;
    let count = 0;
    for (const [date, kind] of Object.entries(days)) {
      // 同上：本地缓存也可能是旧版/被手改的，键格式必须校验，否则垃圾键会活到下一轮计费。
      if (count >= 400) break;
      if (
        typeof date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        (kind === "holiday" || kind === "workday")
      ) {
        CN_CALENDAR[date] = kind;
        cnCalendarState.days[date] = kind;
        count += 1;
      }
    }
    cnCalendarState.fetchedAt = Number(parsed.fetchedAt) || 0;
    if (typeof parsed.source === "string") cnCalendarState.source = parsed.source;
    cnCalendarState.years = Array.isArray(parsed.years)
      ? parsed.years.map((y) => Number(y)).filter((y) => Number.isFinite(y)).sort()
      : [];
    cnCalendarState.missing = Array.isArray(parsed.missing)
      ? parsed.missing.map((y) => Number(y)).filter((y) => Number.isFinite(y)).sort()
      : [];
    return count > 0;
  } catch {
    return false;
  }
}

/** 写本地缓存：先写 .tmp 再 rename，避免写一半把文件写坏。 */
async function saveCalendarCache() {
  const file = cnCalendarState.file;
  if (file === "") return false;
  try {
    const { mkdir, writeFile, rename } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(file), { recursive: true });
    // 临时名必须唯一（2026-10-31 审计 L3）：固定 .tmp 在并发保存时会互相覆盖，
    // 后完成的那次 rename 拿到的是前一次的半份内容，甚至先 rename 完的那个把 tmp 删掉后
    // 另一个 rename 直接 ENOENT。
    const tmp = file + "." + process.pid + "." + Math.random().toString(36).slice(2) + ".tmp";
    const payload = {
      fetchedAt: cnCalendarState.fetchedAt,
      years: cnCalendarState.years,
      missing: cnCalendarState.missing,
      source: cnCalendarState.source || CN_CALENDAR_SOURCE,
      days: cnCalendarState.days,
    };
    await writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
    await rename(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/** 当前节假日数据状态（GET /balance-api?calendar=1 直接返回它）。 */
function calendarStatus() {
  return {
    fetchedAt: cnCalendarState.fetchedAt,
    years: cnCalendarState.years.slice(),
    missing: cnCalendarState.missing.slice(),
    count: Object.keys(cnCalendarState.days).length,
    source: cnCalendarState.source || CN_CALENDAR_SOURCE,
    days: cnCalendarState.days,
    ttlDays: Math.round(CALENDAR_TTL_MS / 86400000),
  };
}

/** 同步当年 ±1 年（覆盖 90 天统计窗口与跨年场景）。
 *  force=false 且缓存新鲜、且没有缺数据的年份时，完全跳过网络；
 *  缓存新鲜但有 missing（如次年安排还没发布），只补拉那几个年份。 */
async function refreshCnCalendar(ctx, force) {
  // 兜底：正常路径是 apply 里先 loadCalendarCache 把 file 填好；
  // 但只要有人直接点「立即同步」而这个状态还没初始化，这里也得能落盘。
  if (cnCalendarState.file === "") cnCalendarState.file = holidaysFilePath(ctx);
  const fresh = cnCalendarState.fetchedAt > 0 && Date.now() - cnCalendarState.fetchedAt < CALENDAR_TTL_MS;
  const stale = force || !fresh;
  if (!stale && cnCalendarState.missing.length === 0) {
    return { ok: true, skipped: true, ...calendarStatus() };
  }
  const y = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCFullYear();
  // 只缺某几年 → 只补拉那几年，不要把已有数据的年份再拉一遍
  const targets = stale ? [y - 1, y, y + 1] : cnCalendarState.missing.slice();
  const done = [];
  const failed = [];
  const stillMissing = [];
  let added = 0;
  for (const year of targets) {
    const n = await fetchCalendarYear(year);
    if (n > 0) {
      added += n;
      done.push(year);
      cnCalendarYears.add(year);
    } else if (n === 0) {
      // 连上了、但这一年还没数据（次年放假安排尚未公布）——不是失败，但要继续补试
      stillMissing.push(year);
    } else {
      failed.push(year);
    }
  }
  // 已拿到数据的年份从 missing 里摘掉；「连上了但没数据」的补进去（保持升序去重）。
  // 注意「连不上」（n < 0）不算 missing —— 那是网络问题，交给 30 天 TTL 兜，
  // 否则断网用户每次启动都会去拉三年、白白等超时。
  //
  // 下限 y-1：放假安排必然在当年之前公布，比 y-1 还早却还「缺」的年份不可能是
  // 「待公布」，只可能是历史残留（例如插件停用两年后重新打开，那几年再也不会
  // 被 targets 命中，会一直留着）。这类年份直接丢弃，否则设置页会永久显示
  // 「2025 待公布」这种荒谬文本。上限不需要管：y+1 就是 target 的上界。
  const floorYear = y - 1;
  const kept = cnCalendarState.missing.filter((year) => year >= floorYear && !done.includes(year));
  cnCalendarState.missing = [...new Set([...kept, ...stillMissing])].sort((x, z) => x - z);
  if (done.length === 0 && failed.length > 0 && !stale) {
    // 只补拉 missing 且全部连不上：保持原样，不动 fetchedAt（避免把数据「洗新」）
    await saveCalendarCache();
    return { ok: false, error: "连不上节假日数据源，继续使用本地数据。", failedYears: failed, ...calendarStatus() };
  }
  if (done.length === 0 && stillMissing.length > 0) {
    // 连上了但确实还没公布（例如次年安排还没发）——不算错误，静默保持
    await saveCalendarCache();
    return { ok: true, pending: stillMissing, added: 0, ...calendarStatus() };
  }
  if (done.length === 0) {
    return {
      ok: false,
      error: "连不上节假日数据源，继续使用本地数据。",
      failedYears: failed,
      ...calendarStatus(),
    };
  }
  cnCalendarState.fetchedAt = Date.now();
  cnCalendarState.years = [...new Set([...cnCalendarState.years, ...done])].sort((x, z) => x - z);
  await saveCalendarCache();
  return { ok: true, added, years: done, failedYears: failed, pending: cnCalendarState.missing.slice(), ...calendarStatus() };
}

/** 拉取指定年份（保留旧入口）：内部走 fetchCalendarYear，成功后落盘。 */
async function ensureCnCalendar(year) {
  if (cnCalendarYears.has(year)) return;
  cnCalendarYears.add(year); // 先占位，避免并发重复请求
  const n = await fetchCalendarYear(year);
  if (n < 0) return;
  if (!cnCalendarState.years.includes(year)) {
    cnCalendarState.years = [...cnCalendarState.years, year].sort((x, z) => x - z);
  }
  if (cnCalendarState.fetchedAt === 0) cnCalendarState.fetchedAt = Date.now();
  void saveCalendarCache();
}

/** 北京时区日期键 YYYY-MM-DD（传入已 +8h 偏移的 Date）。 */
function cnDateKey(d) {
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}

/** 判断某时间戳（毫秒）是否处于高峰时段（北京时间；含周末、法定节假日与调休上班判断）。 */
// 窗口/星期只跟 config 有关，不该每帧重建（2026-10-31 审计 M8）：
// 两万帧的会话 ≈ 4000 次调用，原来每次都要 map 两个数组、分配两份对象。
// withSettings 每次会产出**新对象**，所以用 WeakMap 按 config 身份缓存，自动随 GC 释放。
// 日历查询必须留在函数体里（CN_CALENDAR 会随同步被填充，缓存住会读到旧表）。
const peakRuleCache = new WeakMap();
function peakRuleOf(config) {
  const cacheable = config != null && typeof config === "object";
  if (cacheable) {
    const hit = peakRuleCache.get(config);
    if (hit !== void 0) return hit;
  }
  const windows = (Array.isArray(config?.peakWindows) && config.peakWindows.length > 0
    ? config.peakWindows
    : DEFAULT_PEAK_WINDOWS
  ).map((w) => ({ start: Number(w.start), end: Number(w.end) }));
  const weekdays = Array.isArray(config?.peakWeekdays) && config.peakWeekdays.length > 0
    ? config.peakWeekdays.map(Number)
    : DEFAULT_PEAK_WEEKDAYS;
  const rule = { windows, weekdays };
  if (cacheable) peakRuleCache.set(config, rule);
  return rule;
}
function isPeakAt(timeMs, config) {
  const { windows, weekdays } = peakRuleOf(config);
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
  // ⚠️ 两个调用都必须包住（2026-10-31 全量审查）：它们是 DSH 内部方法，
  // 会话处于半装载 / 已释放状态时抛错很正常。detectModel 在 ?session= 主路径上，
  // 这里一抛就是整条接口 500，而模型只是「用来选价格」的次要信息，拿不到还有兜底。
  if (typeof session.requestHeader === "function") {
    try {
      const header = session.requestHeader();
      const m = header?.config?.model;
      if (typeof m === "string" && m !== "") return m;
    } catch {
      // 折叠头拿不到就继续往下走
    }
  }
  if (typeof session.requestContext === "function") {
    try {
      const ctx = session.requestContext();
      const m = ctx?.model;
      if (typeof m === "string" && m !== "") return m;
    } catch {
      // 同上
    }
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
  // credentials 是可选服务，ctx.get 本身可能抛；resolve() 也会抛（凭据存储损坏 / 未解锁）。
  // resolved.value 更不能裸取长度（2026-10-31 审计 L4）—— 这里的异常会一路冒到 HTTP handler，
  // 变成零字节响应 + 客户端挂到超时。拿不到就当没有，交给后面的环境变量。
  try {
    const credentials = ctx.get("credentials");
    if (credentials !== void 0 && credentials !== null && typeof credentials.resolve === "function") {
      const resolved = await credentials.resolve("DEEPSEEK_API_KEY");
      if (resolved != null && typeof resolved.value === "string" && resolved.value.length > 0) {
        return resolved.value;
      }
    }
  } catch {
    // 凭据服务不可用：继续往下找环境变量
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
  // ⚠️ 不能直接 infos[0]（2026-10-31 全量审查）：
  // 官方账号路径（normalizeAccountBalance）已经改成「只认计 CNY 钱包」，
  // 而这条 API Key 路径还是取数组第一个 —— 两条路径对同一个账号
  // 可能给出不同币种、不同数字。取币种名确定一的那个，
  // 没有 CNY 才退回首位。
  const info = infos.find((w) => String(w && w.currency).toUpperCase() === "CNY") ?? infos[0];
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
  // 主数字是充值余额；充值花光但还有赠送时不能报「暂无余额」。
  if ((!balance.total_balance || balance.total_balance === "0.00") && (!balance.granted_balance || balance.granted_balance === "0.00")) {
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
const PLUGIN_VERSION = "2.1.4";

/** 斜杠命令名（2026-10-31 定案：用带作者后缀的全名，避免和别的余额插件撞车，也不设备用名）。
 *  ⚠️ DSH 的 COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u —— **只允许小写**。
 *  写成 balance-dsh-Rannist 会在 normalizeDefinition 里抛 TypeError，整条命令直接消失，
 *  所以这里落成小写；界面里输入 `/balance-dsh-rannist` 即可。 */
const COMMAND_NAME = "balance-dsh-rannist";

/** 磁盘上**实际安装**的版本号。
 *
 *  `PLUGIN_VERSION` 是编译进代码里的常量 —— 插件升级后新文件已经落盘，但插件进程
 *  仍是旧实例，于是设置页一直显示旧版本号，非要重启 DeepSeek Harness 才变
 *  （用户 2026-10-31 反馈）。
 *
 *  这里改成读 package.json，按 mtime 缓存：文件没换过只多一次 statSync，
 *  换过立刻读到新值。读不到（打包方式异常 / 权限）就退回常量，绝不抛错。
 */
let installedVersionCache = { mtimeMs: -1, value: PLUGIN_VERSION };
function installedVersion() {
  try {
    const file = new URL("../package.json", import.meta.url);
    const stat = statSync(file);
    if (stat.mtimeMs === installedVersionCache.mtimeMs) return installedVersionCache.value;
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const v = typeof parsed?.version === "string" && parsed.version !== "" ? parsed.version : PLUGIN_VERSION;
    installedVersionCache = { mtimeMs: stat.mtimeMs, value: v };
    return v;
  } catch {
    return PLUGIN_VERSION;
  }
}

// ─── 检查更新 ───────────────────────────────────────────────────────────────
// 只查 npm registry 的 latest 标签（一个很小的 JSON），不下载任何东西。
// 结果缓存 10 分钟：设置页的按钮连着点也不会把 registry 打爆。
const UPDATE_CACHE_MS = 10 * 60 * 1000;
const UPDATE_REGISTRY_URL = "https://registry.npmjs.org/balance-dsh/latest";
let updateCache = { at: 0, value: null };

/** 语义化版本比较：a > b 返回正、相等返回 0、a < b 返回负。
 *  只比三段数字（忽略预发布后缀），够用来判断「npm 上的是不是比本地新」。 */
function compareVersion(a, b) {
  const parse = (v) =>
    String(v ?? "")
      .trim()
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((x) => parseInt(x, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 本插件的安装根目录（.../node_modules/balance-dsh），由 import.meta.url 反推。
 *  定位不到返回空串（调用方报错，不动任何文件）。 */
async function installedPluginDir() {
  try {
    const { fileURLToPath } = await import("node:url");
    const { dirname } = await import("node:path");
    // .../node_modules/balance-dsh/lib/index.js → 上两级就是包根
    return dirname(dirname(fileURLToPath(import.meta.url)));
  } catch {
    return "";
  }
}

/** 极简 tar.gz 解包：只取普通文件、去掉 npm 固定的 package/ 前缀，返回 [{ rel, data }]。
 *  不处理符号链接（npm 包是禁掉 symlink 的）与 ustar 长文件名（本包路径都很短）。 */
async function extractPackageFiles(gz) {
  const { gunzipSync } = await import("node:zlib");
  const tar = gunzipSync(gz);
  const files = [];
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    // 尾部是全零块，遇到就结束
    let allZero = true;
    for (let i = 0; i < 512; i += 1) {
      if (header[i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) break;
    const name = header.toString("utf8", 0, 100).replace(/\0.*$/, "");
    const size = parseInt(header.toString("utf8", 124, 136).replace(/\0.*$/, "").trim(), 8) || 0;
    const typeFlag = header.toString("utf8", 156, 157);
    // "0" / "" / NUL = 普通文件；"5" = 目录，"2" = 符号链接，都跳过
    const isFile = typeFlag === "0" || typeFlag === "" || typeFlag === "\0";
    if (isFile && size > 0 && name !== "") {
      const rel = name.startsWith("package/") ? name.slice("package/".length) : name;
      if (rel !== "" && !rel.endsWith("/") && !rel.includes("..")) {
        files.push({ rel, data: tar.subarray(off + 512, off + 512 + size) });
      }
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** tarball 地址（npm 的固定布局）。 */
function updateTarballUrl(version) {
  return "https://registry.npmjs.org/balance-dsh/-/balance-dsh-" + version + ".tgz";
}

/** 插件目录所在的 profile 根（.../profiles/<名字>/node_modules/balance-dsh → .../profiles/<名字>）。
 *
 *  用户反馈（2026-10-31）：「在插件设置里更新之后重启会导致版本回归，更新完是 2.1.0，
 *  重启了之后又变成 2.0.8」。根因就是这里 —— 就地覆盖文件只改了 node_modules 里的内容，
 *  profile 的 package.json / pnpm-lock.yaml 里锁的还是旧版本；DSH 重启时按声明版本重新
 *  落地那一份，于是又退回 2.0.8。所以必须同时把「声明的版本」也更新掉，见下面
 *  installViaPackageManager。 */
async function profileDirOf(pluginDir) {
  if (typeof pluginDir !== "string" || pluginDir === "") return "";
  const { dirname, basename, join } = await import("node:path");
  const fs = await import("node:fs/promises");
  /** 这一层是不是「声明了 balance-dsh 的 profile 根」。 */
  const declares = async (dir) => {
    try {
      const raw = JSON.parse(await fs.readFile(join(dir, "package.json"), "utf8"));
      return raw != null && typeof raw === "object" && raw.dependencies != null && Object.hasOwn(raw.dependencies, "balance-dsh");
    } catch {
      return false;
    }
  };
  // 常规布局：<profile>/node_modules/<包>
  const nodeModules = dirname(pluginDir);
  if (basename(nodeModules) === "node_modules") {
    const profile = dirname(nodeModules);
    if (await declares(profile)) return profile;
  }
  // 兜底：pnpm 的虚拟仓是 <profile>/node_modules/.pnpm/<包>@<版本>/node_modules/<包>，
  // 上一级不是 profile —— 往上找「package.json 里声明了 balance-dsh」的那一层，最多 6 级。
  // 认不出来返回 ""（开发目录），调用方按「本地装法」处理，就地覆盖就是最终状态。
  let dir = dirname(pluginDir);
  for (let i = 0; i < 6 && dir !== ""; i += 1) {
    if (await declares(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "";
}

/** profile 里 balance-dsh 的依赖声明。只有**registry 版本号**才需要走包管理器：
 *  `file:` / `link:` / `git` 这类指向本地目录的装法，就地覆盖文件就是最终状态，不会被回退。 */
async function profileSpecOf(profileDir) {
  if (profileDir === "") return "";
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const raw = JSON.parse(await readFile(join(profileDir, "package.json"), "utf8"));
    const spec = raw?.dependencies?.["balance-dsh"];
    if (typeof spec !== "string") return "";
    const trimmed = spec.trim();
    if (trimmed === "") return "";
    // file:/link:/portal:/workspace:/git+https: 这些都不指向 registry 版本号。
    // ⚠️ git 要写成 `git(?:\+[a-z]+)?`：实参是 `git+https://…`，光写 `git\+` 后面
    // 跟的是 `https:` 而不是冒号，会漏过去被当成 registry 号（探针 2026-10-31 抓到）。
    if (/^(file|link|portal|workspace|git(?:\+[a-z]+)?|https?):/i.test(trimmed)) return "";
    if (trimmed.startsWith(".") || trimmed.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(trimmed)) return "";
    return trimmed;
  } catch {
    return "";
  }
}

/** 用 DSH 自带的 pnpm 真正装一遍：它会把 profile 的 package.json + pnpm-lock.yaml + node_modules
 *  一起改成新版本，重启不会再退回旧号。失败时把两个文件按原样恢复（对齐 DSH 插件管理器自己的做法）。 */
async function installViaPackageManager(profileDir, version) {
  const result = { ok: false, error: "", output: "" };
  if (profileDir === "" || version === "") {
    result.error = "没有 profile 目录";
    return result;
  }
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const roots = [];
  const res = typeof process !== "undefined" && typeof process.resourcesPath === "string" ? process.resourcesPath : "";
  if (res !== "") {
    roots.push(path.join(res, "runtime", "primary-runtime", "dependencies"));
    roots.push(path.join(res, "app", "runtime", "primary-runtime", "dependencies"));
  }
  const exe = typeof process !== "undefined" && typeof process.execPath === "string" ? process.execPath : "";
  if (exe !== "") {
    const base = path.dirname(exe);
    roots.push(path.join(base, "runtime", "primary-runtime", "dependencies"));
    roots.push(path.join(base, "resources", "runtime", "primary-runtime", "dependencies"));
    roots.push(path.join(base, "..", "resources", "runtime", "primary-runtime", "dependencies"));
  }
  let nodeExe = "";
  let pnpmMjs = "";
  for (const root of roots) {
    const nodeTry = process.platform === "win32"
      ? path.join(root, "node", "bin", "node.exe")
      : path.join(root, "node", "bin", "node");
    const pnpmTry = path.join(root, "pnpm", "bin", "pnpm.mjs");
    try {
      await fs.access(nodeTry);
      await fs.access(pnpmTry);
      nodeExe = nodeTry;
      pnpmMjs = pnpmTry;
      break;
    } catch {
      // 继续试下一个候选根
    }
  }
  if (nodeExe === "" || pnpmMjs === "") {
    result.error = "找不到 DSH 自带的 pnpm";
    return result;
  }

  // 备份两个会被 pnpm 改写的文件：失败要原样恢复，绝不能让 profile 停在半改状态
  const saved = [];
  for (const name of ["package.json", "pnpm-lock.yaml"]) {
    const file = path.join(profileDir, name);
    try {
      saved.push({ file, text: await fs.readFile(file, "utf8") });
    } catch {
      saved.push({ file, text: null });
    }
  }
  const restore = async () => {
    for (const item of saved) {
      try {
        if (item.text === null) await fs.rm(item.file, { force: true });
        else await fs.writeFile(item.file, item.text, "utf8");
      } catch {
        // 恢复失败也只能作罢，至少已经报错给用户
      }
    }
  };

  const { spawn } = await import("node:child_process");
  const args = [
    pnpmMjs,
    "add",
    "balance-dsh@" + version,
    "--config.minimum-release-age=0",
    "--config.confirmModulesPurge=false",
    "--reporter=append-only",
    "--registry",
    "https://registry.npmjs.org/",
  ];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  const child = spawn(nodeExe, args, { cwd: profileDir, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout?.on("data", (chunk) => {
    out += String(chunk);
    if (out.length > 20000) out = out.slice(-20000);
  });
  child.stderr?.on("data", (chunk) => {
    out += String(chunk);
    if (out.length > 20000) out = out.slice(-20000);
  });
  const done = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // 进程可能已经退出
      }
      resolve({ code: -1, timedOut: true });
    }, 240000);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, error: error instanceof Error ? error.message : String(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: typeof code === "number" ? code : -1, timedOut: false });
    });
  });
  result.output = out.trim().split(/\r?\n/).slice(-6).join("\n");
  if (done.code === 0) {
    result.ok = true;
    return result;
  }
  await restore();
  result.error = done.timedOut
    ? "pnpm 超过 4 分钟没有结束（已中止，profile 已恢复原状）"
    : (done.error || ("pnpm 退出码 " + String(done.code)));
  return result;
}

/** 就地更新本插件：下载 npm 上的最新 tarball → 解包 → 逐文件覆盖自己的安装目录。
 *
 *  几个刻意的取舍：
 *  - 只覆盖 tarball 里有的文件，不删任何东西。上游删掉的文件会残留，但残留无害，
 *    比误删用户目录里的东西安全得多。
 *  - 覆盖前把旧文件备份到 <dshHome>/balance-update-backup/<from>-<时间戳>/，可手工回滚。
 *  - 逐个文件写、单个失败只记进 failed 不中断 —— 最典型的是 Windows 上 package.json
 *    被 DSH 占着（之前同步时就踩过），但 lib/*.js 能写进去，功能不受影响。
 *  - 覆盖后 lib/index.js 的改动**必须重启 DSH** 才生效：Node 不会热替换已加载的模块。
 *    返回值里带 restart:true，让界面明确提示。
 */
async function installLatestVersion(ctx) {
  const found = await fetchLatestVersion();
  if (found.error) return { ok: false, error: found.error };
  const latest = found.latest;
  // 比的是「磁盘上装的版本」而不是编译时常量：否则插件升级后、进程还没重启时，
  // 明明已经是最新也会被判成有更新可装。
  const currentVer = installedVersion();
  if (compareVersion(latest, currentVer) <= 0) {
    return { ok: true, installed: false, from: currentVer, to: latest, note: "已是最新版本" };
  }

  const root = await installedPluginDir();
  if (root === "") return { ok: false, error: "定位不到插件安装目录" };

  // ★ 先看这一份装法是不是「按 registry 版本装进 profile 的」。
  // 是的话，光覆盖 node_modules 里的文件没用 —— profile 的 package.json / pnpm-lock.yaml
  // 还锁着旧版本，DSH 重启时按声明版本重新落地，版本就退回旧号（用户 2026-10-31 报的现象）。
  // 所以这种情况先让 DSH 自带的 pnpm 真正装一遍，声明与文件一起变，重启才不丢。
  const profileDir = await profileDirOf(root);
  const registrySpec = await profileSpecOf(profileDir);
  const manualCommand = "dsh plugin install balance-dsh@" + latest;
  let pnpmFailure = "";
  let pnpmOutput = "";
  if (registrySpec !== "") {
    const viaPnpm = await installViaPackageManager(profileDir, latest);
    if (viaPnpm.ok) {
      updateCache = { at: 0, value: null };
      return {
        ok: true,
        installed: true,
        from: currentVer,
        to: latest,
        via: "pnpm",
        persisted: true,
        files: 0,
        failed: [],
        restart: true,
      };
    }
    // pnpm 跑不起来（没有自带 runtime / 断网 / 被策略拦）：继续走就地覆盖，
    // 但必须如实告诉用户「这次不持久」，并给出能真正生效的命令。
    pnpmFailure = viaPnpm.error;
    pnpmOutput = viaPnpm.output;
  }

  let gz;
  try {
    const signal =
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(20000)
        : undefined;
    const res = await fetch(updateTarballUrl(latest), { signal });
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "?"));
    gz = Buffer.from(await res.arrayBuffer());
  } catch (error) {
    return { ok: false, error: "下载 " + latest + " 失败：" + (error instanceof Error ? error.message : String(error)) };
  }

  let files;
  try {
    files = await extractPackageFiles(gz);
  } catch (error) {
    return { ok: false, error: "解包失败：" + (error instanceof Error ? error.message : String(error)) };
  }
  if (files.length === 0) return { ok: false, error: "下载到的包里没有文件" };

  const { mkdir, writeFile, readFile, rename, unlink } = await import("node:fs/promises");
  const { dirname, join, resolve, sep } = await import("node:path");

  // 备份目录：拿不到 dshHome 就跳过备份（仍继续更新，失败项会体现在 failed 里）
  const home = dshHomeDir(ctx);
  const backupRoot =
    home === "" ? "" : join(home, "balance-update-backup", installedVersion() + "-" + Date.now());

  const written = [];
  const failed = [];
  const rootAbs = resolve(root);
  const rootPrefix = rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep;

  for (const file of files) {
    const dst = resolve(rootAbs, file.rel);
    // 防路径穿越：解析后必须仍在包目录里
    if (!dst.startsWith(rootPrefix)) {
      failed.push(file.rel + "（路径越界，已跳过）");
      continue;
    }
    try {
      if (backupRoot !== "") {
        try {
          const old = await readFile(dst);
          const bak = join(backupRoot, file.rel);
          await mkdir(dirname(bak), { recursive: true });
          await writeFile(bak, old);
        } catch {
          // 旧文件不存在（新版本新增的文件）或不可读：没有可备份的，继续
        }
      }
      await mkdir(dirname(dst), { recursive: true });
      // 先写同目录临时文件再 rename：原子替换 + 断开硬链接（profile 里有些文件是
      // pnpm 硬链接，直接 writeFile 会写进同一个 inode，可能污染 store / 其它 profile）。
      const staging = dst + ".new-" + Date.now() + "-" + written.length;
      try {
        await writeFile(staging, file.data);
        await rename(staging, dst);
      } catch (error) {
        try {
          await unlink(staging);
        } catch {
          // 临时文件没建起来或已清理，忽略
        }
        throw error;
      }
      written.push(file.rel);
    } catch (error) {
      failed.push(file.rel + "：" + (error instanceof Error ? error.message : String(error)));
    }
  }

  if (written.length === 0) {
    return { ok: false, error: "没有文件写入成功：" + failed.join("；") };
  }

  // 缓存里的 latest 可能已经过时，更新完作废，下次检查重新问 registry
  updateCache = { at: 0, value: null };

  return {
    ok: true,
    installed: true,
    from: currentVer,
    to: latest,
    via: "files",
    // registry 装法只覆盖文件 = 重启会被 profile 里锁的旧版本覆盖回去，必须如实标出来
    persisted: registrySpec === "",
    warning: registrySpec === ""
      ? ""
      : "文件已覆盖到 " + latest + "，但本机是按 npm 版本装进 profile 的，profile 里锁定的还是旧版本；"
        + "重启后可能退回旧号（" + (pnpmFailure || "自带 pnpm 不可用") + "）。"
        + "请执行 " + manualCommand + " 后再重启，或用 设置 → 插件 里的更新。",
    command: manualCommand,
    pnpmError: pnpmFailure,
    pnpmOutput,
    files: written.length,
    failed,
    backup: backupRoot,
    restart: true,
  };
}

/** 查 npm 上 balance-dsh 的最新版本。成功返回 { latest }，失败返回 { error }（失败不缓存，下次可重试）。 */
async function fetchLatestVersion(force) {
  const now = Date.now();
  if (!force && updateCache.value && now - updateCache.at < UPDATE_CACHE_MS) return updateCache.value;
  if (typeof fetch !== "function") return { error: "当前运行环境没有 fetch" };
  try {
    let signal;
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      signal = AbortSignal.timeout(8000);
    }
    const res = await fetch(UPDATE_REGISTRY_URL, { headers: { accept: "application/json" }, signal });
    if (!res || !res.ok) throw new Error("registry 返回 HTTP " + (res ? res.status : "?"));
    const data = await res.json();
    const latest = data && typeof data.version === "string" ? data.version.trim() : "";
    if (latest === "") throw new Error("registry 返回里没有 version 字段");
    updateCache = { at: now, value: { latest } };
    return updateCache.value;
  } catch (error) {
    // 超时 / 断网 / 被墙都走这里，只影响这个按钮，不影响余额与设置
    return { error: error instanceof Error ? error.message : String(error) };
  }
}


/**
 * 读取官方账号余额并归一化成与 normalizeBalance 相同的形状。
 * 服务不存在、未登录、接口报错一律返回 null，由调用方回退 API Key，绝不因此抛错。
 */
//
// ⚠️ 服务端单飞（2026-10-31 全量审查）：官方余额接口实测 419ms，
// 而 /balance-api 的每一个分支（?session= / ?today=1 / ?stats=1）都会顺手叫一次。
// 多窗口 / 多 slot / 启动时短信几个请求并发就会重复查同一份余额。
// 这里只合并**同时进行中**的请求（single-flight），**不做 TTL 缓存** ——
// 余额不能因为服务端缓存而变旧（用户右键刷新就是要看最新值），
// 只把「同一瞬间的重复开销」去掉，单个请求的新鲜度与原来完全一致。
let accountBalanceInFlight = null;

async function fetchAccountBalance(ctx) {
  const account = typeof ctx.get === "function" ? ctx.get("deepseekAccount") : void 0;
  if (account === void 0 || account === null || typeof account.getBalance !== "function") return null;
  if (accountBalanceInFlight !== null) return accountBalanceInFlight;
  accountBalanceInFlight = (async () => {
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
  })();
  try {
    return await accountBalanceInFlight;
  } finally {
    accountBalanceInFlight = null;
  }
}

/** 官方钱包结构 → 统一余额形状。value 是充值钱包，bonusWallets 是赠送钱包（官方不计入充值余额）。 */
function normalizeAccountBalance(result) {
  // ⚠️ 必须把同币种的**所有**钱包求和，不能只取第一个（原来用 find 取首笔）。
  // 充值可能拆成多个钱包（分批到账、或充值款与其它款分开管），只取首笔会让总额
  // 跟着数组返回顺序变化 —— 用户 2026-10-31 报「刚充值，手动刷新几次数字反复跳动」
  // 就是这种表现。求和对顺序天然免疫，也才等于「账户余额」的语义。
  const sumByCurrency = (list, currency) => {
    const arr = Array.isArray(list) ? list : [];
    let sum = 0;
    let found = false;
    for (const w of arr) {
      if (!w || typeof w.balance !== "string") continue;
      if (w.currency !== currency) continue;
      const n = Number(w.balance);
      if (!Number.isFinite(n)) continue;
      sum += n;
      found = true;
    }
    return found ? sum : null;
  };
  // 币种先看充值钱包，再看赠送钱包，都没有就按 CNY。
  const currencyOf = (list) => {
    const arr = Array.isArray(list) ? list : [];
    const hit = arr.find((w) => w && typeof w.currency === "string" && w.currency !== "");
    return hit ? hit.currency : null;
  };
  const currency = currencyOf(result.value) ?? currencyOf(result.bonusWallets) ?? "CNY";
  const toppedSum = sumByCurrency(result.value, currency);
  const grantedSum = sumByCurrency(result.bonusWallets, currency);
  // 官方金额字符串遵循 big.js 文法（允许 0E-16 这类写法），Number() 能正确解析。
  const toppedUp = toppedSum !== null ? toppedSum : 0;
  const grantedAmount = grantedSum !== null ? grantedSum : 0;
  return {
    // 有赠送余额也算可用（充值款花完了、赠送还在，仍然能继续用）。
    is_available: toppedUp + grantedAmount > 0,
    currency,
    // ⚠️ 主数字 = **充值余额**，必须和官网「充值余额」那个数字一模一样。
    // 2026-10-31 用户贴官网截图「充值余额 ¥7.80」，插件显示 ¥8.10 —— 差的正是
    // 赠送钱包的 ¥0.30。官方页面上「充值余额」只统计 value，bonusWallets 是**另一栏**，
    // 把两者相加就永远对不上官网。赠送余额单独放在 granted_balance 里，不并入主数字。
    // （注意：value 内部仍然要**求和所有同币种钱包**，那是修「反复跳动」的另一件事，别退回 find。）
    total_balance: toppedUp.toFixed(2),
    granted_balance: grantedAmount.toFixed(2),
    topped_up_balance: toppedUp.toFixed(2),
    // 官方返回的**原始字符串**，只用于核对「插件显示的数 vs 官网显示的数」到底差在哪
    // （2026-10-31：官网「充值余额 ¥7.36」、插件 ¥7.37，差 0.01，光看两位小数分不出是
    //  舍入口径不同还是两次读取的时刻不同）。不进 UI，只在 /balance-api 里带出来。
    raw: {
      value: (Array.isArray(result.value) ? result.value : []).map((w) => (w ? { currency: w.currency, balance: w.balance } : null)),
      bonusWallets: (Array.isArray(result.bonusWallets) ? result.bonusWallets : []).map((w) => (w ? { currency: w.currency, balance: w.balance } : null)),
    },
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

/** 图片 token 换算 —— **原样移植 DeepSeek 官方文档站「图片 Token 计算器」的实现**
 *  （文档站 chunk 6620 里的 class h，配置取 h.v41()）。
 *
 *  官方文字只给了三条口头规则（总像素 < 544² 等比放大、更大的缩到总像素约 1300²、每张上限 1024），
 *  真正的换算在这段前端代码里，而且它对宽高方向的用法并不直观 —— 所以**逐字符保真搬过来，
 *  不要「读懂后重写」**：第一版做了语义化重命名，把 safeResize 的实参顺序搞反，
 *  结果横图与竖图直接互换（3840×2160 给出 986，官方是 968；1080×1920 恰好反之）。
 *
 *  算法要点（v41 配置）：patchSize=14、downsampleRatio=3、maxNToken=1024、minPixels=544²。
 *  像素先按 patchSize 向上取整对齐，再按 downsampleRatio 折成视觉网格，
 *  token = 网格B × (网格A + 1) + 2；超预算时用解析解求比例并迭代收敛（最多 10 轮）。
 *
 *  校验方式：把 chunk 原文求值当 oracle，与移植版逐尺寸比对 —— 定向 23 组 + 随机 3000 组全等。
 *  ⚠️ 只用于**展示**：DeepSeek 已把图片折成 token 计入 usage.inputTokens，
 *  这里再乘价格就是重复计费（金额会翻倍）。 */
const ImageTokenCalculator = (() => {
  const l = (e, t) => Math.floor(e / t),
    c = (e, t) => Math.floor((e + t - 1) / t),
    r = (e) => Math.trunc(e);
  class ImageTokenCalculator {
    constructor(e, t, s, n, i, a, o) { this.patchSize = e; this.downsampleRatio = t; this.maxNToken = s; this.isNLayout = n; this.compressPadTo = null == i ? null : i; this.maxWhRatio = null == a ? null : a; this.minPixels = o; }
    static v4() { return new ImageTokenCalculator(14, 3, 384, !0, 4, 8, 147456); }
    static v41() { return new ImageTokenCalculator(14, 3, 1024, !1, null, null, 295936); }
    worstPad() { return this.isNLayout && null != this.compressPadTo ? this.compressPadTo - 1 : 0; }
    actualPad(e) { return this.isNLayout && null != this.compressPadTo ? null == e ? this.compressPadTo - 1 : (this.compressPadTo - (e + 1) % this.compressPadTo) % this.compressPadTo : 0; }
    calcNumTokens(e, t) { let s = e * (t + 1) + 2; return this.isNLayout && (e % 2 == 1 && (s += t + 1), s += c(e, 2) * (t + 1) % 2 * 2), s; }
    solveResizeRatio(e, t, s) {
      const n = e / t, i = Math.sqrt((s - 2) / n + .25) - .5, a = i * n;
      let o, h;
      if (i < 1) {
        const e2 = 1;
        let t2 = l(s - 2, e2 + 1);
        this.isNLayout && t2 % 2 == 1 && (t2 -= 1), h = e2 * this.patchSize * this.downsampleRatio, o = t2 * this.patchSize * this.downsampleRatio;
      } else if (a < (this.isNLayout ? 2 : 1)) {
        const e2 = this.isNLayout ? 2 : 1, t2 = l(s - 2, e2) - 1;
        if (!(t2 > 1)) throw new Error("assertion failed: max_w > 1");
        h = t2 * this.patchSize * this.downsampleRatio, o = e2 * this.patchSize * this.downsampleRatio;
      } else {
        const s2 = r(i);
        let n2 = r(a);
        this.isNLayout && n2 % 2 == 1 && (n2 -= 1);
        const l2 = s2 * this.patchSize * this.downsampleRatio / t, c2 = n2 * this.patchSize * this.downsampleRatio / e, u = Math.min(l2, c2);
        h = r(t * u / this.patchSize) * this.patchSize, o = r(e * u / this.patchSize) * this.patchSize;
      }
      const u2 = c(l(o, this.patchSize), this.downsampleRatio), d = c(l(h, this.patchSize), this.downsampleRatio);
      return { nLlmH: u2, nLlmW: d, bestHeight: o, bestWidth: h, numTokens: this.calcNumTokens(u2, d) };
    }
    safeResize(e, t, s, n) {
      const i = c(l(s, this.patchSize), this.downsampleRatio), a = c(l(n, this.patchSize), this.downsampleRatio), o = this.calcNumTokens(i, a), r2 = this.worstPad(), h = this.maxNToken - r2;
      let u = { nLlmH: i, nLlmW: a, bestHeight: s, bestWidth: n, numTokens: o };
      if (u.numTokens > h) {
        if (u = this.solveResizeRatio(e, t, h), this.isNLayout) {
          let s2 = h;
          for (; u.numTokens > h;) s2 -= 1, u = this.solveResizeRatio(e, t, s2);
        }
        if (!(u.numTokens <= h)) throw new Error("assertion failed: result.num_tokens <= max_n_token");
      }
      return u.numTokens += r2, u;
    }
    calcResizeInner(e, t, s) {
      null != this.maxWhRatio && e > t * this.maxWhRatio && (e = t * this.maxWhRatio);
      const n = e * t;
      if (n < this.minPixels && n > 0) {
        const s2 = Math.sqrt(this.minPixels / n);
        e = r(e * s2), t = r(t * s2);
      }
      const i = c(e, this.patchSize) * this.patchSize, a = c(t, this.patchSize) * this.patchSize, o = this.worstPad(), l2 = this.actualPad(s), h = this.safeResize(t, e, a, i);
      return h.numTokens -= o - l2, h;
    }
    calcResize(e, t, s) {
      void 0 === s && (s = null);
      let n = this.calcResizeInner(e, t, s);
      for (let o = 1; o < 10; o++) {
        const e2 = this.calcResizeInner(n.bestWidth, n.bestHeight, s);
        if (e2.nLlmH === n.nLlmH && e2.nLlmW === n.nLlmW && e2.bestHeight === n.bestHeight && e2.bestWidth === n.bestWidth && e2.numTokens === n.numTokens) return n;
        n = e2;
      }
      throw new Error("calc_resize did not converge after 10 iterations, last result: " + JSON.stringify(n));
    }
    calcTokenLen(e, t, s) { return void 0 === s && (s = null), this.calcResize(e, t, s).numTokens; }
  }
  return ImageTokenCalculator;
})();

const IMAGE_TOKEN_CALC = ImageTokenCalculator.v41();

/** 单张图片的估算 token 数；尺寸非法时返回 0（官方计算器此时会报「无法计算」）。 */
function estimateImageTokens(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 0;
  try {
    return IMAGE_TOKEN_CALC.calcTokenLen(w, h, null);
  } catch {
    return 0;
  }
}

/** 统计会话里的图片：张数 + 估算 token。
 *  ⚠️ 两条铁律：
 *  ① **只用于展示，绝不再计入金额** —— DeepSeek 已把图片折成 token 塞进 usage.inputTokens，
 *     这里只是把它从 input 里「标出来」。再算一次钱就是重复计费（金额会翻倍）。
 *  ② **必须按 attachmentId 去重** —— 同一张图会在 `agent/inbox/spliced` 与 `user/message`
 *     里各记一次（实测 443 次出现只有 273 张唯一图），不去重就会多算近一倍。
 *  只遍历可能携带图片的事件类型，避免把整棵事件树递归一遍（stats 要扫 200 个会话）。 */
const IMAGE_HOST_EVENTS = new Set(["user/message", "agent/inbox/spliced", "tool/result", "developer/message"]);

function imageUsage(events) {
  const seen = new Set();
  let imageCount = 0;
  let imageTokens = 0;
  const visit = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node.type === "image") {
      const attachment = node.attachment ?? {};
      // 兜底键要多带几样：同一张图在两类事件里各记一次（必须去重），但两张**不同**的图
      // 完全可能撞上「同尺寸 + 同字节数」（同一批截图裁剪一致时尤甚），只靠这两项会少算一张。
      // attachmentId 缺席时按「尺寸:字节数:文件名:内容哈希」拼，命中率比裸尺寸高得多。
      const id = attachment.attachmentId ?? node.attachmentId
        ?? [attachment.width, attachment.height, attachment.bytes ?? 0, attachment.name ?? attachment.path ?? "", attachment.sha256 ?? ""].join(":");
      if (!seen.has(id)) {
        seen.add(id);
        imageCount += 1;
        imageTokens += estimateImageTokens(attachment.width, attachment.height);
      }
      return;
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (value !== null && typeof value === "object") visit(value);
    }
  };
  for (const event of events ?? []) {
    if (!IMAGE_HOST_EVENTS.has(event?.type)) continue;
    visit(event.data);
  }
  return { imageCount, imageTokens };
}

/** 从事件数组汇总 usage（按模型分段 + 跨时段分桶）。
 *  供 live 会话与持久化（子代理）会话复用。返回按模型拆分的 byModel，及跨模型聚合字段。 */
function sumEventsUsage(events, config, fallbackModel = "") {
  const switches = collectModelSwitches(events);
  const starts = stepStartTimes(events);
  const fallback = fallbackModel !== "" ? fallbackModel : "deepseek-v4-flash";
  // 网页搜索 / 抓取：次数 + 按次计费金额（2026-11-01 起才收费）
  const webTools = webToolUsage(events);
  // 图片：张数 + 估算 token（**仅展示**，token 已含在 inputTokens 里，不再计费）
  const images = imageUsage(events);
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
    ...images,
  };
}

function sumSessionUsage(session, config) {
  if (session == null) return null;
  // fallbackModel = detectModel(session)：当 message 早于所有模型切换点时兜底，避免落到默认 flash 价。
  // ⚠️ 必须切掉 seeded 前缀（ownEventsOf）：fork 出来的会话（智能体团队里 context:"fork" 的队友）
  // 自己的日志里整段带着父会话的事件，直接求和就把历史算了两遍。
  return sumEventsUsage(
    ownEventsOf(session?.header ?? null, sessionEvents(session)),
    config,
    detectModel(session),
  );
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
// 单会话解压实测 700 ms（35 MB 会话 19331 帧），扫 200 个就是 140 秒 —— 首次打开
// 统计面板会像死机。默认降到 80，配合 inspectPersistedCached 的指纹缓存，
// 第二次之后基本是 0 成本。要更久的历史可在设置里调 statsSessionLimit。
const STATS_MAX_SESSIONS = 80;
// 今日消耗单独一个上限，不再跟统计面板共用（用户 2026-10-31：「启动时如果过多可以
// 计算久一点，并且在设置里添加今日消耗扫描上限」）。今日是常驻数字，漏算比慢更难接受；
// 配合落盘快照 + 指纹缓存，稳态下几乎不重扫，冷启动那一次慢一点可以接受。
const TODAY_MAX_SESSIONS = 200;
// 子代理后代会话的扫描上限。子代理会话通常比主会话小得多，但 `?session=` 每轮都要跑
// 这段枚举，一个开很多子代理的长对话不能让它变成几百次串行解压（同步 CPU，会掉帧）。
const SUBAGENT_MAX_SESSIONS = 60;
const STATS_CACHE_MS = 5 * 60 * 1000;

// ───────────────────────────────────────────────────────────────────────────
// 插件设置：由 DSH「插件」页 → balance-dsh 详情页的配置卡片读写（slot
// `plugins.bundle.config`，见 lib/client.js），落在 <dshHome>/balance-dsh.json。
// 刻意不接 DSH 的 settings / storageDomain 服务——那些内部 API 无兼容承诺，
// 而这个插件已经被 DSH 升级打断过多次；普通 JSON 文件不会因升级失效。
// ───────────────────────────────────────────────────────────────────────────

const SETTINGS_FILENAME = "balance-dsh.json";

// ── 今日消耗快照 ──────────────────────────────────────────────────────────
// 冷启动时「今日消耗」要列出今天动过的会话，再逐个读 zstd 持久化文件解压，
// 会话一多就是几百 MB 的解压量，而它和余额共用同一条 /balance-api 请求 ——
// 余额行得等它算完才出来，加载动效就卡在那一段上（2026-10-31 反馈「每次打开
// 加载动画都会卡」）。
// 解法：算完就把结果落盘，下次启动直接读这个小 JSON 立刻显示，重算放到后台。
const TODAY_SNAPSHOT_FILENAME = "balance-today.json";
// 跨天时旧快照不能直接丢：强制退出时最后一段 usage 可能还没落到会话文件里，
// 那部分是快照独有的。先把它结算进这里，统计弹窗再按日期合并。
const DAILY_SETTLED_FILENAME = "balance-daily-settled.json";
// 快照超过这个年龄就认为「可能过期了」，触发一次后台重算（不阻塞响应）。
const TODAY_SNAPSHOT_STALE_MS = 45 * 1000;
// 今日快照的口径版本。2026-11-01 起 seeded（fork）会话会切掉继承前缀再求和 ——
// 旧版本写下的快照可能把父会话历史算了两遍（偏大），必须让它失效重算一次，
// 否则那个脏数会一直显示到当天结束，还会随跨天结算漏进 balance-daily-settled.json。
// 只在口径真的变了时 +1。
const TODAY_SNAPSHOT_VERSION = 2;

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
  // 2.0.7：「本会话消耗」在等分时段用量时用哪种加载动效。
  //   "wipe"（默认）= 白光擦出：数据到手那一刻一道白光从左扫过，数字跟着光显现。
  //   "text"        = 显示带呼吸动画的「计算中…」文字，数据到手后直接显示数字。
  // 两种都只在等待期间出现，不会先亮一个错误值再换成正确值。
  usageLoadingStyle: "wipe",
  // 侧栏「余额与用量」入口是否已被点开过。false = 显示红点。
  // 与版本号无关：只有用户真正点开过这个面板才会被写成 true，之后永不回退。
  entrySeen: false,
  // NEW 徽标的计时起点：记录「当前版本首次启动」的时间戳与版本号。
  // 版本一变（用户升级了）就重置计时；设置项旁那颗 NEW 亮 24 小时。
  newTagVersion: "",
  newTagSince: 0,
  // 升级前的版本（用户上一次跑的是哪个版本）。
  // 客户端用它和「某项功能的引入版本」比较：只有比它新的功能才标 NEW。
  // 这样跨几个版本一次升上来的用户能看到中间所有新功能，
  // 已经跑过某个版本的用户不会被重复提示。
  newTagFrom: "",
  // 逐项计时：{ [配置项 key]: { v: 引入版本, t: 首次看到的时间戳, e?: 点进过设置页 } }。
  // 每个新功能各自走自己的 24 小时，互不影响：
  // 旧功能没亮完时又升级，也不会被这次升级重新计时——
  // 因为它记录的版本已经是用户见过的版本了。
  // e:true 只影响侧栏入口那颗 NEW（点进去过就不再提示），不影响设置项旁那颗。
  newTagSeen: {},
  // 收起态圆钮外观
  fabSize: 60, // 直径（px）
  fabLeft: 44, // 距窗口左缘（px）
  // 统计
  statsSessionLimit: STATS_MAX_SESSIONS, // 统计扫描的最近会话数
  // 今日消耗扫描的最近会话数。和 statsSessionLimit 分开：今日是常驻数字，
  // 默认放得比统计宽（用户 2026-10-31 要求「过多可以计算久一点」）。
  todaySessionLimit: TODAY_MAX_SESSIONS,
  statsCacheSec: 300, // 统计结果缓存秒数
  // 计费
  // 高峰时段窗口。官方当前是「工作日北京 9-12、14-18」，但这条也是会变的
  // （改了时段就等于改了哪几个小时翻倍）。写成文本而不是数组：输入框直接对应，
  // 没有「数组 → 界面 → 数组」的转换损耗，用户手改也不会因为半截输入被弹回。
  peakWindowsText: "9-12, 14-18",
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
  const entries = [];
  for (const key of Object.keys(raw)) {
    if (typeof key !== "string" || key === "" || key.length > 64) continue;
    const rec = raw[key];
    if (rec == null || typeof rec !== "object" || Array.isArray(rec)) continue;
    const v = typeof rec.v === "string" ? rec.v.trim() : "";
    const t = Number(rec.t);
    if (v === "" || !Number.isFinite(t) || t <= 0) continue;
    const item = { v, t: Math.floor(t) };
    // 额外的布尔标记（e = 用户点进过设置页）原样保留。
    // ⚠️ 这里**不要**逐字段白名单（只认 e、扔掉别的）：每加一个标记就得改服务端，
    // 漏改一次就是「客户端写了、服务端一存一取给丢了」，表现为标签点了又亮回来
    // （2026-10-31 用户报「点进去消失 出来继续显示」，就是这个）。
    // 只收布尔值 + 短键名，杜绝被塞进大对象把设置文件撑爆。
    for (const mark of Object.keys(rec)) {
      if (mark === "v" || mark === "t") continue;
      if (mark.length > 8) continue;
      if (rec[mark] === true) item[mark] = true;
    }
    entries.push([key, item]);
  }
  // 硬上限 24 条，按时间取最近的。NEW_TAGS 现在只有 4 项，正常永远碰不到这条；
  // 它是给「版本不断加新功能、老 key 却没人删」兜底的，防止设置文件越写越大。
  entries.sort((a, b) => b[1].t - a[1].t);
  const out = {};
  for (const [key, item] of entries.slice(0, 24)) out[key] = item;
  return out;
}

/** 高峰窗口文本 → 数组。接受 "9-12, 14-18"、"9-12，14-18"、"9~12" 这几种写法。
 *  逐段校验（0 ≤ start < end ≤ 24，整点），**任何一段不合法就整串作废返回 null** ——
 *  宁可回退官方默认窗口，也不要拿半对半错的窗口去算钱。
 *  end = 24 表示到当天结束（hour 最大 23，`hour < end` 覆盖 23:00-23:59）。 */
function parsePeakWindowsText(text) {
  if (typeof text !== "string") return null;
  const out = [];
  for (const chunk of text.split(/[,，;；]/)) {
    const part = chunk.trim();
    if (part === "") continue;
    const m = part.match(/^(\d{1,2})\s*[-~到至]\s*(\d{1,2})$/);
    if (!m) return null;
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < 0 || end > 24 || start >= end) return null;
    out.push({ start, end });
  }
  return out.length > 0 ? out : null;
}

/** 高峰窗口文本的**类型清洗**（不校验语法）。
 *  用户打到一半（"9-"）也要能存下来继续编辑，所以这里不判合法；
 *  真正解析发生在 withSettings（服务端算钱）与客户端 currentPeriod（显示标签），
 *  解析失败一律回退官方默认窗口 —— 计费永远不会因为一段烂文本而错。 */
function normalizePeakWindowsText(raw, fallback) {
  if (typeof raw !== "string") return fallback;
  const text = raw.trim();
  if (text === "") return fallback;
  return text.slice(0, 80);
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
    // 枚举值只认已知项，其余（含旧版的布尔写入）一律回落默认
    usageLoadingStyle: src.usageLoadingStyle === "text" || src.usageLoadingStyle === "wipe"
      ? src.usageLoadingStyle
      : d.usageLoadingStyle,
    entrySeen: bool(src.entrySeen, d.entrySeen),
    newTagVersion: typeof src.newTagVersion === "string" ? src.newTagVersion : d.newTagVersion,
    newTagFrom: typeof src.newTagFrom === "string" ? src.newTagFrom : d.newTagFrom,
    newTagSeen: normalizeNewTagSeen(src.newTagSeen),
    newTagSince: clampNumber(src.newTagSince, 0, Number.MAX_SAFE_INTEGER, d.newTagSince),
    fabSize: clampNumber(src.fabSize, 32, 120, d.fabSize),
    fabLeft: clampNumber(src.fabLeft, 0, 600, d.fabLeft),
    statsSessionLimit: clampNumber(src.statsSessionLimit, 10, 2000, d.statsSessionLimit),
  todaySessionLimit: clampNumber(src.todaySessionLimit, 10, 2000, d.todaySessionLimit),
    statsCacheSec: clampNumber(src.statsCacheSec, 0, 3600, d.statsCacheSec),
    peakWindowsText: normalizePeakWindowsText(src.peakWindowsText, d.peakWindowsText),
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
    // 设置里改的高峰窗口优先；文本解析不出来就回退官方默认窗口，
    // 绝不能把 undefined 透给 isPeakAt（那会让 isPeakAt 自己再 fallback，语义重复）
    peakWindows: parsePeakWindowsText(s.peakWindowsText) ?? DEFAULT_PEAK_WINDOWS,
    peakMultiplier: s.peakMultiplier,
    priceByModel,
    statsSessionLimit: s.statsSessionLimit,
  todaySessionLimit: s.todaySessionLimit,
    statsCacheMs: s.statsCacheSec * 1000,
  };
}

/** DSH 的 home 目录：优先 dshHomePath 服务，再环境变量，最后 ~/.dsh。
 *  返回空串表示定位不到，此时设置读写与更新备份一律静默降级。 */
function dshHomeDir(ctx) {
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
  return home;
}

/** 设置文件路径。返回空串表示定位不到，此时读写一律静默降级为「用默认值、不落盘」。 */
function settingsFilePath(ctx) {
  const home = dshHomeDir(ctx);
  if (home === "") return "";
  const sep = home.includes("\\") && !home.includes("/") ? "\\" : "/";
  return `${home.replace(/[\\/]+$/, "")}${sep}${SETTINGS_FILENAME}`;
}

/** 与设置文件同目录的兄弟文件路径；定位不到 dshHome 时返回空串（调用方静默降级）。 */
function siblingFilePath(ctx, filename) {
  const settings = settingsFilePath(ctx);
  if (settings === "") return "";
  const sep = settings.includes("\\") && !settings.includes("/") ? "\\" : "/";
  const dir = settings.slice(0, settings.lastIndexOf(sep));
  return `${dir}${sep}${filename}`;
}

/** 北京当日 0 点对应的真实时间戳（用 UTC 分量读北京日期，再减回去）。
 *  「今天」的分界线按北京时间算：用户看的是北京时间，跨天清理也必须跟着它走。 */
function beijingDayStart(now = Date.now()) {
  const bj = new Date(now + 8 * 60 * 60 * 1000);
  return Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()) - 8 * 60 * 60 * 1000;
}

/** 读今日消耗快照；不存在 / 损坏 / 不是今天的都返回 null（调用方回退到现算）。 */
async function readTodaySnapshot(file) {
  if (file === "") return null;
  try {
    const { readFile } = await import("node:fs/promises");
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (parsed == null || typeof parsed !== "object") return null;
    // 口径版本不符就当作没有快照 → 走一次现算。见 TODAY_SNAPSHOT_VERSION。
    if (Number(parsed.v ?? 1) !== TODAY_SNAPSHOT_VERSION) return null;
    const date = typeof parsed.date === "string" ? parsed.date : "";
    if (date === "" || date !== beijingDayKey()) return null; // 昨天的快照一律不认
    const cost = Number(parsed.cost);
    const totalTokens = Number(parsed.totalTokens);
    // ⚠️ `bySession` 必须一起还原（2026-10-31 全量审查）。
    // 增量路径 updateTodayCostWithSession 的口径是「其余会话原样搬运上一次的 bySession，
    // 只把当前会话那一桶换掉」，它读的就是 base.bySession。快照里丢掉这个字段，
    // 冷启动第一次 ?session= 拿到的 base 就只有 {cost, totalTokens, sessions}，
    // bySession 变成空表 —— 重算出的今日总额 = 当前会话一个桶（实测 ¥16 直接塌成 ¥3.2），
    // 而且这个虚低的数还带着「非 partial」身份被 ?today=1 当定型值发给客户端，
    // 要等 45 秒后一次全量重算才纠正回来。症状就是「打开时数字先小后大」。
    const bySession = {};
    if (parsed.bySession != null && typeof parsed.bySession === "object") {
      for (const [key, rec] of Object.entries(parsed.bySession)) {
        if (typeof key !== "string" || key === "") continue;
        if (rec == null || typeof rec !== "object") continue;
        // 键归一化（2026-11-01 审计 P0-3）：旧快照里可能同时存在 `session-<uuid>`
        // 和裸 `<uuid>` 两种写法，直接搬进内存就会让同一个会话算两遍。
        // 归一到裸 UUID 后若撞键，按「当天只增不减」取较大值合并。
        const nkey = sessionIdKey(key);
        if (nkey === "") continue;
        const c = Number(rec.cost);
        const t = Number(rec.totalTokens);
        const cost = Number.isFinite(c) && c >= 0 ? c : 0;
        const totalTokens = Number.isFinite(t) && t >= 0 ? t : 0;
        const prev = bySession[nkey];
        bySession[nkey] =
          prev == null
            ? { cost, totalTokens }
            : { cost: Math.max(prev.cost, cost), totalTokens: Math.max(prev.totalTokens, totalTokens) };
      }
    }
    return {
      date,
      cost: Number.isFinite(cost) && cost >= 0 ? cost : 0,
      totalTokens: Number.isFinite(totalTokens) && totalTokens >= 0 ? totalTokens : 0,
      sessions: Number.isFinite(Number(parsed.sessions)) ? Number(parsed.sessions) : 0,
      at: Number.isFinite(Number(parsed.at)) ? Number(parsed.at) : 0,
      bySession,
    };
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file, value) {
  if (file === "") return;
  const { mkdir, writeFile, rename } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(file), { recursive: true });
  // ⚠️ 临时名必须唯一（2026-10-31 第二十二轮审计）：固定 `.tmp` 时两次并发写会互相截断，
  // rename 也可能报 ENOENT。saveCalendarCache 早就改成唯一名了，这里跟上。
  const tmp = file + "." + process.pid + "." + Math.random().toString(36).slice(2) + ".tmp";
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

async function writeTodaySnapshot(file, snapshot) {
  // ⚠️ **增量结果绝不落盘**（`provisional` 由 updateTodayCostWithSession 打上）。
  // 增量是「旧基线 + 当前对话那一桶」的临时视图，比全量扫描多出一点（实测 +0.211），
  // 一旦写进快照，下次冷启动就会先显示这个虚高的数、随后被补拉的精算值「缩水」
  // （2026-10-31：「打开加载完显示17.几 下一秒变成16.几，而且每次打开还不一样」）。
  // 快照必须只由全量扫描（buildTodayCost）写入 —— 它是唯一权威口径。
  if (snapshot != null && typeof snapshot === "object" && snapshot.provisional === true) return;
  await writeJsonAtomic(file, snapshot);
}

/** 已结算的历史日消耗：{ "YYYY-MM-DD": { cost, totalTokens } }。
 *  只保留最近 STATS_DAYS 天，超出直接丢——统计弹窗最多就看 90 天。 */
async function readDailySettled(file) {
  if (file === "") return {};
  try {
    const { readFile } = await import("node:fs/promises");
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (parsed == null || typeof parsed !== "object") return {};
    const out = {};
    for (const [date, rec] of Object.entries(parsed)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (rec == null || typeof rec !== "object") continue;
      const cost = Number(rec.cost);
      const totalTokens = Number(rec.totalTokens);
      out[date] = {
        cost: Number.isFinite(cost) && cost >= 0 ? cost : 0,
        totalTokens: Number.isFinite(totalTokens) && totalTokens >= 0 ? totalTokens : 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

async function writeDailySettled(file, map) {
  const keep = new Set(recentDayKeys(STATS_DAYS));
  const pruned = {};
  for (const [date, rec] of Object.entries(map)) {
    if (keep.has(date)) pruned[date] = rec;
  }
  await writeJsonAtomic(file, pruned);
  return pruned;
}

/** 跨天清理：把昨天（及更早）的快照结算进 dailySettled，然后让今天的快照归零。
 *  按日期取**较大值**合并——统计本身会重扫会话算历史，若把快照值全额加进去
 *  就重复计数了；取 max 既保住「强制退出时还没落盘的那段增量」，又不会翻倍。
 *  @returns {Promise<{settled:boolean, date:string}>} */
async function settleStaleTodaySnapshot(ctx) {
  const snapshotFile = siblingFilePath(ctx, TODAY_SNAPSHOT_FILENAME);
  const settledFile = siblingFilePath(ctx, DAILY_SETTLED_FILENAME);
  if (snapshotFile === "") return { settled: false, date: "" };
  let raw = null;
  try {
    const { readFile } = await import("node:fs/promises");
    raw = JSON.parse(await readFile(snapshotFile, "utf8"));
  } catch {
    return { settled: false, date: "" }; // 没有快照 = 没什么可结算
  }
  const date = raw != null && typeof raw === "object" && typeof raw.date === "string" ? raw.date : "";
  if (date === "" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { settled: false, date: "" };
  // 口径版本不符的快照不许结算进历史（见 TODAY_SNAPSHOT_VERSION）：它可能是重复计费的脏数，
  // 一旦并进 balance-daily-settled.json 就永久污染那一天的统计。
  if (Number(raw.v ?? 1) !== TODAY_SNAPSHOT_VERSION) return { settled: false, date };
  const today = beijingDayKey();
  if (date === today) return { settled: false, date }; // 还是今天，不用结算
  const cost = Number(raw.cost);
  const totalTokens = Number(raw.totalTokens);
  const map = await readDailySettled(settledFile);
  const prev = map[date] ?? { cost: 0, totalTokens: 0 };
  map[date] = {
    cost: Math.max(prev.cost, Number.isFinite(cost) && cost > 0 ? cost : 0),
    totalTokens: Math.max(prev.totalTokens, Number.isFinite(totalTokens) && totalTokens > 0 ? totalTokens : 0),
  };
  // ⚠️ 写失败就不许删快照（2026-10-31 审计 L2）：原来 catch 完照删，
  // 那一份昨天（含强制退出前还没落盘的部分）就那么没了 —— 统计面板永远补不回来。
  // 留着它下次启动会再结算一次，重复结算由 writeDailySettled 的取较大值保证不会翻倍。
  try {
    await writeDailySettled(settledFile, map);
  } catch {
    // 结算写失败也不能挡住今天的显示，下次启动会再试；快照保留
    return { settled: false, date };
  }
  // 删掉旧快照，今天的从 0 重新累积（用户要求：第二天打开直接就是 0）
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(snapshotFile);
  } catch {
    // ignore
  }
  return { settled: true, date };
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
    // **JSON 坏了 / 读不动：绝不能静默降级成默认值然后把它写回去**（用户 2026-10-31：
    // 「这些设置保存到用户配置文件里，不要每次更新都改回去」）。原文件先另存一份
    // `.corrupt-<时间戳>`，调用方拿到 "corrupt" 后禁止自动写盘 —— 用户的配置留在磁盘上，
    // 任何时候都能找回，而不是被一份出厂默认值覆盖掉。
    try {
      const { rename } = await import("node:fs/promises");
      await rename(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      // 连改名都失败（权限/占用）：至少不让调用方写盘
    }
    return "corrupt";
  }
}

/** 写设置文件：先写临时文件再改名，避免写一半把配置写坏。
 *  写之前把上一份留成 `.bak` —— 任何一次写盘出问题，用户的配置都还在。 */
async function writeSettingsFile(file, settings) {
  if (file === "") throw new Error("无法定位 DeepSeek Harness 配置目录");
  const { mkdir, writeFile, rename, copyFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(file), { recursive: true });
  try {
    await copyFile(file, `${file}.bak`);
  } catch {
    // 首次写盘（还没有原文件）：没有可备份的东西，继续
  }
  // 唯一临时名：并发写（设置卡片连点保存）时固定 `.tmp` 会互相截断。
  const tmp = file + "." + process.pid + "." + Math.random().toString(36).slice(2) + ".tmp";
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
    // 客户端中途断开时既没有 end 也没有 error（2026-10-31 审计 L9）：
    // Promise 永不 settle，await 它的 handler 就一直挂着、连接和内存都不释放。
    req.on("close", () => reject(new Error("连接已关闭")));
  });
}

function beijingDayKey(timeMs = Date.now()) {
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
      // 按会话拆分（sessionId -> { cost, totalTokens }）：供「今日消耗」复用
      // ?session= 请求里已经解压好的事件、做实时刷新，避免为了某个会话再解一次。
      bySession: new Map(),
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

/** 把一笔费用记到「属于哪个会话」的桶，供「今日消耗」按会话拆分做实时刷新。
 *  没有 sessionId（老调用方）就跳过，不影响总额。
 *  ⚠️ 键一律走 `sessionIdKey()` 归一化成裸 UUID（2026-11-01 审计 P0-3）：
 *  全量扫描那条路径的 id 来自会话列表（新版是裸 UUID，旧版是 `session-<uuid>`），
 *  增量路径原来写的是 `session-<uuid>` —— 两种形态并存时同一个会话在表里占两个键，
 *  求和直接把它算两遍（实测 10.04 → 20.08）。 */
function addDaySessionCost(day, sessionId, cost, tokens) {
  const key = sessionIdKey(sessionId);
  if (key === "") return;
  let rec = day.bySession.get(key);
  if (rec == null) {
    rec = { cost: 0, totalTokens: 0 };
    day.bySession.set(key, rec);
  }
  rec.cost += cost;
  rec.totalTokens += tokens;
}

/** 增量结果的短期缓存：同一会话在 600 ms 内重复问，直接返回上次算好的结果。
 *
 *  `?session=` 每轮对话会被问**两次** —— 一次给 `resolveSessionModel` 解析模型、一次给
 * `fetchSessionUsage` 拉 usage，打的是同一个 URL。服务端没必要把整份
 * `collectDailyUsage`（对 40 MB 会话是好几遍全量事件遍历）跑两遍。600 ms 足够覆盖这两次
 * 请求的间隔，又短到用户感知不到「今日金额没跟上」。
 *
 *  Map 上限 64：今天动过的会话不可能比这多到离谱，超了直接整体丢弃（重建成本极低）。 */
const todayIncrementCache = new Map();
// 1500ms 是**实测标定值**（2026-10-31 审计 L8 核实）：模型解析和 usage 拉取打的是同一个 URL，
// 两趟之间通常差几百毫秒；早期注释里写的 600ms 会让第二趟必然落空、白跑一遍整会话遍历。
// 改这个值等于改「重复请求复用窗口」，属行为参数，别随手调。
const TODAY_INCREMENT_TTL_MS = 1500;

/** 用「单个会话的实时事件」增量更新今日消耗，**完全不扫描其他会话**。
 *
 *  用户 2026-10-31 明确要求：「本对话消耗只扫对应对话的，其他对话别扫描」。
 *  原来 `?session=` 会把 today 整份重算 —— 列一遍今天动过的所有会话、逐个遍历它们的
 *  事件数组。主会话 40 MB / 两万帧时，这一趟就是几百毫秒的同步 CPU；插件和 DSH 同进程，
 *  于是对话一推进界面就掉帧、聊天里的图片解码也跟着排队。
 *
 *  这里改成：其余会话的贡献**原样搬运**上一次算好的结果，只把当前会话那一桶换成刚算
 *  出来的值。复杂度从 O(今天所有会话的事件总数) 降到 O(当前会话的事件数)。
 *
 *  返回 null 表示「没法增量」（今天还没算过 / 快照是昨天的），调用方回退到完整路径 ——
 *  那种情况一天只发生一次（冷启动、刚跨天），代价可以接受。
 *
 *  @returns {Promise<object|null>} 与 buildTodayCost 同形状 */
async function updateTodayCostWithSession(ctx, config, state, sessionId, events) {
  if (typeof sessionId !== "string" || sessionId === "" || !Array.isArray(events)) return null;
  const now = Date.now();
  const todayKey = beijingDayKey(now);
  // ⚠️ **键必须和全量扫描那条路径同一个口径**（2026-11-01 审计 P0-3）。
  // 原来这里写 `session-<uuid>`、全量扫描写列表原样 id（新版 DSH 是裸 UUID），
  // 两种形态并存 → 同一会话在 bySession 里占两个键 → 求和算两遍（实测 10.04 → 20.08）。
  // 现在两条路径都走 sessionIdKey()（裸 UUID），旧快照在 readTodaySnapshot 里也一并归一化。
  const sessionKey = sessionIdKey(sessionId);
  if (sessionKey === "") return null;
  const base = state.cache.value ?? (await readTodaySnapshot(state.snapshotFile));
  if (base == null || base.date !== todayKey) return null;
  // 基线里没有 bySession 就**根本没有增量可言**：下面那套「其余会话原样搬运」全靠它，
  // 空表算出来的总额只剩当前会话一个桶，是个远低于真实值的假数。
  // 旧版本写下的快照就长这样（readTodaySnapshot 以前不还原这个字段），所以这里必须挡一道，
  // 让它返回 null 回退到完整重算 —— 一天只多算一次，比显示一个错数字便宜得多。
  // ⚠️ 空表也必须挡（2026-10-31 审计 NEW-1）：上面 readTodaySnapshot 现在
  // **无条件**构造 bySession = {}，而 {} 是 object，只判类型的闸门永远不会触发 ——
  // 旧版快照（没有这个字段）就会被当成合法基线，增量把空表当基线去搬运，
  // 今日总额塌成只剩当前会话一个桶（就是注释里那个 16 元塌成 3.2）。
  // 还会被当成非 partial 发给客户端，于是「打开时先小后大」换个入口又复发。
  if (base.bySession == null || typeof base.bySession !== "object") return null;
  if (Object.keys(base.bySession).length === 0) return null;
  // 同一会话 600 ms 内重复问（模型解析 + usage 拉取打的是同一个 URL）直接复用上次结果，
  // 省掉一遍整会话事件遍历。必须在 collectDailyUsage 之前短路，否则等于没省。
  const cachedIncrement = todayIncrementCache.get(sessionKey);
  // 缓存必须绑定基线对象本身（2026-10-31 审计 M1）：
  // 快照回填 / 全量重算会把 state.cache.value 换成另一个对象，
  // 标准只看 TTL 的话，这 1.5 秒内仍会返回按旧基线算的整份总额，今日数字往回跳一下。
  // 用引用相等做版本戳最廉价。
  if (cachedIncrement != null && cachedIncrement.base === base && now - cachedIncrement.at < TODAY_INCREMENT_TTL_MS) {
    return cachedIncrement.value;
  }
  const local = new Map();
  collectDailyUsage(
    events,
    config,
    detectModel({ requestHeader: () => void 0, requestContext: () => void 0, events }),
    beijingDayStart(now),
    local,
    sessionId,
  );
  // 取本地这一桶也必须用归一化键（addDaySessionCost 内部也是归一化后写的）
  const localRec = local.get(todayKey)?.bySession?.get(sessionKey);
  const bySession = { ...(base.bySession ?? {}) };
  // ⚠️ 桶只能往大走（2026-10-31 第二十二轮审计）：`events` 可能是被
  // SESSION_REREAD_MIN_MS 节流后的**旧数组**（`?session=` 4 秒内复用上一份），
  // 直接覆盖会让今日金额往回跳（实测 0.168 → 0.112），而且这个较小的 provisional
  // 值还会写进 state.cache.value。当天消耗只增不减，取较大者即可。
  const prevRec = bySession[sessionKey];
  const nextCost = Number(localRec?.cost ?? 0);
  const nextTokens = Number(localRec?.totalTokens ?? 0);
  bySession[sessionKey] = {
    cost: Math.max(Number(prevRec?.cost ?? 0), nextCost),
    totalTokens: Math.max(Number(prevRec?.totalTokens ?? 0), nextTokens),
  };
  let cost = 0;
  let totalTokens = 0;
  let sessions = 0;
  for (const rec of Object.values(bySession)) {
    cost += Number(rec?.cost ?? 0);
    totalTokens += Number(rec?.totalTokens ?? 0);
    sessions += 1;
  }
  const value = { date: todayKey, cost, totalTokens, sessions, bySession, provisional: true };
  // 只更新值、不动过期时间：增量的可信度取决于基线，基线多旧它就多旧。
  // 让原来的 staleMs 正常触发一次完整重算，把其他会话的过时数字纠正回来。
  state.cache.value = value;
  if (todayIncrementCache.size >= 64) todayIncrementCache.clear();
  todayIncrementCache.set(sessionKey, { at: now, base, value });
  return value;
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
    // ⚠️ 完成时刻缺失时也必须回退到「现在」，不能回退 0（2026-11-01 审计 P1-3）：
    // `?? Number(event.time ?? 0)` 会得到 1970 年，被下面的 cutoffMs 一刀滤掉 ——
    // 同一份事件在 sumEventsUsage 里（那里回退 Date.now()）算得出钱、今日却算 0。
    latestByStep.set(`${turn}/${step}`, {
      usage,
      time: starts.get(`${turn}/${step}`) ?? Number(event.time ?? Date.now()),
    });
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
          addDaySessionCost(day, sessionId, WEB_TOOL_PRICE_PER_CALL, 0);
        }
      } else {
        day.webFetchCalls += 1;
        if (billable) {
          day.webFetchBillable += 1;
          day.webFetchCost += WEB_TOOL_PRICE_PER_CALL;
          day.cost += WEB_TOOL_PRICE_PER_CALL;
          addDaySessionCost(day, sessionId, WEB_TOOL_PRICE_PER_CALL, 0);
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
    addDaySessionCost(day, sessionId, stepCost, tokens);

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
 *  与 buildUsageStats 的区别：只扫 updatedAt 落在今天的会话，通常只有几个。
 *  @param {{ sessionId?: string, events?: unknown[] }} [reuse] 调用方已持有的会话事件，
 *         命中时不再为它解压一遍（?session= 请求靠这个实现「零额外成本」的实时刷新）。
 *  @returns {Promise<{ cost:number, totalTokens:number, sessions:number, bySession:object }>} */
async function buildTodayCost(ctx, config, reuse = null) {
  const getService = typeof ctx.get === "function" ? ctx.get.bind(ctx) : null;
  const controller = getService?.("sessionController");
  const persistence = getService?.("sessionPersistence");
  const now = Date.now();
  const dayStart = beijingDayStart(now);
  const todayKey = beijingDayKey(now);
  // ⚠️ 会话时间戳单位不保证是毫秒（2026-10-31：「怎么变成0了」）。
  // `controller.list()` 的 updatedAt 有可能是**秒**，而 dayStart 是毫秒 ——
  // `x.at >= dayStart` 就永远为假，今天动过的会话被整批滤掉，daily 为空，
  // 于是算出 cost:0 并把 0 落进快照，界面显示 ¥0.0000。
  // stats 那条路径只拿 sessionId、不比较时间，所以它一直是好的
  // （实测同刻 stats 里 10-31 有 15.13），这就是当时唯一的差异点。
  // 归一化：小于 1e11 的一律当秒。1e11 ms ≈ 1973 年，1e11 s 远在未来，分界安全。
  const toMs = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n < 1e11 ? n * 1000 : n;
  };
  // 只挑今天动过的会话
  let candidates = [];
  let listedCount = 0;
  if (typeof controller?.list === "function") {
    const listed = await controller.list({});
    const items = Array.isArray(listed) ? listed : (listed?.items ?? []);
    listedCount = items.length;
    candidates = items
      .map((item) => (item && typeof item === "object" ? { id: item.sessionId ?? item.id, at: toMs(item.updatedAt ?? item.createdAt ?? 0) } : null))
      .filter((x) => x && typeof x.id === "string" && x.id !== "");
    // list() 已按活动降序；万一没有 updatedAt 字段就保守全扫（上限 TODAY_MAX_SESSIONS）。
    // ⚠️ 没有时间戳（at === 0）的会话**不许被过滤掉**（2026-10-31 全量审查）：
    // 只要列表里有一部分带时间戳，t >= dayStart 就会把 at=0 的那批整批丢掉 ——
    // 而「今天真的用过它」完全可能，症状就是今日金额系统性偏低。
    // 保留它们不会造成多算：collectDailyUsage 内部按每条事件的时刻和 dayStart 比，
    // 老会话的旧事件自然贡献 0，代价只是多读一份文件。
    if (candidates.some((x) => x.at > 0)) {
      candidates = candidates.filter((x) => x.at >= dayStart || !(x.at > 0));
    }
  } else if (typeof persistence?.list === "function") {
    const headers = await persistence.list();
    const list = Array.isArray(headers) ? headers : [];
    listedCount = list.length;
    candidates = list
      .map((h) => (h && typeof h.id === "string" ? { id: h.id, at: toMs(h.updatedAt ?? h.createdAt ?? 0) } : null))
      .filter(Boolean);
    // 同上：at === 0（无时间戳）的会话保留，别被 at >= dayStart 整批滤掉。
    if (candidates.some((x) => x.at > 0)) {
      candidates = candidates.filter((x) => x.at >= dayStart || !(x.at > 0));
    }
  } else {
    throw new Error("会话持久化服务不可用");
  }
  // 有会话但今天一个都没筛出来时，**不许**把 0 写进快照：
  // 这既可能是真的今天还没用（合法 0），也可能是时间戳口径又变了（假 0）。
  // 假的 0 一旦落盘会被 readTodaySnapshot 认成"今天的值"，界面就一直显示 ¥0.0000，
  // 而且后台重算只要继续踩同一个坑就永远修不回来。所以这种情况宁可不落盘，
  // 让下次冷启动重新现算。
  const suspiciousEmpty = listedCount > 0 && candidates.length === 0;  const selected = candidates
    // 今日用自己的上限（默认 200），不再跟统计面板的 80 绑在一起 —— 见 TODAY_MAX_SESSIONS。
    .slice(0, clampNumber(config?.todaySessionLimit, 10, 2000, TODAY_MAX_SESSIONS))
    .map((x) => x.id);
  // reuse：调用方（?session= 请求）手里已经持有某个会话的完整 events，
  // 别再为它解压一遍 —— 那正是「今日消耗实时刷新」的成本来源。
  const reuseId = typeof reuse?.sessionId === "string" ? reuse.sessionId : "";
  const reuseEvents = Array.isArray(reuse?.events) ? reuse.events : null;
  // ⚠️ 必须按**归一化键**比较（2026-10-31 审计 M3）：list() 给的是带 session- 前缀的 id，
  // 而 reuseId 是客户端传来的裸 UUID —— 直接 includes 永远为 false，同一个会话被 unshift 第二份，
  // 一份读盘、一份 reuse，金额双算而且会被写进快照。
  const reuseKey = reuseId === "" ? "" : sessionIdKey(reuseId);
  if (
    reuseId !== "" &&
    reuseEvents !== null &&
    !selected.some((id) => sessionIdKey(id) === reuseKey)
  ) {
    selected.unshift(reuseId);
  }
  const daily = new Map();
  let cursor = 0;
  // 成功读到事件的会话数（2026-10-31 第二十二轮审计）。⚠️ 原来只要「候选非空」就当正常，
  // 而候选是按 list() 的 updatedAt 筛出来的、跟"读不读得出来"无关 —— 所有会话的 inspect
  // 都抛错时 cost 会是 0，却带着新鲜 at 落盘，界面长期 ¥0.0000（被当成今天的定型值）。
  let okCount = 0;
  const worker = async () => {
    while (cursor < selected.length) {
      const sessionId = selected[cursor++];
      try {
        const inspected =
          reuseId !== "" && sessionIdKey(sessionId) === reuseKey && reuseEvents !== null
            ? null
            : await inspectPersistedCached(ctx, sessionId);
        const rawEvents =
          inspected === null ? reuseEvents : (inspected?.events ?? []);
        // ⚠️ 今日是**按会话逐个累加**的：fork 子会话日志里那整段继承前缀（保留源时间戳）
        // 会被当成「今天发生的事」再算一遍，父会话的历史就从今天凭空多出一截。
        // 与 sumSubagentUsage 同一套切法（ownEventsOf）。
        const events = ownEventsOf(inspected?.meta ?? reuse?.meta, rawEvents ?? []);
        collectDailyUsage(
          events,
          config,
          detectModel({ requestHeader: () => void 0, requestContext: () => void 0, events }),
          dayStart,
          daily,
          sessionId,
        );
        okCount += 1;
      } catch {
        // 单个会话读不出来不影响总额
      }
      // 每读完一个就让出一次主线程：单会话解压实测 723 ms 且是同步 CPU，
      // 连着读几个会把 Node 主线程占死 —— 和 DSH 同进程，界面就掉帧。
      // 让出之后余额/指针/动效都还能跑，只是总额晚几百毫秒到。
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  // 并发度回到 3。**不要改成 1**：串行化会让「A 还没解压完就点 B」变成严格排队 ——
  // B 的请求要等 A 的同步解压整段跑完才能开始，用户体感就是「两个对话一起卡住」。
  // 单线程下并发不会更快，但能让不同会话的解压机会**交错**，切会话时不必等前一个走完。
  // 真正的阻塞控制靠下面每会话解压之后的 setImmediate 让出。
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, () => worker()));
  const day = daily.get(todayKey);  // bySession 摊平成普通对象：快照要能 JSON 序列化，Map 存不了。
  const bySession = {};
  if (day?.bySession != null) {
    for (const [id, rec] of day.bySession) bySession[id] = { cost: rec.cost, totalTokens: rec.totalTokens };
  }
  return {
    date: todayKey,
    cost: day?.cost ?? 0,
    totalTokens: day?.totalTokens ?? 0,
    sessions: day?.sessionIds?.size ?? 0,
    bySession,
    // 只给 computeAndStoreToday 用（决定要不要落盘），客户端不读这个字段。
    // ⚠️ 除了「候选被筛空」，还要判「一个会话都没读成功」（2026-10-31 第二十二轮审计）：
    // list() 正常、每个 inspect 都抛错时 candidates 非空、cost 却是 0 —— 那种 0 是假的，
    // 带着新鲜 at 落盘就会长期显示 ¥0.0000。
    suspiciousEmpty: suspiciousEmpty || (listedCount > 0 && okCount === 0),
  };
}

/** 真算一次今日消耗，并把结果落盘成快照。
 *  快照是「下次启动秒开」的全部依据，所以每次算完都要写；
 *  写失败（目录只读等）只影响下次启动会不会卡，不影响这一次的结果。 */
async function computeAndStoreToday(ctx, config, state, reuse = null) {
  const value = await buildTodayCost(ctx, config, reuse);
  // ⚠️ 可疑的空结果**不落盘**（见 buildTodayCost 里 suspiciousEmpty 的注释）。
  // 真的今天还没用过（0）明天也会被跨天结算清掉，代价只是下次冷启动多算一遍；
  // 而假的 0 一旦落盘会被当成"今天的值"长期显示 ¥0.0000，重算若继续踩同一个坑
  // 就永远修不回来 —— 两害相权，宁可不写。
  const snapshot = value.suspiciousEmpty
    ? { ...value, v: TODAY_SNAPSHOT_VERSION, at: 0 }
    : { ...value, v: TODAY_SNAPSHOT_VERSION, at: Date.now() };
  try {
    if (!value.suspiciousEmpty) {
      // ⚠️ 写今天这份之前，先把昨天那份结算进 balance-daily-settled.json
      // （2026-10-31 第二十二轮审计）：结算原来只在 apply 的启动块里跑一次，
      // 桌面端常驻不重启、跨过北京时间 0 点后，昨天快照的收尾部分会被今天这份直接覆盖，
      // 统计里昨天就少一截。这里是"即将覆盖"的唯一位置，放这里天然只多一次小 JSON 读。
      try {
        await settleStaleTodaySnapshot(ctx);
      } catch {
        // 结算失败不影响今天的数字
      }
      await writeTodaySnapshot(state.snapshotFile, snapshot);
    }
  } catch {
    // 落盘失败：当作只有内存缓存，下次启动再算一遍
  }
  // 内存里也把 at 归零，让上层把这次结果当"不新鲜"：不写盘 + 立即允许重算，
  // 而不是拿着假 0 缓存 45 秒。
  return snapshot;
}

/** 后台重算（单飞）：同一时刻只跑一个，避免轮询把解压任务叠罗汉。 */
function scheduleTodayRecompute(ctx, config, state) {
  if (state.recompute !== null) return;
  state.recompute = (async () => {
    try {
      const snapshot = await computeAndStoreToday(ctx, config, state);
      state.cache.value = snapshot;
      // 可疑空结果（有会话但今天一个都没筛出来）**不许被缓存满 staleMs**：
      // 落盘那边已经用 at:0 表达了不新鲜，内存里必须跟着立即允许重算，
      // 否则界面会拿着一个可疑的 0 硬撑 45 秒（2026-10-31 全量审查）。
      state.cache.expiresAt = snapshot.suspiciousEmpty === true ? 0 : Date.now() + state.staleMs;
      // 全量重算换了基线，增量缓存里的旧值全部作废 —— 否则同一会话在 TTL 内
      // 会拿「按旧基线算的增量」覆盖新结果（2026-10-31 全量审查）。
      todayIncrementCache.clear();
    } catch {
      // 后台失败不打扰任何人：界面上继续显示旧快照
    } finally {
      state.recompute = null;
    }
  })();
}

/** 「今日消耗」对外入口 —— 快照优先，现算兜底。
 *
 *  分层顺序（越靠前越快）：
 *    ① 内存缓存新鲜  → 直接给，partial=false
 *    ② 落盘快照      → 直接给，同时后台重算（这是消除冷启动卡顿的那一步）
 *    ③ 现算          → 只在「首次安装」「刚跨天」「快照文件损坏」时走到这里
 *
 *  `partial=true` 表示「这是旧值，后台正在算新的」，客户端会隔几秒再问一次。
 *  @returns {Promise<{value:object|null, partial:boolean}>} */
async function resolveTodayCost(ctx, config, state, reuse = null) {
  const now = Date.now();
  // 带了 reuse（?session= 场景）就**强制重算**：当前会话的事件已经在手上，
  // 其余今天动过的会话指纹没变、直接命中持久化缓存 —— 于是这次重算是纯计算、
  // 零额外磁盘开销，正好用来做「今日消耗实时刷新」。走缓存反而会拿到旧值。
  if (reuse === null) {
    // ⚠️ provisional（增量算出来的不精确值）**不能当定型值命中缓存**（2026-10-31 审计 M2）：
    // ?session= 把它写进 state.cache.value 后，45 秒内的 ?today=1 会命中它、
    // 带着 partial=false 发回去，客户端于是 settled=true 压 20 秒不补拉，
    // 数字就锁在一个不精确值上。
    if (state.cache.value != null && state.cache.expiresAt > now && state.cache.value.provisional !== true) {
      return { value: state.cache.value, partial: state.recompute !== null };
    }
    const snapshot = await readTodaySnapshot(state.snapshotFile);
    if (snapshot != null) {
      // ⚠️ 增量值（provisional）可能**比快照大**（快照是几十秒前算的），直接拿快照覆盖
      // 会让今日金额往回跳、而且带着 partial=false 让客户端不再补拉，锁死在旧值上
      // （2026-10-31 第二十二轮审计：实测 17.3 → 16.0）。取较大者，并强制 partial=true
      // 让客户端继续补拉、后台重算把真值补上。
      const prev = state.cache.value;
      const keepPrev = prev != null && prev.provisional === true
        && Number(prev.cost ?? 0) > Number(snapshot.cost ?? 0);
      const chosen = keepPrev ? prev : snapshot;
      const forcedPartial = keepPrev;
      state.cache.value = chosen;
      const age = chosen.at > 0 ? now - chosen.at : Number.POSITIVE_INFINITY;
      const fresh = age < state.staleMs;
      state.cache.expiresAt = now + (fresh && !forcedPartial ? state.staleMs - age : 3000);
      if (!fresh || forcedPartial) scheduleTodayRecompute(ctx, config, state);
      return { value: chosen, partial: !fresh || forcedPartial };
    }
  }
  // 快照不可用 / 带了 reuse：现算。reuse 路径算完同样落盘，下一次冷启动照样秒开。
  const value = await computeAndStoreToday(ctx, config, state, reuse);
  // 同 scheduleTodayRecompute：可疑空结果立即允许重算，别缓存满 staleMs。
  state.cache = {
    value,
    expiresAt: value.suspiciousEmpty === true ? 0 : Date.now() + state.staleMs,
  };
  todayIncrementCache.clear();
  // 可疑空结果必须如实标 partial（2026-10-31 审计 M4）：硬写 false 客户端就不补拉，
  // 一个可疑的 0 就真的长期显示下去了。
  return { value, partial: value.suspiciousEmpty === true };
}


async function buildUsageStats(ctx, config) {
  const getService = typeof ctx.get === "function" ? ctx.get.bind(ctx) : null;
  const controller = getService?.("sessionController");
  const persistence = getService?.("sessionPersistence");
  const now = Date.now();
  // ⚠️ 要跟**自然日**对齐（2026-10-31 审计 L6）：
  // now - 89 天 = 今天的同一时刻，而统计是按北京自然日分行的，
  // 于是第 90 行只算到「当天此刻为止」，比其余 89 天少一截，看起来像那天特别省。
  // 改成「今天 0 点往前推 89 个整天」，窗口正好覆盖 90 个完整自然日。
  const cutoffMs = beijingDayStart(now) - (STATS_DAYS - 1) * 24 * 60 * 60 * 1000;
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
        const inspected = await inspectPersistedCached(ctx, sessionId);
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
      // 同 buildTodayCost：统计要扫几十个会话，每个解压 700 ms，必须逐个让出，
      // 否则打开统计面板那一下整页都会卡住。
      await new Promise((resolve) => setImmediate(resolve));
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
        // ⚠️ 这 7 个 web* 键一个都不能少（2026-10-31 审计 L1）：
        // 下面汇总时是 acc.webSearchCalls += day.webSearchCalls，0 + undefined = NaN，
        // JSON.stringify 把 NaN 写成 null，客户端 num() 又把它吃成 0 ——
        // 于是「网页工具」90 天汇总恒为 0，而实际天天在用。
        webSearchCalls: 0,
        webFetchCalls: 0,
        webSearchBillable: 0,
        webFetchBillable: 0,
        webSearchCost: 0,
        webFetchCost: 0,
        webToolCost: 0,
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
  // ── 已结算的历史日（跨天时从「今日快照」转存下来的，见 settleStaleTodaySnapshot）──
  // 统计本身会重扫会话算历史，所以这里按**较大值**合并、且只补差额：
  // 快照可能含「强制退出时还没落盘的那段 usage」，那是快照独有的；
  // 但若重扫已经算得更多（会话最终落盘了），就以重扫为准，绝不重复计数。
  // 差额记进「空闲」桶 —— 快照没留时段明细，按低峰价补是最保守的取整，
  // 并且能保住 peakCost + offpeakCost + webToolCost === cost 这个不变量。
  // token 分项不动：改了会让「各分项之和 === totalTokens」也对不上。
  const settledDaily = await readDailySettled(siblingFilePath(ctx, DAILY_SETTLED_FILENAME));
  if (Object.keys(settledDaily).length > 0) {
    for (const row of rows) {
      const rec = settledDaily[row.date];
      if (rec == null) continue;
      const extra = rec.cost - row.cost;
      if (!(extra > 1e-7)) continue;
      row.cost += extra;
      row.offpeakCost += extra;
    }
  }

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

/** 会话 id 归一化：客户端传的是裸 UUID（DSH 的 sessionId prop），
 *  会话列表摘要和持久化目录用的是 `session-<uuid>`。比较父子关系前必须先抹平，
 *  否则同一棵树永远匹配不上（这正是「子代理一直是 0 个」的一半原因）。 */
function sessionIdKey(id) {
  if (typeof id !== "string" || id === "") return "";
  return id.startsWith("session-") ? id.slice("session-".length) : id;
}

/** 切出「这个会话自己的事件」，丢掉 seeded（fork / resume）日志里整段继承的前缀。
 *
 *  为什么必须切：`buildForkSeed` 把源会话的事件 **slice 整段复制**进子会话日志，
 *  时间戳原样保留。fork 队友（智能体团队 context:"fork"、`subagent_fork`）都是这种。
 *  不切就会把父会话的历史**再算一遍** —— 子会话自己那一份是「本会话消耗」翻倍，
 *  而今日 / 统计是**按会话逐个累加**的，父 + 子两条日志各算一次 = 今天凭空多出一截钱。
 *
 *  切点优先用权威标记：`session/end-seed` 事件（语义是「之前都是种子，之后才属于我」），
 *  它之后的第一个事件就是自己的。没有这个标记时退回时间比较：seeded 会话的 createdAt
 *  晚于全部继承事件，所以 `ev.time >= header.createdAt` 就是自己产生的事件。
 *  非 seeded 会话原样返回（绝大多数会话走这条，零开销）。 */
function ownEventsOf(header, events) {
  if (!Array.isArray(events) || events.length === 0) return [];
  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    if (ev != null && ev.type === "session/end-seed") return events.slice(i + 1);
  }
  if (header?.isSeeded === true && typeof header.createdAt === "number") {
    return events.filter((ev) => ev != null && (typeof ev.time !== "number" || ev.time >= header.createdAt));
  }
  return events;
}

/** 列出全部会话并带上父子关系（跨 DSH 版本）。
 *  @returns {Promise<Array<{id:string,parentId:string,origin:string}>>}
 *
 *  这是枚举子代理的**主要**依据，不是备用方案。DSH 的 sessionController.list() 每个
 *  摘要都经过 listFields(header)，里面会带出 parentSessionId / origin；旧版
 *  sessionPersistence.list() 通常没有这两项，那就只能退回 subagents 服务那条路。 */
async function listSessionRows(ctx) {
  const getService = typeof ctx.get === "function" ? ctx.get.bind(ctx) : null;
  const rows = [];
  const push = (id, parentId, origin) => {
    if (typeof id !== "string" || id === "") return;
    rows.push({
      id,
      parentId: typeof parentId === "string" ? parentId : "",
      origin: typeof origin === "string" ? origin : "",
    });
  };
  const controller = getService?.("sessionController");
  if (typeof controller?.list === "function") {
    try {
      const listed = await controller.list({});
      const items = Array.isArray(listed) ? listed : (listed?.items ?? []);
      for (const item of items) {
        if (item == null || typeof item !== "object") continue;
        push(item.sessionId ?? item.id, item.parentSessionId ?? item.parentSession, item.origin);
      }
      if (rows.length > 0) return rows;
    } catch {
      /* 新版列不出来就试旧版 */
    }
  }
  const persistence = getService?.("sessionPersistence");
  if (typeof persistence?.list === "function") {
    try {
      const headers = await persistence.list();
      for (const h of Array.isArray(headers) ? headers : []) {
        if (h == null || typeof h !== "object") continue;
        push(h.id ?? h.sessionId, h.parentSession ?? h.parentSessionId, h.origin);
      }
    } catch {
      /* 两套都不可用就是没有 */
    }
  }
  return rows;
}

/** 汇总某会话的所有子代理后代会话的 usage（跨时段精确计费，与主会话分开）。
 *  @param ctx DSH 上下文（用于 subagents 服务 + 跨版本持久化会话读取）
 *  @param sessionId 父会话 id
 *  @param config 插件配置
 *
 *  两条枚举路径，缺一条就会在某种 DSH 版本上永远拿到 0：
 *   ① subagents.listDescendants —— 官方口径，但它内部要求 sessions + sessionQuery +
 *      subagentCatalog 投影三个同时在线，任何一个缺失就抛 SubagentError。原来的实现
 *      直接 `catch { descendants = [] }`，于是**这条唯一路径一失败就等于「没有子代理」**，
 *      面板上那两行永远不出现，而且没有任何日志（2026-10-31：「把子智能体的消费也算上」）。
 *   ② 会话列表摘要里的 parentSessionId —— 不依赖任何投影，只要有 sessionController.list()
 *      就能建出父子图。子代理还能再派子代理，所以按层展开而不是只看直接子级。
 *  两条取并集：服务可用时多一层保险，服务不可用（实测就是这种）时②独立成立。 */
async function sumSubagentUsage(ctx, sessionId, config) {
  if (ctx == null || sessionId === "") return { usage: null };
  const rootKey = sessionIdKey(sessionId);
  const childIds = new Set();
  const seenKeys = new Set([rootKey]);
  let source = "none";

  // 路径①：官方服务（可空探测，缺失不影响下面）
  const subagentsSvc = typeof ctx.get === "function" ? ctx.get("subagents") : void 0;
  const listDescendants =
    subagentsSvc != null && typeof subagentsSvc.listDescendants === "function"
      ? subagentsSvc.listDescendants.bind(subagentsSvc)
      : void 0;
  if (listDescendants != null) {
    try {
      const descendants = await listDescendants(sessionId);
      for (const e of Array.isArray(descendants) ? descendants : []) {
        if (e == null || typeof e !== "object") continue;
        if (typeof e.id !== "string" || e.id === "") continue;
        const key = sessionIdKey(e.id);
        if (key === "" || seenKeys.has(key)) continue;
        seenKeys.add(key);
        childIds.add(e.id);
      }
      if (childIds.size > 0) source = "service";
    } catch {
      /* 投影不全时它必抛；不是错误，走路径② */
    }
  }

  // 路径②：从会话摘要的 parentSessionId 建父子图，逐层展开
  try {
    const rows = await listSessionRows(ctx);
    const byParent = new Map();
    for (const row of rows) {
      const parentKey = sessionIdKey(row.parentId);
      if (parentKey === "") continue;
      if (!byParent.has(parentKey)) byParent.set(parentKey, []);
      byParent.get(parentKey).push(row.id);
    }
    let frontier = [rootKey];
    while (frontier.length > 0) {
      const next = [];
      for (const parentKey of frontier) {
        for (const childId of byParent.get(parentKey) ?? []) {
          const key = sessionIdKey(childId);
          if (key === "" || seenKeys.has(key)) continue;
          seenKeys.add(key);
          childIds.add(childId);
          next.push(key);
        }
      }
      frontier = next;
    }
    if (childIds.size > 0 && source === "none") source = "catalog";
  } catch {
    /* 列不出来就当没有子代理 */
  }

  if (childIds.size === 0) return { usage: null, debug: { source } };

  // 2) 对每个子代理读取持久化事件并求和
  const empty = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  const peak = empty();
  const offpeak = empty();
  const byModelMap = new Map(); // model -> { model, peak, offpeak }
  let count = 0;
  // ⚠️ 网页工具费与图片张数必须一起搬出去（2026-11-01 审计 P0-2）。
  // 原来出口只搬 token 和 byModel：子代理若只调了 search/fetch、没产生 token，
  // `totalTokens` 是 0，客户端 `hasSubagent` 判假、整行不显示，而今日却算了那 ¥0.005/次
  // —— 用户看到的就是「今日 ¥10.045 / 消耗行 ¥10.040」永远差一个网页工具费，
  // 且子代理越多差得越多。sumEventsUsage 早就返回这些字段（lib/index.js:1661 ...webTools），
  // 是这里把它们丢了。
  const web = { webSearchCalls: 0, webFetchCalls: 0, webSearchBillable: 0, webFetchBillable: 0, webToolCost: 0 };
  let imageCount = 0;
  // 每个子会话自己的费用（含智能体团队的 teammate）：出口一并返回，
  // 团队区按人头展示就靠它。普通 subagent / workflow 子代理也在这张表里，不额外开销。
  const children = [];
  // 上限：子代理会话虽然通常比主会话小，但这里是每轮 ?session= 都会跑的路径，
  // 一个会开很多子代理的长对话要防止它变成几百次串行解压（主线程同步 CPU）。
  const scanIds = [...childIds].slice(0, SUBAGENT_MAX_SESSIONS);
  for (const id of scanIds) {
    try {
      // ⚠️ 必须带 minIntervalMs（2026-11-01 审计 P1）：这条循环在**每轮 `?session=`**
      // 都会跑（流式输出时约 600ms 一次），而活着的队友每写一条 `updatedAt` 就变，
      // 只看指纹等于每 600ms 把每个活跃子会话的 zstd 完整解压一遍（fork 队友的日志
      // 就是父会话全量副本，几十 MB / 几百 ms 同步 CPU）。插件与 DSH 同进程 ——
      // 表现就是「开着团队干活时整页发卡」。节流到 SESSION_REREAD_MIN_MS 后
      // 最多每 4 秒重读一次，数字最多晚 4 秒（补拉本来就是 15 秒一轮）。
      const inspected = await inspectPersistedCached(ctx, id, SESSION_REREAD_MIN_MS);
      const events = Array.isArray(inspected?.events) ? inspected.events : [];
      // ⚠️ fork 出来的子会话（智能体团队的 context:"fork" 队友、subagent_fork）**整段继承
      // 了父会话的事件前缀**（buildForkSeed 直接把源事件 slice 复制进新日志），
      // 原样求和等于把父会话的历史再算一遍 —— 一个 fork 队友就能让「本会话消耗」翻倍。
      // 切法见 ownEventsOf（优先 session/end-seed 下标，退化为 createdAt 时间比较）。
      const ownEvents = ownEventsOf(inspected?.meta, events);
      const u = sumEventsUsage(ownEvents, config);
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
      // 网页工具费按「次数 × 单价」逐段累加，绝不乘峰谷倍率（与服务端主链路同一口径）
      web.webSearchCalls += Number(u.webSearchCalls ?? 0);
      web.webFetchCalls += Number(u.webFetchCalls ?? 0);
      web.webSearchBillable += Number(u.webSearchBillable ?? 0);
      web.webFetchBillable += Number(u.webFetchBillable ?? 0);
      web.webToolCost += Number(u.webToolCost ?? 0);
      imageCount += Number(u.imageCount ?? 0);
      // 每个子会话单独的费用：口径与客户端 computeSplitCost 一致（各模型桶求和 + 网页工具费，
      // 后者按次计费、不乘峰谷）。智能体团队按人头展示就靠这张表。
      {
        const peakFactor = peakMultiplierOf(config);
        let childCost = Number(u.webToolCost ?? 0) || 0;
        for (const b of u.byModel ?? []) {
          childCost += estimateCost(b, catalogPricing(config, b.model, b.era), peakFactor);
        }
        children.push({
          sessionId: id,
          tokens: Number(u.totalTokens ?? 0) || 0,
          cost: childCost,
        });
      }
      // 子代理也可能换模型，按模型同样分桶聚合。
      // ⚠️ 键必须带 era（2026-10-31 审计 L5）：出口处是按
      // estimateCost(b, catalogPricing(config, b.model, b.era), ...) 算钱的，
      // 原来只按 model 分桶、桶里没有 era → b.era 恒 undefined → 一律用**当前**价。
      // 于是跨过调价点的老子代理用量被按新价重算（旧价贵 50%，方向是低估），
      // 而且同一个 model 在新旧两段被并成一桶，「各模型之和 = 总额」当场破。
      for (const b of u.byModel ?? []) {
        const bucketKey = b.model + "\u0000" + (b.era ?? "");
        let be = byModelMap.get(bucketKey);
        if (!be) {
          be = { model: b.model, era: b.era, peak: empty(), offpeak: empty() };
          byModelMap.set(bucketKey, be);
        }
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
    // 每个会话后让出主线程：插件和 DSH 同进程，连着解压十几个会把 UI 卡住
    await new Promise((resolve) => {
      if (typeof setImmediate === "function") setImmediate(resolve);
      else setTimeout(resolve, 0);
    });
  }
  if (count === 0) return { usage: null, debug: { source, scanned: scanIds.length, counted: 0 } };
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
    // 出口补齐网页工具费 / 张数（客户端 computeSplitCost 会把它加进金额）
    ...web,
    imageCount,
    sessions: count,
  };
  return { usage, children, debug: { source, scanned: scanIds.length, counted: count } };
}

/**
 * 从会话事件里解出智能体团队（Agent Teams）的 roster。
 *
 * 为什么读事件而不是读 ctx.agentTeams / agentTeam 投影：
 *   ① roster 的权威来源就是本会话自己落的 `team/member` 事件（持久化投影也是从它 fold 出来的），
 *      事件在任何环境下都拿得到，服务和投影则可能没启用；
 *   ② DSH 内部 API 无兼容承诺（AGENTS 铁律 1），少一个必须存在的服务就少一处崩溃面。
 *
 * 事件形状（@deepseek-ai/dsh-experimental-agent-team，会随版本变，所以字段全用可空读）：
 *   { type: "team/member", data: { version: 2, teamId, member: { id, name, description, provider, context, phase, error? } } }
 * 同一个 member 会因 phase 变化重复出现 —— 后写的覆盖先写的（与投影的 last-wins 一致）。
 *
 * @param events - 本会话（Lead）的事件数组。
 * @returns members[]，按首次出现的顺序；空数组表示这条会话没有团队。
 */
function collectTeamMembers(events) {
  if (!Array.isArray(events)) return [];
  const byId = new Map();
  for (const ev of events) {
    if (ev == null || ev.type !== "team/member") continue;
    const m = ev.data?.member;
    if (m == null || typeof m.id !== "string" || m.id === "") continue;
    byId.set(sessionIdKey(m.id), {
      id: m.id,
      name: typeof m.name === "string" ? m.name : "",
      description: typeof m.description === "string" ? m.description : "",
      context: typeof m.context === "string" ? m.context : "",
      phase: typeof m.phase === "string" ? m.phase : "",
    });
  }
  return [...byId.values()];
}

/**
 * 把 roster 和「每个子会话花了多少」拼成团队视图。
 *
 * @param members - collectTeamMembers 的结果。
 * @param children - sumSubagentUsage 返回的每个子会话费用。
 * @param leadSessionId - Lead 会话 id；它自己不算队友（roster 里可能也有它）。
 * @returns {{count:number,cost:number,tokens:number,members:Array}|null}
 */
function buildTeamView(members, children, leadSessionId) {
  if (!Array.isArray(members) || members.length === 0) return null;
  const leadKey = sessionIdKey(leadSessionId);
  const costByKey = new Map();
  for (const c of Array.isArray(children) ? children : []) {
    if (c == null || typeof c.sessionId !== "string") continue;
    costByKey.set(sessionIdKey(c.sessionId), c);
  }
  const rows = [];
  let cost = 0;
  let tokens = 0;
  for (const m of members) {
    const key = sessionIdKey(m.id);
    if (key === "" || key === leadKey) continue;
    const hit = costByKey.get(key);
    const memberCost = hit == null ? 0 : Number(hit.cost) || 0;
    const memberTokens = hit == null ? 0 : Number(hit.tokens) || 0;
    cost += memberCost;
    tokens += memberTokens;
    rows.push({ ...m, cost: memberCost, tokens: memberTokens });
  }
  if (rows.length === 0) return null;
  return { count: rows.length, cost, tokens, members: rows };
}

/** 一份 usage 的 token 金额（不含网页工具费 —— 那个是 usage.webToolCost，按次计费、不乘峰谷）。
 *  口径必须与客户端 computeSplitCost 完全一致，否则「消耗行」和命令会显示两个数
 *  （2026-10-31 用户截图：命令 ¥112.6567 vs 消耗行 ¥115.0942）。 */
function usageCostOf(usage, pricing, multiplier = 2) {
  if (usage == null || typeof usage !== "object") return 0;
  if (Array.isArray(usage.byModel) && usage.byModel.length > 0) {
    return usage.byModel.reduce(
      (sum, b) => sum + (typeof b.cost === "number" && Number.isFinite(b.cost) ? b.cost : estimateCost(b, pricing, multiplier)),
      0,
    );
  }
  return estimateCost(usage, pricing, multiplier);
}

function formatUsage(usage, pricing, multiplier = 2, model = "", extras = null) {
  // ⚠️ usage 为 null 时绝不许直接解引用（2026-10-31 全量审查）。
  // sumSessionUsage 在会话还在装载 / 事件为空时会返回 null，
  // 而命令处理把 usage 直接传进来 —— 下面一行 usage.byModel 就是 TypeError，
  // 整个命令面板报错。命令只是查看入口，拿不到数字就说一句话。
  if (usage == null || typeof usage !== "object") {
    return "当前会话消耗：暂时无数据（会话可能还在加载，稍后再试）";
  }
  // peak / offpeak 也可能缺失（旧版数据），先落到空桶再取字段。
  const peakBucket = usage.peak ?? {};
  const offpeakBucket = usage.offpeak ?? {};
  // 优先按 byModel 逐段累加（每段用各自模型 + 价格时代的价格，历史消耗不因调价而变）；
  // 无 byModel 时回退单一价格估算（兼容旧数据）。pricing 是**目录价**，倍率单独传。
  // ⚠️ 这里只算「本会话自身」的 token 钱：网页工具费在 usage.webToolCost，
  // 子代理在另一个 usage 里 —— 两者客户端都会加进消耗行，命令也必须加，否则两边对不上。
  const ownCost = usageCostOf(usage, pricing, multiplier);
  const webCost = Number(usage.webToolCost ?? 0) || 0;
  const webSearchCalls = Number(usage.webSearchCalls ?? 0) || 0;
  const webFetchCalls = Number(usage.webFetchCalls ?? 0) || 0;
  const subUsage = extras?.subagentUsage ?? null;
  const subCost = Number(extras?.subagentCost ?? 0) || 0;
  const subCount = Number(extras?.subagentCount ?? 0) || 0;
  const hasSub = subUsage != null && subCost > 0;
  // 合计 = 本会话自身 + 网页工具费 + 子代理，与消耗行同口径
  const total = ownCost + webCost + subCost;
  const newTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  const peakTokens = (peakBucket.inputTokens ?? 0) + (peakBucket.cacheReadTokens ?? 0) + (peakBucket.cacheWriteTokens ?? 0) + (peakBucket.outputTokens ?? 0);
  const offpeakTokens = (offpeakBucket.inputTokens ?? 0) + (offpeakBucket.cacheReadTokens ?? 0) + (offpeakBucket.cacheWriteTokens ?? 0) + (offpeakBucket.outputTokens ?? 0);
  const modelLine = model === "" ? "" : `（模型 ${model}）`;
  const lines = [
    `当前会话消耗${modelLine}：`,
    `  新增 tokens：${newTokens}（未缓存输入 ${usage.inputTokens} + 输出 ${usage.outputTokens}）`,
    `  计费 tokens：${usage.totalTokens}（含缓存重读 ${usage.cacheReadTokens}、缓存写入 ${usage.cacheWriteTokens}）`,
    `    - 未缓存输入：${usage.inputTokens}`,
    `    - 缓存读取：${usage.cacheReadTokens}`,
    `    - 缓存写入：${usage.cacheWriteTokens}`,
    `    - 输出 tokens：${usage.outputTokens}`,
    `  本会话自身：¥${ownCost.toFixed(4)}（按 ${modelKey(model) || "deepseek-v4-flash"} 目录价估算，实际以账单为准）`,
    `  时段拆分：高峰 ${peakTokens} tokens、空闲 ${offpeakTokens} tokens（跨时段按各自时段价计费）`,
  ];
  if (webSearchCalls + webFetchCalls > 0) {
    lines.push(`  网页工具费：¥${webCost.toFixed(4)}（搜索 ${webSearchCalls} / 抓取 ${webFetchCalls} 次，不乘峰谷）`);
  }
  if (hasSub) {
    lines.push(`  子代理消耗：≈ ¥${subCost.toFixed(4)}（${subCount} 个，已计入合计）`);
  } else if (extras?.subagentSkipped === true) {
    lines.push("  子代理消耗：本次未枚举（拿不到当前会话 id），合计可能略低于消耗行");
  }
  if (webSearchCalls + webFetchCalls > 0 || hasSub) {
    lines.push(`  合计：¥${total.toFixed(4)}（含网页工具费与子代理，与消耗行同口径）`);
  }
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

/** 是否来自同源的 JSON 请求。
 *  本地 HTTP 接口默认对浏览器里**任意网页**开放：一个 text/plain 的「简单请求」
 *  不需要 CORS 预检就能打到 127.0.0.1，改设置、触发自更新都算副作用。
 *  所以写入口要求：Content-Type 是 application/json，且（若带 Origin）Origin 的
 *  host:port 等于请求自己的 Host。兼容不带 Origin 的非浏览器调用（curl / 测试）。 */
function isSameOriginJsonRequest(req) {
  const headers = req && req.headers ? req.headers : {};
  const contentType = String(headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) return false;
  const origin = headers.origin;
  if (origin === void 0 || origin === "") return true;
  try {
    const originHost = new URL(origin).host;
    const host = String(headers.host || "");
    return host !== "" && originHost === host;
  } catch {
    return false;
  }
}

/** 后台异步任务的兜底包装。
 *
 *  为什么必须有：本插件里所有「不 await 的后台任务」（读设置文件、同步节假日、拉更新）
 *  都是 fire-and-forget。只要其中任何一个抛出未被包住的异常，Node/Electron 会把它升级成
 *  unhandledRejection —— **Electron 主进程遇到它会直接报错退出**。用户看到的现象是
 *  「DSH 更新完启动就崩，把插件禁用了才起得来，之后再启用又正常」（2026-10-30 反馈）。
 *
 *  那个现象的本质：启动期插件是主进程的一部分，它抛错 = bootstrap 中止；
 *  而运行时启用时 app 已经活着，同样的错只影响插件自己。
 *  所以这里把所有后台任务统一吞掉：失败就降级（设置用默认值 / 日历用内置表 / 跳过这次刷新），
 *  只写一条 warn，绝不把异常漏成 unhandledRejection。
 *
 *  注意：只包**异步/后台**那段。同步的 register 类错误该暴露还是要暴露，
 *  否则出问题时会变成「插件静默不工作」，更难查。 */
function runQuietly(label, fn) {
  const report = (error) => {
    try {
      const detail = error && error.message ? error.message : String(error);
      console.warn("[balance-dsh] " + label + " 失败（已降级，不影响启动）: " + detail);
    } catch {
      // console 本身不可用时也不能再抛
    }
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      result.then(undefined, report);
    }
  } catch (error) {
    report(error);
  }
}

export function apply(ctx, config = {}) {
  // 今日消耗的运行时状态：内存缓存 + 落盘快照路径 + 后台重算的单飞句柄。
  // 快照路径在读到 dshHome 之后填（见下面 runQuietly「读取设置」），
  // 空串表示定位不到目录 —— 此时退化成纯内存缓存，功能照常、只是下次启动仍要现算。
  const todayState = {
    cache: { expiresAt: 0, value: null },
    // ⚠️ 不能先置空串、稍后再赋值（2026-10-31 全量审查）。
    // todayState 一旦在赋值之前被读（异步回调、快速手动刷新、dispose 落盘），
    // readTodaySnapshot("") 会直接返回 null —— 表现就是「冷启动一直算不出今日」。
    // siblingFilePath 是同步的，直接在构造时就算好。
    snapshotFile: siblingFilePath(ctx, TODAY_SNAPSHOT_FILENAME),
    staleMs: TODAY_SNAPSHOT_STALE_MS,
    recompute: null,
  };
  let statsCache = { expiresAt: 0, value: null };
// 统计单飞（2026-10-31 审计 M7a）：并发请求共用同一次全量扫描。
let statsInFlight = null;
  // 用户设置（「插件」页配置卡片读写）：先按出厂默认值跑，异步读到文件后热替换。
  // 读不到文件不是错误——全新安装就是没有文件，保持默认值即可。
  // `ready` 是「文件已经读过一轮」的闸门：在它变 true 之前，POST 一律拒绝写盘，
  // 否则出厂默认值会把用户配置整份覆盖（见下面 handler 里的说明）。
  const settingsState = { value: { ...DEFAULT_SETTINGS }, file: "", readOnly: false, ready: false };
  let effectiveConfig = withSettings(config, settingsState.value);
  // 读设置是后台任务：settingsFilePath 走 dshHomePath 服务、readSettingsFile 走 fs，
  // 两者都可能在 DSH 换版本后抛错（内部服务改名 / 目录权限变化）。
  // 用 runQuietly 包住 —— 读不到就保持出厂默认值继续跑，绝不能漏成 unhandledRejection。
  runQuietly("读取设置", async () => {
    settingsState.file = settingsFilePath(ctx);
    const loaded = await readSettingsFile(settingsState.file);
    let dirty = false;
    if (loaded === "missing") {
      // 全新安装：没有任何历史可回顾，红点不亮，
      // 并立即落盘固化，保证后续每次启动都走「已读」分支。
      settingsState.value = { ...DEFAULT_SETTINGS, entrySeen: true };
      dirty = true;
    } else if (loaded === "corrupt") {
      // 配置文件坏了（已被另存为 .corrupt-<ts>）：这一轮用出厂默认值跑，
      // 但**禁止启动时自动写盘** —— 否则一份默认值会把用户的 60 秒轮询、
      // 阈值、扫描上限全盖掉，正是「每次更新都改回去」的来源。
      // 用户之后在设置页改任何一项时会正常写盘（那时是用户自己的意图）。
      settingsState.value = { ...DEFAULT_SETTINGS, entrySeen: true };
      settingsState.readOnly = true;
    } else if (loaded) {
      settingsState.value = loaded;
    }
    // NEW 徽标的计时：记下「这个版本首次启动」的时间。
    // 版本号变了（用户升级了）就重置，否则沿用上次记录的起点——
    // 否则每次启动都会把计时推到“现在”，永远过不了 24 小时。
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
    // 闸门放开：从这里往后 settingsState.value 才是「用户磁盘上那一份」，
    // 之前的任何写入都是拿默认值覆盖用户配置。
    settingsState.ready = true;
    if (dirty && !settingsState.readOnly) {
      try {
        await writeSettingsFile(settingsState.file, settingsState.value);
      } catch {
        // 写盘失败（目录只读等）不影响这一次运行：内存里已经是最新值
      }
    }
    // 今日消耗快照：先填路径，再结算「昨天留下的那份」。
    // 结算必须在读快照之前做 —— settleStaleTodaySnapshot 会把过期的快照
    // 并进 dailySettled 然后删掉它，之后的 readTodaySnapshot 才不会读到旧值。
    // snapshotFile 已在 todayState 构造时就位（见上），这里不再重复赋值。
    try {
      await settleStaleTodaySnapshot(ctx);
    } catch {
      // 结算失败不影响今天的显示，下次启动会再试
    }
  });
  // DSH 热重载(reload)时会重新 apply 本插件；若旧实例注册的 /balance-api 路由
  // 未被清理，新实例再次 register 就会抛出 duplicate route，导致整个 apply 失败、
  // 余额不显示。这里收集每次 register 返回的 disposer，并在插件卸载(ctx.on("dispose"))
  // 时统一清理，保证重复 apply 不冲突。
  const disposers = [];

  // 节假日数据：先读本地缓存（这样断网、改过系统时间也照样按上次同步的结果算钱），
  // 再看缓存是不是过期（默认 30 天），过期才去拉。故意不 await —— 网络慢不能拖住启动，
  // isPeakAt 保持同步函数，缓存没到位时继续用内置表。
  runQuietly("同步节假日数据", async () => {
    await loadCalendarCache(ctx);
    await refreshCnCalendar(ctx, false);
  });

  // 1) 命令行查询入口。命令名**必须是插件专属的**（2026-10-31 用户反馈：
  //    「这个指令跟好多插件冲突了」）—— DSH 的命令名是全局唯一的，注册重名会抛
  //    `command "x" is already registered`，先注册的那个赢、后来的整条命令消失。
  //    所以直接用带作者后缀的全名，不设备用名（用户 2026-10-31 定案）。
  //    ⚠️ DSH 的命令名规则是 COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u，**只允许小写**，
  //    写成大写 Rannist 会在 normalizeDefinition 里抛 TypeError、整条命令消失，
  //    所以这里落成小写的 balance-dsh-rannist。
  ctx.inject(["commands"], (commandCtx) => {
    try {
      commandCtx.commands.register({
        name: COMMAND_NAME,
        description: "查询 DeepSeek 余额与当前会话消耗",
        handler: async ({ agent, signal }) => {
          const usage = sumSessionUsage(agent.session, effectiveConfig);
          const model = detectModel(agent.session);
          const pricing = catalogPricing(effectiveConfig, model);
          const multiplier = peakMultiplierOf(effectiveConfig);
          // 余额来源：官方账号优先（官方版内置登录，无需 API Key），回退 API Key。
          // ⚠️ usage 可能是 null（session 未就绪 / sumSessionUsage 判定拿不到），
          // 而 formatUsage 第一行就取 usage.byModel（2026-10-31 审计 M10）。
          // 一旦炸掉，连余额文本都拿不到 —— 命令面板只剩一条异常。所以这里先算成文本，
          // 两条返回分支共用。
          // ⚠️ 子代理必须一起算（2026-10-31 用户截图：命令 ¥112.6567 vs 消耗行 ¥115.0942）。
          // 消耗行那边是 computeSplitCost(split) + subagentCost，命令原来只算本会话自身、
          // 也没加网页工具费，于是永远比消耗行少一截。这里补齐，口径就一致了。
          const liveId = String(agent?.session?.id ?? agent?.sessionId ?? "");
          let subagentUsage = null;
          if (liveId !== "") {
            try {
              const sub = await sumSubagentUsage(ctx, liveId, effectiveConfig);
              subagentUsage = sub?.usage ?? null;
            } catch {
              // 子代理枚举失败只影响那几行，本会话数字照常给
              subagentUsage = null;
            }
          }
          const usageText = formatUsage(usage, pricing, multiplier, model, {
            subagentUsage,
            subagentCost: subagentUsage == null ? 0 : usageCostOf(subagentUsage, pricing, multiplier),
            subagentCount: Number(subagentUsage?.sessions ?? 0) || 0,
            subagentSkipped: liveId === "",
          });
          const { balance, error } = await resolveBalance(ctx, effectiveConfig, signal);
          if (balance === null) {
            return {
              kind: "error",
              text: `${error}\n\n${usageText}`,
            };
          }
          return {
            kind: "success",
            text: `${formatBalance(balance)}\n\n${usageText}`,
          };
        },
      });
    } catch (error) {
      runQuietly("注册 /" + COMMAND_NAME + " 命令", () => {
        throw error;
      });
    }
  });

  // 2) /balance-api HTTP 接口：供客户端插件直接渲染余额（不经过命令，不污染会话日志）
  // 注意：不要在这里声 inject ["subagents"] —— 它依赖 dsh-subagent 服务；
  //      若 balance-dsh 加载时该服务未就绪，Cordis 会跳过整个 callback，导致
  //      /balance-api 不注册（404）。改为只声 inject ["webServer"]，子代理在
  //      sumSubagentUsage 内部用可空 ctx.get("subagents") 获取。
  ctx.inject(["webServer"], (httpCtx) => {
    // register 是最可能在启动期炸的一步：DSH 更新/热重载后旧实例路由没清干净，
    // 新实例再注册就会抛 duplicate exact route。以前这个异常会一路冒到 loader，
    // 整个插件加载失败（连带余额行、消耗行、设置卡片全不显示）。
    // 现在单独兜住：注册失败只意味着余额接口这次不可用，启动照常。
    let balanceRouteDisposer = null;
    try {
      balanceRouteDisposer = httpCtx.webServer.register({
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
              writeJson(res, 200, { ok: true, settings: settingsState.value, version: installedVersion() });
              return;
            }
            if (req.method !== "POST") {
              writeJson(res, 405, { ok: false, error: "method not allowed" });
              return;
            }
            const body = await readRequestBody(req);
            const parsed = body.trim() === "" ? {} : JSON.parse(body);
            const patch = parsed != null && typeof parsed === "object" && parsed.settings != null ? parsed.settings : parsed;
            // ⚠️ 设置文件还没读完时**绝不许写盘**（2026-10-31 全量审查）。
            // settingsState.value 的初值是 DEFAULT_SETTINGS，真正的值要等上面那个
            // runQuietly 异步读完文件。这中间任何一次 POST 都会拿出厂默认值当底
            // 做 normalizeSettings({...默认值, ...patch}) 然后整份落盘 ——
            // 用户改一个开关，轮询间隔 / 低余额阈值 / 扫描上限 / apiKey 全被盖回出厂。
            // 客户端也有同样的闸门，但那是浏览器侧，冷启动抢跑时挡不住。
            if (settingsState.ready !== true) {
              writeJson(res, 503, { ok: false, error: "设置还没加载完成，请稍后再试" });
              return;
            }
            // ⚠️ 写入口必须校验来源与 Content-Type（2026-10-31 审计 L10）。
            // 本接口监听在 127.0.0.1，浏览器里任意一个网页都能对它发 text/plain
            // 的「简单请求」—— 不需要预检就能改设置或触发自更新。
            // 只放行同源（本机 webServer）与 application/json。
            if (req.method === "POST" && !isSameOriginJsonRequest(req)) {
              writeJson(res, 403, { ok: false, error: "forbidden" });
              return;
            }
            const next = normalizeSettings({ ...settingsState.value, ...(patch ?? {}) });
            await writeSettingsFile(settingsState.file || settingsFilePath(ctx), next);
            settingsState.value = next;
            effectiveConfig = withSettings(config, next);
            // 价格与扫描范围可能变了，作废统计缓存
            statsCache = { expiresAt: 0, value: null };
            // ⚠️ today 也必须一起作废（2026-10-31 审计 L7）：
            // 改的是价格 / 倍率 / 峰谷窗口时，统计面板立刻刷新了，
            // 而今日金额还拿着旧价算出来的值最多 45 秒 —— 同一个界面两个口径。
            todayState.cache = { value: null, expiresAt: 0 };
            todayIncrementCache.clear();
            writeJson(res, 200, { ok: true, settings: next, version: installedVersion() });
          } catch (error) {
            writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        // 检查更新 / 就地更新：同一个参数，GET 查询、POST 安装。
        // 它排在下面那道 405 之前 —— 这是除了设置写入之外唯一放开 POST 的入口，
        // 且只认 ?update=1（其余非 GET 仍然 405）。
        let wantUpdate = false;
        try {
          wantUpdate = new URL(req.url, "http://localhost").searchParams.get("update") === "1";
        } catch {
          wantUpdate = false;
        }
        if (wantUpdate) {
          if (req.method === "POST") {            // ⚠️ 必须和设置写入同一道同源校验（2026-10-31 第二十二轮审计）：
            // 这条分支会真的下载 npm 包并覆盖插件安装目录。少了校验，本机任意网页
            // 用一个 text/plain 的简单请求就能触发写盘（CSRF）。
            if (!isSameOriginJsonRequest(req)) {
              writeJson(res, 403, { ok: false, error: "forbidden" });
              return;
            }
            // POST → 下载 npm 上最新 tarball 覆盖本机安装（见 installLatestVersion）。
            // 下载 + 逐文件写盘期间 await 会让出事件循环，不会卡住余额请求。
            try {
              const result = await installLatestVersion(httpCtx);
              writeJson(res, 200, { current: installedVersion(), ...result });
            } catch (error) {
              writeJson(res, 200, {
                ok: false,
                current: installedVersion(),
                error: error instanceof Error ? error.message : String(error),
              });
            }
            return;
          }
          if (req.method !== "GET") {
            writeJson(res, 405, { ok: false, error: "method not allowed" });
            return;
          }
          // force：用户手动点「检查更新」时不走 10 分钟缓存，否则刚更新过会显示旧结果
          const found = await fetchLatestVersion(true);
          if (found && found.error) {
            writeJson(res, 200, { ok: false, current: installedVersion(), error: found.error });
          } else {
            writeJson(res, 200, { ok: true, current: installedVersion(), latest: found.latest });
          }
          return;
        }
        // 节假日数据：GET 读状态（含 days 明细，客户端据此与服务端同口径判断峰谷），
        // POST 强制重新同步。和 update 一样排在下面那道 405 之前。
        let wantCalendar = false;
        try {
          wantCalendar = new URL(req.url, "http://localhost").searchParams.get("calendar") === "1";
        } catch {
          wantCalendar = false;
        }
        if (wantCalendar) {
          if (req.method === "POST") {
            try {
              writeJson(res, 200, await refreshCnCalendar(httpCtx, true));
            } catch (error) {
              writeJson(res, 200, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                ...calendarStatus(),
              });
            }
            return;
          }
          if (req.method !== "GET") {
            writeJson(res, 405, { ok: false, error: "method not allowed" });
            return;
          }
          writeJson(res, 200, { ok: true, ...calendarStatus() });
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
        let wantDiag = false;
        // `?lite=1`：只算「本会话 usage + 子代理 + 团队」，**不查余额、不碰今日**。
        // 智能体团队的 15 秒补拉走这条 —— 补拉只为了更新团队那点数字，
        // 却原来连带一次官方余额网络请求（实测 419ms）和一次今日增量，
        // 团队挂两小时就是 480 次白跑的余额请求。余额自己还有 60 秒轮询在管，不缺这一趟。
        let wantLite = false;
        try {
          const search = new URL(req.url, "http://localhost").searchParams;
          model = search.get("model") ?? "";
          sessionParam = search.get("session") ?? "";
          wantStats = search.get("stats") === "1";
          wantToday = search.get("today") === "1";
          wantDiag = search.get("diag") === "1";
          wantLite = search.get("lite") === "1";
        } catch {
          model = "";
          sessionParam = "";
          wantStats = false;
          wantToday = false;
          wantDiag = false;
          wantLite = false;
        }
        let stats = null;
        let statsError = "";
        if (wantStats) {
          try {
            if (statsCache.value == null || statsCache.expiresAt <= Date.now()) {
              // ⚠️ 统计要全量扫最多 80 个会话（每个可能 700ms 同步解压），
              // 并发而来的第二个请求原来会**再扫一遍**（2026-10-31 审计 M7a）。
              // 单飞：同一时刻只允许一个 buildUsageStats 在跑，其余共用同一个 Promise。
              if (statsInFlight === null) {
                statsInFlight = (async () => {
                  try {
                    const value = await buildUsageStats(httpCtx, effectiveConfig);
                    statsCache = {
                      value,
                      expiresAt: Date.now() + (effectiveConfig.statsCacheMs ?? STATS_CACHE_MS),
                    };
                    return value;
                  } finally {
                    statsInFlight = null;
                  }
                })();
              }
              await statsInFlight;
            }
            stats = statsCache.value;
          } catch (error) {
            statsError = error instanceof Error ? error.message : String(error);
          }
        }
        // 今日消耗放在会话处理之后算：?session= 请求手里已经有该会话的完整 events，
        // 传给 buildTodayCost 就不用再解压一遍 —— 这就是「实时刷新」的零成本来源。
        // 按 session id 取会话并分时段汇总 usage（拿不到则返回 null，客户端回退用本地投影）
        let usage = null;
        // 子代理后代会话的 usage 汇总（与主会话分开）
        let subagentUsage = null;
        // 每个子会话（含智能体团队的 teammate）的独立费用：sumSubagentUsage 顺手带出来，
        // 用来把「团队 N 人」拆到人头。普通 subagent / workflow 子代理也在这张表里，
        // 但只有 roster 里点得到的那几个才会进团队的展示区。
        let subagentChildren = [];
        // 从会话事件识别实际使用模型（客户端未传 ?model= 时兜底）
        let detectedModel = "";
        // 今日消耗复用句柄：谁解压过当前会话的 events，就记在这里
        let todayReuse = null;
        // 智能体团队（Agent Teams）的 roster + 按人头费用。
        // 数据来源都在本会话自己的事件里：`team/member` 事件带 member {id,name,phase,context}，
        // 而 cost 从 subagentChildren 里按 sessionId 对上号 —— 不依赖 ctx 的 agentTeams 服务，
        // 也就不受「服务缺失 / 投影未就绪」影响（DSH 内部 API 无兼容承诺，见 AGENTS 铁律）。
        let team = null;
        // 会话是否已经装进 DSH 内存。false = DSH 正在读它的持久化文件，
        // 这一轮插件**完全不碰磁盘**（不读会话、不算 today、不扫子代理）。
        let sessionLoaded = false;
        // 是否**真的**在装载中（sessions 服务存在但该会话没值）。
        // 注意它与 `!sessionLoaded` 不等价：服务端根本没有 sessions 服务时，
        // sessionLoaded 恒为 false 但并非"正在加载"，此时必须照常读持久化。
        let sessionLoading = false;
        // 临时诊断：`?diag=1` 时随响应带回，用来查「为什么 usage 恒为 null」。
        // 只带类型和布尔，不带 token 内容，开销为零。
        let sessionDiag = null;
        if (sessionParam !== "") {
          try {
            const sessions = ctx.get("sessions");
            // ⚠️ `sessions.get(id)` 拿不到**不等于**会话正在装载 —— DSH 启动后不会预加载会话，
            // 只有用户点进某个对话时它才进内存。所以「没值」最常见的原因其实是「这个对话
            // 还没被点开过」，此时磁盘上的 zstd 完好、根本没人跟插件抢。
            //
            // 2026-10-31 实测：重启后 `?session=9877db7c` 恒 null（界面 ¥73.6），
            // 用户点进该对话后同一请求立刻正常（¥90.9）——差别就是 `get()` 有没有值。
            // 所以「没值」时**必须**先去磁盘拿真数，不能直接给 null 让客户端估算，
            // 估算那条路不分 era，跨调价点的会话会被压低近 20%。
            //
            // 抢线程的风险靠 `SESSION_REREAD_MIN_MS` 节流兜住：真在装载时最多也只解压一次。
            const sessionsUsable = sessions !== void 0 && sessions !== null && typeof sessions.get === "function";
            const session = sessionsUsable ? sessions.get(sessionParam) : void 0;
            // 仅用于诊断：区分「服务不存在」和「服务在但会话没进内存」。
            sessionLoading = sessionsUsable && session === void 0;
            if (wantDiag) {
              sessionDiag = {
                sessionsType: typeof sessions,
                sessionsIsNull: sessions === null,
                hasGet: typeof sessions?.get === "function",
                sessionsUsable,
                sessionUndefined: session === void 0,
                sessionType: typeof session,
                sessionLoading,
                persisted: null,
                persistedError: null,
              };
            }
            // **会话确实正在装载时，绝不去读它的持久化文件**（2026-10-31：「点击 A 对话
            // 之后加载没完成，我再点击 B 对话会导致对话都加载很慢」，「让行那几十毫秒不行」）。
            // `sessions.get()` 有服务但没值 = DSH 正在把那个 zstd 读进内存。此时插件再去解压
            // 同一个 40 MB 文件，就是两个同步解压抢同一条线程，A 和 B 一起卡 —— 让行 60 ms
            // 只是把拥堵推后 60 ms，堵本身一点没少，所以那个方案无效。
            // 正确做法是**根本不参与**：返回 null，客户端用本地投影估算先显示；等 DSH 把这个
            // 会话装进内存（下一轮 usageKey 变化再来问时 session 就有值了），插件才读它，
            // 那时 DSH 已经读完，不存在竞争。
            // 「会话正在装载」只可能是**服务存在但没值**这一种。sessions 服务不存在时
            // 永远不是加载中 —— 否则在这个环境里 usage 会恒为 null（2026-10-31 实测）。
            sessionLoaded = session !== void 0;
            if (session !== void 0) {
              usage = sumSessionUsage(session, effectiveConfig);
              detectedModel = detectModel(session);
              // live 事件本身就是全量，直接给「今日消耗」复用，省掉一次解压。
              // ⚠️ 同样只复用切过前缀的那批（ownEventsOf），与持久化路径同口径。
              const liveEvents = sessionEvents(session);
              const ownLive = ownEventsOf(session?.header ?? null, liveEvents);
              if (Array.isArray(ownLive) && ownLive.length > 0) {
                todayReuse = { sessionId: sessionParam, events: ownLive, meta: session?.header ?? null };
              }
            }
            // DSH 2.0.4 起 live session（sessions.get）可能拿不到 events，导致 usage 全 0；
            // 会话还没被点开时更是根本拿不到 live。两种情况都回退持久化读事件，
            // 避免客户端拿到"空但非 null"的 usage 而把金额显示成 ¥0.0000。
            // 这里**不再**用 sessionLoading 拦：拿不到 live 最常见的原因是该对话还没被点开，
            // 磁盘上没人跟插件抢；真在装载时由 SESSION_REREAD_MIN_MS 节流兜住。
            if (usage == null || usage.totalTokens === 0) {
              try {
                // 4 秒内不重复解压同一个会话：对话进行中 `updatedAt` 每轮都变，
                // 只看指纹会把 46 MB 的 zstd 每轮重解一遍（800 ms 同步 CPU）。
                //
                // ⚠️ **两套 id**：客户端传的是裸 UUID（DSH 的 sessionId prop），
                // 而 `sessions.get()` 认裸 UUID、持久化目录却叫 `session-<uuid>`。
                // 直接拿裸 UUID 去 inspect 会报 `session "…" not found`
                // （2026-10-31 实测，`?session=` 因此恒为 null → 界面走不分 era 的估算）。
                // 先按带前缀的试，失败再退回原值，两边都能覆盖。
                const persistedId = sessionParam.startsWith("session-") ? sessionParam : `session-${sessionParam}`;
                let persisted = await inspectPersistedCached(ctx, persistedId, SESSION_REREAD_MIN_MS);
                if ((persisted == null || !Array.isArray(persisted.events) || persisted.events.length === 0) && persistedId !== sessionParam) {
                  persisted = await inspectPersistedCached(ctx, sessionParam, SESSION_REREAD_MIN_MS);
                }
                if (sessionDiag !== null) {
                  sessionDiag.persisted = {
                    isNull: persisted == null,
                    hasEvents: Array.isArray(persisted?.events),
                    eventCount: Array.isArray(persisted?.events) ? persisted.events.length : 0,
                    meta: persisted?.meta == null ? null : typeof persisted.meta,
                  };
                }
                if (Array.isArray(persisted?.events) && persisted.events.length > 0) {
                  // 同样切掉 seeded 前缀 —— 否则 fork 会话的「本会话消耗」和今日都会翻倍。
                  const ownPersisted = ownEventsOf(persisted?.meta, persisted.events);
                  const persistedUsage = sumEventsUsage(ownPersisted, effectiveConfig, detectedModel);
                  if (persistedUsage.totalTokens > 0) {
                    usage = persistedUsage;
                    if (detectedModel === "") {
                      const switches = collectModelSwitches(ownPersisted);
                      if (switches.length > 0) detectedModel = switches[switches.length - 1].model;
                    }
                  }
                  // 刚解压出来的事件也给今日消耗复用（缓存之外的第二份，避免重复读）。
                  // ⚠️ 复用出去的必须是**切过的**那批：今日是按会话累加的，带着前缀进去就重复计费。
                  todayReuse = { sessionId: sessionParam, events: ownPersisted, meta: persisted?.meta ?? null };
                }
              } catch (err) {
                // 持久化读取不可用：忽略，走下方统一降级
                if (sessionDiag !== null) {
                  sessionDiag.persistedError = String(err && err.message ? err.message : err).slice(0, 300);
                }
              }
            }
            // 仍无任何 token 就返回 null，让客户端回退本地投影估算（而不是当成 0 消耗显示 ¥0.0000）
            if (usage != null && usage.totalTokens === 0) usage = null;
            // 子代理枚举走持久化目录（不依赖 live 会话），即使父会话不在内存也能拿到。
            try {
              const subRes = await sumSubagentUsage(httpCtx, sessionParam, effectiveConfig);
              subagentUsage = subRes.usage;
              subagentChildren = Array.isArray(subRes.children) ? subRes.children : [];
            } catch {
              subagentUsage = null;
              subagentChildren = [];
            }
            // 智能体团队：roster 就长在本会话自己的事件里（team/member），
            // 每人的费用从 subagentChildren 按 sessionId 对上号。
            // 没有团队事件 → team 为 null，客户端整块不渲染。
            try {
              const leadEvents = todayReuse !== null && todayReuse.sessionId === sessionParam
                ? todayReuse.events
                : null;
              team = buildTeamView(collectTeamMembers(leadEvents), subagentChildren, sessionParam);
            } catch {
              team = null;
            }
          } catch (err) {
            usage = null;
            subagentUsage = null;
            team = null;
            if (sessionDiag !== null) {
              sessionDiag.outerError = String(err && err.stack ? err.stack : err).slice(0, 600);
            }
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
        // 今日消耗：三条路径。
        //  ① 带 ?session= 且手里有该会话的实时事件 → **只增量算这一个会话**，
        //     其余会话的贡献从上一次结果里原样搬运，一笔都不重扫（用户 2026-10-31：
        //     「本对话消耗只扫对应对话的，其他对话别扫描」）。
        //  ② 增量无从谈起（今天还没算过 / 快照是昨天的）→ 回退完整路径，一天只碰一次。
        //  ③ 只带 ?today=1 → 走快照三层（冷启动秒开）。
        // partial 表示给的是旧值、后台正在算。
        let today = null;
        let todayPartial = false;
        // lite 模式（团队补拉）不碰今日：今日的增量靠「有其他会话写盘」驱动，
        // 团队补拉每 15 秒来一次，跟着刷今日只是白花 CPU。
        if (!wantLite && (wantToday || sessionParam !== "")) {
          try {
            // today 也照常算：会话没进内存不代表 DSH 在解锁它（可能只是没被点开），
            // 此时扫盘不冲突，而漏算今日比慢更难接受。
            if (sessionParam !== "" && todayReuse !== null && todayReuse.sessionId === sessionParam) {
              today = await updateTodayCostWithSession(
                httpCtx, effectiveConfig, todayState, sessionParam, todayReuse.events,
              );
            }
            if (today === null && wantToday) {
              const resolved = await resolveTodayCost(httpCtx, effectiveConfig, todayState, todayReuse);
              today = resolved.value;
              todayPartial = resolved.partial;
            }
          } catch {
            today = null; // 拿不到就不显示，不阻塞余额
          }
        }
        // ⚠️ 主干尾部必须自己兜住（2026-10-31 审计 M12）：
        // 前面每个分支都有局部 try，唯独这段没有。resolveBalance / catalogPricing /
        // writeJson 任一抛出（resolveApiKey、网络、res 已销毁）都会让 handler 直接 reject，
        // 客户端收到零字节响应挂到超时，还可能升级成 unhandledRejection。
        try {
          // 余额来源：官方账号优先（官方桌面版内置登录，无需 API Key），回退 DeepSeek API Key。
          // lite 模式完全不查（团队补拉每 15 秒一次，查余额是纯浪费；余额有自己 60 秒的轮询）。
          const { balance, error: balanceError } = wantLite
            ? { balance: null, error: "" }
            : await resolveBalance(ctx, effectiveConfig);
          if (!wantLite && balance === null && !wantStats) {
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
            // 智能体团队（Agent Teams）：{ count, cost, tokens, members:[{id,name,phase,context,cost,tokens}] }
            // 没有团队时是 null。金额口径与 subagentUsage 一致（都是同一批子会话的估算），
            // 这里只是把它们按 roster 拆到人头，**不是**额外再加一笔。
            team,
            stats,
            statsError,
            today,
            todayPartial,
            ...(wantDiag ? { diag: sessionDiag } : {}),
          });
        } catch (error) {
          // headersSent 之后不能再写头，只能放弃这一次响应
          if (!res.headersSent) {
            writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
      },
    });
    } catch (error) {
      // duplicate exact route / API 变更：余额接口这次不可用，但插件照常加载
      runQuietly("注册 /balance-api 路由", () => {
        throw error;
      });
      return;
    }
    if (typeof balanceRouteDisposer === "function") disposers.push(balanceRouteDisposer);
  });

  // 插件卸载/dispose 时清理本实例注册的路由，避免 DSH 热重载时旧实例残留
  // 的路由导致新实例 register /balance-api 抛 duplicate route、插件启动失败。
  const release = () => {
    for (const d of disposers) {
      try { d(); } catch { /* ignore */ }
    }
    // 退出/热重载时把今天最后一次算出的值落盘（用户要求：退出时保留缓存，下次直接读）。
    // 不重算、不刷新 at —— at 记录的是「算出来的时刻」，改成写盘时刻会让下次启动
    // 误判成「刚算过」而不去重算，快照就永远停在这里。
    // writeJsonAtomic 是先写 .tmp 再 rename，中途被打断也不会留下半个文件。
    const last = todayState.cache.value;
    if (last != null && typeof last === "object" && todayState.snapshotFile !== "") {
      runQuietly("保存今日消耗快照", () => writeTodaySnapshot(todayState.snapshotFile, last));
    }
  };
  if (typeof ctx.on === "function") ctx.on("dispose", release);
}
