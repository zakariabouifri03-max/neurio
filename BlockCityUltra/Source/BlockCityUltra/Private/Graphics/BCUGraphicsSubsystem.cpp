// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Graphics/BCUGraphicsSubsystem.h"

#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Engine/World.h"
#include "HAL/PlatformMisc.h"
#include "HAL/PlatformProcess.h"
#include "Interfaces/IPluginManager.h"
#include "Misc/ConfigCacheIni.h"
#include "RHI.h"
#include "RHIDefinitions.h"
#include "ShaderPlatformQualitySettings.h"
#include "Engine/Scalability.h"
#include "DynamicResolutionStatus.h"
#include "GameFramework/GameUserSettings.h"
#include "TimerManager.h"
#include "UnrealClient.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUGraphics, Log, All);

namespace BCUGraphics
{
	static const TCHAR* ScalabilityGroupNames[] =
	{
		TEXT("sg.ResolutionQuality"),
		TEXT("sg.ViewDistanceQuality"),
		TEXT("sg.AntiAliasingQuality"),
		TEXT("sg.ShadowQuality"),
		TEXT("sg.GlobalIlluminationQuality"),
		TEXT("sg.ReflectionQuality"),
		TEXT("sg.PostProcessQuality"),
		TEXT("sg.TextureQuality"),
		TEXT("sg.EffectsQuality"),
		TEXT("sg.FoliageQuality"),
		TEXT("sg.ShadingQuality")
	};

	static FString GroupNameFor(EBCUQualityPreset Preset)
	{
		switch (Preset)
		{
		case EBCUQualityPreset::Performance:	return TEXT("0");
		case EBCUQualityPreset::Balanced:		return TEXT("1");
		case EBCUQualityPreset::Quality:		return TEXT("2");
		case EBCUQualityPreset::Ultra:			return TEXT("3");
		default:								return TEXT("2");
		}
	}

	static bool ConsoleVariableExists(const TCHAR* Name)
	{
		return IConsoleManager::Get().FindConsoleVariable(Name) != nullptr
			|| IConsoleManager::Get().FindConsoleCommand(Name) != nullptr;
	}
}

void UBCUGraphicsSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	ProbeHardwareCapabilities();

	// Clamp the persisted settings to what this machine can actually do, so a
	// save copied from a 5090 rig does not try to run Full RT on an iGPU.
	if (Settings.Upscaler == EBCUUpscalerMode::DLSS_SR_FG && !bFrameGenerationAvailable)
	{
		Settings.Upscaler = bDLSSAvailable ? EBCUUpscalerMode::DLSS_SR : EBCUUpscalerMode::TSR;
	}
	else if (Settings.Upscaler == EBCUUpscalerMode::DLSS_SR && !bDLSSAvailable)
	{
		Settings.Upscaler = EBCUUpscalerMode::TSR;
	}

	if (Settings.RayTracing != EBCURayTracingMode::Off && !bHardwareRayTracingAvailable)
	{
		Settings.RayTracing = EBCURayTracingMode::Off;
	}

	UE_LOG(LogBCUGraphics, Log,
		TEXT("GPU='%s' VRAM=%dMB DLSS=%d FG=%d HWRT=%d Nanite=%d → recommended preset %d"),
		*DetectedAdapterName, DetectedVRAM_MB, bDLSSAvailable ? 1 : 0,
		bFrameGenerationAvailable ? 1 : 0, bHardwareRayTracingAvailable ? 1 : 0,
		bNaniteSupported ? 1 : 0, static_cast<int32>(GetRecommendedPreset()));
}

void UBCUGraphicsSubsystem::Deinitialize()
{
	if (OnFrameReadyHandle.IsValid() && GEngine && GEngine->GameViewport)
	{
		GEngine->GameViewport->OnFrameReadyDelegate().Remove(OnFrameReadyHandle);
		OnFrameReadyHandle.Reset();
	}

	Super::Deinitialize();
}

void UBCUGraphicsSubsystem::ApplySavedSettings()
{
	PushSettingsToWorld();
}

