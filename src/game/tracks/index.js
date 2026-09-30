// Реестр трасс. Каждая трасса — только данные (см. alpine.js).
import ALPINE from './alpine.js';
import STREET from './street.js';

export const TRACKS = [ALPINE, STREET];
export const TRACK_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t]));
