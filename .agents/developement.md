# Implementacja i weryfikacja Tubevra

Instrukcje dotyczą implementacji, testowania i dokumentowania zmian. Stosuj je razem z `AGENTS.md`.

## Praca z kodem

- Przed zmianami sprawdź stan repozytorium. Zachowuj istniejące zmiany użytkownika; nie cofaj ich ani nie porządkuj przy okazji zadania.
- Czytaj dokumentację właściwego obszaru: `docs/core.md`, `docs/ui.md` lub `docs/extensions.md`. Rozbieżności między dokumentacją a kodem zgłaszaj, zamiast zakładać, że opis potwierdza aktualne działanie.
- Nie formatuj całego repozytorium ani nie poprawiaj niezwiązanych błędów.
- Wdrożenie lub zmiana rozszerzenia łączącego się z usługą zewnętrzną wymaga krótkiej, zgodnej z kodem aktualizacji `PRIVACY.md` i `PRIVACY_PL.md`: wskaż usługę, cel połączenia, przekazywane dane (w tym adres IP), kiedy połączenia są wykonywane i jak je wyłączyć.

## Weryfikacja

- Korzystaj ze skryptów dostępnych w `package.json`. Dobieraj weryfikację do zmiany: kontrola typów, lint i testy dotyczące zmodyfikowanego obszaru.
- Zmiany w preloadach, IPC, natywnym sterowaniu i cyklu życia rozszerzeń sprawdzaj odpowiednimi testami Electron. Przy zmianach budowania rozszerzeń uwzględniaj również testy spakowanej aplikacji.
- Testy uruchamiaj na odizolowanych profilach i danych tymczasowych. Nie używaj rzeczywistej konfiguracji ani sesji użytkownika.
- Rozróżniaj test lokalnej atrapy YouTube od sprawdzenia rzeczywistego serwisu. Nie przedstawiaj powodzenia testu atrapy jako potwierdzenia działania na YouTube.
- Przy zmianach interfejsu sprawdzaj fokus, edycję tekstu, IME, fullscreen, otwieranie ustawień oraz obszary przechwytujące mysz — odpowiednio do zakresu zadania.
- W podsumowaniu podawaj wykonane testy, ograniczenia i zachowania pozostające bez weryfikacji.
