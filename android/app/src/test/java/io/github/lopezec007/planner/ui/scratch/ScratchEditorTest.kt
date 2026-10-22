// The editor's rules: typing saves once after it stops (one queued op), a
// server text replaces the field only while it is neither focused nor
// dirty, and leaving (flush) saves at once. Real Room in memory, real
// delays made short.
package io.github.lopezec007.planner.ui.scratch

import android.app.Application
import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import io.github.lopezec007.planner.attach.Outbox
import io.github.lopezec007.planner.data.db.PlannerDatabase
import io.github.lopezec007.planner.data.db.ScratchEntity
import io.github.lopezec007.planner.data.repo.PlannerRepository
import io.github.lopezec007.planner.data.sync.SyncEngine
import io.github.lopezec007.planner.data.sync.SyncScheduler
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class ScratchEditorTest {
    private lateinit var db: PlannerDatabase
    private lateinit var repo: PlannerRepository
    private lateinit var scope: CoroutineScope
    private val errors = java.util.concurrent.CopyOnWriteArrayList<Throwable>()

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, PlannerDatabase::class.java).allowMainThreadQueries().build()
        scope = CoroutineScope(Dispatchers.Default + Job() + CoroutineExceptionHandler { _, e -> errors += e })
        val engine = SyncEngine(db, { null })
        repo = PlannerRepository(db, engine, SyncScheduler(context, engine, scope), Outbox(context), context.cacheDir, { null })
    }

    @After
    fun tearDown() {
        scope.cancel()
        db.close()
    }

    /** Polls [cond] for up to two seconds. */
    private suspend fun await(what: String, cond: suspend () -> Boolean) {
        val until = System.currentTimeMillis() + 2_000
        while (!cond()) {
            if (System.currentTimeMillis() > until) throw AssertionError("timed out waiting for $what; editor errors: $errors", errors.firstOrNull())
            delay(20)
        }
    }

    @Test
    fun typingSavesOnceAfterItStopsAndKeepsOneQueuedOp() = runBlocking {
        val editor = ScratchEditor("global", repo, scope, saveDelayMs = 100)
        await("the cache") { editor.loaded }
        editor.onFocus(true)
        editor.onTyped("h")
        editor.onTyped("he")
        editor.onTyped("hel")
        assertTrue(editor.dirty)
        await("the debounced save") { !editor.dirty }
        await("the cache row") { db.scratch().get("global")?.text == "hel" }
        assertEquals(1, db.pendingOps().count())
        editor.onTyped("hello")
        await("the second save") { !editor.dirty && db.scratch().get("global")?.text == "hello" }
        assertEquals(1, db.pendingOps().count()) // collapsed into the queued op
        assertEquals("hello", editor.text)
    }

    @Test
    fun serverTextWaitsWhileFocusedOrDirtyAndLocalEditsWin() = runBlocking {
        db.scratch().upsert(ScratchEntity("global", "first", "s1"))
        val editor = ScratchEditor("global", repo, scope, saveDelayMs = 100)
        await("the cache") { editor.text == "first" }

        // Not focused, not dirty: a new cached text replaces the field.
        db.scratch().upsert(ScratchEntity("global", "second", "s2"))
        await("the replacement") { editor.text == "second" }

        // Focused but clean: the change waits for the blur.
        editor.onFocus(true)
        db.scratch().upsert(ScratchEntity("global", "third", "s3"))
        Thread.sleep(200)
        assertEquals("second", editor.text)
        editor.onFocus(false)
        assertEquals("third", editor.text)

        // Dirty: the user's text stays and is what gets saved; the remote text is dropped.
        editor.onFocus(true)
        editor.onTyped("third plus mine")
        db.scratch().upsert(ScratchEntity("global", "fourth", "s4"))
        Thread.sleep(200)
        assertEquals("third plus mine", editor.text)
        editor.onFocus(false) // blur saves at once
        await("the save") { db.scratch().get("global")?.text == "third plus mine" }
        assertFalse(editor.dirty)
        Thread.sleep(200)
        assertEquals("third plus mine", editor.text)
    }

    @Test
    fun flushSavesWhatIsTypedWithoutWaiting() = runBlocking {
        val editor = ScratchEditor("user:1", repo, scope, saveDelayMs = 60_000)
        await("the cache") { editor.loaded }
        editor.onTyped("leaving now")
        editor.flush()
        assertFalse(editor.dirty)
        assertEquals("leaving now", db.scratch().get("user:1")!!.text)
        assertEquals(1, db.pendingOps().count())
        editor.flush() // nothing new: no second op
        assertEquals(1, db.pendingOps().count())
    }
}
