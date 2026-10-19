// A back stack of screens kept in Compose state; no Navigation library.
package io.github.lopezec007.planner.ui.nav

import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.snapshots.SnapshotStateList
import io.github.lopezec007.planner.data.model.ItemType

sealed class Screen {
    /** The list / timeline / matrix, with the shared toolbar. */
    object Home : Screen()
    data class Detail(val itemId: Long) : Screen()
    /** The form for a new Ongoing/Project (parentId null) or task. */
    data class New(val type: ItemType, val parentId: Long?) : Screen()
    object Settings : Screen()
    object Setup : Screen()
}

class Nav(start: Screen) {
    val stack: SnapshotStateList<Screen> = mutableStateListOf(start)
    val current: Screen get() = stack.last()
    val canGoBack: Boolean get() = stack.size > 1

    fun push(s: Screen) {
        stack.add(s)
    }

    /** Returns false when already at the root (the activity should finish). */
    fun pop(): Boolean {
        if (stack.size <= 1) return false
        stack.removeAt(stack.lastIndex)
        return true
    }

    /** Replaces the top screen (e.g. New -> Detail of the created item). */
    fun replace(s: Screen) {
        stack[stack.lastIndex] = s
    }

    fun reset(s: Screen) {
        stack.clear()
        stack.add(s)
    }
}
