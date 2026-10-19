// The attachments of an item (spec "Attachments", README "Offline
// tolerance"): a row per file that opens it in the system viewer (bytes
// fetched into the cache on first tap), a ✕ with Undo, and File / Photo /
// Camera buttons that copy the pick into the outbox and queue the upload.
// The camera is the system camera app via TakePicture; no CAMERA permission
// of ours is involved.
package io.github.lopezec007.planner.ui.detail

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.lopezec007.planner.data.model.Attachment
import io.github.lopezec007.planner.ui.PlannerViewModel
import io.github.lopezec007.planner.ui.theme.LocalPalette
import kotlinx.coroutines.launch
import java.io.File
import java.io.IOException
import java.util.Locale

@Composable
internal fun AttachmentsSection(itemId: Long, attachments: List<Attachment>, vm: PlannerViewModel, snackbar: SnackbarHostState) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // Copies each pick into the outbox and queues it; nothing waits for the network.
    fun importAll(uris: List<Uri>) {
        if (uris.isEmpty()) return
        scope.launch {
            var failed = 0
            for (uri in uris) {
                try {
                    val f = vm.outbox.importUri(uri)
                    vm.repo.attach(itemId, f)
                } catch (_: IOException) {
                    failed++
                } catch (_: SecurityException) {
                    failed++
                }
            }
            if (failed > 0) snackbar.showSnackbar(if (failed == 1) "One file could not be read" else "$failed files could not be read")
        }
    }

    val fileLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        importAll(uris)
    }
    val photoLauncher = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { uris ->
        importAll(uris)
    }

    // The camera's target file, kept across the activity result (and a process restart while the camera is up).
    var cameraPath by rememberSaveable { mutableStateOf("") }
    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        val path = cameraPath
        cameraPath = ""
        if (path.isEmpty()) return@rememberLauncherForActivityResult
        val file = File(path)
        if (saved) {
            scope.launch {
                val f = vm.outbox.captured(file)
                if (f != null) vm.repo.attach(itemId, f) else snackbar.showSnackbar("The camera saved nothing")
            }
        } else {
            file.delete()
        }
    }
    val hasCamera = remember(context) {
        context.packageManager.resolveActivity(
            Intent(MediaStore.ACTION_IMAGE_CAPTURE),
            PackageManager.ResolveInfoFlags.of(0L),
        ) != null
    }

    fun openAttachment(a: Attachment) {
        scope.launch {
            try {
                val f = vm.repo.attachmentFile(a)
                val intent = Intent(Intent.ACTION_VIEW)
                    .setDataAndType(vm.repo.shareUri(f), a.contentType.ifBlank { "*/*" })
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                context.startActivity(intent)
            } catch (_: ActivityNotFoundException) {
                snackbar.showSnackbar("No app can open this file")
            } catch (_: IOException) {
                snackbar.showSnackbar("Could not download (offline?)")
            } catch (_: IllegalStateException) {
                snackbar.showSnackbar("Could not download (no server configured)")
            }
        }
    }

    fun removeAttachment(a: Attachment) {
        scope.launch {
            vm.repo.deleteAttachment(a.id)
            if (a.pending || a.id < 0) {
                // A queued upload is simply dropped; there is nothing on the server to restore.
                snackbar.showSnackbar("Removed ${a.name}")
            } else {
                val result = snackbar.showSnackbar(
                    message = "Removed ${a.name}",
                    actionLabel = "Undo",
                    withDismissAction = true,
                    duration = SnackbarDuration.Long,
                )
                if (result == SnackbarResult.ActionPerformed) vm.repo.restoreAttachment(a.id)
            }
        }
    }

    fun launchCamera() {
        val (file, uri) = vm.outbox.cameraTarget()
        cameraPath = file.absolutePath
        try {
            cameraLauncher.launch(uri)
        } catch (_: ActivityNotFoundException) {
            cameraPath = ""
            file.delete()
            scope.launch { snackbar.showSnackbar("No camera app") }
        }
    }

    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.AttachFile, contentDescription = null, tint = LocalPalette.current.subtle)
            Spacer(Modifier.width(12.dp))
            Text("Attachments", style = MaterialTheme.typography.titleSmall)
        }
        if (attachments.isEmpty()) {
            Text(
                "None",
                style = MaterialTheme.typography.bodySmall,
                color = LocalPalette.current.subtle,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        for (a in attachments) {
            AttachmentRow(a, onOpen = { openAttachment(a) }, onRemove = { removeAttachment(a) })
        }
        Spacer(Modifier.height(4.dp))
        AddButtons(
            hasCamera = hasCamera,
            onFile = { fileLauncher.launch(arrayOf("*/*")) },
            onPhoto = { photoLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) },
            onCamera = { launchCamera() },
        )
    }
}

@Composable
private fun AttachmentRow(a: Attachment, onOpen: () -> Unit, onRemove: () -> Unit) {
    val isImage = a.contentType.startsWith("image/")
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            if (isImage) Icons.Filled.Image else Icons.Filled.AttachFile,
            contentDescription = null,
            tint = LocalPalette.current.subtle,
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(a.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
            Text(
                formatSize(a.size) + if (a.pending) "  ·  pending upload" else "",
                style = MaterialTheme.typography.bodySmall,
                color = LocalPalette.current.subtle,
            )
        }
        IconButton(onClick = onRemove) { Icon(Icons.Filled.Close, contentDescription = "Remove ${a.name}") }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AddButtons(hasCamera: Boolean, onFile: () -> Unit, onPhoto: () -> Unit, onCamera: () -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        AssistChip(
            onClick = onFile,
            label = { Text("File") },
            leadingIcon = { Icon(Icons.Filled.AttachFile, contentDescription = null) },
        )
        AssistChip(
            onClick = onPhoto,
            label = { Text("Photo") },
            leadingIcon = { Icon(Icons.Filled.Image, contentDescription = null) },
        )
        if (hasCamera) {
            AssistChip(
                onClick = onCamera,
                label = { Text("Camera") },
                leadingIcon = { Icon(Icons.Filled.PhotoCamera, contentDescription = null) },
            )
        }
    }
}

/** "812 B", "24 KB", "3.5 MB", "1.20 GB". */
internal fun formatSize(bytes: Long): String {
    val kb = 1024.0
    val mb = kb * 1024
    val gb = mb * 1024
    return when {
        bytes < 1024 -> "$bytes B"
        bytes < mb -> String.format(Locale.US, "%.0f KB", bytes / kb)
        bytes < gb -> String.format(Locale.US, "%.1f MB", bytes / mb)
        else -> String.format(Locale.US, "%.2f GB", bytes / gb)
    }
}
