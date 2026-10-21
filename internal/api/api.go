// Package api exposes the store over a JSON HTTP API.
//
// Conventions:
//   - All responses are JSON. Errors are {"error": "message"}.
//   - PATCH bodies are partial: absent fields are unchanged; an explicit null
//     clears a nullable field (parent_id excepted: tasks always need one).
//   - Owner/assignee: send {"assignee_id": 3} for a user or
//     {"assignee_id": null} to clear (likewise owner_id).
//   - Every change is announced on GET /api/events (see events.go); clients
//     identify themselves with the X-Planner-Client header.
package api

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"planner/internal/store"
)

type Server struct {
	st  *store.Store
	hub *Hub
}

// New makes a server over the store with its own event hub.
func New(st *store.Store) *Server { return &Server{st: st, hub: NewHub()} }

// Handler returns the API router mounted under /api/.
func Handler(st *store.Store) http.Handler { return New(st).Handler() }

// Handler returns the server's router mounted under /api/.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/events", s.events)
	mux.HandleFunc("GET /api/scratch", s.getScratch)
	mux.HandleFunc("PUT /api/scratch", s.putScratch)
	mux.HandleFunc("GET /api/users/{id}/scratch", s.getUserScratch)
	mux.HandleFunc("PUT /api/users/{id}/scratch", s.putUserScratch)
	mux.HandleFunc("GET /api/users", s.listUsers)
	mux.HandleFunc("POST /api/users", s.createUser)
	mux.HandleFunc("PATCH /api/users/{id}", s.updateUser)
	mux.HandleFunc("DELETE /api/users/{id}", s.deleteUser)
	mux.HandleFunc("GET /api/users/{id}/prefs", s.getPrefs)
	mux.HandleFunc("PATCH /api/users/{id}/prefs", s.updatePrefs)

	mux.HandleFunc("GET /api/items", s.listItems)
	mux.HandleFunc("POST /api/items", s.createItem)
	mux.HandleFunc("GET /api/items/{id}", s.getItem)
	mux.HandleFunc("PATCH /api/items/{id}", s.updateItem)
	mux.HandleFunc("DELETE /api/items/{id}", s.deleteItem)
	mux.HandleFunc("GET /api/items/{id}/history", s.history)
	mux.HandleFunc("POST /api/items/{id}/restore", s.restoreItem)
	mux.HandleFunc("GET /api/items/{id}/attachments", s.listAttachments)
	mux.HandleFunc("POST /api/items/{id}/attachments", s.uploadAttachments)
	mux.HandleFunc("GET /api/attachments/{id}", s.getAttachment)
	mux.HandleFunc("DELETE /api/attachments/{id}", s.deleteAttachment)
	mux.HandleFunc("POST /api/attachments/{id}/restore", s.restoreAttachment)
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
		Short string `json:"short"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	u, err := s.st.CreateUser(in.Name, in.Color, in.Short)
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r, KindUsers, "")
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
		Short *string `json:"short"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	u, err := s.st.UpdateUser(id, in.Name, in.Color, in.Short)
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r, KindUsers, "")
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
	s.publish(r, KindUsers, "")
	w.WriteHeader(http.StatusNoContent)
}

// getPrefs returns the user's preferences with defaults applied.
func (s *Server) getPrefs(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	prefs, err := s.st.UserPrefs(id)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, prefs)
}

// updatePrefs takes a partial {key: value} map and returns the full map.
func (s *Server) updatePrefs(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	var in map[string]string
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	prefs, err := s.st.UpdateUserPrefs(id, in)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, prefs)
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
	Color       *string     `json:"color"`
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
	p.Color = b.Color
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
	s.publish(r, KindItems, "")
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
	s.publish(r, KindItems, "")
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
	s.publish(r, KindItems, "")
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
	s.publish(r, KindItems, "")
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
	s.publish(r, KindItems, "")
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
	s.publish(r, KindItems, "")
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
	s.publish(r, KindSettings, "")
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
	s.publish(r, KindItems, "")
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------- attachments

// maxUploadBody bounds a whole upload request: a few files at the limit plus
// multipart framing. Larger bodies are cut off with a 413.
const maxUploadBody = 4*store.MaxAttachmentSize + 1<<20

// Renderable reports whether a browser can be allowed to show the content
// type inline rather than download it.
func Renderable(contentType string) bool {
	mt, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return false
	}
	switch {
	case strings.HasPrefix(mt, "image/"), strings.HasPrefix(mt, "video/"),
		strings.HasPrefix(mt, "audio/"), strings.HasPrefix(mt, "text/"):
		return true
	}
	return mt == "application/pdf" || mt == "application/json"
}

// sandboxed reports whether the content type can carry scripts (or load
// them) when rendered, so that it must be served under a CSP sandbox.
func sandboxed(contentType string) bool {
	mt, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return false
	}
	return mt == "text/html" || mt == "image/svg+xml" || mt == "text/xml"
}

