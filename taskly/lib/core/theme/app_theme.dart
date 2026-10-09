import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_colors.dart';

/// Central design system: typography, shapes, light + dark themes.
class AppTheme {
  const AppTheme._();

  static const String fontFamily = 'Nunito';

  static const double radiusCard = 22;
  static const double radiusField = 16;
  static const double radiusPill = 999;

  static ThemeData light() {
    final scheme = ColorScheme.light(
      primary: AppColors.primary,
      onPrimary: AppColors.onPrimary,
      secondary: AppColors.primary,
      onSecondary: AppColors.onPrimary,
      surface: AppColors.white,
      onSurface: AppColors.textPrimary,
      surfaceContainerHighest: AppColors.primarySoft,
      error: AppColors.error,
      onError: AppColors.white,
      outline: AppColors.softBorder,
      outlineVariant: AppColors.softBorder,
    );
    return _base(scheme,
        scaffold: AppColors.cream,
        card: AppColors.white,
        textPrimary: AppColors.textPrimary,
        textSecondary: AppColors.textSecondary,
        border: AppColors.softBorder,
        shadow: const Color(0x14664FA8),
        brightness: Brightness.light);
  }

  static ThemeData dark() {
    final scheme = ColorScheme.dark(
      primary: AppColors.darkPrimary,
      onPrimary: AppColors.darkOnPrimary,
      secondary: AppColors.darkPrimary,
      onSecondary: AppColors.darkOnPrimary,
      surface: AppColors.darkSurface,
      onSurface: AppColors.darkText,
      surfaceContainerHighest: AppColors.darkPrimarySoft,
      error: AppColors.darkDanger,
      onError: AppColors.darkOnPrimary,
      outline: AppColors.darkBorder,
      outlineVariant: AppColors.darkBorder,
    );
    return _base(scheme,
        scaffold: AppColors.darkBackground,
        card: AppColors.darkSurface,
        textPrimary: AppColors.darkText,
        textSecondary: AppColors.darkTextSecondary,
        border: AppColors.darkBorder,
        shadow: const Color(0x40000000),
        brightness: Brightness.dark);
  }

  static ThemeData _base(
    ColorScheme scheme, {
    required Color scaffold,
    required Color card,
    required Color textPrimary,
    required Color textSecondary,
    required Color border,
    required Color shadow,
    required Brightness brightness,
  }) {
    final textTheme = TextTheme(
      displaySmall: TextStyle(
          fontFamily: fontFamily,
          fontWeight: FontWeight.w800,
          fontSize: 30,
          height: 1.2,
          color: textPrimary),
      headlineMedium: TextStyle(
          fontFamily: fontFamily,
          fontWeight: FontWeight.w800,
          fontSize: 24,
          height: 1.25,
          color: textPrimary),
      headlineSmall: TextStyle(
          fontFamily: fontFamily,
          fontWeight: FontWeight.w700,
          fontSize: 20,
          height: 1.3,
          color: textPrimary),
      titleLarge: TextStyle(
          fontFamily: fontFamily,
          fontWeight: FontWeight.w700,
          fontSize: 17,
          height: 1.35,
          color: textPrimary),
      titleMedium: TextStyle(
          fontFamily: fontFamily,
          fontWeight: FontWeight.w600,
          fontSize: 15,
          height: 1.4,
          color: textPrimary),
      titleSmall: TextStyle(
          fontFamily: fontFamily,
          fontWeight: FontWeight.w600,
          fontSize: 13.5,
          height: 1.4,
          color: textPrimary),
      bodyLarge: TextStyle(
          fontFamily: fontFamily,
          fontWeight: FontWeight.w400,
          fontSize: 15.5,
          height: 1.5,
          color: textPrimary),
      bodyMedium: TextStyle(
          fontFamily: fontFamily,
          fontWeight: FontWeight.w400,
          fontSize: 14,
          height: 1.5,
          color: textPrimary),
      bodySmall: TextStyle(
          fontFamily: fontFamily,
          fontWeight: FontWeight.w400,
          fontSize: 12.5,
          height: 1.45,
          color: textSecondary),
      labelLarge: TextStyle(
          fontFamily: fontFamily,
          fontWeight: FontWeight.w700,
          fontSize: 15,
          height: 1.2,
          color: textPrimary),
      labelMedium: TextStyle(
          fontFamily: fontFamily,
          fontWeight: FontWeight.w600,
          fontSize: 13,
          height: 1.2,
          color: textPrimary),
      labelSmall: TextStyle(
          fontFamily: fontFamily,
          fontWeight: FontWeight.w600,
          fontSize: 11.5,
          height: 1.2,
          color: textSecondary),
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: scaffold,
      cardColor: card,
      dividerColor: border,
      fontFamily: fontFamily,
      textTheme: textTheme,
      splashFactory: InkRipple.splashFactory,
      appBarTheme: AppBarTheme(
        backgroundColor: scaffold,
        surfaceTintColor: Colors.transparent,
        foregroundColor: textPrimary,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: textTheme.headlineSmall,
        systemOverlayStyle: brightness == Brightness.light
            ? SystemUiOverlayStyle.dark.copyWith(
                statusBarColor: Colors.transparent,
                systemNavigationBarColor: scaffold)
            : SystemUiOverlayStyle.light.copyWith(
                statusBarColor: Colors.transparent,
                systemNavigationBarColor: scaffold),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: card,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        hintStyle: textTheme.bodyMedium?.copyWith(color: textSecondary),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusField),
          borderSide: BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusField),
          borderSide: BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusField),
          borderSide: BorderSide(color: scheme.primary, width: 1.6),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusField),
          borderSide: const BorderSide(color: AppColors.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusField),
          borderSide: const BorderSide(color: AppColors.error, width: 1.6),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: scheme.surfaceContainerHighest,
        selectedColor: scheme.primary,
        labelStyle: textTheme.labelMedium,
        side: BorderSide.none,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusPill),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: textPrimary,
        contentTextStyle: textTheme.bodyMedium?.copyWith(color: scaffold),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: card,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: card,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(color: border),
        ),
      ),
      extensions: <ThemeExtension<dynamic>>[
        AppPalette(
          card: card,
          scaffold: scaffold,
          border: border,
          textPrimary: textPrimary,
          textSecondary: textSecondary,
          shadow: shadow,
          lavender: brightness == Brightness.light
              ? AppColors.lavender
              : AppColors.darkPrimarySoft,
          pink: brightness == Brightness.light
              ? AppColors.pink
              : const Color(0xFF4A3244),
          babyBlue: brightness == Brightness.light
              ? AppColors.babyBlue
              : const Color(0xFF2C3E4C),
          mint: brightness == Brightness.light
              ? AppColors.mint
              : const Color(0xFF2A4438),
          cream: brightness == Brightness.light
              ? AppColors.cream
              : AppColors.darkSurfaceHigh,
          success: brightness == Brightness.light
              ? AppColors.success
              : AppColors.darkSuccess,
          warning: brightness == Brightness.light
              ? AppColors.warning
              : AppColors.darkWarning,
          danger: brightness == Brightness.light
              ? AppColors.danger
              : AppColors.darkDanger,
          successSoft: brightness == Brightness.light
              ? AppColors.successSoft
              : const Color(0xFF24402F),
          warningSoft: brightness == Brightness.light
              ? AppColors.warningSoft
              : const Color(0xFF453722),
          dangerSoft: brightness == Brightness.light
              ? AppColors.dangerSoft
              : const Color(0xFF4A2A31),
        ),
      ],
    );
  }

  static AppPalette paletteOf(BuildContext context) =>
      Theme.of(context).extension<AppPalette>()!;
}

