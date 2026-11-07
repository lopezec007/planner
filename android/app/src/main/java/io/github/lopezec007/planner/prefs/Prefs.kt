// The phone's own settings, in DataStore: the server, the account and the
// view preferences. (The web UI keeps view preferences on the server per
// account; on the phone they stay local since a phone wants its own.)
package io.github.lopezec007.planner.prefs

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import io.github.lopezec007.planner.data.model.ColorMode
import io.github.lopezec007.planner.data.model.Criteria
import io.github.lopezec007.planner.data.model.SortSpec
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "planner")

enum class View(val label: String) { LIST("List"), TIMELINE("Timeline"), MATRIX("Matrix") }

/** Matrix dot size: the task's effort, or every dot the same size (the web UI's matrix_size preference). */
enum class DotSize(val label: String) { EFFORT("Effort"), SAME("Same") }

data class AppPrefs(
    val serverUrl: String = "",
    val accountId: Long? = null,
    val view: View = View.LIST,
    val flat: Boolean = false,
    val criteria: Criteria = Criteria.fromJson(null),
    val sort: SortSpec = SortSpec(),         // the list's (and Timeline's) row order; empty = user-defined
    val collapsed: Set<Long> = emptySet(),   // parents whose tasks are hidden in the list
    val barColor: ColorMode = ColorMode.ASSIGNEE,
    val pointColor: ColorMode = ColorMode.ASSIGNEE,
    val dotSize: DotSize = DotSize.EFFORT,
    val matrixHideClosed: Boolean = false, // the Matrix leaves Done/Cancelled tasks out (they are drawn faintly otherwise)
    val notifyEnabled: Boolean = true,
    val notifyHour: Int = 8,
    val notifyMinute: Int = 0,
    val notifyDays: Int = DEFAULT_NOTIFY_DAYS, // the notification also lists items due within this many days
    val scratchWrap: Boolean = true,       // the scratch pads wrap long lines
    val setupDone: Boolean = false,
) {
    val isConfigured get() = serverUrl.isNotBlank() && setupDone

    companion object {
        const val DEFAULT_NOTIFY_DAYS = 7

        /** The look-ahead choices offered in Settings (0 = overdue and due today only). */
        val NOTIFY_DAY_CHOICES = listOf(0, 1, 3, 7, 14, 30)
    }
}

class Prefs(private val context: Context) {
    private object K {
        val serverUrl = stringPreferencesKey("server_url")
        val accountId = longPreferencesKey("account_id")
        val view = stringPreferencesKey("view")
        val flat = booleanPreferencesKey("flat")
        val filters = stringPreferencesKey("filters")
        // 1 once the stored filters know the Validating status (see fromPrefs).
        val filtersRev = intPreferencesKey("filters_rev")
        val sort = stringPreferencesKey("sort")
        val blockedLast = booleanPreferencesKey("blocked_last")
        val closedLast = booleanPreferencesKey("closed_last")
        val matrixHideClosed = booleanPreferencesKey("matrix_hide_closed")
        val collapsed = stringPreferencesKey("collapsed")
        val barColor = stringPreferencesKey("bar_color")
        val pointColor = stringPreferencesKey("point_color")
        val dotSize = stringPreferencesKey("matrix_size")
        val notifyEnabled = booleanPreferencesKey("notify_enabled")
        val notifyHour = intPreferencesKey("notify_hour")
        val notifyMinute = intPreferencesKey("notify_minute")
        val notifyDays = intPreferencesKey("notify_days")
        val scratchWrap = booleanPreferencesKey("scratch_wrap")
        val setupDone = booleanPreferencesKey("setup_done")
    }

    private val json = Json { ignoreUnknownKeys = true }

    private companion object {
        const val FILTERS_REV = 1
    }

    val flow: Flow<AppPrefs> = context.dataStore.data.map { p -> fromPrefs(p) }

    suspend fun current(): AppPrefs = flow.first()

