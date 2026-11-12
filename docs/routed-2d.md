# Routed 2D coupled channel

This is an **experimental, unqualified path**, not an accepted DDR3 simulation.
`pipeline/routed.ts` compiles physical routed copper and the existing IBIS
package/switching models into a candidate ngspice deck, using the
[2D cross-section solver](2d-cross-section.md) for per-unit-length RLGC. The
public RFC entry still uses the existing 3D stage chain. No vendor models, board
JSON, generated netlists or plots are committed.

## Geometry and scope

`prepareBlocks(..., '2d')` admits whole candidate nets within a 32 mm geometry cap
on the same/adjacent layers, including branched
and unmodelled neighbours. Only the selected channel graph must have supported
endpoint declarations. Quiet mapped IBIS pins retain their existing run states.
Unknown external loads are explicitly recorded as open/ideal-logical terminations;
this does not constitute a complete system/PDN model. Nearby rail wires are ideal
AC electrodes. Their longitudinal impedance is omitted.

The physical route is traversed through wires and explicit vias. A 1 um
Douglas–Peucker chord tolerance reduces dense curved-route tessellation, recording
original and simplified lengths. Width/layer/via boundaries survive. Parallel
overlapping copper of the same electrical net becomes its transverse metal
union, split at branch endpoints. Explicit lateral equipotential joins preserve
original endpoints; lateral spreading R/L
and patch-edge fringing remain omitted and recorded.

Parallel directions have local longitudinal/transverse frames. Sweeps split at
all longitudinal endpoints and intersections with actual pour outer/inner rings.
Groups use actual reference identity and solved pair coupling: retain a pair
when either normalized mutual C or L is at least 0.5%, then solve its connected
component. The 32 mm cap and 40-conductor admission limit are explicit; omitted
fields beyond the cap and aggregate waveform error are not bounded. Cache keys contain
only relative slice geometry and material profiles, not net names or position.
Actual PCB ports and branch junctions protect electrical cell boundaries.
Coplanar pours are not discretized into finite strip conductors in this revision;
pours supply vertical references only. Lateral coplanar shielding/coupling is
therefore an explicit remaining model gap, not a qualified full-copper solution.

The nearest *actual pour copper surface* on each side supplies the references.
Inner4 therefore sees intervening inner5 copper before inner6 when a power pour
is present; `power_references` records every such interval. A different-net plane
is an ideal AC reference approximation with an explicit PDN warning. Centre-line
boundary checks do not calculate 3D lateral edge fields. Where every vertical
reference is void, the nearest actual edge within 2 mm is replaced by a surface
at `hypot(vertical gap, lateral edge distance)`; every such surface records
`lateralGapMm`. This is an unqualified return-detour estimate. Larger unsupported
voids fail. Absent copper-layer volume is filled with the nearest laminate.

Oblique selected-net/neighbour encounters on the same/adjacent layers use a
local parallel electrostatic surrogate at their closest finite-segment points.
Effective length is bounded by both segment lengths and `2h/abs(sin(angle))`.
Pair C is placed at the nearest electrical nodes; placement error, angle, length,
C and outward 1 um spacing rounding are recorded. Magnetic oblique coupling and
neighbour-to-neighbour oblique interactions are explicitly omitted. Touching bend
endpoints are recorded without an invalid parallel-strip substitution. When a
local infinite reference intersects the neighbour strip height, the encounter is
recorded as shielded; finite aperture/plane-edge fringing is omitted. Adding
pair C to isolated self C is a weak-coupling approximation, not an accuracy bound.

## Lines, causal losses and numerical cost

