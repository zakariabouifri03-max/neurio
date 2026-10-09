import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';

/// Hand-drawn (vector) pastel illustrations: resolution independent,
/// theme aware, and free of raster assets.
class Illustrations {
  const Illustrations._();

  static Widget planner({double size = 170}) =>
      _Illustration(size: size, factory: (p) => _PlannerPainter(p));

  static Widget reminder({double size = 170}) =>
      _Illustration(size: size, factory: (p) => _ReminderPainter(p));

  static Widget progress({double size = 170}) =>
      _Illustration(size: size, factory: (p) => _ProgressPainter(p));

  static Widget blankCanvas({double size = 170}) =>
      _Illustration(size: size, factory: (p) => _BlankCanvasPainter(p));
}

typedef _PainterFactory = CustomPainter Function(AppPalette palette);

class _Illustration extends StatelessWidget {
  const _Illustration({required this.size, required this.factory});

  final double size;
  final _PainterFactory factory;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      image: true,
      label: 'Decorative illustration',
      child: CustomPaint(
        size: Size.square(size),
        painter: factory(AppTheme.paletteOf(context)),
      ),
    );
  }
}

// --- shared drawing helpers -------------------------------------------------

void _drawStar(Canvas canvas, Offset center, double radius, Color color) {
  final paint = Paint()
    ..color = color
    ..style = PaintingStyle.fill;
  final path = Path();
  for (var i = 0; i < 10; i++) {
    final r = i.isEven ? radius : radius * 0.45;
    final angle = (i * 36 - 90) * math.pi / 180;
    final point = Offset(
      center.dx + r * math.cos(angle),
      center.dy + r * math.sin(angle),
    );
    if (i == 0) {
      path.moveTo(point.dx, point.dy);
    } else {
      path.lineTo(point.dx, point.dy);
    }
  }
  path.close();
  canvas.drawPath(path, paint);
}

void _drawSparkle(Canvas canvas, Offset center, double radius, Color color) {
  final paint = Paint()
    ..color = color
    ..style = PaintingStyle.fill;
  final path = Path()
    ..moveTo(center.dx, center.dy - radius)
    ..quadraticBezierTo(center.dx + radius * 0.16, center.dy - radius * 0.16,
        center.dx + radius, center.dy)
    ..quadraticBezierTo(center.dx + radius * 0.16, center.dy + radius * 0.16,
        center.dx, center.dy + radius)
    ..quadraticBezierTo(center.dx - radius * 0.16, center.dy + radius * 0.16,
        center.dx - radius, center.dy)
    ..quadraticBezierTo(center.dx - radius * 0.16, center.dy - radius * 0.16,
        center.dx, center.dy - radius)
    ..close();
  canvas.drawPath(path, paint);
}

void _drawHeart(Canvas canvas, Offset center, double radius, Color color) {
  final paint = Paint()
    ..color = color
    ..style = PaintingStyle.fill;
  final path = Path()
    ..moveTo(center.dx, center.dy + radius * 0.85)
    ..cubicTo(
        center.dx - radius * 1.3,
        center.dy - radius * 0.15,
        center.dx - radius * 0.55,
        center.dy - radius * 1.1,
        center.dx,
        center.dy - radius * 0.35)
    ..cubicTo(
        center.dx + radius * 0.55,
        center.dy - radius * 1.1,
        center.dx + radius * 1.3,
        center.dy - radius * 0.15,
        center.dx,
        center.dy + radius * 0.85)
    ..close();
  canvas.drawPath(path, paint);
}

// --- illustrations ----------------------------------------------------------

class _PlannerPainter extends CustomPainter {
  _PlannerPainter(this.palette);

  final AppPalette palette;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final card = RRect.fromRectAndRadius(
      Rect.fromLTWH(w * 0.16, h * 0.22, w * 0.66, h * 0.62),
      Radius.circular(w * 0.07),
    );
    canvas.drawRRect(card, Paint()..color = palette.card);
    canvas.drawRRect(
        card,
        Paint()
          ..color = palette.border
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2);

    final boxColors = <Color>[palette.mint, palette.lavender, palette.pink];
    for (var i = 0; i < 3; i++) {
      final y = h * (0.34 + i * 0.16);
      final boxSize = w * 0.11;
      final box = RRect.fromRectAndRadius(
        Rect.fromLTWH(w * 0.25, y, boxSize, boxSize),
        Radius.circular(boxSize * 0.32),
      );
      canvas.drawRRect(box, Paint()..color = boxColors[i]);
      final check = Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.6
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round;
      canvas.drawPath(
        Path()
          ..moveTo(w * 0.275, y + boxSize * 0.52)
          ..lineTo(w * 0.297, y + boxSize * 0.76)
          ..lineTo(w * 0.338, y + boxSize * 0.26),
        check,
      );
      final barWidth = w * (0.34 - i * 0.06);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(w * 0.43, y + boxSize * 0.34, barWidth, 6),
          const Radius.circular(3),
        ),
        Paint()..color = palette.border,
      );
    }
    _drawStar(canvas, Offset(w * 0.82, h * 0.17), w * 0.1,
        const Color(0xFFF6C86B));
    _drawSparkle(canvas, Offset(w * 0.13, h * 0.16), w * 0.05, palette.lavender);
    _drawHeart(canvas, Offset(w * 0.9, h * 0.42), w * 0.05, palette.pink);
  }

  @override
  bool shouldRepaint(covariant _PlannerPainter oldDelegate) =>
      oldDelegate.palette != palette;
}

