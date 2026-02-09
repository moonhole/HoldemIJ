## 德州扑克 H5（面向玩家）方案文档（Pixi + DOM UI + WS + Proto + buf）

### 0. 背景与目标

你希望做一个**面向玩家的 H5 德州扑克**，动效丰富、体验接近主流产品（可参考 wepoker 的交互感受），并且协议/架构允许**大刀阔斧重构**，不必兼容旧系统。

本方案核心决策：

- **渲染**：Pixi.js（桌面/牌/筹码/特效统一走 WebGL Canvas）
- **UI**：DOM UI（按钮/弹窗/输入/设置等走 Web，叠加到 Canvas 上）
- **实时通信**：WebSocket
- **协议**：Proto（proto3）二进制帧
- **IDL/生成**：buf 管理 `.proto`，统一生成 Go + TS
- **未来能力**：需要观战/旁观/回放，但 **MVP 暂不实现**（在协议和服务端事件模型中预留）

### 1. 范围（Scope）

#### 1.1 MVP（先落地）

- **现金桌（Ring/Cash）**：6-max/9-max（可配置）
- **入桌/坐下/买入（Buy-in）/离桌（Stand up & cash out）**
- 基本对局流程：发牌、下注轮、分池/边池、摊牌、结算展示
- 断线重连：Snapshot + 增量同步（不要求“绝对零丢包”，但需要可恢复）
- 动效：发牌、筹码飞行、底池合并、赢家高亮、简单粒子/滤镜特效

#### 1.2 MVP 不做（但要留口子）

- 观战/旁观（Spectate）
- 回放（Replay）与手牌历史浏览
- 自动补码/自动 rebuy（明确：**不需要**）
- 复杂商业化（商城、任务、活动等）

### 2. Monorepo 结构建议

> 目标：研发体验好、依赖清晰、可拆仓库时迁移成本低。

建议结构（示例）：

```
repo-root/
  apps/
    server/                 # Go: WS 网关 + 房间/桌子管理 + 游戏驱动
    h5/                     # TS: Pixi 客户端 + DOM UI
  proto/                    # buf module: *.proto + buf.yaml + buf.gen.yaml
  packages/
    ui/                     # (可选) 共享 UI 组件/样式/主题
    shared/                 # (可选) TS 工具库：数学/插值/布局/动画工具
  tools/
    asset-gen/              # (可选) AI/程序化资源生成工具（离线，产物入库）
```

本仓库内现阶段已有的 `holdem-lite/holdem` 可作为**玩法引擎原型**，后续可被 `apps/server` 直接引用或复制到新 repo。

### 3. 客户端架构（Pixi Canvas + DOM UI）

#### 3.1 分层原则（非常关键）

- **Pixi Layer（Canvas）**：所有“桌面内元素”与高频动画
  - 桌布、座位、头像框、牌、筹码、底池、按钮高亮提示、粒子/发光/镜头等
- **DOM Layer（HTML/CSS）**：低频 UI 与可访问性
  - 登录/设置/充值入口/房间列表/买入弹窗/聊天输入/Toast/系统弹窗

好处：

- Pixi 保证性能与一致性（特别是移动端）
- DOM 负责交互复杂度与开发效率（输入、滚动、无障碍、国际化）

#### 3.2 Pixi 场景划分（Scene Graph）

推荐基础场景：

- `BootScene`：加载资源、版本校验、首屏过渡
- `LobbyScene`：房间列表/快速开始（MVP 可最简）
- `TableScene`：核心牌桌（所有动效在这里）

`TableScene` 内部图层建议：

- `BackgroundLayer`（桌布/光效底层）
- `SeatLayer`（座位/头像/昵称/筹码数/状态）
- `CardLayer`（手牌/公共牌/牌背/翻牌）
- `ChipLayer`（下注筹码/底池筹码/筹码飞行动画）
- `FxLayer`（粒子/闪光/滤镜/胜利特效）
- `OverlayLayer`（引导箭头/倒计时圈/行动提示）

#### 3.3 动画与特效技术选型

- **时间线动画**：GSAP（推荐）
  - 优点：成熟、易表达复杂时间线、回调清晰、与 Pixi 组合广泛
- **粒子**：对象池 + 自研简单 emitter（或选择成熟的 Pixi 粒子实现）
- **滤镜**：谨慎使用（移动端 GPU/内存敏感），优先做“少量强效果 + 可降级”

#### 3.4 “更 AI-native”的资源与动效方案（离线生成 + 在线运行）

> 不建议运行时依赖在线 AI（不稳定/成本/延迟），更推荐“AI 帮助产出资源，产物入库”。

可选组合（按性价比排序）：

1. **程序化+参数化动效（推荐）**
   - 桌布纹理/光晕/扫光/闪光：用简单 shader 或噪声纹理 + 参数驱动
   - 筹码飞行曲线：贝塞尔 + 弹性插值（统一动画曲线库）
2. **AI 生成静态素材（离线）**
   - 使用提示词生成桌布/背景/按钮质感纹理等，导出为 WebP/PNG，配合 atlas
   - 产物入库同时保存 `prompt + seed + model + postprocess` 元数据，保证可追溯
3. **Lottie / SVG 动效（用于 DOM UI 或轻量装饰）**
   - 用于 Toast、弹窗进入等，不占 Pixi 主渲染预算

> 落地建议：MVP 阶段先把“桌面动效”做成程序化 + 少量静态贴图；后续再引入更复杂资产（Spine/序列帧等）。

#### 3.5 适配与性能（移动端必做清单）

