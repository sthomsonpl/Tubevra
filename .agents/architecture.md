# Architektura Tubevra

Instrukcje dotyczą zmian w podziale odpowiedzialności, widokach Electron, konfiguracji i systemie rozszerzeń. Stosuj je razem z `AGENTS.md`.

## Odpowiedzialności

- **Proces `main`** odpowiada za cykl życia aplikacji, okna i widoki, sesje, uprawnienia, zapis konfiguracji oraz obsługę uprzywilejowanych operacji.
- **`preload`** odpowiada za ograniczone mosty komunikacyjne i integrację z dokumentem. Nie przenoś do niego logiki zapisu konfiguracji ani zarządzania aplikacją.
- **`renderer`** odpowiada za lokalny interfejs Tubevra. Zachowuj rozdzielenie lokalnego interfejsu aplikacji od zdalnej strony YouTube.
- **Widoki Electron:** uwzględniaj natywną hierarchię `WebContentsView`. CSS `z-index` nie zastępuje zarządzania kolejnością, widocznością, rozmiarem i fokusem osobnych widoków.

## Rozszerzenia

- Dodawaj rozszerzenia przez istniejący katalog `src/extensions/catalog.ts`. Korzystaj z obecnego mechanizmu budowania i warstw `main`, `page`, `hooks`, zamiast tworzyć równoległy system rejestracji lub uruchamiania.
- Zachowuj obsługę anulowania i zwalniania zasobów. Usuwaj listenery, obserwatory, timery i reguły sieciowe po wyłączeniu rozszerzenia lub zakończeniu jego działania.
- Reguły sieciowe rejestruj przez istniejący dispatcher, aby rozszerzenia nie zastępowały wzajemnie swojej obsługi żądań.

## Konfiguracja i stan wykonania

- Rozdzielaj zapisane preferencje od rzeczywistego statusu działania, błędów oraz wymagań przeładowania lub restartu.
