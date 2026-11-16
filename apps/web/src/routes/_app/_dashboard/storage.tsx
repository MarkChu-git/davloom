import { createFileRoute } from "@tanstack/react-router";
import { StoragePage } from "../../../features/storage/StoragePage";

export const Route = createFileRoute("/_app/_dashboard/storage")({
  head: () => ({ meta: [{ title: "Storage & Mounts | Davloom" }] }),
  component: StoragePage,
});
