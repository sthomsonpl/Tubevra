# Tubevra — Agent Instructions

## Projekt

Tubevra to nieoficjalny klient YouTube oparty na Electron i TypeScript, przeznaczony na Windows, macOS i Linux.

Docelowo aplikacja obsługuje:
- **TV Mode** — YouTube Leanback (`youtube.com/tv`).
- **Desktop Mode** — standardowy YouTube (`youtube.com`).
- **Extensions** — modularne rozszerzenia inspirowane TizenTube i VacuumTube.

Planowane funkcjonalności nie są automatycznie częścią bieżącego zadania.

## Zasady pracy

- Realizuj wyłącznie uzgodniony zakres zadania.
- Zachowuj istniejące rozwiązania i działające funkcjonalności.
- Preferuj prosty, czytelny kod bez zbędnych abstrakcji.
- Wykorzystuj istniejące komponenty, zanim utworzysz nowe.
- Nie modyfikuj plików niezwiązanych z zadaniem.
- Nie dodawaj zależności bez uzasadnienia.

## Granice architektury i zakres zmian

- **Zachowuj istniejący podział odpowiedzialności** procesów Electron (`main`, `preload`, `renderer`), kodu współdzielonego (`shared`) i modułów rozszerzeń (`extensions`). Nie przenoś logiki między nimi bez uzasadnienia i wcześniejszej zgody użytkownika.
- **Zachowuj odrębność TV Mode i Desktop Mode.** Podobieństwo funkcjonalności nie uzasadnia automatycznego scalania ich sterowania, integracji z YouTube ani zarządzania stanem.
- **Współdziel mechanizmy i komponenty tam, gdzie jest to uzasadnione.** Tryby aplikacji i rozszerzenia mogą korzystać ze wspólnej infrastruktury, zachowując własną logikę, stan i interfejsy. Nie przenoś zachowania specyficznego dla jednego trybu lub rozszerzenia do pozostałych.
- **Nie wykonuj nieuzgodnionych zmian architektonicznych.** Zmiana granic modułów, podziału odpowiedzialności, kontraktów IPC lub sposobu integracji rozszerzeń wymaga przedstawienia propozycji, uzasadnienia i wpływu na istniejące funkcjonalności oraz wcześniejszej zgody użytkownika.
- **Preferuj minimalne, uzasadnione zmiany.** Lokalne refaktoryzacje niezbędne do realizacji zatwierdzonego planu są dozwolone, jeśli mieszczą się w jego zakresie, zachowują istniejącą architekturę i zachowanie pozostałych funkcjonalności.
- Jeśli zmiana architektury lub rozszerzenie zakresu okaże się korzystne albo konieczne podczas pracy, przedstaw aktualizację planu i uzyskaj jej zatwierdzenie przed wdrożeniem tych zmian.

## Sterowanie

- Skróty aplikacji nie mogą kolidować z pisaniem tekstu.
- Nie przechwytuj zwykłych klawiszy podczas edycji pól `input`, `textarea`, `contenteditable` ani podczas kompozycji IME.
- Zachowuj standardowe skróty systemowe i edycji tekstu.
- **TV Mode:** prawy przycisk myszy wykonuje akcję `Back` interfejsu YouTube TV.
- **Desktop Mode:** prawy przycisk myszy zachowuje standardowe działanie.
- Sterowanie specyficzne dla jednego trybu nie może wpływać na drugi.

## Bezpieczeństwo

- Nie włączaj `nodeIntegration` dla zdalnych stron.
- Zachowuj `contextIsolation`, sandbox i `webSecurity`.
- Nie udostępniaj nieograniczonych API Electron/Node.js zdalnym stronom.
- Waliduj komunikację IPC i ograniczaj uprawnienia.
- Nie osłabiaj zabezpieczeń w celu obejścia problemów kompatybilności.

## Struktura i organizacja projektu

- Organizuj projekt modularnie, z wyraźnym podziałem katalogów według odpowiedzialności.
- Preferuj strukturę `main/`, `preload/`, `renderer/` i `shared/` w katalogu `src/`.
- Nie umieszczaj wszystkich modułów bezpośrednio w głównym katalogu `src/`.
- Grupuj powiązane pliki w odpowiednich katalogach, zachowując separację odpowiedzialności.
- Nie mieszaj logiki biznesowej, IPC, konfiguracji i komponentów UI.
- Zachowuj istniejącą strukturę projektu. Jej reorganizacja wymaga wcześniejszej akceptacji.
- Unikaj zarówno płaskiej struktury projektu, jak i niepotrzebnego zagnieżdżania katalogów.
- Nie twórz pustych katalogów ani abstrakcji wyłącznie na potrzeby przyszłych funkcjonalności.

