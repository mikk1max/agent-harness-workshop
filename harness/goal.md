# Cel

Zbudować `cli.js` — prosty CLI do zarządzania listą zadań (todo) trzymaną
w pliku JSON. Cała logika mieści się w jednym pliku `cli.js` w katalogu
projektu, uruchamianym przez `node cli.js <komenda> ...`.

## Interfejs (nie zmienia się w trakcie pracy)

```
node cli.js add "<tekst>" --file <ścieżka>      # dodaje zadanie, drukuje nic, exit 0
node cli.js list --file <ścieżka>               # drukuje zadania, jedna linia na zadanie, exit 0
node cli.js done <id> --file <ścieżka>          # oznacza zadanie jako zrobione, exit 0
node cli.js remove <id> --file <ścieżka>        # usuwa zadanie, exit 0
```

- Plik `--file` to zwykły JSON: tablica obiektów `{ "id": number, "text": string, "done": boolean }`.
  Jeśli plik nie istnieje, `add` go tworzy.
- `id` jest liczbą całkowitą, przydzielaną rosnąco od 1, nigdy nie jest ponownie
  wykorzystywana (nawet po `remove`).
- `list` wypisuje zadania posortowane rosnąco po `id`, jedna linia na zadanie,
  dokładnie w formacie: `<id> [ ] <text>` dla niezrobionych i `<id> [x] <text>`
  dla zrobionych.
- `done <id>` i `remove <id>` dla nieistniejącego `id`: proces kończy się
  kodem wyjścia **1** i komunikatem błędu na stderr (nie rzuca nieobsłużonego
  wyjątku, nie wypisuje stack trace'u).
- Brak zewnętrznych zależności — sam Node.js (fs, path, process).

## Poza zakresem

Nie ma edycji tekstu zadania, nie ma priorytetów, nie ma trwałej konfiguracji.
Jeśli czegoś tu nie ma — nie dodawaj tego.
