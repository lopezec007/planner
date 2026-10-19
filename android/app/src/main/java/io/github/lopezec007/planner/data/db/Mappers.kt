// Conversions between wire DTOs, Room entities and the domain model.
package io.github.lopezec007.planner.data.db

import io.github.lopezec007.planner.data.api.AttachmentDto
import io.github.lopezec007.planner.data.api.ItemDto
import io.github.lopezec007.planner.data.api.StatusChangeDto
import io.github.lopezec007.planner.data.api.UserDto
import io.github.lopezec007.planner.data.model.Attachment
import io.github.lopezec007.planner.data.model.Dates
import io.github.lopezec007.planner.data.model.Item
import io.github.lopezec007.planner.data.model.ItemType
import io.github.lopezec007.planner.data.model.Status
import io.github.lopezec007.planner.data.model.StatusChange
import io.github.lopezec007.planner.data.model.User
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString

private val json = Json { ignoreUnknownKeys = true }

fun encodeIds(ids: List<Long>): String = json.encodeToString(ids)
fun decodeIds(s: String?): List<Long> = if (s.isNullOrBlank()) emptyList() else try { json.decodeFromString<List<Long>>(s) } catch (_: Exception) { emptyList() }

fun UserDto.toEntity() = UserEntity(id, name, color, short, created_at)
fun UserEntity.toModel() = User(id, name, color, short, createdAt)

fun AttachmentDto.toEntity() = AttachmentEntity(id, item_id, name, content_type, size, created_at)
fun AttachmentEntity.toModel() = Attachment(id, itemId, name, contentType, size, createdAt, pending = localPath != null)

fun ItemDto.toEntity() = ItemEntity(
    id = id, type = type, key = key, num = num, parentId = parent_id, title = title, description = description,
    ownerId = owner_id, assigneeId = assignee_id, status = status, startDate = start_date, startFirm = start_firm,
    endDate = end_date, endFirm = end_firm, urgency = urgency, importance = importance, blocked = blocked,
    color = color, sortOrder = sort_order, createdAt = created_at, updatedAt = updated_at, closedAt = closed_at,
    blockedBy = encodeIds(blocked_by), blocks = encodeIds(blocks),
)

fun ItemEntity.toModel(attachments: List<Attachment>): Item = Item(
    id = id, type = ItemType.fromWire(type), key = key, num = num, parentId = parentId, title = title,
    description = description, ownerId = ownerId, assigneeId = assigneeId, status = Status.fromWire(status),
    startDate = Dates.parse(startDate), startFirm = startFirm, endDate = Dates.parse(endDate), endFirm = endFirm,
    urgency = urgency, importance = importance, blocked = blocked, color = color, sortOrder = sortOrder,
    createdAt = createdAt, updatedAt = updatedAt, closedAt = closedAt,
    blockedBy = decodeIds(blockedBy), blocks = decodeIds(blocks), attachments = attachments,
)

fun StatusChangeDto.toEntity() = StatusHistoryEntity(id, item_id, status, changed_at)
fun StatusHistoryEntity.toModel(): StatusChange? = Status.fromWire(status)?.let { StatusChange(id, itemId, it, changedAt) }