- **分辨率策略**：设计基准分辨率（如 1920x1080），按短边等比缩放；关键 UI 用锚点布局
- **纹理管理**：合图（atlas）优先；避免大量独立纹理导致频繁切换
- **对象池**：Card/Chip/Fx 强制复用，禁止频繁 new/destroy
- **字体与文本**：频繁变化文本（计时/筹码）尽量用 BitmapText 或缓存；复杂富文本留给 DOM
- **降级开关**：低端机可关闭 bloom/模糊/高粒子密度

### 4. 服务端架构（Go WS 网关 + 权威桌子）

#### 4.1 基本模块

- `Gateway (WS)`：连接管理、鉴权、心跳、限流、消息编解码
- `Lobby`：房间列表/快速开始/分配桌子（MVP 可极简）
- `Table`：单桌 Actor（串行处理），驱动玩法引擎、广播事件
- `Wallet`：买入/离桌结算（MVP 可先用内存余额，后续再接真实账本）

#### 4.2 并发模型

推荐“每桌一个 goroutine/actor”串行化，避免锁地狱：

- 任何用户动作（Bet/Call/Raise/Fold/BuyIn/StandUp）都投递到桌子 actor
- 桌子输出事件（Deal/ActionResult/PhaseChange/Showdown/SeatUpdate）广播给相关连接

#### 4.3 Buy-in / 离桌（参考 wepoker 体验的可落地规则）

MVP 可先定一套简单但合理的规则（下面是建议，细节可后续调参）：

- **Buy-in 发生时机**
  - 坐下时必须 Buy-in（min/max 由房间配置）
  - 对局中允许“加筹码（Add-on）”，但**不自动补码**
  - 若玩家正在进行中（in-hand），Add-on 进入 `Pending`，**下一手开始前生效**
- **Stand up（离桌）**
  - 若玩家不在手牌中：立即离桌，筹码结算回钱包
  - 若玩家在手牌中：默认处理为“站起并自动弃牌”（或“本手结束后离桌”二选一；MVP 建议后者更像主流体验）

> 以上规则与协议/引擎要对齐：引擎内建议支持 `PendingStack`（下一手合并到 stack），但 MVP 可以先只允许“手牌开始前 buy-in”。

### 5. 协议（Proto3 over WebSocket）设计

#### 5.1 传输

- WebSocket binary frame
- 一个 frame = 一个 protobuf `ServerEnvelope` 或 `ClientEnvelope`

#### 5.2 Envelope（建议）

核心字段（为重连/回放预留）：

- `table_id`
- `user_id`
- `seq`：客户端递增序号（客户端发送）
- `ack`：客户端确认已处理到的服务端 `server_seq`
- `server_seq`：服务端递增序号（服务端发送）
- `server_ts_ms`：服务端时间戳（用于动画对齐/延迟统计）
- `oneof payload`

#### 5.3 Snapshot + Event（强烈推荐的同步模式）

- **Snapshot**：进桌/重连必发；包含可渲染的完整状态（座位、筹码、公共牌、底池、行动位、阶段等）
- **Event**：对局过程增量推送（发牌、下注、底池变化、阶段变化、摊牌结果等）

MVP 的最小事件集建议：

- `TableSnapshot`
- `SeatUpdate`（坐下/离开/筹码变化/状态变更）
- `HandStart`（按钮/盲注信息/行动位）
- `DealHoleCards`（只发给自己；或发一个 “你收到两张牌” 事件）
- `DealBoard`（Flop/Turn/River）
- `ActionRequest`（轮到谁 + 合法动作 + 最小加注）
- `ActionResult`（某人做了什么 + 新下注额）
- `PotUpdate`
- `Showdown`（最佳五张、牌型、分池结果）
- `HandEnd`

#### 5.4 为“观战/回放”预留（MVP 不实现，但协议提前兼容）

建议从一开始就让服务端维护一份**桌内事件日志**（内存 ring buffer 即可）：

- `server_seq` 是天然的事件序号
- 观战者加入时：先发 Snapshot，再从某个 `server_seq` 开始补发事件
- 回放：把某手牌的事件序列存到对象存储/DB（后续实现）

### 6. 研发与构建流程（buf + 生成）

#### 6.1 buf 工作流

- `proto/buf.yaml`：定义模块与 lint/breaking 规则
- `proto/buf.gen.yaml`：生成 Go + TS
- CI：`buf lint` + `buf breaking`（后续才需要 breaking）

TS 生成建议优先考虑官方生态（可二选一）：

- `bufbuild/es`（protobuf-es）
- `ts-proto`（类型友好，但插件链需维护）

#### 6.2 本地开发

- H5：Vite dev server（热更新）
- Server：Go `air`/`reflex`（可选）
- 联调：H5 连接 ws://localhost:xxxx

### 7. 风险与对策

- **移动端性能不稳**：atlas + 对象池 + 降级开关 + 监控 FPS/内存
- **重连一致性**：Snapshot + server_seq 补偿；客户端只做表现层，不做权威计算
- **动效与状态不同步**：统一“事件 -> 动画队列”机制，严格按 server_seq 播放；允许中途打断并回到 Snapshot
- **协议演进成本**：buf + 生成，禁止手写二进制协议

### 8. 开放问题（不影响先启动，但需尽早定稿）

1. **桌型**：6-max 还是 9-max 为主？是否允许可配置？
2. **Buy-in 规则**：最小/最大买入、Add-on 允许时机（随时/仅手牌间）、离桌结算时机
3. **安全/风控**：是否需要防脚本、设备指纹、延迟补偿策略
4. **回放数据留存**：保留多少手？是否要生成“手牌历史列表”？

