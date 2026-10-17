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
- All users have full CRUD access to everything.
- Each user is auto-assigned a color (used for categorical highlighting of the Owner and Assignee columns).  The color
  can be changed by the user.

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

For display purposes, a project's status supersedes the statuses of its child tasks: a task is shown wherever its
parent project is shown, regardless of the task's own status.  Since an "Ongoing" has no status, tasks under an
"Ongoing" are displayed according to their own status.

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
listing item key and title.  The Timeline draws a line from the blocking item's end to the blocked item's start;
the Matrix draws subtle lines with arrows pointing from blocker to blocked.

### Deletion
Items can be deleted from the UI.  A deleted item remains in the database but becomes entirely inaccessible in the UI
(it does not appear on any page, including the "Everything" page).

### UI
#### General
The UI should respond to the user's system theme (light/dark).  There is no manual theme override.

#### Navigation
There is a single planner page.  The "Active", "Backlog", "Ideas" and "All" views described below are predefined
filters selected along the top of that page; the search and filter controls apply on top of the selected one.  A
hamburger (☰) menu at the far left of the title bar switches between them and opens Settings.

#### Active (default filter)
This should display:
- All "Ongoing" items, regardless of whether they have any children
- All to-do and in-progress items
- All done and cancelled items that were marked "done" or "cancelled" within the last two weeks

(Subject to the rule that a project's status supersedes its children's for display purposes.)

##### Layout
The items should be presented as a hierarchical list of ongoing/project w/ child tasks.  Parent rows (ongoing and
project) and task rows use entirely different column sets.  Columns for parents must align with the columns of other
parents, and columns for tasks must align with the task columns under other parents.

All fields except description should be shown as columns, with the following exceptions:
- "Blocked" is not a column; it is shown only via the row mask described below.
- "Start Date Firm" and "End Date Firm" are not columns; each is shown only as an icon on its corresponding date.

The description should be made available by an "expand" arrow.  Any number of items may be expanded at once and
buttons at the top should allow expansion and collapse of all at once.  Items with no description should offer no
expand/collapse buttons.

The order of items is user-specified via drag-and-drop, and the order is persisted.

##### Creating, editing, and deleting
- "New Ongoing" and "New Project" buttons at the top add a blank row to the table for the user to fill in, with its
  description pre-expanded.  The row is created when the title is confirmed with Enter or the ✓ button.
- Every "Ongoing" and "Project" row has an "Add task" button that adds a blank child task row in the same manner.
- There is no separate edit mode: to edit a field the user simply clicks into it, and the change is saved
  immediately.  Firm dates are toggled with a clickable "~" before the date ("~" shown = approximate).
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

"Matrix" view should plot all visible tasks (tasks only, since parents have no urgency/importance) in an X-Y scatter
with "Importance" plotted on the y-axis and "Urgency" plotted on the x-axis.  Points should be jittered so that tasks
with identical values are all visible.  Mousing-over a point should display its title and description.

##### Highlighting
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

#### All
This filter shows every item that has not been deleted.  The search and filter controls (free text over key, title
and description; type, status, owner, assignee, blocked and end-date filters) are available with every predefined
filter and also apply to the "Plan" (Timeline) and "Matrix" views.
