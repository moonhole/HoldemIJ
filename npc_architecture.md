# NPC Module Architecture

> A unified NPC subsystem for HoldemIJ that serves Story Mode (6-max),
> ranked matchmaking filler, player-built strategy bots, and LLM-powered
> reasoning agents. All narrative flows through Rei (Agent Chat).

---

## 1. Core Design Principles

1. **One interface, four brain types.** All NPC types implement `BrainDecider`.
2. **6-max is the standard.** Story Mode is 1 human + 5 NPCs on a full ring.
3. **NPCs are persistent characters.** They have names, faces, and play styles
   that players learn to recognize across modes.
4. **Rei is the sole narrator.** NPCs never speak. Rei comments on them,
   introduces them, and provides tactical advice about them.
5. **NPC = JSON data.** Adding a new NPC requires zero code — just a config entry.

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

// BrainDecider is the core interface all NPC types implement.
type BrainDecider interface {
    Decide(view GameView) Decision
    Name() string
}
```

---

## 3. NPC Persona System

### 3.1 Persona Definition

Every NPC is defined by a lightweight persona card. NPCs do not have dialogue
— Rei handles all narrative using the persona's `ReiIntro` and `ReiStyle` fields.

```go
type NPCPersona struct {
    ID        string             // "dasher"
    Name      string             // "DASHER"
    Tagline   string             // "Fast hands, empty pockets"
    AvatarKey string             // asset key for avatar rendering
    Brain     PersonalityProfile // decision parameters
    FirstSeen int                // chapter where NPC first appears (0 = random pool only)
    Tier      int                // 1=boss, 2=supporting, 3=random/generated

    // Fields consumed by Rei for contextual commentary
    ReiIntro  string // "Likes to 3-bet from cutoff, often gives up on the river"
    ReiStyle  string // "loose-aggressive"
}

type PersonalityProfile struct {
    Aggression float64 // 0.0–1.0: tendency to bet/raise vs check/call
    Tightness  float64 // 0.0–1.0: hand range width (1.0 = only premiums)
    Bluffing   float64 // 0.0–1.0: bluff frequency
    Positional float64 // 0.0–1.0: how much position affects play
    Randomness float64 // 0.0–1.0: decision noise (0 = robotic, 1 = chaotic)
}
```

### 3.2 Three-Tier NPC Universe

```
NPC Universe
│
├── Tier 1: Story Bosses (5)
│   One per chapter. Full backstory. Unique avatar art.
│   Strongest personality traits (most recognizable).
│   After chapter is cleared → enters Quick Join pool.
│
├── Tier 2: Supporting Cast (15–20)
│   Appear as 6-max table fillers in Story Mode.
│   Named, with avatar and identifiable play style.
│   Enter Quick Join pool after first encounter.
│
└── Tier 3: Random NPCs (unlimited)
    Procedurally generated name + avatar combos.
    Brain params = slight mutation from base templates.
    Always available in Quick Join. No story significance.
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
  },
  {
    "id": "dasher",
    "name": "DASHER",
    "tagline": "Fast hands, empty pockets.",
    "avatarKey": "npc_dasher",
    "tier": 2,
    "firstSeen": 1,
    "brain": {
      "aggression": 0.75,
      "tightness": 0.3,
      "bluffing": 0.55,
      "positional": 0.5,
      "randomness": 0.25
    },
    "reiIntro": "Loves to 3-bet from cutoff and steal blinds aggressively, but tends to give up on the river when called.",
    "reiStyle": "loose-aggressive"
  }
  // ... more personas
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

**Key design:** Later chapters reintroduce NPCs from earlier chapters.
Players use the knowledge they've built about those characters.

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

When a player encounters an NPC in Story Mode for the first time,
that NPC is added to their unlock pool.

### 5.2 Quick Join Table Filling Rules

