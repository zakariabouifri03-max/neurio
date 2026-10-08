// Minimal stand-in for Unreal's CoreMinimal, used ONLY by the native voxel core
// tests in this folder. It is not shipped, not part of the game module, and never
// included by engine builds. Its purpose is to let the engine-agnostic voxel core
// be compiled and *executed* on a machine with no Unreal installation, so the
// coordinate maths, mesher and terrain generator are verified by running them
// rather than by inspection.
#pragma once

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdarg>
#include <cstring>
#include <ctime>
#include <string>
#include <utility>
#include <vector>

// ---------------------------------------------------------------- basic types
typedef int32_t  int32;
typedef uint32_t uint32;
typedef int16_t  int16;
typedef uint16_t uint16;
typedef int8_t   int8;
typedef uint8_t  uint8;
typedef int64_t  int64;
typedef uint64_t uint64;
typedef size_t   SIZE_T;
typedef char     TCHAR;

#define TEXT(x) x
#define INDEX_NONE (-1)
#define KINDA_SMALL_NUMBER (1.e-4f)
#define FORCEINLINE inline

enum EForceInit { ForceInit };

template <typename T> FORCEINLINE T&& MoveTemp(T& Value) { return static_cast<T&&>(Value); }
template <typename T> FORCEINLINE void Swap(T& A, T& B) { T Temp = MoveTemp(A); A = MoveTemp(B); B = MoveTemp(Temp); }

FORCEINLINE uint32 GetTypeHash(int32 Value) { return static_cast<uint32>(Value); }
FORCEINLINE uint32 GetTypeHash(uint16 Value) { return static_cast<uint32>(Value); }
FORCEINLINE uint32 GetTypeHash(float Value)
{
	uint32 Result = 0;
	std::memcpy(&Result, &Value, sizeof(Result));
	return Result;
}

inline uint32 HashCombineFast(uint32 A, uint32 B)
{
	return A * 31u + B * 17u;
}
inline uint32 HashCombineFast(uint32 A, uint32 B, uint32 C)
{
	return HashCombineFast(HashCombineFast(A, B), C);
}
inline uint32 HashCombineFast(uint32 A, uint32 B, uint32 C, uint32 D)
{
	return HashCombineFast(HashCombineFast(A, B), HashCombineFast(C, D));
}

// ---------------------------------------------------------------- FMath
struct FMath
{
	template <typename T> static T Max(T A, T B) { return (A < B) ? B : A; }
	template <typename T> static T Min(T A, T B) { return (A < B) ? A : B; }
	template <typename T> static T Abs(T A) { return (A < T(0)) ? -A : A; }
	template <typename T> static T Clamp(T X, T Min, T Max) { return X < Min ? Min : (X > Max ? Max : X); }

	static int32 FloorToInt(float F) { return static_cast<int32>(std::floor(F)); }
	static int32 FloorToInt(double F) { return static_cast<int32>(std::floor(F)); }
	static int32 CeilToInt(float F) { return static_cast<int32>(std::ceil(F)); }
	static int32 RoundToInt(float F) { return static_cast<int32>(std::lround(F)); }
	static int32 RoundToInt(double F) { return static_cast<int32>(std::lround(F)); }
	static int32 TruncToInt(float F) { return static_cast<int32>(F); }

	static bool IsNearlyEqual(float A, float B, float Tolerance = KINDA_SMALL_NUMBER) { return Abs(A - B) <= Tolerance; }
	static bool IsNearlyEqual(double A, double B, double Tolerance = KINDA_SMALL_NUMBER) { return Abs(A - B) <= Tolerance; }

	template <typename T> static T Lerp(T A, T B, float Alpha) { return static_cast<T>(A + (B - A) * Alpha); }

	/** Matches Unreal: normalises X into [A,B], clamps, then applies 3t^2 - 2t^3. */
	static float SmoothStep(float A = 0.0f, float B = 1.0f, float X = 0.5f)
	{
		const float Range = B - A;
		const float T = (Range > KINDA_SMALL_NUMBER) ? Clamp((X - A) / Range, 0.0f, 1.0f) : 0.0f;
		return T * T * (3.0f - 2.0f * T);
	}

	static float Sqrt(float F) { return std::sqrt(F); }
	static float Pow(float A, float B) { return std::pow(A, B); }
};