void UBCUGraphicsSubsystem::ApplyPreset(EBCUQualityPreset Preset, bool bPersist)
{
	if (Preset == EBCUQualityPreset::Custom)
	{
		// "Custom" is a state, not a target — nothing to push.
		Settings.Preset = EBCUQualityPreset::Custom;
		OnGraphicsChanged.Broadcast(Settings);
		return;
	}

	Settings.Preset = Preset;

	// Clear every manual override so the preset is authoritative again.
	FBCUScalabilityOverrides Clean;
	Settings.Overrides = Clean;

	// Presets also imply sensible upscaler / RT / resolution choices.
	switch (Preset)
	{
	case EBCUQualityPreset::Performance:
		Settings.Upscaler = bDLSSAvailable ? EBCUUpscalerMode::DLSS_SR : EBCUUpscalerMode::TSR;
		Settings.UpscalerQuality = 0.42f;      // aggressive — Performance mode
		Settings.RayTracing = EBCURayTracingMode::Off;
		Settings.bDynamicResolution = true;
		Settings.DynamicResolutionMinPercent = 55.0f;
		Settings.bMotionBlur = false;
		Settings.ResolutionTarget = EBCUResolutionTarget::R1080p;
		break;

	case EBCUQualityPreset::Balanced:
		Settings.Upscaler = bDLSSAvailable ? EBCUUpscalerMode::DLSS_SR : EBCUUpscalerMode::TSR;
		Settings.UpscalerQuality = 0.58f;
		Settings.RayTracing = EBCURayTracingMode::Off;
		Settings.bDynamicResolution = true;
		Settings.DynamicResolutionMinPercent = 66.0f;
		Settings.bMotionBlur = true;
		Settings.ResolutionTarget = EBCUResolutionTarget::R1080p;
		break;

	case EBCUQualityPreset::Quality:
		Settings.Upscaler = bDLSSAvailable ? EBCUUpscalerMode::DLSS_SR : EBCUUpscalerMode::TSR;
		Settings.UpscalerQuality = 0.75f;
		Settings.RayTracing = bHardwareRayTracingAvailable ? EBCURayTracingMode::Reflections : EBCURayTracingMode::Off;
		Settings.bDynamicResolution = true;
		Settings.DynamicResolutionMinPercent = 78.0f;
		Settings.bMotionBlur = true;
		Settings.ResolutionTarget = EBCUResolutionTarget::R1440p;
		break;

	case EBCUQualityPreset::Ultra:
		// Frame Generation only when the plugin *and* the GPU support it.
		Settings.Upscaler = bFrameGenerationAvailable ? EBCUUpscalerMode::DLSS_SR_FG
			: (bDLSSAvailable ? EBCUUpscalerMode::DLSS_SR : EBCUUpscalerMode::TSR);
		Settings.UpscalerQuality = 1.0f;       // native-quality render scale
		Settings.RayTracing = bHardwareRayTracingAvailable ? EBCURayTracingMode::Full : EBCURayTracingMode::Off;
		Settings.bDynamicResolution = false;   // benchmark preset: fixed scale
		Settings.bMotionBlur = true;
		Settings.bFilmGrain = true;
		Settings.ResolutionTarget = EBCUResolutionTarget::R4K;
		break;

	default:
		break;
	}

	PushSettingsToWorld();

	if (bPersist)
	{
		PersistSettings();
	}

	OnGraphicsChanged.Broadcast(Settings);
	UE_LOG(LogBCUGraphics, Log, TEXT("Applied preset %s"), *UEnum::GetValueAsString(Settings.Preset));
}

void UBCUGraphicsSubsystem::ApplySettings(const FBCUGraphicsSettings& NewSettings, bool bPersist)
{
	Settings = NewSettings;

	// Re-clamp against capability so the menu cannot request the impossible.
	if (!bDLSSAvailable && (Settings.Upscaler == EBCUUpscalerMode::DLSS_SR
		|| Settings.Upscaler == EBCUUpscalerMode::DLSS_SR_FG))
	{
		Settings.Upscaler = EBCUUpscalerMode::TSR;
	}
	if (!bFrameGenerationAvailable && Settings.Upscaler == EBCUUpscalerMode::DLSS_SR_FG)
	{
		Settings.Upscaler = EBCUUpscalerMode::DLSS_SR;
	}
	if (!bHardwareRayTracingAvailable && Settings.RayTracing != EBCURayTracingMode::Off)
	{
		Settings.RayTracing = EBCURayTracingMode::Off;
	}

	Settings.Preset = EBCUQualityPreset::Custom;

	PushSettingsToWorld();

	if (bPersist)
	{
		PersistSettings();
	}

	OnGraphicsChanged.Broadcast(Settings);
}

