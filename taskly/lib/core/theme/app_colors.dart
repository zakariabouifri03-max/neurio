import 'package:flutter/material.dart';

/// Taskly brand palette — soft, cozy pastels with strong text contrast.
abstract final class AppColors {
  // ---- Brand pastels ----
  static const Color lavender = Color(0xFFC9B8FF);
  static const Color pastelPink = Color(0xFFFFD6E7);
  static const Color babyBlue = Color(0xFFCDEBFF);
  static const Color mintGreen = Color(0xFFCFF5DF);
  static const Color sunnyYellow = Color(0xFFFFE9B8);
  static const Color peach = Color(0xFFFFE0D3);

  // ---- Neutrals (light theme) ----
  static const Color cream = Color(0xFFFFF9F2);
  static const Color white = Color(0xFFFFFFFF);
  static const Color softBorder = Color(0xFFEEE8F5);

  // ---- Text ----
  static const Color primaryText = Color(0xFF353347);
  static const Color secondaryText = Color(0xFF777487);
  static const Color error = Color(0xFFD95368);

  // ---- Functional accents (readable on white/cream) ----
  static const Color lavenderDeep = Color(0xFF7C6BC8);
  static const Color pinkDeep = Color(0xFFC96E96);
  static const Color blueDeep = Color(0xFF4E88C9);
  static const Color mintDeep = Color(0xFF3F9D74);
  static const Color yellowDeep = Color(0xFFB98A1F);

  // ---- Dark theme surfaces ----
  static const Color nightBackground = Color(0xFF211E2E);
  static const Color nightSurface = Color(0xFF2B2740);
  static const Color nightSurfaceHigh = Color(0xFF353049);
  static const Color nightBorder = Color(0xFF443E5C);
  static const Color nightText = Color(0xFFF2EFF7);
  static const Color nightTextSecondary = Color(0xFFB4AFc7);
  static const Color nightLavender = Color(0xFFB7A6F2);
  static const Color nightError = Color(0xFFF08CA0);

  /// Priority colors (paired with labels + icons, never color alone).
  static const Color priorityLow = mintDeep;
  static const Color priorityMedium = yellowDeep;
  static const Color priorityHigh = error;
}
