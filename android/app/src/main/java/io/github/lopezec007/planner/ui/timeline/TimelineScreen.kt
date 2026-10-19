// The Timeline (Gantt) screen: the whole content area of the phone.
//
// Layout, top to bottom: a control row (the bar colour mode chip, with a
// compact legend beneath it for the ramp and combo modes), the two-tier
// date axis (a Canvas), and the rows in a vertically scrolling Box holding
// one Canvas for every row's band, bar and connector plus a Column of row
// titles laid over it. Each row is two lines: the key + title on the top
// line, sticky at the left edge (it does not scroll with the time axis),
// and the bar alone on the bottom line so nothing ever covers it.
// Pan and zoom change a remembered TimelineView (pixels per day, the day at
// the left edge) that the two Canvases read while drawing, so a gesture
// only redraws. Gestures are decided by detectTimelineGestures on the
// outer Box (see TimelineGestures.kt); the Today button and the colour chip
// consume their own downs and are ignored by it.
//
// A bar drag edits dates through PlannerRepository.patchItem with only the
// changed fields; the new dates are held as "pending" until the snapshot
// reports them so the bar does not jump back meanwhile.
package io.github.lopezec007.planner.ui.timeline

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Today
import androidx.compose.material3.AssistChip
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.lopezec007.planner.data.model.AppSettings
import io.github.lopezec007.planner.data.model.ColorMode
import io.github.lopezec007.planner.data.model.Dates
import io.github.lopezec007.planner.data.model.Group
import io.github.lopezec007.planner.data.model.Item
import io.github.lopezec007.planner.data.model.PlannerColors
import io.github.lopezec007.planner.data.repo.ItemPatch
import io.github.lopezec007.planner.data.repo.Opt
import io.github.lopezec007.planner.data.repo.Snapshot
import io.github.lopezec007.planner.data.repo.set
import io.github.lopezec007.planner.ui.PlannerViewModel
import io.github.lopezec007.planner.ui.components.KeyText
import io.github.lopezec007.planner.ui.theme.LocalPalette
import io.github.lopezec007.planner.ui.theme.contrastOn
import io.github.lopezec007.planner.ui.theme.hexColor
import kotlinx.coroutines.launch
import java.time.LocalDate
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

@Composable
fun TimelineScreen(vm: PlannerViewModel, groups: List<Group>, onOpen: (Long) -> Unit, modifier: Modifier = Modifier) {
    val snap by vm.snapshot.collectAsStateWithLifecycle()
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    val barMode = prefs?.barColor ?: ColorMode.ASSIGNEE
    val scope = rememberCoroutineScope()

    var pending by remember { mutableStateOf<PendingDates?>(null) }
    LaunchedEffect(snap, pending) {
        val p = pending ?: return@LaunchedEffect
        val item = snap.item(p.id)
        if (item == null || (item.startDate == p.start && item.endDate == p.end)) pending = null
    }

    val model = remember(snap, groups, barMode, pending) { buildTimelineModel(snap, groups, barMode, pending) }
    val view = remember { TimelineView() }
    val today = remember(snap) { Dates.today() }
    val commit: (Item, LocalDate?, LocalDate?) -> Unit = { item, start, end ->
        val patch = ItemPatch(
            startDate = if (start != item.startDate) set(start) else Opt.Unset,
            endDate = if (end != item.endDate) set(end) else Opt.Unset,
        )
        if (!patch.isEmpty) {
            pending = PendingDates(item.id, start, end)
            scope.launch { vm.repo.patchItem(item.id, patch) }
        }
    }

    Column(modifier.fillMaxSize()) {
        ColorModeControls(barMode, snap.settings, onPick = { vm.setBarColor(it) })
        TimelineBody(
            model = model,
            snap = snap,
            view = view,
            today = today,
            weekStart = snap.settings.weekStart,
            onOpen = onOpen,
            onCommit = commit,
            modifier = Modifier.weight(1f).fillMaxWidth(),
        )
    }
}

// ---------------------------------------------------------------- controls

