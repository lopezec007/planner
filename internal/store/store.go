// Package store is the SQLite persistence layer for the planner.
//
// All timestamps are stored as RFC3339 UTC strings. Dates (start/end) are
// stored as YYYY-MM-DD strings with no timezone; interpretation of "today"
// is left to the client.
package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

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
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
	// Short is the chip label (1-3 characters) shown in the Owner and
	// Assignee columns; it defaults to initials or the start of the name.
	Short     string `json:"short"`
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
	// Color is an Ongoing's or Project's own colour ("#rrggbb"), shared by
	// everyone, or "" to use the type colour from Settings. Tasks have none.
	Color     string `json:"color"`
	SortOrder int64  `json:"sort_order"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	// ClosedAt is the timestamp the item most recently entered a closed
	// status (done/cancelled), or nil if its current status is not closed.
	ClosedAt *string `json:"closed_at"`
	// BlockedBy and Blocks list the live items this one depends on / that
	// depend on it (projects and tasks only).
	BlockedBy []int64 `json:"blocked_by"`
	Blocks    []int64 `json:"blocks"`
	// Attachments lists the live files attached to the item (metadata only;
	// the bytes are served separately).
	Attachments []Attachment `json:"attachments"`
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
	Color         *string // "" clears it
}

type Store struct {
	db *sql.DB
	// LastBackup is the path of the copy taken before migrating an existing
	// database on Open, or "" if none was needed.
	LastBackup string
}

// schemaVersion is stored in PRAGMA user_version. Bump it whenever migrate()
// gains a step; an existing database below it is backed up before migrating.
const schemaVersion = 5

// Open opens (creating if necessary) the SQLite database at path and applies
// the schema. An existing database whose schema is behind is first copied to
// "<path>.bak-<timestamp>-v<old version>" with SQLite's own backup (VACUUM
// INTO), so a migration can always be rolled back.
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

	var version, tables int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		db.Close()
		return nil, err
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'`).Scan(&tables); err != nil {
		db.Close()
		return nil, err
	}
	if version < schemaVersion && tables > 0 && path != ":memory:" {
		backup := fmt.Sprintf("%s.bak-%s-v%d", path, time.Now().Format("20060102-150405"), version)
		if _, err := db.Exec(`VACUUM INTO ?`, backup); err != nil {
			db.Close()
			return nil, fmt.Errorf("backup before migration to %s: %w", backup, err)
		}
		s.LastBackup = backup
	}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	if version < schemaVersion {
		if _, err := db.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, schemaVersion)); err != nil {
			db.Close()
			return nil, err
		}
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

const schema = `
CREATE TABLE IF NOT EXISTS users (
	id         INTEGER PRIMARY KEY,
	name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
	color      TEXT NOT NULL,
	short      TEXT NOT NULL DEFAULT '',
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
	color           TEXT NOT NULL DEFAULT '',
	sort_order      INTEGER NOT NULL DEFAULT 0,
	created_at      TEXT NOT NULL,
	updated_at      TEXT NOT NULL,
	deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS items_parent ON items(parent_id);

CREATE TABLE IF NOT EXISTS dependencies (
	blocker_id INTEGER NOT NULL REFERENCES items(id),
	blocked_id INTEGER NOT NULL REFERENCES items(id),
	created_at TEXT NOT NULL,
	PRIMARY KEY (blocker_id, blocked_id),
	CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS dependencies_blocked ON dependencies(blocked_id);

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

CREATE TABLE IF NOT EXISTS user_prefs (
	user_id INTEGER NOT NULL REFERENCES users(id),
	key     TEXT NOT NULL,
	value   TEXT NOT NULL,
	PRIMARY KEY (user_id, key)
);

-- File contents live in the database on purpose: the single SQLite file is
-- the whole of the planner's data.
CREATE TABLE IF NOT EXISTS attachments (
	id           INTEGER PRIMARY KEY,
	item_id      INTEGER NOT NULL REFERENCES items(id),
	name         TEXT NOT NULL,
	content_type TEXT NOT NULL,
	size         INTEGER NOT NULL,
	data         BLOB NOT NULL,
	created_at   TEXT NOT NULL,
	deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS attachments_item ON attachments(item_id);

-- Scratch pad text (schema version 5): one row per scope, "global" for the
-- pane everyone shares and "user:<id>" for a user's own pane.
CREATE TABLE IF NOT EXISTS scratch (
	scope      TEXT PRIMARY KEY,
	text       TEXT NOT NULL DEFAULT '',
	updated_at TEXT NOT NULL
);
`

