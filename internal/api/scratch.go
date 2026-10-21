package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"planner/internal/store"
)

// The scratch pad: GET/PUT /api/scratch for the shared pane and
// GET/PUT /api/users/{id}/scratch for a user's own. Both return
// {"text": ..., "updated_at": ...}; a PUT body is {"text": ...}.

// maxScratchBody bounds a PUT body: the text limit plus JSON escaping room.
// Anything larger is cut off with a 413 before the store sees it.
const maxScratchBody = 2 * store.MaxScratchSize

func (s *Server) getScratch(w http.ResponseWriter, r *http.Request) {
	sc, err := s.st.GlobalScratch()
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, sc)
}

func (s *Server) putScratch(w http.ResponseWriter, r *http.Request) {
	text, ok := readScratchText(w, r)
	if !ok {
		return
	}
	sc, err := s.st.SetGlobalScratch(text)
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r, KindScratch, store.GlobalScratchScope)
	writeJSON(w, 200, sc)
}

func (s *Server) getUserScratch(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	sc, err := s.st.UserScratch(id)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, sc)
}

func (s *Server) putUserScratch(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	// Reject an unknown user before reading the body.
	if _, err := s.st.UserScratch(id); err != nil {
		writeErr(w, err)
		return
	}
	text, ok := readScratchText(w, r)
	if !ok {
		return
	}
	sc, err := s.st.SetUserScratch(id, text)
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r, KindScratch, store.UserScratchScope(id))
	writeJSON(w, 200, sc)
}

// readScratchText decodes a {"text": ...} body. It answers the request
// itself (413 for an oversized body, 400 for bad JSON) and returns false
// when it did.
func readScratchText(w http.ResponseWriter, r *http.Request) (string, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxScratchBody)
	var in struct {
		Text *string `json:"text"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			io.Copy(io.Discard, r.Body)
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
				"error": "the scratch pad text is larger than the " + strconv.Itoa(store.MaxScratchSize>>20) + " MiB limit",
			})
			return "", false
		}
		writeErr(w, &store.ValidationError{Msg: "invalid JSON body: " + err.Error()})
		return "", false
	}
	if in.Text == nil {
		writeErr(w, &store.ValidationError{Msg: "text is required"})
		return "", false
	}
	return *in.Text, true
}
