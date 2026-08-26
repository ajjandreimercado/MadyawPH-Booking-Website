import { clsx } from 'clsx';

/** Gray placeholder bar / block for layout-before-content loading. */
export function Skeleton({
  className,
  rounded = 'rounded-lg',
}: {
  className?: string;
  rounded?: string;
}) {
  return (
    <div
      className={clsx('animate-pulse bg-brand-dark/10', rounded, className)}
      aria-hidden
    />
  );
}

export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={clsx('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={clsx('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')}
          rounded="rounded-full"
        />
      ))}
    </div>
  );
}

export function DestinationCardSkeleton() {
  return (
    <div className="relative h-52 rounded-2xl overflow-hidden">
      <Skeleton className="absolute inset-0" rounded="rounded-2xl" />
      <div className="absolute bottom-4 left-4 space-y-2 w-2/3">
        <Skeleton className="h-5 w-3/4" rounded="rounded-full" />
        <Skeleton className="h-3 w-1/2" rounded="rounded-full" />
      </div>
    </div>
  );
}

export function HotelCardSkeleton({ list = false }: { list?: boolean }) {
  return (
    <div
      className={clsx(
        'bg-brand-cream rounded-2xl border border-brand-primary/10 overflow-hidden',
        list && 'flex flex-col sm:flex-row',
      )}
    >
      <Skeleton className={clsx(list ? 'w-full sm:w-56 md:w-64 h-48 sm:min-h-[200px] shrink-0' : 'h-48', 'rounded-none')} />
      <div className="p-5 space-y-3 flex-1">
        <Skeleton className="h-5 w-2/3" rounded="rounded-full" />
        <Skeleton className="h-3 w-1/2" rounded="rounded-full" />
        <Skeleton className="h-3 w-full" rounded="rounded-full" />
        <div className="flex justify-between pt-2">
          <Skeleton className="h-8 w-24" rounded="rounded-full" />
          <Skeleton className="h-8 w-20" rounded="rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function HotelDetailSkeleton() {
  return (
    <div className="page-shell pt-28 pb-16 space-y-8 animate-pulse">
      <Skeleton className="h-8 w-48" rounded="rounded-full" />
      <div className="grid grid-cols-1 md:grid-cols-4 md:grid-rows-2 gap-2 md:h-[400px]">
        <Skeleton className="md:col-span-2 md:row-span-2 h-56 md:h-auto rounded-2xl" />
        <Skeleton className="hidden md:block h-full rounded-xl" />
        <Skeleton className="hidden md:block h-full rounded-xl" />
        <Skeleton className="hidden md:block h-full rounded-xl" />
        <Skeleton className="hidden md:block h-full rounded-xl" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <Skeleton className="h-10 w-3/4" rounded="rounded-full" />
          <Skeleton className="h-4 w-1/2" rounded="rounded-full" />
          <SkeletonText lines={4} />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function BookingFormSkeleton() {
  return (
    <div className="page-shell pt-28 pb-16">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        <div className="lg:col-span-3 space-y-6">
          <Skeleton className="h-8 w-56" rounded="rounded-full" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-brand-primary/10 p-5 space-y-4">
              <Skeleton className="h-4 w-40" rounded="rounded-full" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Skeleton className="h-11 rounded-xl" />
                <Skeleton className="h-11 rounded-xl" />
              </div>
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
          ))}
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-brand-primary/10 p-5 space-y-4 sticky top-28">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-5 w-3/4" rounded="rounded-full" />
            <SkeletonText lines={5} />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConfirmationSkeleton() {
  return (
    <div className="min-h-screen bg-brand-background pt-32 pb-20">
      <div className="max-w-2xl mx-auto px-4 space-y-6">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="w-20 h-20 rounded-full" />
          <Skeleton className="h-8 w-72" rounded="rounded-full" />
          <Skeleton className="h-4 w-80" rounded="rounded-full" />
        </div>
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="rounded-2xl border border-brand-primary/10 p-6 space-y-4">
          <Skeleton className="h-6 w-48" rounded="rounded-full" />
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" rounded="rounded-full" />
                <Skeleton className="h-5 w-32" rounded="rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HomeSectionsSkeleton() {
  return (
    <div className="page-shell py-12 sm:py-16 space-y-12 sm:space-y-16">
      <section>
        <div className="mb-6 space-y-2">
          <Skeleton className="h-3 w-32" rounded="rounded-full" />
          <Skeleton className="h-8 w-64" rounded="rounded-full" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <DestinationCardSkeleton key={i} />
          ))}
        </div>
      </section>
      <section>
        <div className="mb-6 space-y-2">
          <Skeleton className="h-3 w-36" rounded="rounded-full" />
          <Skeleton className="h-8 w-56" rounded="rounded-full" />
        </div>
        <div className="fluid-card-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <HotelCardSkeleton key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}
