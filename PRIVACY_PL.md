# Polityka prywatności

[![Read in English](https://img.shields.io/badge/EN-Read_in_English-2563eb?style=for-the-badge&labelColor=18181b)](PRIVACY.md)

## Dane lokalne

Tubevra zapisuje ustawienia, profile User-Agent, preferencje rozszerzeń i dane
przeglądarkowe YouTube na Twoim urządzeniu. Cookies, sesje logowania, pamięć stron
i pamięć podręczna korzystają z profilu oddzielnego od zwykłej przeglądarki.
Ustawienia są przechowywane w zwykłych plikach JSON.

Typowe lokalizacje profilu:

- Windows: `%APPDATA%\Tubevra`
- macOS: `~/Library/Application Support/Tubevra`
- Linux: `$XDG_CONFIG_HOME/Tubevra` lub `~/.config/Tubevra`

Wersje portable również korzystają ze standardowego profilu użytkownika.

## YouTube i Google

Tubevra łączy się bezpośrednio z YouTube TV. Google/YouTube otrzymują adres IP,
informacje o żądaniach i przeglądarce, wybrany User-Agent, odpowiednie cookies
oraz aktywność, np. wyszukiwania i żądania filmów. Jeśli jesteś zalogowany,
aktywność może być powiązana z kontem Google. Niektóre sposoby logowania nie są
obecnie obsługiwane.

Wykorzystanie tych informacji przez Google, w tym analitykę, reklamy, okresy
przechowywania i przekazywanie danych za granicę, opisuje
[polityka prywatności Google](https://policies.google.com/privacy).
Znaczenie mają też ustawienia konta. Adblock nie gwarantuje ochrony przed śledzeniem.

## SponsorBlock

SponsorBlock jest **domyślnie wyłączony**. Po jego włączeniu Tubevra pobiera
segmenty sponsorowane z `sponsor.ajay.app`, wysyłając pierwsze cztery znaki
obliczonego lokalnie skrótu SHA-256 identyfikatora filmu. Dopasowanie pełnego
identyfikatora odbywa się lokalnie.

Żądania korzystają z osobnej sesji, bez cookies YouTube i danych uwierzytelniających
konta. Tubevra nie wysyła identyfikatora użytkownika SponsorBlock, głosów,
zgłoszeń ani statystyk pominięć. Usługa i jej dostawcy hostingu/proxy nadal
otrzymują adres IP i metadane żądań; prefiks skrótu nie gwarantuje anonimowości.
Wyniki są buforowane wyłącznie w pamięci operacyjnej i usuwane po zatrzymaniu
rozszerzenia lub zamknięciu aplikacji.

Zobacz [politykę prywatności SponsorBlock](https://gist.github.com/ajayyy/aa9f8ded2b573d4f73a3ffa0ef74f796)
i [informacje o usługach zewnętrznych](THIRD_PARTY_NOTICES.md). Wyłączenie
rozszerzenia zatrzymuje dalsze żądania.

## Diagnostyka i odnośniki zewnętrzne

Tubevra nie ma wbudowanej analityki, automatycznego wysyłania raportów awarii ani
sprawdzania aktualizacji. Nie dotyczy to danych zbieranych przez YouTube,
SponsorBlock lub Return YouTube Dislike. Błędy są wyświetlane lokalnie i mogą trafiać do konsoli.
Electron/Chromium lub system operacyjny mogą również zapisywać lokalne dane
diagnostyczne. Przed udostępnieniem logów sprawdź ich zawartość — mogą zawierać
ścieżki plików i szczegóły techniczne.

Odnośniki do GitHuba, Return YouTube Dislike i SponsorBlock otwierają się
w domyślnej przeglądarce
i korzystają z jej profilu oraz zasad prywatności odwiedzanej strony.

## Usuwanie danych

Ustawienia pozostają do czasu zmiany lub usunięcia. Dane stron podlegają terminom
ważności ustalanym przez YouTube i mechanizmom zarządzania pamięcią Chromium.
Restart lub zmiana User-Agent nie usuwa sesji YouTube.

Aplikacja nie ma wbudowanej funkcji czyszczenia danych. Aby usunąć lokalne
ustawienia i dane stron, całkowicie zamknij Tubevrę i usuń katalog jej profilu.
Deinstalator Windows zachowuje ten katalog. Kopie zapasowe mogą nadal zawierać
dane. Usunięcie lokalnych plików nie usuwa danych z usług zewnętrznych; służą do
tego ich ustawienia konta i narzędzia prywatności.

## Prawa dotyczące danych

Jeśli zastosowanie ma RODO, mogą przysługiwać Ci prawa dostępu, sprostowania,
usunięcia, ograniczenia przetwarzania, przenoszenia danych i sprzeciwu oraz
wycofania zgody, gdy jest ona podstawą przetwarzania — na warunkach określonych
w prawie. Możesz złożyć skargę do organu nadzorczego ochrony danych. Więcej
w [informacjach Komisji Europejskiej](https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en).

Tubevra zarządza danymi lokalnymi i połączeniami opisanymi powyżej. Jej autor
odpowiada za własne operacje przetwarzania w zakresie wynikającym z obowiązującego
prawa. Google/YouTube, SponsorBlock i Return YouTube Dislike odpowiadają za przetwarzanie, o którego celach
i sposobach decydują w swoich usługach. Wnioski dotyczące tego przetwarzania kieruj
do odpowiednich administratorów danych, korzystając z kanałów kontaktu w ich
politykach prywatności.

Lokalne ustawienia i dane stron możesz usunąć zgodnie z opisem w sekcji
[Usuwanie danych](#usuwanie-danych). Nie usuwa to danych przechowywanych przez
usługi zewnętrzne.

Pytania o Tubevrę możesz zgłaszać
w [repozytorium projektu](https://github.com/sthomsonpl/Tubevra); nie publikuj
cookies, tokenów ani danych osobowych.

## Return YouTube Dislike

Rozszerzenie jest domyślnie wyłączone. Po włączeniu rozpoznaje potwierdzony film w YouTube TV i pobiera oceny również przy schowanym docku.
Wywołana usługa wysyła pełne ID filmu do returnyoutubedislikeapi.com, aby pobrać
szacunkowe liczby Like/Dislike. Usługodawca otrzymuje adres IP i metadane żądania.
Połączenia korzystają z osobnej nietrwałej sesji bez cookies YouTube i danych konta.
Nie wysyłamy głosów. Wyniki pozostają w RAM i znikają po wyłączeniu lub zamknięciu
aplikacji. Tylko znaczniki czasu limitów pozostają przez wyłączenie i ponowne
włączenie w obrębie procesu. Wyłączenie rozszerzenia zatrzymuje żądania.
Zobacz [informacje o usługodawcy](THIRD_PARTY_NOTICES.md).

Lokalny panel ocen pokazuje istniejący wynik RYD razem z dockiem oraz przez krótki
czas po potwierdzonej zmianie filmu.
Pokazywanie i ukrywanie panelu nie powoduje dodatkowych żądań RYD ani wysyłania jego zawartości.
