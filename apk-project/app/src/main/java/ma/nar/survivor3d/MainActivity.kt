package ma.nar.survivor3d

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader

/**
 * Fullscreen WebView shell for the NAR SURVIVOR 3D web game.
 * ES modules refuse to load from file://, so assets are served through
 * WebViewAssetLoader under the secure virtual origin
 * https://appassets.androidplatform.net/assets/www/…
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.databaseEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.settings.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        web.setBackgroundColor(0xFF0B1009.toInt())

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView, request: WebResourceRequest
            ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)
        }

        keepImmersive()
        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    private fun keepImmersive() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) keepImmersive()
    }

    override fun onResume() { super.onResume(); keepImmersive(); web.onResume() }
    override fun onPause() { web.onPause(); super.onPause() }
    override fun onDestroy() { web.destroy(); super.onDestroy() }

    @Deprecated("keep the in-game pause menu in charge of Back")
    override fun onBackPressed() {
        web.evaluateJavascript(
            "(()=>{const b=document.getElementById('btnPause');" +
            "if(b&&getComputedStyle(b).display!=='none'){b.click();return 'paused';}" +
            "const m=document.getElementById('menu');" +
            "if(m&&getComputedStyle(m).display!=='none')return 'menu';" +
            "return 'none';})()"
        ) { r ->
            if (r == "\"none\"") {
                @Suppress("DEPRECATION")
                super.onBackPressed()
            }
        }
    }
}
