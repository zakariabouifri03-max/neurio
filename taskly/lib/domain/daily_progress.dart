import '../data/models/task.dart';

/// Daily progress computed from *real* task data only.
class DailyProgress {
  const DailyProgress({required this.completed, required this.total});

  final int completed;
  final int total;

  double get fraction => total == 0 ? 0 : (completed / total).clamp(0.0, 1.0);

  int get percent => (fraction * 100).round();

  bool get isAllDone => total > 0 && completed == total;

  /// Encouragement that matches the actual state — never fabricated.
  String get message {
    if (total == 0) return 'Your day is a blank canvas. Let\u2019s plan something wonderful!';
    if (completed == 0) return 'One step at a time. You\u2019ve got this.';
    if (isAllDone) return 'You\u2019re doing amazing! Every little win counts.';
    if (fraction >= 0.5) return 'Look at you making progress!';
    return 'Every little win counts. Keep going.';
  }

  static DailyProgress fromTasks(Iterable<Task> dueToday) {
    var completed = 0;
    var total = 0;
    for (final task in dueToday) {
      total++;
      if (task.isCompleted) completed++;
    }
    return DailyProgress(completed: completed, total: total);
  }
}
