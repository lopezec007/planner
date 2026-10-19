// Domain model shared by the database, the API and the UI. Field names and
// wire values match the server (internal/store/store.go); see the README's
// "Item JSON fields".
package io.github.lopezec007.planner.data.model

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
    val importance: Int?,
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
data class AppSettings(val values: Map<String, String>) {
    operator fun get(key: String): String? = values[key]
    val weekStart: Int get() = values["week_start"]?.toIntOrNull()?.coerceIn(0, 6) ?: 6
    val colorOngoing: String get() = values["color_ongoing"] ?: "#2a9d8f"
    val colorProject: String get() = values["color_project"] ?: "#5b6cff"
    val colorTask: String get() = values["color_task"] ?: ""
    val colorUnassigned: String get() = values["color_unassigned"] ?: "#9aa3ad"

    /** The ramp for urgency or importance: index = value 0..10, "" = no colour. */
    fun ramp(field: String): List<String> = parseRamp(values["${field}_colors"])

    fun levelColor(field: String, n: Int?): String {
        if (n == null) return ""
        return ramp(field).getOrNull(n) ?: ""
    }

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
