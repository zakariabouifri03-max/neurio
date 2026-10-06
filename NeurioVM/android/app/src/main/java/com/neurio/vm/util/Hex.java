package com.neurio.vm.util;

import java.security.SecureRandom;
import java.util.Locale;

/** Hex / identifier helpers. All generators are deterministic-free (SecureRandom). */
public final class Hex {

    private static final char[] DIGITS = "0123456789abcdef".toCharArray();
    private static final SecureRandom RNG = new SecureRandom();

    private Hex() {}

    public static String of(byte[] data) {
        StringBuilder sb = new StringBuilder(data.length * 2);
        for (byte b : data) {
            sb.append(DIGITS[(b >> 4) & 0xF]).append(DIGITS[b & 0xF]);
        }
        return sb.toString();
    }

    public static byte[] parse(String hex) {
        String s = hex == null ? "" : hex.replaceAll("[^0-9a-fA-F]", "");
        if (s.length() % 2 != 0) s = s.substring(0, s.length() - 1);
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    /** {@code n} random hex characters — used for ANDROID_ID (16) and GSF id (16). */
    public static String randomHex(int n) {
        char[] out = new char[n];
        for (int i = 0; i < n; i++) out[i] = DIGITS[RNG.nextInt(16)];
        return new String(out);
    }

    /** A random MAC with the locally-administered bit set and unicast preserved. */
    public static String randomMac() {
        byte[] m = new byte[6];
        RNG.nextBytes(m);
        m[0] = (byte) ((m[0] & 0xFC) | 0x02); // locally administered, unicast
        StringBuilder sb = new StringBuilder(17);
        for (int i = 0; i < 6; i++) {
            if (i > 0) sb.append(':');
            sb.append(DIGITS[(m[i] >> 4) & 0xF]).append(DIGITS[m[i] & 0xF]);
        }
        return sb.toString().toUpperCase(Locale.US);
    }

    /** 14 random IMEI digits plus a correct Luhn check digit. */
    public static String randomImei(String tac) {
        StringBuilder body = new StringBuilder(tac == null || tac.length() != 8 ? "353" + randomDigits(11) : tac);
        if (body.length() > 14) body.setLength(14);
        while (body.length() < 14) body.append(DIGITS[RNG.nextInt(10)]);
        return body.toString() + luhn(body.toString());
    }

    public static String randomDigits(int n) {
        StringBuilder sb = new StringBuilder(n);
        for (int i = 0; i < n; i++) sb.append(DIGITS[RNG.nextInt(10)]);
        return sb.toString();
    }

    /** Luhn check digit for a string of decimal digits. */
    public static char luhn(String digits) {
        int sum = 0;
        // the check digit will sit at the rightmost position, so the digit next
        // to it is doubled first
        for (int i = 0; i < digits.length(); i++) {
            int d = digits.charAt(digits.length() - 1 - i) - '0';
            if (i % 2 == 0) {
                d *= 2;
                if (d > 9) d -= 9;
            }
            sum += d;
        }
        int check = (10 - (sum % 10)) % 10;
        return (char) ('0' + check);
    }

    public static int nextInt(int bound) {
        return RNG.nextInt(bound);
    }

    public static <T> T pick(T[] array) {
        return array[RNG.nextInt(array.length)];
    }

    public static SecureRandom rng() {
        return RNG;
    }

    /** Stable 32-bit hash used to seed the canvas / audio fingerprint noise. */
    public static int stableHash(String s) {
        int h = 0x811c9dc5;
        if (s != null) {
            for (int i = 0; i < s.length(); i++) {
                h ^= s.charAt(i);
                h *= 0x01000193;
            }
        }
        return h;
    }
}
