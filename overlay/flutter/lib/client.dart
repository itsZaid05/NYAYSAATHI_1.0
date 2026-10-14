import 'package:nyay_client/nyay_client.dart';
import 'package:serverpod_flutter/serverpod_flutter.dart';

/// One client for the whole app.
///
/// Every read and write in the UI goes through it, which is what makes the server
/// the single source of truth: a reload re-queries, it does not re-generate. The
/// URL comes from `--dart-define=SERVER_URL` or `assets/config.json`, so the same
/// build can point at a laptop or at a deployment.
late final Client client;

Future<void> initializeClient() async {
  client = Client(await getServerUrl())
    ..connectivityMonitor = FlutterConnectivityMonitor();
}
