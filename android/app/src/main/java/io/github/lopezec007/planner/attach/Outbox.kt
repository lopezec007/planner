// Files waiting to be uploaded, and the camera's target file. Everything
// lives under filesDir/outbox so a queued upload survives a restart; the
// sync engine deletes each file once the server has it.
package io.github.lopezec007.planner.attach

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class OutboxFile(val file: File, val name: String, val contentType: String, val size: Long)

class Outbox(private val context: Context) {
    private val dir: File get() = File(context.filesDir, "outbox").apply { mkdirs() }

    private val authority get() = "${context.packageName}.files"

    /** Copies a picked document or photo into the outbox; throws IOException when it cannot be read. */
    suspend fun importUri(uri: Uri): OutboxFile = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val name = displayName(resolver, uri) ?: "file"
        val type = resolver.getType(uri)?.takeIf { it.isNotBlank() && it != "application/octet-stream" }
            ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
            ?: "application/octet-stream"
        val dest = unique(name)
        resolver.openInputStream(uri)?.use { input -> dest.outputStream().use { input.copyTo(it) } }
            ?: throw IOException("cannot open $uri")
        OutboxFile(dest, name, type, dest.length())
    }

    /** A fresh JPEG target for the camera, plus the content URI to hand to it. */
    fun cameraTarget(): Pair<File, Uri> {
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
        val file = unique("photo-$stamp.jpg")
        return file to FileProvider.getUriForFile(context, authority, file)
    }

    /** Wraps a finished camera capture as an outbox file (null when the camera wrote nothing). */
    fun captured(file: File): OutboxFile? {
        if (!file.exists() || file.length() == 0L) {
            file.delete()
            return null
        }
        return OutboxFile(file, file.name, "image/jpeg", file.length())
    }

    /** A content URI for a file in the outbox or the attachment cache, for the system viewer. */
    fun shareUri(file: File): Uri = FileProvider.getUriForFile(context, authority, file)

    private fun unique(name: String): File {
        val safe = name.replace(Regex("[/\\\\\u0000]"), "_").ifBlank { "file" }
        var f = File(dir, safe)
        var n = 1
        while (f.exists()) {
            val dot = safe.lastIndexOf('.')
            f = if (dot > 0) File(dir, "${safe.substring(0, dot)}-$n${safe.substring(dot)}") else File(dir, "$safe-$n")
            n++
        }
        return f
    }

    private fun displayName(resolver: ContentResolver, uri: Uri): String? {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (i >= 0) c.getString(i)?.let { return it }
            }
        }
        return uri.lastPathSegment?.substringAfterLast('/')
    }
}
