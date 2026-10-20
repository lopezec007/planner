// Drawing for the Timeline screen: the two-tier date axis, the row bands
// with their grid, the bars (gradient edges per the spec), the dependency
// connectors and the today line. Everything here is plain DrawScope code
// reading the view state (pixels per day, left-edge day) so that pan and
// zoom only invalidate the draw phase.
package io.github.lopezec007.planner.ui.timeline

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.lopezec007.planner.ui.theme.hexColor
import java.time.LocalDate
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

// A row is two lines: the key + title on top (sticky at the left edge), the
// bar below it across the full width, so no text ever covers a bar.
internal val ROW_HEIGHT: Dp = 52.dp
internal val TITLE_LINE: Dp = 20.dp
internal val AXIS_HEIGHT: Dp = 40.dp

/** Colours and text styles resolved from the theme once per composition. */
internal class TimelineColors(
    val axisBg: Color,
    val grid: Color,
    val gridStrong: Color,
    val month: Color,
    val year: Color,
    val firm: Color,
    val today: Color,
    val rowBorder: Color,
    val parentBorder: Color,
    val neutral: Color,
    val dep: Color,
    val depOpen: Color,
    val accent: Color,
    val label: TextStyle,
    val labelStrong: TextStyle,
    val todayLabel: TextStyle,
)

/** Pixel sizes of the dp constants, computed once per density. */
internal class TimelineMetrics(density: Density) {
    val rowPx: Float = with(density) { ROW_HEIGHT.toPx() }
    val titleLinePx: Float = with(density) { TITLE_LINE.toPx() }
    val axisPx: Float = with(density) { AXIS_HEIGHT.toPx() }
    val edgePx: Float = with(density) { 16.dp.toPx() }       // resize zone at either end of a bar
    val barTask: Float = with(density) { 16.dp.toPx() }
    val barParent: Float = with(density) { 11.dp.toPx() }
    val softMax: Float = with(density) { 6.dp.toPx() }       // longest "approximate date" gradient
    val minLong: Float = with(density) { 24.dp.toPx() }      // shortest "missing date" fade
    val firmPx: Float = with(density) { 3.dp.toPx() }
    val radius: Float = with(density) { 3.dp.toPx() }
    val depPad: Float = with(density) { 10.dp.toPx() }
    val depRadius: Float = with(density) { 6.dp.toPx() }
    val depStroke: Float = with(density) { 1.5.dp.toPx() }
    val arrowLen: Float = with(density) { 8.dp.toPx() }
    val arrowHalf: Float = with(density) { 3.dp.toPx() }
    val hairline: Float = with(density) { 1.dp.toPx() }
    val todayStroke: Float = with(density) { 2.dp.toPx() }
    val pad: Float = with(density) { 4.dp.toPx() }

    /** Vertical centre of a row's bar line, for the connectors. */
    fun barCentre(rowTop: Float): Float = rowTop + titleLinePx + (rowPx - titleLinePx) / 2f
}

private fun tickColor(unit: TickUnit, c: TimelineColors, major: Boolean): Color = when (unit) {
    TickUnit.MONTH -> c.month
    TickUnit.YEAR -> c.year
    else -> if (major) c.gridStrong else c.grid
}

private fun tickWidth(unit: TickUnit, m: TimelineMetrics): Float = if (unit == TickUnit.YEAR) m.todayStroke else m.hairline

private fun DrawScope.measure(tm: TextMeasurer, text: String, style: TextStyle, maxWidth: Float): TextLayoutResult =
    tm.measure(
        text = text,
        style = style,
        overflow = TextOverflow.Ellipsis,
        softWrap = false,
        maxLines = 1,
        constraints = Constraints(maxWidth = max(1f, maxWidth).toInt()),
    )

