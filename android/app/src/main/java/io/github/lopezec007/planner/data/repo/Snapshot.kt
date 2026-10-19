// Everything a screen needs in one immutable value, rebuilt whenever Room
// changes: the users, the live items with their attachments, the settings,
// and the lookups the web UI's state.js keeps.
package io.github.lopezec007.planner.data.repo

import io.github.lopezec007.planner.data.model.AppSettings
import io.github.lopezec007.planner.data.model.ColorResolver
import io.github.lopezec007.planner.data.model.Group
import io.github.lopezec007.planner.data.model.Item
import io.github.lopezec007.planner.data.model.User

data class Snapshot(
    val users: List<User>,
    val items: List<Item>,            // sort order: parents then their tasks as the server lists them
    val settings: AppSettings,
    val loaded: Boolean,              // false until the first pull ever completed (or the DB has rows)
) {
    val usersById: Map<Long, User> = users.associateBy { it.id }
    val itemsById: Map<Long, Item> = items.associateBy { it.id }
    val childrenOf: Map<Long, List<Item>> = items.filter { it.parentId != null }.groupBy { it.parentId!! }
    val colors = ColorResolver(usersById, settings, itemsById)

    fun item(id: Long): Item? = itemsById[id]
    fun user(id: Long?): User? = id?.let { usersById[it] }

    /** Every parent with its tasks, in sort order (filters.js allGroups). */
    val groups: List<Group> by lazy {
        items.filter { it.parentId == null }.map { p -> Group(p, childrenOf[p.id] ?: emptyList()) }
    }

    /** "Blocked" as shown: the flag or an open blocker. */
    fun isBlocked(item: Item): Boolean = item.isBlocked { itemsById[it] }

    /** Dependency edges (blocker, blocked) among live items. */
    val dependencyEdges: List<Pair<Long, Long>> by lazy {
        items.flatMap { it -> it.blockedBy.filter { b -> b in itemsById }.map { b -> b to it.id } }
    }

    /** Whether adding blocker -> blocked would close a cycle (or is a self/ongoing edge). */
    fun wouldCycle(blockerId: Long, blockedId: Long): Boolean {
        if (blockerId == blockedId) return true
        // A cycle exists if blockerId is reachable from blockedId by following "blocks".
        val seen = HashSet<Long>()
        val stack = ArrayDeque<Long>().apply { add(blockedId) }
        while (stack.isNotEmpty()) {
            val cur = stack.removeLast()
            if (cur == blockerId) return true
            if (!seen.add(cur)) continue
            itemsById[cur]?.blocks?.forEach { stack.add(it) }
        }
        return false
    }

    companion object {
        val EMPTY = Snapshot(emptyList(), emptyList(), AppSettings.EMPTY, loaded = false)
    }
}
