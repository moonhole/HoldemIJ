# Audit Product + Ledger Core (Design)

本文统一命名如下：

- `ledger`：内部系统名，唯一事实事件底座（append-only）。
- `audit`：产品层能力名，聚合 `ledger + replay + rei` 的历史查询体验。
- `sandbox`：产品层能力名，聚合 `ledger + replay + agent + rei` 的实验推演体验。

目标是支持：

- 玩家查看自己最近 `X` 手对局流水（类似雀魂“最近牌谱”）
- 每个账号可长期保存 `Y` 手（收藏/书签）
- `live` 与 `replay` 使用不同展示策略，但共享同一事实源

---

## 1. 目标与边界

### 1.1 目标

- **统一事实源**：事件采集只做一套（`ledger`），避免 `live`/`replay` 两套标准。
- **分层展示策略**：
  - `live`：菜单折叠查看，或限制“离桌后可看”。
  - `replay`：每个 step 的事实状态文字（时间线驱动）。
- **可控存储成本**：每账号最近 `X` 手 + 收藏 `Y` 手。
- **隐私与公平**：仅暴露当前账号可见视角（Hero 视角，不泄露他人私牌）。

### 1.2 非目标（MVP）

- 不做跨玩家公开牌谱市场。
- 不做复杂社交（点赞、评论、转发）功能。
- 不做 solver 级分析报告。

---

## 2. 核心原则

1. **事实和解释解耦**  
   `ledger` 只记录事实事件；`rei` 负责解释文案；`audit` 负责产品化查询与展示。

2. **append-only**  
   原始事实流不可原地修改，只允许追加。

3. **单手主键化**  
   所有事件按 `hand_id + seq` 建模，保证可回放与可审计。

4. **按视角出数**  
   用户查询时默认只拿到该用户可见视角（含自己手牌，不含他人手牌）。

5. **产品层组合，不反向污染底座**  
   `audit`、`sandbox` 都是上层组合；不得反向改写 `ledger` 事实记录。

---

## 3. 场景策略（Live vs Replay）

### 3.1 Live 呈现策略

- 展示入口：对局菜单中的“最近手牌”。
- 推荐限制：
  - 仅在手牌结束后可看该手详情；
  - 或仅离桌后可看完整历史。
- 默认展示“手牌级摘要”，非逐 step 长文本。

### 3.2 Replay 呈现策略

- 展示入口：Replay 时间线面板。
- 每个 step 输出事实状态短句（由 replay/audit formatter 生成，不依赖 REI）。
- 支持 `step/back/seek` 时同步刷新 step 状态。
- 本地 replay（WASM）可先会话级投影；用户点击保存后再落库。

结论：**呈现分离，事实统一**。

---

## 4. 分层架构

### 4.1 Ledger Core（内部底座）

- 接口：`LedgerSink.Append(event)`
- 输入：标准化事件（来自 live 推流或 replay 生成）
- 输出：`ledger_event_stream` 追加写入 + 投影触发信号

### 4.2 Projection 层

- `AuditHistoryProjection`
  - 面向“最近手牌/收藏手牌”列表与详情。
- `ReplayFactProjection`
  - 面向 replay step 事实状态文本。
- `AgentContextProjection`
  - 面向 agent 推理输入（结构化上下文）。
- `ReiContextProjection`
  - 面向 REI 解释输入（结构化上下文）。

### 4.3 Product 层

- `Audit Product` = `ledger + replay + rei`
- `Sandbox Product` = `ledger + replay + agent + rei`

`sandbox` 必须使用独立命名空间（如 `source=sandbox` + `scenario_id`），避免污染 live/audit 主流水。

### 4.4 存储部署策略（推荐）

- **云数据库为主存**：`ledger_event_stream` 作为权威事实源，`audit_user_hand_history` 作为服务端投影结果。
- **本地仅做缓存/暂存**：客户端（IndexedDB/SQLite）仅保留会话级 replay/sandbox 数据和待上传队列，不作为最终事实源。
- **显式上传时机**：用户点击“保存”或网络恢复后，将本地待上传事件写入云端。
- **幂等写入要求**：上传必须带稳定键（建议 `source + scenario_id + hand_id + seq`），服务端重复写入不产生重复事件。
- **冲突处理**：以云端已存在记录为准；客户端收到冲突时仅做本地标记并拉取最新手牌详情。
- **删除策略**：本地缓存可按 LRU/容量裁剪；云端按 `X/Y` 配额和策略裁剪。

---

## 5. 数据模型（建议）

> 命名可按现有数据库规范调整，以下为概念模型。

### 5.1 事实事件流表：`ledger_event_stream`

