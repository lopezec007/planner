// The Filters bottom sheet: the same criteria as the web Filters panel
// (type, status with "or closed within N days", owner, assignee, blocked,
// end-date range, hide empty parents) plus the phone's Flat toggle. Owner
// and assignee are multi-select: any chosen user (or "none") matches.
package io.github.lopezec007.planner.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import io.github.lopezec007.planner.data.model.Criteria
import io.github.lopezec007.planner.data.model.Dates
import io.github.lopezec007.planner.data.model.ItemType
import io.github.lopezec007.planner.data.model.Status
import io.github.lopezec007.planner.data.model.User
import io.github.lopezec007.planner.ui.components.DatePickerDialogFor
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun FilterSheet(
    criteria: Criteria,
    users: List<User>,
    flat: Boolean,
    onFlat: (Boolean) -> Unit,
    onChange: (Criteria) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var pickDate by remember { mutableStateOf<String?>(null) } // "after" | "before"
    val c = criteria

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Filters", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                TextButton(onClick = { onChange(Criteria()) }, enabled = c.isActive) { Text("Clear") }
            }

            Section("Layout") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(checked = flat, onCheckedChange = onFlat)
                    Spacer(Modifier.width(8.dp))
                    Text("Flat: tasks only, with their Ongoing/Project")
                }
            }

            Section("Type") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (t in ItemType.entries) {
                        FilterChip(
                            selected = t in c.types,
                            onClick = { onChange(c.copy(types = if (t in c.types) c.types - t else c.types + t)) },
                            label = { Text(t.label) },
                        )
                    }
                }
            }

            Section("Status") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (s in Status.entries) {
                        FilterChip(
                            selected = s in c.statuses,
                            onClick = { onChange(c.copy(statuses = if (s in c.statuses) c.statuses - s else c.statuses + s)) },
                            label = { Text(s.label) },
                        )
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("or closed within")
                    Spacer(Modifier.width(8.dp))
                    var days by remember(c.recentDays) { mutableStateOf(if (c.recentDays > 0) c.recentDays.toString() else "") }
                    OutlinedTextField(
                        value = days,
                        onValueChange = { v ->
                            days = v.filter { it.isDigit() }.take(3)
                            onChange(c.copy(recentDays = days.toIntOrNull()?.coerceIn(0, 365) ?: 0))
                        },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                        modifier = Modifier.width(80.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("days")
                }
            }

            Section("Owner") {
                UserChoice(users, c.owners, noneLabel = "No owner") { onChange(c.copy(owners = it)) }
            }
            Section("Assignee") {
                UserChoice(users, c.assignees, noneLabel = "Unassigned") { onChange(c.copy(assignees = it)) }
            }

            Section("Blocked") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = c.blocked == "", onClick = { onChange(c.copy(blocked = "")) }, label = { Text("Any") })
                    FilterChip(selected = c.blocked == "yes", onClick = { onChange(c.copy(blocked = "yes")) }, label = { Text("Blocked") })
                    FilterChip(selected = c.blocked == "no", onClick = { onChange(c.copy(blocked = "no")) }, label = { Text("Not blocked") })
                }
            }

            Section("End date") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = c.endAfter != null, onClick = { pickDate = "after" },
                        label = { Text(c.endAfter?.let { "on/after ${Dates.human(it)}" } ?: "on/after…") },
                    )
                    FilterChip(
                        selected = c.endBefore != null, onClick = { pickDate = "before" },
                        label = { Text(c.endBefore?.let { "on/before ${Dates.human(it)}" } ?: "on/before…") },
                    )
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = c.hideEmptyParents, onCheckedChange = { onChange(c.copy(hideEmptyParents = it)) })
                Text("Hide Ongoing and Project rows with no matching tasks")
            }
            Spacer(Modifier.height(16.dp))
        }
    }

    pickDate?.let { which ->
        val initial: LocalDate? = if (which == "after") c.endAfter else c.endBefore
        DatePickerDialogFor(
            initial = initial,
            allowClear = true,
            onPick = { d -> onChange(if (which == "after") c.copy(endAfter = d) else c.copy(endBefore = d)) },
            onDismiss = { pickDate = null },
        )
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
        Text(title, style = MaterialTheme.typography.labelLarge)
        content()
    }
}

/** "Any" clears the set; the other chips toggle, and an empty set shows as "Any". */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun UserChoice(users: List<User>, chosen: Set<String>, noneLabel: String, onPick: (Set<String>) -> Unit) {
    val toggle = { v: String -> onPick(if (v in chosen) chosen - v else chosen + v) }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(selected = chosen.isEmpty(), onClick = { onPick(emptySet()) }, label = { Text("Any") })
        FilterChip(selected = "none" in chosen, onClick = { toggle("none") }, label = { Text(noneLabel) })
        for (u in users) {
            val id = u.id.toString()
            FilterChip(selected = id in chosen, onClick = { toggle(id) }, label = { Text(u.name) })
        }
    }
}
