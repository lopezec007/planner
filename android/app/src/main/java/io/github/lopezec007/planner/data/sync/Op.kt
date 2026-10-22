// The offline queue's entries. Each op is one server request, recorded with
// the ids as they were known when the user acted; ids of items or users
// created offline are negative and are rewritten ([remapItem], [remapUser])
// when the server answers the create that precedes them in the queue.
package io.github.lopezec007.planner.data.sync

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

@Serializable
sealed class Op {
    @Serializable @SerialName("create_item")
    data class CreateItem(val localId: Long, val body: JsonObject) : Op()

    @Serializable @SerialName("patch_item")
    data class PatchItem(val id: Long, val body: JsonObject) : Op()

    @Serializable @SerialName("delete_item")
    data class DeleteItem(val id: Long) : Op()

    @Serializable @SerialName("restore_item")
    data class RestoreItem(val id: Long) : Op()

    @Serializable @SerialName("reorder")
    data class Reorder(val ids: List<Long>) : Op()

    @Serializable @SerialName("add_dependency")
    data class AddDependency(val blockerId: Long, val blockedId: Long) : Op()

    @Serializable @SerialName("remove_dependency")
    data class RemoveDependency(val blockerId: Long, val blockedId: Long) : Op()

    @Serializable @SerialName("upload_attachment")
    data class UploadAttachment(val localId: Long, val itemId: Long, val path: String, val name: String, val contentType: String) : Op()

    @Serializable @SerialName("delete_attachment")
    data class DeleteAttachment(val id: Long) : Op()

    @Serializable @SerialName("restore_attachment")
    data class RestoreAttachment(val id: Long) : Op()

    @Serializable @SerialName("patch_settings")
    data class PatchSettings(val values: Map<String, String>) : Op()

    @Serializable @SerialName("create_user")
    data class CreateUser(val localId: Long, val body: JsonObject) : Op()

    @Serializable @SerialName("patch_user")
    data class PatchUser(val id: Long, val body: JsonObject) : Op()

    @Serializable @SerialName("delete_user")
    data class DeleteUser(val id: Long) : Op()

    /**
     * The full text of one scratch pad (last writer wins on the server).
     * At most one is queued per scope: a later edit replaces its text
     * instead of adding an entry (PlannerRepository.saveScratch).
     */
    @Serializable @SerialName("put_scratch")
    data class PutScratch(val scope: String, val text: String) : Op()

    /** A short description for the sync log. */
    fun describe(): String = when (this) {
        is CreateItem -> "create item ${body["title"]?.let { (it as? JsonPrimitive)?.content } ?: ""}"
        is PatchItem -> "edit item $id (${body.keys.joinToString()})"
        is DeleteItem -> "delete item $id"
        is RestoreItem -> "restore item $id"
        is Reorder -> "reorder ${ids.size} items"
        is AddDependency -> "add dependency $blockerId → $blockedId"
        is RemoveDependency -> "remove dependency $blockerId → $blockedId"
        is UploadAttachment -> "upload $name to item $itemId"
        is DeleteAttachment -> "remove attachment $id"
        is RestoreAttachment -> "restore attachment $id"
        is PatchSettings -> "settings ${values.keys.joinToString()}"
        is CreateUser -> "create user"
        is PatchUser -> "edit user $id"
        is DeleteUser -> "delete user $id"
        is PutScratch -> "scratch pad $scope"
    }

    /** Whether this op refers to the item [id] (and so must wait for its create). */
    fun mentionsItem(id: Long): Boolean = when (this) {
        is CreateItem -> body.long("parent_id") == id
        is PatchItem -> this.id == id || body.long("parent_id") == id
        is DeleteItem -> this.id == id
        is RestoreItem -> this.id == id
        is Reorder -> id in ids
        is AddDependency -> blockerId == id || blockedId == id
        is RemoveDependency -> blockerId == id || blockedId == id
        is UploadAttachment -> itemId == id
        else -> false
    }

    /** This op with every reference to item [old] replaced by [new]. */
    fun remapItem(old: Long, new: Long): Op = when (this) {
        is CreateItem -> copy(body = body.remapKeys(setOf("parent_id"), old, new))
        is PatchItem -> copy(id = id.swap(old, new), body = body.remapKeys(setOf("parent_id"), old, new))
        is DeleteItem -> copy(id = id.swap(old, new))
        is RestoreItem -> copy(id = id.swap(old, new))
        is Reorder -> copy(ids = ids.map { it.swap(old, new) })
        is AddDependency -> copy(blockerId = blockerId.swap(old, new), blockedId = blockedId.swap(old, new))
        is RemoveDependency -> copy(blockerId = blockerId.swap(old, new), blockedId = blockedId.swap(old, new))
        is UploadAttachment -> copy(itemId = itemId.swap(old, new))
        else -> this
    }

    /** This op with every reference to user [old] replaced by [new]. */
    fun remapUser(old: Long, new: Long): Op = when (this) {
        is CreateItem -> copy(body = body.remapKeys(USER_KEYS, old, new))
        is PatchItem -> copy(body = body.remapKeys(USER_KEYS, old, new))
        is PatchUser -> copy(id = id.swap(old, new))
        is DeleteUser -> copy(id = id.swap(old, new))
        else -> this
    }

    /** This op with every reference to attachment [old] replaced by [new]. */
    fun remapAttachment(old: Long, new: Long): Op = when (this) {
        is DeleteAttachment -> copy(id = id.swap(old, new))
        is RestoreAttachment -> copy(id = id.swap(old, new))
        else -> this
    }

    companion object {
        private val USER_KEYS = setOf("owner_id", "assignee_id")

        val json = Json {
            classDiscriminator = "kind"
            ignoreUnknownKeys = true
            encodeDefaults = true
        }

        fun encode(op: Op): String = json.encodeToString(serializer(), op)
        fun decode(s: String): Op = json.decodeFromString(serializer(), s)
    }
}

private fun Long.swap(old: Long, new: Long) = if (this == old) new else this

private fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

private fun JsonObject.remapKeys(keys: Set<String>, old: Long, new: Long): JsonObject {
    var changed = false
    val out = LinkedHashMap<String, kotlinx.serialization.json.JsonElement>(this)
    for (k in keys) {
        val v = this[k]
        if (v is JsonPrimitive && v !== JsonNull && v.longOrNull == old) {
            out[k] = JsonPrimitive(new)
            changed = true
        }
    }
    return if (changed) JsonObject(out) else this
}
