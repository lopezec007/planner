# Planner

A greatly simplified, self-hosted task planner. See [spec.md](spec.md) for the
full requirements.

## Build and run

Requires Go 1.26+. No Node toolchain is needed to build or run; Node is only
used for the browser tests.

    make build
    ./planner -addr :8080 -db /var/lib/planner/planner.db

Flags can also be given as environment variables `PLANNER_ADDR` and
`PLANNER_DB`; `planner -version` prints the semantic version, its release
date and the git build id (the version badge in the toolbar shows the same).
The version and date live at the top of `main.go`; bump them when cutting a
release. All data lives in
the single SQLite file. The directory containing it must already exist.

## Using it

1. Open **Settings** and add the people who will own or be assigned work. Each gets a colour (click the swatch to change it) that highlights
   the Owner and Assignee columns everywhere, and a chip label of up to
   three characters (initials, or the start of the name) that is what the
   chips show; the full name is in the tooltip.
2. The planner is a single page. **Active**, **Backlog** and **Ideas** beside
   the search box are filter templates: Active sets To-Do and In-Progress
   plus anything closed in the last 14 days, the other two set that status
   for projects and tasks. They are toggles that combine: click one to turn
   it on, click it again to turn it off, and turn on two or three to see
   their statuses together (Active + Backlog shows both and hides ideas).
   They fill the Filters panel, where you can adjust
   them; Clear removes every filter and shows everything. The filter
   settings are remembered per account like the other
   preferences; the search text is not. The gear at the
   far left opens Settings, which has an Items button to come back.
   Active on its own hides Ongoing and Project rows without active tasks;
   Backlog and Ideas (alone or combined with Active) keep every Ongoing row
   so items can be added to them. Filters apply to each item's own status.
   Click **+ Ongoing** or **+ Project** to add a blank row;
   fill in the title (required) and anything else, then press Enter or the ✓
   button (✕ or Escape discards). A new project or task starts in the
   default status from Settings (To-Do unless changed) when the filters in
   effect would show it, otherwise in a status they do show. Use the **+** on an Ongoing or Project row
   to add a task beneath it.
