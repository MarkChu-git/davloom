import { operationsByHour } from "../sample-data/data";

// Totals over the sample day of operations, shared by the Overview's figure and its chart so that
// both show the same numbers.

export const totalOperations = operationsByHour.reduce((sum, hour) => sum + hour.operations, 0);

export const failedOperations = operationsByHour.reduce((sum, hour) => sum + hour.failed, 0);
