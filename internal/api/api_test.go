package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"planner/internal/store"
)

func setup(t *testing.T) *httptest.Server {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	srv := httptest.NewServer(Handler(st))
	t.Cleanup(srv.Close)
	return srv
}

func call(t *testing.T, srv *httptest.Server, method, path string, body any, out any) int {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if s, ok := body.(string); ok {
			buf.WriteString(s)
		} else {
			json.NewEncoder(&buf).Encode(body)
		}
	}
	req, _ := http.NewRequest(method, srv.URL+path, &buf)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil && resp.StatusCode < 300 && resp.StatusCode != 204 {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatalf("decode %s %s: %v", method, path, err)
		}
	}
	return resp.StatusCode
}

func TestItemLifecycle(t *testing.T) {
	srv := setup(t)
	var u map[string]any
	if c := call(t, srv, "POST", "/api/users", map[string]any{"name": "Evan"}, &u); c != 201 {
		t.Fatalf("create user: %d", c)
	}
	var o map[string]any
	if c := call(t, srv, "POST", "/api/items", map[string]any{"type": "ongoing", "title": "Maint"}, &o); c != 201 {
		t.Fatalf("create ongoing: %d", c)
	}
	if o["key"] != "N-1" || o["status"] != nil {
		t.Fatalf("ongoing: %v", o)
	}
	var tk map[string]any
	c := call(t, srv, "POST", "/api/items", map[string]any{
		"type": "task", "title": "Fix roof", "parent_id": o["id"], "owner_id": u["id"], "assignee_id": u["id"],
		"end_date": "2026-11-01", "end_firm": true,
	}, &tk)
	if c != 201 {
		t.Fatalf("create task: %d", c)
	}
	if tk["key"] != "T-1" || tk["urgency"].(float64) != 5 || tk["assignee_id"] == nil || tk["end_firm"] != true {
		t.Fatalf("task: %v", tk)
	}
	id := int64(tk["id"].(float64))
	path := "/api/items/" + jsonNum(id)

	// Patch: clear end date via null, set status.
	var up map[string]any
	if c := call(t, srv, "PATCH", path, `{"end_date": null, "status": "done", "assignee_id": `+jsonNum(int64(u["id"].(float64)))+`}`, &up); c != 200 {
		t.Fatalf("patch: %d", c)
	}
	if up["end_date"] != nil || up["end_firm"] != false || up["status"] != "done" || up["closed_at"] == nil {
		t.Fatalf("patched: %v", up)
	}
	var hist []map[string]any
	call(t, srv, "GET", path+"/history", nil, &hist)
	if len(hist) != 2 || hist[1]["status"] != "done" {
		t.Fatalf("history: %v", hist)
	}

	// Validation errors are 400.
	if c := call(t, srv, "PATCH", path, map[string]any{"urgency": 42}, nil); c != 400 {
		t.Fatalf("expected 400, got %d", c)
	}
	if c := call(t, srv, "PATCH", path, map[string]any{"type": "project"}, nil); c != 400 {
		t.Fatalf("type change should be 400, got %d", c)
	}
	if c := call(t, srv, "PATCH", path, map[string]any{"bogus": 1}, nil); c != 400 {
		t.Fatalf("unknown field should be 400, got %d", c)
	}

	// User referenced -> 409.
	if c := call(t, srv, "DELETE", "/api/users/"+jsonNum(int64(u["id"].(float64))), nil, nil); c != 409 {
		t.Fatalf("expected 409, got %d", c)
	}

	// Delete hides.
	if c := call(t, srv, "DELETE", path, nil, nil); c != 204 {
		t.Fatalf("delete: %d", c)
	}
	if c := call(t, srv, "GET", path, nil, nil); c != 404 {
		t.Fatalf("expected 404 after delete, got %d", c)
	}
	var items []map[string]any
	call(t, srv, "GET", "/api/items", nil, &items)
	if len(items) != 1 {
		t.Fatalf("expected only ongoing, got %d", len(items))
	}
}

