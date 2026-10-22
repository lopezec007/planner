// The state behind one scratch pad's text field, owned by the ViewModel so
// a save still lands after the screen is left. It mirrors the web's
// scratch.js: the field shows the cached text; typing marks it dirty and
// saves (through the repository, so the queue) about a second after the
// last keystroke, on blur and on leaving the screen; a text that arrives
// from the server (the cache changing underneath) replaces the field only
// while it is neither focused nor dirty, otherwise it waits for the blur,
// and a local edit made meanwhile wins (last writer wins, as on the server).
package io.github.lopezec007.planner.ui.scratch

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.lopezec007.planner.data.repo.PlannerRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.coroutines.coroutineContext

class ScratchEditor(
    val scope: String,
    private val repo: PlannerRepository,
    private val coroutineScope: CoroutineScope,
    private val saveDelayMs: Long = SAVE_DELAY_MS,
) {
    /** What the field shows. */
    var text by mutableStateOf("")
        private set

    /** Typed but not yet handed to the repository. */
    var dirty by mutableStateOf(false)
        private set

    /** The server's stamp of the cached text ("" until it has one). */
    var updatedAt by mutableStateOf("")
        private set

    /** Null until the cache has answered once (the pad may legitimately be empty). */
    var loaded by mutableStateOf(false)
        private set

    private var focused = false

    /** A cached text that arrived while the field was focused: applied on blur unless typing happened. */
    private var waiting: String? = null

    private var saveJob: Job? = null

    init {
        coroutineScope.launch {
            repo.scratch(scope).collect { s ->
                loaded = true
                updatedAt = s?.updatedAt ?: ""
                onCached(s?.text ?: "")
            }
        }
    }

    private fun onCached(t: String) {
        when {
            t == text -> waiting = null
            dirty || focused -> waiting = t
            else -> text = t
        }
    }

    fun onTyped(t: String) {
        if (t == text) return
        text = t
        dirty = true
        waiting = null   // the user's text is the newer one
        saveJob?.cancel()
        saveJob = coroutineScope.launch {
            delay(saveDelayMs)
            flush()
        }
    }

    fun onFocus(f: Boolean) {
        focused = f
        if (f) return
        if (dirty) {
            coroutineScope.launch { flush() }
        } else {
            waiting?.let { text = it }
            waiting = null
        }
    }

    /** Saves now when there is anything unsaved. */
    suspend fun flush() {
        // The debounce coroutine calls this too: it must not cancel itself.
        val me = coroutineContext[Job]
        saveJob?.let { if (it !== me) it.cancel() }
        saveJob = null
        if (!dirty) return
        dirty = false
        repo.saveScratch(scope, text)
    }

    companion object {
        const val SAVE_DELAY_MS = 1_000L
    }
}