    private fun fromPrefs(p: Preferences) = AppPrefs(
        serverUrl = p[K.serverUrl] ?: "",
        accountId = p[K.accountId],
        view = View.entries.firstOrNull { it.name == p[K.view] } ?: View.LIST,
        flat = p[K.flat] ?: false,
        // Filters stored by a version without the Validating status: where they
        // show In-Progress they now show Validating too (once; the next save
        // marks them current, so narrowing them again sticks).
        criteria = Criteria.fromJson(p[K.filters]).let { c -> if ((p[K.filtersRev] ?: 0) < FILTERS_REV) c.withValidating() else c },
        sort = SortSpec(SortSpec.keysFromJson(p[K.sort]), blockedLast = p[K.blockedLast] ?: false, closedLast = p[K.closedLast] ?: false),
        matrixHideClosed = p[K.matrixHideClosed] ?: false,
        collapsed = p[K.collapsed]?.let { s -> runCatching { json.decodeFromString<List<Long>>(s) }.getOrDefault(emptyList()) }?.toSet() ?: emptySet(),
        barColor = ColorMode.fromWire(p[K.barColor]),
        pointColor = ColorMode.fromWire(p[K.pointColor]),
        dotSize = DotSize.entries.firstOrNull { it.name == p[K.dotSize] } ?: DotSize.EFFORT,
        notifyEnabled = p[K.notifyEnabled] ?: true,
        notifyHour = p[K.notifyHour] ?: 8,
        notifyMinute = p[K.notifyMinute] ?: 0,
        notifyDays = p[K.notifyDays] ?: AppPrefs.DEFAULT_NOTIFY_DAYS,
        scratchWrap = p[K.scratchWrap] ?: true,
        setupDone = p[K.setupDone] ?: false,
    )

    suspend fun setServer(url: String, accountId: Long?) = context.dataStore.edit {
        it[K.serverUrl] = url
        if (accountId == null) it.remove(K.accountId) else it[K.accountId] = accountId
        it[K.setupDone] = url.isNotBlank()
    }

    suspend fun setAccount(accountId: Long?) = context.dataStore.edit {
        if (accountId == null) it.remove(K.accountId) else it[K.accountId] = accountId
    }

    suspend fun setView(v: View) = context.dataStore.edit { it[K.view] = v.name }
    suspend fun setFlat(flat: Boolean) = context.dataStore.edit { it[K.flat] = flat }
    suspend fun setCriteria(c: Criteria) = context.dataStore.edit {
        it[K.filters] = c.toJson()
        it[K.filtersRev] = FILTERS_REV
    }
    suspend fun setSort(s: SortSpec) = context.dataStore.edit {
        it[K.sort] = s.keysJson()
        it[K.blockedLast] = s.blockedLast
        it[K.closedLast] = s.closedLast
    }
    suspend fun setMatrixHideClosed(hide: Boolean) = context.dataStore.edit { it[K.matrixHideClosed] = hide }
    suspend fun setCollapsed(ids: Set<Long>) = context.dataStore.edit { it[K.collapsed] = json.encodeToString(ids.toList()) }
    suspend fun setBarColor(m: ColorMode) = context.dataStore.edit { it[K.barColor] = m.wire }
    suspend fun setPointColor(m: ColorMode) = context.dataStore.edit { it[K.pointColor] = m.wire }
    suspend fun setDotSize(s: DotSize) = context.dataStore.edit { it[K.dotSize] = s.name }
    suspend fun setNotify(enabled: Boolean, hour: Int, minute: Int) = context.dataStore.edit {
        it[K.notifyEnabled] = enabled
        it[K.notifyHour] = hour.coerceIn(0, 23)
        it[K.notifyMinute] = minute.coerceIn(0, 59)
    }
    suspend fun setNotifyDays(days: Int) = context.dataStore.edit { it[K.notifyDays] = days.coerceIn(0, 365) }
    suspend fun setScratchWrap(wrap: Boolean) = context.dataStore.edit { it[K.scratchWrap] = wrap }
}
