package com.neurio.vm;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.ListView;
import android.widget.TextView;

import com.neurio.vm.core.DeviceIdentity;
import com.neurio.vm.core.IdentityFactory;
import com.neurio.vm.core.ProfileStore;
import com.neurio.vm.core.Vault;
import com.neurio.vm.hook.HookConfig;
import com.neurio.vm.runtime.SlotTable;
import com.neurio.vm.util.Io;
import com.neurio.vm.util.Log;
import com.neurio.vm.util.Ui;
import com.neurio.vm.vm.VmManager;
import com.neurio.vm.vm.VmSession;

import java.io.InputStream;
import java.util.List;

/**
 * The device deck: the fleet of virtual handsets at a glance.
 *
 * <p>This is the only screen that mutates the roster (add / import / delete);
 * everything else operates on one device. It deliberately shows the two facts
 * a user most often gets wrong about this kind of app, right at the top: which
 * key protects the profiles (vault badge) and whether the native hook layer is
 * actually publishing (hook badge).
 */
public final class MainActivity extends Activity {

    private static final String TAG = "MainActivity";
    private static final int REQUEST_IMPORT = 41;
    private static final int REQUEST_EXPORT = 42;
    private String pendingExport;

    private ProfileStore store;
    private ListView list;
    private TextView empty;
    private TextView vaultBadge;
    private TextView hookBadge;
    private DeckAdapter adapter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        store = ProfileStore.get(this);

        list = findViewById(R.id.device_list);
        empty = findViewById(R.id.empty_state);
        vaultBadge = findViewById(R.id.vault_badge);
        hookBadge = findViewById(R.id.hook_badge);

        adapter = new DeckAdapter();
        list.setAdapter(adapter);

        list.setOnItemClickListener((AdapterView<?> parent, View view, int position, long id) -> {
            DeviceIdentity d = adapter.item(position);
            if (d != null) openDevice(d);
        });

        list.setOnItemLongClickListener((AdapterView<?> parent, View view, int position, long id) -> {
            DeviceIdentity d = adapter.item(position);
            if (d != null) showActions(d);
            return true;
        });

        findViewById(R.id.btn_new).setOnClickListener(v ->
                startActivity(new Intent(this, EditorActivity.class)));

        findViewById(R.id.btn_random).setOnClickListener(v -> Ui.bg(() -> {
            DeviceIdentity d = store.add(IdentityFactory.randomRetail());
            Ui.ui(() -> openDevice(d));
        }));

        findViewById(R.id.btn_console).setOnClickListener(v ->
                startActivity(new Intent(this, ConsoleActivity.class)));

