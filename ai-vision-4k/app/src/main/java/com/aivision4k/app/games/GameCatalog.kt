package com.aivision4k.app.games

import com.aivision4k.sdk.DeviceCompatibility
import com.aivision4k.sdk.GraphicsProfile
import com.aivision4k.sdk.IntegrationKind
import com.aivision4k.sdk.QualityPreset
import com.aivision4k.sdk.UpscalingQuality

/**
 * A game we have a *suggested* starting profile for.
 *
 * Read the word "suggested" literally: these numbers come from what each title
 * is known to render at and from the resolution ladder the engine accepts. They
 * are a starting point for the sliders, not a benchmark result, and the app says
 * so wherever it shows them. Nothing here claims a title supports in-pipeline
 * upscaling — that is decided per game by [IntegrationKind], not by this table.
 */
data class KnownGame(
    val id: String,
    /** Package name of the most common build, when there is a canonical one. */
    val packageName: String,
    val title: String,
    /** Extra package names (regional builds) that should match this entry. */
    val packageHints: List<String>,
    /** Case-insensitive substrings matched against the launcher label. */
    val labelHints: List<String>,
    val recommended: GraphicsProfile,
    /** One honest sentence about why this profile looks like this. */
    val note: String,
)

object GameCatalog {

    /** The `1080p -> 4K` pair the dashboard offers as an explicit target. */
    fun genericTargets(device: DeviceCompatibility?): List<GraphicsProfile> {
        val maxOutput = if (device != null && device.recommendedOutputWidth >= 2560) {
            3840 to 2160
        } else {
            1920 to 1080
        }
        return listOf(
            profile(
                id = "generic-4k-60",
                name = "Generic \u00b7 1080p \u2192 4K @ 60",
                scale = 60,
                output = maxOutput,
                quality = UpscalingQuality.Medium,
                sharpeningPercent = 20,
                targetFps = 60,
                preset = QualityPreset.Balanced,
            ),
            profile(
                id = "generic-4k-30",
                name = "Generic \u00b7 1080p \u2192 4K @ 30",
                scale = 50,
                output = maxOutput,
                quality = UpscalingQuality.High,
                sharpeningPercent = 25,
                targetFps = 30,
                preset = QualityPreset.Quality,
            ),
        )
    }

    /** Device-aware default for a game we do not have a suggestion for. */
    fun deviceDefault(device: DeviceCompatibility?, packageName: String, title: String): GraphicsProfile {
        val output = if (device != null && device.recommendedOutputWidth > 0) {
            device.recommendedOutputWidth to device.recommendedOutputHeight
        } else {
            1920 to 1080
        }
        val scale = device?.recommendedRenderScalePercent?.takeIf { it > 0 } ?: 67
        val quality = device?.maximumAiQuality ?: UpscalingQuality.Medium
        return profile(
            id = packageName.ifEmpty { "default" },
            name = title.ifEmpty { "Balanced" },
            scale = scale,
            output = output,
            quality = quality,
            sharpeningPercent = 20,
            targetFps = 60,
            preset = QualityPreset.Balanced,
        ).copy(packageName = packageName, gameTitle = title, integration = device?.let { IntegrationKind.None } ?: IntegrationKind.None)
    }

    /** Catalog entry matching a package name, then a launcher label. */
    fun match(packageName: String, label: String): KnownGame? {
        known.firstOrNull { it.packageName == packageName }?.let { return it }
        known.firstOrNull { game -> game.packageHints.any { it == packageName } }?.let { return it }
        val lowered = label.lowercase()
        return known.firstOrNull { game ->
            game.labelHints.any { lowered.contains(it) }
        }
    }

