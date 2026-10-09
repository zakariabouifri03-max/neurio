import 'package:flutter_test/flutter_test.dart';

import 'package:taskly/core/utils/date_helper.dart';

void main() {
  group('DateHelper basics', () {
    test('startOfDay strips the time', () {
      expect(
        DateHelper.startOfDay(DateTime(2026, 4, 12, 18, 30, 12)),
        DateTime(2026, 4, 12),
      );
    });

    test('isSameDay compares calendar days only', () {
      final a = DateTime(2026, 1, 31, 23, 59);
      final b = DateTime(2026, 1, 31, 0, 0);
      expect(DateHelper.isSameDay(a, b), isTrue);
      expect(DateHelper.isSameDay(a, DateTime(2026, 2, 1)), isFalse);
      expect(DateHelper.isSameDay(null, b), isFalse);
    });

    test('friendly day labels', () {
      final now = DateTime(2026, 6, 15);
      expect(DateHelper.isToday(DateTime(2026, 6, 15), now), isTrue);
      expect(DateHelper.isTomorrow(DateTime(2026, 6, 16), now), isTrue);
      expect(DateHelper.isYesterday(DateTime(2026, 6, 14), now), isTrue);
    });

    test('formatMinutes renders a 12-hour clock', () {
      expect(DateHelper.formatMinutes(null), 'Anytime');
      expect(DateHelper.formatMinutes(0), '12:00 AM');
      expect(DateHelper.formatMinutes(9 * 60 + 5), '9:05 AM');
      expect(DateHelper.formatMinutes(12 * 60), '12:00 PM');
      expect(DateHelper.formatMinutes(13 * 60 + 45), '1:45 PM');
      expect(DateHelper.formatMinutes(23 * 60 + 59), '11:59 PM');
    });
  });

  group('DateHelper formats', () {
    final date = DateTime(2026, 3, 9);
    test('mdy / dmy / ymd', () {
      expect(DateHelper.formatDate(date, AppDateFormat.mdy), 'Mar 9, 2026');
      expect(DateHelper.formatDate(date, AppDateFormat.dmy), '9 Mar 2026');
      expect(DateHelper.formatDate(date, AppDateFormat.ymd), '2026-03-09');
    });

    test('friendlyDate prefers relative words', () {
      final now = DateTime(2026, 3, 9);
      expect(
        DateHelper.friendlyDate(DateTime(2026, 3, 9), now, AppDateFormat.mdy),
        'Today',
      );
      expect(
        DateHelper.friendlyDate(DateTime(2026, 3, 10), now, AppDateFormat.mdy),
        'Tomorrow',
      );
      expect(
        DateHelper.friendlyDate(DateTime(2026, 3, 8), now, AppDateFormat.mdy),
        'Yesterday',
      );
      expect(
        DateHelper.friendlyDate(DateTime(2026, 3, 1), now, AppDateFormat.ymd),
        '2026-03-01',
      );
    });
  });

  group('DateHelper month math', () {
    test('daysInMonth is leap-year aware', () {
      expect(DateHelper.daysInMonth(2026, 2), 28);
      expect(DateHelper.daysInMonth(2028, 2), 29);
      expect(DateHelper.daysInMonth(2000, 2), 29); // 400-year rule
      expect(DateHelper.daysInMonth(1900, 2), 28); // 100-year rule
      expect(DateHelper.daysInMonth(2026, 7), 31);
      expect(DateHelper.daysInMonth(2026, 4), 30);
    });

    test('addMonths clamps overflow days', () {
      expect(
        DateHelper.addMonths(DateTime(2026, 1, 31), 1),
        DateTime(2026, 2, 28),
      );
      expect(
        DateHelper.addMonths(DateTime(2028, 1, 31), 1),
        DateTime(2028, 2, 29),
      );
      expect(
        DateHelper.addMonths(DateTime(2026, 3, 15), -1),
        DateTime(2026, 2, 15),
      );
      expect(
        DateHelper.addMonths(DateTime(2026, 11, 20), 3),
        DateTime(2027, 2, 20),
      );
    });
  });

  group('DateHelper weeks', () {
    test('startOfWeek honors Sunday start', () {
      // Oct 7, 2026 is a Wednesday. Week starting Sunday = Oct 4.
      expect(
        DateHelper.startOfWeek(DateTime(2026, 10, 7), WeekStart.sunday),
        DateTime(2026, 10, 4),
      );
    });

    test('startOfWeek honors Monday start', () {
      expect(
        DateHelper.startOfWeek(DateTime(2026, 10, 7), WeekStart.monday),
        DateTime(2026, 10, 5),
      );
    });

    test('startOfWeek honors Saturday start', () {
      expect(
        DateHelper.startOfWeek(DateTime(2026, 10, 7), WeekStart.saturday),
        DateTime(2026, 10, 3),
      );
      // Saturday itself starts its own week.
      expect(
        DateHelper.startOfWeek(DateTime(2026, 10, 3), WeekStart.saturday),
        DateTime(2026, 10, 3),
      );
    });

    test('weekdayLabels order matches the chosen start', () {
      expect(DateHelper.weekdayLabels(WeekStart.sunday), [
        'Sun',
        'Mon',
        'Tue',
        'Wed',
        'Thu',
        'Fri',
        'Sat',
      ]);
      expect(DateHelper.weekdayLabels(WeekStart.monday), [
        'Mon',
        'Tue',
        'Wed',
        'Thu',
        'Fri',
        'Sat',
        'Sun',
      ]);
    });

    test('leadingBlanks aligns the grid', () {
      // March 2026 starts on a Sunday.
      expect(DateHelper.leadingBlanks(2026, 3, WeekStart.sunday), 0);
      expect(DateHelper.leadingBlanks(2026, 3, WeekStart.monday), 6);
      // October 2026 starts on a Thursday.
      expect(DateHelper.leadingBlanks(2026, 10, WeekStart.sunday), 4);
    });

    test('calendar math across a leap February', () {
      final grid =
          DateHelper.leadingBlanks(2028, 2, WeekStart.monday) +
          DateHelper.daysInMonth(2028, 2);
      expect((grid / 7).ceil(), 5, reason: 'Feb 2028 fits in 5 week rows');
    });
  });
}
