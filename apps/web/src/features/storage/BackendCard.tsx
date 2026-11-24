import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { useAnnounce } from "@astryxdesign/core/hooks";
import { HStack, Stack, VStack } from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Text } from "@astryxdesign/core/Text";
import * as stylex from "@stylexjs/stylex";
import { describeError } from "../api/client";
import { kindLabel, useVerifyBackend, type Backend, type BackendCheck } from "../api/queries";
import { formatBytes, formatCount, formatRelative } from "../shell/format";
import { StatusLabel } from "../shell/StatusLabel";
import { useNarrowerThan } from "../shell/useNarrowerThan";
import { backendStatus } from "./backendStatus";

/** The narrowest backend card, in rem, with room for the status beside the name and each value
 * beside its label. */
const WIDE_BACKEND_CARD = 21;

const styles = stylex.create({
  // A backend card spans three rows of the backend grid, one for each part: the name and status,
  // the details, and Verify connection. The card takes the grid's rows as its own (subgrid), so
  // each part starts on the same line as the parts of the cards beside it, and the actions line up
  // along the bottom of a row of cards where one card has no capacity bar.
  card: {
    display: "grid",
    gridRow: "span 3",
    gridTemplateRows: "subgrid",
    alignItems: "start",
  },
  // The status's words sit on the line of the name's. Stack's vAlign offers no baseline, so a wide
  // card's header takes this in its place.
  onBaseline: {
    alignItems: "baseline",
  },
  // An endpoint breaks anywhere rather than reach past a phone's window.
  code: {
    overflowWrap: "anywhere",
  },
});

const text = (value: string | boolean | undefined): string =>
  typeof value === "string" ? value : "";

/** Where Davloom reaches a backend: an S3 endpoint and bucket, an R2 binding, or built in. */
export const endpointOf = (backend: Backend): string | null => {
  const config = backend.config ?? {};
  if (backend.kind === "s3") {
    const endpoint = text(config.endpoint);
    const bucket = text(config.bucket);
    const prefix = text(config.prefix);
    return endpoint === "" ? null : `${endpoint}/${bucket}${prefix === "" ? "" : `/${prefix}`}`;
  }
  if (backend.kind === "r2") {
    const binding = text(config.binding);
    return binding === "" ? null : binding;
  }
  return null;
};

const checkLabel = (check: BackendCheck): string =>
  check.available
    ? `Answered just now, in ${formatCount(check.latencyMs ?? 0)} ms`
    : `Still unavailable: ${check.reason ?? "no answer"}`;

export const BackendCard = ({
  backend,
  mountCount,
  isDefault,
  checkedAt,
  onEdit,
  onRemove,
}: {
  backend: Backend;
  mountCount: number;
  isDefault: boolean;
  /** When the list of backends, and so each backend's status, was read. */
  checkedAt: number;
  onEdit: () => void;
  onRemove: () => void;
}) => {
  const announce = useAnnounce();
  const verify = useVerifyBackend();
  // A narrower card, as on the narrowest phones, puts the status under the backend's kind and
  // each label above its value.
  const [cardRef, isNarrow] = useNarrowerThan(WIDE_BACKEND_CARD);
  const usage = backend.usage;
  const capacity = backend.capacity ?? null;
  const endpoint = endpointOf(backend);
  const check = verify.data;

  const runCheck = () =>
    verify.mutate(backend.id, {
      onSuccess: (result) =>
        announce(
          result.available
            ? `${backend.name} answered.`
            : `${backend.name} is still unavailable: ${result.reason ?? "no answer"}.`,
          result.available ? "polite" : "assertive",
        ),
      onError: (error) => announce(describeError(error), "assertive"),
    });

  return (
    <Card ref={cardRef} elevation="low" xstyle={styles.card}>
      <Stack
        direction={isNarrow ? "vertical" : "horizontal"}
        hAlign={isNarrow ? "start" : "between"}
        vAlign={isNarrow ? "start" : undefined}
        gap={isNarrow ? 2 : 3}
        xstyle={isNarrow ? undefined : styles.onBaseline}
      >
        <VStack gap={0.5}>
          <Heading level={3}>{backend.name}</Heading>
          <Text type="supporting" color="secondary">
            {isDefault ? `${kindLabel(backend.kind)} · Default` : kindLabel(backend.kind)}
          </Text>
        </VStack>
        <HStack gap={1} vAlign="center">
          <StatusLabel {...backendStatus(backend)} />
          <MoreMenu
            label={`Actions for backend ${backend.name}`}
            size="sm"
            alignment="end"
            items={[
              { label: "Edit", onClick: onEdit },
              { type: "divider" },
              { label: "Remove", variant: "destructive", onClick: onRemove },
            ]}
          />
        </HStack>
      </Stack>
      <VStack gap={4}>
        <MetadataList label={isNarrow ? { position: "top" } : undefined}>
          <MetadataListItem label="Endpoint">
            {endpoint === null ? (
              "Built in"
            ) : (
              <Text type="code" xstyle={styles.code}>
                {endpoint}
              </Text>
            )}
          </MetadataListItem>
          <MetadataListItem label="Objects">
            {usage === null ? "Unknown" : formatCount(usage.files + usage.collections)}
          </MetadataListItem>
          <MetadataListItem label="Stored">
            {usage === null
              ? "Unknown"
              : capacity === null
                ? `${formatBytes(usage.bytes)}, no fixed limit`
                : `${formatBytes(usage.bytes)} of ${formatBytes(capacity)}`}
          </MetadataListItem>
          <MetadataListItem label="Mounts">{formatCount(mountCount)}</MetadataListItem>
        </MetadataList>
        {capacity === null || usage === null ? null : (
          <ProgressBar
            label={`${backend.name} capacity used`}
            isLabelHidden
            value={usage.bytes}
            max={capacity}
          />
        )}
      </VStack>
      <HStack gap={3} vAlign="center" wrap="wrap">
        <Button
          label="Verify connection"
          variant="secondary"
          size="sm"
          isLoading={verify.isPending}
          onClick={runCheck}
        />
        {check !== undefined && !verify.isPending ? (
          <StatusLabel tone={check.available ? "success" : "error"} label={checkLabel(check)} />
        ) : verify.isError ? (
          <StatusLabel tone="error" label={describeError(verify.error)} />
        ) : (
          <Text type="supporting" color="secondary">
            {`Last checked ${formatRelative(new Date(checkedAt).toISOString())}`}
          </Text>
        )}
      </HStack>
    </Card>
  );
};
