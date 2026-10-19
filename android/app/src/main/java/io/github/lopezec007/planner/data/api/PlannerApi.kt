// The server's JSON API over OkHttp. Every network request of the app goes
// through here, to the one base URL the user configured (README: "Network
// policy"). Network failures surface as IOException, HTTP errors as
// ApiException; callers decide what is retryable.
package io.github.lopezec007.planner.data.api

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/** An HTTP error answer: [code] and the server's "error" message. */
class ApiException(val code: Int, message: String) : Exception(message) {
    /** 4xx: the request itself is wrong and will not succeed on retry. */
    val isClientError get() = code in 400..499
}

class PlannerApi(val baseUrl: HttpUrl, client: OkHttpClient? = null) {
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private val client: OkHttpClient = client ?: OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    /** A client with short timeouts for the reachability probe. */
    private val probeClient: OkHttpClient by lazy {
        this.client.newBuilder()
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(3, TimeUnit.SECONDS)
            .build()
    }

    companion object {
        /**
         * Builds the base URL from what the user typed: "10.0.0.2:8080",
         * "http://planner.lan/", "planner:8080". Returns null when it cannot
         * be parsed. Only http and https are accepted.
         */
        fun parseBaseUrl(text: String): HttpUrl? {
            var s = text.trim().trimEnd('/')
            if (s.isEmpty()) return null
            if (!s.contains("://")) s = "http://$s"
            val url = s.toHttpUrlOrNull() ?: return null
            if (url.scheme != "http" && url.scheme != "https") return null
            return url.newBuilder().addPathSegment("").build() // trailing slash
        }
    }

    private fun url(vararg segments: String, query: Map<String, String> = emptyMap()): HttpUrl {
        val b = baseUrl.newBuilder().addPathSegment("api")
        for (s in segments) b.addPathSegment(s)
        for ((k, v) in query) b.addQueryParameter(k, v)
        return b.build()
    }

    private fun jsonBody(obj: JsonObject): RequestBody = obj.toString().toRequestBody(jsonType)

    private suspend fun exec(req: Request, client: OkHttpClient = this.client): Response = withContext(Dispatchers.IO) {
        val res = client.newCall(req).execute()
        if (!res.isSuccessful) {
            val body = try { res.body?.string().orEmpty() } catch (_: IOException) { "" }
            res.close()
            val msg = try {
                json.decodeFromString<ErrorDto>(body).error.ifBlank { "HTTP ${res.code}" }
            } catch (_: Exception) {
                "HTTP ${res.code}"
            }
            throw ApiException(res.code, msg)
        }
        res
    }

    private suspend inline fun <reified T> call(req: Request): T {
        val res = exec(req)
        return withContext(Dispatchers.IO) {
            res.use { r ->
                val text = r.body?.string().orEmpty()
                json.decodeFromString<T>(text)
            }
        }
    }

    private suspend fun callUnit(req: Request) {
        exec(req).close()
    }

    // ---- reachability

    /** GET /api/version with short timeouts; throws IOException when the server cannot be seen. */
    suspend fun probe(): VersionDto {
        val res = exec(Request.Builder().url(url("version")).get().build(), probeClient)
        return withContext(Dispatchers.IO) { res.use { json.decodeFromString<VersionDto>(it.body?.string().orEmpty()) } }
    }

    // ---- users

    suspend fun listUsers(): List<UserDto> = call(Request.Builder().url(url("users")).get().build())

    suspend fun createUser(body: JsonObject): UserDto =
        call(Request.Builder().url(url("users")).post(jsonBody(body)).build())

    suspend fun updateUser(id: Long, body: JsonObject): UserDto =
        call(Request.Builder().url(url("users", id.toString())).patch(jsonBody(body)).build())

    suspend fun deleteUser(id: Long) =
        callUnit(Request.Builder().url(url("users", id.toString())).delete().build())

    // ---- items

    suspend fun listItems(): List<ItemDto> = call(Request.Builder().url(url("items")).get().build())

    suspend fun getItem(id: Long): ItemDto = call(Request.Builder().url(url("items", id.toString())).get().build())

