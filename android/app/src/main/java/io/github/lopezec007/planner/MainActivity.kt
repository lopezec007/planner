package io.github.lopezec007.planner

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.lopezec007.planner.notify.DueNotifier
import io.github.lopezec007.planner.ui.PlannerViewModel
import io.github.lopezec007.planner.ui.detail.DetailScreen
import io.github.lopezec007.planner.ui.detail.NewItemScreen
import io.github.lopezec007.planner.ui.home.HomeScreen
import io.github.lopezec007.planner.ui.nav.Nav
import io.github.lopezec007.planner.ui.nav.Screen
import io.github.lopezec007.planner.ui.scratch.ScratchScreen
import io.github.lopezec007.planner.ui.settings.SettingsScreen
import io.github.lopezec007.planner.ui.setup.SetupScreen
import io.github.lopezec007.planner.ui.theme.PlannerTheme
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {
    private val vm: PlannerViewModel by viewModels { PlannerViewModel.Factory(PlannerApp.graph(this)) }

    /** Item to open from a notification tap; consumed by the composition. */
    private val openItem = MutableStateFlow<Long?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        openItem.value = intent?.itemIdExtra()
        setContent {
            PlannerTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Root(vm)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.itemIdExtra()?.let { openItem.value = it }
    }

    private fun Intent.itemIdExtra(): Long? =
        if (hasExtra(DueNotifier.EXTRA_ITEM_ID)) getLongExtra(DueNotifier.EXTRA_ITEM_ID, 0L).takeIf { it != 0L } else null

    @Composable
    private fun Root(vm: PlannerViewModel) {
        val prefs by vm.prefs.collectAsStateWithLifecycle()
        val p = prefs ?: return  // DataStore not read yet: keep the window background
        val nav = remember { Nav(if (p.isConfigured) Screen.Home else Screen.Setup) }
        val pending by openItem.collectAsStateWithLifecycle()

        LaunchedEffect(pending) {
            val id = pending ?: return@LaunchedEffect
            openItem.value = null
            if (p.isConfigured) {
                nav.reset(Screen.Home)
                nav.push(Screen.Detail(id))
            }
        }
        LaunchedEffect(p.isConfigured) {
            if (!p.isConfigured && nav.current != Screen.Setup) nav.reset(Screen.Setup)
        }

        BackHandler(enabled = nav.canGoBack) { nav.pop() }

        when (val s = nav.current) {
            Screen.Setup -> SetupScreen(vm, onDone = { nav.reset(Screen.Home) })
            Screen.Home -> HomeScreen(vm, nav)
            is Screen.Detail -> DetailScreen(vm, nav, s.itemId)
            is Screen.New -> NewItemScreen(vm, nav, s.type, s.parentId)
            Screen.Settings -> SettingsScreen(vm, nav)
            Screen.Scratch -> ScratchScreen(vm, nav)
        }
    }
}
