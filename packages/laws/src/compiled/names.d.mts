import type { BendList } from "../bend";

declare const module: {
  name_ok(name: BendList<number>): boolean;
  path_ok(path: BendList<BendList<number>>): boolean;
};
export default module;
