# balance-dsh

DSH 插件：在 Web UI 中直接显示 DeepSeek 账户余额和当前会话 token/金额消耗。

## 功能

- **侧边栏余额行**：侧边栏展开时显示在底部（紧贴"设置"按钮上方），格式：钱包图标 + `余额` + 金额（带货币单位）+ 时段标签（高峰红 / 空闲绿）。金额按余额状态变色：充足绿色、偏低（<10）琥珀黄、为 0 显示红色"去充值"。
- **收起态 FAB**：侧边栏收起时，余额显示为左下角悬浮胶囊。
- **自动刷新**：每 60 秒自动刷新一次；每次对话完成（新回复落库）也会立即刷新；右键余额任意区域可手动刷新。
- **余额与使用统计**：单击余额在余额项旁打开局部快捷菜单，展示账户余额、近 90 天计费 Token、估算费用、扫描会话数和按日使用热力图；点击菜单外区域关闭，双击余额打开 DeepSeek 官方 API 用量页。
- **高峰/空闲计费**：官方高峰窗口为**周一至周五 09:00-12:00、14:00-18:00（北京时间）**，周末全天空闲。消耗金额**跨时段精确计费**：高峰时段的 token 按高峰价 ×2、空闲时段按目录价，按事件时间分桶计算。
- **会话消耗行**：对话框下方实时显示当前会话消耗（新增 tokens + 估算金额），悬停查看完整明细（模型、时段拆分、计费口径）。
- **`/balance` 命令**：命令行查询余额明细和当前会话消耗。

### 使用统计口径

- 热力图按北京时间聚合最近 90 天持久化会话中的 `assistant/message` Token usage。
- 费用按照每条消息的实际模型和峰谷时段估算，最终金额以 DeepSeek 官方账单为准。
- 为避免历史会话过多拖慢 DSH，最多扫描最近 200 个会话，统计结果缓存 5 分钟。
- 若未配置 API Key，仍可查看本地 Token 与费用统计，但账户余额会显示为不可用。

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

### 设置 DeepSeek API Key（三选一）

1. 环境变量 `DEEPSEEK_API_KEY`，或
2. 在注册项的 `config.apiKey` 中设置，或
3. 使用 DSH 凭据存储中的 `DEEPSEEK_API_KEY`

### 重启

服务端界面改动需**重启 DSH Desktop** 后生效。

## 配置

在插件注册项（或 `cordis.patch.yml`）中覆盖：

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
      inputCnyPerMillion: 1.5
      cacheReadCnyPerMillion: 0.05
      cacheWriteCnyPerMillion: 0
      outputCnyPerMillion: 4.5
```

> 注意：插件已自动按高峰/空闲时段计费（高峰价 = 目录价 × 2），**不要再设置 `config.peak: true`**，否则会重复翻倍。

## 卸载

```powershell
cd C:\Users\<你的用户名>\.dsh\profiles\desktop
pnpm remove balance-dsh
```

如需删除手动注册行（若你手动加过），从 profile 的 `cordis.patch.yml` 移除对应的 `balance` 条目。

## 权限 / 数据

- 仅在你**主动刷新**或对话完成时，会向 `api.deepseek.com` 的 `/user/balance` 端点发起一次余额查询。
- 插件需要你的 DeepSeek API Key（仅用于余额查询），不收集、不上传任何会话内容到第三方。
- 消费统计完全基于本地会话事件（`request/header`、`assistant/message` 的 token usage）计算，不向 DeepSeek 之外的服务发送数据。

## 价格表（2026-08-17 生效的 V4 峰谷定价·空闲时段价，元/百万 tokens）

| 模型 | 输入（缓存未命中） | 输入（缓存命中） | 输出 |
|---|---|---|---|
| deepseek-v4-flash | 1.5 | 0.05 | 4.5 |
| deepseek-v4-pro | 4.5 | 0.15 | 13.5 |
| deepseek-chat（旧） | 2 | 0.5 | 3 |
| deepseek-reasoner（旧） | 4 | 1 | 16 |

未识别模型按 deepseek-v4-flash 兜底；DeepSeek 调价后需同步更新 `lib/index.js` 的 `MODEL_PRICING` 与 `lib/client.js` 的 `DEFAULT_PRICING`。

## License

MIT
