@file:Suppress("unused", "UNUSED_PARAMETER", "RedundantNullableReturnType")

package androidx.lifecycle

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers

abstract class ViewModel {
    protected open fun onCleared() {}
}

interface ViewModelProvider {
    interface Factory {
        fun <T : ViewModel> create(modelClass: Class<T>): T
    }
}

val ViewModel.viewModelScope: CoroutineScope
    get() = CoroutineScope(Dispatchers.Default)
