// What the screens talk to. Reads are Flows over Room; every mutation is
// applied to Room at once and appended to the queue, then a sync is
// requested (README "Offline tolerance").
package io.github.lopezec007.planner.data.repo

import androidx.room.withTransaction
import io.github.lopezec007.planner.attach.Outbox
import io.github.lopezec007.planner.attach.OutboxFile
import io.github.lopezec007.planner.data.api.PlannerApi
import io.github.lopezec007.planner.data.db.AttachmentEntity
import io.github.lopezec007.planner.data.db.ItemEntity
import io.github.lopezec007.planner.data.db.PendingOpEntity
import io.github.lopezec007.planner.data.db.PlannerDatabase
import io.github.lopezec007.planner.data.db.ScratchEntity
import io.github.lopezec007.planner.data.db.SettingEntity
import io.github.lopezec007.planner.data.db.UserEntity
import io.github.lopezec007.planner.data.db.decodeIds
import io.github.lopezec007.planner.data.db.encodeIds
import io.github.lopezec007.planner.data.db.toModel
import io.github.lopezec007.planner.data.model.AppSettings
import io.github.lopezec007.planner.data.model.Attachment
import io.github.lopezec007.planner.data.model.Item
import io.github.lopezec007.planner.data.model.ItemType
import io.github.lopezec007.planner.data.model.Scratch
import io.github.lopezec007.planner.data.model.Status
import io.github.lopezec007.planner.data.model.StatusChange
import io.github.lopezec007.planner.data.model.User
import io.github.lopezec007.planner.data.sync.Op
import io.github.lopezec007.planner.data.sync.SyncEngine
import io.github.lopezec007.planner.data.sync.SyncScheduler
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.time.Instant
import java.util.concurrent.atomic.AtomicLong

