// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "BlockCityUltraEditor.h"

#include "World/City/BCUCityStreamer.h"
#include "World/City/BCUDistrictDataAsset.h"
#include "World/Voxel/BCUVoxelMesher.h"
#include "Graphics/BCUGraphicsSubsystem.h"
#include "Framework/Commands/UIAction.h"
#include "Framework/Docking/TabManager.h"
#include "Framework/MultiBox/MultiBoxBuilder.h"
#include "LevelEditor.h"
#include "Modules/ModuleManager.h"
#include "ToolMenus.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/MessageDialog.h"
#include "Styling/AppStyle.h"
#include "Editor.h"
#include "HAL/IConsoleManager.h"

DEFINE_LOG_CATEGORY(LogBCUEditor);

#define LOCTEXT_NAMESPACE "FBlockCityUltraEditorModule"

static const FName BCUToolbarExtenderName(TEXT("BCUToolbarExtender"));
static const FName BCULevelMenuName(TEXT("BCULevelEditor.MainMenu"));

void FBlockCityUltraEditorModule::StartupModule()
{
	FLevelEditorModule& LevelEditor = FModuleManager::LoadModuleChecked<FLevelEditorModule>(TEXT("LevelEditor"));

	// A single top-level menu with everything the city tools need. Designers
	// should never have to open a console to regenerate a district.
	TSharedPtr<FExtender> MenuExtender = MakeShared<FExtender>();
	MenuExtender->AddMenuExtension(
		TEXT("Window"),
		EExtensionHook::After,
		nullptr,
		FMenuExtensionDelegate::CreateRaw(this, &FBlockCityUltraEditorModule::AddMenuEntry));

	LevelEditor.GetMenuExtensibilityManager()->AddExtender(MenuExtender);

	TSharedPtr<FExtender> ToolbarExtender = MakeShared<FExtender>();
	ToolbarExtender->AddToolBarExtension(
		TEXT("Settings"),
		EExtensionHook::After,
		nullptr,
		FToolBarExtensionDelegate::CreateRaw(this, &FBlockCityUltraEditorModule::AddToolbarEntry));

	LevelEditor.GetToolBarExtensibilityManager()->AddExtender(ToolbarExtender);

	UE_LOG(LogBCUEditor, Log, TEXT("BLOCK CITY ULTRA editor tools loaded."));
}

void FBlockCityUltraEditorModule::ShutdownModule()
{
	if (UToolMenus* Menus = UToolMenus::Get())
	{
		Menus->UnregisterOwner(this);
	}

	FLevelEditorModule* LevelEditor = FModuleManager::GetModulePtr<FLevelEditorModule>(TEXT("LevelEditor"));
	if (LevelEditor)
	{
		LevelEditor->GetMenuExtensibilityManager()->RemoveAllExtensions(this);
		LevelEditor->GetToolBarExtensibilityManager()->RemoveAllExtensions(this);
	}
}

void FBlockCityUltraEditorModule::AddMenuEntry(FMenuBuilder& Builder)
{
	Builder.BeginSection(NAME_None, LOCTEXT("BCUSection", "BLOCK CITY ULTRA"));

	Builder.AddMenuEntry(
		LOCTEXT("SpawnStreamer", "Spawn City Streamer"),
		LOCTEXT("SpawnStreamerTooltip", "Places an ABCUCityStreamer configured from the world settings."),
		FSlateIcon(),
		FUIAction(FExecuteAction::CreateRaw(this, &FBlockCityUltraEditorModule::SpawnCityStreamer)));

	Builder.AddMenuEntry(
		LOCTEXT("RebuildCells", "Rebuild All Cells"),
		LOCTEXT("RebuildCellsTooltip", "Regenerates and re-meshes every resident city cell."),
		FSlateIcon(),
		FUIAction(FExecuteAction::CreateRaw(this, &FBlockCityUltraEditorModule::RebuildAllCells)));

	Builder.AddMenuEntry(
		LOCTEXT("BuildHLODs", "Build HLOD Proxies"),
		LOCTEXT("BuildHLODsTooltip", "Bakes the merged low-detail proxy meshes for distant cells."),
		FSlateIcon(),
		FUIAction(FExecuteAction::CreateRaw(this, &FBlockCityUltraEditorModule::BuildHLODs)));

	Builder.AddMenuSeparator();

	Builder.AddMenuEntry(
		LOCTEXT("PerfReport", "Run Performance Report"),
		LOCTEXT("PerfReportTooltip", "Captures a 6-second benchmark and writes CPU/GPU/memory/streaming stats."),
		FSlateIcon(),
		FUIAction(FExecuteAction::CreateRaw(this, &FBlockCityUltraEditorModule::RunPerformanceReport)));

	Builder.AddMenuEntry(
		LOCTEXT("ApplyUltra", "Apply Ultra Preset"),
		LOCTEXT("ApplyUltraTooltip", "Applies the Ultra graphics preset to the editor viewport."),
		FSlateIcon(),
		FUIAction(FExecuteAction::CreateLambda([]()
		{
			IConsoleManager::Get().ProcessUserConsoleInput(
				const_cast<TCHAR*>(TEXT("bcu.preset.ultra")), GLog, nullptr);
		})));

	Builder.EndSection();
}

