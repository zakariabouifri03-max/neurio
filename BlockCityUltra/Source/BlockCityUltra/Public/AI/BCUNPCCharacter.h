// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "BCUNPCCharacter.generated.h"

class UBCUVoxelBodyComponent;
class UBCUHealthComponent;
class UBCUInteractionComponent;
class UWidgetComponent;

UENUM(BlueprintType)
enum class EBCUNPCRole : uint8
{
	Civilian		UMETA(DisplayName = "Civilian"),
	Shopkeeper		UMETA(DisplayName = "Shopkeeper"),
	MissionGiver	UMETA(DisplayName = "Mission Giver"),
	GangMember		UMETA(DisplayName = "Gang Member"),
	PoliceOfficer	UMETA(DisplayName = "Police Officer"),
	Paramedic		UMETA(DisplayName = "Paramedic"),
	Firefighter		UMETA(DisplayName = "Firefighter"),
	Valet			UMETA(DisplayName = "Valet"),
	Mechanic		UMETA(DisplayName = "Mechanic"),
	Bouncer			UMETA(DisplayName = "Bouncer")
};

/**
 * Every non-player person in the city. One class, data-driven by role: the role
 * selects the outfit, the dialogue bank, the faction and whether the character
 * is a mission giver, a shop or just a pedestrian.
 *
 * All characters, names, factions and dialogue are original creations.
 */
UCLASS(Blueprintable)
class BLOCKCITYULTRA_API ABCUNPCCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	ABCUNPCCharacter();

	virtual void BeginPlay() override;
	virtual float TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent,
		AController* EventInstigator, AActor* DamageCauser) override;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|NPC|Components")
	TObjectPtr<UBCUVoxelBodyComponent> VoxelBody;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|NPC|Components")
	TObjectPtr<UBCUHealthComponent> Health;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|NPC|Components")
	TObjectPtr<UWidgetComponent> NameplateWidget;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|NPC")
	FName NPCId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|NPC")
	FText DisplayName;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|NPC")
	EBCUNPCRole Role = EBCUNPCRole::Civilian;

	/** Original factions: the Foundry Collective, Marbella Syndicate,
	 *  Ironside Crew, Ashfall Rangers, Calder Port Authority. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|NPC")
	FName FactionId = TEXT("None");

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|NPC")
	FName OutfitId = TEXT("Civilian_A");

	/** Dialogue bank id resolved against DT_Dialogue. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|NPC")
	FName DialogueBankId = NAME_None;

	/** Mission this NPC offers (mission givers only). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|NPC")
	FName OfferedMissionId = NAME_None;

	/** Shop this NPC runs (shopkeepers only). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|NPC")
	FName ShopId = NAME_None;

	UFUNCTION(BlueprintPure, Category = "BCU|NPC")
	bool IsHostileTo(const AActor* Other) const;

	UFUNCTION(BlueprintCallable, Category = "BCU|NPC")
	void SetHostile(bool bHostile);

	UFUNCTION(BlueprintPure, Category = "BCU|NPC")
	bool IsHostile() const { return bHostile; }

	/** Interaction entry point (E/F prompt). */
	UFUNCTION(BlueprintCallable, Category = "BCU|NPC")
	void Interact(AActor* Instigator);

protected:
	bool bHostile = false;
	float HostilityTimer = 0.0f;

	void ConfigureForRole();
};
