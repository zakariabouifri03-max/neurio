import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';
import '../core/utils/motion.dart';
import '../domain/task_statistics.dart';
import '../data/models/task_category.dart';

/// Weekly completion bar chart drawn with CustomPaint — lightweight,
/// theme aware and labeled for accessibility.
class WeeklyBarChart extends StatelessWidget {
  const WeeklyBarChart({super.key, required this.points, this.height = 150});

  final List<WeekPoint> points;
  final double height;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final today = DateTime.now();
    final maxCount = points.fold<int>(1, (m, p) => p.count > m ? p.count : m);
    return Semantics(
      label: 'Completions for the last 7 days: '
          '${points.map((p) => '${p.shortLabel} ${p.count}').join(', ')}',
      child: SizedBox(
        height: height,
        child: CustomPaint(
          painter: _BarPainter(
            points: points,
            maxCount: maxCount,
            barColor: palette.lavender,
            todayColor: Theme.of(context).colorScheme.primary,
            labelColor: palette.textSecondary,
            trackColor: palette.border,
            todayIndex: points.indexWhere((p) =>
                p.day.year == today.year &&
                p.day.month == today.month &&
                p.day.day == today.day),
          ),
          size: Size.infinite,
        ),
      ),
    );
  }
}

class _BarPainter extends CustomPainter {
  _BarPainter({
    required this.points,
    required this.maxCount,
    required this.barColor,
    required this.todayColor,
    required this.labelColor,
    required this.trackColor,
    required this.todayIndex,
  });

  final List<WeekPoint> points;
  final int maxCount;
  final Color barColor;
  final Color todayColor;
  final Color labelColor;
  final Color trackColor;
  final int todayIndex;

  @override
  void paint(Canvas canvas, Size size) {
    if (points.isEmpty) return;
    final labelSpace = 20.0;
    final chartHeight = size.height - labelSpace;
    final slot = size.width / points.length;
    final barWidth = slot * 0.46;
    final text = TextPainter(textAlign: TextAlign.center)
      ..textDirection = TextDirection.ltr;

    for (var i = 0; i < points.length; i++) {
      final point = points[i];
      final center = slot * i + slot / 2;
      final fullHeight = chartHeight - 8;
      final trackRect = RRect.fromRectAndRadius(
        Rect.fromLTWH(center - barWidth / 2, 4, barWidth, fullHeight),
        Radius.circular(barWidth / 2),
      );
      canvas.drawRRect(trackRect, Paint()..color = trackColor.withValues(alpha: 0.55));

      final valueHeight =
          point.count == 0 ? 0.0 : (point.count / maxCount) * fullHeight;
      if (valueHeight > 0) {
        final valueRect = RRect.fromRectAndRadius(
          Rect.fromLTWH(
              center - barWidth / 2,
              4 + fullHeight - valueHeight,
              barWidth,
              valueHeight),
          Radius.circular(barWidth / 2),
        );
        canvas.drawRRect(
            valueRect, Paint()..color = i == todayIndex ? todayColor : barColor);
      }

      text.text = TextSpan(
        text: point.shortLabel,
        style: TextStyle(
            color: labelColor, fontSize: 10.5, fontWeight: FontWeight.w600),
      );
      text.layout();
      text.paint(canvas,
          Offset(center - text.width / 2, chartHeight + 4));
    }
  }

  @override
  bool shouldRepaint(_BarPainter oldDelegate) =>
      oldDelegate.points != points || oldDelegate.maxCount != maxCount;
}

/// Horizontal category breakdown bars with real counts.
class CategoryBreakdownBars extends StatelessWidget {
  const CategoryBreakdownBars(
      {super.key, required this.breakdown, required this.total});

  final Map<TaskCategory, int> breakdown;
  final int total;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    if (breakdown.isEmpty || total == 0) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(
          'Complete a few tasks to see your category mix.',
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: palette.textSecondary),
        ),
      );
    }
    return Column(
      children: <Widget>[
        for (final entry in breakdown.entries)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(
              children: <Widget>[
                Icon(entry.key.icon, size: 16, color: entry.key.foreground),
                const SizedBox(width: 8),
                SizedBox(
                  width: 78,
                  child: Text(entry.key.label,
                      style: Theme.of(context).textTheme.labelMedium),
                ),
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: TweenAnimationBuilder<double>(
                      tween: Tween<double>(
                          begin: 0, end: entry.value / total),
                      duration: AppMotion.resolve(context, AppMotion.slow),
                      curve: AppMotion.curve,
                      builder: (context, value, _) => LinearProgressIndicator(
                        value: value,
                        minHeight: 10,
                        backgroundColor: palette.border,
                        valueColor:
                            AlwaysStoppedAnimation<Color>(entry.key.background),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Text('${entry.value}',
                    style: Theme.of(context).textTheme.labelMedium),
              ],
            ),
          ),
      ],
    );
  }
}