// ---------------------------------------------------------------- FMemory
struct FMemory
{
	static void Memzero(void* Dest, SIZE_T Size) { std::memset(Dest, 0, Size); }
	static void Memcpy(void* Dest, const void* Src, SIZE_T Size) { std::memcpy(Dest, Src, Size); }
};

struct FPlatformTime
{
	static double Seconds()
	{
		return static_cast<double>(std::clock()) / static_cast<double>(CLOCKS_PER_SEC);
	}
};

// ---------------------------------------------------------------- FString
struct FString
{
	std::string Data;

	FString() = default;
	FString(const TCHAR* Str) : Data(Str ? Str : "") {}

	static FString Printf(const TCHAR* Format, ...)
	{
		char Buffer[512];
		va_list Args;
		va_start(Args, Format);
		std::vsnprintf(Buffer, sizeof(Buffer), Format, Args);
		va_end(Args);
		return FString(Buffer);
	}

	const TCHAR* operator*() const { return Data.c_str(); }
	int32 Len() const { return static_cast<int32>(Data.size()); }
};

// ---------------------------------------------------------------- vectors
struct FVector2D
{
	float X = 0.0f;
	float Y = 0.0f;

	FVector2D() = default;
	FVector2D(float InX, float InY) : X(InX), Y(InY) {}

	bool operator==(const FVector2D& O) const { return X == O.X && Y == O.Y; }
};

struct FVector
{
	double X = 0.0, Y = 0.0, Z = 0.0;

	FVector() = default;
	explicit FVector(double InF) : X(InF), Y(InF), Z(InF) {}
	FVector(double InX, double InY, double InZ) : X(InX), Y(InY), Z(InZ) {}

	FVector operator+(const FVector& O) const { return FVector(X + O.X, Y + O.Y, Z + O.Z); }
	FVector operator-(const FVector& O) const { return FVector(X - O.X, Y - O.Y, Z - O.Z); }
	FVector operator*(double S) const { return FVector(X * S, Y * S, Z * S); }
	FVector& operator+=(const FVector& O) { X += O.X; Y += O.Y; Z += O.Z; return *this; }

	bool operator==(const FVector& O) const { return X == O.X && Y == O.Y && Z == O.Z; }
	double SizeSquared() const { return X * X + Y * Y + Z * Z; }
	double Size() const { return std::sqrt(SizeSquared()); }

	static FVector CrossProduct(const FVector& A, const FVector& B)
	{
		return FVector(A.Y * B.Z - A.Z * B.Y, A.Z * B.X - A.X * B.Z, A.X * B.Y - A.Y * B.X);
	}
	static double DotProduct(const FVector& A, const FVector& B)
	{
		return A.X * B.X + A.Y * B.Y + A.Z * B.Z;
	}

	static const FVector ZeroVector;
};

inline const FVector FVector::ZeroVector(0.0, 0.0, 0.0);

struct FIntVector
{
	int32 X = 0, Y = 0, Z = 0;

	FIntVector() = default;
	FIntVector(int32 InX, int32 InY, int32 InZ) : X(InX), Y(InY), Z(InZ) {}

	FIntVector operator+(const FIntVector& O) const { return FIntVector(X + O.X, Y + O.Y, Z + O.Z); }
	FIntVector operator-(const FIntVector& O) const { return FIntVector(X - O.X, Y - O.Y, Z - O.Z); }

	int32& operator[](int32 Index) { return (Index == 0) ? X : ((Index == 1) ? Y : Z); }
	int32 operator[](int32 Index) const { return (Index == 0) ? X : ((Index == 1) ? Y : Z); }

	bool operator==(const FIntVector& O) const { return X == O.X && Y == O.Y && Z == O.Z; }
	bool operator!=(const FIntVector& O) const { return !(*this == O); }
};

inline uint32 GetTypeHash(const FIntVector& V) { return HashCombineFast(GetTypeHash(V.X), GetTypeHash(V.Y), GetTypeHash(V.Z)); }

struct FBox
{
	FVector Min = FVector(0, 0, 0);
	FVector Max = FVector(0, 0, 0);
	bool bIsValid = false;

	FBox() = default;
	FBox(EForceInit) {}
	FBox(const FVector& InMin, const FVector& InMax) : Min(InMin), Max(InMax), bIsValid(true) {}