class PlannerRepository(
    private val db: PlannerDatabase,
    private val sync: SyncEngine,
    private val scheduler: SyncScheduler,
    private val outbox: Outbox,
    private val cacheDir: File,
    private val apiProvider: () -> PlannerApi?,
) {
    /** Temporary ids for things created offline: negative, decreasing, unique per process and below any stored one. */
    private val nextLocalId = AtomicLong(-System.currentTimeMillis())

    private fun nowIso(): String = Instant.now().toString()

    // ---------------------------------------------------------------- reads

    val snapshot: Flow<Snapshot> = combine(
        db.users().observeAll(),
        db.items().observeLive(),
        db.attachments().observeLive(),
        db.settings().observeAll(),
    ) { users, items, attachments, settings ->
        val byItem = attachments.groupBy { it.itemId }
        Snapshot(
            users = users.map { it.toModel() },
            items = items.map { e -> e.toModel(byItem[e.id]?.map { it.toModel() } ?: emptyList()) },
            settings = AppSettings(settings.associate { it.key to it.value }),
            loaded = users.isNotEmpty() || items.isNotEmpty() || settings.isNotEmpty(),
        )
    }

    fun history(itemId: Long): Flow<List<StatusChange>> =
        db.history().observe(itemId).map { l -> l.mapNotNull { it.toModel() } }

    val syncState get() = sync.state
    /** Temporary -> server ids of items created in this process and synced since (see [resolveId]). */
    val remappedIds get() = sync.remappedIds
    val pendingCount: Flow<Int> get() = db.pendingOps().observeCount()
    val syncLog get() = db.syncLog().observeRecent()

    fun requestSync() = scheduler.requestNow()

    /** Pulls an item's status history from the server into the cache (no-op offline). */
    suspend fun refreshHistory(itemId: Long) {
        if (itemId > 0) sync.refreshHistory(itemId)
    }

    // ---------------------------------------------------------------- queue plumbing

    private suspend fun enqueue(op: Op) {
        db.pendingOps().insert(PendingOpEntity(payload = Op.encode(op), createdAt = System.currentTimeMillis()))
        sync.refreshPending()
    }

    private fun after() = scheduler.requestSoon()

    // ---------------------------------------------------------------- items

    /**
     * Creates an item optimistically and returns its (temporary) id. The key
     * is "…" until the server assigns one.
     */
    suspend fun createItem(
        type: ItemType,
        title: String,
        parentId: Long? = null,
        status: Status? = null,
        patch: ItemPatch = ItemPatch(),
    ): Long {
        val id = nextLocalId.getAndDecrement()
        val now = nowIso()
        val effectiveStatus = if (type == ItemType.ONGOING) null else (status ?: Status.TODO)
        val base = ItemEntity(
            id = id, type = type.wire, key = "…", num = 0, parentId = parentId, title = title.trim(), description = "",
            ownerId = null, assigneeId = null, status = effectiveStatus?.wire, startDate = null, startFirm = false,
            endDate = null, endFirm = false,
            urgency = if (type == ItemType.TASK) 5 else null, importance = if (type == ItemType.TASK) 5 else null,
            blocked = false, color = "", sortOrder = nextSortOrder(parentId), createdAt = now, updatedAt = now,
            closedAt = if (effectiveStatus?.isClosed == true) now else null, blockedBy = "[]", blocks = "[]",
        )
        val entity = patch.applyTo(base, now)
        val body = buildJsonObject {
            put("type", type.wire)
            put("title", entity.title)
            if (parentId != null) put("parent_id", parentId)
            if (effectiveStatus != null) put("status", effectiveStatus.wire)
            for ((k, v) in patch.toJson()) if (k != "status" && k != "parent_id" && k != "title") put(k, v)
        }
        db.withTransaction {
            db.items().upsert(entity)
            enqueue(Op.CreateItem(id, body))
        }
        after()
        return id
    }

    private suspend fun nextSortOrder(parentId: Long?): Long {
        val siblings = db.items().live().filter { it.parentId == parentId }
        return (siblings.maxOfOrNull { it.sortOrder } ?: -1) + 1
    }

    suspend fun patchItem(id: Long, patch: ItemPatch) {
        val body = patch.toJson()
        if (body.isEmpty()) return
        db.withTransaction {
            val e = db.items().get(id) ?: return@withTransaction
            db.items().update(patch.applyTo(e, nowIso()))
            enqueue(Op.PatchItem(id, body))
        }
        after()
    }

    /** Soft-deletes locally (tasks cascade like the server) and queues the delete. */
    suspend fun deleteItem(id: Long) {
        db.withTransaction {
            db.items().markDeleted(id, null)
            for (t in db.items().children(id)) if (!t.deleted) db.items().markDeleted(t.id, id)
            enqueue(Op.DeleteItem(id))
        }
        after()
    }

    suspend fun restoreItem(id: Long) {
        db.withTransaction {
            db.items().restore(id)
            enqueue(Op.RestoreItem(id))
        }
        after()
    }

    /** Reorders siblings; [ids] is the full new order of one parent's tasks or of the parents. */
    suspend fun reorder(ids: List<Long>) {
        if (ids.any { it < 0 }) return  // unsynced items cannot be reordered yet
        db.withTransaction {
            ids.forEachIndexed { i, id ->
                val e = db.items().get(id) ?: return@forEachIndexed
                if (e.sortOrder != i.toLong()) db.items().update(e.copy(sortOrder = i.toLong()))
            }
            enqueue(Op.Reorder(ids))
        }
        after()
    }

    /** Moves a task under another parent (appended at the end). */
    suspend fun reparent(taskId: Long, parentId: Long) {
        val order = nextSortOrder(parentId)
        db.withTransaction {
            val e = db.items().get(taskId) ?: return@withTransaction
            db.items().update(e.copy(parentId = parentId, sortOrder = order, updatedAt = nowIso()))
            enqueue(Op.PatchItem(taskId, buildJsonObject { put("parent_id", parentId) }))
        }
        after()
    }

    // ---------------------------------------------------------------- dependencies

    /** Returns null on success or the reason it was refused (as the server would). */
    suspend fun addDependency(blockerId: Long, blockedId: Long, snapshot: Snapshot): String? {
        if (blockerId < 0 || blockedId < 0) return "wait for the item to sync first"
        val blocker = snapshot.item(blockerId) ?: return "unknown item"
        val blocked = snapshot.item(blockedId) ?: return "unknown item"
        if (blocker.type == ItemType.ONGOING || blocked.type == ItemType.ONGOING) return "Ongoing items take no part in dependencies"
        if (blockerId == blockedId) return "an item cannot block itself"
        if (blockedId in blocker.blockedBy) return "that would make the two items block each other"
        if (snapshot.wouldCycle(blockerId, blockedId)) return "that would create a cycle of dependencies"
        if (blockerId in blocked.blockedBy) return null  // already there
        db.withTransaction {
            editIds(blockedId) { bb, bl -> (bb + blockerId).distinct() to bl }
            editIds(blockerId) { bb, bl -> bb to (bl + blockedId).distinct() }
            enqueue(Op.AddDependency(blockerId, blockedId))
        }
        after()
        return null
    }

    suspend fun removeDependency(blockerId: Long, blockedId: Long) {
        db.withTransaction {
            editIds(blockedId) { bb, bl -> (bb - blockerId) to bl }
            editIds(blockerId) { bb, bl -> bb to (bl - blockedId) }
            enqueue(Op.RemoveDependency(blockerId, blockedId))
        }
        after()
    }

    private suspend fun editIds(id: Long, f: (List<Long>, List<Long>) -> Pair<List<Long>, List<Long>>) {
        val e = db.items().get(id) ?: return
        val (bb, bl) = f(decodeIds(e.blockedBy), decodeIds(e.blocks))
        db.items().update(e.copy(blockedBy = encodeIds(bb), blocks = encodeIds(bl)))
    }

    // ---------------------------------------------------------------- attachments

    /** Queues an outbox file for upload to [itemId] and shows it as pending at once. */
    suspend fun attach(itemId: Long, file: OutboxFile) {
        val id = nextLocalId.getAndDecrement()
        db.withTransaction {
            db.attachments().upsert(
                AttachmentEntity(
                    id = id, itemId = itemId, name = file.name, contentType = file.contentType, size = file.size,
                    createdAt = nowIso(), localPath = file.file.absolutePath,
                ),
            )
            enqueue(Op.UploadAttachment(id, itemId, file.file.absolutePath, file.name, file.contentType))
        }
        after()
    }

    suspend fun deleteAttachment(id: Long) {
        db.withTransaction {
            db.attachments().setDeleted(id, true)
            if (id > 0) enqueue(Op.DeleteAttachment(id)) else cancelUpload(id)
        }
        after()
    }

    suspend fun restoreAttachment(id: Long) {
        if (id < 0) return
        db.withTransaction {
            db.attachments().setDeleted(id, false)
            enqueue(Op.RestoreAttachment(id))
        }
        after()
    }

    /** Drops a queued upload that was removed before it went out. */
    private suspend fun cancelUpload(localId: Long) {
        for (e in db.pendingOps().all()) {
            val op = runCatching { Op.decode(e.payload) }.getOrNull() as? Op.UploadAttachment ?: continue
            if (op.localId == localId) {
                db.pendingOps().delete(e)
                File(op.path).delete()
            }
        }
        db.attachments().delete(localId)
    }

    /**
     * The attachment's bytes as a local file: the outbox copy for a pending
     * upload, else the cache (downloaded on first use). Throws on network
     * failure.
     */
    suspend fun attachmentFile(a: Attachment): File {
        val entity = db.attachments().get(a.id)
        entity?.localPath?.let { p -> File(p).takeIf { it.exists() }?.let { return it } }
        val dir = File(cacheDir, "attachments").apply { mkdirs() }
        val ext = a.name.substringAfterLast('.', "").take(8)
        val f = File(dir, if (ext.isNotEmpty()) "${a.id}.$ext" else "${a.id}")
        if (f.exists() && f.length() == a.size) return f
        val api = apiProvider() ?: throw IllegalStateException("no server configured")
        api.downloadAttachment(a.id, f)
        return f
    }

    fun shareUri(file: File) = outbox.shareUri(file)

    // ---------------------------------------------------------------- settings & users

    suspend fun updateSettings(values: Map<String, String>) {
        db.withTransaction {
            db.settings().insertAll(values.map { (k, v) -> SettingEntity(k, v) })
            enqueue(Op.PatchSettings(values))
        }
        after()
    }

    suspend fun createUser(name: String, color: String?, short: String?): Long {
        val id = nextLocalId.getAndDecrement()
        val body: JsonObject = buildJsonObject {
            put("name", name.trim())
            if (!color.isNullOrBlank()) put("color", color)
            if (!short.isNullOrBlank()) put("short", short)
        }
        db.withTransaction {
            db.users().upsert(UserEntity(id, name.trim(), color ?: "#9aa3ad", short ?: defaultShort(name), nowIso()))
            enqueue(Op.CreateUser(id, body))
        }
        after()
        return id
    }

    suspend fun updateUser(id: Long, name: String? = null, color: String? = null, short: String? = null) {
        db.withTransaction {
            val u = db.users().get(id) ?: return@withTransaction
            db.users().upsert(u.copy(name = name ?: u.name, color = color ?: u.color, short = short ?: u.short))
            enqueue(
                Op.PatchUser(
                    id,
                    buildJsonObject {
                        if (name != null) put("name", name)
                        if (color != null) put("color", color)
                        if (short != null) put("short", short)
                    },
                ),
            )
        }
        after()
    }

    /** Refused (returns false) while any item refers to the user, as the server would 409. */
    suspend fun deleteUser(id: Long): Boolean {
        if (db.items().live().any { it.ownerId == id || it.assigneeId == id }) return false
        db.withTransaction {
            db.users().delete(id)
            enqueue(Op.DeleteUser(id))
        }
        after()
        return true
    }

    private fun defaultShort(name: String): String {
        val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        return if (words.size >= 2) words.take(3).joinToString("") { it.first().uppercaseChar().toString() } else name.trim().take(3)
    }

    /** Model for a single user, for screens that only need one. */
    suspend fun user(id: Long): User? = db.users().get(id)?.toModel()

    // ---------------------------------------------------------------- scratch pads

    /** The cached text of a pad; null until it has been fetched or edited once. */
    fun scratch(scope: String): Flow<Scratch?> =
        db.scratch().observe(scope).map { e -> e?.let { Scratch(it.scope, it.text, it.updatedAt) } }

    /** Whether an edit of the pad is still waiting to reach the server. */
    fun scratchQueued(scope: String): Flow<Boolean> = db.pendingOps().observeAll().map { ops ->
        ops.any { e -> (runCatching { Op.decode(e.payload) }.getOrNull() as? Op.PutScratch)?.scope == scope }
    }

    /**
     * Saves a pad's text: the cache takes it at once, and the queue holds
     * one put-scratch op per scope, whose text a later save replaces, so
     * typing does not grow the queue.
     */
    suspend fun saveScratch(scope: String, text: String) {
        db.withTransaction {
            val cur = db.scratch().get(scope)
            db.scratch().upsert(ScratchEntity(scope, text, cur?.updatedAt ?: ""))
            val queued = db.pendingOps().all().firstOrNull { e ->
                (runCatching { Op.decode(e.payload) }.getOrNull() as? Op.PutScratch)?.scope == scope
            }
            if (queued != null) {
                db.pendingOps().update(queued.copy(payload = Op.encode(Op.PutScratch(scope, text)), attempts = 0, lastError = null))
            } else {
                enqueue(Op.PutScratch(scope, text))
            }
        }
        after()
    }

    /** Fetches a pad from the server into the cache (kept as is while an edit is queued); the error, or null. */
    suspend fun refreshScratch(scope: String): Exception? = sync.refreshScratch(scope)
}