@Composable
private fun ColorModeControls(mode: ColorMode, settings: AppSettings, onPick: (ColorMode) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val subtle = LocalPalette.current.subtle
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Colour by", fontSize = 12.sp, color = subtle)
        Spacer(Modifier.width(6.dp))
        Box {
            AssistChip(
                onClick = { open = true },
                label = { Text(mode.label, fontSize = 12.sp) },
                trailingIcon = { Icon(Icons.Filled.ArrowDropDown, contentDescription = null, modifier = Modifier.size(18.dp)) },
            )
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                for (m in ColorMode.forBars) {
                    DropdownMenuItem(
                        text = { Text(m.label) },
                        onClick = {
                            open = false
                            onPick(m)
                        },
                        trailingIcon = {
                            if (m == mode) Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                        },
                    )
                }
            }
        }
    }
    BarLegend(mode, settings)
}

/** Swatches for the 0..10 ramp of a level mode, or the four combo corners; nothing for the categorical modes. */
@Composable
private fun BarLegend(mode: ColorMode, settings: AppSettings) {
    val neutral = hexColor(settings.colorUnassigned, MaterialTheme.colorScheme.outline)
    val entries: List<Pair<String, Color>> = when (mode) {
        ColorMode.IMPORTANCE, ColorMode.URGENCY -> (0..10).map { n -> n.toString() to hexColor(settings.levelColor(mode.wire, n), neutral) }
        ColorMode.COMBO -> listOf(
            "Neither" to hexColor(PlannerColors.COMBO_NEITHER, neutral),
            "Urgent" to hexColor(PlannerColors.COMBO_URGENT, neutral),
            "Important" to hexColor(PlannerColors.COMBO_IMPORTANT, neutral),
            "Urgent & important" to hexColor(PlannerColors.COMBO_BOTH, neutral),
        )
        else -> return
    }
    val subtle = LocalPalette.current.subtle
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 10.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for ((label, color) in entries) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).clip(RoundedCornerShape(2.dp)).background(color))
                Spacer(Modifier.width(3.dp))
                Text(label, fontSize = 10.sp, color = subtle, maxLines = 1)
            }
        }
    }
}

// ---------------------------------------------------------------- the chart

