import type { Storage, ToolResult } from "./storage/Storage.js";
/**
 * Handler for the `harvest_workitem_metrics` tool, exported so tests can drive
 * the harvest → rollup → optional-persist flow without a live MCP transport.
 * `write` defaults to false → zero writes (AC-9). Always returns the per-record
 * array + rollup as a JSON text block.
 */
export declare function handleHarvestWorkitemMetrics(storage: Storage, args: {
    project: string;
    workitem_root: string;
    write?: boolean;
}): Promise<ToolResult>;
//# sourceMappingURL=server.d.ts.map