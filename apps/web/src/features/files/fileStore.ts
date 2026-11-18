import { Store, useStore } from "@tanstack/react-store";
import { SAMPLE_NOW, fileTrees, type Entry } from "../sample-data/data";
import { currentMountIds } from "../storage/mountStore";
import {
  createFolderIn,
  putFileIn,
  removeIn,
  renameIn,
  transferIn,
  type Outcome,
  type Transfer,
  type Trees,
} from "./tree";

/** The sample trees, kept for the whole visit so changes survive moving between pages. */
const treeStore = new Store<Trees>(fileTrees);

export const useTrees = (): Trees => useStore(treeStore, (trees) => trees);

const now = (): string => SAMPLE_NOW.toISOString();

/** Keeps the new trees of an outcome, and returns why it was refused, if it was. */
const apply = (outcome: Outcome): string | undefined => {
  if (outcome.problem === undefined) {
    treeStore.setState(() => outcome.trees);
  }
  return outcome.problem;
};

export const createFolder = (path: string, name: string): string | undefined =>
  apply(createFolderIn(treeStore.state, currentMountIds(), path, name, now()));

export const renameEntry = (path: string, from: string, to: string): string | undefined =>
  apply(renameIn(treeStore.state, currentMountIds(), path, from, to, now()));

export const removeEntries = (path: string, names: ReadonlySet<string>): string | undefined =>
  apply(removeIn(treeStore.state, currentMountIds(), path, names));

export const transferEntries = (
  transfer: Transfer,
  from: string,
  names: ReadonlySet<string>,
  to: string,
): string | undefined =>
  apply(transferIn(treeStore.state, currentMountIds(), transfer, from, names, to, now()));

export const putFile = (path: string, file: Entry): string | undefined =>
  apply(putFileIn(treeStore.state, currentMountIds(), path, file));
