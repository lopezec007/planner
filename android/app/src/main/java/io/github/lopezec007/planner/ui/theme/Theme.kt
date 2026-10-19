// Material 3 theme following the system light/dark setting (the spec allows
// no manual override). Dynamic colour is off so the planner's own colours
// (users, Ongoing/Project tints, urgency ramps) stay legible against a
// neutral surface.
package io.github.lopezec007.planner.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/** Colours the web UI uses that are not part of the Material scheme. */
data class PlannerPalette(
    val accent: Color,       // links, selected chips
    val alert: Color,        // open-blocker connectors, overdue
    val warn: Color,         // due within a week, urgency 6-8
    val danger: Color,       // overdue, urgency 9-10
    val blockedMask: Color,  // laid over blocked rows
    val subtle: Color,       // secondary text
    val rowBorder: Color,
    val parentBorder: Color, // the heavier border above a parent row
    val todayLine: Color,
)

val LocalPalette = staticCompositionLocalOf {
    PlannerPalette(
        accent = Color(0xFF3B7DD8), alert = Color(0xFFE5484D), warn = Color(0xFFF5A524), danger = Color(0xFFE5484D),
        blockedMask = Color(0x66FFFFFF), subtle = Color(0xFF6B7280), rowBorder = Color(0xFFE5E7EB),
        parentBorder = Color(0xFF9CA3AF), todayLine = Color(0xFFE5484D),
    )
}

private val LightScheme: ColorScheme = lightColorScheme(
    primary = Color(0xFF1F7A70),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFBDEDE5),
    onPrimaryContainer = Color(0xFF00201C),
    secondary = Color(0xFF4A5FC1),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFDEE0FF),
    onSecondaryContainer = Color(0xFF000F5C),
    background = Color(0xFFF9FAFB),
    onBackground = Color(0xFF111827),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF111827),
    surfaceVariant = Color(0xFFEEF0F3),
    onSurfaceVariant = Color(0xFF4B5563),
    outline = Color(0xFF9CA3AF),
    error = Color(0xFFB3261E),
)

private val DarkScheme: ColorScheme = darkColorScheme(
    primary = Color(0xFF6ED4C6),
    onPrimary = Color(0xFF003731),
    primaryContainer = Color(0xFF005048),
    onPrimaryContainer = Color(0xFFBDEDE5),
    secondary = Color(0xFFBBC3FF),
    onSecondary = Color(0xFF13268E),
    secondaryContainer = Color(0xFF3042A8),
    onSecondaryContainer = Color(0xFFDEE0FF),
    background = Color(0xFF0F1115),
    onBackground = Color(0xFFE5E7EB),
    surface = Color(0xFF16191F),
    onSurface = Color(0xFFE5E7EB),
    surfaceVariant = Color(0xFF262A33),
    onSurfaceVariant = Color(0xFFB4BAC6),
    outline = Color(0xFF6B7280),
    error = Color(0xFFF2B8B5),
)

private val LightPalette = PlannerPalette(
    accent = Color(0xFF3B7DD8), alert = Color(0xFFE5484D), warn = Color(0xFFF5A524), danger = Color(0xFFE5484D),
    blockedMask = Color(0x80F9FAFB), subtle = Color(0xFF6B7280), rowBorder = Color(0xFFE5E7EB),
    parentBorder = Color(0xFF9CA3AF), todayLine = Color(0xFFE5484D),
)

private val DarkPalette = PlannerPalette(
    accent = Color(0xFF7FB0F0), alert = Color(0xFFF26D71), warn = Color(0xFFF7B955), danger = Color(0xFFF26D71),
    blockedMask = Color(0x800F1115), subtle = Color(0xFF9CA3AF), rowBorder = Color(0xFF2A2F3A),
    parentBorder = Color(0xFF4B5563), todayLine = Color(0xFFF26D71),
)

@Composable
fun PlannerTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    androidx.compose.runtime.CompositionLocalProvider(LocalPalette provides if (dark) DarkPalette else LightPalette) {
        MaterialTheme(colorScheme = if (dark) DarkScheme else LightScheme, content = content)
    }
}

/** "#rrggbb" to a Compose colour; [fallback] for blank or malformed input. */
fun hexColor(hex: String?, fallback: Color = Color.Unspecified): Color {
    if (hex.isNullOrBlank() || !hex.startsWith("#") || hex.length != 7) return fallback
    val n = hex.substring(1).toLongOrNull(16) ?: return fallback
    return Color(0xFF000000L or n)
}

/** Black or white text over [bg], like util.js contrastText. */
fun contrastOn(bg: Color): Color {
    val lum = 0.299f * bg.red + 0.587f * bg.green + 0.114f * bg.blue
    return if (lum > 0.6f) Color.Black else Color.White
}
