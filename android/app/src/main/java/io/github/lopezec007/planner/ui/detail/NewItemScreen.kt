// The form for a new Ongoing, Project or task (README "Using it" step 2):
// title required, the rest optional with the web UI's defaults (status: the
// `default_status` setting when the filters in effect admit it, owner = the
// account, urgency and importance 5).
// Create writes the item to Room with a temporary id and replaces this
// screen with its detail; the key shows "…" until the server answers.
package io.github.lopezec007.planner.ui.detail

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.lopezec007.planner.data.model.ItemType
import io.github.lopezec007.planner.data.model.Status
import io.github.lopezec007.planner.data.repo.ItemPatch
import io.github.lopezec007.planner.data.repo.Opt
import io.github.lopezec007.planner.data.repo.set
import io.github.lopezec007.planner.ui.PlannerViewModel
import io.github.lopezec007.planner.ui.components.FieldRow
import io.github.lopezec007.planner.ui.components.LevelSlider
import io.github.lopezec007.planner.ui.components.StatusChip
import io.github.lopezec007.planner.ui.components.StatusPickerDialog
import io.github.lopezec007.planner.ui.components.UserChip
import io.github.lopezec007.planner.ui.components.UserPickerDialog
import io.github.lopezec007.planner.ui.nav.Nav
import io.github.lopezec007.planner.ui.nav.Screen
import io.github.lopezec007.planner.ui.theme.LocalPalette
import kotlinx.coroutines.launch
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewItemScreen(vm: PlannerViewModel, nav: Nav, type: ItemType, parentId: Long?) {
    val snap by vm.snapshot.collectAsStateWithLifecycle()
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    val parent = parentId?.let { snap.item(it) }
    val scope = rememberCoroutineScope()
    val dated = type != ItemType.ONGOING

    var title by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    // Defaults as the web UI's new row: the planner's default status when the
    // filters admit it (else one they show), the account as owner. The
    // default is read live until the user picks a status, since the settings
    // may still be loading when the screen opens.
    var pickedStatus by remember { mutableStateOf<Status?>(null) }
    val status = pickedStatus ?: (prefs?.criteria?.newStatus(snap.settings.defaultStatus) ?: Status.TODO)
    var ownerId by remember { mutableStateOf(prefs?.accountId) }
    var assigneeId by remember { mutableStateOf<Long?>(null) }
    var startDate by remember { mutableStateOf<LocalDate?>(null) }
    var startFirm by remember { mutableStateOf(false) }
    var endDate by remember { mutableStateOf<LocalDate?>(null) }
    var endFirm by remember { mutableStateOf(false) }
    var urgency by remember { mutableIntStateOf(5) }
    var importance by remember { mutableIntStateOf(5) }
    var creating by remember { mutableStateOf(false) }

    var pickStatus by remember { mutableStateOf(false) }
    var pickOwner by remember { mutableStateOf(false) }
    var pickAssignee by remember { mutableStateOf(false) }

    val canCreate = title.isNotBlank() && !creating
    val create: () -> Unit = {
        val t = title.trim()
        if (t.isNotEmpty() && !creating) {
            creating = true
            scope.launch {
                val patch = ItemPatch(
                    description = if (description.isNotBlank()) set(description) else Opt.Unset,
                    ownerId = if (ownerId != null) set(ownerId) else Opt.Unset,
                    assigneeId = if (assigneeId != null) set(assigneeId) else Opt.Unset,
                    startDate = if (dated && startDate != null) set(startDate) else Opt.Unset,
                    startFirm = if (dated && startFirm) set(true) else Opt.Unset,
                    endDate = if (dated && endDate != null) set(endDate) else Opt.Unset,
                    endFirm = if (dated && endFirm) set(true) else Opt.Unset,
                    urgency = if (type == ItemType.TASK && urgency != 5) set(urgency) else Opt.Unset,
                    importance = if (type == ItemType.TASK && importance != 5) set(importance) else Opt.Unset,
                )
                val id = vm.repo.createItem(
                    type = type,
                    title = t,
                    parentId = parentId,
                    status = if (dated) status else null,
                    patch = patch,
                )
                vm.pin(id)
                nav.replace(Screen.Detail(id))
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = when (type) {
                            ItemType.TASK -> if (parent != null) "New task under ${parent.key} ${parent.title}" else "New task"
                            else -> "New ${type.label}"
                        },
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = { nav.pop() }) { Icon(Icons.Filled.Close, contentDescription = "Close") }
                },
                actions = {
                    TextButton(onClick = create, enabled = canCreate) { Text("Create") }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(bottom = 32.dp),
        ) {
            val focus = remember { FocusRequester() }
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("Title") },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .focusRequester(focus),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            )
            LaunchedEffect(Unit) { focus.requestFocus() }

            if (dated) {
                FieldRow("Status", onClick = { pickStatus = true }) { StatusChip(status) }
            }
            FieldRow("Owner", onClick = { pickOwner = true }) { UserChip(snap.user(ownerId)) }
            FieldRow("Assignee", onClick = { pickAssignee = true }) { UserChip(snap.user(assigneeId)) }
            if (dated) {
                DateRow(
                    label = "Start",
                    date = startDate,
                    firm = startFirm,
                    onDate = { startDate = it; if (it == null) startFirm = false },
                    onFirm = { startFirm = it },
                ) { PlainDateText(startDate, startFirm) }
                DateRow(
                    label = "End",
                    date = endDate,
                    firm = endFirm,
                    onDate = { endDate = it; if (it == null) endFirm = false },
                    onFirm = { endFirm = it },
                ) { PlainDateText(endDate, endFirm) }
            }
            if (type == ItemType.TASK) {
                LevelSlider(
                    label = "Urgency",
                    value = urgency,
                    onChange = { urgency = it },
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
                LevelSlider(
                    label = "Importance",
                    value = importance,
                    onChange = { importance = it },
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            Text(
                "Description",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                minLines = 4,
                placeholder = { Text("Add a description") },
            )
            if (type == ItemType.TASK && parent == null) {
                Text(
                    "The parent item is not available.",
                    style = MaterialTheme.typography.bodySmall,
                    color = LocalPalette.current.subtle,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = create,
                enabled = canCreate,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
            ) { Text("Create") }
        }
    }

    if (pickStatus) {
        StatusPickerDialog(selected = status, onPick = { pickedStatus = it }, onDismiss = { pickStatus = false })
    }
    if (pickOwner) {
        UserPickerDialog(
            title = "Owner",
            users = snap.users,
            selected = ownerId,
            allowNone = true,
            onPick = { ownerId = it },
            onDismiss = { pickOwner = false },
        )
    }
    if (pickAssignee) {
        UserPickerDialog(
            title = "Assignee",
            users = snap.users,
            selected = assigneeId,
            allowNone = true,
            onPick = { assigneeId = it },
            onDismiss = { pickAssignee = false },
        )
    }
}
