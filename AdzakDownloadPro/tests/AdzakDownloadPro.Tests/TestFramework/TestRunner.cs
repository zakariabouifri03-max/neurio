using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;

namespace AdzakDownloadPro.Tests.TestFramework
{
    /// <summary>
    /// Discovers and runs all <see cref="FactAttribute"/> methods in the test assembly.
    /// Returns the number of failed tests (0 = success).
    /// </summary>
    public static class TestRunner
    {
        public static async Task<int> RunAllAsync(TimeSpan perTestTimeout)
        {
            var testMethods = Assembly.GetExecutingAssembly()
                .GetTypes()
                .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static))
                .Where(m => m.GetCustomAttribute<FactAttribute>() != null)
                .OrderBy(m => m.DeclaringType?.Name, StringComparer.Ordinal)
                .ThenBy(m => m.Name, StringComparer.Ordinal)
                .ToList();

            Console.WriteLine($"ADZAK DOWNLOAD PRO — test run");
            Console.WriteLine($"Discovered {testMethods.Count} tests.");
            Console.WriteLine(new string('=', 72));

            int passed = 0;
            var failures = new List<(string Name, string Error)>();

            foreach (var method in testMethods)
            {
                var fact = method.GetCustomAttribute<FactAttribute>()!;
                string name = fact.Name ?? $"{method.DeclaringType?.Name}.{method.Name}";

                object? instance = null;
                if (!method.IsStatic)
                    instance = Activator.CreateInstance(method.DeclaringType!);

                try
                {
                    var invokeTask = (Task?)method.Invoke(instance, null);
                    if (invokeTask != null)
                    {
                        var completed = await Task.WhenAny(invokeTask, Task.Delay(perTestTimeout)).ConfigureAwait(false);
                        if (completed != invokeTask)
                            throw new TimeoutException($"Test timed out after {perTestTimeout.TotalSeconds:0}s.");
                        await invokeTask.ConfigureAwait(false);
                    }
                    passed++;
                    Console.WriteLine($"  PASS  {name}");
                }
                catch (Exception ex)
                {
                    var error = ex is TargetInvocationException tie && tie.InnerException != null
                        ? tie.InnerException
                        : ex;
                    failures.Add((name, error.Message));
                    Console.WriteLine($"  FAIL  {name}");
                    Console.WriteLine($"        {error.GetType().Name}: {error.Message}");
                }
            }

            Console.WriteLine(new string('=', 72));
            Console.WriteLine($"Passed: {passed} / {testMethods.Count}");
            if (failures.Count > 0)
            {
                Console.WriteLine("Failed tests:");
                foreach (var (name, error) in failures)
                    Console.WriteLine($"  - {name}: {error}");
                return failures.Count;
            }
            Console.WriteLine("ALL TESTS PASSED");
            return 0;
        }
    }
}
