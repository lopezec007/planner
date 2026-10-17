package store

import (
	"errors"
	"path/filepath"
	"testing"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func str(s string) *string { return &s }
func i64(i int64) *int64   { return &i }
func in(i int) *int        { return &i }
func b(v bool) *bool       { return &v }

func mustCreate(t *testing.T, s *Store, typ string, p Patch) *Item {
	t.Helper()
	it, err := s.CreateItem(NewItem{Type: typ, Patch: p})
	if err != nil {
		t.Fatalf("create %s: %v", typ, err)
	}
	return it
}

func TestKeysIncrementPerTypeAndNeverReuse(t *testing.T) {
	s := openTest(t)
	o1 := mustCreate(t, s, TypeOngoing, Patch{Title: str("Maint")})
	p1 := mustCreate(t, s, TypeProject, Patch{Title: str("Proj")})
	o2 := mustCreate(t, s, TypeOngoing, Patch{Title: str("Finance")})
	if o1.Key != "O-1" || p1.Key != "P-1" || o2.Key != "O-2" {
		t.Fatalf("keys: %s %s %s", o1.Key, p1.Key, o2.Key)
	}
	if err := s.DeleteItem(o2.ID); err != nil {
		t.Fatal(err)
	}
	o3 := mustCreate(t, s, TypeOngoing, Patch{Title: str("Again")})
	if o3.Key != "O-3" {
		t.Fatalf("expected O-3 after delete, got %s", o3.Key)
	}
}

func TestDefaultsAndValidation(t *testing.T) {
	s := openTest(t)
	o := mustCreate(t, s, TypeOngoing, Patch{Title: str("Bucket")})
	if o.Status != nil {
		t.Fatal("ongoing should have no status")
	}
	tk := mustCreate(t, s, TypeTask, Patch{Title: str("T"), ParentID: i64(o.ID)})
	if *tk.Urgency != 5 || *tk.Importance != 5 || *tk.Status != StatusTodo || tk.Blocked {
		t.Fatalf("task defaults wrong: %+v", tk)
	}
	cases := []struct {
		name string
		typ  string
		p    Patch
	}{
		{"no title", TypeOngoing, Patch{}},
		{"blank title", TypeOngoing, Patch{Title: str("  ")}},
		{"task no parent", TypeTask, Patch{Title: str("x")}},
		{"task parent is task", TypeTask, Patch{Title: str("x"), ParentID: i64(tk.ID)}},
		{"project with parent", TypeProject, Patch{Title: str("x"), ParentID: i64(o.ID)}},
		{"ongoing with status", TypeOngoing, Patch{Title: str("x"), Status: str(StatusTodo)}},
		{"ongoing with date", TypeOngoing, Patch{Title: str("x"), StartDate: str("2026-01-01")}},
		{"project with urgency", TypeProject, Patch{Title: str("x"), Urgency: in(3)}},
		{"bad status", TypeProject, Patch{Title: str("x"), Status: str("nope")}},
		{"bad date", TypeProject, Patch{Title: str("x"), EndDate: str("01/02/2026")}},
		{"urgency range", TypeTask, Patch{Title: str("x"), ParentID: i64(o.ID), Urgency: in(11)}},
		{"missing owner", TypeTask, Patch{Title: str("x"), ParentID: i64(o.ID), OwnerID: i64(999)}},
	}
	for _, c := range cases {
		_, err := s.CreateItem(NewItem{Type: c.typ, Patch: c.p})
		var ve *ValidationError
		if !errors.As(err, &ve) {
			t.Errorf("%s: expected validation error, got %v", c.name, err)
		}
	}
}

func TestAssigneeSharedExclusive(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateUser("Evan", "")
	p := mustCreate(t, s, TypeProject, Patch{Title: str("P"), AssigneeID: i64(u.ID)})
	if p.AssigneeID == nil || p.AssigneeShared {
		t.Fatal("assignee should be user")
	}
	p, err := s.UpdateItem(p.ID, Patch{AssigneeShared: b(true)})
	if err != nil {
		t.Fatal(err)
	}
	if p.AssigneeID != nil || !p.AssigneeShared {
		t.Fatal("assignee should be shared")
	}
	p, _ = s.UpdateItem(p.ID, Patch{ClearAssignee: true})
	if p.AssigneeID != nil || p.AssigneeShared {
		t.Fatal("assignee should be cleared")
	}
}

func TestStatusHistoryAndClosedAt(t *testing.T) {
	s := openTest(t)
	p := mustCreate(t, s, TypeProject, Patch{Title: str("P"), Status: str(StatusBacklog)})
	if p.ClosedAt != nil {
		t.Fatal("not closed yet")
	}
	p, _ = s.UpdateItem(p.ID, Patch{Status: str(StatusInProgress)})
	p, _ = s.UpdateItem(p.ID, Patch{Title: str("renamed")}) // no status change
	p, _ = s.UpdateItem(p.ID, Patch{Status: str(StatusDone)})
	if p.ClosedAt == nil {
		t.Fatal("expected closed_at")
	}
	h, err := s.History(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(h) != 3 || h[0].Status != StatusBacklog || h[1].Status != StatusInProgress || h[2].Status != StatusDone {
		t.Fatalf("history: %+v", h)
	}
	if h[2].ChangedAt != *p.ClosedAt {
		t.Fatal("closed_at should match last history entry")
	}
	p, _ = s.UpdateItem(p.ID, Patch{Status: str(StatusTodo)})
	if p.ClosedAt != nil {
		t.Fatal("reopened item should not have closed_at")
	}
}

func TestSoftDeleteCascadesAndHides(t *testing.T) {
	s := openTest(t)
	p := mustCreate(t, s, TypeProject, Patch{Title: str("P")})
	tk := mustCreate(t, s, TypeTask, Patch{Title: str("T"), ParentID: i64(p.ID)})
	if err := s.DeleteItem(p.ID); err != nil {
		t.Fatal(err)
	}
	for _, id := range []int64{p.ID, tk.ID} {
		if _, err := s.GetItem(id); !errors.Is(err, ErrNotFound) {
			t.Fatalf("item %d should be hidden, got %v", id, err)
		}
	}
	items, _ := s.ListItems()
	if len(items) != 0 {
		t.Fatalf("expected no items, got %d", len(items))
	}
	if err := s.DeleteItem(p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("double delete should be not found")
	}
	// Row still exists in the DB.
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM items`).Scan(&n)
	if n != 2 {
		t.Fatalf("rows should remain, got %d", n)
	}
	// Cannot parent a new task under a deleted project.
	_, err := s.CreateItem(NewItem{Type: TypeTask, Patch: Patch{Title: str("x"), ParentID: i64(p.ID)}})
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestReorder(t *testing.T) {
	s := openTest(t)
	a := mustCreate(t, s, TypeOngoing, Patch{Title: str("a")})
	bb := mustCreate(t, s, TypeOngoing, Patch{Title: str("b")})
	c := mustCreate(t, s, TypeOngoing, Patch{Title: str("c")})
	p := mustCreate(t, s, TypeProject, Patch{Title: str("p")})
	t1 := mustCreate(t, s, TypeTask, Patch{Title: str("t1"), ParentID: i64(p.ID)})
	t2 := mustCreate(t, s, TypeTask, Patch{Title: str("t2"), ParentID: i64(p.ID)})

	if err := s.Reorder([]int64{c.ID, a.ID}); err != nil {
		t.Fatal(err)
	}
	items, _ := s.ListItems()
	var top []string
	for _, it := range items {
		if it.ParentID == nil {
			top = append(top, it.Title)
		}
	}
	if got := top[0] + top[1] + top[2] + top[3]; got != "cabp" {
		t.Fatalf("order: %v", top)
	}
	_ = bb
	if err := s.Reorder([]int64{t1.ID, a.ID}); err == nil {
		t.Fatal("mixed parents should fail")
	}
	if err := s.Reorder([]int64{t2.ID, t1.ID}); err != nil {
		t.Fatal(err)
	}
	items, _ = s.ListItems()
	var tasks []string
	for _, it := range items {
		if it.Type == TypeTask {
			tasks = append(tasks, it.Title)
		}
	}
	if tasks[0] != "t2" || tasks[1] != "t1" {
		t.Fatalf("task order: %v", tasks)
	}
}

func TestReparentMovesToEnd(t *testing.T) {
	s := openTest(t)
	p1 := mustCreate(t, s, TypeProject, Patch{Title: str("p1")})
	p2 := mustCreate(t, s, TypeProject, Patch{Title: str("p2")})
	x := mustCreate(t, s, TypeTask, Patch{Title: str("x"), ParentID: i64(p1.ID)})
	mustCreate(t, s, TypeTask, Patch{Title: str("y"), ParentID: i64(p2.ID)})
	x, err := s.UpdateItem(x.ID, Patch{ParentID: i64(p2.ID)})
	if err != nil {
		t.Fatal(err)
	}
	if *x.ParentID != p2.ID || x.SortOrder != 1 {
		t.Fatalf("reparent: %+v", x)
	}
}

func TestUsers(t *testing.T) {
	s := openTest(t)
	u1, err := s.CreateUser("Evan", "")
	if err != nil {
		t.Fatal(err)
	}
	u2, _ := s.CreateUser("Sam", "")
	if u1.Color == "" || u1.Color == u2.Color {
		t.Fatal("auto colours should differ")
	}
	if _, err := s.CreateUser("evan", ""); err == nil {
		t.Fatal("case-insensitive duplicate should fail")
	}
	if _, err := s.CreateUser("Z", "red"); err == nil {
		t.Fatal("bad colour should fail")
	}
	u1, _ = s.UpdateUser(u1.ID, nil, str("#112233"))
	if u1.Color != "#112233" {
		t.Fatal("colour not updated")
	}
	p := mustCreate(t, s, TypeProject, Patch{Title: str("p"), OwnerID: i64(u1.ID)})
	if err := s.DeleteUser(u1.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected conflict, got %v", err)
	}
	s.DeleteItem(p.ID)
	if err := s.DeleteUser(u1.ID); err != nil {
		t.Fatalf("delete after item deleted: %v", err)
	}
	us, _ := s.ListUsers()
	if len(us) != 1 {
		t.Fatalf("expected 1 user, got %d", len(us))
	}
}
