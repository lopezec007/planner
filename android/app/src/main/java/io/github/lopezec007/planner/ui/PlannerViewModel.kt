// The one ViewModel shared by every screen: the repository snapshot, the
// phone preferences and the sync state as StateFlows, plus the preference
// setters. Screens call the repository directly for data changes.
package io.github.lopezec007.planner.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import io.github.lopezec007.planner.Graph
import io.github.lopezec007.planner.attach.Outbox
import io.github.lopezec007.planner.data.model.ColorMode
import io.github.lopezec007.planner.data.model.Criteria
import io.github.lopezec007.planner.data.model.Group
import io.github.lopezec007.planner.data.repo.PlannerRepository
import io.github.lopezec007.planner.data.repo.Snapshot
import io.github.lopezec007.planner.data.sync.SyncState
import io.github.lopezec007.planner.prefs.AppPrefs
import io.github.lopezec007.planner.prefs.Prefs
import io.github.lopezec007.planner.prefs.View
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class PlannerViewModel(val graph: Graph) : ViewModel() {
    val repo: PlannerRepository get() = graph.repo
    val outbox: Outbox get() = graph.outbox
    private val prefsStore: Prefs get() = graph.prefs

    val snapshot: StateFlow<Snapshot> = repo.snapshot
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), Snapshot.EMPTY)

    /** Null until DataStore has been read once (so Setup is not flashed on a configured app). */
    val prefs: StateFlow<AppPrefs?> = prefsStore.flow
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    val sync: StateFlow<SyncState> = repo.syncState

    /** The search text lives here, not in the stored criteria (as in the web UI). */
    val searchText = MutableStateFlow("")

    /** Items created in this session stay visible even when the filters would hide them. */
    private val pinned = MutableStateFlow<Set<Long>>(emptySet())
    fun pin(id: Long) { pinned.value = pinned.value + id }

    /** The groups after search and filters, in display order. */
    val visibleGroups: StateFlow<List<Group>> = combine(snapshot, prefs, searchText, pinned) { snap, p, text, pins ->
        val c = (p?.criteria ?: Criteria()).copy(text = text)
        c.apply(snap.groups, { snap.itemsById[it] }, pins)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    // ---- preference setters

    fun setView(v: View) = viewModelScope.launch { prefsStore.setView(v) }
    fun setFlat(flat: Boolean) = viewModelScope.launch { prefsStore.setFlat(flat) }
    fun setCriteria(c: Criteria) {
        pinned.value = emptySet()
        viewModelScope.launch { prefsStore.setCriteria(c.copy(text = "")) }
    }
    fun toggleCollapsed(parentId: Long) = viewModelScope.launch {
        val cur = prefsStore.current().collapsed
        prefsStore.setCollapsed(if (parentId in cur) cur - parentId else cur + parentId)
    }
    fun setBarColor(m: ColorMode) = viewModelScope.launch { prefsStore.setBarColor(m) }
    fun setPointColor(m: ColorMode) = viewModelScope.launch { prefsStore.setPointColor(m) }
    fun setAccount(id: Long?) = viewModelScope.launch { prefsStore.setAccount(id) }
    fun setNotify(enabled: Boolean, hour: Int, minute: Int) = viewModelScope.launch { prefsStore.setNotify(enabled, hour, minute) }
    fun setNotifyDays(days: Int) = viewModelScope.launch { prefsStore.setNotifyDays(days) }

    /** Points the app at a server (and account). A changed address drops the local copy and the queue. */
    fun setServer(url: String, accountId: Long?) = viewModelScope.launch {
        val before = prefsStore.current().serverUrl
        if (before.isNotBlank() && before != url) graph.syncEngine.reset()
        prefsStore.setServer(url, accountId)
    }

    fun requestSync() = repo.requestSync()

    class Factory(private val graph: Graph) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = PlannerViewModel(graph) as T
    }
}
