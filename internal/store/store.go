// Package store is the SQLite persistence layer for the planner.
//
// All timestamps are stored as RFC3339 UTC strings. Dates (start/end) are
// stored as YYYY-MM-DD strings with no timezone; interpretation of "today"
// is left to the client.
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Item types.
const (
	TypeOngoing = "ongoing"
	TypeProject = "project"
	TypeTask    = "task"
)

// Statuses (apply to projects and tasks only).
const (
	StatusIdea       = "idea"
	StatusBacklog    = "backlog"
	StatusTodo       = "todo"
	StatusInProgress = "in-progress"
	StatusDone       = "done"
	StatusCancelled  = "cancelled"
)

// Ongoing uses "N" rather than "O" so keys cannot be misread as zeros.
var keyPrefix = map[string]string{TypeOngoing: "N", TypeProject: "P", TypeTask: "T"}

var validStatuses = map[string]bool{
	StatusIdea: true, StatusBacklog: true, StatusTodo: true,
	StatusInProgress: true, StatusDone: true, StatusCancelled: true,
}

// IsClosed reports whether a status counts as closed for UI purposes.
func IsClosed(status string) bool { return status == StatusDone || status == StatusCancelled }

// ValidationError is returned for client-caused failures (HTTP 400/409/404).
type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string { return e.Msg }

func verr(format string, a ...any) error { return &ValidationError{Msg: fmt.Sprintf(format, a...)} }

// ErrNotFound is returned when a row does not exist or is soft-deleted.
var ErrNotFound = errors.New("not found")

// ErrConflict is returned when an operation conflicts with existing data.
var ErrConflict = errors.New("conflict")

type User struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	CreatedAt string `json:"created_at"`
}

// Item is a row of the items table as exposed by the API. Owner and
// Assignee are optional user references.
type Item struct {
	ID          int64   `json:"id"`
	Type        string  `json:"type"`
	Key         string  `json:"key"`
	Num         int64   `json:"num"`
	ParentID    *int64  `json:"parent_id"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	OwnerID     *int64  `json:"owner_id"`
	AssigneeID  *int64  `json:"assignee_id"`
	Status      *string `json:"status"`
	StartDate   *string `json:"start_date"`
	StartFirm   bool    `json:"start_firm"`
	EndDate     *string `json:"end_date"`
	EndFirm     bool    `json:"end_firm"`
	Urgency     *int    `json:"urgency"`
	Importance  *int    `json:"importance"`
	Blocked     bool    `json:"blocked"`
	SortOrder   int64   `json:"sort_order"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
	// ClosedAt is the timestamp the item most recently entered a closed
	// status (done/cancelled), or nil if its current status is not closed.
	ClosedAt *string `json:"closed_at"`
}

type StatusChange struct {
	ID        int64  `json:"id"`
	ItemID    int64  `json:"item_id"`
	Status    string `json:"status"`
	ChangedAt string `json:"changed_at"`
}

// Patch holds optional field updates. A nil pointer means "leave unchanged".
// For nullable fields, Clear* flags set the field to NULL.
type Patch struct {
	ParentID      *int64
	Title         *string
	Description   *string
	OwnerID       *int64
	ClearOwner    bool
	AssigneeID    *int64
	ClearAssignee bool
	Status        *string
	StartDate     *string
	ClearStart    bool
	StartFirm     *bool
	EndDate       *string
	ClearEnd      bool
	EndFirm       *bool
	Urgency       *int
	Importance    *int
	Blocked       *bool
}

type Store struct{ db *sql.DB }

