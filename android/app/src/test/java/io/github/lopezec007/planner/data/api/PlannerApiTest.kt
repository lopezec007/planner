package io.github.lopezec007.planner.data.api

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class PlannerApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: PlannerApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = PlannerApi(PlannerApi.parseBaseUrl(server.url("/").toString())!!)
    }

    @After
    fun tearDown() = server.shutdown()

    @Test
    fun parsesLooseAddresses() {
        assertEquals("http://10.8.0.1:8080/", PlannerApi.parseBaseUrl("10.8.0.1:8080").toString())
        assertEquals("http://planner.lan:8080/", PlannerApi.parseBaseUrl(" planner.lan:8080/ ").toString())
        assertEquals("https://x.example/", PlannerApi.parseBaseUrl("https://x.example").toString())
        assertNull(PlannerApi.parseBaseUrl(""))
        assertNull(PlannerApi.parseBaseUrl("ftp://x"))
    }

    @Test
    fun listsItemsAndTolerantOfUnknownFields() = runBlocking {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "application/json").setBody(
                """[{"id":3,"type":"task","key":"T-1","num":1,"parent_id":1,"title":"Clean","description":"",
                     "owner_id":1,"assignee_id":null,"status":"todo","start_date":"2026-10-20","start_firm":false,
                     "end_date":null,"end_firm":false,"urgency":7,"importance":8,"blocked":false,"color":"",
                     "sort_order":1,"created_at":"x","updated_at":"y","closed_at":null,"blocked_by":[],"blocks":[4],
                     "attachments":[{"id":9,"item_id":3,"name":"a.pdf","content_type":"application/pdf","size":12,"created_at":"z"}],
                     "something_new":true}]""",
            ),
        )
        val items = api.listItems()
        assertEquals(1, items.size)
        assertEquals("T-1", items[0].key)
        assertEquals(listOf(4L), items[0].blocks)
        assertEquals("a.pdf", items[0].attachments.single().name)
        assertEquals("/api/items", server.takeRequest().path)
    }

    @Test
    fun patchSendsNullToClearAndSurfacesErrors() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"parent_id cannot be null"}"""))
        try {
            api.updateItem(3, buildJsonObject { put("title", "x"); put("end_date", kotlinx.serialization.json.JsonNull) })
            fail("expected ApiException")
        } catch (e: ApiException) {
            assertEquals(400, e.code)
            assertTrue(e.isClientError)
            assertEquals("parent_id cannot be null", e.message)
        }
        val req = server.takeRequest()
        assertEquals("PATCH", req.method)
        assertEquals("/api/items/3", req.path)
        assertEquals("""{"title":"x","end_date":null}""", req.body.readUtf8())
    }

    @Test
    fun reorderAndDependencyBodies() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(204))
        server.enqueue(MockResponse().setResponseCode(204))
        api.reorder(listOf(5, 2))
        api.addDependency(1, 2)
        assertEquals("""{"ids":[5,2]}""", server.takeRequest().body.readUtf8())
        assertEquals("""{"blocker_id":1,"blocked_id":2}""", server.takeRequest().body.readUtf8())
    }
}
