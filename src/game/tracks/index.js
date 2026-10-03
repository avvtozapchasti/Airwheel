// Реестр трасс. Каждая трасса — только данные (см. alpine.js).
import ALPINE from './alpine.js';
import STREET from './street.js';
import COASTAL from './coastal.js';
import HARBOR from './harbor.js';
import DESERT from './desert.js';
import SAKURA from './sakura.js';

export const TRACKS = [ALPINE, COASTAL, STREET, HARBOR, DESERT, SAKURA];
export const TRACK_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t]));
