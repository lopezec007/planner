// The Matrix view: the visible tasks as an urgency × importance scatter in
// the Eisenhower orientation (urgency 10 at the left, importance 10 at the
// top, so urgent-and-important is top-left), a port of static/js/matrix.js.
// Urgency runs 0..10; importance -1..10, so the y axis has one more cell.
// A dot's radius grows with the task's effort (log2 of effort over 15
// minutes: 4dp at 15m up to 11dp at 64h); no effort gives the default 6dp.
//
// Layout: the point-colouring picker in a strip at the top right, then a
// Canvas filling the rest of the screen. The plot area is the canvas less
// margins for the tick numbers and axis titles; each axis uses its own pixel
// extent, with half a cell of padding so the 0 and 10 rows stay clear of the
// frame. Tasks sharing a grid point are spread evenly on a small circle
// around it, ordered by id, so the layout is deterministic. Dependency lines
// run from the blocker's dot to the blocked dot beneath the points (open
// blockers in the alert colour, arrowhead at the blocked end).
//
// Gestures: a tap selects the nearest point within reach and shows its card
// over the bottom of the plot (tapping empty space clears it); the card's
// title (and its Open button) opens the task's detail screen; a long press
// on a point and then a drag moves it, with a live "U7 · I9" label, and the
// snapped values are saved on release when they changed.
package io.github.lopezec007.planner.ui.matrix

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.lopezec007.planner.data.model.ColorMode
import io.github.lopezec007.planner.data.model.Group
import io.github.lopezec007.planner.data.model.Item
import io.github.lopezec007.planner.data.model.ItemType
import io.github.lopezec007.planner.data.repo.ItemPatch
import io.github.lopezec007.planner.data.repo.Opt
import io.github.lopezec007.planner.data.repo.Snapshot
import io.github.lopezec007.planner.data.repo.set
import io.github.lopezec007.planner.ui.PlannerViewModel
import io.github.lopezec007.planner.ui.components.EffortBadge
import io.github.lopezec007.planner.ui.components.KeyText
import io.github.lopezec007.planner.ui.components.LevelBadge
import io.github.lopezec007.planner.ui.components.MarkdownText
import io.github.lopezec007.planner.ui.components.StatusChip
import io.github.lopezec007.planner.ui.components.UserChip
import io.github.lopezec007.planner.ui.theme.LocalPalette
import io.github.lopezec007.planner.ui.theme.hexColor
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

private const val MAX = 10
private const val IMP_MIN = -1   // the importance axis' lower end (urgency starts at 0)
private const val EFFORT_BASE = 15.0   // the effort (minutes) drawn at the smallest radius
private const val EFFORT_TOP = 3840.0  // 64h: the effort drawn at the largest radius

