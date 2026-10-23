# Tubevra

[![Read in English](https://img.shields.io/badge/EN-Read_in_English-2563eb?style=for-the-badge&labelColor=18181b)](readme.md)

Nieoficjalny klient YouTube oparty na Electron i TypeScript, na Windows, macOS i Linux.

Projekt na wczesnym etapie rozwoju.

## Uruchamianie

Potrzebujesz Node.js 22.13.0 lub nowszego i npm. W katalogu projektu:

```sh
npm ci
npm start
```

## Budowanie

Buduj na systemie docelowym:

| Budowanie na | Komenda                             | Instalator / archiwum        |
| ------------ | ----------------------------------- | ---------------------------- |
| Windows      | `npm run make -- --platform=win32`  | Instalator Squirrel (`.exe`) |
| macOS        | `npm run make -- --platform=darwin` | Archiwum ZIP                 |
| Linux        | `npm run make -- --platform=linux`  | Paczki DEB i RPM             |

Tworzy wersję przenośną w `out/Tubevra-<platform>-<arch>/` oraz instalator lub archiwum w `out/make/`.

Aby zbudować tylko wersję przenośną, użyj `npm run package`.

Bez `--platform` wybierany jest bieżący system. Architektura domyślnie odpowiada Twojej maszynie; dodaj `--arch=x64` lub `--arch=arm64`, jeśli dany format ją obsługuje. Na Linux potrzebujesz też `dpkg` i `rpmbuild` w `PATH`.

## Podziękowania

Inspiracją są TizenTube & TizenTube Cobalt. Więcej w [informacjach o projektach i zależnościach](THIRD_PARTY_NOTICES.md).

## Licencja

[GPL-3.0-only](LICENSE).

Niezależny projekt, niezwiązany z Google ani YouTube.

Projekt powstał głównie w celach edukacyjnych.
