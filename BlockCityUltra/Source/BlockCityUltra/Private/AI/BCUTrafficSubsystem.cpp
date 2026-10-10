// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "AI/BCUTrafficSubsystem.h"

#include "AI/BCUTrafficComponent.h"
#include "Vehicle/BCUBaseVehicle.h"
#include "Vehicle/BCUVehicleDefinition.h"
#include "Vehicle/BCUVehicleSubsystem.h"
#include "World/City/BCUDistrictDataAsset.h"
#include "World/City/BCUCityStreamer.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Stats/Stats.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUTraffic, Log, All);
DECLARE_DWORD_ACCUMULATOR_STAT(TEXT("Traffic Agents"), STAT_BCUTrafficAgents, STATGROUP_BCUCity);

void UBCUTrafficSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	Collection.InitializeDependency<UBCUVehicleSubsystem>();

	Vehicles = GetWorld()->GetSubsystem<UBCUVehicleSubsystem>();
	Agents.Reserve(MaxActiveTrafficVehicles);
	VehiclePool.Reserve(MaxActiveTrafficVehicles / 2);
	ApplyScalability();
}

void UBCUTrafficSubsystem::Deinitialize()
{
	for (FBCUTrafficAgent& Agent : Agents)
	{
		if (Agent.Vehicle) { ReturnVehicleToPool(Agent.Vehicle); }
	}
	Agents.Reset();

	for (ABCUBaseVehicle* Pooled : VehiclePool)
	{
		if (Pooled) { Pooled->Destroy(); }
	}
	VehiclePool.Reset();

	Super::Deinitialize();
}

TStatId UBCUTrafficSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UBCUTrafficSubsystem, STATGROUP_Tickables);
}

void UBCUTrafficSubsystem::Tick(float DeltaTime)
{
	if (!UGameplayStatics::GetPlayerPawn(this, 0)) { return; }

	UpdateSimulationLODs(DeltaTime);
	DriveAllAgents(DeltaTime);
	SpawnTrafficNearPlayer(DeltaTime);
	DespawnDistantTraffic();

	SET_DWORD_STAT(STAT_BCUTrafficAgents, Agents.Num());
}

void UBCUTrafficSubsystem::UpdateSimulationLODs(float DeltaTime)
{
	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn || !bUseDistanceBasedSimulation) { return; }

	const FVector Player = PlayerPawn->GetActorLocation();

	for (FBCUTrafficAgent& Agent : Agents)
	{
		if (!Agent.Vehicle) { continue; }

		const float Distance = FVector::Dist(Agent.Vehicle->GetActorLocation(), Player);
		Agent.SimulationLOD = FMath::Clamp(Distance / FMath::Max(1.0f, SimulationLODFarCm), 0.0f, 1.0f);

		if (Agent.Vehicle->Traffic)
		{
			Agent.Vehicle->Traffic->SetSimulationTier(Agent.SimulationLOD < 0.55f ? 0 : 1);
		}
	}

	(void)DeltaTime;
}

void UBCUTrafficSubsystem::DriveAllAgents(float DeltaTime)
{
	// Far-tier agents update at ~3 Hz; near-tier agents every frame.
	static float FarAccumulator = 0.0f;
	FarAccumulator += DeltaTime;
	const bool bRunFarTier = FarAccumulator >= 0.333f;
	if (bRunFarTier) { FarAccumulator = 0.0f; }

	for (int32 i = Agents.Num() - 1; i >= 0; --i)
	{
		FBCUTrafficAgent& Agent = Agents[i];
		if (!Agent.Vehicle) { Agents.RemoveAt(i); continue; }

		const bool bFullRate = Agent.SimulationLOD < 0.55f;
		if (!bFullRate && !bRunFarTier) { continue; }

		DriveAgent(Agent, bFullRate ? DeltaTime : 0.333f, bFullRate);
	}
}

