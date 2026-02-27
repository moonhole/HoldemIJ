package npc

// ChapterConfig defines a story mode chapter.
type ChapterConfig struct {
	ID          int              `json:"id"`         // 1-5
	Title       string           `json:"title"`      // "NEON GUTTER"
	Subtitle    string           `json:"subtitle"`   // flavor text
	BossID      string           `json:"bossId"`     // persona ID of the boss
	SupportIDs  []string         `json:"supportIds"` // persona IDs of supporting NPCs
	Objective   ChapterObjective `json:"objective"`
	Unlocks     []string         `json:"unlocks"`     // features unlocked on completion
	TeachTheme  string           `json:"teachTheme"`  // what the chapter teaches
	ReiIntro    string           `json:"reiIntro"`    // Rei's intro narration for this chapter
	ReiBossNote string           `json:"reiBossNote"` // Rei's commentary about the boss
}

// ChapterObjective defines the win condition for a chapter.
type ChapterObjective struct {
	Type   string `json:"type"`   // "win_bb", "survive", "win_pots", "eliminate", "most_chips"
	Target int    `json:"target"` // e.g. 10 BB, 30 hands, 3 pots, etc.
	Desc   string `json:"desc"`   // human-readable description
}

// StoryProgress tracks a player's story mode advancement.
type StoryProgress struct {
	UserID            uint64   `json:"userId"`
	CurrentChapter    int      `json:"currentChapter"` // highest unlocked chapter (0 = not started)
	CompletedChapters []int    `json:"completedChapters"`
	UnlockedFeatures  []string `json:"unlockedFeatures"`
}

// ChapterSession tracks an in-progress chapter attempt.
type ChapterSession struct {
	UserID       uint64
	Chapter      int
	TableID      string
	HandsPlayed  int
	StartStack   int64
	CurrentStack int64
	PotWins      int // for "win_pots" objective
	Completed    bool
}

// IsChapterComplete checks if the objective has been met.
func (s *ChapterSession) IsChapterComplete(obj ChapterObjective, bigBlind int64) bool {
	switch obj.Type {
	case "win_bb":
		gained := s.CurrentStack - s.StartStack
		return gained >= int64(obj.Target)*bigBlind
	case "survive":
		return s.HandsPlayed >= obj.Target && s.CurrentStack >= s.StartStack
	case "win_pots":
		return s.PotWins >= obj.Target
	case "eliminate":
		// Checked externally when all NPCs bust
		return s.Completed
	case "most_chips":
		// Checked externally by comparing stacks
		return s.Completed
	default:
		return false
	}
}
