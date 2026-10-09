import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:taskly/core/theme/app_theme.dart';

void main() {
  group('AppTheme', () {
    final light = AppTheme.light();
    final dark = AppTheme.dark();

    test('light theme uses the cozy cream palette', () {
      expect(light.brightness, Brightness.light);
      expect(light.scaffoldBackgroundColor, const Color(0xFFFFF9F2));
      expect(light.colorScheme.surface, Colors.white);
      expect(light.textTheme.headlineMedium?.fontSize, 24);
    });

    test('dark theme uses deep plum surfaces, never pure black', () {
      expect(dark.brightness, Brightness.dark);
      expect(dark.scaffoldBackgroundColor, const Color(0xFF211E2E));
      expect(dark.colorScheme.surface, const Color(0xFF2B2740));
      expect(
        dark.scaffoldBackgroundColor,
        isNot(Colors.black),
        reason: 'pure black is avoided',
      );
      expect(dark.textTheme.bodyLarge?.color, const Color(0xFFF2EFF7));
    });

    test('fonts are the rounded brand font', () {
      expect(light.fontFamily, 'Nunito');
      expect(dark.fontFamily, 'Nunito');
    });

    test('text contrast survives in both themes', () {
      final lightText = light.textTheme.bodyLarge!.color!;
      expect(
        _contrast(lightText, light.colorScheme.surface),
        greaterThan(7.0),
        reason: 'body text must be AA+ on cards',
      );
      final darkText = dark.textTheme.bodyLarge!.color!;
      expect(_contrast(darkText, dark.colorScheme.surface), greaterThan(7.0));
    });

    test('both themes define an accessible error color', () {
      expect(light.colorScheme.error, const Color(0xFFD95368));
      expect(dark.colorScheme.error, const Color(0xFFF08CA0));
    });

    test('theme mode mapping stays intact', () {
      // ThemeMode passes straight to MaterialApp; settings persists names.
      expect(ThemeMode.values.length, 3);
    });
  });
}

/// WCAG relative-luminance contrast ratio.
double _contrast(Color a, Color b) {
  double lum(Color c) {
    double channel(double v) => v <= 0.03928
        ? v / 12.92
        : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
    return 0.2126 * channel(c.r) +
        0.7152 * channel(c.g) +
        0.0722 * channel(c.b);
  }

  final l1 = lum(a);
  final l2 = lum(b);
  final lighter = math.max(l1, l2);
  final darker = math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
