// The list view: in Nested mode each parent with its tasks is one rounded,
// outlined card (the parent row is its tinted header, a collapsed parent a
// single-row card), like the web table's groups; Flat is a plain list of
// tasks with the parent named on each row and a heavier rule per group.
// Rows carry the same highlights as the web table: status, assignee, end
// date, urgency, importance and effort; blocked rows are dimmed; closed rows
// carry no highlighting. Pull down to sync. Swipe is deliberately absent (no
// edit mode here: tap a row to open it).
//
// Scrolling: every row is its own LazyColumn item (keyed, with a content
// type), so entering a big group composes one row per frame, not the whole
// card at once. The card is drawn per row instead: the first and last rows
// of a card get its rounded corners and the outline is drawn on each row
// (top and bottom edges on the corner rows, the sides on all), which reads
// as one shape. Rows are built from the snapshot once per change (the
// parent's colour, assignee, blocked state and effort sums are computed in
// buildRows, not during composition), and the row composables take only
// @Immutable values, so a row whose item did not change is skipped when a
// new snapshot arrives. Only blocked rows pay for an alpha layer.
package io.github.lopezec007.planner.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.lopezec007.planner.data.model.AppSettings
import io.github.lopezec007.planner.data.model.Effort
import io.github.lopezec007.planner.data.model.Group
import io.github.lopezec007.planner.data.model.Item
import io.github.lopezec007.planner.data.model.ItemType
import io.github.lopezec007.planner.data.model.User
import io.github.lopezec007.planner.data.repo.Snapshot
import io.github.lopezec007.planner.data.sync.SyncPhase
import io.github.lopezec007.planner.ui.PlannerViewModel
import io.github.lopezec007.planner.ui.components.EffortBadge
import io.github.lopezec007.planner.ui.components.EffortSumText
import io.github.lopezec007.planner.ui.components.EndDateText
import io.github.lopezec007.planner.ui.components.KeyText
import io.github.lopezec007.planner.ui.components.LevelBadge
import io.github.lopezec007.planner.ui.components.StatusChip
import io.github.lopezec007.planner.ui.components.UserChip
import io.github.lopezec007.planner.ui.components.effortSummary
import io.github.lopezec007.planner.ui.theme.LocalPalette
import io.github.lopezec007.planner.ui.theme.hexColor
import kotlinx.coroutines.delay
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/** Gap between cards, corner radius and outline of a card (drawn per row). */
private val CardGap = 8.dp
private val CardCorner = 12.dp
private val CardStroke = 1.dp

/**
 * What one row of the list shows, with everything the row needs resolved
 * (assignee, blocked state, colours, sums), so the row composable takes
 * only immutable values and skips when none of them changed.
 */
@Immutable
private sealed class ListRow {
    abstract val key: String
    abstract val contentType: String

    data class Parent(
        val item: Item,
        val assignee: User?,
        val blocked: Boolean,
        val tint: String,          // the parent's own colour (ColorResolver.ownColor)
        val taskCount: Int,        // tasks shown under it (0 when collapsed hides them is still the count)
        val collapsed: Boolean,
        val effortOpen: Int?,      // sum over its open tasks shown
        val effortAll: Int?,       // sum including closed ones
        val lastOfCard: Boolean,   // collapsed: the header is the whole card
    ) : ListRow() {
        override val key get() = "p${item.id}"
        override val contentType get() = "parent"
    }

    data class Task(
        val item: Item,
        val parent: Item?,
        val assignee: User?,
        val blocked: Boolean,
        val flat: Boolean,
        val firstOfParent: Boolean,
        val lastOfCard: Boolean,   // nested: the card's last row gets the bottom corners
    ) : ListRow() {
        override val key get() = "t${item.id}"
        override val contentType get() = "task"
    }
}

