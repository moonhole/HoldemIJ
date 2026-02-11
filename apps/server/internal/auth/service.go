package auth

// Service is the auth/session contract consumed by gateway and HTTP handlers.
type Service interface {
	Register(username, password string) (accountID uint64, sessionToken string, err error)
	Login(username, password string) (accountID uint64, sessionToken string, err error)
	ResolveSession(token string) (accountID uint64, username string, ok bool)
	Logout(token string)
	Close() error

	// Deprecated compatibility API.
	ResolveOrCreateAccount(token string) (accountID uint64, sessionToken string, reused bool)
}
