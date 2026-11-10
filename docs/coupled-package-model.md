# Coupled IBIS package contract

The parser follows [IBIS 5.1 section 7](https://ibis.org/ver5.1/ver5_1.pdf#page=129).
The sign rule also appears in the AM335x file's own revision, IBIS 4.1.
Vendor bytes remain local in ignored `models/` and are never copied into fixtures.

## Specification decisions

### Capacitance signs

[IBIS 4.1 section 7, RLC Matrix Notes, printed page 121](https://ibis.org/ver4.1/ver4_1.pdf#page=121)
states:

> Note that Kij ( when i /= j) will be a negative number and should be entered as such.

[IBIS 5.1 section 7, page 135](https://ibis.org/ver5.1/ver5_1.pdf#page=135)
retains this rule. These are Maxwell coefficients, not positive mutual capacitor
magnitudes. [IBIS 6.1 section 7, pages 147–148](https://ibis.org/ver6.1/ver6_1.pdf#page=147)
also specifies nonnegative diagonal coefficients and diagonal dominance for C.
The SPICE pair capacitor is therefore `-C_ij`, and its capacitance to the reference
is `C_ii + sum(C_ij, j != i)`. Passivity is checked on the supplied Maxwell matrix;
positive off-diagonal values are rejected, never guessed or automatically flipped.

The local AM335x `am335x_zcz` definition has 175 rows, all diagonally dominant,
and 15,225 positive off-diagonal pairs, with no negative pairs. Its first row H4
has diagonal 1.19047 pF and an off-diagonal magnitude sum of 0.61153091044 pF;
the smallest diagonal margin across all rows is 0.05923748524 pF (P1).
These magnitudes are consistent with a *possible* missing-sign error, but also
with other positive-capacitor representations. They do not authorize inferring
vendor intent. A vendor-confirmed corrected source is still needed for raw-source
acceptance; changing the parser to interpret positive couplings would violate IBIS.

### Pins absent from the matrix definition

[IBIS 7.2 section 7.3, `[Pin Numbers]`, page 181](https://ibis.org/ver7.2/ver7_2.pdf#page=181)
explicitly permits a package definition to cover only part of a component's pin
table. For unlisted pins, its hierarchy instruction includes this exact excerpt:

> the EDA tool is expected to use the RLC values from the [Pin] or [Package] keywords

The complete rules also appear in [IBIS 6.1 section 7, pages 142–143](https://ibis.org/ver6.1/ver6_1.pdf#page=142).
Ordinary unlisted pins use each specified R_pin/L_pin/C_pin; a missing or NA value
uses the corresponding [Package] default. Pins listed in the matrix retain their
matrix data. This is the specification's per-pin precedence rule, **not a silent
scalar fallback for missing, unsupported or invalid coupled data**. Such coupled
definitions still fail explicitly.

For a POWER/GND bus declared by [Pin Mapping], unlisted bus members are instead
shorted at the board side to the first member in [Pin Numbers] order, when that
bus has any listed member. That member's merged package data is used, including
when the merging member itself was not explicitly mapped by TSX. Its row is kept
in the selected matrices. If no member is listed, the scalar hierarchy applies.
Explicit [Merged Pins] sections remain unsupported and fail in parsing.

AM335x has no [Pin Mapping] section, no rail rows in its package matrix, and no
individual [Pin] R/L/C values for E5 (VDDS_DDR) or A1 (VSS). Both therefore use the
[Package] typical defaults: 0.163002954285714 ohm, 4.14298268571429 nH and
1.2259796 pF. The ideal die rails remain behind these parasitics.

## Parsing and explicit limits

Each selected local [Define Package Model] requires Manufacturer, OEM,
Description, Number Of Pins, Pin Numbers, Model Data, inductance and capacitance
matrices, End Model Data and End Package Model. The optional resistance matrix
defaults to zero. Metadata, names, counts, unique definitions, matrix sizes and
required ordering are checked. Keywords accept spaces or underscores and are
case insensitive; pin/model names remain case sensitive. The package parser
recognizes Comment Char and standard IBIS numeric suffixes; the pinned die-buffer
parser independently rejects non-pipe comment characters. External `.pkg` lookup
is unsupported and fails explicitly if the named local definition is absent.

Full_matrix stores the diagonal and upper triangle, not N values per row.
Sparse_matrix stores one named column/value pair per line, with unspecified
entries zero. Sparse column order within a row need not be sorted, but every
column must be on/above the diagonal in **Pin Numbers order**, never lexical
order or an invented one-based numeric index. All formats require Row blocks
in the declared pin order.

Banded_matrix requires Bandwidth before rows. Ordinary row lengths are
`min(B+1, N-i)` with zero-based row `i`. Circular bands have B+1 values in every
row, with columns past N wrapping to the first pins; `B <= floor((N-1)/2)` prevents
duplicates. Consistent row lengths distinguish the forms (B=0 is identical).
Mixed/truncated row lengths are errors. Full/Banded continuation lines are supported.

Number Of Sections and section syntax under Pin Numbers (Len, L/R/C, slash,
Fork/Endfork) are explicitly unsupported, even for one section. They are never
misread as pin labels or reduced to scalar data.

## Selection and unused pins

Every mapped signal participates, including quiet/steady neighbors, together
with mapped power/ground references and any required merging pins. Converter
terminals are permuted explicitly from package order. Matrix metadata identifies
selected rows, scalar-only pins remain in mappedPins, and mergedPins records
unlisted-to-merging-pin associations. One shared pulldown reference per chip is
required; independent ground banks remain unsupported.

Unused matrix leads are externally open and have no modeled die load or drive.
For series terms, `I_unused = 0`, so R and L use principal submatrices. For
floating electrostatic conductors, incremental net charge is zero, so retained C
is `C_ss - C_su * inverse(C_uu) * C_us`. Sequential symmetric elimination avoids
forming an inverse. Principal C would instead clamp omitted conductors to AC ground.

This low-frequency open-lead approximation neglects unused external terminations,
die capacitance/clamps, switching and resonant circulating currents along internal
stubs. It is not exact broadband elimination. Pins needed for those effects must
be explicitly mapped. Selected matrices, unreduced self terms, unused pin names
and termination policy are recorded in assembly metadata.

## Passivity and SPICE realization

Complete source matrices, including unused blocks, are checked before reduction.
A diagonal-scale normalized LDL check requires R positive semidefinite and L/C
positive definite; extracted L/C are checked again. The relative pivot threshold
is 1e-12. Singular/nearly singular L/C, including reference-free semidefinite C,
remain an explicit implementation limit. Non-finite data fails. C off-diagonals
must be nonpositive and every row sum nonnegative.

The circuit is one lumped pi section per selected package pin:

- Self R is series resistance. Zero-volt sources sense board-to-die current;
  signed current-controlled voltage sources realize off-diagonal R.
- Self L uses inductors with positive terminals facing the board.
  Signed `K_ij = L_ij / sqrt(L_ii * L_jj)` realizes mutual inductance.
- Pair capacitance is `-C_ij`; reference capacitance is the row sum. Both are
  split equally between board and die ends. This is an explicit lumped placement
  approximation; IBIS matrices do not specify the distributed lead profile.

POWER/GND die nodes retain ideal voltage sources behind their packages. Scalar
and matrix element names are disjoint. Merged rail aliases share a single die
rail source, and incompatible rail voltages fail. Pin-value comparison warnings
use the original matrix diagonal, before floating-pin reduction. Missing coupled
definitions never enable the scalar path. Components without Package Model retain
their existing scalar package behavior.

## DDR3 admission evidence and remaining blockers

Core checks declarations, pin/model binding, roles, differential identity and
routing. It no longer rejects Package Model or parses numerical package data.
Channel receiver model overrides survive the additional on-net pin scan.
The pipeline owns package parsing, validation and realization.

```sh
# Build the sibling core with its package.json build script first: bun run build
IBIS_MODEL_DIR=models TSX_TSCONFIG_PATH=examples/tsconfig.json \
SI_CORE_MODULE="$(cd ../core && pwd)/dist/index.js" \
node --import tsx scripts/check-ddr3.tsx
```

The unchanged, fully routed DDR3 TSX now renders through real core: nine signals,
14 traces, 16 vias and two pours. Raw-source derivation rejects:

```text
am335x_zcz: Maxwell capacitance has positive off-diagonal entries; vendor sign conversion is forbidden
```

E5/A1 absence no longer rejects. The raw channel **has not passed all package
admission**, because the sign violation is real. No native board solver was run.

An explicit counterfactual diagnostic negates only off-diagonal C entries in
memory. It neither edits vendor files nor enables a production sign heuristic:

```sh
IBIS_MODEL_DIR=models TSX_TSCONFIG_PATH=examples/tsconfig.json \
SI_CORE_MODULE="$(cd ../core && pwd)/dist/index.js" \
SI_DIAGNOSTIC_MAXWELL_SIGNS=1 node --import tsx scripts/check-ddr3.tsx
```

For that candidate, derivation and the pure admit/declare/bind stages pass. Static
package-only conversion verifies both real chip packages, including the AM335x
scalar reference pins and ideal die rails. The former bind error,
`Actual adjacent transitions overlap the IBIS switching waveform`, is resolved by
[checked inactive-tail scheduling](ibis-switching.md), including specification
sources, actual waveform measurements and explicit truncation diagnostics.
The next stage is extraction; it was deliberately not invoked, so there is no
verified downstream error. Raw-source sign correction remains a user/vendor
decision. The JSON
summary in ignored `runs/ddr3-boundary.json` distinguishes raw rejection from the
candidate, records both source hashes and waveform inspection, and reports zero native solver calls.
No extraction or native board transient was started.

Inline TSX tests use original small fixtures. The opt-in package-only ngspice
AC oracles check full R, signed mutual L and Maxwell C against their equations,
and validate mixed scalar/matrix and merged-rail netlists:

```sh
SI_TEST_PACKAGE_NGSPICE=1 node --import tsx --test tests/buffers/coupled-package.test.tsx
```
