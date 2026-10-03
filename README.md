# balance-dsh

DSH 插件：在 Web UI 中直接显示 DeepSeek 账户余额和当前会话 token/金额消耗。

> **仅支持 DeepSeek，暂不支持其他大模型。**
> 余额读的是 DeepSeek 官方账号（未登录时回退 DeepSeek API Key），费用按 DeepSeek 官方价表估算，模型识别也只认 DeepSeek 的模型名。如果你通过其他厂商或自建服务用 DSH（OpenAI、Claude、本地模型等），本插件**不会**给出正确的余额和费用：余额会显示为不可用，模型会回落按 Flash 价估算，数字仅供参考。

## 功能

- **侧边栏余额行**：侧边栏展开时显示在底部（紧贴"设置"按钮上方），格式：钱包图标 + `余额` + 金额（带货币单位）+ 时段标签（高峰红 / 空闲绿）。金额按余额状态变色：充足绿色、偏低（<10）琥珀黄、为 0 显示红色"去充值"。
- **收起态圆钮**：侧边栏收起时，余额显示为左下角 **60px 圆形**悬浮按钮（liquid glass 质感，圆内显示 `¥金额`；大小和水平位置可在配置界面调整）。
- **自动刷新**：每 60 秒自动刷新一次（间隔可配置）；每次对话完成（新回复落库）也会立即刷新；右键余额任意区域可手动刷新。
- **余额与使用统计**：单击余额打开**居中弹窗**（带半透明模糊遮罩），展示账户余额、近 90 天计费 Token、估算费用、活跃天数、按模型与高峰/空闲拆分、今日/近 7 天/近 30 天、日均与峰值日，以及按日使用热力图；点遮罩 / 按 `Esc` / 点关闭按钮均可关闭，双击余额在**应用内**打开 DeepSeek 官方用量页（官方版自带内嵌浏览器，不再弹出系统浏览器；旧版环境自动回退到浏览器）。
- **高峰/空闲计费**：官方高峰窗口为**工作日 09:00-12:00、14:00-18:00（北京时间）**；周末、**中国法定节假日全天**都按空闲计费，**调休上班的周末按工作日**计峰谷。节假日安排会自动从公开数据源补录（内置 2026 年表作离线兜底，无需手动更新）。消耗金额**跨时段精确计费**：高峰时段的 token 按高峰价 ×2、空闲时段按目录价，按事件时间分桶计算。
- **会话消耗行**：对话框下方实时显示当前会话消耗（`数据库图标 + 本会话消耗 + ≈¥金额`），**点击**展开明细浮层（Token 用量、缓存命中率、模型、高峰/空闲拆分、子代理消耗）。
- **应用内查看官方用量**：双击余额、或点统计面板里的「查看官方用量」，都会在应用内嵌浏览器里打开官方用量页（余额、消费金额、请求次数、Tokens）；「去充值」同理。旧版 DSH 缺少内嵌浏览器时自动回退系统浏览器。
- **`/balance` 命令**：命令行查询余额明细和当前会话消耗。

### 使用统计口径

**插件显示的所有金额都是本地估算，不是 DeepSeek 官方账单。** 想要准确数字请用「查看官方用量」打开官方用量页（双击余额、或点统计面板里的按钮）。

- 热力图按北京时间聚合最近 90 天持久化会话中的 `assistant/message` Token usage。
- 费用按每条消息的**实际模型**和**峰谷时段**估算：高峰时段的 token 按高峰价、空闲时段按目录价，按事件分桶计算。
- **峰谷归属按「请求发起时刻」判定**（取 `step/start` 事件的 `time`；拿不到时回退消息完成时刻）。**官方并未公开跨时段请求到底按发起还是按完成计费**，所以这是一个合理猜测而非官方口径；如果官方实际按响应生成时间逐段计费，一次横跨边界的请求真实费用会介于「全高峰」和「全空闲」之间，本插件两种口径都算不出这个中间值。（实测影响很小：请求平均耗时约 6 秒，长请求也只到分钟级，撞上窗口边界的概率极低。）
- 其他已知误差来源：本地 token 数与官方计费口径可能不同（系统提示、工具调用的内部算法未公开）；缓存命中与否按 usage 字段判断，官方口径可能不同；官方调价后需等插件更新价表；模型靠事件里的切换点推断，同名不同版本分不清。
- 为避免历史会话过多拖慢 DSH，默认最多扫描最近 200 个会话；服务端统计和客户端展示结果均缓存 5 分钟，重复打开菜单不会重复请求。**这两个值、以及刷新间隔、各类显示开关，都能在下面的配置界面里改。**
- 账户余额优先读取 **DSH 官方账号**（官方版登录后即可用，无需 API Key）；未登录官方账号时回退到 API Key。两者都不可用时仍可查看本地 Token 与费用统计，只是余额会显示为不可用。

## 安装