class _ReminderPainter extends CustomPainter {
  _ReminderPainter(this.palette);

  final AppPalette palette;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final bellColor = palette.lavender;

    // Bell body
    final bell = Path()
      ..moveTo(w * 0.3, h * 0.62)
      ..cubicTo(w * 0.3, h * 0.3, w * 0.38, h * 0.22, w * 0.5, h * 0.22)
      ..cubicTo(w * 0.62, h * 0.22, w * 0.7, h * 0.3, w * 0.7, h * 0.62)
      ..lineTo(w * 0.76, h * 0.68)
      ..lineTo(w * 0.24, h * 0.68)
      ..close();
    canvas.drawPath(bell, Paint()..color = bellColor);

    // Clapper
    canvas.drawCircle(Offset(w * 0.5, h * 0.75), w * 0.055,
        Paint()..color = palette.pink);

    // Top knob
    canvas.drawCircle(Offset(w * 0.5, h * 0.2), w * 0.035,
        Paint()..color = bellColor);

    // Sound waves
    final wave = Paint()
      ..color = palette.babyBlue
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.4
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(
      Rect.fromCircle(center: Offset(w * 0.5, h * 0.45), radius: w * 0.32),
      -0.5,
      0.6,
      false,
      wave,
    );
    canvas.drawArc(
      Rect.fromCircle(center: Offset(w * 0.5, h * 0.45), radius: w * 0.32),
      math.pi - 0.1,
      0.6,
      false,
      wave,
    );

    _drawSparkle(canvas, Offset(w * 0.18, h * 0.24), w * 0.05, palette.mint);
    _drawSparkle(canvas, Offset(w * 0.85, h * 0.62), w * 0.04, palette.pink);
    _drawStar(canvas, Offset(w * 0.84, h * 0.16), w * 0.06,
        const Color(0xFFF6C86B));
  }

  @override
  bool shouldRepaint(covariant _ReminderPainter oldDelegate) =>
      oldDelegate.palette != palette;
}

class _ProgressPainter extends CustomPainter {
  _ProgressPainter(this.palette);

  final AppPalette palette;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final base = h * 0.82;
    final bars = <Color>[palette.babyBlue, palette.pink, palette.lavender];
    final heights = <double>[h * 0.24, h * 0.38, h * 0.54];
    for (var i = 0; i < 3; i++) {
      final left = w * (0.2 + i * 0.22);
      final barWidth = w * 0.15;
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(left, base - heights[i], barWidth, heights[i]),
          Radius.circular(barWidth * 0.4),
        ),
        Paint()..color = bars[i],
      );
    }
    // Baseline
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(w * 0.14, base, w * 0.72, 4),
        const Radius.circular(2),
      ),
      Paint()..color = palette.border,
    );
    _drawStar(canvas, Offset(w * 0.665, h * 0.19), w * 0.085,
        const Color(0xFFF6C86B));
    _drawSparkle(canvas, Offset(w * 0.16, h * 0.3), w * 0.045, palette.mint);
    _drawHeart(canvas, Offset(w * 0.88, h * 0.4), w * 0.05, palette.pink);
  }

  @override
  bool shouldRepaint(covariant _ProgressPainter oldDelegate) =>
      oldDelegate.palette != palette;
}

class _BlankCanvasPainter extends CustomPainter {
  _BlankCanvasPainter(this.palette);

  final AppPalette palette;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final frame = RRect.fromRectAndRadius(
      Rect.fromLTWH(w * 0.14, h * 0.2, w * 0.72, h * 0.6),
      Radius.circular(w * 0.08),
    );
    canvas.drawRRect(
        frame,
        Paint()
          ..color = palette.card
          ..style = PaintingStyle.fill);
    final dash = Paint()
      ..color = palette.textSecondary.withValues(alpha: 0.5)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.2;
    _dashRRect(canvas, frame, dash, 7, 6);

    _drawStar(canvas, Offset(w * 0.5, h * 0.44), w * 0.09,
        const Color(0xFFF6C86B));
    _drawSparkle(canvas, Offset(w * 0.3, h * 0.34), w * 0.04, palette.lavender);
    _drawSparkle(canvas, Offset(w * 0.7, h * 0.56), w * 0.035, palette.mint);
    _drawHeart(canvas, Offset(w * 0.68, h * 0.33), w * 0.045, palette.pink);
  }

  void _dashRRect(Canvas canvas, RRect rect, Paint paint, double dashLength,
      double gapLength) {
    final path = Path()..addRRect(rect);
    for (final metric in path.computeMetrics()) {
      var distance = 0.0;
      while (distance < metric.length) {
        final end = math.min(distance + dashLength, metric.length);
        canvas.drawPath(metric.extractPath(distance, end), paint);
        distance = end + gapLength;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _BlankCanvasPainter oldDelegate) =>
      oldDelegate.palette != palette;
}