func (s *Store) migrate() error {
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	// Ongoing keys were originally prefixed "O-"; they are now "N-".
	if _, err := s.db.Exec(`UPDATE items SET key = 'N-' || num WHERE type = 'ongoing' AND key LIKE 'O-%'`); err != nil {
		return err
	}
	// A single urgency/importance ramp ("level_colors") became two.
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO settings (key, value)
		SELECT 'urgency_colors', value FROM settings WHERE key = 'level_colors'
		UNION ALL SELECT 'importance_colors', value FROM settings WHERE key = 'level_colors'`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DELETE FROM settings WHERE key = 'level_colors'`); err != nil {
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
	// Ongoing and Project items gained their own colour (schema version 3).
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('items') WHERE name = 'color'`).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		if _, err := s.db.Exec(`ALTER TABLE items ADD COLUMN color TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}
	// Users gained a chip label (schema version 4); existing users get the
	// default derived from their name.
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('users') WHERE name = 'short'`).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		if _, err := s.db.Exec(`ALTER TABLE users ADD COLUMN short TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}
	rows, err := s.db.Query(`SELECT id, name FROM users WHERE short = ''`)
	if err != nil {
		return err
	}
	type idName struct {
		id   int64
		name string
	}
	var blank []idName
	for rows.Next() {
		var r idName
		if err := rows.Scan(&r.id, &r.name); err != nil {
			rows.Close()
			return err
		}
		blank = append(blank, r)
	}
	rows.Close()
	for _, r := range blank {
		if _, err := s.db.Exec(`UPDATE users SET short = ? WHERE id = ?`, defaultShort(r.name), r.id); err != nil {
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
	// End-date highlighting: a "warn" level and a stronger "alert" level, each
	// with a colour and a window (end dates within date_*_days calendar days of
	// today, where 0 means today or overdue and -1 disables the rule).
	"hl_warn_color":   "#f5a524",
	"hl_alert_color":  "#e5484d",
	"date_warn_days":  "7",
	"date_alert_days": "0",
	// Urgency and importance colour ramps: JSON arrays of 11 entries (values
	// 0-10), each "#rrggbb" or "" for no highlight.
	"urgency_colors":    DefaultRamp,
	"importance_colors": DefaultRamp,
}

// LevelCount is the number of urgency/importance values (0-10).
const LevelCount = 11

// DefaultRamp highlights 6-8 in the warn colour and 9-10 in the alert colour.
const DefaultRamp = `["","","","","","","#f5a524","#f5a524","#f5a524","#e5484d","#e5484d"]`

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
	case "hl_warn_color", "hl_alert_color":
		if !validColor(v) {
			return verr("%s must be a #rrggbb hex string", k)
		}
	case "urgency_colors", "importance_colors":
		var cols []string
		if err := json.Unmarshal([]byte(v), &cols); err != nil || len(cols) != LevelCount {
			return verr("%s must be a JSON array of %d colours", k, LevelCount)
		}
		for _, c := range cols {
			if c != "" && !validColor(c) {
				return verr("%s entries must be #rrggbb or empty", k)
			}
		}
	case "date_warn_days", "date_alert_days":
		if n, err := strconv.Atoi(v); err != nil || n < -1 || n > 365 {
			return verr("%s must be -1 to 365 (-1 disables it)", k)
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

// ---------------------------------------------------------------- user prefs

// PrefDefaults lists every known per-user preference with its default value.
// Unknown keys are rejected by UpdateUserPrefs.
var PrefDefaults = map[string]string{
	"view":         "table", // table | timeline | matrix
	"narrow":       "0",
	"flat":         "0",
	"collapsed":    "[]", // JSON array of collapsed parent item ids
	"sort":         "[]", // JSON array of {"key": ..., "dir": "asc"|"desc"}
	"blocked_last": "0",
	"bar_color":    "assignee", // assignee | owner | importance | urgency | combo | parent
	"hidden_cols":  "[]",       // JSON array of hidden table columns (see validColumns)
	// Colour-coding by Ongoing/Project (the items' own colours are shared;
	// whether and where they show is per user):
	"parent_colors": "custom",   // custom: a parent row shows its own colour when set | type: always the type colour
	"task_colors":   "type",     // type: task rows take the Task tint from Settings | parent: their Ongoing/Project colour
	"point_color":   "assignee", // Matrix points: assignee | owner | parent
	// The Filters panel criteria, as JSON (see validFilters), or "" for the
	// default Active template. The search text is not kept.
	"filters": "",
	// Matrix point labels: the task key or its title.
	"matrix_labels": "key", // key | title
	// The scratch pad panel (see static/js/scratch.js): whether it is open,
	// its width in px, the height of the global pane as a percentage of the
	// panel, and whether lines wrap.
	"scratch_open":  "0",
	"scratch_width": "320",
	"scratch_split": "50",
	"scratch_wrap":  "1",
}

// MaxCollapsed caps the number of ids kept in the "collapsed" preference.
const MaxCollapsed = 10000

// MaxSortKeys caps the number of entries in the "sort" preference.
const MaxSortKeys = 12

// validColumns are the table columns that can be hidden (title and the
// action buttons always show).
var validColumns = map[string]bool{
	"key": true, "parent": true, "status": true, "owner": true, "assignee": true,
	"start": true, "end": true, "urgency": true, "importance": true, "blocked": true,
}

var validSortKeys = map[string]bool{
	"parent": true, "key": true, "title": true, "status": true, "owner": true, "assignee": true,
	"start": true, "end": true, "urgency": true, "importance": true, "blocked": true,
}

func oneOf(v string, opts ...string) bool {
	for _, o := range opts {
		if v == o {
			return true
		}
	}
	return false
}

func validPref(k, v string) error {
	switch k {
	case "view":
		if !oneOf(v, "table", "timeline", "matrix") {
			return verr("view must be one of table, timeline, matrix")
		}
	case "narrow", "flat", "blocked_last", "scratch_open", "scratch_wrap":
		if v != "0" && v != "1" {
			return verr("%s must be \"0\" or \"1\"", k)
		}
	case "matrix_labels":
		if !oneOf(v, "key", "title") {
			return verr("matrix_labels must be key or title")
		}
	case "scratch_width":
		if n, err := strconv.Atoi(v); err != nil || n < 160 || n > 2000 {
			return verr("scratch_width must be an integer between 160 and 2000")
		}
	case "scratch_split":
		if n, err := strconv.Atoi(v); err != nil || n < 5 || n > 95 {
			return verr("scratch_split must be an integer between 5 and 95")
		}
	case "collapsed":
		var ids []int64
		if err := json.Unmarshal([]byte(v), &ids); err != nil {
			return verr("collapsed must be a JSON array of integers")
		}
		if len(ids) > MaxCollapsed {
			return verr("collapsed may hold at most %d ids", MaxCollapsed)
		}
	case "sort":
		var keys []struct {
			Key string `json:"key"`
			Dir string `json:"dir"`
		}
		dec := json.NewDecoder(strings.NewReader(v))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&keys); err != nil || dec.More() {
			return verr(`sort must be a JSON array of {"key": ..., "dir": "asc"|"desc"}`)
		}
		if len(keys) > MaxSortKeys {
			return verr("sort may hold at most %d entries", MaxSortKeys)
		}
		for _, sk := range keys {
			if !validSortKeys[sk.Key] {
				return verr("unknown sort key %q", sk.Key)
			}
			if sk.Dir != "asc" && sk.Dir != "desc" {
				return verr("sort dir must be asc or desc")
			}
		}
	case "hidden_cols":
		var cols []string
		if err := json.Unmarshal([]byte(v), &cols); err != nil {
			return verr("hidden_cols must be a JSON array of column names")
		}
		for _, c := range cols {
			if !validColumns[c] {
				return verr("unknown column %q", c)
			}
		}
	case "bar_color":
		if !oneOf(v, "assignee", "owner", "importance", "urgency", "combo", "parent") {
			return verr("bar_color must be one of assignee, owner, importance, urgency, combo, parent")
		}
	case "parent_colors":
		if !oneOf(v, "custom", "type") {
			return verr("parent_colors must be custom or type")
		}
	case "task_colors":
		if !oneOf(v, "type", "parent") {
			return verr("task_colors must be type or parent")
		}
	case "point_color":
		if !oneOf(v, "assignee", "owner", "parent") {
			return verr("point_color must be one of assignee, owner, parent")
		}
	case "filters":
		if v != "" {
			return validFilters(v)
		}
	default:
		return verr("unknown preference %q", k)
	}
	return nil
}

// validFilters checks the "filters" preference: a JSON object with the
// Filters panel criteria.
func validFilters(v string) error {
	var f struct {
		Types            []string `json:"types"`
		Statuses         []string `json:"statuses"`
		RecentDays       int      `json:"recent_days"`
		HideEmptyParents bool     `json:"hide_empty_parents"`
		Owner            string   `json:"owner"`
		Assignee         string   `json:"assignee"`
		Blocked          string   `json:"blocked"`
		EndAfter         string   `json:"end_after"`
		EndBefore        string   `json:"end_before"`
	}
	dec := json.NewDecoder(strings.NewReader(v))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&f); err != nil || dec.More() {
		return verr("filters must be a JSON object of filter criteria")
	}
	for _, t := range f.Types {
		if _, ok := keyPrefix[t]; !ok {
			return verr("filters: unknown type %q", t)
		}
	}
	for _, st := range f.Statuses {
		if !validStatuses[st] {
			return verr("filters: unknown status %q", st)
		}
	}
	if f.RecentDays < 0 || f.RecentDays > 365 {
		return verr("filters: recent_days must be 0 to 365")
	}
	isUserRef := func(v string) bool {
		if v == "" || v == "none" {
			return true
		}
		_, err := strconv.ParseInt(v, 10, 64)
		return err == nil
	}
	if !isUserRef(f.Owner) || !isUserRef(f.Assignee) {
		return verr("filters: owner and assignee must be \"\", \"none\" or a user id")
	}
	if !oneOf(f.Blocked, "", "yes", "no") {
		return verr("filters: blocked must be \"\", yes or no")
	}
	for _, d := range []string{f.EndAfter, f.EndBefore} {
		if d != "" && !validDate(d) {
			return verr("filters: end dates must be YYYY-MM-DD")
		}
	}
	return nil
}