// Open opens (creating if necessary) the SQLite database at path and applies
// the schema.
func Open(path string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite handles one writer at a time; serialise through a single conn to
	// avoid SQLITE_BUSY under concurrent requests.
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

const schema = `
CREATE TABLE IF NOT EXISTS users (
	id         INTEGER PRIMARY KEY,
	name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
	color      TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS key_counters (
	type TEXT PRIMARY KEY,
	next INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
	id              INTEGER PRIMARY KEY,
	type            TEXT NOT NULL CHECK (type IN ('ongoing','project','task')),
	num             INTEGER NOT NULL,
	key             TEXT NOT NULL UNIQUE,
	parent_id       INTEGER REFERENCES items(id),
	title           TEXT NOT NULL,
	description     TEXT NOT NULL DEFAULT '',
	owner_id        INTEGER REFERENCES users(id),
	assignee_id     INTEGER REFERENCES users(id),
	status          TEXT CHECK (status IS NULL OR status IN ('idea','backlog','todo','in-progress','done','cancelled')),
	start_date      TEXT,
	start_firm      INTEGER NOT NULL DEFAULT 0,
	end_date        TEXT,
	end_firm        INTEGER NOT NULL DEFAULT 0,
	urgency         INTEGER CHECK (urgency IS NULL OR (urgency BETWEEN 0 AND 10)),
	importance      INTEGER CHECK (importance IS NULL OR (importance BETWEEN 0 AND 10)),
	blocked         INTEGER NOT NULL DEFAULT 0,
	sort_order      INTEGER NOT NULL DEFAULT 0,
	created_at      TEXT NOT NULL,
	updated_at      TEXT NOT NULL,
	deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS items_parent ON items(parent_id);

CREATE TABLE IF NOT EXISTS settings (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS status_history (
	id         INTEGER PRIMARY KEY,
	item_id    INTEGER NOT NULL REFERENCES items(id),
	status     TEXT NOT NULL,
	changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS status_history_item ON status_history(item_id, id);
`

func (s *Store) migrate() error {
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	// Ongoing keys were originally prefixed "O-"; they are now "N-".
	if _, err := s.db.Exec(`UPDATE items SET key = 'N-' || num WHERE type = 'ongoing' AND key LIKE 'O-%'`); err != nil {
		return err
	}
	// The "Shared" assignee option was removed; drop its column if present
	// (items that used it become unassigned).
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('items') WHERE name = 'assignee_shared'`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		if _, err := s.db.Exec(`ALTER TABLE items DROP COLUMN assignee_shared`); err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------- settings

// SettingDefaults lists every known setting with its default value. Unknown
// keys are rejected by UpdateSettings.
var SettingDefaults = map[string]string{
	"week_start":       "6", // 0 = Sunday ... 6 = Saturday
	"color_ongoing":    "#2a9d8f",
	"color_project":    "#5b6cff",
	"color_task":       "",        // empty = no tint
	"color_unassigned": "#9aa3ad", // matrix points / timeline bars with no assignee
}

// Settings returns all settings with defaults applied.
func (s *Store) Settings() (map[string]string, error) {
	out := make(map[string]string, len(SettingDefaults))
	for k, v := range SettingDefaults {
		out[k] = v
	}
	rows, err := s.db.Query(`SELECT key, value FROM settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		if _, known := SettingDefaults[k]; known {
			out[k] = v
		}
	}
	return out, rows.Err()
}

func validSetting(k, v string) error {
	switch k {
	case "week_start":
		if len(v) != 1 || v[0] < '0' || v[0] > '6' {
			return verr("week_start must be 0-6")
		}
	case "color_ongoing", "color_project", "color_task", "color_unassigned":
		if v != "" && !validColor(v) {
			return verr("%s must be a #rrggbb hex string or empty", k)
		}
	default:
		return verr("unknown setting %q", k)
	}
	return nil
}

