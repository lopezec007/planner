// The daily due-date notification: its channel, the WorkManager schedule and
// the notification itself, built from Room alone (no network). The bucketing
// and wording helpers are top-level internal functions so a plain JVM test
// can call them without Android.
package io.github.lopezec007.planner.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import io.github.lopezec007.planner.MainActivity
import io.github.lopezec007.planner.PlannerApp
import io.github.lopezec007.planner.R
import io.github.lopezec007.planner.data.db.toModel
import io.github.lopezec007.planner.data.model.Dates
import io.github.lopezec007.planner.data.model.Item
import io.github.lopezec007.planner.data.model.ItemType
import java.time.Duration
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit

class DueNotifier(private val context: Context) {

    /** The notification channel; creating an existing channel again is a no-op. */
    fun ensureChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notification_channel_due),
            NotificationManager.IMPORTANCE_DEFAULT,
        )
        channel.description = context.getString(R.string.notification_channel_due_desc)
        NotificationManagerCompat.from(context).createNotificationChannel(channel)
    }

    /**
     * (Re)schedules the daily run at [hour]:[minute] local time, or cancels it.
     *
     * Periodic work is not exact: WorkManager may run it minutes to an hour
     * late and the period drifts with each late run. That is acceptable for
     * a once-a-day summary, and every app start calls this again (the Graph
     * collects the prefs), which pins the next run back onto the chosen time.
     */
    fun schedule(enabled: Boolean, hour: Int, minute: Int) {
        val wm = WorkManager.getInstance(context)
        if (!enabled) {
            wm.cancelUniqueWork(DAILY_WORK)
            return
        }
        val now = ZonedDateTime.now()
        val next = nextOccurrence(hour, minute, now)
        val delay = Duration.between(now, next)
        val req = PeriodicWorkRequestBuilder<DueWorker>(24, TimeUnit.HOURS)
            // The initial delay counts only for a request that has never run;
            // the override is what moves an already-running schedule to the
            // new time under UPDATE (the first run clears it, after which the
            // 24h period applies from that run).
            .setInitialDelay(delay.toMillis(), TimeUnit.MILLISECONDS)
            .setNextScheduleTimeOverride(next.toInstant().toEpochMilli())
            .build()
        wm.enqueueUniquePeriodicWork(DAILY_WORK, ExistingPeriodicWorkPolicy.UPDATE, req)
    }

    /**
     * Builds and posts the notification from the local database, or takes it
     * down when notifications are off or nothing is due. Used by [DueWorker];
     * also what a "test notification" button would call.
     */
    suspend fun postNow() {
        val graph = PlannerApp.graph(context)
        val manager = NotificationManagerCompat.from(context)
        val prefs = graph.prefs.current()
        if (!prefs.notifyEnabled) {
            manager.cancel(NOTIFICATION_ID)
            return
        }
        val today = Dates.today()
        val items = graph.db.items().live().map { it.toModel(emptyList()) }
        val summary = summarize(items, prefs.accountId, today)
        if (summary.isEmpty) {
            manager.cancel(NOTIFICATION_ID)
            return
        }
        val all = summary.all

        val open = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (all.size == 1) putExtra(EXTRA_ITEM_ID, all[0].id)
        }
        val tap = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            open,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val style = NotificationCompat.InboxStyle()
        all.take(MAX_LINES).forEach { style.addLine(lineFor(it, today)) }
        if (all.size > MAX_LINES) style.setSummaryText("+${all.size - MAX_LINES} more")

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(titleFor(summary))
            .setContentText(contentFor(all[0], today))
            .setStyle(style)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .build()

        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) return
        try {
            manager.notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // The permission was revoked between the check and the post.
        }
    }

    companion object {
        /** Long extra on the launch intent: the item to open (set when exactly one is due). */
        const val EXTRA_ITEM_ID = "item_id"
        const val CHANNEL_ID = "due"
        const val DAILY_WORK = "planner-due-daily"
        const val NOTIFICATION_ID = 1
        const val MAX_LINES = 6
    }
}

/** The due items in their three buckets, each sorted by end date (overdue first overall). */
data class DueSummary(
    val overdue: List<Item>,
    val today: List<Item>,
    val week: List<Item>,
) {
    val isEmpty: Boolean get() = overdue.isEmpty() && today.isEmpty() && week.isEmpty()

    /** Every due item, overdue first, then by end date. */
    val all: List<Item> get() = overdue + today + week
}

/**
 * Picks the account's open projects and tasks with an end date and buckets
 * them: overdue (before [today]), due today, or due within the next 7 days.
 * "Mine" is assigned to the account, or unassigned and owned by it; a null
 * [accountId] counts every item.
 */
internal fun summarize(items: List<Item>, accountId: Long?, today: LocalDate): DueSummary {
    val mine = items.asSequence()
        .filter { it.type != ItemType.ONGOING && !it.isClosed && it.endDate != null }
        .filter { accountId == null || isMine(it, accountId) }
        .sortedWith(compareBy<Item> { it.endDate }.thenBy { it.id })
        .toList()
    val overdue = ArrayList<Item>()
    val due = ArrayList<Item>()
    val week = ArrayList<Item>()
    for (item in mine) {
        val end = item.endDate ?: continue
        val days = ChronoUnit.DAYS.between(today, end)
        when {
            days < 0 -> overdue.add(item)
            days == 0L -> due.add(item)
            days <= 7 -> week.add(item)
        }
    }
    return DueSummary(overdue, due, week)
}

private fun isMine(item: Item, accountId: Long): Boolean =
    item.assigneeId == accountId || (item.assigneeId == null && item.ownerId == accountId)

/** "3 overdue, 1 due today, 2 this week": only the non-zero parts. */
internal fun titleFor(s: DueSummary): String {
    val parts = ArrayList<String>(3)
    if (s.overdue.isNotEmpty()) parts.add("${s.overdue.size} overdue")
    if (s.today.isNotEmpty()) parts.add("${s.today.size} due today")
    if (s.week.isNotEmpty()) parts.add("${s.week.size} this week")
    return parts.joinToString(", ")
}

/** "overdue 3 days", "due today", "in 1 day". */
internal fun dueText(item: Item, today: LocalDate): String {
    val end = item.endDate ?: return ""
    val days = ChronoUnit.DAYS.between(today, end)
    return when {
        days < 0 -> "overdue ${plural(-days, "day")}"
        days == 0L -> "due today"
        else -> "in ${plural(days, "day")}"
    }
}

/** One InboxStyle line: "T-12 Clean exhaust vents · overdue 3 days". */
internal fun lineFor(item: Item, today: LocalDate): String = "${keyAndTitle(item)} · ${dueText(item, today)}"

/** The collapsed content text: "T-12 Clean exhaust vents — overdue 3 days". */
internal fun contentFor(item: Item, today: LocalDate): String = "${keyAndTitle(item)} — ${dueText(item, today)}"

private fun keyAndTitle(item: Item): String = listOf(item.key, item.title).filter { it.isNotBlank() }.joinToString(" ")

private fun plural(n: Long, unit: String): String = if (n == 1L) "1 $unit" else "$n ${unit}s"

/** The next [hour]:[minute] in [now]'s zone: today if still ahead, else tomorrow. */
internal fun nextOccurrence(hour: Int, minute: Int, now: ZonedDateTime): ZonedDateTime {
    val time = LocalTime.of(hour.coerceIn(0, 23), minute.coerceIn(0, 59))
    val today = ZonedDateTime.of(now.toLocalDate(), time, now.zone)
    return if (today.isAfter(now)) today else ZonedDateTime.of(now.toLocalDate().plusDays(1), time, now.zone)
}
