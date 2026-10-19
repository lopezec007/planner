// Application: owns the object graph (no DI framework) and configures
// WorkManager by hand so workers can reach the graph.
package io.github.lopezec007.planner

import android.app.Application
import android.content.Context
import androidx.work.Configuration
import io.github.lopezec007.planner.attach.Outbox
import io.github.lopezec007.planner.data.api.PlannerApi
import io.github.lopezec007.planner.data.db.PlannerDatabase
import io.github.lopezec007.planner.data.repo.PlannerRepository
import io.github.lopezec007.planner.data.sync.SyncEngine
import io.github.lopezec007.planner.data.sync.SyncScheduler
import io.github.lopezec007.planner.notify.DueNotifier
import io.github.lopezec007.planner.prefs.Prefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

class Graph(app: Application) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val prefs = Prefs(app)
    val db = PlannerDatabase.build(app)
    val outbox = Outbox(app)

    /** The API for the configured server; rebuilt when the address changes. */
    @Volatile private var api: PlannerApi? = null
    @Volatile private var apiUrl: String = ""

    fun api(): PlannerApi? = api

    private fun setServer(url: String) {
        if (url == apiUrl) return
        apiUrl = url
        api = PlannerApi.parseBaseUrl(url)?.let { PlannerApi(it) }
    }

    val syncEngine = SyncEngine(db, { api })
    val scheduler = SyncScheduler(app, syncEngine, scope)
    val repo = PlannerRepository(db, syncEngine, scheduler, outbox, app.cacheDir, { api })
    val notifier = DueNotifier(app)

    init {
        scope.launch {
            prefs.flow.map { it.serverUrl }.distinctUntilChanged().collect { url ->
                setServer(url)
                if (url.isNotBlank()) {
                    scheduler.ensurePeriodic()
                    scheduler.requestNow()
                }
            }
        }
        scope.launch {
            prefs.flow.map { Triple(it.notifyEnabled, it.notifyHour, it.notifyMinute) }.distinctUntilChanged().collect { (on, h, m) ->
                notifier.schedule(on, h, m)
            }
        }
    }
}

class PlannerApp : Application(), Configuration.Provider {
    lateinit var graph: Graph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = Graph(this)
        graph.notifier.ensureChannel()
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setMinimumLoggingLevel(android.util.Log.INFO).build()

    companion object {
        fun graph(context: Context): Graph = (context.applicationContext as PlannerApp).graph
    }
}
