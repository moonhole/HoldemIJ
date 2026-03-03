# Agent UI Programming: 战略规划与落地路线图

## 一、 愿景与定位 (Vision)

**Agent UI Programming** 是本机 Holdem 平台从“传统的扑克游戏”向“可编程沙盒与 AI 原生游戏”跨越的核心功能（在 Story Mode 的 Phase 4 解锁）。

我们的目标是：
1. **自然语言编程**：允许玩家通过右侧的 "Agent Chat (REI)"，用自然语言对话来生成、修改、定制游戏界面HUD。
2. **打牌自动化**：允许玩家（特别是开发者/硬核玩家）通过代码或自然语言定义自己的打牌策略（Bot Scripts），甚至让 Bot 代理自己离线或其他桌面的对局。
3. **开发友好与敏捷测试**：由于采用“云端 Server + 本地可执行 Server + 本地 WASM Replay”架构，我们拥有极高的本地安全边界与隔离性。用户编写的代码和 UI 组件可在本地环境中自由测试（Local Server/WASM 充当天然的安全容器），而无需刻意构建复杂的前端沙盒。

---

## 二、 核心考量与架构红利

### 1. 架构级沙盒 (Architecture as Sandbox)
得益于我们的多端分离架构，传统的在前端做 `<iframe>` 或严格 Worker 隔离的诉求大大降低：
* **本地试错空间**：玩家或 Agent 生成的代码可以直接提交至本地运行的 Local Server，或直接与加载的本地 WASM 引擎交互。只要不影响云端正式对局进程，即使代码报错/无限循环，也仅限于本地环境的崩溃，刷新或重启即可恢复。
* **WASM 天然隔离**：核心算牌、推演机制通过 WASM (Replay Engine) 暴露，它是内存安全的黑盒。前端生成的代码再怎么越界，也无法破坏底层游戏状态的正确性。

### 2. 上下文暴露 (Holdem API)
玩家的代码必须能知道“现在发生了什么”。我们需要向沙盒内注入一个全局只读对象（例如 `window.HoldemAPI` 或 `context.api`），包含：
* `getSnapshot()`：获取当前桌面的脱敏状态（底池、公共牌、自己的底牌、其他玩家下注情况）。
* `getPotOdds()`：获取基础赢率或赔率计算辅助函数。
* `subscribeEvents()`：订阅发牌、轮到操作等生命周期事件。

---

## 三、 三阶段落地路线图 (Roadmap)

### Phase 1: 独立的自定义 UI 路由页面 (Custom UI Hub)
**目标**：玩家进入一个专门的路由（如 `/agent-ui`），在这个页面里，不再是基础的游戏桌面，而是一张用于测试和运行自定义代码的画布。这类似于《魔兽世界》的 ElvUI 设置中心或者一个本地图灵测试台。

**实现路径**：
1. **统一路由入口**：在大厅添加一个进入 Agent UI Programming 的独立路由跳转。
2. **纯粹的数据映射上下文**：在这个路由里，注入 `useGameStore` 提供的数据，交由玩家和 Rei 来决定怎么渲染。
3. **集成编辑器**：左侧/上方是实时渲染画布，右侧/下方是集成代码编辑器与 Rei 的对话框。
4. **混合渲染引擎 (React + PixiJS)**：LLM 提示词约束不仅包含纯 React/DOM 组件，还明确告知 Rei 可以使用 `@pixi/react`（React-Pixi）语法。允许代码在画布上直接操纵 PixiJS 的 `Sprite`、`Graphics`、`Text`，绘制拥有 WebGL 特效的筹码和牌面。

### Phase 2: 交互式仪表盘组件与 WebGL 特效扩展 (Interactive & FX Extensibility)
**目标**：玩家能够在画板上添加控制类的 DOM 组件，同时也能够使用 PixiJS 编写华丽的视觉滤镜和动画特效。比如手写一个带发光特效和缓动动画的“一键 Fold”组件。

**实现路径**：
1. **统一的编译器生态**：引入 `react-live` 等实时编译组件，同时预注入 `PIXI` 和 `@pixi/react` 包及其依赖到全局作用域。
2. **双向绑定指令 API**：不仅仅是读取 `Snapshot`，暴露基础操作接口（`actionFold()`, `actionBet()`），玩家或者 Agent 写的按钮点击后直接连入本地 Server。
3. **资产与特效编排**：联动本地目录 `public/assets/` 下的美术内容，让 Rei 能够直接在画板中用 PixiJS 实例化带有专属 Shader 或动效逻辑的新生成的卡背或全像素外框。

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
