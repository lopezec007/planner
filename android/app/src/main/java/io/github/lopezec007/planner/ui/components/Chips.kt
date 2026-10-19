// Small shared pieces: user chips, status chips, level (urgency/importance)
// badges, the end-date label and the blocked mask. Highlighting follows the
// spec: none of it applies to Done/Cancelled items.
package io.github.lopezec007.planner.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.lopezec007.planner.data.model.AppSettings
import io.github.lopezec007.planner.data.model.Dates
import io.github.lopezec007.planner.data.model.Item
import io.github.lopezec007.planner.data.model.PlannerColors
import io.github.lopezec007.planner.data.model.Status
import io.github.lopezec007.planner.data.model.User
import io.github.lopezec007.planner.ui.theme.LocalPalette
import io.github.lopezec007.planner.ui.theme.contrastOn
import io.github.lopezec007.planner.ui.theme.hexColor

/** A user's coloured chip with the short label; grey "—" placeholder when null. */
@Composable
fun UserChip(user: User?, modifier: Modifier = Modifier, placeholder: String = "—", muted: Boolean = false) {
    val bg = if (user == null || muted) MaterialTheme.colorScheme.surfaceVariant else hexColor(user.color, MaterialTheme.colorScheme.surfaceVariant)
    val fg = if (user == null || muted) MaterialTheme.colorScheme.onSurfaceVariant else contrastOn(bg)
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .padding(horizontal = 7.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = user?.chip ?: placeholder,
            color = fg,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** A round swatch of a colour (user colours in pickers, Ongoing/Project colours). */
@Composable
fun ColorDot(hex: String?, modifier: Modifier = Modifier, size: Int = 14) {
    val c = hexColor(hex, Color.Transparent)
    Box(
        modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(c)
            .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f), CircleShape),
    )
}

@Composable
fun StatusChip(status: Status?, modifier: Modifier = Modifier) {
    if (status == null) return
    val scheme = MaterialTheme.colorScheme
    val (bg, fg) = when (status) {
        Status.IN_PROGRESS -> scheme.primaryContainer to scheme.onPrimaryContainer
        Status.TODO -> scheme.secondaryContainer to scheme.onSecondaryContainer
        Status.DONE, Status.CANCELLED -> scheme.surfaceVariant to scheme.onSurfaceVariant.copy(alpha = 0.7f)
        else -> scheme.surfaceVariant to scheme.onSurfaceVariant
    }
    Box(
        modifier
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .padding(horizontal = 7.dp, vertical = 2.dp),
    ) {
        Text(status.label, color = fg, fontSize = 12.sp, maxLines = 1)
    }
}

/**
 * Urgency or importance as "U7" / "I9", coloured from the server's ramp for
 * that field (0-5 none, 6-8 orange, 9-10 red by default). No colour on
 * closed items.
 */
@Composable
fun LevelBadge(field: String, value: Int?, settings: AppSettings, closed: Boolean, modifier: Modifier = Modifier) {
    if (value == null) return
    val ramp = if (closed) "" else settings.levelColor(field, value)
    val bg = hexColor(ramp, Color.Transparent)
    val strong = !closed && value >= 9
    Box(
        modifier
            .clip(RoundedCornerShape(5.dp))
            .background(if (bg == Color.Transparent) MaterialTheme.colorScheme.surfaceVariant else bg)
            .padding(horizontal = 5.dp, vertical = 1.dp),
    ) {
        Text(
            "${field.first().uppercaseChar()}$value",
            color = if (bg == Color.Transparent) MaterialTheme.colorScheme.onSurfaceVariant else contrastOn(bg),
            fontSize = 11.sp,
            fontWeight = if (strong) FontWeight.Bold else FontWeight.Medium,
            maxLines = 1,
        )
    }
}

/** The end date, orange within a week and bold red when due today or overdue (never on closed items). */
@Composable
fun EndDateText(item: Item, modifier: Modifier = Modifier) {
    val d = item.endDate ?: return
    val palette = LocalPalette.current
    val level = PlannerColors.endDateLevel(item)
    val prefix = if (item.endFirm) "" else "~"
    Text(
        text = prefix + Dates.human(d),
        modifier = modifier,
        color = when (level) {
            2 -> palette.danger
            1 -> palette.warn
            else -> palette.subtle
        },
        fontWeight = if (level == 2) FontWeight.Bold else FontWeight.Normal,
        fontSize = 12.sp,
        maxLines = 1,
    )
}

/** The item key in monospace, muted; "…" for an item still unsynced. */
@Composable
fun KeyText(key: String, modifier: Modifier = Modifier) {
    Text(
        key,
        modifier = modifier,
        color = LocalPalette.current.subtle,
        fontSize = 12.sp,
        fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
        maxLines = 1,
    )
}
