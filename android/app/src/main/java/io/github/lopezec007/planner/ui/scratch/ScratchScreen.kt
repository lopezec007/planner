// The scratch pads: two plain-text notes, "Shared" (everyone sees and edits
// the same text) and the account's own, as tabs. Each is a monospaced
// field filling the screen; Wrap (a phone preference) folds long lines or
// lets them scroll sideways. The text comes from the Room cache at once;
// the server is asked on opening and with the Refresh action; edits save
// through the queue (ScratchEditor), so the pads work offline like the
// rest of the app.
package io.github.lopezec007.planner.ui.scratch

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.WrapText
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.lopezec007.planner.data.model.ScratchScope
import io.github.lopezec007.planner.ui.PlannerViewModel
import io.github.lopezec007.planner.ui.nav.Nav
import io.github.lopezec007.planner.ui.theme.LocalPalette
import kotlinx.coroutines.launch
import java.io.IOException
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScratchScreen(vm: PlannerViewModel, nav: Nav) {
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    val p = prefs ?: return
    val snap by vm.snapshot.collectAsStateWithLifecycle()
    val account = p.accountId?.let { snap.user(it) }
    val userScope = p.accountId?.let { ScratchScope.user(it) }
    val coroutineScope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }

    /** Pushes what is queued and fetches both pads; [report] tells the user when the server could not be reached. */
    fun refresh(report: Boolean) {
        if (refreshing) return
        refreshing = true
        coroutineScope.launch {
            vm.requestSync()
            val errors = listOfNotNull(ScratchScope.GLOBAL, userScope).mapNotNull { vm.repo.refreshScratch(it) }
            refreshing = false
            val e = errors.firstOrNull() ?: return@launch
            if (report) {
                snackbar.showSnackbar(
                    if (e is IOException) "Server not reachable — showing the text saved on this phone" else "Could not refresh: ${e.message}",
                )
            }
        }
    }

    LaunchedEffect(userScope) { refresh(report = false) }
    // Leaving the screen saves what is typed but not saved yet.
    DisposableEffect(Unit) { onDispose { vm.flushScratch() } }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Scratch pad") },
                navigationIcon = {
                    IconButton(onClick = { nav.pop() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    IconToggleButton(checked = p.scratchWrap, onCheckedChange = { vm.setScratchWrap(it) }) {
                        Icon(
                            Icons.AutoMirrored.Filled.WrapText,
                            contentDescription = if (p.scratchWrap) "Wrap lines (on)" else "Wrap lines (off)",
                            tint = if (p.scratchWrap) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(onClick = { refresh(report = true) }, enabled = !refreshing) { Icon(Icons.Filled.Refresh, "Refresh") }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            PrimaryTabRow(selectedTabIndex = tab) {
                Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Shared") })
                Tab(
                    selected = tab == 1,
                    onClick = { tab = 1 },
                    text = { Text(account?.name ?: "No account", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                )
            }
            when {
                tab == 0 -> Pad(vm, ScratchScope.GLOBAL, p.scratchWrap)
                userScope != null -> Pad(vm, userScope, p.scratchWrap)
                else -> Box(Modifier.fillMaxSize().padding(32.dp)) {
                    Text(
                        "Choose an account in Settings to get a pad of your own.",
                        style = MaterialTheme.typography.bodyLarge,
                        color = LocalPalette.current.subtle,
                    )
                }
            }
        }
    }
}

/** One pad: a status line and the text field, filling the rest of the screen. */
@Composable
private fun Pad(vm: PlannerViewModel, scope: String, wrap: Boolean) {
    val editor = remember(scope) { vm.scratchEditor(scope) }
    val queued by remember(scope) { vm.repo.scratchQueued(scope) }.collectAsStateWithLifecycle(initialValue = false)
    val palette = LocalPalette.current

    val status = when {
        editor.dirty -> "Editing…"
        queued -> "Saved on this phone — waiting for the server"
        !editor.loaded -> ""
        editor.updatedAt.isNotBlank() -> "Synced ${localTime(editor.updatedAt)}"
        else -> "Not written yet"
    }
    Text(
        status,
        style = MaterialTheme.typography.labelSmall,
        color = palette.subtle,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
    )

    // The field is at least as big as the viewport, so a tap anywhere
    // focuses it; it grows with the text and the Box scrolls. Without Wrap
    // the width is unbounded and lines run sideways.
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val minWidth = maxWidth
        val minHeight = maxHeight
        val vertical = rememberScrollState()
        val horizontal = rememberScrollState()
        Box(
            Modifier
                .fillMaxSize()
                .verticalScroll(vertical)
                .then(if (wrap) Modifier else Modifier.horizontalScroll(horizontal)),
        ) {
            BasicTextField(
                value = editor.text,
                onValueChange = { editor.onTyped(it) },
                textStyle = TextStyle(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                modifier = Modifier
                    .defaultMinSize(minWidth = minWidth, minHeight = minHeight)
                    .padding(12.dp)
                    .onFocusChanged { editor.onFocus(it.isFocused) },
                decorationBox = { inner ->
                    Box {
                        if (editor.text.isEmpty()) {
                            Text(
                                "Notes…",
                                style = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 14.sp, lineHeight = 20.sp),
                                color = palette.subtle,
                            )
                        }
                        inner()
                    }
                },
            )
        }
    }
}

private val timeFormat: DateTimeFormatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)

/** The server's RFC 3339 stamp in local time; the raw string when it cannot be parsed. */
private fun localTime(stamp: String): String =
    runCatching { timeFormat.format(OffsetDateTime.parse(stamp).atZoneSameInstant(ZoneId.systemDefault())) }.getOrDefault(stamp)
