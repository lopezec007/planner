// Calendar-day helpers. All date logic in the planner uses calendar days in
// the device's timezone (spec: "Today" is the user's day, never the server's).
package io.github.lopezec007.planner.data.model

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit

object Dates {
    private val ymd: DateTimeFormatter = DateTimeFormatter.ISO_LOCAL_DATE

    fun today(): LocalDate = LocalDate.now()

    /** YYYY-MM-DD -> LocalDate, null for null/blank/malformed. */
    fun parse(s: String?): LocalDate? {
        if (s.isNullOrBlank()) return null
        return try {
            LocalDate.parse(s.take(10), ymd)
        } catch (_: DateTimeParseException) {
            null
        }
    }

    fun format(d: LocalDate?): String? = d?.format(ymd)

    /** Whole calendar days from today to [d] (negative when past). */
    fun daysFromToday(d: LocalDate): Long = ChronoUnit.DAYS.between(today(), d)

    /** RFC 3339 timestamp -> the local calendar day it fell on, or null. */
    fun localDayOf(timestamp: String?): LocalDate? {
        if (timestamp.isNullOrBlank()) return null
        return try {
            Instant.parse(timestamp).atZone(ZoneId.systemDefault()).toLocalDate()
        } catch (_: Exception) {
            null
        }
    }

    /** The web UI's withinLastDays: the timestamp's local day is within the last [days] days (inclusive of today). */
    fun withinLastDays(timestamp: String?, days: Int): Boolean {
        if (days <= 0) return false
        val day = localDayOf(timestamp) ?: return false
        val diff = ChronoUnit.DAYS.between(day, today())
        return diff in 0 until days
    }

    /** Short human form: "Mon 3 Nov" this year, "3 Nov 2027" otherwise. */
    fun human(d: LocalDate?): String {
        if (d == null) return ""
        val fmt = if (d.year == today().year) DateTimeFormatter.ofPattern("EEE d MMM") else DateTimeFormatter.ofPattern("d MMM yyyy")
        return d.format(fmt)
    }
}
