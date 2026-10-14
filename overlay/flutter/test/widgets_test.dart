import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nyay_flutter/widgets.dart';

void main() {
  testWidgets('sample provenance is visible without a model', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(body: ModelNotice(model: null, promptVersion: 'v2')),
    ));
    expect(find.textContaining('SAMPLE MODE'), findsOneWidget);
    expect(find.textContaining('Hand-written'), findsOneWidget);
  });

  testWidgets('ready is not checked before work starts', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(body: StageChips(reached: null)),
    ));
    expect(find.byIcon(Icons.check), findsNothing);
    expect(find.text('Ready'), findsOneWidget);
  });

  testWidgets('failure is not rendered as all stages completed', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(body: StageChips(reached: 'failed')),
    ));
    expect(find.textContaining('Could not finish'), findsOneWidget);
    expect(find.byIcon(Icons.check), findsNothing);
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });
}
