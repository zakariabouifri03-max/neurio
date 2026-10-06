package com.neurio.vm;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ListView;
import android.widget.TextView;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.core.ProfileStore;
import com.neurio.vm.hook.HookConfig;
import com.neurio.vm.util.Io;
import com.neurio.vm.util.Ui;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Chooses which installed applications the LSPosed module should rewrite.
 *
 * <p>Enumerating every installed package needs {@code QUERY_ALL_PACKAGES} on
 * Android 11+, which is exactly why this app declares it: there is no
 * narrower way to offer "pick the apps you want to appear as a different
 * handset". The list is read-only — nothing here can launch or modify another
 * app, it only records package names into the hook configuration.
 *
 * <p>Selection is stored per device through {@link HookConfig#publish}; the
 * module inside each hooked process reads it back over {@code HookProvider}.
 */
public final class HookAppsActivity extends Activity {

    private static final class AppEntry {
        final String label;
        final String pkg;
        boolean selected;

        AppEntry(String label, String pkg, boolean selected) {
            this.label = label;
            this.pkg = pkg;
            this.selected = selected;
        }
    }

    private DeviceIdentity device;
    private final List<AppEntry> all = new ArrayList<>();
    private final List<AppEntry> shown = new ArrayList<>();
    private AppAdapter adapter;
    private TextView count;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_hook_apps);
        device = ProfileStore.get(this).get(getIntent().getStringExtra(DeviceActivity.EXTRA_DEVICE));
        if (device == null) {
            finish();
            return;
        }

        count = findViewById(R.id.k_count);
        ListView list = findViewById(R.id.k_list);
        adapter = new AppAdapter();
        list.setAdapter(adapter);

        list.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                AppEntry e = shown.get(position);
                e.selected = !e.selected;
                adapter.notifyDataSetChanged();
                updateCount();
            }
        });

        EditText search = findViewById(R.id.k_search);
        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) { filter(s.toString()); }
            @Override public void afterTextChanged(Editable s) { }
        });

        findViewById(R.id.k_all).setOnClickListener(v -> {
            for (AppEntry e : shown) e.selected = true;
            adapter.notifyDataSetChanged();
            updateCount();
        });
        findViewById(R.id.k_none).setOnClickListener(v -> {
            for (AppEntry e : shown) e.selected = false;
            adapter.notifyDataSetChanged();
            updateCount();
        });
        findViewById(R.id.k_save).setOnClickListener(v -> save());

        if (!lspLikely()) {
            TextView warn = findViewById(R.id.k_status);
            warn.setVisibility(View.VISIBLE);
            warn.setText(getString(R.string.hook_not_active));
        }

        load();
    }

    private boolean lspLikely() {
        return Io.exists("/data/adb/lspd") || Io.exists("/data/adb/modules/zygisk_lsposed")
                || System.getProperty("xposed.version") != null;
    }

    private void load() {
        Ui.bg(() -> {
            final Set<String> selected = currentSelection();
            PackageManager pm = getPackageManager();
            List<ApplicationInfo> apps = new ArrayList<>();
            try {
                apps.addAll(pm.getInstalledApplications(0));
            } catch (Throwable t) {
                // Some builds throw here; the query-API fallback is enough.
            }
            final List<AppEntry> entries = new ArrayList<>();
            for (ApplicationInfo info : apps) {
                String pkg = info.packageName;
                if (pkg == null || pkg.equals(getPackageName())) continue;
                if (pkg.startsWith("com.android.") || pkg.startsWith("android.")) continue;
                CharSequence label = info.loadLabel(pm);
                entries.add(new AppEntry(
                        label == null ? pkg : label.toString(),
                        pkg, selected.contains(pkg)));
            }
            java.util.Collections.sort(entries, (a, b) ->
                    a.label.compareToIgnoreCase(b.label));
            Ui.ui(() -> {
                all.clear();
                all.addAll(entries);
                filter("");
            });
        });
    }

    private Set<String> currentSelection() {
        HookConfig cfg = HookConfig.load(this);
        if (cfg == null || cfg.identity == null || !device.id.equals(cfg.identity.id)) {
            return new HashSet<>();
        }
        return new HashSet<>(cfg.packages);
    }

    private void filter(String query) {
        shown.clear();
        String q = query == null ? "" : query.trim().toLowerCase(java.util.Locale.US);
        for (AppEntry e : all) {
            if (q.isEmpty()
                    || e.label.toLowerCase(java.util.Locale.US).contains(q)
                    || e.pkg.toLowerCase(java.util.Locale.US).contains(q)) {
                shown.add(e);
            }
        }
        adapter.notifyDataSetChanged();
        updateCount();
    }

    private void updateCount() {
        int n = 0;
        for (AppEntry e : all) if (e.selected) n++;
        count.setText(getString(R.string.hook_selected, n));
    }

    private void save() {
        final Set<String> selected = new HashSet<>();
        for (AppEntry e : all) if (e.selected) selected.add(e.pkg);
        HookConfig.publish(this, device, selected, true);
        Ui.toast(this, getString(R.string.hook_saved));
        finish();
    }

    private final class AppAdapter extends BaseAdapter {
        @Override public int getCount() { return shown.size(); }
        @Override public Object getItem(int position) { return shown.get(position); }
        @Override public long getItemId(int position) { return position; }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            View v = convertView;
            if (v == null) v = getLayoutInflater().inflate(R.layout.item_app, parent, false);
            AppEntry e = shown.get(position);
            ((CheckBox) v.findViewById(R.id.a_check)).setChecked(e.selected);
            ((TextView) v.findViewById(R.id.a_label)).setText(e.label);
            ((TextView) v.findViewById(R.id.a_pkg)).setText(e.pkg);
            return v;
        }
    }
}
