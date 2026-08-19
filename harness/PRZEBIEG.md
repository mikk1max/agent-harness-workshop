# Przebieg ćwiczenia: harness agentowy na przykładzie CLI todo

Ten dokument opisuje **finalny stan repo** — architekturę, jak działa, i
referencyjny przebieg od pustego projektu do końca. Po drodze mechanizm się
kilka razy zmieniał (patrz sekcja "Ewolucja"), ale to, co jest opisane niżej,
to stan ostateczny.

## Co budowaliśmy i po co

Chodziło o to, żeby zamiast jednej długiej sesji agenta AI (która ma
ograniczony "oddech" — kontekst i liczbę kroków, po której trzeba skończyć),
zbudować **system, który sam się kręci**: uruchamia kolejne krótkie sesje
agenta, każda z inną rolą, aż całe zadanie zostanie zrobione — bez
człowieka klikającego "dalej" po każdym kroku.

Zadaniem testowym było napisanie prostego CLI do listy zadań (todo) w
Node.js: `add`, `list`, `done`, `remove`, `count` na pliku JSON.

## Kto z kim gra — role

Zamiast jednego agenta, który "robi wszystko na słowo honoru", w każdym
epizodzie (jednej rundzie pracy) biorą udział trzy osobne sesje agenta,
każda z innym zadaniem i inną wiedzą:

- **Implementer** (`.claude/agents/implementer.md`, model `sonnet`, effort
  `high`) — dostaje krok z planu i pisze kod (`cli.js`). Nie widzi niczego
  więcej niż aktualny krok i ewentualne uwagi z poprzedniej rundy.
- **Release manager** (`.claude/agents/release-manager.md`, model `haiku`,
  effort `low`) — nie wierzy implementerowi na słowo. Sam, osobiście,
  odpala polecenie kryterium i patrzy na realny wynik, a nie na to, co
  implementer napisał w podsumowaniu. Tania, mechaniczna rola — stąd
  najtańszy model.
- **Detektyw** (`.claude/agents/detektyw.md`, model `sonnet`, effort
  `medium`) — czyta, co zrobił implementer i co realnie wyszło release
  managerowi, i wydaje **werdykt**: da się iść dalej (`advance`), trzeba
  spróbować jeszcze raz (`retry`), czy sprawa jest nie do ruszenia bez
  człowieka (`walled`).

Każda rola to prawdziwy subagent Claude Code (`.claude/agents/*.md` —
frontmatter `name`/`description`/`tools` + treść roli w body), odpalany
headless przez `claude -p "<dane epizodu>" --agent <rola>`. Model/effort/
max-turns per rola nie siedzi w pliku agenta, tylko w `scout-config.json` —
jedno miejsce, które scout może (i potrafi) sam sobie modyfikować.

Te trzy sesje **nie rozmawiają ze sobą bezpośrednio** i nic nie pamiętają
z poprzednich rund. Cała wiedza, która ma przetrwać między sesjami, ląduje
w plikach — głównie w plikach `*-signal.json`, które każda rola zapisuje
na koniec swojej pracy, plus surowy JSON całej sesji (`*-session.json` —
liczba tur, koszt, czas, pełna odpowiedź) do audytu.

## Kto/co pilnuje kolejności — scout

**Scout** (`scout.js`) — zwykły kod, bez żadnego wywołania modelu AI —
odpowiada za dwie rzeczy:

1. **Tworzy epizody** (`scout.startEpisode`) — liczy kolejny numer i
   zakłada katalog `episodes/episode-N/` na dysku, zanim jakakolwiek rola
   odpali sesję.
2. **Czyta sygnały i decyduje, co dalej** (`scout.decideNextStep`) — jedno
   miejsce łączące werdykt detektywa z ruchem w `plan.md`:
   - `advance` → odhacza krok, wybiera następny nieodhaczony,
   - `retry` → krok zostaje, a scout **sam podnosi** `maxTurns`
     implementera w `scout-config.json` (z sufitem 40) — założenie: skoro
     krok wymagał powtórki, agent potrzebuje więcej przestrzeni na próby,
   - `walled` → nic w planie się nie rusza, harness ma się zatrzymać,
   - brak sygnału od którejś roli → **to nie werdykt kroku**, tylko
     usterka: ta sama rola dostaje powtórkę z dopiskiem o braku pliku
     (do `maxSignalRetries` z configu),
   - błąd na poziomie API (limit konta, rate-limit — `is_error` +
     `api_error_status` w surowym logu sesji) → też nie jest "brakiem
     sygnału do powtórki": harness przerywa się **od razu**, bo kolejne
     próby i tak nic nie zmienią, dopóki limit trwa.

