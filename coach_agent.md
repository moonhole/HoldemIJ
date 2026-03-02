# Agent System (Design)

本文件定义“复盘观战陪练”相关的 **Agent** 体系（会产出结构化数据或做决策的智能体）。

边界说明：

- `rei.md` 只负责 **解说/旁白**（REI 文案与呈现、Lite/Online、触发与降级）。
- `replay.md` 只负责 **回放管线**（`HandSpec -> ReplayTape -> step/seek/branch`）。
- `agent.md` 负责 **生成 HandSpec / 生成陪练对手 / 生成场景 / 机器人决策策略**。

目标：先把最小技术闭环写清楚，后续再逐步上 LLM、订阅、credits。

---

## 1. Agent 分类（MVP）

### 1) HandSpecBuilder（自然语言 -> 结构化手牌）

职责：

- 把用户自然语言输入转成 `HandSpec v1`（见 `replay.md`）。
- 当信息缺失/不一致时，产出“澄清问题（chips）”而不是胡乱猜。
- 产出可被引擎 **硬校验** 的结果：校验不过就给出可定位错误。

Lite/Online：

- Lite：规则/模板/正则解析 + 引擎校验 + 问答补全（无 LLM）。
- Online：LLM 做抽取与补全（仍必须走引擎校验与约束）。

### 2) TableDirector（空桌 -> 风格化陪打对手 + 场景）

职责：

- 在空桌上创建一局“可玩可教学”的局：座位数、盲注、买入、对手人格。
- 选择/生成 `PersonaSpec`（风格化菜鸟/鱼/疯狗/紧弱等）并分配到 seats。
- 可选：生成“导演式开局”的 `ScenarioScript`（用于演绎某个教学点）。

Lite/Online：

- Lite：从预设 persona 库里抽取 + 简单随机化（保证可复现）。
- Online：LLM 生成更丰富的“对手故事/台词/微习惯”，但核心决策仍由 BotPolicy 控制。

### 3) OpponentBot / BotPolicy（对手决策策略）

职责：

- 在“陪练/自家对局”模式里，为非 Hero 座位提供行动决策（action + amount_to）。
- 必须保证信息隔离：Bot 只看自己的手牌 + 公共信息，不得读取其他玩家手牌。

---

## 2. 核心数据结构（建议）

> 下面是“概念结构”，最终可以落地为 JSON / TS types / Go structs。

### 2.1 PersonaSpec（对手人格）

目的：把“风格化菜鸟局”落到可参数化、可复现、可调难度的配置上。

建议字段：

```json
{
  "id": "loose_passive_01",
  "display_name": "松被动跟注怪",
  "tags": ["loose", "passive", "calling_station"],
  "skill": { "level": 1, "leak_intensity": 0.8 },
  "preflop": {
    "open_looseness": 0.75,
    "call_vs_open": 0.65,
    "3bet_freq": 0.05,
    "size_style": "small"
  },
  "postflop": {
    "cbet_freq": 0.25,
    "bluff_freq": 0.05,
    "overcall_freq": 0.7,
    "fold_to_big_bet": 0.25
  },
  "sizing": {
    "bet_sizes": [0.33, 0.5],
    "raise_sizes": [2.5, 3.0],
    "shove_threshold_spr": 1.2
  },
  "flavor": {
    "chat_lines": ["我就看看", "这牌能中", "跟一手不亏"],
    "avatar_skin": "npc_cyber_03"
  }
}
```

MVP 可以只落地 `tags + 3~6 个关键参数`，先跑起来，再逐步加维度。

### 2.2 ScenarioSpec（开局场景）

目的：导演（Director）产出的“可直接开打”的场景配置。

```json
{
  "version": 1,
  "variant": "NLH",
  "table": { "max_players": 6, "sb": 50, "bb": 100, "ante": 0 },
  "hero": { "chair": 0, "stack": 11000 },
  "seats": [
    { "chair": 0, "type": "human", "name": "YOU" },
    { "chair": 2, "type": "bot", "persona_id": "loose_passive_01", "stack": 8000 },
    { "chair": 4, "type": "bot", "persona_id": "aggro_fish_02", "stack": 12000 }
  ],
  "director": {
    "theme": "菜鸟局: 跟注偏多",
    "teaching_goal": "value bet / thin value / 不要过度诈唬",
    "seed": 123456
  }
}
```

### 2.3 ScenarioScript（可选，导演式演绎）

用途：教学关卡/剧情关卡/复盘演绎时，让对手在某些节点“按剧本走”。

建议约束：

