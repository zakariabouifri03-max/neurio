package ma.filebox;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.zip.CRC32;
import java.util.zip.Deflater;
import java.util.zip.Inflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * A vault is an ordinary .zip file with one twist.
 *
 * An encrypted entry uses compression method 99 (the "vendor" method) plus a
 * 0xFB01 extra field that records the real compression method, and its payload
 * is
 *
 *     salt(32) | iv(12) | AES-256-GCM(stored bytes) || tag(16)
 *
 * with the key from PBKDF2-SHA256(password, salt, 250000, 32 bytes).
 * That is the same layout the Filebox web app writes, so a vault moves between
 * the phone and the browser untouched.
 *
 * Two deliberate choices:
 *  · the general-purpose "encrypted" bit is left clear, because java.util.zip
 *    refuses to read entries that have it set;
 *  · reading goes through ZipFile (random access), never ZipInputStream, which
 *    throws on method 99.
 *
 * An unencrypted vault is a plain zip that any unzip tool can open.
 */
public final class Vault {

    public static final int METHOD_WRAPPED = 99;
    public static final int EXTRA_ID = 0xFB01;
    private static final int SALT_LEN = 32;
    private static final int IV_LEN = 12;
    private static final int TAG_BITS = 128;
    private static final int ITERATIONS = 250_000;

    private Vault() {}

    public static final class Entry {
        public final String name;
        public final long size;          // decrypted size
        public final long lastModified;
        Entry(String name, long size, long lastModified) {
            this.name = name; this.size = size; this.lastModified = lastModified;
        }
    }

    public interface Progress {
        void on(float fraction, String currentName);
    }

    public interface Sink {
        OutputStream open(String entryName) throws IOException;
    }

    // ── crypto ──────────────────────────────────────────────────────────────
    public static byte[] newSalt() {
        byte[] s = new byte[SALT_LEN];
        new SecureRandom().nextBytes(s);
        return s;
    }

