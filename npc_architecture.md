# NPC Module Architecture

> A unified NPC subsystem for HoldemIJ that serves Story Mode (6-max),
> ranked matchmaking filler, player-built strategy bots, and LLM-powered
> reasoning agents. All narrative flows through Rei (Agent Chat).

---

## 1. Core Design Principles

1. **One core policy engine.** Rule/Script/LLM all execute through the same decision core.
2. **Style modulates strategy, not replaces it.** Persona traits are bounded biases over a shared policy structure.
3. **6-max is the standard.** Story Mode is 1 human + 5 NPCs on a full ring.
4. **NPCs are persistent characters.** They have names, faces, and play styles that players learn to recognize across modes.
5. **Rei is the sole narrator.** NPCs never speak. Rei comments on them, introduces them, and provides tactical advice about them.
6. **NPC = data-first config.** Personas and strategy presets are data-driven, so new opponents do not require engine rewrites.

---

## 2. BrainDecider Interface (Go)

```go
package npc

import (
    "holdem-lite/card"
    "holdem-lite/holdem"
)

// GameView is a read-only projection of the game state visible to the NPC.
type GameView struct {
    Phase          holdem.Phase
    HoleCards      []card.Card
    Community      []card.Card
    Pot            int64
    CurrentBet     int64
    MyBet          int64
    MyStack        int64
    LegalActions   []holdem.ActionType
    MinRaise       int64
    ActivePlayers  int
    OpponentStacks []int64
    Street         int                // 0=preflop, 1=flop, 2=turn, 3=river
    HandHistory    []HistoryEntry
}

// Decision is what the brain returns.
type Decision struct {
    Action holdem.ActionType
    Amount int64
}

// BrainDecider is the runtime adapter used by table/game loop.
// Internally, all adapters delegate to one core policy engine.
type BrainDecider interface {
    Decide(view GameView) Decision
    Name() string
}
```

---

## 3. NPC Persona System

### 3.1 Persona Definition

Every NPC is defined by a lightweight persona card. NPCs do not have dialogue.
Rei handles all narrative using the persona's `ReiIntro` and `ReiStyle` fields.

```go
type NPCPersona struct {
    ID        string             // "dasher"
    Name      string             // "DASHER"
    Tagline   string             // "Fast hands, empty pockets"
    AvatarKey string             // asset key for avatar rendering
    Brain     PersonalityProfile // style modulation parameters
    FirstSeen int                // chapter where NPC first appears (0 = random pool only)
    Tier      int                // 1=boss, 2=supporting, 3=random/generated

    // Fields consumed by Rei for contextual commentary
    ReiIntro  string
    ReiStyle  string
}

type PersonalityProfile struct {
    Aggression float64 // tendency to bet/raise vs check/call
    Tightness  float64 // hand range width (1.0 = only premiums)
    Bluffing   float64 // bluff frequency tendency
    Positional float64 // how much position affects play
    Randomness float64 // bounded noise (0 = robotic, 1 = chaotic)
}
```

### 3.2 Three-Tier NPC Universe

```
NPC Universe
├── Tier 1: Story Bosses (5)
│   One per chapter. Full backstory. Strongest identity.
├── Tier 2: Supporting Cast (15-20)
│   Named fillers with recognizable styles.
└── Tier 3: Random NPCs (unlimited)
    Generated combinations for population fill.
```

### 3.3 Persona Registry (JSON-driven)

```jsonc
// data/npc_personas.json
[
  {
    "id": "proxy",
    "name": "PROXY",
    "tagline": "Calls everything. Regrets nothing.",
    "avatarKey": "npc_proxy",
    "tier": 1,
    "firstSeen": 1,
    "brain": {
      "aggression": 0.2,
      "tightness": 0.2,
      "bluffing": 0.1,
      "positional": 0.3,
      "randomness": 0.35
    },
    "reiIntro": "A true calling station. Rarely folds to any bet, but almost never raises. Punish him with larger value bets.",
    "reiStyle": "passive-loose"
  }
]
```

