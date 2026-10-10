// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Core/BCUPlayerController.h"

#include "Core/BCUGameMode.h"
#include "Player/BCUPlayerCharacter.h"
#include "Player/BCUCameraSystem.h"
#include "Player/BCUInteractionComponent.h"
#include "Vehicle/BCUBaseVehicle.h"
#include "Vehicle/BCUVehicleSubsystem.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "InputActionValue.h"
#include "InputMappingContext.h"
#include "GameFramework/PlayerInput.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUPC, Log, All);

ABCUPlayerController::ABCUPlayerController()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickInterval = 0.0f;
	bAutoManageActiveCameraTarget = false;   // UBCUCameraSystem owns the camera
	bBlockInput = false;
	DefaultMouseCursor = EMouseCursor::Default;
	bShowMouseCursor = false;
	bEnableClickEvents = false;
	bEnableMouseOverEvents = false;
}

void ABCUPlayerController::BeginPlay()
{
	Super::BeginPlay();

	// Register every mapping context once at the *player* level. Priorities
	// decide which one wins; SetControlContext() adds/removes by context.
	if (UEnhancedInputLocalPlayerSubsystem* Subsystem =
			ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(GetLocalPlayer()))
	{
		if (GlobalMappingContext)
		{
			Subsystem->AddMappingContext(GlobalMappingContext, /*Priority=*/100);
		}
		if (UIMappingContext)
		{
			Subsystem->AddMappingContext(UIMappingContext, /*Priority=*/90);
		}
		if (OnFootMappingContext)
		{
			Subsystem->AddMappingContext(OnFootMappingContext, /*Priority=*/10);
		}

	}

	// Hide the cursor until a menu opens — gameplay is mouse-look / gamepad only.
	bShowMouseCursor = false;
	SetInputMode(FInputModeGameOnly());

	SetControlContext(EBCUControlContext::OnFoot);
}

void ABCUPlayerController::SetupInputComponent()
{
	Super::SetupInputComponent();

	if (UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(InputComponent))
	{
		BindOnFootActions(EIC);
		BindDrivingActions(EIC);
		BindUIActions(EIC);
	}
	else
	{
		UE_LOG(LogBCUPC, Error,
			TEXT("InputComponent is not a UEnhancedInputComponent — check DefaultInput.ini "
				 "DefaultInputComponentClass=/Script/EnhancedInput.EnhancedInputComponent"));
	}
}

void ABCUPlayerController::BindOnFootActions(UEnhancedInputComponent* EIC)
{
	if (!EIC)
	{
		return;
	}

	if (IA_Move)
	{
		EIC->BindAction(IA_Move, ETriggerEvent::Triggered, this, &ABCUPlayerController::OnMove);
	}
	if (IA_Look)
	{
		EIC->BindAction(IA_Look, ETriggerEvent::Triggered, this, &ABCUPlayerController::OnLook);
	}
	if (IA_Jump)
	{
		// Bound to the pawn's own handlers: the jump lives on the movement
		// component, and the pawn may be swapped (e.g. after a respawn).
		if (ABCUPlayerCharacter* Char = GetBCUPawn())
		{
			EIC->BindAction(IA_Jump, ETriggerEvent::Started, Char, &ABCUPlayerCharacter::StartJump);
			EIC->BindAction(IA_Jump, ETriggerEvent::Completed, Char, &ABCUPlayerCharacter::StopJump);
		}
	}
	if (IA_Sprint)
	{
		EIC->BindAction(IA_Sprint, ETriggerEvent::Started, this, &ABCUPlayerController::OnSprintStarted);
		EIC->BindAction(IA_Sprint, ETriggerEvent::Completed, this, &ABCUPlayerController::OnSprintEnded);
	}
	if (IA_EnterVehicle)
	{
		EIC->BindAction(IA_EnterVehicle, ETriggerEvent::Started, this, &ABCUPlayerController::OnEnterVehiclePressed);
	}
	if (IA_Interact)
	{
		EIC->BindAction(IA_Interact, ETriggerEvent::Started, this, &ABCUPlayerController::OnInteractPressed);
	}
}