    val known: List<KnownGame> = listOf(
        KnownGame(
            id = "pubg-mobile",
            packageName = "com.tencent.ig",
            title = "PUBG Mobile",
            packageHints = listOf("com.tencent.ig", "com.rekoo.pubgm"),
            labelHints = listOf("pubg"),
            recommended = profile(
                id = "pubg-mobile",
                name = "PUBG Mobile \u00b7 720p \u2192 1080p",
                scale = 67,
                output = 1920 to 1080,
                quality = UpscalingQuality.Medium,
                sharpeningPercent = 20,
                targetFps = 60,
                preset = QualityPreset.Performance,
                performanceMode = true,
            ),
            note = "Fast shooter: 60 FPS first, so a lower render resolution and a light AI pass.",
        ),
        KnownGame(
            id = "bgmi",
            packageName = "com.pubg.imobile",
            title = "BATTLEGROUNDS MOBILE INDIA",
            packageHints = listOf("com.pubg.imobile"),
            labelHints = listOf("bgmi", "battlegrounds"),
            recommended = profile(
                id = "bgmi",
                name = "BGMI \u00b7 720p \u2192 1080p",
                scale = 67,
                output = 1920 to 1080,
                quality = UpscalingQuality.Medium,
                sharpeningPercent = 20,
                targetFps = 60,
                preset = QualityPreset.Performance,
                performanceMode = true,
            ),
            note = "Same engine as PUBG Mobile, same 60 FPS-first trade-off.",
        ),
        KnownGame(
            id = "cod-mobile",
            packageName = "com.activision.callofduty.shooter",
            title = "Call of Duty: Mobile",
            packageHints = listOf("com.activision.callofduty.shooter", "com.garena.game.codm"),
            labelHints = listOf("call of duty", "cod mobile"),
            recommended = profile(
                id = "cod-mobile",
                name = "COD Mobile \u00b7 1080p \u2192 1440p",
                scale = 75,
                output = 2560 to 1440,
                quality = UpscalingQuality.Medium,
                sharpeningPercent = 25,
                targetFps = 60,
                preset = QualityPreset.Balanced,
            ),
            note = "Heavier than PUBG Mobile on GPU; sharpening helps the smoke and muzzle flash.",
        ),
        KnownGame(
            id = "free-fire",
            packageName = "com.dts.freefireth",
            title = "Free Fire",
            packageHints = listOf("com.dts.freefireth", "com.dts.freefiremax"),
            labelHints = listOf("free fire"),
            recommended = profile(
                id = "free-fire",
                name = "Free Fire \u00b7 1080p \u2192 1440p",
                scale = 75,
                output = 2560 to 1440,
                quality = UpscalingQuality.Low,
                sharpeningPercent = 15,
                targetFps = 60,
                preset = QualityPreset.Performance,
                performanceMode = true,
            ),
            note = "Upscaling is cheap here: the extra headroom goes into resolution.",
        ),
        KnownGame(
            id = "genshin",
            packageName = "com.miHoYo.GenshinImpact",
            title = "Genshin Impact",
            packageHints = listOf("com.miHoYo.GenshinImpact", "com.miHoYo.Yuanshen"),
            labelHints = listOf("genshin"),
            recommended = profile(
                id = "genshin",
                name = "Genshin Impact \u00b7 1080p \u2192 1440p",
                scale = 75,
                output = 2560 to 1440,
                quality = UpscalingQuality.High,
                sharpeningPercent = 15,
                targetFps = 60,
                preset = QualityPreset.Quality,
            ),
            note = "Open world with a lot of fine geometry: quality favours texture detail.",
        ),
        KnownGame(
            id = "star-rail",
            packageName = "com.HoYoverse.hkrpgoversea",
            title = "Honkai: Star Rail",
            packageHints = listOf("com.HoYoverse.hkrpgoversea", "com.miHoYo.hkrpg"),
            labelHints = listOf("star rail", "honkai"),
            recommended = profile(
                id = "star-rail",
                name = "Honkai: Star Rail \u00b7 1080p \u2192 1440p",
                scale = 83,
                output = 2560 to 1440,
                quality = UpscalingQuality.High,
                sharpeningPercent = 10,
                targetFps = 60,
                preset = QualityPreset.Quality,
            ),
            note = "Turn-based: the frame budget is generous, so render closer to native.",
        ),
        KnownGame(
            id = "mlbb",
            packageName = "com.mobile.legends",
            title = "Mobile Legends: Bang Bang",
            packageHints = listOf("com.mobile.legends", "com.mobilelegends.mi"),
            labelHints = listOf("mobile legends"),
            recommended = profile(
                id = "mlbb",
                name = "Mobile Legends \u00b7 1080p \u2192 1440p",
                scale = 75,
                output = 2560 to 1440,
                quality = UpscalingQuality.Medium,
                sharpeningPercent = 20,
                targetFps = 60,
                preset = QualityPreset.Balanced,
            ),
            note = "MOBA: stable frame time matters more than maximum detail.",
        ),
        KnownGame(
            id = "efootball",
            packageName = "jp.konami.pesam",
            title = "eFootball",
            packageHints = listOf("jp.konami.pesam", "com.konami.pesclub"),
            labelHints = listOf("efootball", "pes"),
            recommended = profile(
                id = "efootball",
                name = "eFootball \u00b7 1440p \u2192 4K",
                scale = 67,
                output = 3840 to 2160,
                quality = UpscalingQuality.High,
                sharpeningPercent = 15,
                targetFps = 60,
                preset = QualityPreset.Quality,
            ),
            note = "Slow camera, large flat surfaces: a good candidate for 4K output.",
        ),
        KnownGame(
            id = "asphalt9",
            packageName = "com.gameloft.android.ANMP.GloftA9HM",
            title = "Asphalt 9: Legends",
            packageHints = listOf("com.gameloft.android.ANMP.GloftA9HM"),
            labelHints = listOf("asphalt"),
            recommended = profile(
                id = "asphalt9",
                name = "Asphalt 9 \u00b7 1440p \u2192 4K",
                scale = 60,
                output = 3840 to 2160,
                quality = UpscalingQuality.Medium,
                sharpeningPercent = 25,
                targetFps = 60,
                preset = QualityPreset.Balanced,
            ),
            note = "Very fast motion: temporal reconstruction needs stable frame pacing.",
        ),
        KnownGame(
            id = "standoff2",
            packageName = "com.axlebolt.standoff2",
            title = "Standoff 2",
            packageHints = listOf("com.axlebolt.standoff2"),
            labelHints = listOf("standoff"),
            recommended = profile(
                id = "standoff2",
                name = "Standoff 2 \u00b7 720p \u2192 1080p",
                scale = 67,
                output = 1920 to 1080,
                quality = UpscalingQuality.Low,
                sharpeningPercent = 25,
                targetFps = 60,
                preset = QualityPreset.Performance,
                performanceMode = true,
            ),
            note = "Competitive shooter: latency beats detail, so the AI pass stays cheap.",
        ),
        KnownGame(
            id = "fortnite",
            packageName = "com.epicgames.fortnite",
            title = "Fortnite",
            packageHints = listOf("com.epicgames.fortnite"),
            labelHints = listOf("fortnite"),
            recommended = profile(
                id = "fortnite",
                name = "Fortnite \u00b7 720p \u2192 1080p",
                scale = 67,
                output = 1920 to 1080,
                quality = UpscalingQuality.Low,
                sharpeningPercent = 20,
                targetFps = 60,
                preset = QualityPreset.Performance,
                performanceMode = true,
            ),
            note = "Heavy title: expect to need the frame-rate limiter before raising quality.",
        ),
        KnownGame(
            id = "minecraft",
            packageName = "com.mojang.minecraftpe",
            title = "Minecraft",
            packageHints = listOf("com.mojang.minecraftpe"),
            labelHints = listOf("minecraft"),
            recommended = profile(
                id = "minecraft",
                name = "Minecraft \u00b7 1440p \u2192 4K",
                scale = 75,
                output = 3840 to 2160,
                quality = UpscalingQuality.High,
                sharpeningPercent = 0,
                targetFps = 60,
                preset = QualityPreset.Quality,
            ),
            note = "Blocky geometry: sharpening only adds ringing, so it is off.",
        ),
        KnownGame(
            id = "roblox",
            packageName = "com.roblox.client",
            title = "Roblox",
            packageHints = listOf("com.roblox.client"),
            labelHints = listOf("roblox"),
            recommended = profile(
                id = "roblox",
                name = "Roblox \u00b7 1080p \u2192 1440p",
                scale = 67,
                output = 2560 to 1440,
                quality = UpscalingQuality.Medium,
                sharpeningPercent = 15,
                targetFps = 60,
                preset = QualityPreset.Balanced,
            ),
            note = "Highly variable scenes; dynamic resolution is left on.",
        ),
        KnownGame(
            id = "brawl-stars",
            packageName = "com.supercell.brawlstars",
            title = "Brawl Stars",
            packageHints = listOf("com.supercell.brawlstars"),
            labelHints = listOf("brawl stars"),
            recommended = profile(
                id = "brawl-stars",
                name = "Brawl Stars \u00b7 1080p \u2192 1440p",
                scale = 83,
                output = 2560 to 1440,
                quality = UpscalingQuality.Medium,
                sharpeningPercent = 10,
                targetFps = 60,
                preset = QualityPreset.Balanced,
            ),
            note = "Light renderer, wide colour areas: a high render scale is affordable.",
        ),
        KnownGame(
            id = "clash-royale",
            packageName = "com.supercell.clashroyale",
            title = "Clash Royale",
            packageHints = listOf("com.supercell.clashroyale"),
            labelHints = listOf("clash royale"),
            recommended = profile(
                id = "clash-royale",
                name = "Clash Royale \u00b7 1080p \u2192 1440p",
                scale = 83,
                output = 2560 to 1440,
                quality = UpscalingQuality.Medium,
                sharpeningPercent = 10,
                targetFps = 60,
                preset = QualityPreset.Balanced,
            ),
            note = "Card UI is text-heavy: keep AA on so the cards stay legible.",
        ),
        KnownGame(
            id = "arena-of-valor",
            packageName = "com.garena.game.kgvn",
            title = "Arena of Valor",
            packageHints = listOf("com.garena.game.kgvn", "com.tencent.tmgp.sgame"),
            labelHints = listOf("arena of valor", "honor of kings"),
            recommended = profile(
                id = "arena-of-valor",
                name = "Arena of Valor \u00b7 1080p \u2192 1440p",
                scale = 75,
                output = 2560 to 1440,
                quality = UpscalingQuality.Medium,
                sharpeningPercent = 20,
                targetFps = 60,
                preset = QualityPreset.Balanced,
            ),
            note = "Team fights: the temporal stage is what keeps the effect field stable.",
        ),
    )

    private fun profile(
        id: String,
        name: String,
        scale: Int,
        output: Pair<Int, Int>,
        quality: UpscalingQuality,
        sharpeningPercent: Int,
        targetFps: Int,
        preset: QualityPreset,
        performanceMode: Boolean = false,
    ) = GraphicsProfile(
        id = id,
        name = name,
        renderScalePercent = scale,
        outputWidth = output.first,
        outputHeight = output.second,
        aiUpscaling = quality != UpscalingQuality.Off,
        aiQuality = quality,
        sharpening = (sharpeningPercent / 100.0f),
        noiseReduction = when (quality) {
            UpscalingQuality.Off -> 0.0f
            UpscalingQuality.Low -> 0.08f
            UpscalingQuality.Medium -> 0.15f
            UpscalingQuality.High -> 0.20f
            UpscalingQuality.Ultra -> 0.25f
        },
        antiAliasing = true,
        motionAware = true,
        dynamicResolution = true,
        targetFps = targetFps,
        performanceMode = performanceMode,
        batteryMode = false,
        thermalGuard = true,
        preset = preset,
        integration = IntegrationKind.None,
    )
}
