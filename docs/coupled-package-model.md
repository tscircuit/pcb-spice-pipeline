# Coupled IBIS package contract

The parser follows [IBIS 5.1 section 7, pages 129–138](https://ibis.org/ver5.1/ver5_1.pdf),
whose lumped matrix conventions also apply to the AM335x file's IBIS 4.1 data.
Vendor bytes remain local in ignored `models/` and are never copied into fixtures.

## Parsing and explicit limits

Each selected local `[Define Package Model]` requires Manufacturer, OEM,
Description, Number Of Pins, Pin Numbers, Model Data, inductance and capacitance
matrices, End Model Data and End Package Model. The optional resistance matrix
defaults to zero as specified. Metadata, names, counts, unique definitions,
matrix sizes and required ordering are checked. Keywords accept spaces or
underscores and are case insensitive; pin/model names remain case sensitive.
The package parser recognizes Comment Char and standard IBIS numeric suffixes;
the pinned die-buffer parser independently rejects non-pipe comment characters.
External `.pkg` lookup is unsupported and fails explicitly if the named local
definition is absent.

Full_matrix stores the diagonal and upper triangle, not N values per row.
Sparse_matrix stores one named column/value pair per line, with unspecified
entries zero. Sparse column order within a row need not be sorted, but every
column must be on/above the diagonal in **Pin Numbers order**, never lexical
order or an invented one-based numeric index. All formats require Row blocks
in the declared pin order.

Banded_matrix requires Bandwidth before rows. Ordinary row lengths are
`min(B+1, N-i)` with zero-based row `i`. The spec also permits circular bands:
every row has B+1 values, columns past N wrap to the first pins, and
`B <= floor((N-1)/2)` prevents duplicates. There is no separate circular-mode
keyword; consistent row lengths distinguish the two forms (B=0 is identical).
Mixed/truncated row lengths are errors. Continuation lines are supported for
Full_matrix and Banded_matrix.

Number Of Sections and section syntax under Pin Numbers (Len, L/R/C, slash,
Fork/Endfork) are explicitly unsupported, even for one section. They are never
misread as pin labels or reduced to scalar data.

## Selection and unused pins

Every mapped signal participates, including mapped quiet or steady neighbors
retained by the block derivation, together with mapped power/ground references.
Each selected physical pin must exist in Pin Numbers. A missing reference ball
cannot acquire invented matrix rows, scalar fallback, or a zero-impedance short.
Converter terminal order is explicitly permuted from the package's pin order.
The current rail policy requires one shared pulldown reference per chip;
independent ground banks remain unsupported.

Unused package leads are externally open and have no modeled die load or drive.
For their **series** terms, `I_unused = 0`, so R and L use principal submatrices.
For their **electrostatic** terms, floating conductors have zero incremental net
charge, so the retained Maxwell capacitance is
`C_ss - C_su * inverse(C_uu) * C_us`. Sequential symmetric elimination computes
this without explicitly forming an inverse. Simply keeping principal C would
instead clamp every omitted conductor to AC ground, which is not the chosen
termination.

This is a low-frequency open-lead reduction: it neglects unused pins' external
terminations, die capacitance/clamps, switching, and circulating currents caused
by induced voltage and displacement current along their internal stubs. It does
not claim an exact broadband elimination of those distributed circuits. All
pins needed for such effects must be explicitly mapped and modeled. The selected
matrices, original unreduced diagonal self terms, unused pin names and policy
are recorded in assembly metadata. No vendor pin is silently grounded.

## Passivity and SPICE realization

Complete source matrices are checked before reduction, including the unused
block, so bad source data cannot disappear when selecting pins. A diagonal-scale
normalized LDL check requires R positive semidefinite and L/C positive definite;
extracted L/C are checked again. The relative pivot threshold is 1e-12. This
implementation explicitly rejects singular L/C and nearly singular modes at
that threshold, including reference-free semidefinite C. Non-finite data fails.

C must contain Maxwell coefficients: off-diagonal terms must be nonpositive,
and every row sum must be nonnegative. A positive off-diagonal entry is an error,
even when that matrix is positive definite. Signs are never automatically
flipped and magnitudes are never silently repaired.

The circuit is one lumped pi section per selected package pin:

- Self R is series resistance. A zero-volt series source senses board-to-die
  current, and signed current-controlled voltage sources realize off-diagonal
  R terms, so `V_i = sum(R_ij * I_j)` for the resistive drops.
- Self L uses series inductors with all positive terminals facing the board.
  Signed `K_ij = L_ij / sqrt(L_ii * L_jj)` realizes mutual inductance.
- Pair capacitance is `-C_ij`; capacitance to the ideal die-ground reference is
  the row sum. Both are split equally between board and die ends. This pi
  placement is an explicit lumped approximation; IBIS matrices do not specify
  a distributed capacitance profile along each lead.

POWER/GND die nodes retain ideal voltage sources behind their coupled pin
packages. Buffer rail voltages and drive tables retain the existing converter
behavior. Missing package data never enables the scalar path. Components without
Package Model retain the existing scalar package behavior.

Matrix self terms take precedence over Pin and Package scalars. When Pin-level
parasitics exist, conversion warnings compare their exact values with the
**unreduced** matrix diagonal. Assembly mapped-pin values describe the actual
selected circuit (including the floating-pin C reduction). The inline TSX test
deliberately supplies different Pin/Package values and verifies that they are
not stamped into the coupled circuit. The AM335x Pin table has no individual
R/L/C columns; its Package defaults are averages and are not substitutes for
matrix self terms. For example, its first package pin H4 has self R=0.173611 ohm,
L=3.40755 nH and C=1.19047 pF, versus scalar defaults of approximately
0.163003 ohm, 4.142983 nH and 1.225980 pF.

## DDR3 admission evidence and remaining blockers

The existing DDR3 TSX is unchanged. The current sibling core build still emits
its own early unsupported-package error; this repository change does not patch
core or claim end-to-end DDR3 operation. The bounded check renders the physical
TSX with its simulation block removed, then admits the real CPU model with the
rendered physical pin map directly through the pipeline package boundary.
It does not fabricate vendor models or run extraction.

```sh
IBIS_MODEL_DIR=models TSX_TSCONFIG_PATH=examples/tsconfig.json \
SI_CORE_MODULE="$(cd ../core && pwd)/dist/index.js" \
node --import tsx scripts/check-ddr3.tsx
```

The new pipeline error is:

```text
am335x_zcz: selected package pin E5 missing from [Pin Numbers]; scalar fallback is forbidden
```

Both selected reference balls E5 (VDDS_DDR) and A1 (VSS) are absent from the
175-pin package definition. A separate diagnostic using only the mapped signal
pins then rejects positive off-diagonal capacitances under the Maxwell
convention. The source's intent cannot be inferred safely from those magnitudes;
it needs a corrected/clarified vendor model and explicit reference-pin data.
Signal-only admission otherwise passes the complete R/L positive checks. The
physical render contains 14 traces, 16 vias and two pours. This check starts zero
native solvers; native DDR3 extraction/transient validation remains scheduled
separately.

Inline format and passivity tests use original small fixtures. The opt-in
package-only ngspice AC oracle completes in seconds and checks full R, signed
mutual L and board-side Maxwell C against their equations:

```sh
SI_TEST_PACKAGE_NGSPICE=1 node --import tsx --test tests/buffers/coupled-package.test.tsx
```
