// Settings: the server and account, sync status with the log of dropped
// changes, the daily notification, the users (name, colour, chip label),
// the planner settings shared with every client, and About. Planner
// settings and users go through the repository, so they are applied at once
// and queued like any other change (README "Offline tolerance").
package io.github.lopezec007.planner.ui.settings

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.lopezec007.planner.BuildConfig
import io.github.lopezec007.planner.data.db.SyncLogEntity
import io.github.lopezec007.planner.data.model.AppSettings
import io.github.lopezec007.planner.data.model.User
import io.github.lopezec007.planner.data.sync.SyncPhase
import io.github.lopezec007.planner.data.sync.SyncState
import io.github.lopezec007.planner.prefs.AppPrefs
import io.github.lopezec007.planner.ui.PlannerViewModel
import io.github.lopezec007.planner.ui.components.ColorDot
import io.github.lopezec007.planner.ui.components.FieldRow
import io.github.lopezec007.planner.ui.components.UserChip
import io.github.lopezec007.planner.ui.nav.Nav
import io.github.lopezec007.planner.ui.nav.Screen
import io.github.lopezec007.planner.ui.theme.LocalPalette
import io.github.lopezec007.planner.ui.theme.contrastOn
import io.github.lopezec007.planner.ui.theme.hexColor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private val DAYS = listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")

/** The chip label's limit (spec: at most 3 characters; counted in code points like the web UI). */
private const val SHORT_MAX = 3

/** Preset swatches for users and the planner colours; the current value is added when it is not one of these. */
private val PRESET_COLORS = listOf(
    "#2a9d8f", "#5b6cff", "#3b7dd8", "#00acc1", "#2e9e4f",
    "#9ccc3d", "#fdd835", "#f5a524", "#fb8c00", "#e5484d",
    "#b71c1c", "#e91e63", "#8e44ad", "#795548", "#607d8b",
    "#9aa3ad",
)

private val dateTimeFormat: DateTimeFormatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)

private fun absoluteTime(ms: Long): String = dateTimeFormat.format(Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()))

/** "just now", "12 min ago", "3 h ago", else the date and time. */
private fun relativeTime(ms: Long): String {
    val minutes = (System.currentTimeMillis() - ms) / 60_000
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "$minutes min ago"
        minutes < 24 * 60 -> "${minutes / 60} h ago"
        else -> absoluteTime(ms)
    }
}

private fun codePoints(s: String): Int = s.codePointCount(0, s.length)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(vm: PlannerViewModel, nav: Nav) {
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    val p = prefs ?: return
    val snap by vm.snapshot.collectAsStateWithLifecycle()
    val sync by vm.sync.collectAsStateWithLifecycle()
    val pending by vm.repo.pendingCount.collectAsStateWithLifecycle(initialValue = 0)
    val log by vm.repo.syncLog.collectAsStateWithLifecycle(initialValue = emptyList())
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = { nav.pop() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { inner ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .verticalScroll(rememberScrollState()),
        ) {
            ServerSection(p, sync, snap.users, vm, nav)
            HorizontalDivider()
            SyncSection(sync, pending, log, onSyncNow = { vm.requestSync() })
            HorizontalDivider()
            NotificationsSection(p, vm)
            HorizontalDivider()
            UsersSection(snap.users, p.accountId, vm, scope, snackbar)
            HorizontalDivider()
            PlannerSettingsSection(
                settings = snap.settings,
                onChange = { key, value -> scope.launch { vm.repo.updateSettings(mapOf(key to value)) } },
            )
            HorizontalDivider()
            AboutSection()
            Spacer(Modifier.height(24.dp))
        }
    }
}

// ---------------------------------------------------------------- shared bits

@Composable
private fun SectionTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 4.dp),
    )
}

@Composable
private fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = LocalPalette.current.subtle,
        modifier = modifier.padding(horizontal = 16.dp, vertical = 4.dp),
    )
}

