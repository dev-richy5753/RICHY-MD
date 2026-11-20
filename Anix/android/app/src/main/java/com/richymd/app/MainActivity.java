package com.richymd.app;

import android.graphics.Color;
import android.os.Bundle;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.rgb(5, 6, 8));
        getWindow().setNavigationBarColor(Color.rgb(5, 6, 8));

        var webView = getBridge().getWebView();
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            var safeInsets = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(safeInsets.left, safeInsets.top, safeInsets.right, safeInsets.bottom);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(webView);
    }
}
