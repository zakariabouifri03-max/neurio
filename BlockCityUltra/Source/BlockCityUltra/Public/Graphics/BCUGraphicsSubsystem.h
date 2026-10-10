// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "BCUGraphicsSubsystem.generated.h"

class UUserWidget;

UENUM(BlueprintType)
enum class EBCUQualityPreset : uint8
{
	Performance		= 0		UMETA(DisplayName = "Performance"),
	Balanced		= 1		UMETA(DisplayName = "Balanced"),
	Quality			= 2		UMETA(DisplayName = "Quality"),
	Ultra			= 3		UMETA(DisplayName = "Ultra"),
	Custom			= 4		UMETA(DisplayName = "Custom")
};

UENUM(BlueprintType)
enum class EBCUResolutionTarget : uint8
{
	R1080p			UMETA(DisplayName = "1920x1080"),
	R1440p			UMETA(DisplayName = "2560x1440"),
	R4K				UMETA(DisplayName = "3840x2160"),
	Native			UMETA(DisplayName = "Native Display")
};

UENUM(BlueprintType)
enum class EBCUFrameRateTarget : uint8
{
	Unlocked		= 0		UMETA(DisplayName = "Unlocked"),
	FPS30			= 30	UMETA(DisplayName = "30 FPS"),
	FPS60			= 60	UMETA(DisplayName = "60 FPS"),
	FPS90			= 90	UMETA(DisplayName = "90 FPS"),
	FPS120			= 120	UMETA(DisplayName = "120 FPS"),
	FPS144			= 144	UMETA(DisplayName = "144 FPS")
};

UENUM(BlueprintType)
enum class EBCUUpscalerMode : uint8
{
	TSR				UMETA(DisplayName = "Temporal Super Resolution"),
	DLSS_SR			UMETA(DisplayName = "DLSS Super Resolution"),
	DLSS_SR_FG		UMETA(DisplayName = "DLSS SR + Frame Generation"),
	Off				UMETA(DisplayName = "Off (native)")
};

UENUM(BlueprintType)
enum class EBCURayTracingMode : uint8
{
	Off				UMETA(DisplayName = "Off"),
	Reflections		UMETA(DisplayName = "Reflections"),
	ReflectionsShadows UMETA(DisplayName = "Reflections + Shadows"),
	Full			UMETA(DisplayName = "Full (Refl + Shadows + GI)")
};

/** Every independently scalable category required by the design spec. */
USTRUCT(BlueprintType)
struct FBCUScalabilityOverrides
{
	GENERATED_BODY()

	/** -1 = follow preset, 0..3 = force. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Graphics", meta = (ClampMin = "-1", ClampMax = "3"))
	int32 ViewDistance = -1;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Graphics", meta = (ClampMin = "-1", ClampMax = "3"))
	int32 Shadows = -1;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Graphics", meta = (ClampMin = "-1", ClampMax = "3"))
	int32 Reflections = -1;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Graphics", meta = (ClampMin = "-1", ClampMax = "3"))
	int32 GlobalIllumination = -1;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Graphics", meta = (ClampMin = "-1", ClampMax = "3"))
	int32 PostProcess = -1;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Graphics", meta = (ClampMin = "-1", ClampMax = "3"))
	int32 Textures = -1;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Graphics", meta = (ClampMin = "-1", ClampMax = "3"))
	int32 Effects = -1;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Graphics", meta = (ClampMin = "-1", ClampMax = "3"))
	int32 Vegetation = -1;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Graphics", meta = (ClampMin = "-1", ClampMax = "3"))
	int32 AntiAliasing = -1;

	/** BCU-specific: city streaming radius / HLOD aggressiveness. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Graphics", meta = (ClampMin = "-1", ClampMax = "3"))
	int32 CityDetail = -1;

	/** BCU-specific: voxel triangle budget, prop instance budget. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Graphics", meta = (ClampMin = "-1", ClampMax = "3"))
	int32 VoxelDetail = -1;

	/** BCU-specific: traffic + pedestrian simulation budgets. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Graphics", meta = (ClampMin = "-1", ClampMax = "3"))
	int32 TrafficDensity = -1;

	/** BCU-specific: rain particles, volumetric fog, puddle decals. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Graphics", meta = (ClampMin = "-1", ClampMax = "3"))
	int32 WeatherDetail = -1;
};

/** Persisted video options. Mirrors the settings menu 1:1. */
USTRUCT(BlueprintType)
struct FBCUGraphicsSettings
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Graphics")
	EBCUQualityPreset Preset = EBCUQualityPreset::Quality;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Graphics")
	EBCUResolutionTarget ResolutionTarget = EBCUResolutionTarget::R1440p;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Graphics")
	EBCUFrameRateTarget FrameRateTarget = EBCUFrameRateTarget::Unlocked;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Graphics")
	EBCUUpscalerMode Upscaler = EBCUUpscalerMode::DLSS_SR;