---

## 4. Story Mode Design (6-max)

### 4.1 Format

Each chapter is a **6-max session**: 1 human (you) + 1 Boss NPC + 4 supporting NPCs.
The game plays standard No-Limit Hold'em. Chapters have objectives rather than
simple "beat the boss" conditions.

### 4.2 Chapter Outline

| Ch | Title | Boss | Style | 4 Supporting NPCs | Objective | Teaching Theme |
|----|-------|------|-------|-------------------|-----------|----------------|
| 1 | NEON GUTTER | PROXY | Passive-Loose | DASHER, GLOW, MOTH, STATIC | Win 10 BB | Basics: fold equity + value betting |
| 2 | CHROME HEAVEN | MIRROR | Tight-Passive | FLUX, SHARD + 2 from Ch.1 | Survive 30 hands, don't lose chips | Position + blind stealing |
| 3 | VOID RUNNER | VECTOR | Loose-Aggressive | DRIFT, SPARK + 2 returning | Win 3 pots against VECTOR | Reading bluffs + exploiting LAGs |
| 4 | GLITCH PALACE | CIPHER | Tight-Aggressive | 4 mixed (2 new + 2 returning) | Tournament: eliminate everyone | Tournament strategy + ICM |
| 5 | DATA STREAM | NEXUS | Balanced/GTO | 4 strong (all returning faces) | Most chips after 60 hands | Full GTO + dynamic adaptation |

### 4.3 Passage Unlocks

| Cleared | Feature Unlocked |
|---------|-----------------|
| Ch.1 | Hand Audit |
| Ch.2 | Agent Coach |
| Ch.3 | Agent UI Programming |
| Ch.4 | Invite Friends (Multiplayer) |
| Ch.5 | All NPC personas visible in Quick Join |

---

## 5. Unlock Pool & Quick Join Integration

### 5.1 Player's NPC Pool

```go
type PlayerNPCPool struct {
    UserID   uint64
    Unlocked []string             // ["proxy", "dasher", "glow", ...]
    Records  map[string]NPCRecord // per-NPC win/loss history
}

type NPCRecord struct {
    Wins       int
    Losses     int
    NetPnL     int64
    LastSeenAt time.Time
}
```

### 5.2 Quick Join Table Filling Rules

```
Seat filling priority:
1. Real human players
2. Named NPCs from player's unlock pool
3. Tier 3 random NPCs for remaining seats

NPC count by rank tier:
  Bronze: up to 4 NPCs
  Silver: up to 2 NPCs
  Gold:   up to 1 NPC
  Diamond: 0 NPCs
```

### 5.3 Rei's Recognition System

When a known NPC sits at the table, Rei messages the player in Agent Chat:

- First encounter intro
- Re-encounter recap (record and habits)
- Triggered tactical hints from signature behavior

---

## 6. Unified Policy Architecture

### 6.1 One Execution Core

All NPC decisions are executed by one deterministic core policy engine.
Rule/Script/LLM do **not** execute actions directly; they provide strategy
plans (or deltas), and the core engine emits the final `Decision`.

```go
type CorePolicyEngine interface {
    Decide(view GameView, runtime PolicyRuntime) Decision
}
```

### 6.2 Shared Strategy Plan

All strategy sources target the same plan schema so they are comparable,
testable, and replayable.

```go
type PolicyPlan struct {
    OpenRaiseByPos       map[string]float64
    ThreeBetByPos        map[string]float64
    CBetByStreet         map[int]float64 // 1=flop,2=turn,3=river
    BarrelByStreet       map[int]float64
    CheckRaiseByStreet   map[int]float64
    BetSizeFractions     []float64
    RaiseSizeMultipliers []float64
    MaxBluffFreq         float64
    MaxAllInFreq         float64
}
```

