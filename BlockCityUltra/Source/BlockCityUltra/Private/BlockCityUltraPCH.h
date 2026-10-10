// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
//
// Shared precompiled header. Referenced by BlockCityUltra.Build.cs as
// PrivatePCHHeaderFile. Keeping it small and stable is deliberate: a large PCH
// makes every C++ change cost a full module rebuild.
#pragma once

#include "CoreMinimal.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/Character.h"
#include "Components/ActorComponent.h"
#include "UObject/Object.h"
#include "UObject/UnrealType.h"
#include "Misc/Paths.h"
#include "HAL/Platform.h"
#include "Containers/Array.h"
#include "Containers/Map.h"
#include "Math/Vector.h"
#include "Math/Rotator.h"
#include "Math/Transform.h"
#include "Logging/LogMacros.h"
