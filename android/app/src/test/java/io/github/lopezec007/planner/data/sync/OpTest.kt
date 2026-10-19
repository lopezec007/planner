package io.github.lopezec007.planner.data.sync

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class OpTest {
    @Test
    fun roundTripsEveryKind() {
        val ops = listOf(
            Op.CreateItem(-5, buildJsonObject { put("type", "task"); put("title", "x"); put("parent_id", -3L) }),
            Op.PatchItem(7, buildJsonObject { put("title", "y") }),
            Op.DeleteItem(7), Op.RestoreItem(7), Op.Reorder(listOf(1, 2, 3)),
            Op.AddDependency(1, 2), Op.RemoveDependency(1, 2),
            Op.UploadAttachment(-9, 7, "/tmp/x.jpg", "x.jpg", "image/jpeg"),
            Op.DeleteAttachment(4), Op.RestoreAttachment(4),
            Op.PatchSettings(mapOf("week_start" to "1")),
            Op.CreateUser(-2, buildJsonObject { put("name", "Amy") }), Op.PatchUser(2, buildJsonObject { put("color", "#000000") }), Op.DeleteUser(2),
        )
        for (op in ops) assertEquals(op, Op.decode(Op.encode(op)))
        assertTrue(Op.encode(ops[0]).contains("\"kind\":\"create_item\""))
    }

    @Test
    fun remapsItemIdsEverywhere() {
        val create = Op.CreateItem(-5, buildJsonObject { put("type", "task"); put("parent_id", -3L) })
        assertEquals(JsonPrimitive(42L), (create.remapItem(-3, 42) as Op.CreateItem).body["parent_id"])

        val patch = Op.PatchItem(-5, buildJsonObject { put("parent_id", -3L); put("owner_id", -3L) })
        val r = patch.remapItem(-5, 10).remapItem(-3, 42) as Op.PatchItem
        assertEquals(10L, r.id)
        assertEquals(JsonPrimitive(42L), r.body["parent_id"])
        assertEquals(JsonPrimitive(-3L), r.body["owner_id"]) // a user id, untouched by an item remap

        assertEquals(Op.Reorder(listOf(1, 42, 3)), Op.Reorder(listOf(1, -3, 3)).remapItem(-3, 42))
        assertEquals(Op.AddDependency(42, 2), Op.AddDependency(-3, 2).remapItem(-3, 42))
        assertEquals(Op.UploadAttachment(-9, 42, "/p", "n", "t"), Op.UploadAttachment(-9, -3, "/p", "n", "t").remapItem(-3, 42))
        val untouched = Op.DeleteUser(-3)
        assertSame(untouched, untouched.remapItem(-3, 42))
    }

    @Test
    fun remapsUserIds() {
        val patch = Op.PatchItem(5, buildJsonObject { put("assignee_id", -2L); put("parent_id", -2L) })
        val r = patch.remapUser(-2, 9) as Op.PatchItem
        assertEquals(JsonPrimitive(9L), r.body["assignee_id"])
        assertEquals(JsonPrimitive(-2L), r.body["parent_id"])
        assertEquals(Op.PatchUser(9, buildJsonObject { }), Op.PatchUser(-2, buildJsonObject { }).remapUser(-2, 9))
    }

    @Test
    fun mentionsItem() {
        assertTrue(Op.PatchItem(5, buildJsonObject { }).mentionsItem(5))
        assertTrue(Op.CreateItem(-1, buildJsonObject { put("parent_id", 5L) }).mentionsItem(5))
        assertTrue(Op.Reorder(listOf(1, 5)).mentionsItem(5))
        assertFalse(Op.PatchSettings(emptyMap()).mentionsItem(5))
        assertFalse(Op.DeleteItem(6).mentionsItem(5))
    }
}
