import 'package:flutter/material.dart';

import 'client.dart';
import 'screens/intake_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeClient();
  runApp(const NyayApp());
}

/// NyaySaathi — a confidential first step for someone in India with a legal
/// problem and no lawyer.
///
/// One flow, on purpose: say what happened, answer what the server asks, read a
/// plan that shows where each line came from.
class NyayApp extends StatelessWidget {
  const NyayApp({super.key});

  @override
  Widget build(BuildContext context) {
    ThemeData theme(Brightness brightness, Color seed, Color background) => ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: seed, brightness: brightness),
          useMaterial3: true,
          scaffoldBackgroundColor: background,
          visualDensity: VisualDensity.comfortable,
          inputDecorationTheme: const InputDecorationTheme(
            border: OutlineInputBorder(),
            isDense: true,
          ),
        );

    return MaterialApp(
      title: 'NyaySaathi',
      debugShowCheckedModeBanner: false,
      theme: theme(Brightness.light, const Color(0xFF1B5E4B), const Color(0xFFF7F6F2)),
      darkTheme: theme(Brightness.dark, const Color(0xFF6FD3B4), const Color(0xFF121815)),
      themeMode: ThemeMode.system,
      home: const IntakeScreen(),
    );
  }
}
