package store

import (
	"database/sql"
	"errors"
	"strconv"
	"unicode/utf8"
)

// The scratch pad: free-form text panes, one shared by everyone ("global")
// and one per user ("user:<id>"). Each scope is a single row that the client
// replaces wholesale on every autosave; there is no history.

// Scratch is the text of one scratch pad scope. UpdatedAt is "" until the
// scope has been written for the first time.
type Scratch struct {
	Text      string `json:"text"`
	UpdatedAt string `json:"updated_at"`
}

// MaxScratchSize is the largest scratch pad text accepted, in bytes.
const MaxScratchSize = 1 << 20

// GlobalScratchScope is the scope of the pane everyone shares.
const GlobalScratchScope = "global"

// UserScratchScope is the scope of a user's own pane.
func UserScratchScope(userID int64) string { return "user:" + strconv.FormatInt(userID, 10) }

// ScratchByScope returns the text of a scope; an unwritten scope is empty.
func (s *Store) ScratchByScope(scope string) (*Scratch, error) {
	var sc Scratch
	err := s.db.QueryRow(`SELECT text, updated_at FROM scratch WHERE scope = ?`, scope).Scan(&sc.Text, &sc.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return &Scratch{}, nil
	}
	if err != nil {
		return nil, err
	}
	return &sc, nil
}

// SetScratchByScope replaces the text of a scope and returns the result.
func (s *Store) SetScratchByScope(scope, text string) (*Scratch, error) {
	if len(text) > MaxScratchSize {
		return nil, verr("the scratch pad text is larger than the %d MiB limit", MaxScratchSize>>20)
	}
	if !utf8.ValidString(text) {
		return nil, verr("the scratch pad text must be valid UTF-8")
	}
	ts := now()
	if _, err := s.db.Exec(`INSERT INTO scratch (scope, text, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(scope) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`, scope, text, ts); err != nil {
		return nil, err
	}
	return &Scratch{Text: text, UpdatedAt: ts}, nil
}

// GlobalScratch returns the shared pane.
func (s *Store) GlobalScratch() (*Scratch, error) { return s.ScratchByScope(GlobalScratchScope) }

// SetGlobalScratch replaces the shared pane's text.
func (s *Store) SetGlobalScratch(text string) (*Scratch, error) {
	return s.SetScratchByScope(GlobalScratchScope, text)
}

// UserScratch returns a user's own pane; ErrNotFound for an unknown user.
func (s *Store) UserScratch(userID int64) (*Scratch, error) {
	if _, err := s.GetUser(userID); err != nil {
		return nil, err
	}
	return s.ScratchByScope(UserScratchScope(userID))
}

// SetUserScratch replaces a user's own pane; ErrNotFound for an unknown user.
func (s *Store) SetUserScratch(userID int64, text string) (*Scratch, error) {
	if _, err := s.GetUser(userID); err != nil {
		return nil, err
	}
	return s.SetScratchByScope(UserScratchScope(userID), text)
}
