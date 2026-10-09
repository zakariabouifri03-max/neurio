import 'package:flutter/material.dart';

/// Gentle shared-axis transition used for secondary screens.
/// Honors the system "remove animations" accessibility preference.
PageRouteBuilder<T> fadeSlideRoute<T>({
  RouteSettings? settings,
  required WidgetBuilder builder,
}) {
  return PageRouteBuilder<T>(
    settings: settings,
    transitionDuration: const Duration(milliseconds: 240),
    reverseTransitionDuration: const Duration(milliseconds: 180),
    pageBuilder: (context, animation, secondaryAnimation) =>
        builder(context),
    transitionsBuilder: (context, animation, secondaryAnimation, child) {
      final disabled = MediaQuery.disableAnimationsOf(context);
      if (disabled) return child;
      final curved = CurvedAnimation(
        parent: animation,
        curve: Curves.easeOutCubic,
      );
      return SlideTransition(
        position: Tween(
          begin: const Offset(0, 0.03),
          end: Offset.zero,
        ).animate(curved),
        child: FadeTransition(opacity: curved, child: child),
      );
    },
  );
}
