# REI Narration System (Design)

REI is the in-game cyberpunk robot narrator that lives in the bottom panel:

- Live mode: comment on ongoing hands and player actions.
- Replay mode: explain a reproduced hand step-by-step (from `ReplayTape`).
- Lite mode (free): deterministic template-driven text (no LLM).
- Online mode (subscription/credits): LLM-generated, personalized narration + “advanced” avatar/voice.

This doc focuses on the **minimum technical design** needed to ship a believable REI experience now,
while keeping a clean seam for future expansion.

See also:

- `replay.md` (local replay pipeline: `HandSpec -> ReplayTape`)
- `agent.md` (hand reconstruction + director/bot agents)

---

## Goals

- Always playable without LLM: Lite mode must feel “real”, not placeholder spam.
- Strong state binding: REI text should clearly correspond to what is happening on table.
- Minimal coupling: REI consumes a small, stable `ReiContext` derived from game state/events.
- Cost control: Online mode should have strict output limits, caching, and safe downgrade.
- Cyberpunk voice: short, confident, low-jargon by default; deeper analysis only on demand.

## Non-Goals (MVP)

- “Solver” authority or guaranteed optimal play.
- Real-money / external platform integration.
- Full conversational memory across long sessions (keep it short).

---

## Product Modes

### REI Lite (Free)

Purpose:

- Provide moment-to-moment atmosphere + basic tactical hints.
- Never block gameplay when LLM is unavailable.

Mechanism:

- Rule engine + templates with slot filling.
- Uses only deterministic signals derived from current snapshot/event.

Output:

- 1-line “Key point” text (always).
- Optional short “Detail” block (expand).

### REI Online (Subscription + Credits)

Purpose:

- Personalize explanation to user goals and mistakes.
- Provide higher-quality replay coaching and “what-if” branches.

Mechanism:

- LLM call with strict schema output + hard caps.
- Uses the same `ReiContext`, plus optional per-user memory (preferences, style).

Output:

- Key point (short).
- Optional deeper explanation (bounded).
- Optional “next action” recommendation in replay, not in competitive live modes.

Upgrade cosmetics:

- Avatar becomes “advanced robot” skin.
- Optional voice lines (TTS), gated by subscription.

---

## UX Requirements (Bottom Panel)

Panel components:

- Avatar + nameplate: `REI` (Lite) / `REI // ONLINE` (Online).
- Status tag (small): e.g. `SYNCING`, `ANALYZING`, `LOCKED_IN`, `WAITING_OPPONENT`.
- Text area:
  - Key point line (always visible).
  - Details (collapsed by default).
- Optional quick chips:
  - `为什么?` (why)
  - `下一步?` (next)
  - `风险` (risk)
  - `对手画像` (villain)

Hard UX rules:

- Never cover action buttons or critical table info.
- Default text length must fit without scrolling.
- Any long analysis must be user-initiated (expand/click).

Animation style (cyberpunk):

- “type-in” effect for first 1–2 lines only.
- Glitch/scanline micro effect when status changes (subtle).

---

## REI Input Contract

REI should consume a small, stable context object, created from:

- last streamed event (live) OR replay event (replay)
- latest table snapshot
- hero seat/chair
- optional opponent stats (later)

Suggested shape (conceptual):

```ts
type ReiMode = 'live' | 'replay';
type ReiTier = 'lite' | 'online';

type ReiContext = {
  mode: ReiMode;
  tier: ReiTier;
  nowMs: number;
  table: {
    maxPlayers: number;
    sb: number;
    bb: number;
    ante: number;
  };
  hero: {
    chair: number;
    stack: number;
    bet: number;
    hasCards: boolean;
    // optional: hole cards (replay or if local)
  };
  street: 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN';
  pot: {
    total: number;
    // optional: side pot breakdown
  };
  action: {
    actionChair: number;
    isHeroTurn: boolean;
    legal?: { check: boolean; call: number; minRaiseTo: number; allIn: boolean };
  };
  lastEvent: {
    type: string;
    // small event summary only, not huge payload
    actorChair?: number;
    actionType?: 'CHECK'|'BET'|'CALL'|'RAISE'|'FOLD'|'ALLIN';
    amountTo?: number;
  };
  derived: {
    spr?: number;        // stack-to-pot ratio for hero
    potOdds?: number;    // call / (pot + call)
    playersActive?: number;
    isMultiway?: boolean;
  };
  flags: {
    onlineAvailable: boolean;     // network/model availability
    creditsAvailable: boolean;    // credits > 0
  };
};
```

Integration note:

- Live mode already has `snapshot` and `lastEvent` in `apps/h5/src/store/gameStore.ts`.
- Replay mode uses the same event types (see `replay.md`).

---

## When REI Speaks (Triggers)

We want **high signal, low spam**.

Trigger table (MVP):

