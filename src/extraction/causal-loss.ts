/** Positive-real Foster quadrature: sqrt(s), and a finite-band constant-loss-tangent dielectric. */
export interface LossPole { rate: number; skin: number; dielectric: number }

/** Skin weight / sqrt(rate) and dielectric weight per pole, a nonnegative least-squares fit of Zs = (1 + j) sqrt(f)
 * and of a constant loss tangent (G = w, dC/d ln w = -(2/pi) G/w) over 10 MHz–5 GHz. The interior weights stay near the
 * log-uniform Stieltjes quadrature (0.2197, 0.7788); the end poles absorb the truncated tails. Worst error in band: 0.8%
 * skin magnitude and phase, 0.2% dielectric G, 1.0% Kramers–Kronig slope.
 */
const skinWeights = [.617084, .126051, .234089, .215091, .222717, .215633, .232706, .127446, .617523]
const dielectricWeights = [1.22314, .743928, .775148, .781415, .776727, .781436, .774987, .743842, 1.22581]

/** Nine negative real poles, log-uniform from 10^6.25 to 10^10.5 Hz, each with positive branch weights. */
export function causalLossPoles(): LossPole[] {
  return skinWeights.map((skin, i) => {
    const rate = 2 * Math.PI * 10 ** (6.25 + 4.25 * i / 8)
    return { rate, skin: skin * Math.sqrt(rate), dielectric: dielectricWeights[i] }
  })
}

/** AC response of the implemented unit skin impedance / unit dielectric admittance, for fit evidence. */
export function causalLossResponse(frequency: number): { skinReal: number; skinImaginary: number; dielectricReal: number; dielectricCapacitance: number } {
  const omega = 2 * Math.PI * frequency
  const poles = causalLossPoles()
  return {
    skinReal: poles.reduce((sum, pole) => sum + pole.skin * omega ** 2 / (pole.rate ** 2 + omega ** 2), 0),
    skinImaginary: poles.reduce((sum, pole) => sum + pole.skin * omega * pole.rate / (pole.rate ** 2 + omega ** 2), 0),
    dielectricReal: poles.reduce((sum, pole) => sum + pole.dielectric * pole.rate * omega ** 2 / (pole.rate ** 2 + omega ** 2), 0),
    dielectricCapacitance: poles.reduce((sum, pole) => sum + pole.dielectric * pole.rate ** 2 / (pole.rate ** 2 + omega ** 2), 0),
  }
}
