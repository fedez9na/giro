// I tre tasti aprono le app che Riccardo usa già. Via e numero vanno SOLO in questi link, che apre lui con un tocco.

const nome = s => s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, l => l.toUpperCase());
const numero = t => {
  const d = String(t ?? '').replace(/[^\d+]/g, '').replace(/^00/, '+');
  if (!d) return null;
  return d.startsWith('+') ? d.slice(1) : `39${d}`;
};

export function naviga(i) {
  const dove = [i.via, nome(i.comune), 'Italia'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&${new URLSearchParams({ destination: dove, travelmode: 'driving', dir_action: 'navigate' })}`;
}

export const chiama = i => (numero(i.telefono) ? `tel:+${numero(i.telefono)}` : null);

const LAVORO = {
  'FASTWEB 3.5': 'l’installazione Fastweb', 'FASTWEB 3.5 + EXT.': 'l’installazione Fastweb',
  'INS.KOLME': 'l’installazione Kolme', 'DIS. FASTWEB': 'la disinstallazione Fastweb',
};

// Il nome con cui si presenta lo sceglie Riccardo (il foglio non dice quale parola è il nome di battesimo).
export function testoArrivo(i, ora, chiSono) {
  const chi = chiSono ? `sono ${chiSono}, il tecnico` : 'sono il tecnico';
  return `Buongiorno, ${chi} per ${LAVORO[i.tipologia] ?? `l’intervento ${i.tipologia}`}. ${ora ? `Arrivo verso le ${ora}.` : 'Arrivo a breve.'}`;
}

// Senza numero WhatsApp fa scegliere il contatto: il testo è già scritto.
export const stoArrivando = (i, testo) => `https://wa.me/${numero(i.telefono) ?? ''}?text=${encodeURIComponent(testo)}`;
