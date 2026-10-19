# kotlinx.serialization: keep the generated serializers of our DTOs.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class io.github.lopezec007.planner.**$$serializer { *; }
-keepclassmembers class io.github.lopezec007.planner.** { *** Companion; }
-keepclasseswithmembers class io.github.lopezec007.planner.** { kotlinx.serialization.KSerializer serializer(...); }

# OkHttp
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
