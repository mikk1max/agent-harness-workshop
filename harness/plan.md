# Plan

Implementer edytuje **wyłącznie** `cli.js` w tym katalogu. Pliki w `tests/`
są zamrożone — nie wolno ich zmieniać (release manager i detektyw mają to
sprawdzać).

- [ ] 1. dodawanie zadań — `node tests/step1.test.js` kończy się kodem wyjścia 0
- [ ] 2. listowanie zadań — `node tests/step2.test.js` kończy się kodem wyjścia 0
- [ ] 3. oznaczanie jako zrobione — `node tests/step3.test.js` kończy się kodem wyjścia 0
- [ ] 4. usuwanie zadań i walidacja błędnego id — `node tests/step4.test.js` kończy się kodem wyjścia 0

Kryteria są skumulowane: test kroku 3 zakłada, że `add` i `list` z kroków
1-2 już działają. Testy uruchamiaj z katalogu `harness/` (ten, w którym
leży ten plik).
