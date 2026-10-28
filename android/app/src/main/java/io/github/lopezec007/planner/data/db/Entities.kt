// Room tables. Items, users, attachments, settings and the scratch pads
// mirror the server; pending_ops is the offline queue; sync_log keeps
// dropped ops for Settings; status_history caches /history answers so the
// detail screen works offline.
package io.github.lopezec007.planner.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "users")
data class UserEntity(
    @PrimaryKey val id: Long,
    val name: String,
    val color: String,
    val short: String,
    val createdAt: String,
)

@Entity(
    tableName = "items",
    indices = [Index("parentId"), Index("deleted")],
)
data class ItemEntity(
    @PrimaryKey val id: Long,          // negative while created offline
    val type: String,
    val key: String,
    val num: Long,
    val parentId: Long?,
    val title: String,
    val description: String,
    val ownerId: Long?,
    val assigneeId: Long?,
    val status: String?,
    val startDate: String?,
    val startFirm: Boolean,
    val endDate: String?,
    val endFirm: Boolean,
    val urgency: Int?,
    val importance: Int?,
    val blocked: Boolean,
    val color: String,
    val sortOrder: Long,
    val createdAt: String,
    val updatedAt: String,
    val closedAt: String?,
    /** JSON arrays of item ids, as on the wire. */
    val blockedBy: String,
    val blocks: String,
    /** Soft-deleted locally (the delete may still be queued); hidden everywhere. */
    @ColumnInfo(defaultValue = "0") val deleted: Boolean = false,
    /** For a task hidden by its parent's delete: that parent's id, so a restore brings it back. */
    val deletedWith: Long? = null,
    /** Minutes (tasks only); added in version 3, so it comes last. */
    val effort: Int? = null,
)

@Entity(tableName = "attachments", indices = [Index("itemId")])
data class AttachmentEntity(
    @PrimaryKey val id: Long,          // negative while the upload is queued
    val itemId: Long,
    val name: String,
    val contentType: String,
    val size: Long,
    val createdAt: String,
    /** Outbox file of a queued upload; null once on the server. */
    val localPath: String? = null,
    @ColumnInfo(defaultValue = "0") val deleted: Boolean = false,
)

@Entity(tableName = "settings")
data class SettingEntity(@PrimaryKey val key: String, val value: String)

/**
 * The cached text of one scratch pad, keyed like the server ("global" or
 * "user:<id>", see ScratchScope). A local edit lands here at once and in
 * the queue; [updatedAt] is the server's stamp, "" until it has one.
 */
@Entity(tableName = "scratch")
data class ScratchEntity(
    @PrimaryKey val scope: String,
    val text: String,
    val updatedAt: String,
)

@Entity(tableName = "status_history", indices = [Index("itemId")])
data class StatusHistoryEntity(
    @PrimaryKey val id: Long,
    val itemId: Long,
    val status: String,
    val changedAt: String,
)

@Entity(tableName = "pending_ops")
data class PendingOpEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    /** JSON of data.sync.Op (kind discriminator inside). */
    val payload: String,
    val createdAt: Long,
    val attempts: Int = 0,
    val lastError: String? = null,
)

@Entity(tableName = "sync_log")
data class SyncLogEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val at: Long,
    val summary: String,
    val detail: String,
)