void ABCUPlayerController::BindDrivingActions(UEnhancedInputComponent* EIC)
{
	if (!EIC)
	{
		return;
	}

	if (IA_Throttle)
	{
		EIC->BindAction(IA_Throttle, ETriggerEvent::Triggered, this, &ABCUPlayerController::OnThrottle);
	}
	if (IA_Steer)
	{
		EIC->BindAction(IA_Steer, ETriggerEvent::Triggered, this, &ABCUPlayerController::OnSteer);
	}
	if (IA_Brake)
	{
		EIC->BindAction(IA_Brake, ETriggerEvent::Triggered, this, &ABCUPlayerController::OnBrake);
	}
	if (IA_Handbrake)
	{
		EIC->BindAction(IA_Handbrake, ETriggerEvent::Started, this, &ABCUPlayerController::OnHandbrakeStarted);
		EIC->BindAction(IA_Handbrake, ETriggerEvent::Completed, this, &ABCUPlayerController::OnHandbrakeEnded);
	}
	if (IA_ExitVehicle)
	{
		EIC->BindAction(IA_ExitVehicle, ETriggerEvent::Started, this, &ABCUPlayerController::OnExitVehiclePressed);
	}
	if (IA_Horn)
	{
		EIC->BindAction(IA_Horn, ETriggerEvent::Started, this, &ABCUPlayerController::OnHornPressed);
	}
	if (IA_CameraMode)
	{
		EIC->BindAction(IA_CameraMode, ETriggerEvent::Started, this, &ABCUPlayerController::OnCameraModePressed);
	}
	if (IA_LookBack)
	{
		EIC->BindAction(IA_LookBack, ETriggerEvent::Started, this, &ABCUPlayerController::OnLookBackStarted);
		EIC->BindAction(IA_LookBack, ETriggerEvent::Completed, this, &ABCUPlayerController::OnLookBackEnded);
	}
}

void ABCUPlayerController::BindUIActions(UEnhancedInputComponent* EIC)
{
	if (!EIC)
	{
		return;
	}

	if (IA_Map)		{ EIC->BindAction(IA_Map, ETriggerEvent::Started, this, &ABCUPlayerController::ToggleMap); }
	if (IA_Phone)	{ EIC->BindAction(IA_Phone, ETriggerEvent::Started, this, &ABCUPlayerController::TogglePhone); }
	if (IA_Inventory)	{ EIC->BindAction(IA_Inventory, ETriggerEvent::Started, this, &ABCUPlayerController::ToggleInventory); }
	if (IA_Pause)	{ EIC->BindAction(IA_Pause, ETriggerEvent::Started, this, &ABCUPlayerController::TogglePauseMenu); }
}

void ABCUPlayerController::ClearActionBindings(UEnhancedInputComponent* EIC)
{
	if (EIC)
	{
		EIC->ClearActionBindings();
	}
}

void ABCUPlayerController::OnPossess(APawn* InPawn)
{
	Super::OnPossess(InPawn);

	if (ABCUPlayerCharacter* Char = Cast<ABCUPlayerCharacter>(InPawn))
	{
		Char->SetOwningBCUController(this);

		if (UBCUCameraSystem* Cam = Char->GetCameraSystem())
		{
			Cam->SetViewTarget(this);
		}
	}
}

void ABCUPlayerController::OnUnPossess()
{
	Super::OnUnPossess();
}

void ABCUPlayerController::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// Keep the interaction prompt fresh (nearest door / vehicle / NPC).
	if (Interaction && !bAnyMenuOpen)
	{
		Interaction->UpdateFocus(DeltaSeconds);
	}
}

void ABCUPlayerController::PlayerTick(float DeltaTime)
{
	Super::PlayerTick(DeltaTime);

	// Feed throttle/steer smoothing into the driven vehicle. Chaos reads the
	// values we cached in the input handlers, so nothing to do when on foot.
	if (DrivenVehicle)
	{
		DrivenVehicle->ConsumePlayerInput(DeltaTime);
	}
}

