// Domain model shared by the database, the API and the UI. Field names and
// wire values match the server (internal/store/store.go); see the README's
// "Item JSON fields".
package io.github.lopezec007.planner.data.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.time.LocalDate

@Serializable
enum class ItemType(val wire: String, val label: String, val keyPrefix: String) {
    @SerialName("ongoing") ONGOING("ongoing", "Ongoing", "N"),
    @SerialName("project") PROJECT("project", "Project", "P"),
    @SerialName("task") TASK("task", "Task", "T");

    val isParent get() = this != TASK

    companion object {
        fun fromWire(s: String): ItemType = entries.first { it.wire == s }
    }
}

@Serializable
enum class Status(val wire: String, val label: String) {
    @SerialName("idea") IDEA("idea", "Idea"),
    @SerialName("backlog") BACKLOG("backlog", "Backlog"),
    @SerialName("todo") TODO("todo", "To-Do"),
    @SerialName("in-progress") IN_PROGRESS("in-progress", "In-Progress"),
    @SerialName("done") DONE("done", "Done"),
    @SerialName("cancelled") CANCELLED("cancelled", "Cancelled");

    val isClosed get() = this == DONE || this == CANCELLED

    companion object {
        fun fromWire(s: String?): Status? = s?.let { w -> entries.firstOrNull { it.wire == w } }
    }
}

// The model classes are @Immutable so Compose compares them by value: a list
// row whose item did not change is skipped when a new snapshot arrives,
// instead of recomposing because the instance is new (see ItemList).
@Immutable
data class User(
    val id: Long,
    val name: String,
    val color: String,   // "#rrggbb"
    val short: String,   // chip label, at most 3 characters
    val createdAt: String,
) {
    /** What a chip shows: the short label, else the name. */
    val chip: String get() = short.ifBlank { name }
}

@Immutable
data class Attachment(
    val id: Long,
    val itemId: Long,
    val name: String,
    val contentType: String,
    val size: Long,
    val createdAt: String,
    /** Set while an upload is still queued (the file is in the outbox). */
    val pending: Boolean = false,
)

/**
 * An item as the UI sees it. `id` is negative for an item created offline
 * that the server has not yet answered ([isLocal]); its [key] is then "…".
 */
@Immutable
data class Item(
    val id: Long,
    val type: ItemType,
    val key: String,
    val num: Long,
    val parentId: Long?,
    val title: String,
    val description: String,
    val ownerId: Long?,
    val assigneeId: Long?,
    val status: Status?,
    val startDate: LocalDate?,
    val startFirm: Boolean,
    val endDate: LocalDate?,
    val endFirm: Boolean,
    val urgency: Int?,
    val importance: Int?,       // -1..10 (urgency is 0..10)
    val effort: Int? = null,    // minutes, tasks only; one of the `effort_options` setting
    val blocked: Boolean,
    val color: String,          // an Ongoing's/Project's own colour, "" for none
    val sortOrder: Long,
    val createdAt: String,
    val updatedAt: String,
    val closedAt: String?,
    val blockedBy: List<Long>,
    val blocks: List<Long>,
    val attachments: List<Attachment>,
) {
    val isLocal get() = id < 0
    val isClosed get() = status?.isClosed == true
    val isParent get() = type.isParent

    /** "Blocked" as the UI shows it: the flag, or an open blocker. */
    fun isBlocked(byId: (Long) -> Item?): Boolean =
        blocked || blockedBy.any { byId(it)?.isClosed == false }
}

data class StatusChange(val id: Long, val itemId: Long, val status: Status, val changedAt: String)