@Composable
fun MatrixScreen(vm: PlannerViewModel, groups: List<Group>, onOpen: (Long) -> Unit, modifier: Modifier = Modifier) {
    val snap by vm.snapshot.collectAsStateWithLifecycle()
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val palette = LocalPalette.current

    val mode = prefs?.pointColor?.takeIf { it in ColorMode.forPoints } ?: ColorMode.ASSIGNEE
    // Only tasks with both values are plotted (parents have neither).
    val tasks = remember(groups) {
        groups.flatMap { g -> g.tasks }.filter { it.type == ItemType.TASK && it.urgency != null && it.importance != null }
    }

    var selectedId by remember { mutableStateOf<Long?>(null) }
    // The values a just-dragged point was given, shown until the snapshot
    // catches up so the point does not jump back for a frame.
    var pending by remember { mutableStateOf<PendingMove?>(null) }
    LaunchedEffect(tasks) { pending = null }
    val shown = remember(tasks, pending) {
        val p = pending
        if (p == null) tasks else tasks.map { if (it.id == p.id) it.copy(urgency = p.urgency, importance = p.importance) else it }
    }
    val selected = selectedId?.let { id -> shown.firstOrNull { it.id == id } }

    Column(modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PointColorPicker(mode = mode, onPick = { vm.setPointColor(it) })
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (shown.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("No tasks match the current filters.", color = palette.subtle, style = MaterialTheme.typography.bodyMedium)
                }
            } else {
                MatrixPlot(
                    tasks = shown,
                    snap = snap,
                    mode = mode,
                    selectedId = selectedId,
                    onSelect = { selectedId = it },
                    onMove = { item, u, i ->
                        pending = PendingMove(item.id, u, i)
                        scope.launch {
                            vm.repo.patchItem(
                                item.id,
                                ItemPatch(
                                    urgency = if (u != item.urgency) set(u) else Opt.Unset,
                                    importance = if (i != item.importance) set(i) else Opt.Unset,
                                ),
                            )
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            }
            if (selected != null) {
                PointCard(
                    item = selected,
                    snap = snap,
                    onOpen = { onOpen(selected.id) },
                    onClose = { selectedId = null },
                    modifier = Modifier.align(Alignment.BottomCenter),
                )
            }
        }
    }
}

// ---------------------------------------------------------------- geometry

private data class PendingMove(val id: Long, val urgency: Int, val importance: Int)

/** A plotted task at its pixel position (jitter included) and its radius (from its effort). */
private class PlotPoint(val item: Item, val x: Float, val y: Float, val r: Float)

/** A dependency between two plotted points; `open` when the blocker is not closed. */
private class Edge(val from: PlotPoint, val to: PlotPoint, val open: Boolean)

/** A point being dragged: the point and the pointer's travel since the long press. */
private class Drag(val point: PlotPoint, val dx: Float, val dy: Float)

/** Every size in pixels, from dp once per density. */
private class Metrics(density: Density) {
    val pointR = with(density) { 6.dp.toPx() }        // a task without effort
    val pointMin = with(density) { 4.dp.toPx() }      // 15m
    val pointMax = with(density) { 11.dp.toPx() }     // 64h and above
    val hitR = with(density) { 14.dp.toPx() }
    val ring = with(density) { 2.dp.toPx() }         // surface ring around a dot
    val ringGap = with(density) { 3.5.dp.toPx() }    // radius offset of the blocked ring
    val jitterMin = with(density) { 9.dp.toPx() }
    val jitterGap = with(density) { 3.dp.toPx() }    // clearance between jittered dots
    val hairline = with(density) { 1.dp.toPx() }
    val dash = with(density) { 2.dp.toPx() }
    val arrowLen = with(density) { 7.dp.toPx() }
    val arrowHalf = with(density) { 2.5.dp.toPx() }
    val minDep = with(density) { 6.dp.toPx() }       // shortest dependency line worth drawing
    val tickGap = with(density) { 5.dp.toPx() }
    val labelGap = with(density) { 5.dp.toPx() }
    val labelPad = with(density) { 6.dp.toPx() }
    val corner = with(density) { 4.dp.toPx() }
    val axisTitleX = with(density) { 10.dp.toPx() }  // centre of the rotated y-axis title
    val marginTop = with(density) { 10.dp.toPx() }
    val marginRight = with(density) { 12.dp.toPx() }
    val marginBottom = with(density) { 44.dp.toPx() }
    val marginLeft = with(density) { 44.dp.toPx() }

    /** The dot radius for an effort: log2(effort / 15m) scaled over 15m..64h, clamped; the default without one. */
    fun radiusFor(effort: Int?): Float {
        if (effort == null || effort <= 0) return pointR
        val t = (ln(effort / EFFORT_BASE) / ln(EFFORT_TOP / EFFORT_BASE)).toFloat().coerceIn(0f, 1f)
        return pointMin + (pointMax - pointMin) * t
    }
}

/**
 * Pixel scales for the plot area (matrix.js `scales`): half a cell of inner
 * padding on each axis keeps points at the ends clear of the frame; the x
 * axis is reversed (urgency 10 at the left); the y axis runs IMP_MIN..MAX.
 * `cell` is the smaller cell size and bounds the jitter so clusters stay
 * inside a cell on both axes.
 */
private class Plot(val left: Float, val top: Float, val plotW: Float, val plotH: Float) {
    val right = left + plotW
    val bottom = top + plotH
    private val cellsX = MAX + 1
    private val cellsY = MAX - IMP_MIN + 1
    val cell = min(plotW / cellsX, plotH / cellsY)
    private val padX = plotW / cellsX / 2
    private val padY = plotH / cellsY / 2
    private val spanX = plotW - 2 * padX
    private val spanY = plotH - 2 * padY

    fun sx(u: Float): Float = left + padX + (MAX - u) / MAX * spanX
    fun sy(i: Float): Float = top + padY + (MAX - i) / (MAX - IMP_MIN) * spanY
    fun ux(x: Float): Float = MAX - (x - left - padX) / spanX * MAX
    fun iy(y: Float): Float = MAX - (y - top - padY) / spanY * (MAX - IMP_MIN)
}

private fun urgencyLevel(n: Int?): Int = (n ?: 5).coerceIn(0, MAX)
private fun importanceLevel(n: Int?): Int = (n ?: 5).coerceIn(IMP_MIN, MAX)

/** Jitter radius so that n dots of radius up to [maxR] spread evenly on a circle do not touch, kept inside ~40% of a cell. */
private fun jitterRadius(n: Int, maxR: Float, plot: Plot, m: Metrics): Float {
    if (n <= 1) return 0f
    val gap = maxR * 2 + m.jitterGap
    val r = gap / (2 * sin(PI / n)).toFloat()
    return max(m.jitterMin, min(r, plot.cell * 0.4f))
}

/** Lays out the points: tasks sharing a grid point are spread around it, ordered by id. */
private fun layoutPoints(tasks: List<Item>, plot: Plot, m: Metrics): List<PlotPoint> {
    val clusters = LinkedHashMap<Pair<Int, Int>, MutableList<Item>>()
    for (t in tasks) clusters.getOrPut(urgencyLevel(t.urgency) to importanceLevel(t.importance)) { ArrayList() }.add(t)
    val out = ArrayList<PlotPoint>(tasks.size)
    for ((key, cluster) in clusters) {
        cluster.sortBy { it.id }
        val n = cluster.size
        val radii = cluster.map { m.radiusFor(it.effort) }
        val jr = jitterRadius(n, radii.max(), plot, m)
        val cx = plot.sx(key.first.toFloat())
        val cy = plot.sy(key.second.toFloat())
        // Deterministic start angle from the first id, so clusters at
        // different grid points do not all line up the same way.
        val start = -PI / 2 + ((cluster[0].id * 0.61803) % 1.0) * (2 * PI / n)
        cluster.forEachIndexed { k, item ->
            if (n > 1) {
                val angle = start + k * 2 * PI / n
                out.add(PlotPoint(item, cx + (cos(angle) * jr).toFloat(), cy + (sin(angle) * jr).toFloat(), radii[k]))
            } else {
                out.add(PlotPoint(item, cx, cy, radii[k]))
            }
        }
    }
    return out
}

/** The nearest point within reach (the hit radius, or the dot itself when it is bigger), or null. */
private fun hitPoint(points: List<PlotPoint>, pos: Offset, m: Metrics): PlotPoint? {
    var best: PlotPoint? = null
    var bestD = Float.MAX_VALUE
    for (p in points) {
        val d = (Offset(p.x, p.y) - pos).getDistance()
        if (d <= max(m.hitR, p.r + m.ringGap) && d < bestD) {
            best = p
            bestD = d
        }
    }
    return best
}

// ---------------------------------------------------------------- plot

/** Theme colours the draw pass needs, read once in composition. */
private class PlotColors(
    val surface: Color,
    val onSurface: Color,
    val outline: Color,
    val plotBg: Color,
    val subtle: Color,
    val accent: Color,
    val alert: Color,
)

@Composable
private fun MatrixPlot(
    tasks: List<Item>,
    snap: Snapshot,
    mode: ColorMode,
    selectedId: Long?,
    onSelect: (Long?) -> Unit,
    onMove: (Item, Int, Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val m = remember(density) { Metrics(density) }
    val scheme = MaterialTheme.colorScheme
    val palette = LocalPalette.current
    val colors = remember(scheme, palette) {
        PlotColors(
            surface = scheme.surface,
            onSurface = scheme.onSurface,
            outline = scheme.outline,
            plotBg = scheme.surfaceVariant.copy(alpha = 0.35f),
            subtle = palette.subtle,
            accent = palette.accent,
            alert = palette.alert,
        )
    }
    val dash = remember(m) { PathEffect.dashPathEffect(floatArrayOf(m.dash, m.dash)) }

    val textMeasurer = rememberTextMeasurer(cacheSize = 64)
    val typography = MaterialTheme.typography
    val tickStyle = remember(typography, colors) { typography.labelSmall.copy(color = colors.subtle) }
    val axisStyle = remember(typography, colors) {
        typography.labelMedium.copy(color = colors.onSurface, fontWeight = FontWeight.SemiBold)
    }
    val quadStyle = remember(typography, colors) {
        typography.labelSmall.copy(fontSize = 10.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.8.sp)
    }
    val keyStyle = remember(colors) { TextStyle(fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = colors.onSurface) }
    val dragStyle = remember(typography, colors) {
        typography.labelMedium.copy(color = colors.onSurface, fontWeight = FontWeight.SemiBold)
    }
    // Indexed by value - IMP_MIN: the y axis needs the "-1" tick too.
    val tickLayouts = remember(textMeasurer, tickStyle) { (IMP_MIN..MAX).map { textMeasurer.measure(it.toString(), tickStyle) } }
    val urgencyTitle = remember(textMeasurer, axisStyle) { textMeasurer.measure("Urgency", axisStyle) }
    val importanceTitle = remember(textMeasurer, axisStyle) { textMeasurer.measure("Importance", axisStyle) }
    val quadLabels = remember(textMeasurer, quadStyle) {
        listOf("URGENT & IMPORTANT", "IMPORTANT", "URGENT", "NEITHER").map { textMeasurer.measure(it, quadStyle) }
    }

    var canvasSize by remember { mutableStateOf(IntSize.Zero) }
    val plot = remember(canvasSize, m) {
        if (canvasSize.width <= 0 || canvasSize.height <= 0) {
            null
        } else {
            Plot(
                left = m.marginLeft,
                top = m.marginTop,
                plotW = max(1f, canvasSize.width - m.marginLeft - m.marginRight),
                plotH = max(1f, canvasSize.height - m.marginTop - m.marginBottom),
            )
        }
    }
    val points = remember(tasks, plot, m) { if (plot == null) emptyList() else layoutPoints(tasks, plot, m) }
    // Muted (closed or blocked) points are drawn first so live ones sit on top.
    val ordered = remember(points, snap) { points.sortedBy { if (it.item.isClosed || snap.isBlocked(it.item)) 0 else 1 } }
    val edges = remember(points, snap) {
        val byId = points.associateBy { it.item.id }
        snap.dependencyEdges.mapNotNull { (blocker, blocked) ->
            val a = byId[blocker]
            val b = byId[blocked]
            if (a != null && b != null) Edge(a, b, open = !a.item.isClosed) else null
        }
    }

    var drag by remember { mutableStateOf<Drag?>(null) }
    val pointsState = rememberUpdatedState(points)
    val plotState = rememberUpdatedState(plot)
    val onSelectState = rememberUpdatedState(onSelect)
    val onMoveState = rememberUpdatedState(onMove)
    val haptics = LocalHapticFeedback.current

    Canvas(
        modifier = modifier
            .onSizeChanged { canvasSize = it }
            .pointerInput(Unit) {
                detectTapGestures(onTap = { pos ->
                    onSelectState.value(hitPoint(pointsState.value, pos, m)?.item?.id)
                })
            }
            .pointerInput(Unit) {
                detectDragGesturesAfterLongPress(
                    onDragStart = { pos ->
                        val p = hitPoint(pointsState.value, pos, m)
                        if (p != null) {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            drag = Drag(p, 0f, 0f)
                        }
                    },
                    onDrag = { _, amount ->
                        drag = drag?.let { Drag(it.point, it.dx + amount.x, it.dy + amount.y) }
                    },
                    onDragEnd = {
                        val d = drag
                        drag = null
                        val pl = plotState.value
                        if (d != null && pl != null) {
                            val u = pl.ux(d.point.x + d.dx).roundToInt().coerceIn(0, MAX)
                            val i = pl.iy(d.point.y + d.dy).roundToInt().coerceIn(IMP_MIN, MAX)
                            val item = d.point.item
                            if (u != urgencyLevel(item.urgency) || i != importanceLevel(item.importance)) onMoveState.value(item, u, i)
                        }
                    },
                    onDragCancel = { drag = null },
                )
            },
    ) {
        val pl = plot ?: return@Canvas
        val d = drag
        fun pos(p: PlotPoint): Offset =
            if (d != null && d.point.item.id == p.item.id) Offset(p.x + d.dx, p.y + d.dy) else Offset(p.x, p.y)

        // ---- frame, quadrant washes (split at 5 on both axes), grid
        drawRect(colors.plotBg, Offset(pl.left, pl.top), Size(pl.plotW, pl.plotH))
        val mid = MAX / 2f
        val midX = pl.sx(mid)
        val midY = pl.sy(mid)
        drawRect(colors.alert.copy(alpha = 0.07f), Offset(pl.left, pl.top), Size(midX - pl.left, midY - pl.top))
        drawRect(colors.onSurface.copy(alpha = 0.04f), Offset(midX, midY), Size(pl.right - midX, pl.bottom - midY))
        for (v in IMP_MIN..MAX) {
            val major = v == 0 || v == MAX || v == MAX / 2
            val gridColor = colors.outline.copy(alpha = if (major) 0.55f else 0.22f)
            val tick = tickLayouts[v - IMP_MIN]
            if (v >= 0) {
                val x = pl.sx(v.toFloat())
                drawLine(gridColor, Offset(x, pl.top), Offset(x, pl.bottom), m.hairline)
                drawText(tick, topLeft = Offset(x - tick.size.width / 2f, pl.bottom + m.tickGap))
            }
            val y = pl.sy(v.toFloat())
            drawLine(gridColor, Offset(pl.left, y), Offset(pl.right, y), m.hairline)
            drawText(tick, topLeft = Offset(pl.left - m.tickGap - tick.size.width, y - tick.size.height / 2f))
        }
        drawRect(colors.outline.copy(alpha = 0.5f), Offset(pl.left, pl.top), Size(pl.plotW, pl.plotH), style = Stroke(m.hairline))

        // ---- axis titles
        val tickH = tickLayouts[0].size.height
        drawText(
            urgencyTitle,
            topLeft = Offset(midX - urgencyTitle.size.width / 2f, pl.bottom + m.tickGap + tickH + m.tickGap),
        )
        val iy = midY
        rotate(degrees = -90f, pivot = Offset(m.axisTitleX, iy)) {
            drawText(
                importanceTitle,
                topLeft = Offset(m.axisTitleX - importanceTitle.size.width / 2f, iy - importanceTitle.size.height / 2f),
            )
        }

        // ---- quadrant labels, faint, in the outer corners
        val inset = m.labelPad
        drawText(quadLabels[0], color = colors.alert.copy(alpha = 0.55f), topLeft = Offset(pl.left + inset, pl.top + inset))
        drawText(
            quadLabels[1], color = colors.subtle.copy(alpha = 0.45f),
            topLeft = Offset(pl.right - inset - quadLabels[1].size.width, pl.top + inset),
        )
        drawText(
            quadLabels[2], color = colors.subtle.copy(alpha = 0.45f),
            topLeft = Offset(pl.left + inset, pl.bottom - inset - quadLabels[2].size.height),
        )
        drawText(
            quadLabels[3], color = colors.subtle.copy(alpha = 0.45f),
            topLeft = Offset(pl.right - inset - quadLabels[3].size.width, pl.bottom - inset - quadLabels[3].size.height),
        )

        // ---- dependency lines (blocker -> blocked), beneath the points
        for (e in edges) {
            val a = pos(e.from)
            val b = pos(e.to)
            val dx = b.x - a.x
            val dy = b.y - a.y
            val len = hypot(dx, dy)
            if (len < e.from.r + e.to.r + m.minDep) continue // dots overlap: nothing to draw between them
            val ux = dx / len
            val uy = dy / len
            val lit = selectedId != null && (selectedId == e.from.item.id || selectedId == e.to.item.id)
            val base = if (e.open) colors.alert else colors.subtle
            val color = base.copy(alpha = if (lit) 0.9f else if (e.open) 0.5f else 0.35f)
            val start = Offset(a.x + ux * e.from.r, a.y + uy * e.from.r)
            val end = Offset(b.x - ux * e.to.r, b.y - uy * e.to.r)
            drawLine(
                color, start,
                Offset(end.x - ux * m.arrowLen * 0.6f, end.y - uy * m.arrowLen * 0.6f),
                strokeWidth = if (lit) m.hairline * 1.5f else m.hairline,
            )
            val head = Path().apply {
                moveTo(end.x, end.y)
                lineTo(end.x - ux * m.arrowLen - uy * m.arrowHalf, end.y - uy * m.arrowLen + ux * m.arrowHalf)
                lineTo(end.x - ux * m.arrowLen + uy * m.arrowHalf, end.y - uy * m.arrowLen - ux * m.arrowHalf)
                close()
            }
            drawPath(head, color)
        }

        // ---- points: muted first, live on top, the selected and dragged last
        fun dot(p: PlotPoint, c: Offset, lit: Boolean) {
            val item = p.item
            val closed = item.isClosed
            val blocked = !closed && snap.isBlocked(item)
            val r = if (lit) p.r + m.hairline else p.r
            if (closed) {
                // Hollow and faded: no highlighting on closed items.
                drawCircle(colors.surface, r, c)
                drawCircle(colors.subtle.copy(alpha = 0.5f), r - m.hairline / 2, c, style = Stroke(m.hairline * 1.5f))
            } else {
                val fill = hexColor(snap.colors.color(item, mode), colors.subtle)
                drawCircle(colors.surface, r + m.ring, c) // surface ring so overlapping dots stay legible
                drawCircle(fill.copy(alpha = if (blocked) 0.55f else 1f), r, c)
                if (blocked) {
                    drawCircle(colors.subtle, r + m.ringGap, c, style = Stroke(m.hairline * 1.5f, pathEffect = dash))
                }
            }
            if (lit) drawCircle(colors.accent, r + m.ring, c, style = Stroke(m.ring))
        }

        val draggedId = d?.point?.item?.id
        for (p in ordered) {
            if (p.item.id != selectedId && p.item.id != draggedId) dot(p, pos(p), lit = false)
        }
        for (p in ordered) {
            if (p.item.id != selectedId || p.item.id == draggedId) continue
            val c = pos(p)
            dot(p, c, lit = true)
            // The selected point's key beside it (flipped to the left near the right edge).
            val key = textMeasurer.measure(p.item.key, keyStyle)
            val rightX = c.x + p.r + m.labelGap
            val x = if (rightX + key.size.width > pl.right) c.x - p.r - m.labelGap - key.size.width else rightX
            drawText(key, topLeft = Offset(x, c.y - key.size.height / 2f))
        }
        for (p in ordered) {
            if (p.item.id == draggedId) dot(p, pos(p), lit = true)
        }

        // ---- live label while dragging, and a marker at the snapped grid point
        if (d != null) {
            val c = pos(d.point)
            val u = pl.ux(c.x).roundToInt().coerceIn(0, MAX)
            val i = pl.iy(c.y).roundToInt().coerceIn(IMP_MIN, MAX)
            drawCircle(
                colors.accent.copy(alpha = 0.6f), d.point.r + m.ringGap, Offset(pl.sx(u.toFloat()), pl.sy(i.toFloat())),
                style = Stroke(m.hairline),
            )
            val label = textMeasurer.measure("U$u · I$i", dragStyle)
            val w = label.size.width + 2 * m.labelPad
            val h = label.size.height + m.labelPad
            var left = c.x - w / 2
            left = left.coerceIn(0f, max(0f, size.width - w))
            var topY = c.y - d.point.r - m.ringGap - m.labelGap - h
            if (topY < 0f) topY = c.y + d.point.r + m.ringGap + m.labelGap
            drawRoundRect(colors.surface, Offset(left, topY), Size(w, h), CornerRadius(m.corner))
            drawRoundRect(colors.accent, Offset(left, topY), Size(w, h), CornerRadius(m.corner), style = Stroke(m.hairline))
            drawText(label, topLeft = Offset(left + m.labelPad, topY + m.labelPad / 2))
        }
    }
}

// ---------------------------------------------------------------- chrome

/** "Colour by …" button opening the point-colouring modes (a preference). */
@Composable
private fun PointColorPicker(mode: ColorMode, onPick: (ColorMode) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }) {
            Text("Colour by ${mode.label}", style = MaterialTheme.typography.labelMedium)
            Icon(Icons.Default.ArrowDropDown, contentDescription = null)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (mm in ColorMode.forPoints) {
                DropdownMenuItem(
                    text = { Text(mm.label) },
                    onClick = {
                        open = false
                        onPick(mm)
                    },
                    trailingIcon = if (mm == mode) ({ Icon(Icons.Default.Check, contentDescription = null) }) else null,
                )
            }
        }
    }
}