/// Theme-aware palette extension so widgets never hard-code light colors.
@immutable
class AppPalette extends ThemeExtension<AppPalette> {
  const AppPalette({
    required this.card,
    required this.scaffold,
    required this.border,
    required this.textPrimary,
    required this.textSecondary,
    required this.shadow,
    required this.lavender,
    required this.pink,
    required this.babyBlue,
    required this.mint,
    required this.cream,
    required this.success,
    required this.warning,
    required this.danger,
    required this.successSoft,
    required this.warningSoft,
    required this.dangerSoft,
  });

  final Color card;
  final Color scaffold;
  final Color border;
  final Color textPrimary;
  final Color textSecondary;
  final Color shadow;
  final Color lavender;
  final Color pink;
  final Color babyBlue;
  final Color mint;
  final Color cream;
  final Color success;
  final Color warning;
  final Color danger;
  final Color successSoft;
  final Color warningSoft;
  final Color dangerSoft;

  @override
  AppPalette copyWith({
    Color? card,
    Color? scaffold,
    Color? border,
    Color? textPrimary,
    Color? textSecondary,
    Color? shadow,
    Color? lavender,
    Color? pink,
    Color? babyBlue,
    Color? mint,
    Color? cream,
    Color? success,
    Color? warning,
    Color? danger,
    Color? successSoft,
    Color? warningSoft,
    Color? dangerSoft,
  }) {
    return AppPalette(
      card: card ?? this.card,
      scaffold: scaffold ?? this.scaffold,
      border: border ?? this.border,
      textPrimary: textPrimary ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      shadow: shadow ?? this.shadow,
      lavender: lavender ?? this.lavender,
      pink: pink ?? this.pink,
      babyBlue: babyBlue ?? this.babyBlue,
      mint: mint ?? this.mint,
      cream: cream ?? this.cream,
      success: success ?? this.success,
      warning: warning ?? this.warning,
      danger: danger ?? this.danger,
      successSoft: successSoft ?? this.successSoft,
      warningSoft: warningSoft ?? this.warningSoft,
      dangerSoft: dangerSoft ?? this.dangerSoft,
    );
  }

  @override
  AppPalette lerp(AppPalette? other, double t) {
    if (other is! AppPalette) return this;
    return AppPalette(
      card: Color.lerp(card, other.card, t)!,
      scaffold: Color.lerp(scaffold, other.scaffold, t)!,
      border: Color.lerp(border, other.border, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      shadow: Color.lerp(shadow, other.shadow, t)!,
      lavender: Color.lerp(lavender, other.lavender, t)!,
      pink: Color.lerp(pink, other.pink, t)!,
      babyBlue: Color.lerp(babyBlue, other.babyBlue, t)!,
      mint: Color.lerp(mint, other.mint, t)!,
      cream: Color.lerp(cream, other.cream, t)!,
      success: Color.lerp(success, other.success, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      successSoft: Color.lerp(successSoft, other.successSoft, t)!,
      warningSoft: Color.lerp(warningSoft, other.warningSoft, t)!,
      dangerSoft: Color.lerp(dangerSoft, other.dangerSoft, t)!,
    );
  }
}
