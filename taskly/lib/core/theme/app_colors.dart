import 'package:flutter/material.dart';

/// Taskly brand palette.
///
/// Pastels are used for surfaces, chips and decorations. Deeper tints of the
/// same hues are used where text or control contrast requires it.
class AppColors {
  const AppColors._();

  // Brand pastels
  static const Color lavender = Color(0xFFC9B8FF);
  static const Color pink = Color(0xFFFFD6E7);
  static const Color babyBlue = Color(0xFFCDEBFF);
  static const Color mint = Color(0xFFCFF5DF);
  static const Color cream = Color(0xFFFFF9F2);
  static const Color white = Color(0xFFFFFFFF);

  // Light theme ink
  static const Color textPrimary = Color(0xFF353347);
  static const Color textSecondary = Color(0xFF777487);
  static const Color softBorder = Color(0xFFEEE8F5);
  static const Color error = Color(0xFFD95368);

  // Accessible (contrast-safe) accents derived from the pastels
  static const Color primary = Color(0xFF6C4FC4); // deep lavender
  static const Color primarySoft = Color(0xFFEDE7FB);
  static const Color onPrimary = Color(0xFFFFFFFF);
  static const Color success = Color(0xFF2E9E77);
  static const Color successSoft = Color(0xFFDFF6EA);
  static const Color warning = Color(0xFFB7791F);
  static const Color warningSoft = Color(0xFFFFEFD6);
  static const Color danger = Color(0xFFC24357);
  static const Color dangerSoft = Color(0xFFFFE1E6);

  // Dark theme
  static const Color darkBackground = Color(0xFF1B1826);
  static const Color darkSurface = Color(0xFF262233);
  static const Color darkSurfaceHigh = Color(0xFF302B40);
  static const Color darkBorder = Color(0xFF3B3550);
  static const Color darkText = Color(0xFFF3F0FA);
  static const Color darkTextSecondary = Color(0xFFB7B1C9);
  static const Color darkPrimary = Color(0xFFB9A5F2);
  static const Color darkPrimarySoft = Color(0xFF3A3153);
  static const Color darkOnPrimary = Color(0xFF241F33);
  static const Color darkSuccess = Color(0xFF7EDCB4);
  static const Color darkWarning = Color(0xFFEFC078);
  static const Color darkDanger = Color(0xFFF08D9D);

  /// Category colors (soft background + readable foreground).
  static const Color categoryPersonal = lavender;
  static const Color categoryWork = babyBlue;
  static const Color categoryStudy = pink;
  static const Color categoryHealth = mint;
  static const Color categoryShopping = Color(0xFFFFE3C9);
  static const Color categoryOther = Color(0xFFE9E5F2);
}
