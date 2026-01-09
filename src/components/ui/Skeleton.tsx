"use client";

import { ReactNode } from "react";

interface SkeletonProps {
  className?: string;
  variant?: "text" | "circular" | "rectangular";
  width?: string | number;
  height?: string | number;
  animation?: "pulse" | "wave" | "none";
}

/**
 * Skeleton loading placeholder component.
 * Used to show loading state while content is being fetched.
 */
export default function Skeleton({
  className = "",
  variant = "text",
  width,
  height,
  animation = "pulse",
}: SkeletonProps) {
  const baseStyles = "bg-surface-alt";

  const variants = {
    text: "rounded",
    circular: "rounded-full",
    rectangular: "rounded-lg",
  };

  const animations = {
    pulse: "animate-pulse",
    wave: "animate-shimmer",
    none: "",
  };

  const defaultSizes = {
    text: { width: "100%", height: "1em" },
    circular: { width: "40px", height: "40px" },
    rectangular: { width: "100%", height: "100px" },
  };

  const style = {
    width: width ?? defaultSizes[variant].width,
    height: height ?? defaultSizes[variant].height,
  };

  return (
    <div
      className={`${baseStyles} ${variants[variant]} ${animations[animation]} ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

/**
 * Common skeleton patterns for reuse
 */

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export function TableSkeleton({ rows = 5, columns = 4 }: TableSkeletonProps) {
  return (
    <div className="w-full space-y-3">
      {/* Header */}
      <div className="flex gap-4 pb-3 border-b border-border">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={`header-${i}`} variant="text" className="flex-1 h-4" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={`row-${rowIndex}`} className="flex gap-4 py-2">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton
              key={`cell-${rowIndex}-${colIndex}`}
              variant="text"
              className="flex-1 h-4"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

interface CardSkeletonProps {
  showHeader?: boolean;
  showFooter?: boolean;
  contentLines?: number;
}

export function CardSkeleton({
  showHeader = true,
  showFooter = false,
  contentLines = 3,
}: CardSkeletonProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
      {showHeader && (
        <div className="flex items-center gap-3">
          <Skeleton variant="circular" width={40} height={40} />
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" width="60%" height={16} />
            <Skeleton variant="text" width="40%" height={12} />
          </div>
        </div>
      )}
      <div className="space-y-2">
        {Array.from({ length: contentLines }).map((_, i) => (
          <Skeleton
            key={`line-${i}`}
            variant="text"
            width={i === contentLines - 1 ? "70%" : "100%"}
            height={14}
          />
        ))}
      </div>
      {showFooter && (
        <div className="flex gap-2 pt-4 border-t border-border">
          <Skeleton variant="rectangular" width={80} height={32} />
          <Skeleton variant="rectangular" width={80} height={32} />
        </div>
      )}
    </div>
  );
}

interface ListSkeletonProps {
  items?: number;
  showAvatar?: boolean;
}

export function ListSkeleton({ items = 5, showAvatar = true }: ListSkeletonProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: items }).map((_, i) => (
        <div key={`item-${i}`} className="flex items-center gap-3 p-3 rounded-lg">
          {showAvatar && <Skeleton variant="circular" width={36} height={36} />}
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" width="50%" height={14} />
            <Skeleton variant="text" width="30%" height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

interface FormSkeletonProps {
  fields?: number;
  showSubmit?: boolean;
}

export function FormSkeleton({ fields = 4, showSubmit = true }: FormSkeletonProps) {
  return (
    <div className="space-y-6">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={`field-${i}`} className="space-y-2">
          <Skeleton variant="text" width={120} height={14} />
          <Skeleton variant="rectangular" width="100%" height={42} />
        </div>
      ))}
      {showSubmit && (
        <div className="flex gap-3 pt-4">
          <Skeleton variant="rectangular" width={100} height={40} />
          <Skeleton variant="rectangular" width={100} height={40} />
        </div>
      )}
    </div>
  );
}

/**
 * Page-level skeleton for dashboard pages
 */
interface PageSkeletonProps {
  children?: ReactNode;
}

export function PageSkeleton({ children }: PageSkeletonProps) {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton variant="text" width={200} height={28} />
          <Skeleton variant="text" width={300} height={16} />
        </div>
        <Skeleton variant="rectangular" width={120} height={40} />
      </div>

      {/* Content area */}
      {children || (
        <div className="rounded-xl border border-border bg-surface p-6">
          <TableSkeleton rows={8} columns={5} />
        </div>
      )}
    </div>
  );
}