/** The axis: major ticks (month/year) in the top tier, minor (day/week/month/quarter) below, and the today marker. */
internal fun DrawScope.drawTimelineAxis(
    c: TimelineColors,
    m: TimelineMetrics,
    tm: TextMeasurer,
    ppd: Float,
    leftDay: Float,
    today: LocalDate,
    weekStart: Int,
) {
    val w = size.width
    val h = size.height
    val tier = h / 2f
    drawRect(color = c.axisBg)
    val (majorU, minorU) = tickUnits(ppd)
    val from = floor(leftDay).toLong()
    val to = ceil(leftDay + w / ppd).toLong() + 1

    forEachTick(majorU, today, from, to, weekStart) { s, e, d ->
        val x0 = (s - leftDay) * ppd
        val x1 = (e - leftDay) * ppd
        drawLine(color = tickColor(majorU, c, major = true), start = Offset(x0, 0f), end = Offset(x0, h), strokeWidth = tickWidth(majorU, m))
        // The label sticks to the left edge while its unit is scrolled through.
        val lx = max(x0, 0f) + m.pad
        val avail = x1 - lx - m.pad
        if (avail > 8f) {
            val lay = measure(tm, tickLabel(majorU, d, (x1 - x0) / density), c.labelStrong, avail)
            drawText(lay, topLeft = Offset(lx, (tier - lay.size.height) / 2f))
        }
    }
    forEachTick(minorU, today, from, to, weekStart) { s, e, d ->
        val x0 = (s - leftDay) * ppd
        val x1 = (e - leftDay) * ppd
        drawLine(color = tickColor(minorU, c, major = false), start = Offset(x0, tier), end = Offset(x0, h), strokeWidth = tickWidth(minorU, m))
        val avail = x1 - x0 - 2f * m.pad
        if (avail > 6f) {
            val text = tickLabel(minorU, d, (x1 - x0) / density)
            if (text.isNotEmpty()) {
                val lay = measure(tm, text, c.label, avail)
                val lx = if (minorU == TickUnit.DAY) x0 + (x1 - x0 - lay.size.width) / 2f else x0 + m.pad
                drawText(lay, topLeft = Offset(lx, tier + (h - tier - lay.size.height) / 2f))
            }
        }
    }
    drawLine(color = c.rowBorder, start = Offset(0f, tier), end = Offset(w, tier), strokeWidth = m.hairline)
    drawLine(color = c.rowBorder, start = Offset(0f, h - m.hairline / 2f), end = Offset(w, h - m.hairline / 2f), strokeWidth = m.hairline)

    val tx = -leftDay * ppd
    if (tx >= -2f && tx <= w + 2f) {
        drawLine(color = c.today, start = Offset(tx, 0f), end = Offset(tx, h), strokeWidth = m.todayStroke)
        val lay = measure(tm, "TODAY", c.todayLabel, w)
        val pillH = lay.size.height + m.pad / 2f
        drawRoundRect(
            color = c.today,
            topLeft = Offset(tx, m.pad / 2f),
            size = Size(lay.size.width + 2f * m.pad, pillH),
            cornerRadius = CornerRadius(pillH / 2f),
        )
        drawText(lay, topLeft = Offset(tx + m.pad, m.pad / 2f + (pillH - lay.size.height) / 2f))
    }
}

/**
 * The rows: grid lines, bands, bars, connectors and the today line. [geom]
 * receives each row's bar extent (x0, x1, top, bottom; NaN x0 when none),
 * for the connectors and for hit-testing; it must hold rows.size * 4 floats.
 */
