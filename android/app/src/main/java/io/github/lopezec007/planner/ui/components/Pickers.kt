// Pickers shared by the detail and new-item screens: a user (chips when
// there are three or fewer, a list otherwise), a status, a date with its
// firm toggle, and a 0-10 level.
package io.github.lopezec007.planner.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.lopezec007.planner.data.model.Status
import io.github.lopezec007.planner.data.model.User
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.math.roundToInt

/**
 * Pick a user: chips for three or fewer, a list otherwise; the selected one
 * tapped again clears (when [allowNone]).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun UserPicker(users: List<User>, selected: Long?, allowNone: Boolean, onPick: (Long?) -> Unit, modifier: Modifier = Modifier) {
    if (users.size <= 3) {
        FlowRow(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (u in users) {
                FilterChip(
                    selected = u.id == selected,
                    onClick = { if (u.id == selected && allowNone) onPick(null) else onPick(u.id) },
                    label = { Text(u.name) },
                    leadingIcon = { ColorDot(u.color) },
                )
            }
            if (allowNone) {
                FilterChip(selected = selected == null, onClick = { onPick(null) }, label = { Text("None") })
            }
        }
    } else {
        Column(modifier) {
            if (allowNone) {
                ListItem(
                    headlineContent = { Text("None") },
                    modifier = Modifier.clickable { onPick(null) },
                    trailingContent = { if (selected == null) Text("✓") },
                )
            }
            for (u in users) {
                ListItem(
                    headlineContent = { Text(u.name) },
                    leadingContent = { ColorDot(u.color, size = 18) },
                    trailingContent = { if (u.id == selected) Text("✓") },
                    modifier = Modifier.clickable { onPick(u.id) },
                )
            }
        }
    }
}

@Composable
fun UserPickerDialog(title: String, users: List<User>, selected: Long?, allowNone: Boolean, onPick: (Long?) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { UserPicker(users, selected, allowNone, onPick = { onPick(it); onDismiss() }) },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StatusPicker(selected: Status?, onPick: (Status) -> Unit, modifier: Modifier = Modifier) {
    FlowRow(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (s in Status.entries) {
            FilterChip(selected = s == selected, onClick = { onPick(s) }, label = { Text(s.label) })
        }
    }
}

@Composable
fun StatusPickerDialog(selected: Status?, onPick: (Status) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Status") },
        text = { StatusPicker(selected, onPick = { onPick(it); onDismiss() }) },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

/** A Material date picker; Clear sets null (when [allowClear]). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DatePickerDialogFor(initial: LocalDate?, allowClear: Boolean, onPick: (LocalDate?) -> Unit, onDismiss: () -> Unit) {
    val state = rememberDatePickerState(
        initialSelectedDateMillis = initial?.atStartOfDay(ZoneOffset.UTC)?.toInstant()?.toEpochMilli(),
    )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                val ms = state.selectedDateMillis
                if (ms != null) onPick(Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate())
                onDismiss()
            }) { Text("OK") }
        },
        dismissButton = {
            Row {
                if (allowClear) TextButton(onClick = { onPick(null); onDismiss() }) { Text("Clear") }
                TextButton(onClick = onDismiss) { Text("Cancel") }
            }
        },
    ) {
        DatePicker(state = state)
    }
}

/** Urgency / importance: a 0-10 slider with the value beside it. */
@Composable
fun LevelSlider(label: String, value: Int?, onChange: (Int) -> Unit, modifier: Modifier = Modifier) {
    var v by remember(value) { mutableIntStateOf(value ?: 5) }
    Row(modifier = modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.width(96.dp))
        Slider(
            value = v.toFloat(),
            onValueChange = { v = it.roundToInt().coerceIn(0, 10) },
            onValueChangeFinished = { if (v != value) onChange(v) },
            valueRange = 0f..10f,
            steps = 9,
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(8.dp))
        Text(v.toString(), style = MaterialTheme.typography.titleMedium, modifier = Modifier.width(24.dp).wrapContentWidth())
    }
}

/** A labelled row used by the detail and settings screens. */
@Composable
fun FieldRow(label: String, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.width(96.dp))
        content()
    }
}
