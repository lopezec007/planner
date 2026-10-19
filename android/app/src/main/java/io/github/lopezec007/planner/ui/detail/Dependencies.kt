// The "Blocked by" and "Blocks" lists of the detail screen (spec
// "Dependencies"): chips of key + title that open the other item, a ✕ to
// remove the link, and a + that picks from the projects and tasks not yet
// linked. Both are off while the item is unsynced (negative id), since the
// server knows nothing of it yet.
package io.github.lopezec007.planner.ui.detail

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.lopezec007.planner.data.model.Item
import io.github.lopezec007.planner.data.model.ItemType
import io.github.lopezec007.planner.data.repo.Snapshot
import io.github.lopezec007.planner.ui.components.KeyText
import io.github.lopezec007.planner.ui.components.StatusChip
import io.github.lopezec007.planner.ui.theme.LocalPalette

/** Which side of the link the picker adds to. */
private enum class Side(val title: String) { BLOCKED_BY("Blocked by"), BLOCKS("Blocks") }

/**
 * [onAdd] and [onRemove] take (blockerId, blockedId) as the repository does.
 */
@Composable
internal fun DependenciesSection(
    item: Item,
    snap: Snapshot,
    onOpen: (Long) -> Unit,
    onAdd: (blockerId: Long, blockedId: Long) -> Unit,
    onRemove: (blockerId: Long, blockedId: Long) -> Unit,
) {
    var adding by remember { mutableStateOf<Side?>(null) }

    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Link, contentDescription = null, tint = LocalPalette.current.subtle)
            Spacer(Modifier.width(12.dp))
            Text("Dependencies", style = MaterialTheme.typography.titleSmall)
        }
        if (item.isLocal) {
            Text(
                "Available once synced",
                style = MaterialTheme.typography.bodySmall,
                color = LocalPalette.current.subtle,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        DependencyList(
            side = Side.BLOCKED_BY,
            ids = item.blockedBy,
            snap = snap,
            enabled = !item.isLocal,
            onOpen = onOpen,
            onRemove = { other -> onRemove(other, item.id) },
            onAdd = { adding = Side.BLOCKED_BY },
        )
        DependencyList(
            side = Side.BLOCKS,
            ids = item.blocks,
            snap = snap,
            enabled = !item.isLocal,
            onOpen = onOpen,
            onRemove = { other -> onRemove(item.id, other) },
            onAdd = { adding = Side.BLOCKS },
        )
    }

    val side = adding
    if (side != null) {
        val linked = (item.blockedBy + item.blocks).toSet()
        val candidates = snap.items.filter {
            it.type != ItemType.ONGOING && it.id != item.id && !it.isLocal && it.id !in linked
        }
        PickItemDialog(
            title = "${side.title} ${item.key}",
            candidates = candidates,
            onPick = { other ->
                adding = null
                when (side) {
                    Side.BLOCKED_BY -> onAdd(other, item.id)
                    Side.BLOCKS -> onAdd(item.id, other)
                }
            },
            onDismiss = { adding = null },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DependencyList(
    side: Side,
    ids: List<Long>,
    snap: Snapshot,
    enabled: Boolean,
    onOpen: (Long) -> Unit,
    onRemove: (Long) -> Unit,
    onAdd: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(side.title, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
        IconButton(onClick = onAdd, enabled = enabled) {
            Icon(Icons.Filled.Add, contentDescription = "Add to ${side.title.lowercase()}")
        }
    }
    if (ids.isEmpty()) {
        Text("None", style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.subtle)
        return
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (id in ids) {
            val other = snap.item(id)
            DependencyChip(
                key = other?.key ?: "?",
                title = other?.title ?: "(not available)",
                closed = other?.isClosed == true,
                onClick = { if (other != null) onOpen(id) },
                onRemove = { onRemove(id) },
            )
        }
    }
}

/** Key + truncated title; the whole chip opens the item, the ✕ removes the link. */
@Composable
private fun DependencyChip(key: String, title: String, closed: Boolean, onClick: () -> Unit, onRemove: () -> Unit) {
    AssistChip(
        onClick = onClick,
        label = {
            Text(
                text = "$key  $title",
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = if (closed) LocalPalette.current.subtle else MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.widthIn(max = 220.dp),
            )
        },
        trailingIcon = {
            Icon(
                Icons.Filled.Close,
                contentDescription = "Remove",
                modifier = Modifier
                    .size(18.dp)
                    .clickable(onClick = onRemove),
            )
        },
    )
}

/** A searchable list of items (key, title, status); tapping one picks it. */
@Composable
private fun PickItemDialog(title: String, candidates: List<Item>, onPick: (Long) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val q = query.trim().lowercase()
    val shown = if (q.isEmpty()) candidates else candidates.filter {
        it.key.lowercase().contains(q) || it.title.lowercase().contains(q)
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    placeholder = { Text("Search key or title") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
                    if (shown.isEmpty()) {
                        Text("No matching item.", color = LocalPalette.current.subtle, style = MaterialTheme.typography.bodySmall)
                    }
                    for (c in shown) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onPick(c.id) }
                                .padding(vertical = 8.dp, horizontal = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            KeyText(c.key, modifier = Modifier.width(48.dp))
                            Text(
                                c.title,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f),
                                color = if (c.isClosed) LocalPalette.current.subtle else MaterialTheme.colorScheme.onSurface,
                            )
                            Spacer(Modifier.width(8.dp))
                            StatusChip(c.status)
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