### 6.3 Style Modulator (Persona Layer)

`Aggression / Tightness / Bluffing / Positional / Randomness` are style biases
over `PolicyPlan`, not full strategy definitions.

- `Aggression`: nudges bet/raise frequencies and larger sizing choices.
- `Tightness`: narrows preflop participation and marginal continues.
- `Bluffing`: adjusts bluff branches under guard bounds.
- `Positional`: scales IP/OOP pressure and defense frequencies.
- `Randomness`: adds bounded entropy to avoid robotic repetition.

### 6.4 Strategy Providers

| Provider | Input | Output | Typical Use |
|---------|-------|--------|-------------|
| `RuleProvider` | Persona + built-in templates | Full `PolicyPlan` | Story baseline, Quick Join fillers |
| `ScriptProvider` | DSL / visual strategy graph | `PolicyPlan` or validated delta | Player bot arena |
| `LLMProvider` | Prompt + table context | Proposed delta + reasoning | Premium adaptive mode |

### 6.5 Brain Level = Execution Cadence

Brain level defines **when** strategy updates happen, not a separate
decision engine.

| Brain Level | Update cadence | Typical mapping |
|------------|----------------|-----------------|
| Mechanical | Static per table/session | RuleProvider baseline NPCs |
| Dynamic | Recompute at hand/street triggers | ScriptProvider bots, advanced bosses |
| Intelligent | Contextual deltas + guard + fallback | LLMProvider modes |

### 6.6 Guardrails and Fallback

Every provider output passes through a guard layer before execution.

```go
type PolicyGuard interface {
    Validate(plan PolicyPlan) error
    Clamp(base PolicyPlan, delta PolicyDelta) PolicyPlan
}
```

If a provider fails (timeout/parse/invalid), fallback path is:
`last_good_plan -> rule baseline -> safe action`.

### 6.7 Context Assignment

| Context | Provider | Brain Level | Notes |
|---------|----------|-------------|-------|
| Story Mode Boss (Ch1-Ch3) | RuleProvider | Mechanical | Learnable patterns first |
| Story Mode Boss (Ch4-Ch5) | RuleProvider (+ scripted deltas) | Dynamic | Add adaptation pressure |
| Story Mode Supporting | RuleProvider | Mechanical | Stable cast identities |
| Quick Join filler | RuleProvider | Mechanical | Low cost, deterministic |
| Player Bot Arena | ScriptProvider | Dynamic | User-authored strategies |
| Premium AI Mode | LLMProvider (+ Rule fallback) | Intelligent | Opt-in, cost-controlled |

---

## 7. NPCManager (Server-Side)

```go
type NPCManager struct {
    registry     *PersonaRegistry
    instances    map[uint64]*NPCInstance
    pools        map[uint64]*PlayerNPCPool
    coreEngine   CorePolicyEngine
    ruleSource   RuleProvider
    scriptSource ScriptProvider
    llmSource    LLMProvider
    guard        PolicyGuard
    mu           sync.RWMutex
}

type NPCInstance struct {
    PlayerID   uint64
    Chair      uint16
    Persona    *NPCPersona
    Brain      BrainDecider  // thin adapter over coreEngine + runtime
    Provider   string        // rule|script|llm
    Level      string        // mechanical|dynamic|intelligent
    Runtime    PolicyRuntime // current effective plan + metadata
    ThinkDelay time.Duration
}

func (m *NPCManager) SpawnNPC(
    table *holdem.Game,
    chair uint16,
    persona *NPCPersona,
) (*NPCInstance, error)

func (m *NPCManager) OnTurn(playerID uint64, view GameView) Decision

func (m *NPCManager) FillTable(
    userID uint64,
    rank string,
    emptySeats int,
) []*NPCPersona
```

### OnTurn Flow

1. Build/refresh runtime plan by provider + level cadence.
2. Apply `PolicyGuard` validation/clamp.
3. Execute one action via `coreEngine.Decide(view, runtime)`.
4. Emit optional reasoning metadata to Rei channel (if available).

