import { Button } from "@astryxdesign/core/Button";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { useState, type ReactNode } from "react";
import { describeError } from "../api/client";
import { webdavAddress } from "../api/dav";
import {
  kindLabel,
  useBackends,
  useInstanceInfo,
  useMounts,
  useSaveStorageSettings,
  useStorageSettings,
} from "../api/queries";
import { formatCount } from "../shell/format";
import { LoadingRows, QueryState } from "../shell/QueryState";
import { useNarrowerThan } from "../shell/useNarrowerThan";

// The Storage and About this instance sections of Settings.

/** The narrowest section, in rem, whose values have room beside their labels. */
const WIDE_DETAILS = 30;

/** Labels beside their values, or above them where a narrow section has no room. */
const Details = ({ children }: { children: ReactNode }) => {
  const [ref, isNarrow] = useNarrowerThan(WIDE_DETAILS);
  return (
    <VStack ref={ref}>
      <MetadataList label={isNarrow ? { position: "top" } : undefined}>{children}</MetadataList>
    </VStack>
  );
};

/** The default backend for new mounts, chosen from the backends and saved on the server. */
const StorageForm = ({ saved }: { saved: string | null }) => {
  const backends = useBackends();
  const save = useSaveStorageSettings();
  const toast = useToast();
  const [chosen, setChosen] = useState(saved ?? "");
  const options = (backends.data ?? []).map((backend) => ({
    value: backend.id,
    label: backend.name,
    description: kindLabel(backend.kind),
  }));
  return (
    <>
      {/* In a form layout, as Profile's fields are, so the two sections' fields share a width. */}
      <FormLayout>
        <Selector
          label="Default backend for new mounts"
          value={chosen}
          onChange={setChosen}
          options={options}
          isDisabled={options.length === 0}
        />
      </FormLayout>
      <HStack>
        <Button
          label="Save storage settings"
          variant="primary"
          isLoading={save.isPending}
          isDisabled={chosen === "" || chosen === saved}
          onClick={() =>
            save.mutate(
              { defaultBackendId: chosen },
              {
                onSuccess: () => toast({ body: "Storage settings saved." }),
                onError: (error) => toast({ type: "error", body: describeError(error) }),
              },
            )
          }
        />
      </HStack>
    </>
  );
};

export const StorageSettingsContent = () => {
  const settings = useStorageSettings();
  return (
    <QueryState
      query={settings}
      title="Cannot read the storage settings"
      loading={<LoadingRows rows={1} />}
    >
      {(data) => <StorageForm key={data.defaultBackendId ?? ""} saved={data.defaultBackendId} />}
    </QueryState>
  );
};

const PENDING = "…";

export const AboutContent = () => {
  const info = useInstanceInfo();
  const backends = useBackends();
  const mounts = useMounts();
  const kinds = [...new Set((backends.data ?? []).map((backend) => kindLabel(backend.kind)))];
  const about = (pick: (value: NonNullable<typeof info.data>) => string | null): string => {
    if (info.data !== undefined) return pick(info.data) ?? "Unknown";
    return info.isError ? "Unknown" : PENDING;
  };
  return (
    <Details>
      <MetadataListItem label="Version">{about((value) => value.version)}</MetadataListItem>
      <MetadataListItem label="Commit">
        <Text type="code">{about((value) => value.commit?.slice(0, 12) ?? null)}</Text>
      </MetadataListItem>
      <MetadataListItem label="Deployment">{about((value) => value.deployment)}</MetadataListItem>
      <MetadataListItem label="Runtime">{about((value) => value.runtime)}</MetadataListItem>
      <MetadataListItem label="Database">{about((value) => value.database)}</MetadataListItem>
      <MetadataListItem label="Region">{about((value) => value.region)}</MetadataListItem>
      <MetadataListItem label="Address">{location.origin}</MetadataListItem>
      <MetadataListItem label="WebDAV address">{webdavAddress()}</MetadataListItem>
      <MetadataListItem label="Storage">
        {backends.data === undefined ? PENDING : kinds.length === 0 ? "None" : kinds.join(", ")}
      </MetadataListItem>
      <MetadataListItem label="Backends">
        {backends.data === undefined ? PENDING : formatCount(backends.data.length)}
      </MetadataListItem>
      <MetadataListItem label="Mounts">
        {mounts.data === undefined ? PENDING : formatCount(mounts.data.length)}
      </MetadataListItem>
    </Details>
  );
};