	/** Quality knob of the chosen upscaler, 0 (max perf) .. 1 (max quality). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Graphics", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float UpscalerQuality = 0.667f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Graphics")
	EBCURayTracingMode RayTracing = EBCURayTracingMode::Off;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Graphics")
	bool bDynamicResolution = true;

	/** Minimum screen percentage dynamic resolution may drop to. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Graphics", meta = (ClampMin = "40.0", ClampMax = "100.0"))
	float DynamicResolutionMinPercent = 66.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Graphics")
	bool bVerticalSync = false;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Graphics")
	bool bMotionBlur = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Graphics")
	bool bFilmGrain = false;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Graphics")
	FBCUScalabilityOverrides Overrides;

	/** Field of view for the on-foot camera (vehicle FOV is derived). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Graphics", meta = (ClampMin = "70.0", ClampMax = "110.0"))
	float BaseFOV = 90.0f;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnBCUGraphicsChanged, const FBCUGraphicsSettings&, Settings);

/**
 * Single authority for every rendering setting in BLOCK CITY ULTRA.
 *
 * Why a subsystem and not a blueprint library: presets have to survive map
 * travel, be applied before the first frame, be clamped against what the
 * detected hardware can actually do, and be written back to the save game.
 *
 * DLSS is *optional and licence-gated*: we never hard-link the plugin. The
 * subsystem probes for it with IPluginManager and console variables at Init;
 * if it is missing (or the GPU is not RTX-class) the requested mode degrades
 * to TSR with dynamic resolution and the UI greys the option out.
 */
UCLASS(config = Game, Blueprintable)
class BLOCKCITYULTRA_API UBCUGraphicsSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	//~ USubsystem
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	//~ End USubsystem

	/** Applies the settings the user last saved (called from the instance). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Graphics")
	void ApplySavedSettings();

	/** Applies a preset and (optionally) writes it to config immediately. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Graphics")
	void ApplyPreset(EBCUQualityPreset Preset, bool bPersist = true);

	/** Applies arbitrary user settings; flips the preset to Custom. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Graphics")
	void ApplySettings(const FBCUGraphicsSettings& NewSettings, bool bPersist = true);

	UFUNCTION(BlueprintPure, Category = "BCU|Graphics")
	const FBCUGraphicsSettings& GetSettings() const { return Settings; }

	/** Convenience setters used by the settings menu sliders. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Graphics")
	void SetResolutionTarget(EBCUResolutionTarget Target);

	UFUNCTION(BlueprintCallable, Category = "BCU|Graphics")
	void SetFrameRateTarget(EBCUFrameRateTarget Target);

	UFUNCTION(BlueprintCallable, Category = "BCU|Graphics")
	void SetUpscalerMode(EBCUUpscalerMode Mode);

	UFUNCTION(BlueprintCallable, Category = "BCU|Graphics")
	void SetRayTracingMode(EBCURayTracingMode Mode);

	UFUNCTION(BlueprintCallable, Category = "BCU|Graphics")
	void SetScalabilityOverride(const FName& Category, int32 Level);

	// ── Hardware capability probing (drives the greyed-out UI options) ──────
	UFUNCTION(BlueprintPure, Category = "BCU|Graphics|Capability")
	bool IsDLSSAvailable() const { return bDLSSAvailable; }

	UFUNCTION(BlueprintPure, Category = "BCU|Graphics|Capability")
	bool IsFrameGenerationAvailable() const { return bFrameGenerationAvailable; }

	UFUNCTION(BlueprintPure, Category = "BCU|Graphics|Capability")
	bool IsHardwareRayTracingAvailable() const { return bHardwareRayTracingAvailable; }

	UFUNCTION(BlueprintPure, Category = "BCU|Graphics|Capability")
	bool IsNaniteSupported() const { return bNaniteSupported; }

	/** Estimated VRAM budget in MB from the detected adapter. */
	UFUNCTION(BlueprintPure, Category = "BCU|Graphics|Capability")
	int32 GetDetectedVRAM_MB() const { return DetectedVRAM_MB; }

