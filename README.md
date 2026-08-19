# Warsztat: Harness agentowy — wiele agentów, jeden plan

Drugi warsztat z serii o agentach. Na pierwszym każdy zbudował własną pętlę
agentyczną — jednego agenta, który w jednej sesji kręci się między modelem
a narzędziami. Dziś budujemy piętro wyżej: **harness**, czyli automatyczną
pętlę epizodów, w której kilka agentów o różnych rolach pracuje nad jednym
długoterminowym planem, a między epizodami progresję pilnuje **scout** —
deterministyczny kod, nie model.

```
(AGENT 1 → AGENT 2 → AGENT 3) → scout → (AGENT 1 → AGENT 2 → AGENT 3) → scout → …
```

Agentów tym razem **nie piszemy sami**. Pętla z pierwszego warsztatu była po
to, żeby zrozumieć mechanizm — do realnej pracy jest za słaba i nikt jej w
jeden dzień nie doprowadzi do sensownej jakości. Rolę agenta gra gotowy
Claude Code uruchamiany bez interfejsu: `claude -p "<zadanie>"` wykonuje
całą sesję od początku do końca i oddaje sterowanie twojemu kodowi.
Budujemy wyłącznie to, czego w pudełku nie ma: role, sygnały, scouta
i pętlę epizodów.

Każdy uczestnik wychodzi z:

- harnessem, który przechodzi przez wielokrokowy plan bez nadzoru: epizod
  za epizodem, aż wszystkie kroki są odhaczone
- trzema rolami agentów: **implementer** pisze kod, **release manager**
  dopuszcza krok do wydania (drobiazgi poprawia sam), **detektyw** szuka
  tropów — diagnozuje porażki i sprawdza, czy sukces jest wiarygodny
- komunikacją między agentami przez pliki `{nazwa-agenta}-signal.json`,
  osobne dla każdego epizodu — bez współdzielenia kontekstu
- scoutem: kawałkiem zwykłego kodu, który czyta sygnały, odhacza kroki
  planu i wykonuje werdykt detektywa: dalej, powtórka, ściana

## Cel

Zrozumieć, jak z krótkich, jednorazowych sesji agenta składa się długą,
wielogodzinną pracę. Trzy idee do zabrania:

- **Stan żyje poza modelem.** Sesja agenta jest krótka i śmiertelna —
  kontekst rośnie, budżet iteracji i tokenów się wyczerpuje. Wszystko, co ma
  przetrwać, mieszka w plikach: cel, plan, sygnały, kod, wnioski z porażek.
- **Role zamiast supermózgu.** Zamiast jednego agenta, który "robi
  wszystko", trzy krótkie sesje z wąskimi rolami. Ten, kto sprawdza, nie
  jest tym, kto pisał — i dlatego sprawdza naprawdę.
- **Orkiestracja jest deterministyczna.** Ocenę pracy wydaje detektyw, ale
  wykonuje ją kod: scout czyta werdykt i rusza dalej według prostych reguł.
  Nie ma kreatywności i nie ma tokenów — i dokładnie dlatego harness
  daje się debugować.

## Jak działa harness

```
  goal.md   — cel całości; nie zmienia się w trakcie
  plan.md   — długoterminowy plan: kroki z kryteriami "zrobione"
      │
      ▼
  ┌──────────────────────── epizod N ────────────────────────┐
  │                                                          │
  │  AGENT 1: implementer     ──► implementer-signal.json    │
  │  AGENT 2: release manager ──► release-manager-signal.json│
  │  AGENT 3: detektyw        ──► detektyw-signal.json       │
  │                                                          │
  │  (sygnały lądują w episodes/episode-N/;                  │
  │   każdy agent startuje z czystym kontekstem:             │
  │   czyta goal.md, plan.md i cudze sygnały)                │
  └────────────────────────────┬─────────────────────────────┘
                               ▼
                   scout — deterministyczny kod
             czyta werdykt detektywa → odhacza krok →
             wykonuje: dalej / powtórka / ściana
                               │
                               ▼
                         epizod N+1 … aż plan zostanie ukończony
```

Agenci **nie rozmawiają ze sobą bezpośrednio** i nie dzielą kontekstu.
Jedyny kanał to pliki: każda sesja kończy się sygnałem, każda następna
sesja zaczyna od przeczytania cudzych sygnałów. Co ma wiedzieć następny
agent, musi zostać zapisane — dokładnie jak w zespole, który pracuje na
zmiany i zostawia sobie notatki. Sygnały należą do epizodu: każdy epizod ma
własny komplet w swoim katalogu `episodes/episode-N/`, więc kronika całej
pracy buduje się sama.

## Co budujesz

Harness to kilka małych plików wokół gotowego agenta (`claude -p`):