Scout jest w 100% przewidywalny — cała jego logika (tworzenie epizodów,
decyzje, samo-tuning configu) jest przetestowana w `scout.test.js` na
ręcznie napisanych fixture'ach, zero wywołań modelu.

## Zamrożone kryteria

`tests/step{1..5}.test.js` to pięć plików, których implementer **nigdy nie
dotyka** — release manager i detektyw uruchamiają je dosłownie, żeby
sprawdzić krok. Każdy zweryfikowany osobno referencyjną implementacją
przed wpięciem do planu (żeby wiedzieć, że kryterium jest w ogóle
osiągalne, zanim zobaczy go prawdziwy agent).

## Ewolucja mechanizmu (dla kontekstu)

Repo przeszło kilka realnych iteracji, nie powstało w finalnym kształcie
od razu:

1. **Start**: role jako ręcznie sklejane wielkie prompty w `roles/*.md`,
   wstrzykiwane do `claude -p "<cały prompt>"`.
2. **Debug #1**: pierwsza sesja headless wisiała do `max-turns` bez
   sygnału — `claude -p` bez interaktywnego terminala pytał o zgodę na
   każdy `Write`/`Bash` i nikt nie mógł kliknąć "zgadzam się". Naprawa:
   `--allowedTools "Read Write Edit Bash(node *)"`.
3. **Refaktor scouta**: pierwotnie katalog epizodu tworzył `run-agent.js`,
   a numer epizodu liczył `harness.js` — scout tylko czytał sygnały.
   Skonsolidowane do `scout.startEpisode`/`scout.decideNextStep`, żeby
   scout naprawdę robił obie rzeczy, nie tylko połowę.
4. **Migracja na `.claude/agents`**: role przepisane z ręcznych promptów
   na prawdziwe subagenty Claude Code, odpalane przez `--agent <rola>`.
   Zweryfikowane empirycznie przed użyciem (smoke-test), bo research nad
   dokładnym schematem frontmatteru wrócił z ostrzeżeniem o podejrzanym,
   wstrzykniętym sugestiami dot. `bypassPermissions` — zignorowanym.
5. **Config + logi**: `scout-config.json` (model/effort/max-turns per
   rola + samokorekta po `retry`) i surowe logi sesji w JSON
   (`episodes/episode-N/*-session.json`) zamiast tekstowego `tee`.
6. **Debug #2**: pełny przebieg trafił na miesięczny limit zużycia konta
   w środku epizodu (`is_error`/`api_error_status: 429` w logu sesji).
   Harness wcześniej próbował to bezsensownie powtórzyć 3 razy — naprawa:
   `isFatalApiError` rozpoznaje to natychmiast i przerywa cały harness
   zamiast marnować próby.
7. **Weryfikacja odporności**: ubicie harnessu w połowie sesji (`TaskStop`,
   sprawdzone że nie zostawia sierocych procesów) i restart — `plan.md`
   nie cofa się, epizody się nie duplikują, przerwana praca na dysku
   (kod) przetrwa i zostaje domknięta w kolejnym epizodzie.

## Referencyjny przebieg — od zera do końca, jednym poleceniem

Ostateczny test: `./reset-and-run.sh` (czyści `cli.js`, `episodes/`,
checkboxy w `plan.md` i `scout-config.json`, potem odpala `node harness.js`
i nie jest już dotykany).

**Wynik: 5 kroków, 5 epizodów — zero `retry`, zero `walled`, zero ręcznej
interwencji.**

