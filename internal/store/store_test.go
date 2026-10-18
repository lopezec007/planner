package store

import (
	"errors"
	"path/filepath"
	"strings"
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
	if o1.Key != "N-1" || p1.Key != "P-1" || o2.Key != "N-2" {
		t.Fatalf("keys: %s %s %s", o1.Key, p1.Key, o2.Key)
	}
	if err := s.DeleteItem(o2.ID); err != nil {
		t.Fatal(err)
	}
	o3 := mustCreate(t, s, TypeOngoing, Patch{Title: str("Again")})
	if o3.Key != "N-3" {
		t.Fatalf("expected N-3 after delete, got %s", o3.Key)
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
		{"task with colour", TypeTask, Patch{Title: str("x"), ParentID: i64(o.ID), Color: str("#112233")}},
		{"bad colour", TypeProject, Patch{Title: str("x"), Color: str("red")}},
	}
	for _, c := range cases {
		_, err := s.CreateItem(NewItem{Type: c.typ, Patch: c.p})
		var ve *ValidationError
		if !errors.As(err, &ve) {
			t.Errorf("%s: expected validation error, got %v", c.name, err)
		}
	}
}

func TestItemColor(t *testing.T) {
	s := openTest(t)
	p := mustCreate(t, s, TypeProject, Patch{Title: str("Plain")})
	if p.Color != "" {
		t.Fatalf("new items have no colour of their own, got %q", p.Color)
	}
	p2 := mustCreate(t, s, TypeProject, Patch{Title: str("Teal"), Color: str("#2a9d8f")})
	if p2.Color != "#2a9d8f" {
		t.Fatalf("colour on create: %q", p2.Color)
	}
	p2, err := s.UpdateItem(p2.ID, Patch{Color: str("#AABBCC")})
	if err != nil || p2.Color != "#AABBCC" {
		t.Fatalf("colour update: %q %v", p2.Color, err)
	}
	p2, err = s.UpdateItem(p2.ID, Patch{Color: str("")})
	if err != nil || p2.Color != "" {
		t.Fatalf("colour clear: %q %v", p2.Color, err)
	}
	var ve *ValidationError
	if _, err := s.UpdateItem(p2.ID, Patch{Color: str("#12")}); !errors.As(err, &ve) {
		t.Fatalf("bad colour: %v", err)
	}
	tk := mustCreate(t, s, TypeTask, Patch{Title: str("T"), ParentID: i64(p.ID)})
	if _, err := s.UpdateItem(tk.ID, Patch{Color: str("#112233")}); !errors.As(err, &ve) {
		t.Fatalf("task colour: %v", err)
	}
	items, _ := s.ListItems()
	if items[1].Color != "" || items[0].Title != "Plain" {
		t.Fatalf("list: %+v", items)
	}
}

func TestColorColumnAdded(t *testing.T) {
	s := openTest(t)
	mustCreate(t, s, TypeOngoing, Patch{Title: str("old")})
	if _, err := s.db.Exec(`ALTER TABLE items DROP COLUMN color`); err != nil {
		t.Fatal(err)
	}
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	items, err := s.ListItems()
	if err != nil || len(items) != 1 || items[0].Color != "" {
		t.Fatalf("after adding the column: %+v %v", items, err)
	}
	if _, err := s.UpdateItem(items[0].ID, Patch{Color: str("#123456")}); err != nil {
		t.Fatal(err)
	}
}

func TestAssigneeSetAndClear(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateUser("Evan", "", "")
	p := mustCreate(t, s, TypeProject, Patch{Title: str("P"), AssigneeID: i64(u.ID)})
	if p.AssigneeID == nil || *p.AssigneeID != u.ID {
		t.Fatal("assignee should be user")
	}
	p, _ = s.UpdateItem(p.ID, Patch{ClearAssignee: true})
	if p.AssigneeID != nil {
		t.Fatal("assignee should be cleared")
	}
}

