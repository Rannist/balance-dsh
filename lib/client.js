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
   左缘与设置按钮严格对齐，高度/颜色一致（金额 600 加粗）。
   布局：[meta + 刻度条（竖排，居中）] [金额（最右）] */
.balance-footer{position:relative;isolation:isolate;box-sizing:border-box;display:flex;align-items:center;justify-content:flex-start;gap:8px;width:100%;min-width:0;height:42px;margin:0;padding:0 0 0 8px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;text-decoration:none;cursor:pointer;white-space:nowrap;overflow:visible;-webkit-user-select:none;user-select:none}
/* 带 meta 行时整块变高：42px 装不下「一行 11px 文字 + 13px 轨道」，改成自适应 */
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
.balance-footer__dcell--roll{position:relative;overflow:hidden}
.balance-footer__dghost{display:block;visibility:hidden;white-space:pre}
.balance-footer__dout,.balance-footer__din{position:absolute;left:0;top:0;white-space:pre;will-change:transform,opacity}
.balance-footer__dout{animation:balance-roll-out .42s cubic-bezier(.33,.66,.24,1) forwards}
.balance-footer__din{animation:balance-roll-in .42s cubic-bezier(.33,.66,.24,1) forwards}
@keyframes balance-roll-out{0%{transform:translateY(0);opacity:1}60%{opacity:0}100%{transform:translateY(-105%);opacity:0}}
@keyframes balance-roll-in{0%{transform:translateY(105%);opacity:0}40%{opacity:0}100%{transform:translateY(0);opacity:1}}
/* 逐位滚动不受 prefers-reduced-motion 影响：它是"这轮花掉多少"的即时反馈，是插件特色 */
.balance-footer__wave{position:absolute;left:0;right:0;top:0;bottom:0;overflow:hidden;border-radius:var(--dsw-radius-lg,14px);corner-shape:round;pointer-events:none;z-index:2}
/* 前沿白条：纯白，不带品牌色辉光（2026-10-30 反馈「只保留白色光效 不要颜色」）。
   只扫一层白光，**不覆盖扫过区域**——曾经有一个 ::after 暗罩把白条右侧整体压暗，
   视觉上等于给扫过的部分蒙了层色，已删除（2026-10-30 反馈「不要为扫过区域的颜色覆盖了」）。
   现在动效 = 一条白光从左走到右，走完即止，行内颜色全程不变。 */
