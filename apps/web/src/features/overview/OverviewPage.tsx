import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Layout, LayoutContent, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { spacingVars } from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { HardDrive, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { backends, instance } from "../sample-data/data";
import { formatBytes, formatCount } from "../sample-data/format";
import { useDefaultBackendId } from "../settings/settingsStore";
import { CopyField } from "../shell/CopyField";
import { PageHeader } from "../shell/PageHeader";
import { usePageGutter } from "../shell/pageWidth";
import { StatusLabel } from "../shell/StatusLabel";
import { TitleAction, TitleRow } from "../shell/TitleRow";
import { BACKEND_STATUS } from "../storage/backendStatus";
import { useMounts } from "../storage/mountStore";
import { knownCapacity, knownUsed, objectCount, unreachable, usedBytes } from "../storage/summary";
import { OperationsChart, StorageChart } from "./charts";
import { failedOperations, totalOperations } from "./operations";
import { ErrorViewSwitch, RecentErrors } from "./RecentErrors";

const share = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });

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
  // parts 4 px apart rather than the 16 px between tiles. Each part keeps its own height at the top
  // of its row, as a backend card's parts do.
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
  value: string;
  meter?: ReactNode;
  children: ReactNode;
}) => (
  <Card elevation="low" xstyle={styles.tile}>
    <Text type="label" color="secondary">
      {label}
    </Text>
    <VStack gap={1}>
      <Text type="display-3" weight="semibold">
        {value}
      </Text>
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

/** Overview (PRD §8.1): what is stored and where, whether it answers, and what failed lately. */
export const OverviewPage = () => {
  const mounts = useMounts();
  const defaultBackendId = useDefaultBackendId();
  const toast = useToast();
  const gutter = usePageGutter();
  const [isChecking, setIsChecking] = useState(false);
  // Leaving the page ends the check, so its answer never shows on another page.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const checkAgain = () => {
    setIsChecking(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setIsChecking(false);
      const checked = `Checked ${backends.length} backends.`;
      // A backend that still does not answer is a failure, which error toasts announce assertively.
      toast(
        unreachable.length === 0
          ? { body: `${checked} Every one answered.`, uniqueID: "check" }
          : {
              type: "error",
              body: `${checked} ${unreachable.map((backend) => backend.name).join(", ")} ${unreachable.length === 1 ? "is" : "are"} still unreachable.`,
              uniqueID: "check",
            },
      );
    }, 900);
  };

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
                  value={instance.webdavUrl}
                  copyLabel="Copy address"
                  width="28rem"
                />
              }
            />

            <Grid xstyle={styles.tiles} gap={4}>
              <Tile label="Stored" value={formatBytes(usedBytes)}>
                <Text type="supporting" color="secondary">
                  {`${formatCount(objectCount)} objects`}
                </Text>
              </Tile>
              <Tile
                label="Known capacity"
                value={share.format(knownUsed / knownCapacity)}
                meter={
                  <ProgressBar
                    label="Known capacity used"
                    isLabelHidden
                    value={knownUsed}
                    max={knownCapacity}
                  />
                }
              >
                <Text type="supporting" color="secondary">
                  {`${formatBytes(knownUsed)} of ${formatBytes(knownCapacity)}`}
                </Text>
              </Tile>
              <Tile label="Mounts" value={formatCount(mounts.length)}>
                <Text type="supporting" color="secondary">
                  {`On ${new Set(mounts.map((mount) => mount.backendId)).size} of ${backends.length} backends`}
                </Text>
              </Tile>
            </Grid>

            <Panel
              title="Operations"
              action={
                <Text type="supporting" color="secondary">
                  Last 24 hours
                </Text>
              }
            >
              <HStack gap={3} wrap="wrap" xstyle={styles.onBaseline}>
                <Text type="display-3" weight="semibold">
                  {formatCount(totalOperations)}
                </Text>
                {failedOperations === 0 ? null : (
                  <StatusLabel tone="error" label={`${formatCount(failedOperations)} failed`} />
                )}
              </HStack>
              <OperationsChart />
            </Panel>

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
                <StorageChart />
              </Panel>
              <Panel
                title="Connections"
                action={
                  <TitleAction
                    label="Check connections"
                    variant="secondary"
                    size="sm"
                    icon={<Icon icon={RefreshCw} size="sm" />}
                    isLoading={isChecking}
                    onClick={checkAgain}
                  />
                }
              >
                <List density="compact" edge="flush" hasDividers>
                  {backends.map((backend) => {
                    const { tone, label } = BACKEND_STATUS[backend.status];
                    const paths = mounts
                      .filter((mount) => mount.backendId === backend.id)
                      .map((mount) => mount.path);
                    // The default backend's mark leads the line of its mounts, so a narrow window
                    // cuts the paths short rather than the mark.
                    const details = [
                      ...(backend.id === defaultBackendId ? ["Default"] : []),
                      ...(paths.length === 0 ? [] : [paths.join(", ")]),
                    ];
                    return (
                      <ListItem
                        key={backend.id}
                        label={backend.name}
                        description={details.length === 0 ? undefined : details.join(" · ")}
                        endContent={<StatusLabel tone={tone} label={label} />}
                      />
                    );
                  })}
                </List>
              </Panel>
            </Grid>

            <Panel title="Recent operation errors" action={<ErrorViewSwitch />}>
              <RecentErrors />
            </Panel>
          </VStack>
        </LayoutContent>
      }
    />
  );
};
