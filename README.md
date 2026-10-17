# Planner

A greatly simplified, self-hosted task planner. See [spec.md](spec.md) for the
full requirements.

## Build and run

Requires Go 1.26+. No Node toolchain is needed to build or run; Node is only
used for the browser tests.

    make build
    ./planner -addr :8080 -db /var/lib/planner/planner.db

Flags can also be given as environment variables `PLANNER_ADDR` and
`PLANNER_DB`. All data lives in the single SQLite file; back it up however you
like (it is safe to copy while the service runs, since WAL mode is used, but a
`sqlite3 planner.db ".backup out.db"` is the most robust approach).

## Development

Layout:

    main.go               HTTP server, embeds static/
    internal/store        SQLite persistence, validation, soft delete, status history
    internal/api          JSON API handlers (see package doc for conventions)
    static/               Frontend: vanilla ES modules, no build step
      js/app.js           hash router, toolbar, page rendering
      js/state.js         client cache + local-timezone date helpers
      js/filters.js       which items each page shows (supersede rule lives here)
      js/table.js         hierarchical table renderer and highlighting
      js/plan.js          Plan (Gantt) view
      js/matrix.js        Matrix (scatter) view
      js/users.js         Users page
      js/search.js        Everything-page search and filter
      css/app.css         theme tokens + table; one css file per feature module
    scripts/seed.sh       sample data for a running instance
    e2e/                  Playwright browser tests (seeded fresh per run)

Commands:

    make test     # go vet + unit tests
    make e2e      # browser tests (first run: npm install + npx playwright install chromium)
    make run      # dev server on :8080 with dev.db; then scripts/seed.sh to add sample data

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
