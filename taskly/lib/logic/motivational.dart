import '../logic/stats_calculator.dart';

/// Tiny pool of encouraging lines. Deterministic per progress so the app
/// never lies: 0 of 0 shows a "blank canvas" mood instead of a fake win.
abstract final class Motivational {
  static const List<String> _empty = [
    'Your day is a blank canvas. ✨',
    'A fresh page, ready for little wins.',
  ];

  static const List<String> _started = [
    'One step at a time.',
    'Every little win counts.',
    'Look at you making progress!',
  ];

  static const List<String> _mostly = [
    'So close — keep going!',
    'You\'re doing amazing!',
  ];

  static const List<String> _allDone = [
    'All done for today. Dreamy! 💜',
    'Everything\'s checked off. Enjoy it!',
  ];

  static String pick(DailyProgress progress, DateTime now) {
    final List<String> pool;
    if (progress.total == 0 && progress.completed == 0) {
      pool = _empty;
    } else if (progress.isAllDone) {
      pool = _allDone;
    } else if (progress.ratio >= 0.5) {
      pool = _mostly;
    } else {
      pool = _started;
    }
    // Stable within an hour so the line doesn't flicker on rebuilds.
    final seed = now.hour + progress.completed * 7 + progress.total;
    return pool[seed % pool.length];
  }
}
