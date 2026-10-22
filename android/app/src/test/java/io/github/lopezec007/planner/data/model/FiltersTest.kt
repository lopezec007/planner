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

        assertEquals(listOf(mine.id), Criteria(assignees = setOf("2")).apply(groups, byId).single().tasks.map { it.id })
        assertEquals(listOf(nobody.id, blocker.id, blocked.id), Criteria(assignees = setOf("none")).apply(groups, byId).single().tasks.map { it.id })
        assertEquals(listOf(blocked.id), Criteria(blocked = "yes").apply(groups, byId).single().tasks.map { it.id })
        // The project matches owner=1 itself, so it shows even with no matching tasks.
        val byOwner = Criteria(owners = setOf("1")).apply(groups, byId).single()
        assertTrue(byOwner.tasks.isEmpty())
    }

    @Test
    fun ownerAndAssigneeAreMultiSelect() {
        val p = item(ItemType.PROJECT, "P", ownerId = 1)
        val mine = item(ItemType.TASK, "mine", parentId = p.id, assigneeId = 2)
        val theirs = item(ItemType.TASK, "theirs", parentId = p.id, assigneeId = 3)
        val nobody = item(ItemType.TASK, "nobody", parentId = p.id)
        val (groups, byId) = groupsOf(p, mine, theirs, nobody)

        // Any of the chosen assignees matches, "none" included.
        assertEquals(listOf(mine.id, theirs.id), Criteria(assignees = setOf("2", "3")).apply(groups, byId).single().tasks.map { it.id })
        assertEquals(listOf(mine.id, nobody.id), Criteria(assignees = setOf("2", "none")).apply(groups, byId).single().tasks.map { it.id })
        assertTrue(Criteria(assignees = setOf("9")).apply(groups, byId).isEmpty())
        // Owners: the project owned by 1 shows; nobody owns 2, so that alone shows nothing.
        assertEquals(1, Criteria(owners = setOf("1", "2")).apply(groups, byId).size)
        assertTrue(Criteria(owners = setOf("2")).apply(groups, byId).isEmpty())
        assertEquals(2, Criteria(owners = setOf("1"), assignees = setOf("none")).filterCount)
    }

    @Test
    fun userSetsRoundTripAndReadTheLegacySingleKey() {
        val c = Criteria(owners = setOf("1", "none"), assignees = setOf("2", "3"))
        assertEquals(c, Criteria.fromJson(c.toJson()))
        // A lone choice is also written under the web's single key.
        val one = Criteria(owners = setOf("4"))
        assertTrue(one.toJson().contains("\"owner\":\"4\""))
        assertEquals(one, Criteria.fromJson(one.toJson()))
        // Filters saved before multi-select carry only the single keys.
        val legacy = Criteria.fromJson("{\"owner\":\"5\",\"assignee\":\"none\"}")
        assertEquals(setOf("5"), legacy.owners)
        assertEquals(setOf("none"), legacy.assignees)
        assertEquals(emptySet<String>(), Criteria.fromJson("{\"owner\":\"\"}").owners)
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
        val c = Criteria(statuses = setOf(Status.TODO, Status.IN_PROGRESS), recentDays = 14, hideEmptyParents = true, owners = setOf("3"), endAfter = LocalDate.of(2026, 1, 2))
        val back = Criteria.fromJson(c.toJson())
        assertEquals(c, back)
        assertEquals(Preset.ACTIVE, back.preset)
        assertNull(back.copy(owners = emptySet(), recentDays = 0).preset)
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

    @Test
    fun newStatusTakesTheDefaultWhenTheFiltersAdmitIt() {
        // No status filter, or one that includes the default: the default.
        assertEquals(Status.BACKLOG, Criteria().newStatus(Status.BACKLOG))
        assertEquals(Status.IDEA, Preset.IDEAS.criteria().newStatus(Status.IDEA))
        assertEquals(Status.IN_PROGRESS, Criteria(statuses = setOf(Status.TODO, Status.IN_PROGRESS)).newStatus(Status.IN_PROGRESS))
        // Otherwise the filter-derived choice, so the new row stays visible.
        assertEquals(Status.BACKLOG, Preset.BACKLOG.criteria().newStatus(Status.IDEA))
        assertEquals(Status.TODO, Preset.ACTIVE.criteria().newStatus(Status.BACKLOG))
        assertEquals(Status.IDEA, Criteria(statuses = setOf(Status.IDEA, Status.DONE)).newStatus(Status.BACKLOG))
    }
}
