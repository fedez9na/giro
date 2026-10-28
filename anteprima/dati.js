// La giornata di prova: la copia anonima del foglio (test/fogli/esempio-anonimo.pdf, nomi finti), letta come la legge
// l'app (testi.js: nomi, lavori, note). Ora finta: le 9:35, Pogliano già segnato OK.
export const ADESSO = 9 * 60 + 35;
export const DATA = 'martedì 27 ottobre';

export const INTERVENTI = [
  { comune: 'Pogliano Milanese', cliente: 'Rossi Mario', lavoro: 'Fastweb 3.5', da: '8:30', a: '9:00', nota: '', cielo: 'sole', esito: 'OK' },
  { comune: 'Busto Arsizio', cliente: 'Bianchi Lucia', lavoro: 'Installazione Kolme', da: '10:00', nota: '', cielo: 'sole-nuvole' },
  { comune: 'Tradate', cliente: 'Verdi Anna', lavoro: 'Installazione Kolme', da: '11:00', a: '11:30', nota: '', cielo: 'sole-nuvole' },
  { comune: 'Tradate', cliente: 'Neri Paolo', lavoro: 'Disinstallazione Fastweb', da: '12:00', a: '12:30', nota: '', cielo: 'nuvole' },
  { comune: 'Tradate', cliente: 'Galli Sara', lavoro: 'Disinstallazione Fastweb', da: '13:30', nota: 'Puntuale, chiamalo prima', cielo: 'nuvole' },
  { comune: 'Venegono Inferiore', cliente: 'Costa Giorgio Ferri', lavoro: 'Fastweb 3.5 + ext.', da: '14:00', a: '14:30', nota: 'non prima delle 14:00', cielo: 'nuvole' },
  { comune: 'Fagnano Olona', cliente: 'Zeta Ottavia', lavoro: 'Installazione Kolme', da: '16:15', nota: 'non prima delle 16:15', cielo: 'pioggia', meteo: 'Pioggia 70%' },
];

export const minuti = t => { const [h, m] = t.split(':'); return +h * 60 + +m; };
export const durata = m => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
export const quando = i => (i.a ? `${i.da}–${i.a}` : i.da);

// il punto stretto, come margini.js: fra ciò che resta, i due inizi più vicini (strada compresa)
export function puntoStretto(lista) {
  const resta = lista.filter(i => !i.esito);
  let meglio = null;
  for (let k = 0; k + 1 < resta.length; k++) {
    const m = minuti(resta[k + 1].da) - minuti(resta[k].da);
    const p = !!(resta[k].nota.includes('Puntuale') || resta[k + 1].nota.includes('Puntuale'));
    if (!meglio || m < meglio.minuti || (m === meglio.minuti && p && !meglio.puntuale)) meglio = { da: resta[k], a: resta[k + 1], minuti: m, puntuale: p };
  }
  return meglio;
}