void UBCUGraphicsSubsystem::SetResolutionTarget(EBCUResolutionTarget Target)
{
	Settings.ResolutionTarget = Target;
	ApplyResolutionAndFrameRate();
	PersistSettings();
	OnGraphicsChanged.Broadcast(Settings);
}

void UBCUGraphicsSubsystem::SetFrameRateTarget(EBCUFrameRateTarget Target)
{
	Settings.FrameRateTarget = Target;
	ApplyResolutionAndFrameRate();
	PersistSettings();
	OnGraphicsChanged.Broadcast(Settings);
}

void UBCUGraphicsSubsystem::SetUpscalerMode(EBCUUpscalerMode Mode)
{
	if ((Mode == EBCUUpscalerMode::DLSS_SR || Mode == EBCUUpscalerMode::DLSS_SR_FG) && !bDLSSAvailable)
	{
		UE_LOG(LogBCUGraphics, Warning, TEXT("DLSS requested but not available on this system; keeping TSR."));
		return;
	}
	if (Mode == EBCUUpscalerMode::DLSS_SR_FG && !bFrameGenerationAvailable)
	{
		Mode = EBCUUpscalerMode::DLSS_SR;
	}

	Settings.Upscaler = Mode;
	Settings.Preset = EBCUQualityPreset::Custom;
	ApplyUpscaler();
	PersistSettings();
	OnGraphicsChanged.Broadcast(Settings);
}

void UBCUGraphicsSubsystem::SetRayTracingMode(EBCURayTracingMode Mode)
{
	if (Mode != EBCURayTracingMode::Off && !bHardwareRayTracingAvailable)
	{
		UE_LOG(LogBCUGraphics, Warning, TEXT("Hardware ray tracing requested but unsupported; staying off."));
		return;
	}

	Settings.RayTracing = Mode;
	Settings.Preset = EBCUQualityPreset::Custom;
	ApplyRayTracing();
	PersistSettings();
	OnGraphicsChanged.Broadcast(Settings);
}

void UBCUGraphicsSubsystem::SetScalabilityOverride(const FName& Category, int32 Level)
{
	const int32 Clamped = FMath::Clamp(Level, -1, 3);
	FBCUScalabilityOverrides& O = Settings.Overrides;
	bool bFound = true;

	const FString Name = Category.ToString();
	if		(Name == TEXT("ViewDistance"))		O.ViewDistance = Clamped;
	else if (Name == TEXT("Shadows"))			O.Shadows = Clamped;
	else if (Name == TEXT("Reflections"))		O.Reflections = Clamped;
	else if (Name == TEXT("GlobalIllumination"))O.GlobalIllumination = Clamped;
	else if (Name == TEXT("PostProcess"))		O.PostProcess = Clamped;
	else if (Name == TEXT("Textures"))			O.Textures = Clamped;
	else if (Name == TEXT("Effects"))			O.Effects = Clamped;
	else if (Name == TEXT("Vegetation"))		O.Vegetation = Clamped;
	else if (Name == TEXT("AntiAliasing"))		O.AntiAliasing = Clamped;
	else if (Name == TEXT("CityDetail"))		O.CityDetail = Clamped;
	else if (Name == TEXT("VoxelDetail"))		O.VoxelDetail = Clamped;
	else if (Name == TEXT("TrafficDensity"))	O.TrafficDensity = Clamped;
	else if (Name == TEXT("WeatherDetail"))		O.WeatherDetail = Clamped;
	else										bFound = false;

	if (!bFound)
	{
		UE_LOG(LogBCUGraphics, Warning, TEXT("Unknown scalability category '%s'"), *Name);
		return;
	}

	Settings.Preset = EBCUQualityPreset::Custom;
	PushSettingsToWorld();
	PersistSettings();
	OnGraphicsChanged.Broadcast(Settings);
}

//═══════════════════════════════════════════════════════════════════════════════
// Application
//═══════════════════════════════════════════════════════════════════════════════