## Workflow

1. Przeanalizuj istotny kod przed zmianami.
2. Przed każdą implementacją, naprawą błędu lub refaktoryzacją przedstaw krótki plan obejmujący cel, zakres zmian, dotknięte moduły lub pliki, wpływ na istniejące funkcjonalności, istotne ryzyka i sposób weryfikacji. Szczegółowość planu dostosuj do wielkości zadania.
3. **Poczekaj na wyraźne zatwierdzenie planu przez użytkownika przed rozpoczęciem zmian.** Samo zlecenie zadania ani brak odpowiedzi nie oznaczają akceptacji planu. Jeżeli użytkownik wcześniej wyraźnie zatwierdził konkretny plan, nie proś ponownie o tę samą zgodę.
4. Implementuj wyłącznie zatwierdzony zakres. Jeśli potrzebna jest zmiana zakresu, architektury lub istotnych założeń, przedstaw zaktualizowany plan i poczekaj na jego zatwierdzenie przed wykonaniem zmian, których dotyczy aktualizacja. Czynności mieszczące się w zatwierdzonym planie nie wymagają osobnych zatwierdzeń.
5. Przeprowadź adekwatne testy.
6. Podsumuj zmiany, wyniki testów i ewentualne problemy.

Analiza i odczyt plików potrzebne do przygotowania planu nie wymagają jego zatwierdzenia. Jeżeli zadanie dotyczy tylko analizy, nie modyfikuj kodu.

Uwzględniaj dodatkowe instrukcje z `.agents/`, jeśli dotyczą aktualnego zadania.

- [`.agents/architecture.md`](.agents/architecture.md) — przy zmianach w podziale odpowiedzialności, widokach Electron, konfiguracji i systemie rozszerzeń.
- [`.agents/developement.md`](.agents/developement.md) — przy implementacji, testowaniu i dokumentowaniu zmian.
- [`.agents/security.md`](.agents/security.md) — przy zmianach w IPC, preloadach, nawigacji, uprawnieniach, rozszerzeniach i zapisie konfiguracji.


## Git & Commits

- **Conventional Commits:** wszystkie proponowane commity muszą być zgodne ze standardem Conventional Commits (`type(scope): description`).
- **No Automatic Commits:** nigdy nie wykonuj `git commit`, `git push` ani innych operacji publikujących zmiany bez wyraźnej zgody użytkownika.
- **Commit Proposal:** po zakończeniu zadania zaproponuj commit obejmujący wykonane zmiany, ale nie wykonuj go samodzielnie.
- **Commit Format:** propozycję przedstaw w jednym bloku kodu, zawierającym angielski tytuł i opis commita.
- **Polish Translation:** bezpośrednio pod blokiem umieść polskie tłumaczenie tytułu i opisu, zachowując tę samą strukturę.
- **Accuracy:** opis commita musi odzwierciedlać faktycznie wykonane zmiany. Nie uwzględniaj funkcjonalności, które nie zostały zaimplementowane.
- **Atomic Commits:** jeżeli zmiany obejmują niezależne obszary, zaproponuj ich logiczny podział na osobne commity.
- **No Unapproved Git Changes:** nie wykonuj `git add`, `reset`, `rebase`, `merge`, `cherry-pick` ani innych operacji zmieniających stan repozytorium bez zgody użytkownika.


## Dodatkowe zasady

- **Root Cause First:** przed naprawą błędu ustal jego przyczynę. Nie maskuj problemów przypadkowymi obejściami.
- **Compatibility First:** integracje z YouTube traktuj jako zależne od zewnętrznego serwisu. Unikaj kruchych rozwiązań i izoluj mechanizmy kompatybilności.
- **No Silent Fallbacks:** nie wprowadzaj alternatywnego zachowania bez uzasadnienia. Istotne błędy i ograniczenia muszą być widoczne.
- **Preserve Configuration:** nie resetuj ustawień użytkownika ani istniejących danych bez wyraźnej zgody.
- **Git Safety:** nie wykonuj destrukcyjnych operacji Git, nie zmieniaj historii ani nie publikuj zmian bez zgody użytkownika.

Third-party code: przy integracji lub modyfikacji kodu pochodzącego z zewnętrznych projektów zachowuj wymagane informacje licencyjne i aktualizuj THIRD_PARTY_NOTICES.md.
