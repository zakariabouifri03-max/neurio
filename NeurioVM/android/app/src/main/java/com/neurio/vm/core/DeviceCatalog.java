package com.neurio.vm.core;

/**
 * Curated handset / emulator profiles.
 *
 * <p>Each preset carries the {@code android.os.Build} triple that a real device
 * (or a real emulator) reports, so a generated identity is internally
 * consistent: {@code brand}, {@code product}, {@code device} and the hardware
 * string always come from the same source. Consistency matters — a
 * "Samsung SM-S928B" advertising {@code ro.hardware=ranchu} is the single
 * easiest way for a service to flag a spoof.
 *
 * <p>Values are reconstructed from public build fingerprints and are accurate
 * enough to be plausible, not a substitute for the exact OTA your operator
 * shipped. Edit anything you like on the editor screen.
 */
public final class DeviceCatalog {

    /** Grouping used by the picker UI. */
    public enum Group { PHONE, TABLET, EMULATOR, CONTAINER }

    /** One immutable preset. */
    public static final class Preset {
        public final String name;
        public final Group group;
        public final String manufacturer;
        public final String brand;
        public final String model;
        public final String device;
        public final String product;
        public final String board;
        public final String hardware;
        public final String release;
        public final int sdkInt;
        public final String buildId;
        public final String securityPatch;
        public final int screenWidth;
        public final int screenHeight;
        public final int densityDpi;

        Preset(String name, Group group, String manufacturer, String brand, String model,
               String device, String product, String board, String hardware,
               String release, int sdkInt, String buildId, String securityPatch,
               int w, int h, int dpi) {
            this.name = name; this.group = group;
            this.manufacturer = manufacturer; this.brand = brand; this.model = model;
            this.device = device; this.product = product; this.board = board; this.hardware = hardware;
            this.release = release; this.sdkInt = sdkInt; this.buildId = buildId;
            this.securityPatch = securityPatch;
            this.screenWidth = w; this.screenHeight = h; this.densityDpi = dpi;
        }

        /** Copies this preset onto a builder, keeping everything the user already typed. */
        public DeviceIdentity.Builder apply(DeviceIdentity.Builder b) {
            b.manufacturer = manufacturer;
            b.brand = brand;
            b.model = model;
            b.device = device;
            b.product = product;
            b.board = board;
            b.hardware = hardware;
            b.release = release;
            b.sdkInt = sdkInt;
            b.buildId = buildId;
            b.securityPatch = securityPatch;
            b.displayId = buildId.contains(".") ? buildId.substring(0, buildId.indexOf('.')) : buildId;
            b.screenWidth = screenWidth;
            b.screenHeight = screenHeight;
            b.densityDpi = densityDpi;
            b.fingerprint = null; // re-derive from the new values
            if (b.label == null || b.label.isEmpty()) b.label = name;
            return b;
        }

        @Override public String toString() { return name; }
    }

    private static Preset phone(String name, String mf, String brand, String model, String device,
                                String board, String hw, String rel, int sdk, String bid,
                                String patch, int w, int h, int dpi) {
        return new Preset(name, Group.PHONE, mf, brand, model, device, device, board, hw,
                rel, sdk, bid, patch, w, h, dpi);
    }

