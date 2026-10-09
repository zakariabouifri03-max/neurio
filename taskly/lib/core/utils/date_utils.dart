import 'package:intl/intl.dart';

/// Week-start preference for the calendar and weekly statistics.
enum WeekStart { system, monday, sunday }

extension WeekStartX on WeekStart {
  String get label {
    switch (this) {
      case WeekStart.system:
        return 'Device default';
      case WeekStart.monday:
        return 'Monday';
      case WeekStart.sunday:
        return 'Sunday';
    }
  }

  /// Weekday (DateTime.monday == 1 … DateTime.sunday == 7) that weeks start on.
  /// `system` follows the active locale (US → Sunday, most of EU → Monday).
  int firstWeekday([String? locale]) {
    switch (this) {
      case WeekStart.monday:
        return DateTime.monday;
      case WeekStart.sunday:
        return DateTime.sunday;
      case WeekStart.system:
        // intl does not expose locale week-start directly, so common
        // Sunday-first locales are listed explicitly.
        final loc = locale ?? 'en_US';
        const sundayLocales = <String>{
          'en_US', 'en_CA', 'ja_JP', 'ko_KR', 'zh_CN', 'zh_TW', 'pt_BR', 'he_IL'
        };
        return sundayLocales.contains(loc)
            ? DateTime.sunday
            : DateTime.monday;
    }
  }
}

/// User-selectable display formats for dates.
enum DateFormatPref { usLong, usNumeric, dayMonthYear }

extension DateFormatPrefX on DateFormatPref {
  String get label {
    switch (this) {
      case DateFormatPref.usLong:
        return 'Mar 5, 2026';
      case DateFormatPref.usNumeric:
        return '03/05/2026';
      case DateFormatPref.dayMonthYear:
        return '5 Mar 2026';
    }
  }

  String get _pattern {
    switch (this) {
      case DateFormatPref.usLong:
        return 'MMM d, yyyy';
      case DateFormatPref.usNumeric:
        return 'MM/dd/yyyy';
      case DateFormatPref.dayMonthYear:
        return 'd MMM yyyy';
    }
  }

  String format(DateTime date) => DateFormat(_pattern).format(date);

  String formatWithWeekday(DateTime date) =>
      DateFormat('EEE, $_pattern').format(date);
}

/// Date helpers shared across the app. All of them work with *local* dates.
class TasklyDates {
  const TasklyDates._();

  static DateTime dayOnly(DateTime date) =>
      DateTime(date.year, date.month, date.day);

  static bool isSameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  /// First day of the week containing [date].
  static DateTime startOfWeek(DateTime date, int firstWeekday) {
    final day = dayOnly(date);
    final delta = (day.weekday - firstWeekday) % 7;
    return day.subtract(Duration(days: delta < 0 ? delta + 7 : delta));
  }

  /// Ordered list of the 7 days of the week containing [date].
  static List<DateTime> weekDays(DateTime date, int firstWeekday) {
    final start = startOfWeek(date, firstWeekday);
    return List<DateTime>.generate(
        7, (i) => start.add(Duration(days: i)),
        growable: false);
  }

  /// Grid of days for a month view: always full weeks (6 rows max).
  static List<DateTime> monthGrid(DateTime month, int firstWeekday) {
    final first = DateTime(month.year, month.month, 1);
    final start = startOfWeek(first, firstWeekday);
    final daysInMonth = DateTime(month.year, month.month + 1, 0).day;
    final last = DateTime(month.year, month.month, daysInMonth);
    final endOfWeek = startOfWeek(last, firstWeekday).add(const Duration(days: 6));
    final count = endOfWeek.difference(start).inDays + 1;
    return List<DateTime>.generate(count, (i) => start.add(Duration(days: i)),
        growable: false);
  }

  static String encodeTime(int hour, int minute) =>
      '${hour.toString().padLeft(2, '0')}:${minute.toString().padLeft(2, '0')}';

  /// "3:45 PM" (or 24h when [use24Hour] is set).
  static String formatTime(String hhmm, {bool use24Hour = false}) {
    final parts = hhmm.split(':');
    final hour = int.tryParse(parts.first) ?? 0;
    final minute = int.tryParse(parts.length > 1 ? parts[1] : '') ?? 0;
    if (use24Hour) return encodeTime(hour, minute);
    final suffix = hour < 12 ? 'AM' : 'PM';
    final displayHour = hour % 12 == 0 ? 12 : hour % 12;
    return '$displayHour:${minute.toString().padLeft(2, '0')} $suffix';
  }

  /// Friendly relative label: Today / Tomorrow / Yesterday / weekday name.
  static String relativeDayLabel(DateTime date, DateTime now) {
    final day = dayOnly(date);
    final today = dayOnly(now);
    final diff = day.difference(today).inDays;
    if (diff == 0) return 'Today';
    if (diff == 1) return 'Tomorrow';
    if (diff == -1) return 'Yesterday';
    return DateFormat('EEEE').format(date);
  }
}
