# Planner

A greatly simplified, self-hosted task planner. See [spec.md](spec.md) for the
full requirements.

## Build and run

Requires Go 1.26+. No Node toolchain is needed to build or run; Node is only
used for the browser tests.

    make build
    ./planner -addr :8080 -db /var/lib/planner/planner.db

Flags can also be given as environment variables `PLANNER_ADDR` and
`PLANNER_DB`; `planner -version` prints the build version. All data lives in
the single SQLite file. The directory containing it must already exist.

## Using it

1. Open the **Users** page and add the people who will own or be assigned
   work. Each gets a colour (click the swatch to change it) that highlights
   the Owner and Assignee columns everywhere.
2. On **Home**, click **New** to add an Ongoing bucket or a Project as a blank
   row; fill in the title (required) and anything else, then press Enter or
   the ✓ button. Use the **+** on an Ongoing or Project row to add a task
   beneath it.
3. Rows are read-only until you click ✎ on that row. Escape cancels, Enter
   saves (Ctrl+Enter inside the description). Only one row edits at a time.
4. Drag the ⠿ handle to reorder: Ongoing/Project rows among themselves, tasks
   within their parent. Reparent a task through its Parent field in edit mode.
5. **Plan** shows a Gantt timeline beside the titles (zoom with the +/−
   buttons or Ctrl+wheel, drag or scroll to pan, Today recentres). **Matrix**
   plots tasks by urgency and importance; hover a point for its description.
6. **Backlog** and **Ideas** list items in those statuses; **Everything**
   lists all live items with search and filters.
7. Deleting hides an item (and its tasks) from the UI; the rows stay in the
   database and keys are never reused. Each item's status history is kept and
   available at `/api/items/{id}/history`.

"Today" and all date highlighting use the browser's timezone, not the
server's. The homepage shows To-Do and In-Progress work plus anything closed
in the last 14 days; a project's status decides where its tasks appear.

## Deploying on Debian

The app runs as a systemd service on a Debian 13 host; see `deploy/`. It
listens on plain HTTP with no authentication, so keep it on a private network.

### Install

On a machine with Go, build a static linux/amd64 binary (no cgo, so it runs
on any x86-64 Debian regardless of installed libraries):

    make dist            # -> dist/planner, versioned from `git describe`

Then, on the target host as root, from a checkout of this repo:

    sudo deploy/install.sh dist/planner      # or: sudo make install BIN=dist/planner

If Go is installed on the host you can omit the argument and the script builds
the binary itself (`sudo make install`). The script is idempotent and:

- installs the binary to `/usr/local/bin/planner`
- creates the `planner` system user (no shell, no home)
- installs `deploy/planner.service` to `/etc/systemd/system/`
- creates `/etc/planner/planner.env` from `deploy/planner.env.example` if it
  does not already exist (an existing file is never overwritten), and keeps a
  current copy of the example alongside it
- runs `systemctl daemon-reload`, enables the service, (re)starts it, and
  prints the URL

### Configuration

`/etc/planner/planner.env` holds `KEY=VALUE` lines read by systemd:

    PLANNER_ADDR=0.0.0.0:8080            # listen address; default reaches the whole LAN
    PLANNER_DB=/var/lib/planner/planner.db

Both are optional; the defaults above are built into the unit. After editing
run `systemctl restart planner`. Logs go to the journal:
`journalctl -u planner -f`.

The unit runs with `ProtectSystem=strict` and related hardening, so the only
writable location is the state directory `/var/lib/planner` (created and owned
by systemd via `StateDirectory=`). If you point `PLANNER_DB` elsewhere, add
that directory to `ReadWritePaths=` in the unit. To listen on a port below
1024, see the capability note in `deploy/planner.service`.

### Where the data lives

Everything is in `/var/lib/planner/planner.db`. SQLite runs in WAL mode, so
`planner.db-wal` and `planner.db-shm` sit next to it while the service is
running; they are part of the database state, not temp files.

### Upgrade

Build a new binary and re-run the installer; it replaces the binary and unit
and restarts the service, leaving the env file and database alone:

    make dist && sudo deploy/install.sh dist/planner

Or by hand: copy the new binary over `/usr/local/bin/planner` and run
`systemctl restart planner`. Schema migrations run automatically at startup.

### Backup

The database is a single file, so it fits any file-level backup tool such as
restic. Two safe approaches:

1. Snapshot with SQLite (most robust; produces a consistent single file with
   no `-wal` companion, and works while the service is running):

       sqlite3 /var/lib/planner/planner.db ".backup /var/backups/planner.db"

   then point restic at `/var/backups/planner.db`. `sqlite3` is in the Debian
   package of the same name. Run it as root or as the `planner` user; the
   state directory is mode 0750.

2. Copy the files directly. Because WAL mode is used, copying `planner.db`
   together with `planner.db-wal` (if present) while the service runs yields a
   usable database; backing up `planner.db` alone can miss the most recent
   writes still in the WAL. Stopping the service first
   (`systemctl stop planner`) checkpoints the WAL and makes a plain copy of
   `planner.db` exact.

To restore: stop the service, replace `/var/lib/planner/planner.db` (removing
any stale `-wal`/`-shm` files), `chown planner:planner` it, and start the
service.

### Uninstall

    sudo deploy/uninstall.sh

This stops and disables the service and removes the unit and binary. It
deliberately leaves `/var/lib/planner` (the database), `/etc/planner`, and the
`planner` user in place; remove them yourself if you want a clean slate.

## Development

Layout:

    main.go               HTTP server, embeds static/
    internal/store        SQLite persistence, validation, soft delete, status history
    internal/api          JSON API handlers (see package doc for conventions)
    static/               Frontend: vanilla ES modules, no build step
      js/app.js           hash router, toolbar, page rendering
      js/state.js         client cache + local-timezone date helpers
      js/filters.js       which items each page shows (supersede rule lives here)
      js/table.js         hierarchical table renderer, highlighting, drag reordering
      js/edit.js          in-table create/edit forms
      js/plan.js          Plan (Gantt) view
      js/matrix.js        Matrix (scatter) view
      js/users.js         Users page
      js/search.js        Everything-page search and filter
      css/app.css         theme tokens + table; one css file per feature module
    scripts/seed.sh       sample data for a running instance
    deploy/               systemd unit, env example, install/uninstall scripts
    e2e/                  Playwright browser tests (seeded fresh per run)

Commands:

    make test     # go vet + unit tests
    make e2e      # browser tests (first run: npm install + npx playwright install chromium)
    make run      # dev server on :8080 with dev.db; then scripts/seed.sh to add sample data
    make dist     # static linux/amd64 binary in dist/ (CGO_ENABLED=0)
    make install  # install as a systemd service on this host (root; see Deploying)

API summary (all JSON):

    GET    /api/users                 PATCH /api/users/{id}  {name?, color?}
    POST   /api/users {name, color?}  DELETE /api/users/{id}   (409 if referenced)
    GET    /api/items                 all live items, ordered by parent then sort_order
    POST   /api/items {type, title, parent_id?, ...}
    GET    /api/items/{id}            PATCH /api/items/{id}  partial; null clears
    DELETE /api/items/{id}            soft delete (cascades to tasks)
    GET    /api/items/{id}/history    status changes, oldest first
    PUT    /api/order {ids: [...]}    reorder siblings

Item JSON fields: id, type (ongoing|project|task), key, num, parent_id, title,
description, owner_id, assignee_id, assignee_shared, status, start_date,
start_firm, end_date, end_firm, urgency, importance, blocked, sort_order,
created_at, updated_at, closed_at (set while status is done/cancelled).
