import type * as THREE from "three";

/** What a hotspot does when it is clicked. */
export type HotspotAction =
  /**
   * Take the camera in to the desk. `screen` names the panel that was tapped.
   * The desk view frames both and ignores it; the narrow-viewport reading view
   * uses it to decide which one to open on.
   */
  | { type: "focus-desk"; screen?: 0 | 1 }
  | { type: "card"; card: CardContent }
  | { type: "projects" };

export interface CardContent {
  eyebrow: string;
  title: string;
  body: string;
  meta?: string[];
  link?: { label: string; href: string; external?: boolean };
}

export interface Hotspot {
  /** The mesh (or group) the raycaster tests against. */
  object: THREE.Object3D;
  id: string;
  /** Shown in the floating label on hover. */
  label: string;
  action: HotspotAction;
  /** Meshes that get an emissive lift on hover. Defaults to `object`. */
  highlight?: THREE.Mesh[];
}

export interface SceneQuality {
  bloom: boolean;
  /** MSAA samples on the composer's offscreen buffer. */
  samples: number;
  pixelRatio: number;
}