/** The effort over every visible task, for the strip above the list. */
private data class EffortTotals(val tasks: Int, val open: Int?, val all: Int?)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemList(
    vm: PlannerViewModel,
    groups: List<Group>,
    snapshot: Snapshot,
    flat: Boolean,
    collapsed: Set<Long>,
    onOpen: (Long) -> Unit,
    onAddTask: (Long) -> Unit,
    snackbar: SnackbarHostState,
    modifier: Modifier = Modifier,
) {
    val sync by vm.sync.collectAsStateWithLifecycle()
    var refreshing by remember { mutableStateOf(false) }
    LaunchedEffect(refreshing) {
        if (refreshing) {
            vm.requestSync()
            // Keep the indicator up while the engine is busy, with a floor so a quick sync still shows.
            delay(600)
            while (vm.sync.value.phase == SyncPhase.SYNCING) delay(150)
            refreshing = false
        }
    }

    val rows = remember(groups, snapshot, flat, collapsed) { buildRows(groups, snapshot, flat, collapsed) }
    val totals = remember(groups) {
        val tasks = groups.flatMap { it.tasks }
        EffortTotals(tasks.size, Effort.sumOpen(tasks), Effort.sum(tasks))
    }

    Column(modifier) {
        EffortStrip(totals)
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = { refreshing = true }, modifier = Modifier.fillMaxSize()) {
            if (rows.isEmpty()) {
                EmptyState(snapshot, sync.phase)
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = if (flat) PaddingValues(0.dp) else PaddingValues(horizontal = 8.dp, vertical = 8.dp),
                ) {
                    items(rows, key = { it.key }, contentType = { it.contentType }) { row ->
                        when (row) {
                            is ListRow.Parent -> ParentRow(
                                row,
                                onOpen = { onOpen(row.item.id) },
                                onToggle = { vm.toggleCollapsed(row.item.id) },
                                onAddTask = { onAddTask(row.item.id) },
                            )
                            is ListRow.Task -> TaskRow(row, snapshot.settings, onOpen = { onOpen(row.item.id) })
                        }
                    }
                    item(key = "end", contentType = "end") { Spacer(Modifier.height(80.dp)) } // room above the FAB
                }
            }
        }
    }
}

/** The rows in display order: nested, a header plus the tasks of each uncollapsed parent; flat, the tasks only. */
private fun buildRows(groups: List<Group>, snap: Snapshot, flat: Boolean, collapsed: Set<Long>): List<ListRow> {
    val out = ArrayList<ListRow>()
    for (g in groups) {
        if (flat) {
            g.tasks.forEachIndexed { i, t ->
                out.add(ListRow.Task(t, g.parent, snap.user(t.assigneeId), snap.isBlocked(t), flat = true, firstOfParent = i == 0, lastOfCard = false))
            }
            continue
        }
        val isCollapsed = g.parent.id in collapsed
        out.add(
            ListRow.Parent(
                item = g.parent,
                assignee = snap.user(g.parent.assigneeId),
                blocked = snap.isBlocked(g.parent),
                tint = snap.colors.ownColor(g.parent),
                taskCount = g.tasks.size,
                collapsed = isCollapsed,
                effortOpen = Effort.sumOpen(g.tasks),
                effortAll = Effort.sum(g.tasks),
                lastOfCard = isCollapsed || g.tasks.isEmpty(),
            ),
        )
        if (isCollapsed) continue
        g.tasks.forEachIndexed { i, t ->
            out.add(
                ListRow.Task(
                    t, g.parent, snap.user(t.assigneeId), snap.isBlocked(t),
                    flat = false, firstOfParent = i == 0, lastOfCard = i == g.tasks.lastIndex,
                ),
            )
        }
    }
    return out
}

/** "12 tasks · 18h 30m" (open effort; "· 22h with closed" when closed tasks add to it) over the list; nothing without effort. */
@Composable
private fun EffortStrip(totals: EffortTotals) {
    val summary = effortSummary(totals.open, totals.all) ?: return
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
            .padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "${totals.tasks} task${if (totals.tasks == 1) "" else "s"} · $summary",
            style = MaterialTheme.typography.labelMedium,
            color = LocalPalette.current.subtle,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun EmptyState(snapshot: Snapshot, phase: SyncPhase) {
    val text = when {
        !snapshot.loaded && phase == SyncPhase.OFFLINE -> "Nothing here yet. The server could not be reached — once it can, your items will appear."
        !snapshot.loaded -> "Loading…"
        else -> "Nothing matches the current filters."
    }
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(text, style = MaterialTheme.typography.bodyLarge, color = LocalPalette.current.subtle)
    }
}

// ---------------------------------------------------------------- the card, drawn per row

/**
 * A row's share of its card's shape: the gap below the card after its last
 * row, and rounded corners (a clip, so the header tint and the ripple
 * follow them) on the first and last rows. Middle rows need no clip and so
 * no graphics layer. Goes before the row's background; [cardEdge] after it.
 */
private fun Modifier.cardShape(first: Boolean, last: Boolean): Modifier {
    val gap = if (last) this.padding(bottom = CardGap) else this
    if (!first && !last) return gap
    val r = CardCorner
    return gap.clip(RoundedCornerShape(topStart = if (first) r else 0.dp, topEnd = if (first) r else 0.dp, bottomStart = if (last) r else 0.dp, bottomEnd = if (last) r else 0.dp))
}