void UBCUTrafficSubsystem::DriveAgent(FBCUTrafficAgent& Agent, float DeltaTime, bool bFullRate)
{
	const TArray<FBCULaneNode>* Nodes = LaneGraph.Find(Agent.Cell);
	if (!Nodes || Nodes->Num() == 0 || !Agent.Vehicle)
	{
		if (Agent.Vehicle)
		{
			Agent.Vehicle->SetAIThrottle(0.0f);
			Agent.Vehicle->SetAIBrake(0.4f);
		}
		return;
	}

	// Pick a successor when we reach the current target node.
	if (Agent.TargetNode == INDEX_NONE || !Nodes->IsValidIndex(Agent.TargetNode))
	{
		const TArray<int32>* Successors = Nodes->IsValidIndex(Agent.CurrentNode)
			? &(*Nodes)[Agent.CurrentNode].Successors : nullptr;

		Agent.TargetNode = (Successors && Successors->Num() > 0)
			? (*Successors)[FMath::RandRange(0, Successors->Num() - 1)]
			: FMath::RandRange(0, Nodes->Num() - 1);
	}

	if (!Nodes->IsValidIndex(Agent.TargetNode)) { return; }

	const FBCULaneNode& Target = (*Nodes)[Agent.TargetNode];
	const float Distance = FVector::Dist2D(Target.Location, Agent.Vehicle->GetActorLocation());

	if (Distance < 400.0f)
	{
		Agent.CurrentNode = Agent.TargetNode;
		Agent.TargetNode = INDEX_NONE;
	}

	SteerAgentAlongLane(Agent, Target, DeltaTime);

	// Only near agents pay for an obstacle sweep.
	if (bFullRate)
	{
		float Brake = 0.0f;
		float SteerBias = 0.0f;
		if (AgentAvoidanceCheck(Agent, Brake, SteerBias))
		{
			Agent.Vehicle->SetAIBrake(FMath::Max(Agent.Vehicle->GetVehicleState() == EBCUVehicleState::Braking ? 0.5f : 0.0f, Brake));
			Agent.Vehicle->SetAISteer(FMath::Clamp(SteerBias, -1.0f, 1.0f));
			Agent.bYielding = Brake > 0.3f;
		}
		else
		{
			Agent.bYielding = false;
		}
	}
}

void UBCUTrafficSubsystem::SteerAgentAlongLane(FBCUTrafficAgent& Agent, const FBCULaneNode& Node, float DeltaTime)
{
	if (!Agent.Vehicle) { return; }

	const FVector ToTarget = Node.Location - Agent.Vehicle->GetActorLocation();
	const FRotator Desired = ToTarget.Rotation();
	const float YawError = FMath::Clamp(
		FMath::FindDeltaAngleDegrees(Agent.Vehicle->GetActorRotation().Yaw, Desired.Yaw) / 30.0f, -1.0f, 1.0f);

	// Slow for corners: sharper yaw error → lower target speed.
	const float CorneringScale = 1.0f - FMath::Abs(YawError) * 0.55f;
	Agent.DesiredSpeedKmh = Node.SpeedLimitKmh * CorneringScale;

	const float SpeedKmh = Agent.Vehicle->GetSpeedKmh();
	const float SpeedError = (Agent.DesiredSpeedKmh - SpeedKmh) / FMath::Max(1.0f, Agent.DesiredSpeedKmh);

	Agent.Vehicle->SetAIThrottle(FMath::Clamp(SpeedError * 2.0f, -0.25f, 1.0f));
	Agent.Vehicle->SetAIBrake(SpeedKmh > Agent.DesiredSpeedKmh * 1.2f
		? FMath::Clamp(-SpeedError * 1.6f, 0.0f, 0.8f) : 0.0f);
	Agent.Vehicle->SetAISteer(FMath::FInterpTo(0.0f, -YawError, DeltaTime, 6.0f));
	Agent.Vehicle->SetAIWantsHandbrake(false);
}

