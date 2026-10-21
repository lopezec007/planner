package api

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"planner/internal/store"
)

func TestHubFansOutNumberedEvents(t *testing.T) {
	h := NewHub()
	a, cancelA := h.Subscribe()
	b, cancelB := h.Subscribe()
	defer cancelB()
	if h.Subscribers() != 2 {
		t.Fatalf("subscribers: %d", h.Subscribers())
	}
	h.Publish(KindItems, "", "c1")
	h.Publish(KindScratch, "user:3", "c2")
	for _, ch := range []<-chan Event{a, b} {
		e1, e2 := <-ch, <-ch
		if e1.Kind != KindItems || e1.Client != "c1" || e1.Rev != 1 || e2.Kind != KindScratch || e2.Scope != "user:3" || e2.Client != "c2" || e2.Rev != 2 {
			t.Fatalf("events: %+v %+v", e1, e2)
		}
	}
	cancelA()
	h.Publish(KindUsers, "", "")
	if h.Rev() != 3 || h.Subscribers() != 1 {
		t.Fatalf("after cancel: rev %d subs %d", h.Rev(), h.Subscribers())
	}
	select {
	case e := <-a:
		t.Fatalf("cancelled subscriber got %+v", e)
	default:
	}
	if e := <-b; e.Kind != KindUsers || e.Rev != 3 {
		t.Fatalf("b: %+v", e)
	}
	// A subscriber that never reads does not block publishing.
	_, cancelC := h.Subscribe()
	defer cancelC()
	for i := 0; i < subBuffer*2; i++ {
		h.Publish(KindItems, "", "")
	}
}

// eventStream opens GET /api/events and returns the data lines as they
// arrive, plus a cancel for the request.
func eventStream(t *testing.T, srv *httptest.Server) (<-chan string, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/events", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if ct := resp.Header.Get("Content-Type"); resp.StatusCode != 200 || ct != "text/event-stream" || resp.Header.Get("Cache-Control") != "no-cache" {
		t.Fatalf("stream response: %d %q", resp.StatusCode, ct)
	}
	lines := make(chan string, 16)
	go func() {
		defer resp.Body.Close()
		defer close(lines)
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			if l := sc.Text(); strings.HasPrefix(l, "data: ") {
				lines <- strings.TrimPrefix(l, "data: ")
			}
		}
	}()
	return lines, cancel
}

func nextEvent(t *testing.T, lines <-chan string) Event {
	t.Helper()
	select {
	case l, ok := <-lines:
		if !ok {
			t.Fatal("stream closed")
		}
		var ev Event
		if err := json.Unmarshal([]byte(l), &ev); err != nil {
			t.Fatalf("bad event %q: %v", l, err)
		}
		return ev
	case <-time.After(5 * time.Second):
		t.Fatal("no event within 5s")
	}
	return Event{}
}