void UBCUGraphicsSubsystem::PushSettingsToWorld()
{
	ApplyScalabilityGroups(Settings.Preset, Settings.Overrides);
	ApplyUpscaler();
	ApplyRayTracing();
	ApplyResolutionAndFrameRate();
	ApplyDynamicResolution();

	// Post-process toggles that are not scalability groups.
	UObject* Ctx = GEngine;
	ExecCmd(Ctx, Settings.bMotionBlur ? TEXT("r.MotionBlurQuality 3") : TEXT("r.MotionBlurQuality 0"));
	ExecCmd(Ctx, Settings.bFilmGrain ? TEXT("r.Tonemapper.GrainQuantization 1") : TEXT("r.Tonemapper.GrainQuantization 0"));
	ExecCmd(Ctx, FString::Printf(TEXT("r.DefaultFeature.LensFlare %d"), 1));

	if (UGameUserSettings* UserSettings = GEngine ? GEngine->GetGameUserSettings() : nullptr)
	{
		UserSettings->SetFOVAngle(Settings.BaseFOV);
		UserSettings->ApplyNonResolutionSettings();
	}
}

void UBCUGraphicsSubsystem::ApplyScalabilityGroups(EBCUQualityPreset Preset, const FBCUScalabilityOverrides& Overrides)
{
	UObject* Ctx = GEngine;
	const FString Group = BCUGraphics::GroupNameFor(Preset);

	// Engine groups.
	ExecCmd(Ctx, FString::Printf(TEXT("sg.ResolutionQuality %s"), *Group));
	ExecCmd(Ctx, FString::Printf(TEXT("sg.ViewDistanceQuality %s"),
		Overrides.ViewDistance >= 0 ? *FString::FromInt(Overrides.ViewDistance) : *Group));
	ExecCmd(Ctx, FString::Printf(TEXT("sg.AntiAliasingQuality %s"),
		Overrides.AntiAliasing >= 0 ? *FString::FromInt(Overrides.AntiAliasing) : *Group));
	ExecCmd(Ctx, FString::Printf(TEXT("sg.ShadowQuality %s"),
		Overrides.Shadows >= 0 ? *FString::FromInt(Overrides.Shadows) : *Group));
	ExecCmd(Ctx, FString::Printf(TEXT("sg.GlobalIlluminationQuality %s"),
		Overrides.GlobalIllumination >= 0 ? *FString::FromInt(Overrides.GlobalIllumination) : *Group));
	ExecCmd(Ctx, FString::Printf(TEXT("sg.ReflectionQuality %s"),
		Overrides.Reflections >= 0 ? *FString::FromInt(Overrides.Reflections) : *Group));
	ExecCmd(Ctx, FString::Printf(TEXT("sg.PostProcessQuality %s"),
		Overrides.PostProcess >= 0 ? *FString::FromInt(Overrides.PostProcess) : *Group));
	ExecCmd(Ctx, FString::Printf(TEXT("sg.TextureQuality %s"),
		Overrides.Textures >= 0 ? *FString::FromInt(Overrides.Textures) : *Group));
	ExecCmd(Ctx, FString::Printf(TEXT("sg.EffectsQuality %s"),
		Overrides.Effects >= 0 ? *FString::FromInt(Overrides.Effects) : *Group));
	ExecCmd(Ctx, FString::Printf(TEXT("sg.FoliageQuality %s"),
		Overrides.Vegetation >= 0 ? *FString::FromInt(Overrides.Vegetation) : *Group));
	ExecCmd(Ctx, FString::Printf(TEXT("sg.ShadingQuality %s"), *Group));

	// BCU groups — declared in Config/DefaultScalability.ini so the city,
	// voxel, traffic and weather budgets scale independently of the engine.
	const FString CityGroup = Overrides.CityDetail >= 0 ? FString::FromInt(Overrides.CityDetail) : Group;
	const FString VoxelGroup = Overrides.VoxelDetail >= 0 ? FString::FromInt(Overrides.VoxelDetail) : Group;
	const FString TrafficGroup = Overrides.TrafficDensity >= 0 ? FString::FromInt(Overrides.TrafficDensity) : Group;
	const FString WeatherGroup = Overrides.WeatherDetail >= 0 ? FString::FromInt(Overrides.WeatherDetail) : Group;

	ExecCmd(Ctx, FString::Printf(TEXT("bcu.city.Quality %s"), *CityGroup));
	ExecCmd(Ctx, FString::Printf(TEXT("bcu.voxel.Quality %s"), *VoxelGroup));
	ExecCmd(Ctx, FString::Printf(TEXT("bcu.traffic.Quality %s"), *TrafficGroup));
	ExecCmd(Ctx, FString::Printf(TEXT("bcu.weather.Quality %s"), *WeatherGroup));

	// Texture streaming pool scales with the VRAM we detected, not the preset.
	const int32 PoolMB = DetectedVRAM_MB > 0
		? FMath::Clamp(DetectedVRAM_MB / 3, 1024, 8192)
		: 4096;
	ExecCmd(Ctx, FString::Printf(TEXT("r.Streaming.PoolSize %d"), PoolMB));
}

