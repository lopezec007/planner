// Markdown rendering through Markwon (a TextView inside Compose). Only the
// core, strikethrough, task-list and table plugins are installed: no image
// plugin, so nothing in a description can make the app fetch a URL.
package io.github.lopezec007.planner.ui.components

import android.widget.TextView
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import io.github.lopezec007.planner.ui.theme.LocalPalette
import io.noties.markwon.Markwon
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tasklist.TaskListPlugin

@Composable
fun MarkdownText(markdown: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val textColor = MaterialTheme.colorScheme.onSurface.toArgb()
    val linkColor = LocalPalette.current.accent.toArgb()
    val textSizeSp = MaterialTheme.typography.bodyMedium.fontSize.value
    val markwon = remember(context) {
        Markwon.builder(context)
            .usePlugin(StrikethroughPlugin.create())
            .usePlugin(TaskListPlugin.create(context))
            .usePlugin(TablePlugin.create(context))
            .build()
    }
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            TextView(ctx).apply {
                setTextColor(textColor)
                setLinkTextColor(linkColor)
                textSize = textSizeSp
                setTextIsSelectable(true)
            }
        },
        update = { tv ->
            tv.setTextColor(textColor)
            tv.setLinkTextColor(linkColor)
            markwon.setMarkdown(tv, markdown)
        },
    )
}
