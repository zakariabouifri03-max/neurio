import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';

import '../controllers/settings_controller.dart';
import '../controllers/task_controller.dart';
import '../core/theme/app_colors.dart';
import '../core/utils/date_helper.dart';
import '../notifications/reminder_scheduler.dart';
import 'privacy_policy_page.dart';

/// Profile & settings: personalization, notifications, about.
class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key});

  Future<void> _editName(
    BuildContext context,
    SettingsController settings,
  ) async {
    final controller = TextEditingController(text: settings.preferredName);
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('What should Taskly call you?'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 30,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(
            hintText: 'e.g. Alex',
            counterText: '',
          ),
          onSubmitted: (value) => Navigator.of(context).pop(value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (name != null) await settings.setPreferredName(name);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final settings = context.watch<SettingsController>();
    final tasks = context.watch<TaskController>();

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 32),
          children: [
            // ---- Identity ----
            Card(
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: AppColors.lavender,
                  child: Text(
                    settings.preferredName.isEmpty
                        ? '🌟'
                        : settings.preferredName.characters.first.toUpperCase(),
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                title: Text(
                  settings.preferredName.isEmpty
                      ? 'Anonymous superstar'
                      : settings.preferredName,
                ),
                subtitle: Text(
                  '${tasks.totalCompleted} tasks completed so far',
                ),
                trailing: const Icon(Icons.edit_outlined, size: 19),
                onTap: () => _editName(context, settings),
              ),
            ),
            const SizedBox(height: 20),
            Text('Appearance', style: theme.textTheme.labelLarge),
            const SizedBox(height: 8),
            Card(
              child: RadioGroup<ThemeMode>(
                groupValue: settings.themeMode,
                onChanged: (value) {
                  if (value != null) settings.setThemeMode(value);
                },
                child: Column(
                  children: [
                    for (final mode in ThemeMode.values)
                      RadioListTile<ThemeMode>(
                        value: mode,
                        title: Text(switch (mode) {
                          ThemeMode.system => 'Match system',
                          ThemeMode.light => 'Light',
                          ThemeMode.dark => 'Dark',
                        }),
                        secondary: Icon(switch (mode) {
                          ThemeMode.system => Icons.brightness_auto_outlined,
                          ThemeMode.light => Icons.light_mode_outlined,
                          ThemeMode.dark => Icons.dark_mode_outlined,
                        }),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            Text('Reminders', style: theme.textTheme.labelLarge),
            const SizedBox(height: 8),
            _RemindersCard(settings: settings),
            const SizedBox(height: 20),
            Text('Format', style: theme.textTheme.labelLarge),
            const SizedBox(height: 8),
            Card(
              child: Column(
                children: [
                  ListTile(
                    title: const Text('Start of week'),
                    subtitle: Text(switch (settings.weekStart) {
                      WeekStart.saturday => 'Saturday',
                      WeekStart.sunday => 'Sunday',
                      WeekStart.monday => 'Monday',
                    }),
                    trailing: DropdownButton<WeekStart>(
                      value: settings.weekStart,
                      underline: const SizedBox.shrink(),
                      items: [
                        for (final w in WeekStart.values)
                          DropdownMenuItem(
                            value: w,
                            child: Text(switch (w) {
                              WeekStart.saturday => 'Saturday',
                              WeekStart.sunday => 'Sunday',
                              WeekStart.monday => 'Monday',
                            }),
                          ),
                      ],
                      onChanged: (value) {
                        if (value != null) settings.setWeekStart(value);
                      },
                    ),
                  ),
                  Divider(color: theme.colorScheme.outline, height: 1),
                  ListTile(
                    title: const Text('Date format'),
                    subtitle: Text(switch (settings.dateFormat) {
                      AppDateFormat.mdy => 'Mar 9, 2026',
                      AppDateFormat.dmy => '9 Mar 2026',
                      AppDateFormat.ymd => '2026-03-09',
                    }),
                    trailing: DropdownButton<AppDateFormat>(
                      value: settings.dateFormat,
                      underline: const SizedBox.shrink(),
                      items: [
                        for (final f in AppDateFormat.values)
                          DropdownMenuItem(
                            value: f,
                            child: Text(switch (f) {
                              AppDateFormat.mdy => 'Mar 9, 2026',
                              AppDateFormat.dmy => '9 Mar 2026',
                              AppDateFormat.ymd => '2026-03-09',
                            }),
                          ),
                      ],
                      onChanged: (value) {
                        if (value != null) settings.setDateFormat(value);
                      },
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            Text('About', style: theme.textTheme.labelLarge),
            const SizedBox(height: 8),
            Card(
              child: Column(
                children: [
                  const _VersionTile(),
                  Divider(color: theme.colorScheme.outline, height: 1),
                  ListTile(
                    leading: const Icon(Icons.privacy_tip_outlined),
                    title: const Text('Privacy policy'),
                    subtitle: const Text('Your tasks stay on your device'),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const PrivacyPolicyPage(),
                      ),
                    ),
                  ),
                  Divider(color: theme.colorScheme.outline, height: 1),
                  ListTile(
                    leading: const Icon(Icons.source_outlined),
                    title: const Text('Open-source licenses'),
                    onTap: () => showLicensePage(
                      context: context,
                      applicationName: 'Taskly',
                      applicationIcon: _AppIcon(),
                    ),
                  ),
                  Divider(color: theme.colorScheme.outline, height: 1),
                  const ListTile(
                    leading: Icon(Icons.favorite_outline_rounded),
                    title: Text('About Taskly'),
                    subtitle: Text(
                      'A cute, cozy planner for little daily wins. '
                      'No account needed — your tasks stay with you.',
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            Text('Danger zone', style: theme.textTheme.labelLarge),
            const SizedBox(height: 8),
            Card(
              child: ListTile(
                leading: Icon(
                  Icons.delete_sweep_outlined,
                  color: theme.colorScheme.error,
                ),
                title: Text(
                  'Delete all tasks',
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: theme.colorScheme.error,
                  ),
                ),
                subtitle: const Text('Everything, gone. Double-checked.'),
                onTap: () => _deleteAll(context),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _deleteAll(BuildContext context) async {
    // Two confirmations for something this destructive.
    final first = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete ALL tasks?'),
        content: const Text(
          'Every task, completed or not, will be permanently removed.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
    if (first != true) return;
    if (!context.mounted) return;

    final second = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        icon: const Icon(Icons.warning_amber_rounded),
        title: const Text('Really sure?'),
        content: const Text('This is the last check — there is no undo.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep my tasks'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete everything'),
          ),
        ],
      ),
    );
    if (second != true) return;
    if (!context.mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    await context.read<TaskController>().deleteAllTasks();
    messenger.showSnackBar(
      const SnackBar(content: Text('All tasks deleted. Fresh start!')),
    );
  }
}

class _RemindersCard extends StatefulWidget {
  const _RemindersCard({required this.settings});

  final SettingsController settings;

  @override
  State<_RemindersCard> createState() => _RemindersCardState();
}

class _RemindersCardState extends State<_RemindersCard> {
  ReminderDiagnostics? _diagnostics;
  bool _checking = true;

  @override
  void initState() {
    super.initState();
    _refreshDiagnostics();
  }

  Future<void> _refreshDiagnostics() async {
    final scheduler = context.read<ReminderScheduler>();
    final result = await scheduler.diagnostics();
    if (mounted) {
      setState(() {
        _diagnostics = result;
        _checking = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final diagnostics = _diagnostics;
    final remindersOn = widget.settings.remindersEnabled;

    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Column(
          children: [
            SwitchListTile.adaptive(
              title: const Text('Task reminders'),
              subtitle: const Text('Nudges for tasks you set a reminder on'),
              value: remindersOn,
              onChanged: (value) async {
                await widget.settings.setRemindersEnabled(value);
                if (!mounted) return;
                // Re-sync existing alarms to match the new preference.
                final tasks = context.read<TaskController>();
                await tasks.resyncReminders();
              },
            ),
            Divider(color: theme.colorScheme.outline, height: 1),
            if (_checking)
              const Padding(
                padding: EdgeInsets.all(14),
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              )
            else ...[
              ListTile(
                leading: Icon(
                  diagnostics!.notificationsEnabled
                      ? Icons.notifications_active_outlined
                      : Icons.notifications_off_outlined,
                  color: diagnostics.notificationsEnabled
                      ? AppColors.mintDeep
                      : theme.colorScheme.error,
                ),
                title: Text(
                  diagnostics.notificationsEnabled
                      ? 'Notifications are enabled'
                      : 'Notifications are turned off',
                ),
                subtitle: Text(
                  diagnostics.notificationsEnabled
                      ? 'Reminders will show up here'
                      : 'Allow notifications for Taskly in system settings',
                ),
                trailing: diagnostics.notificationsEnabled
                    ? null
                    : TextButton(
                        onPressed: () => context
                            .read<ReminderScheduler>()
                            .openNotificationSettings(),
                        child: const Text('Fix'),
                      ),
              ),
              if (!diagnostics.exactAlarmsAllowed)
                ListTile(
                  leading: Icon(
                    Icons.schedule_rounded,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  title: const Text('Exact timing unavailable'),
                  subtitle: const Text(
                    'Reminders still work, but Android may delay them by a '
                    'few minutes. Allow exact alarms for best timing.',
                  ),
                  trailing: TextButton(
                    onPressed: () =>
                        context.read<ReminderScheduler>().requestExactAlarms(),
                    child: const Text('Allow'),
                  ),
                ),
            ],
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: Text(
                'Heads up: Android battery optimization can delay reminders '
                'on some devices. Taskly always re-schedules them after a '
                'restart.',
                style: theme.textTheme.bodySmall,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _VersionTile extends StatefulWidget {
  const _VersionTile();

  @override
  State<_VersionTile> createState() => _VersionTileState();
}

class _VersionTileState extends State<_VersionTile> {
  String _version = '…';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final info = await PackageInfo.fromPlatform();
    if (mounted) {
      setState(() => _version = '${info.version} (${info.buildNumber})');
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const Icon(Icons.info_outline_rounded),
      title: const Text('Version'),
      subtitle: Text(_version),
    );
  }
}

class _AppIcon extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 64,
      height: 64,
      decoration: BoxDecoration(
        color: AppColors.lavender,
        borderRadius: BorderRadius.circular(18),
      ),
      child: const Icon(
        Icons.task_alt_rounded,
        size: 34,
        color: AppColors.primaryText,
      ),
    );
  }
}
