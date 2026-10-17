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
	if o["key"] != "O-1" || o["status"] != nil {
		t.Fatalf("ongoing: %v", o)
	}
	var tk map[string]any
	c := call(t, srv, "POST", "/api/items", map[string]any{
		"type": "task", "title": "Fix roof", "parent_id": o["id"], "owner_id": u["id"], "assignee_shared": true,
		"end_date": "2026-11-01", "end_firm": true,
	}, &tk)
	if c != 201 {
		t.Fatalf("create task: %d", c)
	}
	if tk["key"] != "T-1" || tk["urgency"].(float64) != 5 || tk["assignee_shared"] != true || tk["end_firm"] != true {
		t.Fatalf("task: %v", tk)
	}
	id := int64(tk["id"].(float64))
	path := "/api/items/" + jsonNum(id)

	// Patch: clear end date via null, set status.
	var up map[string]any
	if c := call(t, srv, "PATCH", path, `{"end_date": null, "status": "done", "assignee_id": `+jsonNum(int64(u["id"].(float64)))+`}`, &up); c != 200 {
		t.Fatalf("patch: %d", c)
	}
	if up["end_date"] != nil || up["end_firm"] != false || up["status"] != "done" || up["closed_at"] == nil || up["assignee_shared"] != false {
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
