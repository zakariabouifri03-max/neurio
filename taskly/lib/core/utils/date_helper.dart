/// Week start day preference.
enum WeekStart { saturday, sunday, monday }

/// Date display format preference (US-centric but flexible).
enum AppDateFormat {
  /// Mar 9, 2026
  mdy,

  /// 9 Mar 2026
  dmy,

  /// 2026-03-09
  ymd,
}

/// Date and time helpers used across the app.
///
/// All functions work on **local** dates. Tasks store the local calendar day
/// (midnight of that day) so "today" comparisons stay correct across time
/// zones and daylight-saving changes.
abstract final class DateHelper {
  static const List<String> _monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  static const List<String> _monthNamesShort = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  /// Weekday short names indexed by DateTime.weekday (1 = Monday).
  static const List<String> _weekdayShortMonFirst = [
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri',
    'Sat',
    'Sun',
  ];

  static String monthName(int month) => _monthNames[month - 1];
  static String monthShort(int month) => _monthNamesShort[month - 1];

  /// Short weekday name (Mon..Sun) for a [DateTime].
  static String weekdayShort(DateTime date) =>
      _weekdayShortMonFirst[date.weekday - 1];

  static DateTime startOfDay(DateTime d) => DateTime(d.year, d.month, d.day);

  static bool isSameDay(DateTime? a, DateTime? b) {
    if (a == null || b == null) return false;
    return a.year == b.year && a.month == b.month && a.day == b.day;
  }

  static bool isToday(DateTime d, DateTime now) => isSameDay(d, now);

  static bool isTomorrow(DateTime d, DateTime now) =>
      isSameDay(d, now.add(const Duration(days: 1)));

  static bool isYesterday(DateTime d, DateTime now) =>
      isSameDay(d, now.subtract(const Duration(days: 1)));

  /// Combines a calendar day with a minutes-since-midnight value.
  static DateTime atMinutes(DateTime day, int? minutes) {
    if (minutes == null) return startOfDay(day);
    return DateTime(day.year, day.month, day.day, minutes ~/ 60, minutes % 60);
  }

  /// 24h minutes -> friendly 12-hour clock, e.g. 13:45 -> "1:45 PM".
  static String formatMinutes(int? minutes) {
    if (minutes == null) return 'Anytime';
    final hour = minutes ~/ 60;
    final minute = minutes % 60;
    final period = hour >= 12 ? 'PM' : 'AM';
    var display = hour % 12;
    if (display == 0) display = 12;
    final mm = minute.toString().padLeft(2, '0');
    return '$display:$mm $period';
  }

  /// Formats a date according to the user's preference.
  static String formatDate(DateTime d, AppDateFormat format) =>
      switch (format) {
        AppDateFormat.mdy => '${monthShort(d.month)} ${d.day}, ${d.year}',
        AppDateFormat.dmy => '${d.day} ${monthShort(d.month)} ${d.year}',
        AppDateFormat.ymd =>
          '${d.year.toString().padLeft(4, '0')}-'
              '${d.month.toString().padLeft(2, '0')}-'
              '${d.day.toString().padLeft(2, '0')}',
      };

  /// "Today", "Tomorrow", "Yesterday", or the preferred date format.
  static String friendlyDate(DateTime d, DateTime now, AppDateFormat format) {
    if (isToday(d, now)) return 'Today';
    if (isTomorrow(d, now)) return 'Tomorrow';
    if (isYesterday(d, now)) return 'Yesterday';
    return formatDate(d, format);
  }

  /// Number of days in a month — leap-year aware.
  static int daysInMonth(int year, int month) {
    if (month == 2) {
      final leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
      return leap ? 29 : 28;
    }
    return const [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }

  /// Adds [months] to a date, clamping the day (Jan 31 + 1 month -> Feb 28).
  static DateTime addMonths(DateTime d, int months) {
    var year = d.year + (d.month - 1 + months) ~/ 12;
    var month = (d.month - 1 + months) % 12 + 1;
    final day = d.day;
    final maxDay = daysInMonth(year, month);
    return DateTime(year, month, day > maxDay ? maxDay : day);
  }

  /// 1 = Monday ... 7 = Sunday (DateTime.weekday convention).
  static int weekdayFromName(WeekStart start) => switch (start) {
    WeekStart.monday => DateTime.monday,
    WeekStart.saturday => DateTime.saturday,
    WeekStart.sunday => DateTime.sunday,
  };

  /// Midnight of the week containing [d], given the preferred start day.
  static DateTime startOfWeek(DateTime d, WeekStart weekStart) {
    final start = startOfDay(d);
    final target = weekdayFromName(weekStart);
    // DateTime.weekday: Mon=1..Sun=7.
    final diff = (start.weekday - target) % 7;
    return start.subtract(Duration(days: diff));
  }

  /// Weekday labels in display order for the preferred start day.
  static List<String> weekdayLabels(WeekStart weekStart) {
    final start = weekdayFromName(weekStart);
    return List.generate(7, (i) => _weekdayShortMonFirst[(start - 1 + i) % 7]);
  }

  /// Offsets (in days) from the first of [month] to the first weekday cell.
  static int leadingBlanks(int year, int month, WeekStart weekStart) {
    final first = DateTime(year, month, 1);
    final target = weekdayFromName(weekStart);
    return (first.weekday - target) % 7;
  }
}