void UBCUGraphicsSubsystem::ApplyUpscaler()
{
	UObject* Ctx = GEngine;

	switch (Settings.Upscaler)
	{
	case EBCUUpscalerMode::Off:
		ExecCmd(Ctx, TEXT("r.AntiAliasingMethod 2"));
		ExecCmds(Ctx, { TEXT("r.ScreenPercentage 100"), TEXT("r.TSR.ShadingRejection 0") });
		break;

	case EBCUUpscalerMode::TSR:
		// UE5 Temporal Super Resolution — always available, no licence needed.
		ExecCmd(Ctx, TEXT("r.AntiAliasingMethod 4"));
		ExecCmd(Ctx, FString::Printf(TEXT("r.ScreenPercentage %.1f"),
			FMath::Lerp(58.0f, 100.0f, Settings.UpscalerQuality)));
		ExecCmd(Ctx, TEXT("r.TSR.ShadingRejection 1"));
		break;

	case EBCUUpscalerMode::DLSS_SR:
	case EBCUUpscalerMode::DLSS_SR_FG:
		if (!bDLSSAvailable)
		{
			// Licence/hardware fallback: TSR at the same render scale.
			ExecCmd(Ctx, TEXT("r.AntiAliasingMethod 4"));
			ExecCmd(Ctx, FString::Printf(TEXT("r.ScreenPercentage %.1f"),
				FMath::Lerp(58.0f, 100.0f, Settings.UpscalerQuality)));
			UE_LOG(LogBCUGraphics, Warning, TEXT("DLSS unavailable — falling back to TSR."));
			return;
		}
		// DLSS takes over the temporal upscaler slot; we only tune quality.
		ExecCmd(Ctx, TEXT("r.AntiAliasingMethod 4"));
		ExecCmd(Ctx, FString::Printf(TEXT("r.NGX.DLSS.Enable 1")));
		ExecCmd(Ctx, FString::Printf(TEXT("r.NGX.DLSS.Quality %.2f"), Settings.UpscalerQuality));
		ExecCmd(Ctx, FString::Printf(TEXT("r.ScreenPercentage %.1f"),
			FMath::Lerp(58.0f, 100.0f, Settings.UpscalerQuality)));

		if (Settings.Upscaler == EBCUUpscalerMode::DLSS_SR_FG)
		{
			// Frame Generation requires the DLSS-G capable plugin + RTX GPU.
			ExecCmd(Ctx, TEXT("r.NGX.DLSS.FrameGeneration.Enable 1"));
			// FG inserts interpolated frames: VSync must stay off and the
			// Reflex low-latency path must be on or input lag is unacceptable.
			ExecCmd(Ctx, TEXT("r.NGX.DLSS.FrameGeneration.LowLatencyAuto 1"));
			ExecCmd(Ctx, TEXT("r.VSync 0"));
		}
		else
		{
			ExecCmd(Ctx, TEXT("r.NGX.DLSS.FrameGeneration.Enable 0"));
		}
		break;

	default:
		break;
	}

	UE_LOG(LogBCUGraphics, Log, TEXT("Upscaler=%s quality=%.2f"),
		*UEnum::GetValueAsString(Settings.Upscaler), Settings.UpscalerQuality);
}

