# Standalone 2D cross-section extraction

`src/extraction/cross-section.ts` exports `solveCrossSection` through
`src/extraction/index.ts`. The standalone interface does not change root package
exports or invoke native solvers. The [routed pipeline](routed-2d.md) consumes it;
that path remains candidate-unqualified. Numerical validation below concerns this
standalone solver.

## Contract

```ts
import { solveCrossSection } from '../src/extraction'

const line = solveCrossSection({
  conductors: [
    { id: 'DQ0', xMm: 0, zMm: .0994, widthMm: .1, thicknessMm: .035 },
    { id: 'DQ1', xMm: .36071684930549125, zMm: .0994, widthMm: .1, thicknessMm: .035 },
  ],
  planes: [{ zMm: 0 }],
  dielectrics: [{ zMm: 0, thicknessMm: .0994, er: 4.1, lossTangent: .02 }],
})
const { R, G } = line.atFrequency(1e9)
```

Geometry is in **mm**; z increases upwards, conductor x is its centre, and z is
its lower face. Dielectrics are non-overlapping infinite horizontal slabs;
unlisted space is air. Planar soldermask is another slab, including the spaces
between traces. Conductivity defaults to 5.8e7 S/m independently for each signal
and plane. Reference z specifies the metal surface facing the field. Signals
cannot touch references or each other. All reference surfaces have zero potential;
a solid plane shields signals in different regions exactly. Upper-only references
are reflected internally. IDs and matrix order follow the caller's conductor order.

| Output | Units / meaning |
|---|---|
| C | F/m; ground-referenced Maxwell matrix with the supplied dielectrics |
| C0 | F/m; identical physical conductors in vacuum |
| L | H/m; `mu0 * epsilon0 * inverse(C0)`, external high-frequency inductance |
| dielectricLoss | F/m; sum of material energy sensitivities weighted by loss tangent |
| dcResistance | ohm/m; signal bulk resistance; infinite reference has zero DC resistance |
| skinResistance | ohm/m/sqrt(Hz); coupled high-frequency Wheeler loss coefficient |
| atFrequency(f).R | ohm/m; passive interpolation between DC and skin-effect asymptotes |
| atFrequency(f).G | S/m; `2*pi*f*dielectricLoss` |
| diagnostics | panel count, **raw** reciprocity residual and wall differentiation step |

Default options are `panelsPerEdge: 12`, `interfaceExtent: 24`, and
`recessionFraction: .01`. Extent multiplies the largest local trace width/vertical
height, adding padding at each end of the dielectric interfaces. Work is fixed and
bounded for each requested discretisation. No unbounded automatic refinement loop
is hidden in the API. Increase panel count and extent independently when qualifying
a new geometry family; reciprocity and passivity alone do not establish accuracy.
Small weak mutual entries can need more panels than self/modal values do. The DQ0
demo uses 20 panels and extent 48, checks 24 panels and extent 96, and reports
entry-wise changes. This costs tens of milliseconds for its two conductors.

## Method and choice

