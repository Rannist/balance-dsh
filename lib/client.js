window.__ModuleLoader__.load({
  id: "balance-dsh",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    let reactDom = require("react-dom");
    let jsx = require("react/jsx-runtime");
    let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    // ─── 样式 ────────────────────────────────────────────────────────────────
    const css = `
/* 兜底定义主题过渡变量：上游 deepsuite theme/global.css 未加载时，
   恢复侧边栏/面板的滑动动画（AppFrame 宽度过渡依赖 --ds-transition-duration-slow） */
:root{--ds-transition-duration-slow:.3s;--ds-transition-duration:.2s;--ds-transition-duration-fast:.1s;--ds-ease-in-out:cubic-bezier(.4,0,.2,1)}
/* ── 基础元素（自定义类，稳定；纯文字样式，不用胶囊） ── */
/* 完全复刻设置按钮（.VOzbGW_trigger）：width calc(100%+4px)、height 42px、margin 4px -2px、
   padding 0 10px 0 8px、gap 8px、font 14px/22px、color label-primary；
   左缘与设置按钮严格对齐，高度/颜色一致（图标与"余额"文字也统一 label-primary，金额 600 加粗） */
.balance-footer{box-sizing:border-box;display:flex;align-items:center;justify-content:flex-start;gap:8px;width:100%;min-width:0;height:42px;margin:0;padding:0 0 0 8px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;text-decoration:none;cursor:pointer;white-space:nowrap;overflow:visible;-webkit-user-select:none;user-select:none}
.balance-footer__icon{display:inline-flex;flex:none;color:var(--dsw-alias-label-primary)}
.balance-footer__label{white-space:nowrap;color:var(--dsw-alias-label-primary)}
.balance-footer__value{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap;padding:2px 8px;border-radius:999px;margin-left:auto;margin-right:6px;text-decoration:none;cursor:pointer;transition:transform .15s var(--ds-ease-in-out,.2s)}
.balance-footer__value:hover{filter:brightness(.85);transform:scale(1.06)}
.balance-footer__value--healthy{color:var(--dsw-alias-state-success-primary);background:rgba(34,197,94,.15)}
.balance-footer__value--low{color:#d97706;background:rgba(217,119,6,.15)}
.balance-footer__value--empty{color:var(--dsw-alias-state-error-primary,#e5484d);background:rgba(229,72,77,.15)}
.balance-footer__topup{margin-left:auto;flex:none;box-sizing:border-box;padding:2px 10px;border-radius:999px;font-weight:500;white-space:nowrap;color:var(--dsw-alias-state-error-primary,#e5484d);text-decoration:none;background:rgba(229,72,77,.15);transition:transform .15s var(--ds-ease-in-out,.2s)}
.balance-footer__topup:hover{filter:brightness(.85);transform:scale(1.06)}
.balance-footer__period-inline{font-weight:500;white-space:nowrap}
.balance-footer__period-inline--peak{color:var(--dsw-alias-state-error-primary,#e5484d)}
.balance-footer__period-inline--offpeak{color:var(--dsw-alias-state-success-primary)}
.balance-footer__period-inline--refreshing{color:var(--dsw-alias-label-secondary)}
.balance-footer__error{color:var(--dsw-alias-state-error-primary)}
.balance-topup{box-sizing:border-box;display:flex;align-items:center;justify-content:flex-start;gap:8px;width:calc(100% + 4px);min-width:0;height:42px;margin:0 -2px;padding:0 10px 0 8px;color:var(--dsw-alias-state-error-primary,#e5484d);font-size:14px;font-weight:600;line-height:22px;text-decoration:none;cursor:pointer;white-space:nowrap;overflow:hidden}
.balance-topup:hover{text-decoration:underline}
/* ── 收起态：悬浮 FAB（保持原样） ── */
.balance-fab{box-sizing:border-box;position:fixed;left:68px;bottom:12px;z-index:40;height:32px;padding:0 14px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-base));border:1px solid var(--dsw-alias-border-l2);border-radius:999px;cursor:pointer;font-size:12px;font-weight:600;line-height:1;text-decoration:none;white-space:nowrap;pointer-events:auto;box-shadow:0 4px 12px rgba(0,0,0,.10)}
.balance-fab:hover{background:var(--dsw-alias-interactive-bg-hover)}
.balance-fab-dark{color:#fff;background:var(--dsw-alias-state-error-primary,#e5484d);border-color:var(--dsw-alias-state-error-primary,#e5484d)}
.balance-fab-dark:hover{background:#cf3a3f}
.balance-usage-line{box-sizing:border-box;display:flex;justify-content:center;align-items:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.balance-usage-line strong{color:var(--dsw-alias-label-primary);font-weight:600}
/* ── 跨会话统计浮层（余额元素的子级，向右/向上展开） ── */
.balance-stats-anchor{position:relative;display:flex;min-width:0;overflow:visible}
.balance-stats-anchor--wide{width:100%}
.balance-stats-anchor--compact{position:fixed;left:68px;bottom:12px;z-index:10000}
.balance-stats-anchor--compact .balance-fab{position:static}
.balance-stats-panel{box-sizing:border-box;position:fixed;z-index:10000;width:460px;max-height:min(620px,calc(100vh - 24px));overflow:auto;padding:16px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l2,#d9d9df);border-radius:12px;box-shadow:0 14px 36px rgba(0,0,0,.24)}
.balance-stats-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
.balance-stats-title{margin:0;font-size:16px;line-height:24px;font-weight:700}
.balance-stats-subtitle{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}
.balance-stats-close{width:32px;height:32px;flex:none;border:0;border-radius:8px;color:var(--dsw-alias-label-secondary);background:transparent;font-size:22px;line-height:1;cursor:pointer}
.balance-stats-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.balance-stats-error{padding:12px;border-radius:10px;color:var(--dsw-alias-state-error-primary,#e5484d);background:rgba(229,72,77,.10)}
.balance-stats-loading{padding:48px 12px;text-align:center;color:var(--dsw-alias-label-secondary)}
.balance-stats-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:16px}
.balance-stats-card{min-width:0;padding:11px;border:1px solid var(--dsw-alias-border-l2,#d9d9df);border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.04))}
.balance-stats-card__label{display:block;margin-bottom:6px;color:var(--dsw-alias-label-secondary);font-size:12px}
.balance-stats-card__value{display:block;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
.balance-stats-section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px;font-size:14px;font-weight:650}
.balance-stats-legend{display:flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:400}
.balance-heatmap-wrap{overflow-x:auto;padding:4px 2px 8px}
.balance-heatmap{display:grid;grid-template-rows:repeat(7,14px);grid-auto-flow:column;grid-auto-columns:14px;gap:4px;width:max-content;min-width:100%}
.balance-heatmap-cell{width:14px;height:14px;border-radius:3px;background:rgba(127,127,127,.10)}
.balance-heatmap-cell--1{background:rgba(34,197,94,.25)}
.balance-heatmap-cell--2{background:rgba(34,197,94,.45)}
.balance-heatmap-cell--3{background:rgba(34,197,94,.68)}
.balance-heatmap-cell--4{background:rgba(22,163,74,.95)}
.balance-heatmap-cell--blank{visibility:hidden}
.balance-stats-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;color:var(--dsw-alias-label-secondary);font-size:11px}
.balance-stats-link{padding:7px 12px;border:1px solid var(--dsw-alias-border-l2,#d9d9df);border-radius:8px;color:var(--dsw-alias-label-primary);text-decoration:none;background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.04))}
.balance-stats-link:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
@media(max-width:680px){.balance-stats-panel{max-height:calc(100vh - 68px)}}
/* ── 展开态底部一行：[设置齿轮][余额胶囊]，余额在设置右边 ──
   全部使用稳定锚点，不依赖 CSS Modules hash 类名（DSH 升级后仍有效）：
   - wide 态特征：底部存在 .balance-footer / .balance-topup（收起态渲染 position:fixed 的 .balance-fab，不影响）
   - footArea 改 row；footerActions 占满并把余额推向右端；settingsArea order:-1 排到最左
   - [data-slot] = slot 出口契约（display:contents） */
:has(> :has(> [data-slot="sidebar.footer.action"])):has(.balance-footer, .balance-topup){flex-direction:row;align-items:center;gap:4px}
:has(> :has(> [data-slot="sidebar.footer.action"])):has(.balance-footer, .balance-topup) > :has(> [data-slot="sidebar.footer.action"]){flex:1 1 0;min-width:0;width:auto;flex-direction:row;justify-content:flex-end;align-items:center;gap:4px}
:has(> :has(> [data-slot="sidebar.footer.action"])):has(.balance-footer, .balance-topup) > :has(> [data-slot="sidebar.settings"]){order:-1;flex:0 0 auto;width:32px;min-width:0}
:has(> :has(> [data-slot="sidebar.footer.action"])):has(.balance-footer, .balance-topup) [data-slot="sidebar.settings"] button{width:32px;height:32px;margin:0;padding:0;justify-content:center;border-radius:50%;gap:0}
:has(> :has(> [data-slot="sidebar.footer.action"])):has(.balance-footer, .balance-topup) [data-slot="sidebar.settings"] button span{display:none}
`;

    const tagId = "balance/balance-widget.css";
    if (typeof document !== "undefined") {
      let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]");
      if (tag === null) {
        tag = document.createElement("style");
        tag.dataset.plugin = "balance";
        tag.dataset.pluginCss = tagId;
        document.head.appendChild(tag);
      }
      tag.textContent = css;
    }

    // ─── 价格（与服务端默认保持一致；服务端 /balance-api 返回后会覆盖） ───
    // 2026-08-17 生效的 DeepSeek V4-Flash 空闲时段价（元/百万 tokens）
    const DEFAULT_PRICING = {
      inputCnyPerMillion: 1.5, // 输入（缓存未命中）
      cacheReadCnyPerMillion: 0.05, // 输入（缓存命中）
      cacheWriteCnyPerMillion: 0, // DeepSeek 无缓存写入计费
      outputCnyPerMillion: 4.5, // 输出
    };

    let pricing = DEFAULT_PRICING;
    const pricingListeners = new Set();
    function setPricing(next) {
      if (!next) return;
      pricing = {
        inputCnyPerMillion: Number(next.inputCnyPerMillion ?? DEFAULT_PRICING.inputCnyPerMillion),
        cacheReadCnyPerMillion: Number(next.cacheReadCnyPerMillion ?? DEFAULT_PRICING.cacheReadCnyPerMillion),
        cacheWriteCnyPerMillion: Number(next.cacheWriteCnyPerMillion ?? DEFAULT_PRICING.cacheWriteCnyPerMillion),
        outputCnyPerMillion: Number(next.outputCnyPerMillion ?? DEFAULT_PRICING.outputCnyPerMillion),
      };
      for (const listener of pricingListeners) listener();
    }
    function usePricing() {
      const [, force] = react.useState(0);
      react.useEffect(() => {
        const listener = () => force((n) => n + 1);
        pricingListeners.add(listener);
        return () => pricingListeners.delete(listener);
      }, []);
      // 返回原始目录价（分时段计费时由 computeSplitCost 决定高峰×2）
      return pricing;
    }

    function computeCost(usage, p) {
      const input =
        ((usage.uncachedInputTokens ?? 0) * p.inputCnyPerMillion +
          (usage.cacheReadTokens ?? 0) * p.cacheReadCnyPerMillion +
          (usage.cacheWriteTokens ?? 0) * p.cacheWriteCnyPerMillion) /
        1_000_000;
      const output = ((usage.outputTokens ?? 0) * p.outputCnyPerMillion) / 1_000_000;
      return input + output;
    }

    /** 分时段金额：优先按服务端已标注的各模型 cost 累加（byModel）；
     *  无 byModel 时回退到旧的单模型逻辑：高峰桶按目录价 ×2、空闲桶按目录价（兼容子代理/旧数据）。 */
    function computeSplitCost(usage, p) {
      if (Array.isArray(usage.byModel) && usage.byModel.length > 0) {
        let total = 0;
        for (const b of usage.byModel) {
          total += typeof b.cost === "number" && Number.isFinite(b.cost) ? b.cost : computeSingleSplitCost(b, p);
        }
        return total;
      }
      return computeSingleSplitCost(usage, p);
    }
    function computeSingleSplitCost(usage, p) {
      const costOf = (u) =>
        ((u.inputTokens ?? 0) * p.inputCnyPerMillion +
          (u.cacheReadTokens ?? 0) * p.cacheReadCnyPerMillion +
          (u.cacheWriteTokens ?? 0) * p.cacheWriteCnyPerMillion) /
          1_000_000 +
        ((u.outputTokens ?? 0) * p.outputCnyPerMillion) / 1_000_000;
      return costOf(usage.peak) * 2 + costOf(usage.offpeak);
    }
      function formatTokens(n) {
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
        if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
        return String(n);
      }

    // ─── 当前会话模型：按模型取价（服务端 /balance-api 按 ?model= 返回对应价格） ───
    let sessionsFace = void 0;
    let currentModel = "";
    const modelListeners = new Set();
    const modelCache = new Map(); // sessionId -> model
    function setCurrentModel(model) {
      if (model === currentModel) return;
      currentModel = model;
      for (const listener of modelListeners) listener();
    }
    function useCurrentModel() {
      const [model, force] = react.useState(currentModel);
      react.useEffect(() => {
        const listener = () => force(currentModel);
        modelListeners.add(listener);
        return () => modelListeners.delete(listener);
      }, []);
      return model;
    }
    /** 通过官方 sessions RPC 解析某会话使用的模型，缓存结果并广播；RPC 拿不到时回退到服务端 detectModel。
     *  只缓存"取到模型"的结果；取到空串不缓存，以便会话后续可能产出模型时能重新解析。 */
    async function resolveSessionModel(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return "";
      if (modelCache.has(sessionId)) {
        const cached = modelCache.get(sessionId);
        if (cached !== "") setCurrentModel(cached);
        return cached;
      }
      let model = "";
      if (sessionsFace !== void 0) {
        try {
          const { result } = await sessionsFace.models({ sessionId });
          model = result && result.ok ? (result.value?.current?.model ?? "") : "";
        } catch {
          model = "";
        }
      }
      // 回退：服务端 /balance-api?session= 已检测实际模型（遍历会话事件）
      if (model === "") model = await fetchServerModel(sessionId);
      if (model !== "") modelCache.set(sessionId, model);
      if (model !== "") setCurrentModel(model);
      return model;
    }
    /** 请求服务端按会话检测模型（等价于 /balance-api?session= 返回的 model 字段），失败返回 "". */
    async function fetchServerModel(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return "";
      try {
        const res = await fetch("/balance-api?session=" + encodeURIComponent(sessionId));
        if (!res.ok) return "";
        const data = await res.json();
        return data && data.ok && typeof data.model === "string" ? data.model : "";
      } catch {
        return "";
      }
    }
    function balanceApiUrl() {
      return currentModel === "" ? "/balance-api" : "/balance-api?model=" + encodeURIComponent(currentModel);
    }
    /** 拉取余额 + 按当前模型计算的定价；成功后广播 pricing。 */
    async function fetchBalanceData(controller) {
      const res = await fetch(balanceApiUrl(), { signal: controller && controller.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (data && data.ok) {
        if (data.pricing) setPricing(data.pricing);
        return data;
      }
      throw new Error((data && data.error) || "余额查询失败");
    }

    /** 拉取指定会话的分时段 usage 及子代理 usage（/balance-api?session=...），失败返回 null。 */
    async function fetchSessionUsage(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return null;
      try {
        const res = await fetch("/balance-api?session=" + encodeURIComponent(sessionId));
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || !data.ok) return null;
        return {
          usage: data.usage || null,
          subagentUsage: data.subagentUsage || null,
        };
      } catch {
        return null;
      }
    }

    // ─── 高峰/空闲时段（纯客户端判断，无需服务端） ────────────────────────
    // V4 峰谷定价（2026-08-17 生效）：高峰价 = 空闲价 × 2。
    // 官方高峰窗口（北京时间）为 周一至周五 09:00-12:00、14:00-18:00；周末全天空闲。
    const PEAK_WINDOWS = [
      { start: 9, end: 12 },
      { start: 14, end: 18 },
    ];
    const PEAK_WEEKDAYS = [1, 2, 3, 4, 5]; // 1=周一 … 5=周五，0/6=周末
    function currentPeriod() {
      const d = new Date(Date.now() + 8 * 60 * 60 * 1000); // 北京时间
      const hour = d.getUTCHours();
      const weekday = d.getUTCDay(); // 0=周日 … 6=周六
      return PEAK_WEEKDAYS.includes(weekday) && PEAK_WINDOWS.some((w) => hour >= w.start && hour < w.end)
        ? "peak"
        : "offpeak";
    }
    /** 按当前时段调整价格：高峰 ×2、空闲原价。注意：若服务端已配 config.peak:true
     *  （强制高峰价翻倍），此处会再乘一次，两种方式不要同时使用。 */
    function periodAdjustedPricing(p) {
      if (currentPeriod() !== "peak") return p;
      return {
        inputCnyPerMillion: p.inputCnyPerMillion * 2,
        cacheReadCnyPerMillion: p.cacheReadCnyPerMillion * 2,
        cacheWriteCnyPerMillion: p.cacheWriteCnyPerMillion * 2,
        outputCnyPerMillion: p.outputCnyPerMillion * 2,
      };
    }

    // ─── 余额数据：模块级共享缓存 + 60s 轮询 ──────────────────────────────
    // 切换会话时 header 组件会重新挂载，若每个实例各自拉取会先消失再出现（闪烁）；
    // 缓存全局存一份，任何实例挂载都直接读缓存，无需重新请求。
    let balanceCache = { status: "loading", balance: null, error: null, refreshing: false };
    let balancePollTimer = null;
    const balanceListeners = new Set();

    function emitBalance() {
      for (const listener of balanceListeners) listener();
    }

    // 防抖/防并发：同一时刻只允许一个余额请求；两次刷新间隔不小于 800ms。
    // 疯狂右键/轮询/对话刷新并发时自动合并，避免打爆 DeepSeek API。
    let balanceFetchInFlight = false;
    let lastBalanceFetchAt = 0;
    const BALANCE_REFRESH_MIN_INTERVAL = 800;

    async function fetchBalanceOnce() {
      const now = Date.now();
      if (balanceFetchInFlight || now - lastBalanceFetchAt < BALANCE_REFRESH_MIN_INTERVAL) return;
      lastBalanceFetchAt = now;
      balanceFetchInFlight = true;
      try {
        const data = await fetchBalanceData();
        balanceCache = { status: "ready", balance: data.balance, error: null, refreshing: false };
      } catch (error) {
        balanceCache = { status: "error", balance: null, error: error && error.message ? error.message : String(error), refreshing: false };
      } finally {
        balanceFetchInFlight = false;
      }
      emitBalance();
    }

    function ensureBalancePolling() {
      if (balancePollTimer !== null) return;
      fetchBalanceOnce();
      balancePollTimer = setInterval(fetchBalanceOnce, 60_000);
    }

    function useBalance() {
      const [, force] = react.useState(0);
      react.useEffect(() => {
        const listener = () => force((n) => n + 1);
        balanceListeners.add(listener);
        ensureBalancePolling();
        return () => balanceListeners.delete(listener);
      }, []);
      return balanceCache;
    }

    // 右键余额：阻止默认菜单、立即显示"刷新中"反馈（防止连按），并触发刷新（防抖合并）。
    // 仅当本次点击真的会发起请求时才显示反馈，避免被防抖合并的点击留下悬挂的"刷新中"状态。
    function onBalanceContextMenu(event) {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      const now = Date.now();
      const willFetch = !balanceFetchInFlight && now - lastBalanceFetchAt >= BALANCE_REFRESH_MIN_INTERVAL;
      if (willFetch && !balanceCache.refreshing) {
        balanceCache = { ...balanceCache, refreshing: true };
        emitBalance();
      }
      fetchBalanceOnce();
    }

    async function fetchUsageStats(signal) {
      const res = await fetch("/balance-api?stats=1", { signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!data || !data.ok) throw new Error((data && data.error) || "统计加载失败");
      if (!data.stats) throw new Error(data.statsError || "暂无可用的会话统计");
      return data;
    }

    function StatsCard({ label, value }) {
      return jsx.jsxs("div", {
        className: "balance-stats-card",
        children: [
          jsx.jsx("span", { className: "balance-stats-card__label", children: label }),
          jsx.jsx("span", { className: "balance-stats-card__value", title: value, children: value }),
        ],
      });
    }

    function UsageStatsPanel({ onClose, panelRef, style }) {
      const [state, setState] = react.useState({ loading: true, data: null, error: "" });
      react.useEffect(() => {
        const controller = new AbortController();
        fetchUsageStats(controller.signal).then(
          (data) => setState({ loading: false, data, error: "" }),
          (error) => {
            if (controller.signal.aborted) return;
            setState({ loading: false, data: null, error: error && error.message ? error.message : String(error) });
          },
        );
        return () => controller.abort();
      }, []);
      react.useEffect(() => {
        const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
      }, [onClose]);

      const data = state.data;
      const stats = data && data.stats;
      const days = stats && Array.isArray(stats.days) ? stats.days : [];
      const maxTokens = Math.max(0, ...days.map((day) => Number(day.totalTokens || 0)));
      const firstDay = days[0] && days[0].date;
      const leading = firstDay ? (new Date(firstDay + "T00:00:00Z").getUTCDay() + 6) % 7 : 0;
      const heatmap = [];
      for (let i = 0; i < leading; i++) {
        heatmap.push(jsx.jsx("span", { className: "balance-heatmap-cell balance-heatmap-cell--blank" }, "blank-" + i));
      }
      for (const day of days) {
        const tokens = Number(day.totalTokens || 0);
        const ratio = maxTokens > 0 ? tokens / maxTokens : 0;
        const level = tokens === 0 ? 0 : ratio <= 0.25 ? 1 : ratio <= 0.5 ? 2 : ratio <= 0.75 ? 3 : 4;
        const title = day.date + "\nToken：" + formatTokens(tokens) + "\n费用：¥" + Number(day.cost || 0).toFixed(4) + "\n会话：" + Number(day.sessions || 0);
        heatmap.push(jsx.jsx("span", {
          className: "balance-heatmap-cell" + (level > 0 ? " balance-heatmap-cell--" + level : ""),
          title,
          "aria-label": title,
        }, day.date));
      }
      const balance = data && data.balance;
      const total = stats && stats.total;
      const balanceText = balance
        ? String(balance.total_balance ?? "0.00") + " " + String(balance.currency || "CNY")
        : "不可用";
      const body = state.loading
        ? jsx.jsx("div", { className: "balance-stats-loading", children: "正在汇总会话记录…" })
        : state.error
          ? jsx.jsx("div", { className: "balance-stats-error", children: state.error })
          : jsx.jsxs(jsx.Fragment, {
              children: [
                data.balanceError ? jsx.jsx("div", { className: "balance-stats-error", children: "余额：" + data.balanceError }) : null,
                jsx.jsxs("div", {
                  className: "balance-stats-cards",
                  children: [
                    jsx.jsx(StatsCard, { label: "账户余额", value: balanceText }),
                    jsx.jsx(StatsCard, { label: "90 天计费 Token", value: formatTokens(Number(total?.totalTokens || 0)) }),
                    jsx.jsx(StatsCard, { label: "90 天估算费用", value: "¥" + Number(total?.cost || 0).toFixed(4) }),
                    jsx.jsx(StatsCard, { label: "已扫描会话", value: String(stats?.scannedSessions || 0) }),
                  ],
                }),
                jsx.jsxs("div", {
                  className: "balance-stats-section-title",
                  children: [
                    jsx.jsx("span", { children: "近 90 天使用热力图" }),
                    jsx.jsxs("span", {
                      className: "balance-stats-legend",
                      children: ["少", 0, 1, 2, 3, 4].map((item, index) => index === 0
                        ? item
                        : jsx.jsx("i", { className: "balance-heatmap-cell balance-heatmap-cell--" + item }, "legend-" + item)).concat(["多"]),
                    }),
                  ],
                }),
                jsx.jsx("div", { className: "balance-heatmap-wrap", children: jsx.jsx("div", { className: "balance-heatmap", children: heatmap }) }),
                jsx.jsxs("div", {
                  className: "balance-stats-footer",
                  children: [
                    jsx.jsx("span", {
                      children: stats?.limited
                        ? "为保证性能，仅统计最近 200 个会话；结果缓存 5 分钟。"
                        : "按北京时间和实际模型峰谷价格估算；结果缓存 5 分钟。",
                    }),
                    jsx.jsx("a", {
                      className: "balance-stats-link",
                      href: "https://platform.deepseek.com/usage",
                      target: "_blank",
                      rel: "noreferrer",
                      children: "查看官方用量",
                    }),
                  ],
                }),
              ],
            });
      return jsx.jsxs("section", {
        ref: panelRef,
        style,
        className: "balance-stats-panel",
        role: "dialog",
        "aria-label": "余额与使用统计",
        children: [
          jsx.jsxs("header", {
            className: "balance-stats-header",
            children: [
              jsx.jsxs("div", {
                children: [
                  jsx.jsx("h2", { className: "balance-stats-title", children: "余额与使用统计" }),
                  jsx.jsx("p", { className: "balance-stats-subtitle", children: "余额快捷菜单 · 双击打开 DeepSeek API 用量页" }),
                ],
              }),
              jsx.jsx("button", { className: "balance-stats-close", type: "button", onClick: onClose, "aria-label": "关闭", children: "×" }),
            ],
          }),
          body,
        ],
      });
    }

    function WalletIcon() {
      return jsx.jsxs("svg", {
        width: 16,
        height: 16,
        viewBox: "0 0 24 24",
        fill: "none",
        xmlns: "http://www.w3.org/2000/svg",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
        children: [
          jsx.jsx("path", { d: "M21 12V7H5a2 2 0 0 1 0-4h14v4" }),
          jsx.jsx("path", { d: "M3 5v14a2 2 0 0 0 2 2h16v-5" }),
          jsx.jsx("path", { d: "M18 12a2 2 0 0 0 0 4h4v-4Z" }),
        ],
      });
    }

    // ─── 余额显示：单击统计，双击 DeepSeek 用量页，右键刷新 ─────────────
    function BalanceFooter({ wide }) {
      const state = useBalance();
      const [statsOpen, setStatsOpen] = react.useState(false);
      const [statsPosition, setStatsPosition] = react.useState({ left: 12, bottom: 56, width: 460 });
      const clickTimer = react.useRef(null);
      const anchorRef = react.useRef(null);
      const panelRef = react.useRef(null);
      react.useEffect(() => () => {
        if (clickTimer.current !== null) clearTimeout(clickTimer.current);
      }, []);
      react.useEffect(() => {
        if (!statsOpen) return undefined;
        const closeOnOutsideClick = (event) => {
          if (anchorRef.current && anchorRef.current.contains(event.target)) return;
          if (panelRef.current && panelRef.current.contains(event.target)) return;
          setStatsOpen(false);
        };
        const closeOnResize = () => setStatsOpen(false);
        document.addEventListener("mousedown", closeOnOutsideClick);
        window.addEventListener("resize", closeOnResize);
        return () => {
          document.removeEventListener("mousedown", closeOnOutsideClick);
          window.removeEventListener("resize", closeOnResize);
        };
      }, [statsOpen]);
      const openStats = (event) => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        if (clickTimer.current !== null) clearTimeout(clickTimer.current);
        const trigger = event && event.currentTarget;
        if (trigger && typeof trigger.getBoundingClientRect === "function") {
          const rect = trigger.getBoundingClientRect();
          const width = Math.max(1, Math.min(460, window.innerWidth - 24));
          const desiredLeft = wide ? rect.right + 8 : rect.left;
          const left = Math.max(12, Math.min(desiredLeft, window.innerWidth - width - 12));
          const bottom = wide
            ? Math.max(12, window.innerHeight - rect.bottom)
            : Math.max(12, window.innerHeight - rect.top + 8);
          setStatsPosition({ left, bottom, width });
        }
        clickTimer.current = setTimeout(() => {
          clickTimer.current = null;
          setStatsOpen(true);
        }, 230);
      };
      const openUsagePage = (event) => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        if (clickTimer.current !== null) clearTimeout(clickTimer.current);
        clickTimer.current = null;
        setStatsOpen(false);
        window.open("https://platform.deepseek.com/usage", "_blank", "noopener");
      };
      const interactions = {
        onClick: openStats,
        onDoubleClick: openUsagePage,
        onContextMenu: onBalanceContextMenu,
        title: "单击查看余额与使用统计，双击打开 DeepSeek API 用量页，右键刷新",
      };
      const withPanel = (node) => jsx.jsxs("div", {
        ref: anchorRef,
        className: "balance-stats-anchor balance-stats-anchor--" + (wide ? "wide" : "compact"),
        children: [
          node,
          statsOpen ? reactDom.createPortal(jsx.jsx(UsageStatsPanel, {
            onClose: () => setStatsOpen(false),
            panelRef,
            style: statsPosition,
          }), document.body) : null,
        ],
      });

      if (!wide) {
        if (state.status === "error" || !state.balance) return null;
        const b = state.balance;
        const total = Number.parseFloat(b.total_balance ?? "0");
        const depleted = b.is_available === false || !Number.isFinite(total) || total <= 0;
        if (depleted) {
          return jsx.jsx("a", {
            className: "balance-fab balance-fab-dark",
            href: "https://platform.deepseek.com/top_up",
            target: "_blank",
            rel: "noreferrer",
            onContextMenu: onBalanceContextMenu,
            children: "去充值",
          });
        }
        return withPanel(jsx.jsx("a", {
          className: "balance-fab",
          href: "https://platform.deepseek.com/usage",
          ...interactions,
          children: "¥" + b.total_balance,
        }));
      }

      if (state.status === "error") {
        return withPanel(jsx.jsx("div", {
          className: "balance-footer",
          ...interactions,
          children: jsx.jsx("span", { className: "balance-footer__error", children: "余额查询失败" }),
        }));
      }
      if (!state.balance) {
        return withPanel(jsx.jsx("div", { className: "balance-footer", ...interactions, children: "余额加载中…" }));
      }

      const b = state.balance;
      const total = Number.parseFloat(b.total_balance ?? "0");
      const depleted = b.is_available === false || !Number.isFinite(total) || total <= 0;
      const currency = b.currency || "CNY";
      const totalText = b.total_balance + " " + currency;
      if (depleted) {
        return withPanel(jsx.jsxs("div", {
          className: "balance-footer",
          ...interactions,
          children: [
            jsx.jsx("span", { className: "balance-footer__icon", children: jsx.jsx(WalletIcon, {}) }),
            jsx.jsx("span", { className: "balance-footer__label", children: "余额" }),
            jsx.jsx("a", {
              className: "balance-footer__topup",
              href: "https://platform.deepseek.com/top_up",
              target: "_blank",
              rel: "noreferrer",
              onClick: (event) => event.stopPropagation(),
              onDoubleClick: (event) => event.stopPropagation(),
              onContextMenu: onBalanceContextMenu,
              children: "去充值",
            }),
          ],
        }));
      }

      const period = currentPeriod();
      const low = total > 0 && total < 10;
      return withPanel(jsx.jsxs("div", {
        className: "balance-footer",
        ...interactions,
        children: [
          jsx.jsx("span", { className: "balance-footer__icon", children: jsx.jsx(WalletIcon, {}) }),
          jsx.jsx("span", { className: "balance-footer__label", children: "余额" }),
          jsx.jsxs("span", {
            className: "balance-footer__value" + (low ? " balance-footer__value--low" : " balance-footer__value--healthy"),
            children: [
              totalText,
              " • ",
              state.refreshing
                ? jsx.jsx("span", { className: "balance-footer__period-inline balance-footer__period-inline--refreshing", children: "刷新中…" })
                : jsx.jsx("span", { className: "balance-footer__period-inline balance-footer__period-inline--" + period, children: period === "peak" ? "高峰" : "空闲" }),
            ],
          }),
        ],
      }));
    }

    // ─── 当前会话消耗：输入区 dock ──────────────────────────────────────────
function UsageCostLine({ useProjection, sessionId }) {
      const p = usePricing();
      const model = useCurrentModel();
      const usage = typeof useProjection === "function" ? useProjection("tokenUsage") : undefined;
      const [splitUsage, setSplitUsage] = react.useState(null);
      const [subagentUsage, setSubagentUsage] = react.useState(null);
      const [splitReady, setSplitReady] = react.useState(false);

      // 会话 token 总量（未缓存输入 + 缓存读/写 + 输出）；为 0 时代表还没有消耗。
      const usageKey = usage
        ? (usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) + (usage.outputTokens ?? 0)
        : 0;

      // 解析本会话使用的模型，并按模型刷新定价（/balance-api?model=...）
      // 依赖 [sessionId, usageKey]：切对话或会话内容推进（新消息）都会触发；若还没解析到模型则总是重试。
      react.useEffect(() => {
        let disposed = false;
        resolveSessionModel(sessionId).then((resolved) => {
          if (disposed || resolved === "") return;
          fetchBalanceData().catch(() => {});
        });
        return () => {
          disposed = true;
        };
      }, [sessionId, usageKey]);

      // 会话 token 总量变化（新消息/新消耗）时，拉取服务端分时段 usage，跨时段精确计费
      // 同时"对话完成"即刷新一次余额（token 变化 = 一条新回复落库）
      react.useEffect(() => {
        if (usageKey === 0) return;
        let disposed = false;
        fetchSessionUsage(sessionId).then((u) => {
          if (disposed) return;
          if (u) {
            setSplitUsage(u.usage);
            setSubagentUsage(u.subagentUsage);
          }
          setSplitReady(true);
        });
        fetchBalanceData().catch(() => {});
        return () => {
          disposed = true;
        };
      }, [sessionId, usageKey]);

      if (!usage) return null;

      const uncachedInput = usage.uncachedInputTokens ?? 0;
      const cacheRead = usage.cacheReadTokens ?? 0;
      const cacheWrite = usage.cacheWriteTokens ?? 0;
      const output = usage.outputTokens ?? 0;
      // 新增内容 = 未缓存输入 + 输出（不含缓存重读）
      const newTokens = uncachedInput + output;
      // 计费总量 = 未缓存输入 + 缓存重读/写入 + 输出，与 DeepSeek 账单口径一致
      const billedTotal = uncachedInput + cacheRead + cacheWrite + output;
      if (newTokens === 0 && billedTotal === 0) return null;

      // 金额：优先用服务端分时段 usage（高峰桶×2+空闲桶）；未就绪时按当前时段价估算
      const split = splitReady && splitUsage ? splitUsage : null;
      const cost = split ? computeSplitCost(split, p) : computeCost(usage, periodAdjustedPricing(p));
      const peakTokens = split ? split.peak.inputTokens + split.peak.cacheReadTokens + split.peak.cacheWriteTokens + split.peak.outputTokens : 0;
      const offpeakTokens = split ? split.offpeak.inputTokens + split.offpeak.cacheReadTokens + split.offpeak.cacheWriteTokens + split.offpeak.outputTokens : 0;

      // 子代理消耗（与主会话分开，同样跨时段精确计费）
      const hasSubagent = splitReady && subagentUsage && subagentUsage.totalTokens > 0;
      const subCost = hasSubagent ? computeSplitCost(subagentUsage, p) : 0;
      const subNewTokens = hasSubagent
        ? (subagentUsage.inputTokens ?? 0) + (subagentUsage.outputTokens ?? 0)
        : 0;
      const subCount = hasSubagent ? (subagentUsage.sessions ?? 0) : 0;

      const detailLines = [
        "模型：" + (model || "未知（按 deepseek-v4-flash 价估算）"),
        "新增：" + formatTokens(newTokens) + " tokens（未缓存输入 " + formatTokens(uncachedInput) + " + 输出 " + formatTokens(output) + "）",
        "计费：" + formatTokens(billedTotal) + " tokens（含缓存重读 " + formatTokens(cacheRead) + "、缓存写入 " + formatTokens(cacheWrite) + "）",
      ];
      if (split) {
        detailLines.push(
          "时段拆分：高峰 " + formatTokens(peakTokens) + " tokens + 空闲 " + formatTokens(offpeakTokens) + " tokens",
          "估算金额：¥" + cost.toFixed(4) + "（高峰桶按目录价×2、空闲桶按目录价）",
        );
      } else {
        detailLines.push("估算金额：¥" + cost.toFixed(4) + "（按当前时段价估算）");
      }
      if (hasSubagent) {
        const subPeak = subagentUsage.peak.inputTokens + subagentUsage.peak.cacheReadTokens + subagentUsage.peak.cacheWriteTokens + subagentUsage.peak.outputTokens;
        const subOff = subagentUsage.offpeak.inputTokens + subagentUsage.offpeak.cacheReadTokens + subagentUsage.offpeak.cacheWriteTokens + subagentUsage.offpeak.outputTokens;
        detailLines.push(
          "子代理消耗：新增 " + formatTokens(subNewTokens) + " tokens、计费 " + formatTokens(subagentUsage.totalTokens) + " tokens（" + subCount + " 个子代理）",
          "子代理金额：¥" + subCost.toFixed(4) + "（高峰桶×2、空闲桶按目录价）",
        );
      }
      const children = [
        jsx.jsx("span", { children: "本会话消耗" }),
        jsx.jsx("span", { children: jsx.jsx("strong", { children: formatTokens(newTokens) + " tokens" }) }),
      ];
      if (billedTotal > newTokens) {
        children.push(jsx.jsx("span", { children: "计费 " + formatTokens(billedTotal) }));
      }
      children.push(jsx.jsxs("span", { children: ["≈ ", jsx.jsx("strong", { children: "¥" + cost.toFixed(4) })] }));
      if (hasSubagent) {
        children.push(jsx.jsx("span", { children: "子代理 +" + formatTokens(subNewTokens) + " ≈ ¥" + subCost.toFixed(4) }));
      }
      return jsx.jsx(primitives.Tooltip, {
        label: detailLines.join("\n"),
        side: "top",
        delayMs: 300,
        children: jsx.jsxs("div", {
          className: "balance-usage-line",
          children,
        }),
      });
    }

    // ─── 插件主体 ───────────────────────────────────────────────────────────
    const inject = ["slots", "sessions"];

    function apply(ctx) {
      // 拿到 sessions 服务，用于解析当前会话使用的模型（按模型取价）
      sessionsFace = ctx.sessions;
      // 余额显示：展开态底部胶囊（order 20 排在市场 10 之后、紧挨设置）；收起态悬浮 FAB
      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register(
          {
            name: "sidebar.footer.action",
            id: "balance",
            order: 20,
          },
          BalanceFooter,
        ),
      );

      // 对话统计区（对话框下方）的会话消耗行
      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register(
          {
            name: "conversation.composer.dock",
            id: "balance-usage",
            order: 30,
          },
          UsageCostLine,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
