// Command planner serves the task planner web application.
//
// Usage:
//
//	planner [-addr :8080] [-db planner.db]
//	planner -version
//
// Environment variables PLANNER_ADDR and PLANNER_DB are used as defaults for
// the corresponding flags.
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"planner/internal/api"
	"planner/internal/store"
)

//go:embed static
var staticFS embed.FS

// Version is the semantic version of this release and VersionDate the day it
// was cut. build is the git description, set via -ldflags "-X main.build=...".
const (
	Version     = "1.5.0"
	VersionDate = "2026-10-28"
)

var build = "dev"

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	addr := flag.String("addr", envOr("PLANNER_ADDR", ":8080"), "listen address")
	dbPath := flag.String("db", envOr("PLANNER_DB", "planner.db"), "path to SQLite database file")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("planner %s (%s, build %s)\n", Version, VersionDate, build)
		return
	}

	// SQLite reports a missing parent directory only as a cryptic
	// "unable to open database file"; check it up front instead.
	if dir := filepath.Dir(*dbPath); dir != "." {
		if fi, err := os.Stat(dir); err != nil {
			log.Fatalf("database directory %s does not exist (create it first): %v", dir, err)
		} else if !fi.IsDir() {
			log.Fatalf("database directory %s is not a directory", dir)
		}
	}

	st, err := store.Open(*dbPath)
	if err != nil {
		log.Fatalf("open database %s: %v", *dbPath, err)
	}
	defer st.Close()
	if st.LastBackup != "" {
		log.Printf("database schema upgraded; a copy of the previous database was saved to %s", st.LastBackup)
	}

	static, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("/api/", api.Handler(st))
	mux.HandleFunc("GET /api/version", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"version":%q,"date":%q,"build":%q}`, Version, VersionDate, build)
	})
	mux.Handle("/", noCache(http.FileServer(http.FS(static))))

	log.Printf("planner %s (%s) listening on %s (db %s)", Version, build, *addr, *dbPath)
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
