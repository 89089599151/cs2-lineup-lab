/**
 * The floor guard rejects only a known wrong level, while the atlas search uses
 * floor-aligned rows exclusively. A floor-aligned row is a *simulation candidate*,
 * never evidence that the smoke actually works in Counter-Strike 2.
 *
 * 0 = no walkable NAV polygon contains XY (unknown, NOT necessarily invalid)
 * 1 = endpoint is close in Z to a walkable NAV floor
 * 2 = endpoint overlaps walkable area(s), but on a different Z level
 */
export const UNKNOWN_SURFACE = 0;
export const FLOOR_ALIGNED = 1;
export const WRONG_LEVEL = 2;

export function assertAtlasQuality(atlas, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== atlas.rows?.length) {
    throw new Error('Данные проверки поверхности не соответствуют атласу Mirage.');
  }
  if (atlas.map !== 'de_mirage' || atlas.build !== '2000948') {
    throw new Error('Атлас Mirage обновился: проверку геометрии нужно пересчитать.');
  }
  if (bytes.some((value) => value > WRONG_LEVEL)) {
    throw new Error('Неизвестный статус проверки поверхности Mirage.');
  }
  return bytes;
}

export function isFloorCandidate(quality, rowIndex) {
  return quality?.[rowIndex] === FLOOR_ALIGNED;
}
