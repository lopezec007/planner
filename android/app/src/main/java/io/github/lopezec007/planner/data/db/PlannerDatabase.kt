package io.github.lopezec007.planner.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        UserEntity::class, ItemEntity::class, AttachmentEntity::class, SettingEntity::class,
        StatusHistoryEntity::class, PendingOpEntity::class, SyncLogEntity::class, ScratchEntity::class,
    ],
    version = 2,
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
    abstract fun scratch(): ScratchDao

    companion object {
        /** 1 -> 2: the scratch pad cache. */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS `scratch` (`scope` TEXT NOT NULL, `text` TEXT NOT NULL, `updatedAt` TEXT NOT NULL, PRIMARY KEY(`scope`))")
            }
        }

        val MIGRATIONS = arrayOf<Migration>(MIGRATION_1_2)

        fun build(context: Context, name: String = "planner.db"): PlannerDatabase =
            Room.databaseBuilder(context.applicationContext, PlannerDatabase::class.java, name)
                .addMigrations(*MIGRATIONS)
                // Every schema change so far has a migration above, which
                // keeps the queue and the local copy. The fallback is for a
                // downgrade or a version without one: the database is then
                // rebuilt from the server (and the queue is lost).
                .fallbackToDestructiveMigration(dropAllTables = true)
                .build()
    }
}