bool UBCUTrafficSubsystem::AgentAvoidanceCheck(const FBCUTrafficAgent& Agent, float& OutBrake, float& OutSteerBias) const
{
	OutBrake = 0.0f;
	OutSteerBias = 0.0f;
	if (!Agent.Vehicle) { return false; }

	const FVector Origin = Agent.Vehicle->GetActorLocation() + FVector(0.0f, 0.0f, 40.0f);
	const FVector Forward = Agent.Vehicle->GetActorForwardVector();
	const float Speed = Agent.Vehicle->GetSpeedKmh() * 277.78f;
	const float ProbeDistance = FMath::Clamp(600.0f + Speed * 1.1f, 600.0f, 9000.0f);

	FHitResult Hit;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(BCUTrafficAvoid), false, Agent.Vehicle);

	const bool bHit = Agent.Vehicle->GetWorld()->SweepSingleByChannel(
		Hit, Origin, Origin + Forward * ProbeDistance, FQuat::Identity,
		ECC_Vehicle, FCollisionShape::MakeBox(FVector(90.0f, 70.0f, 40.0f)), Params);

	if (!bHit) { return false; }

	const float Ratio = FMath::Clamp(1.0f - (Hit.Distance / ProbeDistance), 0.0f, 1.0f);
	OutBrake = FMath::Lerp(0.15f, 1.0f, Ratio);

	// Nudge around static obstacles, never around a pawn: swerving into a
	// pedestrian is worse than stopping behind them.
	if (Hit.GetActor() && !Hit.GetActor()->IsA(APawn::StaticClass()))
	{
		OutSteerBias = (Hit.ImpactNormal.Y > 0.0f) ? -0.22f : 0.22f;
	}

	return true;
}

//═══════════════════════════════════════════════════════════════════════════════
// Lane graph
//═══════════════════════════════════════════════════════════════════════════════

void UBCUTrafficSubsystem::RegisterCellLanes(const FBCUCellCoord& Coord, const TArray<FVector>& SpawnPoints,
	const TArray<FBCURoadSegment>& Roads)
{
	TArray<FBCULaneNode>& Nodes = LaneGraph.FindOrAdd(Coord);
	if (Nodes.Num() > 0) { return; }

	Nodes.Reserve(SpawnPoints.Num());

	for (int32 i = 0; i < SpawnPoints.Num(); ++i)
	{
		FBCULaneNode Node;
		Node.Location = SpawnPoints[i];
		Node.Cell = Coord;
		Node.RoadIndex = i;

		if (Roads.IsValidIndex(i))
		{
			const FBCURoadSegment& Road = Roads[i];
			const FVector Delta(Road.End.X - Road.Start.X, Road.End.Y - Road.Start.Y, 0.0f);
			Node.Direction = Delta.IsNearlyZero() ? FVector::ForwardVector : Delta.GetSafeNormal2D();
			Node.SpeedLimitKmh = Road.bIsHighway ? 110.0f : (Road.WidthVoxels >= 11 ? 60.0f : 45.0f);
		}
		else
		{
			Node.Direction = FVector::ForwardVector;
			Node.SpeedLimitKmh = 50.0f;
		}

		Nodes.Add(Node);
	}

	// Link each node to nearby nodes roughly along its heading. Cheap, and good
	// enough for lane following plus A* route building.
	for (int32 i = 0; i < Nodes.Num(); ++i)
	{
		for (int32 j = 0; j < Nodes.Num(); ++j)
		{
			if (i == j) { continue; }

			const FVector To = Nodes[j].Location - Nodes[i].Location;
			const float Distance = To.Size2D();
			if (Distance > 12000.0f || Distance < 900.0f) { continue; }

			const float Alignment = FVector::DotProduct(To.GetSafeNormal2D(), Nodes[i].Direction);
			if (Alignment > 0.86f && Nodes[i].Successors.Num() < 4)
			{
				Nodes[i].Successors.Add(j);
			}
		}

		if (Nodes[i].Successors.Num() >= 3) { Nodes[i].bIsIntersection = true; }
	}

	UE_LOG(LogBCUTraffic, Verbose, TEXT("Cell %s: %d lane nodes"), *Coord.ToString(), Nodes.Num());
}

void UBCUTrafficSubsystem::UnregisterCell(const FBCUCellCoord& Coord)
{
	LaneGraph.Remove(Coord);

	for (int32 i = Agents.Num() - 1; i >= 0; --i)
	{
		if (Agents[i].Cell == Coord)
		{
			if (Agents[i].Vehicle) { ReturnVehicleToPool(Agents[i].Vehicle); }
			Agents.RemoveAt(i);
		}
	}
}

const TArray<FBCULaneNode>& UBCUTrafficSubsystem::GetCellNodes(const FBCUCellCoord& Coord) const
{
	static const TArray<FBCULaneNode> Empty;
	const TArray<FBCULaneNode>* Found = LaneGraph.Find(Coord);
	return Found ? *Found : Empty;
}

