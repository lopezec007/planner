// Data behind the Timeline screen: the rows (parents and dated tasks in
// display order), each bar in day units (offsets from today, so the geometry
// does not depend on the zoom), the dependency edges between rows, the
// session view state (pixels per day and the day at the left edge) and the
// axis tick rules, all ported from static/js/timeline.js.
//
// Rows: every parent in `groups` gets a row, dated or not (so the grouping
// reads and a parent without dates shows a "no dates" hint). Tasks with
// neither a start nor an end date are omitted: the spec says they are not
// rendered on the timeline, and on a phone a bar-less task row would only
// cost space.
package io.github.lopezec007.planner.ui.timeline

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import io.github.lopezec007.planner.data.model.ColorMode
import io.github.lopezec007.planner.data.model.Dates
import io.github.lopezec007.planner.data.model.Group
import io.github.lopezec007.planner.data.model.Item
import io.github.lopezec007.planner.data.repo.Snapshot
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlin.math.max
import kotlin.math.min

internal const val MAX_PPD = 80f              // max pixels per day
internal const val MISSING_FADE_DAYS = 14     // tail length for a missing start or end date
internal const val MIN_RANGE_DAYS = 730f      // zoomed all the way out, about two years fit the width

internal enum class RowKind { PARENT, TASK }

/** Which part of a bar a long-press took hold of. */
internal enum class Zone { START, END, MOVE }

/**
 * A bar in day offsets from today. A null [start] or [endExcl] is a missing
 * date (it fades); [endExcl] is the end date plus one so the bar covers the
 * end day. [depStart] / [depEnd] pin a missing date's fade to the latest
 * blocker end / earliest blocked start when there is one, as the web UI does.
 */
internal class Bar(
    val itemId: Long,
    val start: Long?,
    val endExcl: Long?,
    val depStart: Long?,
    val depEnd: Long?,
    val startFirm: Boolean,
    val endFirm: Boolean,
    val closed: Boolean,
    val blocked: Boolean,
    val colorHex: String,
)

internal class TimelineRow(
    val item: Item,
    val kind: RowKind,
    val index: Int,
    val bar: Bar?,
    val tintHex: String,   // a parent's own colour ("" for tasks)
    val parent: Item? = null,          // Flat only: the task's Ongoing/Project, named on the row
    val firstOfParent: Boolean = false, // Flat only: first task of its parent (heavier rule above)
)

/** A dependency between two rows that both have a bar; `open` while the blocker is not closed. */
internal class Edge(val from: Int, val to: Int, val open: Boolean)

internal class TimelineModel(val rows: List<TimelineRow>, val edges: List<Edge>) {
    val hasBars: Boolean = rows.any { it.bar != null }
}

/** Dates just committed from a drag, shown until the snapshot catches up (avoids a snap-back flicker). */
internal data class PendingDates(val id: Long, val start: LocalDate?, val end: LocalDate?)

/**
 * Rows in display order. Nested: every parent, then its dated tasks. Flat
 * (as in the list): dated tasks only, each naming its parent, with the
 * heavier rule above the first task of each parent.
 */
internal fun buildTimelineModel(snap: Snapshot, groups: List<Group>, mode: ColorMode, pending: PendingDates?, flat: Boolean = false): TimelineModel {
    val rows = ArrayList<TimelineRow>()
    val rowOf = HashMap<Long, Int>()
    fun add(stored: Item, kind: RowKind, parent: Item? = null, firstOfParent: Boolean = false) {
        val item = if (pending != null && pending.id == stored.id) stored.copy(startDate = pending.start, endDate = pending.end) else stored
        val bar = barFor(snap, item, mode)
        val tint = if (kind == RowKind.PARENT) snap.colors.ownColor(item) else ""
        val index = rows.size
        rows.add(TimelineRow(item, kind, index, bar, tint, parent, firstOfParent))
        if (bar != null) rowOf[item.id] = index
    }
    for (g in groups) {
        if (!flat) add(g.parent, RowKind.PARENT)
        var first = true
        for (t in g.tasks) {
            val dated = t.startDate != null || t.endDate != null || pending?.id == t.id
            if (!dated) continue
            if (flat) add(t, RowKind.TASK, parent = g.parent, firstOfParent = first) else add(t, RowKind.TASK)
            first = false
        }
    }
    val edges = snap.dependencyEdges.mapNotNull { (blocker, blocked) ->
        val a = rowOf[blocker] ?: return@mapNotNull null
        val b = rowOf[blocked] ?: return@mapNotNull null
        Edge(a, b, open = snap.item(blocker)?.isClosed != true)
    }
    return TimelineModel(rows, edges)
}

