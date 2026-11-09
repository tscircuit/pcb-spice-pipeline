/** Numerical policy in one place. These are method choices, never caller settings or resource caps.
 * SI units are used electrically; Circuit JSON geometry is in mm. Literal 0/1, halves, π,
 * unit conversions and exact algebraic exponents elsewhere are definitions, not tuning knobs.
 */
export const numerics = {
  /** Prompt accuracy contract: every nonzero C/C0/L/skin/loss matrix entry changes by less than 0.5%. */
  meshRelativeChange: .005,
  /** Rectilinear metric: grow far cells geometrically; quartic near-edge spacing resolves corner currents. */
  gridInitialDensity: 1,
  /** Sum of nodal flux imbalance relative to solved absolute face flux, independent of mesh refinement. */
  fieldBalanceRelative: 1e-8,
  gridGrowth: .7,
  gridEdgePower: 4,
  gridRefinementRatio: 2,
  /** Vacuum rectangular-metal corner: J~r^(-1/3); integral J^2 has h^(1/3) error. */
  skinExtrapolationOrder: 4/3,
  /** Millimetre topology comparisons reflect Circuit JSON's route precision. */
  endpointToleranceMm: 1e-5,
  boundaryToleranceMm: 1e-9,
  coordinateDigits: 8,
  stackupCoordinateDigits: 10,
  /** Dimensionless parallel-route direction predicate. */
  directionTolerance: 1e-8,
  /** Observed-eye boundary/interpolation tolerances are fractions of one UI, not resource limits. */
  eyeBoundaryToleranceUi: 1e-9,
  eyeInterpolationToleranceUi: 1e-12,
  /** Display interpolation density only; native rows and measured eye envelopes retain all samples. */
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
  /** Initial positive-real Foster branches; doubled until the maximum relative error contract passes. */
  lossBranches: 4,
  lossFitMaximumRelative: .02,
  lossPoleExtension: 100,
  frequencySamples: 41,
  /** Relative objective stagnation is numerical convergence, not an iteration cap. */
  fitRelativeChange: 1e-11,
  /** Standard 10–90% physical edge thresholds, used for vendor fixtures and linear PULSE edges. */
  edgeLowFraction: .1,
  edgeHighFraction: .9,
  /** Linear Ramp convention: 10–90 time = (0.8/0.6) * specified 20–80 time. */
  rampToRiseTime: 4 / 3,
  /** Relative coverage roundoff for ms-to-s conversions of finite stimulus endpoints. */
  stimulusCoverageRelativeTolerance: 1e-12,
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
  /** Matrix validation tolerances; these predate field extraction and also protect SPICE passivity. */
  matrixReciprocity: .005,
  choleskyRelativeFloor: 1e-12,
  /** Native transient accuracy retained from the existing pipeline: tighter than the 0.5% field criterion.
   * Gear integration damps numerical ringing in the stiff IBIS/Foster network (ngspice manual, transient options).
   */
  spiceRelativeTolerance: 1e-5,
  spiceAbsoluteCurrentToleranceA: 1e-12,
  /** SPICE text precision retains more digits than the extraction accuracy supports. */
  netlistDigits: 12,
  /** TI Analog Engineer's Pocket Reference eqs. 87–88, dimensions in mm.
   * https://www.ti.com/lit/eb/slyw038c/slyw038c.pdf
   */
  viaInductanceHPerMm: .2e-9,
  viaCapacitanceFPerMm: .0555e-12,
} as const
