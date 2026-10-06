package com.neurio.vm.core;

import com.neurio.vm.util.Hex;

import java.util.UUID;

/**
 * Turns a {@link DeviceCatalog.Preset} into a complete, self-consistent
 * {@link DeviceIdentity}: every identifier, the display geometry, the locale
 * and the carrier are filled in so that the result looks like a handset that
 * actually left a factory.
 *
 * <p>Two entry points:
 * <ul>
 *   <li>{@link #randomRetail()} — a plausible real phone, random carrier/locale.</li>
 *   <li>{@link #fromPreset(DeviceCatalog.Preset)} — exactly the device you picked.</li>
 * </ul>
 * Both keep the timezone/locale/IMEI-TAC aligned with the chosen region, which
 * is the detail most naive spoofers get wrong.
 */
public final class IdentityFactory {

    /** A mobile carrier: MCC-MNC, display name, ISO country and a plausible TAC range. */
    public static final class Carrier {
        public final String name;
        public final String mccMnc;
        public final String country;      // ISO 3166-1 alpha-2
        public final String timezone;     // IANA zone
        public final String language;     // ISO 639-1
        public final String tac;          // 8-digit Type Allocation Code

        Carrier(String name, String mccMnc, String country, String timezone, String language, String tac) {
            this.name = name; this.mccMnc = mccMnc; this.country = country;
            this.timezone = timezone; this.language = language; this.tac = tac;
        }

        @Override public String toString() { return name + " (" + mccMnc + ")"; }
    }

    /** Moroccan carriers first — this build is meant to be useful at home — then the rest. */
    public static final Carrier[] CARRIERS = {
        new Carrier("Maroc Telecom", "60400", "MA", "Africa/Casablanca", "fr", "35310109"),
        new Carrier("Orange Maroc",  "60401", "MA", "Africa/Casablanca", "fr", "35391511"),
        new Carrier("inwi",          "60402", "MA", "Africa/Casablanca", "ar", "35674410"),
        new Carrier("Free Mobile",   "20815", "FR", "Europe/Paris",      "fr", "35407116"),
        new Carrier("Orange France", "20801", "FR", "Europe/Paris",      "fr", "35396610"),
        new Carrier("SFR",           "20810", "FR", "Europe/Paris",      "fr", "35296610"),
        new Carrier("Vodafone ES",   "21401", "ES", "Europe/Madrid",     "es", "35328813"),
        new Carrier("O2 UK",         "23410", "GB", "Europe/London",     "en", "35865404"),
        new Carrier("Vodafone DE",   "26202", "DE", "Europe/Berlin",     "de", "35693803"),
        new Carrier("Turkcell",      "28601", "TR", "Europe/Istanbul",   "tr", "35328910"),
        new Carrier("Etisalat AE",   "42402", "AE", "Asia/Dubai",        "ar", "35272909"),
        new Carrier("Verizon US",    "311480", "US", "America/New_York", "en", "35272909"),
        new Carrier("T-Mobile US",   "310260", "US", "America/Los_Angeles", "en", "35331810"),
        new Carrier("No SIM",        "",      "",   "Etc/UTC",           "en", "35310109"),
    };

    private IdentityFactory() {}

    /** A random retail handset with a random (plausible) carrier. */
    public static DeviceIdentity randomRetail() {
        DeviceCatalog.Preset[] retail = DeviceCatalog.retail();
        DeviceCatalog.Preset p = retail[Hex.nextInt(retail.length)];
        Carrier c = CARRIERS[Hex.nextInt(CARRIERS.length - 1)]; // skip "No SIM"
        return fromPreset(p, c);
    }

    public static DeviceIdentity fromPreset(DeviceCatalog.Preset p) {
        return fromPreset(p, pickCarrierFor(p));
    }

    public static DeviceIdentity fromPreset(DeviceCatalog.Preset p, Carrier c) {
        DeviceIdentity.Builder b = DeviceIdentity.builder();
        b.id = UUID.randomUUID().toString();
        b.createdAt = System.currentTimeMillis();
        p.apply(b);

        b.timezoneId = c.timezone;
        b.language = c.language;
        b.country = c.country.isEmpty() ? "US" : c.country;
        b.operatorName = c.name;
        b.operatorMccMnc = c.mccMnc;
        b.simCountry = c.country;
        b.chromeMajor = pickChromeMajor(b.sdkInt);

        b.bootloader = p.group == DeviceCatalog.Group.EMULATOR
                ? "unknown" : "bootloader-" + Hex.randomHex(8);
        b.kernel = kernelFor(p);

        fillIdentifiers(b, c);
        return b.build();
    }

    /**
     * Fresh identifiers for an existing identity — the "this device has never
     * been seen before" button. The handset model is kept, everything that a
     * service uses to recognise a returning installation is replaced.
     */
    public static DeviceIdentity reissue(DeviceIdentity src) {
        DeviceIdentity.Builder b = src.toBuilder();
        fillIdentifiers(b, carrierOf(src));
        b.fingerprint = null;
        return b.build();
    }

