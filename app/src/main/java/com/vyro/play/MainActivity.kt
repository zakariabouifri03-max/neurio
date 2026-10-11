package com.vyro.play

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vyro.play.ui.VyroPlayApp
import com.vyro.play.ui.theme.VyroPlayTheme
import com.vyro.play.ui.viewmodel.VyroViewModel

class MainActivity : ComponentActivity() {

    private lateinit var viewModel: VyroViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val appContainer = (application as VyroPlayApplication).container
        val factory = VyroViewModel.provideFactory(
            repository = appContainer.repository,
            settingsStore = appContainer.settingsStore,
            networkMonitor = appContainer.networkMonitor
        )
        viewModel = ViewModelProvider(this, factory)[VyroViewModel::class.java]

        if (savedInstanceState == null) {
            handleIncomingIntent(intent)
        }

        setContent {
            val settings by viewModel.settingsState.collectAsStateWithLifecycle()
            VyroPlayTheme(
                themeMode = settings.themeMode,
                lowEndMode = settings.lowEndPerformanceMode
            ) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    VyroPlayApp(viewModel = viewModel)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val dataUri = intent.data ?: return
        val scheme = dataUri.scheme?.lowercase().orEmpty()
        if (scheme == "content" || scheme == "file") {
            viewModel.onLocalVideosPicked(listOf(dataUri))
        } else if (scheme == "http" || scheme == "https") {
            viewModel.playYouTubeByUrlOrId(dataUri.toString())
        }
    }
}
