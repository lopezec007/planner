package api

import (
	"bytes"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"path/filepath"
	"strconv"
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
	if c := call(t, srv, "GET", "/api/settings", nil, &st); c != 200 || st["week_start"] != "6" || st["default_status"] != "todo" {
		t.Fatalf("get: %d %v", c, st)
	}
	if c := call(t, srv, "PATCH", "/api/settings", map[string]string{"week_start": "0", "color_ongoing": "#abcdef", "default_status": "backlog"}, &st); c != 200 {
		t.Fatalf("patch: %d", c)
	}
	if st["week_start"] != "0" || st["color_ongoing"] != "#abcdef" || st["default_status"] != "backlog" {
		t.Fatalf("patched: %v", st)
	}
	if c := call(t, srv, "PATCH", "/api/settings", map[string]string{"week_start": "9"}, nil); c != 400 {
		t.Fatalf("expected 400, got %d", c)
	}
	if c := call(t, srv, "PATCH", "/api/settings", map[string]string{"default_status": "open"}, nil); c != 400 {
		t.Fatalf("expected 400 for a bad default_status, got %d", c)
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

func TestPrefsEndpoints(t *testing.T) {
	srv := setup(t)
	var u map[string]any
	call(t, srv, "POST", "/api/users", map[string]any{"name": "Evan"}, &u)
	path := "/api/users/" + jsonNum(int64(u["id"].(float64))) + "/prefs"
	var prefs map[string]string
	if c := call(t, srv, "GET", path, nil, &prefs); c != 200 || prefs["view"] != "table" || prefs["collapsed"] != "[]" {
		t.Fatalf("get: %d %v", c, prefs)
	}
	if c := call(t, srv, "PATCH", path, map[string]string{"view": "matrix", "sort": `[{"key":"urgency","dir":"desc"}]`}, &prefs); c != 200 {
		t.Fatalf("patch: %d", c)
	}
	if prefs["view"] != "matrix" || prefs["sort"] != `[{"key":"urgency","dir":"desc"}]` || prefs["narrow"] != "0" {
		t.Fatalf("patched: %v", prefs)
	}
	for _, bad := range []any{
		map[string]string{"view": "list"},
		map[string]string{"nope": "1"},
		map[string]string{"sort": "[1]"},
		map[string]string{"collapsed": `["x"]`},
		`{"narrow": 1}`,
	} {
		if c := call(t, srv, "PATCH", path, bad, nil); c != 400 {
			t.Fatalf("%v: expected 400, got %d", bad, c)
		}
	}
	if c := call(t, srv, "GET", "/api/users/999/prefs", nil, nil); c != 404 {
		t.Fatalf("expected 404, got %d", c)
	}
	if c := call(t, srv, "PATCH", "/api/users/999/prefs", map[string]string{"view": "table"}, nil); c != 404 {
		t.Fatalf("expected 404, got %d", c)
	}
}

// mpFile is one part of a multipart upload. An empty contentType omits the
// part's Content-Type header; field defaults to "file".
type mpFile struct {
	field, name, contentType string
	data                     []byte
}

func multipartBody(t *testing.T, files []mpFile) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for _, f := range files {
		field := f.field
		if field == "" {
			field = "file"
		}
		h := make(textproto.MIMEHeader)
		h.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": field, "filename": f.name}))
		if f.contentType != "" {
			h.Set("Content-Type", f.contentType)
		}
		pw, err := mw.CreatePart(h)
		if err != nil {
			t.Fatal(err)
		}
		pw.Write(f.data)
	}
	mw.Close()
	return &buf, mw.FormDataContentType()
}

func upload(t *testing.T, srv *httptest.Server, itemID string, files []mpFile, out any) int {
	t.Helper()
	body, ct := multipartBody(t, files)
	req, _ := http.NewRequest("POST", srv.URL+"/api/items/"+itemID+"/attachments", body)
	req.Header.Set("Content-Type", ct)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil && resp.StatusCode < 300 {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatalf("decode upload: %v", err)
		}
	}
	return resp.StatusCode
}