- 脚本优先级高于 BotPolicy，但必须仍通过引擎合法性校验。
- 脚本只锁定“关键节点”，其余节点交给 BotPolicy，避免僵硬。

```json
{
  "locks": [
    { "at": { "street": "FLOP", "action_index": 1 }, "chair": 4, "force": { "type": "BET", "amount_to": 450 } }
  ]
}
```

### 2.4 HandSpec（复盘输入）

复盘走 `HandSpec`（见 `replay.md`）。`HandSpecBuilder` 的职责就是产出它。

---

## 3. 两条核心流程（最小闭环）

### 3.1 自然语言复盘（Reconstruct）

```
User text
  -> HandSpecBuilder (Lite/Online)
      -> HandSpec OR ClarifyingQuestions
          -> ReplayEngine (local WASM)
              -> ReplayTape
                  -> UI timeline step/seek/branch
                      -> REI (Lite/Online) narrates current step
```

关键约束：

- **引擎校验为准**：Builder 不能“编”一个看似合理但不可执行的 hand。
- Builder 如果缺信息：必须问，而不是胡猜（或提供带置信度的默认值，并明确“我假设…”）。

### 3.2 空桌陪练（Direct + Play）

```
User picks theme (菜鸟局/训练点/难度)
  -> TableDirector
      -> ScenarioSpec (+ optional ScenarioScript)
          -> Start training table (local or server)
              -> OpponentBot acts using BotPolicy (+ script locks)
                  -> REI explains (and optionally prompts drills)
```

---

## 4. HandSpecBuilder 设计要点

### 4.1 澄清问题（Chips）

自然语言不可避免不完整，MVP 的体验关键是“少问但问到点上”。

高价值澄清点（优先级大致从高到低）：

- 盲注/人数/有效筹码（SPR 决定了整局线）
- 位置（BTN/SB/BB/UTG... 或 chair）
- 每街行动顺序与下注“到多少”（amount_to）
- 翻牌/转牌/河牌牌面（如果是复盘）
- Hero 手牌（可选；如果用户不想说，允许 unknown）

输出形式建议：

- 2~5 个 chips（每个 chip 提供 2~6 个选项 + “自定义输入”）
- Builder 返回 `ClarifyingQuestions`，UI 直接渲染为可点选组件，不走“聊天式长对话”。

### 4.2 结构化输出与校验循环

Builder 输出 `HandSpec` 后，必须立刻运行一次引擎验证：

- 下注是否合法
- 行动顺序是否合法
- 牌面/发牌是否一致（无重复卡）

校验失败时，返回 `ReplayError`（见 `replay.md` 的建议），并把错误转成用户能改的表单点。

---

## 5. Director / BotPolicy 设计要点

### 5.1 信息隔离（必须）

Bot 决策输入只能包含：

- 公共牌、底池、当前下注、行动顺序
- Bot 自己的 hole cards
- 历史行动（action tape）

不得包含：

- 其他玩家 hole cards
- 引擎内部“未来牌序”

### 5.2 可复现与“风格稳定”

陪练对手要“像一个人”，而不是每手都随机变脸：

- `PersonaSpec` + `seed` 让行为可复现
- 人格参数要影响多个点：开池频率、跟注阈值、下注尺度、诈唬倾向

### 5.3 难度与教学目标解耦

建议把“难度”拆成两类：

- `mechanical`：算赔率/尺度/范围直觉（偏强弱）
- `leak`：漏洞强度（比如过度跟注/不弃牌/尺度暴露）

这样可以做“低难度但很像菜鸟”的对手：容易被 exploit，但风格稳定。

---

## 6. 与 REI 的关系（只消费，不决策）

REI 只消费 `ReiContext`（见 `rei.md`），不拥有决策权。

典型联动点：

- Builder 产出澄清问题时：REI 显示“我需要确认两件事…”（Lite 模板即可）。
- Director 生成 persona 时：REI 用一句话说明“本局对手画像”。
- Bot 行动后：REI 给出“你在针对什么漏洞”的提示（不必给最优解）。

---

## 7. MVP 切法（不急编码时的最小落地）

建议最小切片（按价值/复杂度排序）：

1. `ScenarioSpec` + persona 预设库（20 个）+ BotPolicy（规则型），先把“菜鸟局陪练”跑起来。
2. `HandSpec` 手动表单输入 + 本地回放（见 `replay.md`），先把“步进/倒退/分支”打磨好。
3. `HandSpecBuilder Lite`（轻量解析 + 澄清 chips），先覆盖 30% 的常见输入。
4. 再考虑 `HandSpecBuilder Online`（LLM）与 credits。