void UBCUGraphicsSubsystem::ApplyRayTracing()
{
	UObject* Ctx = GEngine;

	if (!bHardwareRayTracingAvailable || Settings.RayTracing == EBCURayTracingMode::Off)
	{
		ExecCmd(Ctx, TEXT("r.RayTracing 0"));
		ExecCmd(Ctx, TEXT("r.RayTracing.Reflections 0"));
		ExecCmd(Ctx, TEXT("r.RayTracing.Shadows 0"));
		ExecCmd(Ctx, TEXT("r.RayTracing.Geometry.Landscape 0"));
		// Lumen stays on the software/screen-trace path — still full GI.
		ExecCmd(Ctx, TEXT("r.Lumen.HardwareRayTracing 0"));
		return;
	}

	const bool bReflections = Settings.RayTracing != EBCURayTracingMode::Off;
	const bool bShadows = Settings.RayTracing == EBCURayTracingMode::ReflectionsShadows
		|| Settings.RayTracing == EBCURayTracingMode::Full;
	const bool bGI = Settings.RayTracing == EBCURayTracingMode::Full;

	ExecCmds(Ctx, {
		TEXT("r.RayTracing 1"),
		FString::Printf(TEXT("r.RayTracing.Reflections %d"), bReflections ? 1 : 0),
		FString::Printf(TEXT("r.RayTracing.Shadows %d"), bShadows ? 1 : 0),
		FString::Printf(TEXT("r.RayTracing.Geometry.InstancedStaticMeshes %d"), 1),
		FString::Printf(TEXT("r.RayTracing.Nanite.Mode %d"), 1),
		FString::Printf(TEXT("r.Lumen.HardwareRayTracing %d"), bGI ? 1 : 0),
		FString::Printf(TEXT("r.Lumen.Reflections.HardwareRayTracing %d"), bReflections ? 1 : 0),
	});

	// Hardware RT lighting on Nanite voxel clusters is expensive; cap bounces.
	ExecCmd(Ctx, TEXT("r.Lumen.HardwareRayTracing.LightingMode 2"));
	ExecCmd(Ctx, TEXT("r.RayTracing.Geometry.MaxBuiltPrimitivesPerFrame 2000000"));

	UE_LOG(LogBCUGraphics, Log, TEXT("Hardware RT: refl=%d shadow=%d gi=%d"),
		bReflections ? 1 : 0, bShadows ? 1 : 0, bGI ? 1 : 0);
}

void UBCUGraphicsSubsystem::ApplyResolutionAndFrameRate()
{
	UObject* Ctx = GEngine;

	// Frame rate target. Frame Generation doubles presented frames, so we keep
	// the *simulation* cap where the user asked and let FG interpolate above.
	switch (Settings.FrameRateTarget)
	{
	case EBCUFrameRateTarget::Unlocked:
		ExecCmd(Ctx, TEXT("t.MaxFPS 0"));
		break;
	default:
		ExecCmd(Ctx, FString::Printf(TEXT("t.MaxFPS %d"), static_cast<int32>(Settings.FrameRateTarget)));
		break;
	}

	ExecCmd(Ctx, FString::Printf(TEXT("r.VSync %d"), Settings.bVerticalSync ? 1 : 0));

	if (UGameUserSettings* UserSettings = GEngine ? GEngine->GetGameUserSettings() : nullptr)
	{
		FIntPoint Res;
		switch (Settings.ResolutionTarget)
		{
		case EBCUResolutionTarget::R1080p:	Res = FIntPoint(1920, 1080); break;
		case EBCUResolutionTarget::R1440p:	Res = FIntPoint(2560, 1440); break;
		case EBCUResolutionTarget::R4K:		Res = FIntPoint(3840, 2160); break;
		case EBCUResolutionTarget::Native:
		default:
			UserSettings->SetToDefaults();
			Res = UserSettings->GetDesktopResolution();
			break;
		}

		UserSettings->SetScreenResolution(Res);
		UserSettings->SetFullscreenMode(EWindowMode::Fullscreen);
		UserSettings->ApplyResolutionSettings(/*bCheckForCommandLineOverrides=*/false);
	}
}

void UBCUGraphicsSubsystem::ApplyDynamicResolution()
{
	UObject* Ctx = GEngine;

	if (!Settings.bDynamicResolution)
	{
		ExecCmd(Ctx, TEXT("r.DynamicRes.OperationMode 0")); // disabled
		return;
	}

	ExecCmds(Ctx, {
		TEXT("r.DynamicRes.OperationMode 2"),               // 2 = interactive (heuristic)
		FString::Printf(TEXT("r.DynamicRes.MinScreenPercentage %.1f"), Settings.DynamicResolutionMinPercent),
		TEXT("r.DynamicRes.MaxScreenPercentage 100.0"),
		FString::Printf(TEXT("r.DynamicRes.FrameTimeBudget %.2f"),
			Settings.FrameRateTarget == EBCUFrameRateTarget::Unlocked
				? 16.6f
				: 1000.0f / FMath::Max(1, static_cast<int32>(Settings.FrameRateTarget))),
		TEXT("r.DynamicRes.TargetPrimaryBufferCount 2"),
	});
}