void ABCUPlayerController::SetPause(bool bPaused)
{
	Super::SetPause(bPaused);

	if (bPaused)
	{
		SetControlContext(EBCUControlContext::UI);
	}
	else if (!bAnyMenuOpen)
	{
		SetControlContext(DrivenVehicle ? EBCUControlContext::Driving : EBCUControlContext::OnFoot);
	}
}

void ABCUPlayerController::SetControlContext(EBCUControlContext NewContext)
{
	if (NewContext == CurrentContext)
	{
		return;
	}

	const EBCUControlContext Old = CurrentContext;
	CurrentContext = NewContext;
	SwapMappingContextsFor(NewContext);

	bShowMouseCursor = (NewContext == EBCUControlContext::UI);
	SetInputMode(NewContext == EBCUControlContext::UI
		? FInputModeUIOnly()
		: FInputModeGameOnly());

	OnControlContextChanged.Broadcast(NewContext, Old);
	UE_LOG(LogBCUPC, Verbose, TEXT("Control context %d → %d"), static_cast<int32>(Old), static_cast<int32>(NewContext));
}

void ABCUPlayerController::SwapMappingContextsFor(EBCUControlContext NewContext)
{
	UEnhancedInputLocalPlayerSubsystem* Subsystem =
		ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(GetLocalPlayer());
	if (!Subsystem)
	{
		return;
	}

	// Remove both gameplay contexts, then add exactly one back. This is what
	// makes "F enters the car" stop firing while you are driving it.
	if (OnFootMappingContext)	{ Subsystem->RemoveMappingContext(OnFootMappingContext); }
	if (DrivingMappingContext)	{ Subsystem->RemoveMappingContext(DrivingMappingContext); }

	switch (NewContext)
	{
	case EBCUControlContext::OnFoot:
		if (OnFootMappingContext)	{ Subsystem->AddMappingContext(OnFootMappingContext, 10); }
		break;
	case EBCUControlContext::Driving:
		if (DrivingMappingContext)	{ Subsystem->AddMappingContext(DrivingMappingContext, 10); }
		break;
	case EBCUControlContext::UI:
		// No gameplay context: only Global + UI remain, at higher priority.
		break;
	case EBCUControlContext::Cinematic:
		break;
	default:
		break;
	}
}

ABCUPlayerCharacter* ABCUPlayerController::GetBCUPawn() const
{
	return Cast<ABCUPlayerCharacter>(GetPawn());
}

//═══════════════════════════════════════════════════════════════════════════════
// Input handlers
//═══════════════════════════════════════════════════════════════════════════════

void ABCUPlayerController::OnMove(const FInputActionValue& Value)
{
	const FVector2D Axis = Value.Get<FVector2D>();
	if (ABCUPlayerCharacter* Char = GetBCUPawn())
	{
		Char->AddMovementInputFromAxis(Axis);
	}
}

void ABCUPlayerController::OnLook(const FInputActionValue& Value)
{
	const FVector2D Axis = Value.Get<FVector2D>();
	AddYawInput(Axis.X);
	AddPitchInput(Axis.Y);

	if (UBCUCameraSystem* Cam = GetBCUPawn() ? GetBCUPawn()->GetCameraSystem() : nullptr)
	{
		Cam->AddLookInput(Axis);
	}
}

void ABCUPlayerController::OnSprintStarted()
{
	if (ABCUPlayerCharacter* Char = GetBCUPawn()) { Char->SetWantsSprint(true); }
}

void ABCUPlayerController::OnSprintEnded()
{
	if (ABCUPlayerCharacter* Char = GetBCUPawn()) { Char->SetWantsSprint(false); }
}

void ABCUPlayerController::OnEnterVehiclePressed()
{
	if (DrivenVehicle || !Interaction)
	{
		return;
	}

	if (ABCUBaseVehicle* Target = Cast<ABCUBaseVehicle>(Interaction->GetFocusedActor()))
	{
		EnterVehicle(Target, /*SeatIndex=*/0);
	}
}

void ABCUPlayerController::OnInteractPressed()
{
	if (Interaction)
	{
		Interaction->ActivateFocused();
	}
}