    /** A brand new sandbox with a new UUID but the same handset. */
    public static DeviceIdentity clone(DeviceIdentity src, String newLabel) {
        DeviceIdentity.Builder b = src.toBuilder();
        b.id = UUID.randomUUID().toString();
        b.createdAt = System.currentTimeMillis();
        b.label = newLabel == null || newLabel.isEmpty() ? src.displayName() + " (copy)" : newLabel;
        fillIdentifiers(b, carrierOf(src));
        b.fingerprint = null;
        return b.build();
    }

    // ── internals ──────────────────────────────────────────────────────────

    private static void fillIdentifiers(DeviceIdentity.Builder b, Carrier c) {
        b.androidId = Hex.randomHex(16);
        b.gsfId = Hex.randomHex(16);
        b.serial = serialFor(b);
        b.advertisingId = UUID.randomUUID().toString().toUpperCase(java.util.Locale.US);
        b.imei = Hex.randomImei(c.tac);
        b.meid = Hex.randomDigits(14);
        b.simSerial = "89" + (c.mccMnc.isEmpty() ? "010100" : c.mccMnc) + Hex.randomDigits(9);
        b.imsi = (c.mccMnc.isEmpty() ? "00101" : c.mccMnc) + Hex.randomDigits(10);
        b.wifiMac = Hex.randomMac();
        b.bluetoothMac = Hex.randomMac();
        if (b.notes == null) b.notes = "";
    }

    /** Emulators report a generic serial; retail devices report 11–13 alphanumerics. */
    private static String serialFor(DeviceIdentity.Builder b) {
        if ("ranchu".equals(b.hardware) || "goldfish".equals(b.hardware)
                || "cutf_cvm".equals(b.hardware) || "vbox86".equals(b.hardware)) {
            return "EMULATOR" + Hex.randomDigits(4) + "X";
        }
        if ("redroid".equals(b.hardware)) return "REDROID" + Hex.randomHex(6).toUpperCase(java.util.Locale.US);
        String alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        int len = 11 + Hex.nextInt(3);
        StringBuilder sb = new StringBuilder(len);
        for (int i = 0; i < len; i++) sb.append(alphabet.charAt(Hex.nextInt(alphabet.length())));
        if ("samsung".equals(b.brand)) return "R" + sb.substring(0, Math.min(sb.length(), 10));
        return sb.toString();
    }

    private static String kernelFor(DeviceCatalog.Preset p) {
        if (p.group == DeviceCatalog.Group.EMULATOR) return "5.15.104-android14-11-g8ba8f2a4a3f0-ab11223344";
        if (p.group == DeviceCatalog.Group.CONTAINER) return "5.10.198-redroid";
        if ("mediatek".equals(p.hardware)) return "4.14.186-perf-g" + Hex.randomHex(10);
        if ("qcom".equals(p.hardware)) return "5.15.110-perf-g" + Hex.randomHex(10);
        if ("tensor".equals(p.hardware)) return "5.10.177-android13-4-g" + Hex.randomHex(10);
        return "4.19.157-" + Hex.randomHex(8);
    }

    /** Chrome major roughly matching the Android release the preset ships with. */
    private static int pickChromeMajor(int sdkInt) {
        if (sdkInt >= 35) return 130;
        if (sdkInt >= 34) return 126 + Hex.nextInt(6);
        if (sdkInt >= 33) return 118 + Hex.nextInt(6);
        if (sdkInt >= 31) return 104 + Hex.nextInt(6);
        if (sdkInt >= 29) return 89 + Hex.nextInt(6);
        return 74 + Hex.nextInt(6);
    }

    private static Carrier pickCarrierFor(DeviceCatalog.Preset p) {
        if (p.group == DeviceCatalog.Group.EMULATOR || p.group == DeviceCatalog.Group.CONTAINER) {
            return CARRIERS[CARRIERS.length - 1]; // "No SIM"
        }
        if ("samsung".equals(p.brand) || "TECNO".equals(p.brand) || "Infinix".equals(p.brand)
                || "HUAWEI".equals(p.brand) || "HONOR".equals(p.brand)) {
            return CARRIERS[Hex.nextInt(3)]; // Moroccan carriers are the common case here
        }
        return CARRIERS[Hex.nextInt(CARRIERS.length)];
    }

    /** Reverse-lookup so "reissue" keeps the same operator. */
    private static Carrier carrierOf(DeviceIdentity src) {
        for (Carrier c : CARRIERS) {
            if (c.mccMnc.equals(src.operatorMccMnc) && c.name.equals(src.operatorName)) return c;
        }
        for (Carrier c : CARRIERS) {
            if (!c.mccMnc.isEmpty() && c.mccMnc.equals(src.operatorMccMnc)) return c;
        }
        return CARRIERS[0];
    }
}