```
Seat filling priority:
1. Real human players (matchmaking)
2. Named NPCs from player's unlock pool (0–3, random)
3. Tier 3 random NPCs to fill remaining seats

NPC count by rank tier:
  Bronze:  up to 4 NPCs (many new players, few humans)
  Silver:  up to 2 NPCs
  Gold:    up to 1 NPC (mostly humans)
  Diamond: 0 NPCs (pure human)
```

### 5.3 Rei's Recognition System

When a known NPC sits at the table, Rei messages the player in Agent Chat:

**First encounter (Story Mode):**
> 🤖 Rei: This is **DASHER** — fast and reckless. He loves to 3-bet from
> cutoff but crumbles under pressure on the river.

**Re-encounter (Quick Join):**
> 🤖 Rei: Look who's here — **DASHER** again. You've played 20 hands
> against him so far. Record: 12W / 8L, up $4,200. He hasn't changed
> his habits.

**During play (triggered by NPC's signature behavior):**
> 🤖 Rei: Classic DASHER — 3-bet from CO again. Consider flatting
> with your position advantage.

---

## 6. Four Brain Types

### 6.1 RuleBrain — Story Mode & Ranked Filler

Deterministic rules with tunable personality parameters.

```go
type RuleBrain struct {
    Profile    PersonalityProfile
    rng        *rand.Rand
}

func (b *RuleBrain) Decide(view GameView) Decision {
    // Uses Profile params to weight action probabilities
    // e.g., high Aggression → more likely to bet/raise
    // high Tightness → fold more marginal hands preflop
    // Randomness adds noise to make play less predictable
}
```

### 6.2 ScriptBrain — Player-Created Strategy Bots

Players write strategy rules in a DSL or visual editor.

```go
type ScriptBrain struct {
    Script   *StrategyScript
    AuthorID uint64
    Name     string
}

// Example player-authored DSL:
// PREFLOP:
//   hand_strength > 0.8 → RAISE 3x BB
//   hand_strength > 0.5 → CALL
//   else → FOLD
```

This is the backend for the "Agent UI Programming" lobby feature card.

### 6.3 LLMBrain — LLM-Powered Reasoning NPC

Calls an external LLM for each decision. Most expensive but most human-like.

```go
type LLMBrain struct {
    Provider    LLMProvider
    Model       string
    SystemPrompt string
    Temperature float64
    Fallback    BrainDecider   // RuleBrain fallback on timeout
    Timeout     time.Duration  // max 5s
}
```

LLMBrain returns a `reasoning` field that Rei can display in Agent Chat,
creating a learning experience:

> 🤖 Rei: NEXUS is thinking... He has top pair on a wet board. He's
> considering a check-raise here to trap aggressive players.

### 6.4 Brain Assignment by Context

| Context | Brain Type | Notes |
|---------|-----------|-------|
| Story Mode Boss | RuleBrain (strong params) | Predictable enough to learn patterns |
| Story Mode Supporting | RuleBrain (varied params) | Unique per-persona |
| Quick Join (Bronze–Silver) | RuleBrain | From unlock pool |
| Quick Join (filler) | RuleBrain (Tier 3) | Random weak NPCs |
| Player Bot Arena | ScriptBrain | Community bots |
| Premium AI Mode | LLMBrain | Opt-in, possibly paid feature |

---

## 7. NPCManager (Server-Side)

```go
type NPCManager struct {
    registry  *PersonaRegistry          // all persona definitions
    instances map[uint64]*NPCInstance    // active NPC instances on tables
    pools     map[uint64]*PlayerNPCPool  // per-player unlock state
    mu        sync.RWMutex
}

type NPCInstance struct {
    PlayerID   uint64
    Chair      uint16
    Persona    *NPCPersona
    Brain      BrainDecider
    ThinkDelay time.Duration // simulate "thinking" for UX (1–4s)
}

// SpawnNPC creates and seats an NPC at the table.
func (m *NPCManager) SpawnNPC(
    table *holdem.Game,
    chair uint16,
    persona *NPCPersona,
) (*NPCInstance, error)

// OnTurn is called by the game loop when it's an NPC's turn to act.
func (m *NPCManager) OnTurn(playerID uint64, view GameView) Decision

// FillTable picks NPCs for a Quick Join table based on player's pool + rank.
func (m *NPCManager) FillTable(
    userID uint64,
    rank string,
    emptySeats int,
) []*NPCPersona
```

### Integration with Game Loop

```
Game Loop (tables.go)
│
├── game.StartHand()
│
├── for each turn:
│   ├── if player.IsRobot():
│   │   └── decision = npcManager.OnTurn(playerID, view)
│   │       └── time.Sleep(instance.ThinkDelay)  // UX realism
│   │       └── game.Act(chair, decision.Action, decision.Amount)
│   │
│   └── if human:
│       └── wait for WebSocket → game.Act(...)
│
└── game.EndHand() → update NPCRecords
```

---

## 8. Data Schema

```sql
-- NPC persona templates (developer-authored, loaded from JSON at startup)
-- Stored in DB for querying and potential community contributions.
CREATE TABLE npc_personas (
    id          TEXT PRIMARY KEY,       -- "dasher"
    name        TEXT NOT NULL,          -- "DASHER"
    tagline     TEXT,
    avatar_key  TEXT,
    tier        INT NOT NULL DEFAULT 3, -- 1=boss, 2=supporting, 3=random
    first_seen  INT DEFAULT 0,          -- chapter number (0 = no story)
    brain       JSONB NOT NULL,         -- PersonalityProfile
    rei_intro   TEXT,
    rei_style   TEXT
);

-- Player's unlocked NPC pool and per-NPC records
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

-- Story mode progress
CREATE TABLE story_progress (
    user_id     BIGINT PRIMARY KEY,
    chapter     INT NOT NULL DEFAULT 0,     -- highest completed chapter
    unlocks     JSONB DEFAULT '[]'::jsonb,  -- ["hand_audit", "agent_coach", ...]
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Player-created bots (for Agent UI Programming)
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
- Small icon next to NPC name: 🤖 (rule), ⚡ (script bot), 🧠 (LLM)
- Story NPCs: unique avatar art rendered in seat
- Hover/click: shows simplified persona card (name, tagline, your record vs them)

### Left Rail Enhancements
- **Story Mode:** chapter objective + Boss intel card
- **Quick Join:** if named NPCs are present, show mini cards in Opponent section

### Rei (Agent Chat) — The Single Narrative Channel
- NPC introductions on seat join
- Tactical commentary during play
- Post-hand summary ("You just won $800 from DASHER, your best pot against him")
- Story chapter narration (chapter intro, objective reminders, completion celebration)

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
- Partial only: Feature unlock gating, returning-NPC records/pool logic, and Rei recognition/commentary loops are not implemented yet.

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
- [ ] Feature unlock gating (Audit, Coach, etc.)
- [ ] Rei story narration templates (chapter intro, NPC intro, completion)
- [ ] 5 Boss personas + 15 supporting personas (brain tuning + avatar art)

Current state:
- ✔ `data/story_chapters.json` + `ChapterRegistry` are in place.
- ✔ Story table creation, chapter info proto payloads, gateway handler, and frontend "Begin Chapter I" entry are wired.
- ✔ Story progress persistence + chapter lock/unlock flow are implemented (memory/postgres/sqlite backends + server push to frontend).
- Partial: chapter intro/boss note text exists, but a full Rei narration pipeline for NPC intro/completion is still missing.
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
- [ ] DSL parser → `ScriptBrain`
- [ ] Visual strategy editor (lobby feature card)
- [ ] Bot leaderboard + ELO system
- [ ] Bot vs Bot arena mode

### Phase 5: LLM Integration
- [ ] `LLMBrain` with provider abstraction (OpenAI, Ollama)
- [ ] Prompt engineering + JSON response parsing
- [ ] Timeout + RuleBrain fallback
- [ ] LLM reasoning → Rei Agent Chat pipeline
- [ ] Cost control (caching, rate limiting, opt-in premium)
