/**
 * Spends CPU on a fixed amount of work. Time cannot decide when to stop: on Workers, clocks only
 * advance after I/O, so a loop that watches the clock would never end.
 */
export const burnCpu = (iterations: number): number => {
  let value = 1;
  for (let index = 0; index < iterations; index += 1) {
    value = (value * 31 + index) | 0;
  }
  return value;
};
