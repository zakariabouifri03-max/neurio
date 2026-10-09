import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';

enum TaskPriority { low, medium, high }

extension TaskPriorityX on TaskPriority {
  String get label {
    switch (this) {
      case TaskPriority.low:
        return 'Low';
      case TaskPriority.medium:
        return 'Medium';
      case TaskPriority.high:
        return 'High';
    }
  }

  /// Sorting weight — higher sorts first.
  int get rank {
    switch (this) {
      case TaskPriority.low:
        return 0;
      case TaskPriority.medium:
        return 1;
      case TaskPriority.high:
        return 2;
    }
  }

  IconData get icon {
    switch (this) {
      case TaskPriority.low:
        return Icons.arrow_downward_rounded;
      case TaskPriority.medium:
        return Icons.drag_handle_rounded;
      case TaskPriority.high:
        return Icons.keyboard_double_arrow_up_rounded;
    }
  }

  Color get background {
    switch (this) {
      case TaskPriority.low:
        return AppColors.mint;
      case TaskPriority.medium:
        return AppColors.warningSoft;
      case TaskPriority.high:
        return AppColors.dangerSoft;
    }
  }

  Color get foreground {
    switch (this) {
      case TaskPriority.low:
        return AppColors.success;
      case TaskPriority.medium:
        return AppColors.warning;
      case TaskPriority.high:
        return AppColors.danger;
    }
  }

  static TaskPriority fromIndex(int index) =>
      TaskPriority.values[index.clamp(0, TaskPriority.values.length - 1)];
}
