import 'package:flutter/material.dart';

/// Gentle, short motion used across the app.
///
/// Every animation goes through [duration]/[curve] so that a single change
/// here tunes the whole feel, and callers check
/// [reducedMotion] to respect the system "remove animations" setting.
class AppMotion {
  const AppMotion._();

  static const Duration fast = Duration(milliseconds: 160);
  static const Duration medium = Duration(milliseconds: 260);
  static const Duration slow = Duration(milliseconds: 420);

  static const Curve curve = Curves.easeOutCubic;
  static const Curve springy = Curves.easeOutBack;

  static bool reducedMotion(BuildContext context) =>
      MediaQuery.of(context).disableAnimations;

  static Duration resolve(BuildContext context, Duration preferred) =>
      reducedMotion(context) ? Duration.zero : preferred;
}
