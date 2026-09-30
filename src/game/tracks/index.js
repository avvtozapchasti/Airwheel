// Реестр трасс. Каждая трасса — только данные (см. alpine.js).
import ALPINE from './alpine.js';
import STREET from './street.js';
import COASTAL from './coastal.js';

export const TRACKS = [ALPINE, COASTAL, STREET];
export const TRACK_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t]));
