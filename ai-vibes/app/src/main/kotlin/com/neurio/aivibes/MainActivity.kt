package com.neurio.aivibes

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.navigation.compose.rememberNavController
import com.neurio.aivibes.ui.AiVibesNav
import com.neurio.aivibes.ui.Routes
import com.neurio.aivibes.ui.theme.AiVibesTheme
import com.neurio.aivibes.ui.theme.VibeColors

class MainActivity : ComponentActivity() {

    private val vm: AppViewModel by viewModels {
        AppViewModel.Factory(AiVibesApp.from(this))
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { /* results flow into the library/headphone states automatically */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)

        requestRuntimePermissions()
        vm.loadLibrary()

        setContent {
            AiVibesTheme {
                AppRoot(vm = vm, onPermissionRequest = { requestRuntimePermissions() })
            }
        }
    }

    override fun onResume() {
        super.onResume()
        AiVibesApp.from(this).headphones.refresh()
        vm.loadLibrary()
    }

    private fun requestRuntimePermissions() {
        val needed = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 33) {
            if (!granted(Manifest.permission.READ_MEDIA_AUDIO)) {
                needed += Manifest.permission.READ_MEDIA_AUDIO
            }
            if (!granted(Manifest.permission.POST_NOTIFICATIONS)) {
                needed += Manifest.permission.POST_NOTIFICATIONS
            }
        } else {
            if (!granted(Manifest.permission.READ_EXTERNAL_STORAGE)) {
                needed += Manifest.permission.READ_EXTERNAL_STORAGE
            }
        }
        if (Build.VERSION.SDK_INT >= 31 && !granted(Manifest.permission.BLUETOOTH_CONNECT)) {
            needed += Manifest.permission.BLUETOOTH_CONNECT
        }
        if (needed.isNotEmpty()) {
            permissionLauncher.launch(needed.toTypedArray())
        }
    }

    private fun granted(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
}

@Composable
private fun AppRoot(vm: AppViewModel, onPermissionRequest: () -> Unit) {
    val prefs by vm.prefs.collectAsState()
    val nav = rememberNavController()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(VibeColors.Black)
    ) {
        if (!prefs.onboarded) {
            OnboardingGate(vm = vm, onPermissionRequest = onPermissionRequest)
        } else {
            AiVibesNav(
                nav = nav,
                vm = vm,
                initialRoute = Routes.HOME,
                onPermissionRequest = onPermissionRequest
            )
        }
    }
}

@Composable
private fun OnboardingGate(vm: AppViewModel, onPermissionRequest: () -> Unit) {
    com.neurio.aivibes.ui.screens.OnboardingScreen(
        onPermissionRequest = onPermissionRequest,
        onFinished = { vm.setOnboarded() }
    )
}
