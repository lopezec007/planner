// Sorting, a port of static/js/sort.js: a list of columns applied in order
// (empty = the user-defined order the server keeps), plus two switches that
// apply whatever the columns: "blocked items last" and "done / cancelled
// items last". With both on the bands are open-and-unblocked, then blocked,
// then closed; each band keeps the column sort or the user-defined order.
//
// Nested: the parents are sorted among themselves and the tasks within each
// parent. Flat: every task takes part in one sort, and the result is handed
// back as runs of consecutive tasks that share a parent (one Group per run),
// so the same parent may appear in several groups; [SortSpec.groupedIn]
// says whether the tasks of a parent still sit together (then a run is a
// whole parent and the list can rule them off).
//
// Ties keep the order the groups came in (the sort is stable), which is the
// user-defined order. A missing value sorts last in both directions.
// Stored in the same JSON shape as the web "sort" preference.
package io.github.lopezec007.planner.data.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** A column the list can be sorted by. [descFirst]: the first tap sorts descending (the most important first). */
enum class SortColumn(val wire: String, val label: String, val descFirst: Boolean = false, val flatOnly: Boolean = false) {
    PARENT("parent", "Ongoing / Project", flatOnly = true),
    KEY("key", "Key"),
    TITLE("title", "Title"),
    STATUS("status", "Status"),
    OWNER("owner", "Owner"),
    ASSIGNEE("assignee", "Assignee"),
    START("start", "Start"),
    END("end", "End"),
    IMPORTANCE("importance", "Importance", descFirst = true),
    URGENCY("urgency", "Urgency", descFirst = true),
    EFFORT("effort", "Effort"),
    BLOCKED("blocked", "Blocked");

    companion object {
        fun fromWire(s: String?): SortColumn? = entries.firstOrNull { it.wire == s }
    }
}

@Immutable
data class SortKey(val column: SortColumn, val desc: Boolean = column.descFirst)

/** What the comparator needs to know beyond the items themselves. */
class SortLookup(val item: (Long) -> Item?, val userName: (Long) -> String?)