//═══════════════════════════════════════════════════════════════════════════════
// Capability probing
//═══════════════════════════════════════════════════════════════════════════════

void UBCUGraphicsSubsystem::ProbeHardwareCapabilities()
{
	// ── GPU ─────────────────────────────────────────────────────────────────
	DetectedAdapterName = FPlatformMisc::GetPrimaryGPUBrand();
	DetectedVRAM_MB = 0;

	if (const FRHIDevice* RHIDevice = RHIGetDevice())
	{
		const FRHIDeviceInfo Info = RHIDevice->GetDeviceInfo();
		if (Info.Name.Len() > 0)
		{
			DetectedAdapterName = FString(Info.Name);
		}
		if (Info.DedicatedVideoMemoryInBytes > 0)
		{
			DetectedVRAM_MB = static_cast<int32>(Info.DedicatedVideoMemoryInBytes / (1024 * 1024));
		}
	}

	// Hardware ray tracing needs an SM6 backend *and* a GPU that reports RT.
	bHardwareRayTracingAvailable = GSupportsRayTracing
		&& (GMaxRHIShaderPlatform == SP_PCD3D_SM6 || GMaxRHIShaderPlatform == SP_VULKAN_SM6);

	// ── DLSS (optional, licence-gated) ──────────────────────────────────────
	// We never hard-link the plugin. Presence is inferred from the plugin
	// manager *and* from the console variables the plugin registers.
	bDLSSAvailable = false;
	bFrameGenerationAvailable = false;

#if BCU_WITH_OPTIONAL_DLSS
	if (const TSharedPtr<IPlugin> DLSSPlugin = IPluginManager::Get().FindPlugin(TEXT("DLSS")))
	{
		bDLSSAvailable = DLSSPlugin->IsEnabled()
			&& BCUGraphics::ConsoleVariableExists(TEXT("r.NGX.DLSS.Enable"));

		// Frame Generation additionally requires an RTX 40/50-series GPU and the
		// DLSS-G capable build of the plugin.
		bFrameGenerationAvailable = bDLSSAvailable
			&& BCUGraphics::ConsoleVariableExists(TEXT("r.NGX.DLSS.FrameGeneration.Enable"));
	}
#endif

	if (!bDLSSAvailable)
	{
		UE_LOG(LogBCUGraphics, Display,
			TEXT("NVIDIA DLSS plugin not present — using TSR. See Docs/01_BUILD_AND_SETUP.md §9 to opt in."));
	}

	// ── Nanite ──────────────────────────────────────────────────────────────
	bNaniteSupported = IsNaniteEnabled() || GSupportsNaniteRendering;

	// ── Frame Generation is meaningless without an unlocked/high cap ────────
	if (bFrameGenerationAvailable && Settings.FrameRateTarget != EBCUFrameRateTarget::Unlocked)
	{
		UE_LOG(LogBCUGraphics, Display,
			TEXT("Frame Generation active with a %d FPS cap — consider Unlocked for best results."),
			static_cast<int32>(Settings.FrameRateTarget));
	}
}

EBCUQualityPreset UBCUGraphicsSubsystem::GetRecommendedPreset() const
{
	// Heuristic tuned for the target hardware in the design spec:
	//   RTX 5060-class + 16-32 GB RAM  → Quality (1440p) by default,
	//                                    Ultra when VRAM ≥ 12 GB and 32 GB RAM.
	const uint64 RamMB = FPlatformMisc::GetPhysicalRAMSize() / (1024 * 1024);

	if (DetectedVRAM_MB <= 0 && RamMB < 12000)
	{
		return EBCUQualityPreset::Performance;
	}

	if (DetectedVRAM_MB >= 12000 && RamMB >= 30000 && bHardwareRayTracingAvailable)
	{
		return EBCUQualityPreset::Ultra;
	}

	if (DetectedVRAM_MB >= 8000 && RamMB >= 16000)
	{
		return EBCUQualityPreset::Quality;
	}

	if (DetectedVRAM_MB >= 6000)
	{
		return EBCUQualityPreset::Balanced;
	}

	return EBCUQualityPreset::Performance;
}

