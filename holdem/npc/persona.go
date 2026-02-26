package npc

// PersonalityProfile defines the tunable parameters for a RuleBrain.
type PersonalityProfile struct {
	Aggression float64 `json:"aggression"` // 0.0–1.0: tendency to bet/raise vs check/call
	Tightness  float64 `json:"tightness"`  // 0.0–1.0: hand range width (1.0 = only premiums)
	Bluffing   float64 `json:"bluffing"`   // 0.0–1.0: bluff frequency
	Positional float64 `json:"positional"` // 0.0–1.0: how much position affects play
	Randomness float64 `json:"randomness"` // 0.0–1.0: decision noise
}

// NPCPersona defines a named NPC character.
type NPCPersona struct {
	ID        string             `json:"id"`
	Name      string             `json:"name"`
	Tagline   string             `json:"tagline"`
	AvatarKey string             `json:"avatarKey"`
	Tier      int                `json:"tier"`      // 1=boss, 2=supporting, 3=random
	FirstSeen int                `json:"firstSeen"` // chapter (0 = no story)
	Brain     PersonalityProfile `json:"brain"`
	ReiIntro  string             `json:"reiIntro"`
	ReiStyle  string             `json:"reiStyle"`
}