func TestReorderEndpoint(t *testing.T) {
	srv := setup(t)
	var a, b map[string]any
	call(t, srv, "POST", "/api/items", map[string]any{"type": "project", "title": "a"}, &a)
	call(t, srv, "POST", "/api/items", map[string]any{"type": "project", "title": "b"}, &b)
	if c := call(t, srv, "PUT", "/api/order", map[string]any{"ids": []any{b["id"], a["id"]}}, nil); c != 204 {
		t.Fatalf("reorder: %d", c)
	}
	var items []map[string]any
	call(t, srv, "GET", "/api/items", nil, &items)
	if items[0]["title"] != "b" {
		t.Fatalf("order: %v", items)
	}
}

func jsonNum(i int64) string {
	b, _ := json.Marshal(i)
	return string(b)
}

func TestSettingsEndpoint(t *testing.T) {
	srv := setup(t)
	var st map[string]string
	if c := call(t, srv, "GET", "/api/settings", nil, &st); c != 200 || st["week_start"] != "6" {
		t.Fatalf("get: %d %v", c, st)
	}
	if c := call(t, srv, "PATCH", "/api/settings", map[string]string{"week_start": "0", "color_ongoing": "#abcdef"}, &st); c != 200 {
		t.Fatalf("patch: %d", c)
	}
	if st["week_start"] != "0" || st["color_ongoing"] != "#abcdef" {
		t.Fatalf("patched: %v", st)
	}
	if c := call(t, srv, "PATCH", "/api/settings", map[string]string{"week_start": "9"}, nil); c != 400 {
		t.Fatalf("expected 400, got %d", c)
	}
}

func TestDependencyEndpoints(t *testing.T) {
	srv := setup(t)
	var a, b map[string]any
	call(t, srv, "POST", "/api/items", map[string]any{"type": "project", "title": "a"}, &a)
	call(t, srv, "POST", "/api/items", map[string]any{"type": "project", "title": "b"}, &b)
	if c := call(t, srv, "POST", "/api/dependencies", map[string]any{"blocker_id": a["id"], "blocked_id": b["id"]}, nil); c != 204 {
		t.Fatalf("add: %d", c)
	}
	if c := call(t, srv, "POST", "/api/dependencies", map[string]any{"blocker_id": b["id"], "blocked_id": a["id"]}, nil); c != 400 {
		t.Fatalf("mutual should be 400, got %d", c)
	}
	var got map[string]any
	call(t, srv, "GET", "/api/items/"+jsonNum(int64(b["id"].(float64))), nil, &got)
	if bb := got["blocked_by"].([]any); len(bb) != 1 || bb[0].(float64) != a["id"].(float64) {
		t.Fatalf("blocked_by: %v", got)
	}
	path := "/api/dependencies/" + jsonNum(int64(a["id"].(float64))) + "/" + jsonNum(int64(b["id"].(float64)))
	if c := call(t, srv, "DELETE", path, nil, nil); c != 204 {
		t.Fatalf("delete: %d", c)
	}
	call(t, srv, "GET", "/api/items/"+jsonNum(int64(b["id"].(float64))), nil, &got)
	if bb := got["blocked_by"].([]any); len(bb) != 0 {
		t.Fatalf("blocked_by after delete: %v", got)
	}
}

func TestRestoreEndpoint(t *testing.T) {
	srv := setup(t)
	var p map[string]any
	call(t, srv, "POST", "/api/items", map[string]any{"type": "project", "title": "p"}, &p)
	id := jsonNum(int64(p["id"].(float64)))
	call(t, srv, "DELETE", "/api/items/"+id, nil, nil)
	if c := call(t, srv, "GET", "/api/items/"+id, nil, nil); c != 404 {
		t.Fatalf("expected 404, got %d", c)
	}
	var got map[string]any
	if c := call(t, srv, "POST", "/api/items/"+id+"/restore", nil, &got); c != 200 || got["title"] != "p" {
		t.Fatalf("restore: %d %v", c, got)
	}
	if c := call(t, srv, "POST", "/api/items/999/restore", nil, nil); c != 404 {
		t.Fatalf("expected 404, got %d", c)
	}
}
