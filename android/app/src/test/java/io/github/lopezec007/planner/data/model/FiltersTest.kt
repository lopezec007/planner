package io.github.lopezec007.planner.data.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit

class FiltersTest {
    private var nextId = 1L

    private fun item(
        type: ItemType,
        title: String,
        parentId: Long? = null,
        status: Status? = if (type == ItemType.ONGOING) null else Status.TODO,
        closedAt: String? = null,
        ownerId: Long? = null,
        assigneeId: Long? = null,
        endDate: LocalDate? = null,
        blocked: Boolean = false,
        blockedBy: List<Long> = emptyList(),
        key: String = "${type.keyPrefix}-${nextId}",
    ) = Item(
        id = nextId++, type = type, key = key, num = 0, parentId = parentId, title = title, description = "",
        ownerId = ownerId, assigneeId = assigneeId, status = status, startDate = null, startFirm = false,
        endDate = endDate, endFirm = false, urgency = 5, importance = 5, blocked = blocked, color = "", sortOrder = 0,
        createdAt = "", updatedAt = "", closedAt = closedAt, blockedBy = blockedBy, blocks = emptyList(), attachments = emptyList(),
    )

    private fun groupsOf(vararg items: Item): Pair<List<Group>, (Long) -> Item?> {
        val byId = items.associateBy { it.id }
        val groups = items.filter { it.parentId == null }.map { p -> Group(p, items.filter { it.parentId == p.id }) }
        return groups to { id: Long -> byId[id] }
    }

    @Test
    fun activeTemplateHidesBacklogAndEmptyParents() {
        val ongoing = item(ItemType.ONGOING, "Maintenance")
        val todo = item(ItemType.TASK, "Fix", parentId = ongoing.id, status = Status.TODO)
        val backlog = item(ItemType.TASK, "Later", parentId = ongoing.id, status = Status.BACKLOG)
        val empty = item(ItemType.PROJECT, "Empty project", status = Status.TODO)
        val (groups, byId) = groupsOf(ongoing, todo, backlog, empty)

        val out = Preset.ACTIVE.criteria().apply(groups, byId)
        assertEquals(1, out.size)
        assertEquals(ongoing.id, out[0].parent.id)
        assertEquals(listOf(todo.id), out[0].tasks.map { it.id })
    }

    @Test
    fun recentlyClosedCountsAsActive() {
        val ongoing = item(ItemType.ONGOING, "Maintenance")
        val recent = item(ItemType.TASK, "Done lately", parentId = ongoing.id, status = Status.DONE,
            closedAt = Instant.now().minus(3, ChronoUnit.DAYS).toString())
        val old = item(ItemType.TASK, "Done long ago", parentId = ongoing.id, status = Status.DONE,
            closedAt = Instant.now().minus(30, ChronoUnit.DAYS).toString())
        val (groups, byId) = groupsOf(ongoing, recent, old)

        val out = Preset.ACTIVE.criteria().apply(groups, byId)
        assertEquals(listOf(recent.id), out.single().tasks.map { it.id })
    }

    @Test
    fun backlogKeepsOngoingRowsWithoutTasks() {
        val ongoing = item(ItemType.ONGOING, "Cats")
        val (groups, byId) = groupsOf(ongoing)
        val out = Preset.BACKLOG.criteria().apply(groups, byId)
        assertEquals(1, out.size)
        assertTrue(out[0].tasks.isEmpty())
    }

    @Test
    fun textSearchMatchesKeyTitleDescription() {
        val p = item(ItemType.PROJECT, "Kitchen", key = "P-7")
        val t = item(ItemType.TASK, "Paint walls", parentId = p.id)
        val (groups, byId) = groupsOf(p, t)
        assertEquals(1, Criteria(text = "p-7").apply(groups, byId).size)
        assertEquals(listOf(t.id), Criteria(text = "PAINT").apply(groups, byId).single().tasks.map { it.id })
        assertTrue(Criteria(text = "nothing").apply(groups, byId).isEmpty())
    }

    @Test
    fun ownerAssigneeAndBlockedFilters() {
        val p = item(ItemType.PROJECT, "P", ownerId = 1)
        val mine = item(ItemType.TASK, "mine", parentId = p.id, assigneeId = 2)
        val nobody = item(ItemType.TASK, "nobody", parentId = p.id)
        val blocker = item(ItemType.TASK, "blocker", parentId = p.id, status = Status.IN_PROGRESS)
        val blocked = item(ItemType.TASK, "blocked", parentId = p.id, blockedBy = listOf(blocker.id))
        val (groups, byId) = groupsOf(p, mine, nobody, blocker, blocked)

        assertEquals(listOf(mine.id), Criteria(assignee = "2").apply(groups, byId).single().tasks.map { it.id })
        assertEquals(listOf(nobody.id, blocker.id, blocked.id), Criteria(assignee = "none").apply(groups, byId).single().tasks.map { it.id })
        assertEquals(listOf(blocked.id), Criteria(blocked = "yes").apply(groups, byId).single().tasks.map { it.id })
        // The project matches owner=1 itself, so it shows even with no matching tasks.
        val byOwner = Criteria(owner = "1").apply(groups, byId).single()
        assertTrue(byOwner.tasks.isEmpty())
    }

    @Test
    fun endDateRangeNeedsADate() {
        val p = item(ItemType.PROJECT, "P")
        val dated = item(ItemType.TASK, "dated", parentId = p.id, endDate = LocalDate.of(2026, 11, 5))
        val undated = item(ItemType.TASK, "undated", parentId = p.id)
        val (groups, byId) = groupsOf(p, dated, undated)
        val c = Criteria(endAfter = LocalDate.of(2026, 11, 1), endBefore = LocalDate.of(2026, 11, 30))
        assertEquals(listOf(dated.id), c.apply(groups, byId).single().tasks.map { it.id })
        assertTrue(Criteria(endBefore = LocalDate.of(2026, 11, 4)).apply(groups, byId).isEmpty())
    }

    @Test
    fun jsonRoundTripAndPresetDetection() {
        val c = Criteria(statuses = setOf(Status.TODO, Status.IN_PROGRESS), recentDays = 14, hideEmptyParents = true, owner = "3", endAfter = LocalDate.of(2026, 1, 2))
        val back = Criteria.fromJson(c.toJson())
        assertEquals(c, back)
        assertEquals(Preset.ACTIVE, back.preset)
        assertNull(back.copy(owner = "", recentDays = 0).preset)
        assertEquals(Preset.ACTIVE, Criteria.fromJson(null).preset)
        assertEquals(Preset.ACTIVE, Criteria.fromJson("{not json").preset)
        assertFalse(Criteria().isActive)
    }

    @Test
    fun newStatusFollowsTheFilters() {
        assertEquals(Status.TODO, Criteria().newStatus())
        assertEquals(Status.BACKLOG, Preset.BACKLOG.criteria().newStatus())
        assertEquals(Status.TODO, Preset.ACTIVE.criteria().newStatus())
        assertEquals(Status.IDEA, Criteria(statuses = setOf(Status.IDEA, Status.DONE)).newStatus())
    }
}
