/**
 * What the store screenshots show (docs/decisions.md, Store publishing T24), per language.
 * Everything is made up: the pages are fixtures on reserved `.example` hosts,
 * the providers and models are fictional names on the local mock LLM.
 */

export type Lang = 'en' | 'de';

export interface StorePage {
  /** A file in `tests/fixtures/pages`. */
  file: string;
  /** A fictional host under the reserved `.example` TLD, routed to the fixture server. */
  host: string;
}

export interface StoreContent {
  /** The browser locale the screenshots are taken in. */
  locale: string;
  /** Pinned in this order, so they are sources 1, 2 and 3. */
  pages: [StorePage, StorePage, StorePage];
  /** Older sessions for the sessions drawer, oldest first, with their age in minutes. */
  olderSessions: [string, number][];
  /** The name the main session is given (it starts named after its first pin). */
  sessionTitle: string;
  question: string;
  answer: string;
  summary: string;
  providers: { local: string; lab: string };
}

/** Fictional model names served by the mock LLM. */
export const MODELS = ['nova-2', 'nova-2-mini', 'orion-mini'];

const EN_ANSWER = [
  'Three new night routes start with the December 2027 timetable [1]:',
  '',
  '- **Brussels – Prague**, three nights a week [1]',
  '- **Munich – Rome**, every night from spring [1]',
  '- **Hamburg – Copenhagen – Stockholm**, extended to Oslo in summer [1]',
  '',
  'A bed in a six-berth couchette starts at **€69**, and a private sleeper compartment at **€159** for one or two people [2].',
  '',
  'Tickets often cost more than a flight because night trains pay track charges for every kilometre, run with staff all night and carry fewer people per carriage [3].',
].join('\n');

const EN_SUMMARY = [
  '## TL;DR',
  '',
  'Night trains are returning to Europe with three new routes in 2027 [1]. Beds start at €69 [2], but running costs keep fares above many flights [3].',
  '',
  '## Detailed summary',
  '',
  '### Night trains are back [1]',
  '',
  'Brussels – Prague, Munich – Rome and Hamburg – Stockholm join the timetable. Capacity remains the main limit.',
  '',
  '### Seat, couchette or sleeper [2]',
  '',
  'Seats from €39, couchette beds from €69, private sleepers from €159 with breakfast.',
  '',
  '### Why a night train costs more [3]',
  '',
  'Track charges per kilometre, night staff and idle carriages by day.',
  '',
  '### Overall',
  '',
  'All three pages agree that demand is growing; they differ on whether prices can fall [1] [3].',
].join('\n');

const DE_ANSWER = [
  'Mit dem Fahrplan im Dezember 2027 starten drei neue Nachtzugstrecken [1]:',
  '',
  '- **Brüssel – Prag**, dreimal pro Woche [1]',
  '- **München – Rom**, ab dem Frühjahr täglich [1]',
  '- **Hamburg – Kopenhagen – Stockholm**, im Sommer bis Oslo [1]',
  '',
  'Ein Bett im Sechser-Liegewagen gibt es ab **69 €**, ein eigenes Schlafwagenabteil ab **159 €** für eine oder zwei Personen [2].',
  '',
  'Tickets sind oft teurer als ein Flug, weil Nachtzüge für jeden Kilometer Trassenentgelte zahlen, die ganze Nacht Personal brauchen und weniger Fahrgäste pro Wagen befördern [3].',
].join('\n');

const DE_SUMMARY = [
  '## TL;DR',
  '',
  'Nachtzüge kehren mit drei neuen Strecken 2027 nach Europa zurück [1]. Betten gibt es ab 69 € [2], doch die Betriebskosten halten die Preise über vielen Flügen [3].',
  '',
  '## Ausführliche Zusammenfassung',
  '',
  '### Die Nachtzüge kommen zurück [1]',
  '',
  'Brüssel – Prag, München – Rom und Hamburg – Stockholm kommen in den Fahrplan. Die Kapazität bleibt die größte Grenze.',
  '',
  '### Sitzplatz, Liegewagen oder Schlafwagen [2]',
  '',
  'Sitzplätze ab 39 €, Liegewagenbetten ab 69 €, eigene Schlafwagenabteile ab 159 € mit Frühstück.',
  '',
  '### Warum ein Nachtzug mehr kostet [3]',
  '',
  'Trassenentgelte pro Kilometer, Personal in der Nacht und Wagen, die tagsüber stillstehen.',
  '',
  '### Gesamt',
  '',
  'Alle drei Seiten sehen eine wachsende Nachfrage; sie sind uneins, ob die Preise sinken können [1] [3].',
].join('\n');

export const CONTENT: Record<Lang, StoreContent> = {
  en: {
    locale: 'en-US',
    pages: [
      { file: 'store-night-trains.en.html', host: 'railreview.example' },
      { file: 'store-sleeper-prices.en.html', host: 'slowtravel.example' },
      { file: 'store-rail-costs.en.html', host: 'transportweekly.example' },
    ],
    olderSessions: [
      ['Kitchen renovation budget', 60 * 24 * 12],
      ['Choosing a road bike', 60 * 24 * 3],
      ['Sourdough troubleshooting', 60 * 26],
      ['Podcast notes: urban design', 90],
    ],
    sessionTitle: 'Night trains across Europe',
    question: 'Which new routes start next year, and what does a bed cost?',
    answer: EN_ANSWER,
    summary: EN_SUMMARY,
    providers: { local: 'Local server', lab: 'Team gateway' },
  },
  de: {
    locale: 'de-DE',
    pages: [
      { file: 'store-night-trains.de.html', host: 'schienenblick.example' },
      { file: 'store-sleeper-prices.de.html', host: 'langsam-reisen.example' },
      { file: 'store-rail-costs.de.html', host: 'verkehrswoche.example' },
    ],
    olderSessions: [
      ['Budget für die Küchenrenovierung', 60 * 24 * 12],
      ['Ein Rennrad auswählen', 60 * 24 * 3],
      ['Sauerteig: Fehler finden', 60 * 26],
      ['Podcast-Notizen: Stadtplanung', 90],
    ],
    sessionTitle: 'Nachtzüge quer durch Europa',
    question: 'Welche neuen Strecken starten nächstes Jahr, und was kostet ein Bett?',
    answer: DE_ANSWER,
    summary: DE_SUMMARY,
    providers: { local: 'Lokaler Server', lab: 'Team-Gateway' },
  },
};