A pulse-charge boundary-element / method-of-moments solve avoids a volume mesh.
Metal rows prescribe potential; dielectric rows impose continuity of normal
D through equivalent polarisation charge. This is the formulation described by
[MathWorks' 2D field solver](https://www.mathworks.com/help/rfpcb/ug/2-d-field-solver.html),
which references Djordjevic et al., *Linpar*, and Harrington, *Field Computation
by Moment Methods*. [Polar's AP135](https://www.polarinstruments.com/support/cits/AP135.html)
describes the same general charge/Green-function approach for controlled impedance.

For a single grounded plane the potential kernel is `log(r_image/r)/(2*pi)`.
Between two planes at 0 and b it is
`log((cosh(pi*dx/b)-cos(pi*(z+zs)/b))/(cosh(pi*dx/b)-cos(pi*(z-zs)/b)))/(4*pi)`.
Thus solid planes and the vertical open boundary are exact, rather than wide
meshed strips or an artificial enclosing box. Only dielectric-interface lengths
are truncated. Dielectric interfaces under metal are removed. Quartic grading
concentrates unknowns at conductor corners and projected interface edges; vertical
faces split at material boundaries. Floating-point copies of a material seam are
coalesced before panel generation.

The logarithmic source integral and self term are analytic. Nearby parallel panel
pairs use exact double integrals, avoiding a false capacitance between almost
coincident top/bottom sheets. Other target averages use four-point Gaussian
quadrature. The two-plane smooth correction uses product quadrature. Stable
`log1p` expressions preserve exponentially small stripline coupling. One pivoted
Float64 LU factorisation serves all conductor excitations and the loss sensitivity.
Storage is O(P²), factorisation O(P³), and additional excitations O(P²N); the tested
12-line problems have 384–840 panels rather than a million volume cells. There is
no thread pool, native process, mesh for the planes, or dense surface-current solve.

For dielectric loss, differentiate `A q = V` analytically in the direction
`d(er_k)/ds = er_k*tan(delta_k)`, reusing the factorisation: `A dq = -dA q`.
The resulting `dC/ds` is the material-energy-weighted loss matrix. Boundaries with
equal real er but different loss tangent are retained. No extra perturbed-material
field factorisation is needed. Raw matrix antisymmetry must pass 1.5% **before**
symmetric projection; positive energy is checked independently on C, C0, L and loss.
The measured 12-line raw residual is below 0.06% at the default resolution.

Conductor loss uses **Wheeler's incremental-inductance rule**. In vacuum, recede
every signal wall and reference surface away from the field. For copper,
`R_hf(f) = Rs(f)/mu0 * dL/ds`, `Rs = sqrt(pi*f*mu0/sigma)`.
A central geometry derivative uses two additional small vacuum solves; walls with
different conductivity move proportionally to `1/sqrt(sigma)`. The default
step is 1% of the smallest half-width, half-thickness or half-reference clearance,
also bounded by one-quarter of the inter-signal clearance, with a conductivity
adjustment. This is a shape derivative of L, not a converged
surface-current covariance. It includes plane return loss and mutual resistive
coupling. See Wheeler, “Formulas for the Skin Effect,” *Proc. IRE* 30 (1942),
412–424, [DOI](https://doi.org/10.1109/JRPROC.1942.232015), and
[Jackson's university notes, pp. 23–26](https://courses.egr.uh.edu/ECE/ECE5317/Class%20Notes/Notes%207%205317-6351%20Waveguiding%20Structures%20Part%202%20%28Attenuation%29.pdf).
[Wcalc](https://wcalc.sourceforge.net/coupled_stripline.html) likewise documents
Wheeler loss and a DC/skin interpolation for coupled stripline.

The interpolation makes each R diagonal `hypot(Rdc, R_hf)`. It applies a diagonal
congruence to the full skin matrix and adds the positive DC matrix, preserving
passivity and high-frequency mutual R. This transition is an approximation, not an
accurate low-frequency eddy-current or proximity-current solution. Internal
frequency-dependent inductance, roughness, etch trapezoids, conformal mask, finite
plane boundaries, plane apertures, non-reference planes and vias are outside this
module. Roughness is omitted. The 1–2% validation below concerns quasi-static
C/L/impedance/delay; it is not a blanket 2% conductor-loss claim.

## Numerical validation

Run `node --import tsx --test --test-concurrency=1 tests/extraction/cross-section*.test.ts`.
Every added test file has one `test()` call. Pure numerical fixtures are intentionally
not Circuit JSON. References live only in tests, never in the field solver.

Single microstrip uses [Hammerstad–Jensen](https://qucs.sourceforge.net/tech/node75.html).
The stripline cases use [Cohn's exact thin-strip even/odd elliptic-integral solution](https://wcalc.sourceforge.net/coupled_stripline.html),
including its isolated-line limit. Coupled microstrip uses
[H–J even/odd formulas](https://qucs.sourceforge.net/tech/node77.html). Main fixtures
have w/h=1, er=4, t/h=.001, and coupled edge gap/h=.5; stripline plane separation is
2.001h so the finite rectangle is centred. Maximum errors include C, L, modal Z,
delay and (for pairs) the individual mutual C/L coefficients.

Measured on an Apple M5, 16 GiB, arm64 Node 26.13.0; all times include material,
vacuum, dielectric-loss sensitivity, both Wheeler perturbations and passivity.
They exclude TypeScript startup. Timing is observational, not a machine-dependent
CI assertion. Twelve-line timing cases have no independently published 12-line
oracle; their accuracy evidence is matrix checks and the qualified one/two-line
families, not a claimed 12-line reference comparison.

| Case | Panels | ms/slice | Worst reference error |
|---|---:|---:|---:|
| Single microstrip | 56 | 9.22 | 0.416% |
| Single stripline | 32 | 6.28 | 0.149% |
| Coupled microstrip | 100 | 11.92 | 0.334% |
| Coupled stripline | 64 | 13.74 | 0.374% |
| Twelve microstrips | 540 | 320 | — |
| Twelve microstrips + mask | 840 | 551 | — |
| Twelve striplines | 384 | 496 | — |
| Pair: default + finer mesh + larger domain, total | — | 32.22 | mesh 0.166%; domain 0.105% |

The single-line sweep spans w/h=.25,1,3 and er=2.2,4,10, with worst C/L error
0.832%. The coupled sweep spans w/h=.5,1,2 and edge gap/h=.2,.5,2 at er=4,
with worst modal C/L/Z/delay error 0.823%. The actual DQ0 thickness ratio
(t/h=.352) also passes the finite-thickness H–J correction: worst C/L/Z error
0.161% at default resolution.

Weak mutual C is a subtraction of empirical modal fits: H–J's w/h=2, gap/h=2
mutual C differs by about 12% despite close modal agreement. A separate **test-only**
exact dielectric-image Green series, with no interface panels or production linear
algebra, validates these weak entries instead. Its 32→48 element change is below
0.1%; production self and mutual C agree within 0.417%. This distinguishes empirical
fit uncertainty from field-solver convergence.

Other checks cover SPD and raw/projected reciprocity, conductor-order
permutation, upper-reference reflection, exact plane shielding, invalid geometry,
and DC/high-frequency loss limits. A 100 mm wide layered parallel-plate limit gives
C error 0.385%, energy-weighted loss error 0.139%, and Wheeler skin coefficient
error 1.856% (including return loss). Analytic loss sensitivity agrees with an
independent central material perturbation within 1e-6 relative; halving the Wheeler
wall step changes its result by less than 0.1%. These checks take tens of ms.

The five numerical test files pass in 2.43 s including test-process and TypeScript
startup; maximum process resident size is **140 MiB**, measured with `/usr/bin/time -l`.
`pnpm test` with native/vendor opt-ins disabled passes **209**, skips **27**, fails **0**
(236 tests). `pnpm lint`, `pnpm check:modules`, `pnpm check:vocabulary` and
`pnpm typecheck` pass; lint retains the existing 535-line `extraction/mesh.ts` warning.
The demo script is also typechecked explicitly because scripts are outside tsconfig.
No native field extraction or board simulation was run.
