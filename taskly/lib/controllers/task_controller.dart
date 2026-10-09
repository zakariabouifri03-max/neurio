import 'dart:collection';

import 'package:flutter/foundation.dart';

import '../core/utils/date_helper.dart';
import '../logic/motivational.dart';
import '../logic/stats_calculator.dart';
import '../models/category.dart';
import '../models/priority.dart';
import '../models/task.dart';
import '../models/task_query.dart';
import '../data/task_repository.dart';
import '../notifications/reminder_scheduler.dart';

/// Central task state: loads, creates, edits, deletes and filters tasks, and
/// keeps reminders in sync with the database.
class TaskController extends ChangeNotifier {
  TaskController({
    required TaskRepository repository,
    ReminderScheduler? reminderScheduler,
    DateTime Function()? clock,
  }) : _repository = repository,
       _reminders = reminderScheduler ?? NoopReminderScheduler(),
       _clock = clock ?? DateTime.now;

  final TaskRepository _repository;
  final ReminderScheduler _reminders;
  final DateTime Function() _clock;

  final UnmodifiableListView<Task> _tasks = UnmodifiableListView<Task>([]);
  List<Task> _backing = [];

  bool _loaded = false;
  bool _loading = false;
  String? _error;

  /// True once the first successful load finished (even if empty).
  bool get loaded => _loaded;
  bool get loading => _loading;

  /// Human-friendly message when storage failed; null when all good.
  String? get error => _error;

  UnmodifiableListView<Task> get tasks => _tasks;

  /// Loads (or reloads) every task from storage.
  Future<void> load() async {
    if (_loading) return;
    _loading = true;
    notifyListeners();
    try {
      _backing = await _repository.getAll();
      _error = null;
      _loaded = true;
    } catch (e) {
      debugPrint('Taskly: failed to load tasks: $e');
      _error = 'Your tasks could not be loaded. Please try again.';
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> retryLoad() => load();

  Task? byId(int? id) {
    if (id == null) return null;
    for (final task in _backing) {
      if (task.id == id) return task;
    }
    return null;
  }

  /// Reloads from storage, then finds [id] — used when a notification tap
  /// arrives while the app was cold-started and hasn't loaded yet.
  Future<Task?> refreshAndFind(int id) async {
    await load();
    return byId(id);
  }

  /// Creates a task from editor input. Returns the stored task.
  Future<Task> addTask({
    required String title,
    String description = '',
    required DateTime dueDate,
    int? dueMinutes,
    TaskPriority priority = TaskPriority.medium,
    TaskCategory category = TaskCategory.personal,
    bool reminderEnabled = false,
  }) async {
    final now = _clock();
    var task = Task(
      id: 0,
      title: title.trim(),
      description: description.trim(),
      dueDate: DateHelper.startOfDay(dueDate),
      dueMinutes: dueMinutes,
      priority: priority,
      category: category,
      createdAt: now,
      updatedAt: now,
      reminderEnabled: reminderEnabled,
    );
    task = await _repository.insert(task);
    _backing = [..._backing, task]..sort(_newestFirst);
    notifyListeners();
    await _syncReminder(task);
    return task;
  }

  /// Persists edits to [task] (already carrying new values via copyWith).
  Future<Task> updateTask(Task task) async {
    final updated = task.copyWith(updatedAt: _clock());
    await _repository.update(updated);
    _backing = [
      for (final t in _backing)
        if (t.id == updated.id) updated else t,
    ]..sort(_newestFirst);
    notifyListeners();
    await _syncReminder(updated);
    return updated;
  }

  /// Marks a task done/undone, stamping completion time for honest stats.
  Future<Task> toggleComplete(Task task) async {
    final now = _clock();
    final toggled = task.copyWith(
      isCompleted: !task.isCompleted,
      completedAt: task.isCompleted ? null : now,
      updatedAt: now,
    );
    return updateTask(toggled);
  }

  /// Deletes a task and cancels any reminder. Returns true if a row went.
  Future<bool> deleteTask(Task task) async {
    final rows = await _repository.delete(task.id);
    if (rows == 0) return false;
    _backing = _backing.where((t) => t.id != task.id).toList();
    notifyListeners();
    await _reminders.cancelReminder(task);
    return true;
  }

  /// Removes everything (Settings → Danger zone).
  Future<void> deleteAllTasks() async {
    await _repository.deleteAll();
    _backing = [];
    notifyListeners();
    await _reminders.resyncAll(const [], now: _clock());
  }

  Future<void> resyncReminders() async =>
      _reminders.resyncAll(_backing, now: _clock());

  Future<void> _syncReminder(Task task) async {
    if (task.reminderEnabled && !task.isCompleted) {
      await _reminders.scheduleReminder(task, now: _clock());
    } else {
      await _reminders.cancelReminder(task);
    }
  }

  static int _newestFirst(Task a, Task b) => b.createdAt.compareTo(a.createdAt);

  // ---------------- Derived views (real data only) ----------------

  DailyProgress dailyProgress() =>
      StatsCalculator.dailyProgress(tasks, _clock());

  List<Task> tasksForDay(DateTime day) =>
      tasks
          .where(
            (t) => DateHelper.isSameDay(DateHelper.startOfDay(t.dueDate), day),
          )
          .toList()
        ..sort((a, b) {
          final byTime = (a.dueMinutes ?? 24 * 60).compareTo(
            b.dueMinutes ?? 24 * 60,
          );
          if (byTime != 0) return byTime;
          return a.priority.value.compareTo(b.priority.value) * -1;
        });

  /// Open tasks due today, soonest first — the Home "up next" list.
  List<Task> todayUpNext() {
    final now = _clock();
    return tasks
        .where(
          (t) =>
              !t.isCompleted &&
              (DateHelper.isSameDay(t.dueDate, now) || t.isOverdue(now)),
        )
        .toList()
      ..sort((a, b) {
        final aOverdue = a.isOverdue(now) ? 0 : 1;
        final bOverdue = b.isOverdue(now) ? 0 : 1;
        if (aOverdue != bOverdue) return aOverdue - bOverdue;
        return (a.dueMinutes ?? 24 * 60).compareTo(b.dueMinutes ?? 24 * 60);
      });
  }

  bool get hasAnyTasks => tasks.isNotEmpty;

  /// True when every task due today is finished (and there was at least one).
  bool get allTodayDone {
    final now = _clock();
    final dueToday = tasks.where(
      (t) => DateHelper.isSameDay(DateHelper.startOfDay(t.dueDate), now),
    );
    if (dueToday.isEmpty) return false;
    return dueToday.every((t) => t.isCompleted);
  }

  String motivationalLine() => Motivational.pick(dailyProgress(), _clock());

  List<Task> applyQuery(TaskQuery query) => query.apply(tasks, _clock());
}
