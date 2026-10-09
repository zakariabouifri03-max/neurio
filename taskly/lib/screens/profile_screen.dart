import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';

import '../core/theme/app_theme.dart';
import '../core/utils/date_utils.dart' as taskly;
import '../core/utils/validators.dart';
import '../state/settings_store.dart';
import '../widgets/cute_card.dart';
import 'app_info_screen.dart';
import 'notification_settings_screen.dart';
import 'stats_screen.dart';

/// Profile & settings: every row does something real.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  String _versionLabel = '1.0.0';

  @override
  void initState() {
    super.initState();
    _loadVersion();
  }

  Future<void> _loadVersion() async {
    try {
      final info = await PackageInfo.fromPlatform();
      if (!mounted) return;
      setState(() => _versionLabel = '${info.version} (${info.buildNumber})');
    } catch (_) {
      // Keep the fallback label from pubspec.
    }
  }

  Future<void> _editName() async {
    final settings = context.read<SettingsStore>();
    final controller = TextEditingController(text: settings.preferredName);
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) {
        return Dialog(
          backgroundColor: AppTheme.paletteOf(context).card,
          surfaceTintColor: Colors.transparent,
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppTheme.radiusCard)),
          child: Padding(
            padding: const EdgeInsets.all(22),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text('What should we call you?',
                    style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 14),
                TextField(
                  controller: controller,
                  autofocus: true,
                  maxLength: 30,
                  decoration: const InputDecoration(
                    hintText: 'Your name (optional)',
                    counterText: '',
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: TextButton(
                        onPressed: () => Navigator.of(context).pop(false),
                        child: const Text('Cancel'),
                      ),
                    ),
                    Expanded(
                      child: FilledButton(
                        onPressed: () => Navigator.of(context).pop(true),
                        child: const Text('Save'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
    if (saved == true) {
      final error = Validators.preferredName(controller.text);
      if (error == null) {
        await settings.setPreferredName(controller.text);
      } else if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error)));
      }
    }
    controller.dispose();
  }

  Future<void> _chooseTheme() async {
    final settings = context.read<SettingsStore>();
    final result = await showDialog<ThemeMode>(
      context: context,
      builder: (context) => SimpleDialog(
        backgroundColor: AppTheme.paletteOf(context).card,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusCard)),
        title: const Text('Appearance'),
        children: <Widget>[
          for (final mode in ThemeMode.values)
            RadioListTile<ThemeMode>(
              value: mode,
              groupValue: settings.themeMode,
              title: Text(_themeLabel(mode)),
              onChanged: (v) => Navigator.of(context).pop(v),
            ),
        ],
      ),
    );
    if (result != null) await settings.setThemeMode(result);
  }

  String _themeLabel(ThemeMode mode) {
    switch (mode) {
      case ThemeMode.light:
        return 'Light';
      case ThemeMode.dark:
        return 'Dark';
      case ThemeMode.system:
        return 'System default';
    }
  }

  Future<void> _chooseWeekStart() async {
    final settings = context.read<SettingsStore>();
    final result = await showDialog<taskly.WeekStart>(
      context: context,
      builder: (context) => SimpleDialog(
        backgroundColor: AppTheme.paletteOf(context).card,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusCard)),
        title: const Text('Week starts on'),
        children: <Widget>[
          for (final weekStart in taskly.WeekStart.values)
            RadioListTile<taskly.WeekStart>(
              value: weekStart,
              groupValue: settings.weekStart,
              title: Text(weekStart.label),
              onChanged: (v) => Navigator.of(context).pop(v),
            ),
        ],
      ),
    );
    if (result != null) await settings.setWeekStart(result);
  }

  Future<void> _chooseDateFormat() async {
    final settings = context.read<SettingsStore>();
    final result = await showDialog<taskly.DateFormatPref>(
      context: context,
      builder: (context) => SimpleDialog(
        backgroundColor: AppTheme.paletteOf(context).card,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusCard)),
        title: const Text('Date format'),
        children: <Widget>[
          for (final format in taskly.DateFormatPref.values)
            RadioListTile<taskly.DateFormatPref>(
              value: format,
              groupValue: settings.dateFormat,
              title: Text(format.label),
              onChanged: (v) => Navigator.of(context).pop(v),
            ),
        ],
      ),
    );
    if (result != null) await settings.setDateFormat(result);
  }

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final theme = Theme.of(context);
    final settings = context.watch<SettingsStore>();
    final initial = settings.greetingName.isEmpty
        ? '✨'
        : settings.greetingName[0].toUpperCase();

    return Scaffold(
      backgroundColor: palette.cream,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
          children: <Widget>[
            Row(
              children: <Widget>[
                Container(
                  width: 62,
                  height: 62,
                  decoration: BoxDecoration(
                    color: palette.lavender,
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: Text(initial,
                        style: theme.textTheme.headlineSmall
                            ?.copyWith(color: const Color(0xFF4A3A8C))),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        settings.greetingName.isEmpty
                            ? 'Hey, superstar'
                            : settings.greetingName,
                        style: theme.textTheme.headlineSmall,
                      ),
                      const SizedBox(height: 2),
                      Text('Local planner · no account needed',
                          style: theme.textTheme.bodySmall),
                    ],
                  ),
                ),
                TextButton(onPressed: _editName, child: const Text('Edit')),
              ],
            ),
            const SizedBox(height: 18),
            CuteCard(
              padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
              child: Column(
                children: <Widget>[
                  _SettingsTile(
                    icon: Icons.palette_outlined,
                    title: 'Appearance',
                    subtitle: _themeLabel(settings.themeMode),
                    onTap: _chooseTheme,
                  ),
                  _SettingsTile(
                    icon: Icons.notifications_outlined,
                    title: 'Notifications & reminders',
                    subtitle: settings.remindersEnabled
                        ? 'Reminders on'
                        : 'Reminders off',
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                          builder: (_) => const NotificationSettingsScreen()),
                    ),
                  ),
                  _SettingsTile(
                    icon: Icons.calendar_today_outlined,
                    title: 'Week starts on',
                    subtitle: settings.weekStart.label,
                    onTap: _chooseWeekStart,
                  ),
                  _SettingsTile(
                    icon: Icons.date_range_outlined,
                    title: 'Date format',
                    subtitle: settings.dateFormat.label,
                    onTap: _chooseDateFormat,
                    last: true,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            CuteCard(
              padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
              child: Column(
                children: <Widget>[
                  _SettingsTile(
                    icon: Icons.insights_outlined,
                    title: 'Your progress',
                    subtitle: 'Stats and weekly chart',
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                          builder: (_) => const StatsScreen()),
                    ),
                  ),
                  _SettingsTile(
                    icon: Icons.privacy_tip_outlined,
                    title: 'Privacy & app info',
                    subtitle: 'Policy, licenses and version',
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                          builder: (_) => const AppInfoScreen()),
                    ),
                    last: true,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            Center(
              child: Text('Taskly $_versionLabel',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: palette.textSecondary)),
            ),
            const SizedBox(height: 4),
            Center(
              child: Text('Made with care for calm, colorful days.',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: palette.textSecondary)),
            ),
          ],
        ),
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.last = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final theme = Theme.of(context);
    return Column(
      children: <Widget>[
        InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: Padding(
            padding:
                const EdgeInsets.symmetric(vertical: 13, horizontal: 10),
            child: Row(
              children: <Widget>[
                Icon(icon, size: 21, color: theme.colorScheme.primary),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(title, style: theme.textTheme.titleMedium),
                      const SizedBox(height: 2),
                      Text(subtitle, style: theme.textTheme.bodySmall),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right_rounded,
                    color: palette.textSecondary, size: 20),
              ],
            ),
          ),
        ),
        if (!last) Divider(height: 1, color: palette.border),
      ],
    );
  }
}
