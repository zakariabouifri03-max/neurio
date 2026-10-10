// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "AI/BCUPedestrianAI.h"

#include "BehaviorTree/BehaviorTree.h"
#include "BehaviorTree/BehaviorTreeComponent.h"
#include "BehaviorTree/BlackboardComponent.h"
#include "Perception/AIPerceptionComponent.h"
#include "Perception/AISenseConfig_Hearing.h"
#include "Perception/AISenseConfig_Sight.h"
#include "GameFramework/Character.h"
#include "GameFramework/CharacterMovementComponent.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUPedAI, Log, All);

ABCUPedestrianAIController::ABCUPedestrianAIController()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickInterval = 0.15f; // a pedestrian brain does not need 60 Hz

	Perception = CreateDefaultSubobject<UAIPerceptionComponent>(TEXT("Perception"));
	BehaviorTree = CreateDefaultSubobject<UBehaviorTreeComponent>(TEXT("BehaviorTree"));
	Blackboard = CreateDefaultSubobject<UBlackboardComponent>(TEXT("Blackboard"));

	// Sight: short radius, front-facing, loses targets behind walls. A
	// pedestrian that spots a car 400 m away is both wrong and expensive.
	UAISenseConfig_Sight* SightConfig = CreateDefaultSubobject<UAISenseConfig_Sight>(TEXT("SightConfig"));
	SightConfig->SightRadius = SightRadius;
	SightConfig->LoseSightRadius = SightRadius * 1.35f;
	SightConfig->PeripheralVisionAngleDegrees = 100.0f;
	SightConfig->DetectionByAffiliation.bDetectEnemies = true;
	SightConfig->DetectionByAffiliation.bDetectNeutrals = true;
	SightConfig->DetectionByAffiliation.bDetectFriendlies = false;
	SightConfig->AutoSuccessionFromLastSeenLocation = false;
	Perception->ConfigureSense(*SightConfig);

	// Hearing: gunshots, explosions, tyre screams and sirens. Much larger radius
	// than sight, which is what makes an off-screen shot clear a street.
	UAISenseConfig_Hearing* HearingConfig = CreateDefaultSubobject<UAISenseConfig_Hearing>(TEXT("HearingConfig"));
	HearingConfig->HearingRange = HearingRadius;
	HearingConfig->DetectionByAffiliation.bDetectEnemies = true;
	HearingConfig->DetectionByAffiliation.bDetectNeutrals = true;
	HearingConfig->DetectionByAffiliation.bDetectFriendlies = true;
	Perception->ConfigureSense(*HearingConfig);

	Perception->SetDominantSense(UAISenseConfig_Sight::StaticClass());
	Perception->OnTargetPerceptionUpdated.AddDynamic(this, &ABCUPedestrianAIController::OnTargetPerceptionUpdated);
}

void ABCUPedestrianAIController::BeginPlay()
{
	Super::BeginPlay();

	if (WanderTree && WanderBlackboard)
	{
		BehaviorTree->InitializeBlackboardAsset(*WanderBlackboard);
		BehaviorTree->StartTree(*WanderTree);
	}
}

void ABCUPedestrianAIController::OnPossess(APawn* InPawn)
{
	Super::OnPossess(InPawn);

	if (WanderTree && WanderBlackboard)
	{
		RunBehaviorTree(WanderTree);
	}

	// Pedestrians are light on their feet: cap the tick so 240 of them never
	// become the frame-time bottleneck.
	if (ACharacter* Char = Cast<ACharacter>(InPawn))
	{
		if (UCharacterMovementComponent* Move = Char->GetCharacterMovement())
		{
			Move->MaxWalkSpeed = 165.0f;
			Move->bOrientRotationToMovement = true;
			Move->RotationRate = FRotator(0.0f, 420.0f, 0.0f);
			Move->bCanWalkOffLedges = false; // peds must not fall off kerbs
			Move->SetMovementMode(MOVE_Walking);
		}
	}
}

void ABCUPedestrianAIController::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (!bPanicking) { return; }

	PanicTimer -= DeltaSeconds;
	if (PanicTimer <= 0.0f) { CalmDown(); }
}

void ABCUPedestrianAIController::Panic(const FVector& ThreatLocation)
{
	bPanicking = true;
	PanicTimer = PanicDurationSeconds * FMath::FRandRange(0.7f, 1.4f);

	if (Blackboard)
	{
		Blackboard->SetValueAsVector(TEXT("ThreatLocation"), ThreatLocation);
		Blackboard->SetValueAsBool(TEXT("bPanicking"), true);
	}

	if (ACharacter* Char = GetCharacter())
	{
		if (UCharacterMovementComponent* Move = Char->GetCharacterMovement())
		{
			// Sprint away: roughly 3× walking speed, which is what a real crowd
			// does and what makes a street clearing feel immediate.
			Move->MaxWalkSpeed = 520.0f;
		}
	}

	UE_LOG(LogBCUPedAI, Verbose, TEXT("Pedestrian panicking from %s"), *ThreatLocation.ToString());
}

void ABCUPedestrianAIController::CalmDown()
{
	bPanicking = false;

	if (Blackboard) { Blackboard->SetValueAsBool(TEXT("bPanicking"), false); }

	if (ACharacter* Char = GetCharacter())
	{
		if (UCharacterMovementComponent* Move = Char->GetCharacterMovement())
		{
			Move->MaxWalkSpeed = 165.0f;
		}
	}
}

void ABCUPedestrianAIController::OnPerceptionUpdated(const TArray<AActor*>& UpdatedActors)
{
	(void)UpdatedActors;
}

void ABCUPedestrianAIController::OnTargetPerceptionUpdated(AActor* Actor, FAIStimulus Stimulus)
{
	if (!Actor) { return; }

	// A witnessed crime makes the pedestrian panic and run for cover, which is
	// the visual that tells the player "somebody saw that".
	if (Stimulus.WasSuccessfullySensed() && Stimulus.Type == UAISenseConfig_Hearing::StaticClass())
	{
		Panic(Actor->GetActorLocation());
	}
	else if (Stimulus.WasSuccessfullySensed() && Stimulus.Type == UAISenseConfig_Sight::StaticClass())
	{
		// Only panic at a visible threat if it is actually threatening: a car
		// driving past normally must not clear the sidewalk.
		const float Distance = FVector::Dist(GetPawn()->GetActorLocation(), Actor->GetActorLocation());
		const float Speed = Actor->GetVelocity().Size() * 0.036f; // cm/s → km/h

		if (Distance < 14000.0f && Speed > 65.0f)
		{
			Panic(Actor->GetActorLocation());
		}
	}
}
