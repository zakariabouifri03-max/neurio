import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../controllers/settings_controller.dart';
import '../controllers/task_controller.dart';
import '../core/theme/app_theme.dart';
import '../notifications/notification_service.dart';
import '../pages/splash_page.dart';
import '../pages/task_detail_page.dart';
import 'routes.dart';

/// Root widget: providers, themes, routing and notification-tap handling.
class TasklyApp extends StatefulWidget {
  const TasklyApp({super.key});

  @override
  State<TasklyApp> createState() => _TasklyAppState();
}

class _TasklyAppState extends State<TasklyApp> {
  final GlobalKey<NavigatorState> _navigatorKey = GlobalKey<NavigatorState>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _listenForTaps());
  }

  /// Opens the relevant task when the user taps a reminder notification.
  void _listenForTaps() {
    final service = context.read<NotificationService>();
    service.lastTapPayload.addListener(_onNotificationTap);
  }

  Future<void> _onNotificationTap() async {
    final service = context.read<NotificationService>();
    final payload = service.lastTapPayload.value;
    if (payload == null) return;
    service.lastTapPayload.value = null;

    final id = int.tryParse(payload.substring('task:'.length));
    if (id == null) return;

    if (!mounted) return;
    final controller = context.read<TaskController>();
    final task = controller.byId(id) ?? await controller.refreshAndFind(id);

    final navigator = _navigatorKey.currentState;
    if (task != null && navigator != null) {
      navigator.push(
        fadeSlideRoute<void>(builder: (_) => TaskDetailPage(taskId: task.id)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<SettingsController>();
    return MaterialApp(
      title: 'Taskly',
      debugShowCheckedModeBanner: false,
      navigatorKey: _navigatorKey,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: settings.themeMode,
      home: const SplashPage(),
    );
  }
}