| Epizod | Krok | Werdykt | Koszt (3 role) |
|---|---|---|---|
| 1 | dodawanie zadań | advance | $0.18 |
| 2 | listowanie zadań | advance | $0.18 |
| 3 | oznaczanie jako zrobione | advance | $0.20 |
| 4 | usuwanie + walidacja błędnego id | advance | $0.17 |
| 5 | liczenie zadań | advance | $0.18 |

**Razem: ~9 min 59 s, ~$0.91, 15 sesji `claude -p`.**

Implementer w epizodzie 1 napisał od razu wszystkie pięć komend (mimo że
proszony był tylko o krok 1) — w każdym kolejnym epizodzie zgłaszał "już
było zaimplementowane, nic nie zmieniałem". Release manager **za każdym
razem** i tak sam odpalał test, zamiast uwierzyć na słowo — dokładnie
zachowanie, o które w tym ćwiczeniu chodziło.

Ciekawy szczegół z surowego logu epizodu 2: implementer dwa razy próbował
`mkdir -p episodes/episode-2` przez Bash i został **odrzucony**
(`permission_denials` w `implementer-session.json`) — `Bash(node *)`
faktycznie blokuje wszystko poza `node`, model po prostu poszedł dalej, bo
katalog i tak już istniał (założony wcześniej przez scouta). Potwierdza to,
że ograniczenie uprawnień działa dokładnie tak wąsko, jak powinno, bez
psucia normalnej pracy.

## Co z tego wynika

- **Nikt nikomu nie uwierzył na słowo.** Release manager w każdym epizodzie
  sam uruchamiał test, mimo że implementer pięć razy z rzędu twierdził
  "już zrobione". To jest separacja ról: ten, kto pisze, nie jest tym, kto
  dopuszcza do wydania.
- **Cała pamięć żyła w plikach**, nie w głowie żadnego agenta — każda z 15
  sesji startowała od zera i czytała tylko to, co zostało zapisane
  wcześniej.
- **Orkiestracja (scout) była głupim, przewidywalnym kodem** — cała
  "inteligencja" oceny siedziała w detektywie; wykonanie decyzji
  (odhaczenie kroku, powtórka, tuning configu) to był zwykły kod, w całości
  przetestowany bez modelu.
- **Różne modele do różnych zadań realnie obniżają koszt** — release
  manager (mechaniczne odpalenie jednego polecenia) na `haiku` kosztował
  3-8x mniej niż implementer/detektyw na `sonnet`, bez utraty jakości
  weryfikacji.
- **Harness nie myli awarii infrastruktury z porażką kroku** — limit API
  i brak sygnału to dwa różne przypadki z dwiema różnymi reakcjami
  (przerwij natychmiast vs. powtórz tę samą sesję).

## Elementy techniczne, które to spinają

| Plik/katalog | Rola |
|---|---|
| `goal.md` | cel całości — interfejs CLI, nie zmienia się w trakcie kroku |
| `plan.md` | 5 kroków z checkboxami i poleceniem-kryterium dla każdego |
| `tests/step{1..5}.test.js` | zamrożone kryteria "zrobione" — implementer nie ma do nich dostępu |
| `.claude/agents/*.md` | trzy subagenty Claude Code (implementer / release-manager / detektyw) |
| `scout-config.json` | model/effort/max-turns per rola, limit epizodów, limit powtórek — scout sam to koryguje po `retry` |
| `run-agent.js` | odpala jedną sesję `claude -p --agent <rola>`, wymusza zapis sygnału, łapie błędy API, zapisuje surowy log JSON |
| `scout.js` | czysty kod: tworzy epizody, czyta sygnały, decyduje advance/retry/walled, odhacza krok, tunuje config |
| `scout.test.js` | testy scouta na ręcznych fixture'ach, zero wywołań modelu |
| `harness.js` | pętla: scout tworzy epizod → 3 role → scout decyduje → kolejny epizod, aż koniec planu albo limit |
| `reset-and-run.sh` | czyści projekt do stanu wyjściowego i odpala harness od zera, jednym poleceniem |
| `episodes/episode-N/*-signal.json` | kronika werdyktów — co się działo w każdej rundzie |
| `episodes/episode-N/*-session.json` | surowy log JSON każdej sesji (koszt, tury, czas, pełna odpowiedź) |
