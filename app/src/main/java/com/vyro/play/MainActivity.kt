package com.vyro.play

import android.content.Intent
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import com.vyro.play.ui.*

class MainActivity : ComponentActivity() {
    private var imported by mutableStateOf(0)
    private var importError by mutableStateOf<String?>(null)
    private val picker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            try {
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                val cursor = contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)
                val name = cursor?.use { if (it.moveToFirst()) it.getString(0) else null } ?: "My video"
                (application as VyroApp).let { app ->
                    lifecycleScope.launch { app.repository.addLocal(uri.toString(), name); imported++ }
                }
            } catch (e: Exception) { importError = "Unable to keep access to this file. Select a different file." }
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val app = application as VyroApp
            val model: VyroViewModel = viewModel(factory = VyroViewModel.Factory(app.repository))
            VyroRoot(model, imported, importError, { importError = null }, { picker.launch(arrayOf("video/*")) },
                { requestedOrientation = if (it) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED },
                { uri ->
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).addCategory(Intent.CATEGORY_BROWSABLE)
                    try { startActivity(intent) } catch (_: Exception) { importError = "No application can open this link." }
                })
        }
    }
}
