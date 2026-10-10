// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "AIController.h"
#include "BCUPedestrianAI.generated.h"

class UAIPerceptionComponent;
class UAISenseConfig_Sight;
class UAISenseConfig_Hearing;
class UBehaviorTreeComponent;
class UBlackboardComponent;

/**
 * Pedestrian brain: wander the sidewalk graph, react to gunfire, explosions,
 * speeding cars and the player's wanted level.
 *
 * Perception is sight + hearing with tight radii, because a pedestrian that
 * notices a car 400 m away is both wrong and expensive.
 */
UCLASS(Blueprintable)
class BLOCKCITYULTRA_API ABCUPedestrianAIController : public AAIController
{
	GENERATED_BODY()

public:
	ABCUPedestrianAIController();

	virtual void OnPossess(APawn* InPawn) override;
	virtual void BeginPlay() override;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Pedestrian|AI")
	TObjectPtr<UAIPerceptionComponent> Perception;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Pedestrian|AI")
	TObjectPtr<UBehaviorTreeComponent> BehaviorTree;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Pedestrian|AI")
	TObjectPtr<UBlackboardComponent> Blackboard;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Pedestrian|AI")
	TObjectPtr<class UBehaviorTree> WanderTree;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Pedestrian|AI")
	TObjectPtr<class UBlackboardData> WanderBlackboard;

	/** Makes this pedestrian panic and run from a world location. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Pedestrian|AI")
	void Panic(const FVector& ThreatLocation);

	/** Returns to wandering after the panic timer expires. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Pedestrian|AI")
	void CalmDown();

	UFUNCTION(BlueprintPure, Category = "BCU|Pedestrian|AI")
	bool IsPanicking() const { return bPanicking; }

	/** Sight radius for a threat (gunshot is heard much further than seen). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Pedestrian|AI")
	float SightRadius = 18000.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Pedestrian|AI")
	float HearingRadius = 32000.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Pedestrian|AI")
	float PanicDurationSeconds = 14.0f;

protected:
	bool bPanicking = false;
	float PanicTimer = 0.0f;

	virtual void Tick(float DeltaSeconds) override;
	void OnPerceptionUpdated(const TArray<AActor*>& UpdatedActors);
	void OnTargetPerceptionUpdated(AActor* Actor, FAIStimulus Stimulus);
};
