// Pointer handling for the Timeline. One detector on the whole screen area
// decides what a touch means so that it never fights the vertical scroll of
// the rows (which lives on a descendant and is checked for consumption):
//
//   tap                  open the item under the finger (a row's title line,
//                        or a bar on its bar line)
//   horizontal drag      pan the time axis (vertical drags are left to the
//                        row scroller; whichever axis passes touch slop first
//                        wins)
//   two fingers          pinch to zoom around the pinch centre, and pan
//   long-press on a bar  then drag horizontally to move the bar (or one end
//                        of it when the press was within 16dp of that end);
//                        released, the dates are committed
//
// The Today button and the colour chip sit outside the detector's subtree
// (siblings or above it), so their clicks never reach it; the row titles
// inside it have no click handling of their own, taps there are decided
// here.
package io.github.lopezec007.planner.ui.timeline

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEvent
import androidx.compose.ui.input.pointer.PointerId
import androidx.compose.ui.input.pointer.PointerInputChange
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.positionChange
import kotlinx.coroutines.CancellationException
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.sign

/** A bar under the finger and the part of it that was touched. */
internal class BarHit(val row: TimelineRow, val bar: Bar, val zone: Zone)

/** What the screen provides to the detector: hit-testing in screen coordinates and the actions. */
internal interface TimelineGestureHost {
    fun hitTest(pos: Offset): BarHit?
    /** The item a tap at [pos] opens (a row's title line, or a bar), or null. */
    fun tapTarget(pos: Offset): Long?
    fun open(itemId: Long)
    fun pan(dxPx: Float)
    fun zoom(factor: Float, anchorX: Float)
    fun dragStart(hit: BarHit)
    fun dragMove(dxPx: Float)
    fun dragEnd(cancelled: Boolean)
}

private enum class Mode { UNDECIDED, PAN, PINCH, DRAG }

internal suspend fun PointerInputScope.detectTimelineGestures(host: TimelineGestureHost) {
    awaitEachGesture {
        val slop = viewConfiguration.touchSlop
        val longPressMs = viewConfiguration.longPressTimeoutMillis
        val down = awaitFirstDown(requireUnconsumed = false)
        val hit = host.hitTest(down.position)
        var mode = Mode.UNDECIDED
        var pointer: PointerId = down.id
        var lastX = down.position.x
        var lastTime = down.uptimeMillis
        var totalDx = 0f
        var totalDy = 0f
        var prevCx = 0f
        var prevDist = 0f

        fun startPinch(pressed: List<PointerInputChange>) {
            val p0 = pressed[0]
            val p1 = pressed[1]
            prevCx = (p0.position.x + p1.position.x) / 2f
            prevDist = hypot(p0.position.x - p1.position.x, p0.position.y - p1.position.y)
            mode = Mode.PINCH
        }

        try {
            while (true) {
                val event: PointerEvent? = if (mode == Mode.UNDECIDED) {
                    val remaining = longPressMs - (lastTime - down.uptimeMillis)
                    withTimeoutOrNull(remaining.coerceAtLeast(1L)) { awaitPointerEvent() }
                } else {
                    awaitPointerEvent()
                }
                if (event == null) {
                    // Held still past the long-press timeout: take hold of the
                    // bar under the finger, or just pan from here.
                    if (hit != null) {
                        mode = Mode.DRAG
                        host.dragStart(hit)
                    } else {
                        mode = Mode.PAN
                    }
                    continue
                }
                event.changes.firstOrNull()?.let { lastTime = it.uptimeMillis }
                val pressed = event.changes.filter { it.pressed }

                when (mode) {
                    Mode.UNDECIDED -> {
                        // The row scroller took it (vertical slop first): nothing to do here.
                        if (event.changes.any { it.isConsumed }) return@awaitEachGesture
                        if (pressed.size >= 2) {
                            startPinch(pressed)
                            event.changes.forEach { it.consume() }
                            continue
                        }
                        val ch = event.changes.firstOrNull { it.id == pointer } ?: return@awaitEachGesture
                        if (!ch.pressed) {
                            if (abs(totalDx) <= slop && abs(totalDy) <= slop) {
                                host.tapTarget(down.position)?.let { host.open(it) }
                            }
                            return@awaitEachGesture
                        }
                        val delta = ch.positionChange()
                        totalDx += delta.x
                        totalDy += delta.y
                        if (abs(totalDx) > slop && abs(totalDx) > abs(totalDy)) {
                            mode = Mode.PAN
                            host.pan(totalDx - sign(totalDx) * slop)
                            lastX = ch.position.x
                            ch.consume()
                        } else if (abs(totalDy) > slop) {
                            return@awaitEachGesture
                        }
                    }
                    Mode.PAN -> {
                        if (pressed.size >= 2) {
                            startPinch(pressed)
                            event.changes.forEach { it.consume() }
                            continue
                        }
                        val ch = event.changes.firstOrNull { it.id == pointer } ?: pressed.firstOrNull()
                        if (ch == null || !ch.pressed) return@awaitEachGesture
                        pointer = ch.id
                        host.pan(ch.position.x - lastX)
                        lastX = ch.position.x
                        ch.consume()
                    }
                    Mode.PINCH -> {
                        if (pressed.size < 2) {
                            if (pressed.isEmpty()) return@awaitEachGesture
                            // One finger lifted: carry on panning with the other.
                            mode = Mode.PAN
                            pointer = pressed[0].id
                            lastX = pressed[0].position.x
                            event.changes.forEach { it.consume() }
                            continue
                        }
                        val p0 = pressed[0]
                        val p1 = pressed[1]
                        val cx = (p0.position.x + p1.position.x) / 2f
                        val dist = hypot(p0.position.x - p1.position.x, p0.position.y - p1.position.y)
                        if (prevDist > 0f && dist > 0f) host.zoom(dist / prevDist, cx)
                        host.pan(cx - prevCx)
                        prevCx = cx
                        prevDist = dist
                        event.changes.forEach { it.consume() }
                    }
                    Mode.DRAG -> {
                        val ch = event.changes.firstOrNull { it.id == pointer }
                        if (ch == null || !ch.pressed) {
                            host.dragEnd(cancelled = false)
                            return@awaitEachGesture
                        }
                        host.dragMove(ch.position.x - down.position.x)
                        ch.consume()
                    }
                }
            }
        } catch (e: CancellationException) {
            if (mode == Mode.DRAG) host.dragEnd(cancelled = true)
            throw e
        }
    }
}