| Trigger | Live | Replay | Notes |
|---|---:|---:|---|
| Connection / sync | yes | no | purely atmospheric status lines |
| Hand start | yes | yes | “new hand” tone + table read |
| Hero dealt cards | yes | yes | short; avoid revealing in public modes |
| Hero action prompt | yes | yes | this is the main teaching moment |
| Opponent big bet / shove | yes | yes | highlight risk; avoid long text |
| Street change (flop/turn/river) | yes | yes | board texture hint (lite) |
| Showdown / hand end | yes | yes | 1-line summary; optional “lesson” |

Throttle rules:

- Minimum interval between unsolicited messages: e.g. 1.5s
- Max unsolicited messages per hand: e.g. 6
- In replay, allow more messages but still cap per step.

---

## REI Lite: Template System

Lite must feel reactive. The trick is **template composition** instead of hard-coded full sentences.

### Message Anatomy

Each message is assembled from:

- `statusTag` (short): `ANALYZING`, `RISK_CHECK`, `VALUE_LINE`, `WAIT`
- `keyLine` (<= 80 chars typical)
- `details` (optional, <= 3 short lines)

### Template Slots

Examples of slots:

- `{street}`: preflop/flop/turn/river
- `{spr}`: formatted SPR bucket (e.g. `<2`, `2-6`, `>6`)
- `{potOdds}`: bucket (low/med/high)
- `{threat}`: “强压” / “小试探” / “控池”
- `{actor}`: “对手” / “你” / “按钮位玩家”
- `{action}`: “下注到 {amount}” / “全下” / “过牌”

### Rule Engine (MVP)

Compute a small set of “signals”:

- `isHeroTurn`, `facingBet`, `betSizeBucket` (small/medium/large/shove)
- `sprBucket`
- `multiway`
- `boardWetnessBucket` (later; even simple is fine)

Pick templates based on priority:

1. safety-critical / decision point
2. street transitions
3. atmosphere filler (only if nothing else)

### Example Lite Lines (Chinese, cyberpunk-ish)

Status: `ANALYZING_PROMPT_WAIT`

- Key: `同步下注流... 对手频率稳定，风险等级: 中。`
- Detail: `你当前面对下注：先确认赔率，再决定是否扩池。`

Hero turn, facing large bet:

- Key: `强压来了。先看 {potOdds}，再决定是否继续。`
- Detail: `SPR {sprBucket}：跟注会把你带进高波动区。`

Street change:

- Key: `{street}已展开。公共牌更偏{boardType}，谨慎控池。`

Hand end:

- Key: `手牌结束。记录：你在关键点选择了{heroLineType}。`

---

## REI Online: LLM Design (Cost-Safe)

### Output Constraints

Online mode must be schema-bound and short by default.

Recommended output schema:

- `statusTag`: enum
- `keyLine`: <= 120 chars
- `details`: 0..3 lines, each <= 120 chars
- `highlights`: 0..3 UI highlight targets (chair/pot/board)
- `confidence`: 0..1 (optional)

Hard caps:

- No chain-of-thought exposure.
- No long essays unless user explicitly taps “深度复盘” (separate credit cost).

### Model Routing

Default:

- Cheap model for normal narration.
- More capable model only for “深度复盘报告” or multi-branch what-if.

### Caching

Cache key suggestions:

- Replay: hash of `HandSpec` + step index + requested view (`keyLine` vs `deep`)
- Live: hash of (street + potBucket + facingBetBucket + legalActions signature)

### Degrade Path

If Online unavailable (network/model/credits):

- Keep avatar/status indicating `LITE`.
- Fall back to Lite generation instantly.
- Never block the table.

### Safety / Tone

Online outputs must be:

- “coach”, not “authority”
- no guarantee language (“必胜/稳赢”)
- no real-money encouragement

---

## Credits (MVP Economics)

Credits should map to user-perceived “expensive” actions:

- `keyLine` auto narration: low cost or free within subscription quota
- `why` / `details` expand: small extra cost
- `deep replay report` (end of hand): higher cost
- `what-if branch analysis`: cost scales with branch depth

Rules:

- Subscription includes monthly credits.
- Extra credits can be purchased.
- When credits hit 0: auto-fallback to Lite, not a hard stop.

Prevent abuse:

- Rate limit per minute.
- Clamp output length.
- Deduplicate repeated requests at same step.

---

## Replay Mode Specifics

Replay narration should align with timeline control:

- At each cursor step:
  - produce a short “what happened + why it matters”
- When user seeks:
  - do not spam intermediate lines; only narrate the current cursor position

Branching:

- When a branch is created, REI should label it:
  - `IF: 你在这里选择 {action} ...`

---

## Minimal Milestones

1. Define `ReiContext` + signal derivation from snapshot/event.
2. Build Lite template bank + rule-based selector.
3. Add REI panel states + status tags + expand UI.
4. Add Online stub (feature flag) + degrade path.
5. Add replay alignment (narrate per cursor step).
