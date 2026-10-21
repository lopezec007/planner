package store

import (
	"errors"
	"strings"
	"testing"
)

func TestScratch(t *testing.T) {
	s := openTest(t)
	// Unwritten scopes read as empty rather than missing.
	g, err := s.GlobalScratch()
	if err != nil || g.Text != "" || g.UpdatedAt != "" {
		t.Fatalf("empty global: %+v %v", g, err)
	}
	g, err = s.SetGlobalScratch("shared notes")
	if err != nil || g.Text != "shared notes" || g.UpdatedAt == "" {
		t.Fatalf("set global: %+v %v", g, err)
	}
	g, _ = s.GlobalScratch()
	if g.Text != "shared notes" {
		t.Fatalf("read back: %+v", g)
	}
	// Per user, kept apart from the shared pane and from each other.
	u, _ := s.CreateUser("Evan", "", "")
	v, _ := s.CreateUser("Sam", "", "")
	if _, err := s.SetUserScratch(u.ID, "evan's"); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[int64]string{u.ID: "evan's", v.ID: ""} {
		sc, err := s.UserScratch(id)
		if err != nil || sc.Text != want {
			t.Fatalf("user %d: %+v %v", id, sc, err)
		}
	}
	if g, _ = s.GlobalScratch(); g.Text != "shared notes" {
		t.Fatalf("global changed: %+v", g)
	}
	// Unknown users.
	if _, err := s.UserScratch(999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}
	if _, err := s.SetUserScratch(999, "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}
	// The size cap and invalid UTF-8 are validation errors.
	var ve *ValidationError
	if _, err := s.SetGlobalScratch(strings.Repeat("x", MaxScratchSize+1)); !errors.As(err, &ve) || !strings.Contains(err.Error(), "1 MiB") {
		t.Fatalf("over the cap: %v", err)
	}
	if _, err := s.SetGlobalScratch("\xff"); !errors.As(err, &ve) {
		t.Fatalf("invalid utf-8: %v", err)
	}
	if _, err := s.SetGlobalScratch(strings.Repeat("y", MaxScratchSize)); err != nil {
		t.Fatalf("at the cap: %v", err)
	}
	// Deleting a user removes their pane.
	if err := s.DeleteUser(u.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM scratch WHERE scope = ?`, UserScratchScope(u.ID)).Scan(&n); err != nil || n != 0 {
		t.Fatalf("pane left behind: %d %v", n, err)
	}
}