[ngspice's manual, transmission lines](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf)
provides single-line TXL/LTRA and CPL with at most eight coupled lines, constant
losses, and diagonal R/G matrices. Modal
TXL/LTRA requires nontrivial broadband transformations when R/L/C/G do not commute
and discontinuities change conductor sets. The candidate instead uses passive
coupled RLGC ladders with stable Foster loss branches and no native field solver.

Every solved slice contributes its matrix energy by physical overlap length.
Signed congruences map longitudinal current directions onto route-arc electrical
cells. Node-potential projections assemble shunt C and dielectric-loss matrices.
AC-grounded rail conductors first undergo a Schur reduction of series L, with
the induced return-current congruence applied to skin loss. Fixed-potential C/G
use their principal submatrices. Ground rails are never treated as magnetically
open wires. This preserves the local positive-energy form while integrating many short
geometric sections into one electrical cell. The conservative delay bound is
`sqrt(normInf(L)*normInf(C))`; cell delay is at most rise time/10, divided by the
requested spatial refinement. Physical geometry remains in the extraction ledger.
This reduced the DQ0 experiment from 1,186 geometrical electrical cells to 218
with physical branch and port boundaries protected.

Series matrices use ordinary R, current-controlled H sources and signed K
inductors. Shunts use exact sparse energy branches for diagonally dominant
matrices, including positive mutual terms as common-mode branches. For C(Va+Vb), a linear
VCVS referenced to Va provides the sum voltage and its physical current loads Va;
one current-controlled source returns the same current to Vb. No nonlinear
voltage expression is needed for these linear energy terms. General PSD
matrices fall back to LDL energy factors, never a silent sign correction.

Nine logarithmically spaced poles (10 kHz–1 THz) approximate the Stieltjes integral
`sqrt(s) = integral(s/(s+p)/sqrt(p), p=0..infinity)/pi`.
Each skin branch is an R matrix in parallel with L=R/p; the positive coefficient
is `sqrt(p)*delta(log p)/(pi*sqrt(pi))` times Wheeler's skin matrix. The result is
DC R plus a causal finite-band skin impedance, including the required reactive
part. It deliberately differs from the standalone solver's real-only hypot
interpolation near the DC crossover. Mutual skin loss is retained.

Dielectric loss uses positive series-RC Debye branches with matrix capacitance
`2*delta(log p)/pi * dielectricLoss`. The base C is reduced so the reactive C
matches the 2D result at 1 GHz. The finite-band dispersion is an assumption, not
measured laminate data. Numerical tests bound real skin error below 5% and real
G error below 6% over 10 MHz–5 GHz; these are loss-fit bounds, not board accuracy.

KLU and Gear order 2 are selected. Receiver vectors and all IBIS voltage-source
branch dependencies are saved. Tolerances are reltol=1e-4, abstol=1 nA and
vntol=1 uV; the earlier 1 pA setting failed at the first switching edge. These
settings still require an independent waveform refinement check. A 1 Gohm DC
anchor per coarse route/mapped package node fixes open-neighbour
common-mode singularities; it does not substitute a vendor die termination.
A cross-process lock serializes ngspice, OMP_NUM_THREADS=1 is forced, and each native
run has hard limits of at most 1,200 seconds and 1 GiB native RSS. Electrical
assembly is bounded to 1,024 arc cells. The runner also stops on an observed
progress projection beyond 20 minutes. Stateful stop/resume checkpoints at
1 ps and every 0.5 ns save partial output. Projections exclude measured startup
and conservatively use the next unreached checkpoint. A short pilot must precede
a long capture.
An earlier tessellation-sized pilot was stopped when its projection exceeded that
budget. Cross-sections have a bounded 40-conductor admission limit; the lane's
largest retained slice has 33. No FastHenry/FasterCap runs were performed.

Refinement is explicit and bounded: `SI_ROUTE_REFINEMENT=1,2,4` changes space;
`SI_ROUTE_STEP_PS` changes time independently. Completed native output remains
`candidate-unqualified` until independent waveform comparisons establish the
existing 1% + 1 mV RMS/signed-peak policy. A bounded automatic acceptance controller and RFC result integration remain
unimplemented. `SI_ROUTE_REUSE_DIR` reuses a hashed-board/model-compatible compiled
deck for time-only refinement without repeating field extraction. Reuse cannot
extend the compiled switching history or change its field mesh.

## Transitions and materials

`simulation/route-transitions.ts` adds actual physical via barrels, drilled-span
stubs, pads, and a signal-referred return-loop estimate. Via-to-via and
via-to-trace mutual coupling are omitted; the barrels use self L/C. It uses:

- Regularized short-barrel L: `0.2*h*(log(1+4h/d)+1)` nH, h/d in mm, based on the
  familiar [TI via formula](https://e2e.ti.com/cfs-file/__key/CommunityServer-Discussions-Components-Files/130/0830.Texas_5F00_Instruments_5F00_DisplayPort_5F00_Design_5F00_Guide_5F00_Rev1.1.pdf).
  The added 1 inside the logarithm is a short-barrel regularization.
- Coaxial C: `2*pi*epsilon0*er*h/log(D/d)`, with SI lengths, from the [coaxial capacitor relation](https://openstax.org/books/university-physics-volume-2/pages/8-1-capacitors-and-capacitance). Antipad D is explicitly
  assumed to be outer pad diameter + 0.20 mm; no fabricated clearance is claimed.
- [DC barrel R](https://openstax.org/books/university-physics-volume-2/pages/9-3-resistivity-and-resistance): `h/(sigma*pi*(r_outer^2-r_hole^2))`. Hole plating is the core
  preset's 0.018 mm. Inactive drilled spans are short open-stub LC estimates. Connected-end annular
  via pads add parallel-plate C to each actual local reference; unspecified
  nonfunctional internal pads are omitted.
- [Pad C](https://openstax.org/books/university-physics-volume-2/pages/8-1-capacitors-and-capacitance): `epsilon0*er*area/gap` using actual circle/rectangle/polygon area;
  breakout wire R/L remains in the distributed path. Fringing/current crowding
  and bend excess capacitance are omitted.
- Return-loop L: `mu0/(2*pi)*vertical_distance*log(1+2*stitch_distance/drill_diameter)`.
  The nearest electrically GND-associated physical via spanning the local
  reference layers is recorded. Missing stitches use a warned 10 mm spreading
  distance. The formula is a heuristic regularized partial-inductance estimate; the TI guide
  supports using nearby return vias, not this exact spreading equation. It is
  signal-referred, without shared plane/PDN extraction.

Results are labeled **JLC standard stackup (assumed)**, JLC08121H-3313. Its material
sum is 1.1776 mm for the nominal 1.2 mm board; it is not rescaled. The current core
preset defines no soldermask thickness. The experiment uses a planar 20 um
above-copper overcoat, er=3.3 and tan(delta)=0.025. Laminate tan(delta)=0.02 is
assumed. If the preset supplies a mask thickness the candidate uses it; asymmetric
outer masks currently fail explicitly. Roughness is omitted.

Via-in-pad contacts are explicit even when the pad-layer wire has zero length.
Every selected endpoint must touch a physical wire or via before field solves.
DQS exports differential voltage and both physical DRAM pin voltages.

## Terminal inductance

`terminalInductance` computes external magnetic energy for explicit vertical
port connections: the inward half of the pad, at its height above the plane.
Its PEC image doubles the post length; half the rectangular-bar self and
parallel-filament mutual is retained. The horizontal infinite-line end excess
and the line length to the port centre are subtracted. No constant is fitted.
This is a short-post approximation, not a full discontinuity extraction.

`channelSpice` accepts explicit input/output terminal matrices and adds them to
the first/last series section; omitting them preserves the existing channel.
Ordinary BGA pads do not specify a port-to-plane current path and receive no
inferred vertical post. Real-board vias keep the transition models above, so
the same transition is never added twice.
