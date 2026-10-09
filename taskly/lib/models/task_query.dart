import '../core/utils/date_helper.dart';
import 'category.dart';
import 'priority.dart';
import 'task.dart';

/// Broad time-based filters offered in the My Tasks screen.
enum TaskFilter {
  all('All'),
  today('Today'),
  upcoming('Upcoming'),
  overdue('Overdue'),
  completed('Completed');

  const TaskFilter(this.label);
  final String label;
}

enum TaskSort {
  dueDate('Due date'),
  createdDate('Created'),
  priority('Priority'),
  alphabetical('A → Z');

  const TaskSort(this.label);
  final String label;
}

/// An immutable description of everything the user has asked for.
///
/// [apply] is a pure function so search/filter/sort is unit-testable and
/// identical between the My Tasks screen, Home and the Calendar.
class TaskQuery {
  const TaskQuery({
    this.search = '',
    this.filter = TaskFilter.all,
    this.category,
    this.priority,
    this.sort = TaskSort.dueDate,
    this.completedLast = true,
  });

  final String search;
  final TaskFilter filter;

  /// null = any category.
  final TaskCategory? category;

  /// null = any priority.
  final TaskPriority? priority;
  final TaskSort sort;

  /// Keep finished tasks at the bottom of mixed lists.
  final bool completedLast;

  bool get hasActiveFilters =>
      search.trim().isNotEmpty ||
      filter != TaskFilter.all ||
      category != null ||
      priority != null;

  TaskQuery copyWith({
    String? search,
    TaskFilter? filter,
    Object? category = _unset,
    Object? priority = _unset,
    TaskSort? sort,
    bool? completedLast,
  }) => TaskQuery(
    search: search ?? this.search,
    filter: filter ?? this.filter,
    category: category == _unset ? this.category : category as TaskCategory?,
    priority: priority == _unset ? this.priority : priority as TaskPriority?,
    sort: sort ?? this.sort,
    completedLast: completedLast ?? this.completedLast,
  );

  static const _unset = Object();

  /// Pure filter + search + sort over [tasks]. [now] is injected for
  /// testability.
  List<Task> apply(List<Task> tasks, DateTime now) {
    final query = search.trim().toLowerCase();
    final today = DateHelper.startOfDay(now);

    Iterable<Task> result = tasks.where((task) {
      // Text search across title and description.
      if (query.isNotEmpty) {
        final inTitle = task.title.toLowerCase().contains(query);
        final inDescription = task.description.toLowerCase().contains(query);
        if (!inTitle && !inDescription) return false;
      }
      if (category != null && task.category != category) return false;
      if (priority != null && task.priority != priority) return false;

      final dueDay = DateHelper.startOfDay(task.dueDate);
      switch (filter) {
        case TaskFilter.all:
          return true;
        case TaskFilter.today:
          return !task.isCompleted && DateHelper.isSameDay(task.dueDate, now) ||
              (task.isCompleted && DateHelper.isSameDay(task.completedAt, now));
        case TaskFilter.upcoming:
          return !task.isCompleted && dueDay.isAfter(today);
        case TaskFilter.overdue:
          return task.isOverdue(now);
        case TaskFilter.completed:
          return task.isCompleted;
      }
    });

    final sorted = result.toList()
      ..sort((a, b) => _compare(a, b, now));
    return sorted;
  }

  int _compare(Task a, Task b, DateTime now) {
    var primary = switch (sort) {
      TaskSort.dueDate => _compareNullableDate(a.dueDate, b.dueDate),
      TaskSort.createdDate => _compareNullableDate(a.createdAt, b.createdAt),
      TaskSort.priority => b.priority.value.compareTo(a.priority.value),
      TaskSort.alphabetical => a.title.toLowerCase().compareTo(
        b.title.toLowerCase(),
      ),
    };
    if (primary != 0) return primary;

    // Sensible deterministic tie-breakers.
    primary = _compareNullableDate(a.dueDate, b.dueDate);
    if (primary != 0) return primary;
    if (sort != TaskSort.alphabetical) {
      final byName = a.title.toLowerCase().compareTo(b.title.toLowerCase());
      if (byName != 0) return byName;
    }
    return a.id.compareTo(b.id);
  }

  static int _compareNullableDate(DateTime? a, DateTime? b) {
    if (a == null && b == null) return 0;
    if (a == null) return 1; // no date sorts last
    if (b == null) return -1;
    return a.compareTo(b);
  }
}
