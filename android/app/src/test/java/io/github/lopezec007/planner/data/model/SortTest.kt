package io.github.lopezec007.planner.data.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class SortTest {
    private var nextId = 1L
    private val users = mapOf(1L to "Zoe", 2L to "adam")

    private fun item(
        type: ItemType,
        title: String,
        parentId: Long? = null,
        status: Status? = if (type == ItemType.ONGOING) null else Status.TODO,
        urgency: Int? = 5,
        importance: Int? = 5,
        effort: Int? = null,
        ownerId: Long? = null,
        assigneeId: Long? = null,
        endDate: LocalDate? = null,
        blocked: Boolean = false,
        blockedBy: List<Long> = emptyList(),
        num: Long = nextId,
    ) = Item(
        id = nextId++, type = type, key = "${type.keyPrefix}-$num", num = num, parentId = parentId, title = title, description = "",
        ownerId = ownerId, assigneeId = assigneeId, status = status, startDate = null, startFirm = false,
        endDate = endDate, endFirm = false, urgency = urgency, importance = importance, effort = effort, blocked = blocked, color = "",
        sortOrder = 0, createdAt = "", updatedAt = "", closedAt = null, blockedBy = blockedBy, blocks = emptyList(), attachments = emptyList(),
    )

    private class Fixture(val groups: List<Group>, val lookup: SortLookup)

    private fun fixture(vararg items: Item): Fixture {
        val byId = items.associateBy { it.id }
        val groups = items.filter { it.parentId == null }.map { p -> Group(p, items.filter { it.parentId == p.id }) }
        return Fixture(groups, SortLookup(item = { byId[it] }, userName = { users[it] }))
    }

    private fun titles(groups: List<Group>) = groups.map { g -> g.parent.title to g.tasks.map { it.title } }
    private fun spec(vararg keys: SortKey, blockedLast: Boolean = false, closedLast: Boolean = false) = SortSpec(keys.toList(), blockedLast, closedLast)

    @Test
    fun noSortLeavesTheGroupsAlone() {
        val o = item(ItemType.ONGOING, "O")
        val f = fixture(o, item(ItemType.TASK, "b", o.id), item(ItemType.TASK, "a", o.id))
        assertSame(f.groups, SortSpec().apply(f.groups, flat = false, f.lookup))
        assertSame(f.groups, SortSpec().apply(f.groups, flat = true, f.lookup))
        assertFalse(SortSpec().isActive)
        // The Ongoing/Project column alone is no sort outside Flat.
        assertSame(f.groups, spec(SortKey(SortColumn.PARENT)).apply(f.groups, flat = false, f.lookup))
    }

    @Test
    fun nestedSortsParentsAndTheTasksWithinEach() {
        val b = item(ItemType.PROJECT, "Beta")
        val a = item(ItemType.ONGOING, "alpha")
        val f = fixture(
            b, a,
            item(ItemType.TASK, "Task 10", b.id), item(ItemType.TASK, "task 2", b.id),
            item(ItemType.TASK, "y", a.id), item(ItemType.TASK, "X", a.id),
        )
        // Case is ignored and digit runs compare by value.
        assertEquals(
            listOf("alpha" to listOf("X", "y"), "Beta" to listOf("task 2", "Task 10")),
            titles(spec(SortKey(SortColumn.TITLE)).apply(f.groups, flat = false, f.lookup)),
        )
        assertEquals(
            listOf("Beta" to listOf("Task 10", "task 2"), "alpha" to listOf("y", "X")),
            titles(spec(SortKey(SortColumn.TITLE, desc = true)).apply(f.groups, flat = false, f.lookup)),
        )
    }

    @Test
    fun severalColumnsApplyInOrderAndTiesKeepTheirPlace() {
        val o = item(ItemType.ONGOING, "O")
        val f = fixture(
            o,
            item(ItemType.TASK, "u5 i9", o.id, urgency = 5, importance = 9),
            item(ItemType.TASK, "u9 i1 first", o.id, urgency = 9, importance = 1),
            item(ItemType.TASK, "u9 i7", o.id, urgency = 9, importance = 7),
            item(ItemType.TASK, "u9 i1 second", o.id, urgency = 9, importance = 1),
        )
        val out = spec(SortKey(SortColumn.URGENCY), SortKey(SortColumn.IMPORTANCE)).apply(f.groups, flat = false, f.lookup)
        // Both start descending; the two equal rows stay in their user-defined order.
        assertEquals(listOf("u9 i7", "u9 i1 first", "u9 i1 second", "u5 i9"), out.single().tasks.map { it.title })
    }

    @Test
    fun missingValuesSortLastInBothDirections() {
        val o = item(ItemType.ONGOING, "O")
        val f = fixture(
            o,
            item(ItemType.TASK, "none", o.id),
            item(ItemType.TASK, "2h", o.id, effort = 120),
            item(ItemType.TASK, "15m", o.id, effort = 15),
        )
        assertEquals(listOf("15m", "2h", "none"), spec(SortKey(SortColumn.EFFORT)).apply(f.groups, false, f.lookup).single().tasks.map { it.title })
        assertEquals(listOf("2h", "15m", "none"), spec(SortKey(SortColumn.EFFORT, desc = true)).apply(f.groups, false, f.lookup).single().tasks.map { it.title })
    }

    @Test
    fun statusKeyUserAndDateColumns() {
        val o = item(ItemType.ONGOING, "O")
        val f = fixture(
            o,
            item(ItemType.TASK, "done", o.id, status = Status.DONE, assigneeId = 1, endDate = LocalDate.of(2026, 3, 1), num = 12),
            item(ItemType.TASK, "validating", o.id, status = Status.VALIDATING, assigneeId = 2, endDate = LocalDate.of(2026, 1, 1), num = 3),
            item(ItemType.TASK, "doing", o.id, status = Status.IN_PROGRESS, endDate = null, num = 20),
            item(ItemType.TASK, "idea", o.id, status = Status.IDEA, assigneeId = 99, endDate = LocalDate.of(2026, 2, 1), num = 1),
        )
        fun order(column: SortColumn) = spec(SortKey(column, desc = false)).apply(f.groups, false, f.lookup).single().tasks.map { it.title }
        // Validating sits between In-Progress and Done.
        assertEquals(listOf("idea", "doing", "validating", "done"), order(SortColumn.STATUS))
        // Keys by number, not as text (T-3 before T-12).
        assertEquals(listOf("idea", "validating", "done", "doing"), order(SortColumn.KEY))
        // Names without regard to case; an unknown user by its "#id"; nobody last.
        assertEquals(listOf("idea", "validating", "done", "doing"), order(SortColumn.ASSIGNEE))
        assertEquals(listOf("validating", "idea", "done", "doing"), order(SortColumn.END))
    }

    @Test
    fun blockedAndClosedSinkInBandsWhateverTheSort() {
        val o = item(ItemType.ONGOING, "O")
        val blocker = item(ItemType.TASK, "open blocker", o.id, urgency = 1)
        val f = fixture(
            o,
            item(ItemType.TASK, "closed u10", o.id, status = Status.DONE, urgency = 10),
            item(ItemType.TASK, "flagged u9", o.id, blocked = true, urgency = 9),
            blocker,
            item(ItemType.TASK, "waiting u8", o.id, blockedBy = listOf(blocker.id), urgency = 8),
            item(ItemType.TASK, "closed and flagged", o.id, status = Status.CANCELLED, blocked = true, urgency = 7),
            item(ItemType.TASK, "free u3", o.id, urgency = 3),
        )
        fun order(s: SortSpec) = s.apply(f.groups, false, f.lookup).single().tasks.map { it.title }
        // No columns: each band keeps the user-defined order.
        assertEquals(
            listOf("open blocker", "free u3", "flagged u9", "waiting u8", "closed u10", "closed and flagged"),
            order(spec(blockedLast = true, closedLast = true)),
        )
        // Closed-last alone: a blocked open item stays where the order puts it.
        assertEquals(
            listOf("flagged u9", "open blocker", "waiting u8", "free u3", "closed u10", "closed and flagged"),
            order(spec(closedLast = true)),
        )
        // With a column, the sort applies inside each band.
        assertEquals(
            listOf("free u3", "open blocker", "flagged u9", "waiting u8", "closed u10", "closed and flagged"),
            order(spec(SortKey(SortColumn.URGENCY), blockedLast = true, closedLast = true)),
        )
        assertTrue(spec(blockedLast = true).isActive)
    }

    @Test
    fun flatSortsEveryTaskTogetherAndReturnsRuns() {
        val a = item(ItemType.ONGOING, "A")
        val b = item(ItemType.PROJECT, "B")
        val f = fixture(
            a, b,
            item(ItemType.TASK, "a9", a.id, urgency = 9), item(ItemType.TASK, "a1", a.id, urgency = 1),
            item(ItemType.TASK, "b5", b.id, urgency = 5), item(ItemType.TASK, "b0", b.id, urgency = 0),
        )
        val byUrgency = spec(SortKey(SortColumn.URGENCY))
        // One sort over every task; consecutive tasks of a parent form a group, so A appears twice.
        assertEquals(
            listOf("A" to listOf("a9"), "B" to listOf("b5"), "A" to listOf("a1"), "B" to listOf("b0")),
            titles(byUrgency.apply(f.groups, flat = true, f.lookup)),
        )
        assertFalse(byUrgency.groupedIn(flat = true))
        assertTrue(byUrgency.groupedIn(flat = false))
        // Nested, the same sort stays inside each parent (and parents have no urgency: their order is kept).
        assertEquals(listOf("A" to listOf("a9", "a1"), "B" to listOf("b5", "b0")), titles(byUrgency.apply(f.groups, flat = false, f.lookup)))
        // Sorting by the parent first keeps parents together: projects after ongoings, here reversed.
        val byParent = spec(SortKey(SortColumn.PARENT, desc = true), SortKey(SortColumn.URGENCY, desc = false))
        assertEquals(listOf("B" to listOf("b0", "b5"), "A" to listOf("a1", "a9")), titles(byParent.apply(f.groups, flat = true, f.lookup)))
        assertTrue(byParent.groupedIn(flat = true))
        assertTrue(SortSpec().groupedIn(flat = true))
        assertFalse(spec(closedLast = true).groupedIn(flat = true))
    }

    @Test
    fun tappingAColumnAddsReversesThenRemovesIt() {
        var s = SortSpec()
        s = s.toggle(SortColumn.URGENCY)
        assertEquals(listOf(SortKey(SortColumn.URGENCY, desc = true)), s.keys)   // urgency starts descending
        s = s.toggle(SortColumn.TITLE)
        assertEquals(listOf(SortKey(SortColumn.URGENCY, true), SortKey(SortColumn.TITLE, false)), s.keys)
        s = s.toggle(SortColumn.URGENCY)
        assertEquals(listOf(SortKey(SortColumn.URGENCY, false), SortKey(SortColumn.TITLE, false)), s.keys)
        s = s.toggle(SortColumn.URGENCY)
        assertEquals(listOf(SortKey(SortColumn.TITLE, false)), s.keys)
        assertEquals("Title ↑", s.summary(flat = false))
        assertEquals("User-defined", SortSpec().summary(flat = false))
        // At most MAX_KEYS columns.
        var full = SortSpec()
        for (c in SortColumn.entries) full = full.toggle(c)
        assertEquals(SortSpec.MAX_KEYS, full.keys.size)
    }

    @Test
    fun keysRoundTripInTheWebShape() {
        val s = spec(SortKey(SortColumn.END, desc = false), SortKey(SortColumn.IMPORTANCE, desc = true))
        assertEquals("""[{"key":"end","dir":"asc"},{"key":"importance","dir":"desc"}]""", s.keysJson())
        assertEquals(s.keys, SortSpec.keysFromJson(s.keysJson()))
        assertEquals(emptyList<SortKey>(), SortSpec.keysFromJson(null))
        assertEquals(emptyList<SortKey>(), SortSpec.keysFromJson("{nope"))
        // Unknown columns and repeats are dropped.
        assertEquals(
            listOf(SortKey(SortColumn.TITLE, false)),
            SortSpec.keysFromJson("""[{"key":"colour","dir":"asc"},{"key":"title","dir":"up"},{"key":"title","dir":"desc"}]"""),
        )
    }

    @Test
    fun naturalOrderOfTitles() {
        assertTrue(SortSpec.naturalCompare("Task 2", "task 10") < 0)
        assertTrue(SortSpec.naturalCompare("a", "B") < 0)
        assertEquals(0, SortSpec.naturalCompare("Fix 007", "fix 7"))
        assertTrue(SortSpec.naturalCompare("Fix", "Fix it") < 0)
    }
}