.balance-footer__wave::before{content:"";position:absolute;top:1px;bottom:1px;left:0;width:2.5px;margin-left:-1.25px;border-radius:999px;corner-shape:round;background:#fff;box-shadow:0 0 3px 1px rgba(255,255,255,.95),0 0 8px 3px rgba(255,255,255,.42),0 0 14px 5px rgba(255,255,255,.16);animation:balance-wipe-head .58s cubic-bezier(.34,.7,.26,1) forwards}
@keyframes balance-wipe-head{0%{left:0;opacity:0}5%{opacity:1}82%{opacity:1}100%{left:100%;opacity:0}}
/* 尊重系统的「减少动态效果」：不播，只留 --stale 的静态弱化 */
/* 浪潮白条不受 prefers-reduced-motion 影响：它是右键刷新的签名动效，故意保留 */
/* 旧版余额行用到的图标与「余额」二字（footerStyle === "classic" 时才渲染） */
.balance-footer__icon{display:inline-flex;flex:none;color:var(--dsw-alias-label-primary)}
.balance-footer__label{flex:none;color:var(--dsw-alias-label-primary)}
.balance-footer__value{box-sizing:border-box;position:relative;z-index:0;isolation:isolate;display:inline-flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums;font-weight:600;font-size:16px;line-height:1;white-space:nowrap;padding:7px 14px;border-radius:999px;corner-shape:round;margin-left:auto;margin-right:4px;text-decoration:none;cursor:pointer;transition:transform .15s var(--ds-ease-in-out,.2s);flex:none;/* 宽度恒定 121px：靠「固定 px + 位数多就缩字号」两条一起实现。
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
.balance-footer__value:hover{filter:brightness(.85);transform:scale(1.06)}
/* 旧版布局：胶囊靠右 —— 这是备份 v1.3.1 里的原始写法（margin-left:auto）。
   不能放到基础规则上，新版 timeline 用 margin:0 auto 居中，会和它打架。 */
.balance-footer--classic .balance-footer__value{margin-left:auto}
.balance-footer__value--healthy{color:var(--dsw-alias-state-success-primary);background:rgba(34,197,94,.15)}
/* 正在刷新：金额栏压成半透明旧值，和左侧的时段占位呼应，避免旧数字看起来像刚更新的 */
.balance-footer__value--stale{opacity:.9}
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
/* 「今日 ¥x」独占第一行（flex-basis:100%），于是下面那行永远是「空闲 剩 3h57m」。
   不加这条时宽度够就会并成一行，用户看到的顺序就变成「今日 … 空闲 剩 …」，
   得不到他要的「空闲跟剩余时间一栏」（2026-10-30 指定）。
   ⚠️ 必须配 text-align:center：占满 100% 之后默认是左对齐，而下面那行 group 是居中的，
   两行就会错开（2026-10-30 反馈「今日消费位置不对」）。 */
.balance-footer__timeline-meta-item--today{flex:0 0 100%;text-align:center}
/* 「今日 ¥x」数据没到时的占位：不可见但占位，高度先占好，数据到了只换文字、不动布局。
   ⚠️ 不要改回条件渲染或 display:none —— 那会让 meta 行从 1 行变 2 行，
   侧栏底部整体被顶下 14px，冷启动时就是「今日余额弹出来那下卡了」（2026-10-30 反馈）。 */
.balance-footer__timeline-meta-item--pending{visibility:hidden}
/* 占位换成真实值时淡入，而不是「啪」一下闪出来。
   ⚠️ 用 animation 不用 transition —— 元素刚从 visibility:hidden 显形，
   起点值不一定被浏览器算过，transition 可能整段被吞（同指针那条教训，2026-10-30）。
   类常驻但 key 不变，所以只在「占位 → 真实值」这一次播；之后金额随轮询变化不会重播。 */
.balance-footer__timeline-meta-item--in{animation:balance-today-in .3s cubic-bezier(.25,.8,.35,1) both}
@keyframes balance-today-in{from{opacity:0}to{opacity:1}}
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
.balance-fab{box-sizing:border-box;position:fixed;left:44px;bottom:12px;z-index:9998;width:60px;height:60px;padding:0;border-radius:50%;corner-shape:round;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.01em;text-decoration:none;white-space:nowrap;overflow:hidden;cursor:pointer;pointer-events:auto;background:color-mix(in srgb,var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-base,#1b1b1c)) 58%,transparent);-webkit-backdrop-filter:blur(18px) saturate(180%);backdrop-filter:blur(18px) saturate(180%);border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 26%,transparent),inset 0 -1px 1px color-mix(in srgb,#fff 8%,transparent),0 6px 20px rgba(0,0,0,.28);transition:transform .18s var(--ds-ease-in-out,ease-out),background .18s var(--ds-ease-in-out,ease-out),box-shadow .18s var(--ds-ease-in-out,ease-out)}
.balance-fab:hover{transform:scale(1.06);background:color-mix(in srgb,var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-base,#1b1b1c)) 76%,transparent);box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 34%,transparent),inset 0 -1px 1px color-mix(in srgb,#fff 10%,transparent),0 10px 26px rgba(0,0,0,.34)}
.balance-fab:active{transform:scale(.95)}
/* 金额偏长时（如 ¥1234.56）自动收一号字，免得 60px 圆里挤爆 */
.balance-fab--dense{font-size:11px;letter-spacing:-.03em}
.balance-fab-dark{color:#fff;background:color-mix(in srgb,#e5484d 62%,transparent);border-color:color-mix(in srgb,#fff 22%,transparent)}
.balance-fab-dark:hover{background:color-mix(in srgb,#e5484d 78%,transparent)}
/* ── 消耗行 pill：规格逐条照抄 DSH 原生 StatsPills 的 .pill（iq1doa_pill）──
   圆角是 --dsw-radius-sm（小圆角矩形），不是 999px 胶囊；也不要加
   corner-shape:round —— 原生 hover/展开态就是这个小圆角背景，写成胶囊对不上。 */
.balance-usage-wrap{min-width:0;display:inline-flex}
.balance-usage-line{box-sizing:border-box;max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);font-variant-numeric:tabular-nums;line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;background:0 0;border:none;border-radius:var(--dsw-radius-sm);align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}
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
.balance-settings__notice-icon{flex:none;margin-top:1px;color:var(--dsw-alias-brand-primary,#4d6bfe)}
.balance-settings__notice-text{min-width:0}
/* 分组说明条：不是灰小字，而是带图标的淡蓝提示条——要一眼看见「仅支持 DeepSeek Harness」。
   底色用品牌色 10%、边框 26%，文字提到 secondary；图标跟文字同色。 */
.balance-settings__group-note{display:flex;align-items:flex-start;gap:7px;margin:3px 0 5px;padding:8px 10px;border-radius:var(--dsw-radius-md,8px);border:.5px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 26%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 10%,transparent);font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.balance-settings__group-note-icon{flex:none;margin-top:1.5px;color:var(--dsw-alias-brand-primary,#4d6bfe);opacity:.9}
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
.balance-settings__calendar-note{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary);text-align:right;font-variant-numeric:tabular-nums;max-width:200px}
.balance-settings__calendar-note--warn{color:var(--dsw-alias-state-warn-primary,#d97706)}
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
    const cnCalendarYears = new Set();
    async function ensureCnCalendar(year) {
      if (cnCalendarYears.has(year)) return;
      cnCalendarYears.add(year); // 先占位，避免并发重复请求
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
          return;
        } catch {
          // 这个源连不上：换下一个；全挂就保留内置表
        }
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

    const NEW_TAG_TTL_MS = 3 * 24 * 60 * 60 * 1000; // NEW 徽标展示 3 天

    /** 单项 NEW 判定。每项自带起点，互不影响：
     *  - record 里已记下这一版（v === intro）→ 就用 t 计时，不再判 fresh
     *    （否则刚记完就会因 "intro 不大于自己"而立刻消失）
     *  - 没记录或引入版本变了 → 比较「引入版本 vs 用户见过的版本」
     *  旧功能因 fresh=false 直接不显示，所以不可能被新版本重新计时。 */
    function newTagStateAt(introVersion, record, fallbackFrom, fallbackSince, nowMs) {
      const intro = String(introVersion || "");
      if (intro === "") return { fresh: false, show: false, since: 0 };
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
      // 已经按这一版记录过：用户第一次见到它就是 t，直接按 t 计时
      if (recV !== "" && recV === intro) {
        const since = Number.isFinite(recT) && recT > 0 ? recT : Number(fallbackSince);
        return { fresh: true, show: within(since), since: pick(since) };
      }
      // 没记录（或引入版本变了）：才判这项对用户算不算新
      const baseline = recV !== "" ? recV : String(fallbackFrom || "");
      const fresh = baseline === "" || compareVersion(intro, baseline) > 0;
      if (!fresh) return { fresh: false, show: false, since: 0 };
      const since = Number(fallbackSince);
      return { fresh: true, show: within(since), since: pick(since) };
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
    function buildTimeline(now) {
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
      return {
        gradient: "linear-gradient(90deg," + parts.join(",") + ")",
        pointerPct: pct(now),
      };
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
      entrySeen: false,
      newTagVersion: "",
      newTagSince: 0,
      newTagFrom: "",
      newTagSeen: {},
      fabSize: 60,
      fabLeft: 44,
      statsSessionLimit: 200,
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
        // latest 变了才重置 seen —— 用户已经无视过 2.1.0，再出 2.2.0 仍然要提示
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
    const todayCache = { value: null, inFlight: null, at: 0, tried: false };
    const todayListeners = new Set();
    function notifyToday() {
      for (const listener of todayListeners) listener();
    }
    /** 拉一次今日消耗。失败/未支持时保持 null（meta 行只显示时段与剩余时间）。 */
    function fetchTodayOnce(force) {
      if (!force && Date.now() - todayCache.at < 55000) return Promise.resolve(todayCache.value);
      if (todayCache.inFlight !== null) return todayCache.inFlight;
      todayCache.inFlight = (async () => {
        try {
          const res = await fetch("/balance-api?today=1", { headers: { accept: "application/json" } });
          if (!res.ok) return todayCache.value;
          const data = await res.json();
          if (data && typeof data.today === "object" && data.today !== null) {
            todayCache.value = data.today;
            todayCache.at = Date.now();
            notifyToday();
          }
        } catch {
          // 静默：今日消耗拿不到就不显示，不影响余额
        } finally {
          todayCache.inFlight = null;
          // 只在「问过但没拿到」时才需要通知：成功路径上面已经 notify 过了。
          // 这样失败时会撤掉占位，不会永久留一条空行。
          if (!todayCache.tried) {
            todayCache.tried = true;
            if (todayCache.value === null) notifyToday();
          }
        }
        return todayCache.value;
      })();
      return todayCache.inFlight;
    }
    function useToday() {
      const [, force] = react.useState(0);
      react.useEffect(() => {
        const listener = () => force((n) => n + 1);
        todayListeners.add(listener);
        void fetchTodayOnce(false);
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
    // 浪潮计数器：右键时自增，余额行把它当 key 用，key 变 → 波浪层重挂 → 动画从头播。
    // 之所以不用 animation 的重播属性，是因为 key 重挂最稳，且能保证连点每次都重新触发。
    let waveSeq = 0;
    const waveListeners = new Set();
    function emitWave() {
      for (const listener of waveListeners) listener();
    }

    // 手动刷新窗口：右键时记下时间戳，随后到来的那次余额变化算"手动"，
    // 走白条抹除；超出窗口或窗口内没等来变化，就都按自动刷新处理 —— 走数字滚轮。
    // 两条动效互斥，不会同时出现。
    const MANUAL_WAVE_WINDOW_MS = 4000;

    // 网页搜索 / 抓取：官方 2026-10-17 上线独立计费，¥5 / 千次 = ¥0.005 / 次，
    // 北京时间 2026-11-01 00:00 起开始收费（此前免费）。与 lib/index.js 同名常量保持一致。
    const WEB_TOOL_BILLING_START = Date.parse("2026-11-01T00:00:00+08:00");
    let manualWaveAt = 0;
    // 抹除动效时长，必须与 CSS 里 balance-wipe-head 的 .58s 一致。
    // 改动画时长时这里也要改，否则锁的时间对不上（太短会重播打断，太长会像"点了没反应"）。
    const WAVE_DURATION_MS = 580;
    // 动效播放中的排他锁：这段时间内的右键一律忽略。
    // 目的是保证「一次抹除 = 一次真实刷新」，既不出现"白条扫完余额没动"，
    // 也不出现"余额变了但动效没播/播了一半被打断"（2026-10-30 反馈）。
    let manualRefreshLockedUntil = 0;

    function waveLockDuration() {
      // 恒等于动画时长。刻意**不**跟随 prefers-reduced-motion —— 白条是本插件的
      // 签名动效，系统开了「减少动态效果」也照播（用户明确要求，别再加回判断）。
      return WAVE_DURATION_MS;
    }

    function onBalanceContextMenu(event) {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      const now = Date.now();
      // 浪潮特效只在 timeline 版且没关时才播。关掉动效就没有可播的东西，
      // 下面两条限制一并取消，回到原来纯 800ms 防抖的行为。
      const waveOn = settingsCache.value.refreshWave !== false;
      // ① 动效还没播完：整次右键作废（不动效、不刷新余额），等它播完再让下一次进来。
      if (waveOn && now < manualRefreshLockedUntil) return;
      // ② 这次点击是否真的会发出请求——判据与 fetchBalanceOnce 内部完全一致。
      const willFetch = !balanceFetchInFlight && now - lastBalanceFetchAt >= BALANCE_REFRESH_MIN_INTERVAL;
      // ③ 会被 800ms 防抖吃掉、根本不会刷新的点击，连动效也不播。
      //    否则白条扫了一遍而余额纹丝不动，看起来像"动了但没扣费"。
      if (waveOn && !willFetch) return;
      if (waveOn) {
        manualRefreshLockedUntil = now + waveLockDuration();
        manualWaveAt = now;
        waveSeq += 1;
        emitWave();
      }
      // 白条是"你点了，我扫一遍"的即时反馈；轮询/对话触发的自动刷新不扫光，
      // 改用数字上下滚动（见 BalanceFooter 里的 roll）。
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

    function BalanceFooter({ wide }) {
      const state = useBalance();
      const settings = useSettings();
      const today = useToday();
      // 订阅浪潮计数器：右键时递增，触发重渲染；波浪层用 waveSeq 当 key 重挂来重播动画
      const [, forceWave] = react.useState(0);
      react.useEffect(() => {
        const listener = () => forceWave((n) => n + 1);
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
      react.useEffect(() => {
        const prev = lastRollTextRef.current;
        lastRollTextRef.current = rollText;
        if (rollText === null || prev === null || prev === rollText) return;
        const manual = manualWaveAt !== 0 && Date.now() - manualWaveAt < MANUAL_WAVE_WINDOW_MS;
        manualWaveAt = 0;
        if (manual) return;
        setRoll({ from: prev, to: rollText, at: Date.now() });
      }, [rollText]);

      // 逐位拆开：只有真正变了的数位才做上下滚动，其余（小数点、货币后缀、
      // 以及没变的高位数字）原样静止。所以花掉 0.01 时只有末位在翻，
      // 花掉 1 块才会带动个位 —— 滚动范围跟着实际扣减的量走。
      //
      // 关键在于"按小数点对齐"而不是整串左对齐：
      //   11.04 CNY → 8.04 CNY，左对齐会变成 1↔8 / 1↔. / .↔0 …整串错位，
      //   按小数点分三段（整数右对齐、小数点一位、小数左对齐）之后，
      //   整数位各自对位、小数 .04 原样不动，只有该变的位在翻。
      const rollCells = roll === null ? null : (() => {
        const split = (text) => {
          const m = /^([0-9]*)(\.?)([0-9]*)([\s\S]*)$/.exec(text);
          return m
            ? { int: m[1], dot: m[2], frac: m[3], tail: m[4] }
            : { int: "", dot: "", frac: "", tail: text };
        };
        const a = split(roll.from);
        const b = split(roll.to);
        const EMPTY = "\u0000";
        const padLeft = (s, n) => s.padStart(n, EMPTY);
        const padRight = (s, n) => s.padEnd(n, EMPTY);
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
          for (let i = 0; i < left.length; i++) {
            cells.push({ from: left[i], to: right[i], changed: left[i] !== right[i] });
          }
        }
        return cells;
      })();
      react.useEffect(() => {
        if (roll === null) return;
        const id = setTimeout(() => setRoll(null), 480);
        return () => clearTimeout(id);
      }, [roll]);
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
      // 指针位置见模块作用域的 TimelinePointer —— 刻意拆成独立组件：
      // 补间只重渲染那一根 2px 竖条，不会带着整个余额行一起重渲染。
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
        ref: anchorRef,
        className: "balance-stats-anchor balance-stats-anchor--" + (wide ? "wide" : "compact"),
        style: anchorStyle,
        ...(extraProps || null),
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

      // 右键刷新的浪潮层：只服务新版（timeline）。旧版保持备份里的原样反馈——
      // 时段文字换成灰色「刷新中…」，不扫光。key 绑定 waveSeq，右键自增 → 重挂 → 动画重播。
      const waveNode = settings.refreshWave === false
        ? null
        : jsx.jsx("span", { className: "balance-footer__wave", key: "wave-" + waveSeq });

      if (state.status === "error") {
        return withPanel(jsx.jsxs("div", {
          className: "balance-footer",
          ...interactions,
          children: [
            // 失败原因统一走主题化浮层，避免把长错误塞进 42px 的余额行
            jsx.jsx(primitives.Tooltip, {
              label: state.error || "余额查询失败",
              side: "top",
              delayMs: 200,
              children: jsx.jsx("span", { className: "balance-footer__error", children: "余额读取失败" }),
            }),
          ],
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
      // 位数多就降字号：一旦整数位到 4 位，16px 的胶囊会宽过 121px 的固定宽度
      // （1234.56 CNY 131.3px / 12345.67 CNY 141.1px），把自己撑出容器右缘。
      // 降一档字号就能收回来，宽度重新恒定 —— 配合 .balance-footer__value 的 min-width。
      const valueDensity = amountDensity(b.total_balance);
      if (depleted) {
        return withPanel(jsx.jsxs("div", {
          className: "balance-footer",
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
      const period = currentPeriod(timelineNow);
      const low = total > 0 && total < lowThreshold;
      // 时段模块：上方一行 meta（今日消耗 · 时段 · 剩余时间）+ 下方扁刻度条。
      // 色带固定 = 当天完整时段，指针 = 此刻在当天的位置。
      const span = periodSpan(timelineNow);
      // meta 分两段：①「今日 ¥x」②「时段词 + 剩余时间」。
      // 第二段整体不换行（包在 __group 里），所以窄侧栏折行时一定是
      // 「今日 ¥x」独占上面一行、「空闲 剩 3h57m」落到下面一行 —— 用户 2026-10-30 指定。
      const metaItem = (text, cls, key) =>
        jsx.jsx("span", { className: "balance-footer__timeline-meta-item" + (cls || ""), children: text }, key);
      const tail = [
        metaItem(period === "peak" ? "高峰" : "空闲", " balance-footer__timeline-meta-item--" + period, "period"),
      ];
      if (span !== null) tail.push(metaItem("剩 " + formatRemain(span.remainMs), "", "remain"));
      const metaChildren = [];
      // 「今日 ¥x」独占一行（CSS 里 flex-basis:100%）。数据没到之前先摆一个不可见占位，
      // 让这一行的高度从一开始就是最终高度 —— 条件渲染会让整块从 1 行变 2 行，
      // 侧栏底部（含设置按钮）整体被顶下 14px，那一下重排就是「今日余额弹出来时卡住」。
      // 占位只在「还在等」时出现；确认拿不到（tried 且为 null）就整项不渲染，不留空行。
      const todayCost = today !== null && Number.isFinite(Number(today.cost)) ? Number(today.cost) : null;
      const todayPending = todayCost === null && !todayCache.tried;
      if (todayCost !== null || todayPending) {
        metaChildren.push(
          jsx.jsx(
            "span",
            {
              className:
                "balance-footer__timeline-meta-item balance-footer__timeline-meta-item--today" +
                (todayCost === null ? " balance-footer__timeline-meta-item--pending" : " balance-footer__timeline-meta-item--in"),
              children: todayCost === null ? "今日 ¥--" : "今日 ¥" + todayCost.toFixed(2),
            },
            "today",
          ),
        );
      }
      metaChildren.push(
        jsx.jsx("span", { className: "balance-footer__timeline-meta-group", children: tail }, "tail"),
      );
      const metaNode = jsx.jsx("span", {
        className: "balance-footer__timeline-meta",
        children: metaChildren,
      });
      // 新版把「meta 行 + 刻度条」当结构主体，不存在"关掉只剩金额"的形态，
      // 所以这里不看 showPeriodLabel；那个开关只在旧版有意义（见下面的 classic 分支）。
      const timelineBand = buildTimeline(timelineNow);
      // 刷新时不替换时段模块：刻度条保持原样，刷新反馈只落在右侧金额（半透明 + 浪潮）。
      // 刻度条在 timeline 内部、meta 下方，宽度跟随侧栏（width:100%）：
      //   [今日 ¥x  /  空闲 剩 3h57m]              [胶囊]
      //   [==== 刻度条（跟随侧栏宽度）====]
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
          className: "balance-footer balance-footer--classic",
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
        className: "balance-footer balance-footer--stacked",
        children: [
          // 抹除层覆盖整块显示区（meta 行 + 时段条 + 金额）：白条经过哪里，哪里才显影
          waveNode,
          periodNode === null
            ? jsx.jsx("span", { className: "balance-footer__spacer" })
            : periodNode,
          jsx.jsx("span", {
            className: "balance-footer__value" + (low ? " balance-footer__value--low" : " balance-footer__value--healthy") + (state.refreshing ? " balance-footer__value--stale" : "") + valueDensity,
            children: rollCells === null
              ? totalText
              : jsx.jsx("span", {
                  className: "balance-footer__roll",
                  key: "roll-" + roll.at,
                  children: rollCells.map((cell, i) =>
                    cell.changed
                      ? jsx.jsxs("span", { className: "balance-footer__dcell balance-footer__dcell--roll", children: [
                          // 影子撑住这一格的尺寸（等于新字符），不显示
                          jsx.jsx("span", { className: "balance-footer__dghost", children: cell.to === "\u0000" ? "\u00a0" : cell.to }),
                          jsx.jsx("span", { className: "balance-footer__dout", children: cell.from === "\u0000" ? "\u00a0" : cell.from }),
                          jsx.jsx("span", { className: "balance-footer__din", children: cell.to === "\u0000" ? "\u00a0" : cell.to }),
                        ] }, i)
                      : jsx.jsx("span", { className: "balance-footer__dcell", children: cell.to === "\u0000" ? "\u00a0" : cell.to }, i)
                  ),
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
      const usage = typeof useProjection === "function" ? useProjection("tokenUsage") : undefined;
      // 分时段分桶按「会话 → 分桶」存档。切换会话时 React 不会重建组件，旧会话的分桶
      // 会留在 state 里；不带会话归属就会拿上一个会话的金额当本会话显示
      // （切对话瞬间金额先跳到别的数字、再跳回正确值——2026-10-30 反馈）。
      // 存成表而不是单值：来回切会话时命中缓存，立刻就是正确金额，不闪。
      const SPLIT_CACHE_MAX = 6;
      const [splitMap, setSplitMap] = react.useState(() => ({}));
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
          // 拿不到也记一条（usage:null），表示"这个会话已经问过了"，按本地估算走
          setSplitMap((prev) => {
            const next = { ...prev, [sessionId]: { usage: u ? u.usage : null, subagentUsage: u ? u.subagentUsage : null } };
            // 对象保持插入顺序，最旧的在最前；超出上限就淘汰它（避免长会话列表无限增长）
            const keys = Object.keys(next);
            for (let i = 0; i < keys.length - SPLIT_CACHE_MAX; i += 1) delete next[keys[i]];
            return next;
          });
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

      // 金额：优先用服务端分时段 usage（高峰桶×2+空闲桶）；未就绪时按当前时段价估算。
      // 只认本会话的分桶 —— 切到没缓存的会话时立刻退回本地估算，绝不用上一个会话的数据。
      const splitFor = sessionId ? splitMap[sessionId] || null : null;
      const split = splitFor ? splitFor.usage : null;
      const subagentUsage = splitFor ? splitFor.subagentUsage : null;
      // 服务端分桶可能"非 null 但为空"（拿不到该会话事件），此时必须回退本地投影估算，否则金额会显示 ¥0.0000
      const splitUsable =
        split != null && ((Array.isArray(split.byModel) && split.byModel.length > 0) || (split.totalTokens ?? 0) > 0);
      const cost = splitUsable ? computeSplitCost(split, p, peakMultiplier) : computeCost(usage, periodAdjustedPricing(p, peakMultiplier));
      const peakTokens = splitUsable ? split.peak.inputTokens + split.peak.cacheReadTokens + split.peak.cacheWriteTokens + split.peak.outputTokens : 0;
      const offpeakTokens = splitUsable ? split.offpeak.inputTokens + split.offpeak.cacheReadTokens + split.offpeak.cacheWriteTokens + split.offpeak.outputTokens : 0;

      // 子代理消耗（与主会话分开，同样跨时段精确计费）
      const hasSubagent = subagentUsage != null && subagentUsage.totalTokens > 0;
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
      const unread = settings.entrySeen !== true && !active && !updateHint;
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
      if (!unread && !updateHint) return svg;
      // 点一下图标（红点就在图标右上角，点哪都算）就立刻熄灯：
      // 本地先乐观置 true 并广播，红点在同一帧消失，不等 HTTP 往返；
      // 持久化走 fire-and-forget，失败也只是下次进来再写一次。
      // 用 pointerdown 而不是 click —— panellist 那一行的 click 归 DSH 的 selectPanel 处理，
      // pointerdown 只负责"标记已读"，不抢它的点击行为（事件照常冒泡）。
      const markSeen = () => {
        // 两个红点原因各自熄各自的：不能因为 entrySeen 已是 true 就整段 early return，
        // 否则「有新版本」那颗点永远清不掉。
        if (updateHint) {
          updateNotice = { ...updateNotice, seen: true };
          emitUpdateNotice();
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
      // 有新版 → 「新版本！」胶囊（品牌色实心，压在图标右上、落在入口文字上方）；
      // 否则若没点开过 → 原来那颗未读红点。两者不同时出现。
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
        if (calendarSync.kind === "ok" || calendarSync.kind === "error") return calendarSync.text;
        if (calendar.fetchedAt > 0) {
          const at = new Date(calendar.fetchedAt);
          const stamp =
            at.getFullYear() + "-" + String(at.getMonth() + 1).padStart(2, "0") + "-" +
            String(at.getDate()).padStart(2, "0") + " " + String(at.getHours()).padStart(2, "0") + ":" +
            String(at.getMinutes()).padStart(2, "0");
          const years = calendar.years.length > 0 ? calendar.years.join(" / ") : "—";
          // 只报日期与时刻，不报完整年份列表：那串太长会把左边的标题挤成一字一行。
          // 「同步了哪几年」由服务端 days 的键直接决定，用户点「立即同步」那边也能看到。
          const pending = calendar.missing.length > 0 ? " · " + calendar.missing.join(" / ") + " 待公布" : "";
          return "已同步 " + calendar.count + " 天 · " + stamp.slice(5) + pending;
        }
        return "尚未同步，正在用插件内置表。";
      })();
      const onSyncCalendar = async () => {
        if (calendarBusy) return;
        setCalendarSync({ kind: "syncing", text: "正在同步…" });
        try {
          const data = await syncCalendar();
          if (data && data.ok === true) {
            const years = Array.isArray(data.years) && data.years.length > 0 ? data.years.join(" / ") : "—";
            const pending = Array.isArray(data.pending) && data.pending.length > 0
              ? "（" + data.pending.join(" / ") + " 待公布）"
              : "";
            setCalendarSync({
              kind: "ok",
              text: "已更新 " + years + "（" + (Number(data.added) || 0) + " 天）" + pending,
            });
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
        const merged = { ...valueRef.current, [key]: next };
        setDraft(merged);
        queueSave(merged);
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

      // NEW_TAGS：标准——「最近版本加了什么」。
      // 显示窗口 = 当前版本首次启动后 3 天（2026-10-30 反馈）：
      // 起点由服务端记在设置文件里（newTagSince / newTagVersion），
      // 版本一变就重置——所以用户一升级就会看到新的 3 天。不看 entrySeen。
      // 维护方式：发版时把本版新增的设置项 key 加进来，把上一版的移出去。
      // 每项带上「引入版本」：只有比用户上一次跑的版本更新的项才标 NEW。
      // 这样跨几个版本一次升上来的用户会看到所有中间新功能，
      // 而已经跑过这些功能的用户不会被重复提示。
      // 项目不再需要发版时手动「把上一版的移出去」——版本比较会自动过滤。
      const NEW_TAGS = new Map([
        ["footerStyle", "2.0.0"], // 余额行样式（新版 timeline / 旧版 classic）
        ["showSidebarEntry", "2.0.0"], // 左侧导航栏入口
        ["refreshWave", "2.0.0"], // 右键刷新涟漪
      ]);
      const newTagSince = Number(value.newTagSince);
      // 升级前的版本（空串 = 全新安装）
      const newTagFrom = String(value.newTagFrom || "");
      const newTagSeen = value.newTagSeen && typeof value.newTagSeen === "object" ? value.newTagSeen : {};
      const isNew = (key) => {
        const intro = NEW_TAGS.get(key);
        if (!intro) return false;
        return newTagStateAt(intro, newTagSeen[key], newTagFrom, newTagSince, Date.now()).show;
      };
      // 逐项记录「第一次见到」的时间：每个新功能各自从自己出现那一刻算 3 天，
      // 与其它功能的过期时间完全独立。设置还没加载完不能记（会误当全新安装）。
      react.useEffect(() => {
        if (settingsCache.loaded !== true) return;
        const now = Date.now();
        const patch = {};
        for (const [key, intro] of NEW_TAGS) {
          const rec = newTagSeen[key];
          // 已按这个版本记过了，不重复写盘、也不把起点往后推
          if (rec && typeof rec === "object" && rec.v === intro) continue;
          // 对用户不是新功能就不记（否则以后 baseline 变了会误显示）
          if (!newTagStateAt(intro, rec, newTagFrom, newTagSince, now).fresh) continue;
          patch[key] = { v: intro, t: now };
        }
        if (Object.keys(patch).length === 0) return;
        void saveSettings({ newTagSeen: { ...newTagSeen, ...patch } }).catch(() => {
          // 写盘失败不影响本次渲染：下次进入会重试
        });
      }, [newTagFrom, newTagSince, newTagSeen]);
      const row = (key, label, hint, control) => jsx.jsxs("div", {
        className: "balance-settings__row",
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

      // 二选一分段控件：用于「余额行外观」这类互斥选项
      const choiceRow = (key, label, hint, options) => row(key, label, hint, jsx.jsx("div", {
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
      }));

      // 整张设置卡片可折叠，形式对齐 DSH 原生 DisclosureRow —— 一行标题 + 描述 + 右侧 chevron，
      // 展开时箭头翻转 180 度。**默认展开**：只有插件列表里的单行摘要（view === "summary"）
      // 保持收起，点进详情页 / 设置页 / 侧栏面板页时一进来就摊开所有选项。
      const [openSettings, setOpenSettings] = react.useState(view !== "summary");
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
                  jsx.jsxs("svg", {
                    className: "balance-settings__group-note-icon",
                    viewBox: "0 0 16 16",
                    width: 14,
                    height: 14,
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
              // 顶部告示：计费范围限制放在最前面，打开设置第一眼就看到，
              // 不用翻到「计费」分组才发现。
              jsx.jsxs("div", {
                className: "balance-settings__notice",
                children: [
                  jsx.jsxs("svg", {
                    className: "balance-settings__notice-icon",
                    viewBox: "0 0 16 16",
                    width: 15,
                    height: 15,
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
              ? toggleRow("refreshWave", "右键刷新浪潮", "右键余额时，余额行从左往右扫过一道泛光亮带作为反馈。")
              : null,
            toggleRow("showUsagePill", "会话消耗行", "输入框下方的「本会话消耗」胶囊（含点开的明细浮层）。"),
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
