/** Line art for the visor panels (visor-hud spec). Weapons are side views with the muzzle toward the screen centre. */
import type { WeaponId } from '../../../render/viewmodel/rig.ts';

/** Stroked outlines. Each box is cut to its weapon; the CSS sizes keep the two believable beside each other. */
export const SILHOUETTES: Record<WeaponId, { viewBox: string; d: string }> = {
  pistol: { viewBox: '82 4 96 46', d: [
    // Slide, grip and frame in one outline.
    'M84 9H166L171 13V20H168L176 46L155 48L147 31C146 30 145 30 143 30H134C129 30 127 28 127 23H88V20H84Z',
    'M88 20H168',
    // Trigger guard and trigger.
    'M132 23C132 25 133 26 136 26H143L142 23',
    'M138 23Q136 24.5 138 26',
    // Sights, ejection port and rear serrations.
    'M89 9V6H93V9M159 9V6H164V9',
    'M110 12H124V16H110Z',
    'M151 12V17M155 12V17M159 12V17',
  ].join('') },
  shotgun: { viewBox: '2 6 178 37', d: [
    // Barrel with its bead, and the tube magazine under it. Both break where the pump covers them.
    'M36 19H4V14H102V19H74M8 14V11H11V14',
    'M12 19V24H36M74 24H102',
    // Pump grip.
    'M36 18H74V28H36ZM45 20V26M53 20V26M61 20V26M69 20V26',
    // Receiver, ejection port and trigger guard.
    'M102 12H134L137 15V27H102Z',
    'M110 15H126V20H110Z',
    'M117 27C117 33 120 35 126 35H131L129 27',
    'M124 27Q122 30 124 32',
    // Stock.
    'M137 15L150 17L174 18L177 39L167 41L146 29L137 27',
  ].join('') },
};

/** One round in the pistol's pip row (8 x 22). */
export const CARTRIDGE = { viewBox: '0 0 8 22', body: 'M1 15V9C1 4 2.5 1 4 1S7 4 7 9V15Z', base: 'M1 17H7V21H1Z' };

/** One shell in the shotgun's row (14 x 30). */
export const SHELL = { viewBox: '0 0 14 30', body: 'M2.5 1.5H11.5V20H2.5Z', base: 'M1.5 22H12.5V28.5H1.5Z' };

export const HEART = 'M8 13L2 7C0 5 0 2.6 1.8 1.4C3.8 .1 6.4 .8 8 3C9.6 .8 12.2 .1 14.2 1.4C16 2.6 16 5 14 7Z';
