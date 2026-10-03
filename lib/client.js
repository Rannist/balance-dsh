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
/* ── 收起态：圆形悬浮 FAB（组件里 portal 到 body，绕开收起态 footArea 的 display:none） ──
   liquid glass：半透明底 + backdrop-filter 模糊下层界面 + 顶部高光内阴影 + 柔和外投影。
   backdrop-filter 要求自身背景半透明才出效果，所以底色用 color-mix 掺透明，
   并保留主题变量（深/浅色主题都能跟着走）。
   ⚠️ 必须显式写 corner-shape:round：DSH 主题包（dsh-client-ui-theme）里有一条
   *,:before,:after{corner-shape:var(--dsw-corner-shape)}，而 --dsw-corner-shape
   默认是 superellipse(1.5)——不覆盖的话 border-radius:50% 会被渲染成"圆角方形"
   （squircle），根本不是圆（2026-09-28 用户反馈「很奇怪啊」，截图是 squircle）。
   DSH 自己的 .pill 也是这么显式写 corner-shape:round 抵消的。 */
.balance-fab{box-sizing:border-box;position:fixed;left:44px;bottom:12px;z-index:9998;width:60px;height:60px;padding:0;border-radius:50%;corner-shape:round;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.01em;text-decoration:none;white-space:nowrap;overflow:hidden;cursor:pointer;pointer-events:auto;background:color-mix(in srgb,var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-base,#1b1b1c)) 58%,transparent);-webkit-backdrop-filter:blur(18px) saturate(180%);backdrop-filter:blur(18px) saturate(180%);border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 26%,transparent),inset 0 -1px 1px color-mix(in srgb,#fff 8%,transparent),0 6px 20px rgba(0,0,0,.28);transition:transform .18s var(--ds-ease-in-out,ease-out),background .18s var(--ds-ease-in-out,ease-out),box-shadow .18s var(--ds-ease-in-out,ease-out)}
.balance-fab:hover{transform:scale(1.06);background:color-mix(in srgb,var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-base,#1b1b1c)) 76%,transparent);box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 34%,transparent),inset 0 -1px 1px color-mix(in srgb,#fff 10%,transparent),0 10px 26px rgba(0,0,0,.34)}
.balance-fab:active{transform:scale(.95)}
/* 金额偏长时（如 ¥1234.56）自动收一号字，免得 60px 圆里挤爆 */
.balance-fab--dense{font-size:11px;letter-spacing:-.03em}
.balance-fab-dark{color:#fff;background:color-mix(in srgb,#e5484d 62%,transparent);border-color:color-mix(in srgb,#fff 22%,transparent)}
.balance-fab-dark:hover{background:color-mix(in srgb,#e5484d 78%,transparent)}
/* ── 消耗行 pill：规格逐条照抄 DSH 原生 StatsPills 的 .pill（_091hzG_pill）── */
.balance-usage-wrap{min-width:0;display:inline-flex}
.balance-usage-line{box-sizing:border-box;corner-shape:round;max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);font-variant-numeric:tabular-nums;line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;background:0 0;border:none;border-radius:999px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer;transition:background .15s var(--ds-ease-in-out,.2s)}
.balance-usage-line svg{flex:none;width:14px;height:14px}
.balance-usage-line:hover,.balance-usage-line[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-secondary)}
.balance-usage-label{text-overflow:ellipsis;min-width:0;overflow:hidden}
/* ── 消耗明细浮层：规格照抄 DSH 原生「会话统计」面板（.HS2XBG_panel/.title/.titleRule/.details）── */
.balance-usage-panel{box-sizing:border-box;position:fixed;z-index:1100;border:0;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-module-platform,#242526));width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);backdrop-filter:var(--dsw-menu-backdrop-filter,none);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.32));color:var(--dsw-alias-label-secondary);cursor:default;padding:16px;font-size:12px;line-height:18px;animation:balance-stats-panel-in .12s var(--ds-ease-in-out,ease-out) both}
.balance-usage-panel__title{display:flex;justify-content:space-between;gap:16px;margin-bottom:8px;color:var(--dsw-alias-label-primary);font-weight:500}
.balance-usage-panel__title--second{margin-top:16px}
.balance-usage-panel__rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}
.balance-usage-panel__value{font-variant-numeric:tabular-nums}
.balance-usage-panel__label{display:inline-flex;align-items:center;gap:6px;min-width:0}
.balance-usage-panel__label svg{flex:none;width:14px;height:14px}
.balance-usage-panel__details{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;color:var(--dsw-alias-label-tertiary)}
.balance-usage-panel__details dt,.balance-usage-panel__details dd{min-width:0;margin:0}
.balance-usage-panel__details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}
/* ── 跨会话统计浮层（余额元素的子级，向右/向上展开） ── */
.balance-stats-anchor{position:relative;display:flex;min-width:0;overflow:visible}
.balance-stats-anchor--wide{width:100%}
.balance-stats-anchor--compact{position:fixed;left:44px;bottom:12px;z-index:9998}
.balance-stats-anchor--compact .balance-fab{position:static}
.balance-stats-layer{box-sizing:border-box;position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24));backdrop-filter:var(--dsw-mask-blur,blur(2px));-webkit-backdrop-filter:var(--dsw-mask-blur,blur(2px));animation:balance-stats-backdrop-in .16s var(--ds-ease-in-out,ease-out) both}
.balance-stats-layer--closing{pointer-events:none;animation:balance-stats-backdrop-out .14s var(--ds-ease-in-out,ease-in) both}
.balance-stats-panel{box-sizing:border-box;position:relative;z-index:10000;width:min(800px,100%);max-height:100%;overflow-x:hidden;overflow-y:auto;scrollbar-gutter:stable;padding:0 0 24px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff));border:0;border-radius:24px;box-shadow:var(--dsw-elevation-prominent,0 14px 36px rgba(0,0,0,.24));transform-origin:center center;will-change:transform,opacity;contain:layout style;animation:balance-stats-panel-in .26s var(--ds-ease-in-out,ease-out) .04s both;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2,rgba(127,127,127,.35));--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2,rgba(127,127,127,.55))}
/* 滚动条对齐 DSH 设置窗口：宽度 12px，滑块靠 transparent 边框内缩到 4px（永远不贴 24px 圆角），
   轨道上下各留 10px，颜色沿用 DSH 自己的 --dsh-scrollbar-thumb 变量。 */
