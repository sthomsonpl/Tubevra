# Standard planowania implementacji

## 1. Cel

Dokument określa zasady przygotowywania planów implementacji w projekcie Tubevra.

Plan powinien zapewniać:

- Logiczną kolejność prac wynikającą z zależności technicznych.
- Stabilne fundamenty dla kolejnych etapów.
- Spójność z istniejącą architekturą.
- Wczesne identyfikowanie ryzyk i ograniczeń.
- Możliwość stopniowej weryfikacji poprawności.
- Unikanie zbędnej złożoności i przedwczesnych abstrakcji.

Zasady stosuje się proporcjonalnie do złożoności i ryzyka zadania. Nie każda zmiana wymaga wieloetapowego planu.

## 2. Analiza przed planowaniem

Przed przygotowaniem planu należy:

1. Przeanalizować odpowiednie fragmenty kodu i dokumentacji.
2. Zidentyfikować istniejące mechanizmy możliwe do ponownego wykorzystania.
3. Ustalić odpowiedzialności modułów i granice komunikacji.
4. Zidentyfikować zależności, ograniczenia oraz potencjalne ryzyka.
5. Oddzielić potwierdzone fakty od założeń wymagających weryfikacji.

Nie należy projektować nowych mechanizmów bez sprawdzenia, czy istniejąca architektura już rozwiązuje dany problem.

## 3. Kolejność implementacji

Etapy należy organizować według rzeczywistych zależności technicznych, a nie liczby plików, linii kodu czy arbitralnej wielkości zadań.

W zależności od charakteru funkcjonalności preferowana kolejność obejmuje:

1. Ustalenie kontraktów, odpowiedzialności i niezmienników.
2. Implementację podstawowych mechanizmów i logiki.
3. Integrację oraz obsługę komunikacji i cyklu życia.
4. Implementację zachowania widocznego dla użytkownika.
5. Weryfikację integracyjną i kryteria akceptacji.

Nie jest to obowiązkowy, sztywny schemat.

Niezależne komponenty mogą powstawać równolegle, jeżeli ich kontrakty są wystarczająco określone.

Plan powinien wyjaśniać istotne zależności oraz uzasadniać kolejność etapów.

## 4. Stabilne fundamenty

Każdy etap powinien dostarczać spójną podstawę dla prac, które od niego zależą.

Należy preferować:

- Jednoznaczne kontrakty i odpowiedzialności.
- Wykorzystanie istniejącej infrastruktury.
- Ograniczanie sprzężenia między modułami.
- Przewidywalną obsługę błędów i zwalnianie zasobów.
- Stopniowe wprowadzanie możliwych do zweryfikowania zmian.
- Zachowanie zgodności z istniejącym działaniem aplikacji.

Należy unikać:

- Abstrakcji tworzonych na podstawie hipotetycznych potrzeb.
- Równoległych mechanizmów realizujących tę samą odpowiedzialność.
- Tymczasowych rozwiązań wymagających przewidywalnej przebudowy w kolejnych etapach.
- Implementowania warstw zależnych od nieokreślonych kontraktów.

Stabilność fundamentów nie oznacza projektowania z góry wszystkich możliwych rozszerzeń systemu.

## 5. Struktura etapu

Każdy istotny etap planu powinien zawierać:

**Cel**
- Jaki rezultat ma zostać osiągnięty.

**Zakres**
- Co należy zaimplementować.
- Co pozostaje poza zakresem etapu.

**Zależności**
- Jakie wcześniejsze elementy muszą być gotowe.

**Implementacja**
- Główne odpowiedzialności i punkty integracji.
- Istotne kontrakty i ograniczenia techniczne.

**Weryfikacja**
- Odpowiednie testy i kryteria poprawności.

**Warunki ukończenia**
- Co musi zostać spełnione przed rozpoczęciem prac zależnych.

Nie należy sztucznie rozbudowywać opisu prostych etapów.

## 6. Ryzyka i bezpieczeństwo

Ryzyka należy identyfikować przed implementacją zależnych mechanizmów.

Szczególną uwagę należy poświęcić:

- Granicom zaufania między procesami Electron.
- Walidacji, autoryzacji i zakresowi uprawnień IPC.
- Cyklowi życia rozszerzeń i zwalnianiu zasobów.
- Operacjom asynchronicznym, anulowaniu i warunkom wyścigu.
- Komunikacji z usługami zewnętrznymi i niezaufanym danym.
- Trwałym ustawieniom, kompatybilności i regresjom.

Sposób weryfikacji powinien odpowiadać rzeczywistemu ryzyku danego etapu.

## 7. Weryfikacja przyrostowa

Testy należy planować wraz z implementacją mechanizmów, których dotyczą.

Nie należy odkładać całej weryfikacji do ostatniego etapu.

Każdy zakończony etap powinien pozostawiać odpowiedni fragment systemu w spójnym i możliwym do sprawdzenia stanie, o ile jest to praktycznie wykonalne.

Jeżeli etap nie może działać samodzielnie, należy określić, jak zweryfikować jego kontrakty lub zachowanie.

Testy końcowe powinny obejmować integrację komponentów oraz zachowania niemożliwe do potwierdzenia w izolacji.

## 8. Przegląd planu

Przed przedstawieniem planu należy sprawdzić:

1. Czy kolejność etapów wynika z rzeczywistych zależności?
2. Czy nie występują zależności cykliczne?
3. Czy kontrakty poprzedzają implementacje, które od nich zależą?
4. Czy istniejące mechanizmy są odpowiednio wykorzystywane?
5. Czy istotne ryzyka są uwzględnione wystarczająco wcześnie?
6. Czy każdy etap ma możliwe do sprawdzenia warunki ukończenia?
7. Czy plan nie powoduje przewidywalnej, zbędnej przebudowy wcześniejszych etapów?
8. Czy poziom szczegółowości jest adekwatny do zadania?

W razie potrzeby należy skorygować kolejność lub zakres etapów.

## 9. Zmiany podczas implementacji

Plan nie jest niezmienną specyfikacją.

Jeśli podczas implementacji pojawią się nowe ograniczenia lub zostaną podważone wcześniejsze założenia, należy:

1. Zidentyfikować wpływ na pozostałe etapy.
2. Wyjaśnić konieczne zmiany.
3. Zaktualizować odpowiednie zależności i kryteria akceptacji.
4. Unikać nieuzgodnionego rozszerzania zakresu lub wprowadzania nowych mechanizmów.

Nie należy kontynuować realizacji nieaktualnego planu wyłącznie w celu zachowania pierwotnej kolejności.

## 10. Etapy a historia Git

Etapy implementacji nie muszą odpowiadać commitom.

Granice commitów powinny wynikać z logicznych, spójnych zmian, a nie automatycznie z liczby etapów.

Nie należy tworzyć commitów ani modyfikować historii Git bez odpowiedniego upoważnienia.

## 11. Oddzielenie planowania od implementacji

Przygotowanie planu nie oznacza zgody na rozpoczęcie implementacji.

Nie należy automatycznie modyfikować kodu, tworzyć commitów ani publikować zmian wyłącznie na podstawie polecenia przygotowania planu.