import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Layout, LayoutContent, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { spacingVars } from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { Folder, HardDrive, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { describeError } from "../api/client";
import { webdavAddress } from "../api/dav";
import {
  kindLabel,
  operationsQuery,
  useCheckBackends,
  useOperations,
  useOverview,
  useStorageSettings,
  type Backend,
  type Overview,
} from "../api/queries";
import { filesHref } from "../files/paths";
import { backendStatus } from "../storage/backendStatus";
import { frameTexts } from "../frame/fill";
import { useT } from "../i18n/I18nProvider";
import { AfterFirstPaint } from "../shell/AfterFirstPaint";
import { CopyField } from "../shell/CopyField";
import { PageHeader } from "../shell/PageHeader";
import { usePageGutter } from "../shell/pageWidth";
import { LoadError } from "../shell/QueryState";
import { StatusLabel } from "../shell/StatusLabel";
import { TitleAction, TitleRow } from "../shell/TitleRow";
import { OperationsChart, StorageChart } from "./lazyCharts";
import { ErrorViewSwitch, RecentErrors } from "./RecentErrors";

const TILE_GAP = spacingVars["--spacing-4"];

const styles = stylex.create({
  // The three tiles sit side by side, or one above another, and never two above one. Once the row
  // has no room for three tiles 11rem wide, the columns' minimum jumps from a third of the row to
  // all of it.
  tiles: {
    gridTemplateColumns: `repeat(auto-fit, minmax(clamp((100% - 2 * ${TILE_GAP}) / 3, (3 * 11rem + 2 * ${TILE_GAP} - 100%) * 999, 100%), 1fr))`,
  },
  // A tile spans three rows of the tiles' grid: its label, its number with any meter under it, and
  // what the number is measured in. The tile takes the grid's rows as its own (subgrid), so the
  // last lines of the tiles share a line where one tile has a meter, and its own gap keeps its
  // parts 4 px apart rather than the 16 px between tiles.
  tile: {
    display: "grid",
    gridRow: "span 3",
    gridTemplateRows: "subgrid",
    rowGap: spacingVars["--spacing-1"],
    alignItems: "start",
  },
  // Words beside a headline number, such as a status, sit on the number's baseline.
  onBaseline: {
    alignItems: "baseline",
  },
});

/** A headline number with what it is measured in, and a meter under the number where it has one. */
const Tile = ({
  label,
  value,
  meter,
  children,
}: {
  label: string;
  value: ReactNode;
  meter?: ReactNode;
  children: ReactNode;
}) => (
  <Card elevation="low" xstyle={styles.tile}>
    <Text type="label" color="secondary">
      {label}
    </Text>
    <VStack gap={1}>
      {typeof value === "string" ? (
        <Text type="display-3" weight="semibold">
          {value}
        </Text>
      ) : (
        value
      )}
      {meter}
    </VStack>
    {children}
  </Card>
);

const Panel = ({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) => (
  <Card elevation="low">
    <VStack gap={4}>
      <TitleRow title={<Heading level={2}>{title}</Heading>} actions={action} gap={3} />
      {children}
    </VStack>
  </Card>
);

/** The bytes stored on the backends that know their limit, and that limit in all. */
export const knownCapacity = (
  backends: readonly Backend[],
): { used: number; capacity: number } | null => {
  const known = backends.filter(
    (backend): backend is Backend & { capacity: number } =>
      typeof backend.capacity === "number" && backend.capacity > 0,
  );
  if (known.length === 0) return null;
  return {
    used: known.reduce((sum, backend) => sum + (backend.usage?.bytes ?? 0), 0),
    capacity: known.reduce((sum, backend) => sum + backend.capacity, 0),
  };
};

/** The tiles, with the name of the slot the frame's script writes each one's texts into. */
const TILE_SLOTS = [
  ["overview.stored", "stored"],
  ["overview.knownCapacity", "capacity"],
  ["overview.mounts", "mounts"],
] as const;

/**
 * The tiles while the overview is on its way. Beside each skeleton is an empty, hidden slot of
 * the type the value takes, so in the prerendered frame the script in the page's head
 * (features/frame/fill.ts) can write the value there as soon as the API answers, before the
 * page's code has loaded.
 */
const LoadingTiles = () => {
  const t = useT();
  return (
    <Grid xstyle={styles.tiles} gap={4}>
      {TILE_SLOTS.map(([label, slot], index) => (
        <Tile
          key={slot}
          label={t(label)}
          value={
            <>
              <Skeleton width={96} height={32} index={index} data-frame-placeholder={slot} />
              <Text type="display-3" weight="semibold" data-frame-slot={slot} hidden>
                {""}
              </Text>
            </>
          }
        >
          <Skeleton
            width={140}
            height={14}
            index={index + 3}
            data-frame-placeholder={`${slot}-caption`}
          />
          <Text type="supporting" color="secondary" data-frame-slot={`${slot}-caption`} hidden>
            {""}
          </Text>
        </Tile>
      ))}
    </Grid>
  );
};

const Tiles = ({ overview }: { overview: Overview | undefined }) => {
  const t = useT();
  if (overview === undefined) return <LoadingTiles />;
  const known = knownCapacity(overview.backends);
  // The texts the frame's script wrote before the page's code loaded, written the same way.
  const texts = frameTexts.overviewTexts(overview, t.locale);
  const share = new Intl.NumberFormat(t.locale, { style: "percent", maximumFractionDigits: 1 });
  return (
    <Grid xstyle={styles.tiles} gap={4}>
      <Tile label={t("overview.stored")} value={texts.stored}>
        <Text type="supporting" color="secondary">
          {texts["stored-caption"]}
        </Text>
      </Tile>
      {known === null ? (
        <Tile label={t("overview.knownCapacity")} value={texts.capacity}>
          <Text type="supporting" color="secondary">
            {texts["capacity-caption"]}
          </Text>
        </Tile>
      ) : (
        <Tile
          label={t("overview.knownCapacity")}
          value={share.format(known.used / known.capacity)}
          meter={
            <ProgressBar
              label={t("overview.knownCapacityUsed")}
              isLabelHidden
              value={known.used}
              max={known.capacity}
            />
          }
        >
          <Text type="supporting" color="secondary">
            {t("overview.bytesOf", {
              used: t.bytes(known.used),
              capacity: t.bytes(known.capacity),
            })}
          </Text>
        </Tile>
      )}
      <Tile label={t("overview.mounts")} value={texts.mounts}>
        <Text type="supporting" color="secondary">
          {texts["mounts-caption"]}
        </Text>
      </Tile>
    </Grid>
  );
};

const OperationsPanel = () => {
  const t = useT();
  const operations = useOperations();
  const data = operations.data;
  const total = data?.hours.reduce((sum, hour) => sum + hour.operations, 0) ?? 0;
  const failed = data?.hours.reduce((sum, hour) => sum + hour.failed, 0) ?? 0;
  return (
    <Panel
      title={t("overview.operations")}
      action={
        <Text type="supporting" color="secondary">
          {t("overview.last24Hours")}
        </Text>
      }
    >
      {operations.isError && data === undefined ? (
        <LoadError
          title={t("overview.cannotReadOperations")}
          error={operations.error}
          isRetrying={operations.isFetching}
          onRetry={() => void operations.refetch()}
        />
      ) : data === undefined ? (
        <Skeleton width="100%" height={200} />
      ) : (
        <>
          <HStack gap={3} wrap="wrap" xstyle={styles.onBaseline}>
            <Text type="display-3" weight="semibold">
              {t.count(total)}
            </Text>
            {failed === 0 ? null : (
              <StatusLabel tone="error" label={t("overview.failedCount", { count: failed })} />
            )}
          </HStack>
          <OperationsChart hours={data.hours} />
        </>
      )}
    </Panel>
  );
};

const RecentErrorsPanel = () => {
  const t = useT();
  // The Operations panel above shows a failed read and offers Try again; this panel, put on the
  // page after it, does not read again on its own.
  const operations = useQuery({ ...operationsQuery, retryOnMount: false });
  const errors = operations.data?.errors;
  return (
    <Panel title={t("overview.recentErrors")} action={<ErrorViewSwitch />}>
      {errors === undefined ? (
        operations.isError ? (
          <Text color="secondary">{describeError(t, operations.error)}</Text>
        ) : (
          <Skeleton width="100%" height={44} />
        )
      ) : (
        <RecentErrors errors={errors} readAt={operations.dataUpdatedAt} />
      )}
    </Panel>
  );
};

/** Overview (PRD §8.1): what is stored and where, whether it answers, and what failed lately. */
export const OverviewPage = () => {
  const t = useT();
  const overview = useOverview();
  const settings = useStorageSettings();
  const check = useCheckBackends();
  const toast = useToast();
  const gutter = usePageGutter();
  const data = overview.data;
  const defaultBackendId = settings.data?.defaultBackendId ?? null;

  const checkConnections = () =>
    check.mutate(undefined, {
      onSuccess: (results) => {
        const checked = t("overview.checked", {
          backends: t("count.backends", { count: results.length }),
        });
        const down = results.filter((result) => !result.available);
        // A backend that still does not answer is a failure, which error toasts announce assertively.
        toast(
          down.length === 0
            ? { body: t("overview.allAnswered", { checked }), uniqueID: "check" }
            : {
                type: "error",
                body: t("overview.someDown", {
                  checked,
                  down: down
                    .map((result) =>
                      t("overview.downReason", {
                        name: result.name,
                        reason: result.reason ?? t("overview.noAnswer"),
                      }),
                    )
                    .join(t("overview.downSeparator")),
                }),
                uniqueID: "check",
              },
        );
      },
      onError: (error) =>
        toast({ type: "error", body: describeError(t, error), uniqueID: "check" }),
    });

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={gutter}>
          <VStack gap={6}>
            <PageHeader
              title={t("nav.overview")}
              actions={
                <CopyField
                  label={t("overview.webdavAddress")}
                  isLabelHidden
                  value={webdavAddress()}
                  // Prerendered without the origin: the frame's script writes the whole address.
                  frameSlot="webdav-address"
                  copyLabel={t("overview.copyAddress")}
                  width="28rem"
                />
              }
            />

            {overview.isError && data === undefined ? (
              <LoadError
                title={t("overview.cannotRead")}
                error={overview.error}
                isRetrying={overview.isFetching}
                onRetry={() => void overview.refetch()}
              />
            ) : (
              <>
                {/* In the frame, so the figures paint as soon as the overview arrives. */}
                <Tiles overview={data} />
                {/* Built one part at a time once the page's header is on screen. */}
                <AfterFirstPaint>
                  <OperationsPanel />
                </AfterFirstPaint>
                <AfterFirstPaint>
                  <Grid columns={{ minWidth: 340, max: 2, repeat: "fit" }} gap={4}>
                    <Panel
                      title={t("overview.storageByBackend")}
                      action={
                        <TitleAction
                          label={t("overview.manageStorage")}
                          variant="secondary"
                          size="sm"
                          icon={<Icon icon={HardDrive} size="sm" />}
                          href="/storage"
                        />
                      }
                    >
                      {data === undefined ? (
                        <Skeleton width="100%" height={44} />
                      ) : (
                        <StorageChart
                          bars={data.backends.map((backend) => ({
                            name: backend.name,
                            bytes: backend.usage?.bytes ?? 0,
                            objects:
                              (backend.usage?.files ?? 0) + (backend.usage?.collections ?? 0),
                          }))}
                        />
                      )}
                    </Panel>
                    <Panel
                      title={t("overview.connections")}
                      action={
                        <TitleAction
                          label={t("overview.checkConnections")}
                          variant="secondary"
                          size="sm"
                          icon={<Icon icon={RefreshCw} size="sm" />}
                          isLoading={check.isPending}
                          isDisabled={data === undefined}
                          onClick={checkConnections}
                        />
                      }
                    >
                      {data === undefined ? (
                        <Skeleton width="100%" height={44} />
                      ) : (
                        <List density="compact" edge="flush" hasDividers>
                          {data.backends.map((backend) => {
                            const paths = data.mounts
                              .filter((mount) => mount.backendId === backend.id)
                              .map((mount) => `/${mount.name}`);
                            // The default backend's mark leads the line of its mounts, so a narrow
                            // window cuts the paths short rather than the mark.
                            const details = [
                              ...(backend.id === defaultBackendId ? [t("backend.default")] : []),
                              kindLabel(t, backend.kind),
                              ...paths,
                            ];
                            return (
                              <ListItem
                                key={backend.id}
                                label={backend.name}
                                description={details.join(" · ")}
                                endContent={<StatusLabel {...backendStatus(t, backend)} />}
                              />
                            );
                          })}
                        </List>
                      )}
                    </Panel>
                  </Grid>
                </AfterFirstPaint>
                <AfterFirstPaint>
                  <Panel
                    title={t("overview.mounts")}
                    action={
                      <TitleAction
                        label={t("overview.openFiles")}
                        variant="secondary"
                        size="sm"
                        icon={<Icon icon={Folder} size="sm" />}
                        href="/files"
                      />
                    }
                  >
                    {data === undefined ? (
                      <Skeleton width="100%" height={44} />
                    ) : data.mounts.length === 0 ? (
                      <Text color="secondary">{t("overview.noMounts")}</Text>
                    ) : (
                      <List density="compact" edge="outset">
                        {data.mounts.map((mount) => (
                          <ListItem
                            key={mount.id}
                            label={`/${mount.name}`}
                            description={[
                              data.backends.find((backend) => backend.id === mount.backendId)
                                ?.name ?? t("overview.unknownBackend"),
                              mount.root === "" ? t("overview.wholeBackend") : `/${mount.root}`,
                            ].join(" · ")}
                            href={filesHref(`/${mount.name}`)}
                          />
                        ))}
                      </List>
                    )}
                  </Panel>
                </AfterFirstPaint>
                <AfterFirstPaint>
                  <RecentErrorsPanel />
                </AfterFirstPaint>
              </>
            )}
          </VStack>
        </LayoutContent>
      }
    />
  );
};
