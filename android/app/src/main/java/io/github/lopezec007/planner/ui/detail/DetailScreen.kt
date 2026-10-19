// The item screen: every field editable in place with no edit mode (README
// "Using it" step 3), dependencies, attachments and the status history.
// Each change is one PATCH of that field, applied to Room at once; nothing
// here waits for the network. Delete shows an Undo snackbar (the restore
// endpoint) and leaves the screen when it is dismissed.
package io.github.lopezec007.planner.ui.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.lopezec007.planner.data.model.Dates
import io.github.lopezec007.planner.data.model.Item
import io.github.lopezec007.planner.data.model.ItemType
import io.github.lopezec007.planner.data.model.StatusChange
import io.github.lopezec007.planner.data.repo.ItemPatch
import io.github.lopezec007.planner.data.repo.Snapshot
import io.github.lopezec007.planner.data.repo.set
import io.github.lopezec007.planner.ui.PlannerViewModel
import io.github.lopezec007.planner.ui.components.DatePickerDialogFor
import io.github.lopezec007.planner.ui.components.EndDateText
import io.github.lopezec007.planner.ui.components.FieldRow
import io.github.lopezec007.planner.ui.components.KeyText
import io.github.lopezec007.planner.ui.components.LevelSlider
import io.github.lopezec007.planner.ui.components.MarkdownText
import io.github.lopezec007.planner.ui.components.StatusChip
import io.github.lopezec007.planner.ui.components.StatusPickerDialog
import io.github.lopezec007.planner.ui.components.UserChip
import io.github.lopezec007.planner.ui.components.UserPickerDialog
import io.github.lopezec007.planner.ui.nav.Nav
import io.github.lopezec007.planner.ui.nav.Screen
import io.github.lopezec007.planner.ui.theme.LocalPalette
import io.github.lopezec007.planner.ui.theme.contrastOn
import io.github.lopezec007.planner.ui.theme.hexColor
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** The item colours offered for an Ongoing or Project (the web swatch's PALETTE). */
private val ITEM_PALETTE = listOf(
    "#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2", "#edc948",
    "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac", "#2a9d8f", "#5b6cff",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(vm: PlannerViewModel, nav: Nav, requestedId: Long) {
    val snap by vm.snapshot.collectAsStateWithLifecycle()
    // An item created offline is opened under its temporary id; once the
    // server has answered, that id maps to the real one and we follow it.
    val remapped by vm.repo.remappedIds.collectAsStateWithLifecycle()
    val itemId = remapped[requestedId] ?: requestedId
    val item = snap.item(itemId)
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    // True from the moment Delete is confirmed until its snackbar is undone or dismissed.
    var deleting by remember { mutableStateOf(false) }

    LaunchedEffect(itemId, item?.type) {
        if (item != null && item.type != ItemType.ONGOING) vm.repo.refreshHistory(itemId)
    }

    if (item == null) {
        GoneScreen(
            message = when {
                deleting -> "Deleted"
                !snap.loaded -> ""
                else -> "This item is gone."
            },
            snackbar = snackbar,
            onBack = { nav.pop() },
        )
        return
    }

    val patch: (ItemPatch) -> Unit = { p -> scope.launch { vm.repo.patchItem(itemId, p) } }
    val toast: (String) -> Unit = { msg -> scope.launch { snackbar.showSnackbar(msg) } }
    var confirmDelete by remember { mutableStateOf(false) }
    var moving by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            DetailTopBar(
                item = item,
                parent = item.parentId?.let { snap.item(it) },
                onBack = { nav.pop() },
                onOpenParent = { id -> nav.push(Screen.Detail(id)) },
                onDelete = { confirmDelete = true },
                onMove = { moving = true },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(bottom = 32.dp),
        ) {
            TitleField(title = item.title, onSave = { patch(ItemPatch(title = set(it))) })
            HorizontalDivider()
            Fields(item = item, snap = snap, patch = patch)
            HorizontalDivider()
            DescriptionSection(description = item.description, onSave = { patch(ItemPatch(description = set(it))) })
            if (item.type != ItemType.ONGOING) {
                HorizontalDivider()
                DependenciesSection(
                    item = item,
                    snap = snap,
                    onOpen = { id -> nav.push(Screen.Detail(id)) },
                    onAdd = { blockerId, blockedId ->
                        scope.launch {
                            val reason = vm.repo.addDependency(blockerId, blockedId, snap)
                            if (reason != null) snackbar.showSnackbar("Not added: $reason")
                        }
                    },
                    onRemove = { blockerId, blockedId -> scope.launch { vm.repo.removeDependency(blockerId, blockedId) } },
                )
            }
            HorizontalDivider()
            AttachmentsSection(itemId = itemId, attachments = item.attachments, vm = vm, snackbar = snackbar)
            if (item.type != ItemType.ONGOING) {
                HorizontalDivider()
                val historyFlow = remember(itemId) { vm.repo.history(itemId) }
                val history by historyFlow.collectAsStateWithLifecycle(initialValue = emptyList())
                HistorySection(history = history)
            }
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete ${item.key}?") },
            text = {
                Text(
                    if (item.isParent) "\"${item.title}\" and its tasks will be deleted. You can undo for a moment afterwards."
                    else "\"${item.title}\" will be deleted. You can undo for a moment afterwards.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    deleting = true
                    val label = item.key
                    scope.launch {
                        vm.repo.deleteItem(itemId)
                        val result = snackbar.showSnackbar(
                            message = "Deleted $label",
                            actionLabel = "Undo",
                            withDismissAction = true,
                            duration = SnackbarDuration.Long,
                        )
                        if (result == SnackbarResult.ActionPerformed) {
                            vm.repo.restoreItem(itemId)
                            deleting = false
                        } else {
                            nav.pop()
                        }
                    }
                }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }

    if (moving) {
        MoveDialog(
            item = item,
            parents = snap.items.filter { it.isParent && it.id != item.parentId },
            onPick = { parentId ->
                moving = false
                scope.launch {
                    vm.repo.reparent(itemId, parentId)
                    toast("Moved under ${snap.item(parentId)?.key ?: "its new parent"}")
                }
            },
            onDismiss = { moving = false },
        )
    }
}

// ---------------------------------------------------------------- frame

/** Shown while the item is not in the snapshot: loading, just deleted (undo pending), or gone for good. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GoneScreen(message: String, snackbar: SnackbarHostState, onBack: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
            if (message.isNotEmpty()) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(message, style = MaterialTheme.typography.bodyLarge)
                    Spacer(Modifier.height(16.dp))
                    TextButton(onClick = onBack) { Text("Back") }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DetailTopBar(
    item: Item,
    parent: Item?,
    onBack: () -> Unit,
    onOpenParent: (Long) -> Unit,
    onDelete: () -> Unit,
    onMove: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    TopAppBar(
        title = {
            Column {
                KeyText(item.key)
                if (item.type == ItemType.TASK) {
                    val parentLabel = parent?.let { "${it.key}  ${it.title}" } ?: "No parent"
                    Text(
                        text = parentLabel,
                        style = MaterialTheme.typography.bodyMedium,
                        color = LocalPalette.current.accent,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .then(if (parent != null) Modifier.clickable { onOpenParent(parent.id) } else Modifier),
                    )
                } else {
                    Text(item.type.label, style = MaterialTheme.typography.bodyMedium, color = LocalPalette.current.subtle)
                }
            }
        },
        navigationIcon = {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
        },
        actions = {
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                if (item.type == ItemType.TASK) {
                    DropdownMenuItem(text = { Text("Move to…") }, onClick = { menu = false; onMove() })
                }
                DropdownMenuItem(text = { Text("Delete") }, onClick = { menu = false; onDelete() })
            }
        },
    )
}

/** Picks another Ongoing/Project for a task (the ⇄ button in the web UI). */
@Composable
private fun MoveDialog(item: Item, parents: List<Item>, onPick: (Long) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Move ${item.key} to") },
        text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                if (parents.isEmpty()) Text("No other Ongoing or Project.", color = LocalPalette.current.subtle)
                for (p in parents) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onPick(p.id) }
                            .padding(vertical = 10.dp, horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        KeyText(p.key, modifier = Modifier.width(48.dp))
                        Text(p.title, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

// ---------------------------------------------------------------- fields

/** The title as text; tap to edit in place, Done or leaving the field saves, empty is ignored. */
@Composable
private fun TitleField(title: String, onSave: (String) -> Unit) {
    var editing by remember { mutableStateOf(false) }
    if (!editing) {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier
                .fillMaxWidth()
                .clickable { editing = true }
                .padding(horizontal = 16.dp, vertical = 12.dp),
        )
        return
    }
    var text by remember { mutableStateOf(title) }
    var hadFocus by remember { mutableStateOf(false) }
    var committed by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    val commit: () -> Unit = {
        if (!committed) {
            committed = true
            val t = text.trim()
            if (t.isNotEmpty() && t != title) onSave(t)
            editing = false
        }
    }
    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        singleLine = true,
        label = { Text("Title") },
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .focusRequester(focus)
            .onFocusChanged { state ->
                if (state.isFocused) hadFocus = true else if (hadFocus) commit()
            },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { commit() }),
    )
    LaunchedEffect(Unit) { focus.requestFocus() }
}

/** Status, owner, assignee, dates, levels, blocked and colour, as the type allows. */
@Composable
private fun Fields(item: Item, snap: Snapshot, patch: (ItemPatch) -> Unit) {
    var pickStatus by remember { mutableStateOf(false) }
    var pickOwner by remember { mutableStateOf(false) }
    var pickAssignee by remember { mutableStateOf(false) }
    val dated = item.type != ItemType.ONGOING

    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        if (dated) {
            FieldRow("Status", onClick = { pickStatus = true }) {
                if (item.status != null) StatusChip(item.status) else Text("—", color = LocalPalette.current.subtle)
            }
        }
        FieldRow("Owner", onClick = { pickOwner = true }) { UserChip(snap.user(item.ownerId)) }
        FieldRow("Assignee", onClick = { pickAssignee = true }) { UserChip(snap.user(item.assigneeId)) }
        if (dated) {
            DateRow(
                label = "Start",
                date = item.startDate,
                firm = item.startFirm,
                onDate = { patch(ItemPatch(startDate = set(it))) },
                onFirm = { patch(ItemPatch(startFirm = set(it))) },
            ) {
                PlainDateText(item.startDate, item.startFirm)
            }
            DateRow(
                label = "End",
                date = item.endDate,
                firm = item.endFirm,
                onDate = { patch(ItemPatch(endDate = set(it))) },
                onFirm = { patch(ItemPatch(endFirm = set(it))) },
            ) {
                if (item.endDate != null) EndDateText(item) else PlainDateText(null, item.endFirm)
            }
        }
        if (item.type == ItemType.TASK) {
            LevelSlider(
                label = "Urgency",
                value = item.urgency,
                onChange = { patch(ItemPatch(urgency = set(it))) },
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            LevelSlider(
                label = "Importance",
                value = item.importance,
                onChange = { patch(ItemPatch(importance = set(it))) },
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        if (dated) {
            // Locked on while an open blocker exists (spec "Dependencies").
            val lockedOn = item.blockedBy.any { snap.item(it)?.isClosed == false }
            FieldRow("Blocked") {
                Switch(
                    checked = item.blocked || lockedOn,
                    onCheckedChange = { patch(ItemPatch(blocked = set(it))) },
                    enabled = !lockedOn,
                )
                if (lockedOn) {
                    Spacer(Modifier.width(12.dp))
                    Text("Blocked by an open item", style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.subtle)
                }
            }
        }
        if (item.isParent) {
            ColorRow(current = item.color, onPick = { patch(ItemPatch(color = set(it))) })
        }
    }

    if (pickStatus) {
        StatusPickerDialog(
            selected = item.status,
            onPick = { patch(ItemPatch(status = set(it))) },
            onDismiss = { pickStatus = false },
        )
    }
    if (pickOwner) {
        UserPickerDialog(
            title = "Owner",
            users = snap.users,
            selected = item.ownerId,
            allowNone = true,
            onPick = { patch(ItemPatch(ownerId = set(it))) },
            onDismiss = { pickOwner = false },
        )
    }
    if (pickAssignee) {
        UserPickerDialog(
            title = "Assignee",
            users = snap.users,
            selected = item.assigneeId,
            allowNone = true,
            onPick = { patch(ItemPatch(assigneeId = set(it))) },
            onDismiss = { pickAssignee = false },
        )
    }
}

/** A date with its firm toggle before it; the date text opens the picker (Clear sets none). */
@Composable
internal fun DateRow(
    label: String,
    date: LocalDate?,
    firm: Boolean,
    onDate: (LocalDate?) -> Unit,
    onFirm: (Boolean) -> Unit,
    text: @Composable () -> Unit,
) {
    var picking by remember { mutableStateOf(false) }
    FieldRow(label) {
        FirmToggle(firm = firm, enabled = date != null, onToggle = { onFirm(!firm) })
        Box(
            modifier = Modifier
                .clickable { picking = true }
                .padding(horizontal = 6.dp, vertical = 8.dp),
        ) { text() }
    }
    if (picking) {
        DatePickerDialogFor(initial = date, allowClear = true, onPick = onDate, onDismiss = { picking = false })
    }
}

/** "~" for an approximate date, a pin for a firm one; tap to switch (web step 3). */
@Composable
internal fun FirmToggle(firm: Boolean, enabled: Boolean, onToggle: () -> Unit) {
    IconButton(onClick = onToggle, enabled = enabled) {
        if (firm) {
            Icon(Icons.Filled.PushPin, contentDescription = "Firm date; tap to make approximate", tint = MaterialTheme.colorScheme.primary)
        } else {
            Text(
                "~",
                fontSize = 20.sp,
                color = if (enabled) LocalPalette.current.subtle else LocalPalette.current.subtle.copy(alpha = 0.4f),
            )
        }
    }
}

/** A date as "~Mon 3 Nov" / "Mon 3 Nov", or "Set date" when none. */
@Composable
internal fun PlainDateText(date: LocalDate?, firm: Boolean) {
    if (date == null) {
        Text("Set date", color = LocalPalette.current.subtle, style = MaterialTheme.typography.bodyMedium)
    } else {
        Text((if (firm) "" else "~") + Dates.human(date), style = MaterialTheme.typography.bodyMedium)
    }
}

/** The Ongoing/Project colour: a small palette plus None (spec "Highlighting"). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ColorRow(current: String, onPick: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
        Text("Colour", style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.height(8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Swatch(hex = null, selected = current.isBlank(), onClick = { onPick("") })
            for (c in ITEM_PALETTE) {
                Swatch(hex = c, selected = c.equals(current, ignoreCase = true), onClick = { onPick(c) })
            }
        }
    }
}

@Composable
private fun Swatch(hex: String?, selected: Boolean, onClick: () -> Unit) {
    val fill = hexColor(hex, Color.Transparent)
    val ring = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)
    Box(
        modifier = Modifier
            .size(34.dp)
            .clip(CircleShape)
            .background(fill)
            .border(if (selected) 3.dp else 1.dp, ring, CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        when {
            hex == null -> Icon(
                Icons.Filled.Close,
                contentDescription = "No colour",
                tint = LocalPalette.current.subtle,
                modifier = Modifier.size(16.dp),
            )
            selected -> Icon(
                Icons.Filled.Check,
                contentDescription = "Selected",
                tint = contrastOn(fill),
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

// ---------------------------------------------------------------- description

/** Rendered Markdown; the pencil (or a tap on the text) opens a multi-line editor with Save / Cancel. */
@Composable
private fun DescriptionSection(description: String, onSave: (String) -> Unit) {
    var editing by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Description", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            if (!editing) {
                IconButton(onClick = { editing = true }) { Icon(Icons.Filled.Edit, contentDescription = "Edit description") }
            }
        }
        when {
            editing -> {
                var text by remember { mutableStateOf(description) }
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 4,
                    placeholder = { Text("Add a description") },
                )
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { editing = false }) { Text("Cancel") }
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = {
                        if (text != description) onSave(text)
                        editing = false
                    }) { Text("Save") }
                }
            }
            description.isBlank() -> Text(
                "Add a description",
                color = LocalPalette.current.subtle,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { editing = true }
                    .padding(vertical = 8.dp),
            )
            else -> MarkdownText(
                markdown = description,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { editing = true }
                    .padding(vertical = 4.dp),
            )
        }
    }
}

// ---------------------------------------------------------------- history

/** The status history, collapsed by default, newest first. */
@Composable
private fun HistorySection(history: List<StatusChange>) {
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { open = !open }
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.History, contentDescription = null, tint = LocalPalette.current.subtle)
            Spacer(Modifier.width(12.dp))
            Text("History", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Text(
                if (open) "Hide" else "Show (${history.size})",
                style = MaterialTheme.typography.labelLarge,
                color = LocalPalette.current.accent,
            )
        }
        if (open) {
            if (history.isEmpty()) {
                Text(
                    "No history yet (it is fetched from the server).",
                    color = LocalPalette.current.subtle,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }
            for (h in history.asReversed()) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    StatusChip(h.status, modifier = Modifier.width(96.dp))
                    Spacer(Modifier.width(12.dp))
                    Text(formatTimestamp(h.changedAt), style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.subtle)
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

private val timestampFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("EEE d MMM yyyy, HH:mm")

/** RFC 3339 -> "Mon 3 Nov 2025, 14:05" in the device zone; the raw string when unparsable. */
private fun formatTimestamp(ts: String): String = try {
    Instant.parse(ts).atZone(ZoneId.systemDefault()).format(timestampFormat)
} catch (_: Exception) {
    ts
}
