package com.vyro.play

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vyro.core.model.ThemeMode
import com.vyro.play.ui.navigation.DeepLink
import com.vyro.play.ui.navigation.VyroApp
import com.vyro.play.ui.navigation.resolveDeepLink
import com.vyro.play.ui.theme.VyroTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private val viewModel: AppViewModel by viewModels()

    /**
     * Links that arrive while the activity is already running (for example "share to"
     * from YouTube) land in [onNewIntent]; hoisting the value into a Compose state makes
     * the navigation graph react without any manual listener plumbing.
     */
    private val deepLink = mutableStateOf<DeepLink?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)

        // Compose draws behind the system bars; each screen handles its own insets.
        WindowCompat.setDecorFitsSystemWindows(window, false)

        deepLink.value = resolveDeepLink(intent)

        setContent {
            val settings by viewModel.settings.collectAsStateWithLifecycle()
            val pendingDeepLink by deepLink

            val useDarkTheme =
                when (settings.themeMode) {
                    ThemeMode.SYSTEM -> isSystemInDarkTheme()
                    ThemeMode.LIGHT -> false
                    ThemeMode.DARK -> true
                }

            SideEffect {
                WindowCompat.getInsetsController(window, window.decorView)
                    .isAppearanceLightStatusBars = !useDarkTheme
            }

            VyroTheme(
                themeMode = settings.themeMode,
                dynamicColor = settings.dynamicColor,
                pureBlack = settings.pureBlack,
            ) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    VyroApp(deepLink = pendingDeepLink)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        deepLink.value = resolveDeepLink(intent)
    }
}
