# Plan kopanja

Preprosta spletna aplikacija za vodenje oseb po hodnikih in samodejno sestavo mesečnega razporeda kopanja.

## Zagon

Dvoklik na `index.html` (odpre se v brskalniku, deluje brez strežnika in brez interneta).
Podatki se shranjujejo v brskalnik (`localStorage`) – **redno izvozite varnostno kopijo** (zavihek *Varnostna kopija*).

## Uporaba

1. **Hodniki** – z gumbom **+ Nov hodnik** (ali »Uredi« v tabeli) odprete pojavno okno; vnesite ime in največje število oseb na dan: od ponedeljka do petka (privzeto 3),
   ob sobotah (privzeto 1) ter ob nedeljah in praznikih (privzeto 0). 0 pomeni, da se ta dan ne kopa.
   Za posamezne dneve lahko nastavite izjeme (npr. `24.12.2026 = 0` ali `26.12.2026 = 2`) – v obrazcu
   hodnika ali neposredno v koledarju z gumbom ✎.
2. **Osebe** – izberite hodnik in z gumbom **+ Nova oseba** dodajte osebe: soba, opomba, na koliko dni se kopa (privzeto 10) in
   dovoljeni dnevi v tednu (nič izbranega = vsi). Pri osebi, ki se kopa samo en dan v tednu (npr. samo ob torkih),
   se interval samodejno predlaga na 7 dni. **Shrani in dodaj novo** shrani osebo in pusti okno odprto za naslednji vnos.
   **Uvozi seznam** doda več oseb naenkrat: prilepite vrstice `soba,ime` (npr. iz Excela ali CSV z glavo
   `Soba,Priimek in ime`; ločilo je lahko vejica, podpičje ali tabulator, ločena stolpca `Priimek` in `Ime` se združita).
   Osebe, ki na hodniku že obstajajo, se preskočijo; predogled pokaže število novih oseb in prvo med njimi.
   Klik na glavo stolpca tabelo razvrsti (ponovni klik obrne vrstni red), polja pod glavo jo filtrirajo
   (iskanje ne loči velikih črk in šumnikov, npr. `zupancic` najde »ŽUPANČIČ«).
3. **Razpored** – izberite hodnik in mesec ter kliknite **Sestavi**.
   - Ročni popravki: klik na ime ga izbere (obarvajo se tudi vsi ostali termini te osebe v mesecu), klik na drug dan ga premakne; `×` odstrani; `+` doda osebo.
   - `✎` na dnevu nastavi izjemo (največ oseb ta dan); »Privzeto« izjemo odstrani. Dnevi z izjemo imajo črtkan rob.
     V istem urejevalniku pod »Se ne more kopati:« izberete osebe, ki se ta dan ne morejo kopati (npr. pregled,
     obisk); `×` omejitev odstrani. Osebe z omejitvijo so v celici dneva izpisane za znakom `⊘` (ne natisnejo se).
     Po spremembi izjem ali omejitev kliknite **Sestavi**, da se razpored ponovno sestavi.
   - Opombe oseb so ob imenu označene s številko, besedilo opomb je pod koledarjem (tudi na natisu).
   - Pod koledarjem so opozorila (presežena kapaciteta, zamude, nedovoljeni dnevi …) in povzetek po osebah.
     Povzetek kaže razmike med kopanji; prvi, v oklepaju, je od zadnjega kopanja v prejšnjem mesecu. Razmiki,
     daljši od intervala, so oranžni, zelo kratki pa sivi.
   - **Natisni** natisne koledar na list A4 (ležeče).
4. **Varnostna kopija** – izvoz/uvoz vseh podatkov v datoteko JSON.
5. **Pravila razporejanja** – podroben opis pravil sestavljanja koledarja. Pri vsakem pravilu je navedeno, od kdaj
   velja; z izbiro datuma se prikažejo pravila, ki so veljala tisti dan, pravila, ki ne veljajo več, pa so spodaj
   z obdobjem veljavnosti.

## Kako deluje razporejanje

Na kratko: rok osebe je zadnje kopanje + interval (zadnje kopanje iz razporeda prejšnjih mesecev, zato razporede
sestavljajte po vrsti); dan za dnem se do kapacitete izberejo osebe, ki jim je rok potekel – tudi dan prej, če bi bil
naslednji možni dan preveč po roku, in nekoliko prej, če se v naslednjih dneh obeta gneča. Opozorila se vedno
izračunajo iz dejanskega (tudi ročno popravljenega) razporeda.

Podrobna pravila z obdobji veljavnosti so v zavihku **Pravila razporejanja** (vir: `js/rules.js`).

## Testi

```
node tests/scheduler.test.js
```

ali odprite `tests/scheduler.test.html` v brskalniku.

## Struktura

- `index.html`, `css/style.css` – vmesnik in tiskanje
- `js/holidays.js` – slovenski dela prosti dnevi (vključno z veliko nočjo)
- `js/scheduler.js` – algoritem razporejanja in analiza opozoril (brez DOM)
- `js/storage.js` – localStorage, izvoz/uvoz JSON
- `js/csv.js` – razčlenjevanje prilepljenega seznama oseb
- `js/rules.js` – besedilo pravil razporejanja z obdobji veljavnosti (zavihek »Pravila razporejanja«)
- `js/app.js` – uporabniški vmesnik