@Composable
private fun TimelineBody(
    model: TimelineModel,
    snap: Snapshot,
    view: TimelineView,
    today: LocalDate,
    weekStart: Int,
    onOpen: (Long) -> Unit,
    onCommit: (Item, LocalDate?, LocalDate?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val haptic = LocalHapticFeedback.current
    val scheme = MaterialTheme.colorScheme
    val palette = LocalPalette.current
    val dark = isSystemInDarkTheme()
    val tm = rememberTextMeasurer(cacheSize = 256)
    val scrollState = rememberScrollState()
    val metrics = remember(density) { TimelineMetrics(density) }
    val colors = remember(scheme, palette, dark) {
        TimelineColors(
            axisBg = scheme.surfaceVariant,
            grid = palette.rowBorder.copy(alpha = 0.55f),
            gridStrong = palette.rowBorder,
            month = if (dark) Color(0xFFC48AC4) else Color(0xFFB06CB0),
            year = if (dark) Color(0xFFE0A04A) else Color(0xFFD08A2E),
            firm = Color(0xFFFF1F1F),
            today = palette.todayLine,
            rowBorder = palette.rowBorder,
            parentBorder = palette.parentBorder,
            neutral = scheme.outline,
            dep = palette.subtle,
            depOpen = palette.alert,
            accent = palette.accent,
            label = TextStyle(color = scheme.onSurfaceVariant, fontSize = 10.sp, fontWeight = FontWeight.Medium),
            labelStrong = TextStyle(color = scheme.onSurfaceVariant, fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.3.sp),
            todayLabel = TextStyle(color = contrastOn(palette.todayLine), fontSize = 10.sp, fontWeight = FontWeight.SemiBold),
        )
    }
    val geom = remember(model) { FloatArray(max(1, model.rows.size) * 4) }
    val path = remember { Path() }
    val tmp = remember { BarPx() }

    BoxWithConstraints(modifier) {
        val widthPx = constraints.maxWidth.toFloat()
        val modelState = rememberUpdatedState(model)
        val snapState = rememberUpdatedState(snap)
        val widthState = rememberUpdatedState(widthPx)
        val openState = rememberUpdatedState(onOpen)
        val commitState = rememberUpdatedState(onCommit)
        val controller = remember(view, metrics, haptic) {
            TimelineController(
                view = view,
                m = metrics,
                haptic = haptic,
                modelOf = { modelState.value },
                snapOf = { snapState.value },
                widthOf = { widthState.value },
                scrollYOf = { scrollState.value },
                onOpen = { openState.value(it) },
                onCommit = { item, s, e -> commitState.value(item, s, e) },
            )
        }

        Box(Modifier.fillMaxSize().pointerInput(controller) { detectTimelineGestures(controller) }) {
            Column(Modifier.fillMaxSize()) {
                Canvas(Modifier.fillMaxWidth().height(AXIS_HEIGHT).clipToBounds()) {
                    drawTimelineAxis(colors, metrics, tm, view.ppdFor(size.width), view.leftFor(), today, weekStart)
                }
                Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(scrollState)) {
                    Box(Modifier.fillMaxWidth().height(ROW_HEIGHT * model.rows.size)) {
                        Canvas(Modifier.matchParentSize().clipToBounds()) {
                            drawTimelineRows(
                                model, colors, metrics, view.ppdFor(size.width), view.leftFor(), today, weekStart,
                                controller.drag, geom, path, tmp,
                            )
                        }
                        Column(Modifier.fillMaxWidth()) {
                            for (row in model.rows) {
                                RowTitle(row)
                            }
                        }
                    }
                }
            }

            if (!model.hasBars) {
                Text(
                    "Nothing with dates matches the current filters.",
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    textAlign = TextAlign.Center,
                    color = palette.subtle,
                )
            }

            val drag = controller.drag
            if (drag != null) {
                val item = snap.item(drag.itemId)
                if (item != null) {
                    val n = drag.days.toLong()
                    val s = if (drag.zone != Zone.END) item.startDate?.plusDays(n) else item.startDate
                    val e = if (drag.zone != Zone.START) item.endDate?.plusDays(n) else item.endDate
                    Surface(
                        modifier = Modifier.align(Alignment.TopCenter).padding(top = AXIS_HEIGHT + 8.dp),
                        shape = RoundedCornerShape(8.dp),
                        tonalElevation = 3.dp,
                        shadowElevation = 4.dp,
                    ) {
                        Text(
                            "${item.key}  ${s?.let(Dates::human) ?: "—"} → ${e?.let(Dates::human) ?: "—"}",
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                            fontSize = 12.sp,
                            maxLines = 1,
                        )
                    }
                }
            }
        }

        SmallFloatingActionButton(
            onClick = { view.today(widthPx) },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
        ) {
            Icon(Icons.Filled.Today, contentDescription = "Today")
        }
    }
}

/**
 * A row's title line: key and title in small text at the left (parents
 * heavier, tasks indented), with a muted "no dates" hint for an undated
 * parent. The rest of the row's height is left empty for the bar line.
 */