void ABCUPlayerController::OnThrottle(const FInputActionValue& Value)
{
	if (DrivenVehicle) { DrivenVehicle->SetPlayerThrottle(Value.Get<float>()); }
}

void ABCUPlayerController::OnSteer(const FInputActionValue& Value)
{
	if (DrivenVehicle) { DrivenVehicle->SetPlayerSteer(Value.Get<float>()); }
}

void ABCUPlayerController::OnBrake(const FInputActionValue& Value)
{
	if (DrivenVehicle) { DrivenVehicle->SetPlayerBrake(Value.Get<float>()); }
}

void ABCUPlayerController::OnHandbrakeStarted()
{
	if (DrivenVehicle) { DrivenVehicle->SetHandbrake(true); }
}

void ABCUPlayerController::OnHandbrakeEnded()
{
	if (DrivenVehicle) { DrivenVehicle->SetHandbrake(false); }
}

void ABCUPlayerController::OnExitVehiclePressed()
{
	ExitVehicleIfDriving(/*bForce=*/false);
}

void ABCUPlayerController::OnHornPressed()
{
	if (DrivenVehicle) { DrivenVehicle->PlayHorn(); }
}

void ABCUPlayerController::OnCameraModePressed()
{
	if (UBCUCameraSystem* Cam = GetBCUPawn() ? GetBCUPawn()->GetCameraSystem() : nullptr)
	{
		Cam->CycleCameraMode();
	}
}

void ABCUPlayerController::OnLookBackStarted()
{
	if (UBCUCameraSystem* Cam = GetBCUPawn() ? GetBCUPawn()->GetCameraSystem() : nullptr)
	{
		Cam->SetLookBack(true);
	}
}

