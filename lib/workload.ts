export const WORKLOAD_SCALE = 10;
export const MAX_WORKLOAD = 1;
export const MAX_WORKLOAD_UNITS = MAX_WORKLOAD * WORKLOAD_SCALE;

export function toWorkloadUnits(workload: number): number {
  if (!Number.isFinite(workload)) {
    return 0;
  }

  return Math.round(workload * WORKLOAD_SCALE);
}

export function fromWorkloadUnits(units: number): number {
  return units / WORKLOAD_SCALE;
}

export function normalizeWorkload(workload: number): number {
  return fromWorkloadUnits(toWorkloadUnits(workload));
}

export function sumWorkloadUnits(workloads: number[]): number {
  return workloads.reduce((total, workload) => total + toWorkloadUnits(workload), 0);
}

export function sumWorkloads(workloads: number[]): number {
  return fromWorkloadUnits(sumWorkloadUnits(workloads));
}

export function isWorkloadOverLimit(totalUnits: number): boolean {
  return totalUnits > MAX_WORKLOAD_UNITS;
}
