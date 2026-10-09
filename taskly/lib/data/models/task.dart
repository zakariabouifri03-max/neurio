import 'task_category.dart';
import 'task_priority.dart';

/// A single user task. Dates are stored as plain values:
/// [dueDate] is a day (normalized to midnight), [dueTime] is an optional
/// "HH:mm" local time string.
class Task {
  const Task({
    this.id,
    required this.title,
    this.description,
    required this.dueDate,
    this.dueTime,
    this.priority = TaskPriority.medium,
    this.category = TaskCategory.personal,
    this.isCompleted = false,
    required this.createdAt,
    required this.updatedAt,
    this.completedAt,
    this.reminderEnabled = false,
    this.reminderOffsetMinutes = 0,
  });

  final int? id;
  final String title;
  final String? description;
  final DateTime dueDate;
  final String? dueTime;
  final TaskPriority priority;
  final TaskCategory category;
  final bool isCompleted;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? completedAt;
  final bool reminderEnabled;

  /// Minutes before the due moment when the reminder should fire.
  /// `0` means "at the due moment".
  final int reminderOffsetMinutes;

  static const List<int> reminderOffsetChoices = <int>[0, 10, 30, 60, 1440];

  static String reminderOffsetLabel(int minutes) {
    switch (minutes) {
      case 0:
        return 'At due time';
      case 10:
        return '10 minutes before';
      case 30:
        return '30 minutes before';
      case 60:
        return '1 hour before';
      case 1440:
        return '1 day before';
      default:
        return '$minutes minutes before';
    }
  }

  /// Normalizes [date] to local midnight so day comparisons are stable.
  static DateTime dayOnly(DateTime date) =>
      DateTime(date.year, date.month, date.day);

  int? get dueTimeMinutes {
    if (dueTime == null) return null;
    final parts = dueTime!.split(':');
    if (parts.length != 2) return null;
    final hour = int.tryParse(parts[0]);
    final minute = int.tryParse(parts[1]);
    if (hour == null || minute == null || hour > 23 || minute > 59) {
      return null;
    }
    return hour * 60 + minute;
  }

  /// Due date combined with due time, or `null` when no time is set.
  DateTime? get dueDateTime {
    final minutes = dueTimeMinutes;
    if (minutes == null) return null;
    return DateTime(dueDate.year, dueDate.month, dueDate.day,
        minutes ~/ 60, minutes % 60);
  }

  /// The moment used for reminders and time-aware sorting:
  /// the due time when set, otherwise 9:00 AM on the due day.
  DateTime get referenceDateTime =>
      dueDateTime ?? DateTime(dueDate.year, dueDate.month, dueDate.day, 9, 0);

  DateTime? get reminderAt => reminderEnabled
      ? referenceDateTime.subtract(Duration(minutes: reminderOffsetMinutes))
      : null;

  bool isDueOn(DateTime day) =>
      dueDate.year == day.year &&
      dueDate.month == day.month &&
      dueDate.day == day.day;

  bool isDueToday(DateTime now) => isDueOn(now);

  bool isUpcoming(DateTime now) => dayOnly(dueDate).isAfter(dayOnly(now));

  /// Overdue means: unfinished and its due moment already passed.
  /// Tasks without a time are considered overdue once their day is past.
  bool isOverdue(DateTime now) {
    if (isCompleted) return false;
    final due = dueDateTime;
    if (due != null) return due.isBefore(now);
    return dayOnly(dueDate).isBefore(dayOnly(now));
  }