.balance-stats-panel::-webkit-scrollbar{width:12px;height:12px}
.balance-stats-panel::-webkit-scrollbar-track{background:transparent;margin:10px}
.balance-stats-panel::-webkit-scrollbar-thumb{border:4px solid transparent;background-clip:padding-box;border-radius:6px;background-color:var(--dsh-scrollbar-thumb)}
.balance-stats-panel::-webkit-scrollbar-thumb:hover{background-color:var(--dsh-scrollbar-thumb-hover)}
.balance-stats-panel::-webkit-scrollbar-corner{background:transparent}
@keyframes balance-stats-backdrop-in{from{opacity:0}to{opacity:1}}
@keyframes balance-stats-backdrop-out{from{opacity:1}to{opacity:0}}
.balance-stats-panel--closing{pointer-events:none;animation:balance-stats-panel-out .14s var(--ds-ease-in-out,ease-in) both}
@keyframes balance-stats-panel-in{from{opacity:0;transform:translateY(18px) scale(.955)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes balance-stats-panel-out{from{opacity:1;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(6px) scale(.985)}}
.balance-stats-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:22px 14px 12px 24px}
.balance-stats-body{display:flex;flex-direction:column;min-width:0;padding:0 24px}
.balance-stats-title{margin:0;font-size:16px;line-height:24px;font-weight:500}
.balance-stats-subtitle{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}
.balance-stats-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:8px;color:var(--dsw-alias-label-secondary);background:transparent;font-size:22px;line-height:1;cursor:pointer}
.balance-stats-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.balance-stats-error{padding:12px;border-radius:10px;color:var(--dsw-alias-state-error-primary,#e5484d);background:rgba(229,72,77,.10)}
.balance-stats-loading{padding:48px 12px;text-align:center;color:var(--dsw-alias-label-secondary)}
.balance-stats-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-bottom:8px}
.balance-stats-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:8px}
/* 分组数为奇数时（「按模型」「时段拆分」条件渲染可能缺席），最后一个横跨整行，避免半空行 */
.balance-stats-grid>:last-child:nth-child(odd){grid-column:1/-1}
.balance-stats-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:1fr;gap:8px;min-width:0}
.balance-stats-card{display:flex;flex-direction:column;justify-content:center;min-width:0;padding:11px;border:1px solid var(--dsw-alias-border-l2,#d9d9df);border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.04));animation:balance-stats-card-in .2s var(--ds-ease-in-out,ease-out) both}
.balance-stats-card:nth-child(2){animation-delay:.025s}.balance-stats-card:nth-child(3){animation-delay:.05s}.balance-stats-card:nth-child(4){animation-delay:.075s}
@keyframes balance-stats-card-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
.balance-stats-card__label{display:block;margin-bottom:6px;color:var(--dsw-alias-label-secondary);font-size:12px}
.balance-stats-card__value{display:block;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
.balance-stats-heatmap-card{box-sizing:border-box;min-width:0;padding:11px;border:1px solid var(--dsw-alias-border-l2,#d9d9df);border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.04));animation:balance-stats-card-in .22s var(--ds-ease-in-out,ease-out) .08s both}
.balance-stats-section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 8px;font-size:12px;font-weight:600}
.balance-stats-legend{display:flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:400}
.balance-heatmap-wrap{min-width:0;overflow:hidden;padding:4px 2px 8px}
.balance-heatmap{display:grid;grid-template-rows:repeat(7,14px);grid-auto-flow:column;grid-auto-columns:14px;gap:4px;width:max-content;min-width:100%}
.balance-heatmap-cell{display:block;box-sizing:border-box;width:14px;height:14px;padding:0;border:0;border-radius:3px;background:rgba(127,127,127,.10);appearance:none;transition:transform .12s var(--ds-ease-in-out,ease-out),filter .12s var(--ds-ease-in-out,ease-out)}
.balance-heatmap-cell[aria-label]{cursor:default}
.balance-heatmap-cell[aria-label]:hover{transform:scale(1.18);filter:brightness(1.14)}
.balance-heatmap-tooltip{box-sizing:border-box;position:fixed;z-index:10020;max-width:min(300px,calc(100vw - 24px));padding:6px 9px;border:1px solid var(--dsw-alias-border-l2,#45454d);border-radius:6px;background:var(--dsw-alias-bg-module-platform,#27272b);box-shadow:0 6px 18px rgba(0,0,0,.22);color:var(--dsw-alias-label-primary,#f4f4f5);font-size:11px;font-weight:400;line-height:1.45;white-space:nowrap;pointer-events:none;animation:balance-heatmap-tooltip-in .12s var(--ds-ease-in-out,ease-out) both}
.balance-heatmap-tooltip--left{transform:translateY(-100%)}
.balance-heatmap-tooltip--center{transform:translate(-50%,-100%)}
.balance-heatmap-tooltip--right{transform:translateY(-100%)}
@keyframes balance-heatmap-tooltip-in{from{opacity:0}to{opacity:1}}
.balance-heatmap-cell--1{background:rgba(34,197,94,.25)}
.balance-heatmap-cell--2{background:rgba(34,197,94,.45)}
.balance-heatmap-cell--3{background:rgba(34,197,94,.68)}
.balance-heatmap-cell--4{background:rgba(22,163,74,.95)}
.balance-heatmap-cell--blank{visibility:hidden}
.balance-stats-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;color:var(--dsw-alias-label-secondary);font-size:11px}
/* 底部操作区：官方用量 / 去充值走原生平台视口（带平台凭据、无需网页登录）；
   更多账号信息对齐 DSH 原生账号卡片，开平台首页（外部窗口，原生视口只认 usage / top-up） */
.balance-stats-actions{display:flex;flex:none;align-items:center;gap:8px}
.balance-stats-link{padding:7px 12px;border:1px solid var(--dsw-alias-border-l2,#d9d9df);border-radius:8px;color:var(--dsw-alias-label-primary);text-decoration:none;white-space:nowrap;background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.04))}
.balance-stats-link:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.balance-stats-link--primary{border-color:transparent;color:#fff;background:var(--dsw-alias-state-business-primary,#4d6bfe)}
.balance-stats-link--primary:hover{background:var(--dsw-alias-state-business-primary-hover,#3f5ae0)}
.balance-stats-group{box-sizing:border-box;margin-bottom:0;padding:11px;border:1px solid var(--dsw-alias-border-l2,#d9d9df);border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.04));animation:balance-stats-card-in .22s var(--ds-ease-in-out,ease-out) both}
.balance-stats-group__title{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0 0 6px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}
.balance-stats-group__hint{color:var(--dsw-alias-label-secondary);font-weight:400;font-variant-numeric:tabular-nums}
.balance-stats-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;min-width:0;padding:6px 0;font-size:12px}
.balance-stats-row+.balance-stats-row{border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16))}
.balance-stats-row__name{min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap}
.balance-stats-row__value{flex:none;text-align:right;color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
@media(max-width:900px){.balance-stats-top{grid-template-columns:minmax(0,1fr)}.balance-stats-grid{grid-template-columns:minmax(0,1fr)}}
@media(max-width:760px){.balance-stats-layer{padding:10px}}
@media(prefers-reduced-motion:reduce){.balance-stats-panel,.balance-stats-panel--closing,.balance-stats-layer,.balance-stats-layer--closing,.balance-stats-card,.balance-stats-group,.balance-stats-heatmap-card{animation:none}.balance-heatmap-cell{transition:none}}
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
/* ── 插件配置卡片：DSH「插件」页 → balance-dsh 详情页（slot plugins.bundle.config） ──
   用插件自己的稳定类名（不依赖 DSH 的 CSS Modules hash）；主题变量一律带回退值，
   变量缺失时仍然可读，不会变成透明文字。开关/按钮的真圆角要显式 corner-shape:round，
   否则会被 DSH 主题的全局 superellipse 画成方圆角。 */
.balance-settings{box-sizing:border-box;display:flex;flex-direction:column;width:100%;margin:0;padding:16px 18px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-alias-bg-module-platform,transparent)}
.balance-settings__head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.balance-settings__title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.balance-settings__version{font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.balance-settings__desc{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.balance-settings__group{margin:14px 0 0;padding:12px 0 0;border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22))}
.balance-settings__group-title{margin:0 0 2px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.balance-settings__head-btn{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;box-sizing:border-box;padding:0;border:0;background:0 0;font:inherit;text-align:left;cursor:pointer;color:inherit}
.balance-settings__head-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:var(--dsw-radius-sm,6px)}
.balance-settings__head-text{flex:1;min-width:0}
.balance-settings__chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s ease}
.balance-settings[data-open="true"] .balance-settings__chevron{transform:rotate(180deg)}
.balance-settings__body{margin:12px 0 0;padding:12px 0 0;border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22))}
.balance-settings__row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0}
.balance-settings__label{display:flex;flex-direction:column;gap:2px;min-width:0}
.balance-settings__label-text{font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary)}
.balance-settings__hint{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
.balance-settings__control{display:flex;align-items:center;gap:6px;flex:none}
.balance-settings__unit{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.balance-settings__input{box-sizing:border-box;width:92px;height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.35));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.1));color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-variant-numeric:tabular-nums;outline:none}
.balance-settings__input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.balance-settings__input--wide{width:100%;min-width:0}
.balance-settings__toggle{position:relative;box-sizing:border-box;flex:none;width:36px;height:20px;padding:2px;border:none;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3,rgba(127,127,127,.35));cursor:pointer;transition:background .12s ease}
.balance-settings__toggle[aria-checked="true"]{background:var(--dsw-alias-brand-primary,#4d6bfe)}
.balance-settings__toggle::after{content:"";display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-switch-thumb,#fff);transition:transform .12s ease}
.balance-settings__toggle[aria-checked="true"]::after{background:var(--dsw-alias-label-primary-foreground,#fff);transform:translateX(16px)}
.balance-settings__actions{display:flex;align-items:center;gap:8px;margin:14px 0 0;padding:12px 0 0;border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22))}
.balance-settings__status{flex:1;min-width:0;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
.balance-settings__status--error{color:var(--dsw-alias-state-error-primary,#e5484d)}
.balance-settings__status--ok{color:var(--dsw-alias-state-success-primary,#22c55e)}
.balance-settings__btn{box-sizing:border-box;flex:none;padding:5px 14px;border:1px solid transparent;border-radius:var(--dsw-radius-md,8px);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1.5;cursor:pointer;transition:opacity .12s ease,color .12s ease}
.balance-settings__btn:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.balance-settings__btn:disabled{opacity:.4;cursor:default}
.balance-settings__btn--primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.balance-settings__btn--primary:hover:not(:disabled){opacity:.88;color:var(--dsw-alias-bg-layer-3)}
.balance-settings__summary{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
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
    // 北京时间 2026-09-10 12:00 起生效的 DeepSeek V4-Flash 空闲时段价（元/百万 tokens）
    // 注：历史消耗由服务端按当时价格回传 cost；这里的默认值只用于拉不到服务端分桶时的本地估算。
    const DEFAULT_PRICING = {
      inputCnyPerMillion: 1, // 输入（缓存未命中）
      cacheReadCnyPerMillion: 0.02, // 输入（缓存命中）
      cacheWriteCnyPerMillion: 0, // DeepSeek 无缓存写入计费
      outputCnyPerMillion: 4, // 输出
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
     *  无 byModel 时回退到旧的单模型逻辑：高峰桶按目录价 × 倍率、空闲桶按目录价（兼容子代理/旧数据）。
     *  ⚠️ p 必须是**目录价**（服务端 pricing 字段即目录价），倍率由 peakMultiplier 单独给，
     *  否则会与这里的乘法重复翻倍（高峰变 ×4）。 */
    function computeSplitCost(usage, p, multiplier = 2) {
      if (Array.isArray(usage.byModel) && usage.byModel.length > 0) {
        let total = 0;
        for (const b of usage.byModel) {
          total += typeof b.cost === "number" && Number.isFinite(b.cost) ? b.cost : computeSingleSplitCost(b, p, multiplier);
        }
        return total;
      }
      return computeSingleSplitCost(usage, p, multiplier);
    }
    function computeSingleSplitCost(usage, p, multiplier = 2) {
      const costOf = (u, factor) =>
        (((u.inputTokens ?? 0) * p.inputCnyPerMillion +
          (u.cacheReadTokens ?? 0) * p.cacheReadCnyPerMillion +
          (u.cacheWriteTokens ?? 0) * p.cacheWriteCnyPerMillion) /
          1_000_000 +
          ((u.outputTokens ?? 0) * p.outputCnyPerMillion) / 1_000_000) *
        factor;
      return costOf(usage.peak, multiplier) + costOf(usage.offpeak, 1);
    }
      function formatTokens(n) {
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
        if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
        return String(n);
      }

    // ─── 打开 DeepSeek 平台页面（用量 / 充值 / 账号信息） ───────────────────
    // **一律交给系统默认浏览器**（window.open，DSH 的 Electron 主进程会转给 shell.openExternal）。
    // 用户 2026-10-04 明确要求：不要在软件内开网页。
    // 历史（已删除，别再恢复）：曾实现三级策略——① DSH 官方版 preload 暴露的 globalThis.dshPlatform
    // 原生平台视口（自带平台凭据、无需网页登录）② 应用内侧栏浏览器（无凭据，会要求登录）
    // ③ 系统浏览器。原生视口那套覆盖层（openPlatformPage / closePlatformPage /
    // .balance-platform-* 样式）与侧栏浏览器回退都已随本次改动删除。
    const USAGE_URL = "https://platform.deepseek.com/usage";
    const TOP_UP_URL = "https://platform.deepseek.com/top_up";
    // 「更多账号信息」＝ DSH 原生账号卡片同款入口：它用的是 new URL("/", usageUrl).href，
    // 即平台首页（不是某个子页）。原生那个 <a> 没有走原生平台视口（视口只认 usage / top-up），
    // 是直接开外部窗口，所以这里也传 page = null。
    const PLATFORM_HOME_URL = "https://platform.deepseek.com/";

    /**
     * 量出聊天输入卡片（composer card）的垂直中心（视口坐标）。
     * 收起态圆形余额靠它做「垂直中心对齐聊天栏」，所以不写死像素。
     * @returns 中心 y；量不到返回 null，调用方回退到 CSS 的固定 bottom。
     */
    function measureComposerCenterY() {
      if (typeof document === "undefined") return null;
      try {
        const host = document.querySelector('[data-slot="conversation.composer.bar"]');
        if (host) {
          const own = host.getBoundingClientRect();
          if (own.height > 0) return own.top + own.height / 2;
          // slot 出口容器常常是 display:contents（不生成盒子，rect 全 0），
          // 那种情况取后代里面积最大的元素当卡片
          let best = null;
          for (const el of host.querySelectorAll("*")) {
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            if (best === null || rect.width * rect.height > best.width * best.height) best = rect;
          }
          if (best) return best.top + best.height / 2;
        }
        // 再回退到输入元素本身（老版本 DSH 没有 data-slot 标记）
        const editor = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
        if (editor) {
          const rect = editor.getBoundingClientRect();
          if (rect.height > 0) return rect.top + rect.height / 2;
        }
      } catch {
        /* 结构变了就当量不到，交给 CSS 兜底 */
      }
      return null;
    }

    /** 打开外部网页：交给系统默认浏览器。DSH 的 Electron 主进程拦截 window.open
     *  并转给 shell.openExternal，所以这里不会弹出应用内窗口。 */
    function openInSystemBrowser(url) {
      try {
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        /* ignore */
      }
    }

    /** 打开平台页面：一律走系统默认浏览器，不在应用内开原生视口或内嵌浏览器。 */
    function openPlatformOrUrl(page, url) {
      openInSystemBrowser(url);
    }

    /**
     * 外部链接的通用属性：保留 href（可右键复制），点击时拦截默认跳转、改为应用内打开。
     * @param url - 平台页面地址（用作 href 与最终回退目标）。
     * @param page - 原生视口的页面标识；缺省时跳过原生视口（例如非平台链接）。
     * @param extra - 追加的事件处理器等属性。
     */
    function externalLink(url, page, extra) {
      const options = extra || {};
      return {
        href: url,
        target: "_blank",
        rel: "noreferrer",
        ...options,
        onClick: (event) => {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          if (typeof options.onClick === "function") options.onClick(event);
          openPlatformOrUrl(page, url);
        },
      };
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
    // 官方高峰窗口（北京时间）为 工作日 09:00-12:00、14:00-18:00；
    // 周末与法定节假日全天空闲，但「调休上班的周末」按工作日算（2026-09-20 DeepSeek 明确）。
    const PEAK_WINDOWS = [
      { start: 9, end: 12 },
      { start: 14, end: 18 },
    ];
    const PEAK_WEEKDAYS = [1, 2, 3, 4, 5]; // 1=周一 … 5=周五，0/6=周末
    // 中国大陆法定节假日与调休（北京时区）。**必须与 lib/index.js 的 CN_CALENDAR 完全一致**
    // （服务端负责算钱、客户端只负责显示时段标签）。来源：国办发明电〔2025〕7号，每年需补录。
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

    // 节假日自动补录：与 lib/index.js 同源、同逻辑（客户端只用来显示时段标签）。
    // 拉取失败静默 —— 拿不到就继续用上面的内置表。
    const CN_CALENDAR_SOURCE = "https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master";
    const cnCalendarYears = new Set();
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
        // 网络不可用：保留内置表
      }
    }
    {
      const y = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCFullYear();
      void ensureCnCalendar(y - 1);
      void ensureCnCalendar(y);
      void ensureCnCalendar(y + 1);
    }
    function currentPeriod(atMs) {
      const d = new Date((atMs === undefined ? Date.now() : atMs) + 8 * 60 * 60 * 1000); // 北京时间
      const kind = CN_CALENDAR[
        d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0")
      ];
      if (kind === "holiday") return "offpeak"; // 法定节假日：全天按空闲
      const hour = d.getUTCHours();
      const weekday = d.getUTCDay(); // 0=周日 … 6=周六
      const onDuty = PEAK_WEEKDAYS.includes(weekday) || kind === "workday"; // 调休上班的周末按工作日算
      return onDuty && PEAK_WINDOWS.some((w) => hour >= w.start && hour < w.end) ? "peak" : "offpeak";
    }
    /** 按当前时段调整价格：高峰 × 倍率、空闲原价。
     *  ⚠️ p 必须是**目录价**（服务端 pricing 字段即目录价）；倍率来自设置的 peakMultiplier，
     *  若服务端传来的价已含倍率，这里会再乘一次造成金额虚高。 */
    function periodAdjustedPricing(p, multiplier = 2) {
      if (currentPeriod() !== "peak") return p;
      return {
        inputCnyPerMillion: p.inputCnyPerMillion * multiplier,
        cacheReadCnyPerMillion: p.cacheReadCnyPerMillion * multiplier,
        cacheWriteCnyPerMillion: p.cacheWriteCnyPerMillion * multiplier,
        outputCnyPerMillion: p.outputCnyPerMillion * multiplier,
      };
    }

    // ─── 插件设置：与 DSH「插件」页的配置卡片共用同一份 ────────────────────
    // 设置真身在服务端的 <dshHome>/balance-dsh.json（见 lib/index.js），客户端只做
    // 读缓存 + 写提交。默认值与服务端 DEFAULT_SETTINGS 逐字段保持一致：服务端暂时
    // 不可用（例如服务端改动还没重启生效）时 UI 仍按默认值工作，不会白屏或报错。
    const SETTINGS_DEFAULTS = {
      refreshIntervalSec: 60,
      lowBalanceThreshold: 10,
      apiKey: "",
      showBalanceRow: true,
      showUsagePill: true,
      showPeriodLabel: true,
      showFab: true,
      fabSize: 60,
      fabLeft: 44,
      statsSessionLimit: 200,
      statsCacheSec: 300,
      peakMultiplier: 2,
      priceFlash: null,
      pricePro: null,
    };

    let settingsCache = { value: { ...SETTINGS_DEFAULTS }, loaded: false, version: "" };
    const settingsListeners = new Set();
    let settingsInFlight = null;

    function emitSettings() {
      for (const listener of settingsListeners) listener();
    }

    /** 拉一次设置（并发自动合并）；成功后写缓存并通知订阅者。 */
    function fetchSettingsOnce(force) {
      if (settingsInFlight !== null) return settingsInFlight;
      if (!force && settingsCache.loaded) return Promise.resolve(settingsCache.value);
      settingsInFlight = (async () => {
        try {
          const res = await fetch("/balance-api?config=1");
          const data = await res.json();
          if (data && data.ok === true && data.settings) {
            settingsCache = {
              value: { ...SETTINGS_DEFAULTS, ...data.settings },
              loaded: true,
              version: typeof data.version === "string" ? data.version : settingsCache.version,
            };
          }
        } catch {
          // 服务端不可用：保持默认值，不打扰用户
        } finally {
          settingsInFlight = null;
        }
        emitSettings();
        return settingsCache.value;
      })();
      return settingsInFlight;
    }

    /** 提交设置补丁；成功后以服务端回传的完整设置为准（服务端会做校验与夹紧）。 */
    async function saveSettings(patch) {
      const res = await fetch("/balance-api?config=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { ...settingsCache.value, ...patch } }),
      });
      const data = await res.json();
      if (!data || data.ok !== true) throw new Error((data && data.error) || "保存失败");
      settingsCache = {
        value: { ...SETTINGS_DEFAULTS, ...data.settings },
        loaded: true,
        version: typeof data.version === "string" ? data.version : settingsCache.version,
      };
      emitSettings();
      return settingsCache.value;
    }

    /** 订阅设置（首次挂载异步拉一次）。 */
    function useSettings() {
      const [, force] = react.useState(0);
      react.useEffect(() => {
        const listener = () => force((n) => n + 1);
        settingsListeners.add(listener);
        void fetchSettingsOnce(false);
        return () => settingsListeners.delete(listener);
      }, []);
      return settingsCache.value;
    }

    // ─── 余额数据：模块级共享缓存 + 轮询（间隔取自 refreshIntervalSec） ────
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

    // 轮询间隔由设置 refreshIntervalSec 决定：间隔变了要重建定时器。
    let balancePollIntervalSec = 0;

    function ensureBalancePolling() {
      const raw = Number(settingsCache.value.refreshIntervalSec);
      const sec = Number.isFinite(raw) && raw > 0 ? raw : 60;
      if (balancePollTimer !== null && balancePollIntervalSec === sec) return;
      if (balancePollTimer !== null) {
        clearInterval(balancePollTimer);
        balancePollTimer = null;
      }
      balancePollIntervalSec = sec;
      fetchBalanceOnce();
      balancePollTimer = setInterval(fetchBalanceOnce, sec * 1000);
    }

    function useBalance() {
      const [, force] = react.useState(0);
      react.useEffect(() => {
        // 余额变化 → 重渲染；设置变化 → 重渲染并按新间隔重建轮询
        const listener = () => {
          force((n) => n + 1);
          ensureBalancePolling();
        };
        balanceListeners.add(listener);
        settingsListeners.add(listener);
        void fetchSettingsOnce(false);
        ensureBalancePolling();
        return () => {
          balanceListeners.delete(listener);
          settingsListeners.delete(listener);
        };
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

    const USAGE_STATS_CACHE_TTL = 5 * 60_000;
    let usageStatsCache = null;
    let usageStatsCacheAt = 0;
    let usageStatsInFlight = null;

    function getCachedUsageStats() {
      return usageStatsCache && Date.now() - usageStatsCacheAt < USAGE_STATS_CACHE_TTL
        ? usageStatsCache
        : null;
    }

    function fetchUsageStats() {
      const cached = getCachedUsageStats();
      if (cached) return Promise.resolve(cached);
      if (usageStatsInFlight) return usageStatsInFlight;
      usageStatsInFlight = fetch("/balance-api?stats=1")
        .then(async (res) => {
          if (!res.ok) throw new Error("HTTP " + res.status);
          const data = await res.json();
          if (!data || !data.ok) throw new Error((data && data.error) || "统计加载失败");
          if (!data.stats) throw new Error(data.statsError || "暂无可用的会话统计");
          usageStatsCache = data;
          usageStatsCacheAt = Date.now();
          return data;
        })
        .finally(() => {
          usageStatsInFlight = null;
        });
      return usageStatsInFlight;
    }

    /** 定价表内部键 -> 展示名 */
    function modelLabel(key) {
      if (key === "deepseek-v4-flash") return "Flash";
      if (key === "deepseek-v4-pro") return "Pro";
      if (key === "deepseek-chat") return "Chat";
      if (key === "deepseek-reasoner") return "Reasoner";
      return String(key || "未知");
    }

    /** token 桶求和（服务端统计返回的 peak / offpeak 桶） */
    function bucketTokens(bucket) {
      if (!bucket) return 0;
      return (
        Number(bucket.inputTokens || 0) +
        Number(bucket.outputTokens || 0) +
        Number(bucket.cacheReadTokens || 0) +
        Number(bucket.cacheWriteTokens || 0)
      );
    }

    /** 概览卡片。数值已完整展示，**不挂原生 `title`**——浏览器系统灰框与 DSH 主题不一致。 */
    const StatsCard = react.memo(function StatsCard({ label, value }) {
      return jsx.jsxs("div", {
        className: "balance-stats-card",
        children: [
          jsx.jsx("span", { className: "balance-stats-card__label", children: label }),
          jsx.jsx("span", { className: "balance-stats-card__value", children: value }),
        ],
      });
    });

    /** 明细行：左侧名称、右侧数值（两端对齐）。
     *  曾经画过占比条，但各分组的基准并不统一（Token 构成按 token、按模型/时段按费用、
     *  近期消耗按 90 天总额），同一屏三种尺子无法横向比较，而数值本身已表达量级，
     *  条只会让人猜「这到底占谁的比例」，故去掉。 */
    const StatsRow = react.memo(function StatsRow({ name, value }) {
      return jsx.jsxs("div", {
        className: "balance-stats-row",
        children: [
          jsx.jsx("span", { className: "balance-stats-row__name", children: name }),
          jsx.jsx("span", { className: "balance-stats-row__value", children: value }),
        ],
      });
    });

    /** 明细分组：小标题（可带右侧提示） + 若干明细行。
     *  `index` 只用于卡片逐个浮现的阶梯动画延迟——面板先浮现、各卡片随后依次入场。 */
    function StatsGroup({ title, hint, children, index = 0 }) {
      return jsx.jsxs("div", {
        className: "balance-stats-group",
        style: { animationDelay: (0.08 + index * 0.035).toFixed(3) + "s" },
        children: [
          jsx.jsxs("div", {
            className: "balance-stats-group__title",
            children: [
              jsx.jsx("span", { children: title }),
              hint ? jsx.jsx("span", { className: "balance-stats-group__hint", children: hint }) : null,
            ],
          }),
          children,
        ],
      });
    }

    function UsageStatsPanel({ onClose, panelRef, closing }) {
      const liveBalance = useBalance();
      const [heatmapTooltip, setHeatmapTooltip] = react.useState(null);
      const [state, setState] = react.useState(() => {
        const cached = getCachedUsageStats();
        return cached
          ? { loading: false, data: cached, error: "" }
          : { loading: true, data: null, error: "" };
      });
      react.useEffect(() => {
        let disposed = false;
        fetchUsageStats().then(
          (data) => { if (!disposed) setState({ loading: false, data, error: "" }); },
          (error) => {
            if (disposed) return;
            setState({ loading: false, data: null, error: error && error.message ? error.message : String(error) });
          },
        );
        return () => { disposed = true; };
      }, []);
      react.useEffect(() => {
        const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
      }, [onClose]);

      const data = state.data;
      const stats = data && data.stats;
      const days = stats && Array.isArray(stats.days) ? stats.days : [];
      const showHeatmapTooltip = react.useCallback((event, label) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        const center = rect.left + rect.width / 2;
        const top = Math.max(12, rect.top - 7);
        if (center < 162) {
          setHeatmapTooltip({ label, align: "left", style: { left: Math.max(12, rect.left), top } });
        } else if (center > viewportWidth - 162) {
          setHeatmapTooltip({ label, align: "right", style: { right: Math.max(12, viewportWidth - rect.right), top } });
        } else {
          setHeatmapTooltip({ label, align: "center", style: { left: center, top } });
        }
      }, []);
      const hideHeatmapTooltip = react.useCallback(() => setHeatmapTooltip(null), []);
      const heatmap = react.useMemo(() => {
        const cells = [];
        const maxTokens = Math.max(0, ...days.map((day) => Number(day.totalTokens || 0)));
        const firstDay = days[0] && days[0].date;
        const leading = firstDay ? (new Date(firstDay + "T00:00:00Z").getUTCDay() + 6) % 7 : 0;
        for (let i = 0; i < leading; i++) {
          cells.push(jsx.jsx("span", { className: "balance-heatmap-cell balance-heatmap-cell--blank" }, "blank-" + i));
        }
        for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
          const day = days[dayIndex];
          const tokens = Number(day.totalTokens || 0);
          const ratio = maxTokens > 0 ? tokens / maxTokens : 0;
          const level = tokens === 0 ? 0 : ratio <= 0.25 ? 1 : ratio <= 0.5 ? 2 : ratio <= 0.75 ? 3 : 4;
          const costText = "¥" + Number(day.cost || 0).toFixed(4);
          const sessionsText = String(Number(day.sessions || 0));
          const ariaLabel = day.date + "，消耗 " + formatTokens(tokens) + " Token，费用 " + costText + "，会话 " + sessionsText;
          const tooltip = day.date + " · 消耗 " + formatTokens(tokens) + " Token · 费用 " + costText + " · 会话 " + sessionsText;
          cells.push(jsx.jsx("button", {
            type: "button",
            tabIndex: -1,
            className: "balance-heatmap-cell" + (level > 0 ? " balance-heatmap-cell--" + level : ""),
            "aria-label": ariaLabel,
            onMouseEnter: (event) => showHeatmapTooltip(event, tooltip),
            onMouseLeave: hideHeatmapTooltip,
            onFocus: (event) => showHeatmapTooltip(event, tooltip),
            onBlur: hideHeatmapTooltip,
          }, day.date));
        }
        return cells;
      }, [days, hideHeatmapTooltip, showHeatmapTooltip]);
      const balance = liveBalance.balance || (data && data.balance);
      const total = stats && stats.total;
      const balanceText = balance
        ? String(balance.total_balance ?? "0.00") + " " + String(balance.currency || "CNY")
        : "不可用";

      // —— 派生统计：全部对旧缓存 / 缺失字段容错（数值缺失按 0、数组缺失按空） ——
      const num = (v) => Number(v || 0);
      const derived = react.useMemo(() => {
        const t = total || {};
        const dayList = Array.isArray(days) ? days : [];
        const activeDays = dayList.filter((d) => num(d.totalTokens) > 0);
        const sumRange = (n) =>
          dayList.slice(-n).reduce(
            (acc, d) => {
              acc.tokens += num(d.totalTokens);
              acc.cost += num(d.cost);
              return acc;
            },
            { tokens: 0, cost: 0 },
          );
        const today = dayList.length > 0 ? dayList[dayList.length - 1] : null;
        const peakDay = activeDays.reduce(
          (best, d) => (best == null || num(d.totalTokens) > num(best.totalTokens) ? d : best),
          null,
        );
        const inputTokens = num(t.inputTokens);
        const cacheReadTokens = num(t.cacheReadTokens);
        const cacheWriteTokens = num(t.cacheWriteTokens);
        const outputTokens = num(t.outputTokens);
        const billedInput = inputTokens + cacheReadTokens + cacheWriteTokens;
        const activeCount = activeDays.length;
        return {
          activeCount,
          todayTokens: num(today && today.totalTokens),
          todayCost: num(today && today.cost),
          week: sumRange(7),
          month: sumRange(30),
          avgTokens: activeCount > 0 ? num(t.totalTokens) / activeCount : 0,
          avgCost: activeCount > 0 ? num(t.cost) / activeCount : 0,
          peakDay,
          inputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          outputTokens,
          hitRate: billedInput > 0 ? cacheReadTokens / billedInput : 0,
          byModel: Array.isArray(t.byModel) ? t.byModel.filter((m) => m && num(m.totalTokens) > 0) : [],
          peakTokens: bucketTokens(t.peak),
          offpeakTokens: bucketTokens(t.offpeak),
          peakCost: num(t.peakCost),
          offpeakCost: num(t.offpeakCost),
        };
      }, [days, total]);
      const fmtCost = (v) => "¥" + num(v).toFixed(4);
      const denomCost = num(total && total.cost) > 0 ? num(total.cost) : 1;
      const rangeDays = Number(stats && stats.rangeDays) || 90;

      const body = state.loading
        ? jsx.jsx("div", { className: "balance-stats-loading", children: "正在汇总会话记录…" })
        : state.error
          ? jsx.jsx("div", { className: "balance-stats-error", children: state.error })
          : jsx.jsxs(jsx.Fragment, {
              children: [
                !liveBalance.balance && data.balanceError ? jsx.jsx("div", { className: "balance-stats-error", children: "余额：" + data.balanceError }) : null,
                jsx.jsxs("div", {
                  className: "balance-stats-top",
                  children: [
                    jsx.jsxs("div", {
                      className: "balance-stats-cards",
                      children: [
                        jsx.jsx(StatsCard, { label: "账户余额", value: balanceText }),
                        jsx.jsx(StatsCard, { label: "90 天估算费用", value: fmtCost(total && total.cost) }),
                        jsx.jsx(StatsCard, { label: "90 天计费 Token", value: formatTokens(Number(total?.totalTokens || 0)) }),
                        jsx.jsx(StatsCard, { label: "活跃天数", value: derived.activeCount + " / " + rangeDays + " 天" }),
                      ],
                    }),
                    jsx.jsxs("div", {
                      className: "balance-stats-heatmap-card",
                      children: [
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
                      ],
                    }),
                  ],
                }),
                jsx.jsxs("div", {
                  className: "balance-stats-grid",
                  children: [
                    jsx.jsxs(StatsGroup, {
                      index: 0,
                      title: "Token 构成",
                      hint: "缓存命中率 " + (derived.hitRate * 100).toFixed(1) + "%",
                      children: [
                        jsx.jsx(StatsRow, { name: "未缓存输入", value: formatTokens(derived.inputTokens)}),
                        jsx.jsx(StatsRow, { name: "缓存读取", value: formatTokens(derived.cacheReadTokens)}),
                        jsx.jsx(StatsRow, { name: "缓存写入", value: formatTokens(derived.cacheWriteTokens)}),
                        jsx.jsx(StatsRow, { name: "输出", value: formatTokens(derived.outputTokens)}),
                      ],
                    }),
                    derived.byModel.length > 0
                      ? jsx.jsxs(StatsGroup, {
                          index: 1,
                          title: "按模型",
                          children: derived.byModel.map((item) =>
                            jsx.jsx(
                              StatsRow,
                              {
                                name: modelLabel(item.model),
                                value: fmtCost(item.cost) + " · " + formatTokens(Number(item.totalTokens || 0)),
                              },
                              "model-" + item.model,
                            )),
                        })
                      : null,
                    derived.peakTokens > 0 || derived.offpeakTokens > 0
                      ? jsx.jsxs(StatsGroup, {
                          index: 2,
                          title: "时段拆分",
                          hint: "高峰占 " + ((derived.peakCost / denomCost) * 100).toFixed(0) + "%",
                          children: [
                            jsx.jsx(StatsRow, {
                              name: "高峰（×2）",
                              value: fmtCost(derived.peakCost) + " · " + formatTokens(derived.peakTokens),
                            }),
                            jsx.jsx(StatsRow, {
                              name: "空闲",
                              value: fmtCost(derived.offpeakCost) + " · " + formatTokens(derived.offpeakTokens),
                            }),
                          ],
                        })
                      : null,
                    jsx.jsxs(StatsGroup, {
                      index: 3,
                      title: "近期消耗",
                      children: [
                        jsx.jsx(StatsRow, {
                          name: "今日",
                          value: formatTokens(derived.todayTokens) + " · " + fmtCost(derived.todayCost),
                        }),
                        jsx.jsx(StatsRow, {
                          name: "近 7 天",
                          value: formatTokens(derived.week.tokens) + " · " + fmtCost(derived.week.cost),
                        }),
                        jsx.jsx(StatsRow, {
                          name: "近 30 天",
                          value: formatTokens(derived.month.tokens) + " · " + fmtCost(derived.month.cost),
                        }),
                      ],
                    }),
                    jsx.jsxs(StatsGroup, {
                      index: 4,
                      title: "日均与峰值",
                      children: [
                        // 日均 = 总额 / 活跃天，没有「占比」语义，因此不画条（否则是条空轨道）
                        jsx.jsx(StatsRow, {
                          name: "日均（按活跃天）",
                          value: formatTokens(derived.avgTokens) + " · " + fmtCost(derived.avgCost),
                        }),
                        jsx.jsx(StatsRow, {
                          name: derived.peakDay ? "峰值日 " + derived.peakDay.date : "峰值日",
                          value: derived.peakDay
                            ? formatTokens(Number(derived.peakDay.totalTokens || 0)) + " · " + fmtCost(derived.peakDay.cost)
                            : "—",
                        }),
                      ],
                    }),
                ] }),
                jsx.jsxs("div", {
                  className: "balance-stats-footer",
                  children: [
                    jsx.jsx("span", {
                      children:
                        "已扫描 " + String(stats?.scannedSessions || 0) + " 个会话" +
                        (stats?.limited ? "（为保证性能仅取最近 200 个）" : "") +
                        "；按北京时间和实际模型峰谷价格估算，结果缓存 5 分钟。",
                    }),
                    jsx.jsxs("div", {
                      className: "balance-stats-actions",
                      children: [
                        jsx.jsx("a", {
                          className: "balance-stats-link",
                          ...externalLink(USAGE_URL, "usage"),
                          children: "查看官方用量",
                        }),
                        // 官方「去充值」走同一个原生平台视口（带平台凭据，不用网页登录）
                        jsx.jsx("a", {
                          className: "balance-stats-link balance-stats-link--primary",
                          ...externalLink(TOP_UP_URL, "top-up"),
                          children: "去充值",
                        }),
                        // 「更多账号信息」对齐 DSH 原生账号卡片：开平台首页（外部窗口）
                        jsx.jsx("a", {
                          className: "balance-stats-link",
                          ...externalLink(PLATFORM_HOME_URL, null),
                          children: "更多账号信息",
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            });
      return jsx.jsxs("section", {
        ref: panelRef,
        className: "balance-stats-panel" + (closing ? " balance-stats-panel--closing" : ""),
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
          jsx.jsx("div", { className: "balance-stats-body", children: body }),
          heatmapTooltip ? reactDom.createPortal(jsx.jsx("div", {
            className: "balance-heatmap-tooltip balance-heatmap-tooltip--" + heatmapTooltip.align,
            style: heatmapTooltip.style,
            role: "tooltip",
            children: heatmapTooltip.label,
          }), document.body) : null,
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
      const settings = useSettings();
      // 设置里的外观值：夹到安全范围，手改 JSON 写出畸形值也不会把 UI 搞坏
      const rawSize = Number(settings.fabSize);
      const fabSize = Number.isFinite(rawSize) ? Math.min(120, Math.max(32, rawSize)) : 60;
      const rawLeft = Number(settings.fabLeft);
      const fabLeft = Number.isFinite(rawLeft) ? Math.min(600, Math.max(0, rawLeft)) : 44;
      const rawThreshold = Number(settings.lowBalanceThreshold);
      const lowThreshold = Number.isFinite(rawThreshold) ? rawThreshold : 10;
      // 圆钮里字号随直径等比缩放（60px → 13px；长金额 → 11px）
      const fabFont = Math.max(9, Math.round((fabSize * 13) / 60));
      const fabFontDense = Math.max(8, Math.round((fabSize * 11) / 60));
      const [statsOpen, setStatsOpen] = react.useState(false);
      const [statsClosing, setStatsClosing] = react.useState(false);
      const clickTimer = react.useRef(null);
      const closeTimer = react.useRef(null);
      const anchorRef = react.useRef(null);
      const layerRef = react.useRef(null);
      const panelRef = react.useRef(null);
      react.useEffect(() => () => {
        if (clickTimer.current !== null) clearTimeout(clickTimer.current);
        if (closeTimer.current !== null) clearTimeout(closeTimer.current);
      }, []);
      // 收起态：让圆形余额与聊天输入卡片（composer card）**垂直居中对齐**。
      // 卡片位置随窗口尺寸、输入行数变化，硬编码 bottom 必然错位，所以运行时测量。
      // DSH 的 slot 契约里 conversation.composer.bar = "Resident composer body"（就是那张卡片），
      // 而本插件的消耗行挂在 conversation.composer.dock（卡片下方的 ambient entries）。
      react.useEffect(() => {
        if (wide) return;
        const anchor = anchorRef.current;
        if (!anchor) return;
        const apply = () => {
          const centerY = measureComposerCenterY();
          if (centerY === null) {
            // 测不到（旧版 DSH / 卡片尚未渲染）→ 交回 CSS 里的 bottom:12px 兜底
            anchor.style.top = "";
            anchor.style.bottom = "";
            return;
          }
          // 必须同时清掉 bottom：fixed 元素同时有 top 和 bottom 会被拉伸
          anchor.style.bottom = "auto";
          anchor.style.top = Math.round(centerY - (anchor.offsetHeight || fabSize) / 2) + "px";
        };
        apply();
        window.addEventListener("resize", apply);
        let observer = null;
        try {
          const card = document.querySelector('[data-slot="conversation.composer.bar"]');
          if (typeof ResizeObserver === "function" && card) {
            observer = new ResizeObserver(apply);
            observer.observe(card);
          }
        } catch {
          /* 结构变了就只靠 resize 兜底 */
        }
        return () => {
          window.removeEventListener("resize", apply);
          if (observer) observer.disconnect();
          anchor.style.top = "";
          anchor.style.bottom = "";
        };
      }, [wide, fabSize]);
      const closeStats = react.useCallback(() => {
        if (!statsOpen || statsClosing) return;
        setStatsClosing(true);
        if (closeTimer.current !== null) clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(() => {
          closeTimer.current = null;
          setStatsOpen(false);
          setStatsClosing(false);
        }, 140);
      }, [statsOpen, statsClosing]);
      // 点击遮罩（即 layer 自身）关闭；点击面板内部不关闭。
      // 窗口缩放不再关闭面板（居中布局会自适应，旧实现是锚定按钮需要重算位置）。
      const handleBackdropClick = (event) => {
        if (event.target === layerRef.current) closeStats();
      };
      const openStats = (event) => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        if (clickTimer.current !== null) clearTimeout(clickTimer.current);
        if (closeTimer.current !== null) clearTimeout(closeTimer.current);
        closeTimer.current = null;
        setStatsClosing(false);
        clickTimer.current = setTimeout(() => {
          clickTimer.current = null;
          setStatsClosing(false);
          setStatsOpen(true);
        }, 230);
      };
      const openUsagePage = (event) => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        if (clickTimer.current !== null) clearTimeout(clickTimer.current);
        clickTimer.current = null;
        if (closeTimer.current !== null) clearTimeout(closeTimer.current);
        closeTimer.current = null;
        setStatsClosing(false);
        setStatsOpen(false);
        // 双击：在应用内打开官方用量页（官方版自带内嵌浏览器；旧版回退系统浏览器）
        // 双击：打开官方用量页（官方版用带平台凭据的原生视口，无需网页登录）
        openPlatformOrUrl("usage", USAGE_URL);
      };
      // 余额元素的交互。悬停提示不用原生 title，统一走主题化浮层（见 withPanel）。
      const interactions = {
        // 单击打开统计面板；顺便阻止 <a href> 的默认跳转（否则会同时弹系统浏览器）
        onClick: (event) => {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          openStats(event);
        },
        onDoubleClick: openUsagePage,
        onContextMenu: onBalanceContextMenu,
      };
      const withPanel = (node, hint, anchorStyle) => jsx.jsxs("div", {
        ref: anchorRef,
        className: "balance-stats-anchor balance-stats-anchor--" + (wide ? "wide" : "compact"),
        style: anchorStyle,
        children: [
          // 悬停提示走 DSH 主题化浮层：primitives.Tooltip 内部是 cloneElement(children, {ref})，
          // 不会插入额外 DOM 层，因此不破坏余额行在 flex 容器里的 42px 布局（浮层本身 portal 到 body）。
          jsx.jsx(primitives.Tooltip, {
            label: hint || "单击查看余额与使用统计，双击打开 DeepSeek API 用量页，右键刷新",
            side: "top",
            delayMs: 400,
            children: node,
          }),
          // 统计面板：居中弹层 + 半透明遮罩（点击遮罩 / Esc / 关闭按钮均可关闭）
          statsOpen ? reactDom.createPortal(jsx.jsx("div", {
            ref: layerRef,
            className: "balance-stats-layer" + (statsClosing ? " balance-stats-layer--closing" : ""),
            onMouseDown: handleBackdropClick,
            children: jsx.jsx(UsageStatsPanel, {
              onClose: closeStats,
              panelRef,
              closing: statsClosing,
            }),
          }), document.body) : null,
        ],
      });

      if (!wide) {
        // 设置里关掉圆钮就整个不渲染（统计面板入口随之消失，符合「关掉显示」的预期）
        if (settings.showFab === false) return null;
        if (state.status === "error" || !state.balance) return null;
        const b = state.balance;
        // 尺寸 / 水平位置由设置决定，用内联样式覆盖 CSS 默认值（CSS 保留 60px/44px 兜底）
        const fabStyle = { width: fabSize + "px", height: fabSize + "px", left: fabLeft + "px" };
        const anchorStyle = { left: fabLeft + "px" };
        const total = Number.parseFloat(b.total_balance ?? "0");
        const depleted = b.is_available === false || !Number.isFinite(total) || total <= 0;
        // ⚠️ 必须 portal 到 body：收起态 DSH 把整个 footArea 设为 display:none
        // （`[data-windows-titlebar] .<hash>_collapsed .<hash>_footArea{display:none}`），
        // 而 `sidebar.footer.action` 就在 footArea 里。display:none 的祖先不会生成盒子，
        // 后代即使 position:fixed 也完全不渲染——组件确实被调用了（wide=false），但 DOM 不可见。
        // portal 到 body 后 position:fixed 才真正生效（2026-09-28 用户反馈「收起侧边栏余额不显示」）。
        // 圆形 FAB 放不下长文本：余额显示「¥<金额>」，余额耗尽时用「充值」而不是「去充值」
        const balanceText = "¥" + b.total_balance;
        // 两种情况都经 withPanel：收起态的定位落在它渲染的 .balance-stats-anchor--compact 上
        // （测量 effect 通过 anchorRef 设 top），裸 FAB 就没有 anchor 可量了。
        const fab = depleted
          ? withPanel(jsx.jsx("a", {
              className: "balance-fab balance-fab-dark",
              style: { ...fabStyle, fontSize: fabFont + "px" },
              ...externalLink(TOP_UP_URL, "top-up", { onContextMenu: onBalanceContextMenu }),
              children: "充值",
            }), "余额不足，单击前往充值", anchorStyle)
          : withPanel(jsx.jsx("a", {
              className: "balance-fab" + (balanceText.length > 6 ? " balance-fab--dense" : ""),
              style: { ...fabStyle, fontSize: (balanceText.length > 6 ? fabFontDense : fabFont) + "px" },
              ...externalLink(USAGE_URL, "usage"),
              ...interactions,
              children: balanceText,
            }), undefined, anchorStyle);
        return typeof document === "undefined" ? fab : reactDom.createPortal(fab, document.body);
      }

      // 展开态余额行：设置里关掉就不渲染（收起态圆钮由上面的 showFab 单独控制）
      if (settings.showBalanceRow === false) return null;

      if (state.status === "error") {
        return withPanel(jsx.jsx("div", {
          className: "balance-footer",
          ...interactions,
          // 失败原因统一走主题化浮层，避免把长错误塞进 42px 的余额行
          children: jsx.jsx(primitives.Tooltip, {
            label: state.error || "余额查询失败",
            side: "top",
            delayMs: 200,
            children: jsx.jsx("span", { className: "balance-footer__error", children: "余额读取失败" }),
          }),
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
              ...externalLink(TOP_UP_URL, "top-up", {
                // 阻止冒泡：不要把"去充值"的点击误当成本行余额的单击/双击
                onClick: (event) => event.stopPropagation(),
                onDoubleClick: (event) => event.stopPropagation(),
                onContextMenu: onBalanceContextMenu,
              }),
              children: "去充值",
            }),
          ],
        }));
      }

      const period = currentPeriod();
      const low = total > 0 && total < lowThreshold;
      // 时段标签可关：关掉后只留金额（「刷新中…」的反馈也一起隐藏，保持一行干净）
      const periodNode = settings.showPeriodLabel === false
        ? null
        : state.refreshing
          ? jsx.jsx("span", { className: "balance-footer__period-inline balance-footer__period-inline--refreshing", children: "刷新中…" })
          : jsx.jsx("span", { className: "balance-footer__period-inline balance-footer__period-inline--" + period, children: period === "peak" ? "高峰" : "空闲" });
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
              periodNode === null ? null : " • ",
              periodNode,
            ],
          }),
        ],
      }));
    }

    // ─── 当前会话消耗：输入区 dock ──────────────────────────────────────────
function UsageCostLine({ useProjection, sessionId }) {
      const settings = useSettings();
      const p = usePricing();
      // 高峰倍率来自设置（服务端 pricing 字段是目录价，倍率由这里单独乘）
      const peakMultiplier = (() => {
        const n = Number(settings.peakMultiplier);
        return Number.isFinite(n) && n > 0 ? n : 2;
      })();
      const model = useCurrentModel();
      const usage = typeof useProjection === "function" ? useProjection("tokenUsage") : undefined;
      const [splitUsage, setSplitUsage] = react.useState(null);
      const [subagentUsage, setSubagentUsage] = react.useState(null);
      const [splitReady, setSplitReady] = react.useState(false);
      // 消耗明细面板：**点击展开**（对齐 DSH 原生「会话统计」的交互——点开切换 + 选中态 + portal 浮层）
      const [detailsOpen, setDetailsOpen] = react.useState(false);
      const detailsAnchorRef = react.useRef(null);
      const detailsPanelRef = react.useRef(null);
      // 定位与"点外部关闭"复用 DSH primitives 的 hook，行为/视觉都与原生浮层一致。
      // 运行时探测（DSH 内部 API 无兼容承诺）：hook 不存在时退化为无定位（面板仍渲染），不拖垮消耗行。
      // 注意这里的条件调用是安全的——primitives 是模块级常量，同一组件生命周期内判定结果恒定。
      const anchoredPosition =
        typeof primitives.useAnchoredPosition === "function"
          ? primitives.useAnchoredPosition({
              open: detailsOpen,
              anchorRef: detailsAnchorRef,
              panelRef: detailsPanelRef,
              side: "top",
              gap: 6,
              margin: 8,
            })
          : null;
      if (typeof primitives.useDismissOnOutsidePointer === "function") {
        primitives.useDismissOnOutsidePointer(detailsAnchorRef, detailsOpen, setDetailsOpen, detailsPanelRef);
      }
      react.useEffect(() => {
        if (!detailsOpen) return;
        const onKeyDown = (event) => {
          if (event.key === "Escape") setDetailsOpen(false);
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
      }, [detailsOpen]);

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
      // 服务端分桶可能"非 null 但为空"（拿不到该会话事件），此时必须回退本地投影估算，否则金额会显示 ¥0.0000
      const splitUsable =
        split != null && ((Array.isArray(split.byModel) && split.byModel.length > 0) || (split.totalTokens ?? 0) > 0);
      const cost = splitUsable ? computeSplitCost(split, p, peakMultiplier) : computeCost(usage, periodAdjustedPricing(p, peakMultiplier));
      const peakTokens = splitUsable ? split.peak.inputTokens + split.peak.cacheReadTokens + split.peak.cacheWriteTokens + split.peak.outputTokens : 0;
      const offpeakTokens = splitUsable ? split.offpeak.inputTokens + split.offpeak.cacheReadTokens + split.offpeak.cacheWriteTokens + split.offpeak.outputTokens : 0;

      // 子代理消耗（与主会话分开，同样跨时段精确计费）
      const hasSubagent = splitReady && subagentUsage && subagentUsage.totalTokens > 0;
      const subCost = hasSubagent ? computeSplitCost(subagentUsage, p, peakMultiplier) : 0;
      const subNewTokens = hasSubagent
        ? (subagentUsage.inputTokens ?? 0) + (subagentUsage.outputTokens ?? 0)
        : 0;
      const subCount = hasSubagent ? (subagentUsage.sessions ?? 0) : 0;

      // 缓存命中率口径与 DSH 相同：缓存读取 / (缓存读取 + 未缓存输入)
      const cacheHitBase = cacheRead + uncachedInput;
      const cacheHitPercent = cacheHitBase > 0 ? Math.round((cacheRead / cacheHitBase) * 100) : 0;

      // pill = 图标 + 文字标签 + 金额：DSH 那颗 pill 已经在显示「{tok} · 缓存命中 {%}」，
      // 所以这里不再重复那些数字，但**保留文字说明**（用户要求「最早之前的文字」）。
      // 图标与 DSH 那颗保持一致（都用 IconDatabaseOutlineRegular）——换别的图标会「不搭配」
      // （2026-09-28 反馈「图标换了 不搭配」，仪表版被否掉）。
      // 图标缺失（DSH 改 API）时不渲染，文字照常显示，不影响点击。
      const children = [
        typeof primitives.IconDatabaseOutlineRegular === "function"
          ? jsx.jsx(primitives.IconDatabaseOutlineRegular, { key: "icon" })
          : null,
        jsx.jsx("span", { key: "label", className: "balance-usage-label", children: "本会话消耗" }),
        jsx.jsx("span", { key: "cost", className: "balance-usage-label", children: "≈ ¥" + cost.toFixed(4) }),
      ];

      // ── 点击展开的明细浮层（结构与 DSH 原生「会话统计」一致：标题 + 分隔线 + dl 两列网格）──
      const usageDetails = [
        ["缓存命中", cacheHitPercent + "%"],
        ["未缓存输入", formatTokens(uncachedInput) + " tok"],
        ["缓存读取", formatTokens(cacheRead) + " tok"],
      ];
      if (cacheWrite > 0) usageDetails.push(["缓存写入", formatTokens(cacheWrite) + " tok"]);
      usageDetails.push(["输出", formatTokens(output) + " tok"]);

      const costDetails = [
        ["新增 tokens", formatTokens(newTokens) + " tok"],
        ["计费 tokens", formatTokens(billedTotal) + " tok"],
        ["模型", model || "未知（按 flash 价估算）"],
      ];
      if (splitUsable) {
        costDetails.push(
          ["高峰 tokens", formatTokens(peakTokens) + " tok"],
          ["空闲 tokens", formatTokens(offpeakTokens) + " tok"],
        );
      }
      if (hasSubagent) {
        costDetails.push(
          ["子代理", subCount + " 个"],
          ["子代理 tokens", "+" + formatTokens(subNewTokens) + " / 计费 " + formatTokens(subagentUsage.totalTokens)],
        );
      }

      const detailRows = (prefix, rows) =>
        rows.flatMap(([label, value], index) => [
          jsx.jsx("dt", { key: prefix + index + "t", children: label }),
          jsx.jsx("dd", { key: prefix + index + "d", children: value }),
        ]);

      const panelChildren = [
        jsx.jsxs("div", {
          className: "balance-usage-panel__title",
          children: [
            jsx.jsxs("span", {
              className: "balance-usage-panel__label",
              children: [
                typeof primitives.IconDatabaseOutlineRegular === "function"
                  ? jsx.jsx(primitives.IconDatabaseOutlineRegular, {})
                  : null,
                "Token 用量",
              ],
            }),
            jsx.jsx("span", { className: "balance-usage-panel__value", children: formatTokens(billedTotal) + " tok" }),
          ],
        }),
        jsx.jsx("div", { className: "balance-usage-panel__rule" }),
        jsx.jsx("dl", { className: "balance-usage-panel__details", children: detailRows("u", usageDetails) }),
        jsx.jsxs("div", {
          className: "balance-usage-panel__title balance-usage-panel__title--second",
          children: [
            jsx.jsxs("span", {
              className: "balance-usage-panel__label",
              children: [
                typeof primitives.IconGaugeOutlineRegular === "function"
                  ? jsx.jsx(primitives.IconGaugeOutlineRegular, {})
                  : null,
                "本会话金额",
              ],
            }),
            jsx.jsx("span", { className: "balance-usage-panel__value", children: "≈ ¥" + cost.toFixed(4) }),
          ],
        }),
        jsx.jsx("div", { className: "balance-usage-panel__rule" }),
        jsx.jsx("dl", { className: "balance-usage-panel__details", children: detailRows("c", costDetails) }),
      ];

      // 设置里关掉消耗行就整个不渲染（点开的明细浮层随之一并消失）
      if (settings.showUsagePill === false) return null;

      return jsx.jsxs("div", {
        className: "balance-usage-wrap",
        children: [
          jsx.jsx("button", {
            type: "button",
            ref: detailsAnchorRef,
            className: "balance-usage-line",
            "aria-haspopup": "dialog",
            "aria-expanded": detailsOpen,
            "aria-label": "本会话 Token 用量与金额明细",
            onClick: () => setDetailsOpen((value) => !value),
            children,
          }),
          detailsOpen
            ? reactDom.createPortal(
                jsx.jsx("div", {
                  ref: detailsPanelRef,
                  className: "balance-usage-panel",
                  role: "dialog",
                  "aria-label": "本会话 Token 用量",
                  style: anchoredPosition ?? void 0,
                  children: panelChildren,
                }),
                document.body,
              )
            : null,
        ],
      });
    }

    // ─── 插件配置卡片：DSH「插件」页 → balance-dsh → 设置 ─────────────────────
    // slot 契约（dsh-client-ui-plugin-manager 的 plugins.bundle.config，keyed 类型）：
    //   key        = bundle 的包名，本插件即 "balance-dsh"
    //   ownerProps = { view: "summary" | "page", form?: ConfigPageForm }
    //   view="summary" → 插件列表里的单行摘要；view="page" → 详情页完整表单
    //                   （渲染在 bundle 描述与行列表之间）
    // 刻意**不用** ownerProps.form：那要接入 DSH 的 settings schema（内部 API，
    // 无兼容承诺），配置值改走插件自己的 /balance-api?config=1（见 lib/index.js），
    // 所以这里忽略 form、自己读写。缺失 view / props 时按 page 渲染，不会崩。
    function BalanceSettingsCard(props) {
      const view = props && props.view;
      const settings = useSettings();
      const [draft, setDraft] = react.useState(null);
      const [saving, setSaving] = react.useState(false);
      const [status, setStatus] = react.useState({ kind: "", text: "" });

      // 拿到设置后灌一次草稿；draft 已有内容就不再覆盖，避免打断正在输入的用户
      react.useEffect(() => {
        setDraft((current) => (current === null ? { ...settings } : current));
      }, [settings]);

      const value = draft === null ? settings : draft;
      // 实时保存：改动后 debounce 落盘，避免连续输入时每敲一个键都发一次请求。
      // 用 ref 拿「最新值」，否则快速连续改两个字段时第二个 patch 会基于过期闭包丢改动。
      const valueRef = react.useRef(value);
      valueRef.current = value;
      const saveTimer = react.useRef(null);
      const pendingRef = react.useRef(null);
      react.useEffect(() => () => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
      }, []);

      const commit = async (next) => {
        setSaving(true);
        try {
          await saveSettings(next);
          setStatus({ kind: "ok", text: "已保存" });
        } catch (error) {
          setStatus({ kind: "error", text: error && error.message ? error.message : String(error) });
        } finally {
          setSaving(false);
        }
      };
      const queueSave = (next) => {
        pendingRef.current = next;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        setStatus({ kind: "", text: "修改中…" });
        saveTimer.current = setTimeout(() => {
          saveTimer.current = null;
          const payload = pendingRef.current;
          pendingRef.current = null;
          if (payload) commit(payload);
        }, 350);
      };
      const patch = (key, next) => {
        const merged = { ...valueRef.current, [key]: next };
        setDraft(merged);
        queueSave(merged);
      };
      const onReset = () => {
        const next = { ...SETTINGS_DEFAULTS };
        setDraft(next);
        queueSave(next);
      };

      // 插件列表里的单行摘要
      if (view === "summary") {
        const shown = [
          value.showBalanceRow !== false ? "余额行" : null,
          value.showUsagePill !== false ? "消耗行" : null,
          value.showFab !== false ? "圆钮 " + value.fabSize + "px" : null,
        ].filter(Boolean).join(" · ");
        return jsx.jsx("span", {
          className: "balance-settings__summary",
          children: "每 " + value.refreshIntervalSec + "s 刷新余额 · " + (shown === "" ? "界面全部隐藏" : shown),
        });
      }

      const row = (key, label, hint, control) => jsx.jsxs("div", {
        className: "balance-settings__row",
        children: [
          jsx.jsxs("div", {
            className: "balance-settings__label",
            children: [
              jsx.jsx("span", { className: "balance-settings__label-text", children: label }),
              hint ? jsx.jsx("span", { className: "balance-settings__hint", children: hint }) : null,
            ],
          }),
          jsx.jsx("div", { className: "balance-settings__control", children: control }),
        ],
      }, key);

      const toggle = (key, label, onClick) => jsx.jsx("button", {
        type: "button",
        role: "switch",
        "aria-checked": value[key] === true,
        "aria-label": label,
        className: "balance-settings__toggle",
        onClick: onClick || (() => patch(key, value[key] !== true)),
      });

      const numberInput = (key, min, max) => jsx.jsx("input", {
        className: "balance-settings__input",
        type: "number",
        min,
        max,
        step: 1,
        value: value[key],
        onChange: (event) => patch(key, event.target.value),
      });

      const numberRow = (key, label, hint, min, max, unit) =>
        row(key, label, hint, [
          numberInput(key, min, max),
          jsx.jsx("span", { className: "balance-settings__unit", children: unit, key: key + "-unit" }),
        ]);

      const toggleRow = (key, label, hint) => row(key, label, hint, toggle(key, label));

      // 整张设置卡片可折叠（默认收起）：形式对齐 DSH 原生 DisclosureRow —— 一行
      // 标题 + 描述 + 右侧 chevron，展开时箭头翻转 180 度。
      const [openSettings, setOpenSettings] = react.useState(false);
      const chevron = jsx.jsx("svg", {
        className: "balance-settings__chevron",
        viewBox: "0 0 16 16",
        width: 14,
        height: 14,
        "aria-hidden": "true",
        children: jsx.jsx("path", {
          d: "M4 6.5l4 4 4-4",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.5,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }),
      });
      const group = (key, title, rows) => jsx.jsxs("div", {
        className: "balance-settings__group",
        children: [
          jsx.jsx("div", { className: "balance-settings__group-title", children: title }),
          ...rows,
        ],
      }, key);

      // 自定义价格已从界面移除：价格本来就跟随官方内置价表（官方调价时更新插件即可），
      // 普通用户没有自己填的必要。服务端仍支持 settings.priceByModel 覆盖价，
      // 需要的人可以直接改 ~/.dsh/balance-dsh.json。

      return jsx.jsxs("div", {
        className: "balance-settings",
        "data-open": openSettings ? "true" : "false",
        children: [
          jsx.jsxs("button", {
            type: "button",
            className: "balance-settings__head-btn",
            "aria-expanded": openSettings,
            onClick: () => setOpenSettings((prev) => prev !== true),
            children: [
              jsx.jsxs("div", {
                className: "balance-settings__head-text",
                children: [
                  jsx.jsxs("div", {
                    className: "balance-settings__head",
                    children: [
                      jsx.jsx("span", { className: "balance-settings__title", children: "余额与用量" }),
                      settingsCache.version
                        ? jsx.jsx("span", { className: "balance-settings__version", children: "v" + settingsCache.version })
                        : null,
                    ],
                  }),
                  jsx.jsx("p", {
                    className: "balance-settings__desc",
                    children: "余额刷新频率、界面显示开关、收起态圆钮外观、统计范围与计费口径。改动即时保存并生效；其中服务端相关项需重启 DSH。",
                  }),
                ],
              }),
              chevron,
            ],
          }),

          openSettings ? jsx.jsxs("div", {
            className: "balance-settings__body",
            children: [
              group("balance", "余额", [
            numberRow("refreshIntervalSec", "余额刷新间隔", "轮询间隔；对话产生新消耗时也会顺带刷新。", 5, 3600, "秒"),
            numberRow("lowBalanceThreshold", "低余额警示阈值", "余额低于该值时金额转为琥珀色。", 0, 100000, "元"),
            row("apiKey", "API Key", "官方账号未登录或读不到余额时的回退凭据；留空则只用官方账号。",
              jsx.jsx("input", {
                className: "balance-settings__input",
                style: { width: "280px" },
                type: "password",
                autoComplete: "off",
                placeholder: "sk-…（留空 = 不设置）",
                value: value.apiKey == null ? "" : value.apiKey,
                onChange: (event) => patch("apiKey", event.target.value),
              })),
          ]),

          group("display", "界面显示", [
            toggleRow("showBalanceRow", "侧边栏余额行", "展开侧边栏时底部紧挨设置齿轮的那一行。"),
            toggleRow("showUsagePill", "会话消耗行", "输入框下方的「本会话消耗」胶囊（含点开的明细浮层）。"),
            toggleRow("showPeriodLabel", "高峰 / 空闲标签", "余额行里金额后面的时段提示。"),
          ]),

          group("fab", "收起态圆钮", [
            toggleRow("showFab", "显示圆钮", "收起侧边栏时左下角的悬浮圆形余额。"),
            numberRow("fabSize", "直径", "圆钮大小；圆内字号按比例缩放。", 32, 120, "px"),
            numberRow("fabLeft", "距左缘", "数值越大越靠右。", 0, 600, "px"),
          ]),

          group("stats", "用量统计", [
            numberRow("statsSessionLimit", "扫描会话数上限", "统计面板最多回看多少个历史会话（越大越慢）。", 10, 2000, "个"),
            numberRow("statsCacheSec", "统计缓存时长", "统计结果缓存多久；0 = 每次重新扫描。", 0, 3600, "秒"),
          ]),

          group("billing", "计费", [
            numberRow("peakMultiplier", "高峰时段倍率", "官方为 2（高峰价 = 空闲价 × 倍率）。", 1, 10, "倍"),
          ]),

          jsx.jsxs("div", {
            className: "balance-settings__actions",
            children: [
              jsx.jsx("span", {
                className: "balance-settings__status" +
                  (status.kind === "error" ? " balance-settings__status--error" : status.kind === "ok" ? " balance-settings__status--ok" : ""),
                children: saving ? "保存中…" : status.text,
              }),
              jsx.jsx("button", {
                type: "button",
                className: "balance-settings__btn",
                onClick: onReset,
                disabled: saving,
                children: "恢复默认",
              }),
            ],
          }),
            ],
          }) : null,
        ],
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

      // DSH「插件」页 → 点 balance-dsh → 详情页里的配置卡片。
      // slot 契约：plugins.bundle.config 是 keyed 类型，key 必须是 **bundle 的包名**
      // （本插件 = "balance-dsh"），DSH 的插件管理页按这个 key 派发。
      // 该 slot 由 dsh-client-ui-plugin-manager 声明（页面没打开时不存在），但
      // slots.inject 是惰性的——slot 出现时才回调，所以这里直接注册即可。
      // 旧版 DSH 没有这个 slot 时 inject 静默无效，不影响其余功能。
      ctx.slots.inject("plugins.bundle.config", () =>
        ctx.slots.register(
          {
            name: "plugins.bundle.config",
            key: "balance-dsh",
          },
          BalanceSettingsCard,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