	FBox& operator+=(const FVector& Other)
	{
		if (!bIsValid)
		{
			Min = Max = Other;
			bIsValid = true;
		}
		else
		{
			Min.X = FMath::Min(Min.X, Other.X);
			Min.Y = FMath::Min(Min.Y, Other.Y);
			Min.Z = FMath::Min(Min.Z, Other.Z);
			Max.X = FMath::Max(Max.X, Other.X);
			Max.Y = FMath::Max(Max.Y, Other.Y);
			Max.Z = FMath::Max(Max.Z, Other.Z);
		}
		return *this;
	}

	bool IsInside(const FVector& V) const
	{
		return bIsValid
			&& V.X >= Min.X && V.X <= Max.X
			&& V.Y >= Min.Y && V.Y <= Max.Y
			&& V.Z >= Min.Z && V.Z <= Max.Z;
	}
};

struct FColor
{
	uint8 B = 0, G = 0, R = 0, A = 255;

	FColor() = default;
	FColor(uint8 InR, uint8 InG, uint8 InB, uint8 InA = 255) : B(InB), G(InG), R(InR), A(InA) {}

	bool operator==(const FColor& O) const { return R == O.R && G == O.G && B == O.B && A == O.A; }

	static const FColor White;
	static const FColor Black;
};

inline const FColor FColor::White(255, 255, 255, 255);
inline const FColor FColor::Black(0, 0, 0, 255);

// ---------------------------------------------------------------- TArray
template <typename T>
class TArray
{
public:
	TArray() = default;
	explicit TArray(int32 InNum) { SetNum(InNum); }

	int32 Num() const { return static_cast<int32>(Data.size()); }
	bool IsValidIndex(int32 Index) const { return Index >= 0 && Index < Num(); }

	T& operator[](int32 Index) { return Data[static_cast<size_t>(Index)]; }
	const T& operator[](int32 Index) const { return Data[static_cast<size_t>(Index)]; }

	T* GetData() { return Data.empty() ? nullptr : Data.data(); }
	const T* GetData() const { return Data.empty() ? nullptr : Data.data(); }

	// Unreal reports real slack; the shim reports none, so memory accounting in the
	// tests is exact and reproducible instead of depending on vector growth policy.
	int32 GetSlack() const { return 0; }

	void Reserve(int32 Number) { Data.reserve(static_cast<size_t>(Number)); }

	void SetNum(int32 NewNum) { Data.resize(static_cast<size_t>(NewNum)); }
	void SetNumZeroed(int32 NewNum) { Data.assign(static_cast<size_t>(NewNum), T()); }
	void SetNumUninitialized(int32 NewNum) { Data.resize(static_cast<size_t>(NewNum)); }

	void Reset(int32 NewSize = 0) { Data.clear(); if (NewSize > 0) { Data.reserve(static_cast<size_t>(NewSize)); } }
	void Empty(int32 Slack = 0) { Data.clear(); Data.shrink_to_fit(); }

	void Init(const T& Element, int32 Number) { Data.assign(static_cast<size_t>(Number), Element); }

	int32 Add(const T& Element) { Data.push_back(Element); return Num() - 1; }
	int32 Add(T&& Element) { Data.push_back(MoveTemp(Element)); return Num() - 1; }
	T& AddDefaulted() { Data.emplace_back(); return Data.back(); }

	void Insert(const T& Element, int32 Index) { Data.insert(Data.begin() + Index, Element); }
	void RemoveAtSwap(int32 Index)
	{
		if (!IsValidIndex(Index)) { return; }
		Data[static_cast<size_t>(Index)] = MoveTemp(Data.back());
		Data.pop_back();
	}

	void Append(const T* Source, int32 Count)
	{
		Data.insert(Data.end(), Source, Source + Count);
	}
	void Append(const TArray<T>& Other) { Data.insert(Data.end(), Other.Data.begin(), Other.Data.end()); }

	typename std::vector<T>::iterator begin() { return Data.begin(); }
	typename std::vector<T>::iterator end() { return Data.end(); }
	typename std::vector<T>::const_iterator begin() const { return Data.begin(); }
	typename std::vector<T>::const_iterator end() const { return Data.end(); }

private:
	std::vector<T> Data;
};

// ---------------------------------------------------------------- reflection stubs
#define UENUM(...)
#define USTRUCT(...)
#define UCLASS(...)
#define UFUNCTION(...)
#define UPROPERTY(...)
#define GENERATED_BODY()
#define UMETA(...)
