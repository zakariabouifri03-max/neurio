package com.neurio.vm.core;

import android.content.Context;
import android.os.Build;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import com.neurio.vm.util.Hex;
import com.neurio.vm.util.Io;
import com.neurio.vm.util.Log;

import java.io.File;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Encrypted-at-rest storage for the device profiles.
 *
 * <p>A profile is the one thing about this app that must not leak: it contains
 * the ANDROID_ID / IMEI / serial a given "handset" is known by. If those land
 * in a world-readable file, the whole point of the sandbox is lost.
 *
 * <p>Two key modes, chosen automatically:
 * <ul>
 *   <li><b>KEYSTORE</b> — a 256-bit AES-GCM key generated inside the Android
 *       Keystore (hardware-backed where the OEM provides it). The key material
 *       never leaves the secure element, so nothing in {@code filesDir} can be
 *       decrypted by another app or by a file dump.</li>
 *   <li><b>DERIVED</b> — fallback for the rare device where the Keystore refuses
 *       to create the key. A key is derived with PBKDF2-HMAC-SHA1 (120k rounds)
 *       from a per-install salt mixed with ANDROID_ID and the package name.
 *       This is obfuscation, not hardware-backed secrecy, and {@link #mode()}
 *       reports it so the UI can say so out loud.</li>
 * </ul>
 *
 * <p>File format: {@code magic(4) | version(1) | mode(1) | ivLen(1) | iv | ciphertext+tag}.
 */
public final class Vault {

    private static final String TAG = "Vault";
    private static final String ALIAS = "neurio_vm_master";
    private static final byte[] MAGIC = {'N', 'V', 'M', '1'};
    private static final byte VERSION = 1;
    private static final int GCM_TAG_BITS = 128;
    private static final int PBKDF2_ROUNDS = 120_000;

    public enum Mode { KEYSTORE, DERIVED, PLAINTEXT }

    private final Context ctx;
    private final File file;
    private Mode mode;

    public Vault(Context ctx, String fileName) {
        this(ctx, new File(new File(ctx.getApplicationContext().getFilesDir(), "vault"), fileName));
    }

    /** Absolute-location variant, used for the per-device identity files inside a sandbox. */
    public Vault(Context ctx, File file) {
        this.ctx = ctx.getApplicationContext();
        this.file = file;
        this.mode = openKey() != null ? Mode.KEYSTORE : Mode.DERIVED;
    }

    public Mode mode() { return mode; }

    public File location() { return file; }

    public boolean exists() { return file.isFile(); }

    // ── public API ─────────────────────────────────────────────────────────

    public synchronized void save(String plaintext) throws Exception {
        SecretKey key = openKey();
        byte[] body;
        if (key != null) {
            mode = Mode.KEYSTORE;
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key);
            byte[] iv = c.getIV();
            byte[] ct = c.doFinal(plaintext.getBytes(Io.UTF8));
            body = concat(iv, ct);
        } else {
            mode = Mode.DERIVED;
            byte[] iv = new byte[12];
            new SecureRandom().nextBytes(iv);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, derivedKey(iv), new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] ct = c.doFinal(plaintext.getBytes(Io.UTF8));
            body = concat(iv, ct);
        }

        byte[] header = new byte[MAGIC.length + 2];
        System.arraycopy(MAGIC, 0, header, 0, MAGIC.length);
        header[MAGIC.length] = VERSION;
        header[MAGIC.length + 1] = (byte) (mode == Mode.KEYSTORE ? 1 : 2);

        Io.writeBytes(file, concat(header, body));
    }

    public synchronized String load() throws Exception {
        if (!file.isFile()) return null;
        byte[] raw = Io.readBytes(file);
        if (raw.length < MAGIC.length + 3) throw new IllegalStateException("vault file truncated");
        for (int i = 0; i < MAGIC.length; i++) {
            if (raw[i] != MAGIC[i]) throw new IllegalStateException("not a NeurioVM vault");
        }
        if (raw[MAGIC.length] != VERSION) throw new IllegalStateException("unsupported vault version");

        int offset = MAGIC.length + 2;
        byte[] iv = new byte[12];
        System.arraycopy(raw, offset, iv, 0, iv.length);
        offset += iv.length;
        byte[] ct = Arrays.copyOfRange(raw, offset, raw.length);

        SecretKey key = openKey();
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        if (raw[MAGIC.length + 1] == 1 && key != null) {
            mode = Mode.KEYSTORE;
            c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
        } else {
            mode = Mode.DERIVED;
            c.init(Cipher.DECRYPT_MODE, derivedKey(iv), new GCMParameterSpec(GCM_TAG_BITS, iv));
        }
        return new String(c.doFinal(ct), Io.UTF8);
    }

    /** Wipes the vault file and destroys the Keystore key. */
    public synchronized void destroy() {
        Io.deleteRecursive(file);
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
        } catch (Exception e) {
            Log.w(TAG, "keystore cleanup failed: " + e.getMessage());
        }
    }

    // ── keys ───────────────────────────────────────────────────────────────

    private SecretKey openKey() {
        if (Build.VERSION.SDK_INT < 23) return null;
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(ALIAS)) {
                KeyStore.SecretKeyEntry e = (KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null);
                return e == null ? null : e.getSecretKey();
            }
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder(ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                    .build());
            return kg.generateKey();
        } catch (Throwable t) {
            // StrongBox / TEE failures are common on low-end devices; the caller
            // falls back to the derived key and the UI reports DERIVED.
            Log.w(TAG, "AndroidKeystore unavailable (" + t.getClass().getSimpleName()
                    + ": " + t.getMessage() + ") — falling back to a derived key");
            return null;
        }
    }

    /**
     * PBKDF2 fallback. The salt is stable per install (it lives next to the
     * vault), the password mixes in ANDROID_ID and the package name so two
     * installs on the same device do not share ciphertext.
     */
    private SecretKey derivedKey(byte[] iv) throws Exception {
        File saltFile = new File(file.getParentFile(), "salt");
        byte[] salt;
        if (saltFile.isFile()) {
            salt = Io.readBytes(saltFile);
        } else {
            salt = new byte[16];
            new SecureRandom().nextBytes(salt);
            Io.writeBytes(saltFile, salt);
        }
        String androidId = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ANDROID_ID);
        char[] password = (ctx.getPackageName() + "|" + androidId + "|" + Hex.of(salt)).toCharArray();
        PBEKeySpec spec = new PBEKeySpec(password, salt, PBKDF2_ROUNDS, 256);
        try {
            SecretKeyFactory f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1");
            return new SecretKeySpec(f.generateSecret(spec).getEncoded(), "AES");
        } finally {
            spec.clearPassword();
            Arrays.fill(password, '\0');
        }
    }

    private static byte[] concat(byte[] a, byte[] b) {
        byte[] out = new byte[a.length + b.length];
        System.arraycopy(a, 0, out, 0, a.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }
}
