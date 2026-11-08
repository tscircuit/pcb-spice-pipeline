/** Numerical policy in one place. These are method choices, never caller settings or resource caps.
 * SI units are used electrically; Circuit JSON geometry is in mm. Literal 0/1, halves, π,
 * unit conversions and exact algebraic exponents elsewhere are definitions, not tuning knobs.
 */
export const numerics = {
  /** Prompt accuracy contract: every nonzero C/C0 matrix entry changes by less than 0.5%. */
  meshRelativeChange: .005,
  /** Start a constant-panel BEM cheaply, then double its cosine-graded subdivisions indefinitely. */
  initialPanelsPerEdge: 2,
  meshRefinementRatio: 2,
  /** Galerkin constant panels have second-order capacitance error; Richardson removes that term. */
  capacitanceExtrapolationOrder: 2,
  /** Quartic endpoint grading resolves metal/dielectric corner charge singularities. */
  edgeGradingPower: 4,
  /** Four-point Gauss–Legendre target-panel integration (exact through degree 7). */
  panelQuadrature: [[-.8611363115940526, .3478548451374538], [-.3399810435848563, .6521451548625461], [.3399810435848563, .6521451548625461], [.8611363115940526, .3478548451374538]],
  /** Floating-point zero floor only for entries vanishing by symmetry; relative to matrix norm. */
  symmetryZeroRelative: 1e-10,
  /** Millimetre topology comparisons reflect Circuit JSON's route precision. */
  endpointToleranceMm: 1e-5,
  boundaryToleranceMm: 1e-9,
  interfaceProbeMm: 1e-7,
  coordinateDigits: 8,
  stackupCoordinateDigits: 10,
  /** Direction and panel predicates in mm or dimensionless panel fractions; avoid roundoff slivers. */
  directionTolerance: 1e-8,
  minimumPanelLengthMm: 1e-12,
  kernelNormalZeroMm: 1e-14,
  panelEndFractionTolerance: 1e-8,
  /** Observed-eye boundary/interpolation tolerances are fractions of one UI, not resource limits. */
  eyeBoundaryToleranceUi: 1e-9,
  eyeInterpolationToleranceUi: 1e-12,
  eyePlotPoints: 1200,
  /** Accept only start-time roundoff smaller than a native timestep or this relative duration. */
  simulationStartRelativeTolerance: 1e-8,
  /** IEEE-double solver output, independent of text formatting used for input components. */
  ngspiceOutputDigits: 17,
  /** Quasi-TEM ladder delay <= IBIS 10–90% rise time / 10 (prompt amendment). */
  cellsPerRiseTime: 10,
  /** Cover low-frequency data content and a decade above the IBIS 0.5/tr knee. */
  minimumFrequencyPerBitRate: .1,
  maximumFrequencyPerInverseRise: 5,
  kneeFrequencyPerInverseRise: .5,
  /** Four positive-real Foster branches (amendment's 2–4), sampled on a logarithmic grid. */
  lossBranches: 4,
  frequencySamples: 41,
  /** Relative objective stagnation is numerical convergence, not an iteration cap. */
  fitRelativeChange: 1e-11,
  fitZeroRelative: 1e-6,
  /** Differential dielectric sensitivity step; truncation O(step) is below mesh tolerance. */
  dielectricRelativeStep: .001,
  /** Near-DC skin loss must scale as f², becoming sqrt(f) in the surface-current regime. */
  skinTransitionExponent: 1.5,
  /** Linear Ramp convention: 10–90 time = (0.8/0.6) * specified 20–80 time. */
  rampToRiseTime: 4 / 3,
  /** Physical constants CODATA 2018, NIST. */
  epsilon0: 8.8541878128e-12,
  mu0: 1.25663706212e-6,
  /** Dense pivots below this scaled IEEE-double threshold are a named singular-matrix error. */
  pivotAbsoluteFloor: 1e-25,
  /** WebAssembly's defined 64-KiB page; clang's exported heap starts after its two initial pages.
   * Memory grows to the matrix size. Neither value imposes a matrix, lane or mesh limit.
   */
  wasmPageBytes: 65536,
  luInitialMemoryPages: 2,
  /** Matrix validation tolerances; these predate BEM and also protect SPICE passivity. */
  matrixReciprocity: .005,
  choleskyRelativeFloor: 1e-12,
  /** SPICE text precision retains more digits than the extraction accuracy supports. */
  netlistDigits: 12,
  /** TI Analog Engineer's Pocket Reference eqs. 87–88, dimensions in mm.
   * https://www.ti.com/lit/eb/slyw038c/slyw038c.pdf
   */
  viaInductanceHPerMm: .2e-9,
  viaCapacitanceFPerMm: .0555e-12,
} as const
