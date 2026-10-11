/* Pravila razporejanja z obdobjem veljavnosti (za zavihek »Pravila razporejanja«). Brez DOM –
   deluje v brskalniku (window.KSRules) in v Node.
   Vsako pravilo ima obvezen `from` (prvi dan veljavnosti); `to` je zadnji dan veljavnosti, brez njega pravilo
   velja še zdaj. Ob spremembi pravila: staremu vnosu nastavi `to`, dodaj nov vnos z istim `id` in `from`
   naslednji dan. Navodila za vzdrževanje so v CLAUDE.md. */
(function (root) {
  'use strict';

  const START = '2026-10-07'; // začetek zgodovine pravil
  const UNDO_LIMIT = 20; // največ korakov razveljavitve v zavihku Razpored (uporablja app.js)

  const GROUPS = [
  { section: 'Dnevi in kapaciteta', rules: [
    { id: 'vrste-dni', from: START,
      text: 'Vsak dan spada v eno od treh vrst: delavnik (ponedeljek–petek), sobota ali nedelja/praznik. ' +
        'Praznik, ki pade na delavnik ali soboto, šteje kot nedelja.' },
    { id: 'prazniki', from: START,
      text: 'Upoštevajo se slovenski dela prosti dnevi: novo leto (1. in 2. 1.), Prešernov dan (8. 2.), ' +
        'velika noč in velikonočni ponedeljek, dan upora proti okupatorju (27. 4.), praznik dela (1. in 2. 5.), ' +
        'binkošti, dan državnosti (25. 6.), Marijino vnebovzetje (15. 8.), dan reformacije (31. 10.), ' +
        'dan spomina na mrtve (1. 11.), božič (25. 12.) ter dan samostojnosti in enotnosti (26. 12.).' },
    { id: 'privzeta-kapaciteta', from: START,
      text: 'Kapaciteta (največ oseb na dan) se nastavi za vsak hodnik posebej po vrsti dneva. ' +
        'Privzeto: delavnik 3, sobota 1, nedelja/praznik 0.' },
    { id: 'izjeme', from: START,
      text: 'Izjema za posamezen datum (✎ v koledarju) ima prednost pred privzeto kapaciteto – z njo lahko dan ' +
        'zapremo (0), omejimo ali omogočimo kopanje tudi na nedeljo ali praznik.' },
    { id: 'kapaciteta-0', from: START,
      text: 'Dan s kapaciteto 0 ni veljaven za kopanje in se pri sestavi preskoči.' }
  ] },
  { section: 'Osebe', rules: [
    { id: 'interval', from: START,
      text: 'Vsaka oseba ima interval kopanja v dnevih (privzeto 10, najmanj 1). Želeni razmik med dvema ' +
        'kopanjema je enak intervalu.' },
    { id: 'dovoljeni-dnevi', from: START,
      text: 'Oseba ima lahko izbrane dovoljene dneve v tednu; če ni izbran noben, so dovoljeni vsi dnevi. ' +
        'Na nedovoljen dan se oseba ne razporedi.' },
    { id: 'neaktivne', from: START,
      text: 'Neaktivne osebe se ne razporejajo in se ne upoštevajo pri izračunu potrebne kapacitete.' },
    { id: 'omejitve-datumov', from: START, to: '2026-10-11',
      text: 'Za osebo lahko v urejevalniku dneva (✎, »Se ne more kopati«) označimo posamezne dneve, ko se ne more ' +
        'kopati (npr. pregled, obisk). Tak dan za osebo velja kot nedovoljen – pri sestavi in pri preverjanju.' },
    { id: 'omejitve-datumov', from: '2026-10-12',
      text: 'Za osebo lahko označimo dneve, ko se ne more kopati (npr. pregled, obisk, bolnišnica): posamezne dneve ' +
        'v urejevalniku dneva (✎, »Se ne more kopati«) ali obdobje od–do (največ 366 dni) v obrazcu osebe. ' +
        'Tak dan za osebo velja kot nedovoljen – pri sestavi in pri preverjanju. Omejitve, starejše od 400 dni, ' +
        'se ob zagonu aplikacije samodejno izbrišejo.' }
  ] },
  { section: 'Roki', rules: [
    { id: 'rok', from: START,
      text: 'Rok osebe je zadnje kopanje + interval. Po vsaki razporeditvi se rok premakne na ta dan + interval.' },
    { id: 'zgodovina', from: START,
      text: 'Zadnje kopanje se vzame iz shranjenih razporedov prejšnjih mesecev istega hodnika, zato je ' +
        'treba mesece sestavljati po vrsti. Kopanje, starejše od 2 × interval + 7 dni pred začetkom meseca, ' +
        'se ne upošteva (oseba velja, kot da zgodovine nima).' },
    { id: 'prvi-roki', from: START,
      text: 'Osebam brez zgodovine se prvi rok določi v prvem intervalu meseca: vsaka dobi tisti dovoljen dan, ' +
        'ki je glede na kapaciteto najmanj zaseden (ob enakosti prejšnji). Najprej se rok določi osebam ' +
        'z najmanj dovoljenimi dnevi v mesecu, nato po imenu. Če v prvem intervalu ni nobenega dovoljenega ' +
        'dneva, je rok prvi dovoljen dan v mesecu.' }
  ] },
  { section: 'Sestavljanje dan za dnem', rules: [
    { id: 'kandidati', from: START,
      text: 'Razpored se sestavlja po veljavnih dnevih meseca od prvega do zadnjega. Kandidati za dan so ' +
        'aktivne osebe, ki jim je ta dan dovoljen in jim je rok že potekel ali poteče ta dan.' },
    { id: 'dan-prej', from: START,
      text: 'Oseba je kandidat tudi pred rokom, če bi bil njen naslednji možni dan (dovoljen in veljaven) ' +
        'po roku vsaj toliko dni, kot bi bila zdaj prezgodaj. Oseba z rokom na nedeljo je tako kandidat že ' +
        'v soboto; ali dobi mesto, je odvisno od kapacitete in vrstnega reda, sicer gre na drug dan ' +
        '(zaradi pogleda naprej lahko tudi v petek ali pa v ponedeljek).' },
    { id: 'vrstni-red', from: START,
      text: 'Kandidati se razvrstijo po zamudi (največja najprej), nato po številu dovoljenih dni v mesecu ' +
        '(manj najprej), nato po imenu. Izbere se jih največ toliko, kolikor je kapaciteta dneva.' },
    { id: 'pogled-naprej', from: START,
      text: 'Če ostanejo prosta mesta, se pregledajo naslednji 4 veljavni dnevi (iz naslednjega meseca le tisti ' +
        'v njegovih prvih 8 dneh). Za ta obdobja se primerja, koliko oseb bo do tedaj potrebovalo mesto (z rokom ' +
        'do tega dne, vključno z osebami v zamudi, ki danes niso dobile mesta), s številom mest. Če bo mest ' +
        'premalo, se danes razporedi toliko dodatnih oseb, kolikor mest bo zmanjkalo (a ne več, kot je danes ' +
        'prostih): izmed oseb, ki jim je današnji dan dovoljen in jim rok poteče v največ max(1, ⌊interval / 5⌋) ' +
        'dneh (pri intervalu 10 torej v 2 dneh) – najprej tiste z najbližjim rokom, nato tiste z več dovoljenimi ' +
        'dnevi, nato po imenu. Malo prej je bolje kot zamuda.' }
  ] },
  { section: 'Opozorila in informacije', rules: [
    { id: 'opozorila-vir', from: START,
      text: 'Opozorila se vedno izračunajo iz dejanskega razporeda, tudi ročno popravljenega. Ravni: napaka ' +
        '(rdeče), opozorilo in informacija; informacije se štejejo posebej.' },
    { id: 'napaka-kapaciteta', from: START,
      text: 'Napaka »Kapaciteta premajhna«: ocena potrebnih kopanj, zaokrožena na celo število (za vsako aktivno ' +
        'osebo, ki ima v mesecu vsaj en veljaven dovoljen dan: dni v mesecu / interval), presega vsoto kapacitet ' +
        'veljavnih dni v mesecu.' },
    { id: 'napaka-dan-v-tednu', from: START,
      text: 'Napaka, ko je na en sam dan v tednu vezanih toliko oseb, da potrebujejo več mest na teden ' +
        '(7 / interval na osebo), kot je privzeta kapaciteta tega dneva.' },
    { id: 'napaka-dan', from: START,
      text: 'Napaka za dan, ki ni veljaven, a so nanj razporejene osebe, in za dan z več razporejenimi, ' +
        'kot je kapaciteta.' },
    { id: 'napaka-oseba-dan', from: START,
      text: 'Napaka, ko je oseba razporejena na zanjo nedovoljen dan v tednu.' },
    { id: 'napaka-omejitev', from: START,
      text: 'Napaka, ko je oseba razporejena na dan, ko se ne more kopati (omejitev).' },
    { id: 'napaka-ni-dneva', from: START,
      text: 'Napaka, ko aktivna oseba v mesecu nima nobenega veljavnega in dovoljenega dneva.' },
    { id: 'opozorilo-neaktivna', from: START,
      text: 'Opozorilo, ko je razporejena neaktivna oseba, in ko aktivna oseba brez zgodovine v mesecu ni ' +
        'razporejena.' },
    { id: 'zamuda', from: START,
      text: 'Razmik od prejšnjega kopanja, daljši od intervala, je opozorilo z dnevi zamude – razen če med ' +
        'rokom (tudi če je bil še v prejšnjem mesecu) in tem kopanjem ni bilo nobenega dneva, ko bi se oseba ' +
        'lahko kopala; takrat je le informacija.' },
    { id: 'prekratek-razmik', from: START,
      text: 'Informacija, ko je razmik od prejšnjega kopanja krajši od polovice intervala (zaokroženo navzgor).' },
    { id: 'konec-meseca', from: START,
      text: 'Opozorilo, ko je rok po zadnjem kopanju (lahko tudi iz prejšnjega meseca) na ali pred zadnjim ' +
        'dovoljenim dnem tega meseca, oseba pa do konca meseca ni več razporejena.' }
  ] },
  { section: 'Ročni popravki', rules: [
    { id: 'rocni-popravki', from: START, to: '2026-10-11',
      text: 'Razpored lahko ročno popravimo: klik na ime ga izbere, klik na drug dan ga premakne, × ga odstrani, ' +
        '+ doda osebo. Popravki niso blokirani; težave (npr. presežena kapaciteta, nedovoljen dan) se izpišejo ' +
        'kot opozorilo in v seznamu opozoril.' },
    { id: 'rocni-popravki', from: '2026-10-12',
      text: 'Razpored lahko ročno popravimo: klik na ime ga izbere, klik na drug dan ga premakne, × ga odstrani, ' +
        '+ doda osebo. Popravki niso blokirani; težave (npr. presežena kapaciteta, nedovoljen dan) se izpišejo ' +
        'kot opozorilo in v seznamu opozoril. Zadnjih 20 sprememb v zavihku Razpored (premiki, dodajanja, ' +
        'odstranitve, izjeme, omejitve, sestava, brisanje) lahko razveljavimo z gumbom »Razveljavi« ali Ctrl+Z; ' +
        'ob spremembi hodnikov ali oseb se zgodovina razveljavitev izbriše.' },
    { id: 'ponovna-sestava', from: START,
      text: 'Spremembe kapacitet, izjem, oseb in omejitev ne spremenijo že sestavljenega razporeda – upoštevajo se ' +
        'šele ob ponovnem kliku »Sestavi«. Izjema: izbrisana oseba se takoj odstrani iz vseh shranjenih ' +
        'razporedov. Ročno popravljen razpored se na novo sestavi le po potrditvi (popravki se izgubijo).' },
    { id: 'zaporedje-mesecev', from: '2026-10-12',
      text: 'Če razpored prejšnjega meseca ni sestavljen (a hodnik ima starejše razporede), sestava meseca ' +
        'zahteva potrditev. Ko se razpored meseca sestavi na novo, ročno popravi ali izbriše, se razporedi ' +
        'kasnejših mesecev istega hodnika označijo kot zastareli (opozorilo); oznaka izgine ob njihovi ' +
        'ponovni sestavi.' }
  ] }
  ];

  const SECTIONS = GROUPS.map(g => g.section).filter((s, i, all) => all.indexOf(s) === i);
  // Vsa pravila v enem seznamu: { id, section, from, to, text }; razdelek določa skupina.
  const RULES = GROUPS.flatMap(g => g.rules.map(r => Object.assign({ to: null }, r, { section: g.section })));

  // Ali pravilo velja na dan `iso` (oba konca obdobja sta vključena).
  function validOn(rule, iso) { return rule.from <= iso && (!rule.to || iso <= rule.to); }

  const api = { START, UNDO_LIMIT, SECTIONS, RULES, validOn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KSRules = api;
})(this);