/** A round swatch; a dashed-looking outline for "none" (blank). */
@Composable
private fun Swatch(hex: String, selected: Boolean, onClick: () -> Unit, size: Int = 36) {
    val none = hex.isBlank()
    val bg = if (none) MaterialTheme.colorScheme.surface else hexColor(hex, MaterialTheme.colorScheme.surfaceVariant)
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(bg)
            .border(
                width = if (selected) 2.dp else 1.dp,
                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                shape = CircleShape,
            )
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) {
            Icon(
                Icons.Filled.Check,
                contentDescription = null,
                tint = if (none) MaterialTheme.colorScheme.onSurface else contrastOn(bg),
                modifier = Modifier.size(18.dp),
            )
        } else if (none) {
            Text("—", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
        }
    }
}

/** The preset colours plus [current] (when set and not a preset), in rows of five; "" for none when [allowNone]. */
@Composable
private fun PaletteGrid(current: String?, allowNone: Boolean, onPick: (String) -> Unit) {
    val colors = buildList {
        addAll(PRESET_COLORS)
        val c = current?.trim()?.lowercase().orEmpty()
        if (c.isNotBlank() && c !in PRESET_COLORS) add(c)
        if (allowNone) add("")
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (row in colors.chunked(5)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (c in row) {
                    Swatch(hex = c, selected = c == (current?.trim()?.lowercase().orEmpty()), onClick = { onPick(c) })
                }
            }
        }
    }
}

/** Picks a colour and closes. */
@Composable
private fun PaletteDialog(title: String, current: String, allowNone: Boolean, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            PaletteGrid(current = current, allowNone = allowNone, onPick = { onPick(it); onDismiss() })
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

// ---------------------------------------------------------------- 1. server & account

@Composable
private fun ServerSection(p: AppPrefs, sync: SyncState, users: List<User>, vm: PlannerViewModel, nav: Nav) {
    var pickAccount by remember { mutableStateOf(false) }
    val me = p.accountId?.let { id -> users.firstOrNull { it.id == id } }

    SectionTitle("Server")
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(p.serverUrl.ifBlank { "not set" }, style = MaterialTheme.typography.bodyLarge)
            Text(
                sync.serverVersion?.let { "Planner $it" } ?: "version unknown (not reached yet)",
                style = MaterialTheme.typography.bodySmall,
                color = LocalPalette.current.subtle,
            )
        }
        OutlinedButton(onClick = { nav.push(Screen.Setup) }) { Text("Change…") }
    }

    SectionTitle("Account")
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
            if (me != null) {
                UserChip(me)
                Spacer(Modifier.width(8.dp))
                Text(me.name, style = MaterialTheme.typography.bodyLarge)
            } else {
                Text("No account", style = MaterialTheme.typography.bodyLarge)
            }
        }
        OutlinedButton(onClick = { pickAccount = true }) { Text("Change") }
    }
    Hint("The account is what due-date notifications and the default owner use.")

    if (pickAccount) {
        AccountDialog(
            users = users,
            selected = p.accountId,
            onPick = { vm.setAccount(it) },
            onDismiss = { pickAccount = false },
        )
    }
}

@Composable
private fun AccountDialog(users: List<User>, selected: Long?, onPick: (Long?) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Who are you?") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                for (u in users) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onPick(u.id); onDismiss() }
                            .padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = u.id == selected, onClick = null)
                        Spacer(Modifier.width(8.dp))
                        ColorDot(u.color, size = 16)
                        Spacer(Modifier.width(8.dp))
                        Text(u.name)
                    }
                }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onPick(null); onDismiss() }
                        .padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = selected == null, onClick = null)
                    Spacer(Modifier.width(8.dp))
                    Text("No account")
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

// ---------------------------------------------------------------- 2. sync

