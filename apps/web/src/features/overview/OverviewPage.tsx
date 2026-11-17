import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Layout, LayoutContent, VStack } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { colorVars, spacingVars } from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { backends, instance, recentErrors } from "../sample-data/data";
import { formatBytes, formatCount, formatRelative } from "../sample-data/format";
import { useDefaultBackendId } from "../settings/settingsStore";
import { CopyField } from "../shell/CopyField";
import { PageHeader } from "../shell/PageHeader";
import { StatusLabel } from "../shell/StatusLabel";
import { BACKEND_STATUS } from "../storage/backendStatus";
import { useMounts } from "../storage/mountStore";
import { knownCapacity, knownUsed, objectCount, unreachable, usedBytes } from "../storage/summary";
import { OperationsChart, StorageChart } from "./charts";
import { failedOperations, totalOperations } from "./operations";

const share = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });

const TILE_GAP = spacingVars["--spacing-4"];

const styles = stylex.create({
  // The three tiles sit side by side, or one above another, and never two above one. Once the row
  // has no room for three tiles 10rem wide, the columns' minimum jumps from a third of the row to
  // all of it.
  tiles: {
    gridTemplateColumns: `repeat(auto-fit, minmax(clamp((100% - 2 * ${TILE_GAP}) / 3, (3 * 10rem + 2 * ${TILE_GAP} - 100%) * 999, 100%), 1fr))`,
  },
  // A failed operation's status code takes the error color, as the failed count above it does.
  errorCode: {
    color: colorVars["--color-text-error"],
  },
});

/** A headline number with what it is measured in. */
const Tile = ({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: ReactNode;
}) => (
  <Card elevation="low">
    <VStack gap={1}>
      <Text type="label" color="secondary">
        {label}
      </Text>
      <Text type="display-3" weight="semibold">
        {value}
      </Text>
      {children}
    </VStack>
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
      <HStack hAlign="between" vAlign="center" gap={3} wrap="wrap">
        <Heading level={2}>{title}</Heading>
        {action}
      </HStack>
      {children}
    </VStack>
  </Card>
);

/** Overview (PRD §8.1): what is stored and where, whether it answers, and what failed lately. */
export const OverviewPage = () => {
  const mounts = useMounts();
  const defaultBackendId = useDefaultBackendId();
  const toast = useToast();
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
        <LayoutContent padding={6}>
          <VStack gap={6}>
            <PageHeader
              title="Overview"
              actions={
                <CopyField
                  label="WebDAV address"
                  isLabelHidden
                  value={instance.webdavUrl}
                  copyLabel="Copy address"
                  width="min(20rem, 100%)"
                />
              }
            />

            <Grid xstyle={styles.tiles} gap={4}>
              <Tile label="Stored" value={formatBytes(usedBytes)}>
                <Text type="supporting" color="secondary">
                  {`${formatCount(objectCount)} objects`}
                </Text>
              </Tile>
              <Tile label="Known capacity" value={share.format(knownUsed / knownCapacity)}>
                <ProgressBar
                  label="Known capacity used"
                  isLabelHidden
                  value={knownUsed}
                  max={knownCapacity}
                />
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
              <HStack gap={3} vAlign="center" wrap="wrap">
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
                action={<Link href="/storage">Manage storage</Link>}
              >
                <StorageChart />
              </Panel>
              <Panel
                title="Connections"
                action={
                  <Button
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
                    return (
                      <ListItem
                        key={backend.id}
                        label={
                          backend.id === defaultBackendId
                            ? `${backend.name} · Default`
                            : backend.name
                        }
                        description={paths.length === 0 ? undefined : paths.join(", ")}
                        endContent={<StatusLabel tone={tone} label={label} />}
                      />
                    );
                  })}
                </List>
              </Panel>
            </Grid>

            <Panel title="Recent operation errors">
              <List density="compact" edge="flush" hasDividers>
                {recentErrors.map((error) => (
                  <ListItem
                    key={error.id}
                    startContent={
                      <Text hasTabularNumbers weight="semibold" xstyle={styles.errorCode}>
                        {error.status}
                      </Text>
                    }
                    label={`${error.method} ${error.path}`}
                    description={error.message}
                    endContent={
                      <Text type="supporting" color="secondary">
                        {formatRelative(error.at)}
                      </Text>
                    }
                  />
                ))}
              </List>
            </Panel>
          </VStack>
        </LayoutContent>
      }
    />
  );
};
