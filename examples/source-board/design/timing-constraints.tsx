import { Fragment } from "react";
import { DDR_RULES, ddrTimingGroups, ddrPairs } from "./ddr-rules";

export function TimingConstraints() {
  return (
    <>
      {ddrTimingGroups.map((group) => (
        <Fragment key={group.name}>
        <bus
          name={group.name}
          connections={group.signals}
          maxLengthSkew={group.maxLengthSkew}
          pcbAllowedLayers={[...DDR_RULES.signalLayers]}
          targetImpedance={DDR_RULES.singleEndedImpedanceOhm}
        />
        </Fragment>
      ))}
      {ddrPairs.map((pair) => (
        <Fragment key={pair.name}>
        <differentialpair
          name={pair.name}
          positiveConnection={pair.signals[0]}
          negativeConnection={pair.signals[1]}
          maxLengthSkew={DDR_RULES.pairSkewMm}
          targetDifferentialImpedance={DDR_RULES.differentialImpedanceOhm}
          pcbTraceGap={DDR_RULES.provisionalPairGapMm}
        />
        </Fragment>
      ))}
      {/* RESET# is not in TI Table 7-67's clocked ADDR_CTRL class. */}
      <bus
        name="DDR_RESET_LAYER"
        connections={["DDR_RESETn_SIGNAL"]}
        pcbAllowedLayers={[...DDR_RULES.signalLayers]}
      />
    </>
  );
}
