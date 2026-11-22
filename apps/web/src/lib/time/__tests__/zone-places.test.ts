import { zonePlace } from '../zones';
import { ZONE_PLACES_AR } from '../zone-places-ar';

describe('zonePlace', () => {
  it('names the place in Arabic from the generated table, never a Latin city (AUDIT-2)', () => {
    expect(zonePlace('America/New_York', 'ar')).toBe('نيويورك');
    expect(zonePlace('Africa/Cairo', 'ar')).toBe('مصر');
  });

  it('keeps no Latin letter, digit or offset in any Arabic place', () => {
    for (const place of Object.values(ZONE_PLACES_AR)) expect(place).not.toMatch(/[A-Za-z0-9٠-٩]|GMT|UTC/);
  });

  it('takes the city from the zone id in English', () => {
    expect(zonePlace('America/New_York', 'en')).toBe('New York');
  });
});
