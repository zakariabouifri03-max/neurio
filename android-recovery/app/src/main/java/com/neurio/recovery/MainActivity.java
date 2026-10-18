package com.neurio.recovery;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.ContentUris;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.content.ContentValues;
import android.content.ContentResolver;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private LinearLayout list;
    private TextView status;
    private Uri pendingRestore;
    private static final int PERMISSION = 3, RESTORE = 4;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(20, 30, 20, 12);
        root.setBackgroundColor(Color.WHITE);
        TextView heading = new TextView(this);
        heading.setText("Neurio Restore | استرجاع الصور والفيديوهات");
        heading.setTextSize(20);
        heading.setTextColor(Color.BLACK);
        root.addView(heading);
        TextView warning = new TextView(this);
        warning.setText("يفحص الملفات المتاحة وسلة Android فقط. لا يستطيع استرجاع ملفات مُسحت نهائياً من ذاكرة الهاتف. لا يرفع ملفاتك للإنترنت.");
        warning.setTextSize(16);
        warning.setPadding(0, 18, 0, 18);
        root.addView(warning);
        Button scan = new Button(this);
        scan.setText("فحص الصور والفيديوهات");
        scan.setOnClickListener(v -> requestScan());
        root.addView(scan);
        status = new TextView(this);
        status.setText("اضغط فحص واسمح بالوصول الكامل للصور والفيديوهات.");
        status.setPadding(0, 12, 0, 12);
        root.addView(status);
        ScrollView scroll = new ScrollView(this);
        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(list);
        root.addView(scroll);
        setContentView(root);
    }

    private void requestScan() {
        String[] perms = Build.VERSION.SDK_INT >= 33 ?
                new String[]{Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO} :
                new String[]{Manifest.permission.READ_EXTERNAL_STORAGE};
        for (String p : perms) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(perms, PERMISSION);
                return;
            }
        }
        scan();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == PERMISSION) {
            for (int result : results) if (result != PackageManager.PERMISSION_GRANTED) {
                status.setText("خصّك تسمح بالوصول الكامل للصور والفيديوهات من إعدادات التطبيق.");
                return;
            }
            scan();
        }
    }

    private void scan() {
        list.removeAllViews();
        int count = 0;
        ContentResolver resolver = getContentResolver();
        for (Uri collection : new Uri[]{MediaStore.Images.Media.EXTERNAL_CONTENT_URI, MediaStore.Video.Media.EXTERNAL_CONTENT_URI}) {
            Bundle args = new Bundle();
            args.putInt(MediaStore.QUERY_ARG_MATCH_TRASHED, MediaStore.MATCH_INCLUDE);
            args.putStringArray(ContentResolver.QUERY_ARG_SORT_COLUMNS, new String[]{MediaStore.MediaColumns.DATE_ADDED});
            args.putInt(ContentResolver.QUERY_ARG_SORT_DIRECTION, ContentResolver.QUERY_SORT_DIRECTION_DESCENDING);
            try (Cursor cursor = resolver.query(collection,
                    new String[]{MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.IS_TRASHED},
                    args, null)) {
                if (cursor == null) continue;
                while (cursor.moveToNext() && count < 500) {
                    Uri uri = ContentUris.withAppendedId(collection, cursor.getLong(0));
                    String name = cursor.getString(1);
                    boolean trashed = cursor.getInt(2) == 1;
                    addItem(uri, name == null ? "ملف بدون اسم" : name, trashed);
                    count++;
                }
            } catch (Exception e) {
                status.setText("تعذر قراءة بعض الملفات: " + e.getMessage());
            }
        }
        status.setText("الملفات المتاحة: " + count + " (حد العرض 500). العناصر المحذوفة نهائياً لا تظهر هنا.");
    }

    private void addItem(Uri uri, String name, boolean trashed) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        TextView label = new TextView(this);
        label.setText((trashed ? "🗑 سلة: " : "ملف موجود: ") + name);
        label.setTextSize(16);
        label.setPadding(0, 14, 0, 4);
        row.addView(label);
        Button action = new Button(this);
        action.setText(trashed ? "استعادة من السلة" : "حفظ نسخة في Downloads");
        action.setOnClickListener(v -> {
            if (trashed) restore(uri); else copyFile(uri, name);
        });
        row.addView(action);
        list.addView(row);
    }

    private void restore(Uri uri) {
        try {
            List<Uri> uris = new ArrayList<>();
            uris.add(uri);
            PendingIntent request = MediaStore.createTrashRequest(getContentResolver(), uris, false);
            pendingRestore = uri;
            startIntentSenderForResult(request.getIntentSender(), RESTORE, null, 0, 0, 0);
        } catch (Exception e) {
            Toast.makeText(this, "تعذرت الاستعادة: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == RESTORE) {
            Toast.makeText(this, resultCode == RESULT_OK ? "تمت الاستعادة" : "أُلغيت الاستعادة", Toast.LENGTH_SHORT).show();
            pendingRestore = null;
            scan();
        }
    }

    private void copyFile(Uri uri, String name) {
        String mime = getContentResolver().getType(uri);
        if (mime == null) mime = "application/octet-stream";
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, "restored_" + System.currentTimeMillis() + "_" + name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/NeurioRestore");
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri destination = null;
        try {
            destination = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (destination == null) throw new Exception("تعذر إنشاء الملف");
            try (InputStream in = getContentResolver().openInputStream(uri);
                 OutputStream out = getContentResolver().openOutputStream(destination)) {
                if (in == null || out == null) throw new Exception("تعذر فتح الملف");
                byte[] buffer = new byte[65536];
                int n;
                while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
            }
            ContentValues ready = new ContentValues();
            ready.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContentResolver().update(destination, ready, null, null);
            Toast.makeText(this, "حُفظت نسخة في Downloads/NeurioRestore", Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            if (destination != null) getContentResolver().delete(destination, null, null);
            Toast.makeText(this, "فشل النسخ: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }
}
