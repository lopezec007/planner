// Push the queue, then pull everything. See README "Offline tolerance".
//
//   sync()      one full cycle; safe to call from anywhere, serialised by a
//               mutex, never throws (the outcome is in the returned result
//               and in `state`).
//   state       what the UI shows: phase, pending count, last sync, last error.
package io.github.lopezec007.planner.data.sync

import androidx.room.withTransaction
import io.github.lopezec007.planner.data.api.ApiException
import io.github.lopezec007.planner.data.api.PlannerApi
import io.github.lopezec007.planner.data.db.PendingOpEntity
import io.github.lopezec007.planner.data.db.PlannerDatabase
import io.github.lopezec007.planner.data.db.ScratchEntity
import io.github.lopezec007.planner.data.db.SettingEntity
import io.github.lopezec007.planner.data.db.SyncLogEntity
import io.github.lopezec007.planner.data.db.toEntity
import io.github.lopezec007.planner.data.model.ScratchScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.io.IOException

enum class SyncPhase { IDLE, SYNCING, OFFLINE, NOT_CONFIGURED }

data class SyncState(
    val phase: SyncPhase = SyncPhase.IDLE,
    val pending: Int = 0,
    val lastSuccess: Long? = null,     // epoch millis of the last completed pull
    val lastError: String? = null,     // the latest problem worth showing
    val serverVersion: String? = null,
)

sealed class SyncResult {
    object Done : SyncResult()
    object NotConfigured : SyncResult()
    data class Offline(val reason: String) : SyncResult()
    data class Failed(val reason: String) : SyncResult()
}

