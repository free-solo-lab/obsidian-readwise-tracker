import * as React from "react";
import { t } from "../../i18n";

interface StatsPanelData {
  periodLabel: string;
  total: number;
  max: number;
  avg: number;
  active: number;
}

interface ReadwiseHeatmapPanelProps {
  displayedWeeks: Date[][];
  monthLabelByWeekIndex: Array<string | null>;
  rangeStart: Date;
  rangeEnd: Date;
  selectedDateKey: string | null;
  legendLabel: string;
  heatmapColors: string[];
  statsPanel: StatsPanelData;
  viewportRef: React.RefObject<HTMLDivElement>;
  heatmapValueByDate: (dateKey: string) => number;
  heatmapLevel: (value: number) => number;
  heatmapValueFormat: (value: number) => string;
  onToggleDate: (dateKey: string) => void;
}

export const ReadwiseHeatmapPanel: React.FC<ReadwiseHeatmapPanelProps> = ({
  displayedWeeks,
  monthLabelByWeekIndex,
  rangeStart,
  rangeEnd,
  selectedDateKey,
  legendLabel,
  heatmapColors,
  statsPanel,
  viewportRef,
  heatmapValueByDate,
  heatmapLevel,
  heatmapValueFormat,
  onToggleDate,
}) => (
  <div className="readwise-heatmap-layout">
    <div ref={viewportRef} className="readwise-heatmap-shell">
      <div className="readwise-heatmap-months">
        {displayedWeeks.map((_, weekIndex) => (
          <div key={weekIndex} className="readwise-heatmap-month-slot">
            {monthLabelByWeekIndex[weekIndex] ? (
              <div className="readwise-heatmap-month-label">{monthLabelByWeekIndex[weekIndex]}</div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="readwise-heatmap-grid-row">
        <div className="readwise-heatmap-day-labels">
          {Array.from({ length: 7 }).map((_, dayIndex) => {
            const label =
              dayIndex === 1 ? t("heatmap.mon") : dayIndex === 3 ? t("heatmap.wed") : dayIndex === 5 ? t("heatmap.fri") : "";
            return (
              <div key={dayIndex} className="readwise-heatmap-day-label">
                {label}
              </div>
            );
          })}
        </div>

        <div className="readwise-heatmap-weeks">
          {displayedWeeks.map((week, weekIndex) => (
            <div key={weekIndex} className="readwise-heatmap-week">
              {week.map((date, dayIndex) => {
                const isInRange = date >= rangeStart && date <= rangeEnd;
                const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                const value = isInRange ? heatmapValueByDate(key) : 0;
                const level = isInRange ? heatmapLevel(value) : 0;
                const isSelected = selectedDateKey === key;

                return (
                  <div
                    key={`${weekIndex}-${dayIndex}`}
                    title={isInRange ? `${key}: ${heatmapValueFormat(value)}` : ""}
                    className={`readwise-heatmap-cell${isInRange ? "" : " is-out-of-range"}${isSelected ? " is-selected" : ""}`}
                    style={{ background: isInRange ? heatmapColors[level] : "transparent" }}
                    onClick={() => {
                      if (!isInRange) {
                        return;
                      }
                      onToggleDate(key);
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>

    <div className="readwise-summary-panel">
      <div className="readwise-summary-title">{legendLabel}</div>
      <div className="readwise-summary-legend">
        <span>{t("heatmap.less")}</span>
        <div className="readwise-summary-legend-swatches">
          {heatmapColors.map((color, index) => (
            <div key={index} className="readwise-summary-legend-swatch" style={{ background: color }} />
          ))}
        </div>
        <span>{t("heatmap.more")}</span>
      </div>
      <div className="readwise-summary-metrics">
        <div>
          {statsPanel.periodLabel}: {heatmapValueFormat(statsPanel.total)}
        </div>
        <div>{t("heatmap.maxDay")}: {heatmapValueFormat(statsPanel.max)}</div>
        <div>{t("heatmap.avgActiveDay")}: {heatmapValueFormat(statsPanel.avg)}</div>
        <div>{t("heatmap.activeDays")}: {statsPanel.active}</div>
      </div>
    </div>
  </div>
);
