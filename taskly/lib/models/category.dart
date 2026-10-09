import 'package:flutter/material.dart';

import '../core/theme/app_colors.dart';

/// Categories available for tasks.
///
/// Categories carry a friendly label, a simple line icon and a pastel accent.
enum TaskCategory {
  personal('Personal', Icons.favorite_border),
  work('Work', Icons.work_outline),
  study('Study', Icons.menu_book_outlined),
  health('Health', Icons.favorite_outline_sharp),
  shopping('Shopping', Icons.shopping_bag_outlined),
  other('Other', Icons.category_outlined);

  const TaskCategory(this.label, this.icon);

  final String label;
  final IconData icon;

  /// Stable storage key.
  String get storageKey => name;

  static TaskCategory fromKey(String? key) => TaskCategory.values.firstWhere(
    (c) => c.storageKey == key,
    orElse: () => TaskCategory.other,
  );

  /// Pastel fill used for chips and indicators.
  Color get pastel => switch (this) {
    TaskCategory.personal => AppColors.pastelPink,
    TaskCategory.work => AppColors.babyBlue,
    TaskCategory.study => AppColors.lavender,
    TaskCategory.health => AppColors.mintGreen,
    TaskCategory.shopping => AppColors.peach,
    TaskCategory.other => AppColors.sunnyYellow,
  };

  /// A deeper, readable tone for text/icons on light backgrounds.
  Color get deep => switch (this) {
    TaskCategory.personal => AppColors.pinkDeep,
    TaskCategory.work => AppColors.blueDeep,
    TaskCategory.study => AppColors.lavenderDeep,
    TaskCategory.health => AppColors.mintDeep,
    TaskCategory.shopping => AppColors.error,
    TaskCategory.other => AppColors.yellowDeep,
  };
}
