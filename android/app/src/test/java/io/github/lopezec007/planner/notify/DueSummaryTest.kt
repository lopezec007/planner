// JVM tests for the due-date summary helpers: bucketing, the "mine" rules,
// the title and line wording, and the next scheduled time. No Android.
package io.github.lopezec007.planner.notify

import io.github.lopezec007.planner.data.model.Item
import io.github.lopezec007.planner.data.model.ItemType
import io.github.lopezec007.planner.data.model.Status
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

class DueSummaryTest {
    private val today: LocalDate = LocalDate.of(2026, 10, 19)
    private val me = 7L
    private val other = 8L

    private fun item(
        id: Long,
        end: LocalDate?,
        type: ItemType = ItemType.TASK,
        status: Status? = Status.TODO,
        assignee: Long? = me,
        owner: Long? = me,
        key: String = "T-$id",
        title: String = "Item $id",
    ) = Item(
        id = id, type = type, key = key, num = id, parentId = null, title = title, description = "",
        ownerId = owner, assigneeId = assignee, status = status, startDate = null, startFirm = false,
        endDate = end, endFirm = false, urgency = null, importance = null, blocked = false, color = "",
        sortOrder = id, createdAt = "", updatedAt = "", closedAt = null, blockedBy = emptyList(),
        blocks = emptyList(), attachments = emptyList(),
    )

    private fun ids(items: List<Item>) = items.map { it.id }

    @Test
    fun bucketsByEndDate() {
        val items = listOf(
            item(1, today.minusDays(3)),
            item(2, today),
            item(3, today.plusDays(1)),
            item(4, today.plusDays(7)),
            item(5, today.plusDays(8)),   // beyond the week
            item(6, null),                // no end date
        )
        val s = summarize(items, me, today)
        assertEquals(listOf(1L), ids(s.overdue))
        assertEquals(listOf(2L), ids(s.today))
        assertEquals(listOf(3L, 4L), ids(s.upcoming))
        assertEquals(7, s.daysAhead)
        assertFalse(s.isEmpty)
    }

    @Test
    fun lookAheadWindowIsConfigurable() {
        val items = listOf(
            item(1, today.minusDays(1)),
            item(2, today),
            item(3, today.plusDays(1)),
            item(4, today.plusDays(3)),
            item(5, today.plusDays(10)),
            item(6, today.plusDays(14)),
        )
        // 0: overdue and today only.
        val none = summarize(items, me, today, daysAhead = 0)
        assertEquals(listOf(1L), ids(none.overdue))
        assertEquals(listOf(2L), ids(none.today))
        assertTrue(none.upcoming.isEmpty())
        assertEquals(0, none.daysAhead)
        assertEquals(listOf(3L), ids(summarize(items, me, today, daysAhead = 1).upcoming))
        assertEquals(listOf(3L, 4L), ids(summarize(items, me, today, daysAhead = 3).upcoming))
        assertEquals(listOf(3L, 4L, 5L, 6L), ids(summarize(items, me, today, daysAhead = 14).upcoming))
        // A negative value is treated as 0 rather than hiding today's items.
        assertEquals(listOf(2L), ids(summarize(items, me, today, daysAhead = -2).today))
        // Nothing within the window means nothing to show.
        assertTrue(summarize(listOf(item(7, today.plusDays(2))), me, today, daysAhead = 1).isEmpty)
    }

    @Test
    fun sortsOverdueFirstThenByEndDate() {
        val items = listOf(
            item(1, today.plusDays(5)),
            item(2, today.minusDays(1)),
            item(3, today),
            item(4, today.minusDays(10)),
            item(5, today.plusDays(2)),
        )
        assertEquals(listOf(4L, 2L, 3L, 5L, 1L), ids(summarize(items, me, today).all))
    }

    @Test
    fun mineIsAssignedOrUnassignedAndOwned() {
        val items = listOf(
            item(1, today, assignee = me, owner = other),      // assigned to me
            item(2, today, assignee = null, owner = me),       // unassigned, mine
            item(3, today, assignee = other, owner = me),      // assigned away, though I own it
            item(4, today, assignee = null, owner = other),    // unassigned, someone else's
            item(5, today, assignee = null, owner = null),     // nobody's
        )
        assertEquals(listOf(1L, 2L), ids(summarize(items, me, today).today))
    }