bool UBCUTrafficSubsystem::FindNearestNode(const FVector& Location, float MaxDistanceCm,
	int32& OutNodeIndex, FBCUCellCoord& OutCell) const
{
	float Best = MaxDistanceCm * MaxDistanceCm;
	bool bFound = false;

	for (const TPair<FBCUCellCoord, TArray<FBCULaneNode>>& Pair : LaneGraph)
	{
		for (int32 i = 0; i < Pair.Value.Num(); ++i)
		{
			const float DistSq = FVector::DistSquared(Pair.Value[i].Location, Location);
			if (DistSq < Best)
			{
				Best = DistSq;
				OutNodeIndex = i;
				OutCell = Pair.Key;
				bFound = true;
			}
		}
	}

	return bFound;
}

bool UBCUTrafficSubsystem::FindRouteAlongLanes(const FVector& Start, const FVector& End,
	TArray<FVector>& OutPath) const
{
	OutPath.Reset();

	int32 StartNode = INDEX_NONE, EndNode = INDEX_NONE;
	FBCUCellCoord StartCell, EndCell;

	if (!FindNearestNode(Start, 30000.0f, StartNode, StartCell)) { return false; }
	if (!FindNearestNode(End, 30000.0f, EndNode, EndCell)) { return false; }
	if (StartCell != EndCell) { return false; } // cross-cell routing needs a merged graph

	const TArray<FBCULaneNode>* NodesPtr = LaneGraph.Find(StartCell);
	if (!NodesPtr) { return false; }
	const TArray<FBCULaneNode>& Nodes = *NodesPtr;

	// A*. Straight-line distance in metres is an admissible heuristic.
	TMap<int32, float> CostSoFar;
	TMap<int32, int32> CameFrom;
	TArray<int32> Open;

	Open.Add(StartNode);
	CostSoFar.Add(StartNode, 0.0f);

	int32 Iterations = 0;
	const int32 MaxIterations = 4096;
	const FVector Goal = Nodes[EndNode].Location;

	while (Open.Num() > 0 && Iterations++ < MaxIterations)
	{
		int32 BestIndex = 0;
		float BestF = TNumericLimits<float>::Max();
		for (int32 i = 0; i < Open.Num(); ++i)
		{
			const float F = CostSoFar[Open[i]] + FVector::Dist(Nodes[Open[i]].Location, Goal) * 0.001f;
			if (F < BestF) { BestF = F; BestIndex = i; }
		}

		const int32 Current = Open[BestIndex];
		Open.RemoveAt(BestIndex);

		if (Current == EndNode)
		{
			int32 Walk = EndNode;
			while (Walk != StartNode && CameFrom.Contains(Walk))
			{
				OutPath.Insert(Nodes[Walk].Location, 0);
				Walk = CameFrom[Walk];
			}
			return OutPath.Num() > 0;
		}

		for (int32 Next : Nodes[Current].Successors)
		{
			if (!Nodes.IsValidIndex(Next)) { continue; }

			const float NewCost = CostSoFar[Current]
				+ FVector::Dist(Nodes[Current].Location, Nodes[Next].Location) * 0.001f;

			const float* Existing = CostSoFar.Find(Next);
			if (!Existing || NewCost < *Existing)
			{
				CostSoFar.Add(Next, NewCost);
				CameFrom.Add(Next, Current);
				Open.AddUnique(Next);
			}
		}
	}

	return false;
}

//═══════════════════════════════════════════════════════════════════════════════
// Spawning / despawning / pooling
//═══════════════════════════════════════════════════════════════════════════════

