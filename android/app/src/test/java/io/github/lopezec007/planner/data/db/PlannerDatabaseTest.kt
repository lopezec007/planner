// The scratch table and the schema migration that added it, on Robolectric
// so Room runs for real: in memory for the DAO; for the migration, a file
// built from the exported version-1 schema (app/schemas) and opened by Room,
// which runs the migration and validates the result against the entities.
package io.github.lopezec007.planner.data.db

import android.app.Application
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class PlannerDatabaseTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Test
    fun scratchDaoKeepsOneRowPerScope() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, PlannerDatabase::class.java).allowMainThreadQueries().build()
        try {
            assertNull(db.scratch().get("global"))
            assertNull(db.scratch().observe("global").first())
            db.scratch().upsert(ScratchEntity("global", "one", ""))
            db.scratch().upsert(ScratchEntity("user:3", "mine", "2026-10-21T10:00:00Z"))
            db.scratch().upsert(ScratchEntity("global", "two", "2026-10-21T10:00:01Z"))
            assertEquals("two", db.scratch().observe("global").first()!!.text)
            assertEquals("2026-10-21T10:00:01Z", db.scratch().get("global")!!.updatedAt)
            assertEquals(setOf("global", "user:3"), db.scratch().scopes().toSet())
            db.scratch().deleteAll()
            assertEquals(emptyList<String>(), db.scratch().scopes())
        } finally {
            db.close()
        }
    }

    /** Creates [file] as an empty database of the exported schema [version]. */
    private fun createFromSchema(file: File, version: Int) {
        // Gradle runs unit tests with the module directory as the working directory.
        val schema = Json.parseToJsonElement(File("schemas/${PlannerDatabase::class.java.name}/$version.json").readText())
            .jsonObject["database"]!!.jsonObject
        SQLiteDatabase.openOrCreateDatabase(file, null).use { sql ->
            for (e in schema["entities"]!!.jsonArray) {
                val table = e.jsonObject["tableName"]!!.jsonPrimitive.content
                sql.execSQL(e.jsonObject["createSql"]!!.jsonPrimitive.content.replace("\${TABLE_NAME}", table))
                for (i in e.jsonObject["indices"]?.jsonArray ?: emptyList()) {
                    sql.execSQL(i.jsonObject["createSql"]!!.jsonPrimitive.content.replace("\${TABLE_NAME}", table))
                }
            }
            for (q in schema["setupQueries"]!!.jsonArray) sql.execSQL(q.jsonPrimitive.content)
            sql.version = version
        }
    }

    @Test
    fun migration1To2KeepsTheQueueAndAddsTheScratchTable() = runBlocking {
        val file = File(context.cacheDir, "migration-test.db").apply { delete() }
        createFromSchema(file, 1)
        SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READWRITE).use { sql ->
            sql.execSQL("INSERT INTO pending_ops (payload, createdAt, attempts) VALUES ('{\"kind\":\"delete_item\",\"id\":7}', 1, 0)")
            sql.execSQL("INSERT INTO settings (`key`, value) VALUES ('week_start', '1')")
        }

        val db = Room.databaseBuilder(context, PlannerDatabase::class.java, file.path)
            .addMigrations(*PlannerDatabase.MIGRATIONS)
            .allowMainThreadQueries()
            .build()
        try {
            // Opening runs 1 -> 2 and validates every table against the entities.
            assertEquals(listOf("{\"kind\":\"delete_item\",\"id\":7}"), db.pendingOps().all().map { it.payload })
            assertEquals("1", db.settings().all().single().value)
            assertNull(db.scratch().get("global"))
            db.scratch().upsert(ScratchEntity("global", "hello", ""))
            assertEquals("hello", db.scratch().get("global")!!.text)
        } finally {
            db.close()
        }
    }
}
