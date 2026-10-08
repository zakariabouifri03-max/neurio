// Copyright GameProject. All rights reserved. Original content only.

#include "Debug/GameProjectDebugSubsystem.h"

#include "Core/GameProjectLog.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "HAL/PlatformProcess.h"
#include "Misc/CommandLine.h"
#include "ProjectCore.h"

void UGameProjectDebugSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

#if GAMEPROJECT_WITH_DEBUG_TOOLS
	ApplyStartupSettings();
#endif
}

UGameProjectDebugSubsystem* UGameProjectDebugSubsystem::Get(const UObject* WorldContextObject)
{
	if (!WorldContextObject || !GEngine)
	{
		return nullptr;
	}

	const UWorld* World = GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull);
	const UGameInstance* GameInstance = World ? World->GetGameInstance() : nullptr;
	return GameInstance ? GameInstance->GetSubsystem<UGameProjectDebugSubsystem>() : nullptr;
}

void UGameProjectDebugSubsystem::ApplyStartupSettings()
{
#if GAMEPROJECT_WITH_DEBUG_TOOLS
	const UGameProjectDebugSettings& Settings = UGameProjectDebugSettings::Get();

	EnabledChannels = 0;
	EnabledChannels |= Settings.bStartWithFPSDisplay ? static_cast<int32>(EGameProjectDebugChannel::FPS) : 0;
	EnabledChannels |= Settings.bStartWithPlayerInfo ? static_cast<int32>(EGameProjectDebugChannel::PlayerInfo) : 0;
	EnabledChannels |= Settings.bStartWithChunkInfo ? static_cast<int32>(EGameProjectDebugChannel::ChunkInfo) : 0;
	EnabledChannels |= Settings.bStartWithStreamingInfo ? static_cast<int32>(EGameProjectDebugChannel::StreamingInfo) : 0;
	EnabledChannels |= Settings.bStartWithCollisionVisualisation ? static_cast<int32>(EGameProjectDebugChannel::CollisionVisualisation) : 0;
	EnabledChannels |= Settings.bStartWithInteractionTraceVisualisation ? static_cast<int32>(EGameProjectDebugChannel::InteractionTrace) : 0;

	if (EnabledChannels != 0)
	{
		UE_LOG(LogGameProjectDebug, Log, TEXT("Debug channels enabled at startup: %s"), *GetEnabledChannelsText());
	}
#endif
}

bool UGameProjectDebugSubsystem::IsChannelEnabled(EGameProjectDebugChannel Channel) const
{
#if GAMEPROJECT_WITH_DEBUG_TOOLS
	return (EnabledChannels & static_cast<int32>(Channel)) != 0;
#else
	return false;
#endif
}

void UGameProjectDebugSubsystem::SetChannelEnabled(EGameProjectDebugChannel Channel, bool bEnabled)
{
#if GAMEPROJECT_WITH_DEBUG_TOOLS
	const int32 Mask = static_cast<int32>(Channel);
	const int32 Previous = EnabledChannels;
	EnabledChannels = bEnabled ? (EnabledChannels | Mask) : (EnabledChannels & ~Mask);

	if (Previous == EnabledChannels)
	{
		return;
	}

	// Two channels drive engine-level visualisation rather than our own drawing, so
	// they have to be pushed through the console.
	if ((Mask & static_cast<int32>(EGameProjectDebugChannel::FPS)) != 0)
	{
		SetFPSDisplayEnabled((EnabledChannels & Mask) != 0);
	}
	if ((Mask & static_cast<int32>(EGameProjectDebugChannel::CollisionVisualisation)) != 0)
	{
		SetCollisionVisualisationEnabled((EnabledChannels & Mask) != 0);
	}

	UE_LOG(LogGameProjectDebug, Log, TEXT("Debug channels now: %s"), *GetEnabledChannelsText());
#endif
}

void UGameProjectDebugSubsystem::ToggleChannel(EGameProjectDebugChannel Channel)
{
	SetChannelEnabled(Channel, !IsChannelEnabled(Channel));
}

void UGameProjectDebugSubsystem::EnableAllChannels()
{
#if GAMEPROJECT_WITH_DEBUG_TOOLS
	SetChannelEnabled(EGameProjectDebugChannel::All, true);
#endif
}

void UGameProjectDebugSubsystem::DisableAllChannels()
{
#if GAMEPROJECT_WITH_DEBUG_TOOLS
	const int32 Previous = EnabledChannels;
	EnabledChannels = 0;
	if (Previous != 0)
	{
		SetFPSDisplayEnabled(false);
		SetCollisionVisualisationEnabled(false);
		UE_LOG(LogGameProjectDebug, Log, TEXT("All debug channels disabled."));
	}
#endif
}

