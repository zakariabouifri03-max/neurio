using System;

namespace AdzakDownloadPro.Tests.TestFramework
{
    /// <summary>Marks a method as a test. Methods may be <c>void</c> or <c>Task</c> returning.</summary>
    [AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
    public sealed class FactAttribute : Attribute
    {
        public FactAttribute(string? name = null)
        {
            Name = name;
        }

        /// <summary>Optional friendly name (defaults to the method name).</summary>
        public string? Name { get; }
    }
}