    private static final Preset[] PRESETS = {
        // ── Google ────────────────────────────────────────────────────────
        phone("Google Pixel 8", "Google", "google", "Pixel 8", "shiba", "shiba", "tensor",
                "14", 34, "AP2A.240905.005", "2024-09-05", 1080, 2400, 420),
        phone("Google Pixel 8 Pro", "Google", "google", "Pixel 8 Pro", "husky", "husky", "tensor",
                "14", 34, "AP2A.240905.003", "2024-09-05", 1344, 2992, 480),
        phone("Google Pixel 7", "Google", "google", "Pixel 7", "panther", "panther", "tensor",
                "14", 34, "AP1A.240505.005", "2024-05-05", 1080, 2400, 420),
        phone("Google Pixel 6a", "Google", "google", "Pixel 6a", "bluejay", "bluejay", "tensor",
                "14", 34, "AP2A.240805.005", "2024-08-05", 1080, 2400, 420),

        // ── Samsung ───────────────────────────────────────────────────────
        phone("Samsung Galaxy S24 Ultra", "samsung", "samsung", "SM-S928B", "e3q", "s5e9945", "qcom",
                "14", 34, "UP1A.231005.007", "2024-08-01", 1440, 3120, 505),
        phone("Samsung Galaxy S23", "samsung", "samsung", "SM-S911B", "dm1q", "kalama", "qcom",
                "14", 34, "UP1A.231005.007", "2024-07-01", 1080, 2340, 480),
        phone("Samsung Galaxy A55 5G", "samsung", "samsung", "SM-A556B", "a55x", "exynos1480", "samsung",
                "14", 34, "UP1A.231005.007", "2024-06-01", 1080, 2340, 450),
        phone("Samsung Galaxy A15", "samsung", "samsung", "SM-A155F", "a15", "mt6789", "mediatek",
                "14", 34, "UP1A.231005.007", "2024-05-01", 1080, 2340, 450),
        phone("Samsung Galaxy A05s", "samsung", "samsung", "SM-A057F", "a05s", "bengal", "qcom",
                "13", 33, "TP1A.220624.014", "2024-04-01", 1080, 2400, 400),

        // ── Xiaomi / POCO / Redmi ─────────────────────────────────────────
        phone("Xiaomi 14", "Xiaomi", "Xiaomi", "23127PN0CC", "houji", "pineapple", "qcom",
                "14", 34, "UKQ1.230917.001", "2024-08-01", 1200, 2670, 480),
        phone("Redmi Note 13", "Xiaomi", "Redmi", "23124RN87G", "sapphire", "bengal", "qcom",
                "14", 34, "UKQ1.231003.002", "2024-07-01", 1080, 2400, 440),
        phone("Redmi Note 12", "Xiaomi", "Redmi", "22101316G", "sapphiren", "holi", "qcom",
                "13", 33, "TKQ1.221013.002", "2024-03-01", 1080, 2400, 440),
        phone("POCO X6 Pro", "Xiaomi", "POCO", "2311DRK48G", "duchamp", "mt6897", "mediatek",
                "14", 34, "UKQ1.230917.001", "2024-08-01", 1220, 2712, 480),

        // ── Brands that dominate the Moroccan market ──────────────────────
        phone("Tecno Spark 20", "TECNO", "TECNO", "TECNO KI7", "ki7", "mt6781", "mediatek",
                "13", 33, "TP1A.220624.014", "2024-02-01", 720, 1612, 320),
        phone("Infinix Hot 40", "Infinix", "Infinix", "Infinix X6853", "x6853", "mt6789", "mediatek",
                "13", 33, "TP1A.220624.014", "2024-03-01", 1080, 2400, 440),
        phone("Oppo Reno 11", "OPPO", "OPPO", "CPH2599", "PHZ110", "mt6877", "mediatek",
                "14", 34, "UP1A.231005.007", "2024-07-01", 1080, 2412, 480),
        phone("Realme C67", "realme", "realme", "RMX3890", "RE5C4DL1", "bengal", "qcom",
                "13", 33, "TP1A.220905.001", "2024-04-01", 1080, 2400, 440),
        phone("OnePlus 12", "OnePlus", "OnePlus", "CPH2573", "aston", "pineapple", "qcom",
                "14", 34, "UKQ1.230924.001", "2024-08-01", 1440, 3168, 560),
        phone("Huawei P30", "HUAWEI", "HUAWEI", "VOG-L29", "HWVOG", "kirin980", "hisilicon",
                "10", 29, "10.1.0.190", "2020-03-01", 1080, 2340, 440),
        phone("Motorola Moto G84 5G", "motorola", "motorola", "moto g84 5G", "bangali", "holi", "qcom",
                "13", 33, "T1TL33.30-24-2", "2024-05-01", 1080, 2400, 400),
        phone("Honor X9b", "HONOR", "HONOR", "MGI-NX1", "HNMXH", "mt6877", "mediatek",
                "13", 33, "TP1A.220624.014", "2024-06-01", 1080, 2388, 480),

        // ── Tablet ────────────────────────────────────────────────────────
        new Preset("Samsung Galaxy Tab A9+", Group.TABLET, "samsung", "samsung", "SM-X210",
                "a9xwifi", "a9xwifi", "kalama", "qcom", "13", 33, "TP1A.220624.014",
                "2024-04-01", 1200, 1920, 240),
        new Preset("Lenovo Tab M11", Group.TABLET, "Lenovo", "Lenovo", "TB331FU",
                "tb331fu", "tb331fu", "mt8781", "mediatek", "13", 33, "TP1A.220624.014",
                "2024-05-01", 1200, 1920, 240),

        // ── Real emulator fingerprints (this is what LDPlayer-class software
        //    reports; useful when you *want* to look like an emulator) ──────
        new Preset("AOSP Emulator — arm64 (ranchu)", Group.EMULATOR, "Google", "google",
                "sdk_gphone64_arm64", "emu64a", "sdk_gphone64_arm64", "emu64a", "ranchu",
                "14", 34, "UE1A.230829.036", "2024-01-05", 1080, 2400, 420),
        new Preset("AOSP Emulator — x86_64 (goldfish)", Group.EMULATOR, "Google", "google",
                "sdk_gphone64_x86_64", "emu64xa", "sdk_gphone64_x86_64", "emu64xa", "goldfish",
                "14", 34, "UE1A.230829.036", "2024-01-05", 1080, 2400, 420),
        new Preset("Cuttlefish — AOSP cloud device", Group.EMULATOR, "Google", "google",
                "vsoc_arm64", "vsoc_arm64", "aosp_cf_arm64_phone", "cutf_cvm", "cutf_cvm",
                "14", 34, "UD1A.231105.004", "2024-02-05", 1080, 2400, 320),
        new Preset("Genymotion — vbox86p", Group.EMULATOR, "Genymotion", "generic",
                "vbox86p", "vbox86p", "vbox86p", "vbox86", "vbox86",
                "11", 30, "RSR1.210714.001", "2021-07-01", 1080, 1920, 480),
        new Preset("LDPlayer-style — Samsung SM-G955N", Group.EMULATOR, "samsung", "samsung",
                "SM-G955N", "star2qltekor", "star2qltekor", "universal9810", "samsungexynos9810",
                "9", 28, "PPR1.180610.011", "2019-04-01", 1440, 2960, 560),
        new Preset("BlueStacks-style — Samsung SM-N975F", Group.EMULATOR, "samsung", "samsung",
                "SM-N975F", "d2s", "d2sxeea", "exynos9825", "samsungexynos9825",
                "11", 30, "RP1A.200720.012", "2021-09-01", 1440, 3040, 493),

        // ── Container runtimes (pairs with the redroid backend below) ─────
        new Preset("Redroid — containerised Android 11", Group.CONTAINER, "redroid", "redroid",
                "redroid_arm64", "redroid_arm64", "redroid_arm64", "redroid", "redroid",
                "11", 30, "RD1A.201105.003", "2021-01-05", 1080, 1920, 320),
        new Preset("Redroid — containerised Android 13", Group.CONTAINER, "redroid", "redroid",
                "redroid_arm64", "redroid_arm64", "redroid_arm64", "redroid", "redroid",
                "13", 33, "TD1A.221105.004", "2023-01-05", 1080, 2400, 400),
    };

    private DeviceCatalog() {}

    public static Preset[] all() {
        return PRESETS.clone();
    }

    public static Preset at(int index) {
        return PRESETS[Math.max(0, Math.min(index, PRESETS.length - 1))];
    }

    /** Only real retail handsets — used by the "surprise me" generator so that
     *  a random device never accidentally looks like an emulator. */
    public static Preset[] retail() {
        int n = 0;
        for (Preset p : PRESETS) if (p.group == Group.PHONE || p.group == Group.TABLET) n++;
        Preset[] out = new Preset[n];
        int i = 0;
        for (Preset p : PRESETS) if (p.group == Group.PHONE || p.group == Group.TABLET) out[i++] = p;
        return out;
    }

    /** Names for a {@code Spinner}; index matches {@link #all()}. */
    public static CharSequence[] names() {
        CharSequence[] out = new CharSequence[PRESETS.length];
        for (int i = 0; i < PRESETS.length; i++) out[i] = PRESETS[i].name;
        return out;
    }
}
