/** Positive-real Foster quadrature: sqrt(s), and a finite-band constant-loss-tangent dielectric. */
export interface LossPole { rate: number; skin: number; dielectric: number }

/** Logarithmic Stieltjes quadrature. Every pole is negative real and every branch weight positive. */
export function causalLossPoles(): LossPole[] {
  const step = Math.log(10)
  return Array.from({ length: 9 }, (_, i) => {
    const rate = 2 * Math.PI * 10 ** (i + 4)
    return { rate, skin: Math.sqrt(rate) * step / (Math.PI * Math.sqrt(Math.PI)), dielectric: 2 * step / Math.PI }
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
