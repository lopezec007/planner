// Search and filter criteria, a port of static/js/search.js: an item
// matches on its own fields; a parent is shown when it matches or any task
// does, with only the matching tasks; `hideEmptyParents` drops parents with
// no matching tasks. Persisted in the same JSON shape as the web "filters"
// preference.
//
// The Active template's "closed within" window is the planner's
// `closed_days` setting, not a number of its own: such criteria carry
// `recentAuto`, and `withClosedDays` brings their `recentDays` up to the
// setting wherever they are used, so a change of the setting is followed. A
// number typed into the Filters sheet is the user's own (unless it is the
// setting's value).
package io.github.lopezec007.planner.data.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import java.time.LocalDate

/** A parent with the tasks shown under it. */
@Immutable
data class Group(val parent: Item, val tasks: List<Item>)

/** [recentAuto]: the template also shows items closed within the `closed_days` setting. */
enum class Preset(val title: String, val statuses: Set<Status>, val recentAuto: Boolean, val hideEmptyParents: Boolean) {
    ACTIVE("Active", setOf(Status.TODO, Status.IN_PROGRESS, Status.VALIDATING), true, true),
    BACKLOG("Backlog", setOf(Status.BACKLOG), false, false),
    IDEAS("Ideas", setOf(Status.IDEA), false, false);

    /** The template applied over [base]; [closedDays] is the `closed_days` setting. */
    fun criteria(base: Criteria = Criteria(), closedDays: Int = AppSettings.DEFAULT_CLOSED_DAYS) = base.copy(
        statuses = statuses, recentAuto = recentAuto, recentDays = if (recentAuto) closedDays else 0,
        types = emptySet(), hideEmptyParents = hideEmptyParents,
    )
}

/** The stored form (web-compatible keys). */
@Serializable
private data class CriteriaJson(
    val types: List<String> = emptyList(),
    val statuses: List<String> = emptyList(),
    @SerialName("recent_days") val recentDays: Int = 0,
    @SerialName("recent_auto") val recentAuto: Boolean? = null, // absent in filters stored before the closed_days setting
    @SerialName("hide_empty_parents") val hideEmptyParents: Boolean = false,
    val owner: String = "",       // legacy single choice, read when `owners` is absent
    val assignee: String = "",    // legacy single choice, read when `assignees` is absent
    val owners: List<String> = emptyList(),
    val assignees: List<String> = emptyList(),
    val blocked: String = "",
    @SerialName("end_after") val endAfter: String = "",
    @SerialName("end_before") val endBefore: String = "",
)

