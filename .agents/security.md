# Bezpieczeństwo Tubevra

Instrukcje dotyczą IPC, preloadów, nawigacji, uprawnień, rozszerzeń i zapisu konfiguracji. Stosuj je razem z `AGENTS.md`.

## Granice zaufania i IPC

- Traktuj stronę YouTube i komunikaty z jej środowiska JavaScript jako niezaufane. Kod rozszerzenia działający w tym środowisku nie czyni całej strony zaufaną.
- Przy IPC sprawdzaj nadawcę, właściwy `WebContents`, główną ramkę, dozwolony URL oraz liczbę, typ i zakres argumentów. Same typy TypeScript nie zastępują walidacji podczas działania.
- Uprzywilejowane operacje udostępniaj wyłącznie przez wąskie API lokalnego interfejsu. Nie przekazuj zdalnej stronie ogólnego dostępu do IPC, systemu plików, powłoki ani API Electron.
- Raporty warstw `page` i `hooks` traktuj jako dane diagnostyczne. Nie mogą nadawać uprawnień ani samodzielnie zmieniać konfiguracji aplikacji. Zachowuj kontrolę dokumentu, rewizji i instancji.

## Nawigacja i wykonywanie kodu

- Zachowuj ograniczenia nawigacji, nowych okien i uprawnień. Rozszerzenie obsługiwanych adresów lub przepływów, np. logowania, wymaga osobnej analizy i zatwierdzenia.
- Zachowuj model rozszerzeń dołączanych podczas budowania aplikacji. Nie dodawaj pobierania i wykonywania dowolnego kodu jako obejścia problemu kompatybilności.

## Dane użytkownika

- Przy zapisie konfiguracji zachowuj walidację, serializację i atomowe zastępowanie plików. Błąd odczytu nie może prowadzić do automatycznego nadpisania danych wartościami domyślnymi.