// UpdateSettings stores the given values and returns the full settings.
func (s *Store) UpdateSettings(vals map[string]string) (map[string]string, error) {
	for k, v := range vals {
		if err := validSetting(k, v); err != nil {
			return nil, err
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for k, v := range vals {
		if _, err := tx.Exec(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, k, v); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.Settings()
}

func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }

// ---------------------------------------------------------------- users

// Palette used for auto-assigned user colours; chosen to be distinguishable
// and readable as a background tint in both light and dark themes.
var palette = []string{
	"#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2",
	"#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
}

func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query(`SELECT id, name, color, created_at FROM users ORDER BY name COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Name, &u.Color, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) GetUser(id int64) (*User, error) {
	var u User
	err := s.db.QueryRow(`SELECT id, name, color, created_at FROM users WHERE id = ?`, id).
		Scan(&u.ID, &u.Name, &u.Color, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &u, err
}

func validColor(c string) bool {
	if len(c) != 7 || c[0] != '#' {
		return false
	}
	for _, r := range c[1:] {
		if !strings.ContainsRune("0123456789abcdefABCDEF", r) {
			return false
		}
	}
	return true
}

// CreateUser creates a user. If color is empty a palette colour is chosen
// that is least used among existing users.
func (s *Store) CreateUser(name, color string) (*User, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, verr("name is required")
	}
	if color == "" {
		var n int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
			return nil, err
		}
		color = palette[n%len(palette)]
	} else if !validColor(color) {
		return nil, verr("color must be a #rrggbb hex string")
	}
	res, err := s.db.Exec(`INSERT INTO users (name, color, created_at) VALUES (?, ?, ?)`, name, color, now())
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return nil, verr("a user named %q already exists", name)
		}
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetUser(id)
}

func (s *Store) UpdateUser(id int64, name, color *string) (*User, error) {
	if _, err := s.GetUser(id); err != nil {
		return nil, err
	}
	if name != nil {
		n := strings.TrimSpace(*name)
		if n == "" {
			return nil, verr("name is required")
		}
		if _, err := s.db.Exec(`UPDATE users SET name = ? WHERE id = ?`, n, id); err != nil {
			if strings.Contains(err.Error(), "UNIQUE") {
				return nil, verr("a user named %q already exists", n)
			}
			return nil, err
		}
	}
	if color != nil {
		if !validColor(*color) {
			return nil, verr("color must be a #rrggbb hex string")
		}
		if _, err := s.db.Exec(`UPDATE users SET color = ? WHERE id = ?`, *color, id); err != nil {
			return nil, err
		}
	}
	return s.GetUser(id)
}

// DeleteUser removes a user. It fails with ErrConflict if any live item
// references the user as owner or assignee.
func (s *Store) DeleteUser(id int64) error {
	if _, err := s.GetUser(id); err != nil {
		return err
	}
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM items WHERE deleted_at IS NULL AND (owner_id = ? OR assignee_id = ?)`, id, id).Scan(&n)
	if err != nil {
		return err
	}
	if n > 0 {
		return fmt.Errorf("%w: user is referenced by %d item(s)", ErrConflict, n)
	}
	// Detach from deleted items so the FK allows removal.
	if _, err := s.db.Exec(`UPDATE items SET owner_id = NULL WHERE owner_id = ?`, id); err != nil {
		return err
	}
	if _, err := s.db.Exec(`UPDATE items SET assignee_id = NULL WHERE assignee_id = ?`, id); err != nil {
		return err
	}
	_, err = s.db.Exec(`DELETE FROM users WHERE id = ?`, id)
	return err
}

// ---------------------------------------------------------------- items

const itemCols = `i.id, i.type, i.key, i.num, i.parent_id, i.title, i.description, i.owner_id,
	i.assignee_id, i.status, i.start_date, i.start_firm, i.end_date, i.end_firm,
	i.urgency, i.importance, i.blocked, i.sort_order, i.created_at, i.updated_at,
	CASE WHEN i.status IN ('done','cancelled') THEN
		(SELECT h.changed_at FROM status_history h WHERE h.item_id = i.id ORDER BY h.id DESC LIMIT 1)
	END AS closed_at`

type scanner interface{ Scan(dest ...any) error }

func scanItem(r scanner) (*Item, error) {
	var it Item
	var sfirm, efirm, blocked int
	err := r.Scan(&it.ID, &it.Type, &it.Key, &it.Num, &it.ParentID, &it.Title, &it.Description, &it.OwnerID,
		&it.AssigneeID, &it.Status, &it.StartDate, &sfirm, &it.EndDate, &efirm,
		&it.Urgency, &it.Importance, &blocked, &it.SortOrder, &it.CreatedAt, &it.UpdatedAt, &it.ClosedAt)
	if err != nil {
		return nil, err
	}
	it.StartFirm = sfirm != 0
	it.EndFirm = efirm != 0
	it.Blocked = blocked != 0
	return &it, nil
}

// ListItems returns all non-deleted items ordered by (parent, sort_order, id).
func (s *Store) ListItems() ([]Item, error) {
	rows, err := s.db.Query(`SELECT ` + itemCols + ` FROM items i WHERE i.deleted_at IS NULL
		ORDER BY i.parent_id IS NOT NULL, i.parent_id, i.sort_order, i.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Item{}
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *it)
	}
	return out, rows.Err()
}

func (s *Store) GetItem(id int64) (*Item, error) {
	it, err := scanItem(s.db.QueryRow(`SELECT `+itemCols+` FROM items i WHERE i.id = ? AND i.deleted_at IS NULL`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return it, err
}

func validDate(d string) bool {
	_, err := time.Parse("2006-01-02", d)
	return err == nil
}

func (s *Store) userExists(id int64) (bool, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, id).Scan(&n)
	return n > 0, err
}

// NewItem is the input for CreateItem.
type NewItem struct {
	Type  string
	Patch Patch
}

// CreateItem creates an item, assigning the next key for its type, placing it
// last among its siblings and recording its initial status in the history.
func (s *Store) CreateItem(in NewItem) (*Item, error) {
	prefix, ok := keyPrefix[in.Type]
	if !ok {
		return nil, verr("type must be one of ongoing, project, task")
	}
	p := in.Patch
	if p.Title == nil || strings.TrimSpace(*p.Title) == "" {
		return nil, verr("title is required")
	}
	// Defaults by type.
	if in.Type == TypeTask {
		if p.Urgency == nil {
			d := 5
			p.Urgency = &d
		}
		if p.Importance == nil {
			d := 5
			p.Importance = &d
		}
	}
	if in.Type != TypeOngoing && p.Status == nil {
		d := StatusTodo
		p.Status = &d
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Validate a provisional item using the shared rules.
	base := &Item{Type: in.Type, Title: ""}
	if err := applyPatch(tx, base, p); err != nil {
		return nil, err
	}

	// Next key.
	var num int64
	err = tx.QueryRow(`SELECT next FROM key_counters WHERE type = ?`, in.Type).Scan(&num)
	if errors.Is(err, sql.ErrNoRows) {
		num = 1
		if _, err := tx.Exec(`INSERT INTO key_counters (type, next) VALUES (?, ?)`, in.Type, 2); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	} else {
		if _, err := tx.Exec(`UPDATE key_counters SET next = next + 1 WHERE type = ?`, in.Type); err != nil {
			return nil, err
		}
	}
	key := fmt.Sprintf("%s-%d", prefix, num)

	// Append to end of sibling group.
	var order int64
	if base.ParentID == nil {
		err = tx.QueryRow(`SELECT COALESCE(MAX(sort_order), -1) + 1 FROM items WHERE parent_id IS NULL`).Scan(&order)
	} else {
		err = tx.QueryRow(`SELECT COALESCE(MAX(sort_order), -1) + 1 FROM items WHERE parent_id = ?`, *base.ParentID).Scan(&order)
	}
	if err != nil {
		return nil, err
	}

	ts := now()
	res, err := tx.Exec(`INSERT INTO items (type, num, key, parent_id, title, description, owner_id, assignee_id,
		status, start_date, start_firm, end_date, end_firm, urgency, importance, blocked,
		sort_order, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		in.Type, num, key, base.ParentID, base.Title, base.Description, base.OwnerID, base.AssigneeID,
		base.Status, base.StartDate, base.StartFirm, base.EndDate, base.EndFirm,
		base.Urgency, base.Importance, base.Blocked, order, ts, ts)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if base.Status != nil {
		if _, err := tx.Exec(`INSERT INTO status_history (item_id, status, changed_at) VALUES (?,?,?)`, id, *base.Status, ts); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetItem(id)
}

// applyPatch validates p against it (which carries Type and current values)
// and mutates it in place. Must be called within tx for FK lookups.
func applyPatch(tx *sql.Tx, it *Item, p Patch) error {
	isTask := it.Type == TypeTask
	isOngoing := it.Type == TypeOngoing

	if p.Title != nil {
		t := strings.TrimSpace(*p.Title)
		if t == "" {
			return verr("title is required")
		}
		if len(t) > 255 {
			return verr("title must be at most 255 characters")
		}
		it.Title = t
	}
	if p.Description != nil {
		it.Description = *p.Description
	}
	if p.ParentID != nil {
		if !isTask {
			return verr("only tasks may have a parent")
		}
		var ptype string
		err := tx.QueryRow(`SELECT type FROM items WHERE id = ? AND deleted_at IS NULL`, *p.ParentID).Scan(&ptype)
		if errors.Is(err, sql.ErrNoRows) {
			return verr("parent %d does not exist", *p.ParentID)
		} else if err != nil {
			return err
		}
		if ptype == TypeTask {
			return verr("a task cannot be the parent of a task")
		}
		it.ParentID = p.ParentID
	}
	if isTask && it.ParentID == nil {
		return verr("a task must have a parent")
	}
	if p.ClearOwner {
		it.OwnerID = nil
	} else if p.OwnerID != nil {
		var n int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, *p.OwnerID).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			return verr("owner %d does not exist", *p.OwnerID)
		}
		it.OwnerID = p.OwnerID
	}
	if p.ClearAssignee {
		it.AssigneeID = nil
	} else if p.AssigneeID != nil {
		var n int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, *p.AssigneeID).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			return verr("assignee %d does not exist", *p.AssigneeID)
		}
		it.AssigneeID = p.AssigneeID
	}
	if p.Status != nil {
		if isOngoing {
			return verr("ongoing items have no status")
		}
		if !validStatuses[*p.Status] {
			return verr("invalid status %q", *p.Status)
		}
		it.Status = p.Status
	}
	if isOngoing {
		if p.StartDate != nil || p.EndDate != nil || p.StartFirm != nil || p.EndFirm != nil {
			return verr("ongoing items have no dates")
		}
	} else {
		if p.ClearStart {
			it.StartDate, it.StartFirm = nil, false
		} else if p.StartDate != nil {
			if !validDate(*p.StartDate) {
				return verr("start_date must be YYYY-MM-DD")
			}
			it.StartDate = p.StartDate
		}
		if p.StartFirm != nil {
			it.StartFirm = *p.StartFirm
		}
		if p.ClearEnd {
			it.EndDate, it.EndFirm = nil, false
		} else if p.EndDate != nil {
			if !validDate(*p.EndDate) {
				return verr("end_date must be YYYY-MM-DD")
			}
			it.EndDate = p.EndDate
		}
		if p.EndFirm != nil {
			it.EndFirm = *p.EndFirm
		}
	}
	if !isTask {
		if p.Urgency != nil || p.Importance != nil || p.Blocked != nil {
			return verr("only tasks have urgency, importance and blocked")
		}
	} else {
		if p.Urgency != nil {
			if *p.Urgency < 0 || *p.Urgency > 10 {
				return verr("urgency must be 0-10")
			}
			it.Urgency = p.Urgency
		}
		if p.Importance != nil {
			if *p.Importance < 0 || *p.Importance > 10 {
				return verr("importance must be 0-10")
			}
			it.Importance = p.Importance
		}
		if p.Blocked != nil {
			it.Blocked = *p.Blocked
		}
	}
	return nil
}

