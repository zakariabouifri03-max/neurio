using System;
using System.Text;
using AdzakDownloadPro.Core;
using AdzakDownloadPro.Tests.TestFramework;

namespace AdzakDownloadPro.Tests
{
    public sealed class ChecksumTests
    {
        [Fact]
        public void Sha256_known_vector_abc()
        {
            // Well-known SHA-256 test vector.
            var hex = Checksum.ComputeSha256Hex(Encoding.ASCII.GetBytes("abc"));
            Assert.Equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", hex);
        }

        [Fact]
        public void Sha256_known_vector_empty()
        {
            var hex = Checksum.ComputeSha256Hex(Array.Empty<byte>());
            Assert.Equal("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", hex);
        }

        [Fact]
        public void ToHex_produces_lowercase()
        {
            Assert.Equal("00ff10", Checksum.ToHex(new byte[] { 0x00, 0xFF, 0x10 }));
        }

        [Fact]
        public void Sha256Equals_is_case_insensitive()
        {
            Assert.True(Checksum.Sha256Equals(
                "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD",
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
        }

        [Fact]
        public void Sha256Equals_rejects_mismatch_and_garbage()
        {
            Assert.False(Checksum.Sha256Equals(
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
            Assert.False(Checksum.Sha256Equals(null, "aa"));
            Assert.False(Checksum.Sha256Equals("aa", null));
            Assert.False(Checksum.Sha256Equals("", ""));
        }

        [Fact]
        public void ParseDigestHeader_accepts_rfc9530_base64()
        {
            // SHA-256("abc") in base64: ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=
            var hex = Checksum.ParseDigestHeader("sha-256=:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=:");
            Assert.Equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", hex);
        }

        [Fact]
        public void ParseDigestHeader_accepts_legacy_base64_and_hex()
        {
            Assert.Equal(
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                Checksum.ParseDigestHeader("sha-256=ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0="));
            Assert.Equal(
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                Checksum.ParseDigestHeader("sha-256=BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD"));
        }

        [Fact]
        public void ParseDigestHeader_ignores_other_algorithms()
        {
            Assert.Null(Checksum.ParseDigestHeader("sha-512=:abcdef=:"));
            Assert.Null(Checksum.ParseDigestHeader("md5=abc"));
            Assert.Null(Checksum.ParseDigestHeader(null));
            Assert.Null(Checksum.ParseDigestHeader(""));
        }

        [Fact]
        public void ParseDigestHeader_handles_multiple_values()
        {
            var hex = Checksum.ParseDigestHeader("md5=abc, sha-256=:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=:, sha-512=zz");
            Assert.Equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", hex);
        }
    }
}