// UserPrefs returns the user's preferences with defaults applied.
func (s *Store) UserPrefs(userID int64) (map[string]string, error) {
	if _, err := s.GetUser(userID); err != nil {
		return nil, err
	}
	out := make(map[string]string, len(PrefDefaults))
	for k, v := range PrefDefaults {
		out[k] = v
	}
	rows, err := s.db.Query(`SELECT key, value FROM user_prefs WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		if _, known := PrefDefaults[k]; known {
			out[k] = v
		}
	}
	return out, rows.Err()
}

// UpdateUserPrefs stores the given values for the user and returns the full
// preference map. Every value is validated before anything is written.
func (s *Store) UpdateUserPrefs(userID int64, vals map[string]string) (map[string]string, error) {
	if _, err := s.GetUser(userID); err != nil {
		return nil, err
	}
	for k, v := range vals {
		if err := validPref(k, v); err != nil {
			return nil, err
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for k, v := range vals {
		if _, err := tx.Exec(`INSERT INTO user_prefs (user_id, key, value) VALUES (?, ?, ?)
			ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`, userID, k, v); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.UserPrefs(userID)
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
	rows, err := s.db.Query(`SELECT id, name, color, short, created_at FROM users ORDER BY name COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Name, &u.Color, &u.Short, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) GetUser(id int64) (*User, error) {
	var u User
	err := s.db.QueryRow(`SELECT id, name, color, short, created_at FROM users WHERE id = ?`, id).
		Scan(&u.ID, &u.Name, &u.Color, &u.Short, &u.CreatedAt)
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

// MaxShort is the length of a user's chip label in characters.
const MaxShort = 3

// defaultShort derives a chip label from a name: the initials of a
// multi-word name (up to MaxShort), else the first MaxShort characters.
func defaultShort(name string) string {
	words := strings.Fields(name)
	if len(words) >= 2 {
		var b strings.Builder
		for i, w := range words {
			if i == MaxShort {
				break
			}
			r, _ := utf8.DecodeRuneInString(w)
			b.WriteString(strings.ToUpper(string(r)))
		}
		return b.String()
	}
	rs := []rune(name)
	if len(rs) > MaxShort {
		rs = rs[:MaxShort]
	}
	return string(rs)
}

func validShort(v string) error {
	n := utf8.RuneCountInString(v)
	if n == 0 || n > MaxShort {
		return verr("short must be 1 to %d characters", MaxShort)
	}
	return nil
}

// CreateUser creates a user. If color is empty a palette colour is chosen
// that is least used among existing users; if short is empty the chip label
// is derived from the name.
func (s *Store) CreateUser(name, color, short string) (*User, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, verr("name is required")
	}
	short = strings.TrimSpace(short)
	if short == "" {
		short = defaultShort(name)
	} else if err := validShort(short); err != nil {
		return nil, err
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
	res, err := s.db.Exec(`INSERT INTO users (name, color, short, created_at) VALUES (?, ?, ?, ?)`, name, color, short, now())
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return nil, verr("a user named %q already exists", name)
		}
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetUser(id)
}

func (s *Store) UpdateUser(id int64, name, color, short *string) (*User, error) {
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
	if short != nil {
		v := strings.TrimSpace(*short)
		if err := validShort(v); err != nil {
			return nil, err
		}
		if _, err := s.db.Exec(`UPDATE users SET short = ? WHERE id = ?`, v, id); err != nil {
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
	if _, err := s.db.Exec(`DELETE FROM user_prefs WHERE user_id = ?`, id); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DELETE FROM scratch WHERE scope = ?`, UserScratchScope(id)); err != nil {
		return err
	}
	_, err = s.db.Exec(`DELETE FROM users WHERE id = ?`, id)
	return err
}

// ---------------------------------------------------------------- items

const itemCols = `i.id, i.type, i.key, i.num, i.parent_id, i.title, i.description, i.owner_id,
	i.assignee_id, i.status, i.start_date, i.start_firm, i.end_date, i.end_firm,
	i.urgency, i.importance, i.blocked, i.color, i.sort_order, i.created_at, i.updated_at,
	CASE WHEN i.status IN ('done','cancelled') THEN
		(SELECT h.changed_at FROM status_history h WHERE h.item_id = i.id ORDER BY h.id DESC LIMIT 1)
	END AS closed_at`

type scanner interface{ Scan(dest ...any) error }

func scanItem(r scanner) (*Item, error) {
	var it Item
	var sfirm, efirm, blocked int
	err := r.Scan(&it.ID, &it.Type, &it.Key, &it.Num, &it.ParentID, &it.Title, &it.Description, &it.OwnerID,
		&it.AssigneeID, &it.Status, &it.StartDate, &sfirm, &it.EndDate, &efirm,
		&it.Urgency, &it.Importance, &blocked, &it.Color, &it.SortOrder, &it.CreatedAt, &it.UpdatedAt, &it.ClosedAt)
	if err != nil {
		return nil, err
	}
	it.StartFirm = sfirm != 0
	it.EndFirm = efirm != 0
	it.Blocked = blocked != 0
	it.BlockedBy = []int64{}
	it.Blocks = []int64{}
	it.Attachments = []Attachment{}
	return &it, nil
}

// fillDeps attaches dependency ids (between live items only) to the items.
func (s *Store) fillDeps(items map[int64]*Item) error {
	rows, err := s.db.Query(`SELECT d.blocker_id, d.blocked_id FROM dependencies d
		JOIN items a ON a.id = d.blocker_id AND a.deleted_at IS NULL
		JOIN items b ON b.id = d.blocked_id AND b.deleted_at IS NULL
		ORDER BY d.created_at, d.blocker_id, d.blocked_id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var a, b int64
		if err := rows.Scan(&a, &b); err != nil {
			return err
		}
		if it, ok := items[a]; ok {
			it.Blocks = append(it.Blocks, b)
		}
		if it, ok := items[b]; ok {
			it.BlockedBy = append(it.BlockedBy, a)
		}
	}
	return rows.Err()
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	byID := make(map[int64]*Item, len(out))
	for i := range out {
		byID[out[i].ID] = &out[i]
	}
	if err := s.fillDeps(byID); err != nil {
		return nil, err
	}
	return out, s.fillAttachments(byID)
}

func (s *Store) GetItem(id int64) (*Item, error) {
	it, err := scanItem(s.db.QueryRow(`SELECT `+itemCols+` FROM items i WHERE i.id = ? AND i.deleted_at IS NULL`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	byID := map[int64]*Item{it.ID: it}
	if err := s.fillDeps(byID); err != nil {
		return nil, err
	}
	return it, s.fillAttachments(byID)
}

// ---------------------------------------------------------------- dependencies

// AddDependency records that blocker blocks blocked. Both must be live
// projects or tasks, distinct, and the edge must not create a cycle (which
// includes the two items blocking each other).
func (s *Store) AddDependency(blocker, blocked int64) error {
	if blocker == blocked {
		return verr("an item cannot block itself")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, id := range []int64{blocker, blocked} {
		var typ string
		err := tx.QueryRow(`SELECT type FROM items WHERE id = ? AND deleted_at IS NULL`, id).Scan(&typ)
		if errors.Is(err, sql.ErrNoRows) {
			return verr("item %d does not exist", id)
		} else if err != nil {
			return err
		}
		if typ == TypeOngoing {
			return verr("ongoing items cannot take part in dependencies")
		}
	}
	// Cycle check: would blocked (transitively) block blocker?
	rows, err := tx.Query(`SELECT d.blocker_id, d.blocked_id FROM dependencies d
		JOIN items a ON a.id = d.blocker_id AND a.deleted_at IS NULL
		JOIN items b ON b.id = d.blocked_id AND b.deleted_at IS NULL`)
	if err != nil {
		return err
	}
	next := map[int64][]int64{}
	for rows.Next() {
		var a, b int64
		if err := rows.Scan(&a, &b); err != nil {
			rows.Close()
			return err
		}
		next[a] = append(next[a], b)
	}
	rows.Close()
	seen := map[int64]bool{blocked: true}
	queue := []int64{blocked}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if cur == blocker {
			return verr("That would create a cycle: the blocked item already blocks the blocker (directly or indirectly)")
		}
		for _, n := range next[cur] {
			if !seen[n] {
				seen[n] = true
				queue = append(queue, n)
			}
		}
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`, blocker, blocked, now()); err != nil {
		return err
	}
	return tx.Commit()
}

// RemoveDependency deletes the edge; it is not an error if it does not exist.
func (s *Store) RemoveDependency(blocker, blocked int64) error {
	_, err := s.db.Exec(`DELETE FROM dependencies WHERE blocker_id = ? AND blocked_id = ?`, blocker, blocked)
	return err
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
		status, start_date, start_firm, end_date, end_firm, urgency, importance, blocked, color,
		sort_order, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		in.Type, num, key, base.ParentID, base.Title, base.Description, base.OwnerID, base.AssigneeID,
		base.Status, base.StartDate, base.StartFirm, base.EndDate, base.EndFirm,
		base.Urgency, base.Importance, base.Blocked, base.Color, order, ts, ts)
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
	if p.Color != nil {
		if isTask {
			return verr("only Ongoing and Project items have a colour")
		}
		if *p.Color != "" && !validColor(*p.Color) {
			return verr("color must be a #rrggbb hex string or empty")
		}
		it.Color = *p.Color
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
		status=?, start_date=?, start_firm=?, end_date=?, end_firm=?, urgency=?, importance=?, blocked=?, color=?,
		sort_order=?, updated_at=? WHERE id = ?`,
		cur.ParentID, cur.Title, cur.Description, cur.OwnerID, cur.AssigneeID,
		cur.Status, cur.StartDate, cur.StartFirm, cur.EndDate, cur.EndFirm, cur.Urgency, cur.Importance, cur.Blocked, cur.Color,
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

// RestoreItem undoes a soft delete of an item and of the children that were
// deleted in the same cascade. Restoring a task whose parent is deleted is
// rejected. Restoring a live item is a no-op.
func (s *Store) RestoreItem(id int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var deletedAt sql.NullString
	var parent *int64
	err = tx.QueryRow(`SELECT deleted_at, parent_id FROM items WHERE id = ?`, id).Scan(&deletedAt, &parent)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if !deletedAt.Valid {
		return nil
	}
	if parent != nil {
		var parentDeleted sql.NullString
		if err := tx.QueryRow(`SELECT deleted_at FROM items WHERE id = ?`, *parent).Scan(&parentDeleted); err != nil {
			return err
		}
		if parentDeleted.Valid {
			return verr("cannot restore: its parent is deleted")
		}
	}
	ts := now()
	if _, err := tx.Exec(`UPDATE items SET deleted_at = NULL, updated_at = ? WHERE id = ?`, ts, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE items SET deleted_at = NULL, updated_at = ? WHERE parent_id = ? AND deleted_at = ?`, ts, id, deletedAt.String); err != nil {
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

// ---------------------------------------------------------------- attachments

// MaxAttachmentSize is the largest file that can be attached to an item.
const MaxAttachmentSize = 64 << 20

// Attachment is the metadata of a file attached to an item; the bytes are
// fetched separately with GetAttachment.
type Attachment struct {
	ID          int64  `json:"id"`
	ItemID      int64  `json:"item_id"`
	Name        string `json:"name"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
	CreatedAt   string `json:"created_at"`
}

const attachmentCols = `a.id, a.item_id, a.name, a.content_type, a.size, a.created_at`

func scanAttachment(r scanner, extra ...any) (*Attachment, error) {
	var a Attachment
	dest := append([]any{&a.ID, &a.ItemID, &a.Name, &a.ContentType, &a.Size, &a.CreatedAt}, extra...)
	if err := r.Scan(dest...); err != nil {
		return nil, err
	}
	return &a, nil
}

// fillAttachments attaches live attachment metadata to the items, oldest
// first. A single item is looked up directly; a set is filled from one scan.
func (s *Store) fillAttachments(items map[int64]*Item) error {
	q := `SELECT ` + attachmentCols + ` FROM attachments a WHERE a.deleted_at IS NULL`
	var args []any
	if len(items) == 1 {
		for id := range items {
			q += ` AND a.item_id = ?`
			args = append(args, id)
		}
	}
	rows, err := s.db.Query(q+` ORDER BY a.id`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		a, err := scanAttachment(rows)
		if err != nil {
			return err
		}
		if it, ok := items[a.ItemID]; ok {
			it.Attachments = append(it.Attachments, *a)
		}
	}
	return rows.Err()
}

// baseName strips any directory components (either separator) from a file
// name supplied by a client.
func baseName(name string) string {
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	return strings.TrimSpace(name)
}

func itemLive(q scanner) error {
	var n int
	if err := q.Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// CheckAttachment applies the validation AddAttachment performs on a file's
// name and size, returning the stored form of the name (its base name,
// trimmed). Callers with several files use it to reject the whole batch
// before anything is stored.
func CheckAttachment(name string, size int) (string, error) {
	name = baseName(strings.TrimSpace(name))
	if name == "" {
		return "", verr("file name is required")
	}
	if len(name) > 255 {
		return "", verr("file name must be at most 255 characters")
	}
	if size == 0 {
		return "", verr("empty file: %s", name)
	}
	if size > MaxAttachmentSize {
		return "", verr("file is larger than the %d MiB limit", MaxAttachmentSize>>20)
	}
	return name, nil
}

// GetAttachmentMeta returns an attachment's metadata without its bytes,
// under the same visibility rules as GetAttachment.
func (s *Store) GetAttachmentMeta(id int64) (*Attachment, error) {
	a, err := scanAttachment(s.db.QueryRow(`SELECT `+attachmentCols+` FROM attachments a
		JOIN items i ON i.id = a.item_id AND i.deleted_at IS NULL
		WHERE a.id = ? AND a.deleted_at IS NULL`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}

// AddAttachment stores data as a file attached to a live item. Only the base
// name of name is kept; an empty contentType is stored as
// application/octet-stream.
func (s *Store) AddAttachment(itemID int64, name, contentType string, data []byte) (*Attachment, error) {
	name, err := CheckAttachment(name, len(data))
	if err != nil {
		return nil, err
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := itemLive(tx.QueryRow(`SELECT COUNT(*) FROM items WHERE id = ? AND deleted_at IS NULL`, itemID)); err != nil {
		return nil, err
	}
	res, err := tx.Exec(`INSERT INTO attachments (item_id, name, content_type, size, data, created_at) VALUES (?,?,?,?,?,?)`,
		itemID, name, contentType, len(data), data, now())
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	a, err := scanAttachment(tx.QueryRow(`SELECT `+attachmentCols+` FROM attachments a WHERE a.id = ?`, id))
	if err != nil {
		return nil, err
	}
	return a, tx.Commit()
}

// GetAttachment returns an attachment's metadata and bytes. Soft-deleted
// attachments and attachments of soft-deleted items are not found.
func (s *Store) GetAttachment(id int64) (*Attachment, []byte, error) {
	var data []byte
	a, err := scanAttachment(s.db.QueryRow(`SELECT `+attachmentCols+`, a.data FROM attachments a
		JOIN items i ON i.id = a.item_id AND i.deleted_at IS NULL
		WHERE a.id = ? AND a.deleted_at IS NULL`, id), &data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	return a, data, nil
}

// ListAttachments returns the live attachments of a live item, oldest first.
func (s *Store) ListAttachments(itemID int64) ([]Attachment, error) {
	if err := itemLive(s.db.QueryRow(`SELECT COUNT(*) FROM items WHERE id = ? AND deleted_at IS NULL`, itemID)); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT `+attachmentCols+` FROM attachments a WHERE a.item_id = ? AND a.deleted_at IS NULL ORDER BY a.id`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Attachment{}
	for rows.Next() {
		a, err := scanAttachment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// DeleteAttachment soft-deletes an attachment.
func (s *Store) DeleteAttachment(id int64) error {
	res, err := s.db.Exec(`UPDATE attachments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`, now(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// RestoreAttachment undoes a soft delete. Restoring an attachment whose item
// is deleted is rejected; restoring a live attachment is a no-op.
func (s *Store) RestoreAttachment(id int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var deletedAt, itemDeleted sql.NullString
	err = tx.QueryRow(`SELECT a.deleted_at, i.deleted_at FROM attachments a JOIN items i ON i.id = a.item_id WHERE a.id = ?`, id).
		Scan(&deletedAt, &itemDeleted)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if !deletedAt.Valid {
		return nil
	}
	if itemDeleted.Valid {
		return verr("cannot restore: its item is deleted")
	}
	if _, err := tx.Exec(`UPDATE attachments SET deleted_at = NULL WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}
