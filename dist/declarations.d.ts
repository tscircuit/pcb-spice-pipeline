import type { CircuitJson, SimulationExperiment, SimulationIbisModel, SimulationIbisPinState, SimulationDigitalStimulus } from './schema.js';
import type { IbisModelDefinition, IbisRunConfig } from '@tscircuit/ibis-to-spice';
import type { Geometry, Modeling } from './geometry.js';
export interface CircuitNodes {
    node(id: string): string;
    groundSourcePortId: string;
    mapping: Record<string, string>;
}
export type PipelineIbisModel = SimulationIbisModel & {
    pipelineId: string;
};
export interface VoltageProbePlan {
    simulationVoltageProbeId: string;
    name: string;
    column: number;
    signalSourceId: string;
    referenceSourceId: string | null;
    signalNode: string;
    referenceNode: string;
}
export interface EyePlan {
    simulationEyeDiagramId: string;
    name: string;
    simulationExperimentId: string;
    simulationVoltageProbeId: string;
    column: number;
    unitIntervalSeconds: number;
    timeOriginSeconds: number;
    startTimeSeconds: number;
    endTimeSeconds: number;
}
export interface SimulationPlan {
    simulationExperimentId: string;
    name: string;
    subcircuitId: string | null;
    durationSeconds: number;
    startTimeSeconds: number;
    maxStepSeconds: number;
    experiment: SimulationExperiment;
    states: SimulationIbisPinState[];
    stimuli: (SimulationDigitalStimulus & {
        transmission_pattern: {
            bits: string;
        };
    })[];
    probes: VoltageProbePlan[];
    eyes: EyePlan[];
    models: PipelineIbisModel[];
}
export interface ModelRunDefinition {
    definition: IbisModelDefinition;
    run: IbisRunConfig;
}
export declare function circuitNodes(circuit: CircuitJson, geometry: Geometry, modeling: Modeling): CircuitNodes;
export declare function generalDeclarations(circuit: CircuitJson, geometry: Geometry, modeling: Modeling): {
    models: {
        pipelineId: string;
        type: "simulation_ibis_model";
        source_component_id: string;
        simulation_ibis_model_id: string;
        ibis_model_asset: {
            project_relative_path: string;
            url: string;
            mimetype: string;
        };
        ibis_component_name: string;
        ibis_pin_name_to_source_port_id: Record<string, string>;
        model_value_corner: "minimum" | "maximum" | "typical";
        include_package_parasitics: boolean;
        ibis_pin_name_to_model_name?: Record<string, string> | undefined;
        ibis_pin_name_to_reference_source_port_ids?: Record<string, {
            pullup_reference_source_port_id?: string | undefined;
            pulldown_reference_source_port_id?: string | undefined;
            power_clamp_reference_source_port_id?: string | undefined;
            ground_clamp_reference_source_port_id?: string | undefined;
            external_reference_source_port_id?: string | undefined;
        }> | undefined;
    }[];
    nodes: CircuitNodes;
    plans: SimulationPlan[];
    ports: Map<string, {
        type: "source_port";
        name: string;
        source_port_id: string;
        source_component_id?: string | undefined;
        subcircuit_id?: string | undefined;
        port_hints?: string[] | undefined;
        highlight_color?: string | undefined;
        subcircuit_connectivity_map_key?: string | undefined;
        source_group_id?: string | undefined;
        pin_number?: number | undefined;
        is_output?: boolean | undefined;
        is_input?: boolean | undefined;
        is_bidirectional?: boolean | undefined;
        is_passive?: boolean | undefined;
        can_use_tri_state?: boolean | undefined;
        is_using_tri_state?: boolean | undefined;
        can_use_open_collector?: boolean | undefined;
        is_using_open_collector?: boolean | undefined;
        can_use_open_emitter?: boolean | undefined;
        is_using_open_emitter?: boolean | undefined;
        is_gpio?: boolean | undefined;
        must_be_connected?: boolean | undefined;
        provides_power?: boolean | undefined;
        requires_power?: boolean | undefined;
        provides_ground?: boolean | undefined;
        requires_ground?: boolean | undefined;
        provides_voltage?: number | undefined;
        requires_voltage?: number | undefined;
        required_voltage_tolerance?: number | undefined;
        do_not_connect?: boolean | undefined;
        include_in_board_pinout?: boolean | undefined;
        can_use_internal_pullup?: boolean | undefined;
        is_using_internal_pullup?: boolean | undefined;
        needs_external_pullup?: boolean | undefined;
        can_use_internal_pulldown?: boolean | undefined;
        is_using_internal_pulldown?: boolean | undefined;
        needs_external_pulldown?: boolean | undefined;
        can_use_open_drain?: boolean | undefined;
        is_using_open_drain?: boolean | undefined;
        can_use_push_pull?: boolean | undefined;
        is_using_push_pull?: boolean | undefined;
        should_have_decoupling_capacitor?: boolean | undefined;
        recommended_decoupling_capacitor_capacitance?: string | number | undefined;
        is_configured_for_i2c_sda?: boolean | undefined;
        is_configured_for_i2c_scl?: boolean | undefined;
        is_configured_for_spi_mosi?: boolean | undefined;
        is_configured_for_spi_miso?: boolean | undefined;
        is_configured_for_spi_sck?: boolean | undefined;
        is_configured_for_spi_cs?: boolean | undefined;
        is_configured_for_uart_tx?: boolean | undefined;
        is_configured_for_uart_rx?: boolean | undefined;
        supports_i2c_sda?: boolean | undefined;
        supports_i2c_scl?: boolean | undefined;
        supports_spi_mosi?: boolean | undefined;
        supports_spi_miso?: boolean | undefined;
        supports_spi_sck?: boolean | undefined;
        supports_spi_cs?: boolean | undefined;
        supports_uart_tx?: boolean | undefined;
        supports_uart_rx?: boolean | undefined;
        most_frequently_referenced_by_name?: string | undefined;
    }>;
};
export declare function modelRunDefinition(model: PipelineIbisModel, plan: SimulationPlan): ModelRunDefinition;
