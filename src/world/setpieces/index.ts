import { labBFloor } from './labBFloor.ts';
import type { SetPiece } from './types.ts';

export type { SetPiece, SetPieceInstance, SetPieceLevel } from './types.ts';

/**
 * Every set piece, attached in this order once a level's rooms are built (content-layout spec, design D7). Kept by
 * hand, like the sound index: a new set piece adds its module and one line here, and `level.ts` stays unchanged.
 */
export const SET_PIECES: readonly SetPiece[] = [labBFloor];