// UpdateItem applies p to the item. A status change appends to the history.
// Reparenting moves the item to the end of the new sibling group.
func (s *Store) UpdateItem(id int64, p Patch) (*Item, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	cur, err := scanItem(tx.QueryRow(`SELECT `+itemCols+` FROM items i WHERE i.id = ? AND i.deleted_at IS NULL`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	oldStatus := cur.Status
	oldParent := cur.ParentID
	if err := applyPatch(tx, cur, p); err != nil {
		return nil, err
	}
	order := cur.SortOrder
	if p.ParentID != nil && (oldParent == nil || *oldParent != *p.ParentID) {
		if err := tx.QueryRow(`SELECT COALESCE(MAX(sort_order), -1) + 1 FROM items WHERE parent_id = ?`, *p.ParentID).Scan(&order); err != nil {
			return nil, err
		}
	}
	ts := now()
	_, err = tx.Exec(`UPDATE items SET parent_id=?, title=?, description=?, owner_id=?, assignee_id=?,
		status=?, start_date=?, start_firm=?, end_date=?, end_firm=?, urgency=?, importance=?, blocked=?,
		sort_order=?, updated_at=? WHERE id = ?`,
		cur.ParentID, cur.Title, cur.Description, cur.OwnerID, cur.AssigneeID,
		cur.Status, cur.StartDate, cur.StartFirm, cur.EndDate, cur.EndFirm, cur.Urgency, cur.Importance, cur.Blocked,
		order, ts, id)
	if err != nil {
		return nil, err
	}
	if cur.Status != nil && (oldStatus == nil || *oldStatus != *cur.Status) {
		if _, err := tx.Exec(`INSERT INTO status_history (item_id, status, changed_at) VALUES (?,?,?)`, id, *cur.Status, ts); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetItem(id)
}

// DeleteItem soft-deletes an item and, for parents, all of its live children.
func (s *Store) DeleteItem(id int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	ts := now()
	res, err := tx.Exec(`UPDATE items SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`, ts, ts, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(`UPDATE items SET deleted_at = ?, updated_at = ? WHERE parent_id = ? AND deleted_at IS NULL`, ts, ts, id); err != nil {
		return err
	}
	return tx.Commit()
}

// Reorder sets the relative order of the given items, which must all be live
// siblings (same parent, or all top-level). Siblings not listed keep their
// positions after the listed ones.
func (s *Store) Reorder(ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var parent *int64
	seen := map[int64]bool{}
	for i, id := range ids {
		if seen[id] {
			return verr("duplicate id %d", id)
		}
		seen[id] = true
		var p *int64
		err := tx.QueryRow(`SELECT parent_id FROM items WHERE id = ? AND deleted_at IS NULL`, id).Scan(&p)
		if errors.Is(err, sql.ErrNoRows) {
			return verr("item %d does not exist", id)
		} else if err != nil {
			return err
		}
		if i == 0 {
			parent = p
		} else if (parent == nil) != (p == nil) || (parent != nil && *parent != *p) {
			return verr("items must all share the same parent")
		}
	}
	// Collect the full sibling list in current order, then place listed ids
	// first in the requested order followed by the rest.
	var rows *sql.Rows
	if parent == nil {
		rows, err = tx.Query(`SELECT id FROM items WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY sort_order, id`)
	} else {
		rows, err = tx.Query(`SELECT id FROM items WHERE parent_id = ? AND deleted_at IS NULL ORDER BY sort_order, id`, *parent)
	}
	if err != nil {
		return err
	}
	var rest []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		if !seen[id] {
			rest = append(rest, id)
		}
	}
	rows.Close()
	final := append(append([]int64{}, ids...), rest...)
	for i, id := range final {
		if _, err := tx.Exec(`UPDATE items SET sort_order = ? WHERE id = ?`, i, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// History returns the status history of an item, oldest first.
func (s *Store) History(id int64) ([]StatusChange, error) {
	if _, err := s.GetItem(id); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT id, item_id, status, changed_at FROM status_history WHERE item_id = ? ORDER BY id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StatusChange{}
	for rows.Next() {
		var h StatusChange
		if err := rows.Scan(&h.ID, &h.ItemID, &h.Status, &h.ChangedAt); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}
