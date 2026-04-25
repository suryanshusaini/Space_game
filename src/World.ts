/**
 * src/World.ts
 * ASTRA INFINITUM — WorldManager (Floating Origin System)
 *
 * The player is always at world-space (0,0,0).
 * Every scene object is repositioned relative to playerECI each frame.
 * This eliminates floating-point jitter at planetary distances.
 */

import * as THREE from 'three';
import type { StateVec } from './physics';

export class WorldManager {
  /** True 64-bit ECI position of the player (metres) */
  playerECI: StateVec;

  /** Offset applied to every scene object this frame */
  readonly originOffset = new THREE.Vector3();

  constructor(initialECI: StateVec) {
    this.playerECI = { ...initialECI };
  }

  /**
   * Call once per frame BEFORE updating scene object positions.
   * Computes the translation that maps player ECI → world (0,0,0).
   */
  update(newECI: StateVec): void {
    this.playerECI = newECI;
    this.originOffset.set(
      -newECI.px,
      -newECI.py,
      -newECI.pz,
    );
  }

  /**
   * Translate an ECI position into world-space coordinates.
   * Use this for every object that orbits/sits in ECI space.
   */
  toWorldPos(eciX: number, eciY: number, eciZ: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(
      eciX + this.originOffset.x,
      eciY + this.originOffset.y,
      eciZ + this.originOffset.z,
    );
  }

  /** Convenience: translate a StateVec into world-space position. */
  stateToWorld(state: StateVec, out = new THREE.Vector3()): THREE.Vector3 {
    return this.toWorldPos(state.px, state.py, state.pz, out);
  }

  /** Current altitude above Earth surface in metres */
  get altitude(): number {
    const { px, py, pz } = this.playerECI;
    return Math.sqrt(px * px + py * py + pz * pz) - 6_371_000;
  }
}
