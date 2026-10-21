# Task Planner Tool

## Summary
A task planner that provides similar functionality to Jira in a greatly-simplified, self-hosted form.

## Requirements
### General
There is no such concept as a "project" here as Jira uses the term.

The technology stack (language, framework, libraries, etc.) is at the implementer's discretion.

### Deployment
- This tool should be accessible as a web application.  It should be runnable as a service directly on a Debian 13
  system.
- It will be entirely self-hosted on a private network with no public access.  Security is not a major concern.
- All data should be stored in a single SQLite file.  Backups are out of scope; the end user will back up the SQLite
  file as they see fit (e.g. with restic).
- Target desktop browsers only.  An Android app with a mobile-bespoke UI is specified at the end of this document.

### Users
- Users are managed in-app.  There is no authentication.
- Each user is also an "account": a menu in the title bar selects who is using the browser (no password).  Per-user
  preferences (view, Flat, Narrow, collapsed parents, sort, blocked-last, hidden columns, the filter settings,
  timeline bar and matrix point colouring, and the row colour-coding choices) are stored on the server with the
  user so they follow them to any browser.  The menu offers only users: a browser that has not picked one (or
  whose user was deleted) is given the first user and remembers it; only while no user exists at all does the
  browser keep its own preferences.
- All users have full CRUD access to everything.
- Each user is auto-assigned a color (used for categorical highlighting of the Owner and Assignee columns).  The color
  can be changed by the user.  Each user also has a chip label of at most 3 characters (initials, or the start of
  the name, by default; editable in Settings) which is what the Owner/Assignee chips display, with the full name on
  mouseover.  Clicking a chip offers every user's chip when they all fit within the cell, else a dropdown.

### Item Types
There are only 3:
- Ongoing: a bucket for ongoing work (e.g. "Maintenance", "Finance", etc.)
- Project: a project with a discrete start and end
- Task: a child of either an "Ongoing" or a "Project"