FString UGameProjectDebugSubsystem::GetEnabledChannelsText() const
{
#if GAMEPROJECT_WITH_DEBUG_TOOLS
	TArray<FString> Names;
	const UEnum* Enum = StaticEnum<EGameProjectDebugChannel>();
	if (Enum)
	{
		for (int32 Index = 0; Index < Enum->NumEnums() - 1; ++Index)
		{
			const int64 Value = Enum->GetValueByIndex(Index);
			// Skip the pseudo-entries (None/All) so the readout lists real channels.
			if (Value == 0 || Value == static_cast<int64>(EGameProjectDebugChannel::All))
			{
				continue;
			}
			if ((EnabledChannels & static_cast<int32>(Value)) != 0)
			{
				Names.Add(Enum->GetNameStringByIndex(Index));
			}
		}
	}
	return Names.Num() > 0 ? FString::Join(Names, TEXT(", ")) : TEXT("none");
#else
	return TEXT("disabled in this build");
#endif
}

void UGameProjectDebugSubsystem::SetFPSDisplayEnabled(bool bEnabled)
{
#if GAMEPROJECT_WITH_DEBUG_TOOLS
	if (bFPSEnabled == bEnabled)
	{
		return;
	}
	bFPSEnabled = bEnabled;

	ExecuteConsoleCommand(GetGameInstance(), bEnabled ? TEXT("stat fps") : TEXT("stat none"));
	// stat unit is the more useful of the two for a streamed world: it separates
	// game-thread cost from render-thread cost, which is where voxel meshing shows up.
	ExecuteConsoleCommand(GetGameInstance(), bEnabled ? TEXT("stat unit") : TEXT("stat none"));
#endif
}

void UGameProjectDebugSubsystem::SetCollisionVisualisationEnabled(bool bEnabled)
{
#if GAMEPROJECT_WITH_DEBUG_TOOLS
	if (bCollisionVisEnabled == bEnabled)
	{
		return;
	}
	bCollisionVisEnabled = bEnabled;

	// "show Collision" is an engine *toggle*, and the guard above means we only get
	// here on an actual state change - so one command per change is correct.
	ExecuteConsoleCommand(GetGameInstance(), TEXT("show Collision"));
#endif
}

void UGameProjectDebugSubsystem::ExecuteConsoleCommand(const UObject* WorldContext, const TCHAR* Command) const
{
#if GAMEPROJECT_WITH_DEBUG_TOOLS
	if (!GEngine || !Command)
	{
		return;
	}

	UWorld* World = nullptr;
	if (WorldContext)
	{
		World = GEngine->GetWorldFromContextObject(WorldContext, EGetWorldErrorMode::ReturnNull);
	}
	GEngine->Exec(World, Command);
#endif
}

void UGameProjectDebugSubsystem::DumpDebugStateToLog() const
{
#if GAMEPROJECT_WITH_DEBUG_TOOLS
	UE_LOG(LogGameProjectDebug, Log, TEXT("--- GameProject debug state ---"));
	UE_LOG(LogGameProjectDebug, Log, TEXT("Channels : %s"), *GetEnabledChannelsText());
	UE_LOG(LogGameProjectDebug, Log, TEXT("Providers: %s"), TextProviders.IsBound() ? TEXT("bound") : TEXT("none"));
	UE_LOG(LogGameProjectDebug, Log, TEXT("Build    : %s"),
#if UE_BUILD_SHIPPING
		TEXT("Shipping")
#elif UE_BUILD_TEST
		TEXT("Test")
#else
		TEXT("Development")
#endif
	);
#endif
}

FDelegateHandle UGameProjectDebugSubsystem::RegisterDebugTextProvider(FGameProjectDebugTextProvider::FDelegate Provider)
{
	return TextProviders.Add(Provider);
}

void UGameProjectDebugSubsystem::UnregisterDebugTextProvider(FDelegateHandle Handle)
{
	if (Handle.IsValid())
	{
		TextProviders.Remove(Handle);
	}
}

FString UGameProjectDebugSubsystem::BuildDebugText(const UObject* WorldContext) const
{
#if GAMEPROJECT_WITH_DEBUG_TOOLS
	if (EnabledChannels == 0)
	{
		return FString();
	}

	FString Text;
	Text.Reserve(512);

	if (IsChannelEnabled(EGameProjectDebugChannel::Memory))
	{
		const FPlatformMemory::FConstants Constants = FPlatformMemory::GetConstants();
		Text += FString::Printf(TEXT("RAM: %.0f MB physical\n"), Constants.TotalPhysical / (1024.0 * 1024.0));
	}

	// Every registered system appends its own section. Providers decide what to
	// print, so the subsystem never has to know about voxels, missions or vehicles.
	TextProviders.Broadcast(WorldContext, Text);

	return Text;
#else
	return FString();
#endif
}

void UGameProjectDebugSubsystem::AddOnScreenMessage(const UObject* WorldContext, int32 Key, const FString& Message, float DurationSeconds, FColor Color)
{
#if GAMEPROJECT_WITH_DEBUG_TOOLS
	if (GEngine)
	{
		GEngine->AddOnScreenDebugMessage(Key, DurationSeconds, Color, Message);
	}
#else
	(void)WorldContext; (void)Key; (void)Message; (void)DurationSeconds; (void)Color;
#endif
}
