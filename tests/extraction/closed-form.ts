/** Independent H–J quasi-static oracle, Qucs technical manual eqs. 11.156–11.176.
 * https://qucs.sourceforge.net/tech/node77.html (Hammerstad & Jensen, MTT-S 1980).
 * These published empirical coefficients belong to the oracle, never the numerical field solver.
 */
export function coupledMicrostrip(w: number, gap: number, er: number): { ze: number; zo: number; ee: number; eo: number; l12: number; c12: number } {
  const eta = 376.730313668
  const c = 299792458
  /** Hammerstad–Jensen single-line dielectric filling factor. */
  const factor = (u: number): number => {
    const a = 1 + Math.log((u**4+(u/52)**2)/(u**4+.432))/49 + Math.log(1+(u/18.1)**3)/18.7
    const b = .564*((er-.9)/(er+3))**.053
    return (1+10/u)**(-a*b)
  }
  const f = 6+(2*Math.PI-6)*Math.exp(-((30.666/w)**.7528))
  const zair = eta/(2*Math.PI)*Math.log(f/w+Math.sqrt(1+(2/w)**2))
  const psi = 1+gap/1.45+gap**2.09/3.95
  const alpha = .5*Math.exp(-gap)
  const m = .2175+(4.113+(20.36/gap)**6)**(-.251)+Math.log(gap**10/(1+(gap/13.8)**10))/323
  const phie = .8645*w**.172/(psi*(alpha*w**m+(1-alpha)*w**(-m)))
  const theta = 1.729+1.175*Math.log(1+.627/(gap+.327*gap**2.17))
  const beta = .2306+Math.log(gap**10/(1+(gap/3.73)**10))/301.8+Math.log(1+.646*gap**1.175)/5.3
  const n = (1/17.7+Math.exp(-6.424-.76*Math.log(gap)-(gap/.23)**5))*Math.log((10+68.3*gap**2)/(1+32.5*gap**3.093))
  const phio = phie-theta/psi*Math.exp(beta*w**(-n)*Math.log(w))
  const mu = gap*Math.exp(-gap)+w*(20+gap**2)/(10+gap**2)
  const r = 1+.15*(1-Math.exp(1-(er-1)**2/8.2)/(1+gap**(-6)))
  const fo1 = 1-Math.exp(-.179*gap**.15-.328*gap**r/Math.log(Math.E+(gap/7)**2.8))
  const p = Math.exp(-.745*gap**.295)/Math.cosh(gap**.68)
  const q = Math.exp(-1.366-gap)
  const fo = fo1*Math.exp(p*Math.log(w)+q*Math.sin(Math.PI*Math.log10(w)))
  const ee = (er+1)/2+(er-1)/2*factor(mu)
  const eo = (er+1)/2+(er-1)/2*fo*factor(w)
  const zae = zair/(1-zair*phie/eta)
  const zao = zair/(1-zair*phio/eta)
  return {ze:zae/Math.sqrt(ee),zo:zao/Math.sqrt(eo),ee,eo,l12:(zae-zao)/(2*c),c12:(ee/zae-eo/zao)/(2*c)}
}
/** Complete elliptic integral by the arithmetic–geometric mean; no attempt cap. */
function elliptic(k: number): number {
  let a = 1
  let b = Math.sqrt(1-k*k)
  while (Math.abs(a-b)>Number.EPSILON*a) {
    const next = (a+b)/2
    b = Math.sqrt(a*b)
    a = next
  }
  return Math.PI/(2*a)
}
/** Exact thin edge-coupled stripline conformal map, S. B. Cohn, IRE MTT-3 (1955), pp. 29–38.
 * Primary implementation/reference: https://wcalc.sourceforge.net/coupled_stripline.html
 * b is ground-plane separation. At large separation, both modes approach the isolated stripline.
 */
export function coupledStripline(w: number, gap: number, b: number, er: number): { ze: number; zo: number; l12: number; c12: number } {
  const t = Math.tanh(Math.PI*(w+gap)/(2*b))
  /** Cohn homogeneous even/odd characteristic impedance. */
  const mode = (k: number): number => 376.730313668/4*elliptic(Math.sqrt(1-k*k))/elliptic(k)
  const ze = mode(Math.tanh(Math.PI*w/(2*b))*t)
  const zo = mode(Math.tanh(Math.PI*w/(2*b))/t)
  return {ze:ze/Math.sqrt(er),zo:zo/Math.sqrt(er),l12:(ze-zo)/(2*299792458),c12:er*(1/ze-1/zo)/(2*299792458)}
}