| Składnik        | Co robi                                                                 |
|-----------------|--------------------------------------------------------------------------|
| `goal.md`       | cel całości na jedną stronę; wszyscy czytają, nikt nie edytuje           |
| `plan.md`       | kroki z checkboxami i kryterium "zrobione" dla każdego kroku             |
| role            | trzy wiadomości systemowe: builder, tester, detektyw                     |
| runner sesji    | uruchamia `claude -p` jako podproces: prompt roli + krok + sygnały       |
| sygnały         | `episodes/episode-N/{nazwa-agenta}-signal.json` — status, podsumowanie, wynik |
| scout           | deterministyczny kod: czyta sygnały, odhacza kroki, wybiera następny ruch|
| pętla epizodów  | while: epizod → scout → … plus twardy limit epizodów na poziomie harnessu|
| `episodes/`     | katalog epizodów: każdy ma własny komplet sygnałów i logów               |

Sygnał to zwykły JSON — na tyle prosty, żeby scout czytał go kodem,
a następny agent promptem:

```json
{
  "agent": "release-manager",
  "episode": 3,
  "step": "2-zapis-do-pliku",
  "status": "fail",
  "summary": "Zapis działa, ale wczytanie pustej listy wywala program.",
  "details": ["test_load_empty: FAILED — TypeError: items is not iterable"],
  "artifacts": ["episodes/episode-3/test-output.txt"]
}
```

Sygnał wymuszasz promptem: w prompcie każdej roli stoi, że ostatnią
czynnością sesji jest zapis pliku sygnału (Claude Code ma narzędzia
plikowe, więc po prostu go zapisze). Brak pliku **nie jest werdyktem**
i nie zatrzymuje harnessu: scout powtarza tę samą sesję, dopisując do
promptu, że poprzednia próba nie zostawiła signal file.

## Role

- **Implementer** dostaje bieżący krok planu, kryterium "zrobione" i — po
  powtórce — wnioski detektywa. Pisze kod w piaskownicy projektu i
  zapisuje w swoim signal file, co zrobił.
- **Release manager** decyduje, czy krok nadaje się do wydania. Nie czyta
  zapewnień implementera, tylko sam uruchamia polecenie kryterium —
  dosłownie tak, jak stoi w `plan.md`. Drobiazg w rodzaju literówki czy
  brakującego importu może poprawić sam; wszystko większe opisuje w swoim
  signal file. Jego signal file — nie zapewnienia implementera — jest
  głównym dowodem dla detektywa.
- **Detektyw** pracuje w każdym epizodzie i to on wydaje **werdykt**. Czyta
  kod, signal file release managera i pozostałe sygnały. Po porażce pisze
  diagnozę: co dokładnie jest zepsute i co implementer ma zmienić. Po
  sukcesie sprawdza, czy wynik jest wiarygodny: czy test nie przeszedł
  zbyt łatwo, czy kod nie obchodzi kryterium, czy dług techniczny nie
  został zamieciony pod dywan. Zielony
  wynik testów na kodzie, którego implementer nie tknął, to nie jest
  "dalej". Nie naprawia sam; jego produktem są tropy oraz werdykt w
  sygnale: `advance` (dalej), `retry` (powtórka) albo `walled` (ściana —
  bez decyzji człowieka się nie ruszy). Tropy trafiają do następnego
  epizodu niezależnie od werdyktu.

Reguły scouta mieszczą się w kilku ifach — i tak ma być:

- werdykt `advance` → scout odhacza krok w `plan.md` i bierze następny;
  tropy detektywa jadą do promptów następnego epizodu
- werdykt `retry` → powtórka kroku w następnym epizodzie; diagnoza
  detektywa trafia do promptu implementera
- werdykt `walled` → ściana: harness staje i czeka na decyzję człowieka.
  O zatrzymaniu decyduje dowód, nie licznik — werdykt walled wydaje
  detektyw, kiedy widzi, że kolejne powtórki nic nie zmienią
- brak sygnału → to nie porażka kroku: scout powtarza tę samą sesję
  z dopiskiem, że poprzednia próba nie zostawiła signal file
- wszystkie kroki odhaczone → koniec i raport końcowy
- limit epizodów zostaje jako bezpiecznik awaryjny — gdyby wszystko
  inne zawiodło, harness i tak w końcu stanie

## Przed warsztatem

- Claude Code zainstalowany i zalogowany. Sprawdź przed warsztatem, że
  tryb nieinteraktywny działa: `claude -p "odpowiedz jednym słowem: ok"`.
- Node 22+ (albo Python, jak poprzednio) — w tym piszesz scouta, runner
  sesji i pętlę epizodów.
- Agent z pierwszego warsztatu nie jest potrzebny — rolę agenta gra
  Claude Code.