@Immutable
data class SortSpec(
    val keys: List<SortKey> = emptyList(),
    val blockedLast: Boolean = false,
    val closedLast: Boolean = false,
) {
    /** False for the plain user-defined order. */
    val isActive: Boolean get() = keys.isNotEmpty() || blockedLast || closedLast

    /** The columns in effect: the Ongoing/Project column only exists in Flat and is set aside (not forgotten) otherwise. */
    fun keysFor(flat: Boolean): List<SortKey> = if (flat) keys else keys.filter { !it.column.flatOnly }

    /** Whether the Flat list still keeps each parent's tasks together (sort.js `grouped`). */
    fun groupedIn(flat: Boolean): Boolean {
        if (!flat) return true
        if (blockedLast || closedLast) return false
        return keys.isEmpty() || keys.first().column == SortColumn.PARENT
    }

    /**
     * The tap rule of the web's column headers: a column joins the sort in
     * its first direction, a second tap reverses it, a third removes it.
     */
    fun toggle(column: SortColumn): SortSpec {
        val i = keys.indexOfFirst { it.column == column }
        return when {
            i < 0 -> if (keys.size >= MAX_KEYS) this else copy(keys = keys + SortKey(column))
            keys[i].desc == column.descFirst -> copy(keys = keys.mapIndexed { j, k -> if (j == i) k.copy(desc = !k.desc) else k })
            else -> copy(keys = keys.filterIndexed { j, _ -> j != i })
        }
    }

    /** Compares two sibling items (or any two tasks, in Flat); 0 leaves them in the order they came. */
    fun comparator(lookup: SortLookup, flat: Boolean): Comparator<Item> {
        val active = keysFor(flat)
        return Comparator { a, b ->
            if (closedLast) {
                val d = a.isClosed.compareTo(b.isClosed)
                if (d != 0) return@Comparator d
            }
            if (blockedLast) {
                val d = a.isBlocked(lookup.item).compareTo(b.isBlocked(lookup.item))
                if (d != 0) return@Comparator d
            }
            for (k in active) {
                val va = value(a, k.column, lookup)
                val vb = value(b, k.column, lookup)
                val d = when {
                    va == null && vb == null -> 0
                    va == null -> 1            // missing values last, whatever the direction
                    vb == null -> -1
                    else -> compareSame(va, vb).let { if (k.desc) -it else it }
                }
                if (d != 0) return@Comparator d
            }
            0
        }
    }

    /** Orders the groups for display; see the header for what Flat returns. */
    fun apply(groups: List<Group>, flat: Boolean, lookup: SortLookup): List<Group> {
        if (keysFor(flat).isEmpty() && !blockedLast && !closedLast) return groups
        val cmp = comparator(lookup, flat)
        if (!flat) {
            return groups.map { g -> Group(g.parent, g.tasks.sortedWith(cmp)) }.sortedWith { a, b -> cmp.compare(a.parent, b.parent) }
        }
        val parents = groups.associate { it.parent.id to it.parent }
        val tasks = groups.flatMap { it.tasks }.sortedWith(cmp)
        val out = ArrayList<Group>()
        var run = ArrayList<Item>()
        var runParent: Long? = null
        fun flush() {
            val p = runParent?.let { parents[it] }
            if (p != null && run.isNotEmpty()) out.add(Group(p, run))
            run = ArrayList()
        }
        for (t in tasks) {
            if (t.parentId != runParent) {
                flush()
                runParent = t.parentId
            }
            run.add(t)
        }
        flush()
        return out
    }

    /** "Urgency ↓, End ↑", or "User-defined" without columns. */
    fun summary(flat: Boolean): String {
        val active = keysFor(flat)
        return if (active.isEmpty()) "User-defined" else active.joinToString(", ") { "${it.column.label} ${if (it.desc) "↓" else "↑"}" }
    }

    /** The columns as the web's "sort" preference stores them. */
    fun keysJson(): String = json.encodeToString(keys.map { KeyJson(it.column.wire, if (it.desc) "desc" else "asc") })

    companion object {
        const val MAX_KEYS = 6

        // encodeDefaults: "dir":"asc" is written out, as the web stores it.
        private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

        /** Parses the stored columns leniently: unknown columns and repeats are dropped. */
        fun keysFromJson(s: String?): List<SortKey> {
            if (s.isNullOrBlank()) return emptyList()
            val parsed = try { json.decodeFromString<List<KeyJson>>(s) } catch (_: Exception) { return emptyList() }
            val out = ArrayList<SortKey>()
            for (k in parsed) {
                val column = SortColumn.fromWire(k.key) ?: continue
                if (out.any { it.column == column }) continue
                out.add(SortKey(column, desc = k.dir == "desc"))
                if (out.size >= MAX_KEYS) break
            }
            return out
        }

        private val TYPE_ORDER = mapOf(ItemType.ONGOING to 0, ItemType.PROJECT to 1, ItemType.TASK to 2)

        /** An item key as it sorts: by type (N, P, T), then by number. */
        private data class KeyOrder(val type: Int, val num: Long) : Comparable<KeyOrder> {
            override fun compareTo(other: KeyOrder): Int = compareValuesBy(this, other, { it.type }, { it.num })
        }

        /** Text as it sorts: case ignored, and runs of digits by their value ("Task 2" before "Task 10"). */
        private class Natural(val text: String) : Comparable<Natural> {
            override fun compareTo(other: Natural): Int = naturalCompare(text, other.text)
        }

        private fun keyOrder(it: Item) = KeyOrder(TYPE_ORDER[it.type] ?: 9, it.num)

        private fun value(it: Item, column: SortColumn, lookup: SortLookup): Comparable<*>? = when (column) {
            SortColumn.PARENT -> it.parentId?.let(lookup.item)?.let(::keyOrder)
            SortColumn.KEY -> keyOrder(it)
            SortColumn.TITLE -> Natural(it.title)
            SortColumn.STATUS -> it.status?.ordinal
            SortColumn.OWNER -> it.ownerId?.let { id -> Natural(lookup.userName(id) ?: "#$id") }
            SortColumn.ASSIGNEE -> it.assigneeId?.let { id -> Natural(lookup.userName(id) ?: "#$id") }
            SortColumn.START -> it.startDate
            SortColumn.END -> it.endDate
            SortColumn.IMPORTANCE -> it.importance
            SortColumn.URGENCY -> it.urgency
            SortColumn.EFFORT -> it.effort
            SortColumn.BLOCKED -> if (it.isBlocked(lookup.item)) 1 else 0
        }

        /** Both values come from the same column, so they are of the same type. */
        @Suppress("UNCHECKED_CAST")
        private fun compareSame(a: Comparable<*>, b: Comparable<*>): Int = (a as Comparable<Any>).compareTo(b)

        internal fun naturalCompare(a: String, b: String): Int {
            var i = 0
            var j = 0
            while (i < a.length && j < b.length) {
                val ca = a[i]
                val cb = b[j]
                if (ca.isDigit() && cb.isDigit()) {
                    var ei = i
                    while (ei < a.length && a[ei].isDigit()) ei++
                    var ej = j
                    while (ej < b.length && b[ej].isDigit()) ej++
                    val na = a.substring(i, ei).trimStart('0')
                    val nb = b.substring(j, ej).trimStart('0')
                    if (na.length != nb.length) return na.length.compareTo(nb.length)
                    val d = na.compareTo(nb)
                    if (d != 0) return d
                    i = ei
                    j = ej
                } else {
                    val d = ca.lowercaseChar().compareTo(cb.lowercaseChar())
                    if (d != 0) return d
                    i++
                    j++
                }
            }
            return (a.length - i).compareTo(b.length - j)
        }
    }
}

@Serializable
private data class KeyJson(val key: String = "", val dir: String = "asc")