        findViewById(R.id.btn_import).setOnClickListener(v -> importProfile());
    }

    @Override
    protected void onResume() {
        super.onResume();
        Ui.bg(() -> {
            store.ensureLoaded();
            Ui.ui(this::refresh);
        });
    }

    private void refresh() {
        List<DeviceIdentity> devices = store.list();
        adapter.setData(devices);
        empty.setVisibility(devices.isEmpty() ? View.VISIBLE : View.GONE);
        list.setVisibility(devices.isEmpty() ? View.GONE : View.VISIBLE);

        Vault.Mode mode = store.vaultMode();
        vaultBadge.setText(getString(R.string.main_vault, mode == Vault.Mode.KEYSTORE
                ? "AndroidKeystore (hardware-backed)" : "derived key (obfuscation only)"));

        HookConfig hook = HookConfig.load(this);
        if (hook == null || !hook.enabled || hook.identity == null) {
            hookBadge.setText(getString(R.string.main_hook, getString(R.string.main_hook_off)));
        } else {
            String where = "all".equals(hook.mode) ? "all apps" : (hook.packages.size() + " app(s)");
            hookBadge.setText(getString(R.string.main_hook,
                    getString(R.string.main_hook_on, hook.identity.displayName(), where)));
        }
    }

    private void openDevice(DeviceIdentity d) {
        Intent i = new Intent(this, DeviceActivity.class);
        i.putExtra(DeviceActivity.EXTRA_DEVICE, d.id);
        startActivity(i);
    }

    // ── long-press actions ─────────────────────────────────────────────────

    private void showActions(final DeviceIdentity d) {
        final CharSequence[] items = {
                getString(R.string.menu_activate),
                getString(R.string.menu_open),
                getString(R.string.menu_clone),
                getString(R.string.menu_reissue),
                getString(R.string.menu_edit),
                getString(R.string.menu_export),
                getString(R.string.menu_delete),
        };
        Ui.choose(this, d.displayName(), items, which -> {
            switch (which) {
                case 0:
                    store.setActive(d.id);
                    Ui.toast(this, getString(R.string.device_active, d.displayName()));
                    refresh();
                    break;
                case 1:
                    openDevice(d);
                    break;
                case 2:
                    cloneDevice(d);
                    break;
                case 3:
                    reissue(d);
                    break;
                case 4:
                    Intent e = new Intent(this, EditorActivity.class);
                    e.putExtra(EditorActivity.EXTRA_DEVICE, d.id);
                    startActivity(e);
                    break;
                case 5:
                    exportDevice(d);
                    break;
                case 6:
                    deleteDevice(d);
                    break;
                default:
                    break;
            }
        });
    }

    private void cloneDevice(final DeviceIdentity d) {
        Ui.bg(() -> {
            DeviceIdentity copy = store.add(IdentityFactory.clone(d, null));
            Ui.ui(() -> {
                Ui.toast(this, getString(R.string.device_cloned, copy.displayName()));
                refresh();
            });
        });
    }

    private void reissue(final DeviceIdentity d) {
        Ui.confirm(this, d.displayName(), getString(R.string.device_confirm_reissue, d.displayName()),
                () -> Ui.bg(() -> {
                    store.update(IdentityFactory.reissue(d));
                    Ui.ui(() -> {
                        Ui.toast(this, getString(R.string.device_reissued, d.displayName()));
                        refresh();
                    });
                }));
    }

    private void deleteDevice(final DeviceIdentity d) {
        Ui.confirm(this, getString(R.string.device_delete), getString(R.string.device_confirm_delete, d.displayName()),
                () -> Ui.bg(() -> {
                    SlotTable.release(this, d.id);
                    store.remove(d.id);
                    Ui.ui(() -> {
                        Ui.toast(this, getString(R.string.device_deleted, d.displayName()));
                        refresh();
                    });
                }));
    }

    // ── import / export ────────────────────────────────────────────────────

    private void importProfile() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        try {
            startActivityForResult(i, REQUEST_IMPORT);
        } catch (Exception e) {
            Ui.toast(this, getString(R.string.error) + ": " + e.getMessage());
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null) return;
        if (requestCode == REQUEST_EXPORT) {
            final Uri target = data.getData();
            final String json = pendingExport;
            pendingExport = null;
            if (target == null || json == null) return;
            Ui.bg(() -> {
                try (java.io.OutputStream out = getContentResolver().openOutputStream(target)) {
                    if (out != null) out.write(json.getBytes(Io.UTF8));
                } catch (Exception e) {
                    Log.e(TAG, "export write failed", e);
                }
                Ui.ui(() -> Ui.toast(this, getString(R.string.export_secret)));
            });
            return;
        }
        if (requestCode != REQUEST_IMPORT) return;
        final Uri uri = data.getData();
        if (uri == null) return;
        Ui.bg(() -> {
            String text;
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                text = in == null ? null : Io.readFully(in);
            } catch (Exception e) {
                Log.e(TAG, "import read failed", e);
                text = null;
            }
            final String json = text;
            Ui.ui(() -> {
                if (json == null) {
                    Ui.toast(this, getString(R.string.import_bad));
                    return;
                }
                try {
                    int n = store.importAll(json);
                    Ui.toast(this, getString(R.string.import_ok, n));
                    refresh();
                } catch (Exception e) {
                    Log.e(TAG, "import parse failed", e);
                    Ui.toast(this, getString(R.string.import_bad));
                }
            });
        });
    }

    /**
     * Hands the profile to the Storage Access Framework. The JSON is kept in a
     * field until the user picks a destination, because the result Intent does
     * not round-trip our payload.
     */
    private void exportDevice(DeviceIdentity d) {
        try {
            pendingExport = ProfileStore.exportOne(d);
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("application/json");
            i.putExtra(Intent.EXTRA_TITLE, "neuriovm-" + d.id.substring(0, 8) + ".json");
            startActivityForResult(i, REQUEST_EXPORT);
        } catch (Exception e) {
            pendingExport = null;
            Ui.toast(this, getString(R.string.error) + ": " + e.getMessage());
        }
    }

    // ── adapter ────────────────────────────────────────────────────────────

    private final class DeckAdapter extends BaseAdapter {

        private List<DeviceIdentity> data = java.util.Collections.emptyList();

        void setData(List<DeviceIdentity> d) {
            data = d == null ? java.util.Collections.emptyList() : d;
            notifyDataSetChanged();
        }

        DeviceIdentity item(int position) {
            return position >= 0 && position < data.size() ? data.get(position) : null;
        }

        @Override public int getCount() { return data.size(); }
        @Override public Object getItem(int position) { return item(position); }
        @Override public long getItemId(int position) { return position; }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            View v = convertView;
            if (v == null) v = getLayoutInflater().inflate(R.layout.item_device, parent, false);

            DeviceIdentity d = data.get(position);
            ((TextView) v.findViewById(R.id.d_name)).setText(d.displayName());
            ((TextView) v.findViewById(R.id.d_model)).setText(
                    d.manufacturer + " · " + d.model + " · Android " + d.release
                            + " (API " + d.sdkInt + ")");
            ((TextView) v.findViewById(R.id.d_fp)).setText(d.fingerprint);
            ((TextView) v.findViewById(R.id.d_android)).setText(
                    "ANDROID_ID " + d.androidId + "   IMEI " + d.imei);

            VmSession s = VmManager.get(MainActivity.this).sessionOf(d.id);
            TextView state = v.findViewById(R.id.d_badge_state);
            if (s == null) {
                state.setText(getString(R.string.state_stopped));
                state.setTextColor(getResources().getColor(R.color.text_faint));
            } else {
                state.setText(stateText(s.state()));
                state.setTextColor(getResources().getColor(colorFor(s.state())));
            }

            int slot = SlotTable.slotOf(MainActivity.this, d.id);
            TextView slotView = v.findViewById(R.id.d_badge_slot);
            slotView.setText(slot < 0 ? ":vm-" : ":vm" + slot);

            boolean active = d.id.equals(store.activeId());
            v.findViewById(R.id.d_active).setVisibility(active ? View.VISIBLE : View.INVISIBLE);
            return v;
        }
    }

    private String stateText(VmSession.State s) {
        switch (s) {
            case STARTING: return getString(R.string.state_starting);
            case RUNNING: return getString(R.string.state_running);
            case DEGRADED: return getString(R.string.state_degraded);
            case FAILED: return getString(R.string.state_failed);
            default: return getString(R.string.state_stopped);
        }
    }

    private int colorFor(VmSession.State s) {
        switch (s) {
            case RUNNING: return R.color.primary;
            case DEGRADED: return R.color.warn;
            case FAILED: return R.color.danger;
            case STARTING: return R.color.accent;
            default: return R.color.text_faint;
        }
    }
}
