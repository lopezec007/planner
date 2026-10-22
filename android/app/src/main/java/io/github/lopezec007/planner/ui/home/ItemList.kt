// The list view: in Nested mode each parent with its tasks is one rounded,
// outlined card (the parent row is its tinted header, a collapsed parent a
// single-row card), like the web table's groups; Flat is a plain list of
// tasks with the parent named on each row and a heavier rule per group.
// Rows carry the same highlights as the web table: status, assignee, end
// date, urgency and importance; blocked rows are dimmed; closed rows carry
// no highlighting. Pull down to sync. Swipe is deliberately absent (no edit
// mode here: tap a row to open it).
package io.github.lopezec007.planner.ui.home

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.lopezec007.planner.data.model.Group
import io.github.lopezec007.planner.data.model.Item
import io.github.lopezec007.planner.data.model.ItemType
import io.github.lopezec007.planner.data.repo.Snapshot
import io.github.lopezec007.planner.data.sync.SyncPhase
import io.github.lopezec007.planner.ui.PlannerViewModel
import io.github.lopezec007.planner.ui.components.EndDateText
import io.github.lopezec007.planner.ui.components.KeyText
import io.github.lopezec007.planner.ui.components.LevelBadge
import io.github.lopezec007.planner.ui.components.StatusChip
import io.github.lopezec007.planner.ui.components.UserChip
import io.github.lopezec007.planner.ui.theme.LocalPalette
import io.github.lopezec007.planner.ui.theme.hexColor
import kotlinx.coroutines.delay
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/** What one row of the list shows. */
private sealed class ListRow {
    data class Parent(val item: Item, val taskCount: Int, val collapsed: Boolean) : ListRow()
    data class Task(val item: Item, val parent: Item?, val flat: Boolean, val firstOfParent: Boolean) : ListRow()
}

/** One card of the nested list: the parent row and, unless collapsed, its task rows. */
private data class ListCard(val parent: ListRow.Parent, val tasks: List<ListRow.Task>)

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

    PullToRefreshBox(isRefreshing = refreshing, onRefresh = { refreshing = true }, modifier = modifier) {
        if (groups.isEmpty() || (flat && groups.all { it.tasks.isEmpty() })) {
            EmptyState(snapshot, sync.phase)
        } else if (flat) {
            val rows = remember(groups) { buildFlatRows(groups) }
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(rows, key = { "t${it.item.id}" }) { row -> TaskRow(row, snapshot, onOpen = { onOpen(row.item.id) }) }
                item { Spacer(Modifier.height(88.dp)) } // room above the FAB
            }
        } else {
            // One LazyColumn item per card: a group is small (one parent's
            // tasks), and the card's outline is then a single shape.
            val cards = remember(groups, collapsed) { buildCards(groups, collapsed) }
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(cards, key = { "p${it.parent.item.id}" }) { card ->
                    GroupCard(
                        card, snapshot,
                        onOpen = onOpen,
                        onToggle = { vm.toggleCollapsed(card.parent.item.id) },
                        onAddTask = { onAddTask(card.parent.item.id) },
                    )
                }
                item { Spacer(Modifier.height(80.dp)) } // room above the FAB
            }
        }
    }
}

private fun buildFlatRows(groups: List<Group>): List<ListRow.Task> {
    val out = ArrayList<ListRow.Task>()
    for (g in groups) g.tasks.forEachIndexed { i, t -> out.add(ListRow.Task(t, g.parent, flat = true, firstOfParent = i == 0)) }
    return out
}

private fun buildCards(groups: List<Group>, collapsed: Set<Long>): List<ListCard> = groups.map { g ->
    val isCollapsed = g.parent.id in collapsed
    ListCard(
        parent = ListRow.Parent(g.parent, g.tasks.size, isCollapsed),
        tasks = if (isCollapsed) emptyList() else g.tasks.mapIndexed { i, t -> ListRow.Task(t, g.parent, flat = false, firstOfParent = i == 0) },
    )
}

/** A parent and its tasks in one rounded, outlined card; the shape clips the header's tint. */
@Composable
private fun GroupCard(card: ListCard, snapshot: Snapshot, onOpen: (Long) -> Unit, onToggle: () -> Unit, onAddTask: () -> Unit) {
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            ParentRow(card.parent, snapshot, onOpen = { onOpen(card.parent.item.id) }, onToggle = onToggle, onAddTask = onAddTask)
            for (t in card.tasks) TaskRow(t, snapshot, onOpen = { onOpen(t.item.id) })
        }
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

@Composable
private fun ParentRow(row: ListRow.Parent, snapshot: Snapshot, onOpen: () -> Unit, onToggle: () -> Unit, onAddTask: () -> Unit) {
    val item = row.item
    val palette = LocalPalette.current
    val tint = hexColor(snapshot.colors.ownColor(item), MaterialTheme.colorScheme.primary)
    val blocked = snapshot.isBlocked(item)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(tint.copy(alpha = 0.10f))
            .clickable(onClick = onOpen)
            .alpha(if (blocked && !item.isClosed) 0.55f else 1f)
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
                snapshot.user(item.assigneeId)?.let { UserChip(it, muted = item.isClosed) }
                EndDateText(item)
                if (row.collapsed && row.taskCount > 0) {
                    Text("${row.taskCount} task${if (row.taskCount == 1) "" else "s"}", style = MaterialTheme.typography.labelSmall, color = palette.subtle)
                }
            }
        }
        IconButton(onClick = onAddTask) { Icon(Icons.Filled.Add, "Add task") }
    }
}

@Composable
private fun TaskRow(row: ListRow.Task, snapshot: Snapshot, onOpen: () -> Unit) {
    val item = row.item
    val palette = LocalPalette.current
    val blocked = snapshot.isBlocked(item)
    val tint = hexColor(snapshot.settings.colorTask, Color.Transparent)
    if (row.flat && row.firstOfParent) HorizontalDivider(thickness = 2.dp, color = palette.parentBorder)
    else HorizontalDivider(thickness = 1.dp, color = palette.rowBorder)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(tint.copy(alpha = if (tint == Color.Transparent) 0f else 0.08f))
            .clickable(onClick = onOpen)
            .alpha(if (blocked && !item.isClosed) 0.5f else 1f)
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
                snapshot.user(item.assigneeId)?.let { UserChip(it, muted = item.isClosed) }
                LevelBadge("urgency", item.urgency, snapshot.settings, item.isClosed)
                LevelBadge("importance", item.importance, snapshot.settings, item.isClosed)
                EndDateText(item)
                if (item.attachments.isNotEmpty()) {
                    Text("📎${item.attachments.size}", style = MaterialTheme.typography.labelSmall, color = palette.subtle)
                }
            }
        }
    }
}