internal fun DrawScope.drawTimelineRows(
    model: TimelineModel,
    c: TimelineColors,
    m: TimelineMetrics,
    ppd: Float,
    leftDay: Float,
    today: LocalDate,
    weekStart: Int,
    drag: BarDrag?,
    geom: FloatArray,
    path: Path,
    tmp: BarPx,
) {
    val w = size.width
    val h = size.height
    if (h <= 0f || w <= 0f) return

    // Grid lines continue the axis ticks down the rows.
    val (majorU, minorU) = tickUnits(ppd)
    val from = floor(leftDay).toLong()
    val to = ceil(leftDay + w / ppd).toLong() + 1
    forEachTick(minorU, today, from, to, weekStart) { s, _, _ ->
        val x = (s - leftDay) * ppd
        drawLine(color = tickColor(minorU, c, major = false), start = Offset(x, 0f), end = Offset(x, h), strokeWidth = tickWidth(minorU, m), alpha = 0.6f)
    }
    forEachTick(majorU, today, from, to, weekStart) { s, _, _ ->
        val x = (s - leftDay) * ppd
        drawLine(color = tickColor(majorU, c, major = true), start = Offset(x, 0f), end = Offset(x, h), strokeWidth = tickWidth(majorU, m), alpha = 0.6f)
    }

    val rows = model.rows
    for (i in rows.indices) {
        val row = rows[i]
        val top = i * m.rowPx
        if (row.kind == RowKind.PARENT) {
            val tint = hexColor(row.tintHex, c.neutral)
            drawRect(color = tint, topLeft = Offset(0f, top), size = Size(w, m.rowPx), alpha = 0.16f)
            drawLine(color = c.parentBorder, start = Offset(0f, top), end = Offset(w, top), strokeWidth = m.todayStroke)
        } else if (row.firstOfParent) {
            drawLine(color = c.parentBorder, start = Offset(0f, top), end = Offset(w, top), strokeWidth = m.todayStroke)
        } else {
            drawLine(color = c.rowBorder, start = Offset(0f, top), end = Offset(w, top), strokeWidth = m.hairline)
        }
        val bar = row.bar
        val g = i * 4
        if (bar == null) {
            geom[g] = Float.NaN
            continue
        }
        val d = if (drag != null && drag.itemId == bar.itemId) drag else null
        resolveBar(bar, ppd, leftDay, d?.shiftStart ?: 0, d?.shiftEnd ?: 0, m.softMax, m.minLong, tmp)
        geom[g] = tmp.x0
        geom[g + 1] = tmp.x1
        geom[g + 2] = top
        geom[g + 3] = top + m.rowPx
        if (tmp.x1 < 0f || tmp.x0 > w) continue
        val barH = if (row.kind == RowKind.PARENT) m.barParent else m.barTask
        drawBar(bar, tmp, m.barCentre(top) - barH / 2f, barH, c, m, dragging = d != null)
    }

    for (e in model.edges) {
        val a = e.from * 4
        val b = e.to * 4
        if (geom[a].isNaN() || geom[b].isNaN()) continue
        val ax1 = geom[a + 1]
        val aTop = geom[a + 2]
        val aBot = geom[a + 3]
        val ayc = m.barCentre(aTop)
        val bx0 = geom[b]
        val byc = m.barCentre(geom[b + 2])
        val color = if (e.open) c.depOpen else c.dep
        val alpha = if (e.open) 0.85f else 0.6f
        path.reset()
        connectorPath(path, ax1, ayc, aTop, aBot, bx0, byc, m.depPad, m.depRadius)
        drawPath(path = path, color = color, alpha = alpha, style = Stroke(width = m.depStroke, join = StrokeJoin.Round))
        path.reset()
        path.moveTo(bx0, byc)
        path.lineTo(bx0 - m.arrowLen, byc - m.arrowHalf)
        path.lineTo(bx0 - m.arrowLen, byc + m.arrowHalf)
        path.close()
        drawPath(path = path, color = color, alpha = alpha)
    }

    val tx = -leftDay * ppd
    if (tx >= -2f && tx <= w + 2f) {
        drawLine(color = c.today, start = Offset(tx, 0f), end = Offset(tx, h), strokeWidth = m.todayStroke)
    }
}

/** One bar: a rounded rect filled with a horizontal gradient that fades at the soft/missing ends. */
private fun DrawScope.drawBar(bar: Bar, g: BarPx, y: Float, barH: Float, c: TimelineColors, m: TimelineMetrics, dragging: Boolean) {
    val wBar = g.x1 - g.x0
    var color = hexColor(bar.colorHex, c.neutral)
    var alpha = 1f
    if (bar.closed) {
        // Desaturated and faint, like the web's grayscale filter.
        val lum = 0.299f * color.red + 0.587f * color.green + 0.114f * color.blue
        color = lerp(color, Color(lum, lum, lum), 0.8f)
        alpha = 0.5f
    }
    if (bar.blocked) alpha = if (bar.closed) 0.3f else 0.4f

    val fl = g.fadeL.coerceIn(0f, wBar) / wBar
    val fr = 1f - g.fadeR.coerceIn(0f, wBar) / wBar
    val brush: Brush = if (g.fadeL <= 0f && g.fadeR <= 0f) {
        SolidColor(color)
    } else {
        var a = fl
        var b = fr
        if (a > b) {
            val mid = (a + b) / 2f
            a = mid
            b = mid
        }
        Brush.horizontalGradient(
            0f to (if (g.fadeL > 0f) color.copy(alpha = 0f) else color),
            a to color,
            b to color,
            1f to (if (g.fadeR > 0f) color.copy(alpha = 0f) else color),
            startX = g.x0,
            endX = g.x1,
        )
    }
    val topLeft = Offset(g.x0, y)
    val sz = Size(wBar, barH)
    val radius = CornerRadius(m.radius)
    if (bar.closed) {
        // Closed: an outline with a faint fill.
        drawRoundRect(brush = brush, topLeft = topLeft, size = sz, cornerRadius = radius, alpha = alpha * 0.45f)
        drawRoundRect(brush = brush, topLeft = topLeft, size = sz, cornerRadius = radius, alpha = alpha, style = Stroke(width = m.hairline))
    } else {
        drawRoundRect(brush = brush, topLeft = topLeft, size = sz, cornerRadius = radius, alpha = alpha)
        drawRoundRect(color = Color.Black, topLeft = topLeft, size = sz, cornerRadius = radius, style = Stroke(width = m.hairline), alpha = 0.18f * alpha)
    }
    // Firm dates: a bright marker on that end, as in the web UI.
    if (bar.start != null && bar.startFirm) {
        drawRect(color = c.firm, topLeft = Offset(g.x0, y), size = Size(m.firmPx, barH), alpha = alpha)
    }
    if (bar.endExcl != null && bar.endFirm) {
        drawRect(color = c.firm, topLeft = Offset(g.x1 - m.firmPx, y), size = Size(m.firmPx, barH), alpha = alpha)
    }
    if (dragging) {
        drawRoundRect(
            color = c.accent,
            topLeft = Offset(g.x0 - m.todayStroke, y - m.todayStroke),
            size = Size(wBar + 2f * m.todayStroke, barH + 2f * m.todayStroke),
            cornerRadius = CornerRadius(m.radius + m.todayStroke),
            style = Stroke(width = m.todayStroke),
        )
    }
}