Zasada z poprzedniego warsztatu obowiązuje nadal: **wszystko jest kodem**.
Harness ma się dać uruchomić od zera jednym poleceniem; żadnego kroku,
którego nie widać w repozytorium.

## Agenda

### 1. Intro: czemu jeden agent nie wystarczy (20 min)
Prezentacja: sesja agenta jest krótka i śmiertelna; długa praca to wiele
krótkich sesji plus stan w plikach; role zamiast supermózgu; scout jako
kod, nie model.

### 2. Krok 1: goal.md i plan.md (20 min)
Piszesz cel całości (jedna strona) i plan na 3–5 kroków. Każdy krok ma
kryterium "zrobione" złożone z trzech rzeczy: polecenie do uruchomienia,
oczekiwany wynik i zakaz dotykania samego kryterium. Polecenie stoi w
`plan.md`, release manager uruchamia je **dosłownie** — nie ocenia "czy
działa ładnie". A pliki kryterium (testy, dane wzorcowe) leżą poza
zasięgiem zapisu implementera, bo agent, który może edytować test,
"zaliczy" krok kasując asercje — jeśli agent może zmienić test zamiast implementacji, zmieni test. Bez tak postawionych kryteriów release manager
nie ma czego sprawdzać, a scout nie ma czego odhaczać.

### 3. Krok 2: role i pierwszy sygnał (30 min)
Trzy prompty ról: implementer, release manager, detektyw — każdy z
obowiązkiem zapisania sygnału jako ostatniej czynności sesji. Uruchamiasz
**pojedynczą** sesję implementera: `claude -p` z promptem roli i pierwszym
krokiem planu, i sprawdzasz, że po sesji leży poprawny
`episodes/episode-1/implementer-signal.json`. Jedna sesja, jeden sygnał —
zanim dołożysz pętlę.

### 4. Krok 3: scout (30 min)
Deterministyczny kod bez ani jednego wywołania modelu: wczytuje `plan.md`
i sygnały, odhacza krok albo zleca powtórkę, składa zadania następnego
epizodu. Testujesz go na sygnałach napisanych ręcznie w pliku — scout musi
być przewidywalny, zanim zobaczy prawdziwego agenta.

### 5. Krok 4: pętla epizodów (40 min)
Spinasz całość: epizod (implementer → release manager → detektyw) →
scout → następny epizod. Każdy epizod zapisuje swoje sygnały i logi do
`episodes/episode-N/`. Do tego twarde limity: w pojedynczej sesji
`--max-turns` przekazywany do `claude -p`, w harnessie górny limit epizodów
jako bezpiecznik awaryjny — bo o zatrzymaniu pracy decyduje werdykt walled,
nie licznik. Log na konsoli: numer epizodu, krok, werdykt, ruch scouta.

### 6. Krok 5: przejście całego planu (30 min)
Odpalasz harness na swoim planie i **nie dotykasz klawiatury**. Patrzysz,
jak implementer pisze, release manager sprawdza, detektyw wydaje werdykt,
a scout go wykonuje.
Interwencja ręczna oznacza, że harness ma dziurę — naprawiasz harness,
nie wynik.

### 7. PUNCHLINE: harness pracuje obok ludzi (20 min)
Wszyscy startują harness na tym samym zadaniu — i wracamy do zwykłej
pracy — harness nie wymaga nadzoru. Co kilka minut zaglądamy do
`episodes/` jak do kroniki: ile epizodów, które kroki szły na powtórkę,
co znajdował detektyw, czy ktoś dostał werdykt walled, czyj harness doszedł do
końca planu. Rozmawiamy o właściwym obrazie tej technologii: harness
pracuje obok ludzi — krótkie sesje, stan w plikach, deterministyczna
progresja — a człowiek wraca do niego przy werdykcie walled albo po
ukończeniu planu. Równoległa praca deweloperów obok harnessu ma swoją
nazwę: developer side tracks (dokument PM z AI).

## Koszty

Harness mnoży sesje: plan na 4 kroki przy dwóch, trzech epizodach na krok
to kilkanaście–kilkadziesiąt sesji Claude Code. To zużycie, które **widać**
w limitach konta — i po to są ograniczenia na obu poziomach: `--max-turns`
w pojedynczej sesji, limit epizodów jako bezpiecznik w harnessie. Scout
kosztuje zero, bo nie woła modelu — to zwykły kod.

## Linki

- Warsztat pierwszy (pętla agentyczna): `../warsztat-petla-agentyczna/`
- Claude Code w trybie nieinteraktywnym: https://code.claude.com/docs/en/headless
- Anthropic o budowaniu agentów: https://www.anthropic.com/research/building-effective-agents
- Anthropic o systemach wieloagentowych: https://www.anthropic.com/engineering/built-multi-agent-research-system
- ai-skills (Iterators): https://github.com/theiterators/ai-skills
