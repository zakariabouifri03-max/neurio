package com.vyro.play.data.repository

import com.vyro.core.model.UserSettings
import com.vyro.play.data.datastore.UserPreferencesDataSource
import com.vyro.play.domain.repository.SettingsRepository
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SettingsRepositoryImpl
    @Inject
    constructor(
        private val dataSource: UserPreferencesDataSource,
    ) : SettingsRepository {
        override val settings: Flow<UserSettings> = dataSource.settings

        override val effectiveApiKey: Flow<String> = dataSource.apiKeyOverride

        override suspend fun update(transform: (UserSettings) -> UserSettings) {
            dataSource.update(transform)
        }

        override suspend fun setApiKeyOverride(key: String) {
            dataSource.setApiKey(key)
        }

        override suspend fun clearApiKeyOverride() {
            dataSource.clearApiKey()
        }
    }
