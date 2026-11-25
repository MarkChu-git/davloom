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
import { useT } from "../i18n/I18nProvider";
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
  const t = useT();
  const backends = useBackends();
  const save = useSaveStorageSettings();
  const toast = useToast();
  const [chosen, setChosen] = useState(saved ?? "");
  const options = (backends.data ?? []).map((backend) => ({
    value: backend.id,
    label: backend.name,
    description: kindLabel(t, backend.kind),
  }));
  return (
    <>
      {/* In a form layout, as Profile's fields are, so the two sections' fields share a width. */}
      <FormLayout>
        <Selector
          label={t("storageSettings.defaultBackend")}
          value={chosen}
          onChange={setChosen}
          options={options}
          isDisabled={options.length === 0}
        />
      </FormLayout>
      <HStack>
        <Button
          label={t("storageSettings.save")}
          variant="primary"
          isLoading={save.isPending}
          isDisabled={chosen === "" || chosen === saved}
          onClick={() =>
            save.mutate(
              { defaultBackendId: chosen },
              {
                onSuccess: () => toast({ body: t("storageSettings.saved") }),
                onError: (error) => toast({ type: "error", body: describeError(t, error) }),
              },
            )
          }
        />
      </HStack>
    </>
  );
};

export const StorageSettingsContent = () => {
  const t = useT();
  const settings = useStorageSettings();
  return (
    <QueryState
      query={settings}
      title={t("storageSettings.cannotRead")}
      loading={<LoadingRows rows={1} />}
    >
      {(data) => <StorageForm key={data.defaultBackendId ?? ""} saved={data.defaultBackendId} />}
    </QueryState>
  );
};

const PENDING = "…";

export const AboutContent = () => {
  const t = useT();
  const info = useInstanceInfo();
  const backends = useBackends();
  const mounts = useMounts();
  const kinds = [...new Set((backends.data ?? []).map((backend) => kindLabel(t, backend.kind)))];
  const about = (pick: (value: NonNullable<typeof info.data>) => string | null): string => {
    if (info.data !== undefined) return pick(info.data) ?? t("files.unknown");
    return info.isError ? t("files.unknown") : PENDING;
  };
  return (
    <Details>
      <MetadataListItem label={t("about.version")}>
        {about((value) => value.version)}
      </MetadataListItem>
      <MetadataListItem label={t("about.commit")}>
        <Text type="code">{about((value) => value.commit?.slice(0, 12) ?? null)}</Text>
      </MetadataListItem>
      <MetadataListItem label={t("about.deployment")}>
        {about((value) => value.deployment)}
      </MetadataListItem>
      <MetadataListItem label={t("about.runtime")}>
        {about((value) => value.runtime)}
      </MetadataListItem>
      <MetadataListItem label={t("about.database")}>
        {about((value) => value.database)}
      </MetadataListItem>
      <MetadataListItem label={t("s3.region")}>{about((value) => value.region)}</MetadataListItem>
      <MetadataListItem label={t("settings.address")}>{location.origin}</MetadataListItem>
      <MetadataListItem label={t("overview.webdavAddress")}>{webdavAddress()}</MetadataListItem>
      <MetadataListItem label={t("settings.storage")}>
        {backends.data === undefined
          ? PENDING
          : kinds.length === 0
            ? t("about.none")
            : kinds.join(t("keys.pathSeparator"))}
      </MetadataListItem>
      <MetadataListItem label={t("storage.backends")}>
        {backends.data === undefined ? PENDING : t.count(backends.data.length)}
      </MetadataListItem>
      <MetadataListItem label={t("overview.mounts")}>
        {mounts.data === undefined ? PENDING : t.count(mounts.data.length)}
      </MetadataListItem>
    </Details>
  );
};
