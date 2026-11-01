import { Color, Matrix3, Vector3 } from 'three'

/**
 * Uniform objects shared by reference across every chrome material, so the
 * studio environment is updated once per frame for the whole scene.
 */
export const envUniforms = {
  uEnvRot: { value: new Matrix3() },
  uEnvI: { value: 1 },
  uEnvFlash: { value: 0 },
  uEnvPhase: { value: 0 },
  uRimDir: { value: new Vector3(0, 0, -1) },
  uRimStr: { value: 1.4 },
  uKeyDir: { value: new Vector3(0.45, 0.8, 0.4).normalize() },
  uAccent: { value: new Color(0.62, 0.74, 1.0) },
}
