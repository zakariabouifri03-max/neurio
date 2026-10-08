// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"

/**
 * VOXEL CORE - DETERMINISTIC NOISE
 *
 * Integer-hash value noise with quintic interpolation, plus FBM and ridged
 * variants. Written from scratch for one reason: it must produce bit-identical
 * output everywhere.
 *
 * Perlin/simplex implementations that rely on a float permutation table, or on
 * sin/cos, can differ between compilers, optimisation levels and platforms. A
 * voxel world whose terrain drifts by a block between a save on one machine and a
 * load on another is broken beyond repair, because generated chunks are never
 * stored - only (Seed, Settings, ChunkCoord) is. So every function here is pure
 * integer hashing plus addition, multiplication and lerp on floats, in a fixed
 * evaluation order. Same input, same bits, on every platform.
 *
 * Everything is header-only inline: terrain generation calls this millions of
 * times per world and must not pay call overhead.
 */
namespace VoxelNoise
{
	/** Quintic fade. C2 continuous, so no visible grid artefacts in the terrain. */
	inline float Fade(float T)
	{
		return T * T * T * (T * (T * 6.0f - 15.0f) + 10.0f);
	}

	/**
	 * Finalised 32-bit integer hash. Constants are the standard Murmur3 mixer
	 * values; the mixer is avalanche-tested and cheap (two multiplies, three xors).
	 */
	inline uint32 Hash(int32 X, int32 Y, int32 Z, int32 Seed)
	{
		uint32 H = static_cast<uint32>(X) * 374761393u
			+ static_cast<uint32>(Y) * 668265263u
			+ static_cast<uint32>(Z) * 1103515245u
			+ static_cast<uint32>(Seed) * 2654435761u;

		H ^= H >> 13;
		H *= 1274126177u;
		H ^= H >> 16;
		return H;
	}

	inline uint32 Hash2(int32 X, int32 Y, int32 Seed)
	{
		return Hash(X, Y, 0, Seed);
	}

	/** Hash -> float in [0, 1). Uses the top 24 bits; the low bits are noisier. */
	inline float HashToUnit(uint32 H)
	{
		return static_cast<float>(H >> 8) * (1.0f / 16777216.0f);
	}

	/** Hash -> float in [-1, 1]. */
	inline float HashToSigned(uint32 H)
	{
		return HashToUnit(H) * 2.0f - 1.0f;
	}

	/** Hash -> integer in [0, Count). Uniform, no modulo bias worth worrying about at 24 bits. */
	inline int32 HashToRange(uint32 H, int32 Count)
	{
		return (Count > 0) ? static_cast<int32>(HashToUnit(H) * static_cast<float>(Count)) % Count : 0;
	}

	/**
	 * Per-octave seed offset.
	 *
	 * Done in unsigned arithmetic on purpose: signed overflow is undefined
	 * behaviour, and undefined behaviour is how a noise field that is supposed to be
	 * deterministic ends up differing between compilers and optimisation levels.
	 * Unsigned wraparound is defined, and C++20 defines the conversion back.
	 */
	inline int32 OctaveSeed(int32 Seed, int32 Octave)
	{
		return static_cast<int32>(static_cast<uint32>(Seed) + static_cast<uint32>(Octave) * 1013904223u);
	}

	// ------------------------------------------------------------------ 2D
	/** Bilinear-interpolated value noise in [-1, 1]. */
	inline float Value2D(float X, float Y, int32 Seed)
	{
		const int32 Xi = FMath::FloorToInt(X);
		const int32 Yi = FMath::FloorToInt(Y);

		const float Xf = Fade(X - static_cast<float>(Xi));
		const float Yf = Fade(Y - static_cast<float>(Yi));

		const float A = HashToSigned(Hash2(Xi, Yi, Seed));
		const float B = HashToSigned(Hash2(Xi + 1, Yi, Seed));
		const float C = HashToSigned(Hash2(Xi, Yi + 1, Seed));
		const float D = HashToSigned(Hash2(Xi + 1, Yi + 1, Seed));

		const float Top = A + (B - A) * Xf;
		const float Bottom = C + (D - C) * Xf;
		return Top + (Bottom - Top) * Yf;
	}

	/** Fractal Brownian motion, normalised so the result stays in [-1, 1] for any octave count. */
	inline float Fbm2D(float X, float Y, int32 Seed, int32 Octaves, float Lacunarity = 2.0f, float Gain = 0.5f)
	{
		Octaves = FMath::Clamp(Octaves, 1, 12);

		float Amplitude = 1.0f;
		float Frequency = 1.0f;
		float Sum = 0.0f;
		float Norm = 0.0f;

		for (int32 Octave = 0; Octave < Octaves; ++Octave)
		{
			// Each octave gets an uncorrelated seed rather than a scaled coordinate:
			// scaling alone makes octaves alias onto each other at high frequencies.
			Sum += Amplitude * Value2D(X * Frequency, Y * Frequency, OctaveSeed(Seed, Octave));
			Norm += Amplitude;

			Amplitude *= Gain;
			Frequency *= Lacunarity;
		}

		return (Norm > KINDA_SMALL_NUMBER) ? (Sum / Norm) : 0.0f;
	}

