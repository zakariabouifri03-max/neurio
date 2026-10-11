package com.vyro.play.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.vyro.play.data.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class VyroViewModel(private val repository: VideoRepository) : ViewModel() {
    val settings = repository.settings.stateIn(viewModelScope, SharingStarted.Eagerly, UserSettings())
    val favorites = repository.favorites.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val history = repository.history.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val locals = repository.locals.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val searches = repository.searches.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val localCount = repository.localCount.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0)
    private val _query = MutableStateFlow("")
    val query = _query.asStateFlow()
    private val _results = MutableStateFlow(Page(emptyList(), null))
    val results = _results.asStateFlow()
    private val _popular = MutableStateFlow(Page(emptyList(), null))
    val popular = _popular.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy = _busy.asStateFlow()
    private val _popularBusy = MutableStateFlow(false)
    val popularBusy = _popularBusy.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()
    private val _popularError = MutableStateFlow<String?>(null)
    val popularError = _popularError.asStateFlow()
    private var searchJob: Job? = null
    private var popularJob: Job? = null
    fun query(value: String) { _query.value = value; searchJob?.cancel() }
    fun search(next: Boolean = false) {
        val term = _query.value.trim()
        if (term.isEmpty() || (next && (_results.value.next == null || _busy.value))) return
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            _busy.value = true; _error.value = null
            try {
                if (!next) repository.searchTerm(term)
                val page = repository.search(term, settings.value.apiKey, if (next) _results.value.next else null)
                _results.value = if (next) Page((_results.value.items + page.items).distinctBy { it.id }, page.next) else page
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { _error.value = e.friendly(); if (!next) _results.value = Page(emptyList(), null) }
            finally { _busy.value = false }
        }
    }
    fun popular(next: Boolean = false) {
        if (next && (_popular.value.next == null || _popularBusy.value)) return
        popularJob?.cancel()
        popularJob = viewModelScope.launch {
            _popularBusy.value = true; _popularError.value = null
            try {
                val page = repository.popular(settings.value.apiKey, if (next) _popular.value.next else null)
                _popular.value = if (next) Page((_popular.value.items + page.items).distinctBy { it.id }, page.next) else page
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { _popularError.value = e.friendly() }
            finally { _popularBusy.value = false }
        }
    }
    fun action(block: suspend VideoRepository.() -> Unit) { viewModelScope.launch { repository.block() } }
    suspend fun existing(id: String) = repository.existing(id)
    class Factory(private val repository: VideoRepository): ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST") override fun <T : ViewModel> create(modelClass: Class<T>): T = VyroViewModel(repository) as T
    }
}
