package com.neurio.langame.host;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;

/** Bootstrapped placeholder — replaced by the full implementation. */
public class HostActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TextView tv = new TextView(this);
        tv.setText("HostActivity");
        setContentView(tv);
    }
}