@Composable
private fun SyncSection(sync: SyncState, pending: Int, log: List<SyncLogEntity>, onSyncNow: () -> Unit) {
    SectionTitle("Sync")
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                when (sync.phase) {
                    SyncPhase.IDLE -> "Idle"
                    SyncPhase.SYNCING -> "Syncing…"
                    SyncPhase.OFFLINE -> "Offline — server not reachable"
                    SyncPhase.NOT_CONFIGURED -> "Not configured"
                },
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                "Last synced: " + (sync.lastSuccess?.let { relativeTime(it) } ?: "never"),
                style = MaterialTheme.typography.bodySmall,
                color = LocalPalette.current.subtle,
            )
            Text(
                when (pending) {
                    0 -> "No pending changes"
                    1 -> "1 pending change"
                    else -> "$pending pending changes"
                },
                style = MaterialTheme.typography.bodySmall,
                color = LocalPalette.current.subtle,
            )
            sync.lastError?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
        }
        Button(onClick = onSyncNow, enabled = sync.phase != SyncPhase.SYNCING) { Text("Sync now") }
    }

    if (log.isNotEmpty()) {
        Text(
            "Changes that could not be applied",
            style = MaterialTheme.typography.titleSmall,
            modifier = Modifier.padding(start = 16.dp, top = 12.dp, end = 16.dp, bottom = 4.dp),
        )
        // observeRecent() already lists the newest first.
        for (e in log) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
                Text(e.summary, style = MaterialTheme.typography.bodyMedium)
                if (e.detail.isNotBlank()) {
                    Text(e.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                }
                Text(absoluteTime(e.at), style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.subtle)
            }
        }
    }
}

// ---------------------------------------------------------------- 3. notifications

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NotificationsSection(p: AppPrefs, vm: PlannerViewModel) {
    val context = LocalContext.current
    var granted by remember {
        mutableStateOf(context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
    }
    var denied by remember { mutableStateOf(false) }
    var pickTime by remember { mutableStateOf(false) }
    var pickDays by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        granted = ok
        denied = !ok
    }

    SectionTitle("Notifications")
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Daily due-date summary", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Switch(
            checked = p.notifyEnabled,
            onCheckedChange = { on ->
                if (on && !granted) launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
                vm.setNotify(on, p.notifyHour, p.notifyMinute)
            },
        )
    }
    val time = LocalTime.of(p.notifyHour.coerceIn(0, 23), p.notifyMinute.coerceIn(0, 59))
    FieldRow(label = "Time", onClick = if (p.notifyEnabled) ({ pickTime = true }) else null) {
        Text(
            time.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)),
            style = MaterialTheme.typography.bodyLarge,
            color = if (p.notifyEnabled) MaterialTheme.colorScheme.onSurface else LocalPalette.current.subtle,
        )
    }
    // The look-ahead window: the notification also lists items due within this many days.
    val enabledColor = if (p.notifyEnabled) MaterialTheme.colorScheme.onSurface else LocalPalette.current.subtle
    Box {
        FieldRow(label = "Look ahead", onClick = if (p.notifyEnabled) ({ pickDays = true }) else null) {
            Text(lookAheadLabel(p.notifyDays), style = MaterialTheme.typography.bodyLarge, color = enabledColor)
        }
        DropdownMenu(expanded = pickDays, onDismissRequest = { pickDays = false }) {
            // The stored value is offered too when it is not one of the presets.
            for (d in (AppPrefs.NOTIFY_DAY_CHOICES + p.notifyDays).distinct().sorted()) {
                DropdownMenuItem(
                    text = { Text(lookAheadLabel(d)) },
                    trailingIcon = if (d == p.notifyDays) ({ Icon(Icons.Default.Check, contentDescription = null) }) else null,
                    onClick = { vm.setNotifyDays(d); pickDays = false },
                )
            }
        }
    }
    Hint(
        when (p.notifyDays) {
            0 -> "Lists your overdue items and those due today; works offline."
            1 -> "Lists your overdue items and those due today or tomorrow; works offline."
            else -> "Lists your overdue items and those due within the next ${p.notifyDays} days; works offline."
        },
    )
    if (p.notifyEnabled && !granted) {
        if (denied) {
            Hint("Notifications are blocked for this app in system settings")
        } else {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Notification permission not granted",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { launcher.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text("Allow") }
            }
        }
    }

    if (pickTime) {
        TimeDialog(
            hour = time.hour,
            minute = time.minute,
            onPick = { h, m -> vm.setNotify(p.notifyEnabled, h, m) },
            onDismiss = { pickTime = false },
        )
    }
}