void UBCUTrafficSubsystem::SpawnTrafficNearPlayer(float DeltaTime)
{
	SpawnTimer += DeltaTime;
	if (SpawnTimer < 0.5f) { return; }
	SpawnTimer = 0.0f;

	const int32 Budget = FMath::RoundToInt(float(MaxActiveTrafficVehicles) * DensityScale * BaseTrafficDensity);
	if (Agents.Num() >= Budget) { return; }

	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn) { return; }

	const FVector Player = PlayerPawn->GetActorLocation();

	// Candidate nodes: in the ring just outside comfortable visibility, so a
	// car never materialises in front of the player.
	TArray<TPair<FBCUCellCoord, int32>> Candidates;
	for (const TPair<FBCUCellCoord, TArray<FBCULaneNode>>& Pair : LaneGraph)
	{
		for (int32 i = 0; i < Pair.Value.Num(); ++i)
		{
			const float Distance = FVector::Dist(Pair.Value[i].Location, Player);
			if (Distance > SpawnRadiusCm * 0.55f && Distance < SpawnRadiusCm)
			{
				Candidates.Add(TPair<FBCUCellCoord, int32>(Pair.Key, i));
			}
		}
	}

	if (Candidates.Num() == 0) { return; }

	const int32 ToSpawn = FMath::Min(2, Budget - Agents.Num());
	for (int32 s = 0; s < ToSpawn && Candidates.Num() > 0; ++s)
	{
		const int32 Pick = FMath::RandRange(0, Candidates.Num() - 1);
		const FBCUCellCoord Cell = Candidates[Pick].Key;
		const int32 NodeIndex = Candidates[Pick].Value;
		Candidates.RemoveAt(Pick);

		const FBCULaneNode& Node = LaneGraph[Cell][NodeIndex];
		const FTransform SpawnTM(Node.Direction.Rotation(), Node.Location + FVector(0.0f, 0.0f, 60.0f));

		ABCUBaseVehicle* Vehicle = AcquireVehicleFromPool(SpawnTM, PickRandomTrafficVehicle(Cell));
		if (!Vehicle) { continue; }

		FBCUTrafficAgent Agent;
		Agent.Vehicle = Vehicle;
		Agent.Cell = Cell;
		Agent.CurrentNode = NodeIndex;
		Agent.TargetNode = INDEX_NONE;
		Agent.DesiredSpeedKmh = Node.SpeedLimitKmh;
		Agent.SimulationLOD = FVector::Dist(Node.Location, Player) / SimulationLODFarCm;
		Agents.Add(Agent);

		TotalSpawned++;
	}
}

void UBCUTrafficSubsystem::DespawnDistantTraffic()
{
	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn) { return; }

	const FVector Player = PlayerPawn->GetActorLocation();

	for (int32 i = Agents.Num() - 1; i >= 0; --i)
	{
		FBCUTrafficAgent& Agent = Agents[i];
		if (!Agent.Vehicle) { Agents.RemoveAt(i); continue; }

		// Never despawn a car with a driver in it — that is the player's car or
		// a police unit.
		if (Agent.Vehicle->HasDriver()) { continue; }

		if (FVector::Dist(Agent.Vehicle->GetActorLocation(), Player) > DespawnRadiusCm)
		{
			ReturnVehicleToPool(Agent.Vehicle);
			Agents.RemoveAt(i);
			TotalDespawned++;
		}
	}
}

UBCUVehicleDefinition* UBCUTrafficSubsystem::PickRandomTrafficVehicle(const FBCUCellCoord& Cell) const
{
	if (Vehicles)
	{
		if (UBCUVehicleDefinition* Pick = Vehicles->PickTrafficVehicleForCell(Cell))
		{
			return Pick;
		}
	}

	for (TActorIterator<ABCUCityStreamer> It(GetWorld()); It; ++It)
	{
		if (UBCUDistrictDataAsset* District = (*It)->GetDistrictForCell(Cell))
		{
			if (District->AI.TrafficVehiclePool.Num() > 0)
			{
				const int32 Index = FMath::RandRange(0, District->AI.TrafficVehiclePool.Num() - 1);
				return District->AI.TrafficVehiclePool[Index].LoadSynchronous();
			}
		}
		break;
	}

	return nullptr;
}

ABCUBaseVehicle* UBCUTrafficSubsystem::AcquireVehicleFromPool(const FTransform& SpawnTransform,
	UBCUVehicleDefinition* Def)
{
	ABCUBaseVehicle* Vehicle = nullptr;

	while (VehiclePool.Num() > 0)
	{
		Vehicle = VehiclePool.Pop();
		if (Vehicle && !Vehicle->IsPendingKillPending()) { break; }
		Vehicle = nullptr;
	}

	if (!Vehicle)
	{
		FActorSpawnParameters Params;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
		Params.bNoFail = true;
		Params.ObjectFlags |= RF_Transient;

		Vehicle = GetWorld()->SpawnActor<ABCUBaseVehicle>(ABCUBaseVehicle::StaticClass(), SpawnTransform, Params);
	}
	else
	{
		Vehicle->SetActorTransform(SpawnTransform);
		Vehicle->SetActorHiddenInGame(false);
		Vehicle->SetActorEnableCollision(true);
		Vehicle->SetActorTickEnabled(true);
	}

	if (Vehicle)
	{
		if (Def) { Vehicle->ConfigureFromDefinition(Def); }

		if (!Vehicle->Traffic)
		{
			Vehicle->Traffic = NewObject<UBCUTrafficComponent>(Vehicle);
			Vehicle->Traffic->RegisterComponent();
			Vehicle->Traffic->AttachToComponent(Vehicle->GetRootComponent(),
				FAttachmentTransformRules::KeepRelativeTransform);
		}
		Vehicle->Traffic->Initialise(this);
	}

	return Vehicle;
}

