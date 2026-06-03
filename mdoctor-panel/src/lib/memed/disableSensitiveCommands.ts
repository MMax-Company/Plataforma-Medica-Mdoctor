export { applyClinicalMemedUx, applyDoctorPrescreveFeatureToggles } from './applyClinicalUx';

/** @deprecated */
export function disableSensitiveCommands(): void {
  void import('./applyClinicalUx').then((m) => m.applyClinicalMemedUx());
}
