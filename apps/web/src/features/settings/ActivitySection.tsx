import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { ScrollableArea } from "@astryxdesign/core/ScrollableArea";
import * as stylex from "@stylexjs/stylex";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { useT } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages/en";
import type { Translator } from "../i18n/translate";
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

const TWO_FACTOR: Record<string, MessageKey> = {
  enabled: "activity.twoFactor.enabled",
  disabled: "activity.twoFactor.disabled",
  "backup codes": "activity.twoFactor.backupCodes",
};

const PASSKEY: Record<string, MessageKey> = {
  added: "activity.passkey.added",
  renamed: "activity.passkey.renamed",
  removed: "activity.passkey.removed",
};

const SESSIONS: Record<string, MessageKey> = {
  one: "activity.sessions.one",
  all: "activity.sessions.all",
  others: "activity.sessions.others",
};

const SIGN_IN: Record<string, MessageKey> = {
  password: "activity.how.password",
  authenticator: "activity.how.authenticator",
  "backup code": "activity.how.backupCode",
  passkey: "activity.how.passkey",
};

/** A message that names its target, or its own words without one. */
const named = (t: Translator, key: MessageKey, withName: MessageKey, target: string | null) =>
  target === null ? t(key) : t(withName, { name: target });

/** What an event says, as a line of the list. */
export const describeEvent = (t: Translator, { action, outcome, target }: AuditEvent): string => {
  const how = target === null ? undefined : SIGN_IN[target];
  switch (action) {
    case "sign-in":
      if (how === undefined) {
        return outcome === "success" ? t("activity.signIn") : t("activity.signInRefused");
      }
      return t(outcome === "success" ? "activity.signInHow" : "activity.signInRefusedHow", {
        how: t(how),
      });
    case "sign-out":
      return t("activity.signOut");
    case "registration":
      return outcome === "success" ? t("activity.registered") : t("activity.registrationRefused");
    case "import":
      return outcome === "success" ? t("activity.imported") : t("activity.importRefused");
    case "export":
      return t("activity.exported");
    case "step-up":
      return outcome === "success"
        ? t("activity.verified")
        : outcome === "locked"
          ? t("activity.verificationLocked")
          : t("activity.verificationRefused");
    case "password":
      return t("activity.password");
    case "email":
      return t("activity.email");
    case "two-factor":
      return t(TWO_FACTOR[target ?? ""] ?? "activity.twoFactor.changed");
    case "passkey":
      return t(PASSKEY[target ?? ""] ?? "activity.passkey.changed");
    case "sessions":
      return t(SESSIONS[target ?? ""] ?? "activity.sessions.some");
    case "key.create":
      return named(t, "activity.keyCreate", "activity.keyCreate.named", target);
    case "key.rename":
      return named(t, "activity.keyRename", "activity.keyRename.named", target);
    case "key.revoke":
      return t("activity.keyRevoke");
    case "backend.create":
      return named(t, "activity.backendCreate", "activity.backendCreate.named", target);
    case "backend.edit":
      return named(t, "activity.backendEdit", "activity.backendEdit.named", target);
    case "backend.remove":
      return t("activity.backendRemove");
    case "mount.create":
      return named(t, "activity.mountCreate", "activity.mountCreate.named", target);
    case "mount.edit":
      return t("activity.mountEdit");
    case "mount.remove":
      return t("activity.mountRemove");
    case "settings":
      return t("activity.settings");
    case "webdav.auth":
      return t("activity.webdavAuth");
    default:
      return action;
  }
};

/** When, from where, and how often an event happened. */
export const eventDetails = (t: Translator, event: AuditEvent): string =>
  [
    t.dateTime(event.at),
    ...(event.address === null ? [] : [event.address]),
    ...(event.action === "webdav.auth" && event.target !== null ? [`${event.target}…`] : []),
    ...(event.count > 1 ? [t("activity.times", { count: event.count })] : []),
  ].join(" · ");

export const ActivityContent = () => {
  const t = useT();
  const activity = useActivity();
  return (
    <QueryState
      query={activity}
      title={t("activity.cannotRead")}
      loading={<LoadingRows rows={4} />}
    >
      {(data) => {
        const events = data.pages.flatMap((page) => page.events);
        if (events.length === 0) return <EmptyState title={t("activity.none")} />;
        return (
          <VStack gap={4}>
            <ScrollableArea label={t("settings.activity")} xstyle={styles.events}>
              <List density="compact" edge="flush" hasDividers>
                {events.map((event) => (
                  <ListItem
                    key={event.id}
                    label={describeEvent(t, event)}
                    description={eventDetails(t, event)}
                    endContent={
                      event.outcome === "success" ? undefined : (
                        <StatusLabel
                          tone="error"
                          label={
                            event.outcome === "locked"
                              ? t("activity.outcome.locked")
                              : t("activity.outcome.refused")
                          }
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
                  label={t("activity.more")}
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
