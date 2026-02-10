package auth

import "testing"

func TestResolveOrCreateAccount_ReusesValidToken(t *testing.T) {
	m := NewManager()
	accountID1, token, reused := m.ResolveOrCreateAccount("")
	if accountID1 == 0 {
		t.Fatalf("expected non-zero account id")
	}
	if token == "" {
		t.Fatalf("expected session token")
	}
	if reused {
		t.Fatalf("new account should not be marked reused")
	}

	accountID2, token2, reused2 := m.ResolveOrCreateAccount(token)
	if !reused2 {
		t.Fatalf("expected reused account for valid token")
	}
	if accountID1 != accountID2 {
		t.Fatalf("expected same account id, got %d and %d", accountID1, accountID2)
	}
	if token2 != token {
		t.Fatalf("expected same token for valid session")
	}
}

func TestResolveOrCreateAccount_CreatesNewForUnknownToken(t *testing.T) {
	m := NewManager()
	accountID1, _, _ := m.ResolveOrCreateAccount("")
	accountID2, token2, reused2 := m.ResolveOrCreateAccount("invalid-token")
	if reused2 {
		t.Fatalf("unknown token should not be reused")
	}
	if token2 == "" {
		t.Fatalf("expected new session token")
	}
	if accountID1 == accountID2 {
		t.Fatalf("expected a different account id for invalid token")
	}
}
