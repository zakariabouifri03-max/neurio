/// Priority levels for tasks.
///
/// Priorities are always rendered with a label and an icon in addition to
/// color, so they are accessible to colorblind users and in dark mode.
enum TaskPriority {
  low(0, 'Low'),
  medium(1, 'Medium'),
  high(2, 'High');

  const TaskPriority(this.value, this.label);

  /// Stable integer stored in the database.
  final int value;
  final String label;

  static TaskPriority fromValue(int? value) => TaskPriority.values.firstWhere(
    (p) => p.value == value,
    orElse: () => TaskPriority.medium,
  );
}