### Integration with Game Loop

```
Game Loop
├── game.StartHand()
├── for each turn:
│   ├── if player.IsRobot():
│   │   ├── decision = npcManager.OnTurn(playerID, view)
│   │   ├── time.Sleep(instance.ThinkDelay)
│   │   └── game.Act(chair, decision.Action, decision.Amount)
│   └── if human:
│       └── wait for WebSocket -> game.Act(...)
└── game.EndHand() -> update records / progression
```

---

## 8. Data Schema

```sql
CREATE TABLE npc_personas (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    tagline     TEXT,
    avatar_key  TEXT,
    tier        INT NOT NULL DEFAULT 3,
    first_seen  INT DEFAULT 0,
    brain       JSONB NOT NULL,
    rei_intro   TEXT,
    rei_style   TEXT
);

CREATE TABLE player_npc_records (
    user_id     BIGINT NOT NULL,
    npc_id      TEXT NOT NULL REFERENCES npc_personas(id),
    wins        INT DEFAULT 0,
    losses      INT DEFAULT 0,
    net_pnl     BIGINT DEFAULT 0,
    first_met   TIMESTAMPTZ DEFAULT now(),
    last_seen   TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, npc_id)
);

CREATE TABLE story_progress (
    user_id     BIGINT PRIMARY KEY,
    chapter     INT NOT NULL DEFAULT 0,
    unlocks     JSONB DEFAULT '[]'::jsonb,
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE player_bots (
    id          SERIAL PRIMARY KEY,
    author_id   BIGINT NOT NULL,
    name        TEXT NOT NULL,
    script      JSONB NOT NULL,
    wins        INT DEFAULT 0,
    losses      INT DEFAULT 0,
    elo         INT DEFAULT 1000,
    created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

## 9. Frontend Display

### NPC Badge on Player Seat
- Small icon next to NPC name: rule / script / llm source badge
- Story NPCs: unique avatar art rendered in seat
- Hover/click: persona card (name, tagline, record vs them)

### Left Rail Enhancements
- **Story Mode:** chapter objective + Boss intel card
- **Quick Join:** mini cards for named NPCs in table

### Rei (Agent Chat) - The Single Narrative Channel
- NPC introductions on seat join
- Tactical commentary during play
- Post-hand summary
- Story chapter narration

---

## 10. NPC Roster (Initial 20)

### Tier 1: Story Bosses

| ID | Name | Chapter | Style | Aggression | Tightness | Bluffing |
|----|------|---------|-------|------------|-----------|----------|
| proxy | PROXY | 1 | Passive-Loose | 0.20 | 0.20 | 0.10 |
| mirror | MIRROR | 2 | Tight-Passive | 0.25 | 0.80 | 0.05 |
| vector | VECTOR | 3 | Loose-Aggressive | 0.80 | 0.25 | 0.60 |
| cipher | CIPHER | 4 | Tight-Aggressive | 0.75 | 0.70 | 0.35 |
| nexus | NEXUS | 5 | Balanced/GTO | 0.55 | 0.55 | 0.40 |

### Tier 2: Supporting Cast

| ID | Name | First Ch. | Style | Tagline |
|----|------|-----------|-------|---------|
| dasher | DASHER | 1 | LAG | "Fast hands, empty pockets." |
| glow | GLOW | 1 | Passive-Tight | "Patience is a weapon." |
| moth | MOTH | 1 | Loose-Passive | "Drawn to the pot like a flame." |
| static | STATIC | 1 | Balanced-Weak | "Predictable as white noise." |
| flux | FLUX | 2 | Erratic | "Never the same player twice." |
| shard | SHARD | 2 | Tight-Passive | "Waits for the nuts, always." |
| drift | DRIFT | 3 | Positional | "Only plays in position." |
| spark | SPARK | 3 | Aggressive-Loose | "Lights money on fire." |
| null | NULL | 4 | GTO-Lite | "No emotion. No tells." |
| echo | ECHO | 4 | Copycat | "Mirrors your last action." |
| wraith | WRAITH | 5 | Deceptive | "You never see the trap coming." |
| signal | SIGNAL | 5 | Balanced-Strong | "Plays exactly by the book." |
| arc | ARC | 5 | Adaptive | "Changes style mid-session." |
| haze | HAZE | 5 | Random | "Chaos incarnate." |
| bolt | BOLT | 5 | Hyper-Aggressive | "All-in or nothing." |

---

## 11. Implementation Phases

### Progress Snapshot (as of 2026-02-27)

- ✔ Phase 1 foundation is implemented in `holdem/npc/` and integrated into the live table loop.
- ✔ Quick Join can already auto-fill newly created tables with 4 NPCs.
- ✔ Story Mode has baseline wiring end-to-end: chapter JSON, chapter registry, story table creation, proto messages, gateway handler, frontend entrypoint.
- ✔ Frontend seat rendering already distinguishes NPC players with a dedicated badge.
- Partial only: Returning-NPC records/pool logic and Rei recognition/commentary loops are not implemented yet.
- New architecture direction (this doc): migrate to unified policy core + provider model.

### Phase 1: Foundation
- ✔ Create `holdem/npc/` package with `BrainDecider` interface
- ✔ Implement `RuleBrain` with `PersonalityProfile` parameters
- ✔ Build `PersonaRegistry` that loads from JSON
- ✔ Implement `NPCManager` (spawn, on-turn, despawn)
- ✔ Integrate NPC turn handling into table game loop
- ✔ NPC badge display on frontend player seats

### Phase 2: Story Mode
- ✔ Story chapter config (objectives, NPC assignments, unlock rewards)
- ✔ Chapter progress tracking (`story_progress` table)
- ✔ Feature unlock gating (Audit, Coach, etc.)
- [ ] Rei story narration templates (chapter intro, NPC intro, completion)
- [ ] 5 Boss personas + 15 supporting personas (brain tuning + avatar art)

Current state:
- ✔ `data/story_chapters.json` + `ChapterRegistry` are in place.
- ✔ Story table creation, chapter info proto payloads, gateway handler, and frontend "Begin Chapter I" entry are wired.
- ✔ Story progress persistence + chapter lock/unlock flow are implemented (memory/postgres/sqlite backends + server push to frontend).
- Partial: chapter intro + chapter completion narration is wired into frontend Rei runtime, but per-NPC encounter/return narration is still missing.
- Partial: 20 personas and brain tuning exist in JSON, but the avatar-art portion is still outstanding.

### Phase 3: Quick Join Integration
- [ ] Player NPC pool + unlock tracking (`player_npc_records` table)
- [ ] `FillTable()` logic based on rank tier
- [ ] Rei recognition system for returning NPCs
- [ ] Per-NPC win/loss record display in left rail

Current state:
- ✔ Baseline NPC autofill for Quick Join exists today.
- Partial: current fill logic is random roster fill and is not yet rank-tier-aware or unlock-pool-aware.

### Phase 4: Player Bots (Agent UI Programming)
- [ ] Strategy DSL specification
- [ ] DSL parser -> `ScriptProvider` (PolicyPlan / delta)
- [ ] Visual strategy editor (lobby feature card)
- [ ] Bot leaderboard + ELO system
- [ ] Bot vs Bot arena mode

### Phase 5: LLM Integration
- [ ] `LLMProvider` abstraction (OpenAI, Ollama, etc.)
- [ ] Prompt engineering + structured delta parsing
- [ ] Timeout + Rule fallback + `PolicyGuard` clamp
- [ ] LLM reasoning -> Rei Agent Chat pipeline
- [ ] Cost control (caching, rate limiting, opt-in premium)