/**
 * Route from the end of the blocker bar to the start of the blocked bar
 * (timeline.js connectorPoints): a simple elbow through the gap when the
 * blocked bar starts after the blocker ends; otherwise out past the
 * blocker's end, back along the edge of its row, and in from the left.
 */
private fun connectorPath(path: Path, ax1: Float, ayc: Float, aTop: Float, aBot: Float, bx0: Float, byc: Float, pad: Float, r: Float) {
    val pts = FloatArray(12)
    val n: Int
    val gap = bx0 - ax1
    if (gap >= 2f * pad) {
        val mx = ax1 + gap / 2f
        pts[0] = ax1; pts[1] = ayc
        pts[2] = mx; pts[3] = ayc
        pts[4] = mx; pts[5] = byc
        pts[6] = bx0; pts[7] = byc
        n = 4
    } else {
        val ym = if (byc > ayc) aBot else aTop
        pts[0] = ax1; pts[1] = ayc
        pts[2] = ax1 + pad; pts[3] = ayc
        pts[4] = ax1 + pad; pts[5] = ym
        pts[6] = bx0 - pad; pts[7] = ym
        pts[8] = bx0 - pad; pts[9] = byc
        pts[10] = bx0; pts[11] = byc
        n = 6
    }
    roundedPath(path, pts, n, r)
}

/** An orthogonal polyline with rounded corners, starting and ending exactly on the first and last points. */
private fun roundedPath(path: Path, p: FloatArray, count: Int, r: Float) {
    // Drop consecutive duplicate points (a zero-length segment has no corner).
    val q = FloatArray(count * 2)
    var n = 0
    for (i in 0 until count) {
        val x = p[2 * i]
        val y = p[2 * i + 1]
        if (n > 0 && q[2 * n - 2] == x && q[2 * n - 1] == y) continue
        q[2 * n] = x
        q[2 * n + 1] = y
        n++
    }
    path.moveTo(q[0], q[1])
    for (i in 1 until n - 1) {
        val ax = q[2 * i - 2]; val ay = q[2 * i - 1]
        val cx = q[2 * i]; val cy = q[2 * i + 1]
        val bx = q[2 * i + 2]; val by = q[2 * i + 3]
        val inLen = hypot(cx - ax, cy - ay)
        val outLen = hypot(bx - cx, by - cy)
        val rr = min(r, min(inLen / 2f, outLen / 2f))
        val ix = cx + (ax - cx) / inLen * rr
        val iy = cy + (ay - cy) / inLen * rr
        val ox = cx + (bx - cx) / outLen * rr
        val oy = cy + (by - cy) / outLen * rr
        path.lineTo(ix, iy)
        path.quadraticTo(cx, cy, ox, oy)
    }
    path.lineTo(q[2 * n - 2], q[2 * n - 1])
}
