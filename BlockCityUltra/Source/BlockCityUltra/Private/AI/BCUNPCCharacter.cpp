// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "AI/BCUNPCCharacter.h"

#include "Player/BCUHealthComponent.h"
#include "Player/BCUVoxelBodyComponent.h"
#include "Mission/BCUMissionSubsystem.h"
#include "Components/CapsuleComponent.h"
#include "Components/WidgetComponent.h"
#include "GameFramework/CharacterMovementComponent.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUNPC, Log, All);

ABCUNPCCharacter::ABCUNPCCharacter()
{
	PrimaryActorTick.bCanEverTick = false; // the AI controller ticks instead

	GetCapsuleComponent()->InitCapsuleSize(42.0f, 92.0f);
	GetCapsuleComponent()->SetCollisionProfileName(TEXT("BCU_Pedestrian"));

	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		Move->bOrientRotationToMovement = true;
		Move->RotationRate = FRotator(0.0f, 420.0f, 0.0f);
		Move->MaxWalkSpeed = 165.0f;
		Move->bCanWalkOffLedges = false;
		Move->SetIsReplicated(true);
	}

	bUseControllerRotationYaw = false;

	VoxelBody = CreateDefaultSubobject<UBCUVoxelBodyComponent>(TEXT("VoxelBody"));
	VoxelBody->SetupAttachment(RootComponent);

	Health = CreateDefaultSubobject<UBCUHealthComponent>(TEXT("Health"));
	Health->SetMaxHealth(100.0f);
	Health->RegenPerSecond = 0.0f; // civilians do not regenerate

	NameplateWidget = CreateDefaultSubobject<UWidgetComponent>(TEXT("Nameplate"));
	NameplateWidget->SetupAttachment(RootComponent);
	NameplateWidget->SetRelativeLocation(FVector(0.0f, 0.0f, 120.0f));
	NameplateWidget->SetWidgetSpace(EWidgetSpace::Screen);
	NameplateWidget->SetDrawSize(FVector2D(256.0f, 48.0f));
	NameplateWidget->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	NameplateWidget->SetHiddenInGame(true); // shown on focus only
}

void ABCUNPCCharacter::BeginPlay()
{
	Super::BeginPlay();

	ConfigureForRole();

	if (VoxelBody) { VoxelBody->ApplyOutfit(OutfitId); }
	if (DisplayName.IsEmpty() && NPCId.IsValid()) { DisplayName = FText::FromName(NPCId); }
}

void ABCUNPCCharacter::ConfigureForRole()
{
	// Role drives outfit, hostility and health so one class covers every person
	// in the city. Everything here is data-derived; no role has bespoke code.
	switch (Role)
	{
	case EBCUNPCRole::PoliceOfficer:
		OutfitId = TEXT("Police_Uniform");
		FactionId = TEXT("VaultCityPD");
		if (Health) { Health->SetMaxHealth(140.0f); Health->SetArmour(60.0f); }
		break;
	case EBCUNPCRole::Paramedic:
		OutfitId = TEXT("Paramedic_Uniform");
		FactionId = TEXT("CalderEMS");
		if (Health) { Health->SetMaxHealth(110.0f); }
		break;
	case EBCUNPCRole::Firefighter:
		OutfitId = TEXT("Firefighter_Gear");
		FactionId = TEXT("IronsideFire");
		if (Health) { Health->SetMaxHealth(130.0f); Health->SetArmour(35.0f); }
		break;
	case EBCUNPCRole::GangMember:
		OutfitId = TEXT("Gang_" + FactionId.ToString());
		if (Health) { Health->SetMaxHealth(120.0f); }
		bHostile = false; // hostile only when provoked or on a mission
		break;
	case EBCUNPCRole::Bouncer:
		OutfitId = TEXT("Bouncer_Suit");
		if (Health) { Health->SetMaxHealth(150.0f); }
		break;
	case EBCUNPCRole::Mechanic:
		OutfitId = TEXT("Mechanic_Overalls");
		break;
	case EBCUNPCRole::Valet:
		OutfitId = TEXT("Valet_Uniform");
		break;
	case EBCUNPCRole::Shopkeeper:
		OutfitId = TEXT("Shopkeeper_Apron");
		break;
	case EBCUNPCRole::MissionGiver:
		OutfitId = TEXT("Giver_Smart");
		break;
	case EBCUNPCRole::Civilian:
	default:
		if (!OutfitId.IsValid()) { OutfitId = TEXT("Civilian_A"); }
		break;
	}
}

float ABCUNPCCharacter::TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent,
	AController* EventInstigator, AActor* DamageCauser)
{
	const float Applied = Super::TakeDamage(DamageAmount, DamageEvent, EventInstigator, DamageCauser);

	if (Applied > 0.0f && Health)
	{
		Health->ApplyDamage(Applied);

		// Being shot makes anyone hostile to the shooter, which is what turns a
		// street into a scene rather than a silent shooting gallery.
		SetHostile(true);
	}

	return Applied;
}

bool ABCUNPCCharacter::IsHostileTo(const AActor* Other) const
{
	if (!bHostile || !Other) { return false; }

	// Same faction is never hostile, even when provoked.
	if (const ABCUNPCCharacter* OtherNPC = Cast<ABCUNPCCharacter>(Other))
	{
		return OtherNPC->FactionId != FactionId;
	}

	return true;
}

void ABCUNPCCharacter::SetHostile(bool bNewHostile)
{
	bHostile = bNewHostile;
	HostilityTimer = bNewHostile ? 25.0f : 0.0f;
}

void ABCUNPCCharacter::Interact(AActor* Instigator)
{
	if (!Instigator) { return; }

	// Mission givers hand off to the mission subsystem; shopkeepers open their
	// shop; everyone else just plays a dialogue bark.
	if (OfferedMissionId.IsValid())
	{
		if (UBCUMissionSubsystem* Missions = GetWorld()->GetSubsystem<UBCUMissionSubsystem>())
		{
			Missions->StartMission(OfferedMissionId);
			return;
		}
	}

	if (NameplateWidget)
	{
		NameplateWidget->SetHiddenInGame(false);
	}

	UE_LOG(LogBCUNPC, Log, TEXT("Interacted with %s (role %s, faction %s)"),
		*GetNameSafe(this), *UEnum::GetValueAsString(Role), *FactionId.ToString());
}
