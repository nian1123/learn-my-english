"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const VIRTUALIZATION_THRESHOLD = 200;
const ESTIMATED_ROW_HEIGHT = 84;
const ROW_GAP = 9;
const OVERSCAN_ROWS = 8;

type IdentifiedItem = { id: string };

type VirtualizedLearningSentenceListProps<Item extends IdentifiedItem> = {
  activeIndex: number;
  className: string;
  items: readonly Item[];
  renderItem: (item: Item, index: number) => ReactNode;
};

function MeasuredVirtualRow({
  children,
  index,
  itemId,
  onMeasure,
  top,
  totalCount,
}: {
  children: ReactNode;
  index: number;
  itemId: string;
  onMeasure: (itemId: string, height: number) => void;
  top: number;
  totalCount: number;
}) {
  const rowRef = useRef<HTMLLIElement>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => onMeasure(itemId, row.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [itemId, onMeasure]);

  return (
    <li
      aria-posinset={index + 1}
      aria-setsize={totalCount}
      className="learning-sentence-item virtualized-sentence-row"
      ref={rowRef}
      style={{ transform: `translateY(${top}px)` }}
    >
      {children}
    </li>
  );
}

function indexAtOffset(offsets: readonly number[], position: number) {
  let lower = 0;
  let upper = offsets.length - 1;
  let result = 0;
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    if ((offsets[middle] ?? 0) <= position) {
      result = middle;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  return result;
}

export function VirtualizedLearningSentenceList<
  Item extends IdentifiedItem,
>({
  activeIndex,
  className,
  items,
  renderItem,
}: VirtualizedLearningSentenceListProps<Item>) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [measuredHeights, setMeasuredHeights] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const [viewport, setViewport] = useState({ height: 640, scrollTop: 0 });
  const virtualized = items.length >= VIRTUALIZATION_THRESHOLD;
  const layout = useMemo(() => {
    const offsets: number[] = [];
    const heights: number[] = [];
    let nextOffset = 0;
    for (const item of items) {
      offsets.push(nextOffset);
      const height = measuredHeights.get(item.id) ?? ESTIMATED_ROW_HEIGHT;
      heights.push(height);
      nextOffset += height + ROW_GAP;
    }
    return {
      heights,
      offsets,
      totalHeight: Math.max(0, nextOffset - ROW_GAP),
    };
  }, [items, measuredHeights]);

  const measureRow = useCallback((itemId: string, height: number) => {
    const roundedHeight = Math.ceil(height);
    setMeasuredHeights((current) => {
      if (Math.abs((current.get(itemId) ?? 0) - roundedHeight) <= 1) {
        return current;
      }
      const next = new Map(current);
      next.set(itemId, roundedHeight);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    if (!virtualized) return;
    const viewportElement = viewportRef.current;
    if (!viewportElement) return;
    const updateViewport = () => {
      setViewport({
        height: viewportElement.clientHeight,
        scrollTop: viewportElement.scrollTop,
      });
    };
    updateViewport();
    viewportElement.addEventListener("scroll", updateViewport, {
      passive: true,
    });
    const observer = new ResizeObserver(updateViewport);
    observer.observe(viewportElement);
    return () => {
      viewportElement.removeEventListener("scroll", updateViewport);
      observer.disconnect();
    };
  }, [virtualized]);

  useLayoutEffect(() => {
    if (!virtualized || activeIndex < 0) return;
    const viewportElement = viewportRef.current;
    const top = layout.offsets[activeIndex];
    const height = layout.heights[activeIndex];
    if (!viewportElement || top === undefined || height === undefined) return;
    const bottom = top + height;
    if (top < viewportElement.scrollTop) {
      viewportElement.scrollTop = top;
    } else if (
      bottom >
      viewportElement.scrollTop + viewportElement.clientHeight
    ) {
      viewportElement.scrollTop = bottom - viewportElement.clientHeight;
    }
  }, [activeIndex, layout, virtualized]);

  if (!virtualized) {
    return (
      <ol className={className}>
        {items.map((item, index) => (
          <li className="learning-sentence-item" key={item.id}>
            {renderItem(item, index)}
          </li>
        ))}
      </ol>
    );
  }

  const visibleStart = Math.max(
    0,
    indexAtOffset(layout.offsets, viewport.scrollTop) - OVERSCAN_ROWS,
  );
  const visibleEnd = Math.min(
    items.length,
    indexAtOffset(
      layout.offsets,
      viewport.scrollTop + viewport.height,
    ) +
      OVERSCAN_ROWS +
      1,
  );
  const visibleItems = items.slice(visibleStart, visibleEnd);

  return (
    <div className="virtualized-sentence-viewport" ref={viewportRef}>
      <ol
        className={`${className} virtualized-sentence-list`}
        style={{ height: layout.totalHeight }}
      >
        {visibleItems.map((item, visibleIndex) => {
          const index = visibleStart + visibleIndex;
          return (
            <MeasuredVirtualRow
              index={index}
              itemId={item.id}
              key={item.id}
              onMeasure={measureRow}
              top={layout.offsets[index] ?? 0}
              totalCount={items.length}
            >
              {renderItem(item, index)}
            </MeasuredVirtualRow>
          );
        })}
      </ol>
    </div>
  );
}
