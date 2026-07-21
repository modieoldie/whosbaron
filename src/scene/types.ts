import type * as THREE from "three";

/** What a hotspot does when it is clicked. */
export type HotspotAction =
  | { type: "focus-desk" }
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