data class Criteria(
    val text: String = "",
    val types: Set<ItemType> = emptySet(),
    val statuses: Set<Status> = emptySet(),
    val recentDays: Int = 0,          // also match items closed within this many days (0 = off)
    val recentAuto: Boolean = false,  // recentDays is the closed_days setting (see withClosedDays), not the user's own number
    val hideEmptyParents: Boolean = false,
    val owners: Set<String> = emptySet(),    // empty = any; else "none" and/or user ids, any of which matches
    val assignees: Set<String> = emptySet(), // empty = any; else "none" and/or user ids, any of which matches
    val blocked: String = "",         // "" any | "yes" | "no"
    val endAfter: LocalDate? = null,  // inclusive
    val endBefore: LocalDate? = null, // inclusive
) {
    val isActive: Boolean
        get() = text.isNotBlank() || types.isNotEmpty() || statuses.isNotEmpty() || recentDays > 0 || hideEmptyParents ||
            owners.isNotEmpty() || assignees.isNotEmpty() || blocked.isNotEmpty() || endAfter != null || endBefore != null

    /** Filters other than the search text, as a count for the badge. */
    val filterCount: Int
        get() = (if (types.isNotEmpty()) 1 else 0) + (if (statuses.isNotEmpty() || recentDays > 0) 1 else 0) +
            (if (owners.isNotEmpty()) 1 else 0) + (if (assignees.isNotEmpty()) 1 else 0) + (if (blocked.isNotEmpty()) 1 else 0) +
            (if (endAfter != null || endBefore != null) 1 else 0)

    /** The template whose status/recent/type filters are exactly in effect, or null. */
    val preset: Preset?
        get() = Preset.entries.firstOrNull { p ->
            statuses == p.statuses && recentAuto == p.recentAuto && (p.recentAuto || recentDays == 0) &&
                types.isEmpty() && hideEmptyParents == p.hideEmptyParents
        }

    /** These criteria with a window that follows the `closed_days` setting brought up to [days]. */
    fun withClosedDays(days: Int): Criteria = if (recentAuto && recentDays != days) copy(recentDays = days) else this

    /**
     * Status for a new project/task under these filters (search.js newStatus):
     * the planner's [default] (the `default_status` setting) when the status
     * filter is empty or admits it, else a status the filter does show so the
     * new row is not hidden at once.
     */
    fun newStatus(default: Status = Status.TODO): Status {
        if (statuses.isEmpty() || default in statuses) return default
        if (statuses.size == 1) return statuses.first()
        if (Status.TODO in statuses) return Status.TODO
        return Status.entries.first { it in statuses }
    }

    fun matches(it: Item, byId: (Long) -> Item?): Boolean {
        val q = text.trim().lowercase()
        if (q.isNotEmpty()) {
            val hay = "${it.key}\n${it.title}\n${it.description}".lowercase()
            if (!hay.contains(q)) return false
        }
        if (types.isNotEmpty() && it.type !in types) return false
        if (!statusMatches(it)) return false
        if (owners.isNotEmpty() && !userMatches(it.ownerId, owners)) return false
        if (assignees.isNotEmpty() && !userMatches(it.assigneeId, assignees)) return false
        if (blocked.isNotEmpty() && (blocked == "yes") != it.isBlocked(byId)) return false
        if (endAfter != null || endBefore != null) {
            val end = it.endDate ?: return false
            if (endAfter != null && end.isBefore(endAfter)) return false
            if (endBefore != null && end.isAfter(endBefore)) return false
        }
        return true
    }

    /** A user filter matches an unset user through "none" and a set one through its id. */
    private fun userMatches(userId: Long?, chosen: Set<String>): Boolean =
        if (userId == null) "none" in chosen else userId.toString() in chosen

    /** Status filter on the item's own status; Ongoing rows are never excluded. */
    private fun statusMatches(it: Item): Boolean {
        if (statuses.isEmpty() && recentDays <= 0) return true
        if (it.type == ItemType.ONGOING) return true
        if (it.status != null && it.status in statuses) return true
        if (recentDays > 0 && it.isClosed && Dates.withinLastDays(it.closedAt, recentDays)) return true
        return false
    }

    /** Applies the criteria to groups in display order; [pinned] items stay visible (just created). */
    fun apply(groups: List<Group>, byId: (Long) -> Item?, pinned: Set<Long> = emptySet()): List<Group> {
        if (!isActive) return groups
        val out = ArrayList<Group>()
        for (g in groups) {
            val isPinned = g.parent.id in pinned
            val parentMatch = isPinned || matches(g.parent, byId)
            val tasks = g.tasks.filter { it.id in pinned || matches(it, byId) }
            if (hideEmptyParents && tasks.isEmpty() && !isPinned) continue
            if (parentMatch || tasks.isNotEmpty()) out.add(Group(g.parent, tasks))
        }
        return out
    }

    /**
     * These criteria as stored before the Validating status existed, brought
     * up to date: a filter that shows In-Progress shows Validating as well
     * (which keeps a stored Active template the Active template).
     */
    fun withValidating(): Criteria =
        if (Status.IN_PROGRESS in statuses && Status.VALIDATING !in statuses) copy(statuses = statuses + Status.VALIDATING) else this

    fun toJson(): String = json.encodeToString(
        CriteriaJson(
            types = types.map { it.wire }, statuses = statuses.map { it.wire }, recentDays = recentDays,
            recentAuto = recentAuto,
            hideEmptyParents = hideEmptyParents,
            // The list is the stored form; the single key keeps the web shape for a lone choice.
            owners = owners.toList(), assignees = assignees.toList(),
            owner = owners.singleOrNull() ?: "", assignee = assignees.singleOrNull() ?: "",
            blocked = blocked,
            endAfter = Dates.format(endAfter) ?: "", endBefore = Dates.format(endBefore) ?: "",
        ),
    )

    companion object {
        private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

        /** The Active template's window before the `closed_days` setting existed: a stored 14 was the template's. */
        private const val LEGACY_CLOSED_DAYS = 14

        /** The list when present, else the legacy single choice; blanks dropped. */
        private fun userSet(list: List<String>, single: String): Set<String> =
            (list.ifEmpty { listOf(single) }).filter { it.isNotBlank() }.toSet()

        /** Parses the stored form; the Active template when blank or malformed. */
        fun fromJson(s: String?): Criteria {
            if (s.isNullOrBlank()) return Preset.ACTIVE.criteria()
            val p = try { json.decodeFromString<CriteriaJson>(s) } catch (_: Exception) { return Preset.ACTIVE.criteria() }
            return Criteria(
                types = p.types.mapNotNull { t -> ItemType.entries.firstOrNull { it.wire == t } }.toSet(),
                statuses = p.statuses.mapNotNull { Status.fromWire(it) }.toSet(),
                recentDays = p.recentDays.coerceAtLeast(0),
                recentAuto = p.recentAuto ?: (p.recentDays == LEGACY_CLOSED_DAYS),
                hideEmptyParents = p.hideEmptyParents,
                owners = userSet(p.owners, p.owner), assignees = userSet(p.assignees, p.assignee),
                blocked = if (p.blocked == "yes" || p.blocked == "no") p.blocked else "",
                endAfter = Dates.parse(p.endAfter), endBefore = Dates.parse(p.endBefore),
            )
        }
    }
}