前提：已安装 DSH Desktop，且知道自己的 profile 目录（通常是 `C:\Users\<你的用户名>\.dsh\profiles\desktop\`）。

### 方式一：通过 npm 安装（推荐）

```powershell
cd C:\Users\<你的用户名>\.dsh\profiles\desktop
pnpm add balance-dsh
```

### 方式二：从 tarball 安装

```powershell
cd C:\Users\<你的用户名>\.dsh\profiles\desktop
pnpm add "file:C:\path\to\balance-dsh-1.0.0.tgz"
```

### 方式三：从 GitHub 安装

```powershell
cd C:\Users\<你的用户名>\.dsh\profiles\desktop
dsh plugin --profile desktop add github:Rannist/balance-dsh
```

> 用 npm 安装后，插件自带 `dsh.bundle.patch`（`cordis.patch.yml`），安装即自动注册，**无需手动改 profile 的 cordis.patch.yml**。只有用旧版 tarball/手动方式时才需要手动注册：

```yaml
# profile 目录的 cordis.patch.yml（只有手动安装时才需要）
- insert:
    - id: balance
      name: balance-dsh
```

### 余额来源

**官方 DeepSeek Harness 桌面版**：在应用内登录 DeepSeek 账号后，插件会**自动读取官方余额，无需任何配置**。

**其他环境**（或不想登录官方账号时）：改用 API Key，三选一——

1. 环境变量 `DEEPSEEK_API_KEY`，或
2. 在注册项的 `config.apiKey` 中设置，或
3. 使用 DSH 凭据存储中的 `DEEPSEEK_API_KEY`

### 重启

服务端界面改动需**重启 DSH Desktop** 后生效。

## 配置

### 可视化配置（推荐）

DSH 主界面**左上角「插件」** → 点 `balance-dsh` → 详情页里的 **「余额与用量」** 卡片即可调整：

| 分组 | 可调项 |
|---|---|
| 余额 | 刷新间隔、低余额警示阈值、API Key |
| 界面显示 | 侧边栏余额行 / 会话消耗行 / 高峰空闲标签 的显隐开关 |
| 收起态圆钮 | 显示开关、直径、距左缘 |
| 用量统计 | 扫描会话数上限、统计缓存时长 |
| 计费 | 高峰时段倍率、自定义 Flash / V4-Pro 价格（留空 = 用官方默认价，只填一部分也行） |

改完点「保存设置」（想还原就点「恢复默认」再保存）。设置存放在你的 `.dsh` 目录下的 `balance-dsh.json`。**客户端项保存后刷新即生效；服务端项（刷新间隔、价格、统计范围、API Key）需重启 DSH Desktop。**

### 配置文件 / 注册项覆盖

也可以在插件注册项（或 `cordis.patch.yml`）中覆盖：

```yaml
- id: balance
  name: balance-dsh
  config:
    apiKey: sk-xxxx                        # 可选；缺省用 DEEPSEEK_API_KEY 环境变量/凭据
    peakWindows:                           # 可选；默认周一至周五，如下
      - {start: 9, end: 12}
      - {start: 14, end: 18}
    peakWeekdays: [1, 2, 3, 4, 5]          # 可选；1=周一 … 5=周五，0/6=周末
    price:                                 # 可选；逐项覆盖对应模型价格（元/百万 tokens）
      inputCnyPerMillion: 1
      cacheReadCnyPerMillion: 0.02
      cacheWriteCnyPerMillion: 0
      outputCnyPerMillion: 4
```

> 注意：插件已自动按高峰/空闲时段计费（高峰价 = 目录价 × 2），**不要再设置 `config.peak: true`**，否则会重复翻倍。

## 卸载

```powershell
cd C:\Users\<你的用户名>\.dsh\profiles\desktop
pnpm remove balance-dsh
```

如需删除手动注册行（若你手动加过），从 profile 的 `cordis.patch.yml` 移除对应的 `balance` 条目。

## 权限 / 数据

- 已登录官方账号时，余额通过 **DSH 内置账号服务**读取（登录凭据由应用自身管理，插件不接触、不保存任何 token）。
- 仅当回退到 API Key 时，才会向 `api.deepseek.com` 的 `/user/balance` 端点查询余额（且只在你**主动刷新**或对话完成时）。
- 插件不收集、不上传任何会话内容到第三方。
- 消费统计完全基于本地会话事件（`request/header`、`assistant/message` 的 token usage）计算，不向 DeepSeek 之外的服务发送数据。

## 价格表（空闲时段价，元/百万 tokens）

| 模型 | 输入（缓存未命中） | 输入（缓存命中） | 输出 |
|---|---|---|---|
| deepseek-flash | 1 | 0.02 | 4 |
| deepseek-v4-pro | 4.5 | 0.15 | 13.5 |
| deepseek-chat（旧） | 2 | 0.5 | 3 |
| deepseek-reasoner（旧） | 4 | 1 | 16 |

价格自 **2026-09-10 12:00（北京时间）** 起生效（flash 系列由 1.5 / 0.05 / 4.5 下调）；**高峰时段 = 空闲价 × 2**。调价前的历史消耗仍按当时的旧价计算，不会被重算。DeepSeek 再次调价时需同步更新 `lib/index.js` 的 `MODEL_PRICING` 与 `lib/client.js` 的 `DEFAULT_PRICING`，并把被替换的旧价移入 `LEGACY_MODEL_PRICING`。

## License

MIT