void ABCUPlayerController::OnLookBackEnded()
{
	if (UBCUCameraSystem* Cam = GetBCUPawn() ? GetBCUPawn()->GetCameraSystem() : nullptr)
	{
		Cam->SetLookBack(false);
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Vehicle entry / exit
//═══════════════════════════════════════════════════════════════════════════════

bool ABCUPlayerController::EnterVehicle(ABCUBaseVehicle* Vehicle, int32 SeatIndex)
{
	if (!Vehicle || DrivenVehicle)
	{
		return false;
	}

	ABCUPlayerCharacter* Char = GetBCUPawn();
	if (!Char)
	{
		return false;
	}

	const int32 ResolvedSeat = Vehicle->ResolveSeatForEntrant(SeatIndex, Char);
	if (ResolvedSeat == INDEX_NONE)
	{
		return false; // all seats taken
	}

	// The vehicle hides + attaches the pawn and takes over physics.
	if (!Vehicle->AddOccupant(Char, ResolvedSeat))
	{
		return false;
	}

	DrivenVehicle = Vehicle;
	Char->SetVehicleBeingDriven(Vehicle);

	SetControlContext(EBCUControlContext::Driving);
	Possess(Vehicle->GetSeatPawn(ResolvedSeat));

	if (UBCUCameraSystem* Cam = Char->GetCameraSystem())
	{
		Cam->SetViewTarget(Vehicle);
		Cam->SetCameraModeFor(EBCUControlContext::Driving);
	}

	// Entering a police car while wanted, or a car that is not yours, is a crime.
	if (UBCUVehicleSubsystem* Vehicles = GetWorld()->GetSubsystem<UBCUVehicleSubsystem>())
	{
		Vehicles->OnPlayerEnteredVehicle(Vehicle, ResolvedSeat);
	}

	OnVehicleChanged.Broadcast(Vehicle);
	UE_LOG(LogBCUPC, Log, TEXT("Entered %s (seat %d)"), *Vehicle->GetName(), ResolvedSeat);
	return true;
}

void ABCUPlayerController::ExitVehicleIfDriving(bool bForce)
{
	if (!DrivenVehicle)
	{
		return;
	}

	ABCUBaseVehicle* Vehicle = DrivenVehicle;
	ABCUPlayerCharacter* Char = GetBCUPawn();

	if (!bForce && !Vehicle->CanExitSafely(Char))
	{
		// Moving too fast / no clear pavement: play the "hold to exit" refusal.
		Vehicle->NotifyExitRefused();
		return;
	}

	const FVector ExitLocation = Vehicle->ComputeExitLocation(Char);
	const FRotator ExitRotation = Vehicle->GetActorRotation();

	Vehicle->RemoveOccupant(Char);
	DrivenVehicle = nullptr;

	if (Char)
	{
		Char->SetVehicleBeingDriven(nullptr);
		Possess(Char);
		Char->SetActorLocationAndRotation(ExitLocation, ExitRotation, /*bSweep=*/false);
		Char->PostExitVehicle(Vehicle);
	}

	SetControlContext(EBCUControlContext::OnFoot);

	if (UBCUCameraSystem* Cam = Char ? Char->GetCameraSystem() : nullptr)
	{
		Cam->SetViewTarget(Char);
		Cam->SetCameraModeFor(EBCUControlContext::OnFoot);
	}

	Vehicle->OnPlayerExited();
	OnVehicleChanged.Broadcast(nullptr);
	UE_LOG(LogBCUPC, Log, TEXT("Exited %s"), *Vehicle->GetName());
}

//═══════════════════════════════════════════════════════════════════════════════
// UI
//═══════════════════════════════════════════════════════════════════════════════

void ABCUPlayerController::ToggleMap()			{ bAnyMenuOpen = !bAnyMenuOpen; SetControlContext(bAnyMenuOpen ? EBCUControlContext::UI : (DrivenVehicle ? EBCUControlContext::Driving : EBCUControlContext::OnFoot)); BroadcastUIToggle(TEXT("Map")); }
void ABCUPlayerController::TogglePhone()		{ bAnyMenuOpen = !bAnyMenuOpen; SetControlContext(bAnyMenuOpen ? EBCUControlContext::UI : (DrivenVehicle ? EBCUControlContext::Driving : EBCUControlContext::OnFoot)); BroadcastUIToggle(TEXT("Phone")); }
void ABCUPlayerController::ToggleInventory()	{ bAnyMenuOpen = !bAnyMenuOpen; SetControlContext(bAnyMenuOpen ? EBCUControlContext::UI : (DrivenVehicle ? EBCUControlContext::Driving : EBCUControlContext::OnFoot)); BroadcastUIToggle(TEXT("Inventory")); }

void ABCUPlayerController::TogglePauseMenu()
{
	bAnyMenuOpen = !bAnyMenuOpen;
	SetPause(bAnyMenuOpen);
	SetControlContext(bAnyMenuOpen ? EBCUControlContext::UI
		: (DrivenVehicle ? EBCUControlContext::Driving : EBCUControlContext::OnFoot));
	BroadcastUIToggle(TEXT("Pause"));
}

void ABCUPlayerController::BroadcastUIToggle(const FName& PanelId)
{
	OnUIToggleRequested.Broadcast(PanelId, bAnyMenuOpen);
}

//═══════════════════════════════════════════════════════════════════════════════
// Respawn plumbing
//═══════════════════════════════════════════════════════════════════════════════

void ABCUPlayerController::PlayRespawnFade(float Duration, bool bWasArrested)
{
	OnRespawnFadeRequested.Broadcast(Duration, bWasArrested);
}

void ABCUPlayerController::ReviveAndUnpossessVehicle()
{
	ExitVehicleIfDriving(/*bForce=*/true);

	if (ABCUPlayerCharacter* Char = GetBCUPawn())
	{
		Char->Revive();
	}

	PendingSpawnTag = NAME_None;
}

bool ABCUPlayerController::TeleportToLocation(const FVector& Location, const FRotator& Rotation)
{
	APawn* P = GetPawn();
	if (!P)
	{
		return false;
	}

	P->SetActorLocationAndRotation(Location, Rotation, /*bSweep=*/false);

	if (ACharacter* C = Cast<ACharacter>(P))
	{
		if (UCharacterMovementComponent* Move = C->GetCharacterMovement())
		{
			Move->Velocity = FVector::ZeroVector;
			Move->SetMovementMode(MOVE_Walking);
		}
	}

	return true;
}
