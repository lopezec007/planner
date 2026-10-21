# Planner for Android

A phone client for the planner server in the parent directory. Kotlin and
Jetpack Compose, portrait only, Android 16+ (API 36), built for GrapheneOS
first: no Google Play Services, no third-party services of any kind.

## Build

Requires a JDK (21) and the Android SDK (`ANDROID_HOME`, with
`platforms;android-36` and `build-tools;36.0.0`). Gradle itself is fetched by
the wrapper.

    cd android
    ./gradlew assembleDebug            # app/build/outputs/apk/debug/app-debug.apk
    ./gradlew test                     # JVM unit tests (sync, filters, dates)
    ./gradlew connectedAndroidTest     # instrumented tests on a device/emulator
    ./gradlew installDebug             # onto the device on adb

Release builds are signed with the key named in `android/keystore.properties`
(gitignored; see `keystore.properties.example`) and published as APKs on
GitHub releases, which Obtainium installs and updates from. Without that file
`assembleRelease` produces an unsigned APK.

## Design

### Server contract

The app is a second client of the same JSON API the web UI uses (see
"API summary" in the top-level README). The server was not changed for it.
Nothing in the API is specific to a client; the only things that live on the
phone are its own view preferences and the offline queue.

### Network policy

The app talks to exactly one host, the server address entered at setup, and
to nothing else. There is no analytics, crash reporting, push, update check
or image fetching from the description's Markdown. Every request goes through
`PlannerApi`, which is built on the base URL; the network security config
permits cleartext HTTP because the server speaks plain HTTP (over the LAN or
through the user's WireGuard tunnel), and that permission is only ever used
for that one host.

Before pushing queued changes the sync engine probes `GET /api/version` with
a short timeout. If the server is not reachable (no network, or the tunnel is
down) nothing else is sent and the queue waits. WorkManager retries when
connectivity changes.

### Offline tolerance

Local data lives in Room (`data/db`). The app reads only from Room; the
network never blocks a screen.

- **Pull**: `GET /api/users`, `/api/items`, `/api/settings` are fetched
  together and replace the local tables in one transaction. The dataset is
  small (one household), so there is no delta protocol.
- **Push**: every change is applied to Room at once (optimistically) and
  appended to the `pending_ops` table. `SyncEngine.sync()` replays the queue
  in order, then pulls. A network failure stops the replay and keeps the rest
  of the queue; a 4xx answer drops that one op (it is recorded in `sync_log`
  and shown in Settings) and the following pull reconciles the local state.
  While the queue is non-empty no pull happens, so unsynced local edits are
  never overwritten.
- **Conflicts**: last writer wins per field, as in the web UI (PATCH bodies
  carry only the changed fields).
- **Creating offline**: a new item gets a negative local id and the key
  "…" until the server answers the queued create; then the row and every
  queued op that mentions the temporary id are rewritten with the real id.
  Until it is synced, an item cannot be given dependencies or reordered (the
  controls are disabled with an explanation). Tasks under an unsynced parent
  are fine: the parent's create is earlier in the queue.
- **Attachments**: metadata comes with the items; bytes are fetched on tap
  into the cache directory and opened with the system viewer. Uploads
  (file picker, photo picker, camera) are copied into `filesDir/outbox` and
  queued like any other op.

### Screens

- **Setup**: server address (host:port, http:// assumed) and the account
  (one of the server's users; prefs such as "me" default from it). Both are
  changeable in Settings.
- **List**: the Active / Backlog / Ideas templates, search, and the filter
  sheet, with the same semantics as `static/js/search.js` (an item matches
  on its own fields; a parent shows when it or a task matches; Active hides
  parents without matching tasks). Owner and Assignee are multi-select
  chips: any chosen user, or "No owner" / "Unassigned", matches, and no
  choice means any. Parents are section headers with their
  tasks beneath; Flat is a toggle. Row chips: status, assignee, end date
  (orange within 7 days, red today/overdue), urgency/importance per the
  server's colour ramps; blocked rows are dimmed; closed rows carry no
  highlighting.
- **Detail**: every field editable in place (no edit mode): title, status,
  owner, assignee, dates with firm toggles, urgency, importance, blocked,
  description (Markdown preview, tap to edit), dependencies (blocked by /
  blocks), attachments, status history. Delete with undo via the snackbar
  (the restore endpoint).
- **Timeline**: full-screen Gantt. Rows are the visible items in list
  order, with the title drawn in the row; a two-tier date axis; pinch to
  zoom, drag to pan, long-press and drag a bar to move it, drag an end to
  resize. Bar edges follow the spec (firm: hard, approximate: soft, missing:
  long fade). Colour modes as in the web UI.
- **Matrix**: full-screen urgency × importance scatter of the visible
  tasks, Eisenhower orientation, deterministic jitter, dependency arrows;
  tap a point for its card (its underlined title, like the Open button,
  opens the task), drag a point to change its values.
- **Settings**: server and account, sync status and errors, notification
  time and look-ahead window, users (name, colour, chip label), app
  settings (week start, colours), about.

### Due-date notifications

A daily WorkManager job (`notify/DueWorker`) at the configured time (default
08:00) reads Room and posts one notification listing open items assigned to
the account (or owned by it when unassigned) that are overdue, due today, or
due within the next N days, where N is the "Look ahead" setting (0, 1, 3, 7,
14 or 30 days; default 7; 0 lists only overdue and due-today items). The
title names the window ("2 this week", "1 due tomorrow", "3 in the next 14
days"). It needs no network, so it works offline. Tapping opens the item
(single item) or the list filtered to the account's assignments.

### Layout of the code

    app/src/main/java/io/github/lopezec007/planner/
      PlannerApp.kt            Application: builds the dependency graph (Graph)
      MainActivity.kt          single activity, Compose content, notification intents
      data/model/              Item, User, Attachment, AppSettings, enums, dates
      data/api/                PlannerApi (OkHttp + kotlinx.serialization), wire DTOs
      data/db/                 Room database, entities, DAOs
      data/sync/               PendingOp, SyncEngine, SyncWorker, ConnectivityProbe
      data/repo/               PlannerRepository: Flows for the UI, mutations that
                               write Room and enqueue ops
      prefs/                   DataStore: server URL, account, view prefs, notify time and window
      ui/theme/                Material 3 theme (dynamic colour off; follows system
                               light/dark)
      ui/nav/                  Screen stack (no Navigation library)
      ui/list/  ui/detail/  ui/timeline/  ui/matrix/  ui/settings/  ui/setup/
      ui/components/           chips, user avatars, pickers, Markdown view
      notify/                  DueWorker, scheduling, channel
      attach/                  pickers, camera capture, open-with, outbox

### Conventions

- One `Graph` object built in `PlannerApp` holds the singletons; ViewModels
  take what they need from it. No DI framework.
- Dates are `LocalDate` in Kotlin and `YYYY-MM-DD` strings on the wire and in
  Room. "Today" is the device's calendar day.
- Server timestamps (`created_at`, `updated_at`, `closed_at`) are RFC 3339
  strings and are kept as strings; `closed_at` is parsed only for the
  "closed within N days" rule.
- Status strings are the server's (`idea`, `backlog`, `todo`, `in-progress`,
  `done`, `cancelled`); `Status` is the enum with those wire values.
- Colours arrive as `#rrggbb` strings; `parseColor()` is tolerant of "".
