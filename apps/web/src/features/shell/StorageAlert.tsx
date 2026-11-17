import { Icon } from "@astryxdesign/core/Icon";
import { BACKEND_STATUS } from "../storage/backendStatus";
import { worstStatus } from "../storage/summary";

/**
 * A status glyph after Storage & Mounts in the side navigation while a backend is slow or
 * unreachable, so the problem shows on every page. Its label joins the link's name, such as
 * "Storage & Mounts 1 backend unreachable".
 */
export const StorageAlert = () => {
  const { status, count } = worstStatus;
  if (status === "connected") {
    return null;
  }
  const { tone, label } = BACKEND_STATUS[status];
  return (
    <Icon
      icon={tone}
      color={tone}
      size="sm"
      label={`${count} ${count === 1 ? "backend" : "backends"} ${label.toLowerCase()}`}
    />
  );
};
