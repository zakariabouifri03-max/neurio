package com.vyro.play.data.repository

import com.vyro.core.domain.SearchHistoryPolicy
import com.vyro.core.model.SearchQuery
import com.vyro.play.data.local.SearchQueryDao
import com.vyro.play.data.local.SearchQueryEntity
import com.vyro.play.domain.repository.SearchHistoryRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SearchHistoryRepositoryImpl
    @Inject
    constructor(
        private val dao: SearchQueryDao,
    ) : SearchHistoryRepository {
        override fun observe(): Flow<List<SearchQuery>> =
            dao.observeAll().map { entities -> entities.map { it.toDomain() } }

        override suspend fun record(query: String) {
            val normalised = SearchHistoryPolicy.normalise(query)
            if (!SearchHistoryPolicy.isValid(normalised)) return
            withContext(Dispatchers.IO) {
                dao.record(
                    entity =
                        SearchQueryEntity(
                            text = normalised,
                            updatedAtMillis = System.currentTimeMillis(),
                            useCount = 1,
                        ),
                    limit = MAX_ROWS,
                )
            }
        }

        override suspend fun remove(query: SearchQuery) {
            withContext(Dispatchers.IO) { dao.delete(query.text) }
        }

        override suspend fun clear() {
            withContext(Dispatchers.IO) { dao.clear() }
        }

        private companion object {
            /**
             * The database keeps more rows than the user-visible limit so that lowering
             * the limit in Settings still surfaces older searches.
             */
            const val MAX_ROWS = 300
        }
    }

internal fun SearchQueryEntity.toDomain(): SearchQuery =
    SearchQuery(
        text = text,
        updatedAtMillis = updatedAtMillis,
        useCount = useCount,
    )
