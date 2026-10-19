// A partial edit of an item: unset fields are untouched, Set(null) clears.
// Mirrors the server's PATCH semantics (api.go itemBody / Opt).
package io.github.lopezec007.planner.data.repo

import io.github.lopezec007.planner.data.db.ItemEntity
import io.github.lopezec007.planner.data.model.Dates
import io.github.lopezec007.planner.data.model.Status
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.time.LocalDate

sealed class Opt<out T> {
    object Unset : Opt<Nothing>()
    data class Set<T>(val value: T?) : Opt<T>()
}

fun <T> set(v: T?): Opt<T> = Opt.Set(v)

data class ItemPatch(
    val title: Opt<String> = Opt.Unset,
    val description: Opt<String> = Opt.Unset,
    val status: Opt<Status> = Opt.Unset,
    val parentId: Opt<Long> = Opt.Unset,
    val ownerId: Opt<Long> = Opt.Unset,
    val assigneeId: Opt<Long> = Opt.Unset,
    val startDate: Opt<LocalDate> = Opt.Unset,
    val startFirm: Opt<Boolean> = Opt.Unset,
    val endDate: Opt<LocalDate> = Opt.Unset,
    val endFirm: Opt<Boolean> = Opt.Unset,
    val urgency: Opt<Int> = Opt.Unset,
    val importance: Opt<Int> = Opt.Unset,
    val blocked: Opt<Boolean> = Opt.Unset,
    val color: Opt<String> = Opt.Unset,
) {
    val isEmpty: Boolean get() = toJson().isEmpty()

    /** The PATCH body: only set fields, null for cleared ones. */
    fun toJson(): JsonObject = buildJsonObject {
        fun <T> field(key: String, o: Opt<T>, enc: (T) -> JsonPrimitive) {
            if (o is Opt.Set) put(key, o.value?.let(enc) ?: JsonNull)
        }
        field("title", title) { JsonPrimitive(it) }
        field("description", description) { JsonPrimitive(it) }
        field("status", status) { JsonPrimitive(it.wire) }
        field("parent_id", parentId) { JsonPrimitive(it) }
        field("owner_id", ownerId) { JsonPrimitive(it) }
        field("assignee_id", assigneeId) { JsonPrimitive(it) }
        field("start_date", startDate) { JsonPrimitive(Dates.format(it)) }
        field("start_firm", startFirm) { JsonPrimitive(it) }
        field("end_date", endDate) { JsonPrimitive(Dates.format(it)) }
        field("end_firm", endFirm) { JsonPrimitive(it) }
        field("urgency", urgency) { JsonPrimitive(it) }
        field("importance", importance) { JsonPrimitive(it) }
        field("blocked", blocked) { JsonPrimitive(it) }
        field("color", color) { JsonPrimitive(it) }
    }

    /** The optimistic local result. `closedAt` follows a status change like the server does. */
    fun applyTo(e: ItemEntity, nowIso: String): ItemEntity {
        var out = e
        (title as? Opt.Set)?.let { out = out.copy(title = it.value ?: "") }
        (description as? Opt.Set)?.let { out = out.copy(description = it.value ?: "") }
        (status as? Opt.Set)?.let { s ->
            val next = s.value
            val wasClosed = Status.fromWire(out.status)?.isClosed == true
            val closed = next?.isClosed == true
            out = out.copy(
                status = next?.wire,
                closedAt = when {
                    closed && !wasClosed -> nowIso
                    closed -> out.closedAt ?: nowIso
                    else -> null
                },
            )
        }
        (parentId as? Opt.Set)?.let { if (it.value != null) out = out.copy(parentId = it.value) }
        (ownerId as? Opt.Set)?.let { out = out.copy(ownerId = it.value) }
        (assigneeId as? Opt.Set)?.let { out = out.copy(assigneeId = it.value) }
        (startDate as? Opt.Set)?.let { out = out.copy(startDate = Dates.format(it.value)) }
        (startFirm as? Opt.Set)?.let { out = out.copy(startFirm = it.value ?: false) }
        (endDate as? Opt.Set)?.let { out = out.copy(endDate = Dates.format(it.value)) }
        (endFirm as? Opt.Set)?.let { out = out.copy(endFirm = it.value ?: false) }
        (urgency as? Opt.Set)?.let { out = out.copy(urgency = it.value) }
        (importance as? Opt.Set)?.let { out = out.copy(importance = it.value) }
        (blocked as? Opt.Set)?.let { out = out.copy(blocked = it.value ?: false) }
        (color as? Opt.Set)?.let { out = out.copy(color = it.value ?: "") }
        return out.copy(updatedAt = nowIso)
    }
}