void FBlockCityUltraEditorModule::AddToolbarEntry(FToolBarBuilder& Builder)
{
	Builder.AddToolBarButton(
		FUIAction(FExecuteAction::CreateRaw(this, &FBlockCityUltraEditorModule::RebuildAllCells)),
		NAME_None,
		LOCTEXT("RebuildToolbar", "Rebuild City"),
		LOCTEXT("RebuildToolbarTooltip", "Regenerate every resident city cell."),
		FSlateIcon(FAppStyle::GetAppStyleSetName(), "LevelEditor.Tabs.Viewports"));
}

ABCUCityStreamer* FBlockCityUltraEditorModule::FindStreamer() const
{
	UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
	if (!World) { return nullptr; }

	for (TActorIterator<ABCUCityStreamer> It(World); It; ++It) { return *It; }
	return nullptr;
}

void FBlockCityUltraEditorModule::SpawnCityStreamer()
{
	UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
	if (!World) { return; }

	if (FindStreamer())
	{
		FMessageDialog::Open(EAppMsgType::Ok,
			LOCTEXT("StreamerExists", "A City Streamer already exists in this level."));
		return;
	}

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Params.bNoFail = true;

	ABCUCityStreamer* Streamer = World->SpawnActor<ABCUCityStreamer>(
		ABCUCityStreamer::StaticClass(), FVector::ZeroVector, FRotator::ZeroRotator, Params);

	if (Streamer)
	{
		GEditor->SelectNone(true, true);
		GEditor->SelectActor(Streamer, true, true);
		UE_LOG(LogBCUEditor, Log, TEXT("Spawned ABCUCityStreamer."));
	}
}

void FBlockCityUltraEditorModule::RebuildAllCells()
{
	ABCUCityStreamer* Streamer = FindStreamer();
	if (!Streamer)
	{
		FMessageDialog::Open(EAppMsgType::Ok,
			LOCTEXT("NoStreamer", "No City Streamer in this level. Use Window > BLOCK CITY ULTRA > Spawn City Streamer."));
		return;
	}

	// Release everything, then let the streamer rebuild from the current seed.
	const int32 Before = Streamer->GetResidentCellCount();
	Streamer->bInitialLoadComplete = false;
	Streamer->UpdateWantedCells();

	UE_LOG(LogBCUEditor, Log, TEXT("Rebuilding %d city cells."), Before);
	FMessageDialog::Open(EAppMsgType::Ok,
		FText::Format(LOCTEXT("RebuildDone", "Rebuild requested for {0} cells."), FText::AsNumber(Before)));
}

void FBlockCityUltraEditorModule::BuildHLODs()
{
	ABCUCityStreamer* Streamer = FindStreamer();
	if (!Streamer) { return; }

	// HLOD proxies are built by the mesher's downsample path; the editor button
	// just triggers it for every resident cell.
	const double Start = FPlatformTime::Seconds();
	IConsoleManager::Get().ProcessUserConsoleInput(
		const_cast<TCHAR*>(TEXT("bcu.city.BuildHLOD")), GLog, nullptr);

	UE_LOG(LogBCUEditor, Log, TEXT("HLOD build finished in %.1f ms."),
		(FPlatformTime::Seconds() - Start) * 1000.0);
}

void FBlockCityUltraEditorModule::RunPerformanceReport()
{
	IConsoleManager::Get().ProcessUserConsoleInput(
		const_cast<TCHAR*>(TEXT("bcu.dump.perf")), GLog, nullptr);

	FMessageDialog::Open(EAppMsgType::Ok,
		LOCTEXT("PerfReportDone", "Performance report written to the log (Output Log > BCU)."));
}

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FBlockCityUltraEditorModule, BlockCityUltraEditor)
