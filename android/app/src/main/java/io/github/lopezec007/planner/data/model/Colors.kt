// Colour rules shared by the list, timeline and matrix (the web UI's
// colors.js and the highlighting section of the spec).
package io.github.lopezec007.planner.data.model

import kotlin.math.roundToInt

object PlannerColors {
    // Corners of the importance × urgency blend, as in colors.js.
    const val COMBO_NEITHER = "#9aa3ad"
    const val COMBO_URGENT = "#f5a524"
    const val COMBO_IMPORTANT = "#3b7dd8"
    const val COMBO_BOTH = "#e5484d"

    /** End-date highlight: 2 = today/overdue (red), 1 = within 7 days (orange), 0 = none. Closed items: 0. */
    fun endDateLevel(item: Item): Int {
        if (item.isClosed) return 0
        val d = item.endDate ?: return 0
        val days = Dates.daysFromToday(d)
        return when {
            days <= 0 -> 2
            days <= 7 -> 1
            else -> 0
        }
    }

    /** Parses "#rrggbb" to packed ARGB, or null when blank/malformed. */
    fun parse(hex: String?): Int? {
        if (hex.isNullOrBlank() || !hex.startsWith("#") || hex.length != 7) return null
        return hex.substring(1).toIntOrNull(16)?.or(0xFF shl 24)
    }

    private fun rgb(hex: String): IntArray {
        val n = hex.substring(1).toInt(16)
        return intArrayOf((n shr 16) and 255, (n shr 8) and 255, n and 255)
    }

    private fun hex2(v: Double) = v.roundToInt().coerceIn(0, 255).toString(16).padStart(2, '0')

    /** Bilinear blend of the four corners at urgency u and importance i (0..10). */
    fun comboColor(urgency: Int?, importance: Int?): String {
        val u = ((urgency ?: 0) / 10.0).coerceIn(0.0, 1.0)
        val i = ((importance ?: 0) / 10.0).coerceIn(0.0, 1.0)
        val c00 = rgb(COMBO_NEITHER); val c10 = rgb(COMBO_URGENT)
        val c01 = rgb(COMBO_IMPORTANT); val c11 = rgb(COMBO_BOTH)
        val out = (0..2).map { k ->
            (1 - u) * (1 - i) * c00[k] + u * (1 - i) * c10[k] + (1 - u) * i * c01[k] + u * i * c11[k]
        }
        return "#${hex2(out[0])}${hex2(out[1])}${hex2(out[2])}"
    }

    /** Black or white text for a background colour. */
    fun contrastText(hex: String): String {
        val c = rgb(hex)
        val lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255
        return if (lum > 0.6) "#000000" else "#ffffff"
    }
}

/** Colouring modes for timeline bars; the matrix uses the first two and PARENT. */
enum class ColorMode(val wire: String, val label: String) {
    ASSIGNEE("assignee", "Assignee"),
    OWNER("owner", "Owner"),
    IMPORTANCE("importance", "Importance"),
    URGENCY("urgency", "Urgency"),
    COMBO("combo", "Importance × Urgency"),
    PARENT("parent", "Ongoing / Project");

    companion object {
        val forBars = entries
        val forPoints = listOf(ASSIGNEE, OWNER, PARENT)
        fun fromWire(s: String?, default: ColorMode = ASSIGNEE) = entries.firstOrNull { it.wire == s } ?: default
    }
}

/**
 * Resolves item colours given the users, settings and a parent lookup; built
 * once per render from the repository snapshot.
 */
class ColorResolver(
    private val usersById: Map<Long, User>,
    private val settings: AppSettings,
    private val itemsById: Map<Long, Item>,
) {
    private val neutral get() = settings.colorUnassigned.ifBlank { PlannerColors.COMBO_NEITHER }

    /** An Ongoing's/Project's effective colour: its own, else the type colour. "" for tasks. */
    fun ownColor(parent: Item?): String {
        if (parent == null || parent.type == ItemType.TASK) return ""
        if (parent.color.isNotBlank()) return parent.color
        return if (parent.type == ItemType.ONGOING) settings.colorOngoing else settings.colorProject
    }

    /** The colour of the Ongoing/Project the item belongs to (a parent: its own). */
    fun parentColor(item: Item): String =
        ownColor(if (item.type == ItemType.TASK) item.parentId?.let { itemsById[it] } else item)

    fun userColor(id: Long?): String? = id?.let { usersById[it]?.color }

    /** Bar or point colour for [item] in [mode]. */
    fun color(item: Item, mode: ColorMode): String = when (mode) {
        ColorMode.ASSIGNEE -> userColor(item.assigneeId) ?: neutral
        ColorMode.OWNER -> userColor(item.ownerId) ?: neutral
        ColorMode.IMPORTANCE -> if (item.type != ItemType.TASK) neutral else settings.levelColor("importance", item.importance).ifBlank { neutral }
        ColorMode.URGENCY -> if (item.type != ItemType.TASK) neutral else settings.levelColor("urgency", item.urgency).ifBlank { neutral }
        ColorMode.COMBO -> if (item.type != ItemType.TASK) PlannerColors.COMBO_NEITHER else PlannerColors.comboColor(item.urgency, item.importance)
        ColorMode.PARENT -> parentColor(item).ifBlank { neutral }
    }
}
