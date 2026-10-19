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
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "planner")

enum class View(val label: String) { LIST("List"), TIMELINE("Timeline"), MATRIX("Matrix") }

data class AppPrefs(
    val serverUrl: String = "",
    val accountId: Long? = null,
    val view: View = View.LIST,
    val flat: Boolean = false,
    val criteria: Criteria = Criteria.fromJson(null),
    val collapsed: Set<Long> = emptySet(),   // parents whose tasks are hidden in the list
    val barColor: ColorMode = ColorMode.ASSIGNEE,
    val pointColor: ColorMode = ColorMode.ASSIGNEE,
    val notifyEnabled: Boolean = true,
    val notifyHour: Int = 8,
    val notifyMinute: Int = 0,
    val setupDone: Boolean = false,
) {
    val isConfigured get() = serverUrl.isNotBlank() && setupDone
}

class Prefs(private val context: Context) {
    private object K {
        val serverUrl = stringPreferencesKey("server_url")
        val accountId = longPreferencesKey("account_id")
        val view = stringPreferencesKey("view")
        val flat = booleanPreferencesKey("flat")
        val filters = stringPreferencesKey("filters")
        val collapsed = stringPreferencesKey("collapsed")
        val barColor = stringPreferencesKey("bar_color")
        val pointColor = stringPreferencesKey("point_color")
        val notifyEnabled = booleanPreferencesKey("notify_enabled")
        val notifyHour = intPreferencesKey("notify_hour")
        val notifyMinute = intPreferencesKey("notify_minute")
        val setupDone = booleanPreferencesKey("setup_done")
    }

    private val json = Json { ignoreUnknownKeys = true }

    val flow: Flow<AppPrefs> = context.dataStore.data.map { p -> fromPrefs(p) }

    suspend fun current(): AppPrefs = flow.first()

    private fun fromPrefs(p: Preferences) = AppPrefs(
        serverUrl = p[K.serverUrl] ?: "",
        accountId = p[K.accountId],
        view = View.entries.firstOrNull { it.name == p[K.view] } ?: View.LIST,
        flat = p[K.flat] ?: false,
        criteria = Criteria.fromJson(p[K.filters]),
        collapsed = p[K.collapsed]?.let { s -> runCatching { json.decodeFromString<List<Long>>(s) }.getOrDefault(emptyList()) }?.toSet() ?: emptySet(),
        barColor = ColorMode.fromWire(p[K.barColor]),
        pointColor = ColorMode.fromWire(p[K.pointColor]),
        notifyEnabled = p[K.notifyEnabled] ?: true,
        notifyHour = p[K.notifyHour] ?: 8,
        notifyMinute = p[K.notifyMinute] ?: 0,
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
    suspend fun setCriteria(c: Criteria) = context.dataStore.edit { it[K.filters] = c.toJson() }
    suspend fun setCollapsed(ids: Set<Long>) = context.dataStore.edit { it[K.collapsed] = json.encodeToString(ids.toList()) }
    suspend fun setBarColor(m: ColorMode) = context.dataStore.edit { it[K.barColor] = m.wire }
    suspend fun setPointColor(m: ColorMode) = context.dataStore.edit { it[K.pointColor] = m.wire }
    suspend fun setNotify(enabled: Boolean, hour: Int, minute: Int) = context.dataStore.edit {
        it[K.notifyEnabled] = enabled
        it[K.notifyHour] = hour.coerceIn(0, 23)
        it[K.notifyMinute] = minute.coerceIn(0, 59)
    }
}
