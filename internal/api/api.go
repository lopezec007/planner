// Package api exposes the store over a JSON HTTP API.
//
// Conventions:
//   - All responses are JSON. Errors are {"error": "message"}.
//   - PATCH bodies are partial: absent fields are unchanged; an explicit null
//     clears a nullable field (parent_id excepted: tasks always need one).
//   - Owner/assignee: send {"assignee_id": 3} for a user or
//     {"assignee_id": null} to clear (likewise owner_id).
package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	"planner/internal/store"
)

type Server struct {
	st *store.Store
}

// Handler returns the API router mounted under /api/.
func Handler(st *store.Store) http.Handler {
	s := &Server{st: st}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/users", s.listUsers)
	mux.HandleFunc("POST /api/users", s.createUser)
	mux.HandleFunc("PATCH /api/users/{id}", s.updateUser)
	mux.HandleFunc("DELETE /api/users/{id}", s.deleteUser)

	mux.HandleFunc("GET /api/items", s.listItems)
	mux.HandleFunc("POST /api/items", s.createItem)
	mux.HandleFunc("GET /api/items/{id}", s.getItem)
	mux.HandleFunc("PATCH /api/items/{id}", s.updateItem)
	mux.HandleFunc("DELETE /api/items/{id}", s.deleteItem)
	mux.HandleFunc("GET /api/items/{id}/history", s.history)
	mux.HandleFunc("POST /api/items/{id}/restore", s.restoreItem)
	mux.HandleFunc("PUT /api/order", s.reorder)
	mux.HandleFunc("POST /api/dependencies", s.addDependency)
	mux.HandleFunc("DELETE /api/dependencies/{blocker}/{blocked}", s.removeDependency)
	mux.HandleFunc("GET /api/settings", s.getSettings)
	mux.HandleFunc("PATCH /api/settings", s.updateSettings)
	return mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("write response: %v", err)
	}
}

func writeErr(w http.ResponseWriter, err error) {
	var ve *store.ValidationError
	switch {
	case errors.As(err, &ve):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": ve.Msg})
	case errors.Is(err, store.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	case errors.Is(err, store.ErrConflict):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	default:
		log.Printf("internal error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
	}
}

func pathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return 0, store.ErrNotFound
	}
	return id, nil
}

func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return &store.ValidationError{Msg: "invalid JSON body: " + err.Error()}
	}
	return nil
}

// ---------------------------------------------------------------- users

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	us, err := s.st.ListUsers()
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, us)
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	u, err := s.st.CreateUser(in.Name, in.Color)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 201, u)
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	var in struct {
		Name  *string `json:"name"`
		Color *string `json:"color"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	u, err := s.st.UpdateUser(id, in.Name, in.Color)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, u)
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := s.st.DeleteUser(id); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------- items

// Opt is a JSON field that distinguishes absent from null. After decoding,
// Set reports whether the key was present and Val is nil when it was null.
type Opt[T any] struct {
	Set bool
	Val *T
}

func (o *Opt[T]) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Val = nil
		return nil
	}
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	o.Val = &v
	return nil
}

// itemBody is the wire format for create and patch.
type itemBody struct {
	Type        *string     `json:"type"`
	ParentID    Opt[int64]  `json:"parent_id"`
	Title       *string     `json:"title"`
	Description *string     `json:"description"`
	OwnerID     Opt[int64]  `json:"owner_id"`
	AssigneeID  Opt[int64]  `json:"assignee_id"`
	Status      *string     `json:"status"`
	StartDate   Opt[string] `json:"start_date"`
	StartFirm   *bool       `json:"start_firm"`
	EndDate     Opt[string] `json:"end_date"`
	EndFirm     *bool       `json:"end_firm"`
	Urgency     *int        `json:"urgency"`
	Importance  *int        `json:"importance"`
	Blocked     *bool       `json:"blocked"`
}

func (b *itemBody) patch() (store.Patch, error) {
	var p store.Patch
	p.Title = b.Title
	p.Description = b.Description
	p.Status = b.Status
	p.StartFirm = b.StartFirm
	p.EndFirm = b.EndFirm
	p.Urgency = b.Urgency
	p.Importance = b.Importance
	p.Blocked = b.Blocked
	if b.ParentID.Set {
		if b.ParentID.Val == nil {
			return p, &store.ValidationError{Msg: "parent_id cannot be null"}
		}
		p.ParentID = b.ParentID.Val
	}
	if b.OwnerID.Set {
		if b.OwnerID.Val == nil {
			p.ClearOwner = true
		} else {
			p.OwnerID = b.OwnerID.Val
		}
	}
	if b.AssigneeID.Set {
		if b.AssigneeID.Val == nil {
			p.ClearAssignee = true
		} else {
			p.AssigneeID = b.AssigneeID.Val
		}
	}
	if b.StartDate.Set {
		if b.StartDate.Val == nil {
			p.ClearStart = true
		} else {
			p.StartDate = b.StartDate.Val
		}
	}
	if b.EndDate.Set {
		if b.EndDate.Val == nil {
			p.ClearEnd = true
		} else {
			p.EndDate = b.EndDate.Val
		}
	}
	return p, nil
}

func (s *Server) listItems(w http.ResponseWriter, r *http.Request) {
	items, err := s.st.ListItems()
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, items)
}

func (s *Server) getItem(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	it, err := s.st.GetItem(id)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, it)
}

func (s *Server) createItem(w http.ResponseWriter, r *http.Request) {
	var in itemBody
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	if in.Type == nil {
		writeErr(w, &store.ValidationError{Msg: "type is required"})
		return
	}
	p, err := in.patch()
	if err != nil {
		writeErr(w, err)
		return
	}
	it, err := s.st.CreateItem(store.NewItem{Type: *in.Type, Patch: p})
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 201, it)
}

func (s *Server) updateItem(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	var in itemBody
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	if in.Type != nil {
		writeErr(w, &store.ValidationError{Msg: "type cannot be changed"})
		return
	}
	p, err := in.patch()
	if err != nil {
		writeErr(w, err)
		return
	}
	it, err := s.st.UpdateItem(id, p)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, it)
}

func (s *Server) deleteItem(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := s.st.DeleteItem(id); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) restoreItem(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := s.st.RestoreItem(id); err != nil {
		writeErr(w, err)
		return
	}
	it, err := s.st.GetItem(id)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, it)
}

func (s *Server) history(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	h, err := s.st.History(id)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, h)
}

// ---------------------------------------------------------------- dependencies

func (s *Server) addDependency(w http.ResponseWriter, r *http.Request) {
	var in struct {
		BlockerID int64 `json:"blocker_id"`
		BlockedID int64 `json:"blocked_id"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	if err := s.st.AddDependency(in.BlockerID, in.BlockedID); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) removeDependency(w http.ResponseWriter, r *http.Request) {
	a, err1 := strconv.ParseInt(r.PathValue("blocker"), 10, 64)
	b, err2 := strconv.ParseInt(r.PathValue("blocked"), 10, 64)
	if err1 != nil || err2 != nil {
		writeErr(w, store.ErrNotFound)
		return
	}
	if err := s.st.RemoveDependency(a, b); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------- settings

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	st, err := s.st.Settings()
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, st)
}

func (s *Server) updateSettings(w http.ResponseWriter, r *http.Request) {
	var in map[string]string
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	st, err := s.st.UpdateSettings(in)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, st)
}

func (s *Server) reorder(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs []int64 `json:"ids"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	if err := s.st.Reorder(in.IDs); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