func TestLegacySharedColumnDropped(t *testing.T) {
	s := openTest(t)
	if _, err := s.db.Exec(`ALTER TABLE items ADD COLUMN assignee_shared INTEGER NOT NULL DEFAULT 0`); err != nil {
		t.Fatal(err)
	}
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('items') WHERE name = 'assignee_shared'`).Scan(&n)
	if n != 0 {
		t.Fatal("assignee_shared column should have been dropped")
	}
	mustCreate(t, s, TypeOngoing, Patch{Title: str("still works")})
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
	u1, err := s.CreateUser("Evan", "", "")
	if err != nil {
		t.Fatal(err)
	}
	u2, _ := s.CreateUser("Sam", "", "")
	if u1.Color == "" || u1.Color == u2.Color {
		t.Fatal("auto colours should differ")
	}
	if _, err := s.CreateUser("evan", "", ""); err == nil {
		t.Fatal("case-insensitive duplicate should fail")
	}
	if _, err := s.CreateUser("Z", "red", ""); err == nil {
		t.Fatal("bad colour should fail")
	}
	u1, _ = s.UpdateUser(u1.ID, nil, str("#112233"), nil)
	if u1.Color != "#112233" {
		t.Fatal("colour not updated")
	}
	// Chip labels: derived from the name by default, 1-3 characters when set.
	if u1.Short != "Eva" || u2.Short != "Sam" {
		t.Fatalf("default short labels: %q %q", u1.Short, u2.Short)
	}
	rl, err := s.CreateUser("Robin Lee", "", "")
	if err != nil || rl.Short != "RL" {
		t.Fatalf("initials: %+v %v", rl, err)
	}
	if u, err := s.CreateUser("Émilie Dupont-Smith", "", " éd "); err != nil || u.Short != "éd" {
		t.Fatalf("given short: %+v %v", u, err)
	}
	if _, err := s.CreateUser("Four", "", "FOUR"); err == nil {
		t.Fatal("4-character short should fail")
	}
	u1, err = s.UpdateUser(u1.ID, nil, nil, str("EV"))
	if err != nil || u1.Short != "EV" {
		t.Fatalf("short update: %+v %v", u1, err)
	}
	u1, _ = s.UpdateUser(u1.ID, str("Evan Lopez"), nil, nil)
	if u1.Short != "EV" {
		t.Fatal("renaming must keep the chip label")
	}
	for _, bad := range []string{"", "   ", "ABCD"} {
		var ve *ValidationError
		if _, err := s.UpdateUser(u1.ID, nil, nil, str(bad)); !errors.As(err, &ve) {
			t.Errorf("short %q: expected validation error, got %v", bad, err)
		}
	}
	s.DeleteUser(rl.ID)
	p := mustCreate(t, s, TypeProject, Patch{Title: str("p"), OwnerID: i64(u1.ID)})
	if err := s.DeleteUser(u1.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected conflict, got %v", err)
	}
	s.DeleteItem(p.ID)
	if err := s.DeleteUser(u1.ID); err != nil {
		t.Fatalf("delete after item deleted: %v", err)
	}
	us, _ := s.ListUsers()
	if len(us) != 2 {
		t.Fatalf("expected 2 users, got %d", len(us))
	}
}

func TestShortColumnAdded(t *testing.T) {
	s := openTest(t)
	s.CreateUser("Evan", "", "")
	s.CreateUser("Robin Lee", "", "")
	if _, err := s.db.Exec(`ALTER TABLE users DROP COLUMN short`); err != nil {
		t.Fatal(err)
	}
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	us, _ := s.ListUsers()
	if len(us) != 2 || us[0].Short != "Eva" || us[1].Short != "RL" {
		t.Fatalf("defaults after adding the column: %+v", us)
	}
}

func TestLegacyOngoingKeysMigrate(t *testing.T) {
	s := openTest(t)
	o := mustCreate(t, s, TypeOngoing, Patch{Title: str("Old")})
	if _, err := s.db.Exec(`UPDATE items SET key = 'O-1' WHERE id = ?`, o.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	got, _ := s.GetItem(o.ID)
	if got.Key != "N-1" {
		t.Fatalf("expected migrated key N-1, got %s", got.Key)
	}
}

func TestSettings(t *testing.T) {
	s := openTest(t)
	st, err := s.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if st["week_start"] != "6" || st["color_task"] != "" {
		t.Fatalf("defaults: %v", st)
	}
	st, err = s.UpdateSettings(map[string]string{"week_start": "1", "color_task": "#123456"})
	if err != nil {
		t.Fatal(err)
	}
	if st["week_start"] != "1" || st["color_task"] != "#123456" || st["color_ongoing"] != SettingDefaults["color_ongoing"] {
		t.Fatalf("updated: %v", st)
	}
	for _, bad := range []map[string]string{{"week_start": "7"}, {"color_project": "blue"}, {"nope": "x"}, {"urgency_colors": `["#fff"]`}, {"importance_colors": `["x","","","","","","","","","",""]`}, {"date_alert_days": "x"}, {"hl_warn_color": ""}} {
		var ve *ValidationError
		if _, err := s.UpdateSettings(bad); !errors.As(err, &ve) {
			t.Fatalf("%v: expected validation error, got %v", bad, err)
		}
	}
	st, err = s.UpdateSettings(map[string]string{"urgency_colors": `["#000000","","","","","","","","","","#ffffff"]`})
	if err != nil || st["urgency_colors"] != `["#000000","","","","","","","","","","#ffffff"]` || st["importance_colors"] != DefaultRamp {
		t.Fatalf("ramps: %v %v", st, err)
	}
	// A legacy single ramp is copied to both on migration.
	if _, err := s.db.Exec(`DELETE FROM settings; INSERT INTO settings (key, value) VALUES ('level_colors', '["#111111","","","","","","","","","",""]')`); err != nil {
		t.Fatal(err)
	}
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	st, _ = s.Settings()
	if st["urgency_colors"] != `["#111111","","","","","","","","","",""]` || st["importance_colors"] != st["urgency_colors"] {
		t.Fatalf("legacy ramp migration: %v", st)
	}
	// Clearing a colour restores "no tint".
	st, _ = s.UpdateSettings(map[string]string{"color_task": ""})
	if st["color_task"] != "" {
		t.Fatal("clear failed")
	}
}

func TestDependencies(t *testing.T) {
	s := openTest(t)
	o := mustCreate(t, s, TypeOngoing, Patch{Title: str("bucket")})
	p1 := mustCreate(t, s, TypeProject, Patch{Title: str("p1")})
	p2 := mustCreate(t, s, TypeProject, Patch{Title: str("p2")})
	t1 := mustCreate(t, s, TypeTask, Patch{Title: str("t1"), ParentID: i64(o.ID)})
	t2 := mustCreate(t, s, TypeTask, Patch{Title: str("t2"), ParentID: i64(p1.ID)})

	must := func(a, b int64) {
		t.Helper()
		if err := s.AddDependency(a, b); err != nil {
			t.Fatalf("add %d->%d: %v", a, b, err)
		}
	}
	must(t1.ID, p1.ID) // task blocks project
	must(p1.ID, t2.ID) // project blocks task
	must(p1.ID, p2.ID) // project blocks project
	must(t2.ID, p2.ID) // task blocks project (second blocker of p2)
	must(t1.ID, p1.ID) // duplicate is fine

	var ve *ValidationError
	bad := []struct {
		name string
		a, b int64
	}{
		{"self", t1.ID, t1.ID},
		{"ongoing", o.ID, t1.ID},
		{"mutual", p1.ID, t1.ID},
		{"cycle", p2.ID, t1.ID},
		{"missing", 999, t1.ID},
	}
	for _, c := range bad {
		if err := s.AddDependency(c.a, c.b); !errors.As(err, &ve) {
			t.Errorf("%s: expected validation error, got %v", c.name, err)
		}
	}

	got, _ := s.GetItem(p2.ID)
	if len(got.BlockedBy) != 2 || got.BlockedBy[0] != p1.ID || got.BlockedBy[1] != t2.ID || len(got.Blocks) != 0 {
		t.Fatalf("p2 deps: %+v", got)
	}
	got, _ = s.GetItem(p1.ID)
	if len(got.Blocks) != 2 || len(got.BlockedBy) != 1 {
		t.Fatalf("p1 deps: %+v", got)
	}
	items, _ := s.ListItems()
	for _, it := range items {
		if it.ID == t1.ID && (len(it.Blocks) != 1 || it.Blocks[0] != p1.ID) {
			t.Fatalf("t1 from list: %+v", it)
		}
	}

	// Deleting an item hides its edges; removing an edge is idempotent.
	if err := s.DeleteItem(t2.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = s.GetItem(p2.ID)
	if len(got.BlockedBy) != 1 {
		t.Fatalf("p2 after delete: %+v", got.BlockedBy)
	}
	if err := s.RemoveDependency(p1.ID, p2.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.RemoveDependency(p1.ID, p2.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = s.GetItem(p2.ID)
	if len(got.BlockedBy) != 0 {
		t.Fatalf("p2 after remove: %+v", got.BlockedBy)
	}
	// With the edge gone, the reverse direction is allowed.
	must(p2.ID, p1.ID)
}

func TestRestoreItem(t *testing.T) {
	s := openTest(t)
	p := mustCreate(t, s, TypeProject, Patch{Title: str("P")})
	t1 := mustCreate(t, s, TypeTask, Patch{Title: str("t1"), ParentID: i64(p.ID)})
	t2 := mustCreate(t, s, TypeTask, Patch{Title: str("t2"), ParentID: i64(p.ID)})
	// t2 deleted on its own first, then the project cascades t1.
	if err := s.DeleteItem(t2.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteItem(p.ID); err != nil {
		t.Fatal(err)
	}
	// A task under a deleted parent cannot be restored alone.
	var ve *ValidationError
	if err := s.RestoreItem(t1.ID); !errors.As(err, &ve) {
		t.Fatalf("expected validation error, got %v", err)
	}
	if err := s.RestoreItem(p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetItem(p.ID); err != nil {
		t.Fatal("project should be live")
	}
	if _, err := s.GetItem(t1.ID); err != nil {
		t.Fatal("t1 (same cascade) should be live")
	}
	if _, err := s.GetItem(t2.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("t2 (deleted separately) should stay deleted")
	}
	if err := s.RestoreItem(t2.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.RestoreItem(t2.ID); err != nil {
		t.Fatal("restoring a live item is a no-op")
	}
	if err := s.RestoreItem(999); !errors.Is(err, ErrNotFound) {
		t.Fatal("missing item")
	}
}

func TestBackupBeforeMigration(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "p.db")
	// A fresh database: no backup.
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if s.LastBackup != "" {
		t.Fatalf("fresh database should not be backed up, got %s", s.LastBackup)
	}
	mustCreate(t, s, TypeOngoing, Patch{Title: str("keep me")})
	// Pretend it predates schema versioning.
	if _, err := s.db.Exec(`PRAGMA user_version = 0`); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s2, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	if s2.LastBackup == "" {
		t.Fatal("expected a backup before migrating an old database")
	}
	b, err := Open(s2.LastBackup)
	if err != nil {
		t.Fatalf("backup should be a valid database: %v", err)
	}
	defer b.Close()
	items, _ := b.ListItems()
	if len(items) != 1 || items[0].Title != "keep me" {
		t.Fatalf("backup contents: %+v", items)
	}
	// Up to date now: reopening takes no further backup.
	s2.Close()
	s3, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s3.Close()
	if s3.LastBackup != "" {
		t.Fatalf("no backup expected when up to date, got %s", s3.LastBackup)
	}
}

func TestUserPrefs(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateUser("Evan", "", "")
	prefs, err := s.UserPrefs(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(prefs) != len(PrefDefaults) || prefs["view"] != "table" || prefs["sort"] != "[]" || prefs["bar_color"] != "assignee" {
		t.Fatalf("defaults: %v", prefs)
	}
	prefs, err = s.UpdateUserPrefs(u.ID, map[string]string{
		"view": "timeline", "narrow": "1", "collapsed": "[3, 7]",
		"sort": `[{"key":"end","dir":"asc"},{"key":"title","dir":"desc"}]`, "bar_color": "combo", "hidden_cols": `["owner","urgency"]`,
		"parent_colors": "type", "task_colors": "parent", "point_color": "parent",
		"filters": `{"types":["task"],"statuses":["todo","in-progress"],"recent_days":14,"hide_empty_parents":true,"owner":"3","assignee":"none","blocked":"yes","end_after":"2026-01-01","end_before":""}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if prefs["view"] != "timeline" || prefs["narrow"] != "1" || prefs["collapsed"] != "[3, 7]" || prefs["bar_color"] != "combo" || prefs["flat"] != "0" || prefs["hidden_cols"] != `["owner","urgency"]` ||
		prefs["parent_colors"] != "type" || prefs["task_colors"] != "parent" || prefs["point_color"] != "parent" {
		t.Fatalf("updated: %v", prefs)
	}
	if _, err := s.UpdateUserPrefs(u.ID, map[string]string{"bar_color": "parent", "filters": ""}); err != nil {
		t.Fatalf("bar_color parent / empty filters: %v", err)
	}
	// Upsert replaces, and other keys are untouched.
	prefs, _ = s.UpdateUserPrefs(u.ID, map[string]string{"view": "matrix"})
	if prefs["view"] != "matrix" || prefs["narrow"] != "1" {
		t.Fatalf("second update: %v", prefs)
	}
	bad := []map[string]string{
		{"nope": "x"},
		{"view": "kanban"},
		{"narrow": "yes"},
		{"flat": "2"},
		{"blocked_last": ""},
		{"collapsed": "[1,"},
		{"collapsed": `["a"]`},
		{"collapsed": "[1.5]"},
		{"collapsed": "{}"},
		{"sort": "not json"},
		{"sort": `[{"key":"title"}]`},
		{"sort": `[{"key":"colour","dir":"asc"}]`},
		{"sort": `[{"key":"title","dir":"up"}]`},
		{"sort": `[{"key":"title","dir":"asc","extra":1}]`},
		{"sort": `[` + strings.Repeat(`{"key":"title","dir":"asc"},`, 12) + `{"key":"key","dir":"asc"}]`},
		{"bar_color": "red"},
		{"hidden_cols": "nope"},
		{"hidden_cols": `["title"]`},
		{"parent_colors": "own"},
		{"task_colors": "1"},
		{"point_color": "combo"},
		{"filters": "nope"},
		{"filters": `{"types":["epic"]}`},
		{"filters": `{"statuses":["open"]}`},
		{"filters": `{"recent_days":400}`},
		{"filters": `{"owner":"bob"}`},
		{"filters": `{"blocked":"maybe"}`},
		{"filters": `{"end_after":"tomorrow"}`},
		{"filters": `{"text":"x"}`},
		// One bad key fails the whole batch.
		{"view": "table", "nope": "x"},
	}
	for _, c := range bad {
		var ve *ValidationError
		if _, err := s.UpdateUserPrefs(u.ID, c); !errors.As(err, &ve) {
			t.Errorf("%v: expected validation error, got %v", c, err)
		}
	}
	prefs, _ = s.UserPrefs(u.ID)
	if prefs["view"] != "matrix" {
		t.Fatalf("failed batch should not write: %v", prefs)
	}
	big := make([]string, MaxCollapsed+1)
	for i := range big {
		big[i] = "1"
	}
	var ve *ValidationError
	if _, err := s.UpdateUserPrefs(u.ID, map[string]string{"collapsed": "[" + strings.Join(big, ",") + "]"}); !errors.As(err, &ve) {
		t.Fatalf("oversized collapsed: %v", err)
	}
	if _, err := s.UserPrefs(999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown user: %v", err)
	}
	if _, err := s.UpdateUserPrefs(999, map[string]string{"view": "table"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown user update: %v", err)
	}
	// Prefs go with the user.
	if err := s.DeleteUser(u.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM user_prefs WHERE user_id = ?`, u.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("expected prefs to be removed with the user, %d left", n)
	}
}

func TestAttachments(t *testing.T) {
	s := openTest(t)
	p := mustCreate(t, s, TypeProject, Patch{Title: str("P")})
	png := []byte("\x89PNG\r\n\x1a\n...")
	a, err := s.AddAttachment(p.ID, "  ../../etc/passwd ", "", png)
	if err != nil {
		t.Fatal(err)
	}
	if a.Name != "passwd" || a.ContentType != "application/octet-stream" || a.Size != int64(len(png)) || a.ItemID != p.ID || a.CreatedAt == "" {
		t.Fatalf("attachment: %+v", a)
	}
	b, err := s.AddAttachment(p.ID, `C:\Users\evan\report.pdf`, "application/pdf", []byte("%PDF-1.4"))
	if err != nil {
		t.Fatal(err)
	}
	if b.Name != "report.pdf" || b.ContentType != "application/pdf" {
		t.Fatalf("attachment: %+v", b)
	}

	// Items carry the metadata, oldest first, from both GetItem and ListItems.
	got, _ := s.GetItem(p.ID)
	if len(got.Attachments) != 2 || got.Attachments[0].ID != a.ID || got.Attachments[1].ID != b.ID {
		t.Fatalf("item attachments: %+v", got.Attachments)
	}
	other := mustCreate(t, s, TypeProject, Patch{Title: str("other")})
	items, _ := s.ListItems()
	for _, it := range items {
		switch it.ID {
		case p.ID:
			if len(it.Attachments) != 2 || it.Attachments[1].Name != "report.pdf" {
				t.Fatalf("list attachments: %+v", it.Attachments)
			}
		case other.ID:
			if it.Attachments == nil || len(it.Attachments) != 0 {
				t.Fatalf("other should have an empty, non-nil slice: %#v", it.Attachments)
			}
		}
	}
	list, err := s.ListAttachments(p.ID)
	if err != nil || len(list) != 2 {
		t.Fatalf("list: %v %v", list, err)
	}

	// Bytes come back intact.
	ga, data, err := s.GetAttachment(a.ID)
	if err != nil || ga.Name != "passwd" || string(data) != string(png) {
		t.Fatalf("get: %+v %q %v", ga, data, err)
	}

	// Validation.
	cases := []struct {
		name  string
		item  int64
		fname string
		data  []byte
	}{
		{"empty file", p.ID, "x.txt", nil},
		{"blank name", p.ID, "   ", []byte("x")},
		{"directory only", p.ID, "dir/", []byte("x")},
		{"long name", p.ID, strings.Repeat("a", 256), []byte("x")},
		{"oversize", p.ID, "big.bin", make([]byte, MaxAttachmentSize+1)},
	}
	for _, c := range cases {
		var ve *ValidationError
		if _, err := s.AddAttachment(c.item, c.fname, "", c.data); !errors.As(err, &ve) {
			t.Errorf("%s: expected validation error, got %v", c.name, err)
		}
	}
	if _, err := s.AddAttachment(999, "x.txt", "", []byte("x")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing item: %v", err)
	}
	if _, err := s.ListAttachments(999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("list missing item: %v", err)
	}

	// Delete hides; restore brings back; both idempotent in the documented way.
	if err := s.DeleteAttachment(a.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.GetAttachment(a.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted attachment should be hidden: %v", err)
	}
	if err := s.DeleteAttachment(a.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("double delete: %v", err)
	}
	got, _ = s.GetItem(p.ID)
	if len(got.Attachments) != 1 || got.Attachments[0].ID != b.ID {
		t.Fatalf("after delete: %+v", got.Attachments)
	}
	if err := s.RestoreAttachment(a.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.RestoreAttachment(a.ID); err != nil {
		t.Fatal("restoring a live attachment is a no-op")
	}
	if err := s.RestoreAttachment(999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restore missing: %v", err)
	}
	got, _ = s.GetItem(p.ID)
	if len(got.Attachments) != 2 {
		t.Fatalf("after restore: %+v", got.Attachments)
	}

	// A deleted item hides its attachments and blocks restoring them.
	if err := s.DeleteAttachment(b.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteItem(p.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.GetAttachment(a.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("attachment of deleted item: %v", err)
	}
	if _, err := s.ListAttachments(p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("list of deleted item: %v", err)
	}
	if _, err := s.AddAttachment(p.ID, "x.txt", "", []byte("x")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("add to deleted item: %v", err)
	}
	var ve *ValidationError
	if err := s.RestoreAttachment(b.ID); !errors.As(err, &ve) {
		t.Fatalf("restore under deleted item: %v", err)
	}
	if err := s.RestoreItem(p.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.GetAttachment(a.ID); err != nil {
		t.Fatalf("attachment should be back with its item: %v", err)
	}
}