// contentTypeFor picks the stored content type of an upload: the part's own
// header when it is a valid, specific media type; else the extension; else a
// sniff of the first bytes.
func contentTypeFor(given, name string, data []byte) string {
	given = strings.TrimSpace(given)
	if mt, _, err := mime.ParseMediaType(given); err == nil && mt != "application/octet-stream" {
		return given
	}
	if ct := mime.TypeByExtension(filepath.Ext(name)); ct != "" {
		return ct
	}
	if len(data) > 512 {
		data = data[:512]
	}
	return http.DetectContentType(data)
}

// writeTooLarge answers 413. The remaining body (bounded by MaxBytesReader)
// is drained first so the client sees the response rather than a reset.
func writeTooLarge(w http.ResponseWriter, r *http.Request) {
	io.Copy(io.Discard, r.Body)
	writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
		"error": "file is larger than the " + strconv.Itoa(store.MaxAttachmentSize>>20) + " MiB limit",
	})
}

// listAttachments returns the live attachments of an item.
func (s *Server) listAttachments(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	as, err := s.st.ListAttachments(id)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, as)
}

// uploadAttachments stores every multipart/form-data part named "file" on
// the item and returns the created metadata (201). A part over
// store.MaxAttachmentSize is a 413; a body with no file parts is a 400.
func (s *Server) uploadAttachments(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	// Reject an unknown item before reading the body.
	if _, err := s.st.ListAttachments(id); err != nil {
		writeErr(w, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBody)
	mr, err := r.MultipartReader()
	if err != nil {
		writeErr(w, &store.ValidationError{Msg: "expected a multipart/form-data body: " + err.Error()})
		return
	}
	type upload struct {
		name, contentType string
		data              []byte
	}
	var ups []upload
	var tooBig *http.MaxBytesError
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if errors.As(err, &tooBig) {
			writeTooLarge(w, r)
			return
		}
		if err != nil {
			writeErr(w, &store.ValidationError{Msg: "malformed multipart body: " + err.Error()})
			return
		}
		if part.FormName() != "file" {
			part.Close()
			continue
		}
		data, err := io.ReadAll(io.LimitReader(part, store.MaxAttachmentSize+1))
		part.Close()
		if errors.As(err, &tooBig) || (err == nil && len(data) > store.MaxAttachmentSize) {
			writeTooLarge(w, r)
			return
		}
		if err != nil {
			writeErr(w, &store.ValidationError{Msg: "malformed multipart body: " + err.Error()})
			return
		}
		name := part.FileName()
		ups = append(ups, upload{name, contentTypeFor(part.Header.Get("Content-Type"), name, data), data})
	}
	if len(ups) == 0 {
		writeErr(w, &store.ValidationError{Msg: `the upload has no "file" parts`})
		return
	}
	// All or nothing: a bad part (no name, empty) rejects the batch before
	// any file is stored.
	for _, u := range ups {
		if _, err := store.CheckAttachment(u.name, len(u.data)); err != nil {
			writeErr(w, err)
			return
		}
	}
	out := []store.Attachment{}
	for _, u := range ups {
		a, err := s.st.AddAttachment(id, u.name, u.contentType, u.data)
		if err != nil {
			writeErr(w, err)
			return
		}
		out = append(out, *a)
	}
	s.publish(r, KindItems, "")
	writeJSON(w, 201, out)
}

// getAttachment serves the file. Browser-renderable types are sent inline
// (unless ?download=1), everything else as a download; HTML and SVG are
// additionally sandboxed so embedded scripts cannot touch the app origin.
func (s *Server) getAttachment(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	a, data, err := s.st.GetAttachment(id)
	if err != nil {
		writeErr(w, err)
		return
	}
	disp := "attachment"
	if dl := r.URL.Query().Get("download"); Renderable(a.ContentType) && (dl == "" || dl == "0") {
		disp = "inline"
	}
	h := w.Header()
	h.Set("Content-Type", a.ContentType)
	h.Set("Content-Length", strconv.Itoa(len(data)))
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "private, max-age=0")
	if cd := mime.FormatMediaType(disp, map[string]string{"filename": a.Name}); cd != "" {
		h.Set("Content-Disposition", cd)
	} else {
		h.Set("Content-Disposition", disp)
	}
	if sandboxed(a.ContentType) {
		h.Set("Content-Security-Policy", "sandbox")
	}
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(data); err != nil {
		log.Printf("write attachment %d: %v", id, err)
	}
}

// deleteAttachment soft-deletes an attachment (204).
func (s *Server) deleteAttachment(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := s.st.DeleteAttachment(id); err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r, KindItems, "")
	w.WriteHeader(http.StatusNoContent)
}

// restoreAttachment undoes a soft delete and returns the metadata (200).
func (s *Server) restoreAttachment(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := s.st.RestoreAttachment(id); err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r, KindItems, "")
	a, err := s.st.GetAttachmentMeta(id)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, a)
}
