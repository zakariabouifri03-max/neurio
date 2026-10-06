package com.neurio.langame.ui.performance;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;

/** Bootstrapped placeholder — replaced by the full implementation. */
public class PerformanceActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TextView tv = new TextView(this);
        tv.setText("PerformanceActivity");
        setContentView(tv);
    }
}