private fun barFor(snap: Snapshot, item: Item, mode: ColorMode): Bar? {
    val s = item.startDate
    val e = item.endDate
    if (s == null && e == null) return null
    val start = s?.let { Dates.daysFromToday(it) }
    val endExcl = e?.let { Dates.daysFromToday(it) + 1 }
    val depStart = if (start == null) {
        item.blockedBy.mapNotNull { snap.item(it)?.endDate }.maxOrNull()?.let { Dates.daysFromToday(it) + 1 }
    } else null
    val depEnd = if (endExcl == null) {
        item.blocks.mapNotNull { snap.item(it)?.startDate }.minOrNull()?.let { Dates.daysFromToday(it) }
    } else null
    return Bar(
        itemId = item.id,
        start = start,
        endExcl = endExcl,
        depStart = depStart,
        depEnd = depEnd,
        startFirm = item.startFirm,
        endFirm = item.endFirm,
        closed = item.isClosed,
        blocked = snap.isBlocked(item),
        colorHex = snap.colors.color(item, mode),
    )
}

// ---------------------------------------------------------------- view state

/**
 * Pixels per day and the (fractional) day offset from today at the left edge
 * of the viewport. Both start unset and default to the spec's window (one
 * month before today at the left edge, four months across) once the width
 * is known; gestures then set them explicitly. Kept for the session only.
 */
internal class TimelineView {
    var ppd: Float by mutableFloatStateOf(0f)
    var leftDay: Float by mutableFloatStateOf(Float.NaN)

    private val winStart: Long
    private val winEnd: Long

    init {
        val today = Dates.today()
        winStart = ChronoUnit.DAYS.between(today, today.minusMonths(1))
        winEnd = ChronoUnit.DAYS.between(today, today.plusMonths(3))
    }

    /** Today's position within the default window (about a quarter of the width). */
    private val winFrac: Float get() = -winStart.toFloat() / (winEnd - winStart).toFloat()

    fun minPpd(widthPx: Float): Float = if (widthPx > 0f) widthPx / MIN_RANGE_DAYS else 0.1f

    fun ppdFor(widthPx: Float): Float {
        if (widthPx <= 0f) return 10f
        val p = if (ppd > 0f) ppd else widthPx / (winEnd - winStart).toFloat()
        return p.coerceIn(minPpd(widthPx), MAX_PPD)
    }

    fun leftFor(): Float = if (leftDay.isNaN()) winStart.toFloat() else leftDay

    fun pan(dxPx: Float, widthPx: Float) {
        leftDay = leftFor() - dxPx / ppdFor(widthPx)
    }

    /** Zoom by [factor] keeping the day under viewport x [anchorX] fixed. */
    fun zoom(factor: Float, anchorX: Float, widthPx: Float) {
        if (!(factor > 0f) || factor.isNaN()) return
        val cur = ppdFor(widthPx)
        val next = (cur * factor).coerceIn(minPpd(widthPx), MAX_PPD)
        if (next == cur) return
        val anchorDay = leftFor() + anchorX / cur
        ppd = next
        leftDay = anchorDay - anchorX / next
    }

    /** Recentre so that today sits where it does in the default window. */
    fun today(widthPx: Float) {
        leftDay = -(widthPx / ppdFor(widthPx)) * winFrac
    }
}

/** A bar being moved or resized by a long-press drag; [days] is the whole-day shift so far. */
internal class BarDrag(val itemId: Long, val zone: Zone, val start: Long?, val endExcl: Long?) {
    var days: Int by mutableIntStateOf(0)
    val shiftStart: Int get() = if (zone == Zone.END) 0 else days
    val shiftEnd: Int get() = if (zone == Zone.START) 0 else days
}

// ---------------------------------------------------------------- bar geometry in pixels

internal class BarPx {
    var x0 = 0f
    var x1 = 0f
    var fadeL = 0f
    var fadeR = 0f
}

/**
 * Pixel extent and fade lengths of [bar] at the given scale, with the drag
 * shifts applied. Edge rules: a firm date is a hard edge, an approximate one
 * a short gradient (at most [softMax] px, about 0.6 day), a missing one a
 * [MISSING_FADE_DAYS] fade (at least [minLong] px) from the other end, or a
 * fade to the dependency that pins it.
 */
