/**
 * World layout. The sheet of rice paper IS the ground of the 3D world: a square of
 * WORLD units centred on the origin. Every stroke is stored in world xz, the ink map
 * covers the same square in UV space, and the heightfield covers it in texels, so a
 * mark on the paper and the mountain that rises from it always share coordinates.
 */
export const WORLD = 240
export const HALF = WORLD / 2
/** heightfield texels per side (fixed for every quality level → deterministic worlds) */
export const GRID = 320
export const CELL = WORLD / GRID
/** flat ground level of the paper (and of the endless paper beyond it) */
export const BASE_LEVEL = 0.6
/** rivers fill their carved channels up to this height */
export const WATER_LEVEL = 0
/** before AWAKEN the world is pressed into the paper at this vertical scale */
export const PAPER_SCALE_Y = 0.42

export const LIMITS = {
  mountains: 18,
  rivers: 8,
  trees: 64,
  bridges: 8,
}

export type BrushKind = 'mountain' | 'river' | 'life' | 'bridge'
export const BRUSHES: BrushKind[] = ['mountain', 'river', 'life', 'bridge']
