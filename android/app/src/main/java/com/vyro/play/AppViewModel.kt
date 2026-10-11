package com.vyro.play

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vyro.core.model.NetworkClass
import com.vyro.core.model.UserSettings
import com.vyro.play.domain.repository.ConnectivityRepository
import com.vyro.play.domain.repository.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

/**
 * Process-wide state the theme depends on.
 *
 * It lives above the navigation graph so switching the theme does not recreate any
 * screen, and the network class is shared instead of being re-observed per feature.
 */
@HiltViewModel
class AppViewModel
    @Inject
    constructor(
        settingsRepository: SettingsRepository,
        connectivityRepository: ConnectivityRepository,
    ) : ViewModel() {

        val settings: StateFlow<UserSettings> =
            settingsRepository.settings
                .stateIn(
                    scope = viewModelScope,
                    started = SharingStarted.Eagerly,
                    initialValue = UserSettings.DEFAULT,
                )

        val network: StateFlow<NetworkClass> =
            connectivityRepository.networkClass
                .stateIn(
                    scope = viewModelScope,
                    started = SharingStarted.WhileSubscribed(5_000),
                    initialValue = NetworkClass.UNMETERED_WIFI,
                )
    }
