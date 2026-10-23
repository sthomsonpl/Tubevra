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
- Nie wykonuj nieuzgodnionych refaktorów ani zmian architektury.
- Zachowuj istniejące rozwiązania i działające funkcjonalności.
- Preferuj prosty, czytelny kod bez zbędnych abstrakcji.
- Wykorzystuj istniejące komponenty, zanim utworzysz nowe.
- Większe zmiany architektoniczne wymagają wcześniejszej akceptacji.
- Nie modyfikuj plików niezwiązanych z zadaniem.
- Nie dodawaj zależności bez uzasadnienia.

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
2. Przy większych zadaniach przedstaw krótki plan.
3. Implementuj wyłącznie uzgodniony zakres.
4. Przeprowadź adekwatne testy.
5. Podsumuj zmiany, wyniki testów i ewentualne problemy.

Jeżeli zadanie dotyczy tylko analizy, nie modyfikuj kodu.

Uwzględniaj dodatkowe instrukcje z `.agents/`, jeśli dotyczą aktualnego zadania.


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