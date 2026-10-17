// Command planner serves the task planner web application.
//
// Usage:
//
//	planner [-addr :8080] [-db planner.db]
//
// Environment variables PLANNER_ADDR and PLANNER_DB are used as defaults for
// the corresponding flags.
package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"

	"planner/internal/api"
	"planner/internal/store"
)

//go:embed static
var staticFS embed.FS

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	addr := flag.String("addr", envOr("PLANNER_ADDR", ":8080"), "listen address")
	dbPath := flag.String("db", envOr("PLANNER_DB", "planner.db"), "path to SQLite database file")
	flag.Parse()

	st, err := store.Open(*dbPath)
	if err != nil {
		log.Fatalf("open database %s: %v", *dbPath, err)
	}
	defer st.Close()

	static, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("/api/", api.Handler(st))
	mux.Handle("/", noCache(http.FileServer(http.FS(static))))

	log.Printf("planner listening on %s (db %s)", *addr, *dbPath)
	if err := http.ListenAndServe(*addr, mux); err != nil {
		log.Fatal(err)
	}
}

// noCache prevents browsers holding stale copies of the embedded assets
// across upgrades of the binary.
func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		h.ServeHTTP(w, r)
	})
}