class SyncEngine(
    private val db: PlannerDatabase,
    /** The API for the configured server, or null before setup. */
    private val apiProvider: () -> PlannerApi?,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val mutex = Mutex()
    private val _state = MutableStateFlow(SyncState())
    val state: StateFlow<SyncState> = _state

    /** Temporary id -> server id for every item created offline and since synced, so open screens can follow. */
    private val _remappedIds = MutableStateFlow<Map<Long, Long>>(emptyMap())
    val remappedIds: StateFlow<Map<Long, Long>> = _remappedIds

    /** Ops that keep failing with a server error (5xx) are dropped after this many tries. */
    private val maxAttempts = 5

    suspend fun refreshPending() {
        _state.update { it.copy(pending = db.pendingOps().count()) }
    }

    suspend fun sync(): SyncResult = mutex.withLock {
        val api = apiProvider()
        if (api == null) {
            _state.update { it.copy(phase = SyncPhase.NOT_CONFIGURED, pending = db.pendingOps().count()) }
            return SyncResult.NotConfigured
        }
        _state.update { it.copy(phase = SyncPhase.SYNCING, pending = db.pendingOps().count()) }
        val result = try {
            runCycle(api)
        } catch (e: IOException) {
            SyncResult.Offline(e.message ?: "network error")
        } catch (e: ApiException) {
            SyncResult.Failed(e.message ?: "HTTP ${e.code}")
        } catch (e: Exception) {
            SyncResult.Failed(e.toString())
        }
        val pending = db.pendingOps().count()
        _state.update { s ->
            when (result) {
                is SyncResult.Done -> s.copy(phase = SyncPhase.IDLE, pending = pending, lastSuccess = now(), lastError = null)
                is SyncResult.Offline -> s.copy(phase = SyncPhase.OFFLINE, pending = pending)
                is SyncResult.Failed -> s.copy(phase = SyncPhase.IDLE, pending = pending, lastError = result.reason)
                is SyncResult.NotConfigured -> s.copy(phase = SyncPhase.NOT_CONFIGURED, pending = pending)
            }
        }
        result
    }

    private suspend fun runCycle(api: PlannerApi): SyncResult {
        val version = api.probe()  // IOException when the server cannot be seen
        _state.update { it.copy(serverVersion = version.version) }
        pushAll(api)
        if (db.pendingOps().count() > 0) {
            // Something is still queued (a server error we will retry), so the
            // pull waits: it would overwrite the local edits behind that op.
            return SyncResult.Failed(_state.value.lastError ?: "some changes could not be sent yet")
        }
        pull(api)
        return SyncResult.Done
    }

    // ---------------------------------------------------------------- push

    private suspend fun pushAll(api: PlannerApi) {
        while (true) {
            val entity = db.pendingOps().all().firstOrNull() ?: return
            val op = try {
                Op.decode(entity.payload)
            } catch (e: Exception) {
                drop(entity, "unreadable queue entry", e.toString())
                continue
            }
            try {
                execute(api, op)
                // A scratch pad edit made while its op was in flight replaced
                // the payload (saveScratch collapses per scope); that newer
                // text must still go, so only an unchanged entry is removed.
                val fresh = db.pendingOps().get(entity.id)
                if (fresh == null || fresh.payload == entity.payload) db.pendingOps().delete(entity)
            } catch (e: ApiException) {
                if (e.isClientError) {
                    drop(entity, op.describe(), e.message ?: "HTTP ${e.code}")
                    _state.update { it.copy(lastError = "${op.describe()}: ${e.message}") }
                } else {
                    val tries = entity.attempts + 1
                    if (tries >= maxAttempts) {
                        drop(entity, op.describe(), "gave up after $tries tries: ${e.message}")
                    } else {
                        db.pendingOps().update(entity.copy(attempts = tries, lastError = e.message))
                        _state.update { it.copy(lastError = "${op.describe()}: ${e.message}") }
                        return  // keep order; retry the whole tail later
                    }
                }
            }
            _state.update { it.copy(pending = db.pendingOps().count()) }
        }
    }

    private suspend fun drop(entity: PendingOpEntity, summary: String, detail: String) {
        db.withTransaction {
            db.pendingOps().delete(entity)
            db.syncLog().insert(SyncLogEntity(at = now(), summary = "Not applied: $summary", detail = detail))
        }
    }

    private suspend fun execute(api: PlannerApi, op: Op) {
        when (op) {
            is Op.CreateItem -> {
                val dto = api.createItem(op.body)
                db.withTransaction {
                    // The optimistic row takes the server's id and fields; everything
                    // that pointed at the temporary id follows.
                    db.items().delete(op.localId)
                    db.items().upsert(dto.toEntity())
                    db.items().remapParent(op.localId, dto.id)
                    db.items().remapDeletedWith(op.localId, dto.id)
                    db.attachments().remapItem(op.localId, dto.id)
                    rewriteQueue { it.remapItem(op.localId, dto.id) }
                }
                _remappedIds.update { it + (op.localId to dto.id) }
            }
            is Op.PatchItem -> {
                val dto = api.updateItem(op.id, op.body)
                // Only adopt the server's row when no later queued op touches
                // this item; otherwise that op's optimistic edit would be lost.
                db.withTransaction { if (!laterOpsMention(op.id)) db.items().upsert(dto.toEntity()) }
            }
            is Op.DeleteItem -> api.deleteItem(op.id)
            is Op.RestoreItem -> api.restoreItem(op.id)
            is Op.Reorder -> api.reorder(op.ids)
            is Op.AddDependency -> api.addDependency(op.blockerId, op.blockedId)
            is Op.RemoveDependency -> api.removeDependency(op.blockerId, op.blockedId)
            is Op.UploadAttachment -> {
                val file = File(op.path)
                if (!file.exists()) throw ApiException(400, "the file to upload is gone: ${op.name}")
                val created = api.uploadAttachment(op.itemId, file, op.name, op.contentType)
                db.withTransaction {
                    db.attachments().delete(op.localId)
                    for (a in created) db.attachments().upsert(a.toEntity())
                    created.firstOrNull()?.let { a -> rewriteQueue { it.remapAttachment(op.localId, a.id) } }
                }
                file.delete()
            }
            is Op.DeleteAttachment -> api.deleteAttachment(op.id)
            is Op.RestoreAttachment -> api.restoreAttachment(op.id)
            is Op.PatchSettings -> api.updateSettings(op.values)
            is Op.CreateUser -> {
                val dto = api.createUser(op.body)
                db.withTransaction {
                    db.users().delete(op.localId)
                    db.users().upsert(dto.toEntity())
                    db.users().remapOwner(op.localId, dto.id)
                    db.users().remapAssignee(op.localId, dto.id)
                    rewriteQueue { it.remapUser(op.localId, dto.id) }
                }
            }
            is Op.PatchUser -> api.updateUser(op.id, op.body)
            is Op.DeleteUser -> api.deleteUser(op.id)
            is Op.PutScratch -> {
                val dto = api.putScratch(op.scope, op.text)
                // Take the server's stamp unless the pad was edited again meanwhile.
                db.withTransaction {
                    val cur = db.scratch().get(op.scope)
                    if (cur == null || cur.text == op.text) db.scratch().upsert(ScratchEntity(op.scope, dto.text, dto.updated_at))
                }
            }
        }
    }

    /** Whether any queued op after the head still refers to item [id]. */
    private suspend fun laterOpsMention(id: Long): Boolean =
        db.pendingOps().all().drop(1).any { e -> runCatching { Op.decode(e.payload).mentionsItem(id) }.getOrDefault(false) }

    private suspend fun rewriteQueue(f: (Op) -> Op) {
        for (e in db.pendingOps().all()) {
            val op = runCatching { Op.decode(e.payload) }.getOrNull() ?: continue
            val next = f(op)
            if (next != op) db.pendingOps().update(e.copy(payload = Op.encode(next)))
        }
    }

    // ---------------------------------------------------------------- pull

    private suspend fun pull(api: PlannerApi) {
        val users = api.listUsers()
        val items = api.listItems()
        val settings = api.settings()
        db.withTransaction {
            db.users().deleteAll()
            db.users().insertAll(users.map { it.toEntity() })
            db.items().deleteAll()
            db.items().insertAll(items.map { it.toEntity() })
            db.attachments().deleteSynced()
            db.attachments().insertAll(items.flatMap { it.attachments }.map { it.toEntity() })
            db.settings().deleteAll()
            db.settings().insertAll(settings.map { (k, v) -> SettingEntity(k, v) })
        }
        // The pads shown so far (the shared one always). The queue is empty
        // here, so nothing local is newer; a pad in the middle of being typed
        // is protected by the screen, which keeps unsaved text (ScratchEditor).
        for (scope in (db.scratch().scopes() + ScratchScope.GLOBAL).distinct()) {
            val dto = try {
                api.getScratch(scope)
            } catch (e: ApiException) {
                continue  // an older server without the pads, or a user gone since: not worth failing the pull
            }
            db.scratch().upsert(ScratchEntity(scope, dto.text, dto.updated_at))
        }
    }

    /**
     * Refreshes one scratch pad from the server into the cache, unless an
     * edit of it is still queued (the local text is then the newer one).
     * Errors are returned, not thrown.
     */
    suspend fun refreshScratch(scope: String): Exception? {
        val api = apiProvider() ?: return IllegalStateException("not configured")
        return try {
            val dto = api.getScratch(scope)
            db.withTransaction {
                if (!scratchQueued(scope)) db.scratch().upsert(ScratchEntity(scope, dto.text, dto.updated_at))
            }
            null
        } catch (e: Exception) {
            e
        }
    }

    /** Whether an edit of the pad [scope] is waiting in the queue. */
    suspend fun scratchQueued(scope: String): Boolean =
        db.pendingOps().all().any { e -> (runCatching { Op.decode(e.payload) }.getOrNull() as? Op.PutScratch)?.scope == scope }

    /** Refreshes one item's status history cache; errors are returned, not thrown. */
    suspend fun refreshHistory(itemId: Long): Exception? {
        val api = apiProvider() ?: return IllegalStateException("not configured")
        return try {
            val h = api.history(itemId)
            db.withTransaction {
                db.history().deleteFor(itemId)
                db.history().insertAll(h.map { it.toEntity() })
            }
            null
        } catch (e: Exception) {
            e
        }
    }

    /** Forgets the queue and the local copy (used when the server address changes). */
    suspend fun reset() {
        db.withTransaction {
            db.pendingOps().deleteAll()
            db.syncLog().deleteAll()
            db.users().deleteAll()
            db.items().deleteAll()
            db.attachments().deleteSynced()
            db.settings().deleteAll()
            db.history().deleteAll()
            db.scratch().deleteAll()
        }
        _state.value = SyncState()
    }
}
