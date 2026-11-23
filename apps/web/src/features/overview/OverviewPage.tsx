import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Text } from "@astryxdesign/core/Text";
import { spacingVars } from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { Folder, HardDrive } from "lucide-react";
import type { ReactNode } from "react";
import { webdavAddress } from "../api/dav";
import { kindLabel, useOverview, type Overview } from "../api/queries";
import { backendStatus } from "../storage/backendStatus";
import { CopyField } from "../shell/CopyField";
import { formatBytes, formatCount } from "../shell/format";
import { PageHeader } from "../shell/PageHeader";
import { usePageGutter } from "../shell/pageWidth";
import { LoadError } from "../shell/QueryState";
import { StatusLabel } from "../shell/StatusLabel";
import { TitleAction, TitleRow } from "../shell/TitleRow";
import { filesHref } from "../files/paths";
import { StorageChart } from "./charts";

const TILE_GAP = spacingVars["--spacing-4"];

const styles = stylex.create({
  // The three tiles sit side by side, or one above another, and never two above one. Once the row
  // has no room for three tiles 11rem wide, the columns' minimum jumps from a third of the row to
  // all of it.
  tiles: {
    gridTemplateColumns: `repeat(auto-fit, minmax(clamp((100% - 2 * ${TILE_GAP}) / 3, (3 * 11rem + 2 * ${TILE_GAP} - 100%) * 999, 100%), 1fr))`,
  },
  // A tile spans three rows of the tiles' grid: its label, its number, and what the number is
  // measured in. The tile takes the grid's rows as its own (subgrid), so the tiles' lines line up,
  // and its own gap keeps its parts 4 px apart rather than the 16 px between tiles.
  tile: {
    display: "grid",
    gridRow: "span 3",
    gridTemplateRows: "subgrid",
    rowGap: spacingVars["--spacing-1"],
    alignItems: "start",
  },
});

/** A headline number with what it is measured in. */
const Tile = ({
  label,
  value,
  children,
}: {
  label: string;
  value: ReactNode;
  children: ReactNode;
}) => (
  <Card elevation="low" xstyle={styles.tile}>
    <Text type="label" color="secondary">
      {label}
    </Text>
    {typeof value === "string" ? (
      <Text type="display-3" weight="semibold">
        {value}
      </Text>
    ) : (
      value
    )}
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

const plural = (count: number, one: string, many: string): string =>
  `${formatCount(count)} ${count === 1 ? one : many}`;

const Tiles = ({ overview }: { overview: Overview | undefined }) => {
  if (overview === undefined) {
    return (
      <Grid xstyle={styles.tiles} gap={4}>
        {["Stored", "Mounts", "Backends"].map((label, index) => (
          <Tile key={label} label={label} value={<Skeleton width={96} height={32} index={index} />}>
            <Skeleton width={140} height={14} index={index + 3} />
          </Tile>
        ))}
      </Grid>
    );
  }
  const { usage, mounts, backends } = overview;
  const unavailable = backends.filter((backend) => !backend.available).length;
  return (
    <Grid xstyle={styles.tiles} gap={4}>
      <Tile label="Stored" value={formatBytes(usage.bytes)}>
        <Text type="supporting" color="secondary">
          {`${plural(usage.files, "file", "files")} in ${plural(usage.collections, "folder", "folders")}`}
        </Text>
      </Tile>
      <Tile label="Mounts" value={formatCount(mounts.length)}>
        <Text type="supporting" color="secondary">
          {`On ${new Set(mounts.map((mount) => mount.backendId)).size} of ${plural(backends.length, "backend", "backends")}`}
        </Text>
      </Tile>
      <Tile label="Backends" value={formatCount(backends.length)}>
        {unavailable === 0 ? (
          <Text type="supporting" color="secondary">
            {backends.length === 1 ? "Available" : "All available"}
          </Text>
        ) : (
          <StatusLabel tone="error" label={`${formatCount(unavailable)} unavailable`} />
        )}
      </Tile>
    </Grid>
  );
};

/** Overview (PRD §8.1): what is stored and where, and whether each backend answers. */
export const OverviewPage = () => {
  const overview = useOverview();
  const gutter = usePageGutter();
  const data = overview.data;

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={gutter}>
          <VStack gap={6}>
            <PageHeader
              title="Overview"
              actions={
                <CopyField
                  label="WebDAV address"
                  isLabelHidden
                  value={webdavAddress()}
                  copyLabel="Copy address"
                  width="28rem"
                />
              }
            />

            {overview.isError && data === undefined ? (
              <LoadError
                title="Cannot read the overview"
                error={overview.error}
                isRetrying={overview.isFetching}
                onRetry={() => void overview.refetch()}
              />
            ) : (
              <>
                <Tiles overview={data} />
                <Grid columns={{ minWidth: 340, max: 2, repeat: "fit" }} gap={4}>
                  <Panel
                    title="Storage by backend"
                    action={
                      <TitleAction
                        label="Manage storage"
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
                          objects: (backend.usage?.files ?? 0) + (backend.usage?.collections ?? 0),
                        }))}
                      />
                    )}
                  </Panel>
                  <Panel title="Connections">
                    {data === undefined ? (
                      <Skeleton width="100%" height={44} />
                    ) : (
                      <List density="compact" edge="flush" hasDividers>
                        {data.backends.map((backend) => {
                          const paths = data.mounts
                            .filter((mount) => mount.backendId === backend.id)
                            .map((mount) => `/${mount.name}`);
                          return (
                            <ListItem
                              key={backend.id}
                              label={backend.name}
                              description={[kindLabel(backend.kind), ...paths].join(" · ")}
                              endContent={<StatusLabel {...backendStatus(backend)} />}
                            />
                          );
                        })}
                      </List>
                    )}
                  </Panel>
                </Grid>
                <Panel
                  title="Mounts"
                  action={
                    <TitleAction
                      label="Open Files"
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
                    <Text color="secondary">No mounts yet. Add one on Storage & Mounts.</Text>
                  ) : (
                    <List density="compact" edge="flush" hasDividers>
                      {data.mounts.map((mount) => (
                        <ListItem
                          key={mount.id}
                          label={`/${mount.name}`}
                          description={[
                            data.backends.find((backend) => backend.id === mount.backendId)?.name ??
                              "Unknown backend",
                            mount.root === "" ? "whole backend" : `/${mount.root}`,
                          ].join(" · ")}
                          href={filesHref(`/${mount.name}`)}
                        />
                      ))}
                    </List>
                  )}
                </Panel>
              </>
            )}
          </VStack>
        </LayoutContent>
      }
    />
  );
};
