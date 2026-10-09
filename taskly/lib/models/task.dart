import '../core/utils/date_helper.dart';
import 'category.dart';
import 'priority.dart';

/// A single task. Pure model — no Flutter dependencies, fully testable.
class Task {
  Task({
    required this.id,
    required this.title,
    this.description = '',
    required this.dueDate,
    this.dueMinutes,
    this.priority = TaskPriority.medium,
    this.category = TaskCategory.other,
    this.isCompleted = false,
    this.completedAt,
    required this.createdAt,
    required this.updatedAt,
    this.reminderEnabled = false,
  });

  /// Database primary key (also used as the notification id, keeping
  /// reminder ids stable across edits and restarts).
  final int id;
  final String title;
  final String description;

  /// Local calendar day the task is due (midnight of that day).
  final DateTime dueDate;

  /// Minutes since local midnight, or null when no time is set.
  final int? dueMinutes;
  final TaskPriority priority;
  final TaskCategory category;
  final bool isCompleted;

  /// When the task was marked complete (null while open). Used for honest
  /// statistics such as "completed today".
  final DateTime? completedAt;
  final DateTime createdAt;
  final DateTime updatedAt;
  final bool reminderEnabled;

  Task copyWith({
    int? id,
    String? title,
    String? description,
    DateTime? dueDate,
    Object? dueMinutes = _unset,
    TaskPriority? priority,
    TaskCategory? category,
    bool? isCompleted,
    Object? completedAt = _unset,
    DateTime? createdAt,
    DateTime? updatedAt,
    bool? reminderEnabled,
  }) => Task(
    id: id ?? this.id,
    title: title ?? this.title,
    description: description ?? this.description,
    dueDate: dueDate ?? this.dueDate,
    dueMinutes: dueMinutes == _unset ? this.dueMinutes : dueMinutes as int?,
    priority: priority ?? this.priority,
    category: category ?? this.category,
    isCompleted: isCompleted ?? this.isCompleted,
    completedAt:
        completedAt == _unset ? this.completedAt : completedAt as DateTime?,
    createdAt: createdAt ?? this.createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
    reminderEnabled: reminderEnabled ?? this.reminderEnabled,
  );

  static const _unset = Object();

  /// Full local date+time the task is due, if a time was set.
  DateTime get dueDateTime => DateHelper.atMinutes(dueDate, dueMinutes);

  /// Whether this task is due before today and still open.
  bool isOverdue(DateTime now) =>
      !isCompleted && DateHelper.startOfDay(dueDate).isBefore(DateHelper.startOfDay(now));

  // ---------------- Persistence ----------------

  Map<String, Object?> toMap() => <String, Object?>{
    'id': id,
    'title': title,
    'description': description,
    'dueDate': dueDate.millisecondsSinceEpoch,
    'dueMinutes': dueMinutes,
    'priority': priority.value,
    'category': category.storageKey,
    'isCompleted': isCompleted ? 1 : 0,
    'completedAt': completedAt?.millisecondsSinceEpoch,
    'createdAt': createdAt.millisecondsSinceEpoch,
    'updatedAt': updatedAt.millisecondsSinceEpoch,
    'reminderEnabled': reminderEnabled ? 1 : 0,
  };

  static Task fromMap(Map<String, Object?> map) => Task(
    id: map['id']! as int,
    title: map['title']! as String,
    description: (map['description'] ?? '') as String,
    dueDate: DateTime.fromMillisecondsSinceEpoch(map['dueDate']! as int),
    dueMinutes: map['dueMinutes'] as int?,
    priority: TaskPriority.fromValue(map['priority'] as int?),
    category: TaskCategory.fromKey(map['category'] as String?),
    isCompleted: (map['isCompleted'] ?? 0) == 1,
    completedAt: map['completedAt'] == null
        ? null
        : DateTime.fromMillisecondsSinceEpoch(map['completedAt']! as int),
    createdAt: DateTime.fromMillisecondsSinceEpoch(map['createdAt']! as int),
    updatedAt: DateTime.fromMillisecondsSinceEpoch(map['updatedAt']! as int),
    reminderEnabled: (map['reminderEnabled'] ?? 0) == 1,
  );
}