    public static SecretKey deriveKey(String password, byte[] salt) throws GeneralSecurityException {
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, 256);
        try {
            SecretKeyFactory f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            return new SecretKeySpec(f.generateSecret(spec).getEncoded(), "AES");
        } finally {
            spec.clearPassword();
        }
    }

    private static byte[] seal(SecretKey key, byte[] plain) throws GeneralSecurityException {
        byte[] iv = new byte[IV_LEN];
        new SecureRandom().nextBytes(iv);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
        byte[] sealed = c.doFinal(plain);                   // ciphertext || tag
        byte[] out = new byte[IV_LEN + sealed.length];
        System.arraycopy(iv, 0, out, 0, IV_LEN);
        System.arraycopy(sealed, 0, out, IV_LEN, sealed.length);
        return out;
    }

    private static byte[] unseal(SecretKey key, byte[] blob) throws GeneralSecurityException {
        byte[] iv = new byte[IV_LEN];
        System.arraycopy(blob, 0, iv, 0, IV_LEN);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
        return c.doFinal(blob, IV_LEN, blob.length - IV_LEN);
    }

    /** 0xFB01 | size 4 | "FB" | <H real compression method> */
    private static byte[] extraField(int realMethod) {
        return new byte[] {
            (byte) (EXTRA_ID & 0xff), (byte) ((EXTRA_ID >> 8) & 0xff), 0x04, 0x00,
            'F', 'B',
            (byte) (realMethod & 0xff), (byte) ((realMethod >> 8) & 0xff)
        };
    }

    private static int realMethodOf(ZipEntry e) {
        byte[] x = e.getExtra();
        if (x == null) return ZipEntry.STORED;
        int p = 0;
        while (p + 4 <= x.length) {
            int id = (x[p] & 0xff) | ((x[p + 1] & 0xff) << 8);
            int len = (x[p + 2] & 0xff) | ((x[p + 3] & 0xff) << 8);
            if (id == EXTRA_ID && len >= 4 && p + 8 <= x.length) {
                return (x[p + 6] & 0xff) | ((x[p + 7] & 0xff) << 8);
            }
            p += 4 + len;
        }
        return ZipEntry.STORED;
    }

    // ── create ──────────────────────────────────────────────────────────────
    /**
     * @param dest      the .zip to write
     * @param names     entry names, parallel to {@code sources}
     * @param sources   one File per entry
     * @param password  null/empty → plain zip
     * @param deflate   false → store, true → deflate
     */
    public static void create(File dest, List<String> names, List<File> sources,
                              String password, boolean deflate, Progress prog)
            throws IOException, GeneralSecurityException {

        boolean encrypt = password != null && !password.isEmpty();
        byte[] salt = encrypt ? newSalt() : null;
        SecretKey key = encrypt ? deriveKey(password, salt) : null;

        try (ZipOutputStream zos = new ZipOutputStream(new FileOutputStream(dest))) {
            zos.setLevel(deflate ? Deflater.DEFAULT_COMPRESSION : Deflater.NO_COMPRESSION);

            for (int i = 0; i < sources.size(); i++) {
                File src = sources.get(i);
                byte[] plain = readFile(src);

                int realMethodHere = deflate ? ZipEntry.DEFLATED : ZipEntry.STORED;
                ZipEntry ze = new ZipEntry(names.get(i));
                ze.setTime(src.lastModified() > 0 ? src.lastModified() : System.currentTimeMillis());

                if (encrypt) {
                    // compress first, then encrypt — the extra field records which
                    // of the two the reader has to undo, and in what order
                    byte[] toSeal = plain;
                    if (deflate) {
                        byte[] z = deflate(plain);
                        if (z.length < plain.length) toSeal = z;
                        else realMethodHere = ZipEntry.STORED;
                    }
                    byte[] sealed = seal(key, toSeal);
                    byte[] body = new byte[SALT_LEN + sealed.length];
                    System.arraycopy(salt, 0, body, 0, SALT_LEN);
                    System.arraycopy(sealed, 0, body, SALT_LEN, sealed.length);

                    ze.setMethod(METHOD_WRAPPED);           // stored verbatim, no deflate
                    ze.setExtra(extraField(realMethodHere));
                    ze.setSize(body.length);
                    ze.setCompressedSize(body.length);
                    CRC32 crc = new CRC32();
                    crc.update(body);
                    ze.setCrc(crc.getValue());
                    zos.putNextEntry(ze);
                    zos.write(body);
                } else if (deflate) {
                    ze.setMethod(ZipEntry.DEFLATED);
                    zos.putNextEntry(ze);
                    zos.write(plain);
                } else {
                    ze.setMethod(ZipEntry.STORED);
                    ze.setSize(plain.length);
                    ze.setCompressedSize(plain.length);
                    CRC32 crc = new CRC32();
                    crc.update(plain);
                    ze.setCrc(crc.getValue());
                    zos.putNextEntry(ze);
                    zos.write(plain);
                }
                zos.closeEntry();
                if (prog != null) prog.on((i + 1f) / sources.size(), names.get(i));
            }
        }
    }

    // ── read ────────────────────────────────────────────────────────────────
    public static List<Entry> list(File vault, String password)
            throws IOException, GeneralSecurityException {
        List<Entry> out = new ArrayList<>();
        try (ZipFile zf = new ZipFile(vault)) {
            Enumeration<? extends ZipEntry> en = zf.entries();
            while (en.hasMoreElements()) {
                ZipEntry e = en.nextElement();
                if (e.isDirectory()) continue;
                byte[] data = decode(zf, e, password);
                out.add(new Entry(e.getName(), data.length, e.getTime()));
            }
        }
        return out;
    }

    /** Decrypts and inflates every entry. Returns the entry count; throws on any damage. */
    public static int verify(File vault, String password)
            throws IOException, GeneralSecurityException {
        int n = 0;
        try (ZipFile zf = new ZipFile(vault)) {
            Enumeration<? extends ZipEntry> en = zf.entries();
            while (en.hasMoreElements()) {
                ZipEntry e = en.nextElement();
                if (e.isDirectory()) continue;
                decode(zf, e, password);
                n++;
            }
        }
        return n;
    }

    public static int extract(File vault, String password, Sink sink, Progress prog)
            throws IOException, GeneralSecurityException {
        int done = 0;
        try (ZipFile zf = new ZipFile(vault)) {
            List<ZipEntry> all = new ArrayList<>();
            Enumeration<? extends ZipEntry> en = zf.entries();
            while (en.hasMoreElements()) {
                ZipEntry e = en.nextElement();
                if (!e.isDirectory()) all.add(e);
            }
            for (ZipEntry e : all) {
                byte[] data = decode(zf, e, password);
                try (OutputStream os = sink.open(e.getName())) {
                    os.write(data);
                }
                done++;
                if (prog != null) prog.on(done / (float) all.size(), e.getName());
            }
        }
        return done;
    }

    /** Reads one entry's plaintext. */
    public static byte[] readEntry(File vault, String entryName, String password)
            throws IOException, GeneralSecurityException {
        try (ZipFile zf = new ZipFile(vault)) {
            ZipEntry e = zf.getEntry(entryName);
            if (e == null) throw new IOException("no such entry: " + entryName);
            return decode(zf, e, password);
        }
    }

    public static boolean isEncrypted(File vault) throws IOException {
        try (ZipFile zf = new ZipFile(vault)) {
            Enumeration<? extends ZipEntry> en = zf.entries();
            while (en.hasMoreElements()) {
                if (en.nextElement().getMethod() == METHOD_WRAPPED) return true;
            }
        }
        return false;
    }

    /** Returns the stored (compressed) payload of an entry and decrypts it. */
    private static byte[] decode(ZipFile zf, ZipEntry e, String password)
            throws IOException, GeneralSecurityException {
        byte[] raw;
        try (InputStream in = zf.getInputStream(e)) {
            raw = readAll(in);                    // already inflated unless method 99
        }
        if (e.getMethod() != METHOD_WRAPPED) return raw;
        if (password == null || password.isEmpty()) {
            throw new GeneralSecurityException("vault is encrypted — password required");
        }
        if (raw.length < SALT_LEN + IV_LEN + 16) {
            throw new IOException("entry too short to be a Filebox vault entry: " + e.getName());
        }
        byte[] salt = new byte[SALT_LEN];
        System.arraycopy(raw, 0, salt, 0, SALT_LEN);
        byte[] body = new byte[raw.length - SALT_LEN];
        System.arraycopy(raw, SALT_LEN, body, 0, body.length);
        byte[] plain = unseal(deriveKey(password, salt), body);
        return realMethodOf(e) == ZipEntry.DEFLATED ? inflate(plain) : plain;
    }

    private static byte[] deflate(byte[] data) {
        // zlib-wrapped deflate (nowrap=false) so this matches the web app, which
        // uses CompressionStream('deflate-raw') ... see note below
        Deflater d = new Deflater(Deflater.DEFAULT_COMPRESSION, false);
        d.setInput(data);
        d.finish();
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(64, data.length / 2));
        byte[] buf = new byte[65536];
        while (!d.finished()) {
            int n = d.deflate(buf);
            out.write(buf, 0, n);
        }
        d.end();
        return out.toByteArray();
    }

    private static byte[] inflate(byte[] data) throws IOException {
        Inflater inf = new Inflater(false);             // zlib-wrapped, matches deflate()
        inf.setInput(data);
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(64, data.length * 2));
        byte[] buf = new byte[65536];
        try {
            while (!inf.finished()) {
                int n = inf.inflate(buf);
                if (n == 0 && (inf.needsInput() || inf.needsDictionary())) break;
                out.write(buf, 0, n);
            }
        } catch (java.util.zip.DataFormatException ex) {
            throw new IOException("damaged deflate stream", ex);
        } finally {
            inf.end();
        }
        return out.toByteArray();
    }

    // ── file helpers ────────────────────────────────────────────────────────
    public static byte[] readFile(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            return readAll(in);
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(65536);
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }
}