	/** Human readable adapter name for the video options header. */
	UFUNCTION(BlueprintPure, Category = "BCU|Graphics|Capability")
	FString GetDetectedAdapterName() const { return DetectedAdapterName; }

	/**
	 * The preset we *recommend* for the detected hardware. RTX 5060-class with
	 * 16 GB RAM and a 1440p panel → Quality (Ultra when VRAM ≥ 12 GB and the
	 * user asks for the benchmark configuration).
	 */
	UFUNCTION(BlueprintCallable, Category = "BCU|Graphics|Capability")
	EBCUQualityPreset GetRecommendedPreset() const;

	/** Runs a 6-second in-engine benchmark and reports average frame time. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Graphics|Benchmark")
	void RunBenchmark();

	UPROPERTY(BlueprintAssignable, Category = "BCU|Graphics")
	FOnBCUGraphicsChanged OnGraphicsChanged;

	/** Latest benchmark result, -1 until RunBenchmark completes. */
	UFUNCTION(BlueprintPure, Category = "BCU|Graphics|Benchmark")
	float GetLastBenchmarkAverageFPS() const { return LastBenchmarkAverageFPS; }

protected:
	UPROPERTY(config, BlueprintReadOnly, Category = "BCU|Graphics")
	FBCUGraphicsSettings Settings;

	/** Writes Settings into config/DefaultGame.ini's user section. */
	void PersistSettings();

	/** The actual work: sg.* groups + BCU groups + upscaler + RT + frame cap. */
	void PushSettingsToWorld();

	void ApplyScalabilityGroups(EBCUQualityPreset Preset, const FBCUScalabilityOverrides& Overrides);
	void ApplyUpscaler();
	void ApplyRayTracing();
	void ApplyResolutionAndFrameRate();
	void ApplyDynamicResolution();

	void ProbeHardwareCapabilities();
	void FinishBenchmarkCapture();

	bool bDLSSAvailable = false;
	bool bFrameGenerationAvailable = false;
	bool bHardwareRayTracingAvailable = false;
	bool bNaniteSupported = true;
	int32 DetectedVRAM_MB = 0;
	FString DetectedAdapterName;

	// Benchmark state
	bool bBenchmarkRunning = false;
	double BenchmarkStartTime = 0.0;
	int32 BenchmarkFrameCount = 0;
	double BenchmarkFrameTimeSum = 0.0;
	float LastBenchmarkAverageFPS = -1.0f;

	FDelegateHandle TickHandle;
	FDelegateHandle OnFrameReadyHandle;
	void OnFrameReadyForBenchmark();

	/** Executes a console command safely (no-ops in shipping where needed). */
	static void ExecCmd(UObject* Context, const FString& Cmd);
	static void ExecCmds(UObject* Context, const TArray<FString>& Cmds);
};