/** A row's share of the card's outline: the sides on every row, the top edge on the first, the bottom edge on the last. */
private fun Modifier.cardEdge(first: Boolean, last: Boolean, outline: Color): Modifier =
    drawBehind { drawCardEdge(first, last, outline, CardCorner, CardStroke) }

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawCardEdge(first: Boolean, last: Boolean, color: Color, corner: Dp, stroke: Dp) {
    val w = size.width
    val h = size.height
    val r = corner.toPx()
    val sw = stroke.toPx()
    val half = sw / 2
    val style = Stroke(sw)
    val top = if (first) half + r else 0f
    val bottom = if (last) h - half - r else h
    drawLine(color, Offset(half, top), Offset(half, bottom), sw)
    drawLine(color, Offset(w - half, top), Offset(w - half, bottom), sw)
    if (first) {
        val p = Path().apply {
            moveTo(half, half + r)
            arcTo(Rect(half, half, half + 2 * r, half + 2 * r), 180f, 90f, false)
            lineTo(w - half - r, half)
            arcTo(Rect(w - half - 2 * r, half, w - half, half + 2 * r), 270f, 90f, false)
        }
        drawPath(p, color, style = style)
    }
    if (last) {
        val p = Path().apply {
            moveTo(w - half, h - half - r)
            arcTo(Rect(w - half - 2 * r, h - half - 2 * r, w - half, h - half), 0f, 90f, false)
            lineTo(half + r, h - half)
            arcTo(Rect(half, h - half - 2 * r, half + 2 * r, h - half), 90f, 90f, false)
        }
        drawPath(p, color, style = style)
    }
}

// ---------------------------------------------------------------- rows

@Composable
private fun ParentRow(row: ListRow.Parent, onOpen: () -> Unit, onToggle: () -> Unit, onAddTask: () -> Unit) {
    val item = row.item
    val palette = LocalPalette.current
    val tint = hexColor(row.tint, MaterialTheme.colorScheme.primary)
    val dim = row.blocked && !item.isClosed
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .cardShape(first = true, last = row.lastOfCard)
            .background(tint.copy(alpha = 0.10f))
            .cardEdge(first = true, last = row.lastOfCard, outline = MaterialTheme.colorScheme.outline)
            .then(if (dim) Modifier.alpha(0.55f) else Modifier)
            .clickable(onClick = onOpen)
            .padding(start = 4.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onToggle, modifier = Modifier.width(32.dp)) {
            Icon(
                if (row.collapsed) Icons.Filled.KeyboardArrowDown else Icons.Filled.KeyboardArrowUp,
                if (row.collapsed) "Show tasks" else "Hide tasks",
            )
        }
        Box(Modifier.width(4.dp).height(28.dp).background(tint))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                KeyText(item.key)
                Text(
                    item.title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (item.type == ItemType.PROJECT) StatusChip(item.status)
                row.assignee?.let { UserChip(it, muted = item.isClosed) }
                EndDateText(item)
                if (row.collapsed && row.taskCount > 0) {
                    Text("${row.taskCount} task${if (row.taskCount == 1) "" else "s"}", style = MaterialTheme.typography.labelSmall, color = palette.subtle)
                }
                EffortSumText(row.effortOpen, row.effortAll)
            }
        }
        IconButton(onClick = onAddTask) { Icon(Icons.Filled.Add, "Add task") }
    }
}

@Composable
private fun TaskRow(row: ListRow.Task, settings: AppSettings, onOpen: () -> Unit) {
    val item = row.item
    val palette = LocalPalette.current
    val tint = hexColor(settings.colorTask, Color.Transparent)
    val dim = row.blocked && !item.isClosed
    Column(
        Modifier
            .fillMaxWidth()
            .then(if (row.flat) Modifier else Modifier.cardShape(first = false, last = row.lastOfCard).cardEdge(first = false, last = row.lastOfCard, outline = MaterialTheme.colorScheme.outline)),
    ) {
        if (row.flat && row.firstOfParent) HorizontalDivider(thickness = 2.dp, color = palette.parentBorder)
        else HorizontalDivider(thickness = 1.dp, color = palette.rowBorder)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .then(if (tint == Color.Transparent) Modifier else Modifier.background(tint.copy(alpha = 0.08f)))
                .then(if (dim) Modifier.alpha(0.5f) else Modifier)
                .clickable(onClick = onOpen)
                .padding(start = if (row.flat) 12.dp else 44.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                if (row.flat && row.parent != null) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        KeyText(row.parent.key)
                        Text(row.parent.title, fontSize = 12.sp, color = palette.subtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    KeyText(item.key)
                    Text(
                        item.title,
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = if (item.isClosed) palette.subtle else MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                }
                Spacer(Modifier.height(3.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    StatusChip(item.status)
                    row.assignee?.let { UserChip(it, muted = item.isClosed) }
                    LevelBadge("urgency", item.urgency, settings, item.isClosed)
                    LevelBadge("importance", item.importance, settings, item.isClosed)
                    EffortBadge(item.effort)
                    EndDateText(item)
                    if (item.attachments.isNotEmpty()) {
                        Text("📎${item.attachments.size}", style = MaterialTheme.typography.labelSmall, color = palette.subtle)
                    }
                }
            }
        }
    }
}