//═══════════════════════════════════════════════════════════════════════════════
// Benchmark
//═══════════════════════════════════════════════════════════════════════════════

void UBCUGraphicsSubsystem::RunBenchmark()
{
	if (bBenchmarkRunning)
	{
		return;
	}

	LastBenchmarkAverageFPS = -1.0f;
	bBenchmarkRunning = true;
	BenchmarkStartTime = FPlatformTime::Seconds();
	BenchmarkFrameCount = 0;
	BenchmarkFrameTimeSum = 0.0;

	if (GEngine && GEngine->GameViewport)
	{
		OnFrameReadyHandle = GEngine->GameViewport->OnFrameReadyDelegate().AddUObject(
			this, &UBCUGraphicsSubsystem::OnFrameReadyForBenchmark);
	}

	// Drive the camera through the most expensive district during the capture.
	ExecCmd(GEngine, TEXT("bcu.benchmark.start"));
	UE_LOG(LogBCUGraphics, Log, TEXT("Benchmark started (6 s capture)"));
}

void UBCUGraphicsSubsystem::OnFrameReadyForBenchmark()
{
	if (!bBenchmarkRunning)
	{
		return;
	}

	const double Now = FPlatformTime::Seconds();
	static double LastFrame = 0.0;
	if (LastFrame > 0.0)
	{
		BenchmarkFrameTimeSum += (Now - LastFrame);
		BenchmarkFrameCount++;
	}
	LastFrame = Now;

	if (Now - BenchmarkStartTime >= 6.0)
	{
		LastFrame = 0.0;
		FinishBenchmarkCapture();
	}
}

void UBCUGraphicsSubsystem::FinishBenchmarkCapture()
{
	bBenchmarkRunning = false;

	if (GEngine && GEngine->GameViewport && OnFrameReadyHandle.IsValid())
	{
		GEngine->GameViewport->OnFrameReadyDelegate().Remove(OnFrameReadyHandle);
		OnFrameReadyHandle.Reset();
	}

	ExecCmd(GEngine, TEXT("bcu.benchmark.stop"));

	if (BenchmarkFrameCount > 0 && BenchmarkFrameTimeSum > KINDA_SMALL_NUMBER)
	{
		LastBenchmarkAverageFPS = static_cast<float>(
			BenchmarkFrameCount / BenchmarkFrameTimeSum);
	}

	UE_LOG(LogBCUGraphics, Log, TEXT("Benchmark: %.1f FPS avg over %d frames (preset %s, %s, VRAM %d MB)"),
		LastBenchmarkAverageFPS, BenchmarkFrameCount,
		*UEnum::GetValueAsString(Settings.Preset), *DetectedAdapterName, DetectedVRAM_MB);

	OnGraphicsChanged.Broadcast(Settings);
}

//═══════════════════════════════════════════════════════════════════════════════
// Persistence + helpers
//═══════════════════════════════════════════════════════════════════════════════

void UBCUGraphicsSubsystem::PersistSettings()
{
	SaveConfig();

	// Mirror the essentials into the GameUserSettings file so a crash or an
	// Alt-Tab during a resolution change still leaves a bootable config.
	if (UGameUserSettings* UserSettings = GEngine ? GEngine->GetGameUserSettings() : nullptr)
	{
		UserSettings->SaveSettings();
	}
}

void UBCUGraphicsSubsystem::ExecCmd(UObject* Context, const FString& Cmd)
{
	if (Cmd.IsEmpty())
	{
		return;
	}

	if (GEngine)
	{
		GEngine->Exec(Context, *Cmd);
	}
	else
	{
		IConsoleManager::Get().ProcessUserConsoleInput(*Cmd, *(GLog ? GLog : nullptr), nullptr);
	}
}

void UBCUGraphicsSubsystem::ExecCmds(UObject* Context, const TArray<FString>& Cmds)
{
	for (const FString& Cmd : Cmds)
	{
		ExecCmd(Context, Cmd);
	}
}
