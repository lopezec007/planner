// First-run screen (also reached from Settings > Server > Change…): the
// server address, a reachability probe against it, and the account to use
// on this phone. The address is the only host the app ever talks to
// (README "Network policy").
package io.github.lopezec007.planner.ui.setup

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.lopezec007.planner.data.api.PlannerApi
import io.github.lopezec007.planner.data.api.UserDto
import io.github.lopezec007.planner.ui.PlannerViewModel
import io.github.lopezec007.planner.ui.components.ColorDot
import io.github.lopezec007.planner.ui.theme.LocalPalette
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import java.io.IOException

/** Where the reachability probe stands. */
private sealed class Probe {
    object Idle : Probe()
    object Running : Probe()
    /** No answer at all (no network, tunnel down, wrong host). */
    data class Unreachable(val address: String) : Probe()
    /** Something answered, but not like a planner server. */
    data class Failed(val message: String) : Probe()
    data class Found(val version: String, val users: List<UserDto>) : Probe()
}

/** The stored base URL as something short to type: no "http://", no trailing slash. */
private fun displayAddress(stored: String): String =
    stored.trim().trimEnd('/').removePrefix("http://")

@Composable
fun SetupScreen(vm: PlannerViewModel, onDone: () -> Unit) {
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    val p = prefs ?: return
    val scope = rememberCoroutineScope()

    var address by remember { mutableStateOf(displayAddress(p.serverUrl)) }
    var parseError by remember { mutableStateOf<String?>(null) }
    var url by remember { mutableStateOf<HttpUrl?>(null) }
    var probe by remember { mutableStateOf<Probe>(Probe.Idle) }
    var accountId by remember { mutableStateOf(p.accountId) }

    fun connect() {
        val parsed = PlannerApi.parseBaseUrl(address)
        if (parsed == null) {
            parseError = "That does not look like a server address"
            return
        }
        parseError = null
        url = parsed
        probe = Probe.Running
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                try {
                    val api = PlannerApi(parsed)
                    val version = api.probe()
                    val users = api.listUsers()
                    Probe.Found(version.version, users)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: IOException) {
                    val port = if (parsed.port != HttpUrl.defaultPort(parsed.scheme)) ":${parsed.port}" else ""
                    Probe.Unreachable(parsed.host + port)
                } catch (e: Exception) {
                    Probe.Failed(e.message ?: e.toString())
                }
            }
            probe = result
        }
    }

    fun finish(id: Long?) {
        val u = url ?: return
        vm.setServer(u.toString(), id)
        onDone()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Planner", style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(8.dp))
            Text(
                "Enter the address of your planner server. Examples: 10.8.0.1:8080 or planner.lan:8080",
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = address,
                onValueChange = {
                    address = it
                    parseError = null
                    if (probe !is Probe.Running) probe = Probe.Idle
                },
                label = { Text("Server address") },
                placeholder = { Text("host:port") },
                singleLine = true,
                isError = parseError != null,
                supportingText = {
                    Text(parseError ?: "The app only ever talks to this address.")
                },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { connect() }),
                enabled = probe !is Probe.Running,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))

            when (val s = probe) {
                Probe.Idle -> {
                    Button(onClick = { connect() }, enabled = address.isNotBlank()) { Text("Connect") }
                }
                Probe.Running -> {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.width(20.dp).height(20.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(12.dp))
                        Text("Looking for the server…", style = MaterialTheme.typography.bodyMedium)
                    }
                }
                is Probe.Unreachable -> {
                    Text(
                        "Cannot reach the server at ${s.address} (is the tunnel up?)",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedButton(onClick = { connect() }) { Text("Retry") }
                        // Keeps the account when the address did not change (a
                        // reconfiguration while offline); otherwise none.
                        Button(onClick = { finish(if (url?.toString() == p.serverUrl) p.accountId else null) }) {
                            Text("Use anyway")
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Without an account, due-date notifications and the default owner stay off until you pick one in Settings.",
                        style = MaterialTheme.typography.bodySmall,
                        color = LocalPalette.current.subtle,
                        textAlign = TextAlign.Center,
                    )
                }
                is Probe.Failed -> {
                    Text(
                        "That address does not answer like a planner server: ${s.message}",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = { connect() }) { Text("Retry") }
                }
                is Probe.Found -> {
                    // A stored account that the server no longer lists counts as none.
                    val selected = accountId?.takeIf { id -> s.users.any { it.id == id } }
                    Text(
                        "Planner ${s.version.ifBlank { "?" }} found",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.height(16.dp))
                    Text("Who are you?", style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "The account is what due-date notifications and the default owner use.",
                        style = MaterialTheme.typography.bodySmall,
                        color = LocalPalette.current.subtle,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(8.dp))
                    Column(Modifier.fillMaxWidth()) {
                        for (u in s.users) {
                            AccountRow(
                                name = u.name,
                                color = u.color,
                                selected = selected == u.id,
                                onClick = { accountId = u.id },
                            )
                        }
                        AccountRow(name = "No account", color = null, selected = selected == null, onClick = { accountId = null })
                    }
                    Spacer(Modifier.height(16.dp))
                    Button(onClick = { finish(selected) }, modifier = Modifier.fillMaxWidth()) { Text("Finish") }
                }
            }
        }
    }
}

@Composable
private fun AccountRow(name: String, color: String?, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null)
        Spacer(Modifier.width(8.dp))
        if (color != null) {
            ColorDot(color, size = 16)
            Spacer(Modifier.width(8.dp))
        }
        Text(name, style = MaterialTheme.typography.bodyLarge)
    }
}