func get(t *testing.T, srv *httptest.Server, path string) *http.Response {
	t.Helper()
	resp, err := http.Get(srv.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func TestAttachmentEndpoints(t *testing.T) {
	srv := setup(t)
	var p map[string]any
	call(t, srv, "POST", "/api/items", map[string]any{"type": "project", "title": "p"}, &p)
	id := jsonNum(int64(p["id"].(float64)))

	png := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 16)...)
	zip := []byte("PK\x03\x04zipzipzip")
	var created []map[string]any
	c := upload(t, srv, id, []mpFile{
		{name: "../../etc/passwd", contentType: "image/png", data: png},
		{name: "archive.zip", contentType: "application/zip", data: zip},
		{name: "notes.txt", data: []byte("hello, plain text")}, // no Content-Type: sniffed
		{name: "photo.jpg", contentType: "application/octet-stream", data: []byte("not really")},
		{field: "other", name: "ignored.bin", data: []byte("skip me")},
	}, &created)
	if c != 201 {
		t.Fatalf("upload: %d", c)
	}
	if len(created) != 4 {
		t.Fatalf("expected 4 attachments, got %v", created)
	}
	if created[0]["name"] != "passwd" || created[0]["content_type"] != "image/png" || created[0]["size"].(float64) != float64(len(png)) {
		t.Fatalf("png meta: %v", created[0])
	}
	if created[1]["content_type"] != "application/zip" {
		t.Fatalf("zip meta: %v", created[1])
	}
	if ct := created[2]["content_type"]; ct != "text/plain; charset=utf-8" {
		t.Fatalf("sniffed type: %v", ct)
	}
	if ct := created[3]["content_type"]; ct != "image/jpeg" {
		t.Fatalf("octet-stream should fall back to the extension: %v", ct)
	}

	// The item carries the metadata in GET and in the list.
	var item map[string]any
	call(t, srv, "GET", "/api/items/"+id, nil, &item)
	if as := item["attachments"].([]any); len(as) != 4 || as[0].(map[string]any)["name"] != "passwd" {
		t.Fatalf("item attachments: %v", item["attachments"])
	}
	var items []map[string]any
	call(t, srv, "GET", "/api/items", nil, &items)
	if as := items[0]["attachments"].([]any); len(as) != 4 {
		t.Fatalf("list attachments: %v", items[0]["attachments"])
	}
	var list []map[string]any
	if c := call(t, srv, "GET", "/api/items/"+id+"/attachments", nil, &list); c != 200 || len(list) != 4 {
		t.Fatalf("list endpoint: %d %v", c, list)
	}

	pngID := jsonNum(int64(created[0]["id"].(float64)))
	zipID := jsonNum(int64(created[1]["id"].(float64)))

	// Download: bytes and headers.
	resp := get(t, srv, "/api/attachments/"+pngID)
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || !bytes.Equal(body, png) {
		t.Fatalf("get png: %d %q", resp.StatusCode, body)
	}
	h := resp.Header
	if h.Get("Content-Type") != "image/png" || h.Get("Content-Length") != strconv.Itoa(len(png)) ||
		h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Cache-Control") != "private, max-age=0" ||
		h.Get("Content-Disposition") != `inline; filename=passwd` || h.Get("Content-Security-Policy") != "" {
		t.Fatalf("png headers: %v", h)
	}
	resp = get(t, srv, "/api/attachments/"+pngID+"?download=1")
	if cd := resp.Header.Get("Content-Disposition"); cd != `attachment; filename=passwd` {
		t.Fatalf("forced download: %q", cd)
	}
	resp = get(t, srv, "/api/attachments/"+zipID)
	if cd := resp.Header.Get("Content-Disposition"); cd != `attachment; filename=archive.zip` || resp.Header.Get("Content-Type") != "application/zip" {
		t.Fatalf("zip headers: %v", resp.Header)
	}
	// HTML is renderable but sandboxed.
	var html []map[string]any
	upload(t, srv, id, []mpFile{{name: "page.html", contentType: "text/html; charset=utf-8", data: []byte("<script>1</script>")}}, &html)
	resp = get(t, srv, "/api/attachments/"+jsonNum(int64(html[0]["id"].(float64))))
	if resp.Header.Get("Content-Security-Policy") != "sandbox" || resp.Header.Get("Content-Disposition") != `inline; filename=page.html` ||
		resp.Header.Get("Content-Type") != "text/html; charset=utf-8" {
		t.Fatalf("html headers: %v", resp.Header)
	}

	// Delete hides, restore brings back.
	if c := call(t, srv, "DELETE", "/api/attachments/"+pngID, nil, nil); c != 204 {
		t.Fatalf("delete: %d", c)
	}
	if resp := get(t, srv, "/api/attachments/"+pngID); resp.StatusCode != 404 {
		t.Fatalf("deleted attachment: %d", resp.StatusCode)
	}
	if c := call(t, srv, "DELETE", "/api/attachments/"+pngID, nil, nil); c != 404 {
		t.Fatalf("double delete: %d", c)
	}
	call(t, srv, "GET", "/api/items/"+id, nil, &item)
	for _, a := range item["attachments"].([]any) {
		if a.(map[string]any)["name"] == "passwd" {
			t.Fatal("deleted attachment still listed on the item")
		}
	}
	var restored map[string]any
	if c := call(t, srv, "POST", "/api/attachments/"+pngID+"/restore", nil, &restored); c != 200 || restored["name"] != "passwd" {
		t.Fatalf("restore: %d %v", c, restored)
	}
	if resp := get(t, srv, "/api/attachments/"+pngID); resp.StatusCode != 200 {
		t.Fatalf("restored attachment: %d", resp.StatusCode)
	}
	if c := call(t, srv, "POST", "/api/attachments/999/restore", nil, nil); c != 404 {
		t.Fatalf("restore missing: %d", c)
	}

	// Errors.
	if c := upload(t, srv, id, []mpFile{{name: "empty.txt", data: nil}}, nil); c != 400 {
		t.Fatalf("empty file: %d", c)
	}
	if c := upload(t, srv, id, []mpFile{{field: "other", name: "x.txt", data: []byte("x")}}, nil); c != 400 {
		t.Fatalf("no file parts: %d", c)
	}
	if c := upload(t, srv, "999", []mpFile{{name: "x.txt", data: []byte("x")}}, nil); c != 404 {
		t.Fatalf("missing item: %d", c)
	}
	if c := call(t, srv, "POST", "/api/items/"+id+"/attachments", map[string]any{"name": "x"}, nil); c != 400 {
		t.Fatalf("json body: %d", c)
	}
	if resp := get(t, srv, "/api/attachments/999"); resp.StatusCode != 404 {
		t.Fatalf("missing attachment: %d", resp.StatusCode)
	}

	// Attachments of a soft-deleted item are 404 until it is restored.
	call(t, srv, "DELETE", "/api/items/"+id, nil, nil)
	if resp := get(t, srv, "/api/attachments/"+zipID); resp.StatusCode != 404 {
		t.Fatalf("attachment of deleted item: %d", resp.StatusCode)
	}
	if c := call(t, srv, "GET", "/api/items/"+id+"/attachments", nil, nil); c != 404 {
		t.Fatalf("list of deleted item: %d", c)
	}
	call(t, srv, "POST", "/api/items/"+id+"/restore", nil, nil)
	if resp := get(t, srv, "/api/attachments/"+zipID); resp.StatusCode != 200 {
		t.Fatalf("attachment after item restore: %d", resp.StatusCode)
	}
}