void UBCUTrafficSubsystem::ReturnVehicleToPool(ABCUBaseVehicle* Vehicle)
{
	if (!Vehicle) { return; }

	Vehicle->SetAIThrottle(0.0f);
	Vehicle->SetAIBrake(1.0f);
	Vehicle->SetHandbrake(true);
	Vehicle->SetActorHiddenInGame(true);
	Vehicle->SetActorEnableCollision(false);
	Vehicle->SetActorTickEnabled(false);

	if (VehiclePool.Num() < MaxActiveTrafficVehicles)
	{
		VehiclePool.Add(Vehicle);
	}
	else
	{
		Vehicle->Destroy();
	}
}

ABCUBaseVehicle* UBCUTrafficSubsystem::FindNearestTrafficVehicle(const FVector& Location, float MaxDistanceCm) const
{
	ABCUBaseVehicle* Best = nullptr;
	float BestDistance = MaxDistanceCm;

	for (const FBCUTrafficAgent& Agent : Agents)
	{
		if (!Agent.Vehicle) { continue; }

		const float Distance = FVector::Dist(Agent.Vehicle->GetActorLocation(), Location);
		if (Distance < BestDistance)
		{
			BestDistance = Distance;
			Best = Agent.Vehicle;
		}
	}

	return Best;
}

int32 UBCUTrafficSubsystem::ClearTrafficInRadius(const FVector& Location, float RadiusCm)
{
	int32 Cleared = 0;

	for (int32 i = Agents.Num() - 1; i >= 0; --i)
	{
		FBCUTrafficAgent& Agent = Agents[i];
		if (!Agent.Vehicle) { Agents.RemoveAt(i); continue; }

		if (FVector::Dist(Agent.Vehicle->GetActorLocation(), Location) <= RadiusCm)
		{
			ReturnVehicleToPool(Agent.Vehicle);
			Agents.RemoveAt(i);
			Cleared++;
		}
	}

	return Cleared;
}

void UBCUTrafficSubsystem::SetDensityScale(float Scale)
{
	DensityScale = FMath::Clamp(Scale, 0.0f, 4.0f);
	OnDensityChanged.Broadcast(DensityScale);
}

void UBCUTrafficSubsystem::ApplyScalability()
{
	static const auto CVarMax = IConsoleManager::Get().FindTConsoleVariableDataInt(TEXT("bcu.traffic.MaxActiveVehicles"));
	static const auto CVarLOD = IConsoleManager::Get().FindTConsoleVariableDataFloat(TEXT("bcu.traffic.SimulationLODFarCm"));
	static const auto CVarSpawn = IConsoleManager::Get().FindTConsoleVariableDataFloat(TEXT("bcu.traffic.SpawnRadiusCm"));

	if (CVarMax)   { MaxActiveTrafficVehicles = FMath::Clamp(CVarMax->GetValueOnGameThread(), 1, 400); }
	if (CVarLOD)   { SimulationLODFarCm = FMath::Max(10000.0f, CVarLOD->GetValueOnGameThread()); }
	if (CVarSpawn) { SpawnRadiusCm = FMath::Max(20000.0f, CVarSpawn->GetValueOnGameThread()); }

	DespawnRadiusCm = SpawnRadiusCm * 1.35f;
}

FString UBCUTrafficSubsystem::GetTrafficStats() const
{
	return FString::Printf(TEXT("agents=%d pool=%d cells=%d spawned=%d despawned=%d density=%.2f"),
		Agents.Num(), VehiclePool.Num(), LaneGraph.Num(), TotalSpawned, TotalDespawned, DensityScale);
}
