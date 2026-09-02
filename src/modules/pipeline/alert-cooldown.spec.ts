import { AlertCooldown } from './alert-cooldown';

const NOW = 1_800_000_000_000;

describe('AlertCooldown', () => {
  it('admits the first candidate and refuses the next inside the window', () => {
    const cooldown = new AlertCooldown(60);

    expect(cooldown.admit('camera-a', 'zone-1', 'intruder', NOW)).toBe(true);
    expect(cooldown.admit('camera-a', 'zone-1', 'intruder', NOW + 1)).toBe(
      false,
    );
  });

  it('admits again once the window has elapsed', () => {
    const cooldown = new AlertCooldown(60);
    cooldown.admit('camera-a', 'zone-1', 'intruder', NOW);

    expect(cooldown.admit('camera-a', 'zone-1', 'intruder', NOW + 60_001)).toBe(
      true,
    );
  });

  /** A different alert type on the same zone is new information. */
  it('does not suppress a different alert type on the same zone', () => {
    const cooldown = new AlertCooldown(60);
    cooldown.admit('camera-a', 'zone-1', 'intruder', NOW);

    expect(cooldown.admit('camera-a', 'zone-1', 'suspicious', NOW)).toBe(true);
  });

  it('keeps zones and cameras apart', () => {
    const cooldown = new AlertCooldown(60);
    cooldown.admit('camera-a', 'zone-1', 'intruder', NOW);

    expect(cooldown.admit('camera-a', 'zone-2', 'intruder', NOW)).toBe(true);
    expect(cooldown.admit('camera-b', 'zone-1', 'intruder', NOW)).toBe(true);
  });

  /** A full-frame camera carries no zone, and must still get a window. */
  it('gives a full-frame camera a window of its own', () => {
    const cooldown = new AlertCooldown(60);

    expect(cooldown.admit('camera-a', null, 'intruder', NOW)).toBe(true);
    expect(cooldown.admit('camera-a', null, 'intruder', NOW + 1)).toBe(false);
  });

  it('admits everything at a zero window', () => {
    const cooldown = new AlertCooldown(0);

    expect(cooldown.admit('camera-a', 'zone-1', 'intruder', NOW)).toBe(true);
    expect(cooldown.admit('camera-a', 'zone-1', 'intruder', NOW)).toBe(true);
  });

  it('drops every window a camera held when it is reset', () => {
    const cooldown = new AlertCooldown(60);
    cooldown.admit('camera-a', 'zone-1', 'intruder', NOW);
    cooldown.admit('camera-a', null, 'suspicious', NOW);
    cooldown.admit('camera-b', 'zone-1', 'intruder', NOW);

    cooldown.reset('camera-a');

    expect(cooldown.admit('camera-a', 'zone-1', 'intruder', NOW)).toBe(true);
    expect(cooldown.admit('camera-a', null, 'suspicious', NOW)).toBe(true);
    expect(cooldown.admit('camera-b', 'zone-1', 'intruder', NOW)).toBe(false);
  });
});
