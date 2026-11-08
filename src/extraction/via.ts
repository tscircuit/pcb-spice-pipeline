import type { ViaModel } from '../board'
/** TI Analog Engineer's Pocket Reference, PCB via capacitance/inductance, equations 87–88.
 * https://www.ti.com/lit/eb/slyw038c/slyw038c.pdf
 * h,d,pad,antipad in mm; resistance is exact annular barrel l/(sigma*A).
 */
export function viaRlc(via: ViaModel): { R: number; L: number; C: number } {
  const area = Math.PI * ((via.holeMm / 2 + via.platingMm) ** 2 - (via.holeMm / 2) ** 2) * 1e-6
  return { R: via.lengthMm / 1000 / (via.conductivitySm * area),
    L: .2e-9 * via.lengthMm * (1 + Math.log(4 * via.lengthMm / via.holeMm)),
    C: .0555e-12 * via.er * via.lengthMm * via.padMm / (via.antipadMm - via.padMm) }
}
