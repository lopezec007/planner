// The main screen: the shared toolbar (search, Active/Backlog/Ideas,
// filters), the view switcher (List / Timeline / Matrix) in a bottom bar,
// and the content for the chosen view. The sync state shows as a thin
// banner under the toolbar when something is worth knowing.
package io.github.lopezec007.planner.ui.home

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.lopezec007.planner.data.model.Criteria
import io.github.lopezec007.planner.data.model.ItemType
import io.github.lopezec007.planner.data.model.Preset
import io.github.lopezec007.planner.data.sync.SyncPhase
import io.github.lopezec007.planner.prefs.View
import io.github.lopezec007.planner.ui.PlannerViewModel
import io.github.lopezec007.planner.ui.matrix.MatrixScreen
import io.github.lopezec007.planner.ui.nav.Nav
import io.github.lopezec007.planner.ui.nav.Screen
import io.github.lopezec007.planner.ui.theme.LocalPalette
import io.github.lopezec007.planner.ui.timeline.TimelineScreen
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(vm: PlannerViewModel, nav: Nav) {
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    val p = prefs ?: return
    val snap by vm.snapshot.collectAsStateWithLifecycle()
    val groups by vm.visibleGroups.collectAsStateWithLifecycle()
    val sync by vm.sync.collectAsStateWithLifecycle()
    val search by vm.searchText.collectAsStateWithLifecycle()
    var filtersOpen by remember { mutableStateOf(false) }
    var addMenu by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }

    // A fresh sync whenever the home screen comes up.
    LaunchedEffect(Unit) { vm.requestSync() }

    // Notifications are on by default, so ask for the permission the first
    // time the list shows (the system stops asking after repeated denials;
    // Settings has an "Allow" link for later).
    val context = LocalContext.current
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(p.notifyEnabled) {
        if (p.notifyEnabled &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        TextField(
                            value = search,
                            onValueChange = { vm.searchText.value = it },
                            placeholder = { Text("Search") },
                            singleLine = true,
                            trailingIcon = {
                                if (search.isNotEmpty()) {
                                    IconButton(onClick = { vm.searchText.value = "" }) { Icon(Icons.Filled.Clear, "Clear search") }
                                }
                            },
                            colors = TextFieldDefaults.colors(
                                focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                                unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                                focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                                unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                            ),
                            shape = androidx.compose.foundation.shape.RoundedCornerShape(24.dp),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    },
                    navigationIcon = {
                        IconButton(onClick = { nav.push(Screen.Settings) }) { Icon(Icons.Filled.Settings, "Settings") }
                    },
                    actions = {
                        BadgedBox(badge = { if (p.criteria.filterCount > 0) Badge { Text(p.criteria.filterCount.toString()) } }) {
                            IconButton(onClick = { filtersOpen = true }) { Icon(Icons.Filled.FilterList, "Filters") }
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
                )
                PresetRow(
                    current = p.criteria.preset,
                    onPreset = { vm.setCriteria(it.criteria(p.criteria)) },
                    showAll = p.criteria.isActive || search.isNotEmpty(),
                    onAll = { vm.searchText.value = ""; vm.setCriteria(Criteria()) },
                )
                SyncBanner(sync.phase, sync.pending, sync.lastError, sync.lastSuccess, onRetry = { vm.requestSync() })
            }
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = p.view == View.LIST, onClick = { vm.setView(View.LIST) },
                    icon = { Icon(Icons.AutoMirrored.Filled.List, null) }, label = { Text("List") },
                )
                NavigationBarItem(
                    selected = p.view == View.TIMELINE, onClick = { vm.setView(View.TIMELINE) },
                    icon = { Icon(Icons.Filled.Timeline, null) }, label = { Text("Timeline") },
                )
                NavigationBarItem(
                    selected = p.view == View.MATRIX, onClick = { vm.setView(View.MATRIX) },
                    icon = { Icon(Icons.Filled.GridOn, null) }, label = { Text("Matrix") },
                )
            }
        },
        floatingActionButton = {
            if (p.view == View.LIST) {
                Box {
                    FloatingActionButton(onClick = { addMenu = true }) { Icon(Icons.Filled.Add, "New") }
                    DropdownMenu(expanded = addMenu, onDismissRequest = { addMenu = false }) {
                        DropdownMenuItem(text = { Text("New Ongoing") }, onClick = { addMenu = false; nav.push(Screen.New(ItemType.ONGOING, null)) })
                        DropdownMenuItem(text = { Text("New Project") }, onClick = { addMenu = false; nav.push(Screen.New(ItemType.PROJECT, null)) })
                    }
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        val content = Modifier.fillMaxSize().padding(padding)
        when (p.view) {
            View.LIST -> ItemList(
                vm = vm, groups = groups, snapshot = snap, flat = p.flat, collapsed = p.collapsed,
                onOpen = { nav.push(Screen.Detail(it)) },
                onAddTask = { nav.push(Screen.New(ItemType.TASK, it)) },
                snackbar = snackbar,
                modifier = content,
            )
            View.TIMELINE -> TimelineScreen(vm, groups, onOpen = { nav.push(Screen.Detail(it)) }, modifier = content)
            View.MATRIX -> MatrixScreen(vm, groups, onOpen = { nav.push(Screen.Detail(it)) }, modifier = content)
        }
    }

    if (filtersOpen) {
        FilterSheet(
            criteria = p.criteria,
            users = snap.users,
            flat = p.flat,
            onFlat = { vm.setFlat(it) },
            onChange = { vm.setCriteria(it) },
            onDismiss = { filtersOpen = false },
        )
    }
}

/** Active / Backlog / Ideas, plus "All" to clear everything when a filter is on. */
@Composable
private fun PresetRow(current: Preset?, onPreset: (Preset) -> Unit, showAll: Boolean, onAll: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (preset in Preset.entries) {
            FilterChip(selected = current == preset, onClick = { onPreset(preset) }, label = { Text(preset.title) })
        }
        if (showAll) {
            FilterChip(selected = false, onClick = onAll, label = { Text("All") })
        }
    }
}

/** A one-line strip under the toolbar: offline, pending changes, or the last error. Nothing when all is well. */
@Composable
private fun SyncBanner(phase: SyncPhase, pending: Int, lastError: String?, lastSuccess: Long?, onRetry: () -> Unit) {
    val palette = LocalPalette.current
    val text = when {
        phase == SyncPhase.OFFLINE && pending > 0 -> "Offline — $pending change${if (pending == 1) "" else "s"} waiting to sync"
        phase == SyncPhase.OFFLINE -> "Offline — showing data from " + (lastSuccess?.let { DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(it)) } ?: "an earlier session")
        phase == SyncPhase.NOT_CONFIGURED -> "No server configured"
        lastError != null -> "Sync problem: $lastError"
        pending > 0 && phase == SyncPhase.SYNCING -> "Syncing $pending change${if (pending == 1) "" else "s"}…"
        else -> null
    } ?: return
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (lastError != null && phase != SyncPhase.OFFLINE) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            color = if (lastError != null && phase != SyncPhase.OFFLINE) MaterialTheme.colorScheme.onErrorContainer else palette.subtle,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = onRetry, modifier = Modifier.padding(0.dp)) { Icon(Icons.Filled.Refresh, "Sync now") }
    }
}
