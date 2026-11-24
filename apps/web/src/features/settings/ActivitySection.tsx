import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { ScrollableArea } from "@astryxdesign/core/ScrollableArea";
import * as stylex from "@stylexjs/stylex";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { formatCount, formatDateTime } from "../shell/format";
import { LoadingRows, QueryState } from "../shell/QueryState";
import { StatusLabel } from "../shell/StatusLabel";

// The Activity section of Settings: the audit trail (GET /api/audit), newest first, a page at a time.

export interface AuditEvent {
  id: string;
  at: string;
  action: string;
  outcome: "success" | "failure" | "locked";
  address: string | null;
  target: string | null;
  count: number;
}

export interface AuditPage {
  events: AuditEvent[];
  next: string | null;
}

export const activityKey = ["audit"] as const;

const PAGE = 50;

const styles = stylex.create({
  // The trail grows without end, so it scrolls in a viewport of its own, which the keyboard can
  // reach, rather than lengthening the page past the section's other content.
  events: {
    maxBlockSize: "min(70vh, 48rem)",
  },
});

export const useActivity = () =>
  useInfiniteQuery({
    queryKey: activityKey,
    queryFn: ({ pageParam }) =>
      apiFetch<AuditPage>(
        `/api/audit?${new URLSearchParams({
          limit: String(PAGE),
          ...(pageParam === null ? {} : { before: pageParam }),
        }).toString()}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  });

const TWO_FACTOR: Record<string, string> = {
  enabled: "Turned on two-step verification",
  disabled: "Turned off two-step verification",
  "backup codes": "Made new backup codes",
};

const PASSKEY: Record<string, string> = {
  added: "Added a passkey",
  renamed: "Renamed a passkey",
  removed: "Removed a passkey",
};

const SESSIONS: Record<string, string> = {
  one: "Signed out a session",
  all: "Signed out every session",
  others: "Signed out the other sessions",
};

const SIGN_IN: Record<string, string> = {
  password: "with the password",
  authenticator: "with the authenticator",
  "backup code": "with a backup code",
  passkey: "with a passkey",
};

const named = (prefix: string, target: string | null) =>
  target === null ? prefix : `${prefix} ${target}`;

/** What an event says, as a line of the list. */
export const describeEvent = ({ action, outcome, target }: AuditEvent): string => {
  const how = target === null ? undefined : SIGN_IN[target];
  switch (action) {
    case "sign-in":
      return `${outcome === "success" ? "Signed in" : "Refused a sign-in"}${how ? ` ${how}` : ""}`;
    case "sign-out":
      return "Signed out";
    case "registration":
      return outcome === "success" ? "Registered the owner" : "Refused a registration";
    case "import":
      return outcome === "success" ? "Imported an export" : "Refused an import";
    case "export":
      return "Exported the instance";
    case "step-up":
      return outcome === "success"
        ? "Verified again"
        : outcome === "locked"
          ? "Locked verification"
          : "Refused a verification";
    case "password":
      return "Changed the password";
    case "email":
      return "Changed the email";
    case "two-factor":
      return TWO_FACTOR[target ?? ""] ?? "Changed two-step verification";
    case "passkey":
      return PASSKEY[target ?? ""] ?? "Changed a passkey";
    case "sessions":
      return SESSIONS[target ?? ""] ?? "Signed out sessions";
    case "key.create":
      return named("Created the key", target);
    case "key.rename":
      return named("Renamed a key to", target);
    case "key.revoke":
      return "Revoked a key";
    case "backend.create":
      return named("Added the backend", target);
    case "backend.edit":
      return named("Changed the backend", target);
    case "backend.remove":
      return "Removed a backend";
    case "mount.create":
      return named("Created the mount", target);
    case "mount.edit":
      return "Changed a mount";
    case "mount.remove":
      return "Removed a mount";
    case "settings":
      return "Changed the default backend";
    case "webdav.auth":
      return "Refused a WebDAV key";
    default:
      return action;
  }
};

/** When, from where, and how often an event happened. */
export const eventDetails = (event: AuditEvent): string =>
  [
    formatDateTime(event.at),
    ...(event.address === null ? [] : [event.address]),
    ...(event.action === "webdav.auth" && event.target !== null ? [`${event.target}…`] : []),
    ...(event.count > 1 ? [`${formatCount(event.count)} times`] : []),
  ].join(" · ");

export const ActivityContent = () => {
  const activity = useActivity();
  return (
    <QueryState
      query={activity}
      title="Cannot read the activity"
      loading={<LoadingRows rows={4} />}
    >
      {(data) => {
        const events = data.pages.flatMap((page) => page.events);
        if (events.length === 0) return <EmptyState title="No activity yet" />;
        return (
          <VStack gap={4}>
            <ScrollableArea label="Activity" xstyle={styles.events}>
              <List density="compact" edge="flush" hasDividers>
                {events.map((event) => (
                  <ListItem
                    key={event.id}
                    label={describeEvent(event)}
                    description={eventDetails(event)}
                    endContent={
                      event.outcome === "success" ? undefined : (
                        <StatusLabel
                          tone="error"
                          label={event.outcome === "locked" ? "Locked" : "Refused"}
                        />
                      )
                    }
                  />
                ))}
              </List>
            </ScrollableArea>
            {activity.hasNextPage ? (
              <HStack>
                <Button
                  label="Show more"
                  variant="secondary"
                  isLoading={activity.isFetchingNextPage}
                  onClick={() => void activity.fetchNextPage()}
                />
              </HStack>
            ) : null}
          </VStack>
        );
      }}
    </QueryState>
  );
};
