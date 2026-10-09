import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';

enum TaskCategory { personal, work, study, health, shopping, other }

extension TaskCategoryX on TaskCategory {
  String get label {
    switch (this) {
      case TaskCategory.personal:
        return 'Personal';
      case TaskCategory.work:
        return 'Work';
      case TaskCategory.study:
        return 'Study';
      case TaskCategory.health:
        return 'Health';
      case TaskCategory.shopping:
        return 'Shopping';
      case TaskCategory.other:
        return 'Other';
    }
  }

  IconData get icon {
    switch (this) {
      case TaskCategory.personal:
        return Icons.favorite_rounded;
      case TaskCategory.work:
        return Icons.work_outline_rounded;
      case TaskCategory.study:
        return Icons.menu_book_outlined;
      case TaskCategory.health:
        return Icons.spa_outlined;
      case TaskCategory.shopping:
        return Icons.shopping_bag_outlined;
      case TaskCategory.other:
        return Icons.category_outlined;
    }
  }

  Color get background {
    switch (this) {
      case TaskCategory.personal:
        return AppColors.categoryPersonal;
      case TaskCategory.work:
        return AppColors.categoryWork;
      case TaskCategory.study:
        return AppColors.categoryStudy;
      case TaskCategory.health:
        return AppColors.categoryHealth;
      case TaskCategory.shopping:
        return AppColors.categoryShopping;
      case TaskCategory.other:
        return AppColors.categoryOther;
    }
  }

  /// Readable ink on top of [background].
  Color get foreground {
    switch (this) {
      case TaskCategory.personal:
        return const Color(0xFF5B44A8);
      case TaskCategory.work:
        return const Color(0xFF2E6E9E);
      case TaskCategory.study:
        return const Color(0xFFB04A78);
      case TaskCategory.health:
        return const Color(0xFF2E8B67);
      case TaskCategory.shopping:
        return const Color(0xFFA96A22);
      case TaskCategory.other:
        return const Color(0xFF5D5876);
    }
  }

  static TaskCategory fromIndex(int index) =>
      TaskCategory.values[index.clamp(0, TaskCategory.values.length - 1)];
}