/** "Today only", "1 day", "7 days". */
private fun lookAheadLabel(days: Int): String = when (days) {
    0 -> "Today only"
    1 -> "1 day"
    else -> "$days days"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimeDialog(hour: Int, minute: Int, onPick: (Int, Int) -> Unit, onDismiss: () -> Unit) {
    val state = rememberTimePickerState(initialHour = hour, initialMinute = minute)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Notification time") },
        text = { TimePicker(state = state) },
        confirmButton = {
            TextButton(onClick = { onPick(state.hour, state.minute); onDismiss() }) { Text("OK") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

// ---------------------------------------------------------------- 4. users

@Composable
private fun UsersSection(users: List<User>, accountId: Long?, vm: PlannerViewModel, scope: CoroutineScope, snackbar: SnackbarHostState) {
    var editing by remember { mutableStateOf<User?>(null) }
    var adding by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<User?>(null) }

    SectionTitle("Users")
    Hint("Each user gets a colour and a chip label of up to three characters, shown in the Owner and Assignee columns.")
    if (users.isEmpty()) {
        Hint("No users yet.")
    }
    for (u in users) {
        ListItem(
            headlineContent = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(u.name)
                    Spacer(Modifier.width(8.dp))
                    UserChip(u)
                }
            },
            supportingContent = { Text(u.color) },
            leadingContent = { ColorDot(u.color, size = 18) },
            trailingContent = {
                IconButton(onClick = { deleting = u }) {
                    Icon(Icons.Filled.Delete, contentDescription = "Delete ${u.name}")
                }
            },
            modifier = Modifier.clickable { editing = u },
        )
    }
    Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
        OutlinedButton(onClick = { adding = true }) {
            Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text("Add user")
        }
    }

    editing?.let { u ->
        UserDialog(
            title = "Edit user",
            initialName = u.name,
            initialShort = u.short,
            initialColor = u.color,
            allowAutoColor = false,
            onSave = { name, short, color ->
                val newName = name.takeIf { it != u.name }
                val newShort = short.takeIf { it != u.short }
                val newColor = color?.takeIf { it != u.color }
                if (newName != null || newShort != null || newColor != null) {
                    scope.launch { vm.repo.updateUser(u.id, name = newName, color = newColor, short = newShort) }
                }
            },
            onDismiss = { editing = null },
        )
    }
    if (adding) {
        UserDialog(
            title = "New user",
            initialName = "",
            initialShort = "",
            initialColor = null,
            allowAutoColor = true,
            onSave = { name, short, color ->
                scope.launch { vm.repo.createUser(name, color, short.ifBlank { null }) }
            },
            onDismiss = { adding = false },
        )
    }
    deleting?.let { u ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete user?") },
            text = { Text("Delete \"${u.name}\"? Only possible while no item is owned by or assigned to them.") },
            confirmButton = {
                TextButton(onClick = {
                    deleting = null
                    scope.launch {
                        if (vm.repo.deleteUser(u.id)) {
                            if (accountId == u.id) vm.setAccount(null)
                        } else {
                            snackbar.showSnackbar("That user still owns or is assigned items")
                        }
                    }
                }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
        )
    }
}

/**
 * Name, chip label and colour of a user. [initialColor] null with
 * [allowAutoColor] means "let the server pick" (new users); Save hands back
 * the trimmed name, the label and the colour (null = automatic).
 */
@Composable
private fun UserDialog(
    title: String,
    initialName: String,
    initialShort: String,
    initialColor: String?,
    allowAutoColor: Boolean,
    onSave: (name: String, short: String, color: String?) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(initialName) }
    var short by remember { mutableStateOf(initialShort) }
    var color by remember { mutableStateOf(initialColor) }
    val nameOk = name.isNotBlank()
    val shortOk = short.isBlank() && allowAutoColor || (short.isNotBlank() && codePoints(short) <= SHORT_MAX)
    val previewUser = User(id = 0, name = name.ifBlank { "Name" }, color = color ?: "#9aa3ad", short = short.trim(), createdAt = "")

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    singleLine = true,
                    isError = !nameOk,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = short,
                        onValueChange = { if (codePoints(it) <= SHORT_MAX) short = it },
                        label = { Text("Chip label") },
                        supportingText = { Text(if (allowAutoColor) "Up to 3 characters; blank for initials" else "1 to 3 characters") },
                        singleLine = true,
                        isError = !shortOk,
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(12.dp))
                    UserChip(previewUser, muted = color == null)
                }
                Text("Colour", style = MaterialTheme.typography.labelLarge)
                PaletteGrid(current = color, allowNone = false, onPick = { color = it })
                if (allowAutoColor) {
                    Row(
                        modifier = Modifier.clickable { color = null }.padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = color == null, onClick = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Automatic (the server picks one)", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = nameOk && shortOk,
                onClick = {
                    onSave(name.trim(), short.trim(), color)
                    onDismiss()
                },
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

// ---------------------------------------------------------------- 5. planner settings

@Composable
private fun PlannerSettingsSection(settings: AppSettings, onChange: (key: String, value: String) -> Unit) {
    var weekMenu by remember { mutableStateOf(false) }
    var colorKey by remember { mutableStateOf<String?>(null) }

    SectionTitle("Planner settings")
    Hint("Shared with everyone who uses this server.")

    Box {
        FieldRow(label = "Week start", onClick = { weekMenu = true }) {
            Text(DAYS[settings.weekStart], style = MaterialTheme.typography.bodyLarge)
        }
        DropdownMenu(expanded = weekMenu, onDismissRequest = { weekMenu = false }) {
            DAYS.forEachIndexed { i, day ->
                DropdownMenuItem(
                    text = { Text(day) },
                    onClick = {
                        weekMenu = false
                        if (i != settings.weekStart) onChange("week_start", i.toString())
                    },
                    leadingIcon = {
                        if (i == settings.weekStart) {
                            Icon(Icons.Filled.Check, contentDescription = null)
                        } else {
                            Spacer(Modifier.size(24.dp))
                        }
                    },
                )
            }
        }
    }

    ColorRow("Ongoing", settings.colorOngoing, onClick = { colorKey = "color_ongoing" })
    ColorRow("Project", settings.colorProject, onClick = { colorKey = "color_project" })
    ColorRow("Task tint", settings.colorTask, onClick = { colorKey = "color_task" })
    ColorRow("Unassigned", settings.colorUnassigned, onClick = { colorKey = "color_unassigned" })

    RampRow("Urgency", settings.ramp("urgency"))
    RampRow("Importance", settings.ramp("importance"))
    Hint("Edit these in the web app.")

    colorKey?.let { key ->
        val (title, current, allowNone) = when (key) {
            "color_ongoing" -> Triple("Ongoing colour", settings.colorOngoing, false)
            "color_project" -> Triple("Project colour", settings.colorProject, false)
            "color_task" -> Triple("Task tint", settings.colorTask, true)
            else -> Triple("Unassigned colour", settings.colorUnassigned, false)
        }
        PaletteDialog(
            title = title,
            current = current,
            allowNone = allowNone,
            onPick = { if (it != current) onChange(key, it) },
            onDismiss = { colorKey = null },
        )
    }
}

@Composable
private fun ColorRow(label: String, hex: String, onClick: () -> Unit) {
    FieldRow(label = label, onClick = onClick) {
        if (hex.isBlank()) {
            Text("None", style = MaterialTheme.typography.bodyLarge, color = LocalPalette.current.subtle)
        } else {
            ColorDot(hex, size = 22)
            Spacer(Modifier.width(10.dp))
            Text(hex, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

/** The 0..10 colour ramp as read-only cells (grey cell = no highlight for that value). */
@Composable
private fun RampRow(label: String, ramp: List<String>) {
    FieldRow(label = label) {
        if (ramp.isEmpty()) {
            Text("not loaded yet", style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.subtle)
        } else Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            for (i in 0..10) {
                val hex = ramp.getOrNull(i).orEmpty()
                val bg = hexColor(hex, Color.Unspecified)
                val set = bg != Color.Unspecified
                Box(
                    modifier = Modifier
                        .size(20.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (set) bg else MaterialTheme.colorScheme.surfaceVariant),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (i == 10) "+" else i.toString(),
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Medium,
                        color = if (set) contrastOn(bg) else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

// ---------------------------------------------------------------- 6. about

@Composable
private fun AboutSection() {
    SectionTitle("About")
    Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
        Text("Planner for Android", style = MaterialTheme.typography.bodyLarge)
        Text("Version ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.subtle)
        Spacer(Modifier.height(4.dp))
        Text(
            "This app only connects to the server address above.",
            style = MaterialTheme.typography.bodySmall,
            color = LocalPalette.current.subtle,
        )
    }
}
