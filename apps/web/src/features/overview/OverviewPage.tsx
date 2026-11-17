import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Layout, LayoutContent, VStack } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Table, pixel, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  backends,
  instance,
  recentErrors,
  type Mount,
  type OperationError,
  type StorageBackend,
} from "../sample-data/data";
import { formatBytes, formatCount, formatRelative } from "../sample-data/format";
import { useDefaultBackendId } from "../settings/settingsStore";
import { CopyField } from "../shell/CopyField";
import { PageHeader } from "../shell/PageHeader";
import { StatusLabel } from "../shell/StatusLabel";
import { BACKEND_STATUS } from "../storage/backendStatus";
import { useMounts } from "../storage/mountStore";
import {
  connectionSummary,
  knownCapacity,
  knownUsed,
  objectCount,
  unreachable,
  usedBytes,
} from "../storage/summary";

const backendName = (id: string): string =>
  backends.find((backend) => backend.id === id)?.name ?? id;

const onBackends = (count: number): string => `On ${count} ${count === 1 ? "backend" : "backends"}`;

const MetricCard = ({
  label,
  value,
  detail,
  children,
}: {
  label: string;
  value: string;
  detail: string;
  children?: ReactNode;
}) => (
  <Card>
    <VStack gap={2}>
      <Text type="label" color="secondary">
        {label}
      </Text>
      <Text type="display-3" weight="semibold">
        {value}
      </Text>
      <Text type="supporting" color="secondary">
        {detail}
      </Text>
      {children}
    </VStack>
  </Card>
);

const TableCard = ({
  title,
  link,
  children,
}: {
  title: string;
  link?: { label: string; href: string };
  children: ReactNode;
}) => (
  <Card>
    <VStack gap={4}>
      <HStack hAlign="between" vAlign="center">
        <Heading level={2}>{title}</Heading>
        {link === undefined ? null : <Link href={link.href}>{link.label}</Link>}
      </HStack>
      {children}
    </VStack>
  </Card>
);

const backendColumns: TableColumn<StorageBackend>[] = [
  { key: "name", header: "Backend", width: proportional(1, { minWidth: 140 }) },
  {
    key: "status",
    header: "Status",
    width: pixel(140),
    renderCell: (backend) => (
      <StatusLabel
        tone={BACKEND_STATUS[backend.status].tone}
        label={BACKEND_STATUS[backend.status].label}
      />
    ),
  },
  {
    key: "objectCount",
    header: "Objects",
    width: pixel(96),
    align: "end",
    renderCell: (backend) => <Text hasTabularNumbers>{formatCount(backend.objectCount)}</Text>,
  },
  {
    key: "usedBytes",
    header: "Used",
    width: pixel(96),
    align: "end",
    renderCell: (backend) => <Text hasTabularNumbers>{formatBytes(backend.usedBytes)}</Text>,
  },
];

const mountColumns: TableColumn<Mount>[] = [
  { key: "path", header: "Mount", width: proportional(1, { minWidth: 120 }) },
  {
    key: "backendId",
    header: "Backend",
    width: proportional(1, { minWidth: 120 }),
    renderCell: (mount) => backendName(mount.backendId),
  },
  {
    key: "bucket",
    header: "Bucket and prefix",
    width: proportional(1, { minWidth: 140 }),
    renderCell: (mount) => <Text type="code">{`${mount.bucket}/${mount.prefix}`}</Text>,
  },
];

const errorColumns: TableColumn<OperationError>[] = [
  {
    key: "at",
    header: "When",
    width: pixel(132),
    renderCell: (error) => <Text color="secondary">{formatRelative(error.at)}</Text>,
  },
  {
    key: "method",
    header: "Request",
    width: proportional(2, { minWidth: 200 }),
    renderCell: (error) => (
      <VStack gap={0.5}>
        <Text type="code">{`${error.method} ${error.path}`}</Text>
        <Text type="supporting" color="secondary">
          {error.message}
        </Text>
      </VStack>
    ),
  },
  {
    key: "status",
    header: "Status",
    width: pixel(88),
    align: "end",
    renderCell: (error) => <Text hasTabularNumbers>{error.status}</Text>,
  },
];

const WebDavAddress = () => (
  <Card>
    <VStack gap={3}>
      <Heading level={2}>WebDAV address</Heading>
      <CopyField
        label="WebDAV address"
        isLabelHidden
        value={instance.webdavUrl}
        copyLabel="Copy address"
      />
      <Text type="supporting" color="secondary">
        Add it to Finder, Windows Explorer or any WebDAV client, then sign in with a key from{" "}
        <Link href="/credentials" hasUnderline>
          Credentials
        </Link>
        .
      </Text>
    </VStack>
  </Card>
);

/** Overview (PRD §8.1): what is connected, how full it is, and what failed lately. */
export const OverviewPage = () => {
  const mounts = useMounts();
  const defaultBackendId = useDefaultBackendId();
  const defaultBackend = backends.find((backend) => backend.id === defaultBackendId);
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
              description={`${instance.name} on ${instance.deployment}. Default backend: ${defaultBackend?.name ?? "none"}.`}
              actions={
                <Button
                  label="Check connections"
                  variant="secondary"
                  icon={<Icon icon={RefreshCw} size="sm" />}
                  isLoading={isChecking}
                  onClick={checkAgain}
                />
              }
            />

            <Grid columns={{ minWidth: 150, max: 4, repeat: "fit" }} gap={4}>
              <MetricCard
                label="Backends"
                value={formatCount(backends.length)}
                detail={connectionSummary}
              />
              <MetricCard
                label="Mounts"
                value={formatCount(mounts.length)}
                detail={onBackends(new Set(mounts.map((mount) => mount.backendId)).size)}
              />
              <MetricCard
                label="Objects"
                value={formatCount(objectCount)}
                detail={`Across ${backends.length} backends`}
              />
              <MetricCard
                label="Stored"
                value={formatBytes(usedBytes)}
                detail={`${formatBytes(knownUsed)} of ${formatBytes(knownCapacity)} known capacity`}
              >
                <ProgressBar
                  label="Known capacity used"
                  isLabelHidden
                  value={knownUsed}
                  max={knownCapacity}
                />
              </MetricCard>
            </Grid>

            <WebDavAddress />

            <Divider />

            <Grid columns={{ minWidth: 360, max: 2, repeat: "fit" }} gap={4}>
              <TableCard
                title="Storage connections"
                link={{ label: "Manage storage", href: "/storage" }}
              >
                <Table
                  data={backends}
                  columns={backendColumns}
                  idKey="id"
                  density="compact"
                  textOverflow="truncate"
                />
              </TableCard>
              <TableCard title="Mounts" link={{ label: "Manage mounts", href: "/storage" }}>
                <Table
                  data={mounts}
                  columns={mountColumns}
                  idKey="id"
                  density="compact"
                  textOverflow="truncate"
                />
              </TableCard>
            </Grid>

            <TableCard title="Recent operation errors">
              <Table data={recentErrors} columns={errorColumns} idKey="id" density="compact" />
            </TableCard>
          </VStack>
        </LayoutContent>
      }
    />
  );
};
