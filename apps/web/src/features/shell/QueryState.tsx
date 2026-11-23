import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describeError } from "../api/client";

/** Placeholder rows, as a list shows while its first answer is on the way. */
export const LoadingRows = ({ rows = 5 }: { rows?: number }) => (
  <VStack gap={3}>
    {Array.from({ length: rows }, (_, row) => (
      <HStack key={row} gap={4} vAlign="center">
        <Skeleton width={280} height={16} index={row * 3} />
        <Skeleton width={80} height={16} index={row * 3 + 1} />
        <Skeleton width={120} height={16} index={row * 3 + 2} />
      </HStack>
    ))}
  </VStack>
);

/** Why a read failed, with a button that reads again. */
export const LoadError = ({
  title,
  error,
  isRetrying,
  onRetry,
}: {
  title: string;
  error: unknown;
  isRetrying: boolean;
  onRetry: () => void;
}) => (
  <Banner
    status="error"
    title={title}
    description={describeError(error)}
    endContent={
      <Button
        label="Try again"
        variant="secondary"
        size="sm"
        isLoading={isRetrying}
        onClick={onRetry}
      />
    }
  />
);

/**
 * What a query shows: placeholders while it loads, its error with Try again when it failed, and
 * `children` with its data once it has some. A query that already has data keeps showing it while
 * it reads again.
 */
export const QueryState = <T,>({
  query,
  title,
  loading,
  children,
}: {
  query: UseQueryResult<T>;
  /** What failed, such as "Cannot read the keys". */
  title: string;
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}) => {
  if (query.data !== undefined) {
    return children(query.data);
  }
  if (query.isError) {
    return (
      <LoadError
        title={title}
        error={query.error}
        isRetrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return loading ?? <LoadingRows />;
};
