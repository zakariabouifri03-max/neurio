// Copyright GameProject. All rights reserved. Original content only.

#include "Save/SaveGameProject.h"

#include "Core/GameProjectLog.h"
#include "ProjectCore.h"

USaveGameProject::USaveGameProject()
{
	SaveVersion = GameProject::SaveGameVersion;
}

float USaveGameProject::GetNumericValue(FName Key, float DefaultValue) const
{
	const float* Found = NumericValues.Find(Key);
	return Found ? *Found : DefaultValue;
}

void USaveGameProject::SetNumericValue(FName Key, float Value)
{
	NumericValues.Add(Key, Value);
}

bool USaveGameProject::IsVersionSupported(int32 LoadedVersion)
{
	return LoadedVersion >= GameProject::SaveGameMinSupportedVersion
		&& LoadedVersion <= GameProject::SaveGameVersion;
}

bool USaveGameProject::MigrateFrom(int32 LoadedVersion)
{
	if (LoadedVersion == GameProject::SaveGameVersion)
	{
		return true;
	}

	if (!IsVersionSupported(LoadedVersion))
	{
		UE_LOG(LogSave, Error, TEXT("Save version %d is outside the supported range [%d..%d]; refusing to load."),
			LoadedVersion, GameProject::SaveGameMinSupportedVersion, GameProject::SaveGameVersion);
		return false;
	}

	// Migration steps are written as a fall-through ladder: a version 1 file runs
	// every step up to the current version, in order, exactly once.
	int32 Version = LoadedVersion;

	// Example of the pattern future phases must follow:
	// if (Version < 2)
	// {
	//     // v1 stored money in cents; v2 stores whole units.
	//     Money /= 100;
	//     Version = 2;
	// }

	SaveVersion = GameProject::SaveGameVersion;

	UE_LOG(LogSave, Log, TEXT("Migrated save from version %d to %d."), LoadedVersion, SaveVersion);
	return true;
}