    suspend fun createItem(body: JsonObject): ItemDto =
        call(Request.Builder().url(url("items")).post(jsonBody(body)).build())

    suspend fun updateItem(id: Long, body: JsonObject): ItemDto =
        call(Request.Builder().url(url("items", id.toString())).patch(jsonBody(body)).build())

    suspend fun deleteItem(id: Long) =
        callUnit(Request.Builder().url(url("items", id.toString())).delete().build())

    suspend fun restoreItem(id: Long): ItemDto =
        call(Request.Builder().url(url("items", id.toString(), "restore")).post(ByteArray(0).toRequestBody(null)).build())

    suspend fun history(id: Long): List<StatusChangeDto> =
        call(Request.Builder().url(url("items", id.toString(), "history")).get().build())

    suspend fun reorder(ids: List<Long>) {
        val body = buildJsonObject { put("ids", JsonArray(ids.map { JsonPrimitive(it) })) }
        callUnit(Request.Builder().url(url("order")).put(jsonBody(body)).build())
    }

    // ---- dependencies

    suspend fun addDependency(blockerId: Long, blockedId: Long) {
        val body = buildJsonObject { put("blocker_id", blockerId); put("blocked_id", blockedId) }
        callUnit(Request.Builder().url(url("dependencies")).post(jsonBody(body)).build())
    }

    suspend fun removeDependency(blockerId: Long, blockedId: Long) =
        callUnit(Request.Builder().url(url("dependencies", blockerId.toString(), blockedId.toString())).delete().build())

    // ---- settings

    suspend fun settings(): Map<String, String> = call(Request.Builder().url(url("settings")).get().build())

    suspend fun updateSettings(values: Map<String, String>): Map<String, String> {
        val body = buildJsonObject { for ((k, v) in values) put(k, v) }
        return call(Request.Builder().url(url("settings")).patch(jsonBody(body)).build())
    }

    // ---- attachments

    suspend fun listAttachments(itemId: Long): List<AttachmentDto> =
        call(Request.Builder().url(url("items", itemId.toString(), "attachments")).get().build())

    /** Uploads one file as a "file" part; the server answers with the created metadata. */
    suspend fun uploadAttachment(itemId: Long, file: File, name: String, contentType: String): List<AttachmentDto> {
        val type = (contentType.ifBlank { "application/octet-stream" }).toMediaType()
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", name, file.asRequestBody(type))
            .build()
        return call(Request.Builder().url(url("items", itemId.toString(), "attachments")).post(body).build())
    }

    /** Streams the attachment's bytes into [dest] (replacing it). */
    suspend fun downloadAttachment(id: Long, dest: File) {
        val res = exec(Request.Builder().url(url("attachments", id.toString())).get().build())
        withContext(Dispatchers.IO) {
            res.use { r ->
                val tmp = File(dest.parentFile, dest.name + ".part")
                r.body!!.byteStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
                if (!tmp.renameTo(dest)) {
                    dest.delete()
                    tmp.renameTo(dest)
                }
            }
        }
    }

    suspend fun deleteAttachment(id: Long) =
        callUnit(Request.Builder().url(url("attachments", id.toString())).delete().build())

    suspend fun restoreAttachment(id: Long): AttachmentDto =
        call(Request.Builder().url(url("attachments", id.toString(), "restore")).post(ByteArray(0).toRequestBody(null)).build())

    // ---- prefs (unused by the phone UI, kept for completeness)

    suspend fun userPrefs(id: Long): Map<String, String> =
        call(Request.Builder().url(url("users", id.toString(), "prefs")).get().build())
}

/** Reads a string field of a JSON object, or null. */
fun JsonObject.string(key: String): String? = this[key]?.let { el ->
    if (el is JsonPrimitive && el.isString) el.content else null
}

internal fun JsonObject.obj(key: String): JsonObject? = this[key]?.let { it as? JsonObject }?.jsonObject
internal fun JsonObject.long(key: String): Long? = this[key]?.let { (it as? JsonPrimitive)?.jsonPrimitive?.content?.toLongOrNull() }
