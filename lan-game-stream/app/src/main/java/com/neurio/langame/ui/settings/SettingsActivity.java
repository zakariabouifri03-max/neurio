package com.neurio.langame.ui.settings;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;

/** Bootstrapped placeholder — replaced by the full implementation. */
public class SettingsActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TextView tv = new TextView(this);
        tv.setText("SettingsActivity");
        setContentView(tv);
    }
}