func TestAttachmentTooLarge(t *testing.T) {
	srv := setup(t)
	var p map[string]any
	call(t, srv, "POST", "/api/items", map[string]any{"type": "project", "title": "p"}, &p)
	id := jsonNum(int64(p["id"].(float64)))
	body, ct := multipartBody(t, []mpFile{
		{name: "ok.bin", contentType: "application/octet-stream", data: []byte("fine")},
		{name: "huge.bin", contentType: "application/octet-stream", data: make([]byte, store.MaxAttachmentSize+1)},
	})
	req, _ := http.NewRequest("POST", srv.URL+"/api/items/"+id+"/attachments", body)
	req.Header.Set("Content-Type", ct)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]string
	json.NewDecoder(resp.Body).Decode(&out)
	if resp.StatusCode != http.StatusRequestEntityTooLarge || out["error"] == "" {
		t.Fatalf("expected 413 with an error body, got %d %v", resp.StatusCode, out)
	}
	// Nothing was stored, not even the small part that came first.
	var list []map[string]any
	call(t, srv, "GET", "/api/items/"+id+"/attachments", nil, &list)
	if len(list) != 0 {
		t.Fatalf("oversized upload should store nothing, got %v", list)
	}
	// Exactly the limit is fine.
	if c := upload(t, srv, id, []mpFile{{name: "max.bin", contentType: "application/octet-stream", data: make([]byte, store.MaxAttachmentSize)}}, nil); c != 201 {
		t.Fatalf("file at the limit: %d", c)
	}
}

func TestRenderable(t *testing.T) {
	for ct, want := range map[string]bool{
		"image/png": true, "image/svg+xml": true, "video/mp4": true, "audio/ogg": true,
		"application/pdf": true, "text/plain; charset=utf-8": true, "text/html": true, "application/json": true,
		"application/zip": false, "application/octet-stream": false, "application/msword": false, "": false, "garbage": false,
	} {
		if got := Renderable(ct); got != want {
			t.Errorf("Renderable(%q) = %v, want %v", ct, got, want)
		}
	}
}

func TestAttachmentBatchIsAllOrNothing(t *testing.T) {
	srv := setup(t)
	var p map[string]any
	call(t, srv, "POST", "/api/items", map[string]any{"type": "project", "title": "p"}, &p)
	id := jsonNum(int64(p["id"].(float64)))
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", "ok.txt")
	fw.Write([]byte("fine"))
	mw.CreateFormFile("file", "empty.txt") // zero bytes
	mw.Close()
	req, _ := http.NewRequest("POST", srv.URL+"/api/items/"+id+"/attachments", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("expected 400 for a batch with an empty file, got %d", resp.StatusCode)
	}
	var got map[string]any
	call(t, srv, "GET", "/api/items/"+id, nil, &got)
	if n := len(got["attachments"].([]any)); n != 0 {
		t.Fatalf("expected nothing stored, got %d attachment(s)", n)
	}
}