Items should be keyed based on their type and in increasing numeric order (e.g. "N-1, N-2, P-1, P-2, T-1, T-2, etc.).
"N" is used for Ongoing rather than "O" because "O" can be confused with "0".
Keys are never reused, including after deletion.

Every task must have a parent (an "Ongoing" or a "Project").

### Statuses
The following statuses apply to "Project" and "Task" (this concept isn't applicable to an "Ongoing"):
- Idea
- Backlog
- To-Do
- In-Progress
- Done
- Cancelled

A project of status "Idea" can be thought of as "superbacklogged".  Both "Done" and "Cancelled" should be considered
closed items for UI purposes.  There are no constraints on how statuses can be changed (i.e. no "workflows").

A full status history (each status change with its timestamp) is kept for every item.  Rules such as "marked done
within the last two weeks" are evaluated against this history.

Filters apply to each item's own status.  A parent (Ongoing or Project) is shown when it matches itself or has a
matching task; the "Active" template additionally hides parents with no matching tasks.

### Fields
All 3 work types should have the following fields:
- Title: short string (e.g. varchar(255))
- Description: string of unlimited length (within reason) that supports standard markdown rendering.  The markdown
  flavour is at the implementer's discretion.
- Owner: dropdown of users
- Assignee: dropdown of users (may be left unassigned)

When there are 3 or fewer users, Owner and Assignee are edited as clickable chips rather than dropdowns.

Projects and Tasks should additionally have:
- Start Date: date
- Start Date Firm: bool
- End Date: date
- End Date Firm: bool

And tasks should additionally have:
- Urgency: byte w/ acceptable values 0-10, defaulted to 5
- Importance: byte w/ acceptable values 0-10, defaulted to 5
- Blocked: boolean defaulted to false

Title is the only required field; all others are optional.

All date logic uses calendar days.  Weekends have no meaning to this software.  "Today" is determined using the
timezone of the user's device (the browser), not the server's, in case the server ever runs in UTC.

### Dependencies
Any Project or Task can be blocked by any number of other Projects or Tasks, and can block any number of them
(Ongoing items take no part).  Two items cannot block each other, directly or through a chain of dependencies.
An item that is blocked by another item whose status is not "Done" or "Cancelled" has its "Blocked" state locked
to true.  Dependencies are viewed and edited to the right of the description in the expanded row, with dropdowns
listing item key and title; the lists show only item keys, with the full item (title, status, description) in a
tooltip on mouseover as in the Matrix.  Attachments sit to the right of the dependencies.  The Timeline draws a line from the blocking item's end to the blocked item's start;
the Matrix draws subtle lines with arrows pointing from blocker to blocked.

### Attachments
Files of any type can be attached to any item (Ongoing, Project or Task).  They are stored in the SQLite file.  The
expanded row lists them; clicking one opens it in a new browser tab when the browser can render the type (images,
PDF, text, audio, video) and downloads it otherwise.  The tool does no rendering of its own.  Removing an attachment
is undoable; like deleted items, removed files stay in the database (so the file grows until it is compacted by
hand).  Each file is limited to 64 MiB.

### Undo
Ctrl+Z (Cmd+Z) undoes the most recent change made in the current browser session, up to the last 20 changes:
field edits, creations, deletions (restored with their cascaded tasks), reorders and moves, dependency
changes, and attachment uploads and removals.  Inside a text field the browser's own undo applies instead.

### Backups
Before a schema migration of an existing database, the application writes a copy of the database file next to it
("<db>.bak-<timestamp>-v<version>") using SQLite's own backup, and logs the path.

### Deletion
Items can be deleted from the UI.  A deleted item remains in the database but becomes entirely inaccessible in the UI
(it does not appear on any page, including the "Everything" page).

### UI
#### General
The UI should respond to the user's system theme (light/dark).  There is no manual theme override.

#### Navigation
There is a single planner page showing all live items, narrowed by search and filter controls.  "Active",
"Backlog" and "Ideas" are filter templates next to the Filters dropdown: selecting one populates the status and
type filters that produce that view (and the search box and other filters apply on top).  They are toggles that
combine: clicking a selected one clears it, and any two or all three may be selected at once, showing the union
of their statuses (parents without matching tasks are hidden only when Active is the sole selection).  With no
filters the page shows everything.  A gear icon at the far left of the title bar opens Settings, which has a
button back to the items.

Navigating away from an edit in progress (an unsaved new row, or an open title, date or description editor) is
refused with a warning snack until the edit is finished or discarded; leaving the page altogether gets the
browser's own confirmation.

#### Real-time updates
Every change is announced to all connected browsers over a server-sent event stream, and a page refreshes
itself when another client changes something, without a manual reload.  A page in the middle of an edit waits
until the edit is finished before refreshing.

#### Scratch pad
A button at the far left of the title bar slides out a panel on the left with two plain monospaced text panes,
one above the other: a global one shared by everyone and one belonging to the current account.  Text is saved as
it is typed and other browsers' changes appear live (never replacing a pane that is being edited).  The border
between the panel and the rest of the UI is draggable, as is the border between the two panes; a toggle wraps
long lines.  The panel's open state, width, split and wrap are per-user preferences; the text is stored on the
server (1 MiB per pane).

#### Active (default template)
This should display:
- All to-do and in-progress items
- All done and cancelled items that were marked "done" or "cancelled" within the last two weeks
- Their parent "Ongoing"/"Project" rows; parents with no such tasks are hidden

Backlogged (or idea) tasks are not shown, whatever their project's status.  The "Backlog" and "Ideas" templates
keep every "Ongoing" row visible so that backlogged and idea items can be added to them.

##### Layout
The items should be presented as a hierarchical list of ongoing/project w/ child tasks.  Parent rows (ongoing and
project) and task rows use entirely different column sets.  Columns for parents must align with the columns of other
parents, and columns for tasks must align with the task columns under other parents.

All fields except description should be shown as columns, with the following exceptions:
- "Blocked" is not a column; it is shown only via the row mask described below.
- "Start Date Firm" and "End Date Firm" are not columns; each is shown only as an icon on its corresponding date.

The description (and, for projects and tasks, the dependencies) is made available by an "expand" arrow on every
row, including "Ongoing" rows; it is the first of the buttons at the right-hand end of the row.  Any number of
items may be expanded at once and buttons at the top allow expansion and collapse of all at once.  Independently,
a caret at the far left of each "Ongoing"/"Project" row collapses its tasks (remembered across reloads); the
count shown after a collapsed parent's title is of the tasks that pass the current filters, and a second pair of
buttons at the top collapses or expands the tasks of every parent at once.

A "Nested / Flat" icon pair (next to the "Wide / Narrow" pair, both like the view switch) chooses the layout:
"Flat" removes the "Ongoing"/"Project" rows and shows that information within each task row instead, in the column
order: Ongoing/Project key, task key, Ongoing/Project title, task title, and then the remaining task columns.

Dependencies ("Blocked by" / "Blocks") and attachments in the expanded row each have a small "+" button: for
dependencies it opens the dropdown of items, for attachments the file picker.  Attachment chips sit below the
"Attachments" header, left-aligned, to the right of the dependencies; each section sits in a subtle frame.  A rejected cyclic dependency is reported in a
snack that stays up longer than usual.

In the nested layout each "Ongoing"/"Project" row and its tasks form a framed block of their own, separated from
the header and from the other blocks by a small gap with nothing drawn across it, so it is clear which tasks
belong to which parent; in Flat the table is one frame and a heavier rule sits above the first task of each
parent while tasks are grouped.  The Timeline beside the nested table is framed the same way: its date axis and
each group are outlined separately and nothing is drawn across the gaps.

The order of items is user-specified via drag-and-drop of a handle at the far right of the row (after the
Delete button), and the order is persisted.  In Flat, dragging only reorders a task among its own parent's tasks
and never changes its parent.  The row's buttons, left to right, are: expand, add task (parents) or move to
another parent (tasks), delete, and the drag handle; they are icons, not text glyphs.

Sorting: clicking a column header sorts by that column (ascending, then descending on a second click, removed on a
third; Urgency and Importance start descending instead); clicking further headers appends them, so the order in which headers are clicked is the multi-column sort
order.  "User-defined" (the drag order) remains available and is the default; a Sort menu lists the columns in
effect.  An option pushes blocked items to the bottom regardless of the sort.  While a sort is in effect rows
cannot be dragged.

Each task row has a "reassign parent" button that moves it to another "Ongoing"/"Project".

Every column except the title can be hidden from a Columns menu (a per-user preference).  The toolbar buttons
are icons with mouseover descriptions.

##### Creating, editing, and deleting
- "New Ongoing" and "New Project" buttons at the top add a blank row to the table for the user to fill in, with its
  description pre-expanded.  The row is created when the title is confirmed with Enter or the ✓ button.
- Every "Ongoing" and "Project" row has an "Add task" button that adds a blank child task row in the same manner.
- There is no separate edit mode: to edit a field the user simply clicks into it, and the change is saved
  immediately.  The toggle before a date shows "~" while the date is approximate and a pin icon once it is firm;
  clicking it switches between the two.  The urgency and importance fields accept digits only.
- A new row is tinted exactly like its saved neighbours (including its parent's colour when tasks are coloured
  by parent) and marked as unsaved by an accent bar at its left.
- Each row offers a "Delete" option (see Deletion above).

##### Views
Buttons at the top should allow toggling between the default view described above and two alternate views: "Plan" and
"Matrix".  For both of these, all columns except title should disappear so that space is made available on the
right-hand side of the screen.

"Plan" view should display a timeline in Gantt style:
- The time window defaults to one month before today through three months after today.  It must be zoomable and
  scrollable: a plain mouse wheel scrolls the page, Shift or Alt with the wheel pans the timeline sideways, Ctrl
  with the wheel zooms, and dragging the background pans.  The date axis stays visible under the title bar while
  the page scrolls, as does the table's header row in every view.
- A Project missing its own start or end, and every Ongoing (which has no dates), gets that end from its tasks:
  the earliest task start and the latest task end.  A derived end is drawn distinctly (hatched, dashed edge),
  is never firm, has no remove button and cannot be dragged; on a Project, clicking or dragging it pins a real
  date.  Ongoing bars are read-only.
- Bar tooltips (and the item tooltip used by the Matrix and the dependency chips) name a task's
  "Ongoing"/"Project" above the task's own key and title.
- The ends of each bar are rendered according to the corresponding date:
  - Firm date: hard edge
  - Non-firm date: soft but tight edge
  - No date: a very long fade-out extending from the other end of the bar
- Items with neither a start nor an end date are not rendered on the timeline.
- Bars are coloured by assignee by default; an option (per user) colours them instead by owner, importance,
  urgency, or a combination of importance and urgency.

"Matrix" view should plot all visible tasks (tasks only, since parents have no urgency/importance) in an X-Y scatter
with "Importance" plotted on the y-axis and "Urgency" plotted on the x-axis.  Points should be jittered so that tasks
with identical values are all visible.  Mousing-over a point should display its title and description.  A toggle
above the plot (a per-user preference) labels the points with the task key or with its title.  The plot keeps its
place in the viewport while the list beside it scrolls.

##### Highlighting
Every "Ongoing" and "Project" may be given a colour of its own (a "Colour" box in its expanded row opens a palette,
a custom colour, or back to none); the colour is stored with the item and shared by everyone.  How it shows is per
user, in a "Colours" menu in the toolbar: "Ongoing"/"Project" rows tinted with their own colour when they have one
(otherwise, or when the user prefers it, the per-type colour from Settings, which is the default look), and task
rows tinted either with the Task colour from Settings (default) or with their "Ongoing"/"Project" colour; in the
latter case parent rows are tinted much more strongly than their tasks so the two remain distinct.  A row's
expanded details carry the same tint as the row.  The Timeline's bar colouring and the Matrix's point colouring
each offer an "Ongoing / Project" mode using the same colours.

The "Owner" and "Assignee" fields should be highlighted categorically using each user's color.  "Urgency" and
"Importance" should each be highlighted individually as follows:
- 0-5: no color
- 6-8: orange
- 9-10: bold red

End dates (for both projects and tasks) should be highlighted as follows:
- Within the next week (7 calendar days): orange
- Today or overdue: bold red

Items that are "blocked" should have the whole row greyed out via a mask (so other highlighting is still visible).

No highlighting of any kind is applied to "Done" or "Cancelled" items.

#### Backlog
This filter shows all items of status "Backlog" with the same columns and behaviour as the Active filter.
A backlog project is shown with all of its tasks.  A backlog task under an "Ongoing" is shown beneath its parent.

#### Ideas
Same as the Backlog filter but for ideas.

#### Search and filters
Free text over key, title and description; type, status (with an optional "or closed within N days"), owner,
assignee, blocked and end-date filters.  The status filter follows the "project status supersedes its tasks" rule
and never excludes Ongoing rows.  Filters also apply to the "Plan" (Timeline) and "Matrix" views.

## Android app
A phone client for the same server, kept in `android/` of this repository and built against the same JSON API
(the server is not changed for it).  See `android/README.md` for the design.

### Platforms and access
- Android 16 and 17, and the current GrapheneOS.  Portrait only; no landscape layouts.
- Built for GrapheneOS first: no Google Play Services and no third-party services of any kind.  Installation is
  by signed APK from the repository's GitHub releases (Obtainium); sideloading is the secondary path.
- The server is reached on the LAN or through the user's WireGuard tunnel, over plain HTTP.  The tunnel is not
  always on, so the app must send user data only when it can see the server: it talks to the configured server
  address and to nothing else, and checks reachability before sending queued changes.

### Offline tolerance
- The app keeps a local copy of the data and reads only from it; no screen waits on the network.
- Changes made while offline are queued and replayed in order when the server is reachable; conflicts resolve
  last-writer-wins per field, as in the web UI.  Items created offline show a placeholder key until the server
  assigns one, and cannot be given dependencies or reordered until then.
- Attachment bytes are fetched on demand; uploads are queued like other changes.

### Screens
- Setup: server address and account (one of the server's users; no password), both changeable in Settings.
- List: the Active / Backlog / Ideas templates, search and filters with the same semantics as the web UI (owner
  and assignee filters accept several choices, any of which matches);
  Nested (parents with their tasks) or Flat; the same highlighting rules.  A detail screen edits every field in
  place with no edit mode, and shows dependencies, attachments and the status history.
- Timeline and Matrix: full-screen versions of the web views (no adjacent table), with the same drawing rules,
  colouring modes, zoom/pan, and drag editing.  In the Matrix, tapping the selected task's title opens it.
- Attachments: files and photos from the device, and photos taken with the camera.
- Settings: server and account, sync status and errors, notification time, users, app settings.

### Notifications
A daily local notification at a configurable time lists the account's open items that are overdue, due today
or due within a configurable number of days ahead (default 7; 0 means overdue and due today only).  It needs no
network.
