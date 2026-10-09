import 'package:flutter/foundation.dart';

import '../data/local/task_dao.dart';
import '../data/models/task.dart';
import '../domain/daily_progress.dart';
import '../services/reminder_scheduler.dart';

/// In-memory mirror of the task table plus all mutations.
/// Every write goes to SQLite first, then notifies listeners, so the UI can
/// never show state that was not persisted.
class TasksStore extends ChangeNotifier {
  TasksStore({
    required TaskDao dao,
    required ReminderScheduler reminders,
    this.clock = defaultClock,
  })  : _dao = dao,
        _reminders = reminders;

  static DateTime defaultClock() => DateTime.now();

  final TaskDao _dao;
  final ReminderScheduler _reminders;
  final DateTime Function() clock;

  List<Task> _tasks = const <Task>[];
  bool _isLoading = false;
  String? _errorMessage;

  List<Task> get tasks => _tasks;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  bool get hasTasks => _tasks.isNotEmpty;

  List<Task> dueOn(DateTime day) =>
      _tasks.where((t) => t.isDueOn(day)).toList(growable: false);

  List<Task> dueToday() => dueOn(clock());

  DailyProgress todayProgress() => DailyProgress.fromTasks(dueToday());

  Task? byId(int id) {
    for (final t in _tasks) {
      if (t.id == id) return t;
    }
    return null;
  }

  Future<void> load() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();
    try {
      _tasks = await _dao.all();
    } catch (e) {
      _errorMessage = 'We couldn\u2019t open your task list. '
          'Please try again in a moment.';
      debugPrint('Taskly: task load failed: $e');
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Creates [task]; returns the saved task (with its new id) or null on
  /// failure. Reminder scheduling is kept in sync automatically.
  Future<Task?> addTask(Task task) async {
    try {
      final id = await _dao.insert(task);
      final saved = task.copyWith(id: id);
      _tasks = <Task>[..._tasks, saved];
      notifyListeners();
      await _syncReminder(saved);
      return saved;
    } catch (e) {
      _fail(e, 'Saving didn\u2019t work this time. Please try again.');
      return null;
    }
  }

  Future<bool> updateTask(Task task) async {
    final id = task.id;
    if (id == null) return false;
    try {
      await _dao.update(task);
      _tasks = <Task>[
        for (final t in _tasks)
          if (t.id == id) task else t
      ];
      notifyListeners();
      await _syncReminder(task);
      return true;
    } catch (e) {
      _fail(e, 'We couldn\u2019t save your changes. Please try again.');
      return false;
    }
  }

  Future<bool> deleteTask(Task task) async {
    final id = task.id;
    if (id == null) return false;
    try {
      await _dao.delete(id);
      await _reminders.cancelId(id);
      _tasks = <Task>[
        for (final t in _tasks)
          if (t.id != id) t
      ];
      notifyListeners();
      return true;
    } catch (e) {
      _fail(e, 'Deleting didn\u2019t work this time. Please try again.');
      return false;
    }
  }

  Future<bool> setCompleted(Task task, bool completed) async {
    final now = clock();
    final updated = task.copyWith(
      isCompleted: completed,
      updatedAt: now,
      completedAt: completed ? now : null,
      clearCompletedAt: !completed,
    );
    final ok = task.id == null ? await addTask(updated) != null : await updateTaskSilentReminder(updated);
    if (ok && completed) {
      await _reminders.cancelFor(updated);
    } else if (ok) {
      await _syncReminder(updated);
    }
    return ok;
  }

  Future<bool> updateTaskSilentReminder(Task task) async {
    final id = task.id;
    if (id == null) return false;
    try {
      await _dao.update(task);
      _tasks = <Task>[
        for (final t in _tasks)
          if (t.id == id) task else t
      ];
      notifyListeners();
      return true;
    } catch (e) {
      _fail(e, 'We couldn\u2019t save your changes. Please try again.');
      return false;
    }
  }

  Future<void> _syncReminder(Task task) async {
    if (task.isCompleted || !task.reminderEnabled) {
      await _reminders.cancelFor(task);
    } else if (task.reminderEnabled) {
      await _reminders.scheduleFor(task);
    }
  }

  void _fail(Object e, String friendly) {
    _errorMessage = friendly;
    debugPrint('Taskly: $e');
    notifyListeners();
  }

  void clearError() {
    if (_errorMessage == null) return;
    _errorMessage = null;
    notifyListeners();
  }
}
