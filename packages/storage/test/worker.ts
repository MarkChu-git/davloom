import { StorageObject } from "../src/durable-object";

// The Worker of the storage contract tests in workerd: the production object, and a subclass whose
// inserts and updates fail with SQLITE_FULL once a switch is on, since local workerd does not apply
// the 1 GB limit of Workers Free.
export { StorageObject };

export class FullStorageObject extends StorageObject {
  private full = false;

  setFull(full: boolean) {
    this.full = full;
  }

  protected override insertOrUpdate(query: string, bindings: SqlStorageValue[]): void {
    if (this.full) throw new Error("SQLITE_FULL: database or disk is full");
    super.insertOrUpdate(query, bindings);
  }
}

export default { fetch: () => new Response(null, { status: 404 }) };