  Task copyWith({
    int? id,
    String? title,
    String? description,
    bool clearDescription = false,
    DateTime? dueDate,
    String? dueTime,
    bool clearDueTime = false,
    TaskPriority? priority,
    TaskCategory? category,
    bool? isCompleted,
    DateTime? createdAt,
    DateTime? updatedAt,
    DateTime? completedAt,
    bool clearCompletedAt = false,
    bool? reminderEnabled,
    int? reminderOffsetMinutes,
  }) {
    return Task(
      id: id ?? this.id,
      title: title ?? this.title,
      description: clearDescription ? null : (description ?? this.description),
      dueDate: dueDate ?? this.dueDate,
      dueTime: clearDueTime ? null : (dueTime ?? this.dueTime),
      priority: priority ?? this.priority,
      category: category ?? this.category,
      isCompleted: isCompleted ?? this.isCompleted,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      completedAt: clearCompletedAt ? null : (completedAt ?? this.completedAt),
      reminderEnabled: reminderEnabled ?? this.reminderEnabled,
      reminderOffsetMinutes:
          reminderOffsetMinutes ?? this.reminderOffsetMinutes,
    );
  }

  Map<String, Object?> toMap() {
    return <String, Object?>{
      if (id != null) 'id': id,
      'title': title,
      'description': description,
      'due_date': '${dueDate.year.toString().padLeft(4, '0')}-'
          '${dueDate.month.toString().padLeft(2, '0')}-'
          '${dueDate.day.toString().padLeft(2, '0')}',
      'due_time': dueTime,
      'priority': priority.index,
      'category': category.index,
      'is_completed': isCompleted ? 1 : 0,
      'created_at': createdAt.millisecondsSinceEpoch,
      'updated_at': updatedAt.millisecondsSinceEpoch,
      'completed_at': completedAt?.millisecondsSinceEpoch,
      'reminder_enabled': reminderEnabled ? 1 : 0,
      'reminder_offset_minutes': reminderEnabled ? reminderOffsetMinutes : null,
    };
  }

  factory Task.fromMap(Map<String, Object?> map) {
    final dueDateRaw = (map['due_date'] as String?) ?? '1970-01-01';
    final dueParts = dueDateRaw.split('-');
    final year = int.tryParse(dueParts.elementAtOrNull(0) ?? '') ?? 1970;
    final month = int.tryParse(dueParts.elementAtOrNull(1) ?? '') ?? 1;
    final day = int.tryParse(dueParts.elementAtOrNull(2) ?? '') ?? 1;
    final completedAtMs = map['completed_at'] as int?;
    final reminderEnabled = (map['reminder_enabled'] as int? ?? 0) == 1;
    return Task(
      id: map['id'] as int?,
      title: (map['title'] as String?) ?? '',
      description: map['description'] as String?,
      dueDate: DateTime(year, month, day),
      dueTime: map['due_time'] as String?,
      priority: TaskPriorityX.fromIndex(map['priority'] as int? ?? 1),
      category: TaskCategoryX.fromIndex(map['category'] as int? ?? 0),
      isCompleted: (map['is_completed'] as int? ?? 0) == 1,
      createdAt: DateTime.fromMillisecondsSinceEpoch(
          map['created_at'] as int? ?? 0),
      updatedAt: DateTime.fromMillisecondsSinceEpoch(
          map['updated_at'] as int? ?? 0),
      completedAt: completedAtMs == null
          ? null
          : DateTime.fromMillisecondsSinceEpoch(completedAtMs),
      reminderEnabled: reminderEnabled,
      reminderOffsetMinutes: reminderEnabled
          ? (map['reminder_offset_minutes'] as int? ?? 0)
          : 0,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is Task &&
      other.id == id &&
      other.title == title &&
      other.description == description &&
      other.dueDate == dueDate &&
      other.dueTime == dueTime &&
      other.priority == priority &&
      other.category == category &&
      other.isCompleted == isCompleted &&
      other.updatedAt == updatedAt &&
      other.reminderEnabled == reminderEnabled;

  @override
  int get hashCode => Object.hash(
      id, title, dueDate, dueTime, priority, category, isCompleted, updatedAt);
}

extension _SafeList on List<String> {
  String? elementAtOrNull(int index) =>
      index >= 0 && index < length ? this[index] : null;
}
