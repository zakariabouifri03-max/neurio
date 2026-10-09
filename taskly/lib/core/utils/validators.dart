/// Friendly validation helpers for forms.
class Validators {
  const Validators._();

  static String? taskTitle(String? value) {
    final trimmed = value?.trim() ?? '';
    if (trimmed.isEmpty) {
      return 'Please give your task a little name.';
    }
    if (trimmed.length > 120) {
      return 'Keep it under 120 characters so it stays readable.';
    }
    return null;
  }

  static String? preferredName(String? value) {
    final trimmed = value?.trim() ?? '';
    if (trimmed.isEmpty) return null; // optional field
    if (trimmed.length > 30) {
      return 'That is a lovely name, but 30 characters is the maximum.';
    }
    return null;
  }
}
