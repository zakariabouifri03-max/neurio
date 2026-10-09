import '../data/models/task.dart';
import '../data/models/task_category.dart';
import '../data/models/task_priority.dart';

/// Status filters available on the My Tasks screen.
enum TaskFilter { all, today, upcoming, overdue, completed, incomplete }

extension TaskFilterX on TaskFilter {
  String get label {
    switch (this) {
      case TaskFilter.all:
        return 'All';
      case TaskFilter.today:
        return 'Today';
      case TaskFilter.upcoming:
        return 'Upcoming';
      case TaskFilter.overdue:
        return 'Overdue';
      case TaskFilter.completed:
        return 'Completed';
      case TaskFilter.incomplete:
        return 'To do';
    }
  }

  bool matches(Task task, DateTime now) {
    switch (this) {
      case TaskFilter.all:
        return true;
      case TaskFilter.today:
        return task.isDueOn(now);
      case TaskFilter.upcoming:
        return !task.isCompleted && task.isUpcoming(now);
      case TaskFilter.overdue:
        return task.isOverdue(now);
      case TaskFilter.completed:
        return task.isCompleted;
      case TaskFilter.incomplete:
        return !task.isCompleted;
    }
  }
}

enum TaskSort { dueDate, createdAt, priority, alphabetical }

extension TaskSortX on TaskSort {
  String get label {
    switch (this) {
      case TaskSort.dueDate:
        return 'Due date';
      case TaskSort.createdAt:
        return 'Created';
      case TaskSort.priority:
        return 'Priority';
      case TaskSort.alphabetical:
        return 'A – Z';
    }
  }

  int compare(Task a, Task b) {
    switch (this) {
      case TaskSort.dueDate:
        final byMoment = a.referenceDateTime.compareTo(b.referenceDateTime);
        if (byMoment != 0) return byMoment;
        return b.priority.rank.compareTo(a.priority.rank);
      case TaskSort.createdAt:
        return b.createdAt.compareTo(a.createdAt);
      case TaskSort.priority:
        final byRank = b.priority.rank.compareTo(a.priority.rank);
        if (byRank != 0) return byRank;
        return a.referenceDateTime.compareTo(b.referenceDateTime);
      case TaskSort.alphabetical:
        return a.title.toLowerCase().compareTo(b.title.toLowerCase());
    }
  }
}

/// Immutable search + filter + sort request. Pure and unit-testable.
class TaskQuery {
  const TaskQuery({
    this.search = '',
    this.filter = TaskFilter.all,
    this.sort = TaskSort.dueDate,
    this.category,
    this.priority,
  });

  final String search;
  final TaskFilter filter;
  final TaskSort sort;
  final TaskCategory? category;
  final TaskPriority? priority;

  bool get hasActiveRefinements =>
      search.trim().isNotEmpty ||
      filter != TaskFilter.all ||
      category != null ||
      priority != null;

  TaskQuery copyWith({
    String? search,
    TaskFilter? filter,
    TaskSort? sort,
    TaskCategory? category,
    bool clearCategory = false,
    TaskPriority? priority,
    bool clearPriority = false,
  }) {
    return TaskQuery(
      search: search ?? this.search,
      filter: filter ?? this.filter,
      sort: sort ?? this.sort,
      category: clearCategory ? null : (category ?? this.category),
      priority: clearPriority ? null : (priority ?? this.priority),
    );
  }

  List<Task> apply(List<Task> tasks, DateTime now) {
    final needle = search.trim().toLowerCase();
    final filtered = tasks.where((task) {
      if (!filter.matches(task, now)) return false;
      if (category != null && task.category != category) return false;
      if (priority != null && task.priority != priority) return false;
      if (needle.isNotEmpty) {
        final inTitle = task.title.toLowerCase().contains(needle);
        final inDescription =
            (task.description ?? '').toLowerCase().contains(needle);
        if (!inTitle && !inDescription) return false;
      }
      return true;
    }).toList(growable: true);
    filtered.sort(sort.compare);
    return filtered;
  }
}
