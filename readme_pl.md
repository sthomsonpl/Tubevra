# Tubevra

[![Read in English](https://img.shields.io/badge/EN-Read_in_English-2563eb?style=for-the-badge&labelColor=18181b)](readme.md)

Nieoficjalny klient YouTube oparty na Electron i TypeScript, na Windows, macOS i Linux.

Projekt na wczesnym etapie rozwoju.

## Uruchamianie

Potrzebujesz Node.js 22.13.0 lub nowszego i npm. W katalogu projektu:

```sh
npm install
npm start
```

## Budowanie

Buduj na systemie docelowym. `package` tworzy folder aplikacji, a `make` dodatkowo poniższe formaty, w tym ZIP portable.

| System / architektura                   | Folder aplikacji                                        | Instalatory + portable                               | Formaty           |
| --------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------- | ----------------- |
| Windows x64                             | `npm run package -- --platform=win32 --arch=x64`        | `npm run make -- --platform=win32 --arch=x64`        | Setup (EXE) + ZIP |
| Windows arm64                           | `npm run package -- --platform=win32 --arch=arm64`      | `npm run make -- --platform=win32 --arch=arm64`      | Setup (EXE) + ZIP |
| macOS Universal (Intel + Apple Silicon) | `npm run package -- --platform=darwin --arch=universal` | `npm run make -- --platform=darwin --arch=universal` | DMG + ZIP         |
| Linux x64                               | `npm run package -- --platform=linux --arch=x64`        | `npm run make -- --platform=linux --arch=x64`        | DEB + RPM + ZIP   |
| Linux arm64                             | `npm run package -- --platform=linux --arch=arm64`      | `npm run make -- --platform=linux --arch=arm64`      | DEB + RPM + ZIP   |

DEB/RPM buduj na Linuxie (bezpośrednio, WSL2, maszyna wirtualna lub CI) z `dpkg`, `fakeroot`, `rpmbuild` i `zip` w `PATH`. macOS Universal i DMG buduj na macOS; podpisywanie kodu i notaryzacja nie są skonfigurowane.

- Foldery aplikacji: `out/Tubevra-<platform>-<arch>/`.
- Instalatory: `out/make/nsis/<arch>/`, `out/make/dmg/<arch>/`, `out/make/deb/<arch>/` i `out/make/rpm/<arch>/`.
- ZIP-y portable: `out/make/zip/<platform>/<arch>/`. Rozpakuj i uruchom `Tubevra.exe` (Windows), `Tubevra.app` (macOS) lub `Tubevra` (Linux), zachowując pozostałe pliki. Dane pozostają w standardowym profilu użytkownika.

### GitHub Actions

[Workflow Build](.github/workflows/build.yml) uruchamia się wyłącznie ręcznie. Gdy plik workflow znajdzie się na domyślnej gałęzi repozytorium, otwórz **Actions → Build → Run workflow**, wybierz gałąź i rozpocznij budowanie. Push, pull request i tag nie uruchamiają budowania.

Każde uruchomienie buduje wszystkie pięć wariantów z powyższej tabeli. Paczki pobierzesz z sekcji **Artifacts** na stronie uruchomienia workflow; są pogrupowane według platformy i architektury oraz przechowywane przez 14 dni. Windows ARM64 jest pakowany na runnerze Windows x64, a Linux ARM64 na natywnym runnerze ARM64.

Sekrety do podpisywania nie są wymagane. macOS Universal zawiera pliki dla Intela i Apple Silicon i jest budowany bez podpisywania kodu oraz notaryzacji. Workflow przesyła wyłącznie artefakty budowania; nie publikuje GitHub Releases.

## Podziękowania

Inspiracją są TizenTube & TizenTube Cobalt. Więcej w [informacjach o projektach i zależnościach](THIRD_PARTY_NOTICES.md).

## Licencja

[GPL-3.0-only](LICENSE).

Niezależny projekt, niezwiązany z Google ani YouTube.

Projekt powstał głównie w celach edukacyjnych.
