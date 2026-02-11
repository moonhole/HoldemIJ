package auth

import (
	"errors"
	"testing"
)

func TestRegisterAndLogin(t *testing.T) {
	m := NewManager()

	accountID, token, err := m.Register("alice_01", "secret12")
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}
	if accountID == 0 {
		t.Fatalf("expected account id")
	}
	if token == "" {
		t.Fatalf("expected non-empty token")
	}

	resolvedID, username, ok := m.ResolveSession(token)
	if !ok {
		t.Fatalf("expected valid session")
	}
	if resolvedID != accountID {
		t.Fatalf("expected same account id, got %d and %d", accountID, resolvedID)
	}
	if username != "alice_01" {
		t.Fatalf("expected username alice_01, got %s", username)
	}

	loginID, loginToken, err := m.Login("alice_01", "secret12")
	if err != nil {
		t.Fatalf("login failed: %v", err)
	}
	if loginID != accountID {
		t.Fatalf("expected same account id after login")
	}
	if loginToken == "" {
		t.Fatalf("expected login token")
	}
}

func TestRegisterRejectsDuplicateUsername(t *testing.T) {
	m := NewManager()
	if _, _, err := m.Register("alice_01", "secret12"); err != nil {
		t.Fatalf("register failed: %v", err)
	}
	if _, _, err := m.Register("Alice_01", "secret12"); !errors.Is(err, ErrUsernameTaken) {
		t.Fatalf("expected ErrUsernameTaken, got %v", err)
	}
}

func TestLoginRejectsWrongPassword(t *testing.T) {
	m := NewManager()
	if _, _, err := m.Register("alice_01", "secret12"); err != nil {
		t.Fatalf("register failed: %v", err)
	}
	if _, _, err := m.Login("alice_01", "wrong-password"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestLogoutInvalidatesSession(t *testing.T) {
	m := NewManager()
	_, token, err := m.Register("alice_01", "secret12")
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}
	m.Logout(token)
	if _, _, ok := m.ResolveSession(token); ok {
		t.Fatalf("expected logged out token to be invalid")
	}
}