func TestEventsEndpoint(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	s := New(st)
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)

	lines, cancel := eventStream(t, srv)
	defer cancel()
	// Wait for the handler to subscribe before changing anything.
	deadline := time.Now().Add(5 * time.Second)
	for s.hub.Subscribers() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}

	// A change with a client id: the event names the kind and the client.
	req, _ := http.NewRequest("POST", srv.URL+"/api/items", strings.NewReader(`{"type":"ongoing","title":"Maint"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(ClientHeader, "page-1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 201 {
		t.Fatalf("create: %v %v", err, resp)
	}
	resp.Body.Close()
	if ev := nextEvent(t, lines); ev.Kind != KindItems || ev.Client != "page-1" || ev.Rev != 1 {
		t.Fatalf("items event: %+v", ev)
	}
	// Every kind of change publishes; a failed one does not.
	var u map[string]any
	call(t, srv, "POST", "/api/users", map[string]any{"name": "Evan"}, &u)
	if ev := nextEvent(t, lines); ev.Kind != KindUsers || ev.Client != "" || ev.Rev != 2 {
		t.Fatalf("users event: %+v", ev)
	}
	call(t, srv, "PATCH", "/api/settings", map[string]string{"week_start": "9"}, nil)
	call(t, srv, "PATCH", "/api/settings", map[string]string{"week_start": "1"}, nil)
	if ev := nextEvent(t, lines); ev.Kind != KindSettings || ev.Rev != 3 {
		t.Fatalf("settings event: %+v", ev)
	}
	call(t, srv, "PUT", "/api/scratch", map[string]string{"text": "hi"}, nil)
	if ev := nextEvent(t, lines); ev.Kind != KindScratch || ev.Scope != "global" || ev.Rev != 4 {
		t.Fatalf("scratch event: %+v", ev)
	}
	uid := jsonNum(int64(u["id"].(float64)))
	call(t, srv, "PUT", "/api/users/"+uid+"/scratch", map[string]string{"text": "mine"}, nil)
	if ev := nextEvent(t, lines); ev.Kind != KindScratch || ev.Scope != "user:"+uid {
		t.Fatalf("user scratch event: %+v", ev)
	}

	// Closing the request ends the handler and drops the subscription.
	cancel()
	deadline = time.Now().Add(5 * time.Second)
	for s.hub.Subscribers() != 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if s.hub.Subscribers() != 0 {
		t.Fatal("subscription outlived the request")
	}
}

func TestScratchEndpoints(t *testing.T) {
	srv := setup(t)
	var sc map[string]string
	if c := call(t, srv, "GET", "/api/scratch", nil, &sc); c != 200 || sc["text"] != "" || sc["updated_at"] != "" {
		t.Fatalf("empty: %d %v", c, sc)
	}
	if c := call(t, srv, "PUT", "/api/scratch", map[string]string{"text": "shared"}, &sc); c != 200 || sc["text"] != "shared" || sc["updated_at"] == "" {
		t.Fatalf("put: %d %v", c, sc)
	}
	if c := call(t, srv, "GET", "/api/scratch", nil, &sc); c != 200 || sc["text"] != "shared" {
		t.Fatalf("get: %d %v", c, sc)
	}
	var u map[string]any
	call(t, srv, "POST", "/api/users", map[string]any{"name": "Evan"}, &u)
	path := "/api/users/" + jsonNum(int64(u["id"].(float64))) + "/scratch"
	if c := call(t, srv, "GET", path, nil, &sc); c != 200 || sc["text"] != "" {
		t.Fatalf("user empty: %d %v", c, sc)
	}
	if c := call(t, srv, "PUT", path, map[string]string{"text": "mine"}, &sc); c != 200 || sc["text"] != "mine" {
		t.Fatalf("user put: %d %v", c, sc)
	}
	if c := call(t, srv, "GET", "/api/scratch", nil, &sc); sc["text"] != "shared" {
		t.Fatalf("panes mixed: %d %v", c, sc)
	}
	for _, p := range []string{"/api/users/999/scratch", "/api/users/x/scratch"} {
		if c := call(t, srv, "GET", p, nil, nil); c != 404 {
			t.Fatalf("GET %s: expected 404, got %d", p, c)
		}
		if c := call(t, srv, "PUT", p, map[string]string{"text": "x"}, nil); c != 404 {
			t.Fatalf("PUT %s: expected 404, got %d", p, c)
		}
	}
	// Bad bodies and the size cap.
	for _, bad := range []any{`{}`, `{"text": 1}`, `{"text": "x", "extra": 1}`, `nope`} {
		if c := call(t, srv, "PUT", "/api/scratch", bad, nil); c != 400 {
			t.Fatalf("%v: expected 400, got %d", bad, c)
		}
	}
	var e map[string]string
	req, _ := http.NewRequest("PUT", srv.URL+"/api/scratch", strings.NewReader(`{"text":"`+strings.Repeat("x", store.MaxScratchSize+1)+`"}`))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	json.NewDecoder(resp.Body).Decode(&e)
	resp.Body.Close()
	if resp.StatusCode != 400 || !strings.Contains(e["error"], "1 MiB") {
		t.Fatalf("just over the cap: %d %v", resp.StatusCode, e)
	}
	req, _ = http.NewRequest("PUT", srv.URL+"/api/scratch", strings.NewReader(`{"text":"`+strings.Repeat("x", maxScratchBody+1)+`"}`))
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	e = nil
	json.NewDecoder(resp.Body).Decode(&e)
	resp.Body.Close()
	if resp.StatusCode != 413 || !strings.Contains(e["error"], "1 MiB") {
		t.Fatalf("far over the cap: %d %v", resp.StatusCode, e)
	}
	if c := call(t, srv, "PUT", "/api/scratch", map[string]string{"text": strings.Repeat("y", store.MaxScratchSize)}, &sc); c != 200 || len(sc["text"]) != store.MaxScratchSize {
		t.Fatalf("at the cap: %d", c)
	}
}
