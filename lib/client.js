window.__ModuleLoader__.load({
  id: "balance-dsh",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    let jsx = require("react/jsx-runtime");
    // ⚠️ 顶层 require 一旦抛错，整个 factory 崩掉 —— 5 个 slot 全部不注册、界面静默消失，
    // 而且没有任何日志可查。这是「DSH 兼容铁律 1」的延伸：react-dom 与官方 primitives
    // 都不是绘制这些 UI 的必需品（primitives 只提供 Tooltip / Modal / 三个图标 /
    // 两个定位 hook，全部有降级路径），所以一律包住，缺了只降级对应子功能。
    // 报告里唯一真正会崩的是后面那些 `typeof primitives.X` —— primitives 为 undefined 时
    // 读属性就 TypeError。所以失败时退成空对象，让所有探测退化为「没有这个能力」。
    let reactDom;
    try {
      reactDom = require("react-dom");
    } catch {
      reactDom = null;
    }
    let primitives;
    try {
      // `|| {}` 不能省：模块存在但导出为空（或 require 返回 undefined）时同样要能探测。
      primitives = require("@deepseek-ai/dsh-client-ui-primitives") || {};
    } catch {
      primitives = {};
    }
    // createPortal 缺失时直接返回节点本身：它只用来把圆钮/浮层挂到 document.body
    // （因为收起侧栏会把挂载点整个 display:none），没了顶多定位不对，不该让整块 UI 崩。
    const createPortal =
      reactDom && typeof reactDom.createPortal === "function" ? reactDom.createPortal.bind(reactDom) : (node) => node;
    // Tooltip 缺失时退成透传容器：两个调用点都是「包一层提示」，内容本身必须照常渲染。
    const TooltipPassthrough = (props) => (props && props.children != null ? props.children : null);
    const Tooltip = typeof primitives.Tooltip === "function" ? primitives.Tooltip : TooltipPassthrough;
    // ─── 可选 hook 的恒定点 ────────────────────────────────────────────────
    // 把「provider 可能没提供这个 hook」的探测提到**模块级**，这样组件里就能**无条件调用**。
    // 原来写成 `typeof primitives.useAnchoredPosition === "function" ? primitives.useAnchoredPosition(...) : null`
    // 是条件调用 hook —— 判定结果确实恒定（primitives 是模块级常量），运行期不会出错，
    // 但它违反 hooks 规则：一旦将来改成动态加载 / 异步注入，调用次数变化就是
    // `Rendered more hooks than during the previous render`，整块 UI 白掉。
    // 用 no-op 占位后 hook 数量恒定，缺失时的返回值与原来的 `null` / `undefined` 完全一致，
    // 所以**行为与视觉零变化**，只是把合规风险消掉了。
    const useAnchoredPositionHook =
      typeof primitives.useAnchoredPosition === "function"
        ? primitives.useAnchoredPosition.bind(primitives)
        : () => null;
    const useDismissOnOutsidePointerHook =
      typeof primitives.useDismissOnOutsidePointer === "function"
        ? primitives.useDismissOnOutsidePointer.bind(primitives)
        : () => {};
    const useProjectionFallback = () => undefined;
    // 稳定的空数组常量：凡是「兜底空数组又当 useMemo / effect 依赖」的地方都用它，
    // 否则每次渲染都是新引用，依赖判定永远为真，memo 等于没有（2026-10-31 全量审查）。
    const EMPTY_ARRAY = Object.freeze([]);
    // 白雾光团的下标。原来每处都现写一个数组字面量 [0,1,2,3,4]，每次渲染都是新引用，
    // 而且拿 index 当 React key（2026-10-31 全量审查）。抽成常量 + 显式 key。
    const ORB_INDICES = Object.freeze([0, 1, 2, 3, 4]);
    // 有智能体团队时的补拉间隔：队友在跑、Lead 自己的 token 不变，只能靠定时补。
    // 15 秒是折中 —— 服务端有指纹缓存，没变就是纯读；变了才付一次解压（大会话约 700ms）。
    const TEAM_REFRESH_MS = 15000;
    // 团队补拉的退避上限：连续没变化就 15→30→45→60 秒，一有变化立刻回 15 秒。
    const TEAM_REFRESH_MAX_FACTOR = 4;
    // 补拉请求的超时：到时 abort 掉，让递归链一定能排下一拍（否则挂死的请求会把链断掉）。
    const TEAM_FETCH_TIMEOUT_MS = 10000;
    // 智能体团队（Agent Teams）成员的 phase → 中文。
    // 取值来自 @deepseek-ai/dsh-experimental-agent-team 的 member 快照（provisioning/active/failed）；
    // 认不出来就只显示名字，不猜。DSH 改词表时这里顶多退化成不显示状态，不影响金额。
    const TEAM_PHASE_LABEL = Object.freeze({
      provisioning: "准备中",
      active: "进行中",
      failed: "失败",
    });
    // 查表必须走 own property：`Object.freeze` 不剪原型链，phase 若是 "constructor" / "toString"
    // 这类名字，直查会命中 Object.prototype 上的函数并渲染成 "· function ..."（审计 P2）。
    // 认不出就返回空串，调用方只显示名字。
    function teamPhaseLabel(phase) {
      return typeof phase === "string" && Object.prototype.hasOwnProperty.call(TEAM_PHASE_LABEL, phase)
        ? TEAM_PHASE_LABEL[phase]
        : "";
    }

    // 余额滚轮要"这一帧就挂上滚动结构"，不能等 useEffect（它在 paint 之后跑），
    // 否则余额一变会先渲染出一帧纯文本新值、下一帧才换成滚动格 —— 看起来就是
    // "数字比动画先出来"（2026-10-30 用户反馈）。优先用 useLayoutEffect（paint 前同步），
    // 老 React 没有就退回 useEffect（纯静态 stub 环境也不至于炸）。
    const usePrePaintEffect =
      react && typeof react.useLayoutEffect === "function" ? react.useLayoutEffect : (react && react.useEffect);

    // ─── 样式 ────────────────────────────────────────────────────────────────
    const css = `
/* 兜底定义主题过渡变量：上游 deepsuite theme/global.css 未加载时，
   恢复侧边栏/面板的滑动动画（AppFrame 宽度过渡依赖 --ds-transition-duration-slow） */
:root{--ds-transition-duration-slow:.3s;--ds-transition-duration:.2s;--ds-transition-duration-fast:.1s;--ds-ease-in-out:cubic-bezier(.4,0,.2,1)}
/* ── 基础元素（自定义类，稳定；纯文字样式，不用胶囊） ── */
/* 完全复刻设置按钮（.VOzbGW_trigger）：width calc(100%+4px)、height 42px、margin 4px -2px、
   padding 0 10px 0 8px、gap 8px、font 14px/22px、color label-primary；
   左缘与设置按钮严格对齐，高度/颜色一致（金额 600 加粗）。
   布局：[meta + 刻度条（竖排，居中）] [金额（最右）] */
.balance-footer{position:relative;isolation:isolate;box-sizing:border-box;display:flex;align-items:center;justify-content:flex-start;gap:8px;width:100%;min-width:0;height:42px;margin:0;padding:0 0 0 8px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;text-decoration:none;cursor:pointer;white-space:nowrap;overflow:visible;-webkit-user-select:none;user-select:none}
/* 带 meta 行时整块变高：42px 装不下「一行 11px 文字 + 13px 轨道」，改成自适应。 */
.balance-footer--stacked{height:auto;min-height:42px;padding-top:5px;padding-bottom:5px}
/* 整行都是热区（单击统计面板 / 双击用量页 / 右键刷新；交互挂在 .balance-stats-anchor、捕获阶段）。
   不给整行画 hover / active 底色——那圈圆角高亮框在侧边栏里太显眼，
   且余白区也被涂上颜色很怪（2026-10-30 反馈「我不要高亮显示」）。
   可点指示只靠右端胶囊自己的 hover 缩放。 */
.balance-footer__spacer{flex:1 1 0;min-width:0}
/* 右键刷新的「抹除」效果：白条从左划到右，白条**左边**的数字已经"显影"（新值），
   右边仍被一层暗罩压着（旧值）。所以视觉上就是「只有被白条经过的地方才更新」。
   ::before = 前沿白条（3px 实心 + 双层光晕）
   ::after  = 暗罩（全遮 → clip-path 左边界推进到 100% → 从左往右退去）
   两者同一条时间曲线，边界始终对齐。用 key 重挂来重播。 */
/* 自动刷新的数字滚轮：逐位滚动。
   整串按字符切成格子，只有值真正变了的格子才画三层（影子撑尺寸 / 旧字上滑出 / 新字下滑入），
   没变的字符就是普通文本 —— 所以花掉 0.01 只有末位在翻，小数点和高位数字纹丝不动。
   外层 overflow:hidden 把滑动部分裁在字高内，读起来像机械计数器过位。 */
.balance-footer__roll{display:inline-flex;align-items:baseline;white-space:pre;flex:none}
.balance-footer__dcell{display:inline-block;vertical-align:bottom;white-space:pre}
/* ⚠️ 裁切必须用 overflow:hidden，**不要用 clip-path:inset(0)**（2026-10-31 反转了早先的决定）。
   clip-path 无论值多"无操作"都会把元素推进离屏合成，小字号文字在 GPU 纹理里渲染就发虚
   ——「今日消耗的滚动糊了」而会话消耗不糊，差别只在这一条上（两者 left/width 实测完全相同，
   亚像素定位不是原因）。overflow:hidden 走布局层裁剪，不层化、不发虚。
   早期担心它建立 BFC、挡住子元素外发光，实测数字没有外发光，不成立。 */
.balance-footer__dcell--roll{position:relative;overflow:hidden}
/* 位数减少时（11.04 → 8.04），最左边那一格的「新值」是空位。它得先把旧数字滚出去，
   再把自己收成 0 宽 —— 否则滚动结束后那一格残留的宽度把胶囊撑宽 10px，
   要等 setRoll(null) 才缩回，看起来就是数字左右跳一下。
   收窄过程中 dout/din 是 absolute，会被 dcell 的裁切层裁掉，不会和邻格重叠。
   影子格必须保持 NBSP 而不是 "0"：这一格要在动画期间维持原来的宽度，
   真正让它消失的是这条 max-width 动画，不是字符宽度。 */
.balance-footer__dcell--gone{animation:balance-cell-gone .42s cubic-bezier(.33,.66,.24,1) forwards}
/* ─── 滚动播完后的「定格态」（2026-10-31 方案 3 补充）─────────────────────────
   为什么需要它：滚动动画不是 JS 触发的，而是 .balance-footer__dout / __din 上
   常驻的 animation 声明。只要这两个节点还在、类名还在、animation 声明还在，
   那么元素一旦经历 display:none → 有盒子，浏览器会**取消并重新创建**这个动画
   —— 从 0 秒重播。这就是「展开侧边栏数字重播」的物理机制，改多少 JS 状态都没用，
   因为状态只决定类名，类名在、声明就在。
   所以滚动播完之后给格子加 --roll-done：**摘掉 animation 声明、只留终态几何**。
   这样节点仍常驻（不会像清回 null 那样结构切换、跳一下），但已经没有任何
   动画可以被重播了。
   几何必须与动画终点严丝合缝：dout 直接隐藏，din 去掉 animation 后回到自身样式
   （没有 transform = top:0），正好就是关键帧 100% 的位置。 */
.balance-footer__dcell--roll-done .balance-footer__dout{animation:none;display:none}
.balance-footer__dcell--roll-done .balance-footer__din{animation:none;transform:none}
.balance-footer__dcell--roll-done.balance-footer__dcell--gone{animation:none;max-width:0}
@keyframes balance-cell-gone{from{max-width:2ch}to{max-width:0}}
.balance-footer__dghost{display:block;visibility:hidden;white-space:pre}
/* ⚠️ 不要给 dout/din 加 will-change:transform,opacity。
   它们是**常驻**节点（滚动结束后不再卸掉，见「滚动结束后保持滚动态」），
   而 will-change 会让每一格独立成一个合成层；小字号文字走 GPU 纹理后
   在非整数位置渲染，整体发虚（用户 2026-10-31：「数字变糊了」）。
   transform 动画本身浏览器会自动提升层，撤掉 will-change 不影响这 420ms 的流畅度。 */
.balance-footer__dout,.balance-footer__din{position:absolute;left:0;top:0;white-space:pre}
/* ⚠️ 缓动必须是 linear，**不要用 cubic-bezier(.33,.66,.24,1) 这类强 ease-out**。
   ease-out 尾部速度趋近 0，最后 100ms 只走百分之一的距离，translateY 会长时间停在
   0.6px / 0.3px / 0.1px 这些亚像素值上，文字不在整像素就只能插值抗锯齿 ——
   观感就是「快到位时数字糊了」（用户 2026-10-31 直接猜中）。linear 下速度恒定，
   最后一帧跨 2.4%，一两帧就越过亚像素区间。机械计数器本来就该匀速，语义也更对。

   ⚠️ 但**光靠 linear 会显得生硬**（2026-10-31：「所有的数字滚动太生硬了」）：
   所有位同时起步、同时落位，整串像一块板在平移。所以加**错位起步**（stagger）——
   从右往左依次延后，个位先动、进位往左传递，读起来是机械计数器逐位落位，
   而不是整块平移。每位仍是 linear、落点分毫不差，所以不会退回发虚的老问题。
   stagger 的毫秒数由 renderRollCells 按「从右数第几位」写进 animation-delay。 */
/* ⚠️ fill-mode 必须是 both（不是 forwards）：
   错位起步意味着前面若干位会先等一会儿，等的时候要靠 backwards 保持在 0% 帧
   （dout 停在 translateY(0)、din 停在 translateY(100%) 即下方不可见）。
   只写 forwards 的话，延迟期间应用的是**元素自身样式**（没有 transform），
   din 会直接叠在 dout 上，数字糊成一团。 */
.balance-footer__dout{animation:balance-roll-out .42s linear both}
.balance-footer__din{animation:balance-roll-in .42s linear both}
/* ⚠️ 全程 opacity:1，只靠位移互补 —— 不要再用「先淡出再淡入」那套。
   旧写法是 out 到 60% 淡成 0、in 前 40% 保持 0，中间有约 160ms 两格都看不见，
   逐帧看就是「数字缺失/位置异常一下」。会话消耗因为变化频率低不显眼，
   今日每几秒补拉一次，就会反复闪（用户 2026-10-31：「还是会有这样一帧」）。
   现在两格同时在动、位置严格互补（out 向上退、in 从下方进），overflow:hidden 裁掉边外部分，
   观感是机械计数器过位，任何一帧都有完整可读的数字。 */
/* ⚠️ 用**多段关键帧**做「先快后慢」，不要用 ease-out timing-function。
   （2026-10-31：「滚动速度太统一了 可以就是先快再慢」）
   直接的 cubic-bezier ease-out 是禁区：末端斜率趋 0，最后 100ms 只走 1% 的距离，
   translateY 会长时间停在 0.6 / 0.3 / 0.1px 这些亚像素值上，文字只能插值抗锯齿 → 发虚
   （这一条是用户自己猜中的，别再试）。所以 timing-function 保持 linear，
   把减速做进**关键帧的位移分布**里：linear 对每个关键帧区间各自生效，
   于是每段速度 = 该段位移 / 该段时间，改位移就改了速度。

   实测三段速度比（总长 420ms、每格 20px）：
     0–40%   走 55%   1.37 倍速   ← 起步冲出去
     40–75%  走 35%   1.00 倍速   ← 匀速过渡
     75–100% 走 10%   0.40 倍速   ← 收尾放缓
   尾部 0.4 倍速下每 100ms 仍走 3.2px，亚像素区只占最后约 30ms —— 读起来是「落位」，
   不是「糊住」。ease-out 在那一段只走 0.2px，慢 16 倍，那才是发虚的来源。

   ⚠️ out 和 in 必须用**同一套归一化进度**，否则中间会露缝或重叠：
   任一时刻 out 在 -a、in 在 100-a，两者间距恒为一整格。对应关系是
   out 的 -55% ↔ in 的 45%、out 的 -90% ↔ in 的 10%（差值都是 100%）。改一边必须改另一边。 */
@keyframes balance-roll-out{
  0%{transform:translateY(0)}
  40%{transform:translateY(-55%)}
  75%{transform:translateY(-90%)}
  100%{transform:translateY(-100%)}
}
@keyframes balance-roll-in{
  0%{transform:translateY(100%)}
  40%{transform:translateY(45%)}
  75%{transform:translateY(10%)}
  100%{transform:translateY(0)}
}
/* 逐位滚动不受 prefers-reduced-motion 影响：它是"这轮花掉多少"的即时反馈，是插件特色 */
/* ── 今日金额的「首次出场」──
   冷启动 / 打开 DSH 时：加载动效结束 → 真实金额升上来。
   刻意不复用上面的 dout/din 滚格子：balance-roll-in 的前 40% 是 opacity:0
   （给"旧值滚出、新值滚入"留重叠时间），从空白往上升时那段就是纯空白，
   逐帧截图 0/70/140ms 全空、210ms 已经到位 —— 看起来就是硬切（2026-10-31 反馈）。
   这里数字全程可见，只用位移 + 淡入把它托上来，420ms 走完，缓动末端重量感。
   只作用于金额这一层，「今日」二字恒定不动；¥ 在外层，也不参与。 */
/* ⚠️ 必须是 inline-flex，不能是 inline-block（用户 2026-10-31：「今日消耗的滚动糊了」）。
   内部结构是 dghost(block 撑宽) + dout/din(absolute)，inline-block 容器在这种混排下
   会把行盒算到半像素位置，小字号文字于是发虚；会话消耗用的 .balance-footer__roll 一直是
   inline-flex 所以从不糊。两边保持同一套排版模型。 */
.balance-footer__today-num{display:inline-flex;align-items:baseline;white-space:pre;font-variant-numeric:tabular-nums}
/* 首次显形：**从左到右扫过**（用户 2026-10-31：「我要的从左到右的扫过了 没扫过的地方不要显示数字」）。
   早先是一段 translateY(6px) 上浮 + 淡入，看着像"滚上来"。

   结构和会话消耗的到位动画**完全同一套**（用户 2026-10-31：「你参考一下会话消耗的动画
   不就是出现方式不一样吗」），只有遮罩方向和缓动不同：
     容器 overflow:hidden  →  mist（遮罩挖洞，底下是加载动画）  →  body（数字，clip 揭幕）
   mist 和 body 是**同一个容器的兄弟节点**，宽度天然相等，所以挖洞的边界和揭幕的边界
   永远严丝合缝 —— 被扫过的地方只剩数字，没扫到的地方只剩加载动画，任何一帧都不叠。

   ⚠️ 早先试过"两个独立元素各自 clip-path"（overlay 反向裁 + 数字正向裁）：两者盒子宽度
   不同（¥ 曾在裁剪区外），百分比算出来的边界差半条 ¥ 的宽度，交界处同时出现胶囊和数字，
   白底把浅灰字冲淡 —— 看着就是"数字显示在动画里"，而不是"扫过去"。

   ⚠️ 缓动不能用会话消耗那档 cubic-bezier(.2,.86,.24,1)：那是"开窗"，前段极猛，
   今日金额要的是**看得出边界在往右推**，所以取接近匀速的 ease-in-out、时长也放长。 */
.balance-footer__today-reveal{position:relative;display:inline-flex;align-items:baseline;overflow:hidden;white-space:pre}
/* 等待态（还没有数值）：容器里只有 mist，没有任何要裁的东西。
   这条规则是**兜底** —— 万一将来给 reveal 自己挂了裁切/过渡，等待态也会被一起裁掉，
   加载动画一帧都看不见。现在它等价于"显式声明等待态不参与揭幕"。 */
.balance-footer__today-value--waiting .balance-footer__today-reveal{animation:none;clip-path:none}
/* 挖洞方向：linear 从左往右。0% 全被遮罩盖住（只剩加载动画），100% 左侧全露（只剩数字）。
   --today-hole 必须用 @property 注册成 percentage 才能被 keyframes 插值，
   否则变量是离散的，遮罩会一步跳到底（与会话消耗的 --balance-hole 同理）。 */
@property --today-hole{syntax:"<percentage>";inherits:false;initial-value:0%}
/* 余额行启动入场：从下往上擦出（用户 2026-10-31 原话：「添加一个从下到上的动画
   跟浪潮一样 滑动上去 没滑到的地方不显示 一样的擦除机制」）。
   —— DSH 启动时余额第一次出现，就用这条遮罩从底部往上揭开，没扫到的区域不显示。
   ⚠️ 只能播一次。折叠/展开侧栏会让 BalanceFooter 重新挂载，
   而挂在元素上的 CSS 动画只要节点重建就从 0 秒起播 —— 所以「是否播过」记在
   <html data-balance-footer-entered="1"> 上（跨挂载有效），重挂时读到就不挂这个类。 */
@property --balance-enter-y{syntax:"<percentage>";inherits:false;initial-value:0%}
.balance-footer--enter-up{
  clip-path:inset(calc(100% - var(--balance-enter-y)) 0 0 0);
  animation:balance-enter-up .34s cubic-bezier(.33,0,.67,1) both}
@keyframes balance-enter-up{from{--balance-enter-y:0%}to{--balance-enter-y:100%}}
/* ⚠️ z-index:1 是必须的，不是保险。
   mist 和 body 都是**定位元素**（absolute / relative），同层级下按 DOM 顺序绘制 ——
   mist 写在前面就会被 body 盖在下面，雾盖不住数字，"扫过"完全看不出来。
   会话消耗那边能工作是因为它要的恰好相反：雾在数字**背后**（数字压在最上，
   挖洞只是把数字区域的雾去掉提亮），所以那边不需要 z-index。今日要的是
   "雾盖住还没扫到的部分"，必须把 mist 抬到 body 上面。 */
.balance-footer__today-reveal__mist{
  position:absolute;inset:0;z-index:1;display:block;pointer-events:none;
  -webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) var(--today-hole),#000 var(--today-hole),#000 100%);
  mask-image:linear-gradient(90deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) var(--today-hole),#000 var(--today-hole),#000 100%);
}
/* ⚠️ 挖洞动画**必须挂在修饰类上**（2026-10-31 第十六轮：「是bug吗在展开侧边栏的时候
   这个动画也会触发」）。原来 animation:balance-today-hole … 是直接写在 __mist 上的，于是只要
   节点重建（折叠/展开侧栏让 BalanceFooter 重挂、DOM 重造），CSS 就从 0 秒重播一次 ——
   表现为「已经出好的 ¥35.0 又被雾盖住、又扫一遍」。今日那边 body 早就用 --enter 闸门治过，
   漏的就是 mist 这一层。
   现在按状态拆成两个修饰类，节点怎么重挂都不会凭空起播：
     · --wipe  ：擦出窗口内（todayWipeSeq > 0 && !todayWipeDone）才挂，动画 0%→100%；
     · --clear ：已经擦完（有值 + done），直接钉在 --today-hole:100%，也就是"整层透明"，
                 与动画终点逐像素一致，而且**没有任何 animation 声明可以重播**。
   等待态两个类都不挂，--today-hole 停在注册初值 0% → 雾整块可见，就是加载动画。 */
.balance-footer__today-reveal__mist--wipe{animation:balance-today-hole .26s cubic-bezier(.33,0,.67,1) both}
.balance-footer__today-reveal__mist--clear{--today-hole:100%}
.balance-footer__today-reveal__mist .balance-usage-mist{width:100%;min-width:0;height:100%}
/* ⚠️ 展开态的雾层**不许被拉伸**（2026-10-31 第五轮：「不要因为加载出来导致动画重头开始放」）。
   上面那条 100% 是给**收起态浮窗**的（它没有 balance-footer__today-wait，
   只能靠这条把雾铺满金额格）。但展开态同时挂着 today-wait，一旦也被拉成 100%×100%，
   等待态的 5.5ch×11px 小胶囊会在"值到手"那一帧突然变成「数字框那么大」——
   两层 radial 光团全是百分比尺寸与百分比位移，框一变，每团光的位置/大小整体重算，
   看起来就是动画从头初始化了一遍（这正是用户反复反馈的那一条）。
   所以这里把几何**钉回等待态的数值**，让它自始至终是同一颗胶囊：
     · 尺寸 5.5ch × 11px 不变 → 伪元素的 % 全部不变 → 光团相位不动；
     · 外层 __mist 是 inset:0 的居中 flex，整行又是 justify-content:center，
       胶囊中心恒等于数字框中心 —— 数字变宽时它在**屏幕坐标里其实没动**。
   收起态（.balance-fab__today-wipe-mist，不带 today-wait）不受这条影响。 */
.balance-footer__today-reveal__mist.balance-footer__today-wait .balance-usage-mist{
  width:5.5ch;min-width:5.5ch;height:11px;flex:none;
  /* ⚠️ 揭幕态必须补一层**实底**，否则亮度/模糊度会和加载态不一样（2026-10-31 第十一轮：
     「擦出动画开始之后 雾的亮度或者说是模糊度跟在加载的时候不一样」）。
     原因不在 alpha，而在 backdrop root：给这层加上 mask-image 之后，它自己就成了新的
     backdrop root，里层 .balance-footer__today-fog 的 backdrop-filter **再也采不到胶囊
     背后的侧栏底色**，只剩下面那两团光 —— 玻璃少掉一层深色，整体白一档、也更"糊"。
     实测（同一胶囊、同一光团相位，取胶囊内部）：加载态 mean 68.1 / peak 127；
     揭幕态 mean 81.5 / peak 175（+20% / +38%）。放到深红底上更明显：加载态能透出
     rgb(93,51,51)，揭幕态变成 rgb(100,67,67) —— 底色被采样这件事直接消失。
     所以揭幕态给胶囊铺「侧栏底色 + 3% 白」的实底，把那层丢失的背景补回来：
     实测 mean 69.3 / peak 137，和加载态只差 1.2 / 10（0.5% / 4%，肉眼无感）。
     底色必须用 --dsw-specific-sidebar-fill（深色主题 = neutral-bluish-900 = #1b1b1c），
     **不是 --dsw-alias-bg-layer-1（#232324）**：用户 65×15 那个今日胶囊截图四角恒为
     rgb(27,27,28)，说明侧栏底就是 #1b1b1c，用 layer-1 会偏高 8 级、擦出瞬间亮一下。
     换成变量后未来换主题/换宿主容器只改 --today-mist-bed 一处；
     收起态浮窗那颗（.balance-fab__today-wipe-mist，没有 fog 层、也不带 today-wait）不受影响。 */
  background:linear-gradient(rgba(255,255,255,.03),rgba(255,255,255,.03)),
    var(--today-mist-bed,var(--dsw-specific-sidebar-fill,#1b1b1c));
}
@keyframes balance-today-hole{0%{--today-hole:0%}100%{--today-hole:100%}}
.balance-footer__today-reveal__body{position:relative;display:inline-flex;align-items:baseline;white-space:pre}
/* 揭幕动画：挂在 --enter 修饰类上，只有「今日数值变了」才挂（2026-10-31 第十轮）。
   这恢复了最初的手感 —— 值一变就擦一次；而折叠/展开侧栏不算值变化，
   序号不动、类不挂，不会重播。 */
.balance-footer__today-reveal__body--enter{animation:balance-today-num-wipe .26s cubic-bezier(.33,0,.67,1) both}
@keyframes balance-today-num-wipe{
  0%{clip-path:inset(0 100% 0 0)}
  100%{clip-path:inset(0 0 0 0)}
}
/* ── 时段词 空闲 ⇄ 高峰 ──
   换词时元素靠 key 重挂（useChangeTick），这里只负责那一次淡入。
   纯淡入、无位移、300ms：比金额入场快一点，因为它只是一个小标签换字。 */
/* 时段词（空闲 / 高峰）切换时只做**纯淡入**，不做任何位移 ——
   早期版本是 translateY(4px) 的上浮，看着像在"滚动/跳一下"，
   用户 2026-10-31 明确「不是滚动动画」。
   另外这个类只在真正切换时才挂（periodTick > 0），启动首帧的「空闲」是静态出现的。 */
.balance-footer__period-swap{display:inline-block;animation:balance-period-fade .3s cubic-bezier(.22,.72,.28,1) both}
@keyframes balance-period-fade{
  0%{opacity:0}
  100%{opacity:1}
}
/* 剩余时间整串换掉时用的上浮淡入（段数变了才会走到那条分支）。
   和时段词的纯淡入刻意分开：剩余时间本来就允许有位移感，时段词不要。 */
@keyframes balance-period-swap{
  0%{opacity:0;transform:translateY(4px)}
  100%{opacity:1;transform:translateY(0)}
}
/* ── 剩余时间「剩 3h57m」的逐段滚动 ──
   数字段各自是一个 .balance-footer__roll（内含 dout/din 滚格），
   字母段（h / m / d）保持静止，段数变了就整体换一次。 */
.balance-footer__remain{display:inline-flex;align-items:baseline;white-space:pre}
.balance-footer__remain-unit{display:inline-block}
.balance-footer__remain-swap{display:inline-block;animation:balance-period-swap .3s cubic-bezier(.22,.72,.28,1) both}
/* 剩余时间里的滚格子必须 inline-block，否则在 inline-flex 里会被压成零宽 */
.balance-footer__remain .balance-footer__roll{display:inline-flex;align-items:baseline}
.balance-footer__remain .balance-footer__dcell{display:inline-block}
.balance-footer__wave{position:absolute;left:0;right:0;top:0;bottom:0;overflow:hidden;border-radius:var(--dsw-radius-lg,14px);corner-shape:round;pointer-events:none;z-index:2}
/* 前沿白条：纯白，不带品牌色辉光（2026-10-30 反馈「只保留白色光效 不要颜色」）。
   只扫一层白光，**不覆盖扫过区域**——曾经有一个 ::after 暗罩把白条右侧整体压暗，
   视觉上等于给扫过的部分蒙了层色，已删除（2026-10-30 反馈「不要为扫过区域的颜色覆盖了」）。
   现在动效 = 一条白光从左走到右，走完即止，行内颜色全程不变。 */
.balance-footer__wave::before{content:"";position:absolute;top:1px;bottom:1px;left:0;width:6px;margin-left:-3px;border-radius:999px;corner-shape:round;background:#fff;box-shadow:0 0 3px 1px rgba(255,255,255,.95),0 0 8px 3px rgba(255,255,255,.42),0 0 14px 5px rgba(255,255,255,.16);animation:balance-wipe-head .58s cubic-bezier(.34,.7,.26,1) forwards}
@keyframes balance-wipe-head{0%{left:0;opacity:0}5%{opacity:1}82%{opacity:1}100%{left:100%;opacity:0}}
/* ── 收起态右键水波（2026-10-31 重新设计）─────────────────────────────────────
   需求原话：「设计成水面波浪样式的 鼠标点击的对应区域为波浪中心 向外扩张」，
   第二轮补充：「波浪要覆盖整个矩形 而且玻璃不是很明显 并且速度是从快到慢的」。
   做法：三圈同心环，圆心 = 右键点，从 scale(.04) 推到 scale(1)，边推边淡出。
   - 环径 420px（半径 210）：卡片 112×160 的**对角线**约 195px，点击在最角落时
     最远端点离圆心也有 195px，所以半径必须 ≥195 才能覆盖整卡。210 留了余量，
     推到终点时环已经完全跑出卡片边界、被圆角裁掉，不会看到"环停在半路"。
   - 只放一圈（2026-10-31：「只显示一条就够了」）：三圈错开会读成重复的同心环。
   - 亮度要够（2026-10-31：「波浪还是太暗了」）：第一版边框 .5、辉光 .22，
     在深底上几乎看不出是玻璃。现在边 2.5px/.95、外辉光 .6、内辉光 .45，
     并把关键帧的峰值 opacity 拉到 1 —— 深色卡片上要"亮得起来"才看得见波纹。 */
.balance-fab__ripple-layer{
  position:absolute;inset:0;overflow:hidden;border-radius:inherit;
  pointer-events:none;z-index:2;
}
.balance-fab__ripple{
  position:absolute;width:420px;height:420px;margin:-210px 0 0 -210px;
  border-radius:50%;border:2.5px solid rgba(255,255,255,.95);
  box-shadow:
    0 0 26px 7px rgba(255,255,255,.6),
    0 0 64px 18px rgba(255,255,255,.3),
    inset 0 0 30px 9px rgba(255,255,255,.45);
  transform:scale(.04);opacity:0;
  animation:balance-ripple .7s linear forwards;
}
/* ⚠️ 「先快后慢」靠**关键帧的位移分布**表达，不是靠 ease-out（2026-10-31）：
   强 ease-out 的末段斜率趋 0，环会在边缘长时间爬行、最后"卡住再消失"，
   读起来是顿住而不是减速。这里 linear 对每个关键帧区间各自生效，
   所以每段速度 = 该段位移 / 该段时间，改位移就改了速度：
     0–12%   scale .04→.22   .18/12% = 1.50 倍速   起步冲出去
     12–40%  scale .22→.58   .36/28% = 1.29 倍速   惯性推进
     40–72%  scale .58→.82   .24/32% = 0.75 倍速   开始减速
     72–100% scale .82→1.00  .18/28% = 0.64 倍速   收尾放缓
   亮度同步衰减，推到边缘时正好消失。 */
@keyframes balance-ripple{
  0%{transform:scale(.04);opacity:0}
  10%{transform:scale(.20);opacity:1}
  40%{transform:scale(.58);opacity:.92}
  72%{transform:scale(.82);opacity:.6}
  100%{transform:scale(1);opacity:0}
}
/* 尊重系统的「减少动态效果」：不荡水波，只留静态弱化（与展开态同一条规矩）。 */
@media (prefers-reduced-motion:reduce){
  .balance-fab__ripple{animation:none;opacity:0}
}
/* 尊重系统的「减少动态效果」：不播，只留 --stale 的静态弱化 */
/* 浪潮白条不受 prefers-reduced-motion 影响：它是右键刷新的签名动效，故意保留 */
/* 旧版余额行用到的图标与「余额」二字（footerStyle === "classic" 时才渲染） */
.balance-footer__icon{display:inline-flex;flex:none;color:var(--dsw-alias-label-primary)}
.balance-footer__label{flex:none;color:var(--dsw-alias-label-primary)}
.balance-footer__value{box-sizing:border-box;position:relative;z-index:0;isolation:isolate;display:inline-flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums;font-weight:500;font-synthesis:none;font-size:16px;line-height:1;white-space:nowrap;padding:7px 14px;border-radius:999px;corner-shape:round;margin-left:auto;margin-right:4px;text-decoration:none;cursor:pointer;transition:transform .15s var(--ds-ease-in-out,.2s),box-shadow .18s var(--ds-ease-in-out,.2s),color .42s var(--ds-ease-in-out,.2s),background .42s var(--ds-ease-in-out,.2s);flex:none;/* 宽度恒定 121px：靠「固定 px + 位数多就缩字号」两条一起实现。
   ⚠️ 开头的 box-sizing:border-box 是前提，不能省：min-width 默认算的是「内容盒」，
   少了它 121px 会变成 121 + 左右 padding 28px = 149px 总宽，胶囊凭空胖一圈
   （用户反馈「我的余额胶囊为什么这么长」，真实客户端实测正是 149px）。DSH 页面上
   没有全局 border-box，刻度条 / 去充值 / FAB 都各自显式写了，只有这一处漏过。
   胶囊内容是 total_balance + " " + currency（见 totalText），16px 粗体实测天然宽度：
     0.00 CNY 105.6 · 10.32 CNY 111.5 · 100.00 CNY 121.4 · 1234.56 CNY 131.3 · 12345.67 CNY 141.1
   余额 10.32 -> 9.87 少一个整数位就窄 6px，胶囊会跳（用户反馈「从10块掉到9块时
   余额胶囊宽度变了」）；而四位数以上又会反过来撑宽、把右边挤出容器。
   所以：0~999.99 用 16px + min-width 撑到 121px；超过四位数自动降字号
   （--dense 13px / --dense2 11.5px），缩回 121px 以内。两端都恒定。
   ⚠️ min-width 必须用 px 不能用 em：em 相对自身 font-size，一缩字号锁定宽度也跟着缩，
   宽度照样跳。也别按「¥14.34 • 空闲」这种臆想格式去量 —— timeline 胶囊里只有
   金额+货币码，先前按假格式算出 6.6em 恰好等于 0.00 CNY 的天然宽度，对任何值都不生效（踩过）。
   justify-content:flex-end 让内容靠右，位数少时留白落在左边。 */min-width:112px}
/* 余额位数多时降档，配合上面的固定宽度，让长金额也收在 121px 内 */
.balance-footer__value--dense{font-size:13px}
.balance-footer__value--dense2{font-size:11.5px}
/* 悬停反馈**不许用 filter:brightness**（2026-10-31：「播放手动刷新的动画时余额颜色怎么变了」）。
   filter 作用在整个元素上，连文字带背景一起乘 0.85 —— 而右键刷新时鼠标必然停在胶囊上，
   于是 :hover 和刷新动画同时生效，橙色（低余额）被压暗一档，看起来就是"动画把颜色改了"。
   实测就是这个：同一张橙底，悬停前后肉眼可辨。
   现在只做位移动画 + 底色加深，**文字颜色全程恒定**。 */
/* hover 反馈按**布局**分两套（2026-10-31：「我需要旧版是胶囊放大 新版是泛光」）。
   这里的「旧版 / 新版」指的是两种布局，不是插件版本：
     · 旧版 = classic 布局（.balance-footer--classic，胶囊靠右）      → 整个胶囊放大
     · 新版 = stacked 布局（.balance-footer--stacked，时段词在下方） → 泛光，几何不动
   两套都保留底色加深（下面 --healthy:hover / --low:hover），文字颜色全程恒定。
   ⚠️ 不要统一成一种：用户在两种布局里要的是不同手感。
   ⚠️ 放大那套已知副作用：16px→16.96px 落在非整像素 + 提升合成层，次像素抗锯齿失效，
   笔画比静止时略粗、边缘略软。这是换「胶囊变大」的既定代价，别再改成 font-size。 */
/* 旧版布局：胶囊放大 */
.balance-footer--classic .balance-footer__value:hover{transform:scale(1.06)}
/* 新版布局：泛光（膨胀 + 柔光都交给 box-shadow，不重绘文字、不建合成层） */
.balance-footer--stacked .balance-footer__value:hover{
  box-shadow:0 0 5px 1.5px rgba(34,197,94,.26),0 0 20px 3px rgba(34,197,94,.34)}
.balance-footer--stacked .balance-footer__value--low:hover{
  box-shadow:0 0 5px 1.5px rgba(217,119,6,.26),0 0 20px 3px rgba(217,119,6,.34)}
.balance-footer__value--healthy:hover{background:rgba(34,197,94,.22)}
.balance-footer__value--low:hover{background:rgba(217,119,6,.22)}
/* 旧版布局：胶囊靠右 —— 这是备份 v1.3.1 里的原始写法（margin-left:auto）。
   不能放到基础规则上，新版 timeline 用 margin:0 auto 居中，会和它打架。 */
.balance-footer--classic .balance-footer__value{margin-left:auto}
.balance-footer__value--healthy{color:var(--dsw-alias-state-success-primary);background:rgba(34,197,94,.15)}
/* 正在刷新：金额栏压成半透明旧值，和左侧的时段占位呼应，避免旧数字看起来像刚更新的 */
/* 刷新中不再整体降透明度（2026-10-31：「播放手动刷新的动画时余额颜色怎么变了」）。
   原来这里 opacity:.9，和上面的 hover 变暗叠在一起，刷新那一下颜色明显发灰。
   刷新反馈已经有白光扫过 + 数字擦除两件事，不需要再压一层透明度 ——
   金额胶囊的颜色在所有状态下必须恒定。 */
/* 手动刷新（右键）：金额被白光从左擦出来 —— 与输入区「本会话消耗」同一套手法。
   **必须是双层**（2026-10-30 用户反馈「没被光条扫到的区域接着显示 不要直接消失了」）：
   底层 __reveal-base 常显（上一帧的值），上层 __reveal-sweep 才是被 clip-path 裁切的那层。
   裁切挂在 sweep 自己身上而不是外层容器，所以光条没扫到的地方照旧显示旧值，不会先变空白。 */
.balance-footer__reveal{display:inline-grid;position:relative;height:20px;height:1lh}
.balance-footer__reveal>*{grid-area:1/1;white-space:nowrap}
/* 底层同样要走裁剪，不能靠 sweep 盖上来：文字是笔画不是色块，两层的字形会叠成一团糊字
   （2026-10-30 用户截图「5.96 CNY」中间叠着别的数字，就是这么来的）。
   所以 base 从左边被裁掉、sweep 从左边展开 —— 交界处永远只有一层内容。
   收尾时 base 已被裁光，右侧不会留旧值的尾巴，也不需要额外淡出。 */
/* 底层**必须绝对定位**：clip-path 只作用于绘制，不影响布局 —— 留在 grid 流里时，
   旧值的宽度照样会算进容器（实测 8.04 稳态 73.66px，带上旧值 11.04 的底层就变 83.53px）。
   后果是自动刷新时胶囊先宽 10px 再缩回，看着像数字在左右跳。
   拉出流之后宽度只由 sweep 决定，稳态与滚动过程中完全一致。 */
.balance-footer__reveal-base{position:absolute;inset:0 auto 0 0;display:flex;align-items:center;white-space:nowrap}
@keyframes balance-base-in{from{clip-path:inset(0 0 0 0)}to{clip-path:inset(0 0 0 100%)}}
.balance-footer__reveal-sweep{position:relative;overflow:hidden}
/* ⚠️ 擦除动画**只在真正手动刷新时**才挂（2026-10-31 第三轮：「重播白光没事 关键是
   扣费动画也会重播」）。原来这两条 animation 无条件写在元素上，而它们是挂在元素上的
   CSS 动画 —— 折叠/展开侧栏会让 BalanceFooter 卸载重挂、DOM 节点重建，动画就从 0 秒
   重新播一遍，看起来就是「凭空扣了一次费」。而 revealSeq 是组件 state，重挂后归 0，
   所以用 --animate 修饰类做闸门，与 revealSeq 严格同步：只有它 +1 过才有这个类。 */
.balance-footer__reveal--animate .balance-footer__reveal-base{animation:balance-base-in .34s cubic-bezier(.34,.7,.26,1) both}
.balance-footer__reveal--animate .balance-footer__reveal-sweep{animation:balance-calc-reveal .34s cubic-bezier(.34,.7,.26,1) both}
/* 胶囊内部**不放光条**（2026-10-30 用户要求「余额内的光条撤了」）：
   外面那层 .balance-footer__wave 已经在整块扫白光了，胶囊里再来一道就是两道白光打架。
   这里只保留 clip 揭示 —— 数字从左被「擦」出来，边界交给外面那道光。 */
/* 设置里关掉「右键刷新浪潮」：不载入动画，金额直接显示。
   ⚠️ 底层必须一起 display:none —— 去掉裁剪后 sweep 会全显，两层文字重叠成一团糊字
   （2026-10-30 用户截图报的正是这个：5.96 CNY 中间叠了个别的数字）。 */
.balance-footer__reveal--off .balance-footer__reveal-sweep{animation:none;clip-path:none}
.balance-footer__reveal--off .balance-footer__reveal-base{display:none}
/* 同上：reduce 时没有动画，只留新值那一层，否则同样是两层重叠 */
@media (prefers-reduced-motion:reduce){
  .balance-footer__reveal-sweep{animation:none;clip-path:none}
  .balance-footer__reveal-base{display:none}
}
.balance-footer__value--low{color:#d97706;background:rgba(217,119,6,.15)}
.balance-footer__value--empty{color:var(--dsw-alias-state-error-primary,#e5484d);background:rgba(229,72,77,.15)}
.balance-footer__topup{margin-left:auto;flex:none;box-sizing:border-box;padding:2px 10px;border-radius:999px;font-weight:500;white-space:nowrap;color:var(--dsw-alias-state-error-primary,#e5484d);text-decoration:none;background:rgba(229,72,77,.15);transition:transform .15s var(--ds-ease-in-out,.2s)}
.balance-footer__topup:hover{filter:brightness(.85);transform:scale(1.06)}
/* 旧版金额胶囊里的分隔点：两侧各 5px，柔化到 50% 不透明，不抢金额 */
.balance-footer__sep{flex:none;margin:0 5px;opacity:.5;font-weight:400}
.balance-footer__period-inline{font-weight:500;white-space:nowrap}
.balance-footer__period-inline--refreshing{color:var(--dsw-alias-label-secondary)}
.balance-footer__period-inline--peak{color:var(--dsw-alias-state-error-primary,#e5484d)}
.balance-footer__period-inline--offpeak{color:var(--dsw-alias-state-success-primary)}
/* 时段刻度条：色带固定 = 一整天，指针随时刻从左走到右。
   结构：[meta 行(今日/时段/剩余)] + [轨道(边框) → 裁剪层(1px 内缩 → 泛光 + 色带) + 指针]。
   轨道刻意做扁（20px 压到 13px），上方留一行给文字，整块像个"仪表盘"而不是"进度胶囊"。 */
.balance-footer__timeline{position:relative;z-index:0;display:inline-flex;flex-direction:column;align-items:center;gap:4px;flex:1 1 auto;min-width:0;white-space:nowrap;margin:0;overflow:hidden}
/* meta 行：等宽数字，三项之间用中点分隔感靠 gap 制造。
   三项都 flex:none、都 nowrap，所以这一行只会随内容变宽、永不主动收缩 ——
   「今日 ¥1234.56」比「今日 ¥14.34」宽两三个数字位，余额胶囊又同时要宽度，
   两者硬碰硬时右侧胶囊会被挤出容器裁掉（余额四位数 + 消费四位数就能复现）。
   所以给它 max-width + flex-wrap：空间不够时三项自己折行，块变高（--stacked 是
   height:auto，撑得住），而不是把胶囊顶出去。 */
.balance-footer__timeline-meta{display:inline-flex;align-items:center;gap:6px;row-gap:3px;flex-wrap:wrap;justify-content:center;max-width:100%;font-size:11px;line-height:1;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#8a8a8a);margin:0}
.balance-footer__timeline-meta-item{flex:none;white-space:nowrap}
/* 「今日 ¥x」独占第一行（flex-basis:100%）并居中，与下面「空闲 剩 3h57m」那一行左对齐成组。
   inline-flex 是为了把「今日」/「¥」/ 滚动数字排成一行（基线对齐，小数点不会上下错）。
   ⚠️ 不要改回条件渲染或 display:none —— 那会让 meta 行从 1 行变 2 行，
   侧栏底部整体被顶下 14px，冷启动时就是「今日余额弹出来那下卡了」（2026-10-30 反馈）。
   等待态以前是整串 visibility:hidden，用户嫌「闪」；2026-10-31 改成
   「今日」二字常显、只有金额部位在等（--today-waiting），且动画只落在金额上。 */
.balance-footer__timeline-meta-item--today{flex:0 0 100%;display:inline-flex;align-items:baseline;justify-content:center;gap:3px;text-align:center}
.balance-footer__timeline-meta-item--today-waiting{align-items:center}
/* 等待态跟消耗行同一套语言（设置里选哪种，这里就哪种），但不能照搬几何尺寸：
   ⚠️ 消耗行的白雾是 5 团 52×26、blur 4.2px 的光球，塞进 9px 高的 meta 行会被裁成一团
   灰板、且看不出在动（2026-10-31 实测截图）。所以小尺寸单独标定。 */
/* 宽度自适应，**不要加 min-width** —— 加了整块就不居中了（见 --today-value 的注释）。
   高度 11px：数字行高实测 13.67px，原来 6px 只能做一道扫光、看着是「很细的长条」；
   抬到 11px 才有空间做「光团 + 毛玻璃」两层。11px 仍小于行高，不会把 meta 行撑高。 */
.balance-footer__today-wait{display:inline-flex;align-items:center;justify-content:center}
/* 2026-10-31 第五轮定案：**不是斜向扫光条**。用户原话「底层白色不规则来回流动 然后顶上
   盖了层毛玻璃 雾透的感觉」。所以：
     底层 = 两个各自独立飘移的白色光团（radial-gradient，不是 linear 的条），
            半径、相位、时长、方向全都错开 —— 叠起来才有"不规则"的流动感，
            单条 linear 扫光永远是一条直线在平移。
     顶层 = .balance-footer__today-fog 用真的 backdrop-filter 做毛玻璃，
            **模糊的是底下的光团本身**，光因此变成雾里的光，而不是锐利白条上蒙一层半透明色。
   伪元素 ::before / ::after 全部分给两层光团，毛玻璃层是第三个真实元素（伪元素没有第三层可用）。
   isolation:isolate 让 backdrop-filter 只吃这个胶囊内部的内容，不会把外面的侧栏背景也糊进来。 */
.balance-footer__today-wait .balance-usage-mist{position:relative;overflow:hidden;isolation:isolate;width:5.5ch;min-width:5.5ch;height:11px;border-radius:999px;corner-shape:round;background:rgba(255,255,255,.03);box-shadow:0 0 6px rgba(255,255,255,.055);-webkit-mask-image:none;mask-image:none;animation:none}
/* 光团 A：两团不同大小的柔光，整体左右来回（alternate）+ 缩放 + **形状形变**。
   inset 负值让光团能飘出胶囊边界，再被 overflow:hidden 裁掉 —— 进出都是渐隐的，不会硬切。
   ⚠️ 半径必须小（30%/26% 一档），大了两团就糊满整条、退化成一块均匀白板，
   实测「不规则流动」立刻消失 —— 2026-10-31 第一版用 42%/30% 就是这样。
   ⚠️ 液体感的来源不是位移，是**border-radius 百分比形变 + blur 融合**
   （2026-10-31：「让里面看起来更像是流动的液体」）。只做 translate + scale 时，
   形状是固定的一块光在滑过，读起来是"光斑移动"；让四角半径各自呼吸、
   再叠一层 blur 把两团光的边缘揉在一起，才像有粘性的流体在挤。
   border-radius 的斜杠语法两半都是长度对，可插值，能进 keyframes。
   ⚠️ delay 走 var(--today-flow-a)，由渲染层每次挂载随机给一个负值 —— 原来写死 -.5s，
   每次重挂的第一帧都落在同一点，见下面 B 那条和 makeTodayFlowStyle 的注释。 */
.balance-footer__today-wait .balance-usage-mist::before{content:"";position:absolute;inset:-45% -35%;pointer-events:none;border-radius:46% 54% 62% 38% / 55% 42% 58% 45%;filter:blur(2.4px);background:radial-gradient(30% 58% at 28% 34%,rgba(255,255,255,.62),rgba(255,255,255,0) 70%),radial-gradient(22% 46% at 70% 70%,rgba(255,255,255,.34),rgba(255,255,255,0) 72%);animation:balance-today-flow-a 1.4s ease-in-out var(--today-flow-a,-.5s) infinite alternate}
/* 光团 B：更小更亮的芯，方向与 A 相反、节奏更慢（2.2s vs 1.4s）。
   两个非整倍数的时长叠在一起，交叉点永远不会落在同一相位，视觉上就"没有周期"。
   ⚠️ 这两层的 animation-delay 都是**负值**，不是随便填的：ease-in-out 从 0 速度起步，
   等待态出现的头 300~400ms 里光团几乎不动 —— 用户 2026-10-31：「里面的滚动太慢了
   导致刚加载出来看起来没在动」。负 delay 让动画直接从「速度已经起来」的相位开始，
   一出现就在流。时长 2026-10-31 再收一轮（1.9→1.4 / 3.1→2.2），非整数倍关系保持不变。
   ⚠️ 但**负 delay 写死 = 每次挂载都从同一相位起步**（2026-10-31 第八轮：「每次开始动画
   的时候 都是右下角发白」）。B 的 0% 帧是 translate3d(20%,16%)，那团 .72 alpha 的亮芯
   被推到右下角；写死 -1.1s 时首帧相位固定，于是每次重挂（展开侧栏 / 切会话 / 重开）
   第一眼都是同一张「右下角发白」，两段录像逐帧一对比几乎一模一样。
   而且从挂载到出值再到擦出，整条时序是确定的（+560ms 发请求 → 约 400ms 回），
   所以连「擦出那一刻的光团相位」每次也几乎一样。
   现在延迟由 makeTodayFlowStyle 每次挂载随机取，整条时序被去同步，各次不再复读。 */
.balance-footer__today-wait .balance-usage-mist::after{content:"";position:absolute;inset:-45% -35%;pointer-events:none;border-radius:58% 42% 40% 60% / 44% 56% 40% 60%;filter:blur(3px);background:radial-gradient(19% 40% at 62% 40%,rgba(255,255,255,.72),rgba(255,255,255,0) 74%),radial-gradient(25% 36% at 24% 72%,rgba(255,255,255,.26),rgba(255,255,255,0) 78%);animation:balance-today-flow-b 2.2s ease-in-out var(--today-flow-b,-1.1s) infinite alternate}
.balance-footer__today-wait .balance-usage-mist__orb{display:none}
/* 毛玻璃层：盖在两层光团之上的第三层。
   ⚠️ 关键是 backdrop-filter 而不是「半透明白色贴片」—— 前者真的把底下的光团糊掉，
   再叠一层极淡的白，才有"雾透"；后者只是在光上盖一块灰，看着是脏而不是雾。
   不透明度务必压低（累计约 .05~.08），高了就把两层光全吃掉、变成一块实心板。
   blur 加到 3.4px：2.6px 时光团的硬芯还能透出来，看着是"亮带"而不是"雾里的光"。 */
.balance-footer__today-fog{position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015));-webkit-backdrop-filter:blur(3.4px) saturate(1.2);backdrop-filter:blur(3.4px) saturate(1.2);animation:balance-today-fog-breathe 2.8s ease-in-out -.7s infinite}
/* 雾的呼吸：只动不透明度，**不动 transform** —— 位移交给底下两层光团，
   雾要是也平移，整块会跟着走，就不像"盖着的一层"了。 */
@keyframes balance-today-fog-breathe{0%{opacity:.82}50%{opacity:1}100%{opacity:.82}}
/* 光团 A 的轨迹是折线不是横线：X 来回 + **Y 大幅上下** + 正负倾斜交替。
   ⚠️ 容器只有 11px 高，Y 方向的百分比是相对**元素自身高度**（inset:-45% 后约 21px）算的，
   所以 ±4% 只等于 0.84px —— 肉眼完全看不出垂直位移，读起来就是"只有左右在动"
   （2026-10-31：「当前的流动感觉就是只有左右」）。Y 必须放大到 ±17% 一档（约 3.6px），
   配合 ±8deg 的倾斜，扁平区域里才读得出"斜着涌过去"。
   倾斜也参与形变：rotate 让光团的上下边缘一端抬高、一端压低，等效于不规则拉伸。 */
@keyframes balance-today-flow-a{
  0%{transform:translate3d(-14%,-17%,0) scale(1.02) rotate(-8deg);border-radius:44% 56% 64% 36% / 56% 40% 60% 44%}
  50%{transform:translate3d(2%,18%,0) scale(1.16) rotate(7deg);border-radius:62% 38% 42% 58% / 38% 62% 40% 60%}
  100%{transform:translate3d(16%,-13%,0) scale(1.06) rotate(-6deg);border-radius:36% 64% 58% 42% / 62% 44% 56% 38%}
}
/* 光团 B 的 Y 相位与 A **严格错开**（A 在上时 B 在下），两层才会互相穿过去，
   而不是一起上下晃 —— 同步就退化成整块平移。
   Y 幅度同样是 ±17% 一档，方向与 A 相反，倾斜方向也相反。 */
@keyframes balance-today-flow-b{
  0%{transform:translate3d(20%,16%,0) scale(1.22) rotate(8deg);border-radius:60% 40% 38% 62% / 42% 58% 42% 58%}
  50%{transform:translate3d(2%,-18%,0) scale(.98) rotate(-7deg);border-radius:38% 62% 60% 40% / 60% 40% 62% 38%}
  100%{transform:translate3d(-16%,12%,0) scale(1.1) rotate(6deg);border-radius:56% 44% 42% 58% / 40% 60% 44% 56%}
}
@media (prefers-reduced-motion:reduce){
  /* 停流但保持"有光在雾后面"的样子：光团定在中位、雾照常盖着。
     不能让它们退回透明，否则等待态就只剩一个空胶囊。 */
  .balance-footer__today-wait .balance-usage-mist::before{animation:none;transform:translate3d(0,0,0);opacity:.9}
  .balance-footer__today-wait .balance-usage-mist::after{animation:none;transform:translate3d(0,0,0);opacity:.8}
  .balance-footer__today-fog{animation:none;opacity:.92}
}
/* 「计算中」在这里去掉胶囊底：meta 行只有 11px 字号，套上 pill 会更宽并挤出容器，
   直接内联文字反而干净（消耗行那边仍保留 pill）。 */
.balance-footer__today-wait .balance-usage-calc{background:0 0;height:auto;padding:0;font-size:9px;line-height:1;white-space:nowrap;gap:0}
/* 等待态换成真实值时不再整块淡入 —— 用户 2026-10-31 反馈「今日消耗刷新出来时
   「今日」二字也会闪一下」。现在动画只落在金额上（逐位滚动 buildRollCells），
   「今日」二字恒定不动，所以这条整块淡入规则连同它的 keyframes 一起删掉了。 */
/* 「今日」二字：恒定不动。⚠️ 绝不给它加任何 animation/transition，
   否则每次金额刷新它都会跟着闪一次（就是用户报的那个现象）。 */
/* 金额长度变化时，「今日」会被整块重新居中推到新位置。
   ⚠️ 这里不再用 keyframes：5px 的假位移看着仍是"跳一下再归位"，
   用户 2026-10-31 明确要「滑动过去」。真正的滑动由 JS 量出实际位移再补 ——
   见 usePrePaintEffect 里给 label 写 style 的那段（transition 由它临时加上）。 */
.balance-footer__today-label{display:inline-block}
/* ¥ 与数字之间的呼吸：¥ 是宽字符，紧贴数字会显得糊在一起
   （2026-10-31 用户指出「数字是不是太靠近¥了」）。2px 在 11px 字号下刚刚好，
   再多就会被读成两个独立的词。 */
.balance-footer__today-cur{margin-right:2px}
/* 金额区：与会话消耗同一个滚动实现（buildRollCells + .balance-footer__roll）。
   ¥ 放在滚动区外层 —— buildRollCells 按「数字开头」拆分，¥ 在里面会被当成整串 tail，
   变成一格整体平移，就没有逐位过位的效果了。 */
/* 宽度自适应 —— **不要加 min-width**。
   试过 min-width:48px 让「今日」彻底不动，结果是金额窄时右侧留白、
   整块不再居中，标签被推到左边，看着很不协调（2026-10-31 用户截图反馈）。
   所以宽度跟着数字走，位置变化由 usePrePaintEffect 里的位移过渡吃掉。 */
.balance-footer__today-value{position:relative;isolation:isolate;display:inline-flex;align-items:baseline;justify-content:center;white-space:pre;font-variant-numeric:tabular-nums}
/* 揭幕期间的加载动画层现在由 .balance-footer__today-reveal__mist 承担（见上方定义），
   它和数字层是同容器的兄弟节点、宽度天然相等，靠 linear 遮罩挖洞露出一部分数字。
   旧的「absolute 垫在数字下面 + 数字自己 clip」方案已废弃：两者盒子宽度不同，
   挖洞边界和揭幕边界对不齐，交界处会同时出现胶囊和数字（2026-10-31：「数字怎么显示在动画里了」）。 */
/* meta 的第二段（时段词 + 剩余时间）作为一个整体不拆开：折行时它整段落到
   「今日 ¥x」下面那行，于是「空闲」永远和「剩 3h57m」同行。 */
.balance-footer__timeline-meta-group{display:inline-flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0;white-space:nowrap;max-width:100%}
/* 时段词单独上色：高峰红、空闲绿（其余两项保持中性灰，避免整行花掉） */
.balance-footer__timeline-meta-item--peak{font-weight:600;color:var(--dsw-alias-state-error-primary,#e5484d)}
.balance-footer__timeline-meta-item--offpeak{font-weight:600;color:var(--dsw-alias-state-success-primary,#22c55e)}
/* ⚠️ 需要「实心彩底 + 白字」的地方一律用硬编码 #4d6bfe，不要用 var(--dsw-alias-brand-primary)。
   实测（2026-10-30 用户截图）：DSH 暗色主题里这个变量的值是**接近纯白**的 ——
   官方拿它画 toggle 开关和分组竖条，所以那些地方保持白色才对；
   但套在「白底 + 白字」的徽标上就彻底看不见（用户反馈「NEW 标签还有 bug」）。 */
/* 轨道外框 1px（原 2px）：2px 在 15px 高的条上显得笨重，压住里面彩色时段。
   边框只负责描边，色带与描边之间的空隙由下面 clip 的 1px 内缩提供。 */
.balance-footer__timeline-track{position:relative;display:block;box-sizing:border-box;width:100%;max-width:100%;height:15px;margin:0;border:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary,#8a8a8a) 70%,transparent);border-radius:999px;corner-shape:round;flex:none}
/* 描边统一中性灰：时段已经由 meta 行的「高峰 / 空闲」文字给出，
   轨道再上色就是同一信息说三遍，还会和色带里的红绿抢注意力。
   类名保留（--peak / --offpeak 仍在 JSX 上），将来想恢复彩色描边直接补规则即可。 */
/* 内嵌裁剪层：四边各让 1px，色带裁在这里，颜色与边框之间留一线空隙。
   注意这 1px 是**独立的视觉空隙**，不是给边框让位 —— 边框改窄（2px→1px）时
   它必须留着，否则色带会直接贴到描边上，看起来糊成一整块。 */
.balance-footer__timeline-clip{position:absolute;left:1px;right:1px;top:1px;bottom:1px;overflow:hidden;border-radius:999px;corner-shape:round;isolation:isolate}
/* 泛光层：同一渐变模糊后叠在色带**上面**，靠模糊边缘往外散光。
   刻意不用 screen 混合、也不把 brightness 拉太高——那会把 #e5484d 推成粉白，
   红色看起来"发怪"。这里只轻微提亮 + 降透明度，色相保持在原色上。 */
.balance-footer__timeline-glow{position:absolute;left:-3px;right:-3px;top:-3px;bottom:-3px;pointer-events:none;filter:blur(3px) saturate(1.5) brightness(1.15);opacity:.45;z-index:2}
/* 色带本身：不透明 + 轻微提饱和，颜色是主角 */
.balance-footer__timeline-band{position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;filter:saturate(1.25) brightness(1.12);z-index:1}
/* 换日时色带的交叉淡入：两条 linear-gradient 之间不可插值，只能新旧两层叠着换 opacity。
   TimelineBand 把旧分布垫在下面，新分布挂这个类淡入盖上去，播完摘掉旧层。
   终点 opacity 读 --balance-band-to：色带本体 1、泛光层 .45 —— 写死 1 会把泛光拉成实心。 */
.balance-footer__timeline-fade{animation:balance-band-fade 620ms cubic-bezier(.4,0,.25,1) both}
@keyframes balance-band-fade{from{opacity:0}to{opacity:var(--balance-band-to,1)}}
/* 指针位置由 TimelinePointer 写 inline style 的 left（3px 端内缩，见组件里的 calc）。
   入场走 **CSS animation**（--intro 类 + balance-ptr-in），不是 transition：
   - transition 的起点取「上一次样式计算的值」，而重启 DSH 时首屏繁忙、浏览器可能还没为
     这个元素算过样式，那次变更就被当成首次赋值 → 直接跳到终点、一帧都不播
     （2026-10-30 反馈「有时候重启时指针动画会吞掉」）。
   - animation 的 keyframes 有**显式的 from/to**，元素一插入就带着动画，浏览器时间线怎么
     排都不会漏播；首屏忙只会晚一点开始，但一定播完整。补间在浏览器动画管线里跑，
     React 全程只渲染 2 次（挂载、摘类），不抢主线程（逐帧 setState 就是「掉帧」的元凶）。
   - 稳态（每分钟一次落位）**不带**动画：0.069% 的变化直接跳过去，肉眼无感；顺带也
     避开了「后台标签页暂停动画、切回来瞬移」的老问题。
   时长与曲线与刷新白条 balance-wipe-head 完全一致（.58s cubic-bezier(.34,.7,.26,1)）。 */
.balance-footer__timeline-pointer{position:absolute;left:0;top:-1px;bottom:-1px;width:2px;margin-left:-1px;background:var(--dsw-alias-label-primary,#fff);box-shadow:0 0 3px rgba(255,255,255,.7),0 0 2px rgba(0,0,0,.55);pointer-events:none;z-index:2}
.balance-footer__timeline-pointer--intro{animation:balance-ptr-in 580ms cubic-bezier(.34,.7,.26,1) both;will-change:left}
/* from 固定 = pct 0 的位置（0% + 3px 内缩）；to 读元素上的自定义属性，即最终落点。
   both 让动画结束后停在 to，摘掉 --intro 时 inline left 恰好同值，不会跳。 */
@keyframes balance-ptr-in{from{left:3px}to{left:var(--balance-ptr-to,3px)}}
/* ── 侧栏入口的红点 + 未读高亮 ─────────────────────────────────────────── */
.balance-panel-icon{position:relative;display:inline-flex;align-items:center;justify-content:center}
/* 未读时图标本身染成品牌色，比周围灰图标更跳 */
.balance-panel-icon--unread{color:#4d6bfe}
/* 红点：贴在图标右上角，深色描边保证在任意底色上都看得清 */
.balance-panel-icon__dot{position:absolute;top:-2px;right:-3px;box-sizing:border-box;width:7px;height:7px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-state-error-primary,#e5484d);box-shadow:0 0 0 1.5px var(--dsw-alias-bg-module-platform,var(--dsw-alias-base,#1b1b1c)),0 0 5px 1px color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 65%,transparent);animation:balance-dot-pulse 2.2s ease-in-out infinite}
/* 有新版本时的文字提示：品牌色实心小胶囊，绝对定位压在图标右上，
   视觉上落在「余额与用量」几个字的上方。不做脉冲 —— 那是红点的语言，且静止更醒目。 */
.balance-panel-icon__new{position:absolute;left:10px;top:-10px;box-sizing:border-box;padding:1px 4px;border-radius:999px;corner-shape:round;background:#4d6bfe;color:var(--dsw-alias-label-primary-foreground,#fff);font-size:8.5px;line-height:11px;font-weight:600;letter-spacing:.1px;white-space:nowrap;pointer-events:none;box-shadow:0 1px 4px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 55%,transparent)}
/* 有新功能时的入口标签（文案就是 NEW，比「新版本！」短，宽度收紧一点、
   字号抬到 9px 让三个字母站得住）。品牌色实心 + 轻投影，跟「新版本！」同一套语言。 */
.balance-panel-icon__new--feature{padding:1px 3.5px;font-size:9px;line-height:11px;letter-spacing:.4px}
@keyframes balance-dot-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.82);opacity:.72}}
@media (prefers-reduced-motion:reduce){.balance-panel-icon__dot{animation:none}}
/* ── 侧栏面板页（点左侧「余额与用量」后渲染在主区域） ──────────────────── */
/* 页面根：DSH 的主区 mP3x-q_centerCol 是 display:flex;overflow:hidden（不滚），
   slot 出口容器又是 display:contents，所以本元素直接就是那个 flex 的 item。
   要让它自己滚，必须 flex:1 + min-height:0（否则 flex item 的 min-height:auto
   会撑到内容高度，overflow 永远不触发），再配 overflow-y:auto。 */
.balance-panel-page{box-sizing:border-box;display:flex;flex:1 1 auto;flex-direction:column;gap:14px;min-height:0;max-height:100%;width:100%;max-width:820px;margin:0 auto;padding:28px 24px 40px;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.balance-panel-page__head{display:flex;flex-direction:column;gap:6px}
.balance-panel-page__title{margin:0;font-size:18px;line-height:26px;font-weight:600;color:var(--dsw-alias-label-primary)}
.balance-panel-page__desc{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
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
.balance-fab{box-sizing:border-box;position:fixed;left:44px;bottom:140px;z-index:9998;width:60px;height:60px;padding:0;border-radius:50%;corner-shape:round;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.01em;text-decoration:none;white-space:nowrap;overflow:hidden;cursor:pointer;pointer-events:auto;background:color-mix(in srgb,var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-base,#1b1b1c)) 58%,transparent);-webkit-backdrop-filter:blur(18px) saturate(180%);backdrop-filter:blur(18px) saturate(180%);border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 26%,transparent),inset 0 -1px 1px color-mix(in srgb,#fff 8%,transparent),0 6px 20px rgba(0,0,0,.28);transition:transform .18s var(--ds-ease-in-out,ease-out),color .42s var(--ds-ease-in-out,ease-out),background .42s var(--ds-ease-in-out,ease-out),box-shadow .18s var(--ds-ease-in-out,ease-out)}
.balance-fab:hover{transform:scale(1.06);background:color-mix(in srgb,var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-base,#1b1b1c)) 76%,transparent);box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 34%,transparent),inset 0 -1px 1px color-mix(in srgb,#fff 10%,transparent),0 10px 26px rgba(0,0,0,.34)}
.balance-fab:active{transform:scale(.95)}
/* 金额偏长时（如 ¥1234.56）自动收一号字，免得 60px 圆里挤爆 */
.balance-fab--dense{font-size:11px;letter-spacing:-.03em}
/* ── 新版（timeline）收起态：竖排矩形小卡（2026-10-31） ─────────────────────
   用户要求「显示一个矩形 里面显示跟新版里一样的东西 动画也要在」。
   盖掉圆钮那套：圆形/居中单行 → 圆角矩形/竖排四段（余额、时段词、刻度条、今日）。
   宽度由内联 style 给（= fabSize），高度由内容撑开，所以不写死 height。
   border-radius 从 50% 收到 14px：60px 宽的圆形卡片放四行内容会显得像个药丸，
   而且四角要能容纳 15px 高的刻度条。 */
.balance-fab--rect{
  height:auto;padding:12px 9px 11px;border-radius:18px;
  flex-direction:column;align-items:stretch;justify-content:flex-start;gap:5px;
  font-size:17px;line-height:1;
  /* 中文在 9px 下字号落在亚像素里，笔画会发糊；11px 起字形才对齐（2026-10-31：
     「可以再大一点 让字体显示清楚」）。所以时段/今日两行全部提到 11px，
     容器宽度同步 112px，留够「空闲 剩 1d20h」「今日 ¥21.65」的整行宽度。 */
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
  /* ⚠️ 盖掉圆钮那套边缘光（2026-10-31：「外面那圈边框不要跟之前一样」）。
     圆钮的 inset 0 1px 0 #fff 26% 与 inset 0 -1px 1px #fff 8% 在 60px 圆里
     刚好读成玻璃高光，但拉成 81×148 的矩形后，两条 inset 会在内侧连成一整圈亮边，
     再叠上 border，看起来就是"内外两层描边"。矩形只要一条淡边 + 外投影。 */
  border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);
  box-shadow:0 4px 16px rgba(0,0,0,.24);
}
/* ⚠️ hover 也必须重写 box-shadow 和 border-color：.balance-fab:hover 里还有一整套
   inset 高光，选择器优先级相同（都是 0-2-0）而它写在文件更前，所以这里必须自己声明，
   否则鼠标一移上去那圈内亮边又回来了。 */
.balance-fab--rect:hover{
  transform:scale(1.03);
  border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);
  box-shadow:0 6px 20px rgba(0,0,0,.3);
}
.balance-fab--rect:active{transform:scale(.97)}
/* 余额：17px 粗体，居中；宽度锁满以便逐位滚动格对齐 */
.balance-fab__value{
  display:flex;align-items:center;justify-content:center;
  font-size:17px;font-weight:600;line-height:20px;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;
}
.balance-fab__value--low{color:var(--dsw-alias-state-error-primary,#d97706)}
/* 时段词 + 剩余时长：一行两段，剩余时长用弱化色；11px 是中文清晰度的下限 */
.balance-fab__period{display:flex;align-items:baseline;justify-content:center;gap:4px;font-size:11px;line-height:13px;font-weight:600;letter-spacing:0;white-space:nowrap;opacity:.92}
/* ⚠️ 剩余时长必须显式给 color（2026-10-31：「这个剩余怎么带颜色 展开是啥颜色就是啥颜色」）。
   它嵌在 .balance-fab__period--offpeak/--peak 里，不写 color 就继承峰谷色 → "剩 1d20h" 跟着
   变绿/变红。展开态那边它走 .balance-footer__timeline-meta-item，是普通标签色，
   只有"空闲/高峰"两个字才带峰谷色。这里对齐同一个口径。 */
.balance-fab__remain{color:var(--dsw-alias-label-primary,#e8e8ea);font-weight:500;opacity:.68;font-variant-numeric:tabular-nums}
.balance-fab__period--peak{color:var(--dsw-alias-state-error-primary,#e5484d)}
.balance-fab__period--offpeak{color:var(--dsw-alias-state-success-primary,#22c55e)}
/* 刻度条：复用展开态的 track，高度提到 16px（收起态指针要看得清） */
.balance-fab__track{display:block;width:100%;min-width:0}
.balance-fab__track .balance-footer__timeline-track{height:16px;border-radius:999px}
/* 今日行：「今日」二字常显 + 右边跟着金额/雾。
   gap 用 2px 把标签和金额贴住，读起来是一个整体。 */
.balance-fab__today{display:flex;align-items:center;justify-content:center;gap:2px;min-height:16px;font-size:11px;line-height:16px;opacity:.82}
.balance-fab__today--waiting{opacity:.85}
/* 「今日」二字：弱化一档，让金额仍是主体 */
.balance-fab__label{font-weight:600;opacity:.62;margin-right:2px}
/* ── 收起态的今日等待雾（2026-10-31 定稿）────────────────────────────────────
   结构 = 消耗行那套 5 颗亮芯光球，只把尺寸收到 56px。
   曾经换成展开态今日专用的「两层 radial 光团 + backdrop-filter 毛玻璃」，效果反而更差：
   那套是为浅色侧栏背景标的，光团靠背景透出来才是雾透；卡片底是纯深色，
   同样的结构只会得到一块灰白补丁（无亮芯、边界清楚、看不出在动）。
   深底上要的是「亮的东西在流动」，所以保留 orb 的白色内核。 */
/* 雾只占金额那一格（标签「今日」在它左边常显）—— 所以宽度收到 40px，
   和 ¥21.65 差不多宽，等待态与出值态的行宽不会跳。 */
.balance-fab__today-mist{display:block;width:40px;min-width:40px;flex:none}
.balance-fab__today--waiting .balance-usage-mist{
  width:40px;min-width:40px;max-width:40px;height:13px;min-height:13px;margin:0;
}
/* 光团在 13px 高度下重标：24×13、blur 2.2px、亮度提到 1.15（深底需要更亮的芯，
   展开态那套 brightness(.8) 是给浅色侧栏压对比用的）。 */
.balance-fab__today--waiting .balance-usage-mist__orb{
  width:24px;height:13px;margin-top:-6.5px;
  filter:blur(2.2px) brightness(1.15);opacity:.8;
}
.balance-fab__today-inner{display:inline-flex;align-items:baseline;justify-content:center;gap:1px;white-space:nowrap;overflow:hidden;font-variant-numeric:tabular-nums}
.balance-fab__cur{flex:none}
/* 收起态今日的擦出（2026-10-31：「浮窗的今日加载动画也要有 从左到右显示出来」→
   「跟展开不一样啊 展开是没擦到的地方还是加载动效」）。
   结构与展开态同构：数字在 __body 里被 clip-path 揭开，未扫到的区域由上层的
   .balance-footer__today-reveal__mist 盖着（那层自带 --today-hole 遮罩挖洞动画）。
   ⚠️ position:relative 必须加在 __today-inner 上：mist 是 absolute inset:0，
   没有定位祖先它会铺到整张卡片上去。 */
.balance-fab__today-inner{position:relative}
.balance-fab__today-body{display:inline-flex;align-items:baseline;justify-content:center;gap:1px;white-space:nowrap;font-variant-numeric:tabular-nums}
.balance-fab__today-inner--enter .balance-fab__today-body{animation:balance-fab-today-wipe .26s cubic-bezier(.33,0,.67,1) both}
@keyframes balance-fab-today-wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
/* 雾层容器（2026-10-31：「这个动画容器位置有问题」）。
   ⚠️ 不要写死 height —— 它继承了 .balance-footer__today-reveal__mist 的 inset:0，
   一旦再给一个固定 height，CSS 会忽略 bottom、改成「贴 top 往下量 13px」，
   而 __today-inner 是 baseline 对齐的 inline-flex，数字的实际盒子并不从 top:0 开始，
   于是这层雾整体偏上、和数字错开。现在让它完全由 inset:0 撑满 inner，
   高度天然等于数字盒，位置就不用猜了。圆角保留，抄数字那一格的样子。 */
.balance-fab__today-wipe-mist{border-radius:3px;overflow:hidden;min-height:13px}
.balance-fab-dark{color:#fff;background:color-mix(in srgb,#e5484d 62%,transparent);border-color:color-mix(in srgb,#fff 22%,transparent)}
.balance-fab-dark:hover{background:color-mix(in srgb,#e5484d 78%,transparent)}
/* ── 消耗行 pill：规格逐条照抄 DSH 原生 StatsPills 的 .pill（iq1doa_pill）──
   圆角是 --dsw-radius-sm（小圆角矩形），不是 999px 胶囊；也不要加
   corner-shape:round —— 原生 hover/展开态就是这个小圆角背景，写成胶囊对不上。 */
.balance-usage-wrap{min-width:0;display:inline-flex;align-items:center}
.balance-usage-line{box-sizing:border-box;max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);font-variant-numeric:tabular-nums;line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;background:0 0;border:none;border-radius:var(--dsw-radius-sm);align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer;height:calc(1lh + 2px)}
.balance-usage-line svg{flex:none;width:14px;height:14px}
.balance-usage-line:hover,.balance-usage-line[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-secondary)}
.balance-usage-label{text-overflow:ellipsis;min-width:0;overflow:hidden}
/* 金额那一段单独成类。**宽度必须恒定**：这段一变宽变窄，composer dock 那一行就重排，
   输入框会被顶得上下跳（2026-10-30 用户实测反馈）。
   真正的元凶不是「计算中」三个字，而是位数本身：toFixed(4) 下 0.4218 是 6 个数字位（57.58px）、
   69.2184 是 7 位（64.63px）、123.4567 是 8 位（71.66px），金额一涨就变宽。
   所以用 min-width 按最宽的 8 位兜住（1ch = 一个数字宽，随字号自动缩放），
   短金额右侧留白也不补前导零；pending 那侧另用不可见锚占同样的位。 */
/* 高度也必须锁死：inline-block 一旦带上 overflow:hidden，行盒会被撑高，
   数字就比「本会话消耗」高出两三个像素（2026-10-30 用户反馈「这个数字还变高了」）。
   所以宽高一起固定 —— inline-flex + align-items:center + height:1lh（= 继承的行高，
   跟随 DSH 字号设置走），待算与算完两态的高度完全一致。 */
.balance-usage-cost{white-space:nowrap;font-variant-numeric:tabular-nums;display:inline-flex;align-items:center;min-width:10.6ch;height:20px;height:1lh}
.balance-usage-cost--pending{opacity:1}
/* 智能体团队（Agent Teams）小圆片：只在 roster 里有人时才挂。
   高度 16px（行高 22px，纵向放得下、不会把整行撑高），字号 11px 跟随 DSH 的次要信息档；
   背景用很低的白（.06）—— 比胶囊的雾淡一档，读起来是"附注"而不是第二个数字。 */
.balance-usage-team{display:inline-flex;align-items:center;flex:none;height:16px;padding:0 5px;border-radius:999px;corner-shape:round;background:rgba(255,255,255,.06);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:nowrap}
/* 待算时**什么都不画**：既没有「计算中」，也没有循环白条。
   用户 2026-10-30 的原话是「为什么会扫两遍，如果没扫到就让他空着就行了」——
   循环那道和擦出那道叠在一起就是两遍。现在只留擦出这一遍。 */
/* 数字出场＝被光条擦出来（2026-10-30 用户要「光条滑过的地方开始显示数字 就跟窗户一样」）：
   外层 clip-path 从左往右展开，边界正好压住光条，所以看上去是光条把数字一格一格擦亮；
   ::after 那颗光条与 boundary 用同一条 balance-wipe-head 曲线，二者永远同步，
   拉到右端时外层已全开、光条也淡出，收尾干净。只播一次（both），数字变了也不重播。 */
/* 时长从 .58s 收到 .34s：用户 2026-10-30 反馈「速度太慢了，点进会话会停顿 0.5 秒左右」。
   0.34s 刚好够看清"光条擦过去"，又不至于让人等。白条那份 balance-wipe-head 不动 ——
   它和指针入场同源，selftest 会核对二者时长一致。 */
/* 「计算中…」模式下数据到手用淡入，不放光条（两种加载语言不混用）。 */
.balance-usage-fade{position:relative;display:inline-flex;align-items:center;height:20px;height:1lh;animation:balance-usage-fade-in .2s ease-out both}
@keyframes balance-usage-fade-in{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){
  .balance-usage-fade{animation:none}
}
/* 「计算中…」的三个点逐颗跳动（设置里 usageLoadingStyle 选 "text" 时才用）。
   文字本身不动，只有省略号在闪，这是最不打扰的一种「还在算」的信号。
   ⚠️ 点必须拆成三个独立 span，单个 "…"（U+2026）是一个字，没法分段做动画。 */
/* 高度必须和其它状态统一成 1lh（20px 档），**不能是 18px**：
   user 2026-10-31「1017 上下微动跳动」—— composer dock 那一行的高度取决于本插件行的
   最高子元素，等待态 calc 只有 18px、数字态 reveal/mist 是 1lh≈20px，于是每次在
   「计算中」和数字之间切换，整行就矮一下高一下，上面那排（模型名 / context 1017 / High）
   跟着上下跳 2px。加载态和结果态的高度必须完全一致，高度差一律不许出现在这一行里。
   圆角胶囊在 20px 下反而更接近官方 pill 的比例。 */
.balance-usage-calc{display:inline-flex;align-items:center;height:20px;height:1lh;padding:0 8px;border-radius:999px;corner-shape:round;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.balance-usage-calc__dots{display:inline-flex;margin-left:1px}
.balance-usage-calc__dot{animation:balance-dot-blink 1.2s ease-in-out infinite}
.balance-usage-calc__dot:nth-child(2){animation-delay:.15s}
.balance-usage-calc__dot:nth-child(3){animation-delay:.3s}
@keyframes balance-dot-blink{0%,70%,100%{opacity:.22}35%{opacity:1}}
@media (prefers-reduced-motion:reduce){
  .balance-usage-calc__dot{animation:none;opacity:.75}
}
/* 消耗行两段式动效（2026-10-31 用户定稿）。
   ① 等待＝「Siri 那种一团光在容器里游动」（用户：「就跟siri一样的动画 然后填充满余额栏」）。
      做法：把容器当画框（overflow:hidden + 胶囊圆角），里面放 4 团超大的模糊径向光，
      各自用不同的周期 / 延迟 / 路径在框内横向游走 + 上下起伏 + 缩放呼吸。
      光团交叠处更亮、被圆角裁掉边缘 —— 这就是 Siri 那种「液体能量」观感的来源。
      关键三点，少一个就不像：**铺满整条栏**（光团宽度 40–64px，容器本身 100%）、
      **边缘糊开**（radial-gradient 收尾 + blur 3.5px，不能是实心圆）、
      **四团不同步**（同期同相会变成整齐的呼吸灯）。
      之前的「9 颗小粒子」方案作废：1–2px 的点在深色底上根本看不出在动。
   ② 到手＝白光从左往右扫过把数字擦出来，见下方 .balance-usage-reveal。
   只播一次（key 绑 sessionId），之后数值变动仍走内层逐位滚动，两套动效分开。 */
/* ⚠️ 这里**不许再挂矩形 linear-gradient 遮罩**（2026-10-31：「我怎么感觉左侧的半圆颜色有问题」）。
   原来同时有 border-radius:999px（胶囊圆弧）和
   mask-image:linear-gradient(90deg,transparent 0,#000 13%,#000 87%,transparent 100%)
   —— 遮罩是**矩形**的，不跟随圆角：它在左端 13% 处划出一道竖直的透明度跃变，
   和圆弧边缘完全对不上，于是左半圆被从中切一刀，一半比右边暗、还能看见那条竖线。
   实测截图对比：带遮罩的左侧暗一块、无遮罩是均匀的胶囊弧。
   胶囊形状交给 border-radius + overflow:hidden；两端柔和度由 ::before 的椭圆底光
   （边缘收到 .04 透明度）和光团自身的 radial-gradient 收尾负责，不需要矩形渐隐。 */
/* 玻璃底（2026-10-31 三轮：「本会话消耗的加载动画的毛玻璃颜色有点深」
   →「灰色部分太黑了 导致动效看起来不是很明显」
   →「这有点太显眼了 发白了都」）。
   第一版这条胶囊**完全没有底色**，只有一层最外圈 .04 的白光，灰色部分压到 #232324
   —— 和 composer 底**同一个色**，光团飞过两端时整条像融进背景、看不出是个容器。
   第二版把底色拉到 .20 补"体"，结果过头了：整条胶囊变成一块亮白砖，压在灰字旁边太抢眼。
   现在取中：底色 .07（有"体"但明显是灰玻璃），底光 .13/.08/.04（负责渐变），
   同时把**光团自己的白**收一档 —— 渐变核心 .99→.74、泛光 box-shadow .22/.10→.15/.065，
   雾膜再薄一档，底下的"光在玻璃里"才透得出来（第四轮「最顶上那一层蒙版可以稍微透一点」）。
   ⚠️ 收光团而不是只收底色，是这轮的关键：胶囊只有 65px 宽、5 团 40~64px 的光团几乎铺满，
   screen 混合后**整条都被光斑盖住**，此时底色再暗也压不住白。实测（同位置测胶囊区）：
     无底色 .24/.12/.04         p10 85  p50 115  p90 148
     .20   .12/.07/.03         p10 109 p50 131 p90 160   ← 第二版，整条发白
     .08   .14/.08/.04 球.84    p10 70  p50 117  p90 154   ← 第三版
     .07   .13/.08/.04 球.74    p10 66  p50 106  p90 140   ← 采用，雾膜再薄一档
   抬亮度靠**底色**、不能靠**底光**（底光是径向的，越强越把整条抹平）；
   但**降低白感必须同时收光团**，只降底色会让亮芯反而更扎眼。
   只动静态颜色，**光团几何 / 周期 / 缓动 / 相位一个字节都没碰**。
   ⚠️ 今日等待胶囊走 .balance-footer__today-wait .balance-usage-mist（.03 底色 + 自己那套光团），
   选择器权重更高，写在前面也照样生效，所以今日那格不受这条影响。 */
.balance-usage-mist{position:relative;display:block;width:100%;min-width:10.6ch;height:20px;height:1lh;overflow:hidden;border-radius:999px;corner-shape:round;background:rgba(255,255,255,.07);animation:balance-siri-pulse 1.9s ease-in-out infinite}
/* 底光：保证任何时刻整条栏都有光，不留黑缝（只有游动的光团时，间隙处会断开成一截一截）。
   强度必须比底色低一档 —— 它的作用是让玻璃有渐变，不是给玻璃上色。 */
.balance-usage-mist::before{content:"";position:absolute;inset:0;border-radius:inherit;background:radial-gradient(ellipse at 50% 50%,rgba(255,255,255,.13) 0%,rgba(255,255,255,.08) 58%,rgba(255,255,255,.04) 100%);animation:balance-siri-base 2.7s ease-in-out infinite}
@keyframes balance-siri-base{0%,100%{opacity:.6}50%{opacity:1}}
/* 泛光来自三层叠加：radial-gradient 从纯白起手（0% 处 .99）、blur 把边缘彻底化开、
   再挂一圈 box-shadow 做大范围外发光。brightness 1.3 把整体顶亮一档，
   否则 mix-blend-mode:screen 在深底上会显得发灰（2026-10-31 用户：「白色部分能不能亮一点 泛光的感觉」）。 */
.balance-usage-mist__orb{position:absolute;top:50%;left:-14%;width:var(--ow,52px);height:var(--oh,26px);margin-top:calc(var(--oh,26px) / -2);background:radial-gradient(closest-side,rgba(255,255,255,.74) 0%,rgba(255,255,255,.56) 26%,rgba(255,255,255,.30) 48%,rgba(255,255,255,.12) 68%,rgba(255,255,255,.02) 82%,rgba(255,255,255,0) 92%);box-shadow:0 0 14px 5px rgba(255,255,255,.15),0 0 30px 10px rgba(255,255,255,.065);filter:blur(4.2px) brightness(1.3);mix-blend-mode:screen;border-radius:52% 48% 55% 45%}
.balance-usage-mist__orb:nth-child(1){animation:balance-siri-a 2.6s cubic-bezier(.45,.05,.55,.95) infinite alternate}
.balance-usage-mist__orb:nth-child(2){animation:balance-siri-b 3.4s cubic-bezier(.4,.1,.6,.9) infinite alternate;animation-delay:-.7s;--ow:58px;--oh:30px;opacity:.85}
.balance-usage-mist__orb:nth-child(3){animation:balance-siri-c 2.1s cubic-bezier(.5,0,.5,1) infinite alternate;animation-delay:-1.5s;--ow:40px;--oh:22px}
.balance-usage-mist__orb:nth-child(4){animation:balance-siri-a 3.9s cubic-bezier(.4,.1,.6,.9) infinite alternate-reverse;animation-delay:-2.2s;--ow:64px;--oh:28px;opacity:.7}
.balance-usage-mist__orb:nth-child(5){animation:balance-siri-b 2.9s cubic-bezier(.42,.05,.58,.95) infinite alternate;animation-delay:-1.9s;--ow:44px;--oh:24px;opacity:.8}
/* 本会话消耗胶囊的透明度对齐「今日」那颗（2026-10-31 第九轮：「这个透明的就刚刚好 改到本会话的动画透明度」）。
   用户拿今日等待胶囊当标尺 —— 同样在 #232324 上，本会话那条明显更白更实。
   实测（动画冻结、4× 像素、取胶囊盒内）：今日 peakΔ 92.1 / meanΔ 43.9；本会话 peakΔ 123.0 / meanΔ 75.4。
   把三处白色 alpha 统一乘 0.55 后：peakΔ 77.1 / meanΔ 43.9 —— 平均亮度与今日那颗完全对齐，
   亮芯只低一档（今日那颗的亮芯本来也是自己那一套 blur 光团，不必逐像素相同）。
   ⚠️ 用 .balance-usage-cost 限定范围，**不能改 base 的 .balance-usage-mist / __orb**：
   那条 base 还被收起态浮窗那颗今日胶囊（13px 高、深卡片底）用着，那边是特意调亮的
   （brightness 1.15 + 24×13 的芯），跟着一起压暗就丢了「深底上亮的东西在流动」。
   设置卡片里的样式预览同属「本会话消耗」，一起压，预览才不会骗人。
   ⚠️ 光团那几条 alpha 在 0.55 之上**再乘了 0.8**（2026-10-31 第十三轮）：X 左移之后有更多光团面积
   留在胶囊里，实测平均亮度 46.3 → 54.8（+18%）、峰值 109.4 → 124.1。乘 0.8 后回到 47.1 / 110.7，
   和原来的 46.3 / 109.4 持平 —— 这一轮只许修位置，亮度必须保持用户已经确认过的那一档。
   光团几何 / 周期 / 缓动 / 相位 / mix-blend-mode 全未动。 */
.balance-usage-cost .balance-usage-mist,.balance-settings__preview-stage .balance-usage-mist{background:rgba(255,255,255,.038)}
.balance-usage-cost .balance-usage-mist::before,.balance-settings__preview-stage .balance-usage-mist::before{background:radial-gradient(ellipse at 50% 50%,rgba(255,255,255,.072) 0%,rgba(255,255,255,.044) 58%,rgba(255,255,255,.022) 100%)}
.balance-usage-cost .balance-usage-mist__orb,.balance-settings__preview-stage .balance-usage-mist__orb{background:radial-gradient(closest-side,rgba(255,255,255,.328) 0%,rgba(255,255,255,.248) 26%,rgba(255,255,255,.136) 48%,rgba(255,255,255,.053) 68%,rgba(255,255,255,.01) 82%,rgba(255,255,255,0) 92%);box-shadow:0 0 14px 5px rgba(255,255,255,.066),0 0 30px 10px rgba(255,255,255,.029)}
@keyframes balance-siri-pulse{0%,100%{opacity:.84}50%{opacity:1}}
/* 光团的走位：**左右之外必须有上下与形变**（2026-10-31 第十二轮：「这个加载框够大了吧 能不能让光圈不只是左右晃」）。
   原来三条 keyframes 的 X 位移是 Y 的 15~25 倍（a 的 X 到 235%、Y 只有 ±11%），而 Y 的百分比
   是按**元素自身高度**算的 —— 26px 的光团 ±11% 只有 ±2.9px，被 20px 高的胶囊裁掉上下缘之后
   根本看不出来，于是整条读起来就是一条横线在平移。
   所以 Y 放到 ±18~20%（约 ±5px），scale 拆成双值（sy .76~1.34，做出"涨起来/缩回去"的呼吸），
   再加 rotate ±14deg（椭圆光团一斜，轮廓就变）—— 横向照旧流动，纵向有了涌起来的体积感。
   ⚠️ 光团还要**两端对称**（2026-10-31 第十三轮：「我怎么感觉光圈全都靠左一点」）：原来右侧那条
   关键帧停在 235%，光团早飞出胶囊外，只有左边的停留看得见，于是亮芯大量时间贴在某一端边缘。
   实测 65.8px 胶囊、26 帧取样：亮芯横向中位在 67% 宽处，两端亮度 3.4% / 9.1% —— 一头明显更空。
   现在三个关键帧的 X **各自 -60**（每条跨度不变，只是整体左移），亮芯中位回到 55%、两端 7.2% / 6.2%。
   周期（2.6/3.4/2.1/3.9/2.9s）、缓动、方向和相位延迟全部没动。 */
@keyframes balance-siri-a{0%{transform:translate(-60%,14%) scale(.92,.8) rotate(-9deg);border-radius:52% 48% 55% 45%}50%{transform:translate(55%,-18%) scale(1.14,1.34) rotate(9deg);border-radius:45% 55% 42% 58%}100%{transform:translate(175%,13%) scale(.94,.76) rotate(-13deg);border-radius:58% 42% 50% 50%}}
@keyframes balance-siri-b{0%{transform:translate(115%,-13%) scale(1.02,.92) rotate(10deg);border-radius:47% 53% 58% 42%}50%{transform:translate(30%,7%) scale(.94,1.18) rotate(-8deg);border-radius:56% 44% 46% 54%}100%{transform:translate(-60%,18%) scale(.88,.8) rotate(13deg);border-radius:50% 50% 43% 57%}}
@keyframes balance-siri-c{0%{transform:translate(-5%,-16%) scale(.8,.86) rotate(-14deg);border-radius:60% 40% 52% 48%}50%{transform:translate(135%,20%) scale(1.26,1.1) rotate(13deg);border-radius:44% 56% 40% 60%}100%{transform:translate(25%,9%) scale(.96,.8) rotate(-7deg);border-radius:53% 47% 57% 43%}}
@media (prefers-reduced-motion:reduce){
  .balance-usage-mist{animation:none}
  .balance-usage-mist__orb{animation:none;transform:translate(40%,0) scale(1);opacity:.55}
  .balance-usage-mist__orb:nth-child(n+2){display:none}
}
/* 数字出场＝开窗（2026-10-31 用户第三次定稿：「是从中间往两边打开 跟开窗一样 你现在这样太丑了」）。
   前两版都被否，原因记在这里别再走回头路：
     ✗ 第一版「白光从左往右扫过」—— 一根白色竖条横穿，用户：「不要那个白色的竖条了」；
     ✗ 第二版「中心光团绽开 + 数字过曝回落」—— 模糊圆光叠在胶囊里发糊，用户：「太丑了」。
   所以这一版**只留几何动作，不留任何发光物**：两扇窗从正中同时向两侧滑开，数字跟着露出来。
   - clip-path 左右对称，从中缝 inset(0 50% 0 50%) 起步、满宽收尾（-4px 让最右侧字符不被切边）；
   - 曲线 **cubic-bezier(.33,0,.67,1)**（2026-10-31 第十四轮换的近匀速）。原文是 (.2,.86,.24,1)
     「起步快、尾巴稳」，那时窗只开过数字那么宽，快起步还能读成「被推开」；现在窗钉成整颗胶囊、
     数字只占中段 79%，那条曲线 140ms 就走到 72%，数字在头 90ms 里就全露完了，剩下的行程
     只剩两侧空光在动 —— 用户反馈「展开时的动画被吞了」就是这个。换成近匀速后，数字要走到
     79% 的行程 ≈ 时序的 79%（220ms）才露全，最后 60ms 收掉两侧的光，整段都看得见在动。
     和今日那条擦出用的是同一条曲线，两处手感统一；
   - 时长 .28s，比第一版的 .22s 慢一档 —— 开窗这个动作需要看得清，扫过才需要快。
   ⚠️ 只在**数据到手那一刻**挂载（key 绑 sessionId），所以只开一次；
   之后的数值变动走内层逐位滚动，两套动效分开。
   ⚠️ keyframes 独立命名，**不复用 balance-calc-reveal**（那个是横扫、且被
   余额行的 .balance-footer__reveal-sweep 共用），两者互不干扰。 */
/* ⚠️ 容器自己要有 min-width（2026-10-31 第十八轮）：等待态它里面只有 __mist 一团光、
   没有 __body，宽度会塌成 padding（8px）→ 加载胶囊消失。钉成 10.6ch（content-box，
   加两侧 padding、抵掉负 margin 后外观宽 = 10.6ch + 8px，和数字态一致）。
   10.6ch 是量出来的（2026-11-01 用户：「最少要显示到 0.01，小数点左右最多 5 位」
   「但是可以比如说 1011.11」先定了 formatCostText 的位数，随后「最起码可以容纳 6-7 个
   数字位置」再定宽度）。headless Edge 实测内宽：5 字符 54.53px、6 字符（1011.11）69.78px、
   7 位数字（12345.67）77.41px、8 位数字（123456.78）85.03px。10.6ch = 80.8px 兜到 7 位
   数字，等待态与出数态宽度完全一致（80.8 = 80.8）；8 位数字才溢出一档（85.03），而
   formatCostText 的输出最多 7 位数字（≥10000 时 5 位整数 + 2 位小数），实际到不了。
   ⚠️ 别再用 toFixed(4) 那种 10 字符串：内宽 92.66px，比这里宽 12px，数字会被挤到胶囊
   右半边（用户原话「数字怎么靠右了」）。 */
.balance-usage-reveal{position:relative;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;height:20px;height:1lh;padding:0 4px;margin:0 -4px;min-width:10.6ch}
/* 底层：加载态那团光，用 mask 在**正中间挖一个椭圆洞**并随开窗扩大。
   数字在洞里显出来，光留在两侧 —— 这就是用户要的「没展开到的地方还是加载动画」，
   而数字背后是干净的（洞与数字同步扩大，光不会透到字缝里）。
   洞的边缘走 58%→100% 的渐变，所以边界是柔的，不会像 clip 那样切出一条直线。
   ⚠️ inset 是 0 4px 不是 0：容器上下左右各有 4px padding（给 clip 出血用），
   而加载态那颗胶囊的宽度不含这 8px。写成 inset:0 会让揭幕这颗胶囊比加载态宽 8px，
   出数那一瞬间整颗胶囊"胖一圈"—— 和「展开量不许随数字变」是同一个诉求。
   ⚠️ 为什么用 mask 而不是两片元素拼接：两片必须 overflow:hidden 才不互相盖住，
   而一旦裁切，胶囊的圆角就被切成直角，接缝处还会出现一条硬边（三版都试过，全丑）。
   ⚠️ --balance-hole 必须用 @property 注册成 <percentage> 才能被动画插值，否则 keyframes 里
   的百分比是离散跳变（0% 到 86% 一帧完成，等于没有动画）。
   ⚠️ 上面那句注释**必须留在这一个注释块里**：2026-10-31 第十四轮我在 0 4px 那句后面多写了一个
   注释结束符，把后面两段甩到注释外面，于是这条 @property 被 CSS 解析器当成非法规则整条丢掉 ——
   --balance-hole 退回未注册状态，洞改成离散跳变，动画看起来就是"被吞了"。 */
@property --balance-hole{syntax:"<percentage>";inherits:false;initial-value:0%}
.balance-usage-reveal__mist{position:absolute;inset:0 4px;display:block;pointer-events:none;--balance-hole:86%;-webkit-mask-image:radial-gradient(ellipse var(--balance-hole) 260% at 50% 50%,transparent 58%,#000 100%);mask-image:radial-gradient(ellipse var(--balance-hole) 260% at 50% 50%,transparent 58%,#000 100%)}
.balance-usage-reveal__mist .balance-usage-mist{width:100%;min-width:0;height:100%}
/* ⚠️ 等待态：洞钉在 0%，也就是遮罩整块不透明＝雾全可见。
   它和揭幕态是**同一个节点**（2026-10-31 第十八轮，用户：「不重播的意思是开始展开的时候
   没有被触及到的区域继续播放动画 而不是重头开始播放」）—— 出数那一帧只是把这个类摘掉、
   加挂 --enter 的开窗动画，里面 5 团光球的 keyframes 一次都没有重跑过，
   所以没被洞扫到的地方，光是接着原来那口气继续流的。 */
.balance-usage-reveal__mist--wait{--balance-hole:0%}
@keyframes balance-mist-hole{0%{--balance-hole:0%}100%{--balance-hole:86%}}
/* 上层：数字本体，clip-path 从中缝向两侧打开 —— 「开窗」这个动作只发生在这一层。
   ⚠️ 这一层必须**宽度恒定**（2026-10-31 第十四轮：「展开动画要应用到整个胶囊，
   不是数字多长展开量就多长」）。原来它是 inline-flex 跟着数字走，于是胶囊和窗都只有数字那么宽：
   数字短（¥0.1234）窗就窄、数字长窗就宽，同一段 .28s 里走过的距离每次都不一样，读起来
   像是"胶囊被数字撑大"。现在钉 min-width:10.6ch（就是加载态那颗 .balance-usage-mist 的
   min-width），窗永远开过整颗胶囊，数字居中待在里头 —— 顺带消掉了「加载态 66px、出数后变窄」
   那次宽度跳变。（≈ 在第十六轮被挪回 __body 里、跟着开窗一起显形，所以宽度预算要把它算进去：
   ≈ + ¥ + 最多 7 位数字（formatCostText 在 ≥10 时收成 2 位小数、≥10000 收成 1 位）
   实测 69px 内容宽 < 10.6ch（≈74.6px），窗仍覆盖整颗胶囊。改宽度口径前先重量这一条。）
   box-sizing 必须显式写（DSH 页面没有全局 border-box）。 */
.balance-usage-reveal__body{position:relative;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:10.6ch;height:20px;height:1lh}
@keyframes balance-window-open{0%{clip-path:inset(0 50% 0 50%)}100%{clip-path:inset(0 -4px 0 -4px)}}
/* ⚠️ 两条 animation **只在 --enter 这一档上声明**（2026-10-31 第十五轮：
   「这个动画的逻辑也跟今日消耗的逻辑一样 不要在触发展开的动画时 动画重头播放」）。
   原来它们写在元素自身规则里，于是只要节点是新建的（折叠/展开侧栏让组件重挂、mist 分支
   来回切、DSH 重渲染 composer），CSS 动画就从 0 秒重放一次 —— 用户看到的就是"开窗又重头演"。
   今日那条擦出就是这么治的：闸门类 + 模块级台账（animOnce/animRead/animWrite），
   台账在模块级，页面刷新才清空，折叠展开不重新求值、台账还在 → 不再播。
   这里同样：只有台账允许的那一次渲染才挂 --enter；播完就摘（声明整个消失，节点不动，
   落在与动画终点完全一致的静止态 —— mist 洞开到底 86%、body 不裁切）。 */
.balance-usage-reveal--enter .balance-usage-reveal__mist{animation:balance-mist-hole .28s cubic-bezier(.33,0,.67,1) both}
.balance-usage-reveal--enter .balance-usage-reveal__body{animation:balance-window-open .28s cubic-bezier(.33,0,.67,1) both}
@media (prefers-reduced-motion:reduce){
  .balance-usage-reveal--enter .balance-usage-reveal__body,
  .balance-usage-reveal__body{animation:none;clip-path:none}
  /* ⚠️ 只隐藏揭幕态的那层光（它存在的意义就是"扫过时还留着的加载动画"）。
     等待态（--wait）那层光就是加载动画本身，2026-10-31 第十八轮合并成同一棵树之后
     这里如果不加 :not()，系统开了"减少动态效果"的用户会连加载胶囊都看不到，只剩空白。 */
  .balance-usage-reveal__mist:not(.balance-usage-reveal__mist--wait),
  .balance-usage-reveal--enter .balance-usage-reveal__mist{display:none}
}
/* 出数之后这一整层雾仍然**常驻 DOM**（上面那套「绝不卸载、绝不重播」的代价），但它此刻
   已经整层透明（cost 这边洞开到 86%、今日那边 --clear 拿到 100%），里面的无限动画纯属白跑。
   2026-11-01 审计实测：页面静置时仍有 6 个 infinite 动画在跑 —— 5 团光球带 blur(4.2px) 与
   mix-blend-mode:screen，而 balance-siri-a/b/c 逐帧改 border-radius（形状动画**无法合成器化**），
   于是 60fps 常驻重绘；today-fog 那层 backdrop-filter 更是一直在重采样背景。
   用 animation-play-state:paused 冻住：**不摘节点、不改几何、不改任何一帧的可见像素**，
   等待态（--wait / 非 --clear）照常播，随时可以恢复。
   ⚠️ 只能用 paused 不能用 animation:none —— none 会让元素退回自身样式（没有 transform），
   光球会瞬间归位到 left:-14% 那一格；虽然此刻被 mask 裁没了，但下次回到等待态时就带着
   一个错误的起始姿态起播（和「不要重头初始化」那条是同一个坑）。 */
.balance-usage-reveal__mist:not(.balance-usage-reveal__mist--wait) .balance-usage-mist,
.balance-usage-reveal__mist:not(.balance-usage-reveal__mist--wait) .balance-usage-mist::before,
.balance-usage-reveal__mist:not(.balance-usage-reveal__mist--wait) .balance-usage-mist__orb,
.balance-footer__today-reveal__mist--clear .balance-usage-mist,
.balance-footer__today-reveal__mist--clear .balance-usage-mist::before,
.balance-footer__today-reveal__mist--clear .balance-usage-mist::after,
.balance-footer__today-reveal__mist--clear .balance-usage-mist__orb,
.balance-footer__today-reveal__mist--clear .balance-footer__today-fog{animation-play-state:paused}
/* 透明层上的 backdrop-filter 没有任何可见输出，却仍会参与合成与背景重采样（滚动时最费）。
   只在「已经擦完」这一档摘掉；--wipe 期间它必须在，否则擦出过程后半段雾会忽然变清。 */
.balance-footer__today-reveal__mist--clear .balance-footer__today-fog{-webkit-backdrop-filter:none;backdrop-filter:none}
.balance-usage-cost-inner{display:inline-flex;align-items:center;white-space:nowrap;height:20px;height:1lh}
/* ≈ 的视觉修正：字形本身偏低，用 em 单位上提（跟随字号缩放），右侧留一点呼吸缝。
   不要改成 vertical-align —— inline-flex 子项走的是 align-items:center，两者会打架。
   右侧间距 .28em → .12em（2026-11-01 用户圈着 ≈ 说「约等于往中间靠一点」）：.28em 下
   实测 ≈ 与 ¥ 之间空 3.36px，读起来像两个不相干的符号；.12em 实测 1.43px，≈ 靠向 ¥
   但仍不粘连。≈ 字形本身有 3.5px 左右侧空（advance 宽 8.92px、墨迹只有 5px 出头），
   所以 margin 归零也不会真的贴住 —— 别再加回去。
   2026-11-01 晚⑯：这个类曾随「不要约等于了」整条删除，同一天用户又要求加回来并且
   「算到动画里去」（理由是没它时胶囊中间空一块），于是规则与节点一起复原。
   ⚠️ 同日还试过「≈ 与 ¥ 隔 2ch + 胶囊放宽到 12ch」，用户看完直接说「算了 改回刚刚那样吧」，
   已回滚成 .12em + 10.6ch。**不要再自作主张去拉开这段间距**：≈ 紧贴 ¥ 才是定稿。 */
.balance-usage-approx{position:relative;top:-.12em;margin-right:.12em}
@keyframes balance-calc-reveal{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 -4px 0 0)}}
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
/* ── 收起态余额行（2026-10-31）───────────────────────────────────────────────
   位置在 composer 输入框内部（conversation.composer.bar），排版对齐 DSH 原生模型名：
   12px、次要色、单行、行高紧凑，不额外撑高输入卡片。
   不要写 position:absolute / fixed —— 它现在是 composer 里的正常流内元素，
   由 DSH 的 flex 布局排布；一旦脱离流就会和输入区重叠，正是要避免的事。

   收起态的 .balance-fab / 统计面板锚点**永远**浮在 body 上：那一刻 DSH 已经把整个
   侧栏 footArea 设成 display:none，所以它没有被侧栏收纳的可能，和 composer 恒处同一
   垂直区间。因此避让不能按视口宽度开媒体查询 —— 宽屏只要侧栏收起，一样会压住输入框。
   composer 一坨从窗口底部量：状态栏约 30 + 工具行约 32 + 输入框约 60 + 间距 ≈ 130px。
   取 140px（上面基础规则里的 bottom），卡片整块坐进消息区，右缘不再压到附件按钮和发送区。
   ⚠️ 历史的「与输入框平齐(bottom:30px)」已被这条取代：平齐的前提是不遮挡。
   统计面板锚点必须同值，否则面板从旧位置弹出、和卡片错位。 */
/* 收起态定位（2026-10-31 重构：「收起状态下之前没有这个东西」＋「现在界面变成这样了」）。
   ⚠️ 这里两个角色的分工必须记清楚，之前搞反过：
     · **FAB 自己 position:fixed**，bottom/left 直接相对视口，位置可预测；
     · **anchor 只做 Tooltip 的挂载点**，position:static、不参与定位。
   上一版是反过来的（anchor:fixed + bottom:140px，FAB 在它内部 static），于是 FAB 的
   实际纵向位置 = anchor 底边 + anchor 的高度，而 anchor 高度由 Tooltip 包裹层和
   矩形卡的 height:auto 共同决定 —— bottom:140px 根本不是「距视口底 140px」，
   卡片会飘到贴着窗口底部、正好压在 composer 上。JS 里按 bottom:140 算的遮挡判断
   也就跟着全错（算的是一处、画的是另一处）。
   现在几何只有一份来源：FAB 的 bottom（见上面 .balance-fab 主规则），
   JS 那边也直接量 FAB 的真实矩形，不再用常量推算。 */
.balance-stats-anchor--compact{position:static;left:auto;bottom:auto;z-index:9998}
.balance-stats-anchor--compact .balance-fab{position:fixed}
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
/* ⚠️ hover 不要跟随 --dsw-alias-state-business-primary-hover（2026-10-31：
   「按钮颜色是不是搞反了 怎么鼠标放上去这么显眼」）。DSH 深色主题里那个变量是**提亮**的，
   hover 反而比静止更抢眼，读起来像"反了"。这里固定往黑里兑 12% 做加深，
   不依赖主题的 hover 语义；base 本身仍走主题变量，换主题整体色相跟着变。 */
.balance-stats-link--primary:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 88%,#000)}
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
.balance-settings{box-sizing:border-box;display:flex;flex-direction:column;width:100%;margin:0;padding:18px 20px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-alias-bg-module-platform,transparent)}
.balance-settings__head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.balance-settings__title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.balance-settings__version{font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.balance-settings__desc{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.balance-settings__group{margin:18px 0 0;padding:14px 0 0;border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22))}
/* 第一个分组紧接折叠头，顶线和额外内边距都去掉，避免双线 */
.balance-settings__body > .balance-settings__group:first-child{margin-top:0;padding-top:0;border-top:0}
/* 分组标题：左侧一道 3px 品牌色竖条做视觉分隔，字号收到 11px 并加字距，比正文弱、比说明强，避免和行内容糊在一起 */
.balance-settings__group-title{display:flex;align-items:center;gap:7px;margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:.3px;color:var(--dsw-alias-label-secondary)}
/* 顶部告示条：设置页最前面的一条范围声明。底色/边框比分组说明再重一档，
   文字提到 primary，整块在深色背景里第一个跳出来。 */
.balance-settings__notice{display:flex;align-items:flex-start;gap:8px;margin:0 0 14px;padding:10px 12px;border-radius:var(--dsw-radius-md,8px);border:.5px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 34%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 13%,transparent);font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-primary)}
.balance-settings__notice-icon{flex:none;display:block;margin-top:1px;color:var(--dsw-alias-brand-primary,#4d6bfe)}
.balance-settings__notice-text{min-width:0}
/* 「本版新增」横幅：不依赖侧栏入口也能知道有新功能。
   侧栏那颗 NEW 只在入口可见时才起作用，用户把「侧边栏显示本插件」关掉、
   或者从 DSH「插件」页直接进来时，这是唯一的提示（2026-10-31 用户问
   「如果用户没打开这个设置页面入口 怎么提示用户有新功能」）。
   用品牌色实心胶囊当引子 + 一行白字说明 + 右侧跳转按钮，视觉上比告示条更"新"。 */
.balance-settings__newcue{display:flex;align-items:center;gap:9px;margin:0 0 12px;padding:9px 12px;border-radius:var(--dsw-radius-md,8px);border:.5px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 12%,transparent);font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-primary)}
.balance-settings__newcue-badge{flex:none;padding:1.5px 6px;border-radius:999px;corner-shape:round;background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:9.5px;line-height:12px;font-weight:700;letter-spacing:.4px}
.balance-settings__newcue-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.balance-settings__newcue-btn{flex:none;padding:2px 9px;border-radius:999px;corner-shape:round;border:.5px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe);font:inherit;font-size:11.5px;line-height:16px;cursor:pointer}
.balance-settings__newcue-btn:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 28%,transparent)}
/* 跳到目标行时闪一下品牌色底，指出"就是这一行"。
   五条约束（2026-10-31 用户四轮反馈后才定下来，改之前先读完）：
   1. **必须是蓝的** —— 别用 color-mix(品牌色 x%, transparent)：transparent 是
      rgba(0,0,0,0)，跟它混合等于往黑里兑，落在深色底上是一块灰（被报过「没颜色」）。
   2. **必须圆角** —— 满宽方角就是一块灰板（被问过「圆角呢」）。
   3. **向两边各延伸一点点** —— 贴原行宽显得局促；8px 被嫌长，取 6px。
   4. **绝对不能动文字位置** —— 前两版都是给行本身加 margin:0 -6px + 等量 padding 补偿，
      数学上内容区宽度和起点都对，但负 margin 参与 flex 布局，浏览器重排后字就是会跳
      （被报过「字体又变动了」）。现在改用绝对定位的伪元素画底色：inset:0 -6px 相对行本身
      定位，**完全不参与布局**，无论左右扩多少，文字都钉在原地。
   5. 不要动 border-top —— 那是分隔线，抹掉会让相邻两行粘在一起。
   isolation:isolate 建立层叠上下文，::before 的 z-index:-1 才会落在本行背景之上、
   内容之下（少了它会沉到卡片底色后面，整块看不见）。 */
.balance-settings__row--flash{position:relative;isolation:isolate}
.balance-settings__row--flash::before{content:"";position:absolute;inset:0 -6px;border-radius:var(--dsw-radius-md,8px);background:rgba(77,107,254,.17);pointer-events:none;z-index:-1;animation:balance-row-flash 1.4s ease-out both}
/* ⚠️ 末尾的 both 不能省。少了它动画播完 opacity 会回到元素默认值 1，
   蓝底完整地再亮一次、直到 1.5s 时 class 被 JS 摘掉才消失 ——
   看起来就是「高亮之后又闪一下」（2026-10-31 用户报的 bug）。
   both = 播完停在 100% 的 opacity:0，跟后续移除 class 无缝衔接。 */
@keyframes balance-row-flash{0%,30%{opacity:1}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.balance-settings__row--flash::before{display:none}}
/* 分组说明条：不是灰小字，而是带图标的淡蓝提示条——要一眼看见「仅支持 DeepSeek Harness」。
   底色用品牌色 10%、边框 26%，文字提到 secondary；图标跟文字同色。 */
.balance-settings__group-note{display:flex;align-items:flex-start;gap:7px;margin:3px 0 5px;padding:8px 10px;border-radius:var(--dsw-radius-md,8px);border:.5px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 26%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 10%,transparent);font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.balance-settings__group-note-icon{flex:none;display:block;margin-top:.5px;color:var(--dsw-alias-brand-primary,#4d6bfe);opacity:.9}
.balance-settings__group-note-text{min-width:0}
.balance-settings__group-title::before{content:"";flex:none;width:3px;height:11px;border-radius:1px;corner-shape:round;background:var(--dsw-alias-brand-primary,#4d6bfe);opacity:.75}
.balance-settings__head-btn{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;box-sizing:border-box;padding:0;border:0;background:0 0;font:inherit;text-align:left;cursor:pointer;color:inherit}
.balance-settings__head-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:var(--dsw-radius-sm,6px)}
.balance-settings__head-text{flex:1;min-width:0}
.balance-settings__chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s ease}
.balance-settings[data-open="true"] .balance-settings__chevron{transform:rotate(180deg)}
.balance-settings__body{margin:10px 0 0;padding:10px 0 0;border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22))}
/* 标签行：文字 + NEW 徽标并排 */
.balance-settings__label-line{display:inline-flex;align-items:center;gap:6px;min-width:0}
/* NEW 徽标：低调底色 + 微弱呼吸光晕。
   先前用的是实心品牌色渐变 + 白字 + 三层强光晕，
   在深色设置页里太刺眼（2026-10-30 反馈「太亮了」）。
   现在：品牌色 18% 薄底 + 6px 弱光晕，呼吸幅度也收窄。 */
/* NEW 徽标：实心品牌蓝 + 白字。原先用 color-mix 调淡（62% 蓝 + 38% 白字、18% 底），
   实测在客户端里淡到看起来就是一行白字，用户反馈「没颜色」—— 小尺寸下必须给足饱和度。 */
.balance-settings__new-badge{flex:none;box-sizing:border-box;padding:0 5px;border-radius:5px;corner-shape:round;font-size:9px;line-height:14px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#fff;background:#4d6bfe;animation:balance-new-glow 3.2s ease-in-out infinite}
/* 呼吸式光晕：只有两层，最大 7px / 32%，足以有「光」的感觉但不刺眼 */
@keyframes balance-new-glow{
  0%,100%{box-shadow:0 0 4px color-mix(in srgb,#4d6bfe 22%,transparent),0 0 8px color-mix(in srgb,#4d6bfe 10%,transparent)}
  50%{box-shadow:0 0 7px color-mix(in srgb,#4d6bfe 40%,transparent),0 0 14px color-mix(in srgb,#4d6bfe 18%,transparent)}
}
/* 尊重减少动态效果：不呼吸，保持平均亮度 */
@media (prefers-reduced-motion:reduce){.balance-settings__new-badge{animation:none;box-shadow:0 0 5px color-mix(in srgb,#4d6bfe 28%,transparent)}}
.balance-settings__row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:11px 0}
/* 行与行之间用半像素淡线分开，避免几行文字堆成一片 */
.balance-settings__row + .balance-settings__row{border-top:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12))}
.balance-settings__label{display:flex;flex-direction:column;gap:3px;min-width:0}
.balance-settings__label-text{font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary)}
.balance-settings__hint{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
.balance-settings__control{display:flex;align-items:center;gap:6px;flex:none}
.balance-settings__unit{font-size:12px;color:var(--dsw-alias-label-tertiary)}
/* 文本类输入：数字框那套 96px + 右对齐会把「9-12, 14-18」截掉，单独放宽并左对齐 */
.balance-settings__input--text{width:132px;text-align:left;font-variant-numeric:normal;letter-spacing:.2px}
.balance-settings__input--text::placeholder{color:var(--dsw-alias-label-tertiary)}/* 输入框底色照抄 DSH 官方设置页（dsh-client-ui-settings-models 的 input 规则）：
   那边用 --dsw-alias-bg-layer-1，不是 layer-3。深色主题下三层分别是
   bg-layer-1 #232324 / bg-layer-2 #2c2c2e / bg-layer-3 #353638，页面底 bg-base #151517 —
   用 layer-3 比底色亮 32 级，在设置卡片里就是一块发闷的灰板（用户反馈「那个框的颜色太灰了」）。
   layer-1 只亮 14 级，和官方观感一致；浅色主题下 layer-1 = #fff 与底色同色，
   层次完全靠 .5px 的 border-l4 撑，这也是官方那套的样子。 */
.balance-settings__input{box-sizing:border-box;width:96px;height:34px;padding:0 10px;text-align:right;font-variant-numeric:tabular-nums;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.35));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-variant-numeric:tabular-nums;outline:none}
.balance-settings__input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.balance-settings__input--wide{width:100%;max-width:340px;min-width:0;text-align:left}
/* 关掉侧边栏入口后的提醒：壳用 DSH 官方 Modal，这里只留正文排版。 */
.balance-tip-body{margin:0;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
/* 节假日数据行：右侧是「状态文案 + 立即同步」两段，窄屏时自动换行靠右。 */
.balance-settings__calendar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.balance-settings__calendar-note{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary);text-align:right;font-variant-numeric:tabular-nums;max-width:100%;word-break:keep-all}
.balance-settings__calendar-note--warn{color:var(--dsw-alias-state-warn-primary,#d97706)}
.balance-settings__calendar-note--ok{color:var(--dsw-alias-state-success-primary,#22c55e)}
.balance-settings__calendar-note--error{color:var(--dsw-alias-state-error-primary,#e5484d)}
.balance-tip-ok{padding:5px 14px;border:.5px solid transparent;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;cursor:pointer}
.balance-tip-ok:hover{opacity:.88}
.balance-settings__toggle{position:relative;box-sizing:border-box;flex:none;width:36px;height:20px;padding:2px;border:none;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3,rgba(127,127,127,.35));cursor:pointer;transition:background .12s ease}
.balance-settings__toggle[aria-checked="true"]{background:var(--dsw-alias-brand-primary,#4d6bfe)}
.balance-settings__toggle::after{content:"";display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-switch-thumb,#fff);transition:transform .12s ease}
.balance-settings__toggle[aria-checked="true"]::after{background:var(--dsw-alias-label-primary-foreground,#fff);transform:translateX(16px)}
/* 二选一分段控件（余额行外观 新版/旧版） */
.balance-settings__segmented{display:inline-flex;flex:none;padding:2px;gap:2px;border-radius:999px;corner-shape:round;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.balance-settings__segment{box-sizing:border-box;padding:2px 12px;border:none;border-radius:999px;corner-shape:round;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;font-weight:500;cursor:pointer;white-space:nowrap;transition:background .15s var(--ds-ease-in-out,.2s),color .15s var(--ds-ease-in-out,.2s)}
.balance-settings__segment:hover{color:var(--dsw-alias-label-primary)}
.balance-settings__segment--on{background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-base,#2a2a2c));color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.2)}
/* 「消耗行加载动效」那一行的实时预览（2026-10-31 用户要求：「在介绍栏预览给用户看红圈位置」）。
   直接复用消耗行的真实类名（.balance-usage-mist / .balance-usage-calc），
   所以这里看到的就是输入框下方真会出现的那个效果 —— 两边永远不会走样，改一处两边一起变。
   **只预览当前选择的那一个**（2026-10-31 第十三轮：「只预览当前选择的样式」）：
   并排播两个会让人以为「两个都生效」，而右边分段控件已经标出选中的是哪个，预览只负责「长什么样」。
   环形高亮保留 —— 它读起来就是「这就是你现在的选择」。
   stage 的 min-width 钉住两种样式的宽度差（计算中那颗比光胶囊宽），切样式时右侧按钮不会左右挪。
   窄屏整块隐藏：640px 以下 label 已经被挤得很窄，再加预览会把文字压断。 */
.balance-settings__preview{display:flex;align-items:center;margin-left:auto;margin-right:8px;flex:none}
.balance-settings__preview-item{display:flex;flex-direction:column;align-items:center;gap:4px;padding:5px 7px;border-radius:8px;border:.5px solid color-mix(in srgb,#4d6bfe 55%,transparent);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}
.balance-settings__preview-tag{font-size:9.5px;line-height:1;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
/* 预览里要把「本会话消耗」这几个字一起画出来 —— 只放一条光带的话看不出这是哪一行，
   真实的那颗胶囊就是「本会话消耗 + 效果」，预览得对得上（2026-10-31 用户：「这个不应该显示对话消耗吗」）。
   胶囊宽度取 81px：真身是 min-width:10.6ch（13px 字号下约 80.8px），预览要是收成 44px，
   光团被裁得更狠、纵向那点涌动就看不出来了 —— 预览跟着真身的尺寸走才不会骗人。
   stage 的 min-width 钉住两种样式的宽度差（「计算中」那颗比光胶囊宽），切样式时右侧按钮不会左右挪。 */
.balance-settings__preview-stage{position:relative;display:inline-flex;align-items:center;gap:5px;height:20px;min-width:140px}
.balance-settings__preview-text{font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.balance-settings__preview-stage .balance-usage-mist{min-width:0;width:81px}
/* .balance-usage-calc 本身只定了尺寸和圆角，字号/行高/nowrap 是从消耗行的 .balance-usage-line 继承来的
   —— 预览里没有那层，不补这三行「计算中」会折成「计算 / 中」两行并撑破胶囊。 */
.balance-settings__preview-stage .balance-usage-calc{height:20px;height:1lh;padding:0 7px;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:18px;white-space:nowrap}
@media (max-width:640px){
  .balance-settings__preview{display:none}
}
/* 版本与更新区块：设置页第一块（紧跟计费范围告示条）。
   默认是中性底色，只在「有新版本」时提亮成品牌色、「刚更新完」时转成功色，
   失败不染色（网络波动不该看起来像错误告警）。 */
.balance-settings__update{margin:0 0 16px;padding:11px 13px;border-radius:var(--dsw-radius-md,8px);border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
.balance-settings__update--newer{border-color:color-mix(in srgb,#4d6bfe 42%,transparent);background:color-mix(in srgb,#4d6bfe 14%,transparent)}
.balance-settings__update--done{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 34%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 11%,transparent)}
.balance-settings__update-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.balance-settings__update-title{display:flex;align-items:center;gap:7px;min-width:0;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.balance-settings__update-ver{font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
/* 新版徽标：实心品牌色胶囊，形状必须是正圆角（DSH 全局把圆角改成 superellipse 了） */
.balance-settings__update-badge{flex:none;padding:1px 7px;border-radius:999px;corner-shape:round;background:#4d6bfe;color:#fff;font-size:11px;font-weight:600;line-height:16px;white-space:nowrap}
.balance-settings__update-btns{display:flex;align-items:center;gap:6px;flex:none}
/* 查询中的进度文案：跟按钮同一行、排在左边，灰一点，不跟主文案抢注意力。 */
.balance-settings__update-busy{flex:none;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
/* 标题行左侧的状态话（目前只有「已是最新版本。」）—— 成功绿，前面一个细分隔点，
   与「版本 2.0.2」拉开层次但不抢眼。 */
.balance-settings__update-inline{flex:none;font-size:11.5px;line-height:17px;color:var(--dsw-alias-state-success-primary,#22c55e);white-space:nowrap}
.balance-settings__update-inline::before{content:"·";margin:0 2px 0 0;color:var(--dsw-alias-label-tertiary)}
.balance-settings__update-note{margin:7px 0 0;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
.balance-settings__actions{display:flex;align-items:center;gap:8px;margin:14px 0 0;padding:12px 0 0;border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22))}
.balance-settings__status{flex:1;min-width:0;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
.balance-settings__status--error{color:var(--dsw-alias-state-error-primary,#e5484d)}
.balance-settings__status--ok{color:var(--dsw-alias-state-success-primary,#22c55e)}
.balance-settings__btn{box-sizing:border-box;flex:none;white-space:nowrap;padding:5px 14px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5;cursor:pointer;transition:background .12s ease,border-color .12s ease,opacity .12s ease}
.balance-settings__btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.18))}
.balance-settings__btn:disabled{opacity:.4;cursor:default}
.balance-settings__btn--primary{border-color:transparent;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
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
      // 逐个订阅者隔离：一个订阅者的 render 异常不能让其他组件收不到新价。
      for (const listener of pricingListeners) {
        try {
          listener();
        } catch {
          // 单个订阅者异常不影响其他订阅者
        }
      }
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
    /** 网页搜索 / 抓取按次计费，不属于峰谷，不乘时段倍率。缺失时按 0。 */
    function webToolCostOf(usage) {
      const v = Number(usage?.webToolCost);
      return Number.isFinite(v) && v > 0 ? v : 0;
    }
    function computeSplitCost(usage, p, multiplier = 2) {
      // 网页工具费单独累加：它既不属于高峰也不属于空闲，跟着总额走。
      const web = webToolCostOf(usage);
      if (Array.isArray(usage.byModel) && usage.byModel.length > 0) {
        let total = 0;
        for (const b of usage.byModel) {
          total += typeof b.cost === "number" && Number.isFinite(b.cost) ? b.cost : computeSingleSplitCost(b, p, multiplier);
        }
        return total + web;
      }
      return computeSingleSplitCost(usage, p, multiplier) + web;
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

    /** 消耗行金额的显示位数（2026-11-01 用户定案：「最少要显示到 0.01，然后小数点左右加起来
     *  最多 5 位」「但是可以比如说 1011.11」）。
     *  · 两位小数是**下限**，任何金额都不许只显示到 0.1；
     *  · 小于 1000 的金额，整数位 + 小数位合计不超过 5 位（123.45 / 12.345 / 1.2345），
     *    这样最常见的三位数金额恒定是 6 个字符，胶囊宽度可预测；
     *  · 1000 及以上允许 4 位整数 + 2 位小数（1011.11），合计 6 位。
     *  ⚠️ 别再改回 toFixed(4)：`≈ ¥120.2032` 那一串比标签还长，数字会被挤到右半边，
     *  而且金额一进百位就换宽度、composer dock 跟着重排。 */
    function formatCostText(cost) {
      const v = Math.abs(Number(cost) || 0);
      // ≥10000 收成 1 位小数：智能体团队把会话金额推到四位数很常见，再留着两位就是
      // 「≈¥12345.67」11 个字符、实测会顶破 10.6ch（约 74.6px）的胶囊宽度预算。
      const decimals = v < 1 ? 4 : v < 10 ? 3 : v < 10000 ? 2 : 1;
      return v.toFixed(decimals);
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

    /** 打开平台页面：一律走系统默认浏览器，不在应用内开原生视口或内嵌浏览器。
     *  原来还有一个 page 参数（原生视口标识），从未被使用——
     *  历史上那条路径已废弃，留着它只会让调用方以为存在另一种打开方式（2026-10-31 全量审查）。 */
    function openPlatformOrUrl(url) {
      openInSystemBrowser(url);
    }

    /**
     * 外部链接的通用属性：保留 href（可右键复制），点击时拦截默认跳转、改为应用内打开。
     * @param url - 平台页面地址（用作 href 与最终回退目标）。
     * @param page - 已废弃（参数保留以免调用方改动）；现在一律走系统浏览器。
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
          openPlatformOrUrl(url);
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
      // 逐个订阅者隔离：模型解析结果要送达所有订阅者，不能被一个坏订阅者截断。
      for (const listener of modelListeners) {
        try {
          listener();
        } catch {
          // 单个订阅者异常不影响其他订阅者
        }
      }
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
     *  只缓存"取到模型"的结果；取到空串不缓存，以便会话后续可能产出模型时能重新解析。
     *  ⚠️ 空结果必须节流（2026-10-31 第二十二轮审计）：调用方是 `usageKey` 依赖的 effect，
     *  而 usageKey 在流式输出时每个 chunk 都变。取不到模型时不写缓存 → 每个 chunk 都会走一次
     *  sessionsFace.models() RPC（IPC，不是 HTTP，探针抓不到）+ 一条 fetchServerModel 的 ?session=。
     *  serverModelProbeAt 只挡了后者。这里对"没取到"也记时间，15 秒内不再重试。 */
    const modelMissAt = new Map(); // sessionId -> 上次取到空模型的时刻
    const MODEL_MISS_RETRY_MS = 15000;
    async function resolveSessionModel(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return "";
      if (modelCache.has(sessionId)) {
        const cached = modelCache.get(sessionId);
        if (cached !== "") setCurrentModel(cached);
        return cached;
      }
      if (Date.now() - (modelMissAt.get(sessionId) ?? 0) < MODEL_MISS_RETRY_MS) return "";
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
      if (model !== "") {
        modelCache.set(sessionId, model);
        capSessions(modelCache);
        modelMissAt.delete(sessionId);
        setCurrentModel(model);
      } else {
        modelMissAt.set(sessionId, Date.now());
        capSessions(modelMissAt);
      }
      return model;
    }
    function balanceApiUrl() {
      return currentModel === "" ? "/balance-api" : "/balance-api?model=" + encodeURIComponent(currentModel);
    }
    /** 拉取余额 + 按当前模型计算的定价；成功后广播 pricing。
     *  **单飞**：并发调用共用同一个 in-flight Promise。这条接口每次都要真去查官方余额
     *  （实测 419ms），同一时刻发多份毫无意义，只会让服务端排队。
     *  2026-10-31 加，配合 UsageCostLine 里那两处 usageKey 依赖的修复一起堵住请求风暴。 */
    let balanceDataInFlight = null;
    async function fetchBalanceData(controller) {
      // 带 signal 的调用（外部的取消语义）不参与复用，各走各的
      if (controller && controller.signal) {
        const res = await fetch(balanceApiUrl(), { signal: controller.signal });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (data && data.ok) {
          if (data.pricing) setPricing(data.pricing);
          return data;
        }
        throw new Error((data && data.error) || "余额查询失败");
      }
      if (balanceDataInFlight !== null) return balanceDataInFlight;
      balanceDataInFlight = (async () => {
        const res = await fetch(balanceApiUrl());
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (data && data.ok) {
          if (data.pricing) setPricing(data.pricing);
          return data;
        }
        throw new Error((data && data.error) || "余额查询失败");
      })();
      try {
        return await balanceDataInFlight;
      } finally {
        balanceDataInFlight = null;
      }
    }

    // 按会话增长的表一律夹住上限（2026-10-31 第二十二轮审计）：Map 保持插入序，
    // 超了就淘汰最旧的键。长命页面里访问几百个会话也只是几十 KB，但没必要留着。
    const CACHE_MAX_SESSIONS = 64;
    function capSessions(map, max = CACHE_MAX_SESSIONS) {
      while (map.size > max) {
        const oldest = map.keys().next();
        if (oldest.done) return;
        map.delete(oldest.value);
      }
    }

    /** 请求服务端按会话检测模型（等价于 /balance-api?session= 返回的 model 字段），失败返回 ""。
     *  **同一会话 15 秒内最多问一次**：模型探测不出来时（新会话、空会话）上层会不停重试，
     *  而这条请求会让服务端解压整份 zstd —— 不设闸门就是灾难（2026-10-31）。 */
    const serverModelProbeAt = new Map();
    async function fetchServerModel(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return "";
      const now = Date.now();
      const last = serverModelProbeAt.get(sessionId) ?? 0;
      if (now - last < 15000) return "";
      serverModelProbeAt.set(sessionId, now);
      capSessions(serverModelProbeAt);
      try {
        const res = await fetch("/balance-api?session=" + encodeURIComponent(sessionId));
        if (!res.ok) return "";
        const data = await res.json();
        return data && data.ok && typeof data.model === "string" ? data.model : "";
      } catch {
        return "";
      }
    }

    /** 拉取指定会话的分时段 usage 及子代理 usage（/balance-api?session=...），失败返回 null。
     *  服务端会顺带回一个 `today`（利用本次已解压的事件现算），用它做「今日消耗」的实时刷新。 */
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
          // ⚠️ 必须原样转发 team（2026-11-01 审计 P0）：这一层漏了它，下面写表处的
          // `u.team ?? null` 恒得 null → teamCount 恒 0 → 圆片、团队明细块、以及
          // 「有团队才启动」的补拉全被同一个自锁卡死，整个团队 UI 等于死代码。
          team: data.team && typeof data.team === "object" ? data.team : null,
          today: data.today && typeof data.today === "object" ? data.today : null,
        };
      } catch {
        return null;
      }
    }

    // ─── 逐位滚动（数字每帧上下翻） ──────────────────────────────────────
    // 把两段金额文本按「小数点对齐」拆成逐位滚动的格子：整数右对齐、小数点一位、
    // 小数左对齐，只有真正变了的数位才滚，其余（小数点、货币后缀、没变的高位）静止。
    // 空位用 \u0000 标记，渲染时换成 NBSP 或退回旧字符撑宽。
    // 余额胶囊（自动刷新）与「本会话消耗」共用这一套 —— 两处滚动观感必须一致
    // （2026-10-30 用户要求「对话消耗的数字变动动画跟余额的自动刷新一样」）。
    const ROLL_EMPTY = "\u0000";
    function buildRollCells(fromText, toText) {
      const split = (text) => {
        const m = /^([0-9]*)(\.?)([0-9]*)([\s\S]*)$/.exec(text);
        return m
          ? { int: m[1], dot: m[2], frac: m[3], tail: m[4] }
          : { int: "", dot: "", frac: "", tail: text };
      };
      const a = split(fromText);
      const b = split(toText);
      // ⚠️ **位数一变就不滚，直接静态换值**（2026-10-31：「20.6? CNY」叠字）。
      // 位数不同时要靠 --gone 的 max-width 动画把多出来的格子收成 0 宽（或撑开），
      // 那个宽度是**连续变化**的，而每个格子都是 position:absolute 排在同一行里——
      // 前一格在收窄的过程中，后一格的 left 跟着一起被挤，滚动中途两串数字就横向叠住了。
      // 位数相同（20.68 → 20.71）时宽度不变，逐位滚动不会挤压，照常滚。
      const sameShape = a.int.length === b.int.length
        && a.frac.length === b.frac.length
        && (a.dot !== "") === (b.dot !== "")
        && a.tail.length === b.tail.length;
      if (!sameShape) {
        return String(toText).split("").map((ch) => ({ from: ch, to: ch, changed: false }));
      }
      const padLeft = (s, n) => s.padStart(n, ROLL_EMPTY);
      const padRight = (s, n) => s.padEnd(n, ROLL_EMPTY);
      const intLen = Math.max(a.int.length, b.int.length);
      const fracLen = Math.max(a.frac.length, b.frac.length);
      const tailLen = Math.max(a.tail.length, b.tail.length);
      const rows = [
        [padLeft(a.int, intLen), padLeft(b.int, intLen)],
        [a.dot || b.dot, b.dot || a.dot],
        [padRight(a.frac, fracLen), padRight(b.frac, fracLen)],
        [padRight(a.tail, tailLen), padRight(b.tail, tailLen)],
      ];
      const cells = [];
      for (const [left, right] of rows) {
        for (let i = 0; i < left.length; i += 1) {
          cells.push({ from: left[i], to: right[i], changed: left[i] !== right[i] });
        }
      }
      return cells;
    }

    // ─── 动画台账（统一授权中心，2026-10-31 方案 3）────────────────────────────
    // 之前是 6 个 state 各自计时、各自判断「该不该播」（enterUp / revealSeq /
    // waveToken / roll / todayWipeSeq / todayWipeDone），重播有三个独立成因
    // （组件重挂 / display:none 切换 / 状态残留），堵住一个漏掉另外两个，
    // 于是同一个 bug 反复出现七八轮。
    // 现在收敛成两条规则：
    //   ① 「只许播一次」的动画 → animOnce(name)，台账在**模块级**：
    //      页面刷新 / 插件重载 → 模块重新求值 → 台账清空 → 播一次（这是想要的）；
    //      折叠展开 / 组件重挂 → 模块不重新求值 → 台账还在 → 不播。
    //   ② 其余「事件驱动」的动画（滚动 / 擦除 / 白光）→ 组件 state，
    //      重挂自然归零；再叠一层「重新可见时统一清零」兜住 display 切换。
    const ANIM_LEDGER_KEY = "__balanceAnimLedger";
    function animLedger() {
      const g = globalThis;
      if (!(g[ANIM_LEDGER_KEY] instanceof Map)) g[ANIM_LEDGER_KEY] = new Map();
      return g[ANIM_LEDGER_KEY];
    }
    /** 这个名字的动画是否还能播一次。返回 true 表示「本次由你播」，并立刻记账。 */
    function animOnce(name) {
      const ledger = animLedger();
      if (ledger.get(name) === true) return false;
      ledger.set(name, true);
      return true;
    }
    /** 读账本里记的「上次的值」（用于判断某个数值是否真的变了，跨重挂有效）。 */
    function animRead(name) {
      return animLedger().get(name);
    }
    function animWrite(name, value) {
      animLedger().set(name, value);
    }

    // ── 「离开过对话」单槽标记 ──────────────────────────────────────────────
    // 从侧边栏切到插件页 / 其它视图、再点回**同一个**对话时，会话 id 根本没变，
    // 只比 id 就会判成「不是进场」→ 一个动画都没有、数字直接跳
    // （用户 2026-10-31：「从红圈位置点进对话的时候 对话消耗没有任何动画」）。
    // 判据不能用时间差（点得快就漏），改用「卸载之后我们的消耗行还在不在 DOM 里」：
    //   · 真的离开了对话 → 250ms 后整块对话视图已换掉，行不在 → 打标记；
    //   · 同一对话内的 composer 重挂 → 新实例早把行挂回去了 → 不打标记，动画不重播。
    const COST_REENTRY_PROBE_MS = 250;
    function markCostReentry() {
      animWrite("cost-reentry", true);
    }
    function takeCostReentry() {
      const marked = animRead("cost-reentry") === true;
      if (marked) animWrite("cost-reentry", "");
      return marked;
    }

    // ── 「服务端这次说拿不到」时，旧分桶最多还能顶多久 ────────────────────────
    // 服务端 `usage: null` **不是**"正在解码"（当前 HEAD 已无 skipDisk 短路，null 只来自
    // 读盘抛错 / totalTokens === 0 / 事件缺 turn·step / 会话被压缩清空，见审计清单）。
    // 其中「会话被压缩或清空」「持久化文件坏掉」是**永久**的：若无限期保留旧分桶，
    // 消耗行会安静地一直显示清空前的金额（实测 ¥10.04 vs 真实 ¥0.00），迷雾和本地投影
    // 兜底都不会触发。所以只给一个短窗口做防抖（同一会话连续两趟 null / 一次读失败），
    // 超过就认新结果、退回本地投影。
    const SPLIT_KEEP_MS = 60_000;

    /** 渲染一组滚动格。prefix 只用于 React key（两处调用各用一个前缀，互不干扰）。
     *
     *  **错位起步**（2026-10-31：「所有的数字滚动太生硬了」）：所有位同时起步时，
     *  整串像一块板在平移。这里按「从右数第几位」给每个滚动格加 animation-delay ——
     *  个位最先动，进位逐位往左传递，读起来是机械计数器逐位落位。
     *  没有变化的格子本来就不滚（渲染成静态 dcell），不占错位名额。
     *  每位自身仍是 linear 420ms、位移分毫不差，所以不会退回「快到位置时发虚」。 */
    const ROLL_STAGGER_MS = 38;
    const ROLL_STAGGER_MAX = 4;
    // 滚动播完后给 roll 打 done 标记（2026-10-31 方案 3 补充）。
    // 为什么必须做：`dout`/`din` 上的 animation 是常驻声明，只要它还在，
    // 元素经历 display:none → 有盒子时浏览器会取消并重建动画，从 0 秒重播。
    // 打了 done 之后 renderRollCells 会挂 --roll-done 把声明整个摘掉，
    // 节点仍常驻（结构不切换、不跳），但已经没有任何动画可以重播。
    // 600ms = 单格 420ms + 最长错位 4×38ms ≈ 572ms，留 30ms 余量。
    const ROLL_SETTLE_MS = 600;
    function useRollSettle(roll, setRoll) {
      react.useEffect(() => {
        if (roll === null || roll.done === true) return;
        const at = roll.at;
        const id = setTimeout(() => {
          setRoll((r) => (r !== null && r.at === at && r.done !== true ? { ...r, done: true } : r));
        }, ROLL_SETTLE_MS);
        return () => clearTimeout(id);
      }, [roll, setRoll]);
    }

    function renderRollCells(cells, prefix, settled) {
      // 先按从右往左给「会滚的格子」编号：最右边的滚动格延迟 0
      const total = cells.length;
      return jsx.jsx("span", {
        className: "balance-footer__roll",
        children: cells.map((cell, i) => {
          if (!cell.changed) {
            return jsx.jsx("span", { className: "balance-footer__dcell", children: cell.to === ROLL_EMPTY ? "\u00a0" : cell.to }, prefix + i);
          }
          const fromRight = total - 1 - i;
          const step = Math.min(fromRight, ROLL_STAGGER_MAX);
          const delay = step * ROLL_STAGGER_MS;
          const style = delay > 0 ? { animationDelay: delay + "ms" } : undefined;
          return jsx.jsxs("span", {
            // 新值是空位（位数减少）时加 --gone：滚完自己收成 0 宽，否则尾巴多一格，
            // 胶囊会被撑宽再缩回（2026-10-30 实测 73.66 ↔ 83.53）。
            // settled 为真时再加 --roll-done：把 animation 声明整个摘掉。
            // 这一步不是视觉优化，是「展开侧边栏不许重播」的根治点 ——
            // display:none 的元素重新显示会取消并重建 CSS 动画，只有让声明不存在才挡得住。
            className: "balance-footer__dcell balance-footer__dcell--roll"
              + (cell.to === ROLL_EMPTY ? " balance-footer__dcell--gone" : "")
              + (settled === true ? " balance-footer__dcell--roll-done" : ""),
            children: [
              // 影子格用「新字符」撑宽；新值是空位时退回旧字符 —— 滚动开始那一刻的宽度
              // 正好等于滚动前，之后由 --gone 的 max-width 动画把它平滑收到 0。
              jsx.jsx("span", { className: "balance-footer__dghost", children: cell.to === ROLL_EMPTY ? cell.from : cell.to }),
              jsx.jsx("span", { className: "balance-footer__dout", style: style, children: cell.from === ROLL_EMPTY ? "\u00a0" : cell.from }),
              jsx.jsx("span", { className: "balance-footer__din", style: style, children: cell.to === ROLL_EMPTY ? "\u00a0" : cell.to }),
            ],
          }, prefix + i);
        }),
      });
    }

    // ─── 「剩 3h57m」这类混排文本的逐段滚动 ──────────────────────────────────
    // buildRollCells 只认「整个串是一个数字」（按数字开头切 int/dot/frac/tail），
    // 直接把 "3h57m" 喂进去只会滚开头的 3，h57m 全被当成静态 tail。
    // 这里先按「数字段 / 非数字段」切开，数字段各自滚、字母段保持不动。
    function splitRollTokens(text) {
      return String(text).match(/\d+|\D+/g) || [];
    }

    /** 渲染剩余时间的滚动。段数变了（59m → 1h0m 这种跨小时）就整体换下来，
     *  逐段对齐没有意义 —— 硬凑会让 h/m 和数字错位。 */
    function renderRemainRoll(fromText, toText, prefix, settled) {
      const a = splitRollTokens(fromText);
      const b = splitRollTokens(toText);
      if (a.length !== b.length) {
        return jsx.jsx("span", { className: "balance-footer__remain-swap", children: toText }, prefix + "swap");
      }
      return jsx.jsx("span", {
        className: "balance-footer__remain",
        children: b.map((tok, i) => (
          /^\d+$/.test(tok)
            ? jsx.jsx("span", {
              className: "balance-footer__roll",
              children: renderRollCells(buildRollCells(a[i], tok), prefix + i, settled),
            }, prefix + "s" + i)
            : jsx.jsx("span", { className: "balance-footer__remain-unit", children: tok }, prefix + "s" + i)
        )),
      }, prefix + "wrap");
    }

    /** 值变化时返回递增的 tick：用它当 key 就能让元素重挂、重播一次入场动画，
     *  不用手工管 class 的摘除时机。首帧不触发（只跟着变化走）。 */
    function useChangeTick(value) {
      const prevRef = react.useRef(value);
      const [tick, setTick] = react.useState(0);
      usePrePaintEffect(() => {
        if (prevRef.current === value) return;
        prevRef.current = value;
        setTick((n) => n + 1);
      }, [value]);
      return tick;
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

    // 生效中的高峰窗口。默认 = 官方当前口径，但设置里的「高峰时段」一改就换成用户的。
    // **判定（currentPeriod）和刻度（periodBounds）都必须读 activePeakWindows**，
    // 直接读 PEAK_WINDOWS 会让改了设置的人看到标签和刻度条对不上。
    let activePeakWindows = PEAK_WINDOWS;

    /** "9-12, 14-18" → [{start,end}]。与服务端 parsePeakWindowsText 同规则：
     *  逐段校验，任何一段不合法整串作废（返回 null），宁可回退默认窗口也不错算。 */
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

    /** 应用设置里的窗口文本；解析失败保持当前窗口不动（不因为半截输入把标签打乱）。 */
    function applyPeakWindowsText(text) {
      const parsed = parsePeakWindowsText(text);
      if (parsed !== null) activePeakWindows = parsed;
      return activePeakWindows;
    }
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
    // 与服务端同一份多源列表：某个 CDN 不通就换下一个。
const CN_CALENDAR_SOURCES = [
  "https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master",
  "https://gcore.jsdelivr.net/gh/NateScarlet/holiday-cn@master",
  "https://raw.githubusercontent.com/NateScarlet/holiday-cn/master",
  "https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master",
];
    // 「已成功同步」与「正在同步」必须分成两个集合。
    // 原来只用一个 Set 做占位，三个源全挂时占位留在集合里 —— 那一年就**永远不再重试**，
    // 网络恢复后也看不到调休数据（2026-10-31 全量审查）。
    const cnCalendarYears = new Set();   // 已成功拿到数据
    const cnCalendarInFlight = new Set(); // 正在请求（防并发重复）
    async function ensureCnCalendar(year) {
      if (cnCalendarYears.has(year) || cnCalendarInFlight.has(year)) return;
      cnCalendarInFlight.add(year);
      try {
        for (const base of CN_CALENDAR_SOURCES) {
          try {
            const res = await fetch(base + "/" + year + ".json", { signal: AbortSignal.timeout(6000) });
            if (!res.ok) continue;
            const data = await res.json();
            if (!Array.isArray(data?.days)) continue;
            for (const item of data.days) {
              if (item && typeof item.date === "string" && typeof item.isOffDay === "boolean") {
                CN_CALENDAR[item.date] = item.isOffDay ? "holiday" : "workday";
              }
            }
            cnCalendarYears.add(year);
            return;
          } catch {
            // 这个源连不上：换下一个；全挂就保留内置表
          }
        }
      } finally {
        // 成功也删、失败也删：成功由 cnCalendarYears 记住，失败则允许下次重试。
        cnCalendarInFlight.delete(year);
      }
    }
    {
      const y = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCFullYear();
      void ensureCnCalendar(y - 1);
      void ensureCnCalendar(y);
      void ensureCnCalendar(y + 1);
    }
    /** 点击目标是否落在统计层 / 平台层内部。
     *  这两层虽然 portal 到 body，但 React 里仍是余额行的子节点，事件会沿组件树冒泡回来；
     *  它们自带关闭逻辑，不能被当成「点了余额行」再 arm 一次打开定时器（2026-10-30 回归：
     *  点关闭按钮 → 捕获阶段先 arm 230ms 打开定时器 → 按钮随即关闭 → 230ms 后又被打开，面板关不掉）。 */
    function isOverlayTarget(target) {
      try {
        return Boolean(target && typeof target.closest === "function" && target.closest(".balance-stats-layer, .balance-platform-layer"));
      } catch {
        return false;
      }
    }

    // 设置项旁那颗 NEW 的展示时长：24 小时（2026-10-31 由 3 天改短）。
    // 入口那颗 NEW 不看这个时长，它的熄灭条件是「用户点进去过」，见 unseenNewTags。
    const NEW_TAG_TTL_MS = 24 * 60 * 60 * 1000;

    /** 单项 NEW 判定。每项自带起点，互不影响：
     *  - record 里已记下这一版（v === intro）→ 就用 t 计时，不再判 fresh
     *    （否则刚记完就会因 "intro 不大于自己"而立刻消失）
     *  - 没记录或引入版本变了 → 比较「引入版本 vs 用户见过的版本」
     *  旧功能因 fresh=false 直接不显示，所以不可能被新版本重新计时。
     *
     *  返回三个字段，语义各不相同，别混用：
     *  - fresh：这一项「对用户算新功能」。决定要不要写记录，与显示无关。
     *  - show ：设置项旁那颗 NEW 现在要不要亮。按 24 小时窗口算。
     *  - entered：用户有没有点进过插件设置页。侧栏入口那颗 NEW 只看它 ——
     *    点进去过就不再提示，直到下个新功能出现（2026-10-31 用户要求）。 */
    function newTagStateAt(introVersion, record, fallbackFrom, fallbackSince, nowMs, currentVersion) {
      const intro = String(introVersion || "");
      if (intro === "") return { fresh: false, show: false, since: 0, entered: true };
      const curVer = String(currentVersion || "");
      const rec = record && typeof record === "object" && !Array.isArray(record) ? record : null;
      const recV = rec && typeof rec.v === "string" ? rec.v : "";
      const recT = rec ? Number(rec.t) : NaN;
      const now = Number(nowMs);
      const within = (since) => {
        const s = Number(since);
        if (!Number.isFinite(s) || s <= 0) return true;
        return now - s < NEW_TAG_TTL_MS;
      };
      const pick = (since) => {
        const s = Number(since);
        return Number.isFinite(s) && s > 0 ? s : 0;
      };
      // 本版新增的功能：即使 newTagFrom 已经被写成同一个版本号（开发期反复改版本号、
      // 或同版本重装），只要还在 24 小时窗口内就照亮 —— 用户 2026-10-31 报
      // 「NEW 标签不是要显示满 24 小时吗，怎么提前消失了」，根因就是
      // compareVersion("2.1.0", "2.1.0") === 0 让这类项被判成「老功能」。
      // 只对 intro 等于当前版本的项放宽，历史版本的功能依旧不亮。
      const isCurrentIntro = (since) => curVer !== "" && compareVersion(intro, curVer) === 0 && within(since);
      // 已经按这一版记录过：仍要**再判一次"对这名用户算不算新功能"**。
      // 早先这里无条件 fresh:true，只靠 24 小时窗口控制显不显示 —— 结果是
      // 从 2.0.8 升上来的用户，2.0.0 的老功能（余额行样式 / 侧边栏显示本插件 /
      // 右键刷新浪潮）只要 t 落在窗口里就一块标 NEW，等于"每个人高亮的东西都一样"。
      // 现在严格用 引入版本 对比 用户升级前的版本（newTagFrom），每人各不相同：
      // 跨多版升上来的会看到中间所有新功能，只升一版的老功能一条都不亮。
      if (recV !== "" && recV === intro) {
        const baseline = String(fallbackFrom || "");
        const since = Number.isFinite(recT) && recT > 0 ? recT : Number(fallbackSince);
        const reallyFresh = baseline === "" || compareVersion(intro, baseline) > 0 || isCurrentIntro(since);
        const entered = rec !== null && rec.d === true;
        return {
          fresh: reallyFresh,
          show: reallyFresh && within(since),
          since: pick(since),
          entered: entered || !reallyFresh,
        };
      }
      // 没记录（或引入版本变了）：才判这项对用户算不算新
      const baseline = recV !== "" ? recV : String(fallbackFrom || "");
      const since = Number(fallbackSince);
      const fresh = baseline === "" || compareVersion(intro, baseline) > 0 || isCurrentIntro(since);
      if (!fresh) return { fresh: false, show: false, since: 0, entered: true };
      return { fresh: true, show: within(since), since: pick(since), entered: false };
    }

    /** 按数字段比较版本号：1.3.10 > 1.3.9（字符串直接比会错）。
     *  任一段非数字按 0 处理；相等返回 0。 */
    function compareVersion(a, b) {
      const pa = String(a === undefined || a === null ? "" : a).split(".");
      const pb = String(b === undefined || b === null ? "" : b).split(".");
      const len = Math.max(pa.length, pb.length);
      for (let i = 0; i < len; i += 1) {
        const x = Number.parseInt(pa[i], 10) || 0;
        const y = Number.parseInt(pb[i], 10) || 0;
        if (x !== y) return x > y ? 1 : -1;
      }
      return 0;
    }

    // NEW_TAGS：标准——「最近版本加了什么」。放在模块级，因为有两处要用：
    //   ① 设置卡片逐项高亮（「消耗行加载动效」旁边那颗 NEW）；
    //   ② 侧栏「余额与用量」入口图标右上角那颗 NEW 标签（有新功能就亮）。
    // 每项带上「引入版本」：只有比用户上一次跑的版本更新的项才标 NEW，
    // 跨几个版本一次升上来的用户会看到所有中间新功能，已经跑过的不会被重复提示。
    // 维护方式：发版时把本版新增的设置项 key 加进来，引入版本写当次的 pending 值。
    const NEW_TAGS = new Map([
      ["footerStyle", "2.0.0"], // 余额行样式（新版 timeline / 旧版 classic）
      ["showSidebarEntry", "2.0.0"], // 左侧导航栏入口
      ["refreshWave", "2.0.0"], // 右键刷新涟漪
      ["usageLoadingStyle", "2.0.9"], // 消耗行加载动效：样式1（光团开窗）/ 样式2（计算中），含行内实时预览
      ["todaySessionLimit", "2.1.0"], // 今日消耗扫描上限：多开对话 / 多跑子代理时把今日汇总算全
    ]);

    /** NEW_TAGS 的 key → 设置项中文名。横幅要写「本版新增：消耗行加载动效」，
     *  key 是内部标识，不能直接给用户看。加新功能时**这里也要补一行**。 */
    const NEW_TAG_LABELS = {
      footerStyle: "余额行样式",
      showSidebarEntry: "侧边栏显示本插件",
      refreshWave: "右键刷新浪潮",
      usageLoadingStyle: "消耗行加载动效",
      todaySessionLimit: "今日消耗扫描上限",
    };

    /** 模板串里取一张表的三个 NEW 相关字段，缺省一律安全兜底。 */
    function newTagFields(settings) {
      const s = settings && typeof settings === "object" ? settings : {};
      return {
        seen: s.newTagSeen && typeof s.newTagSeen === "object" ? s.newTagSeen : {},
        from: String(s.newTagFrom || ""),
        since: Number(s.newTagSince),
        // 当前插件版本：用来判定「这项是不是本版新增」，见 newTagStateAt 的 isCurrentIntro。
        version: String(s.version || ""),
      };
    }

    /** 设置项旁那颗 NEW 要亮的项（24 小时窗口内）。 */
    function freshNewTags(settings) {
      const { seen, from, since, version } = newTagFields(settings);
      const now = Date.now();
      const out = [];
      for (const [key, intro] of NEW_TAGS) {
        const st = newTagStateAt(intro, seen[key], from, since, now, version);
        if (st.fresh && st.show) out.push({ key, intro });
      }
      return out;
    }

    /** 侧栏入口那颗 NEW 要亮的项：算新功能、还在 24 小时窗口内、而且用户没点进去过。
     *  ⚠️ 必须带上 st.show（24 小时窗口）。只判 !entered 会让**老功能永远亮**：
     *  newTagStateAt 对「已记录」的项是无条件 fresh:true 的（那是给写盘用的），
     *  而 footerStyle 这类 2.0.0 的老项永远不会被写上 e 标记，于是入口 NEW 挂一辈子。
     *  2026-10-31 用户报「怎么消不掉」就是这个 —— 一版之前只判了 fresh，漏了窗口。
     *  熄灭条件仍是「点进去过」，下个新功能自有自己的 24 小时窗口。 */
    function unseenNewTags(settings) {
      const { seen, from, since, version } = newTagFields(settings);
      const now = Date.now();
      const out = [];
      for (const [key, intro] of NEW_TAGS) {
        const st = newTagStateAt(intro, seen[key], from, since, now, version);
        if (st.fresh && st.show && !st.entered) out.push({ key, intro });
      }
      return out;
    }

    /** 只留下 NEW_TAGS 里还存在的 key。
     *  NEW_TAGS 会随版本增删，删掉的功能在 newTagSeen 里留的记录永远没人读，
     *  攒久了就是设置文件里一坨死数据。写盘前一律先过这一步（2026-10-31 用户问「缓存会不会越来越大」）。 */
    function pruneNewTagSeen(seen) {
      const src = seen && typeof seen === "object" ? seen : {};
      const out = {};
      for (const [key] of NEW_TAGS) {
        const rec = src[key];
        if (rec && typeof rec === "object" && !Array.isArray(rec)) out[key] = rec;
      }
      return out;
    }

    /** 用户点进了插件设置页（点侧栏入口、或者从别处打开这张卡片）：
     *  把还没看过的新功能全部标成 e:true，侧栏那颗 NEW 就此熄灭，直到下个新功能出现。
     *  设置项旁那颗 NEW 不受影响，它按自己的 24 小时窗口走。
     *  没有可标的项时返回 null（不写盘、不刷事件）。 */
    function markNewTagsEntered(settings) {
      const unseen = unseenNewTags(settings);
      const { seen, since } = newTagFields(settings);
      // 即使这次没有可标的项，也顺手做一次清理，把已删功能的残记录带走
      const next = pruneNewTagSeen(seen);
      const pruned = Object.keys(next).length !== Object.keys(seen).length;
      if (unseen.length === 0) return pruned ? next : null;
      const anchor = Number.isFinite(since) && since > 0 ? since : Date.now();
      for (const { key, intro } of unseen) next[key] = { v: intro, t: anchor, d: true };
      return next;
    }

    function currentPeriod(atMs) {
      const d = new Date((atMs === undefined ? Date.now() : atMs) + 8 * 60 * 60 * 1000); // 北京时间
      const kind = CN_CALENDAR[
        d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0")
      ];
      if (kind === "holiday") return "offpeak"; // 法定节假日：全天按空闲
      const hour = d.getUTCHours();
      const weekday = d.getUTCDay(); // 0=周日 … 6=周六
      // 与服务端 isPeakAt 同口径：官方定价页把「周末及法定节假日全天」都算空闲，
      // 没有调休例外，所以 workday（调休上班的周末）也按周末处理。
      return PEAK_WEEKDAYS.includes(weekday) && activePeakWindows.some((w) => hour >= w.start && hour < w.end) ? "peak" : "offpeak";
    }
    const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
    /** 当前时段的区间与剩余时间（供刻度条上方那行 meta 用）。
     *  高峰 = 所在高峰窗口；空闲 = 上一个高峰结束 → 下一个高峰开始
     *  （可能是一整夜、整个周末或整个法定节假日）。
     *  @returns {{ kind: "peak"|"offpeak", start: number, end: number, remainMs: number } | null} */
    function periodSpan(atMs) {
      const now = atMs === undefined ? Date.now() : atMs;
      const kind = currentPeriod(now);
      const HOUR = 3600000;
      const bj = new Date(now + BEIJING_OFFSET_MS);
      const dayStart = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()) - BEIJING_OFFSET_MS;
      let start = null;
      let end = null;
      if (kind === "peak") {
        const h = (now - dayStart) / HOUR;
        for (const w of activePeakWindows) {
          if (h >= w.start && h < w.end) {
            start = dayStart + w.start * HOUR;
            end = dayStart + w.end * HOUR;
            break;
          }
        }
      }
      if (start === null || end === null) {
        // 空闲：向后找上一个高峰结束、向前找下一个高峰开始（最多看 60 天，覆盖长假）
        let t = Math.floor(now / HOUR) * HOUR;
        for (let i = 0; i < 24 * 60; i++) {
          const probe = t - HOUR;
          if (currentPeriod(probe) === "peak") { start = t; break; }
          t = probe;
        }
        t = Math.floor(now / HOUR) * HOUR;
        for (let i = 0; i < 24 * 60; i++) {
          const probe = t + HOUR;
          if (currentPeriod(probe) === "peak") { end = probe; break; }
          t = probe;
        }
      }
      if (start === null || end === null || end <= start) return null;
      return { kind, start, end, remainMs: end - now };
    }
    /** 把剩余毫秒压成「45m」「3h12m」「2d7h」这种短文案。 */
    function formatRemain(ms) {
      const totalMin = Math.max(0, Math.round(ms / 60000));
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      if (h <= 0) return m + "m";
      if (h < 24) return m === 0 ? h + "h" : h + "h" + m + "m";
      const d = Math.floor(h / 24);
      const rh = h % 24;
      return rh === 0 ? d + "d" : d + "d" + rh + "h";
    }
    /**
     * 余额位数多时返回降字号用的 class（空串 = 不降）。
     *
     * 胶囊的宽度是固定的 121px（.balance-footer__value 的 min-width），正常 16px 字号
     * 能容纳到「999.99 CNY」（121.4px 天然宽度，实测）。整数位一旦到 4 位，
     * 天然宽度就超过固定宽度（1234.56 CNY = 131.3px），会把胶囊撑出侧栏右缘 ——
     * 所以按整数位数降一档字号，让它重新收回 121px 以内。
     *
     * 按「整数位数」而不是整串字符数判断：`¥` 前缀、货币码长短、有没有小数都会
     * 干扰字符数，但整数位数就是金额量级本身，判断最稳。
     * 负数（理论上不会出现）先剥掉符号再数，免得 "-" 被算成一个数位。
     */
    function amountDensity(raw) {
      const text = String(raw ?? "");
      const intPart = text.split(".")[0].replace(/\D/g, "");
      if (intPart.length >= 7) return " balance-footer__value--dense2";
      if (intPart.length >= 3) return " balance-footer__value--dense";
      return "";
    }
    // ─── 时段刻度条：色带固定 = 一整天，指针随时刻从左走到右 ────────────────
    // 轨道铺满当天 00:00 → 次日 00:00 的时段色带（不滚动），指针位置 = 现在时刻在当天的比例。
    // 指针每秒前进一次（pointerNow 独立节拍），CSS transition:left 1s linear 补成连续滑动；
    // 跨零点那一帧用 --snap 关掉过渡，直接落到新一天的起点。
    const DAY_MS = 24 * 3600000;
    /** 当天 00:00（北京时间）的毫秒时间戳。色带、指针、跨零点判定共用同一个基准。 */
    function dayStartOf(now) {
      return Math.floor((now + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS;
    }
    /** 此刻在一整天里的百分比位置（0 → 100）。指针每秒调它一次。 */
    function pointerPercent(now) {
      return ((now - dayStartOf(now)) / DAY_MS) * 100;
    }
    /** 生成刻度条：当天色带渐变 + 时段文字 + 指针位置。
     *  @returns {{ gradient: string, pointerPct: number }} */
    // 纯函数结果缓存：buildTimeline(now) 完全由 now 决定（内部 currentPeriod 都显式传了 t），
    // 每个渲染周期有**两个**组件各调一次同一个 now，再叠上无关状态的重复渲染 ——
    // 24 次小时采样 + 拼字符串每次都白跑（2026-10-31 全量审查）。
    // 用模块级单槽缓存而不是 useMemo：新增 hook 会往渲染体里加入员，
    // 一旦落点越过早退分支就是 "Rendered more hooks…"，代价远大于这点收益。
    let timelineMemoAt = Number.NaN;
    let timelineMemoValue = null;
    function buildTimeline(now) {
      if (timelineMemoValue !== null && timelineMemoAt === now) return timelineMemoValue;
      const HOUR = 3600000;
      // 当天 00:00（北京时间）。BEIJING_OFFSET_MS 东为正，先平移到北京再取整到天。
      const dayStart = dayStartOf(now);
      const dayEnd = dayStart + DAY_MS;
      // 逐小时采样找出切换点（官方时段都在整点切换，1 小时精度足够）
      const stops = [];
      let prevKind = currentPeriod(dayStart);
      for (let t = dayStart + HOUR; t < dayEnd; t += HOUR) {
        const k = currentPeriod(t);
        if (k !== prevKind) {
          stops.push({ at: t, kind: k });
          prevKind = k;
        }
      }
      const peakColor = "var(--dsw-alias-state-error-primary,#e5484d)";
      const offpeakColor = "var(--dsw-alias-state-success-primary,#22c55e)";
      const colorOf = (k) => (k === "peak" ? peakColor : offpeakColor);
      const pct = (ms) => ((ms - dayStart) / DAY_MS) * 100;
      const parts = [];
      let from = dayStart;
      let kind = currentPeriod(dayStart);
      for (const s of stops) {
        parts.push(colorOf(kind) + " " + pct(from).toFixed(2) + "% " + pct(s.at).toFixed(2) + "%");
        from = s.at;
        kind = s.kind;
      }
      parts.push(colorOf(kind) + " " + pct(from).toFixed(2) + "% 100%");
      const built = {
        gradient: "linear-gradient(90deg," + parts.join(",") + ")",
        pointerPct: pct(now),
      };
      timelineMemoAt = now;
      timelineMemoValue = built;
      return built;
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
      footerStyle: "timeline",
      showSidebarEntry: true,
      refreshWave: true,
      // 与服务端 DEFAULT_SETTINGS 逐字段保持一致（selftest 会逐键比对求值后的对象）
      usageLoadingStyle: "wipe",
      entrySeen: false,
      newTagVersion: "",
      newTagSince: 0,
      newTagFrom: "",
      newTagSeen: {},
      fabSize: 60,
      fabLeft: 44,
      statsSessionLimit: 80,
      // 今日消耗单独一个上限，默认比统计宽（服务端 TODAY_MAX_SESSIONS 同值）
      todaySessionLimit: 200,
      statsCacheSec: 300,
      peakWindowsText: "9-12, 14-18",
      peakMultiplier: 2,
      priceFlash: null,
      pricePro: null,
    };

    let settingsCache = { value: { ...SETTINGS_DEFAULTS }, loaded: false, version: "" };
    const settingsListeners = new Set();
    let settingsInFlight = null;

    // 节假日数据（服务端 /balance-api?calendar=1 同步的那份）。
    // 必须把服务端下发的 days 合进客户端自己的 CN_CALENDAR —— 否则服务端按新公告算钱、
    // 客户端高峰/空闲标签还按内置表，同一时刻两边口径会打架。
    // missing = 服务端「连上了但还没公布」的年份（典型：次年放假安排要等国务院年底发）。
    // 只用于在设置页提示「2027 待公布」，不参与峰谷判定。
    let calendarCache = { fetchedAt: 0, years: [], missing: [], count: 0, loaded: false };
    let calendarInFlight = null;

    /** 把服务端的 days 明细（YYYY-MM-DD → holiday/workday）合并进本地日历表。 */
    function applyCalendarDays(days) {
      if (!days || typeof days !== "object") return;
      let merged = 0;
      for (const [date, kind] of Object.entries(days)) {
        if (typeof date === "string" && (kind === "holiday" || kind === "workday")) {
          CN_CALENDAR[date] = kind;
          merged += 1;
        }
      }
      return merged;
    }

    function adoptCalendar(data) {
      calendarCache = {
        fetchedAt: Number(data.fetchedAt) || 0,
        years: Array.isArray(data.years) ? data.years.map(Number).filter((y) => Number.isFinite(y)) : [],
        missing: Array.isArray(data.missing) ? data.missing.map(Number).filter((y) => Number.isFinite(y)) : [],
        count: Number(data.count) || 0,
        loaded: true,
      };
      applyCalendarDays(data.days);
      // 峰谷判定变了 → 让订阅者（余额行标签、消耗行、设置卡片）都重画
      emitSettings();
      return calendarCache;
    }

    /** 读服务端节假日状态（并发合并）。失败静默 —— 拿不到就继续用内置表。 */
    function fetchCalendarStatus() {
      if (calendarInFlight !== null) return calendarInFlight;
      calendarInFlight = (async () => {
        try {
          const res = await fetch("/balance-api?calendar=1", { headers: { accept: "application/json" } });
          if (!res.ok) return calendarCache;
          const data = await res.json();
          if (!data || data.ok !== true) return calendarCache;
          return adoptCalendar(data);
        } catch {
          return calendarCache;
        } finally {
          calendarInFlight = null;
        }
      })();
      return calendarInFlight;
    }

    /** 手动同步：POST 让服务端去拉当年 ±1 年的国务院公告并落盘。 */
    async function syncCalendar() {
      const res = await fetch("/balance-api?calendar=1", {
        method: "POST",
        headers: { accept: "application/json" },
      });
      const data = await res.json();
      if (data && data.ok === true) adoptCalendar(data);
      return data;
    }

    /** 订阅节假日状态；首次使用时自动去读一次。 */
    function useCalendar() {
      const [, force] = react.useState(0);
      react.useEffect(() => {
        const listener = () => force((n) => n + 1);
        settingsListeners.add(listener);
        if (calendarCache.loaded !== true) void fetchCalendarStatus();
        return () => settingsListeners.delete(listener);
      }, []);
      return calendarCache;
    }

    function emitSettings() {
      // 逐个订阅者隔离：设置热更新必须送达所有订阅者。
      for (const listener of settingsListeners) {
        try {
          listener();
        } catch {
          // 单个订阅者异常不影响其他订阅者
        }
      }
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
            // 高峰窗口跟着设置走：判定与刻度都得换，否则标签会和实际计费对不上
            applyPeakWindowsText(settingsCache.value.peakWindowsText);
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
      // ⚠️ 设置没加载完就绝不许写盘（2026-10-31 审查）。
      // 下面那一行会把 settingsCache.value 整份带上去，而它在加载完成前是
      // SETTINGS_DEFAULTS —— 那不是"用户现在想要的"，是"出厂默认"。
      // 写下去就是一次静默的配置清空，而且界面还提示"已保存"。
      if (settingsCache.loaded !== true) {
        throw new Error("设置还没加载完成，请稍后再试");
      }
      const res = await fetch("/balance-api?config=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { ...settingsCache.value, ...patch } }),
      });
      const data = await res.json();
      if (!data || data.ok !== true) throw new Error((data && data.error) || "保存失败");
      const server = data.settings && typeof data.settings === "object" ? data.settings : {};
      // 服务端还是旧代码时不认识新加字段（normalizeSettings 会把未知键丢掉），
      // 如果直接拿它回传的对象覆盖本地，刚落下去的值会被冲回默认值 ——
      // 表现就是「点了 NEW 它又亮回来」（2026-10-31 实测）。所以把服务端**没回传**的
      // 补丁键保留在本地：会话内行为正确，重启 DSH 让服务端认识之后自然对齐。
      const kept = {};
      for (const key of Object.keys(patch)) {
        if (!(key in server)) kept[key] = patch[key];
      }
      settingsCache = {
        value: { ...SETTINGS_DEFAULTS, ...server, ...kept },
        loaded: true,
        version: typeof data.version === "string" ? data.version : settingsCache.version,
      };
      applyPeakWindowsText(settingsCache.value.peakWindowsText);
      emitSettings();
      return settingsCache.value;
    }

    // ─── 检查更新 ─────────────────────────────────────────────────────────────
    /** 查 npm 上有没有新版本（/balance-api?update=1）。
     *  返回 { ok, current, latest, newer, error }；有新版时 newer = true。
     *  只是查版本号，不下载任何东西；失败时 ok = false 且 error 带原因。 */
    async function fetchUpdateInfo() {
      const res = await fetch("/balance-api?update=1", { headers: { accept: "application/json" }, cache: "no-store" });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "?"));
      const data = await res.json();
      const current =
        data && typeof data.current === "string" && data.current !== ""
          ? data.current
          : String(settingsCache.version || "");
      if (!data || data.ok !== true) {
        return {
          ok: false,
          current,
          latest: "",
          newer: false,
          error: data && typeof data.error === "string" ? data.error : "未知原因",
        };
      }
      const latest = typeof data.latest === "string" ? data.latest : "";
      return { ok: true, current, latest, newer: compareVersion(latest, current) > 0, error: "" };
    }

    // ─── 启动检查更新 → 侧栏入口红点 ────────────────────────────────────────
    // 每次打开 DeepSeek Harness 查一次 npm，有新版本就在左侧「余额与用量」
    // 入口上亮一颗红点（用户要求）。只查版本号，不下载、不弹窗、不打扰。
    let updateNotice = { latest: "", seen: false };
    const updateNoticeListeners = new Set();
    function emitUpdateNotice() {
      for (const listener of updateNoticeListeners) {
        // 单个订阅者抛错不能影响其它（也别冒泡到渲染阶段）
        try {
          listener();
        } catch {
          /* ignore */
        }
      }
    }

    /** 订阅「有没有新版本」。与 settingsListeners 分开，避免每次改设置都重查。 */
    function useUpdateNotice() {
      const [, force] = react.useState(0);
      react.useEffect(() => {
        const listener = () => force((n) => n + 1);
        updateNoticeListeners.add(listener);
        return () => updateNoticeListeners.delete(listener);
      }, []);
      return updateNotice;
    }

    /** 启动检查（每次页面加载跑一次，apply 里延迟调度）。失败静默：没有红点而已。 */
    async function checkUpdateOnStartup() {
      try {
        const info = await fetchUpdateInfo();
        if (!info || info.ok !== true || info.newer !== true) return;
        // latest 变了才重置 seen —— 用户已经无视过 2.0.7，再出 2.0.8 仍然要提示
        if (updateNotice.latest !== info.latest) {
          updateNotice = { latest: info.latest, seen: false };
          emitUpdateNotice();
        }
      } catch {
        /* 网络/接口不可用：当作没新版，不写日志不打扰 */
      }
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

    // ─── 今日消耗：随余额一起刷新（服务端 60s 缓存，只扫今天动过的会话） ──
    // tried = 至少问过一次（不论成功失败）。用来区分「还在等」和「确实没有」：
    // 等待期间先摆一个不可见占位，让 meta 行高度从一开始就是最终高度 ——
    // 否则「今日 ¥x」这个 flex-basis:100% 的元素一插入，整行就从 1 行变 2 行，
    // 侧栏底部整体被顶下 14px，冷启动繁忙时看着就是「今日余额弹出来那下卡了」。
    const todayCache = { value: null, inFlight: null, at: 0, tried: false, ttl: 55000, retries: 0, settled: false };
    const todayListeners = new Set();
    function notifyToday() {
      // ⚠️ 逐个订阅者隔离（2026-10-31 全量审查）。任何一个订阅者抛错都不能
      //  ① 中断后面的订阅者，② 把异常抛回调用方 —— 有好几处 emit 落在 try 之外，
      //  抛出去就是 unhandled rejection，界面上表现为「刷新一次就再也不更新了」。
      for (const listener of todayListeners) {
        try {
          listener();
        } catch {
          // 单个订阅者异常不影响其他订阅者，也不影响本次数据更新
        }
      }
    }
    /** 拉一次今日消耗。失败/未支持时保持 null（meta 行只显示时段与剩余时间）。
     *
     *  服务端现在是「快照优先」：冷启动直接返回上次落盘的结果（todayPartial=true），
     *  重算在后台跑。所以拿到 partial 时不能按 55 秒压住缓存 —— 3 秒后补拉一次
     *  把后台算完的新值取回来；连补 3 次还是 partial 就放弃，等下一轮正常刷新。 */
    function fetchTodayOnce(force) {
      if (!force && Date.now() - todayCache.at < todayCache.ttl) return Promise.resolve(todayCache.value);
      if (todayCache.inFlight !== null) return todayCache.inFlight;
      todayCache.inFlight = (async () => {
        try {
          const res = await fetch("/balance-api?today=1", { headers: { accept: "application/json" } });
          if (!res.ok) return todayCache.value;
          const data = await res.json();
          if (data && typeof data.today === "object" && data.today !== null) {
            todayCache.value = data.today;
            todayCache.at = Date.now();
            const partial = data.todayPartial === true && todayCache.retries < 3;
            todayCache.ttl = partial ? 3000 : 20000;
            // 「首屏数据是否已经定型」：partial 是**同一次计算的分阶段**（先给快照、
            // 后台算完再补），不是真的有新消耗。定型前所有值变化都只换基准、不播滚动，
            // 否则会先按快照揭幕、3 秒后又被补拉的数顶上去 → 用户看到「刚加载完就动」
            // （2026-10-31 反馈）。`partial` 已经含 `retries < 3`，所以重试用尽时
            // `partial` 为 false，同样会走到定型，不会永远不滚。
            if (!partial) todayCache.settled = true;
            notifyToday();
            if (partial) {
              todayCache.retries += 1;
              // 单飞标志要等 finally 才清，所以排到下一轮再拉
              setTimeout(() => { void fetchTodayOnce(true); }, 3200);
            } else {
              todayCache.retries = 0;
            }
          }
        } catch {
          // 静默：今日消耗拿不到就不显示，不影响余额
        } finally {
          todayCache.inFlight = null;
          // 只在「问过但没拿到」时才需要通知：成功路径上面已经 notify 过了。
          // 这样失败时会撤掉等待态，不会永久留一条空行。
          if (!todayCache.tried) {
            todayCache.tried = true;
            if (todayCache.value === null) notifyToday();
          }
          // 兜底定型：请求失败（异常 / 非 200）时不会走到成功分支，若不在这里置位，
          // 等待态会永远挂着（`todayWaiting` 依赖 settled）。宁可显示「暂无」也不永远转圈。
          if (!todayCache.settled && todayCache.value === null) {
            todayCache.settled = true;
            notifyToday();
          }
        }
        return todayCache.value;
      })();
      return todayCache.inFlight;
    }
    // 「今日」金额不和插件一起加载：插件本体（余额行 / 指针 / 色带）先渲染出来，
    // **等余额真的到位**之后才去问今日（用户 2026-10-31：打开 DSH 时先加载插件，
    // 加载完再加载今日消耗）。
    // 为什么必须错开：服务端算「今日」要读会话持久化文件，本机实测单个 35 MB 会话
    // 解压 723 ms，和余额请求撞在一起时首屏就要等它；错开之后余额先到，界面立刻有内容。
    /** 余额到位之后隔多久去问今日。
     *  要足够长，让余额那行的入场动画（约 520ms）彻底走完再发请求 ——
     *  服务端算今日是同步解压，和入场动画叠在一起会掉帧
     *  （用户 2026-10-31：「启动时插件加载动画还是有概率掉帧」）。
     *  之前的 240ms 正好撞在动画中段，所以只是"有概率"不是必现。 */
    const TODAY_AFTER_BALANCE_MS = 560;
    /** 余额迟迟不回来时的兜底上限 —— 不能因为余额失败就让今日永远不加载。 */
    const TODAY_WAIT_BALANCE_MAX_MS = 2000;
    // 本会话消耗的发出延迟。**只是让首帧先画出来，不是"错峰"** ——
    // 发 fetch 不耗 CPU，真正贵的是服务端解压（同步 CPU，35 MB 会话单次 723 ms）。
    // 曾经是 600ms，用户 2026-10-31 直接问「为什么本对话消耗加载这么慢」：
    // 那 600ms 纯属空等，把同一件迟早要做的事往后推了半秒。
    const SESSION_USAGE_DELAY_MS = 80;

    /** 「今日」金额的显示精度：数额越小位数越多，大了就逐级省略。
     *  用户 2026-10-31：如果数额小可以显示到小数点后 4 位，越大就相应省略一位。
     *  固定两位时小额永远是 ¥0.00（看不到变化），大额又显得啰嗦。 */
    function todayDecimals(value) {
      const v = Math.abs(Number(value));
      if (!Number.isFinite(v)) return 2;
      if (v < 1) return 4;
      if (v < 10) return 3;
      if (v < 100) return 2;
      if (v < 1000) return 1;
      return 0;
    }

    function useToday() {
      const [, force] = react.useState(0);
      react.useEffect(() => {
        const listener = () => force((n) => n + 1);
        todayListeners.add(listener);
        // 已经拿到过值（切会话重新挂载）就直接补拉，不必再等
        if (todayCache.value !== null) {
          if (Date.now() - todayCache.at >= todayCache.ttl) void fetchTodayOnce(false);
        } else {
          // 用户 2026-10-31：打开 DSH 时先加载插件本体，加载完再加载今日消耗。
          // 原来是无条件等 1.2 秒 —— 那只是"错开"不是"排在后面"：余额慢的时候
          // 今日照样会按自己的表出发。现在等 balanceCache 真正有结果（余额到位、
          // 侧栏已经有内容）之后再隔一小段才问今日，顺序上永远排在余额后面。
          let cancelled = false;
          let timer = null;
          let poll = null;
          const startedAt = Date.now();
          const fire = () => {
            if (cancelled) return;
            timer = setTimeout(() => { void fetchTodayOnce(false); }, TODAY_AFTER_BALANCE_MS);
          };
          const waitBalance = () => {
            if (cancelled) return;
            const balanceReady = balanceCache.status !== "loading" || balanceCache.balance !== null;
            // 兜底：余额一直回不来（未登录、断网）时也不能让今日永远不来
            if (balanceReady || Date.now() - startedAt >= TODAY_WAIT_BALANCE_MAX_MS) {
              fire();
              return;
            }
            poll = setTimeout(waitBalance, 120);
          };
          waitBalance();
          return () => {
            cancelled = true;
            if (timer !== null) clearTimeout(timer);
            if (poll !== null) clearTimeout(poll);
            todayListeners.delete(listener);
          };
        }
        return () => todayListeners.delete(listener);
      }, []);
      return todayCache.value;
    }

    // ─── 余额数据：模块级共享缓存 + 轮询（间隔取自 refreshIntervalSec） ────
    // 切换会话时 header 组件会重新挂载，若每个实例各自拉取会先消失再出现（闪烁）；
    // 缓存全局存一份，任何实例挂载都直接读缓存，无需重新请求。
    let balanceCache = { status: "loading", balance: null, error: null, refreshing: false };
    let balancePollTimer = null;
    const balanceListeners = new Set();

    function emitBalance() {
      // 逐个订阅者隔离：任一订阅者抛错不得中断其他订阅者，也不得抛回调用方。
      // emitBalance 有多处调用点在 try 之外（如设置热更新、轮询回调），
      // 抛出去就是 unhandled rejection —— 症状是「某次刷新之后再也没反应」。
      for (const listener of balanceListeners) {
        try {
          listener();
        } catch {
          // 单个订阅者异常不影响其他订阅者
        }
      }
    }

    // ── 收起态标记（2026-10-31：「隐藏矩形 直接显示在红圈位置 跟显示模型的一样」）──
    // 收起窄屏时**不再浮一块矩形卡片**，改成在 composer 输入框内部（红圈那行）显示一行
    // 余额文本，排版语言对齐 DSH 原生的模型名：小字号、次要色、单行、不抢焦点。
    // 「收起还是展开」是 DSH 根据窗口宽度传给 slot 的 wide，只有 BalanceFooter 拿得到，
    // 而渲染那行文本的组件挂在另一个 slot（composer.bar）里 —— 所以用模块级标记 + 订阅
    // 把这一个布尔值传过去。不用 React context：两个 slot 是各自独立的渲染根。
    

    // 防抖/防并发：同一时刻只允许一个余额请求；两次刷新间隔不小于 800ms。
    // 疯狂右键/轮询/对话刷新并发时自动合并，避免打爆 DeepSeek API。
    let balanceFetchInFlight = false;
    let lastBalanceFetchAt = 0;
    const BALANCE_REFRESH_MIN_INTERVAL = 800;

    async function fetchBalanceOnce(force) {
      const now = Date.now();
      // force = 右键手动刷新。**手动必须绕过 800ms 节流**：那个节流是给自动轮询去重的，
      // 用户亲手点了一下却被"距上次不足 800ms"静默丢掉，看到的就还是上一次的值 ——
      // 2026-10-31「余额不一致」里有一部分就是这个（官方 7.36、插件停在前一次的 7.37）。
      // 防连点交给 onBalanceContextMenu 里的 manualRefreshLockedUntil（580ms 动效锁）。
      if (balanceFetchInFlight || (!force && now - lastBalanceFetchAt < BALANCE_REFRESH_MIN_INTERVAL)) {
        // 这次压根没发出请求：手动标记必须一起清掉，否则它会残留到下一次自动刷新，
        // 把自动更新的响应也标成"手动"——那正是「自动更新不滚动」的成因之一。
        manualFetchPending = false;
        return;
      }
      // 消费标记：这一次响应是不是右键触发的。跟着响应一起进 balanceCache，
      // 渲染层据此决定走「擦除」（手动）还是「滚动」（自动），不再靠时间窗猜。
      // 用户 2026-10-31：「手动更新时擦除样式的 然后滚动就不要了 分清楚了」。
      const manual = manualFetchPending;
      manualFetchPending = false;
      lastBalanceFetchAt = now;
      balanceFetchInFlight = true;
      try {
        const data = await fetchBalanceData();
        balanceCache = { status: "ready", balance: data.balance, error: null, refreshing: false, manual };
      } catch (error) {
        // ⚠️ 失败时**保留上一次成功拿到的数字**（2026-10-31 全量审查）。
        // 原来这里写 `balance: null`，等于「一次网络抖动就把已知余额清空」：
        // 派生计算（低余额判定、剩余天数、提示文案）在 error 帧全部拿到 null，
        // 恢复之后还得重新等一轮轮询才有数。`status: "error"` 已经足够表达「这次没拿到」，
        // 不需要再用抹掉数据来表达。**渲染层照旧先判 `status === "error"` 显示失败文案**，
        // 所以可见行为零变化 —— 这里只是不再丢数据。
        const previousBalance = balanceCache.balance;
        balanceCache = {
          status: "error",
          balance: previousBalance,
          error: error && error.message ? error.message : String(error),
          refreshing: false,
          manual: false,
        };
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
      // ⚠️ 跨模块实例的单例（2026-10-31 第二十二轮审计）：插件热重载会换一份 client.js，
      // 旧实例的 interval 没人清，于是每 60 秒打两次 /balance-api（一次 419ms 的真查询）。
      if (globalThis.__balancePollTimer !== null && globalThis.__balancePollTimer !== undefined) {
        clearInterval(globalThis.__balancePollTimer);
        globalThis.__balancePollTimer = null;
      }
      balancePollIntervalSec = sec;
      fetchBalanceOnce();
      const tick = () => {
        // 没有任何界面在听（组件全卸载）就别再打官方接口；顺手把定时器收掉
        if (balanceListeners.size === 0) {
          if (balancePollTimer !== null) clearInterval(balancePollTimer);
          balancePollTimer = null;
          globalThis.__balancePollTimer = null;
          return;
        }
        fetchBalanceOnce();
      };
      balancePollTimer = setInterval(tick, sec * 1000);
      globalThis.__balancePollTimer = balancePollTimer;
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
    // 浪潮计数器：右键时自增，余额行把它当 key 用，key 变 → 波浪层重挂 → 动画从头播。
    // 之所以不用 animation 的重播属性，是因为 key 重挂最稳，且能保证连点每次都重新触发。
    let waveSeq = 0;
    const waveListeners = new Set();
    // 水波中心：右键点在元素内的局部坐标（{x,y}，px）。
    // 收起态的涟漪以它为圆心向外扩散（2026-10-31：「鼠标点击的对应区域为波浪中心 向外扩张」）。
    // 放在模块级而不是 state 里，是因为 emitWave 是被 sync 调用的、拿不到组件闭包；
    // 组件在 listener 里把它抄进 state 再渲染。展开态用不到，值留着不碍事。
    let waveOriginPoint = null;
    function emitWave(point) {
      if (point) waveOriginPoint = point;
      // 逐个订阅者隔离（同 emitBalance 的理由）。右键刷新走这条，
      // 订阅者抛错不能让白光停在半路。
      for (const listener of waveListeners) {
        try {
          listener();
        } catch {
          // 单个订阅者异常不影响其他订阅者
        }
      }
    }

    // 「下一次余额请求是不是右键触发的」。`onBalanceContextMenu` 置位，`fetchBalanceOnce`
    // 消费并写进 `balanceCache.manual`，渲染层据此二选一：手动→擦除，自动→滚动。
    // **不要退回时间窗判断**（曾经用一个 4000ms 的时间戳窗口）：窗口短了，右键那次请求
    // 稍慢就被判成自动（该擦却滚了）；窗口长了，会把紧随其后的自动轮询吞进来（该滚却擦）。
    // 用户 2026-10-31：「手动更新时擦除样式的 然后滚动就不要了 分清楚了」。
    let manualFetchPending = false;

    // 网页搜索 / 抓取：官方 2026-10-17 上线独立计费，¥5 / 千次 = ¥0.005 / 次，
    // 北京时间 2026-11-01 00:00 起开始收费（此前免费）。与 lib/index.js 同名常量保持一致。
    const WEB_TOOL_BILLING_START = Date.parse("2026-11-01T00:00:00+08:00");
    // 动效时长：**两态各算各的**（2026-10-31：「收起是收起 展开是展开 动画播放完了
    // 我还不能刷新」）。原来两态共用一个 900（取最大值），展开态白光只有 580ms，
    // 播完之后还要再被锁 320ms —— 用户点下去毫无反应，像卡住了。
    // 收起态：矩形卡的水波 balance-ripple，单圈 900ms。
    // 展开态：余额行的白光 balance-wipe-head，580ms。
    // ⚠️ 改任何一边的 CSS 时长，这里必须同步，否则锁和动画对不上（短了会打断重播，
    // 长了就是"点了没反应"）。
    const WAVE_DURATION_RECT_MS = 700;
    const WAVE_DURATION_STACKED_MS = 580;
    // 动效播放中的排他锁：这段时间内的右键一律忽略。
    // 目的是保证「一次抹除 = 一次真实刷新」，既不出现"白条扫完余额没动"，
    // 也不出现"余额变了但动效没播/播了一半被打断"（2026-10-30 反馈）。
    let manualRefreshLockedUntil = 0;

    function waveLockDuration(element) {
      // 恒等于**当前这一态**的动画时长。刻意**不**跟随 prefers-reduced-motion ——
      // 水波/白条是本插件的签名动效，系统开了「减少动态效果」也照播（用户明确要求）。
      // 靠 classList 认收起态（.balance-fab--rect）而不是读设置：
      // 收起/展开是布局宽度决定的，不是 footerStyle 设置项。
      const list = element && element.classList;
      const isRect = !!list && typeof list.contains === "function" && list.contains("balance-fab--rect");
      return isRect ? WAVE_DURATION_RECT_MS : WAVE_DURATION_STACKED_MS;
    }

    function onBalanceContextMenu(event) {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      const now = Date.now();
      // 浪潮特效只在 timeline 版且没关时才播。关掉动效就没有可播的东西，
      // 下面两条限制一并取消，回到原来纯 800ms 防抖的行为。
      const waveOn = settingsCache.value.refreshWave !== false;
      // ① 动效还没播完：整次右键作废（不动效、不刷新余额），等它播完再让下一次进来。
      //    锁按时长**分态**算，读的是被点元素自己的 class —— 展开态只锁 580ms，
      //    不会被收起态的 900ms 拖着（2026-10-31：「动画播放完了 我还不能刷新」）。
      if (waveOn && now < manualRefreshLockedUntil) return;
      // ② 这次点击是否真的会发出请求。手动刷新**不受 800ms 节流限制**（那个节流是给
      //    自动轮询去重的），只防重入 —— 否则刚自动刷过 800ms 内点右键会被静默丢掉，
      //    界面停在上一次的值，看着就是「和官网不一致」。
      const willFetch = !balanceFetchInFlight;
      // ③ 会被 800ms 防抖吃掉、根本不会刷新的点击，连动效也不播。
      //    否则白条扫了一遍而余额纹丝不动，看起来像"动了但没扣费"。
      if (waveOn && !willFetch) return;
      if (waveOn) {
        manualRefreshLockedUntil = now + waveLockDuration(event && event.currentTarget);
        // 白光（.balance-footer__wave）每次右键都要扫 —— 用户 2026-10-31 明确
        // 「你别把白光删了」。它是「你点了，我扫一遍」的即时反馈，跟数值变没变无关。
        waveSeq += 1;
        // 记下点击点（相对被点元素的局部坐标），收起态拿它当水波圆心。
        // 拿不到 layout 信息时传 null，渲染层会退回卡片中心。
        let point = null;
        const el = event && event.currentTarget;
        if (el && typeof el.getBoundingClientRect === "function" && typeof event.clientX === "number") {
          const rect = el.getBoundingClientRect();
          point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        }
        emitWave(point);
      }
      // 标记「接下来这次余额请求是右键触发的」—— `fetchBalanceOnce` 会把它塞进响应，
      // 渲染层据此决定数字走**擦除**（手动）还是**滚动**（自动）。精确到请求，不靠时间窗猜。
      if (willFetch) manualFetchPending = true;
      // 白条是"你点了，我扫一遍"的即时反馈；轮询/对话触发的自动刷新不扫光，
      // 改用数字上下滚动（见 BalanceFooter 里的 roll）。
      if (willFetch && !balanceCache.refreshing) {
        balanceCache = { ...balanceCache, refreshing: true };
        emitBalance();
      }
      fetchBalanceOnce(true);
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
      // ⚠️ 兜底必须是**稳定引用**（2026-10-31 全量审查）。
      // 原来兜底成空数组字面量，stats 缺 days 时每次渲染都生成新引用，
      // 作为 useMemo 依赖就等于「依赖永远在变」—— 下面 heatmap / derived 的 memo 全部作废，
      // 白算一遍还是一样慢。改成模块级冻结常量。
      const days = stats && Array.isArray(stats.days) ? stats.days : EMPTY_ARRAY;
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
          // 网页搜索 / 抓取：按次计费，不计入峰谷
          webSearchCalls: num(t.webSearchCalls),
          webFetchCalls: num(t.webFetchCalls),
          webSearchBillable: num(t.webSearchBillable),
          webFetchBillable: num(t.webFetchBillable),
          webToolCost: num(t.webToolCost),
        };
      }, [days, total]);
      const webBillingStarted = Date.now() >= WEB_TOOL_BILLING_START;
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
                    derived.webSearchCalls + derived.webFetchCalls > 0
                      ? jsx.jsxs(StatsGroup, {
                          index: 3,
                          title: "网页工具",
                          hint: webBillingStarted ? "¥5 / 千次" : "免费期内",
                          children: [
                            jsx.jsx(StatsRow, {
                              name: "Search / Fetch",
                              value: derived.webSearchCalls + " / " + derived.webFetchCalls + " 次",
                            }),
                            jsx.jsx(StatsRow, {
                              name: "网页工具费用",
                              value: webBillingStarted
                                ? fmtCost(derived.webToolCost) + " · 计费 " + (derived.webSearchBillable + derived.webFetchBillable) + " 次"
                                : "免费期内 · 11-01 起按 ¥5 / 千次计费",
                            }),
                          ],
                        })
                      : null,
                    jsx.jsxs(StatsGroup, {
                      index: 4,
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
                      index: 5,
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
                        // 上限必须读用户实际设置（`statsSessionLimit` 默认 80），
                        // 原来硬编码「最近 200 个」—— 那是今日扫描上限，扫的是两件事，
                        // 文案长期在骗人（2026-10-31 全量审查）。
                        (stats?.limited
                          ? "（为保证性能仅取最近 " + String(settingsCache.value?.statsSessionLimit ?? 80) + " 个）"
                          : "") +
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
          heatmapTooltip ? createPortal(jsx.jsx("div", {
            className: "balance-heatmap-tooltip balance-heatmap-tooltip--" + heatmapTooltip.align,
            style: heatmapTooltip.style,
            role: "tooltip",
            children: heatmapTooltip.label,
          }), document.body) : null,
        ],
      });
    }

    // ─── 旧版余额行用的钱包图标（footerStyle === "classic" 时才渲染） ──────
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
// 指针入场动画：从刻度 0 滑到当前时刻，只在页面生命周期的第一次挂载播一次。
// ⚠️ **不要用「模块加载时刻 + 时间窗口」判断**（试过，不行）：client 模块在页面启动早期就加载了，
//   而侧栏组件要等首屏渲染 + 会话恢复完才挂载，中间经常超过好几秒，于是动画被判定成"过期"、
//   指针直接落在终点 —— 用户看到的就是「当前不是从 0 开始的」（2026-10-30 第四次现场反馈）。
// 正确做法：用「是否已经播完过一次」的标记，播完才置位。挂载被中断 / StrictMode 双跑都能补播。
// POINTER_INTRO_MAX_AGE_MS 只是兜底上限，防止挂载后很久才展开侧栏又莫名滑一次。
const POINTER_INTRO_MAX_AGE_MS = 30000;
const PLUGIN_LOADED_AT = Date.now();
let pointerIntroDone = false;

// 时间轴指针：一根 2px 竖条，位置 = 此刻在当天的百分比。
//
// ⚠️ 四件事必须守住：
// 1) 位置由 **React state 渲染**（inline style），不是 ref 里手写 style.left ——
//    在 DSH 里 ref 拿不到 DOM，指针会永远停在 0%（2026-10-30 两次现场反馈）。
// 2) **不要用 requestAnimationFrame**：DSH 渲染进程里它会被窗口可见性挂起。
// 3) 它必须**独立成一个组件**：补间每拍都 setState，挂在 BalanceFooter 里会带着
//    余额行、时间轴、胶囊全部重渲染 —— 一次入场动画要重渲上百次整块 footer，
//    桌面版启动首屏本来就忙，那就是用户看到的「掉帧 / 初始化很卡」。
// 4) 稳态**不要**跑逐帧定时器：指针每分钟才动 0.069%（约 0.14px），按分钟对齐一次就够。
//    旧版稳态也跑 16ms 定时器，等于页面开着就一直 62Hz 唤醒，纯浪费。
function TimelinePointer() {
  // 入场动画 = 一条 CSS animation，React 全程只渲染 2 次（挂载一次、摘类一次）。
  //
  // ⚠️ 三条历史教训，都别再退回去：
  //   1) 逐帧 setState（16ms × 37 拍）会在重启 DSH 的首屏高峰上抢主线程 → 掉帧。
  //   2) 用 CSS transition + 延后一拍设终点，**有时候动画会被吞**：transition 的起点取
  //      「上一次样式计算的值」，而首屏繁忙时浏览器可能还没为这个元素算过样式，
  //      那次变更就被当成首次赋值，直接跳到终点、一帧都不播（2026-10-30 反馈「有时候重启时指针动画会吞掉」）。
  //   3) 所以现在用 animation：keyframes 里有**显式的 from/to**，不依赖上一次计算值。
  //      元素一插入就带着动画，opacity/left 从 3px 补到终点，浏览器时间线怎么排都不会漏播；
  //      首屏忙时它只会晚一点开始，但一定播完整。
  const [view, setView] = react.useState(() => {
    const expired = Date.now() - PLUGIN_LOADED_AT > POINTER_INTRO_MAX_AGE_MS;
    return { pct: pointerPercent(Date.now()), intro: !pointerIntroDone && !expired };
  });
  react.useEffect(() => {
    const expired = Date.now() - PLUGIN_LOADED_AT > POINTER_INTRO_MAX_AGE_MS;
    const intro = !pointerIntroDone && !expired;
    // 与刷新白条（CSS 里 balance-wipe-head 的 .58s）同一个时长、同一条曲线，
    // 两者在同一次渲染里插入，动画时钟同起同落。
    const INTRO_MS = 580;
    const IDLE_MS = 60000;
    let introTimer = 0;
    let idleTimer = 0;
    const idleIn = (now) => IDLE_MS - (now % IDLE_MS) + 30;
    const scheduleIdle = () => {
      idleTimer = setTimeout(tick, idleIn(Date.now()));
    };
    function tick() {
      // 稳态：不带动画直接落位（每分钟才动 0.069%，跳过去看不出来），
      // 下一拍对齐到下一个整分钟。跨零点也走这里，不会反向滑回去。
      setView({ pct: pointerPercent(Date.now()), intro: false });
      scheduleIdle();
    }
    if (intro) {
      introTimer = setTimeout(() => {
        // 到站：置位标记（之后的重挂载不再重播），并摘掉动画类。
        // animation 是 both，摘类前后都在终点，不会跳。
        pointerIntroDone = true;
        setView((v) => ({ pct: v.pct, intro: false }));
        scheduleIdle();
      }, INTRO_MS + 40);
    } else {
      scheduleIdle();
    }
    return () => {
      clearTimeout(introTimer);
      clearTimeout(idleTimer);
    };
    // 依赖故意为空：只在挂载时读一次初值，之后由 CSS animation + 分钟对齐自己跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 刻度两端各留 3px 余量：指针 2px 宽、margin-left 让它以 left 为中心线，直接贴 0%/100%
  // 会有一半被父级 overflow 裁掉，看着就像指针跑到轨道外面去了。
  // 把 [0,100] 线性压进 [3px, 100% - 3px]：中心线 = inset + (p/100) × (宽 - 2 × inset)，
  // 展开成 calc 就是「p% + inset px - (p/100) × 2 × inset px」。
  const pct = view.pct;
  const inset = 3;
  const shift = inset - (pct / 100) * 2 * inset;
  const pos = "calc(" + pct.toFixed(4) + "% + " + shift.toFixed(2) + "px)";
  return jsx.jsx("span", {
    className: view.intro ? "balance-footer__timeline-pointer balance-footer__timeline-pointer--intro" : "balance-footer__timeline-pointer",
    // left 给稳态用；--balance-ptr-to 是 keyframes 的终点（两者取值相同）。
    style: { left: pos, "--balance-ptr-to": pos },
  });
}

// 色带分布变化时的交叉淡入（2026-10-30 加，用户「如果第二天的时段分布不一样 时刻条里的颜色分布我需要有渐变动画」）。
//
// 色带是一条 linear-gradient，而 background-image 在 CSS 里 **不可插值** —— 直接换 gradient
// 永远是硬切：周五 → 周六（整条从「红绿相间」变成「通体绿」）会啪一下换掉，很扎眼。
// 所以做两层交叉淡入：新的那条从 opacity 0 淡到本该有的不透明度，盖住旧的那条，
// 播完把旧层摘掉。视觉上就是颜色分布自己慢慢挪过去。
//
// 触发时机只有两个，都不会天天发生：
//   1) 跨零点 —— 第二天的分布不同（工作日 ↔ 周末、节前 ↔ 假期）；
//   2) 节假日表刚同步完，把当天的口径纠正了。
// 没有定时器：只跟着传入的 gradient 字符串变化走，一天最多一次。
//
// 首挂不播（seq === 0 时不挂动画类）—— 色带不该有自己的入场动画，那会让首屏又多一份动效。
const BAND_FADE_MS = 620;
function TimelineBand(props) {
  const gradient = props.gradient;
  const [view, setView] = react.useState(() => ({ now: gradient, prev: null, seq: 0 }));
  // 分布变了：把当前这条降级成 prev（留在下面），新的那条顶上来并 +1 换 key。
  // key 变了才是新元素，CSS animation 才会重新播。
  react.useEffect(() => {
    setView((v) => (v.now === gradient ? v : { now: gradient, prev: v.now, seq: v.seq + 1 }));
  }, [gradient]);
  // 淡入播完再摘掉旧层，防止 prev 一天天堆下去。
  react.useEffect(() => {
    if (!view.prev) return;
    const timer = setTimeout(() => {
      setView((v) => (v.prev ? { now: v.now, prev: null, seq: v.seq } : v));
    }, BAND_FADE_MS + 80);
    return () => clearTimeout(timer);
  }, [view.prev, view.seq]);
  // seq === 0 是首挂，不带动画类；之后每一层都带，靠 key 变化重新起播。
  const fadeCls = view.seq > 0 ? " balance-footer__timeline-fade" : "";
  // --balance-band-to 是 keyframes 的终点 opacity：色带本体 1、泛光层保持原本的 .45，
  // 否则泛光会被动画拉成实心（它静态就是半透明的）。
  const layer = (cls, bg, to, key) => jsx.jsx("span", {
    className: cls + fadeCls,
    style: { background: bg, "--balance-band-to": to },
  }, key);
  const layers = [];
  if (view.prev) {
    layers.push(jsx.jsx("span", { className: "balance-footer__timeline-glow", style: { background: view.prev } }, "pg"));
    layers.push(jsx.jsx("span", { className: "balance-footer__timeline-band", style: { background: view.prev } }, "pb"));
  }
  layers.push(layer("balance-footer__timeline-glow", view.now, "0.45", "g" + view.seq));
  layers.push(layer("balance-footer__timeline-band", view.now, "1", "b" + view.seq));
  return jsx.jsx("span", { className: "balance-footer__timeline-clip", children: layers });
}

/* 今日等待胶囊两层光团的**起始相位**：每次挂载现取一次随机。
   为什么必须随机：两层光团的 animation-delay 原来写死 -.5s / -1.1s，于是每次重挂
   （展开侧栏 / 切会话 / 重开 DSH）第一帧都落在同一姿态，B 那团 .72 的亮芯正好被
   推到右下角 —— 用户 2026-10-31：「每次开始动画的时候 都是右下角发白」。
   而且挂载→出值→擦出 这条时序本身是确定的（余额就绪后 +560ms 发请求、约 400ms 回），
   所以连擦出那一瞬间的光团相位每次也基本一致，两次录像截出来能一模一样。
   取随机相位后整条时序被去同步，各次不再复读。
   ⚠️ 必须用 useState 的初始化函数取值 —— 每次挂载算一次。放在渲染体里直接
   Math.random() 会让每次余额轮询重渲染都换一次相位，光团原地乱跳。 */
const TODAY_FLOW_PERIOD_A_MS = 1400;
const TODAY_FLOW_PERIOD_B_MS = 2200;
function makeTodayFlowStyle() {
  // 只在周期的 20%~80% 里取：两端是 ease-in-out 速度趋 0 的位置，
  // 落在那里会重演「刚加载出来看着没在动」。
  const fracA = 0.2 + Math.random() * 0.6;
  const fracB = 0.2 + Math.random() * 0.6;
  return {
    "--today-flow-a": "-" + (fracA * TODAY_FLOW_PERIOD_A_MS / 1000).toFixed(3) + "s",
    "--today-flow-b": "-" + (fracB * TODAY_FLOW_PERIOD_B_MS / 1000).toFixed(3) + "s",
  };
}

    function BalanceFooter({ wide }) {
      const state = useBalance();
      const settings = useSettings();
      const today = useToday();
      // ⚠️⚠️ 今日金额的派生值与 hook 必须待在这一片（所有 return 之前）。
      // 组件下半部分有多条早退分支：state.status === "error" / !state.balance / depleted，
      // 首帧 balance 还是 null 就走 2778 那条 return；等数据回来那一帧才继续往下执行。
      // 一旦把 hook 放在早退之后，两次渲染的 hook 数量就不同 —— React 抛
      // "Rendered more hooks than during the previous render"，整个余额行崩溃，
      // 错误边界一兜，左下角就空了（2026-10-31 用户反馈「左下角的显示消失了」）。
      // 记牢：BalanceFooter 里新增的任何 hook 都只能加在这一片。
      const todayCost = today !== null && Number.isFinite(Number(today.cost)) ? Number(today.cost) : null;
      // 显示精度随额度分档（<1 → 4 位 … ≥1000 → 0 位），见 todayDecimals。
      const todayText = todayCost === null ? null : todayCost.toFixed(todayDecimals(todayCost));
      const [todayRoll, setTodayRoll] = react.useState(null);
      // 今日等待胶囊的光团起始相位：**每次挂载随机一次**（见 makeTodayFlowStyle 的注释）。
      // 不能用 useRef 装 —— 那样每次渲染都会重新算；useState 的初始化函数只跑一次。
      const [todayFlowStyle] = react.useState(makeTodayFlowStyle);
      const lastTodayTextRef = react.useRef(null);
      usePrePaintEffect(() => {
        const prev = lastTodayTextRef.current;
        lastTodayTextRef.current = todayText;
        // 从等待态第一次拿到真实值：这是「首次出场」，走 CSS 入场动画（--enter），
        // 不进滚动分支 —— 滚格子前 40% 是全透明的，从空白升起时看着就是硬切。
        if (todayText === null || prev === null) return;
        if (prev === todayText) return;
        // 首屏数据还没定型（`?today=1` 的 partial 补拉阶段）：这里的变化是「同一次计算
        // 算完了」，不是有新消耗，只换基准、不播滚动。否则会先按快照揭幕、3 秒后补拉
        // 的数顶上来时再滚一次 —— 用户看到的就是「刚加载完今日消耗，下一秒就动了」
        // （2026-10-31 反馈）。定型之后（settled）所有变化照常滚动。
        if (!todayCache.settled) return;
        setTodayRoll({ from: prev, to: todayText, at: Date.now() });
      }, [todayText]);
      // 值变成 null（今日数据没了）时清空，避免拿旧基准继续滚。
      react.useEffect(() => {
        if (todayText === null) setTodayRoll(null);
      }, [todayText]);
      // 滚完定格：摘掉 animation 声明，展开侧栏不再重播
      useRollSettle(todayRoll, setTodayRoll);

      // 入场动画只播一次：拿到值后 300ms 摘掉 --enter（CSS 时长 260ms + 40ms 余量）。
      // 不摘的话每次 todayRoll 结束回到静态分支都会重播一遍。
      // ⚠️ 这个时刻同时决定**底层加载动画（mist）什么时候卸载** —— 揭幕期间它盖在数字上面，
      // 只露出没扫到的区域（用户 2026-10-31 要求）。卸载必须紧跟动画结束：早了会在
      // 数字还没铺满时露出空白，晚了则数字已完全盖住、mist 还会多挡 100ms（能看出来）。
      // ⚠️ 260ms 是 2026-10-31 定的（460 → 340 → 260，两轮「快一点」+「擦除的速度有点慢」）。
      // **不要顺手把这个 300 和下面 label 位移的 .46s 一起改** —— 那个是「今日」二字
      // 跟着金额宽度变化滑动用的过渡，和揭幕是两件事，它的时长另有标定理由。
      // 余额行「从下往上擦出」——加载态已经不渲染任何东西了（原来那行「余额加载中…」
      // 和余额胶囊高度不同，叠上今日消耗后整块高度对不齐），所以值到达时用这条遮罩
      // 从底部往上扫一遍：没扫到的区域不显示，和今日揭幕同一套擦除机制，只是方向换成正交。
      //
      // ⚠️ **标记必须在初始化时就写**（2026-10-31 第五轮）。原来是在 380ms 的定时器里
      // 写 globalThis，而那个定时器会被 effect cleanup 清掉 —— 只要你在这几百毫秒内
      // 折叠/展开一次，标记就永远设不上，下次挂载又是「首次」→ 再播一遍。
      // 用户反复看到「展开一瞬间数字又跳」，根子就在这里。
      // 现在改成：初始化时若还没播过，就**当场**把标记写成 true，再由本次挂载播一次。
      // 定时器只负责收尾（把 --enter 摘掉），即使被取消，标记也已经落定。
      // 启动入场动画：DSH 启动 / 插件重载 / 页面刷新时，余额第一次出现从下往上擦出
      // （用户 2026-10-31 原话：「添加一个从下到上的动画跟浪潮一样 滑动上去
      // 没滑到的地方不显示 一样的擦除机制」）。
      //
      // 授权只问 animOnce 一次，**不再依赖任何定时器**：
      //   · 首次挂载 → true → 挂 --enter-up → 播一次
      //   · 任何一次重挂（折叠/展开侧栏都会重挂）→ false → 类根本不挂 → 播不了
      //   · 页面刷新 / 插件重载 → 模块重新求值、台账清空 → 又能播一次（这是想要的）
      // 定时器只负责「播完把类摘掉」，即使被 cleanup 取消也无所谓 —— 授权已经落定，
      // 下一轮挂载本来就是 false。
      const [enterUp, setEnterUp] = react.useState(() => animOnce("footer-enter"));
      react.useEffect(() => {
        if (!enterUp) return;
        // 等余额真的到了再起算（余额是纯网络，实测 419ms；从这里计时才不会
        // 出现「计时走完、数字才到」导致动画根本没播的情况）
        if (!state.balance) return;
        // 340ms 动画 + 40ms 余量
        const id = setTimeout(() => setEnterUp(false), 380);
        return () => clearTimeout(id);
      }, [enterUp, state.balance]);
      // 四个渲染分支共用，漏一处就会有一条路径不播动画。
      const footerEnterClass = enterUp ? " balance-footer--enter-up" : "";

      // ── 唯一的「展开兜底」（2026-10-31 方案 3）──────────────────────────────
      // DSH 折叠侧栏时要么把 footArea 设成 display:none、要么把组件卸载，
      // 两条路都会让挂在元素上的 CSS 动画从 0 秒重播。所以这里只有一件事：
      // 重新可见时，把所有「事件驱动」的动画状态统一清零。
      // 「只许播一次」的动画（今日首播 / 余额入场）不在这里处理 —— 它们由
      // 模块级台账 animOnce 授权，重挂时读到的就是 false，压根没有动画可播。
      const clearAnimations = react.useCallback(() => {
        setRevealSeq(0);
        setWaveToken(0);
        setRoll(null);
        setTodayWipe({ seq: 0, done: true });
        setTodayRoll(null);
        setEnterUp(false);
      }, []);
      react.useEffect(() => {
        let wasHidden = false;
        const timer = setInterval(() => {
          if (typeof document === "undefined") return;
          // 窗口不可见时直接跳过：getClientRects() 会强制一次 layout，140ms 一次就是
          // 每秒 7 次无谓的整页重排（2026-10-31 全量审查）。看不见的时候没人观察动画，
          // 这里也不改 wasHidden —— 回到可见后的下一拍（≤140ms）照常判定，行为不变。
          if (document.visibilityState !== "visible") return;
          const el = document.getElementById("balance-footer-root");
          if (el === null) return;
          // getClientRects() 为空 = 祖先 display:none（或自身不可见），即「已折叠」
          const visible = el.getClientRects().length > 0;
          if (!visible) {
            wasHidden = true;
            return;
          }
          if (!wasHidden) return;
          wasHidden = false;
          clearAnimations();
        }, 140);
        return () => clearInterval(timer);
      }, [clearAnimations]);

      // 「今日揭幕已经播过」——记在**模块级**，不放组件 state。
      // 折叠/展开侧栏会让 BalanceFooter 卸载重挂，state 全部归零；而揭幕
      // （__body 上的 balance-today-num-wipe）是挂在元素上的 CSS 动画，节点一重建就从头播，
      // 用户看到的就是「点侧边栏按钮导致今日消耗数字滚一下」（2026-10-31 反馈）。
      // 今日是全局数（不分会话），所以用一个布尔就够，不需要按 sessionId 记。
      // 「今日」的擦出动画：**值变了就播，展开侧栏不播**（2026-10-31 第十轮）。
      // 之前有两版都是错的：
      //   ① 动画无条件挂在 __body 上 → 每次有值/每次重挂都播；
      //   ② 改成「整页只播一次」的布尔闸门 → 用户立刻发现「擦出动画怎么改成这样了」，
      //      因为今日数值刷新（扣费）时也再也不播了，观感退化成硬跳。
      // 现在用一个序号：todayText 每变一次 +1，序号即 key，只有它变了才重新挂载播动画。
      // 展开侧栏时序号不变 → 本来不会重播；再叠上下面的可见性清零（display:none
      // 的元素重新显示时 CSS 动画会从 0 秒重播）就彻底安全。
      // 擦出序号 + 「这次擦出播完了没有」，**必须是同一个 state**（2026-10-31 第三轮：
      // 「今日加载的动画 未扫过的区域动画不要初始化 继续播放」）。
      // 拆成两个 state 会漏出一整帧：todayText 变成值的那个 commit 里，todayWipeDone
      // 还是上一轮的 true，而雾的卸载条件（todayCost !== null && todayWipeDone）当场成立
      // → 雾被卸载；等 effect 再把 done 置 false，下一次渲染才把它重新挂上去。
      // 于是右半边（没扫到的那块）的加载动画是**全新插入的 DOM**，
      // ::before / ::after 两层 radial 光团的 CSS 动画从 0 秒重播 —— 用户看到的就是
      // 「未扫过的区域闪回初始形状」。合并成一个对象后，「新值 + 未播完」在同一次
      // setState 里一起生效，DOM 节点自始至终没离开过，动画一路接着播。
      const [todayWipe, setTodayWipe] = react.useState({ seq: 0, done: true });
      // 拆成两个局部量只是给下面所有读点（含 FAB 与各条 selftest 断言）保留原名。
      const todayWipeSeq = todayWipe.seq;
      const todayWipeDone = todayWipe.done;
      // 「这次擦出播完了没有」。它在擦出期间必须是 false —— 因为 mist（加载动画）
      // 要靠它决定何时卸载：用户 2026-10-31 明确要的效果是
      // 「只显示扫过区域的数字，没扫到的还是原来的加载动画」，
      // 也就是擦出过程中 mist 必须还在、盖住右半边；扫完才撤。
      // done 与 seq 同一个 state，见上面的注释。
      // ⚠️ 必须是 paint 之前跑的 effect（usePrePaintEffect，2026-10-31 第十六轮）。
      // 用 react.useEffect 的话它在 paint 之后才跑，于是"值到手"那一帧先被画出来是
      // done=true 的状态：雾层拿到 --clear（全透明），下一帧才翻成 --wipe 从 0% 重新盖住 ——
      // 肉眼就是「数字先闪现一帧、然后被雾盖住再扫一遍」。挪到 paint 前，这一次 commit
      // 重渲染完才出图，第一张图就是雾已经盖好的擦出首帧。
      usePrePaintEffect(() => {
        if (todayText === null) {
          animWrite("today-last", null);
          // 回到等待态 = 下一次出值要重新擦一遍。
          // 跨天归零、切会话待算、首屏还没算出来都会走到这里。
          animWrite("today-pending", true);
          return;
        }
        // ⚠️ 「上次的值」必须存在**模块级台账**里，不能用组件 ref（2026-10-31 方案 3）。
        // 折叠/展开侧栏会让 BalanceFooter 重挂、ref 归零 → 本次 effect 会误判成
        // 「值变了」→ 又擦一遍。这就是「展开会重播扣费动画」的最后一条漏网路径。
        // 台账在模块级：重挂时记得上次的值，只有真的变了才往下走。
        if (animRead("today-last") === todayText) return;
        animWrite("today-last", todayText);
        // ⚠️ 擦出的判据是「**是不是从等待态跳出来的**」，不是「是不是第一次出值」，
        // 也不是「值有没有变」。三者的区别（2026-10-31 两轮踩完）：
        //   · 只看「值变了」  → 今日是每几秒自动补拉的活数据，一次对话里会反复擦，
        //                       看起来像整块在重新加载（用户：「自动更新时会触发擦出」）。
        //   · 只看「第一次」  → 整个页面生命周期只擦一次，刷新后/跨天后/切会话后
        //                       再也看不到擦出（用户：「我的动画呢 只有加载动画」）。
        //   · 看「等待态出口」→ 每次从 null 到有值都擦一次，纯数值刷新只滚动。这才是对的。
        if (animRead("today-pending") !== true) return;
        animWrite("today-pending", false);
        // ⚠️ seq 和 done 必须**在同一次 setState 里**一起翻，这是「未扫过的区域不要
        // 初始化」的关键：分开写就会漏出「done 还是 true」的那一帧，雾被卸载又重挂。
        setTodayWipe((w) => ({ seq: w.seq + 1, done: false }));
        // ⚠️ 这里**不要**开计时器（2026-10-31 审查发现的高危 bug）。
        // 计时器原来写在这个 effect 里，cleanup 是 clearTimeout(id)。可这个 effect 的依赖是
        // todayText —— 今日是每几秒自动补拉的活数据，只要补拉在 300ms 内再来一次，
        // cleanup 就会把计时器取消，而本 effect 因为 today-pending 已经翻成 false 会直接
        // return、不再补一个新的。结果 done 永久停在 false：雾永远盖着、数字再也
        // 看不见，且不会自愈（后续任何一次刷新都走的是同一条 return 路径）。
        // 现在只负责递增序号，由下面那个依赖 todayWipeSeq 的 effect 独占计时器 ——
        // 它的 cleanup 只在下一次真的重新擦出时执行，普通数值刷新碰不到它。
      }, [todayText]);
      // 擦出的收尾：序号每变一次就重开一个 300ms 的窗口，窗口结束才摘掉雾。
      // 260ms 是 CSS 那条动画的时长，+40ms 余量；早了露空白、晚了雾多挡一截。
      react.useEffect(() => {
        if (todayWipeSeq === 0) return undefined;
        const id = setTimeout(() => setTodayWipe((w) => ({ seq: w.seq, done: true })), 300);
        return () => clearTimeout(id);
      }, [todayWipeSeq]);
      // ⚠️ 滚动结束后**不要**把 todayRoll 置回 null（用户 2026-10-31：「被滚动的数字
      // 即将滚动到位时会有变化，看着很割裂」）。动画是 forwards，420ms 播完就停在终点，
      // 清空状态会让整串从 dghost/dout/din 结构切成单个静态 dcell —— 两种结构的高度
      // 与基线有亚像素差，看着就是"到头又跳一下"。保持滚动态，节点不动，视觉连续。
      // 下一次数值变化时 effect 会把它换成新的 roll（key 换掉、动画重播）。
      // 订阅浪潮计数器：右键时递增，触发重渲染；波浪层用 waveSeq 当 key 重挂来重播动画
      // ⚠️ 白光必须由**组件内的 token** 驱动，不能用模块级的 `waveSeq` 判断（2026-10-31 第二轮）：
      // `waveSeq` 是模块级变量，重挂不归零；一旦右键刷新过或发生过消费刷新，它就永远 > 0，
      // 之后每次折叠/展开侧栏（组件重挂、DOM 重建）都会把白光从头播一遍。
      // 这就是「打开 dsh 之后没消费就没事，一旦产生消费，点收起/展开就还有这个 bug」的原因。
      // `waveToken` 初值 0 = 本次挂载还没收到过 emitWave → 不渲染白光；
      // 只有真正右键（emitWave）才 +1，节点才出现、动画才播。
      const [waveToken, setWaveToken] = react.useState(0);
      // 水波圆心（相对 FAB 的局部坐标）。null = 没收到点击位置，涟漪退回卡片中心。
      const [waveOrigin, setWaveOrigin] = react.useState(null);
      react.useEffect(() => {
        // 每次右键都同步抄一份圆心：waveOriginPoint 是模块级的，
        // 只在 emitWave 传了坐标时才更新，所以展开态右键（余额行）也会写进去，
        // 但收起态只在它自己挂载且右键时才渲染涟漪，不影响。
        const listener = () => {
          setWaveToken((n) => n + 1);
          setWaveOrigin(waveOriginPoint);
        };
        waveListeners.add(listener);
        return () => waveListeners.delete(listener);
      }, []);

      // ── 自动刷新的数字滚轮 ────────────────────────────────────────────────
      // 金额一变化就播一次：旧值向上滑出、新值从下方滑入，像翻页计数器。
      // 手动刷新（4s 内右键过）由白条负责，这里直接跳过，避免两种动效打架。
      const rollText = state.status !== "error" && state.balance
        ? String(state.balance.total_balance ?? "") + " " + (state.balance.currency || "CNY")
        : null;
      const [roll, setRoll] = react.useState(null);
      const lastRollTextRef = react.useRef(null);
      // 手动擦出时的底层内容＝「上一帧显示的值」。ref 天然滞后一帧，正好就是它。
      // 用户 2026-10-30 的原话：「没被光条扫到的区域接着显示 不要直接消失了」——
      // 所以扫过的那层（sweep）才是新内容，没扫到的部分由 base 撑着，仍是旧值。
      const revealBaseRef = react.useRef(null);
      react.useEffect(() => {
        if (rollText !== null) revealBaseRef.current = rollText;
      }, [rollText]);
      // 擦出真正的驱动源：**手动刷新 + 金额确实变了**才 +1（用户 2026-10-31：
      // 「这个扣费 bug 又出现了，手动刷新如果余额变了就变啊，没变就不要硬变」）。
      // 不能用 `"reveal-" + waveSeq` —— 那样每次右键都从 0 重播擦除，金额一模一样也照擦，
      // 看着就是"没扣费却硬变"。也不能把 totalText 塞进 key —— 自动刷新也会变 key，
      // 而自动刷新本来就该只滚不擦，两者叠加又是一种重影。
      // 是否"手动"由 `state.manual`（响应自带）决定，见下面 usePrePaintEffect。
      const [revealSeq, setRevealSeq] = react.useState(0);
      // 用 usePrePaintEffect（优先 useLayoutEffect）：必须在浏览器 paint 之前就把 roll 挂上，
      // 否则这一帧画的是纯文本新值、下一帧才变成滚动格 —— 用户看到的就是"数字比动画先播"。
      usePrePaintEffect(() => {
        const prev = lastRollTextRef.current;
        lastRollTextRef.current = rollText;
        // 归属由响应自己带：`state.manual` 是这次余额变化的来源。
        // **手动 → 只擦除、绝不滚动**；**自动 → 只滚动、绝不擦除**（用户 2026-10-31：
        // 「手动更新时擦除样式的 然后滚动就不要了 分清楚了」）。
        // 这条判据精确到请求，不再有"时间窗猜错"的可能。
        const manual = state.manual === true;
        if (rollText === null || prev === null || prev === rollText) return;
        if (manual) {
          // 手动刷新期间不滚（擦除已经给足反馈），但**必须把 roll 同步到当前值**。
          // 只 `return` 的话 `roll` 还停在上一次的 `from`，而下面渲染用
          // `buildRollCells(roll.from, rollText)` —— 旧 from 配新 rollText 是两个不同数字，
          // 动画 key（roll.at）又没换，两串数字直接叠在一起糊掉。
          setRoll({ from: rollText, to: rollText, at: Date.now() });
          // 值确实变了（上面已确认 prev !== rollText）→ 擦一次。值没变根本走不到这里。
          setRevealSeq((n) => n + 1);
          return;
        }
        setRoll({ from: prev, to: rollText, at: Date.now() });
      }, [rollText, state.manual]);

      // 逐位拆开：只在真正变了的数位上做上下滚动。实现见模块级的 buildRollCells ——
      // 「本会话消耗」用的是同一个函数，两处滚动因此逐格一致（2026-10-30 用户要求）。
      // 用「当前文本」而不是 roll.to 作终点：滚动结束后状态不再清空，若期间数值又变了
      // 但还没产生新 roll，用 roll.to 会显示上一轮的值。from 仍是上一轮起点，动画照常。
      const rollCells = roll === null ? null : buildRollCells(roll.from, rollText);
      // 同上：滚完保持滚动态，不要切回静态结构（会造成"到头跳一下"）。
      // 余额消失（未登录 / 失败）时才清空基准。
      react.useEffect(() => {
        if (rollText === null) setRoll(null);
      }, [rollText]);
      // 滚完定格：摘掉 animation 声明，展开侧栏不再重播
      useRollSettle(roll, setRoll);
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
      // 时间轴的"此刻"：每分钟推进一次（剩余时间“剩 5h40m”的分钟位需要这个节拍）。
      // 必须对齐到整分钟：若用 setInterval 从挂载时刻起算，刷新点会漂在任意秒数，
      // 且与真实时间最多错开 60 秒——在 12:00 / 14:00 / 18:00 这些峰谷边界上，
      // 会出现“标签还在空闲、剩余时间已归零”的矛盾画面。
      const [timelineNow, setTimelineNow] = react.useState(() => Date.now());
      react.useEffect(() => {
        let timer = null;
        const tick = () => {
          setTimelineNow(Date.now());
          // 距下一个整分钟的毫秒数；再自校正一次，避免 setTimeout 累计漂移
          timer = setTimeout(tick, 60000 - (Date.now() % 60000) + 30);
        };
        timer = setTimeout(tick, 60000 - (Date.now() % 60000) + 30);
        // 窗口最小化 / 切换回来时补一次：后台定时器可能被浏览器节流，回来时先对齐
        const onVisible = () => {
          if (typeof document === "undefined" || document.visibilityState !== "hidden") {
            setTimelineNow(Date.now());
          }
        };
        if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
          document.addEventListener("visibilitychange", onVisible);
          if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
            window.addEventListener("focus", onVisible);
          }
        }
        return () => {
          if (timer !== null) clearTimeout(timer);
          if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
            document.removeEventListener("visibilitychange", onVisible);
            if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
              window.removeEventListener("focus", onVisible);
            }
          }
        };
      }, []);
      // ── 时段（高峰/空闲）与剩余时间的动画 ──────────────────────────────
      // 两者都从 timelineNow 派生，所以必须在它之后、且仍在所有早退 return 之前。
      // 和今日金额同理：任何新 hook 都不许越过下面的早退分支（会触发 React 的
      // "Rendered more hooks than during the previous render"，整条余额行崩掉）。
      const periodNow = currentPeriod(timelineNow);
      const periodLabelNow = periodNow === "peak" ? "高峰" : "空闲";
      // 空闲 ⇄ 高峰切换时给整词重挂一次，让它淡入上浮；首帧不触发。
      const periodTick = useChangeTick(periodLabelNow);
      const spanNow = periodSpan(timelineNow);
      // 今日金额一变化，整块宽度就变，而容器是 justify-content:center —— 整块重新居中，
      // 「今日」二字被推着左右挪。用户 2026-10-31 明确：要的是**滑过去**，不是跳一下。
      //
      // 纯 CSS 做不到：位移不是由某个可过渡的属性驱动的，是 flex 居中重算出来的。
      // 所以这里量出来再补 —— paint 前把 label 挪回「旧位置」，下一帧放开 transition
      // 让它自己滑到新位置。
      //
      // ⚠️ 量的是 **label 自己的 left**，不是金额宽度。两个原因：
      //  ① 启动时最关键的那一跳发生在「等待态 → 有值」，而等待态渲染的是
      //     `--today-wait`，根本没有 `.balance-footer__today-value` 节点，量宽度会直接
      //     return，于是这一跳完全没有过渡（用户 2026-10-31：「启动时今日还是会跳过去」）。
      //  ② 直接量 left 就是真实位移量，不用再推导 ΔW/2，也不依赖居中算法。
      //
      // 之所以能用 DOM：DSH 的 jsx 工厂不赋 ref，但 document.querySelector 照样能拿到节点。
      const todayLeftRef = react.useRef(null);
      usePrePaintEffect(() => {
        if (typeof document === "undefined" || typeof document.querySelector !== "function") return;
        const label = document.querySelector(".balance-footer__timeline-meta-item--today .balance-footer__today-label");
        if (!label) return;
        const left = label.getBoundingClientRect().left;
        const prev = todayLeftRef.current;
        todayLeftRef.current = left;
        // 首次挂载没有参照，只记位置不滑动。
        if (prev === null) return;
        // 新位置比旧位置左了多少，就先右移多少回到旧位置，再过渡回 0。
        const shift = prev - left;
        if (Math.abs(shift) < 0.5) return;
        label.style.transition = "none";
        label.style.transform = "translateX(" + shift.toFixed(2) + "px)";
        // 下一帧才放开过渡。这里用 setTimeout 而不是 rAF —— DSH 渲染进程里
        // rAF 会被窗口可见性挂起，回调可能永远不来（见 AGENTS「UI 易错点」）。
        const id = setTimeout(() => {
          // 460ms 不是随手写的：启动那一刻的位移只有 2.2px，320ms 滑完肉眼看不出在动、
          // 只觉得"顿了一下"；拉到 460ms 才读得出是平滑挪过去的（2026-10-31 反馈）。
          label.style.transition = "transform .46s cubic-bezier(.22,.72,.28,1)";
          label.style.transform = "translateX(0px)";
          setTimeout(() => {
            // 清干净：transition 留着会影响后续任何位移，
            // transform 留着更糟 —— 残留的 translateX(0px) 会让这块独立成合成层，
            // 小字号中文在 GPU 纹理里渲染直接发虚（用户 2026-10-31：「数字变糊了」）。
            label.style.transition = "";
            label.style.transform = "";
          }, 500);
        }, 16);
        return () => clearTimeout(id);
      }, [todayText]);
      // 连「剩」前缀一起存：滚动要对齐补的是数字段，前缀是非数字段、保持不动。
      const remainText = spanNow === null ? null : "剩 " + formatRemain(spanNow.remainMs);
      const remainPrevRef = react.useRef(null);
      const [remainRoll, setRemainRoll] = react.useState(null);
      usePrePaintEffect(() => {
        const prev = remainPrevRef.current;
        remainPrevRef.current = remainText;
        // 首次拿到（等待 → 有值）不做滚动，交给元素自身挂载即可；
        // 之后每分钟整分钟跳一次才滚，滚的是变了的那个数字段。
        if (remainText === null || prev === null || prev === remainText) return;
        setRemainRoll({ from: prev, to: remainText, at: Date.now() });
      }, [remainText]);
      // 同上：滚完保持滚动态，不要再切回静态结构（会造成"到头跳一下"）。
      // 剩余时间消失时清空即可。
      react.useEffect(() => {
        if (remainText === null) setRemainRoll(null);
      }, [remainText]);
      // 滚完定格：摘掉 animation 声明，展开侧栏不再重播
      useRollSettle(remainRoll, setRemainRoll);
      // 指针位置见模块作用域的 TimelinePointer —— 刻意拆成独立组件：
      // 补间只重渲染那一根 2px 竖条，不会带着整个余额行一起重渲染。
      const clickTimer = react.useRef(null);
      const closeTimer = react.useRef(null);
      const layerRef = react.useRef(null);
      const panelRef = react.useRef(null);
      react.useEffect(() => () => {
        if (clickTimer.current !== null) clearTimeout(clickTimer.current);
        if (closeTimer.current !== null) clearTimeout(closeTimer.current);
      }, []);
      // ── 收起态纵向定位：统一由 fabBottom（见下方测量 effect）负责 ──────────────
      // ⚠️ 这里原来有一段用 anchorRef 量 composer 中心、再写 anchor.style.top 的
      // 「垂直居中」逻辑，2026-10-31 全量审查时删掉了。原因是**方案已被取代**，
      // 不是因为 ref 拿不到节点：
      //   · 那时 .balance-stats-anchor--compact 还是 position:fixed，靠 style.top 摆位置；
      //   · 现在那个 anchor 已经改成 position:static（只做 Tooltip 挂载点），fixed 定位
      //     挪到了 .balance-fab 自己身上、由 fabBottom 内联注入 bottom。
      //   两套并存时，旧的 top 依然会写进 style —— 对 static 元素无效但会留在 DOM 上，
      //   一旦将来有人把 anchor 改回 fixed 就会和 bottom 打架（fixed 同时有 top 和
      //   bottom 会被拉伸成一条）。所以整段清掉，纵向位置只保留一个来源。
      // 它原来还挂了 ResizeObserver 监听卡片尺寸变化 —— 那部分职责由下面测量 effect 的
      // window resize + 400ms 轮询承担，覆盖同样的场景。
      // measureComposerCenterY 保留（实现没问题），目前没有调用方。
      const closeStats = react.useCallback(() => {
        if (!statsOpen || statsClosing) return;
        // 任何关闭路径都先撤销待执行的「打开」定时器，避免关掉后又被自己弹回来
        if (clickTimer.current !== null) {
          clearTimeout(clickTimer.current);
          clickTimer.current = null;
        }
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
      // 展开态整行用的是同一套动作，但挂到 .balance-stats-anchor（primitives.Tooltip 的外层）
      // 并走捕获阶段 —— 内层任何元素都吃不掉事件，Tooltip 也覆盖不到这层 props
      // （2026-10-30 反馈「整栏显示了，只有右侧余额胶囊可点击」就是挂在 cloneElement 目标那层惹的）。
      const rowInteractions = {
        onClickCapture: (event) => {
          if (isOverlayTarget(event && event.target)) return;
          interactions.onClick(event);
        },
        onDoubleClick: (event) => {
          if (isOverlayTarget(event && event.target)) return;
          interactions.onDoubleClick(event);
        },
        onContextMenu: (event) => {
          if (isOverlayTarget(event && event.target)) return;
          interactions.onContextMenu(event);
        },
      };
      // extraProps：展开态把「单击统计 / 双击用量页 / 右键刷新」挂到 anchor 这一层。
      // 之前挂在内部的 .balance-footer 上，而那一层正是 primitives.Tooltip 的 cloneElement 目标，
      // props 可能被 Tooltip 的触发逻辑覆盖，结果只有金额胶囊响应、整行看着能点却点不动
      // （2026-10-30 反馈）。提到 Tooltip 外层 + 捕获阶段，双保险。
      const withPanel = (node, hint, anchorStyle, extraProps) => jsx.jsxs("div", {
        className: "balance-stats-anchor balance-stats-anchor--" + (wide ? "wide" : "compact"),
        style: anchorStyle,
        ...(extraProps || null),
        children: [
          // 悬停提示走 DSH 主题化浮层：primitives.Tooltip 内部是 cloneElement(children, {ref})，
          // 不会插入额外 DOM 层，因此不破坏余额行在 flex 容器里的 42px 布局（浮层本身 portal 到 body）。
          jsx.jsx(Tooltip, {
            label: hint || "单击查看余额与使用统计，双击打开 DeepSeek API 用量页，右键刷新",
            side: "top",
            delayMs: 400,
            children: node,
          }),
          // 统计面板：居中弹层 + 半透明遮罩（点击遮罩 / Esc / 关闭按钮均可关闭）
          statsOpen ? createPortal(jsx.jsx("div", {
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

      // 收起态浮窗被 composer 压住时直接隐藏（2026-10-31：「如果被遮挡直接隐藏就行了」）。
      // ⚠️ 必须量**真实矩形**，不能按 bottom:140 之类常量去推算：上一版就是这样错的 ——
      // 算出来的位置和实际画出来的位置差了一百多像素，于是明明压在 composer 上却判定"没遮挡"。
      // 几何只有一个来源：DOM。谁改 CSS 都不用同步改这里。
      const [fabCovered, setFabCovered] = react.useState(false);
      // 浮窗的 bottom：与 composer 卡片**底边齐平**（2026-10-31：「浮窗跟对话框齐平」）。
      // null = 还没量到（首帧 / composer 未挂载），此时退回 CSS 里的 140px 兜底。
      // 之所以要算而不是写死：composer 离视口底的距离由 DSH 的聊天区 padding 决定，
      // 不同窗口/不同版本会变，写死任何一个值都会差出一条缝。
      const [fabBottom, setFabBottom] = react.useState(null);
      // 位置是否已经确定。首帧一律 false → 浮窗虽然渲染但 visibility:hidden，
      // 等测量写进 fabBottom 后才显形（2026-10-31：「为什么加载插件的时候 浮窗的位置会闪动」）。
      // 闪动的成因是两个渲染批次各画在不同位置：第一批吃 CSS 兜底的 140px，
      // 第二批才拿到实测值。即使把测量搬进 paint 前，只要锚点还没挂载（消耗行属于
      // 另一个 slot，可能晚于余额行），就仍然要先画一次兜底值。所以真正的修法是
      // **在知道位置之前根本不显示它** —— 闪动是"看见两个位置"，不给看就没有。
      const [fabReady, setFabReady] = react.useState(false);
      // ⚠️ 光等测量还不够（2026-10-31「这个 bug 还在」）。
      // fabSize / fabLeft / footerStyle 全部来自 /balance-api?config=1，首帧用的是
      // SETTINGS_DEFAULTS，设置一回来就被真实值替换 —— 于是 effect 重跑、重新测量、
      // 浮窗换到一个新位置。测量本身没错，它诚实地量了两次**不同的东西**。
      // 所以显形条件必须是「测量完成 且 设置已就位」，两者缺一都还会闪。
      // fabSettled 是硬超时兜底：设置请求失败时 loaded 永远为 false，不能让浮窗
      // 因此永久不可见。
      // ⚠️ 它的计时器**必须放在下面主 effect 里面、并且在 wide 为 true 时归零**
      // （2026-10-31 第三次：「是在这个位置 然后跳到当前位置」）。
      // 之前写成独立的 [] effect，于是插件加载时（侧栏还展开着）计时器就开始跑，
      // 800ms 到点时一次测量都还没发生（wide === true 时 effect 直接 return），
      // fabVisible 被硬超时打开 → 浮窗先画在 CSS 兜底的 140px；等用户收起侧栏、
      // 测量真正跑起来，才跳到实测位置。红圈那个位置换算出来正是 821-140-105=576，
      // 就是这条兜底规则的位置。
      const [fabSettled, setFabSettled] = react.useState(false);
      // 800ms 之后无论如何都显示；之前必须「测到位置 + 设置已加载」双满足
      const fabVisible = fabSettled || (fabReady && settingsCache.loaded === true);
      // ⚠️ 用 usePrePaintEffect（paint 前同步）而不是 useEffect：后者在 paint 之后跑，
      // 至少会多一帧停在兜底位置。DSH 里没有 useLayoutEffect 时它会退回 useEffect。
      usePrePaintEffect(() => {
        if (wide) {
          // 展开态不需要浮窗，直接归零。同值 setState 会被 React 跳过，不会多渲染一轮。
          setFabCovered(false);
          // 收起态的"显形门控"也一起复位：下次真正进入收起态时重新计时、重新测量，
          // 绝不能让上一次（甚至从未开始过的）计时结果把浮窗提前放出来。
          setFabReady(false);
          setFabSettled(false);
          return undefined;
        }
        let stopped = false;
        const measure = () => {
          if (stopped) return;
          if (typeof document === "undefined" || typeof document.querySelector !== "function") return;
          const fab = document.querySelector(".balance-stats-anchor--compact .balance-fab")
            || document.querySelector(".balance-fab");
          // ⚠️ 锚点用 **dock 行**，不是 conversation.composer.bar（2026-10-31：「位置太靠上」）。
          // 实测 composer.bar 在真实 DSH 里挂的是**整个输入区容器**（高 700px 以上），
          // 不是那张输入卡片 —— 任何基于它的几何都会算偏：
          //   · 用 c.top  → 得到容器的顶部，浮窗被推到聊天区中间（"太靠上"）；
          //   · 用 c.bottom → 得到容器的底部，浮窗被推出视口（"浮窗不显示了"）。
          // dock 行是插在输入卡片**正下方**的那一条（本插件自己的消耗行就挂在里面），
          // 它的 top 几乎等于卡片底边，高度也只是一行 —— 几何稳定、语义明确。
          // ⚠️ 锚点有三个候选，按可靠性排序（2026-10-31：「位置太靠上」＋「不是你改了什么」）。
          // 之前几版都在猜 DSH 的 DOM：
          //   · conversation.composer.bar  → 实测挂的是**整个输入区容器**（高 700px+），
          //     用它算出来的位置要么把浮窗顶到聊天区中间，要么推出视口。
          //   · conversation.composer.dock → data-slot 属性不一定存在，查不到就整段 return，
          //     浮窗默默退回 CSS 的 140px —— 表现就是"改了跟没改一样"。
          // 所以主锚点换成**插件自己的消耗行**（.balance-usage-line）：它一定挂在 dock 行里、
          // 一定在输入卡片正下方，而且是我们自己的类名，不依赖 DSH 内部属性。
          // 没开消耗行显示时才退到 dock slot，两者都没有就退回 CSS 兜底。
          const anchorEl = document.querySelector(".balance-usage-line")
            || document.querySelector(".balance-usage-wrap")
            || document.querySelector('[data-slot="conversation.composer.dock"]');
          if (fab === null || anchorEl === null) {
            setFabCovered(false);
            return;
          }
          const f = fab.getBoundingClientRect();
          const d = anchorEl.getBoundingClientRect();
          const vh = window.innerHeight;
          // 浮窗底边 = 锚点顶部再往下 8px，视觉上就是「与对话框底边齐平」。
          const rawBottom = Math.round(vh - d.top) + 8;
          // 唯一要守的约束：浮窗整块得留在视口内。锚点正常时 rawBottom 只有几十 px，
          // 一旦算出接近视口高度就说明拿到的不是那一行，宁可不设、退回 CSS 兜底。
          // ⚠️ 带 1px 死区：锚点的 sub-pixel 位置每帧可能抖动，round 之后就是 ±1px。
          // 每 400ms 为这 1px 重新 setState 一次，表现就是浮窗在轻微上下抖。
          const nextBottom = rawBottom + 140 <= vh ? Math.max(8, rawBottom) : null;
          setFabBottom((prev) => {
            if (nextBottom === null || prev === null) return nextBottom;
            return Math.abs(nextBottom - prev) <= 1 ? prev : nextBottom;
          });
          // 位置已定 → 允许显形。测不到锚点时**不要**置 ready，
          // 让浮窗维持不可见，由下面的 800ms 兜底负责"实在测不到也不能永远不显示"。
          setFabReady(true);
          if (f.width === 0 || f.height === 0) {
            setFabCovered(false);
            return;
          }
          // 遮挡判定 = 浮窗和锚点**真正相交**，不再只比 x 区间。
          // 原注释写「它和输入卡片同宽」，但锚点早就换成我们自己的窄 pill（.balance-usage-line），
          // 拿一句失效的假设去判几何迟早出事（2026-10-31 全量审查）。
          // 正常布局下浮窗底边比锚点顶边低 8px、高度 = fabSize，两者纵向必然重叠，
          // 所以补上 Y 判定不改变实际结果，只是把「横向代理」换成真判定。
          const overlapX = f.right > d.left + 4 && f.left < d.right - 4;
          const overlapY = f.bottom > d.top + 4 && f.top < d.bottom - 4;
          setFabCovered(overlapX && overlapY);
        };
        measure();
        // 不用 requestAnimationFrame：DSH 渲染进程里它会被窗口可见性挂起
        window.addEventListener("resize", measure);
        // 不可见时不测：400ms 一次 getBoundingClientRect 同样是强制 layout。
        // 位置只在看得见的时候才有意义，回到可见后 400ms 内必然重新测到一次。
        const timer = setInterval(() => {
          if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
          measure();
        }, 400);
        // 兜底：进入收起态后 800ms 内一次都没测到（消耗行迟迟没挂载 / 被用户关掉）
        // 就按 CSS 的 140px 显形。宁可位置不够理想，也不能因为测量失败让浮窗永远不可见。
        // ⚠️ 计时器必须在**这里**（收起态专属），不能放到 [] 里另行启动 —— 否则侧栏还
        // 展开着的时候它就开始跑，到点时一次测量都没发生，浮窗会先画在兜底位置。
        const fallback = setTimeout(() => {
          if (!stopped) setFabSettled(true);
        }, 800);
        return () => {
          stopped = true;
          window.removeEventListener("resize", measure);
          clearInterval(timer);
          clearTimeout(fallback);
        };
        // ⚠️ 依赖里**不能**放 fabCovered / fabBottom / fabReady：它们的 setState 会重跑本
        // effect、重建定时器，变成"测一次→重建→再测一次"的抖动循环。同值写入本来就会被
        // React 跳过。
      }, [wide, fabSize, fabLeft, settings.footerStyle]);

      // 收起态标记那套模块级广播（compactState / compactListeners / notifyCompact）
      // 和它的消费者组件已于 2026-10-31 全量审查时**整块删除**：那个 slot 注册会把
      // 整个插件搞没，组件从来不会挂载，广播零消费者。别再加回来。

      if (!wide) {
        // 设置里关掉圆钮就整个不渲染（统计面板入口随之消失，符合「关掉显示」的预期）
        if (settings.showFab === false) return null;
        // 被 composer 压住就隐藏：宁可这一块不显示，也不要盖住输入框
        if (fabCovered) return null;
        if (state.status === "error" || !state.balance) return null;
        const b = state.balance;
        // 尺寸 / 水平位置由设置决定，用内联样式覆盖 CSS 默认值（CSS 保留 60px/44px 兜底）。
        // bottom 优先用测到的 composer 底边（与对话框齐平），没测到才让 CSS 的 140px 生效。
        const fabStyle = {
          width: fabSize + "px",
          height: fabSize + "px",
          left: fabLeft + "px",
        };
        if (fabBottom !== null) fabStyle.bottom = fabBottom + "px";
        // 位置未定之前不可见（见上面 fabVisible 的说明）。visibility 而不是 display:none ——
        // 后者会让元素没有盒子、getBoundingClientRect 全 0，遮挡判断就永远测不出来。
        if (!fabVisible) fabStyle.visibility = "hidden";
        const anchorStyle = { left: fabLeft + "px" };
        const total = Number.parseFloat(b.total_balance ?? "0");
        // 「余额不足」必须听服务端的 is_available，**不能**用 total <= 0 推断
      // （2026-10-31 审查）：`total_balance` 只是**充值余额**，赠送钱包单列在 granted_balance 里
      // （见 AGENTS「主数字只等于充值余额」）。所以「充值花光但赠送还有」时 total 是 0、
      // is_available 却是 true —— 旧写法会把这种账号判成没钱：余额行变成「去充值」、
      // 圆钮变成充值卡，而实际还能用。只有在服务端没给这个字段时才退回按金额推断。
      const depleted = typeof b.is_available === "boolean"
        ? b.is_available === false
        : (!Number.isFinite(total) || total <= 0);
        // ⚠️ 必须 portal 到 body：收起态 DSH 把整个 footArea 设为 display:none
        // （`[data-windows-titlebar] .<hash>_collapsed .<hash>_footArea{display:none}`），
        // 而 `sidebar.footer.action` 就在 footArea 里。display:none 的祖先不会生成盒子，
        // 后代即使 position:fixed 也完全不渲染——组件确实被调用了（wide=false），但 DOM 不可见。
        // portal 到 body 后 position:fixed 才真正生效（2026-09-28 用户反馈「收起侧边栏余额不显示」）。
        // 圆形 FAB 放不下长文本：余额显示「¥<金额>」，余额耗尽时用「充值」而不是「去充值」
        const balanceText = "¥" + b.total_balance;

        // ─── 新版（timeline）收起态：矩形卡片（2026-10-31） ────────────────────
        // 「这个同样跟随新版跟旧版的选择 当前样式是旧版 显示一个矩形 里面显示跟新版里一样的东西
        //   动画也要在」——所以新版收起态不再是圆钮，而是一块竖排小卡：
        //   余额（逐位滚动） / 时段词 / 刻度条（含指针） / 今日金额（等待态是雾）。
        // 全部沿用展开态那套 state 和 CSS 类，不另写一份动画，滚动/雾/指针原样继承。
        // 宽度锁在 fabSize（默认 60），高度由内容撑开——收起态侧栏本来就窄，只能竖排。
        if (settings.footerStyle === "timeline") {
          // ⚠️ 这里**必须继续渲染**矩形浮层（2026-10-31：「插件改没了」）。
          // 曾经为了「隐藏矩形 直接显示在红圈位置」把这段换成 return null、把整块交给
          // conversation.composer.bar 里的 CompactBalanceLine —— 结果那个 slot 根本没渲染，
          // 于是收起态两边都是空的，整个插件看起来消失了。
          // slots.register 对不存在的 slot 名是**静默失败**（不抛错、不报警），所以
          // 不能靠"注册没报错"判断它可用。
          // 现在只留浮层（bottom 已抬到 140px，不再压 composer）。原来还并着一条
          // composer.bar 文本行，那个 slot 从未渲染成功，已随 2026-10-31 死代码清理删除。
          // 宽度独立于圆钮尺寸：圆钮 60px 装四行内容字会被挤到 9px（2026-10-31 用户：
          // 「太小了吧」）。收起态侧栏约 56px，但 FAB 是 position:fixed 浮层，
          // 可以比侧栏宽——这里按 fabSize 的 1.85 倍走，默认 112px。
          // 112px 是「时段剩余时间 + 今日二字都要放得下，且中文不落到 9px 亚像素」的实测值
          // （2026-10-31：「可以再大一点 让字体显示清楚」）。
          const rectW = Math.max(96, Math.round(fabSize * 1.85));
          // ⚠️ 定位基准必须是**圆钮中心**，不是圆钮左边缘（2026-10-31：「我怎么感觉你
          // 一直在动这个矩形的位置呢」）。fabLeft 是圆钮**左缘**的坐标，圆钮只有 fabSize
          // 宽，而卡片有 1.85 倍宽 —— 直接写 left: fabLeft 时左缘被钉住、多出来的宽度
          // 全部朝右长，于是每次调整 fabSize 或宽度系数，卡片右缘就跟着往右漂一截，
          // 看起来像"卡片在移动"而不是"卡片变胖"。
          // 按中心对齐后加宽是左右对称扩张，卡片看上去定在原地。
          const rectLeft = Math.max(4, Math.round(fabLeft + fabSize / 2 - rectW / 2));
          const rectStyle = { width: rectW + "px", left: rectLeft + "px" };
          // 与对话框齐平：矩形卡用的是 rectStyle 而不是 fabStyle，两边都要带上 bottom，
          // 否则只有圆形分支对齐、矩形分支还挂在 CSS 的 140px 上（两种布局手感不一致）。
          if (fabBottom !== null) rectStyle.bottom = fabBottom + "px";
          // 同样要带可见性控制，否则矩形卡会先闪一下兜底位置（用户反馈的就是这种浮窗）
          if (!fabVisible) rectStyle.visibility = "hidden";
          // ⚠️ 余额**只用数字**，绝不用展开态的 `rollCells`：那个基于 `totalText`
          // =「17.87 CNY」，塞进 81px 会被 `overflow:hidden` 裁成「17.87 CN\」
          // （2026-10-31 实测截图）。币种在收起态没有横向空间，展开态才显示。
          // 滚动起点同样要把 `roll.from` 里的币种剥掉，否则 from 含 CNY、to 不含，
          // 逐位比对会整串错位。
          const rectNum = String(b.total_balance);
          const stripCurrency = (s) => String(s == null ? "" : s).replace(/\s*[A-Z]{3}\s*$/, "");
          const rectRoll = roll === null ? null : { from: stripCurrency(roll.from), at: roll.at, done: roll.done };
          const rectFab = withPanel(jsx.jsxs("a", {
            className: "balance-fab balance-fab--rect",
            style: rectStyle,
            ...externalLink(USAGE_URL, "usage"),
            ...interactions,
            children: [
              // 右键水波（2026-10-31：「设计成水面波浪样式的 鼠标点击的对应区域为波浪中心 向外扩张」）。
              // 只放**一圈**（2026-10-31：「只显示一条就够了」）：三圈错开会读成"重复的同心环"，
              // 单圈从点击点推到边缘就已经把"水面被点了一下"讲清楚了。
              // 判据与展开态一致：只有本次挂载真的收到过 emitWave 才渲染，
              // 否则重挂时 CSS 动画会从 0 重播一次（"没消费却凭空荡一圈水"）。
              waveToken === 0 || settings.refreshWave === false
                ? null
                : jsx.jsx("span", {
                  className: "balance-fab__ripple-layer",
                  key: "wave-" + waveToken,
                  "aria-hidden": "true",
                  children: jsx.jsx("span", {
                    className: "balance-fab__ripple",
                    style: {
                      left: (waveOrigin === null ? 56 : waveOrigin.x) + "px",
                      top: (waveOrigin === null ? 80 : waveOrigin.y) + "px",
                    },
                  }),
                }),
              // 余额
              jsx.jsx("span", {
                className: "balance-fab__value" + (total > 0 && total < lowThreshold ? " balance-fab__value--low" : ""),
                children: jsx.jsx("span", {
                  className: "balance-footer__roll",
                  children: renderRollCells(
                    buildRollCells(rectRoll === null ? rectNum : rectRoll.from, rectNum),
                    "f" + (rectRoll === null ? "" : rectRoll.at),
                    rectRoll !== null && rectRoll.done === true,
                  ),
                }),
              }),
              // 今日消费紧贴余额下方（2026-10-31 箭头标注：「今日消费显示在」这一行）。
              // 「今日」二字**常显、不进动画**（2026-10-31：「今日二字不算在动画里」），
              // 与展开态同一口径：标签恒定不动，只有金额部位在等待/滚动。
              jsx.jsxs("span", {
                className: "balance-fab__today" + (todayCost === null ? " balance-fab__today--waiting" : ""),
                children: [
                  jsx.jsx("span", { className: "balance-fab__label", children: "今日" }),
                  todayCost === null
                    // 等待态只占金额那一格：消耗行的 5 颗亮芯光球（深底上要的是亮的东西在流动，
                    // 展开态那套「两层光团 + 毛玻璃」在纯深色卡上只会得到一块灰白补丁）。
                    ? jsx.jsx("span", {
                      className: "balance-fab__today-mist",
                      children: jsx.jsx("span", {
                        className: "balance-usage-mist",
                        children: ORB_INDICES.map((i) => jsx.jsx("span", { key: "orb-" + i, className: "balance-usage-mist__orb" })),
                      }),
                    })
                    : jsx.jsxs("span", {
                      // 收起态也要「从左到右扫过」的擦出（2026-10-31：「浮窗的今日加载动画也要有
                      // 从左到右显示出来」）。复用展开态那条链路：todayWipeSeq 当 key（换 key 才重挂、
                      // 动画才从 0 起播），todayWipeDone 决定什么时候摘掉 --enter 类。
                      // 两者都由同一个 effect 驱动，所以「等待态出口才擦、自动刷新只滚动」的
                      // 语义在两种布局下完全一致，不需要为收起态再写一套判据。
                      key: "fab-today-" + todayWipeSeq,
                      className: "balance-fab__today-inner"
                        + (todayWipeSeq > 0 && !todayWipeDone ? " balance-fab__today-inner--enter" : ""),
                      children: [
                        jsx.jsxs("span", {
                          className: "balance-fab__today-body",
                          children: [
                            jsx.jsx("span", { className: "balance-fab__cur", children: "¥" }),
                            jsx.jsx("span", {
                              className: "balance-footer__today-num",
                              children: renderRollCells(
                                buildRollCells(todayRoll === null ? todayText : todayRoll.from, todayText),
                                "t" + (todayRoll === null ? "" : todayRoll.at),
                                todayRoll !== null && todayRoll.done === true,
                              ),
                            }),
                          ],
                        }),
                        // 擦出期间盖在上层的加载雾（2026-10-31：「跟展开不一样啊 展开是没擦到
                        // 的地方还是加载动效」）。直接复用展开态那个类：它带着 --today-hole 的
                        // 遮罩挖洞动画，洞从 0% 长到 100%，和下面数字的 clip-path 同一条缓动、
                        // 同一个 260ms —— 于是"数字被扫开、没扫到的地方还是雾"这件事自然成立。
                        // 只在擦出窗口内渲染：平时它是 absolute + z-index:1 的整块遮罩，
                        // 常驻会一直盖着数字。
                        todayWipeSeq > 0 && !todayWipeDone
                          ? jsx.jsx("span", {
                            // 收起态只在擦出窗口内渲染这一层，所以直接挂 --wipe
                            // （动画声明在修饰类上，见上方 .balance-footer__today-reveal__mist--wipe）
                            className: "balance-footer__today-reveal__mist balance-footer__today-reveal__mist--wipe balance-fab__today-wipe-mist",
                            children: jsx.jsx("span", {
                              className: "balance-usage-mist",
                              children: ORB_INDICES.map((i) => jsx.jsx("span", { key: "orb-" + i, className: "balance-usage-mist__orb" })),
                            }),
                          })
                          : null,
                      ],
                    }),
                ],
              }),
              // 时段词 + 剩余时长（2026-10-31：「多显示一点信息 比如时段剩余时间」）。
              // spanNow 在 compact 分支之前就算好了，这里直接用；remainText 那个变量
              // 定义在分支之后，拿不到，所以现场拼一份。放不下「剩 1d20h」时靠 CSS 收字。
              jsx.jsx("span", {
                className: "balance-fab__period balance-fab__period--" + periodNow,
                children: [
                  jsx.jsx("span", { children: periodLabelNow }),
                  spanNow === null
                    ? null
                    : jsx.jsx("span", {
                      className: "balance-fab__remain",
                      children: "剩 " + formatRemain(spanNow.remainMs),
                    }),
                ],
              }),
              // 刻度条：直接复用展开态的 track + 色带 + 指针，指针自己按 timelineNow 走
              jsx.jsx("span", {
                className: "balance-fab__track",
                children: jsx.jsx("span", {
                  className: "balance-footer__timeline-track balance-footer__timeline-track--" + periodNow,
                  children: [
                    jsx.jsx(TimelineBand, { gradient: buildTimeline(timelineNow).gradient }),
                    jsx.jsx(TimelinePointer, {}),
                  ],
                }),
              }),
            ],
          }), undefined, anchorStyle);
          return typeof document === "undefined" ? rectFab : createPortal(rectFab, document.body);
        }
        // 两种情况都经 withPanel：收起态的定位落在它渲染的 .balance-stats-anchor--compact
        // 上（那个 div 只做 Tooltip 挂载点、position:static，真正的 fixed 定位在 .balance-fab
        // 自己身上，bottom 由 fabBottom 内联注入）。
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
        return typeof document === "undefined" ? fab : createPortal(fab, document.body);
      }

      // 展开态余额行：设置里关掉就不渲染（收起态圆钮由上面的 showFab 单独控制）
      if (settings.showBalanceRow === false) return null;

      // 右键刷新的浪潮层：整块从左往右扫一道泛光。用户 2026-10-30 明确
      // 「别给我整个光条删了」——所以这层保留；金额胶囊内部另有 __reveal 的擦除揭示，
      // 两层叠加：泛光负责「你点了」，擦出负责「新数字出现」。
      //
      // ⚠️ 白光只在**本次挂载真的收到过 emitWave** 时才渲染（`waveToken > 0`）。
      // 判据必须用组件内的 `waveToken`，不能用模块级的 `waveSeq`：那个变量重挂不归零，
      // 只要右键过一次或发生过一次消费刷新就永远 > 0，于是每次折叠/展开侧栏
      // （组件重挂、DOM 重建、CSS 动画从 0 起播）都会凭空扫一道白光 ——
      // 这正是「没有消费时没事，一旦产生消费，点收起/展开就还有这个 bug」
      // （2026-10-31 两轮，第二轮的截图正是在展开那一瞬间拍的）。
      const waveNode = settings.refreshWave === false || waveToken === 0
        ? null
        : jsx.jsx("span", { className: "balance-footer__wave", key: "wave-" + waveToken });

      if (state.status === "error") {
        return withPanel(jsx.jsxs("div", {
          className: "balance-footer" + footerEnterClass, id: "balance-footer-root",
          ...interactions,
          children: [
            // 失败原因统一走主题化浮层，避免把长错误塞进 42px 的余额行
            jsx.jsx(Tooltip, {
              label: state.error || "余额查询失败",
              side: "top",
              delayMs: 200,
              children: jsx.jsx("span", { className: "balance-footer__error", children: "余额读取失败" }),
            }),
          ],
        }));
      }
      if (!state.balance) {
        // ⚠️ **不占位**（2026-10-31：「把这个不要了 不用占位了，因为当前多了个今日消耗
        // 导致高度不一致」）。原来这里渲染「余额加载中…」一行文字，它和真正的余额胶囊
        // 高度不同，所以加载中 → 加载完会顶一下；再叠上今日消耗那一条，整块高度更不齐。
        // 现在加载态直接不渲染，侧栏底部高度由「有没有余额」决定 —— 值到了才出现。
        // （原先还有一条 clip-path 从下往上擦出的入场动画，因为挂在根节点上、
        //   重挂即重播，已整条删除，原因见 CSS 里那段注释。）
        return null;
      }

      const b = state.balance;
      const total = Number.parseFloat(b.total_balance ?? "0");
      // 「余额不足」必须听服务端的 is_available，**不能**用 total <= 0 推断
      // （2026-10-31 审查）：`total_balance` 只是**充值余额**，赠送钱包单列在 granted_balance 里
      // （见 AGENTS「主数字只等于充值余额」）。所以「充值花光但赠送还有」时 total 是 0、
      // is_available 却是 true —— 旧写法会把这种账号判成没钱：余额行变成「去充值」、
      // 圆钮变成充值卡，而实际还能用。只有在服务端没给这个字段时才退回按金额推断。
      const depleted = typeof b.is_available === "boolean"
        ? b.is_available === false
        : (!Number.isFinite(total) || total <= 0);
      const currency = b.currency || "CNY";
      const totalText = b.total_balance + " " + currency;
      // 位数多就降字号：一旦整数位到 4 位，16px 的胶囊会宽过 121px 的固定宽度
      // （1234.56 CNY 131.3px / 12345.67 CNY 141.1px），把自己撑出容器右缘。
      // 降一档字号就能收回来，宽度重新恒定 —— 配合 .balance-footer__value 的 min-width。
      const valueDensity = amountDensity(b.total_balance);
      if (depleted) {
        return withPanel(jsx.jsxs("div", {
          className: "balance-footer" + footerEnterClass, id: "balance-footer-root",
          ...interactions,
          children: [
            jsx.jsx("span", { className: "balance-footer__spacer" }),
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

      // 与 periodSpan / buildTimeline 同源都用 timelineNow：三者必须指向同一时刻，
      // 否则边界那一分钟会出现“标签已是高峰、剩余时间还按空闲算”的自相矛盾。
      // period / spanNow / remainText 已在上面随 timelineNow 一起算好（那里也在早退之前），
      // 这里直接复用，避免同一帧内算两遍、也保证动画用的值和显示的值是同一个。
      const period = periodNow;
      const low = total > 0 && total < lowThreshold;
      // 时段模块：上方一行 meta（今日消耗 · 时段 · 剩余时间）+ 下方扁刻度条。
      // 色带固定 = 当天完整时段，指针 = 此刻在当天的位置。
      const span = spanNow;
      // meta 分两段：①「今日 ¥x」②「时段词 + 剩余时间」。
      // 第二段整体不换行（包在 __group 里），所以窄侧栏折行时一定是
      // 「今日 ¥x」独占上面一行、「空闲 剩 3h57m」落到下面一行 —— 用户 2026-10-30 指定。
      const metaItem = (text, cls, key) =>
        jsx.jsx("span", { className: "balance-footer__timeline-meta-item" + (cls || ""), children: text }, key);
      // 时段词挂 key="${periodTick}"：空闲 ⇄ 高峰 切换时重挂一次，播 --period-swap 的淡入。
      // ⚠️ 启动首帧**不许播**：periodTick 首帧是 0，以此判断「还没切换过」，
      // 这时不挂动画类 —— 打开 DSH 时「空闲」就是静态出现的，不该有任何动效
      // （用户 2026-10-31 明确）。切换过一次之后 tick ≥ 1，类会一直挂着，
      // 但因为 key 只在换词时变，动画也只在换词那一帧重播。
      const periodNodeItem = jsx.jsx("span", {
        className: "balance-footer__timeline-meta-item balance-footer__timeline-meta-item--" + period
          + (periodTick > 0 ? " balance-footer__period-swap" : ""),
        children: periodLabelNow,
      }, "period-" + periodTick);
      const tail = [periodNodeItem];
      if (span !== null) {
        tail.push(jsx.jsx("span", {
          className: "balance-footer__timeline-meta-item",
          style: { fontVariantNumeric: "tabular-nums" },
          children: remainRoll === null
            ? remainText
            // 终点用当前文本而不是 remainRoll.to：滚动结束后状态不再清空，
            // 若期间又跳了一分钟但还没产生新 roll，用 .to 会停在上一轮的值。
            : renderRemainRoll(remainRoll.from, remainText, "r" + remainRoll.at, remainRoll.done === true),
          // key 跟着滚动回合走：每轮重挂，滚动态和静态之间切换不会被 React 复用成同一个元素，
          // 否则 dout/din 的动画不会重新起播。
        }, remainRoll === null ? "remain-" + remainText : "remain-roll-" + remainRoll.at));
      }
      // 「今日 ¥x」是 meta 里的第一项（flex-basis:100%，独占第一行）——
      // 数据没到之前先摆一个等待态，让这一行的高度从一开始就是最终高度 ——
      // 条件渲染会让整块从 1 行变 2 行，侧栏底部（含设置按钮）整体被顶下 14px，
      // 那一下重排就是「今日余额弹出来时卡住」。
      // 等待态只在「还在等」时出现；确认拿不到（tried 且为 null）就整项不渲染，不留空行。
      // todayCost / todayText / 滚动 hook 都在函数最顶部（早退分支之前）算好了 ——
      // 这里是普通派生，不是 hook，放在哪都行。
      // 等待态覆盖两种情况：
      //  1) 还没拿到任何值（`tried === false`）—— 老语义
      //  2) 拿到了但**还没定型**（`settled === false`，即 `?today=1` 的 partial 补拉阶段）
      // 第 2 条是 2026-10-31 补的：冷启动首次返回的是落盘快照，3 秒后才补拉出精算值，
      // 而快照偏高 → 用户看到「¥17.29 刚显示完就往下变成 ¥16.x」。那不是新消耗，
      // 是同一次计算的两个阶段，所以**连揭幕都要等定型**，宁可多等 3 秒也不显示一个
      // 会当场缩水的数。定型后只揭幕一次，之后的值变化才走滚动。
      // 定型之前一律保持等待态（有值也先不揭幕）；定型之后才按「有没有值」决定显示还是整项隐藏。
      // `fetchTodayOnce` 保证一定会定型（成功非 partial、重试用尽、或彻底失败都会置 true），
      // 所以这里不会永久挂住。
      const todayWaiting = !todayCache.settled || (todayCost === null && !todayCache.tried);
      // 等待时「今日」二字常显，只有金额部位在动（用户 2026-10-31：今日二字固定显示）。
      // 动效语言跟随设置里的「消耗行加载动效」，两处不混用。
      const todayLoadingIsText = settings.usageLoadingStyle === "text";
      const metaChildren = [];
      if (todayCost !== null || todayWaiting) {
        metaChildren.push(jsx.jsx("span", {
          className:
            "balance-footer__timeline-meta-item balance-footer__timeline-meta-item--today" +
            (todayCost === null ? " balance-footer__timeline-meta-item--today-waiting" : ""),
          children: [
            // 「今日」二字恒定不动：**不给它挂任何动画类**（用户 2026-10-31 反馈
            // 「刷新出来的时候今日二字也会闪一下」—— 根因就是以前整块挂了淡入动画）。
            // 唯一的动作是金额宽度变化时的真实滑动，由上面的 usePrePaintEffect
            // 直接写 style 驱动（不走类名，也不换 key，所以不会重挂）。
            jsx.jsx("span", { key: "label", className: "balance-footer__today-label", children: "今日" }),
            // ⚠️ 等待态和出数值态必须是**同一个节点树**（2026-10-31：「触发从左往右的擦除动画时
            // 右边的未被经过的位置变回了动画初始样子 看起来就是闪回去了 很割裂」）。
            // 原来分成 key:"wait" / key:"value" 两个分支，数据一到 React 就把整块卸载重挂，
            // mist 是**新插入的 DOM**，里面两层 radial 光团（::before / ::after）的 CSS 动画
            // 从 0 重新起播 —— 已经流动到某个相位的雾突然跳回初始形状，看起来就是"闪回去"。
            // 现在只有一个 .balance-footer__today-value 容器，mist 用恒定 key 常驻，
            // 等待态只是「没有 body」而已，节点不动、动画不断。
            jsx.jsx("span", {
              key: "value",
              className: "balance-footer__today-value"
                + (todayCost === null ? " balance-footer__today-value--waiting" : ""),
              children: jsx.jsx("span", {
                key: "reveal",
                className: "balance-footer__today-reveal",
                children: [
                  // mist **永久常驻，不再按条件卸载**（2026-10-31 第四轮：
                  // 「今日加载的动画 未扫过的区域动画不要初始化 继续播放」）。
                  // 原来写的是 `todayCost !== null && todayWipeDone ? null : <mist>`，
                  // 但 todayWipeDone 只能在 effect / 定时器里翻，而 effect 跑在**渲染之后** ——
                  // 于是「值到手」的那一帧 done 还是 true，mist 当场被卸载，下一帧再挂回来。
                  // 这一来一回是两个不同的 DOM 节点，::before / ::after 两层 radial 光团的
                  // CSS 动画从 0 秒重播 —— 没扫到的右半边"闪回初始形状"，正是用户说的"初始化"。
                  // 现在干脆不卸载：`.balance-footer__today-reveal__mist` 的遮罩动画
                  // （--today-hole 0% → 100%）播完后整层就是全透明，本来就看不见了，
                  // 根本不需要摘 DOM。元素自始至终是同一个，光团动画一路接着播。
                  // 回到等待态时只是这个类被去掉（inner 没有蒙版、恢复可见），节点依然不动。
                  jsx.jsx("span", {
                    key: "mist",
                    // ⚠️ 必须同时挂 balance-footer__today-wait：
                    // 今日那套"11px 胶囊 + 两层 radial 光团 + 毛玻璃"的样式全部写在
                    // .balance-footer__today-wait .balance-usage-mist 选择器下面，
                    // 漏了这个父类，里面的 .balance-usage-mist 就只剩消耗行那套默认样式，
                    // 而今日的雾是靠 ::before/::after 两层光团实现的 —— 结果就是完全透明，
                    // 看着像"mist 根本没渲染"（2026-10-31 实测踩过）。
                    className: "balance-footer__today-wait"
                      + (todayCost === null ? "" : " balance-footer__today-reveal__mist")
                      // 擦出窗口内挂 --wipe（动画从 0 起播）；已经擦完则挂 --clear
                      // （钉在洞开到底的透明态，且没有任何 animation 声明）。
                      // 两个都不挂 ⇒ 等待态，雾整块可见。
                      // ⚠️ 判据只看 done、不看 seq：值到手那一帧就必须已经是 --wipe，
                      // 否则会漏出"雾先透明一帧、再被盖住扫一遍"的闪烁。
                      + (todayCost === null ? "" : (todayWipeDone
                        ? " balance-footer__today-reveal__mist--clear"
                        : " balance-footer__today-reveal__mist--wipe")),
                    "aria-hidden": "true",
                    // 光团起始相位（每次挂载随机一次），把 CSS 里写死的 -.5s / -1.1s 换成变量
                    style: todayFlowStyle,
                    children: todayLoadingIsText
                      ? jsx.jsx("span", {
                        className: "balance-usage-calc",
                        children: [
                          "计算中",
                          jsx.jsx("span", {
                            className: "balance-usage-calc__dots",
                            "aria-hidden": "true",
                            children: [0, 1, 2].map((i) => jsx.jsx("span", { className: "balance-usage-calc__dot", children: "." }, i)),
                          }, "dots"),
                        ],
                      })
                      : jsx.jsx("span", {
                        className: "balance-usage-mist",
                        children: [
                          ...ORB_INDICES.map((i) => jsx.jsx("span", { key: "orb-" + i, className: "balance-usage-mist__orb" })),
                          jsx.jsx("span", { className: "balance-footer__today-fog" }, "fog"),
                        ],
                      }),
                  }),
                  todayCost === null
                    ? null
                    : jsx.jsx("span", {
                      // key 绑序号：值每变一次就重挂一次，动画随之从 0 播；
                      // 值没变（折叠/展开侧栏）序号不动，节点不重挂，不重播。
                      key: "body-" + todayWipeSeq,
                      className: "balance-footer__today-reveal__body"
                        + (todayWipeSeq > 0 && !todayWipeDone ? " balance-footer__today-reveal__body--enter" : ""),
                      children: [
                        // ¥ 仍然在滚动区外层：buildRollCells 按「数字开头」拆分，
                        // 把它包进去会被当成整串 tail，变成一格整体平移。
                        // 单独给个类做右间距：¥ 是宽字符，直接挨着数字会显得贴在一起。
                        jsx.jsx("span", { key: "cur", className: "balance-footer__today-cur", children: "¥" }),
                        // ⚠️ 外层 key 必须恒定（"num"），只有内层变化的格子才重挂。
                        // 之前是 todayRoll === null ? key:"text" : key:"roll-"+at —— 滚动结束
                        // todayRoll 清空时 key 变了，React 把整串卸载重挂，那一帧里被滚动的格子
                        // 从动画终态重新起算，看着就是「位置异常一下再回正」
                        // （2026-10-31 用户反馈）。现在外层永不重挂，只看内层的 changed 标志。
                        jsx.jsx("span", {
                          key: "num",
                          // 首次出场（等待态结束、冷启动拿到金额）走独立入场动画：
                          // 不复用 dout/din 那套滚格子 —— balance-roll-in 前 40% 是 opacity:0
                          // （给「旧值滚出、新值滚入」留的重叠时间），从空白升起时那段就是纯空白，
                          // 看起来跟直接蹦出来没区别（逐帧截图确认 0/70/140ms 三帧全空）。
                          className: "balance-footer__today-num",
                          children: renderRollCells(
                            // from 取滚动起点；静态时 from === to，所有格 changed=false，等价纯静态。
                            // 静态也走逐字格，是为了让宽度和滚动态完全相等（裸文本没有逐字 inline-block
                            // 的字距补偿，来回切会让整串左右挪）。
                            buildRollCells(todayRoll === null ? todayText : todayRoll.from, todayText),
                            // prefix 里带 at：每次滚动只让「变化的那一格」换 key 重挂，动画才重新起播；
                            // 没变的格 key 保持稳定，不会被牵连重挂。
                            "t" + (todayRoll === null ? "" : todayRoll.at),
                            // 播完就定格：摘掉 animation 声明，展开侧栏不再重播
                            todayRoll !== null && todayRoll.done === true,
                          ),
                        }),
                      ],
                    }),
                ],
              }),
            }, "value"),
          ],
        }, "today"));
      }
      metaChildren.push(jsx.jsx("span", { className: "balance-footer__timeline-meta-group", children: tail }, "tail"));
      const metaNode = jsx.jsx("span", { className: "balance-footer__timeline-meta", children: metaChildren });
      // 新版把「meta 行 + 刻度条」当结构主体，不存在"关掉只剩金额"的形态，
      // 所以这里不看 showPeriodLabel；那个开关只在旧版有意义（见下面的 classic 分支）。
      const timelineBand = buildTimeline(timelineNow);
      // 刷新时不替换时段模块：刻度条保持原样，刷新反馈只落在右侧金额（半透明 + 浪潮）。
      // 刻度条在 timeline 内部、meta 下方，宽度跟随侧栏（width:100%）。
      // 容器是普通 flex（不 wrap），实际排版是两段：
      //   [                             今日 ¥x]   ← meta 第一行（独占、居中）
      //   [空闲 剩 3h57m]            [¥x • 空闲]   ← meta 第二行 + 金额胶囊
      //   [==== 刻度条（跟随侧栏宽度）====]
      // 「今日」占满左列宽度并居中，与下面「空闲 剩 3h57m」在左列内部成组。
      const periodNode = jsx.jsxs("span", {
        className: "balance-footer__timeline",
        children: [
          metaNode,
          jsx.jsxs("span", {
            className: "balance-footer__timeline-track balance-footer__timeline-track--" + period,
            children: [
              // 裁剪层让四周各留 1px，颜色不贴边框。
              // 里面是泛光 + 色带两层，换日时由 TimelineBand 做交叉淡入（gradient 不可插值）。
              jsx.jsx(TimelineBand, { gradient: timelineBand.gradient }),
              // 指针：位置 = 此刻在当天的比例，随时间从左走到右。
              // 指针是独立组件，自己管 state 和补间，不带着余额行重渲染。
              jsx.jsx(TimelinePointer, {}),
            ],
          }),
        ],
      });
      // 布局：左侧 [meta + 刻度条] 竖排，右侧金额。行高不够时整块自动变高。
      // 旧版样式（footerStyle === "classic"）：回到早期那版「钱包图标 + 余额 + 金额」的纯文字行，
      // 时段提示退化成金额前的一小段文字，不再画刻度条。
      if (settings.footerStyle === "classic") {
        // 逐字还原 1.3.1 备份里的旧版：图标 + 「余额」 + 单个胶囊，胶囊内是「金额 • 时段」。
        // 胶囊靠 margin-left:auto 推到右缘（见 .balance-footer--classic 规则），
        // 刷新反馈也照备份：时段文字变成灰色「刷新中…」，不扫光、不改透明度。
        const classicPeriod = settings.showPeriodLabel === false
          ? null
          : state.refreshing
            ? jsx.jsx("span", { className: "balance-footer__period-inline balance-footer__period-inline--refreshing", children: "刷新中…" })
            : jsx.jsx("span", {
                className: "balance-footer__period-inline balance-footer__period-inline--" + period,
                children: period === "peak" ? "高峰" : "空闲",
              });
        return withPanel(jsx.jsxs("div", {
          className: "balance-footer balance-footer--classic" + footerEnterClass, id: "balance-footer-root",
          children: [
            jsx.jsx("span", { className: "balance-footer__icon", children: jsx.jsx(WalletIcon, {}) }),
            jsx.jsx("span", { className: "balance-footer__label", children: "余额" }),
            jsx.jsxs("span", {
              className: "balance-footer__value" + (low ? " balance-footer__value--low" : " balance-footer__value--healthy") + valueDensity,
              children: [
                totalText,
                // 分隔点用元素而不是字符串：inline-flex 会把匿名文本条目的首尾空白按规范去掉，
                // 写成 " • " 就只剩一个紧贴的圆点。间距交给 CSS margin，两侧才能真对称。
                classicPeriod === null ? null : jsx.jsx("span", { className: "balance-footer__sep", children: "•" }),
                classicPeriod,
              ],
            }),
          ],
        }), undefined, undefined, rowInteractions);
      }
      return withPanel(jsx.jsxs("div", {
        className: "balance-footer balance-footer--stacked" + footerEnterClass, id: "balance-footer-root",
        children: [
          // 抹除层覆盖整块显示区（today 行 + meta 行 + 时段条）：白条经过哪里，哪里才显影
          waveNode,
          periodNode === null
            ? jsx.jsx("span", { className: "balance-footer__spacer" })
            : periodNode,
          jsx.jsx("span", {
            className: "balance-footer__value" + (low ? " balance-footer__value--low" : " balance-footer__value--healthy") + valueDensity,
            // key 绑定 waveSeq：只有右键手动刷新才 +1 → 重挂 → 白光把金额重新擦一遍。
            // 自动刷新（60s 轮询 / 对话完成触发的 fetch）不动 waveSeq，所以不会擦，
            // 数字继续走下面那套逐位滚动 —— 两套动效完全分开（2026-10-30 用户要求）。
            children: jsx.jsx("span", {
              className: "balance-footer__reveal"
                + (settings.refreshWave === false ? " balance-footer__reveal--off" : "")
                // 擦除动画的闸门：只有 revealSeq 真的 +1 过（手动刷新 + 金额确实变了）
                // 才挂，重挂时 revealSeq 归 0 → 不挂 → 不会凭空重播一次「扣费动画」。
                + (revealSeq > 0 ? " balance-footer__reveal--animate" : ""),
              // key 用 `revealSeq`：**只有「手动刷新 + 金额真的变了」才 +1**，值没变就绝不重挂、
              // 绝不擦（用户 2026-10-31：「手动刷新如果余额变了就变啊，没变就不要硬变」）。
              // 白光（.balance-footer__wave）仍然是每次右键必扫，它才是「你点了」的固定反馈。
              key: "reveal-" + revealSeq,
              children: [
                // 底层（常显）：光条没扫到的区域就是它，所以内容不会先消失再长出来。
                jsx.jsx("span", {
                  className: "balance-footer__reveal-base",
                  children: revealBaseRef.current !== null ? revealBaseRef.current : totalText,
                }, "base"),
                // 上层：被 clip-path 从左边擦开的那一层，光条走到哪，哪才盖住底层。
                jsx.jsx("span", {
                  className: "balance-footer__reveal-sweep",
                  // 滚动格与「本会话消耗」共用 renderRollCells —— 两处必须逐格一致。
                  // 静态时就地渲染同一套逐字格（from === to），宽度与滚动态完全相等；
                  // 外层 key 恒定，只有变化的格子换 key 重挂，滚动结束不会整串重挂闪一下（2026-10-31）。
                  children: jsx.jsx("span", {
                    key: "f",
                    children: renderRollCells(
                      rollCells === null ? buildRollCells(totalText, totalText) : rollCells,
                      "f" + (rollCells === null ? "" : roll.at),
                      // 播完就定格：摘掉 animation 声明，展开侧栏不再重播
                      roll !== null && roll.done === true,
                    ),
                  }),
                }, "sweep"),
              ],
            }),
          }),
        ],
      }), undefined, undefined, rowInteractions);
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
      // `useProjection` 是 DSH 通过 slot props 传进来的**可选** hook。
      // 原来写成 `typeof useProjection === "function" ? useProjection("tokenUsage") : undefined`
      // —— 条件调用 hook，同一个合规问题（判定恒定，故运行期没错，但规则上一旦变就崩）。
      // 改成先落到恒定函数再无条件调用：缺失时 useProjectionFallback 返回 undefined，
      // 和原来的分支返回值一模一样，行为零变化。
      const projectionHook = typeof useProjection === "function" ? useProjection : useProjectionFallback;
      const usage = projectionHook("tokenUsage");
      // 分时段分桶按「会话 → 分桶」存档。切换会话时 React 不会重建组件，旧会话的分桶
      // 会留在 state 里；不带会话归属就会拿上一个会话的金额当本会话显示
      // （切对话瞬间金额先跳到别的数字、再跳回正确值——2026-10-30 反馈）。
      // 存成表而不是单值：来回切会话时命中缓存，立刻就是正确金额，不闪。
      const SPLIT_CACHE_MAX = 32;
      const [splitMap, setSplitMap] = react.useState(() => ({}));
      // splitMap 的镜像：下面那个请求 effect 需要知道「这个会话问过没有」来决定用
      // 首挂载延迟还是 debounce 延迟，但直接把 splitMap 放进依赖会让每次响应都重跑 effect
      // （响应 → setSplitMap → effect 重跑 → 再请求），死循环。用 ref 读当前值。
      const splitMapRef = react.useRef(splitMap);
      splitMapRef.current = splitMap;
      // 消耗明细面板：**点击展开**（对齐 DSH 原生「会话统计」的交互——点开切换 + 选中态 + portal 浮层）
      const [detailsOpen, setDetailsOpen] = react.useState(false);
      const detailsAnchorRef = react.useRef(null);
      const detailsPanelRef = react.useRef(null);
      // 定位与"点外部关闭"复用 DSH primitives 的 hook，行为/视觉都与原生浮层一致。
      // hook 本身在模块级已规范化成「恒定可调用」（缺失时是 no-op，返回 null），
      // 所以这里**无条件调用**，不再写在条件分支里 —— 见模块顶部「可选 hook 的恒定点」。
      const anchoredPosition = useAnchoredPositionHook({
        open: detailsOpen,
        anchorRef: detailsAnchorRef,
        panelRef: detailsPanelRef,
        side: "top",
        gap: 6,
        margin: 8,
      });
      useDismissOnOutsidePointerHook(detailsAnchorRef, detailsOpen, setDetailsOpen, detailsPanelRef);
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

      // 切会话的第一帧：projection 里的 usage 可能还是上一个会话的，这一帧算出来的金额
      // 会属于**旧对话**（用户 2026-10-30 反馈「点对话之前会显示余额，而且这个余额不是正确余额」）。
      // 判据：sessionId 变了、usageKey 没跟着变 → usage 还没换过来 → 这一帧不显示数字。
      // 只影响 1 帧（下一帧 effect 就更新 stamp），不会造成可见停顿。
      const usageStampRef = react.useRef({ sessionId, usageKey });
      const staleUsage =
        usageStampRef.current.sessionId !== sessionId && usageStampRef.current.usageKey === usageKey;
      react.useEffect(() => {
        usageStampRef.current = { sessionId, usageKey };
        // ⚠️ 必须带依赖（2026-10-31 第二十二轮审计）：原来没有依赖数组，
        // 每个 chunk / 输入框每次按键引起的重渲染都会跑一遍并新建对象。
      }, [sessionId, usageKey]);

      // 解析本会话使用的模型，并按模型刷新定价（/balance-api?model=...）
      //
      // ⚠️ 2026-10-31 性能修复：原来这里只要 `resolveSessionModel` 返回非空就
      // `fetchBalanceData()`，而依赖是 [sessionId, usageKey] —— `usageKey` 是 token 总数，
      // **流式输出时每来一个 chunk 就变一次**。`resolveSessionModel` 命中缓存时依旧返回
      // 模型名（不是 ""），于是早退条件永远不成立 → **每个 token 打一次 /balance-api**，
      // 而那条接口每次都要真去查官方余额（实测 419ms）。一个十秒回复能把官方接口打几十次，
      // 服务端排队后整体变慢 —— 用户 2026-10-31 就是问这个：「以前没这么慢的啊」。
      // 现在用 ref 记住"已经为哪个会话的哪个模型刷过定价"，只有模型真的换了才重发。
      const pricingModelRef = react.useRef("");
      react.useEffect(() => {
        let disposed = false;
        resolveSessionModel(sessionId).then((resolved) => {
          if (disposed || resolved === "") return;
          // key 里带 sessionId：切会话时即使模型名相同也要重新取一次定价
          const stamp = String(sessionId) + "\u0000" + resolved;
          if (pricingModelRef.current === stamp) return;
          pricingModelRef.current = stamp;
          fetchBalanceData().catch(() => {});
        });
        return () => {
          disposed = true;
        };
      }, [sessionId, usageKey]);

      // 会话 token 总量变化（新消息/新消耗）时，拉取服务端分时段 usage，跨时段精确计费
      // 同时"对话完成"即刷新一次余额（token 变化 = 一条新回复落库）
      //
      // ⚠️ 这条请求服务端要**解压会话持久化文件**（本机实测：35 MB 会话 = 19331 帧、
      // 解压 134 MB、单次 723 ms，同步 CPU）。和余额请求同时发出去时两者互相拖，
      // 首屏就要等它 —— 这就是「插件加载慢 + 掉帧」的直接来源。
      //
      // 原来这里等 600ms 才发，理由是「错开首屏那一下」。但那 600ms 是**纯客户端空等**：
      // 发一条 fetch 本身不耗 CPU，真正贵的是服务端解压，而那是服务端自己的线程、
      // 迟早要做。等 600ms 只是把同一件事推后，用户却实打实多等半秒。
      //
      // ⚠️ 2026-10-31 性能修复（第二处）：这个 effect 的依赖同样含 `usageKey`，
      // 而 `usageKey` 在流式输出时每来一个 chunk 就变一次。原来固定 80ms 延迟 →
      // chunk 间隔一旦超过 80ms 就会连续发 `?session=`，而这条请求会让服务端
      // **整份解压会话 zstd（42 MB 实测 ~900ms 同步 CPU）**，几个窗口叠起来足以把界面拖死。
      // 现在按「问过没有」分流：
      //   · 首挂载（该会话从没问过）→ 80ms 立刻发，用户第一次看这个会话要快；
      //   · 已问过（流式进行中的反复变化）→ 600ms **debounce**：每次变化都 clearTimeout
      //     重排，流式期间一个包都不发，等输出停下来才问一次。
      //     不能简单把延迟调到 600ms —— 那会把首屏也一起推迟半秒（正是上一轮犯过的错）。
      // ── 进场：每「换进一个对话」算一次新进场 ────────────────────────────────
      // 用户 2026-10-31 第十八轮：「怎么点击过的对话只有展开动画 没有加载动画了」。
      // 之前把「出过数」「开过窗」都记成整页生命周期内的永久事实，于是点回任何看过的对话
      // 都直接显示旧数字、一个动画都没有。真正要挡的只有一件事：
      // **同一个对话内部的重挂/重渲染不许把动画从头再放一遍**（折叠展开侧栏就属于这种）。
      // 所以拿模块级台账记「当前这个对话是第几次进场」，判据是「会话 id 换了没有」：
      //   · 点进另一个对话（含点回看过的）→ 改台账 + 清掉该会话的就绪/开窗记忆 → 重新进场；
      //   · 从插件页 / 其它视图点回**同一个**对话（会话 id 没变）→ 也算进场，
      //     靠「离开过对话」的标记（markCostReentry）把台账清成 fresh，见下面 costMountRef；
      //   · 同一对话里重挂（侧栏折叠展开、DSH 重渲染 composer）→ 台账不变 → 什么都不重放。
      // ⚠️ 这个 effect 必须声明在下面那个 ?session= 请求 effect **之前**：
      // 进场要把「同一 usageKey 不再问」的去重记录清掉，让请求真发出去 —— 否则请求被去重跳过、
      // 数据永远是缓存里那一份，"加载动画"就永远等不到它该等的东西。
      // 「这个对话已经出过数」只记**一个槽**（最后出过数的那个会话 id），不按会话各存一条。
      // 这不是省内存，是语义：进场 = 「换进一个对话」，只要槽里不是当前会话，就得重新演一遍
      // 迷雾 → 数据到位 → 开窗 → 定格。
      // ⚠️ 2026-11-01 用户第三次反馈同一个症状：「从侧边栏点进对话的时候 不会触发加载动画
      // 并且余额是从 90 跳到 115」。根因就是这里曾经是一本**按会话永久记忆**的 Set：任何看过
      // 一次的对话，之后每次点回去都被判成「已就绪」→ 迷雾整个跳过 → 先露出旧值（或本地投影：
      // 不分 era、不含子代理，¥90 那一档就是这么来的），等服务端结果回来再直接跳到 ¥115。
      // 单槽的语义正好是「这一次进场」，和下面开窗那本 cost-reveal-played 完全同构 ——
      // 两本账各用一个槽，就不会再出现「迷雾按会话记、开窗按槽记」那种互相打架的状态。
      // 键名是单数（cost-ready-session），旧的多会话键名已废弃。
      // ⚠️ 再从别的视图点回**同一个**对话也算一次新进场：那时会话 id 没变，
      // 下面那条 `costEpisodePrev !== sessionId` 判不出来 → 迷雾/开窗全被跳过。
      // 所以先看有没有「离开过对话」的标记（见 markCostReentry），有就当场把台账按
      // 「换会话」处理一遍，让这一次挂载从第一帧起就是 fresh。
      // ⚠️ 必须只做一次（ref 守卫）。若每次渲染都清一遍，`costEpisodeFresh` 会永远为真，
      // sessionReady 恒假 —— 迷雾再也收不起来，一直转圈。
      const costMountRef = react.useRef(false);
      // 「视图没卸载、只是被切走」时靠它把重新进场推一次（见下面的兜底 effect）。
      // 它在请求 effect 的依赖里（见 `}, [sessionId, usageKey, costReentrySeq]`）：
      // bump 一次 = 重跑一次 `?session=`。⚠️ 光 bump 不请请求是不行的 —— 那只让
      // `costEpisodeFrom` 和 `splitFor` 一直指向同一个对象，迷雾死等 4 秒兜底。
      const [costReentrySeq, setCostReentrySeq] = react.useState(0);
      // 「这一帧本该渲染消耗行吗」—— 由渲染体每帧写入，供两条离场探测读。
      // ⚠️ 判离场只能用它做前提（2026-11-01 审计 P1）：`!usage`（新会话还没装载）、
      // 零 token、设置里关掉消耗行 这三种情况**本来就不渲染** `.balance-usage-line`，
      // 把它们当成"离开对话"会让流式期间行短暂缺席也触发一次假进场 → 动画无端重播。
      const lineRenderableRef = react.useRef(false);
      if (costMountRef.current === false) {
        costMountRef.current = true;
        if (takeCostReentry()) {
          animWrite("cost-episode", "");
          animWrite("cost-ready-session", "");
          animWrite("cost-reveal-played", "");
        }
      }
      const costEpisodePrev = animRead("cost-episode");
      const costEpisodeFresh = sessionId != null && sessionId !== "" && costEpisodePrev !== sessionId;
      const splitNow = sessionId ? splitMap[sessionId] || null : null;
      // 「这次进场开始时手上那份 split」。等它被新数据换掉，就说明这一次的加载结束了。
      // 用它而不是计时器：缓存命中时也能在响应回来那一刻准时收雾，不靠猜时间。
      const [costEpisodeFrom, setCostEpisodeFrom] = react.useState(splitNow);
      usePrePaintEffect(() => {
        if (!costEpisodeFresh) return;
        animWrite("cost-episode", sessionId);
        // 这一次进场要重新演：迷雾 + 开窗都得重现（单槽清空 = 抹掉「已出数」的记忆）。
        animWrite("cost-ready-session", "");
        animWrite("cost-reveal-played", "");
        // 清掉去重记录 → 下面那个 effect 会真的发一次 ?session=（服务端有指纹缓存，没变就是纯读）。
        const askedMap = globalThis.__balanceUsageAsked;
        if (askedMap instanceof Map) askedMap.delete(sessionId);
        setCostEpisodeFrom(splitNow);
      }, [costEpisodeFresh, sessionId, splitNow]);
      // 卸载后探测「是不是真的离开了对话」——离开才打标记，让下一次挂载重新进场。
      // ⚠️ 这个定时器故意不在 cleanup 里取消：卸载之后正是它该跑的时候。
      // ⚠️ 前提是「刚才真的在显示数字」（lineRenderableRef）。本来就没渲染行的时候
      // 查不到行是必然的、不是离开的证据 —— 新会话 usage 还是 null 时改个设置就会卸载，
      // 那时打上标记，之后任意一次重挂都会无端重播（2026-11-01 审计 P1-2）。
      react.useEffect(() => () => {
        setTimeout(() => {
          if (typeof document === "undefined" || typeof document.querySelector !== "function") return;
          if (!lineRenderableRef.current) return;
          if (document.querySelector(".balance-usage-line") === null) markCostReentry();
        }, COST_REENTRY_PROBE_MS);
      }, []);
      // 兜底：视图**没有卸载**、只是被切走藏起来（display:none / 被换出视口）时，
      // 上面那条卸载探测不会跑，点回来照样一声不响。这里按「自己的消耗行还占不占位置」
      // 判断离场：连续两次量不到盒子才算离开，再量到盒子就把这次进场重做一遍。
      // ⚠️ 阈值不能只取一次 —— 布局切换的那一帧本来就量不到盒子，取一次会误判成离场。
      react.useEffect(() => {
        if (typeof document === "undefined" || typeof document.querySelector !== "function") return undefined;
        let hiddenTicks = 0;
        const timer = setInterval(() => {
          // ⚠️ 前提：这一帧本该渲染消耗行。`!usage`（新会话还没装载）/ 零 token /
          // 设置里关掉消耗行 这三种情况行本来就不存在，量不到盒子**不是**离开的证据；
          // 把它们算成离场，等于让「流式期间行短暂缺席」触发一次假进场（动画无端重播）。
          if (!lineRenderableRef.current) {
            hiddenTicks = 0;
            return;
          }
          const line = document.querySelector(".balance-usage-line");
          const visible = line !== null && line.getClientRects().length > 0;
          if (!visible) {
            hiddenTicks += 1;
            return;
          }
          if (hiddenTicks < 2) {
            hiddenTicks = 0;
            return;
          }
          hiddenTicks = 0;
          animWrite("cost-episode", "");
          animWrite("cost-ready-session", "");
          animWrite("cost-reveal-played", "");
          const askedMap = globalThis.__balanceUsageAsked;
          if (askedMap instanceof Map && sessionId != null) askedMap.delete(sessionId);
          // 触发一次渲染，让上面那段「进场」判定重新跑（台账已清成 fresh）
          setCostReentrySeq((n) => n + 1);
        }, 900);
        return () => clearInterval(timer);
      }, [sessionId]);
      react.useEffect(() => {
        if (usageKey === 0) return;
        // 空 sessionId 直接不参与（2026-11-01 审计 P2）：fetchSessionUsage 会返回 null，
        // 但表里会留下一个 "" 键 + 去重记录，白占淘汰槽位，还会把第 33 个真实会话挤出去。
        if (sessionId == null || sessionId === "") return;
        // ⚠️ 「这个会话的用量在第几版 token 数上问过」——记在**模块级**，不随组件卸载丢失。
        // 折叠/展开侧栏会让 BalanceFooter 卸载重挂 → 组件内 ref/state 全部归零 →
        // 这个 effect 会重新跑一遍并立刻发 `?session=`，而那条请求会顺带刷新今日缓存；
        // 值一变，今日和余额的数字就当场滚一次 —— 用户看到的就是
        // 「点击侧边栏按钮导致刷新异常，今日消耗和余额数字滚动」（2026-10-31 反馈）。
        // 现在按 `usageKey` 去重：token 数没变就绝不再问，重挂也不问。
        //
        // ⚠️ **只允许在请求真正发出之后才记录**（2026-10-31：「会话消耗一直在加载」）。
        // 曾经在 effect 顶部就 `set`，而下面 `fire` 里的 timer 在 `disposed` 时会直接 return——
        // 记录写了、请求没发，此后同一 usageKey 被永久跳过，本会话消耗永远拿不到数据、
        // 一直停在加载态。所以把 set 挪进 timer 内部、紧随 `disposed` 判断之后。
        const usageAskedMap = globalThis.__balanceUsageAsked instanceof Map
          ? globalThis.__balanceUsageAsked
          : (globalThis.__balanceUsageAsked = new Map());
        // ⚠️ **去重判据必须同时确认「结果真的还在」**（2026-10-31：「还是会一直处在加载动画
        // 不知道怎么复现的」）。
        // 原来只判 `usageAskedMap.get(sessionId) === usageKey` 就 return，而两者生命周期不同：
        //   · usageAskedMap → globalThis，跨挂载存活
        //   · splitMap      → useState，只在当前挂载内有效
        // 折叠/展开侧栏、切布局、改设置都会让 BalanceFooter 卸载重挂 → splitMap 清空、
        // usageAskedMap 还留着记录 → 这里直接 return，请求永远不发 → splitAsked 恒为 false
        // → costPending 恒为 true → 本会话消耗永久停在加载动画。
        // 重挂本身是常态，所以这个 bug 看起来「不知道怎么复现」，其实只要重挂就中。
        // 补上 haveResult 之后：结果丢了就重问一次，代价只是那一次解压。
        const haveSplitResult = Object.prototype.hasOwnProperty.call(splitMapRef.current, sessionId);
        if (usageAskedMap.get(sessionId) === usageKey && haveSplitResult) return;
        let disposed = false;
        // `asked` 也走模块级：重挂后仍记得「问过」，走 600ms debounce 而不是首挂载快路径。
        const askedSessions = globalThis.__balanceAsked instanceof Set
          ? globalThis.__balanceAsked
          : (globalThis.__balanceAsked = new Set());
        const asked = askedSessions.has(sessionId) || Object.prototype.hasOwnProperty.call(splitMapRef.current, sessionId);
        askedSessions.add(sessionId);
        let timer = null;
        let poll = null;
        // ⚠️ **不要 abort**（2026-10-31 第十一轮：「我快速点了几个对话就这样了，
        // 只有在对话消耗刷新的时候才会在刷新过了的对话正常显示」）。
        // 这个 effect 依赖 [sessionId, usageKey]，快速切会话时它会反复重跑，
        // 每次 cleanup 都把正在飞的 `?session=` 中断掉 —— 结果永远拿不到，
        // splitMap 里永远没有该会话的数据，于是「快速点几个对话就一直加载」。
        // 正确的做法是让请求自然跑完：结果按 sessionId 落表（下面的 setSplitMap
        // 不判断 disposed），切回来时立刻就有数。代价只是服务端那一次解压不会白省，
        // 但那本来就是它该做的工作，比"永远加载不出来"好得多。
        const fire = () => {
          if (disposed) return;
          // 已问过 → 600ms debounce（流式期间每次 usageKey 变化都会重跑本 effect 并清掉这个
          // timer，所以一个包都不会发，等输出停下来才问一次）。
          // 首挂载 → SESSION_USAGE_DELAY_MS，只留够画首帧。
          timer = setTimeout(() => {
            if (disposed) return;
            // 到这里才记录：请求确实要发了。写在 effect 顶部会让「被取消的那次」也留下
            // 记录，于是同一 usageKey 永远不再重试 —— 会话消耗卡在加载态。
            usageAskedMap.set(sessionId, usageKey);
            fetchSessionUsage(sessionId).then((u) => {
              // ⚠️ `disposed` 只表示「这一轮 effect 失效」（切会话 / 依赖变化），
              // **不表示组件卸载，更不表示这个结果没用**。
              // 2026-10-31：「点击 A 对话还在加载，我这时候立即点击 B 对话 就能卡出这个 bug」——
              // A 的请求已发出，切到 B 后 A 的 effect 被清理，响应回来若直接 return，
              // splitMap 里就没有 A 的数据；而 A 的去重记录还在，再点回 A 会命中去重、
              // 永不重发 → 一直加载。
              // 所以：结果照写进 splitMap（它按 sessionId 索引，对全部会话有效），
              // 只跳过「扣费/今日刷新」这类只该由当前会话触发的事。
              // ⚠️ **必须等今日值定型（settled）之后才允许由 ?session= 触发刷新**
              // （2026-10-31：「打开 dsh 之后没有运行的对话 但是它自己跳动了 就很奇怪」）。
              // 原因：`?session=` 的响应里带着服务端用 updateTodayCostWithSession 增量算出的
              // today，而 `?today=1` 那边还有一条「快照 → 精算」的补拉。两路同时写同一个数，
              // 用户什么都没做，数字就自己变了两次。
              // 定型前只让 `?today=1` 这一条路径有机会改值 —— 它自己是串行的（partial → 补拉）。
              if (!disposed && todayCache.settled && u && u.today && typeof u.today.cost === "number") {
                void fetchTodayOnce(false);
              }
              // 拿不到也记一条（usage:null），表示"这个会话已经问过了"，按本地估算走。
              // ⚠️ 这里**不判断 disposed**：`splitMap` 按 sessionId 索引、对全部会话有效，
              // 切走后收到的结果照样要落表，否则点回去还得再等一轮解压。
              // ⚠️ **拿到 null 时不许立刻把表里那份可用结果冲掉**（2026-11-01：「余额从 90 跳到 115」）。
              // 界面本来有上一次算好的分桶（era 分价 + 子代理都在里面）。一律覆盖成 null →
              // `splitUsable` 变假 → 整行退回**本地投影**（不分 era、不含子代理，跨调价点的大会话
              // 被压低近 20%），下一次响应再换回真值 —— 用户看到的就是「没有加载动画，数字从 90 跳到 115」。
              // 但也不能无限期保留（见 SPLIT_KEEP_MS）：服务端这次说拿不到，可能意味着会话已被
              // 压缩/清空、或者持久化文件读失败，永久留旧值就是安静地显示错数。
              const nowMs = Date.now();
              const nextEntry = u && u.usage != null
                ? { usage: u.usage, subagentUsage: u.subagentUsage ?? null, team: u.team ?? null, at: nowMs }
                : null;
              setSplitMap((prev) => {
                const old = prev[sessionId];
                const oldUsable = old != null && old.usage != null
                  && ((Array.isArray(old.usage.byModel) && old.usage.byModel.length > 0)
                    || (old.usage.totalTokens ?? 0) > 0);
                // null 结果 + 表里有可用值 + **还没过保鲜期** → 值不动，但换一个新的条目对象。
                // ⚠️ 绝不能直接 `return prev`（2026-11-01 审计 P0）：进来的等待判据是
                // `costEpisodeFrom === splitFor`（见 costEpisodeAwaiting），靠"响应到达 →
                // splitFor 换身份"来判断这一次进场问完了。原样返回 prev 的话身份永远不变 →
                // 点回一个看过的大对话、恰好这一趟服务端回 `usage: null` → 迷雾死等 4 秒兜底，
                // 散开时数字和进场前一模一样。
                // 现在：条目对象换新（身份变 → 立刻收雾、接着开窗），`usage` 仍是原来那个引用
                // （金额、峰谷拆分、滚动基准全不变），`at` 也沿用旧值（保鲜期不因"又空跑一趟"而续命）。
                // ⚠️ 也不能写成 `return { ...prev }` —— 那样 `prev[sessionId]` 还是同一个引用，等于没修。
                if (nextEntry === null && oldUsable && nowMs - (old.at ?? 0) < SPLIT_KEEP_MS) {
                  return { ...prev, [sessionId]: { ...old } };
                }
                const next = { ...prev, [sessionId]: nextEntry ?? { usage: null, subagentUsage: null, team: null, at: nowMs } };
                // 对象保持插入顺序，最旧的在最前；超出上限就淘汰它（避免长会话列表无限增长）
                const keys = Object.keys(next);
                for (let i = 0; i < keys.length - SPLIT_CACHE_MAX; i += 1) {
                  // ⚠️ **必须同步删掉去重记录**（2026-10-31：「点了几个会话之后就开始一直加载了，
                  // 别的对话也是的」）。原来只删 splitMap 条目、usageAskedMap 还留着，
                  // 那个会话再进来时命中去重 → 请求被跳过 → splitMap 里又没有它的数据 →
                  // costPending 永远为 true，本会话消耗一直转圈。
                  // 上限当时是 6，所以「点几个会话」就必然触发。
                  delete next[keys[i]];
                  if (typeof usageAskedMap?.delete === "function") usageAskedMap.delete(keys[i]);
                  // ⚠️ `__balanceAsked` 也必须一起淘汰（2026-11-01 审计 P0）：它只增不删，
                  // 而 `splitMap` 只有 SPLIT_CACHE_MAX(32) 个槽。超过 32 个会话之后，
                  // 点回任何老会话都会命中 `asked` → 走 600ms debounce 而不是首挂载的 80ms，
                  // 每次切回都白等 520ms。淘汰口径跟着 splitMap 一起走，两边永远同一个集合。
                  askedSessions.delete(keys[i]);
                  if (typeof globalThis.__balanceAsked?.delete === "function") {
                    globalThis.__balanceAsked.delete(keys[i]);
                  }
                }
                return next;
              });
            }).catch(() => {
              // 请求本身失败（网络 / 后端异常）时把去重记录撤掉，否则同一 usageKey
              // 再也不会重试，本会话消耗会一直停在加载态。
              usageAskedMap.delete(sessionId);
              // ⚠️ **还要给 splitMap 写一条占位结果**（2026-10-31）。
              // 只删去重记录不够：对话已经结束、`usageKey` 不再变化时这个 effect 不会重跑，
              // 于是没有任何人再去发请求 → `splitAsked` 恒 false → 永久加载。
              // 写 `{usage:null}` 让 `splitAsked` 立刻成立，UI 退出加载态、改走本地估算显示
              // 一个数字；下次 usageKey 变化时去重记录已删，会正常重试拿到真实值。
              setSplitMap((prev) => (Object.prototype.hasOwnProperty.call(prev, sessionId)
                ? prev
                : { ...prev, [sessionId]: { usage: null, subagentUsage: null, team: null } }));
            });
            fetchBalanceData().catch(() => {});
          }, asked ? 600 : SESSION_USAGE_DELAY_MS);
        };
        if (asked) {
          fire();
        } else {
          // 首挂载：**等余额先回来再发**。
          // 余额是纯网络（实测 419ms）；`?session=` 可能要服务端整份解压会话 zstd
          // （42 MB 实测 ~900ms 同步 CPU）。两者同时出发会互相拖，首屏反而更慢 ——
          // 曾经用固定 600ms 硬等是为了这个，但那 600ms 不管余额快慢都照等。
          // 现在跟着余额的真实就绪时刻走：余额一到就发，和今日那套同一个判据。
          const startedAt = Date.now();
          const waitBalance = () => {
            if (disposed) return;
            const ready = balanceCache.status !== "loading" || balanceCache.balance !== null;
            if (ready || Date.now() - startedAt >= 1500) { fire(); return; }
            poll = setTimeout(waitBalance, 100);
          };
          waitBalance();
        }
        return () => {
          disposed = true;
          if (timer !== null) clearTimeout(timer);
          if (poll !== null) clearTimeout(poll);
        };
        // ⚠️ `costReentrySeq` 必须在依赖里（2026-11-01 审计）：它是「视图没卸载、只是被切走
        // 又切回来」这条路唯一的抓手。不进依赖就只有台账被清、没有任何请求起飞 →
        // `splitFor` 身份不变 → `costEpisodeAwaiting` 的 `costEpisodeFrom === splitFor` 恒真 →
        // 迷雾死等 4 秒兜底才散，白白露一段"卡住"的动画。
        // 误触发已知会放大成真请求，所以两条离场探测都加了 `lineRenderableRef` 前提（见声明处）。
      }, [sessionId, usageKey, costReentrySeq]);

      // ── 金额与逐位滚动 ────────────────────────────────────────────────────
      // ⚠️ 这段是**计算 + hooks**，必须写在下面两处早退之前：hook 不能跟在条件 return 后面，
      // 否则「usage 为 null 的帧」与「有 usage 的帧」hook 数量不同，React 会直接抛错。
      // 所以 splitFor / split / splitUsable / cost 在这里算，早退之后不再重复定义。
      const splitFor = sessionId ? splitMap[sessionId] || null : null;
      const split = splitFor ? splitFor.usage : null;
      const subagentUsage = splitFor ? splitFor.subagentUsage : null;
      // 智能体团队（Agent Teams）的 roster + 按人头费用。
      // 服务端从本会话的 team/member 事件解出来，没团队就是 null —— 整块不渲染。
      const team = splitFor ? splitFor.team ?? null : null;
      const teamMembers = team && Array.isArray(team.members) ? team.members : [];
      const teamCount = teamMembers.length;
      const teamCost = team && Number.isFinite(team.cost) ? team.cost : 0;
      // 服务端分桶可能"非 null 但为空"（拿不到该会话事件），此时必须回退本地投影估算，否则金额会显示 ¥0.0000
      const splitUsable =
        split != null && ((Array.isArray(split.byModel) && split.byModel.length > 0) || (split.totalTokens ?? 0) > 0);
      // 「这个会话问过服务端没有」——没问过就还在算。
      // 本地估算此时只是临时值：它把**整段历史**按当前时段价一次性乘（高峰窗口里就是 ×2），
      // 而服务端是按每条消息实际发生的时段分桶。所以高峰时段点进旧会话必然先高后低
      // （2026-10-30 实测：先显 ¥107、随即跳到 ¥69，比值 1.55 正好是「一半历史在空闲时段」）。
      // 与其先闪一个会变的数字，不如先留空，拿到结果后一次到位。
      const splitAsked =
        sessionId != null && sessionId !== "" && Object.prototype.hasOwnProperty.call(splitMap, sessionId);
      const costPending = !splitAsked && usageKey > 0;
      // ⚠️ 这一行必须声明在下面那个 shouldMarkReady 的 **deps 数组**之前（2026-10-31 第十九轮：
      // 「我的消耗呢」—— 整行消失）。上一版把它写在 effect 之后，React 求值 deps 数组时
      // 这个 const 还没初始化 → `Cannot access 'costEpisodeAwaiting' before initialization`
      // → 组件抛错 → DSH 把这个 slot 整块吞掉，界面上连「本会话消耗」几个字都没有。
      // 判据是 split 对象的**身份**：进场时记下手上那份缓存，新响应会写进一个新对象，
      // 一旦换了身份就说明这一次真的问完了 → 收雾、接着播开窗。
      // ⚠️ 判据里**必须含 costEpisodeFresh**（2026-10-31 第十九轮：「顺序错了…先展开然后再加载」）。
      // 切会话那一帧 `costEpisodeFrom` 还停在上一个对话的对象上，只比身份会算出「不在等待」→
      // 先渲染出数字并把开窗授权领掉，下一帧才变成迷雾 —— 顺序整个反过来。
      // 进场那一帧一律算等待；等 `costEpisodeFrom` 落成本次进场起点之后，再由身份判断接管。
      // ⚠️ 必须带一条**超时兜底**（2026-10-31 第二十一轮审计）：
      // 判断"数据回来了"靠 split 对象换身份，可请求失败时 catch 分支只在「表里没有该会话」时
      // 才写占位；点回一个**看过的**对话、而那次请求失败 → 对象永远不换 → 迷雾永远不收，
      // 界面上就是一直转圈、数字再也不出现。4 秒后放弃等待，退回缓存里那个数字。
      const [costEpisodeExpired, setCostEpisodeExpired] = react.useState(false);
      usePrePaintEffect(() => {
        if (!costEpisodeFresh) return;
        setCostEpisodeExpired(false);
      }, [costEpisodeFresh]);
      // ⚠️ `costEpisodeFresh` 必须在 expired 之外单独判（2026-10-31 第二十二轮审计）。
      // 上一趟进场超时过（expired=true）之后，再切进任何对话：首个 commit 里 expired 还是 true，
      // 若它参与进来，这一帧就不是「等待」→ 先渲染数字、当场把开窗授权领掉，layout effect
      // 才把 expired 翻回 false，之后才进迷雾 —— 数据回来时授权已用完，数字凭空跳出。
      // 进场那一帧永远算等待；超时只用来结束「同一次进场里」的等待。
      const costEpisodeAwaiting = sessionId != null && sessionId !== ""
        && (costEpisodeFresh || (!costEpisodeExpired && costEpisodeFrom === splitFor));

      // 「服务端明确说拿不到这个会话的分桶」（`usage: null`）——
      // 这一帧显示的是**本地投影**：不分 era、不含子代理、倍率按当前时段统一乘，
      // 跨过调价点的大会话会被压低近 20%（用户看到的 ¥90 那一档就是它）。
      // 所以它既不算「已出数」，也不能在迷雾退场后被当成最终值。
      const splitUnresolved = splitAsked && splitFor != null && split == null;
      const costProvisional = splitUnresolved && !costEpisodeExpired;

      // 「这个对话已经出过数字了」—— 出过就不再显示加载动效（但记忆只属于**这一次进场**）。
      // 用户 2026-10-31：「如果对话在工作时，实时的对话消耗会导致会话加载动效重新播放，这样看起来很割裂」。
      // 每轮对话结束 usageKey 都会变、就会重新请求，任何一个让 splitAsked 短暂为 false 的帧
      // （响应被丢弃、请求重排、缓存未就绪）都会让迷雾态重新插入 DOM，CSS 动画从 0 秒重播一遍。
      // 加载动效的语义是「还没算出来」，不是「正在刷新」—— 所以要记，但只记**当前这一次进场**。
      // ⚠️ 记忆必须是**模块级**的（2026-10-31 第十五轮）：折叠/展开侧栏会让 BalanceFooter 卸载重挂，
      // 组件内 ref/state 全归零 → 迷雾重新插入 DOM、开窗从 0 重播。用今日那本 animLedger。
      // ⚠️ 但记忆只能是**单槽**，绝不能按会话各存一条（2026-11-01 再次反馈）：按会话存等于
      // 「整页生命周期只给每个对话一次」，点回看过的对话就什么都不播、数字直接跳 —— 见进场那一段。
      // 单槽语义 = 换对话（含点回看过的）→ 槽里不是它 → 重新进场；同一对话内重挂/流式刷新 →
      // 槽里就是它 → 不再闪。
      // ⚠️ `!costEpisodeFresh` 不能省（2026-10-31 第二十轮：「先是展开 然后什么都不显示 然后加载」）。
      // 进场那一帧槽里可能还是刚离开的那个对话；只要这一帧算就绪，迷雾就被整个跳过 ——
      // 先渲染出数字、把开窗授权领掉（第一帧看到的是展开），紧接着进场逻辑才清槽、
      // 下一帧才切成迷雾，数据回来时授权已用完 → 数字凭空跳出。
      const sessionReady = sessionId != null && sessionId !== ""
        && !costEpisodeFresh && animRead("cost-ready-session") === sessionId;
      const shouldMarkReady = !costPending && splitAsked && usageKey > 0 && sessionId != null && sessionId !== "";
      // ⚠️ 「已经出过数」的记忆**不许在渲染期写**（2026-10-31 全量审查）。
      // 渲染期改台账在 StrictMode 双调用 / 并发渲染下会写进一次被丢弃的渲染里，
      // 于是这个对话被记成「已就绪」但界面从没出过数 → 加载动效永不再播，一直是空白。
      // 放到 layout effect（paint 之前同步）里写，时序与原意一致。
      usePrePaintEffect(() => {
        // 进场等待期内不许记账（2026-10-31 第十八轮）：进场那一段刚把槽清掉，
        // 这里要是马上写回去，sessionReady 立刻变 true、迷雾被掐掉，又变成"点回看过的对话没动画"。
        // 三个条件都要：costEpisodeFresh 是「进场那一帧」（此刻 episodeFrom 还没设好，
        // costEpisodeAwaiting 可能是 false，光靠它挡不住）；costEpisodeAwaiting 是「还在等数据」；
        // splitUnresolved 是「拿到的是 null、显示的是本地投影」（记账等于把假数字变成已出数）。
        if (!shouldMarkReady || costEpisodeAwaiting || costEpisodeFresh || splitUnresolved) return;
        animWrite("cost-ready-session", sessionId);
      }, [shouldMarkReady, sessionId, costEpisodeAwaiting, costEpisodeFresh, splitUnresolved]);
      // 只有「这个对话在本次进场里还没出过数」才播加载动效；已出过数的，刷新期间保持旧数字不动。
      // ⚠️ 还要并上「本次进场的数据还没回来」（2026-10-31 第十八轮：点回看过的对话要有加载动画）。
      // 缓存命中时不猜时间，靠响应到位的这一刻切换，所以「迷雾 → 开窗」是一条连续的进场动画。
      // costProvisional：服务端给了 null（还在解码 / 读取失败）时也继续保持迷雾，
      // 否则会先显示本地投影的假数字、再跳到真值 —— 就是「90 跳到 115」那一下。
      const costWaiting = costEpisodeAwaiting || costProvisional;
      const showCostLoading = (staleUsage || costPending || costWaiting) && !sessionReady;
      // 等待兜底：4 秒还没等到（请求一直不返回 / 服务端卡住），停止等、退回缓存值。
      // ⚠️ 依赖只留这三个（2026-10-31 第二十二轮审计）：早先 `showCostLoading` 也在依赖里，
      // 而它含 staleUsage / costPending，流式期间每变一次就 cleanup 重排 → 计时器被无限顺延，
      // 卡住的会话永远等不到 expired，兜底等于没写。
      // ⚠️ 判据用 `costWaiting`（进场等待 + 服务端给 null 的临时值）。两者都要能被这 4 秒收掉：
      // 服务端一直返回 null 时迷雾不能永久转圈，超时就退回本地投影那个数字。
      react.useEffect(() => {
        if (!costWaiting || costEpisodeExpired) return undefined;
        const id = setTimeout(() => setCostEpisodeExpired(true), 4000);
        return () => clearTimeout(id);
      }, [costWaiting, costEpisodeExpired, sessionId]);
      // 子代理消耗（2026-10-31：「把字智能体的消费也算上 并且显示在这里」）。
      // 主会话和子代理分开算（各自有 byModel / peak / offpeak 桶），但**合计进同一个数字**：
      // 消耗行金额、明细浮层的「Token 用量」和「本会话金额」都是「含子代理」的口径，
      // 浮层里再用独立几行把子代理自己那一份拆出来，数字可对账。
      // ⚠️ 服务端曾经永远返回 null（枚举路径在 DSH 上必抛），所以这几行的历史行为是
      // 「从来没出现过」—— 如果它们又不出现，先查 lib/index.js 的 sumSubagentUsage。
      // ⚠️ 判据不能只看 `totalTokens`（2026-11-01 审计 P0）：子代理可能**只**用了网页工具
      // （0.005/次，不计 token），那时 totalTokens 为 0 而金额不为 0，整行子代理会被吞掉。
      const hasSubagent = subagentUsage != null
        && ((subagentUsage.totalTokens ?? 0) > 0 || (subagentUsage.webToolCost ?? 0) > 0);
      const subagentCost = hasSubagent ? computeSplitCost(subagentUsage, p, peakMultiplier) : 0;
      const subagentNewTokens = hasSubagent
        ? (subagentUsage.inputTokens ?? 0) + (subagentUsage.outputTokens ?? 0)
        : 0;
      const subagentCount = hasSubagent ? (subagentUsage.sessions ?? 0) : 0;
      const cost = splitUsable
        ? computeSplitCost(split, p, peakMultiplier) + subagentCost
        : computeCost(usage ?? {}, periodAdjustedPricing(p, peakMultiplier)) + subagentCost;
      // 位数由 formatCostText 决定（至少两位小数、千位以下合计不超过 5 位数字），
      // 不再固定 toFixed(4) —— 那个会显示成 ≈ ¥120.2032，宽度不可控且挤到右侧。
      const costText = formatCostText(cost);

      // 逐位滚动：数值一变就翻（和余额胶囊自动刷新共用 buildRollCells/renderRollCells）。
      // usePrePaintEffect 是必须的 —— 等 useEffect（paint 之后）才挂滚动结构的话，
      // 会先渲染一帧纯文本新值，用户看到的就是「数字比动画先出来」（2026-10-30 反馈）。
      // skipCostRoll：切会话/待算/无 usage 时把基准清空，这样下次出现是「首次显示」而不是「从某个值滚过来」。
      // 加载动效风格：决定等待时显示什么、数据到手怎么进场（两种语言不混用）
      const loadingIsText = settings.usageLoadingStyle === "text";
      const skipCostRoll = staleUsage || costPending || !usage || showCostLoading;
      const [costRoll, setCostRoll] = react.useState(null);
      const lastCostTextRef = react.useRef(null);
      usePrePaintEffect(() => {
        const prev = lastCostTextRef.current;
        lastCostTextRef.current = skipCostRoll ? null : costText;
        if (skipCostRoll || prev === null || prev === costText) return;
        setCostRoll({ from: prev, to: costText, at: Date.now() });
      }, [costText, skipCostRoll]);
      // 同上：滚完保持滚动态（forward 停在终点），不要切回静态结构。
      // 只在「整段失效」时清空 —— 切会话 / 待算 / 无 usage 时必须丢弃旧会话的滚动基准，
      // 否则会拿上一个会话的数字当起点。
      react.useEffect(() => {
        if (skipCostRoll) setCostRoll(null);
      }, [skipCostRoll]);
      // 滚完定格：摘掉 animation 声明，展开侧栏不再重播
      useRollSettle(costRoll, setCostRoll);

      // ── 开窗（数字出场）的「只许播一次」闸门，和今日消耗同一套逻辑 ─────────────
      // 用户 2026-10-31 第十五轮：「这个动画的逻辑也跟今日消耗的逻辑一样 不要在触发展开的
      // 动画时 动画重头播放」。今日那边靠 ① 模块级台账判「该不该播」② 播完把 animation
      // 声明整个摘掉（节点不动、但已经没有任何动画可以重播）。这里照抄这两条：
      //   · 台账键按会话隔离：换会话＝新会话，照常开一次窗；同一会话重挂/重渲染绝不再开。
      //   · 授权在 paint 之前落定（usePrePaintEffect），所以带闸门类的那一帧就是首帧，
      //     不会先露一帧「已经开好」的静止态再倒回 0 秒。
      //   · 340ms（280ms 动画 + 60ms 余量）后把类摘掉：类一摘，两条 animation
      //     声明就消失，此后节点怎么重挂都没有动画可重播，落点与动画终点逐像素一致
      //     （mist 的洞本来就是 86%、body 本来就不裁切）。
      // ⚠️ 授权必须**等数字真的要出现那一帧**才发（2026-10-31 第十七轮：「动画彻底消失了」）。
      // 上一版是在组件挂载时就授权记账 —— 但挂载时还在迷雾态（showCostLoading），数字要等
      // 服务端算完才出来，几百毫秒到几秒之后。等数字真出来时台账早被记成"播过"、
      // 闸门类也不再挂，于是那一趟开窗一次都没演过。判据必须带上 showCostLoading：
      // 只有「迷雾已经退场、数字这一帧要渲染」时才算一次出数。
      // ⚠️ 记忆用**单槽**「最后开过窗的会话」而不是按会话各存一条（第十八轮）：
      // 按会话存等于"整页生命周期只给每个对话一次"，第二次点进去什么都不播。
      // 单槽的语义正好是要的那条：换会话 → 槽里的不是它 → 播；同一会话重挂 → 槽里是它 → 不播。
      const costRevealKey = sessionId != null && sessionId !== "" ? "cost-reveal:" + sessionId : "";
      const [costRevealFor, setCostRevealFor] = react.useState("");
      const costRevealOn = costRevealKey !== "" && costRevealFor === costRevealKey;
      const costRevealPlayed = animRead("cost-reveal-played");
      usePrePaintEffect(() => {
        // ⚠️ `!usage` 必须挡掉（2026-10-31 第十八轮：「还是没有」）。挂载时 usage 往往还是
        // null（首屏还没拿到），而那时 staleUsage / costPending 可能都是 false ——
        // showCostLoading 算出来是 false，于是额度被当场领走，而这一帧组件在下面
        // `if (!usage) return null` 直接返回、什么都没渲染。等真数据到了一看：额度已用完，
        // 迷雾那一趟也就永远等不到开窗。判据要覆盖「这一帧到底会不会渲染出数字」：
        // usage 有值 + 不在迷雾 + 不是样式2。
        // loadingIsText（样式2「计算中」）根本不会渲染 reveal 这棵树，同理别烧额度。
        if (showCostLoading || loadingIsText || !usage || costRevealKey === "" || costRevealOn) return;
        if (costRevealPlayed === costRevealKey) return;
        animWrite("cost-reveal-played", costRevealKey);
        setCostRevealFor(costRevealKey);
      }, [showCostLoading, loadingIsText, usage, costRevealKey, costRevealOn, costRevealPlayed]);
      react.useEffect(() => {
        // 依赖是「被授权的那个会话键」而不是任何数值：普通刷新碰不到这个计时器，
        // 只有真的换会话（键变了）才会清掉 —— 与今日那边同一条教训。
        if (costRevealFor === "") return undefined;
        const id = setTimeout(() => setCostRevealFor(""), 340);
        return () => clearTimeout(id);
      }, [costRevealFor]);

      // 智能体团队：队友在跑的时候，**Lead 自己的 token 不变** ——
      // usageKey 不动 ⇒ 上面那条 `?session=` 效果不会重发 ⇒ 团队圆片和人均金额会一直停在
      // 第一次拿到的值上（用户看到的就是「队友干了半天，钱没涨」）。
      // 所以只要这个会话有 team，就每 15 秒自己补一次（绕过 usageAskedMap 去重），
      // 把结果按 sessionId 写回 splitMap —— 与普通响应同一条写入口径，
      // 因此不会重播开窗动画（那个由「已就绪」台账与 cost-reveal-played 按会话把关）。
      // 页面不可见时跳过：后台标签页没人看，白扫一趟 zstd 只是抢主线程。
      react.useEffect(() => {
        if (teamCount === 0) return undefined;
        if (sessionId == null || sessionId === "") return undefined;
        let disposed = false;
        let timer = 0;
        let inFlight = null;
        // 连续几次「拿回来的东西没变」——用来退避。团队挂一整天很常见，
        // 光是「有 team 就每 15 秒问一次」等于 480 次/两小时的白跑，
        // 而队友真正干活时数据每轮都变，会立刻回到 15 秒。
        let quiet = 0;
        let lastSig = "";
        const schedule = (ms) => {
          timer = setTimeout(tick, ms);
        };
        const tick = async () => {
          if (disposed) return;
          // 页面不可见就跳过这一轮（不请求、不计退避），等下一拍再看
          if (typeof document !== "undefined" && document.visibilityState === "hidden") {
            schedule(TEAM_REFRESH_MS);
            return;
          }
          let sig = "";
          // ⚠️ 必须有超时 + abort（2026-11-01 审计 P1）：这条是 setTimeout 递归链，
          // 下一拍只在 await 之后才排。请求挂住（休眠唤醒 / 网络黑洞 / 服务端卡在解压）
          // 整条链就永久断掉 —— 之后该会话的团队金额再也不更新，界面上看不出任何异常。
          const ctrl = typeof AbortController === "function" ? new AbortController() : null;
          inFlight = ctrl;
          const cutoff = setTimeout(() => {
            try {
              if (ctrl !== null) ctrl.abort();
            } catch {
              /* 老运行时没有 abort 就靠 catch 兜着 */
            }
          }, TEAM_FETCH_TIMEOUT_MS);
          try {
            // lite=1：只算本会话 usage + 子代理 + 团队，**不查余额、不碰今日**。
            // 补拉只为更新团队那点数字，没必要连带 419ms 的余额请求。
            const url = "/balance-api?lite=1&session=" + encodeURIComponent(sessionId);
            const res = await fetch(url, ctrl !== null ? { signal: ctrl.signal } : undefined);
            const u = await res.json();
            if (disposed) return;
            if (u && u.ok !== false && u.usage != null) {
              // 指纹：token 总数 + 团队每人（phase/金额/token）。完全一致就不写 splitMap，
              // 免得每 15 秒换一次对象身份、白白重渲染整行。
              const members = Array.isArray(u.team?.members) ? u.team.members : [];
              sig = [
                u.usage.totalTokens ?? 0,
                u.subagentUsage?.totalTokens ?? 0,
                members.map((m) => [m.id, m.phase, Math.round((Number(m.cost) || 0) * 1e4), m.tokens ?? 0]),
              ].join("|");
              if (sig !== lastSig) {
                lastSig = sig;
                quiet = 0;
                // ⚠️ 补拉**不能**用 null 冲掉表里能用的值（2026-11-01 审计 P1）：
                // 服务端那一趟可能是某个子会话读失败、被 catch 成 null 的。整条覆盖 →
                // 子代理行和团队圆片瞬时消失、金额掉一截、下一拍再跳回来。
                // 普通 ?session= 路径有 oldUsable + SPLIT_KEEP_MS 保护，补拉走同一条口径。
                setSplitMap((prev) => {
                  const old = prev[sessionId];
                  return {
                    ...prev,
                    [sessionId]: {
                      usage: u.usage,
                      subagentUsage: u.subagentUsage ?? old?.subagentUsage ?? null,
                      team: u.team ?? old?.team ?? null,
                      at: Date.now(),
                    },
                  };
                });
              } else {
                quiet += 1;
              }
            } else {
              quiet += 1;
            }
          } catch {
            /* 补拉失败（含超时 abort）就等下一轮；界面保留上一份，不闪 */
            quiet += 1;
          } finally {
            clearTimeout(cutoff);
            inFlight = null;
          }
          if (disposed) return;
          // 退避：连续 quiet 次没变化 → 15s → 30s → 45s → 60s（封顶 4 倍）
          schedule(TEAM_REFRESH_MS * Math.min(TEAM_REFRESH_MAX_FACTOR, quiet + 1));
        };
        schedule(TEAM_REFRESH_MS);
        return () => {
          disposed = true;
          clearTimeout(timer);
          // 卸载时把飞出去的请求收掉，别让它挂到超时才结束
          try {
            if (inFlight !== null) inFlight.abort();
          } catch {
            /* 没有 abort 就算了 */
          }
        };
      }, [sessionId, teamCount > 0]);

      // 「这一帧本该渲染消耗行吗」—— 由渲染体每帧写入（见 lineRenderableRef 的声明处）。
      // 三处早退（`!usage` / 全零 / 关掉消耗行）都不渲染行，探测必须先问这个再下结论。
      lineRenderableRef.current = usage != null && settings.showUsagePill !== false
        && ((usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0)
          + (usage.cacheWriteTokens ?? 0) + (usage.outputTokens ?? 0)) > 0;
      if (!usage) return null;

      const uncachedInput = usage.uncachedInputTokens ?? 0;
      const cacheRead = usage.cacheReadTokens ?? 0;
      const cacheWrite = usage.cacheWriteTokens ?? 0;
      const output = usage.outputTokens ?? 0;
      // 新增内容 = 未缓存输入 + 输出（不含缓存重读）
      const newTokens = uncachedInput + output;
      // 计费总量 = 未缓存输入 + 缓存重读/写入 + 输出，与 DeepSeek 账单口径一致
      const billedTotal = uncachedInput + cacheRead + cacheWrite + output;
      // 面板顶部那颗大数字和「计费 tokens」都用**含子代理**的口径，
      // 否则标题 ¥/tok 和下面拆出来的子代理几行加起来对不上。
      const panelBilledTotal = billedTotal + (hasSubagent ? (subagentUsage.totalTokens ?? 0) : 0);
      if (newTokens === 0 && billedTotal === 0) return null;

      const peakTokens = splitUsable ? split.peak.inputTokens + split.peak.cacheReadTokens + split.peak.cacheWriteTokens + split.peak.outputTokens : 0;
      const offpeakTokens = splitUsable ? split.offpeak.inputTokens + split.offpeak.cacheReadTokens + split.offpeak.cacheWriteTokens + split.offpeak.outputTokens : 0;

      // 子代理那几项已经在上面（cost 之前）算过了 —— 它们必须参与合计，
      // 而合计又被 cost 依赖，所以只能在 cost 前面算，这里不再重复声明。

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
        // 智能体团队（Agent Teams）：有 teammate 时挂一个小圆片，说明这颗数字是
        // 「本会话 + 团队 N 人」的合计（每人明细在点开的浮层里按人头列出）。
        // 没有团队时整个节点不渲染，一行还是原来的样子。
        teamCount > 0
          ? jsx.jsxs("span", {
            key: "team",
            className: "balance-usage-team",
            title: "含 " + teamCount + " 个团队成员（智能体团队）的消耗",
            children: ["团队 ", String(teamCount)],
          })
          : null,
        jsx.jsx("span", {
          key: "cost",
          className: "balance-usage-cost" + (showCostLoading ? " balance-usage-cost--pending" : ""),
          // 两种加载动效二选一（usageLoadingStyle），**两套语言不混用**：
          //   "wipe"（默认）：等待时一团白色迷雾在原地呼吸 → 数据到手「炸开」显示数字
          //           （2026-10-31 用户：「加载的时候是一团白色迷雾 然后像爆炸一样显示出来」）。
          //   "text"：等待时显示带呼吸的「计算中…」胶囊 → 数据到手**直接渐入**，不放光不放雾
          //           （2026-10-30 用户：「用的如果是计算中就不要用光条动画了 计算完直接渐入就行了」）。
          // 两种都只在等待期间出现，都不亮错误值。
          // ⚠️ 样式1 的等待态和揭幕态现在是**同一棵树**（2026-10-31 第十八轮：
          // 「不重播的意思是开始展开的时候 没有被触及到的区域继续播放动画 而不是重头开始播放」）。
          // 原来等待态渲染 .balance-usage-mist、揭幕态另起一棵 .balance-usage-reveal__mist，
          // 数字一到手就是**换节点**，里面 5 团光球的 CSS 动画全部从 0 秒重跑 ——
          // 于是开窗那一刻，没被扫到的区域里那团光会"跳回去重新流"。
          // 现在容器只有一棵：__mist 常驻（等待态靠 --wait 把洞钉在 0%，也就是整块可见），
          // 出数时只多挂一个 __body，光球节点的身份不变、相位一路接着走。
          children: loadingIsText
            ? (showCostLoading
              ? jsx.jsxs("span", {
                className: "balance-usage-calc",
                key: "calc-" + (sessionId || ""),
                children: [
                  "计算中",
                  // 三个点拆开逐个闪：单个 "…" 是一个字，没法分段动
                  jsx.jsx("span", {
                    className: "balance-usage-calc__dots",
                    "aria-hidden": "true",
                    children: [0, 1, 2].map((i) => jsx.jsx("span", { className: "balance-usage-calc__dot", children: "." }, i)),
                  }, "dots"),
                ],
              })
              // 样式2（计算中）：就是一层淡入，没有开窗也没有光
              : jsx.jsx("span", {
                className: "balance-usage-fade",
                key: "fade-" + (sessionId || ""),
                children: jsx.jsxs("span", {
                  className: "balance-usage-cost-inner",
                  children: [
                    // ≈ 回到消耗行（2026-11-01 用户定案：「约等于还是加回去吧 并且算到动画里去
                    // 没有约等于中间空了一块好奇怪」）。它就是估算语义的一部分，
                    // 而且没有它时胶囊中间那段留白看着像缺了什么。
                    jsx.jsx("span", { className: "balance-usage-approx", children: "≈" }, "approx"),
                    jsx.jsx("span", { children: "¥" }, "cur"),
                    // 静态也走逐字格：裸文本与 inline-block 逐字格的宽度/字距不等，
                    // 来回切换会让整串左右挪一下（同今日金额，2026-10-31）。
                    // 外层 key 恒定，只有变化的那一格换 key 重挂，否则滚动结束整串重挂会闪一下。
                    jsx.jsx("span", {
                      children: renderRollCells(
                        costRoll === null ? buildRollCells(costText, costText) : buildRollCells(costRoll.from, costText),
                        "u" + (costRoll === null ? "" : costRoll.at),
                        // 播完就定格：摘掉 animation 声明，展开侧栏不再重播
                        costRoll !== null && costRoll.done === true,
                      ),
                    }, "txt"),
                  ],
                }),
              }))
            : jsx.jsxs("span", {
              className: "balance-usage-reveal" + (costRevealOn ? " balance-usage-reveal--enter" : ""),
              key: "reveal-" + (sessionId || ""),
              children: [
                // 底层：加载态那团光（一整条，不切），**等待态和揭幕态是同一个节点**。
                // mask 在正中间挖一个随开窗扩大的椭圆洞，数字从洞里显出来，光留在两侧。
                // 等待态挂 --wait 把洞钉在 0%（整块可见＝加载动画），出数时摘掉它、挂 --enter 播开窗。
                jsx.jsx("span", {
                  className: "balance-usage-reveal__mist"
                    + (showCostLoading ? " balance-usage-reveal__mist--wait" : ""),
                  "aria-hidden": "true",
                  children: jsx.jsx("span", {
                    className: "balance-usage-mist",
                    children: ORB_INDICES.map((i) => jsx.jsx("span", { key: "orb-" + i, className: "balance-usage-mist__orb" })),
                  }),
                }, "mist"),
                // 上层：金额本体（≈ + ¥ + 数字），被 clip-path 从中缝向两侧打开 —— 「开窗」只发生在这一层。
                // 只在出数之后才存在 —— 等待期容器里只有光，宽度靠 .balance-usage-reveal 的 min-width 撑住。
                // ⚠️ ≈ 就在 __body **里面**（2026-11-01 用户最终定案：「约等于还是加回去吧 并且算到动画
                //    里去 没有约等于中间空了一块好奇怪」）。它跟着开窗一起显形，是这一层的一部分：
                //    单独拎出去当常显符号（上一版）会和雾叠着、看着像"符号长在动画上"，整串去掉又让
                //    胶囊中间空一截。放回来之后内容 = ≈ ¥121.17，居中填满，视觉最自然。
                showCostLoading
                  ? null
                  : jsx.jsxs("span", {
                    className: "balance-usage-reveal__body",
                    children: [
                      // ≈ 单独成节点：U+2248 在中文字体里落在数学符号的中线，比数字基线低一截，
                      // 直接跟「¥7.4619」串在一起会显得整个符号往下掉（2026-10-30 用户指出「有点靠下」）。
                      jsx.jsx("span", { className: "balance-usage-approx", children: "≈" }, "approx"),
                      jsx.jsx("span", { children: "¥" }, "cur"),
                      // 只有数字参与逐位滚动：¥ 是定值，跟着滚会把整个符号一起翻。
                      // 静态也走逐字格 + 外层 key 恒定，理由同上（宽度恒定、滚动结束不重挂）。
                      jsx.jsx("span", {
                        children: renderRollCells(
                          costRoll === null ? buildRollCells(costText, costText) : buildRollCells(costRoll.from, costText),
                          "u" + (costRoll === null ? "" : costRoll.at),
                          // 播完就定格：摘掉 animation 声明，展开侧栏不再重播
                          costRoll !== null && costRoll.done === true,
                        ),
                      }, "txt"),
                    ],
                  }, "body"),
              ],
            }),
        }),
      ];

      // ── 点击展开的明细浮层（结构与 DSH 原生「会话统计」一致：标题 + 分隔线 + dl 两列网格）──
      // 图片：官方把图片按尺寸折成 token 并入**输入**（没有单独的图片费用）。
      // 服务端返回的 usage 不做图片级拆分，所以 token 数用官网「图片 Token 计算器」同一算法估算（标「约」）。
      // ⚠️ 这部分金额**已经在**上面的输入里，这里只做说明，绝不能再加一笔（会翻倍）。
      const imageCount = Number(split?.imageCount ?? 0) || 0;
      const imageTokens = Number(split?.imageTokens ?? 0) || 0;
      const usageDetails = [
        ["缓存命中", cacheHitPercent + "%"],
        ["未缓存输入", formatTokens(uncachedInput) + " tok"],
        ["缓存读取", formatTokens(cacheRead) + " tok"],
      ];
      if (cacheWrite > 0) usageDetails.push(["缓存写入", formatTokens(cacheWrite) + " tok"]);
      usageDetails.push(["输出", formatTokens(output) + " tok"]);
      if (imageCount > 0) {
        usageDetails.push([
          "图片",
          imageCount + " 张 · 约 " + formatTokens(imageTokens) + " tok · 已计入输入",
        ]);
      }

      const costDetails = [
        ["新增 tokens", formatTokens(newTokens) + " tok"],
        ["计费 tokens", formatTokens(panelBilledTotal) + " tok"],
        ["模型", model || "未知（按 flash 价估算）"],
      ];
      // 金额口径要写明白：算完 = 服务端逐条按发生时段分桶；算完前 / 拿不到 = 本地按当前时段估算。
      // 估算会把整段历史按「此刻」的峰谷价乘一次，高峰窗口里自然偏高 —— 说清楚，别让它冒充精确值。
      if (costPending) {
        costDetails.push(["金额", "正在取服务端分时段用量"]);
      } else if (!splitUsable) {
        costDetails.push(["金额", "按当前时段估算（服务端未返回分桶）"]);
      }
      if (splitUsable) {
        costDetails.push(
          ["高峰 tokens", formatTokens(peakTokens) + " tok"],
          ["空闲 tokens", formatTokens(offpeakTokens) + " tok"],
        );
      }
      if (hasSubagent) {
        costDetails.push(
          ["子代理", subagentCount + " 个 · 已计入上方合计"],
          ["子代理 tokens", "+" + formatTokens(subagentNewTokens) + " / 计费 " + formatTokens(subagentUsage.totalTokens)],
          ["子代理金额", "≈ ¥" + subagentCost.toFixed(4)],
        );
      }
      // 网页搜索 / 抓取：按次计费，既不属于高峰也不属于空闲，所以单列。
      // 官方 2026-10-17 上线 Search / Fetch API，北京时间 2026-11-01 00:00 起收费（¥5 / 千次）。
      // 之前这一行只在统计弹窗里有，消耗明细浮层里漏了（2026-10-30 反馈）。
      const webSearchCalls = Number(split?.webSearchCalls ?? 0) || 0;
      const webFetchCalls = Number(split?.webFetchCalls ?? 0) || 0;
      const webBillable =
        (Number(split?.webSearchBillable ?? 0) || 0) + (Number(split?.webFetchBillable ?? 0) || 0);
      const webToolCost = Number(split?.webToolCost ?? 0) || 0;
      if (webSearchCalls + webFetchCalls > 0) {
        costDetails.push(
          ["网页搜索 / 抓取", webSearchCalls + " / " + webFetchCalls + " 次"],
          [
            "网页工具费用",
            webToolCost > 0
              ? "¥" + webToolCost.toFixed(4) + " · 计费 " + webBillable + " 次"
              : "免费期内（11-01 起收费）",
          ],
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
            jsx.jsx("span", { className: "balance-usage-panel__value", children: formatTokens(panelBilledTotal) + " tok" }),
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

      // 智能体团队（Agent Teams）：按人头列出 teammate 的消耗。
      // 数据来自本会话事件里的 team/member roster + 每个子会话自己的费用，
      // 合计已经包含在上面的「本会话金额」里 —— 这一块只是拆开看，**不再加钱**。
      if (teamCount > 0) {
        panelChildren.push(
          jsx.jsxs("div", {
            className: "balance-usage-panel__title balance-usage-panel__title--second",
            children: [
              jsx.jsxs("span", {
                className: "balance-usage-panel__label",
                children: [
                  typeof primitives.IconUserOutlineRegular === "function"
                    ? jsx.jsx(primitives.IconUserOutlineRegular, {})
                    : null,
                  "智能体团队",
                ],
              }),
              jsx.jsx("span", {
                className: "balance-usage-panel__value",
                children: teamCount + " 人 · ≈ ¥" + teamCost.toFixed(4),
              }),
            ],
          }),
          jsx.jsx("div", { className: "balance-usage-panel__rule" }),
          jsx.jsx("dl", {
            className: "balance-usage-panel__details",
            children: detailRows(
              "t",
              teamMembers.map((m) => [
                (m && typeof m.name === "string" && m.name !== "" ? m.name : "未命名队友")
                  + (m && teamPhaseLabel(m.phase) !== "" ? " · " + teamPhaseLabel(m.phase) : ""),
                "≈ ¥" + (Number(m && m.cost) || 0).toFixed(4),
              ]),
            ),
          }),
        );
      }

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
            ? createPortal(
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

    // ─── 左侧导航栏的「余额与用量」面板 ─────────────────────────────────────
    // 图标：sidebar.panellist 只渲染这一小块（DSH 负责旁边的文字与点击），
    //       宽展开时 16px、收起成 rail 时 18px，由 slot props.size 给。
    function BalancePanelIcon({ size, active }) {
      const p = typeof size === "number" ? size : 16;
      const settings = useSettings();
      // 未读 = 这个按钮还没被点开过。跟版本号完全无关：
      //   · 用户从 1.3.0 直接跳到 1.3.5（跳过中间版本）也会看到红点
      //   · 点过之后写回 entrySeen: true，红点永久消失，重启也不回来
      //   · 判定用 !== true 而不是 === false，老设置文件里没有这个键也照样算未读
      const notice = useUpdateNotice();
      // 有新版本、且还没点开过面板 → 在图标右上角挂一个「新版本！」胶囊。
      // 用户要求：别再让它跟「有新内容」的未读红点用同一个提示（重复且不显眼）。
      const updateHint = notice.latest !== "" && notice.seen !== true && !active;
      // 有新功能、而且用户还没点进去过 → 入口挂一颗 NEW 标签。
      // 熄灭条件是「点进去过」，不是时间：点进去之后外侧这颗就没了，
      // 直到下个新功能出现（2026-10-31 用户要求）。
      // 这一套**固定开启**，不提供关闭开关（用户明确说过「这个强制打开 不需要这个开关」）——
      // 它只在一个短窗口内出现，不构成长期打扰，关掉反而让用户错过新功能。
      const newFeature = !updateHint && !active && unseenNewTags(settings).length > 0;
      // 优先级：新版本！> NEW > 未读红点。三者永不同时出现（挤在一格里谁也看不清）。
      const unread = settings.entrySeen !== true && !active && !updateHint && !newFeature;
      // 关掉「侧边栏显示本插件」→ 这一格直接不渲染（图标消失）。
      // 位置必须在所有 hook 之后，否则不同渲染间 hook 数量不一致，React 会直接报错。
      if (settings.showSidebarEntry === false) return null;
      const svg = jsx.jsx("svg", {
        width: p,
        height: p,
        viewBox: "0 0 24 24",
        fill: "none",
        xmlns: "http://www.w3.org/2000/svg",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
        style: { display: "block" },
        children: [
          jsx.jsx("path", { d: "M21 12V7H5a2 2 0 0 1 0-4h14v4" }),
          jsx.jsx("path", { d: "M3 5v14a2 2 0 0 0 2 2h16v-5" }),
          jsx.jsx("path", { d: "M18 12a2 2 0 0 0 0 4h4v-4Z" }),
        ],
      });
      if (!unread && !updateHint && !newFeature) return svg;
      // 点一下图标（标签就在图标右上角，点哪都算）就立刻熄灯：
      // 本地先乐观置 true 并广播，标签在同一帧消失，不等 HTTP 往返；
      // 持久化走 fire-and-forget，失败也只是下次进来再写一次。
      // 用 pointerdown 而不是 click —— panellist 那一行的 click 归 DSH 的 selectPanel 处理，
      // pointerdown 只负责"标记已读"，不抢它的点击行为（事件照常冒泡）。
      const markSeen = () => {
        // 三个提示原因各自熄各自的：不能因为 entrySeen 已是 true 就整段 early return，
        // 否则「有新版本」「有新功能」那两颗点永远清不掉。
        if (updateHint) {
          updateNotice = { ...updateNotice, seen: true };
          emitUpdateNotice();
        }
        // NEW 标签：用户点进来了，把还没看过的新功能标成 d:true —— 外侧这颗立即熄灭，
        // 一直保持熄灭，直到下一个新功能出现（没有总开关，也就没有"要不要关"的问题）。
        const entered = markNewTagsEntered(settingsCache.value);
        if (entered) {
          settingsCache = {
            ...settingsCache,
            value: { ...settingsCache.value, newTagSeen: entered },
          };
          emitSettings();
          void saveSettings({ newTagSeen: entered }).catch(() => {});
        }
        if (settingsCache.value.entrySeen !== true) {
          settingsCache = {
            ...settingsCache,
            value: { ...settingsCache.value, entrySeen: true },
          };
          emitSettings();
          void saveSettings({ entrySeen: true }).catch(() => {});
        }
      };
      // 外层 span 只为了挂定位；DSH 的 panellist 容器不裁子元素
      // 三种提示按优先级取一个：有新版 → 「新版本！」胶囊；否则有未读新功能 → 「NEW」标签；
      // 否则若没点开过 → 原来那颗未读红点。
      return jsx.jsxs("span", {
        className:
          "balance-panel-icon" + (unread ? " balance-panel-icon--unread" : ""),
        onPointerDown: markSeen,
        children: [
          svg,
          unread
            ? jsx.jsx("span", { className: "balance-panel-icon__dot", "aria-hidden": "true" })
            : null,
          updateHint
            ? jsx.jsx("span", { className: "balance-panel-icon__new", children: "新版本！" })
            : null,
          newFeature
            ? jsx.jsx("span", {
              className: "balance-panel-icon__new balance-panel-icon__new--feature",
              children: "NEW",
            })
            : null,
        ],
      });
    }

    // 页面：点侧栏「余额与用量」后，主区域按 keyed slot "main" 渲染这个组件。
    // 内容直接复用配置卡片（它自带折叠头、分组、即时保存），外面套一层页面留白。
    function BalancePanelPage() {
      const settings = useSettings();
      // 打开即视为已读：只写一次，失败也不打扰（下次打开再试）
      react.useEffect(() => {
        // 只要不是确切的 true 就写一次（undefined / false 都算未读），
        // 保证「点开过」这件事一定被持久化，红点之后不会再回来。
        if (settings.entrySeen !== true) {
          void saveSettings({ entrySeen: true }).catch(() => {});
        }
        // 打开这一页也算「点进去过」：侧栏那颗 NEW 到此为止，直到下个新功能。
        // 直接打开面板页（不经过侧栏图标）的用户同样要熄灭它。
        const entered = markNewTagsEntered(settingsCache.value);
        if (entered) void saveSettings({ newTagSeen: entered }).catch(() => {});
        // 打开面板就能看到顶部的「版本与更新」区块，所以新版本红点到此为止。
        // seen 只存在内存里（不写盘）：下次启动重新检查，真有新版会再亮。
        if (updateNotice.latest !== "" && updateNotice.seen !== true) {
          updateNotice = { ...updateNotice, seen: true };
          emitUpdateNotice();
        }
      }, [settings.entrySeen]);
      return jsx.jsxs("div", {
        className: "balance-panel-page",
        children: [
          jsx.jsxs("div", {
            className: "balance-panel-page__head",
            children: [
              jsx.jsx("h2", { className: "balance-panel-page__title", children: "余额与用量" }),
              jsx.jsx("p", {
                className: "balance-panel-page__desc",
                children: "DeepSeek 账户余额与本机会话消耗统计的设置。改动即时保存；标了「需重启」的项在重启 DeepSeek Harness 后生效。",
              }),
            ],
          }),
          jsx.jsx(BalanceSettingsCard, { view: "page" }),
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
      // 版本与更新的状态机：
      //   idle       — 没查过
      //   checking   — 正在问 npm
      //   ok         — 查到了；newer 表示有没有新版
      //   installing — 正在下载并覆盖本机安装
      //   installed  — 覆盖完成，等重启
      //   error      — 查询或更新失败
      const [updateCheck, setUpdateCheck] = react.useState({ kind: "idle" });

      // 拿到设置后灌一次草稿；draft 已有内容就不再覆盖，避免打断正在输入的用户。
      // ⚠️ 必须等 `loaded === true` 再灌（2026-10-31 审查）：
      // `useSettings()` 的初值是 SETTINGS_DEFAULTS，真正的值要等 /balance-api?config=1。
      // 原来无条件灌一次，于是草稿被**出厂默认值冻结** —— 之后 patch() 提交的是整份草稿，
      // 用户改一个开关，轮询间隔 / 阈值 / 扫描上限 / apiKey 全部被默认值覆盖回出厂。
      // 这正好踩中「设置绝不许被默认值覆盖」那条铁律。
      react.useEffect(() => {
        if (settingsCache.loaded !== true) return;
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
        if (!saveTimer.current) return;
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        // ⚠️ 卸载时要把还没发出去的改动**补发**（2026-10-31 全量审查）。
        // 原来只 clearTimeout：改动在 350ms debounce 里，用户改完立刻切页/关面板
        // 就整条丢掉 —— 而界面刚刚还提示过「修改中…」，属于静默数据丢失。
        // saveSettings 是模块级函数，组件卸载后照常可调用。
        const payload = pendingRef.current;
        pendingRef.current = null;
        if (payload) {
          void saveSettings(payload).catch(() => {
            // 补发失败只能放弃：此时已经没有 UI 可以提示了
          });
        }
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
      // 关掉侧边栏入口时的提醒弹窗。这一项一关，本设置页就没有常驻入口了，
      // 所以必须当场告诉用户以后怎么回来（侧边栏 -> 插件 -> balance-dsh）。
      const [sidebarTip, setSidebarTip] = react.useState(false);
      // 弹窗用 DSH 官方的 Modal（primitives.Modal）—— Esc / 点遮罩 / 焦点管理都由它负责，
      // 我们只给标题、正文和底部按钮。取不到时退化成纯文字按钮，绝不自己画遮罩。
      const tipModal = primitives && typeof primitives.Modal === "function" ? primitives.Modal : null;
      const tipButton = primitives && typeof primitives.Button === "function" ? primitives.Button : null;
      // 节假日数据：状态来自服务端，按钮触发一次强制同步。
      const calendar = useCalendar();
      const [calendarSync, setCalendarSync] = react.useState({ kind: "idle", text: "" });
      const calendarBusy = calendarSync.kind === "syncing";
      const calendarSummary = (() => {
        // 同步失败：直接把服务端给的原因摆出来，别拿旧数据冒充成功。
        if (calendarSync.kind === "error") return calendarSync.text;
        // 只要有数据就一律显示同一句「已同步 N 天 · 上次同步时刻 · 待公布」——
        // **同步成功之后同样要显示时刻**（2026-10-30 反馈「只有在同步过程中才显示上次同步时间」）。
        // 旧写法让 ok 分支返回另拼的一句「已更新 2025 / 2026（72 天）（2027 待公布）」：
        // 既丢了时刻，又把年份列表塞回来，200px 宽里直接折成两行、断在「公布)」中间。
        // 现在 ok 只负责变色（--ok 绿），文案一律由这里按缓存渲染。
        if (calendar.fetchedAt > 0) {
          const at = new Date(calendar.fetchedAt);
          const stamp =
            at.getFullYear() + "-" + String(at.getMonth() + 1).padStart(2, "0") + "-" +
            String(at.getDate()).padStart(2, "0") + " " + String(at.getHours()).padStart(2, "0") + ":" +
            String(at.getMinutes()).padStart(2, "0");
          // 只报日期与时刻，不报完整年份列表：那串太长会把左边的标题挤成一字一行。
          // 「同步了哪几年」由服务端 days 的键直接决定，用户点「立即同步」那边也能看到。
          // 「2027 待公布」内部用不换行空格（\\u00A0）焊死：卡片窄到 298px 时，
          // 普通空格会允许断在「2027」和「待公布」之间，把这三个字拆成两行（实测）。
          // 焊死后只可能断在前面的「 · 」处，两行就是「已同步…时刻」/「· 2027 待公布」。
          const pending = calendar.missing.length > 0
            ? " · " + calendar.missing.map(String).join("\u00A0/\u00A0") + "\u00A0待公布"
            : "";
          return "已同步 " + calendar.count + " 天 · " + stamp.slice(5) + pending;
        }
        if (calendarSync.kind === "syncing") return "正在同步…";
        return "尚未同步，正在用插件内置表。";
      })();
      const onSyncCalendar = async () => {
        if (calendarBusy) return;
        setCalendarSync({ kind: "syncing", text: "正在同步…" });
        try {
          const data = await syncCalendar();
          if (data && data.ok === true) {
            // 成功不另拼一句文案：syncCalendar() 内部已经 adoptCalendar(data) 刷新了缓存，
            // calendarSummary 会带着新的同步时刻自己重渲染；这里只把状态切成 ok（绿色）。
            setCalendarSync({ kind: "ok", text: "" });
          } else {
            setCalendarSync({
              kind: "error",
              text: (data && data.error) || "同步失败，继续使用本地数据。",
            });
          }
        } catch (error) {
          setCalendarSync({
            kind: "error",
            text: "同步失败：" + (error instanceof Error ? error.message : String(error)),
          });
        }
      };
      const tipClose = () => setSidebarTip(false);
      const tipFooter = tipButton
        ? jsx.jsx(tipButton, { variant: "primary", onClick: tipClose, children: "知道了" })
        : jsx.jsx("button", {
            type: "button",
            className: "balance-tip-ok",
            onClick: tipClose,
            children: "知道了",
          });

      const patch = (key, next) => {
        // ⚠️ 只提交改动的这一个键，不再整份草稿一起发（2026-10-31 审查）。
        // saveSettings 会和服务端自己那份设置合并，所以单键提交既够用又安全；
        // 整份提交一旦碰上草稿没跟上真实值（设置还没加载完 / 别的页刚改过），
        // 就会把其余字段静默写回旧值。
        setDraft((current) => ({ ...(current === null ? valueRef.current : current), [key]: next }));
        queueSave({ [key]: next });
      };
      const onReset = () => {
        const next = { ...SETTINGS_DEFAULTS };
        setDraft(next);
        queueSave(next);
      };
      // 检查更新：只查版本号，不动任何文件。
      const onCheckUpdate = () => {
        if (updateCheck.kind === "checking" || updateCheck.kind === "installing") return;
        setUpdateCheck({ kind: "checking" });
        void fetchUpdateInfo()
          .then((info) => {
            if (info.ok !== true) {
              setUpdateCheck({ kind: "error", error: info.error });
              return;
            }
            setUpdateCheck({ kind: "ok", newer: info.newer, latest: info.latest, current: info.current });
          })
          .catch((error) => {
            setUpdateCheck({ kind: "error", error: error instanceof Error ? error.message : String(error) });
          });
      };

      // 更新入口（用户要求：「检查到新版本时不要直接下载，要提醒用户是否下载」
      // + 「不是弹窗，是在检查更新那个位置变成『检测到新版本，是否更新』（更新）」）。
      // 所以只有一层：查到新版后同一块区域直接问「是否更新？」，旁边的按钮就叫「更新」，
      // 点了才下载。不弹窗、不再多点一次确认。
      const onDoInstall = () => {
        if (updateCheck.kind === "checking" || updateCheck.kind === "installing") return;
        setUpdateCheck({ kind: "installing", latest: updateCheck.latest });
        void fetch("/balance-api?update=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
          .then((res) => {
            if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "?"));
            return res.json();
          })
          .then((data) => {
            if (!data || data.ok !== true) {
              setUpdateCheck({ kind: "error", error: (data && data.error) || "更新失败" });
              return;
            }
            // registry 上刚好被撤掉 / 本地已经是这个版本：服务端会回 installed:false
            if (data.installed === false) {
              setUpdateCheck({ kind: "ok", newer: false, latest: data.to || "", current: data.from || "" });
              return;
            }
            setUpdateCheck({
              kind: "installed",
              to: data.to || "",
              failed: Array.isArray(data.failed) ? data.failed : [],
              // 服务端会判断这次更新是否「持久」：按 npm 版本装进 profile 的，只覆盖文件
              // 会被重启时的声明版本盖回去（用户 2026-10-31 报的版本回归）。
              persisted: data.persisted !== false,
              warning: typeof data.warning === "string" ? data.warning : "",
              command: typeof data.command === "string" ? data.command : "",
            });
          })
          .catch((error) => {
            setUpdateCheck({ kind: "error", error: error instanceof Error ? error.message : String(error) });
          });
      };

      const updateBusy = updateCheck.kind === "checking" || updateCheck.kind === "installing";
      // 一行说明文字：四种状态各说一句，idle 也给一句提示（区块默认就可见，不留空白）
      // 标题行左侧的一句话状态。「已是最新版本」这种短状态放这里（不再单独占一行），
      // 长文案（有新版本时的覆盖/备份/重启说明）仍走下面的 updateNote。
      const updateInline = (() => {
        if (updateCheck.kind === "ok" && !updateCheck.newer) return "已是最新版本。";
        return "";
      })();

      // 查询中的进度文案走右侧（按钮左边），不占下面那一行 ——
      // 用户要求「这个查询也放在右边」。它短，跟按钮排一行正好。
      const updateBusyNote =
        updateCheck.kind === "checking" ? "正在查询 npm registry…" : "";

      const updateNote = (() => {
        if (updateCheck.kind === "installing") return "正在下载并替换本机安装文件，请稍候…";
        if (updateCheck.kind === "installed") {
          const failed = updateCheck.failed || [];
          if (failed.length > 0) {
            return "已更新到 " + updateCheck.to + "，但有 " + failed.length + " 个文件没覆盖成功（" + failed.join("；") + "）。重启后如仍异常，请先从插件市场重装。";
          }
          // 不持久的那一次必须说清楚：重启会退回旧号，并给出能真正生效的命令。
          if (updateCheck.persisted === false) {
            return "已就地更新到 " + updateCheck.to + "，但本机是按 npm 版本装进 profile 的 —— 重启后可能退回旧号。"
              + "请执行 " + (updateCheck.command || "dsh plugin install balance-dsh@" + updateCheck.to)
              + "（或 设置 → 插件 里的更新）后再重启。";
          }
          return "已更新到 " + updateCheck.to + "，重启 DeepSeek Harness 后生效。";
        }
        if (updateCheck.kind === "error") return "检查失败：" + updateCheck.error + "（可稍后重试）";
        if (updateCheck.kind === "ok") {
          // 「已是最新版本」不在这里出 —— 它走 updateInline，显示在标题行左侧。
          if (!updateCheck.newer) return "";
          return "检测到新版本 " + updateCheck.latest
            + "（当前 " + (updateCheck.current || settingsCache.version || "—") + "），是否更新？"
            + "更新会覆盖本机插件文件（旧文件先备份到 ~/.dsh/balance-update-backup/），"
            + "完成后需重启 DeepSeek Harness 生效。";
        }
        // 初始态不写任何引导文案（用户要求：这行小字删掉）。
        return "";
      })();

      // NEW 相关：NEW_TAGS / freshNewTags / markNewTagsEntered 都在模块级
      // （侧栏入口那颗 NEW 标签也要用同一套判定，不能在组件里再定义一份）。
      // ⚠️ 这几个派生值 + 下面那个记录 effect + 折叠状态，**必须写在早退之前**。
      // 它们原来排在 `if (view === "summary")` 后面，于是同一实例从 summary 切到 page 时
      // hook 数量从 N 变成 N+2，React 抛 "Rendered more hooks than during the previous render"，
      // 设置卡片连同整页一起白掉。设置卡片是常驻 UI，正确性优先于就近定义。
      const newTagSince = Number(value.newTagSince);
      // 升级前的版本（空串 = 全新安装）
      const newTagFrom = String(value.newTagFrom || "");
      const newTagSeen = value.newTagSeen && typeof value.newTagSeen === "object" ? value.newTagSeen : {};
      // ⚠️ 版本号走 settingsCache.version，**不是** value.version（2026-10-31 审查）。
      // 服务端把 version 放在 settings 的**兄弟字段**里（见 lib/index.js 的响应体），
      // settings 对象里从来没有这个键，所以 String(value.version || "") 恒为空串。
      // 而 isCurrentIntro 见到空串恒判 false，于是「本版新增必须亮满 24 小时」会提前熄灭 ——
      // 那正是 2026-10-31 修过一次的回归，别再退回 value.version。
      const currentVersion = String(settingsCache.version || value.version || "");
      // 逐项记录时用的起点是**升级时刻**（服务端在版本变化那一刻写下的 newTagSince），
      // 不是「这次渲染的时刻」。用户 2026-10-31 明确要求：「更新完开始计算，不需要打开插件设置页才显示」——
      // 侧栏入口会挂「新版本！」胶囊，看到就会点进来，窗口不该等他点进来才起跑。
      // 所以升级后隔两天才打开设置页，看到的就只剩一天，而不是又白送三天。
      react.useEffect(() => {
        if (settingsCache.loaded !== true) return;
        const now = Date.now();
        const anchor = Number(newTagSince) > 0 ? Number(newTagSince) : now;
        const patch = {};
        for (const [key, intro] of NEW_TAGS) {
          const rec = newTagSeen[key];
          // 已按这个版本记过了，不重复写盘、也不把起点往后推
          if (rec && typeof rec === "object" && rec.v === intro) continue;
          // 对用户不是新功能就不记（否则以后 baseline 变了会误显示）
          if (!newTagStateAt(intro, rec, newTagFrom, newTagSince, now, currentVersion).fresh) continue;
          patch[key] = { v: intro, t: anchor };
        }
        if (Object.keys(patch).length === 0) {
          // 没新东西要记，但顺手把已删功能的残记录清理掉（写盘前统一 prune）
          const pruned = pruneNewTagSeen(newTagSeen);
          if (Object.keys(pruned).length !== Object.keys(newTagSeen).length) {
            void saveSettings({ newTagSeen: pruned }).catch(() => {});
          }
          return;
        }
        void saveSettings({ newTagSeen: { ...pruneNewTagSeen(newTagSeen), ...patch } }).catch(() => {
          // 写盘失败不影响本次渲染：下次进入会重试
        });
        // currentVersion 必须进依赖：它来自异步加载的 settingsCache，加载完成前是空串，
        // 判定结果会从"不是新功能"翻成"是新功能"。
      }, [newTagFrom, newTagSince, newTagSeen, currentVersion]);
      // 整张设置卡片可折叠，形式对齐 DSH 原生 DisclosureRow —— 一行标题 + 描述 + 右侧 chevron，
      // 展开时箭头翻转 180 度。**默认展开**：只有插件列表里的单行摘要（view === "summary"）
      // 保持收起，点进详情页 / 设置页 / 侧栏面板页时一进来就摊开所有选项。
      const [openSettings, setOpenSettings] = react.useState(view !== "summary");

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

      // NEW 相关：NEW_TAGS / freshNewTags / markNewTagsEntered 都在模块级
      // （侧栏入口那颗 NEW 标签也要用同一套判定，不能在组件里再定义一份）。
      const isNew = (key) => {
        const intro = NEW_TAGS.get(key);
        if (!intro) return false;
        return newTagStateAt(intro, newTagSeen[key], newTagFrom, newTagSince, Date.now(), currentVersion).show;
      };
      // 顶部「本版新增」横幅：和逐项 isNew 同一套判定（24 小时窗口），
      // 所以横幅消失的时机跟设置项旁那颗 NEW 完全一致，不会出现"横幅没了但某行还有 NEW"。
      const pendingNew = freshNewTags(value);
      // 点名跳到那一行：设置卡片很长，光说"有新功能"用户还得自己找。
      const focusNewRow = (key) => {
        try {
          const el = document.querySelector('[data-newtag="' + key + '"]');
          if (!el) return;
          if (typeof el.scrollIntoView === "function") {
            el.scrollIntoView({ block: "center", behavior: "smooth" });
          }
          // 先摘再强排一次：连点同一个按钮也要重播闪一下，而不是没反应
          el.classList.remove("balance-settings__row--flash");
          void el.offsetWidth;
          el.classList.add("balance-settings__row--flash");
          // 动画是 1.4s，1.5s 后才摘 class：留 100ms 余量，别在动画没播完时把伪元素抽走。
          // 伪元素本身靠 animation-fill-mode:both 停在 opacity:0，所以中间不会有回跳。
          window.setTimeout(() => el.classList.remove("balance-settings__row--flash"), 1500);
        } catch {
          // 定位失败只是不滚、不闪，设置本身照常可用
        }
      };
      // 逐项记录用的 effect 已经上移到早退之前（见「NEW 相关」那段说明）——
      // hook 不能跟在条件 return 后面。这里只留纯计算。
      const row = (key, label, hint, control, extra) => jsx.jsxs("div", {
        className: "balance-settings__row",
        // 顶部「本版新增」横幅靠它定位跳转（querySelector('[data-newtag="key"]')）
        "data-newtag": key,
        children: [
          jsx.jsxs("div", {
            className: "balance-settings__label",
            children: [
              jsx.jsxs("span", {
                className: "balance-settings__label-line",
                children: [
                  jsx.jsx("span", { className: "balance-settings__label-text", children: label }),
                  isNew(key)
                    ? jsx.jsx("span", { className: "balance-settings__new-badge", children: "NEW" })
                    : null,
                ],
              }),
              hint ? jsx.jsx("span", { className: "balance-settings__hint", children: hint }) : null,
            ],
          }),
          // extra 是可选的「中间预览」：夹在说明文字和右侧控件之间，
          // 由 margin-left:auto 贴向控件一侧（用户指的那块空白就在这里）。
          extra || null,
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

      // 文本行：用于「高峰时段」这类要手写表达式的项。
      // 边输边存（和 numberRow 一致），半截输入由服务端原样存下、解析失败时回退默认窗口，
      // 所以打到一半不会被弹回。
      const textRow = (key, label, hint, placeholder) =>
        row(
          key,
          label,
          hint,
          jsx.jsx("input", {
            className: "balance-settings__input balance-settings__input--text",
            type: "text",
            value: value[key] == null ? "" : String(value[key]),
            placeholder,
            spellCheck: false,
            onChange: (event) => patch(key, event.target.value),
          }),
        );

      // onToggle（可选）拿到的是「点完之后的新值」，用来在关掉某项时追加副作用
      const toggleRow = (key, label, hint, onToggle) =>
        row(
          key,
          label,
          hint,
          toggle(key, label, onToggle ? () => onToggle(value[key] !== true) : undefined),
        );

      // 二选一分段控件：用于「余额行外观」这类互斥选项。第 5 参 extra 是可选的行内预览。
      const choiceRow = (key, label, hint, options, extra) => row(key, label, hint, jsx.jsx("div", {
        className: "balance-settings__segmented",
        role: "radiogroup",
        "aria-label": label,
        children: options.map((opt) => jsx.jsx("button", {
          key: opt.value,
          type: "button",
          role: "radio",
          "aria-checked": value[key] === opt.value,
          className: "balance-settings__segment" + (value[key] === opt.value ? " balance-settings__segment--on" : ""),
          onClick: () => patch(key, opt.value),
          children: opt.label,
        }, opt.value)),
      }), extra);

      // 折叠状态 openSettings 已经上移到早退之前（hook 不能跟在条件 return 后面）。
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
      // note：分组级说明（可选），渲染在分组标题下方、行上方，用来说明这组的口径/适用范围
      const group = (key, title, rows, note) => jsx.jsxs("div", {
        className: "balance-settings__group",
        children: [
          jsx.jsx("div", { className: "balance-settings__group-title", children: title }),
          note
            ? jsx.jsxs("div", {
                className: "balance-settings__group-note",
                children: [
                  // 同顶部告示那颗：宽高必须等于 viewBox 的 16，14/16 的非整数缩放会把描边抹糊。
                  jsx.jsxs("svg", {
                    className: "balance-settings__group-note-icon",
                    viewBox: "0 0 16 16",
                    width: 16,
                    height: 16,
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: 1.5,
                    strokeLinecap: "round",
                    children: [
                      jsx.jsx("circle", { cx: 8, cy: 8, r: 6.4 }),
                      jsx.jsx("path", { d: "M8 7.3v3.9" }),
                      jsx.jsx("circle", { cx: 8, cy: 4.9, r: 0.85, fill: "currentColor", stroke: "none" }),
                    ],
                  }),
                  jsx.jsx("span", { className: "balance-settings__group-note-text", children: note }),
                ],
              })
            : null,
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
                    children: "余额刷新、界面显示与计费口径。改动即时保存；服务端相关项需重启 DeepSeek Harness。",
                  }),
                ],
              }),
              chevron,
            ],
          }),

          openSettings ? jsx.jsxs("div", {
            className: "balance-settings__body",
            children: [
              // 「本版新增」横幅：只在有条目新功能未过期时出现。
              // 它不依赖侧栏入口 —— 用户关闭「侧边栏显示本插件」、或从 DSH「插件」
              // 页直接进来时，这是唯一能看到"有新功能"的地方（2026-10-31 用户提问）。
              pendingNew.length > 0
                ? jsx.jsxs("div", {
                  className: "balance-settings__newcue",
                  children: [
                    jsx.jsx("span", { className: "balance-settings__newcue-badge", children: "NEW" }),
                    jsx.jsx("span", {
                      className: "balance-settings__newcue-text",
                      children: "本版新增：" + pendingNew
                        .map((item) => NEW_TAG_LABELS[item.key] || item.key)
                        .join(" · "),
                    }),
                    jsx.jsx("button", {
                      type: "button",
                      className: "balance-settings__newcue-btn",
                      onClick: () => focusNewRow(pendingNew[0].key),
                      children: "去看看",
                    }),
                  ],
                })
                : null,
              // 顶部告示：计费范围限制放在最前面，打开设置第一眼就看到，
              // 不用翻到「计费」分组才发现。
              jsx.jsxs("div", {
                className: "balance-settings__notice",
                children: [
                  // ⚠️ 宽高必须等于 viewBox 的 16，**不要**写成 15（2026-10-31 用户报「感叹号是糊的」）：
                  // 15/16 = 0.9375 的非整数缩放会让 1.5px 的描边落在半像素上，
                  // 抗锯齿把圆圈和竖线一起抹成灰边。1:1 映射后每个单位正好一个设备像素。
                  jsx.jsxs("svg", {
                    className: "balance-settings__notice-icon",
                    viewBox: "0 0 16 16",
                    width: 16,
                    height: 16,
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: 1.5,
                    strokeLinecap: "round",
                    children: [
                      jsx.jsx("circle", { cx: 8, cy: 8, r: 6.4 }),
                      jsx.jsx("path", { d: "M8 7.3v3.9" }),
                      jsx.jsx("circle", { cx: 8, cy: 4.9, r: 0.85, fill: "currentColor", stroke: "none" }),
                    ],
                  }),
                  jsx.jsx("span", {
                    className: "balance-settings__notice-text",
                    children: "计费仅支持 DeepSeek Harness 内的 DeepSeek 官方模型与账号；其他大模型不计入金额。",
                  }),
                ],
              }),
              // 版本与更新：放在最前面（用户要"往上放一点"）。
              // 检查、更新、结果说明都在这一块，底部只留保存状态与「恢复默认」。
              jsx.jsxs("div", {
                className:
                  "balance-settings__update" +
                  (updateCheck.kind === "error"
                    ? " balance-settings__update--error"
                    : updateCheck.kind === "installed"
                      ? " balance-settings__update--done"
                      : updateCheck.kind === "ok" && updateCheck.newer
                        ? " balance-settings__update--newer"
                        : ""),
                children: [
                  jsx.jsxs("div", {
                    className: "balance-settings__update-head",
                    children: [
                      jsx.jsxs("div", {
                        className: "balance-settings__update-title",
                        children: [
                          "版本 ",
                          jsx.jsx("strong", {
                            className: "balance-settings__update-ver",
                            children: settingsCache.version || "—",
                          }),
                          updateCheck.kind === "ok" && updateCheck.newer
                            ? jsx.jsx("span", {
                                className: "balance-settings__update-badge",
                                children: "新版 " + updateCheck.latest,
                              })
                            : null,
                          updateInline
                            ? jsx.jsx("span", {
                                className: "balance-settings__update-inline",
                                children: updateInline,
                              })
                            : null,
                        ],
                      }),
                      jsx.jsxs("div", {
                        className: "balance-settings__update-btns",
                        children: [
                          // 查询中的文案排在按钮左边（用户要求放在右边，别占下面那行）
                          updateBusyNote
                            ? jsx.jsx("span", {
                                className: "balance-settings__update-busy",
                                children: updateBusyNote,
                              })
                            : null,
                          // 检查更新：进行中禁用并显示进度（checking / installing 共用这个位置）
                          jsx.jsx("button", {
                            type: "button",
                            className: "balance-settings__btn",
                            onClick: onCheckUpdate,
                            disabled: updateBusy,
                            children: updateCheck.kind === "checking"
                              ? "检查中…"
                              : updateCheck.kind === "installing"
                                ? "更新中…"
                                : "检查更新",
                          }),
                          // 「更新」只在检测到新版时出现，点它才真的下载 ——
                          // 上面的说明文字已经把"是否更新"问出来了，这里就是那个「是」。
                          updateCheck.kind === "ok" && updateCheck.newer
                            ? jsx.jsx("button", {
                                type: "button",
                                className: "balance-settings__btn balance-settings__btn--primary",
                                onClick: onDoInstall,
                                children: "更新",
                              })
                            : null,
                        ],
                      }),
                    ],
                  }),
                  updateNote
                    ? jsx.jsx("div", { className: "balance-settings__update-note", children: updateNote })
                    : null,
                ],
              }),

              // 节假日同步紧跟在「版本与更新」下面：两者都是「后台自动补一次 + 可手动触发」，
              // 放一起比塞在「计费」末尾好找。数据本身仍然决定算钱口径，只是入口挪了位置。
              group("calendar", "节假日数据", [
                row(
                  "calendar",
                  "同步状态",
                  "法定节假日与调休从国务院公告同步。插件每 30 天自动同步一次，这里可以手动立即更新。",
                  jsx.jsxs("div", {
                    className: "balance-settings__calendar",
                    children: [
                      jsx.jsx("span", {
                        className:
                          "balance-settings__calendar-note" +
                          (calendarSync.kind === "error"
                            ? " balance-settings__calendar-note--error"
                            : calendarSync.kind === "ok"
                              ? " balance-settings__calendar-note--ok"
                              : calendar.fetchedAt > 0
                                ? ""
                                : " balance-settings__calendar-note--warn"),
                        children: calendarSummary,
                      }),
                      jsx.jsx("button", {
                        type: "button",
                        className: "balance-settings__btn",
                        onClick: onSyncCalendar,
                        disabled: calendarBusy,
                        children: calendarBusy ? "同步中…" : "立即同步",
                      }),
                    ],
                  }),
                ),
              ]),

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
            choiceRow("footerStyle", "余额行样式", "新版：上方一行文字信息 + 扁刻度条；旧版：钱包图标 + 「余额」 + 金额的纯文字行。", [
              { value: "timeline", label: "新版" },
              { value: "classic", label: "旧版" },
            ]),
            toggleRow(
              "showSidebarEntry",
              "侧边栏显示本插件",
              "在左侧导航栏底部（插件 / 自动化任务 那一组）加一个「余额与用量」入口，点开是本页。关掉之后要再打开，走侧边栏「插件」→ balance-dsh。改这一项需刷新页面。",
              (next) => {
                patch("showSidebarEntry", next);
                if (next === false) setSidebarTip(true);
              },
            ),
            // 这两项各只属于一种样式，按当前选择出现：
            //   浪潮 = 新版独有（旧版刷新走「刷新中…」文字，没有白条可关）
            //   时段标签 = 新版不可关闭（刻度条是新版的结构主体），只有旧版才允许收成纯金额
            value.footerStyle === "timeline"
              ? toggleRow("refreshWave", "右键刷新浪潮", "右键余额时，金额会被一道白光从左往右擦出来（和输入区「本会话消耗」同一个动效）。")
              : null,
            toggleRow("showUsagePill", "会话消耗行", "输入框下方的「本会话消耗」胶囊（含点开的明细浮层）。"),
            // 两种加载动效互斥，用分段按钮选（和「余额行外观」同一个控件，视觉一致）。
            // 选项文字用「样式1 / 样式2」而不是效果名，所以旁边直接播一个真预览 ——
            // 用户不用读描述、看动画就知道选的是哪个（2026-10-31 要求「在介绍栏预览给用户看」）。
            // 预览**只画当前选中的那一个**（第十三轮：「只预览当前选择的样式」），节点跟着 value 走。
            choiceRow("usageLoadingStyle", "消耗行加载动效", "等对话用量时显示什么。", [
              { value: "wipe", label: "样式1" },
              { value: "text", label: "样式2" },
            ], jsx.jsx("div", {
              className: "balance-settings__preview",
              "aria-hidden": "true",
              children: jsx.jsxs("div", {
                className: "balance-settings__preview-item",
                children: [
                  jsx.jsx("span", {
                    className: "balance-settings__preview-tag",
                    children: value.usageLoadingStyle === "text" ? "样式2" : "样式1",
                  }),
                  jsx.jsxs("span", {
                    className: "balance-settings__preview-stage",
                    children: [
                      jsx.jsx("span", {
                        className: "balance-settings__preview-text",
                        // 与真实胶囊同一个文案（2026-11-01 用户先说改成「本会话消耗估算」，随后又让把「估算」二字删掉）
                        children: "本会话消耗",
                      }),
                      value.usageLoadingStyle === "text"
                        ? jsx.jsxs("span", {
                          className: "balance-usage-calc",
                          children: [
                            "计算中",
                            jsx.jsx("span", {
                              className: "balance-usage-calc__dots",
                              "aria-hidden": "true",
                              children: [0, 1, 2].map((i) => jsx.jsx("span", { className: "balance-usage-calc__dot", children: "." }, i)),
                            }, "dots"),
                          ],
                        })
                        : jsx.jsx("span", {
                          className: "balance-usage-mist",
                          children: ORB_INDICES.map((i) => jsx.jsx("span", { key: "orb-" + i, className: "balance-usage-mist__orb" })),
                        }),
                    ],
                  }),
                ],
              }, "p-cur"),
            })),
            value.footerStyle === "classic"
              ? toggleRow("showPeriodLabel", "高峰 / 空闲标签", "旧版余额行里「金额 • 时段」的时段部分；关掉后只留金额。")
              : null,
          ]),

          group("fab", "收起态圆钮", [
            toggleRow("showFab", "显示圆钮", "收起侧边栏时左下角的悬浮圆形余额。"),
            numberRow("fabSize", "直径", "圆钮大小；圆内字号按比例缩放。", 32, 120, "px"),
            numberRow("fabLeft", "距左缘", "数值越大越靠右。", 0, 600, "px"),
          ]),

          group("stats", "用量统计", [
            numberRow("todaySessionLimit", "今日消耗扫描上限", "启动时最多统计今天动过的多少个会话（多开对话、多跑子代理时调大，越大越全也可能越慢）。", 10, 2000, "个"),
            numberRow("statsSessionLimit", "扫描会话数上限", "统计面板最多回看多少个历史会话（越大越慢）。", 10, 2000, "个"),
            numberRow("statsCacheSec", "统计缓存时长", "统计结果缓存多久；0 = 每次重新扫描。", 0, 3600, "秒"),
          ]),

          group("billing", "计费", [
            // 官方改时段就等于改「哪几个小时翻倍」。留成可编辑项，
            // 以后即使没人改代码，用户自己也能跟上官方口径。
            textRow(
              "peakWindowsText",
              "高峰时段",
              "工作日北京时间的这些时段按高峰计价。格式 9-12, 14-18（官方当前值）。写错了自动沿用上一组有效值。",
              "9-12, 14-18",
            ),
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

          // 关掉侧边栏入口后的提醒：直接用 DSH 官方 Modal 渲染。
          tipModal && sidebarTip
            ? jsx.jsx(tipModal, {
                open: true,
                title: "已关闭侧边栏入口",
                closeLabel: "关闭",
                onClose: tipClose,
                footer: tipFooter,
                children: jsx.jsx("p", {
                  className: "balance-tip-body",
                  children:
                    "之后想再打开，去侧边栏「插件」→ balance-dsh，就能回到这个设置页，"
                    + "把「侧边栏显示本插件」重新打开。刷新页面后生效。",
                }),
              })
            : null,
        ],
      });
    }

    // ─── 插件主体 ───────────────────────────────────────────────────────────
    // ⚠️ 只 inject slots。`sessions` 是**可选**服务，只用来解析当前会话的模型
    // （取不到就退回服务端 detectModel / 默认 flash 价），把它写进 inject 意味着
    // DSH 哪天不再提供它，整个 apply 会被跳过 —— 5 个 slot 全部不注册、界面静默消失，
    // 而这个插件已经因为 DSH 内部 API 变动崩过多次（见 AGENTS 铁律 4：
    // 可选服务用 ctx.get() 拿，不要放进 inject）。改成运行时探测，缺了只降级模型解析。
    const inject = ["slots"];

    function apply(ctx) {
      // 拿到 sessions 服务，用于解析当前会话使用的模型（按模型取价）。
      // ctx.get() 不会因未声明注入而抛错，服务不存在时返回 undefined。
      sessionsFace = typeof ctx.get === "function" ? ctx.get("sessions") : void 0;
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
      // ⚠️ conversation.composer.bar 的注册已撤除（2026-10-31）。
      // 试过把收起态余额塞进 composer 内部（「红圈是在聊天框里面」），但注册后
      // 侧栏余额行和消耗行**同时消失**，整个插件看起来没加载。DSH 的这个 slot
      // 名即使存在也不接受这种用法，且 slots.register 静默失败、无日志可查。
      // 收起态继续用矩阵浮层（bottom 已抬到 140px，不会压 composer）。
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

      // 左侧导航栏面板入口（1.3.2）：
      //   sidebar.panellist = 列表型 slot，DSH 拿 options.id / options.label / options.order
      //                       生成「图标 + 文字」那一行（插件 / 自动化任务 / Purge / 更多 同一组），
      //                       slot 本体只负责画图标（wide 时尺寸 16，收起态 18）。
      //   点击后 DSH 调 layout.selectPanel(id)，主区域用 keyed slot "main" 按 activePanelId 取内容，
      //   所以再注册一个 key 同名的 main 条目就是点开后的页面。
      // 开关「侧边栏显示本插件」要**立刻**生效，不能等刷新：
      //   拿到 disposer 就把它注销掉（整行消失），拿不到就退回组件内 return null（图标消失）。
      //   注意别在 inject 回调里按当时的缓存值提前 return —— 那时 fetchSettingsOnce 还没回来，
      //   settingsCache 永远是默认值 true，开关会看起来完全没反应。
      ctx.slots.inject("sidebar.panellist", () => {
        let dispose = null;
        let registered = false;
        const syncEntry = () => {
          const want = settingsCache.value.showSidebarEntry !== false;
          if (want && !registered) {
            const result = ctx.slots.register(
              {
                name: "sidebar.panellist",
                id: "balance",
                order: 30,
                label: "余额与用量",
              },
              BalancePanelIcon,
            );
            registered = true;
            dispose = typeof result === "function" ? result : null;
            return;
          }
          if (!want && registered && dispose) {
            try {
              dispose();
            } catch {
              return;
            }
            registered = false;
            dispose = null;
          }
        };
        syncEntry();
        settingsListeners.add(syncEntry);
        return () => {
          settingsListeners.delete(syncEntry);
          if (dispose) {
            try {
              dispose();
            } catch {
              /* 释放失败不影响卸载 */
            }
            dispose = null;
            registered = false;
          }
        };
      });
      // 启动检查更新：等 UI 先跑起来再查（2.5s），别跟首屏抢网络。
      // 每次页面加载 = 每次打开 DeepSeek Harness，符合「每次打开都检查一次」。
      // 节假日数据：跟更新检查一样是「后台补一次」，但更早 —— 峰谷标签一上来就该是准的。
      void fetchCalendarStatus();
      if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
        window.setTimeout(() => {
          void checkUpdateOnStartup();
        }, 2500);
      }

      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: "balance",
          },
          BalancePanelPage,
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