internal fun resolveBar(bar: Bar, ppd: Float, leftDay: Float, shiftStart: Int, shiftEnd: Int, softMax: Float, minLong: Float, out: BarPx) {
    val longFade = max(MISSING_FADE_DAYS * ppd, minLong)
    val soft = min(softMax, 0.6f * ppd).coerceAtLeast(2f)
    val s = bar.start?.let { it + shiftStart }
    val e = bar.endExcl?.let { it + shiftEnd }
    var x0 = 0f
    var x1 = 0f
    var fadeL = 0f
    var fadeR = 0f
    if (s != null) {
        x0 = (s - leftDay) * ppd
        fadeL = if (bar.startFirm) 0f else soft
    }
    if (e != null) {
        x1 = (e - leftDay) * ppd
        fadeR = if (bar.endFirm) 0f else soft
    }
    if (s == null) {
        val dep = bar.depStart?.let { (it - leftDay) * ppd }
        if (dep != null && dep < x1 - 4f) {
            x0 = dep
            fadeL = x1 - x0
        } else {
            x0 = x1 - longFade
            fadeL = longFade
        }
    }
    if (e == null) {
        val dep = bar.depEnd?.let { (it - leftDay) * ppd }
        if (dep != null && dep > x0 + 4f) {
            x1 = dep
            fadeR = x1 - x0
        } else {
            x1 = x0 + longFade
            fadeR = longFade
        }
    }
    if (x1 < x0 + 4f) x1 = x0 + 4f
    out.x0 = x0
    out.x1 = x1
    out.fadeL = fadeL
    out.fadeR = fadeR
}

// ---------------------------------------------------------------- axis ticks

internal enum class TickUnit { DAY, WEEK, MONTH, QUARTER, YEAR }

private val MONTHS = arrayOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
private val MONTHS_LONG = arrayOf(
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)
private val WEEKDAYS = arrayOf("Su", "Mo", "Tu", "We", "Th", "Fr", "Sa")

/** Major and minor tick units for a scale (timeline.js tickUnits). */
internal fun tickUnits(ppd: Float): Pair<TickUnit, TickUnit> = when {
    ppd >= 16f -> TickUnit.MONTH to TickUnit.DAY
    ppd >= 3.2f -> TickUnit.MONTH to TickUnit.WEEK
    ppd >= 0.9f -> TickUnit.YEAR to TickUnit.MONTH
    else -> TickUnit.YEAR to TickUnit.QUARTER
}

/** [weekStart] is 0 = Sunday ... 6 = Saturday, like the setting. */
private fun snapTo(d: LocalDate, unit: TickUnit, weekStart: Int): LocalDate = when (unit) {
    TickUnit.DAY -> d
    TickUnit.WEEK -> d.minusDays(((d.dayOfWeek.value % 7 - weekStart + 7) % 7).toLong())
    TickUnit.MONTH -> d.withDayOfMonth(1)
    TickUnit.QUARTER -> d.withDayOfMonth(1).withMonth(d.monthValue - (d.monthValue - 1) % 3)
    TickUnit.YEAR -> d.withDayOfYear(1)
}

private fun step(d: LocalDate, unit: TickUnit): LocalDate = when (unit) {
    TickUnit.DAY -> d.plusDays(1)
    TickUnit.WEEK -> d.plusWeeks(1)
    TickUnit.MONTH -> d.plusMonths(1)
    TickUnit.QUARTER -> d.plusMonths(3)
    TickUnit.YEAR -> d.plusYears(1)
}

/** The label for a tick given the width (in dp) it has to fit in. */
internal fun tickLabel(unit: TickUnit, d: LocalDate, widthDp: Float): String = when (unit) {
    TickUnit.DAY -> if (widthDp >= 44f) "${WEEKDAYS[d.dayOfWeek.value % 7]} ${d.dayOfMonth}" else d.dayOfMonth.toString()
    TickUnit.WEEK -> if (widthDp >= 54f) "${MONTHS[d.monthValue - 1]} ${d.dayOfMonth}" else d.dayOfMonth.toString()
    TickUnit.MONTH -> when {
        widthDp >= 110f -> "${MONTHS_LONG[d.monthValue - 1]} ${d.year}"
        widthDp >= 64f -> "${MONTHS[d.monthValue - 1]} ${d.year}"
        widthDp >= 26f -> MONTHS[d.monthValue - 1]
        else -> MONTHS[d.monthValue - 1].take(1)
    }
    TickUnit.QUARTER -> if (widthDp >= 22f) "Q${(d.monthValue - 1) / 3 + 1}" else ""
    TickUnit.YEAR -> d.year.toString()
}

/** Calls [block] with the (start, end) day offsets from [today] and the date of every [unit] boundary in [from, to). */
internal fun forEachTick(unit: TickUnit, today: LocalDate, from: Long, to: Long, weekStart: Int, block: (Long, Long, LocalDate) -> Unit) {
    var d = snapTo(today.plusDays(from), unit, weekStart)
    while (true) {
        val start = ChronoUnit.DAYS.between(today, d)
        if (start >= to) return
        val next = step(d, unit)
        block(start, ChronoUnit.DAYS.between(today, next), d)
        d = next
    }
}