@Composable
private fun RowTitle(row: TimelineRow) {
    val subtle = LocalPalette.current.subtle
    val parent = row.kind == RowKind.PARENT
    val closed = row.item.isClosed
    Column(Modifier.fillMaxWidth().height(ROW_HEIGHT)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(TITLE_LINE)
                .padding(start = if (parent) 6.dp else 18.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            KeyText(row.item.key)
            Spacer(Modifier.width(5.dp))
            Text(
                row.item.title,
                modifier = Modifier.weight(1f, fill = false),
                fontSize = 12.sp,
                fontWeight = if (parent) FontWeight.SemiBold else FontWeight.Normal,
                color = if (closed) subtle else MaterialTheme.colorScheme.onSurface,
                textDecoration = if (closed) TextDecoration.LineThrough else null,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (row.bar == null) {
                Spacer(Modifier.width(8.dp))
                Text("no dates", fontSize = 11.sp, color = subtle, maxLines = 1)
            }
        }
    }
}

// ---------------------------------------------------------------- gesture host

/**
 * Hit-testing in screen coordinates (the axis sits above the rows, the rows
 * scroll vertically) and the pan / zoom / drag actions on the view state.
 * Reads the latest model, snapshot and sizes through lambdas since it is
 * remembered across recompositions.
 */
private class TimelineController(
    private val view: TimelineView,
    private val m: TimelineMetrics,
    private val haptic: HapticFeedback,
    private val modelOf: () -> TimelineModel,
    private val snapOf: () -> Snapshot,
    private val widthOf: () -> Float,
    private val scrollYOf: () -> Int,
    private val onOpen: (Long) -> Unit,
    private val onCommit: (Item, LocalDate?, LocalDate?) -> Unit,
) : TimelineGestureHost {
    var drag: BarDrag? by mutableStateOf<BarDrag?>(null)
        private set

    private val tmp = BarPx()

    /** Content y (the axis sits above the rows, which scroll), or -1 above the rows. */
    private fun contentY(pos: Offset): Float = pos.y - m.axisPx + scrollYOf()

    private fun rowAt(pos: Offset): TimelineRow? {
        val y = contentY(pos)
        if (y < 0f) return null
        return modelOf().rows.getOrNull((y / m.rowPx).toInt())
    }

    /** Whether [pos] is on a row's title line (the top part) rather than its bar line. */
    private fun onTitleLine(pos: Offset): Boolean {
        val y = contentY(pos)
        return y >= 0f && y % m.rowPx < m.titleLinePx
    }

    /** A bar under [pos]; only the bar line counts, the title line never starts a drag. */
    override fun hitTest(pos: Offset): BarHit? {
        if (onTitleLine(pos)) return null
        val row = rowAt(pos) ?: return null
        val bar = row.bar ?: return null
        val w = widthOf()
        resolveBar(bar, view.ppdFor(w), view.leftFor(), 0, 0, m.softMax, m.minLong, tmp)
        val x = pos.x
        val slack = m.edgePx / 2f
        if (x < tmp.x0 - slack || x > tmp.x1 + slack) return null
        val nearStart = bar.start != null && x <= tmp.x0 + m.edgePx
        val nearEnd = bar.endExcl != null && x >= tmp.x1 - m.edgePx
        val zone = when {
            nearStart && nearEnd -> if (x - tmp.x0 <= tmp.x1 - x) Zone.START else Zone.END
            nearStart -> Zone.START
            nearEnd -> Zone.END
            else -> Zone.MOVE
        }
        return BarHit(row, bar, zone)
    }

    /** A tap anywhere on the title line, or on a bar, opens that row's item. */
    override fun tapTarget(pos: Offset): Long? {
        if (onTitleLine(pos)) return rowAt(pos)?.item?.id
        return hitTest(pos)?.row?.item?.id
    }

    override fun open(itemId: Long) = onOpen(itemId)

    override fun pan(dxPx: Float) = view.pan(dxPx, widthOf())

    override fun zoom(factor: Float, anchorX: Float) = view.zoom(factor, anchorX, widthOf())

    override fun dragStart(hit: BarHit) {
        drag = BarDrag(hit.bar.itemId, hit.zone, hit.bar.start, hit.bar.endExcl)
        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
    }

    override fun dragMove(dxPx: Float) {
        val d = drag ?: return
        var days = (dxPx / view.ppdFor(widthOf())).roundToInt()
        // Never let the end precede the start while resizing.
        val start = d.start
        val endExcl = d.endExcl
        if (start != null && endExcl != null) {
            if (d.zone == Zone.START) days = min(days, (endExcl - 1 - start).toInt())
            if (d.zone == Zone.END) days = max(days, (start - (endExcl - 1)).toInt())
        }
        d.days = days
    }

    override fun dragEnd(cancelled: Boolean) {
        val d = drag ?: return
        drag = null
        if (cancelled || d.days == 0) return
        val item = snapOf().item(d.itemId) ?: return
        val n = d.days.toLong()
        val start = if (d.zone != Zone.END) item.startDate?.plusDays(n) else item.startDate
        val end = if (d.zone != Zone.START) item.endDate?.plusDays(n) else item.endDate
        onCommit(item, start, end)
    }
}