    @Test
    fun nullAccountIncludesEverything() {
        val items = listOf(
            item(1, today, assignee = other, owner = other),
            item(2, today, assignee = null, owner = null),
            item(3, today.minusDays(1), assignee = me),
        )
        val s = summarize(items, null, today)
        assertEquals(listOf(3L), ids(s.overdue))
        assertEquals(listOf(1L, 2L), ids(s.today))
    }

    @Test
    fun closedItemsAndOngoingsAreExcluded() {
        val items = listOf(
            item(1, today.minusDays(1), status = Status.DONE),
            item(2, today, status = Status.CANCELLED),
            item(3, today.plusDays(1), type = ItemType.ONGOING),
            item(4, today.plusDays(1), type = ItemType.PROJECT, key = "P-4"),
            item(5, today, status = null),   // no status is not closed
        )
        val s = summarize(items, me, today)
        assertTrue(s.overdue.isEmpty())
        assertEquals(listOf(5L), ids(s.today))
        assertEquals(listOf(4L), ids(s.upcoming))
    }

    @Test
    fun emptyWhenNothingIsDue() {
        val s = summarize(listOf(item(1, today.plusDays(30)), item(2, null)), me, today)
        assertTrue(s.isEmpty)
        assertTrue(s.all.isEmpty())
    }

    @Test
    fun titleListsOnlyNonZeroParts() {
        val a = item(1, today.minusDays(1))
        val b = item(2, today)
        val c = item(3, today.plusDays(2))
        assertEquals("3 overdue, 1 due today, 2 this week", titleFor(DueSummary(listOf(a, a, a), listOf(b), listOf(c, c))))
        assertEquals("1 due today", titleFor(DueSummary(emptyList(), listOf(b), emptyList())))
        assertEquals("2 this week", titleFor(DueSummary(emptyList(), emptyList(), listOf(c, c))))
        assertEquals("1 overdue, 2 this week", titleFor(DueSummary(listOf(a), emptyList(), listOf(c, c))))
        // The last part follows the look-ahead window.
        assertEquals("1 due tomorrow", titleFor(DueSummary(emptyList(), emptyList(), listOf(c), daysAhead = 1)))
        assertEquals("2 in the next 3 days", titleFor(DueSummary(emptyList(), emptyList(), listOf(c, c), daysAhead = 3)))
        assertEquals("1 due today, 2 in the next 14 days", titleFor(DueSummary(emptyList(), listOf(b), listOf(c, c), daysAhead = 14)))
        assertEquals("1 due today", titleFor(DueSummary(emptyList(), listOf(b), emptyList(), daysAhead = 0)))
    }

    @Test
    fun lineWording() {
        val vents = { end: LocalDate -> item(12, end, key = "T-12", title = "Clean exhaust vents") }
        assertEquals("T-12 Clean exhaust vents · overdue 3 days", lineFor(vents(today.minusDays(3)), today))
        assertEquals("T-12 Clean exhaust vents · overdue 1 day", lineFor(vents(today.minusDays(1)), today))
        assertEquals("T-12 Clean exhaust vents · due today", lineFor(vents(today), today))
        assertEquals("T-12 Clean exhaust vents · in 1 day", lineFor(vents(today.plusDays(1)), today))
        assertEquals("T-12 Clean exhaust vents · in 5 days", lineFor(vents(today.plusDays(5)), today))
        assertEquals("T-12 Clean exhaust vents — overdue 3 days", contentFor(vents(today.minusDays(3)), today))
    }

    @Test
    fun lineSkipsABlankKey() {
        val local = item(-1, today, key = "", title = "Offline item")
        assertEquals("Offline item · due today", lineFor(local, today))
    }

    @Test
    fun nextOccurrenceIsTodayWhenAheadElseTomorrow() {
        val zone = ZoneId.of("Europe/Paris")
        val now = ZonedDateTime.of(today, LocalTime.of(7, 30), zone)
        assertEquals(ZonedDateTime.of(today, LocalTime.of(8, 0), zone), nextOccurrence(8, 0, now))
        assertEquals(ZonedDateTime.of(today.plusDays(1), LocalTime.of(7, 0), zone), nextOccurrence(7, 0, now))
        // Exactly now counts as passed.
        assertEquals(ZonedDateTime.of(today.plusDays(1), LocalTime.of(7, 30), zone), nextOccurrence(7, 30, now))
    }
}
