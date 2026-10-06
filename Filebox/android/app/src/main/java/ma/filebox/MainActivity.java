package ma.filebox;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * The whole UI is built in code — no layouts, no appcompat, no AndroidX.
 * That keeps the build to plain Gradle + the Android SDK and the APK tiny.
 */
public class MainActivity extends Activity {

    private static final int PICK_FILES = 1001;
    private static final int PICK_ZIP = 1002;

    private static final int BG = 0xFF0B1120;
    private static final int CARD = 0xFF16213A;
    private static final int CARD2 = 0xFF1D2B48;
    private static final int LINE = 0xFF26354F;
    private static final int TXT = 0xFFEAF0FF;
    private static final int MUTED = 0xFF8FA1C4;
    private static final int ACC = 0xFF22D3A5;
    private static final int BAD = 0xFFEF5B6B;

    private LinearLayout root;
    private LinearLayout body;
    private LinearLayout tabBar;
    private int tab = 0;

    private final List<Uri> pending = new ArrayList<>();

    // ── lifecycle ───────────────────────────────────────────────────────────
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);

        body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(body, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        tabBar = new LinearLayout(this);
        tabBar.setOrientation(LinearLayout.HORIZONTAL);
        tabBar.setBackgroundColor(0xFF0D1424);
        root.addView(tabBar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        setContentView(root);
        buildTabs();

        if (hasPin()) showPin(false);
        else render();
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("filebox", Context.MODE_PRIVATE);
    }

    private boolean hasPin() {
        return prefs().contains("pin");
    }

    // ── tabs ────────────────────────────────────────────────────────────────
    private static final String[] TAB_LABELS = {"🏠", "🔒", "🧹", "☁️", "⚙️"};
    private static final String[] TAB_NAMES = {"Dashboard", "Coffre", "Tn9i", "Backup", "Réglages"};

    private void buildTabs() {
        tabBar.removeAllViews();
        for (int i = 0; i < TAB_LABELS.length; i++) {
            final int idx = i;
            LinearLayout cell = new LinearLayout(this);
            cell.setOrientation(LinearLayout.VERTICAL);
            cell.setGravity(Gravity.CENTER);
            cell.setPadding(dp(4), dp(9), dp(4), dp(9));
            cell.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { tab = idx; buildTabs(); render(); }
            });
            TextView ico = new TextView(this);
            ico.setText(TAB_LABELS[i]);
            ico.setTextSize(TypedValue.COMPLEX_UNIT_SP, 19);
            ico.setGravity(Gravity.CENTER);
            TextView lbl = new TextView(this);
            lbl.setText(TAB_NAMES[i]);
            lbl.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
            lbl.setGravity(Gravity.CENTER);
            lbl.setTextColor(i == tab ? ACC : MUTED);
            lbl.setTypeface(null, Typeface.BOLD);
            cell.addView(ico);
            cell.addView(lbl);
            tabBar.addView(cell, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        }
    }

    // ── views ───────────────────────────────────────────────────────────────
    private void render() {
        body.removeAllViews();
        switch (tab) {
            case 0: viewDash(); break;
            case 1: viewVault(); break;
            case 2: viewClean(); break;
            case 3: viewBackup(); break;
            default: viewSettings(); break;
        }
    }

    private void viewDash() {
        File dir = Space.vaultDir(this);
        long free = Space.freeBytes(dir);
        long total = Space.totalBytes(dir);
        List<File> vaults = Space.vaultFiles(this);
        long vaultBytes = 0, origBytes = 0;
        for (File f : vaults) vaultBytes += f.length();
        long saved = Math.max(0, prefs().getLong("saved", 0));

        pad().addView(h1("Salam 👋"));
        LinearLayout hero = card(0xFF0E7490);
        hero.addView(big(Space.human(saved), 38, Color.WHITE, true));
        hero.addView(txt("Mwaffer mn espace", 13, 0xCCFFFFFF));
        pad().addView(hero);

        LinearLayout stats = new LinearLayout(this);
        stats.setOrientation(LinearLayout.HORIZONTAL);
        stats.addView(stat("Coffres", String.valueOf(vaults.size())), rowLp());
        stats.addView(stat("Fihom", Space.human(vaultBytes)), rowLp());
        stats.addView(stat("Fadel f telefon", Space.human(free)), rowLp());
        pad().addView(stats);

        LinearLayout q = card(CARD);
        q.addView(txt("Espace dyal telefon: " + Space.human(free) + " / " + Space.human(total), 12, MUTED));
        q.addView(bar(1f - (free / (float) Math.max(1, total))));
        pad().addView(q);

        LinearLayout tip = card(0xFF2A2416);
        tip.addView(txt("💡 Kifach twaffer espace bessa7?", 14, 0xFFF5B642, true));
        tip.addView(txt("1. Dkhel l-milafat f coffre (khasrin).\n"
                + "2. Verifier l-coffre — ila slm, msah l-versions l-9dam.\n"
                + "3. Wla sift l-coffre l PC/NAS dyalek, w mn ba3d msah l-milafat l-9dam.", 13, 0xFFD8CBA6));
        pad().addView(tip);

        Button add = btn("➕ Zid milafat l coffre", ACC, 0xFF04231B);
        add.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { pickFiles(); }
        });
        pad().addView(add);
    }

    private void viewVault() {
        LinearLayout p = pad();
        p.addView(h1("Coffre"));

        List<File> vaults = Space.vaultFiles(this);
        if (vaults.isEmpty()) {
            p.addView(empty("🔒", "Ma 3ndek ta coffre.\nDwez 3la \"Zid milafat\" bach tsayb wahed."));
        }
        for (final File v : vaults) {
            boolean enc;
            try { enc = Vault.isEncrypted(v); } catch (Exception e) { enc = false; }
            LinearLayout row = card(CARD);
            row.addView(txt((enc ? "🔐 " : "🗜️ ") + v.getName(), 14, TXT, true));
            row.addView(txt(Space.human(v.length()) + " · " + new java.text.SimpleDateFormat(
                    "yyyy-MM-dd HH:mm", Locale.US).format(new java.util.Date(v.lastModified())), 12, MUTED));

            LinearLayout btns = new LinearLayout(this);
            btns.setOrientation(LinearLayout.HORIZONTAL);
            btns.addView(smallBtn("↩️ Rejje3", new View.OnClickListener() {
                @Override public void onClick(View x) { extract(v); }
            }));
            btns.addView(smallBtn("🔍 Verifier", new View.OnClickListener() {
                @Override public void onClick(View x) { verify(v); }
            }));
            btns.addView(smallBtn("🗑️", new View.OnClickListener() {
                @Override public void onClick(View x) { confirmDelete(v); }
            }));
            row.addView(btns);
            p.addView(row);
        }

        Button add = btn("➕ Sayb coffre jdid", ACC, 0xFF04231B);
        add.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { pickFiles(); }
        });
        p.addView(add);

        Button imp = btn("📂 Dkhel ZIP", CARD2, TXT);
        imp.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("application/zip");
                startActivityForResult(i, PICK_ZIP);
            }
        });
        p.addView(imp);
    }

    private void viewClean() {
        LinearLayout p = pad();
        p.addView(h1("Tn9i"));
        p.addView(txt("Hna ghadi tl9a l-milafat l-kbar w l-mkarrarin li f coffre dyalek. "
                + "L-app mat9dersh tmsah milafat mn telefon bla ma nta t2akked — hadchi 3lash "
                + "kola 3amalia 3ndha bouton dyalha.", 13, MUTED));

        final List<File> vaults = Space.vaultFiles(this);
        if (vaults.isEmpty()) { p.addView(empty("✨", "Ma kayn walou hna.")); return; }

        Button scan = btn("🔍 Scan l-coffres", CARD2, TXT);
        scan.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { scanVaults(vaults); }
        });
        p.addView(scan);
    }

    private void scanVaults(final List<File> vaults) {
        run(new Runnable() {
            @Override public void run() {
                final List<String> lines = new ArrayList<>();
                long total = 0;
                for (File v : vaults) {
                    try {
                        if (Vault.isEncrypted(v)) {
                            lines.add("🔐 " + v.getName() + "  (mkhabi — 7ellha bach tchouf)");
                            continue;
                        }
                        List<Vault.Entry> es = Vault.list(v, null);
                        for (Vault.Entry e : es) {
                            lines.add(String.format(Locale.US, "%8s  %s  (%s)",
                                    Space.human(e.size), e.name, v.getName()));
                            total += e.size;
                        }
                    } catch (Exception ex) {
                        lines.add("⚠ " + v.getName() + " — " + shortMsg(ex));
                    }
                }
                final long t = total;
                ui(new Runnable() {
                    @Override public void run() {
                        LinearLayout p = pad();
                        p.addView(h1("Contenu dyal l-coffres"));
                        p.addView(txt(Space.human(t) + " f " + lines.size() + " fichier", 13, ACC, true));
                        Collections.sort(lines, new Comparator<String>() {
                            @Override public int compare(String a, String b) { return b.compareTo(a); }
                        });
                        for (String s : lines) {
                            LinearLayout row = card(CARD);
                            row.addView(txt(s, 12, TXT));
                            p.addView(row);
                        }
                    }
                });
            }
        });
    }

    private void viewBackup() {
        LinearLayout p = pad();
        p.addView(h1("Backup"));
        p.addView(txt("Hadchi huwa li kaykhrej l-milafat MN telefon. Sift l-coffre l "
                + "Nextcloud / Freebox / NAS / PC dyalek b WebDAV, w mn ba3d msah l-coffre.", 13, MUTED));

        final EditText url = field(prefs().getString("url", ""), "https://cloud.example/remote.php/dav/files/me/");
        final EditText user = field(prefs().getString("user", ""), "utilisateur");
        final EditText pass = field(prefs().getString("pass", ""), "mot de passe");
        pass.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        p.addView(lbl("URL dyal WebDAV")); p.addView(url);
        p.addView(lbl("Utilisateur")); p.addView(user);
        p.addView(lbl("Mot de passe")); p.addView(pass);

        Button test = btn("🔗 Jerreb connexion", CARD2, TXT);
        test.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                saveCreds(url, user, pass);
                run(new Runnable() {
                    @Override public void run() {
                        final String err = Backup.probe(url.getText().toString(),
                                user.getText().toString(), pass.getText().toString());
                        ui(new Runnable() {
                            @Override public void run() {
                                toast(err == null ? "Connexion khdam ✅" : "Ma 9darnach: " + err);
                            }
                        });
                    }
                });
            }
        });
        p.addView(test);

        Button push = btn("⬆️ Sift l-coffre", ACC, 0xFF04231B);
        push.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { pushVault(url, user, pass); }
        });
        p.addView(push);
    }

    private void pushVault(final EditText url, final EditText user, final EditText pass) {
        final List<File> vaults = Space.vaultFiles(this);
        if (vaults.isEmpty()) { toast("Ma 3ndek ta coffre"); return; }
        saveCreds(url, user, pass);
        final ProgressBar bar = progress();
        pad().addView(bar);
        run(new Runnable() {
            @Override public void run() {
                final File f = vaults.get(0);
                final String err = Backup.put(url.getText().toString(), "filebox/" + f.getName(),
                        f, user.getText().toString(), pass.getText().toString(),
                        new Backup.Progress() {
                            @Override public void on(final float fr) {
                                ui(new Runnable() { @Override public void run() { bar.setProgress((int) (fr * 100)); } });
                            }
                        });
                ui(new Runnable() {
                    @Override public void run() {
                        bar.setVisibility(View.GONE);
                        toast(err == null ? "Tsift ✅ " + f.getName() : "Ghalat: " + err);
                    }
                });
            }
        });
    }

    private void viewSettings() {
        LinearLayout p = pad();
        p.addView(h1("Réglages"));

        LinearLayout s1 = card(CARD);
        s1.addView(txt("PIN", 15, TXT, true));
        s1.addView(txt(hasPin() ? "PIN kayn." : "Bla PIN kolchi y9der y7ell l-app.", 12, MUTED));
        LinearLayout b1 = new LinearLayout(this);
        b1.addView(smallBtn(hasPin() ? "Beddel" : "Sayb PIN", new View.OnClickListener() {
            @Override public void onClick(View v) { showPin(true); }
        }));
        if (hasPin()) b1.addView(smallBtn("7iyed", new View.OnClickListener() {
            @Override public void onClick(View v) {
                prefs().edit().remove("pin").remove("salt").apply();
                toast("PIN t7iyed"); render();
            }
        }));
        s1.addView(b1);
        p.addView(s1);

        LinearLayout s2 = card(CARD);
        s2.addView(txt("Coffres", 15, TXT, true));
        s2.addView(txt(Space.vaultDir(this).getAbsolutePath(), 11, MUTED));
        s2.addView(smallBtn("7ell f Files", new View.OnClickListener() {
            @Override public void onClick(View v) {
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(Uri.fromFile(Space.vaultDir(MainActivity.this)), "resource/folder");
                    startActivity(i);
                } catch (Exception e) { toast("Ma kayn ta app y7ell dossier"); }
            }
        }));
        p.addView(s2);

        LinearLayout s3 = card(CARD);
        s3.addView(txt("3la Filebox", 15, TXT, true));
        s3.addView(txt("Version 1.0.0 — coffre dyal milafat b compression w AES-256-GCM.", 12, MUTED));
        p.addView(s3);
    }

    // ── picking / creating ──────────────────────────────────────────────────
    private void pickFiles() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(i, PICK_FILES);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (res != RESULT_OK || data == null) return;
        pending.clear();
        if (data.getClipData() != null) {
            for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                pending.add(data.getClipData().getItemAt(i).getUri());
            }
        } else if (data.getData() != null) {
            pending.add(data.getData());
        }
        if (pending.isEmpty()) return;
        if (req == PICK_FILES) askVaultName();
        else if (req == PICK_ZIP) importZip(pending.get(0));
    }

    private void askVaultName() {
        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setPadding(dp(20), dp(20), dp(20), dp(10));

        long total = 0;
        for (Uri u : pending) { long s = Space.sizeOf(this, u); if (s > 0) total += s; }
        wrap.addView(txt(pending.size() + " fichier · " + Space.human(total), 13, MUTED));

        final EditText name = new EditText(this);
        name.setText("coffre-" + new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US)
                .format(new java.util.Date()));
        name.setTextColor(TXT);
        wrap.addView(lbl("Smiya dyal coffre"));
        wrap.addView(name);

        final EditText pass = new EditText(this);
        pass.setHint("mot de passe (khawi = bla chiffrement)");
        pass.setTextColor(TXT);
        pass.setHintTextColor(MUTED);
        pass.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        wrap.addView(lbl("Chiffrement AES-256"));
        wrap.addView(pass);

        dialog("Coffre jdid", wrap, "Sayb", new Runnable() {
            @Override public void run() { createVault(name.getText().toString(), pass.getText().toString()); }
        });
    }

    private void createVault(final String nameIn, final String password) {
        final String safe = nameIn.replaceAll("[^A-Za-z0-9._-]", "_");
        final ProgressBar bar = progress();
        pad().addView(bar);

        run(new Runnable() {
            @Override public void run() {
                try {
                    // SAF gives us content:// URIs — stage them into cache first,
                    // because java.util.zip needs real files
                    File stage = new File(getCacheDir(), "stage");
                    if (stage.exists()) deleteTree(stage);
                    stage.mkdirs();
                    final List<File> files = new ArrayList<>();
                    final List<String> names = new ArrayList<>();
                    long orig = 0;
                    for (int i = 0; i < pending.size(); i++) {
                        Uri u = pending.get(i);
                        String n = Space.displayName(MainActivity.this, u);
                        File f = new File(stage, (i + 1) + "-" + n);
                        java.io.InputStream in = Space.open(MainActivity.this, u);
                        try (OutputStream os = new FileOutputStream(f)) {
                            byte[] buf = new byte[65536];
                            int r;
                            while ((r = in.read(buf)) > 0) os.write(buf, 0, r);
                        } finally { in.close(); }
                        files.add(f);
                        names.add(n);
                        orig += f.length();
                        final float fr = (i + 1f) / pending.size() * 0.5f;
                        ui(new Runnable() { @Override public void run() { bar.setProgress((int) (fr * 100)); } });
                    }

                    File dest = new File(Space.vaultDir(MainActivity.this), safe + ".zip");
                    final long origFinal = orig;
                    Vault.create(dest, names, files, password, true, new Vault.Progress() {
                        @Override public void on(final float fr, String n) {
                            ui(new Runnable() { @Override public void run() { bar.setProgress((int) ((0.5f + fr * 0.5f) * 100)); } });
                        }
                    });
                    deleteTree(stage);

                    final long gained = Math.max(0, origFinal - dest.length());
                    prefs().edit().putLong("saved", prefs().getLong("saved", 0) + gained).apply();
                    ui(new Runnable() {
                        @Override public void run() {
                            bar.setVisibility(View.GONE);
                            toast("Coffre tsayb ✅ " + Space.human(origFinal) + " → "
                                    + Space.human(gained) + " mwaffer");
                            render();
                        }
                    });
                } catch (final Exception e) {
                    ui(new Runnable() {
                        @Override public void run() {
                            bar.setVisibility(View.GONE);
                            toast("Ghalat: " + shortMsg(e));
                        }
                    });
                }
            }
        });
    }

    private void importZip(final Uri uri) {
        run(new Runnable() {
            @Override public void run() {
                try {
                    File dest = new File(Space.vaultDir(MainActivity.this),
                            Space.displayName(MainActivity.this, uri));
                    java.io.InputStream in = Space.open(MainActivity.this, uri);
                    try (OutputStream os = new FileOutputStream(dest)) {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                    } finally { in.close(); }
                    ui(new Runnable() {
                        @Override public void run() { toast("Tdkhel ✅"); render(); }
                    });
                } catch (final Exception e) {
                    ui(new Runnable() { @Override public void run() { toast("Ghalat: " + shortMsg(e)); } });
                }
            }
        });
    }

    private void extract(final File vault) {
        askPassword(vault, new PassCb() {
            @Override public void got(String pass) {
                final ProgressBar bar = progress();
                pad().addView(bar);
                run(new Runnable() {
                    @Override public void run() {
                        try {
                            final File out = Space.restoredDir(MainActivity.this);
                            int n = Vault.extract(vault, pass, new Vault.Sink() {
                                @Override public OutputStream open(String entryName) throws java.io.IOException {
                                    return new FileOutputStream(Space.safeChild(out, entryName));
                                }
                            }, new Vault.Progress() {
                                @Override public void on(final float fr, String nm) {
                                    ui(new Runnable() { @Override public void run() { bar.setProgress((int) (fr * 100)); } });
                                }
                            });
                            final int done = n;
                            ui(new Runnable() {
                                @Override public void run() {
                                    bar.setVisibility(View.GONE);
                                    toast("Rje3na " + done + " fichier l " + out.getAbsolutePath());
                                }
                            });
                        } catch (final Exception e) {
                            ui(new Runnable() {
                                @Override public void run() {
                                    bar.setVisibility(View.GONE);
                                    toast("Ghalat: " + shortMsg(e));
                                }
                            });
                        }
                    }
                });
            }
        });
    }

    private void verify(final File vault) {
        askPassword(vault, new PassCb() {
            @Override public void got(final String pass) {
                run(new Runnable() {
                    @Override public void run() {
                        try {
                            final int n = Vault.verify(vault, pass);
                            ui(new Runnable() {
                                @Override public void run() { toast("Coffre slm ✅ " + n + " fichier"); }
                            });
                        } catch (final Exception e) {
                            ui(new Runnable() {
                                @Override public void run() { toast("⚠️ " + shortMsg(e)); }
                            });
                        }
                    }
                });
            }
        });
    }

    private void confirmDelete(final File vault) {
        LinearLayout wrap = new LinearLayout(this);
        wrap.setPadding(dp(20), dp(20), dp(20), 0);
        wrap.addView(txt("Msah \"" + vault.getName() + "\" b kolchi li fih?\nMa kayn رجوع.", 14, TXT));
        dialog("Msah coffre", wrap, "Msah", new Runnable() {
            @Override public void run() {
                boolean ok = vault.delete();
                toast(ok ? "Tmsah ✅" : "Ma 9darnach nmsah");
                render();
            }
        });
    }

    // ── PIN ─────────────────────────────────────────────────────────────────
    private interface PassCb { void got(String pass); }

    private void askPassword(File vault, final PassCb cb) {
        try {
            if (!Vault.isEncrypted(vault)) { cb.got(null); return; }
        } catch (Exception e) { cb.got(null); return; }
        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setPadding(dp(20), dp(20), dp(20), dp(10));
        final EditText pass = new EditText(this);
        pass.setHint("mot de passe dyal coffre");
        pass.setTextColor(TXT);
        pass.setHintTextColor(MUTED);
        pass.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        wrap.addView(pass);
        dialog(vault.getName(), wrap, "Wakha", new Runnable() {
            @Override public void run() { cb.got(pass.getText().toString()); }
        });
    }

    private void showPin(final boolean setting) {
        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setPadding(dp(20), dp(20), dp(20), dp(10));
        final EditText a = new EditText(this);
        a.setHint(setting ? "PIN jdid (4-8 chiffra)" : "Dakhel l-PIN");
        a.setTextColor(TXT); a.setHintTextColor(MUTED);
        a.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        wrap.addView(a);
        final EditText b = new EditText(this);
        if (setting) {
            b.setHint("3awd nfs l-PIN");
            b.setTextColor(TXT); b.setHintTextColor(MUTED);
            b.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
            wrap.addView(b);
        }
        dialog(setting ? "PIN jdid" : "🔒 Filebox", wrap, setting ? "Sajjel" : "7ell", new Runnable() {
            @Override public void run() {
                String p = a.getText().toString();
                if (setting) {
                    if (p.length() < 4) { toast("PIN khass 4 chiffra 3la l-a9al"); return; }
                    if (!p.equals(b.getText().toString())) { toast("L-PIN machi bhal bhal"); return; }
                    String salt = Long.toHexString(System.nanoTime());
                    prefs().edit().putString("salt", salt)
                            .putString("pin", sha256(p + "|" + salt)).apply();
                    toast("PIN tsajjel ✅");
                    render();
                } else {
                    String salt = prefs().getString("salt", "");
                    if (sha256(p + "|" + salt).equals(prefs().getString("pin", ""))) {
                        render();
                    } else {
                        toast("PIN ghalat");
                        showPin(false);
                    }
                }
            }
        });
    }

    private static String sha256(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format(Locale.US, "%02x", b));
            return sb.toString();
        } catch (Exception e) { return ""; }
    }

    // ── tiny widget kit ─────────────────────────────────────────────────────
    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private LinearLayout pad() {
        LinearLayout p = new LinearLayout(this);
        p.setOrientation(LinearLayout.VERTICAL);
        p.setPadding(dp(16), dp(16), dp(16), dp(24));
        body.addView(p, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return p;
    }

    private LinearLayout card(int bg) {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setBackgroundColor(bg);
        c.setPadding(dp(14), dp(13), dp(14), dp(13));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 0, 0, dp(9));
        c.setLayoutParams(lp);
        return c;
    }

    private LinearLayout.LayoutParams rowLp() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        lp.setMargins(0, 0, dp(6), dp(9));
        return lp;
    }

    private TextView txt(String s, int sp, int color) { return txt(s, sp, color, false); }

    private TextView txt(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(null, Typeface.BOLD);
        return t;
    }

    private TextView h1(String s) {
        TextView t = txt(s, 21, TXT, true);
        t.setPadding(0, dp(4), 0, dp(12));
        return t;
    }

    private TextView lbl(String s) { return txt(s, 12, MUTED, true); }

    private TextView big(String s, int sp, int color, boolean bold) { return txt(s, sp, color, bold); }

    private LinearLayout stat(String label, String value) {
        LinearLayout c = card(CARD);
        c.addView(txt(value, 17, TXT, true));
        c.addView(txt(label, 11, MUTED));
        return c;
    }

    private LinearLayout empty(String ico, String msg) {
        LinearLayout c = card(CARD);
        c.setGravity(Gravity.CENTER);
        c.addView(txt(ico, 44, TXT));
        c.addView(txt(msg, 13, MUTED));
        return c;
    }

    private View bar(float frac) {
        LinearLayout outer = new LinearLayout(this);
        outer.setBackgroundColor(CARD2);
        outer.setPadding(dp(2), dp(2), dp(2), dp(2));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(10));
        lp.setMargins(0, dp(8), 0, 0);
        outer.setLayoutParams(lp);
        View fill = new View(this);
        fill.setBackgroundColor(ACC);
        outer.addView(fill, new LinearLayout.LayoutParams(
                Math.max(dp(4), (int) (dp(240) * Math.max(0f, Math.min(1f, frac)))), dp(6)));
        return outer;
    }

    private ProgressBar progress() {
        ProgressBar p = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        p.setMax(100);
        return p;
    }

    private Button btn(String label, int bg, int fg) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setBackgroundColor(bg);
        b.setTextColor(fg);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        b.setPadding(dp(16), dp(14), dp(16), dp(14));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(6), 0, dp(6));
        b.setLayoutParams(lp);
        return b;
    }

    private Button smallBtn(String label, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setBackgroundColor(CARD2);
        b.setTextColor(TXT);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        b.setOnClickListener(l);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(6), dp(6), 0);
        b.setLayoutParams(lp);
        return b;
    }

    private EditText field(String value, String hint) {
        EditText e = new EditText(this);
        e.setText(value);
        e.setHint(hint);
        e.setTextColor(TXT);
        e.setHintTextColor(MUTED);
        e.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        e.setBackgroundColor(CARD);
        e.setPadding(dp(12), dp(11), dp(12), dp(11));
        e.setSingleLine(true);
        return e;
    }

    private void dialog(String title, View content, String okLabel, final Runnable onOk) {
        android.app.AlertDialog.Builder b = new android.app.AlertDialog.Builder(this);
        b.setTitle(title);
        b.setView(content);
        b.setNegativeButton("Bla", null);
        b.setPositiveButton(okLabel, new android.content.DialogInterface.OnClickListener() {
            @Override public void onClick(android.content.DialogInterface d, int w) { onOk.run(); }
        });
        b.show();
    }

    private void saveCreds(EditText url, EditText user, EditText pass) {
        prefs().edit().putString("url", url.getText().toString())
                .putString("user", user.getText().toString())
                .putString("pass", pass.getText().toString()).apply();
    }

    private void toast(final String s) { Toast.makeText(this, s, Toast.LENGTH_LONG).show(); }

    private void run(Runnable r) { new Thread(r).start(); }

    private void ui(Runnable r) { runOnUiThread(r); }

    private static String shortMsg(Throwable t) {
        String m = t.getMessage();
        if (m == null || m.isEmpty()) m = t.getClass().getSimpleName();
        return m.length() > 90 ? m.substring(0, 90) + "…" : m;
    }

    private static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }
}
