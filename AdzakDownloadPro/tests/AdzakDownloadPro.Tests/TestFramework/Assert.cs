using System;
using System.Collections;
using System.Linq;

namespace AdzakDownloadPro.Tests.TestFramework
{
    /// <summary>Minimal assertion helpers with descriptive failure messages.</summary>
    public static class Assert
    {
        public static void True(bool condition, string? message = null)
        {
            if (!condition)
                Fail(message ?? "Expected condition to be true.");
        }

        public static void False(bool condition, string? message = null)
        {
            if (condition)
                Fail(message ?? "Expected condition to be false.");
        }

        public static void Null(object? value, string? message = null)
        {
            if (value != null)
                Fail(message ?? $"Expected null but was: {value}");
        }

        public static void NotNull(object? value, string? message = null)
        {
            if (value == null)
                Fail(message ?? "Expected non-null value.");
        }

        public static void Equal<T>(T expected, T actual, string? message = null)
        {
            if (!Equals(expected, actual))
                Fail(message ?? $"Expected <{expected}> but was <{actual}>.");
        }

        public static void Equal(long expected, long actual, string? message = null)
        {
            if (expected != actual)
                Fail(message ?? $"Expected <{expected}> but was <{actual}>.");
        }

        public static void Equal(double expected, double actual, double tolerance, string? message = null)
        {
            if (Math.Abs(expected - actual) > tolerance)
                Fail(message ?? $"Expected <{expected}> ± {tolerance} but was <{actual}>.");
        }

        public static void NotEqual<T>(T notExpected, T actual, string? message = null)
        {
            if (Equals(notExpected, actual))
                Fail(message ?? $"Expected value different from <{notExpected}>.");
        }

        public static void EqualBytes(byte[] expected, byte[] actual, string? message = null)
        {
            NotNull(expected);
            NotNull(actual);
            if (expected.Length != actual.Length)
                Fail(message ?? $"Byte arrays differ in length: expected {expected.Length}, was {actual.Length}.");
            for (int i = 0; i < expected.Length; i++)
            {
                if (expected[i] != actual[i])
                    Fail(message ?? $"Byte arrays differ at index {i}: expected {expected[i]}, was {actual[i]}.");
            }
        }

        public static void SequenceEqual(IEnumerable expected, IEnumerable actual, string? message = null)
        {
            var e = expected.Cast<object?>().ToArray();
            var a = actual.Cast<object?>().ToArray();
            if (e.Length != a.Length)
                Fail(message ?? $"Sequences differ in length: expected {e.Length}, was {a.Length}.");
            for (int i = 0; i < e.Length; i++)
            {
                if (!Equals(e[i], a[i]))
                    Fail(message ?? $"Sequences differ at index {i}: expected <{e[i]}>, was <{a[i]}>.");
            }
        }

        public static void Contains(string expectedSubstring, string? actual, string? message = null)
        {
            NotNull(actual);
            if (!actual!.Contains(expectedSubstring))
                Fail(message ?? $"Expected <{actual}> to contain <{expectedSubstring}>.");
        }

        public static void GreaterThan(long actual, long threshold, string? message = null)
        {
            if (actual <= threshold)
                Fail(message ?? $"Expected {actual} to be greater than {threshold}.");
        }

        public static void GreaterThan(double actual, double threshold, string? message = null)
        {
            if (actual <= threshold)
                Fail(message ?? $"Expected {actual} to be greater than {threshold}.");
        }

        public static void LessThan(double actual, double threshold, string? message = null)
        {
            if (actual >= threshold)
                Fail(message ?? $"Expected {actual} to be less than {threshold}.");
        }

        public static void LessThanOrEqual(double actual, double threshold, string? message = null)
        {
            if (actual > threshold)
                Fail(message ?? $"Expected {actual} to be less than or equal to {threshold}.");
        }

        public static T Throws<T>(Action action, string? message = null) where T : Exception
        {
            try
            {
                action();
            }
            catch (T ex)
            {
                return ex;
            }
            catch (Exception ex)
            {
                Fail(message ?? $"Expected {typeof(T).Name} but got {ex.GetType().Name}: {ex.Message}");
            }
            Fail(message ?? $"Expected {typeof(T).Name} but no exception was thrown.");
            throw new InvalidOperationException(); // unreachable
        }

        public static void Fail(string message)
        {
            throw new AssertionException(message);
        }
    }

    public sealed class AssertionException : Exception
    {
        public AssertionException(string message) : base(message) { }
    }
}
