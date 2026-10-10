// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Vehicle/BCUVehicleDefinition.h"

int32 UBCUVehicleDefinition::GetDriverSeatIndex() const
{
	for (int32 i = 0; i < Seats.Num(); ++i)
	{
		if (Seats[i].bIsDriverSeat) { return i; }
	}

	// No seat is flagged as the driver's: fall back to seat 0 for four-wheelers
	// and refuse (INDEX_NONE) for vehicles that genuinely have no driver seat,
	// e.g. an unattended trailer.
	return Seats.Num() > 0 ? 0 : INDEX_NONE;
}