- `id` (bigserial)
- `source` (`live` | `replay` | `sandbox`)
- `scenario_id` (text, nullable) // sandbox 分支标识
- `hand_id` (text/uuid)
- `seq` (int)
- `event_type` (text)
- `envelope_b64` (text) // 标准化事件载荷
- `server_ts_ms` (bigint)
- `created_at` (timestamp)

约束与索引：

- unique(`source`, `scenario_id`, `hand_id`, `seq`)
- index(`source`, `hand_id`, `seq`)
- index(`created_at`)

### 5.2 Audit 用户历史表：`audit_user_hand_history`

- `user_id` (bigint)
- `hand_id` (text/uuid)
- `source` (`live` | `replay`)
- `played_at` (timestamp)
- `summary_json` (jsonb) // 列表摘要（底池、输赢、牌型、标签）
- `tape_blob` (bytea/text, optional) // 可选缓存，避免每次重组
- `is_saved` (bool, default false)
- `saved_at` (timestamp, nullable)

约束与索引：

- unique(`user_id`, `source`, `hand_id`)
- index(`user_id`, `source`, `played_at desc`)
- index(`user_id`, `source`, `is_saved`, `saved_at desc`)

---

## 6. 配额与保留策略（X / Y）

### 6.1 参数

- `X`: 每账号最近手牌保留数（建议默认 200）
- `Y`: 每账号收藏上限（建议默认 50）

### 6.2 规则

1. 每次写入新 hand 后，对该用户执行裁剪：
   - 仅裁剪 `is_saved=false` 的历史；
   - 保证非收藏历史条数不超过 `X`。
2. 收藏动作：
   - 若当前收藏数 >= `Y`，返回错误（推荐）；
   - 也可配置为“自动移除最早收藏”模式（不推荐默认）。
3. 取消收藏后：
   - 若总历史超过阈值，立即触发一次裁剪。

---

## 7. 接口设计（MVP）

### 7.1 Audit（产品接口）

- `GET /api/audit/live/recent?limit&cursor`
  - 返回最近手牌摘要列表
- `GET /api/audit/live/hands/{hand_id}`
  - 返回该手详情（事实事件或可回放 tape）
- `POST /api/audit/live/hands/{hand_id}/save`
  - 收藏
- `DELETE /api/audit/live/hands/{hand_id}/save`
  - 取消收藏
- `GET /api/audit/replay/recent?limit&cursor`
- `GET /api/audit/replay/hands/{hand_id}`
- `POST /api/audit/replay/hands/{hand_id}/save`
- `DELETE /api/audit/replay/hands/{hand_id}/save`

### 7.2 Ledger（内部接口）

- `AppendEvent(event)` // 统一写入
- `LoadHand(source, scenario_id, hand_id)` // 读取完整事实流
- `Project(name, checkpoint)` // 投影任务拉取

---

## 8. 安全与隐私

- 只返回当前用户授权视角的数据。
- 禁止查询他人未公开 hand。
- replay/sandbox 上传时校验 `user_id` 与会话绑定，避免伪造入库。
- audit 访问接口统一走认证中间件。
- sandbox 数据默认仅本人可见，且不进入公开排行或统计。

---

## 9. 落地路线图

### 阶段 A（先上价值）

1. 建表与索引：`ledger_event_stream` + `audit_user_hand_history`
2. 接入 live 采集（table 事件广播点 append 到 ledger）
3. 实现 audit 最近 `X` 手 + 收藏 `Y` 手 API
4. 前端菜单展示 live 历史

### 阶段 B（补 replay 一致性）

1. replay step 事实投影文字
2. 增加“保存 replay 到账号”接口
3. 增加客户端离线暂存与回传队列（失败重试 + 幂等键）
4. replay 入库后走同一配额策略

### 阶段 C（扩展 sandbox）

1. 增加 `source=sandbox` + `scenario_id`
2. 接入 `AgentContextProjection`
3. sandbox 本地分支可选上传云端（按账号隔离）
4. 在 sandbox UI 中展示分支对比

---

## 10. 测试要点

- 事件顺序正确性：`seq` 连续且可重放。
- 视角隔离：他人私牌不泄露。
- 配额正确性：`X`/`Y` 边界行为稳定。
- 幂等性：重复写入不产生重复 hand 记录。
- 隔离性：sandbox 不污染 live/audit 主流水。
- 同步一致性：离线缓存回传后，与云端投影结果一致。

---

## 11. 建议默认配置

- `ledger.default_source = live`
- `ledger.allow_sources = [live, replay, sandbox]`
- `audit.recent_limit_x = 200`
- `audit.saved_limit_y = 50`
- `audit.live_view_policy = after_hand_end`（或 `after_leave_table`）
- `audit.replay_persist = opt_in`（仅用户点击保存时入库）
