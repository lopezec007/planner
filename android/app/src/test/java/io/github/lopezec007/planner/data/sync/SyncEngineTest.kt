// The queue replay against a fake server: temporary ids are remapped, a
// 4xx drops one op and the rest still go, a network failure keeps the
// queue, a pull replaces the local copy, and scratch pad edits collapse to
// one queued op per pad. Runs on Robolectric so Room
// can be used in-memory; a plain Application keeps the app's own Graph out.
package io.github.lopezec007.planner.data.sync

import android.app.Application
import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import io.github.lopezec007.planner.attach.Outbox
import io.github.lopezec007.planner.data.api.PlannerApi
import io.github.lopezec007.planner.data.db.ItemEntity
import io.github.lopezec007.planner.data.db.PlannerDatabase
import io.github.lopezec007.planner.data.model.ItemType
import io.github.lopezec007.planner.data.model.ScratchScope
import io.github.lopezec007.planner.data.model.Status
import io.github.lopezec007.planner.data.repo.ItemPatch
import io.github.lopezec007.planner.data.repo.PlannerRepository
import io.github.lopezec007.planner.data.repo.set
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class SyncEngineTest {
    private lateinit var db: PlannerDatabase
    private lateinit var server: MockWebServer
    private lateinit var engine: SyncEngine
    private lateinit var repo: PlannerRepository
    private lateinit var scope: CoroutineScope
    private var api: PlannerApi? = null

    /** A tiny fake planner: items are stored by id and title; new ids start at 100. */
    private val items = LinkedHashMap<Long, String>()
    private var nextId = 100L

    /** The scratch pads by scope ("global", "user:1"); each PUT gets a new stamp. */
    private val scratch = HashMap<String, String>()
    private var scratchStamp = 0

    private fun scratchJson(scope: String) =
        """{"text":${Json.encodeToString(String.serializer(), scratch[scope] ?: "")},"updated_at":"${if (scope in scratch) "2026-10-21T10:00:0${scratchStamp}Z" else ""}"}"""
    private val requests = ArrayList<RecordedRequest>()

    private fun itemJson(id: Long, title: String) =
        """{"id":$id,"type":"task","key":"T-$id","num":$id,"parent_id":1,"title":"$title","description":"",
            "owner_id":null,"assignee_id":null,"status":"todo","start_date":null,"start_firm":false,"end_date":null,"end_firm":false,
            "urgency":5,"importance":5,"blocked":false,"color":"","sort_order":0,"created_at":"c","updated_at":"u","closed_at":null,
            "blocked_by":[],"blocks":[],"attachments":[]}"""

    private fun entity(id: Long, title: String) = ItemEntity(
        id = id, type = "task", key = "T-$id", num = id, parentId = 1, title = title, description = "", ownerId = null,
        assigneeId = null, status = "todo", startDate = null, startFirm = false, endDate = null, endFirm = false,
        urgency = 5, importance = 5, blocked = false, color = "", sortOrder = 0, createdAt = "", updatedAt = "",
        closedAt = null, blockedBy = "[]", blocks = "[]",
    )

    private fun connect() {
        api = PlannerApi(PlannerApi.parseBaseUrl(server.url("/").toString())!!)
    }

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, PlannerDatabase::class.java).allowMainThreadQueries().build()
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests.add(request)
                val path = request.path ?: ""
                val json = MockResponse().setHeader("Content-Type", "application/json")
                return when {
                    path == "/api/version" -> json.setBody("""{"version":"9.9.9","date":"d","build":"b"}""")
                    path == "/api/users" && request.method == "GET" -> json.setBody("""[{"id":1,"name":"Evan","color":"#4e79a7","short":"EL","created_at":"c"}]""")
                    path == "/api/settings" -> json.setBody("""{"week_start":"6"}""")
                    path == "/api/items" && request.method == "GET" ->
                        json.setBody(items.entries.joinToString(",", "[", "]") { itemJson(it.key, it.value) })
                    path == "/api/items" && request.method == "POST" -> {
                        val body = request.body.readUtf8()
                        val title = Regex("\"title\":\"([^\"]*)\"").find(body)!!.groupValues[1]
                        val id = nextId++
                        items[id] = title
                        json.setResponseCode(201).setBody(itemJson(id, title))
                    }
                    path.startsWith("/api/items/") && request.method == "PATCH" -> {
                        val id = path.removePrefix("/api/items/").toLong()
                        if (id !in items) return json.setResponseCode(404).setBody("""{"error":"not found"}""")
                        val body = request.body.readUtf8()
                        Regex("\"title\":\"([^\"]*)\"").find(body)?.let { items[id] = it.groupValues[1] }
                        json.setBody(itemJson(id, items[id]!!))
                    }
                    path == "/api/dependencies" -> MockResponse().setResponseCode(204)
                    path == "/api/scratch" || Regex("/api/users/\\d+/scratch").matches(path) -> {
                        val scope = if (path == "/api/scratch") "global" else "user:" + path.removePrefix("/api/users/").removeSuffix("/scratch")
                        if (request.method == "PUT") {
                            val text = Json.parseToJsonElement(request.body.readUtf8()).jsonObject["text"]!!.jsonPrimitive.content
                            scratch[scope] = text
                            scratchStamp++
                        }
                        json.setBody(scratchJson(scope))
                    }
                    else -> json.setResponseCode(404).setBody("""{"error":"not found"}""")
                }
            }
        }
        server.start()
        connect()
        engine = SyncEngine(db, { api })
        scope = CoroutineScope(Dispatchers.Unconfined + Job())
        val scheduler = SyncScheduler(context, engine, scope)
        repo = PlannerRepository(db, engine, scheduler, Outbox(context), context.cacheDir, { api })
    }

    @After
    fun tearDown() {
        scope.cancel()
        server.shutdown()
        db.close()
    }

    @Test
    fun offlineCreateThenSyncRemapsTheTemporaryId() = runBlocking {
        api = null // offline: the repository still records everything
        val localId = repo.createItem(ItemType.TASK, "Clean vents", parentId = 1, status = Status.TODO)
        assertTrue(localId < 0)
        assertEquals("…", db.items().get(localId)!!.key)
        repo.patchItem(localId, ItemPatch(title = set("Clean the vents")))
        assertEquals(2, db.pendingOps().count())
        assertEquals(SyncResult.NotConfigured, engine.sync())

        connect()
        assertEquals(SyncResult.Done, engine.sync())

        assertEquals(0, db.pendingOps().count())
        assertNull(db.items().get(localId))
        val synced = db.items().get(100)!!
        assertEquals("Clean the vents", synced.title)
        assertEquals("T-100", synced.key)
        assertEquals(100L, engine.remappedIds.value[localId]) // open screens follow the new id through this
        // The queued patch went to the real id, not the temporary one.
        assertTrue(requests.any { it.method == "PATCH" && it.path == "/api/items/100" })
        assertEquals(SyncPhase.IDLE, engine.state.value.phase)
    }

    @Test
    fun clientErrorDropsOneOpAndIsLogged() = runBlocking {
        // 555 exists locally but was deleted on the server: its edit is refused (404) and dropped.
        db.items().insertAll(listOf(entity(555, "Ghost"), entity(7, "Real")))
        items[7] = "Real"
        repo.patchItem(555, ItemPatch(title = set("still here?")))
        repo.patchItem(7, ItemPatch(title = set("Renamed")))

        assertEquals(SyncResult.Done, engine.sync())
        assertEquals(0, db.pendingOps().count())
        val log = db.syncLog().observeRecent().first()
        assertEquals(1, log.size)
        assertTrue(log[0].summary.contains("edit item 555"))
        assertEquals("Renamed", items[7])
        // The pull afterwards reconciled: the ghost is gone locally too.
        assertNull(db.items().get(555))
    }

    @Test
    fun networkFailureKeepsTheQueue() = runBlocking {
        db.items().insertAll(listOf(entity(1, "One")))
        repo.patchItem(1, ItemPatch(title = set("x")))
        server.shutdown()
        val result = engine.sync()
        assertTrue(result is SyncResult.Offline)
        assertEquals(1, db.pendingOps().count())
        assertEquals(SyncPhase.OFFLINE, engine.state.value.phase)
        assertEquals("x", db.items().get(1)!!.title) // the optimistic edit stays
    }

    @Test
    fun scratchEditsCollapseIntoOneOpPerPadAndPushTheLastText() = runBlocking {
        api = null // typing offline
        repo.saveScratch(ScratchScope.GLOBAL, "a")
        repo.saveScratch(ScratchScope.GLOBAL, "ab")
        repo.saveScratch(ScratchScope.user(1), "mine")
        repo.saveScratch(ScratchScope.GLOBAL, "abc")
        assertEquals(2, db.pendingOps().count())
        assertEquals("abc", db.scratch().get("global")!!.text)
        assertEquals("", db.scratch().get("global")!!.updatedAt) // no server stamp yet
        assertTrue(repo.scratchQueued("global").first())

        connect()
        assertEquals(SyncResult.Done, engine.sync())
        assertEquals(0, db.pendingOps().count())
        val puts = requests.filter { it.method == "PUT" && it.path!!.endsWith("scratch") }
        assertEquals(listOf("/api/scratch", "/api/users/1/scratch"), puts.map { it.path })
        assertEquals("abc", scratch["global"])
        assertEquals("mine", scratch["user:1"])
        assertTrue(db.scratch().get("global")!!.updatedAt.isNotBlank())
        assertEquals(false, repo.scratchQueued("global").first())
    }

    @Test
    fun refreshKeepsAQueuedEditAndThePullTakesTheServerText() = runBlocking {
        scratch["global"] = "from server"
        api = null
        repo.saveScratch("global", "typed offline")
        connect()
        assertNull(repo.refreshScratch("global")) // answered, but the queued edit is the newer text
        assertEquals("typed offline", db.scratch().get("global")!!.text)

        assertEquals(SyncResult.Done, engine.sync())
        assertEquals("typed offline", scratch["global"])
        // Written elsewhere since: the next pull brings it into the cache.
        scratch["global"] = "edited elsewhere"
        assertEquals(SyncResult.Done, engine.sync())
        assertEquals("edited elsewhere", db.scratch().get("global")!!.text)
    }

    @Test
    fun refreshScratchFillsTheCacheAndReportsBeingOffline() = runBlocking {
        scratch["user:1"] = "notes"
        assertNull(repo.refreshScratch("user:1"))
        assertEquals("notes", db.scratch().get("user:1")!!.text)
        // The pull refreshes every pad shown so far, and the shared one always.
        assertEquals(SyncResult.Done, engine.sync())
        assertEquals(setOf("global", "user:1"), db.scratch().scopes().toSet())

        server.shutdown()
        assertTrue(repo.refreshScratch("user:1") is IOException)
        assertEquals("notes", db.scratch().get("user:1")!!.text)
    }

    @Test
    fun pullReplacesLocalTables() = runBlocking {
        db.items().insertAll(listOf(entity(9, "Stale local")))
        items[3] = "From server"
        assertEquals(SyncResult.Done, engine.sync())
        assertEquals(listOf("From server"), db.items().live().map { it.title })
        assertEquals("Evan", db.users().all().single().name)
        assertEquals("6", db.settings().all().single { it.key == "week_start" }.value)
        assertEquals("9.9.9", engine.state.value.serverVersion)
    }
}