	/** Ridged multifractal in [0, 1]: sharp peaks, the right shape for mountain ranges. */
	inline float Ridged2D(float X, float Y, int32 Seed, int32 Octaves, float Lacunarity = 2.0f, float Gain = 0.5f, float Offset = 1.0f)
	{
		Octaves = FMath::Clamp(Octaves, 1, 12);

		float Amplitude = 1.0f;
		float Frequency = 1.0f;
		float Sum = 0.0f;
		float Norm = 0.0f;
		float Weight = 1.0f;

		for (int32 Octave = 0; Octave < Octaves; ++Octave)
		{
			float Signal = Value2D(X * Frequency, Y * Frequency, OctaveSeed(Seed, Octave));

			// Inverting the absolute value turns valleys into ridges.
			Signal = Offset - FMath::Abs(Signal);
			Signal = Signal * Signal;

			// Weight successive octaves by the previous one so ridges stay coherent
			// instead of dissolving into noise.
			Signal *= Weight;
			Weight = FMath::Clamp(Signal * 2.0f, 0.0f, 1.0f);

			Sum += Signal * Amplitude;
			Norm += Amplitude;

			Amplitude *= Gain;
			Frequency *= Lacunarity;
		}

		return (Norm > KINDA_SMALL_NUMBER) ? FMath::Clamp(Sum / Norm, 0.0f, 1.0f) : 0.0f;
	}

	// ------------------------------------------------------------------ 3D
	/**
	 * Trilinear value noise in [-1, 1]. Not used by Phase 02 terrain (which is a
	 * heightfield), included because caves, overhangs and 3D ore veins in Phase 03
	 * need it and it must share this file's determinism guarantees.
	 */
	inline float Value3D(float X, float Y, float Z, int32 Seed)
	{
		const int32 Xi = FMath::FloorToInt(X);
		const int32 Yi = FMath::FloorToInt(Y);
		const int32 Zi = FMath::FloorToInt(Z);

		const float Xf = Fade(X - static_cast<float>(Xi));
		const float Yf = Fade(Y - static_cast<float>(Yi));
		const float Zf = Fade(Z - static_cast<float>(Zi));

		const float C000 = HashToSigned(Hash(Xi, Yi, Zi, Seed));
		const float C100 = HashToSigned(Hash(Xi + 1, Yi, Zi, Seed));
		const float C010 = HashToSigned(Hash(Xi, Yi + 1, Zi, Seed));
		const float C110 = HashToSigned(Hash(Xi + 1, Yi + 1, Zi, Seed));
		const float C001 = HashToSigned(Hash(Xi, Yi, Zi + 1, Seed));
		const float C101 = HashToSigned(Hash(Xi + 1, Yi, Zi + 1, Seed));
		const float C011 = HashToSigned(Hash(Xi, Yi + 1, Zi + 1, Seed));
		const float C111 = HashToSigned(Hash(Xi + 1, Yi + 1, Zi + 1, Seed));

		const float X00 = C000 + (C100 - C000) * Xf;
		const float X10 = C010 + (C110 - C010) * Xf;
		const float X01 = C001 + (C101 - C001) * Xf;
		const float X11 = C011 + (C111 - C011) * Xf;

		const float Y0 = X00 + (X10 - X00) * Yf;
		const float Y1 = X01 + (X11 - X01) * Yf;

		return Y0 + (Y1 - Y0) * Zf;
	}

	inline float Fbm3D(float X, float Y, float Z, int32 Seed, int32 Octaves, float Lacunarity = 2.0f, float Gain = 0.5f)
	{
		Octaves = FMath::Clamp(Octaves, 1, 12);

		float Amplitude = 1.0f;
		float Frequency = 1.0f;
		float Sum = 0.0f;
		float Norm = 0.0f;

		for (int32 Octave = 0; Octave < Octaves; ++Octave)
		{
			Sum += Amplitude * Value3D(X * Frequency, Y * Frequency, Z * Frequency, OctaveSeed(Seed, Octave));
			Norm += Amplitude;
			Amplitude *= Gain;
			Frequency *= Lacunarity;
		}

		return (Norm > KINDA_SMALL_NUMBER) ? (Sum / Norm) : 0.0f;
	}
}
