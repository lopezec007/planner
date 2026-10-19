// Wire types, named exactly as the server's JSON (snake_case kept on
// purpose so the mapping to store.go is obvious).
package io.github.lopezec007.planner.data.api

import kotlinx.serialization.Serializable

@Serializable
data class UserDto(
    val id: Long,
    val name: String,
    val color: String = "",
    val short: String = "",
    val created_at: String = "",
)

@Serializable
data class AttachmentDto(
    val id: Long,
    val item_id: Long,
    val name: String,
    val content_type: String = "",
    val size: Long = 0,
    val created_at: String = "",
)

@Serializable
data class ItemDto(
    val id: Long,
    val type: String,
    val key: String = "",
    val num: Long = 0,
    val parent_id: Long? = null,
    val title: String = "",
    val description: String = "",
    val owner_id: Long? = null,
    val assignee_id: Long? = null,
    val status: String? = null,
    val start_date: String? = null,
    val start_firm: Boolean = false,
    val end_date: String? = null,
    val end_firm: Boolean = false,
    val urgency: Int? = null,
    val importance: Int? = null,
    val blocked: Boolean = false,
    val color: String = "",
    val sort_order: Long = 0,
    val created_at: String = "",
    val updated_at: String = "",
    val closed_at: String? = null,
    val blocked_by: List<Long> = emptyList(),
    val blocks: List<Long> = emptyList(),
    val attachments: List<AttachmentDto> = emptyList(),
)

@Serializable
data class StatusChangeDto(
    val id: Long,
    val item_id: Long,
    val status: String,
    val changed_at: String,
)

@Serializable
data class VersionDto(
    val version: String = "",
    val date: String = "",
    val build: String = "",
)

@Serializable
data class ErrorDto(val error: String = "")