/** App settings from /api/settings (strings on the wire, defaults from the server). */
@Immutable
data class AppSettings(val values: Map<String, String>) {
    operator fun get(key: String): String? = values[key]
    val weekStart: Int get() = values["week_start"]?.toIntOrNull()?.coerceIn(0, 6) ?: 6
    val colorOngoing: String get() = values["color_ongoing"] ?: "#2a9d8f"
    val colorProject: String get() = values["color_project"] ?: "#5b6cff"
    val colorTask: String get() = values["color_task"] ?: ""
    val colorUnassigned: String get() = values["color_unassigned"] ?: "#9aa3ad"
    /** The status a new project or task starts with when the filters allow it (server default "todo"). */
    val defaultStatus: Status get() = Status.fromWire(values["default_status"]) ?: Status.TODO

    /** The ramp for urgency or importance: index = value 0..10, "" = no colour (importance -1 has none). */
    fun ramp(field: String): List<String> = parseRamp(values["${field}_colors"])

    fun levelColor(field: String, n: Int?): String {
        if (n == null || n < 0) return ""
        return ramp(field).getOrNull(n) ?: ""
    }

    /** The effort choices in minutes, ascending (the `effort_options` setting; the server's default when absent). */
    val effortOptions: List<Int> get() = Effort.parseOptions(values["effort_options"])

    companion object {
        val EMPTY = AppSettings(emptyMap())

        /** Parses the JSON array of colour strings the server stores, leniently. */
        fun parseRamp(json: String?): List<String> {
            if (json.isNullOrBlank()) return emptyList()
            return try {
                Json.decodeFromString<List<String>>(json)
            } catch (_: Exception) {
                emptyList()
            }
        }
    }
}

/**
 * Effort on a task: whole minutes, one of the planner's `effort_options`.
 * Shown as "15m", "1h", "1h 30m", "64h"; summed over a parent's open tasks.
 */
object Effort {
    /** The server's default options: 15m, 30m, 1h, 2h, 4h, 8h, 16h, 32h, 64h. */
    val DEFAULT_OPTIONS = listOf(15, 30, 60, 120, 240, 480, 960, 1920, 3840)

    /** Minutes as "15m" / "1h" / "1h 30m"; "" for null. */
    fun format(minutes: Int?): String {
        if (minutes == null) return ""
        if (minutes <= 0) return "0m"
        val h = minutes / 60
        val m = minutes % 60
        return when {
            h == 0 -> "${m}m"
            m == 0 -> "${h}h"
            else -> "${h}h ${m}m"
        }
    }

    /** Parses the setting's JSON array of positive minutes leniently: ascending, distinct, the default when blank or malformed. */
    fun parseOptions(json: String?): List<Int> {
        if (json.isNullOrBlank()) return DEFAULT_OPTIONS
        val parsed = try {
            Json.decodeFromString<List<Int>>(json)
        } catch (_: Exception) {
            return DEFAULT_OPTIONS
        }
        val clean = parsed.filter { it > 0 }.distinct().sorted()
        return if (clean.isEmpty()) DEFAULT_OPTIONS else clean
    }

    /** The setting's wire form: a JSON array, ascending. */
    fun encodeOptions(options: List<Int>): String = options.distinct().sorted().joinToString(",", "[", "]")

    /** The effort of the tasks that count: open ones (not Done/Cancelled) with a value; null when none has one. */
    fun sumOpen(tasks: List<Item>): Int? = sum(tasks.filter { !it.isClosed })

    /** The effort of every task with a value, closed ones included; null when none has one. */
    fun sum(tasks: List<Item>): Int? {
        var total = 0
        var any = false
        for (t in tasks) {
            val e = t.effort ?: continue
            total += e
            any = true
        }
        return if (any) total else null
    }
}

/**
 * The scratch pads' scopes, named as the server's scratch table keys: the
 * pad everyone shares and one per user. Also the Room key of the cache.
 */
object ScratchScope {
    const val GLOBAL = "global"
    fun user(id: Long) = "user:$id"
    /** The user id of a per-user scope, or null for the shared one. */
    fun userId(scope: String): Long? = scope.removePrefix("user:").takeIf { it != scope }?.toLongOrNull()
}

/** One scratch pad's text; [updatedAt] is the server's stamp, "" until it has been written there. */
data class Scratch(val scope: String, val text: String, val updatedAt: String)
