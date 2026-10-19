package io.github.lopezec007.planner.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        UserEntity::class, ItemEntity::class, AttachmentEntity::class, SettingEntity::class,
        StatusHistoryEntity::class, PendingOpEntity::class, SyncLogEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
abstract class PlannerDatabase : RoomDatabase() {
    abstract fun users(): UserDao
    abstract fun items(): ItemDao
    abstract fun attachments(): AttachmentDao
    abstract fun settings(): SettingDao
    abstract fun history(): StatusHistoryDao
    abstract fun pendingOps(): PendingOpDao
    abstract fun syncLog(): SyncLogDao

    companion object {
        fun build(context: Context, name: String = "planner.db"): PlannerDatabase =
            Room.databaseBuilder(context.applicationContext, PlannerDatabase::class.java, name)
                // The local database is a cache plus a queue; on a schema change
                // it is rebuilt from the server (the queue is lost, which the
                // migration path should avoid once there is real data).
                .fallbackToDestructiveMigration(dropAllTables = true)
                .build()
    }
}
