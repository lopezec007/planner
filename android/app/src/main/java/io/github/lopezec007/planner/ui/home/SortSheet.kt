// The Sort bottom sheet: the web UI's Sort menu and column headers in one.
// Each column is a chip that follows the header-click rule (tap: join the
// sort in its first direction; again: reverse; once more: leave), so the
// order the chips are tapped in is the multi-column sort order, shown as a
// number on each chip. "User-defined" clears the columns (the order the
// rows were given in the web UI). Two switches apply whatever the columns:
// blocked items last, and done / cancelled items last (below the blocked).
// The "Ongoing / Project" column is offered in Flat only, as on the web.
package io.github.lopezec007.planner.ui.home

import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.github.lopezec007.planner.data.model.SortColumn
import io.github.lopezec007.planner.data.model.SortSpec
import io.github.lopezec007.planner.ui.theme.LocalPalette

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SortSheet(
    sort: SortSpec,
    flat: Boolean,
    onChange: (SortSpec) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val palette = LocalPalette.current
    // The Ongoing/Project column is set aside outside Flat: its place in the
    // order is kept, it is just not offered or counted here.
    val active = sort.keysFor(flat)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Sort", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                TextButton(onClick = { onChange(sort.copy(keys = emptyList())) }, enabled = sort.keys.isNotEmpty()) { Text("User-defined") }
            }
            Text(
                if (active.isEmpty()) "Rows are in the user-defined order. Tap a column to sort by it; tap more to sort within it."
                else "By ${sort.summary(flat)}. Tap a column again to reverse it, once more to remove it.",
                style = MaterialTheme.typography.bodyMedium,
                color = palette.subtle,
            )

            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (column in SortColumn.entries) {
                    if (column.flatOnly && !flat) continue
                    val index = active.indexOfFirst { it.column == column }
                    val key = active.getOrNull(index)
                    val arrow = if (key == null) "" else if (key.desc) " ↓" else " ↑"
                    val full = active.size >= SortSpec.MAX_KEYS
                    FilterChip(
                        selected = key != null,
                        enabled = key != null || !full,
                        onClick = { onChange(sort.toggle(column)) },
                        label = { Text(if (key == null) column.label else "${index + 1} · ${column.label}$arrow") },
                        modifier = Modifier.semantics {
                            contentDescription = when {
                                key == null -> "Sort by ${column.label}"
                                key.desc -> "${column.label}, descending, sort column ${index + 1}"
                                else -> "${column.label}, ascending, sort column ${index + 1}"
                            }
                        },
                    )
                }
            }

            SwitchRow("Blocked items last", "Whatever the sort", sort.blockedLast) { onChange(sort.copy(blockedLast = it)) }
            SwitchRow("Done / cancelled items last", "Below the blocked ones", sort.closedLast) { onChange(sort.copy(closedLast = it)) }
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
private fun SwitchRow(title: String, hint: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable { onChange(!checked) },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.subtle)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
