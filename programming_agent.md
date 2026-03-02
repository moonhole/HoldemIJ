# Agent UI Programming: 战略规划与落地路线图

## 一、 愿景与定位 (Vision)

**Agent UI Programming** 是本机 Holdem 平台从“传统的扑克游戏”向“可编程沙盒与 AI 原生游戏”跨越的核心功能（在 Story Mode 的 Phase 4 解锁）。

我们的目标是：
1. **自然语言编程**：允许玩家通过右侧的 "Agent Chat (REI)"，用自然语言对话来生成、修改、定制游戏界面HUD。
2. **打牌自动化**：允许玩家（特别是开发者/硬核玩家）通过代码或自然语言定义自己的打牌策略（Bot Scripts），甚至让 Bot 代理自己离线或其他桌面的对局。
3. **安全与隔离**：在一套基于 React/PixiJS 的复杂 Web 架构和 Go 服务端引擎之间，建立安全、受控的沙盒接口（Holdem API），确保玩家编写的代码不会破坏游戏核心状态或产生作弊行为。

---

## 二、 核心痛点与技术边界

### 1. 安全隔离 (Sandbox)
* **前端沙盒**：AI 或玩家生成的代码不能污染全局作用域。针对 UI 和 HUD 的生成，我们必须在独立的 `<iframe>`、`new Function` 上下文、或者安全的 JSX 渲染器（如 `react-live`）中执行。
* **服务端防注入**：对于自动化脚本，不允许直接发送非法的 Action 序列，一切依然要通过合法的 `Act(Chair, Action, Amount)` 接口校验。

### 2. 上下文暴露 (Holdem API)
玩家的代码必须能知道“现在发生了什么”。我们需要向沙盒内注入一个全局只读对象（例如 `window.HoldemAPI` 或 `context.api`），包含：
* `getSnapshot()`：获取当前桌面的脱敏状态（底池、公共牌、自己的底牌、其他玩家下注情况）。
* `getPotOdds()`：获取基础赢率或赔率计算辅助函数。
* `subscribeEvents()`：订阅发牌、轮到操作等生命周期事件。

---

## 三、 三阶段落地路线图 (Roadmap)

### Phase 1: 数据可视化与简单 HUD (只读状态投影)
**目标**：玩家可以通过自然语言命令 Rei ：“帮我在屏幕左上角显示实时的底池赔率（Pot Odds）和 SPR（筹码底池比）”。

**实现路径**：
1. **引擎提供只读 Store**：前端对 `useGameStore` 进行封装，暴露出一个稳定的 `HoldemContext`。
2. **运行时代码执行**：在右侧 Agent 面板或单独的 Code Editor 面板里，允许执行简单的 JavaScript。
3. **Canvas 悬浮层**：在真正的 PixiJS 牌桌之上，盖一个绝对定位的 `<canvas>` 或 `<div>`，AI 生成的代码负责在这一层调用 `drawText` / `renderDiv` 等指令渲染纯文本或简单的图形。
4. **LLM 提示词约束**：在发给 Rei 的 Prompt 中，明确告知它：“你现在的任务是使用 `HoldemAPI` 获取数据，并用这段 JS/HTML 渲染一个面板”。

### Phase 2: 动态 UI 渲染与交互组件 (React Component Injection)
**目标**：玩家对 Rei 说：“帮我画一个紫色的面板，包含两个按钮，点击左边等于弃牌，点击右边等于全下”。面板需要实时响应玩家的操作。

**实现路径**：
1. **动态 JSX 编译**：引入 `react-live` 或 `Babel standalone`，允许在浏览器中实时编译并挂载（Mount） React 组件。
2. **挂载插槽 (Widget Slots)**：在前端界面（左侧边栏、HUD 区域等）预留几个空白的 `<WidgetSlot id="slot-1" />`，提供给 Agent 注入编译好的组件。
3. **双向绑定**：此时不仅要注入 `HoldemAPI.getSnapshot()`，还要注入限制性的写入 API，如 `HoldemAPI.fold()`、`HoldemAPI.allIn()`，允许自定义按钮触发真实的网络请求。
4. **资产管理联动**：结合 AI 美术管线，Rei 可以实时调用大模型生成一张贴图，并自动替换当前 UI 代码里的图片 URL。

### Phase 3: 智能合约与自动化打牌脚本 (Bot Automation)
**目标**：玩家定义复杂的打牌策略（如：“翻牌前拿到 AA/KK 必定 3-bet，如果是听花面则强力隔离下注”），并交由服务器自动执行。

**实现路径**：
1. **脚本格式化**：定义一套 DSL（Domain Specific Language）或者标准化的 JavaScript 脚本规范，要求返回明确的 `holdem.ActionType` 和 `Amount`。
2. **后端挂载或前端托管**：
   * *方案 A（前端托管）*：只要网页开着，游戏循环到该玩家时，前端触发并执行玩家本地的 JS 倒计时逻辑，自动通过 WebSocket 发送指令。
   * *方案 B（后端托管，高难度）*：将脚本发给 Go 服务器，服务器利用 `goja` (Go 语言的 JS 虚拟机) 在玩家离线时替其打牌，并记录资产变动（这也是真正的“挂机挂”合法化机制）。
3. **对局回放与复盘 (Audit Integration)**：与已有的 Hand Audit 结合，让玩家能通过 Audit 分析自己编写的 Bot 是哪里出了 bug 导致输钱，从而持续改进代码。

---

## 四、 近期行动项 (Action Items)

在开始写 Agent UI 之前，我们需要确保基础环境就绪：
1. [ ] **完善牌桌基础逻辑**：确保 `table.go` 及前端状态不再有卡死、广播丢失的 bug。
2. [ ] **引入占位编辑器**：在前端选定一块区域（如侧边栏），引入一个简单的代码编辑器组件（`monaco-editor` 或 `prismjs` 框架）。
3. [ ] **封装导出 API (Mock)**：编写 `src/api/HoldemAPI.ts`，作为沙盒和 `useGameStore` 之间的桥梁，暴露出安全的只读方法供测试使用。
