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

Items should be keyed based on their type and in increasing numeric order (e.g. "O-1, O-2, P-1, P-2, T-1, T-2, etc.).
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
- Assignee: dropdown of users, with one additional option of "Shared".  ("Shared" is not an option for Owner.)

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

### Deletion
Items can be deleted from the UI.  A deleted item remains in the database but becomes entirely inaccessible in the UI
(it does not appear on any page, including the "Everything" page).

### UI
#### General
The UI should respond to the user's system theme (light/dark).  There is no manual theme override.

#### Homepage
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
- A "New" button at the top adds a blank row to the table for the user to fill in, with its description pre-expanded.
- Every "Ongoing" and "Project" row has an "Add task" button that adds a blank child task row in the same manner.
- Editing is done directly within the table but must be enabled via a per-row "Edit" button, so that clicking into a
  cell does not accidentally change anything.
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
This should display all items of status "Backlog" with the same columns and behaviour as the default homepage view.
A backlog project is shown with all of its tasks.  A backlog task under an "Ongoing" is shown beneath its parent.

#### Ideas
Same as backlog page but for ideas.

#### Everything
This should display every item that has not been deleted, with the same columns and behaviour as the default
homepage view.  The "Plan" and "Matrix" views do not apply to this page.  It should additionally offer search and
filter functionality.
