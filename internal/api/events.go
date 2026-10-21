package api

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"
)

// Live updates. Every mutating handler publishes an Event to the Hub after a
// successful change; GET /api/events streams them to browsers as
// server-sent events, so a page can refetch what changed instead of polling.
//
// Events say what kind of thing changed, not what the change was: the client
// reloads everything of that kind. The originating client's id (the
// X-Planner-Client request header, chosen per page load) travels with the
// event so a page can ignore echoes of its own changes.

// ClientHeader carries the id a page chose for itself on every request.
const ClientHeader = "X-Planner-Client"

// Event kinds.
const (
	KindItems    = "items"    // items, their order, dependencies and attachments
	KindUsers    = "users"    // users (and so the account menu)
	KindSettings = "settings" // app settings
	KindScratch  = "scratch"  // the scratch pad; Scope says which pane
)

// Event is the JSON data of one server-sent event.
type Event struct {
	Kind string `json:"kind"`
	// Scope narrows the kind where that helps: for the scratch pad it is
	// "global" or "user:<id>".
	Scope string `json:"scope,omitempty"`
	// Client is the id of the page that made the change ("" when unknown).
	Client string `json:"client"`
	// Rev counts events since the server started; it only ever grows.
	Rev uint64 `json:"rev"`
}

// subBuffer is how many events a slow subscriber can fall behind by before
// further ones are dropped (the client reloads everything on any event, so
// a dropped event is covered by the ones still queued).
const subBuffer = 64

// Hub fans events out to the subscribed event streams.
type Hub struct {
	mu   sync.Mutex
	rev  uint64
	subs map[chan Event]struct{}
}

func NewHub() *Hub { return &Hub{subs: map[chan Event]struct{}{}} }

// Publish numbers the event and hands it to every subscriber.
func (h *Hub) Publish(kind, scope, client string) Event {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.rev++
	ev := Event{Kind: kind, Scope: scope, Client: client, Rev: h.rev}
	for ch := range h.subs {
		select {
		case ch <- ev:
		default:
		}
	}
	return ev
}

// Subscribe returns a channel of future events and a function that stops
// the subscription.
func (h *Hub) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, subBuffer)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.subs, ch)
		h.mu.Unlock()
	}
}

// Rev is the number of the last event published.
func (h *Hub) Rev() uint64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.rev
}

// Subscribers is the number of open event streams (for tests).
func (h *Hub) Subscribers() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}

// publish records a change made by the request's client.
func (s *Server) publish(r *http.Request, kind, scope string) {
	s.hub.Publish(kind, scope, r.Header.Get(ClientHeader))
}

// keepalive is how often an idle stream sends a comment so proxies and
// browsers keep the connection open.
const keepalive = 20 * time.Second

// events streams the hub's events as text/event-stream until the client goes
// away. It touches no database connection: the store serialises on a single
// one, and a long-lived stream must not hold it.
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming is not supported"})
		return
	}
	ch, cancel := s.hub.Subscribe()
	defer cancel()
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	// The opening comment carries the current revision so a client can tell
	// (and log) where the stream started; browsers reconnect after 2 s.
	if _, err := w.Write([]byte("retry: 2000\n: rev " + jsonNumber(s.hub.Rev()) + "\n\n")); err != nil {
		return
	}
	fl.Flush()
	tick := time.NewTicker(keepalive)
	defer tick.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-tick.C:
			if _, err := w.Write([]byte(": keepalive\n\n")); err != nil {
				return
			}
			fl.Flush()
		case ev := <-ch:
			data, err := json.Marshal(ev)
			if err != nil {
				log.Printf("encode event: %v", err)
				continue
			}
			if _, err := w.Write(append(append([]byte("data: "), data...), '\n', '\n')); err != nil {
				return
			}
			fl.Flush()
		}
	}
}

func jsonNumber(n uint64) string {
	b, _ := json.Marshal(n)
	return string(b)
}