/** The selected task's card over the bottom of the plot. */
@Composable
private fun PointCard(item: Item, snap: Snapshot, onOpen: () -> Unit, onClose: () -> Unit, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(8.dp)
            // Swallow taps so they do not fall through to the plot and clear the selection.
            .pointerInput(Unit) { detectTapGestures(onTap = {}) },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 6.dp),
    ) {
        Column(Modifier.padding(start = 16.dp, end = 8.dp, top = 4.dp, bottom = 4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                KeyText(item.key)
                Spacer(Modifier.width(8.dp))
                StatusChip(item.status)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onClose) { Icon(Icons.Default.Close, contentDescription = "Close") }
            }
            // The title is a link to the detail screen (same as Open below):
            // underlined in the accent colour, with a ripple on tap.
            val keyAndTitle = listOf(item.key, item.title).filter { it.isNotBlank() }.joinToString(" ")
            Text(
                item.title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary,
                textDecoration = TextDecoration.Underline,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .clickable(onClick = onOpen, onClickLabel = "Open", role = Role.Button)
                    .semantics { contentDescription = "Open $keyAndTitle" }
                    .padding(end = 8.dp, top = 2.dp, bottom = 2.dp),
            )
            Row(
                modifier = Modifier.padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LevelBadge("urgency", item.urgency, snap.settings, item.isClosed)
                LevelBadge("importance", item.importance, snap.settings, item.isClosed)
                EffortBadge(item.effort)
                UserChip(snap.user(item.assigneeId), muted = item.isClosed)
                if (snap.isBlocked(item)) {
                    Text("Blocked", color = LocalPalette.current.alert, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            if (item.description.isNotBlank()) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp, end = 8.dp)
                        .heightIn(max = 160.dp)
                        .verticalScroll(rememberScrollState()),
                ) {
                    MarkdownText(item.description, Modifier.fillMaxWidth())
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onOpen) { Text("Open") }
            }
        }
    }
}
