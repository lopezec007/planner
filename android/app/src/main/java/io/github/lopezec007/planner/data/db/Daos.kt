package io.github.lopezec007.planner.data.db

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface UserDao {
    @Query("SELECT * FROM users ORDER BY id")
    fun observeAll(): Flow<List<UserEntity>>

    @Query("SELECT * FROM users ORDER BY id")
    suspend fun all(): List<UserEntity>

    @Query("SELECT * FROM users WHERE id = :id")
    suspend fun get(id: Long): UserEntity?

    @Upsert
    suspend fun upsert(u: UserEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(us: List<UserEntity>)

    @Query("DELETE FROM users")
    suspend fun deleteAll()

    @Query("DELETE FROM users WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("UPDATE users SET id = :newId WHERE id = :oldId")
    suspend fun remapId(oldId: Long, newId: Long)

    @Query("UPDATE items SET ownerId = :newId WHERE ownerId = :oldId")
    suspend fun remapOwner(oldId: Long, newId: Long)

    @Query("UPDATE items SET assigneeId = :newId WHERE assigneeId = :oldId")
    suspend fun remapAssignee(oldId: Long, newId: Long)
}

@Dao
interface ItemDao {
    @Query("SELECT * FROM items WHERE deleted = 0 ORDER BY sortOrder, id")
    fun observeLive(): Flow<List<ItemEntity>>

    @Query("SELECT * FROM items WHERE deleted = 0 ORDER BY sortOrder, id")
    suspend fun live(): List<ItemEntity>

    @Query("SELECT * FROM items WHERE id = :id")
    suspend fun get(id: Long): ItemEntity?

    @Query("SELECT * FROM items WHERE id = :id")
    fun observe(id: Long): Flow<ItemEntity?>

    @Query("SELECT * FROM items WHERE parentId = :parentId")
    suspend fun children(parentId: Long): List<ItemEntity>

    @Upsert
    suspend fun upsert(it: ItemEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(items: List<ItemEntity>)

    @Update
    suspend fun update(it: ItemEntity)

    @Query("DELETE FROM items")
    suspend fun deleteAll()

    @Query("DELETE FROM items WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("UPDATE items SET deleted = 1, deletedWith = :with WHERE id = :id")
    suspend fun markDeleted(id: Long, with: Long?)

    @Query("UPDATE items SET deleted = 0, deletedWith = NULL WHERE id = :id OR deletedWith = :id")
    suspend fun restore(id: Long)

    @Query("UPDATE items SET id = :newId WHERE id = :oldId")
    suspend fun remapId(oldId: Long, newId: Long)

    @Query("UPDATE items SET parentId = :newId WHERE parentId = :oldId")
    suspend fun remapParent(oldId: Long, newId: Long)

    @Query("UPDATE items SET deletedWith = :newId WHERE deletedWith = :oldId")
    suspend fun remapDeletedWith(oldId: Long, newId: Long)

    @Query("SELECT MIN(id) FROM items")
    suspend fun minId(): Long?
}

@Dao
interface AttachmentDao {
    @Query("SELECT * FROM attachments WHERE deleted = 0 ORDER BY id")
    fun observeLive(): Flow<List<AttachmentEntity>>

    @Query("SELECT * FROM attachments WHERE id = :id")
    suspend fun get(id: Long): AttachmentEntity?

    @Upsert
    suspend fun upsert(a: AttachmentEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(list: List<AttachmentEntity>)

    /** Replaces every server-side row, keeping the queued uploads (negative ids). */
    @Query("DELETE FROM attachments WHERE id > 0")
    suspend fun deleteSynced()

    @Query("DELETE FROM attachments WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("UPDATE attachments SET deleted = :deleted WHERE id = :id")
    suspend fun setDeleted(id: Long, deleted: Boolean)

    @Query("UPDATE attachments SET itemId = :newId WHERE itemId = :oldId")
    suspend fun remapItem(oldId: Long, newId: Long)

    @Query("SELECT MIN(id) FROM attachments")
    suspend fun minId(): Long?
}

@Dao
interface SettingDao {
    @Query("SELECT * FROM settings")
    fun observeAll(): Flow<List<SettingEntity>>

    @Query("SELECT * FROM settings")
    suspend fun all(): List<SettingEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(list: List<SettingEntity>)

    @Query("DELETE FROM settings")
    suspend fun deleteAll()
}

@Dao
interface StatusHistoryDao {
    @Query("SELECT * FROM status_history WHERE itemId = :itemId ORDER BY changedAt, id")
    fun observe(itemId: Long): Flow<List<StatusHistoryEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(list: List<StatusHistoryEntity>)

    @Query("DELETE FROM status_history WHERE itemId = :itemId")
    suspend fun deleteFor(itemId: Long)

    @Query("DELETE FROM status_history")
    suspend fun deleteAll()
}

@Dao
interface PendingOpDao {
    @Query("SELECT * FROM pending_ops ORDER BY id")
    suspend fun all(): List<PendingOpEntity>

    @Query("SELECT COUNT(*) FROM pending_ops")
    fun observeCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM pending_ops")
    suspend fun count(): Int

    @Insert
    suspend fun insert(op: PendingOpEntity): Long

    @Update
    suspend fun update(op: PendingOpEntity)

    @Delete
    suspend fun delete(op: PendingOpEntity)

    @Query("DELETE FROM pending_ops")
    suspend fun deleteAll()
}

@Dao
interface SyncLogDao {
    @Query("SELECT * FROM sync_log ORDER BY id DESC LIMIT 50")
    fun observeRecent(): Flow<List<SyncLogEntity>>

    @Insert
    suspend fun insert(e: SyncLogEntity)

    @Query("DELETE FROM sync_log")
    suspend fun deleteAll()
}