3. There is no edit mode: click any field to change it and it saves at once.
   Titles, dates and the description become inputs when clicked (Enter or
   leaving the field saves, Escape reverts; Ctrl+Enter in the description).
   Owner and Assignee show the current user's chip; click it to pick another
   (a row of every user's chip when they fit in the cell, a dropdown
   otherwise; click the pressed chip to clear). The `~` before a date marks it approximate; click it to
   pin it firm (the `~` becomes a 📌; click again to make it approximate).
   In the urgency and importance fields a single key sets the
   value: 1 to 9, 0 for 10, ` for 0 and, for importance only, - for -1;
   nothing but digits can be typed there. **Effort** is a dropdown of the
   durations configured in Settings (15m to 64h by default); an Ongoing or
   Project row shows the effort of the open tasks listed beneath it, and a
   badge in the page header, beside Sort, carries the total over every open
   task in view (hover either for the done/cancelled part). Leaving the page (the gear, a filter route, the back button)
   while a new row or a text edit is in progress shows a warning and stays
   put; finish the edit (Enter) or discard it (Escape) first. Reloading or
   closing the tab asks the browser's usual confirmation.
4. Expand a row with the ▸ at its right (the first of the row's buttons) for
   its description, its attachments and, for projects
   and tasks, its dependencies; an Ongoing or Project also gets a **Colour**
   box there (see Item colours below). The description is markdown, rendered
   densely (a single newline is a line break, a blank line a new paragraph).
   The caret at the far left of an Ongoing or Project row
   hides its tasks (remembered across reloads); while hidden, the count
   after the title is of the tasks that pass the current filters, and the
   toolbar's expand-all-parents / collapse-all-parents buttons (next to the
   expand-all / collapse-all buttons for the details) do it for every parent
   at once. **Flat** shows tasks only,
   with the parent's key and title as the first columns; a heavier rule marks
   where one parent's tasks end and the next begin (in the normal layout
   each Ongoing/Project with its tasks is a framed block of its own, with a
   gap between blocks; the Timeline beside it is framed the same way).
   Dependencies: "Blocked by" and
   "Blocks" lists of item keys with a dropdown to add more; hover a key for
   the item's title, status and description.
   An item blocked by anything still open has its Blocked box locked on. Two
   items cannot block each other, directly or through a chain. The Timeline
   draws lines from a blocker's end to the blocked item's start; the Matrix
   draws arrows between tasks. Attachments: **Attach…** (or drop files on
   the strip) stores files of any type with the item; a 📎 after the title
   shows how many. Clicking a file opens it in a new tab when the browser can
   show it (images, PDF, text, audio, video) and downloads it otherwise; × removes it.
5. Drag the ⠿ handle at the far right of a row to reorder: Ongoing/Project rows among themselves, tasks
   among any tasks. Dropping a task among another parent's tasks, or onto a
   parent row, moves it to that parent (in Flat a task only moves among its
   own parent's tasks). The ⇄ button on a task row moves it to another
   Ongoing or Project (it goes last there). The **Wide / Narrow** icon pair
   caps the table width on very wide screens, and **Nested / Flat** next to
   it switches the layout (see Flat above).
   **Sort**: click a column header to sort by it (again for the other
   direction, a third time to remove it); Urgency and Importance start
   with the highest first, the other columns ascending. Headers clicked in
   sequence build a multi-column sort, numbered under the arrows. The Sort menu shows the
   columns in effect, flips or removes them, returns to **User-defined** (the
   drag order) and has **Blocked items last** and **Done / cancelled items
   last**, which sink those items whatever the sort (done/cancelled below
   blocked when both are on). While sorted, rows cannot be dragged. The **Columns**
   menu next to it hides or shows any column (the title always shows).
   Dependencies and attachments in the expanded row each have a small **+**
   (the dropdown of items, or the file picker).
   The toolbar buttons are icons; hover one for what it does.
6. **Timeline** shows a Gantt chart beside the titles (zoom with the +/−
   buttons or Ctrl+wheel; Shift+wheel, Alt+wheel or drag to pan; a plain
   wheel scrolls the page; Today recentres). The date axis stays in view
   under the title bar while the page scrolls, like the table header. Drag
   a bar to move its dates or an end to resize; drag or click in a bar's
   faded tail to pin the missing date; click or drag on an empty row to
   create dates; hover a bar for × buttons that remove a date. A Project
   without a start or end of its own, and every Ongoing, gets that end from
   its tasks (earliest start, latest end): such an end is hatched with a
   dashed edge, the tooltip says "from its tasks", and on a Project
   clicking or dragging it pins a real date. The dropdown in the
   Timeline's corner colours the bars by assignee, owner, importance, urgency
   or importance × urgency (a blend: red = urgent and important, blue =
   important, amber = urgent, grey = neither), with a legend. Tooltips name
   a task's Ongoing or Project above its title. **Matrix**
   plots tasks by urgency (0 to 10) and importance (-1 to 10) and stays in
   view while the list scrolls; dot size follows effort on a logarithmic
   scale from the smallest to the largest configured option, and a task
   without an effort is a hollow dashed dot of middling size; hover a point
   for its description; the Keys / Titles toggle
   above the plot labels points with the task key or its title.
   Settings has the first day of the week, the default status for new
   projects and tasks, the effort options (add any duration such as 1h 30m;
   an option still used by an open task cannot be removed, and done or
   cancelled tasks keep a removed one), the row tint colours for
   Ongoing, Project and Task rows, the end-date highlight colours and
   windows, and a colour for each urgency and importance value (two ramps,
   with presets).
   **Item colours**: the key of every Ongoing and Project is a chip in the
   type colour from Settings with a type glyph (a loop for Ongoing, a flag
   for Project), whatever the row's tint, so the type is always obvious;
   task keys are plain. Beyond that, every Ongoing and Project can have a
   colour of its own.
   Expand the row and click the swatch in its Colour box for a palette, a
   custom colour, or back
   to the type colour; the colour is stored on the item, so everyone sees
   it. The **Colours** menu in the toolbar is your own choice of what shows:
   Ongoing/Project rows in their own colour (when set) or always the type
   colour from Settings, and task rows in the Task tint or in their
   Ongoing/Project's colour (then parent rows are tinted much more strongly
   than their tasks, so the two stay distinct). The Timeline's colour dropdown and a matching
   one above the Matrix have an **Ongoing / Project** mode that colours bars
   and points the same way.
7. Table, Timeline and Matrix show the same filtered items.
8. Deleting hides an item (and its tasks) from the UI; the rows stay in the
   database and keys are never reused. Each item's status history is kept and
   available at `/api/items/{id}/history`.
9. **Ctrl+Z** (Cmd+Z) undoes the last change made in this browser session,
   up to 20 steps: edits, new items, deletions, moves, dependency changes
   and attachment uploads and removals. Inside a text field the browser's
   own undo applies.
10. **Accounts**: the menu at the far right of the title bar says who you
   are (one of the users from Settings; there is no password). A browser
   that has not picked anyone gets the first user and remembers the choice.
   The view, Flat, Narrow, collapsed parents, sort, hidden columns, filters,
   Timeline and Matrix colouring, the Colours menu, the Matrix labels and
   the scratch pad layout are saved with the account, so they follow you to
   any browser; until the first user exists they are kept in the browser.
11. **Live updates**: a change made in another browser (or from the Android
   app) shows up here within a moment, no refresh needed. A page waits
   while you are in the middle of an edit and catches up as soon as you
   finish it.
12. **Scratch pad**: the notepad button at the far left of the title bar
   slides out a panel with two plain-text panes, a **Shared** one that
   everyone sees and one for your account. They save as you type and other
   browsers' edits appear live (never over a pane you are typing in). Drag
   the panel's right edge to resize it and the bar between the panes to
   change their split; **Wrap** toggles line wrapping. Width, split, Wrap
   and open/closed are remembered with the account.

"Today" and all date highlighting use the browser's timezone, not the
server's. A project's status decides under which filter its tasks appear.

## Android app

A phone client lives in [android/](android/): Kotlin and Jetpack Compose,
built for GrapheneOS first, offline-tolerant, talking to the same API over the
LAN or a WireGuard tunnel. See [android/README.md](android/README.md) for the
design and [android/SETUP.md](android/SETUP.md) for the toolchain;
`make android`, `make android-test` and `make android-release` wrap the Gradle
build.

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
`systemctl restart planner`. Schema migrations run automatically at startup;
before migrating an existing database the service first writes a copy next to
it (`planner.db.bak-<timestamp>-v<version>`) and logs the path, so a failed
upgrade can be rolled back by stopping the service and copying it back.

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
    internal/api          JSON API handlers (see package doc for conventions), the event stream, the scratch pad
    static/               Frontend: vanilla ES modules, no build step
      js/app.js           hash router, toolbar, account menu, page rendering, the edit guard
      js/realtime.js      server-sent events: reloads the page when another client changes something
      js/scratch.js       the scratch pad panel (shared and per-account panes)
      js/prefs.js         per-account preferences (server) or per-browser (localStorage)
      js/sort.js          column sort: comparator, header-click rule, Sort menu
      js/columns.js       column definitions, widths, hidden columns and the Columns menu
      js/icons.js         inline SVG icons for the toolbar
      js/tooltip.js       the item tooltip shared by the Matrix and the dependency chips
      js/colors.js        colour-coding: bar/point modes, Ongoing/Project colours, the Colours menu
      js/swatch.js        the colour swatch and palette popover (the Colour box of an expanded Ongoing/Project)
      js/state.js         client cache + local-timezone date helpers
      js/filters.js       grouping of items and the Active/Backlog/Ideas filter templates
      js/table.js         hierarchical table renderer, drag reordering, expanded rows
      js/cells.js         inline-editable cells, new-row draft, dependency and attachment panels
      js/timeline.js      Timeline (Gantt) view
      js/matrix.js        Matrix (scatter) view
      js/settings.js      Settings page (week start, row colours)
      js/users.js         Users section of Settings
      js/search.js        search box, filter templates and the filter popover (supersede rule lives here)
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

    GET    /api/users                 PATCH /api/users/{id}  {name?, color?, short?}
    POST   /api/users {name, color?, short?}  DELETE /api/users/{id}   (409 if referenced)
    GET    /api/users/{id}/prefs      PATCH /api/users/{id}/prefs {key: value}
                                      (view, narrow, flat, collapsed, sort, blocked_last, bar_color, hidden_cols,
                                       closed_last, parent_colors, task_colors, point_color, filters,
                                       matrix_labels, scratch_open, scratch_width, scratch_split, scratch_wrap)
    GET    /api/users/{id}/scratch    PUT /api/users/{id}/scratch {text}   the user's scratch pad {text, updated_at}
    GET    /api/scratch               PUT /api/scratch {text}              the shared scratch pad (1 MiB cap)
    GET    /api/events                server-sent events: {"kind": items|users|settings|scratch, "scope"?,
                                      "client", "rev"} after every change; "client" echoes the X-Planner-Client
                                      header of the request that made it, so a page can ignore its own changes
    GET    /api/items                 all live items, ordered by parent then sort_order
    POST   /api/items {type, title, parent_id?, ...}
    GET    /api/items/{id}            PATCH /api/items/{id}  partial; null clears
    DELETE /api/items/{id}            soft delete (cascades to tasks)
    GET    /api/items/{id}/history    status changes, oldest first
    POST   /api/items/{id}/restore    undo a soft delete (and its cascaded tasks)
    GET    /api/items/{id}/attachments           metadata of the item's files
    POST   /api/items/{id}/attachments           multipart/form-data, "file" parts (64 MiB each)
    GET    /api/attachments/{id}[?download=1]    the bytes (inline if the browser can show the type)
    DELETE /api/attachments/{id}                 soft delete; POST /api/attachments/{id}/restore undoes it
    PUT    /api/order {ids: [...]}    reorder siblings
    POST   /api/dependencies {blocker_id, blocked_id}   400 on self/ongoing/cycle
    DELETE /api/dependencies/{blocker}/{blocked}
    GET    /api/settings              PATCH /api/settings {key: value}  (week_start, default_status, effort_options,
                                      color_*, ...; removing an effort option an open task uses is a 400)

Item JSON fields: id, type (ongoing|project|task), key, num, parent_id, title,
description, owner_id, assignee_id, status, start_date,
start_firm, end_date, end_firm, urgency (0-10), importance (-1 to 10),
effort (minutes, one of the effort_options, or null; tasks only), blocked, color (an
Ongoing's or Project's own "#rrggbb", or "" for the type colour), sort_order,
created_at, updated_at, closed_at (set while status is done/cancelled),
blocked_by and blocks (ids of live projects/tasks), attachments (metadata:
id, name, content_type, size, created_at). Attachment bytes are stored in the
SQLite file, so the single-file backup story still holds.
