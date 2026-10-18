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
- Target desktop browsers only.  An Android app with a mobile-bespoke UI will be built separately later.

### Users
- Users are managed in-app.  There is no authentication.
- Each user is also an "account": a menu in the title bar selects who is using the browser (no password).  Per-user
  preferences (view, Flat, Narrow, collapsed parents, sort, blocked-last, hidden columns, the filter settings,
  timeline bar and matrix point colouring, and the row colour-coding choices) are stored on the server with the
  user so they follow them to any browser.  With no account selected the browser keeps its own.
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
type filters that produce that view (and the search box and other filters apply on top).  With no filters the page
shows everything.  A gear icon at the far left of the title bar opens Settings, which has a button back to the
items.

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
row, including "Ongoing" rows.  Any number of items may be expanded at once and buttons at the top allow
expansion and collapse of all at once.  Independently, a caret on each "Ongoing"/"Project" row collapses its
tasks (remembered across reloads).

A "Nested / Flat" icon pair (next to the "Wide / Narrow" pair, both like the view switch) chooses the layout:
"Flat" removes the "Ongoing"/"Project" rows and shows that information within each task row instead, in the column
order: Ongoing/Project key, task key, Ongoing/Project title, task title, and then the remaining task columns.

Dependencies ("Blocked by" / "Blocks") and attachments in the expanded row each have a small "+" button: for
dependencies it opens the dropdown of items, for attachments the file picker.  Attachment chips sit below the
"Attachments" header, left-aligned, to the right of the dependencies; each section sits in a subtle frame.  A rejected cyclic dependency is reported in a
snack that stays up longer than usual.

The border above each "Ongoing"/"Project" row is heavier than the one between tasks, so it is clear which tasks
belong to which parent; in Flat the same rule sits above the first task of each parent while tasks are grouped.

The order of items is user-specified via drag-and-drop, and the order is persisted.  In Flat, dragging only
reorders a task among its own parent's tasks and never changes its parent.

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
  clicking it switches between the two.
- Each row offers a "Delete" option (see Deletion above).

##### Views
Buttons at the top should allow toggling between the default view described above and two alternate views: "Plan" and
"Matrix".  For both of these, all columns except title should disappear so that space is made available on the
right-hand side of the screen.

"Plan" view should display a timeline in Gantt style:
- The time window defaults to one month before today through three months after today.  It must be zoomable and
  scrollable.
- The ends of each bar are rendered according to the corresponding date:
  - Firm date: hard edge
  - Non-firm date: soft but tight edge
  - No date: a very long fade-out extending from the other end of the bar
- Items with neither a start nor an end date are not rendered on the timeline.
- Bars are coloured by assignee by default; an option (per user) colours them instead by owner, importance,
  urgency, or a combination of importance and urgency.

"Matrix" view should plot all visible tasks (tasks only, since parents have no urgency/importance) in an X-Y scatter
with "Importance" plotted on the y-axis and "Urgency" plotted on the x-axis.  Points should be jittered so that tasks
with identical values are all visible.  Mousing-over a point should display its title and description.

##### Highlighting
Every "Ongoing" and "Project" may be given a colour of its own (a swatch before its title opens a palette, a custom
colour, or back to none); the colour is stored with the item and shared by everyone.  How it shows is per user, in a
"Colours" menu in the toolbar: "Ongoing"/"Project" rows tinted with their own colour when they have one (otherwise,
or when the user prefers it, the per-type colour from Settings, which is the default look), and task rows tinted
either with the Task colour from Settings (default) or with their "Ongoing"/"Project" colour.  The Timeline's bar
colouring and the Matrix's point colouring each offer an "Ongoing / Project" mode using the same colours.

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
