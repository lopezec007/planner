package io.github.lopezec007.planner.data.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EffortTest {
    private fun task(effort: Int?, status: Status = Status.TODO) = Item(
        id = 1, type = ItemType.TASK, key = "T-1", num = 1, parentId = 2, title = "t", description = "",
        ownerId = null, assigneeId = null, status = status, startDate = null, startFirm = false, endDate = null, endFirm = false,
        urgency = 5, importance = 5, effort = effort, blocked = false, color = "", sortOrder = 0, createdAt = "", updatedAt = "",
        closedAt = null, blockedBy = emptyList(), blocks = emptyList(), attachments = emptyList(),
    )

    @Test
    fun formatsMinutesAsHoursAndMinutes() {
        assertEquals("", Effort.format(null))
        assertEquals("15m", Effort.format(15))
        assertEquals("30m", Effort.format(30))
        assertEquals("1h", Effort.format(60))
        assertEquals("2h", Effort.format(120))
        assertEquals("1h 30m", Effort.format(90))
        assertEquals("64h", Effort.format(3840))
        assertEquals("0m", Effort.format(0))
    }

    @Test
    fun parsesTheOptionsSettingLeniently() {
        assertEquals(Effort.DEFAULT_OPTIONS, Effort.parseOptions(null))
        assertEquals(Effort.DEFAULT_OPTIONS, Effort.parseOptions(""))
        assertEquals(Effort.DEFAULT_OPTIONS, Effort.parseOptions("nope"))
        assertEquals(Effort.DEFAULT_OPTIONS, Effort.parseOptions("[]"))
        assertEquals(listOf(15, 45, 60), Effort.parseOptions("[60, 15, 45, 15, -5, 0]"))
        assertEquals("[15,45,60]", Effort.encodeOptions(listOf(60, 15, 45, 45)))
        assertEquals(listOf(15, 45, 60), AppSettings(mapOf("effort_options" to "[15,45,60]")).effortOptions)
        assertEquals(Effort.DEFAULT_OPTIONS, AppSettings.EMPTY.effortOptions)
    }

    @Test
    fun sumsOpenTasksAndAllTasks() {
        val tasks = listOf(task(60), task(30, Status.DONE), task(null), task(15, Status.CANCELLED), task(120, Status.IN_PROGRESS))
        assertEquals(180, Effort.sumOpen(tasks))
        assertEquals(225, Effort.sum(tasks))
        assertNull(Effort.sum(listOf(task(null))))
        assertNull(Effort.sumOpen(listOf(task(30, Status.DONE))))
        assertEquals(30, Effort.sum(listOf(task(30, Status.DONE))))
        assertNull(Effort.sum(emptyList()))
    }

    @Test
    fun importanceBelowZeroHasNoRampColour() {
        val s = AppSettings(mapOf("importance_colors" to "[\"#000001\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"#ffffff\"]"))
        assertEquals("#000001", s.levelColor("importance", 0))
        assertEquals("#ffffff", s.levelColor("importance", 10))
        assertEquals("", s.levelColor("importance", -1))
        assertEquals("", s.levelColor("importance", null))
    }
}
