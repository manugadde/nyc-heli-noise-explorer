const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function parseDateValue(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(normalized);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  return null;
}

function dayKeyFromStartMs(startMs) {
  return new Date(startMs).toISOString().slice(0, 10);
}

function createDayEntry(startMs, count = 0) {
  const date = new Date(startMs);
  const safeCount = Number.isFinite(Number(count)) ? Number(count) : 0;

  return {
    dayKey: dayKeyFromStartMs(startMs),
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
    monthLabel: MONTH_LABEL_FORMATTER.format(startMs),
    count: safeCount,
    startMs,
  };
}

function buildCalendarRows(entries) {
  if (!entries.length) {
    return [];
  }

  const firstMonthDays = new Set(
    entries
      .filter(
        (entry, index) =>
          index === 0 ||
          entry.month !== entries[index - 1].month ||
          entry.year !== entries[index - 1].year,
      )
      .map((entry) => entry.dayKey),
  );
  const entriesByDayKey = new Map(
    entries.map((entry) => [entry.dayKey, entry]),
  );
  const firstEntry = entries[0];
  const lastEntry = entries[entries.length - 1];
  const firstWeekStartMs =
    firstEntry.startMs - new Date(firstEntry.startMs).getUTCDay() * DAY_MS;
  const rows = [];

  for (
    let weekStartMs = firstWeekStartMs;
    weekStartMs <= lastEntry.startMs;
    weekStartMs += 7 * DAY_MS
  ) {
    const cells = [];

    for (let offset = 0; offset < 7; offset += 1) {
      const dayMs = weekStartMs + offset * DAY_MS;
      const dayKey = dayKeyFromStartMs(dayMs);
      const entry = entriesByDayKey.get(dayKey);
      cells.push(
        entry
          ? {
              entry,
              showMonth: firstMonthDays.has(dayKey),
            }
          : null,
      );
    }

    const isLastWeek = weekStartMs + 6 * DAY_MS >= lastEntry.startMs;
    rows.push({
      cells: isLastWeek
        ? cells.slice(0, cells.findLastIndex((cell) => cell !== null) + 1)
        : cells,
    });
  }

  return rows;
}

function createEmptyCell() {
  const cell = document.createElement("calcite-table-cell");
  cell.className = "calendar-spacer-cell";
  cell.setAttribute("alignment", "center");
  return cell;
}

function createDayCell(entry, showMonth, activateDay) {
  const cell = document.createElement("calcite-table-cell");
  const hasData = Number(entry.count ?? 0) > 0;

  cell.className = `calendar-cell ${entry.densityClass}`;
  cell.alignment = "start";
  cell.dataset.dayKey = entry.dayKey;
  cell.title = hasData
    ? `${entry.monthLabel} ${entry.day}, ${entry.year}: ${entry.count.toLocaleString()} flights`
    : "No data";

  if (hasData) {
    cell.tabIndex = 0;
    cell.onclick = () => {
      activateDay(entry.dayKey);
    };
    cell.onkeydown = (event) => {
      if (!["Enter", " ", "Spacebar", "Select"].includes(event.key)) {
        return;
      }

      event.preventDefault();
      activateDay(entry.dayKey);
    };
  } else {
    cell.toggleAttribute("disabled", true);
    cell.setAttribute("aria-disabled", "true");
    cell.tabIndex = -1;
    cell.setAttribute(
      "aria-label",
      `${entry.monthLabel} ${entry.day}, ${entry.year}: no data`,
    );
  }

  const dateWrapper = document.createElement("span");
  dateWrapper.className = "cell-date";

  const month = document.createElement("span");
  month.className = "cell-month";
  month.textContent = showMonth ? entry.monthLabel : "";

  const day = document.createElement("span");
  day.className = "cell-day";
  day.textContent = String(entry.day);

  dateWrapper.append(month, day);
  cell.append(dateWrapper);
  return cell;
}

function createHeatEmptyState(emptyMessage) {
  const emptyState = document.createElement("p");
  emptyState.className = "custom-heat-empty";
  emptyState.textContent = emptyMessage;
  return emptyState;
}

function syncSelectedDayCell(container, selectedDayKey) {
  let selectedCell = null;

  container.querySelectorAll(".calendar-cell").forEach((cell) => {
    const isSelected = selectedDayKey === cell.dataset.dayKey;
    cell.classList.toggle("is-selected", isSelected);
    cell.toggleAttribute("aria-selected", isSelected);

    if (isSelected) {
      selectedCell = cell;
    }
  });

  selectedCell?.focus({ preventScroll: true });
}

export function toDayStartMs(dayKey) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day, 0, 0, 0);
}

export function fillMissingDayEntries(entries) {
  if (!entries.length) {
    return [];
  }

  const sorted = [...entries].sort((a, b) => a.startMs - b.startMs);
  const entriesByDayKey = new Map(sorted.map((entry) => [entry.dayKey, entry]));
  const firstStartMs = sorted[0].startMs;
  const lastStartMs = sorted.at(-1)?.startMs ?? firstStartMs;
  const filled = [];

  for (let startMs = firstStartMs; startMs <= lastStartMs; startMs += DAY_MS) {
    const dayKey = dayKeyFromStartMs(startMs);
    filled.push(entriesByDayKey.get(dayKey) ?? createDayEntry(startMs));
  }

  return filled;
}

export async function queryDayFlightCounts(heliLayer) {
  const query = heliLayer.createQuery();
  query.where = "DateOfFlight IS NOT NULL";
  query.outStatistics = [
    {
      onStatisticField: "OBJECTID",
      outStatisticFieldName: "flight_count",
      statisticType: "count",
    },
  ];
  query.groupByFieldsForStatistics = ["DateOfFlight"];

  const result = await heliLayer.queryFeatures(query);
  const aggregatedByDay = new Map();

  for (const feature of result.features) {
    const date = parseDateValue(feature.attributes?.DateOfFlight);
    if (!date) {
      continue;
    }

    const startMs = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      0,
      0,
    );
    const dayKey = dayKeyFromStartMs(startMs);
    const count = Number(feature.attributes?.flight_count ?? 0);
    const entry = aggregatedByDay.get(dayKey) ?? createDayEntry(startMs, 0);

    entry.count += Number.isFinite(count) ? count : 0;
    aggregatedByDay.set(dayKey, entry);
  }

  return [...aggregatedByDay.values()].sort((a, b) => a.startMs - b.startMs);
}

export function createDayBrowserController({
  timeBrowserBlock,
  daySelectionNav,
  daySelectionBackAction,
  daySelectionPrevAction,
  daySelectionNextAction,
  daySelectionResetAction,
  defaultHeading,
  defaultDescription,
  getHeatEntries,
  getSelectedDayKey,
  onSelectDay,
  onClearDay,
}) {
  let cachedHeatEntries = null;
  let cachedSelectableEntries = [];
  let cachedSelectableEntryIndex = new Map();

  function getSelectableEntries() {
    const heatEntries = getHeatEntries();
    if (heatEntries === cachedHeatEntries) {
      return cachedSelectableEntries;
    }

    cachedHeatEntries = heatEntries;
    cachedSelectableEntries = heatEntries.filter(
      (entry) => Number(entry.count ?? 0) > 0,
    );
    cachedSelectableEntryIndex = new Map(
      cachedSelectableEntries.map((entry, index) => [entry.dayKey, index]),
    );
    return cachedSelectableEntries;
  }

  function updateHeader(dayKey = getSelectedDayKey()) {
    const entries = getSelectableEntries();
    const activeIndex = cachedSelectableEntryIndex.get(dayKey) ?? -1;
    const activeEntry = activeIndex >= 0 ? entries[activeIndex] : null;
    const hasSelection = Boolean(activeEntry);
    const selectedCount = Number(activeEntry?.count ?? 0);
    const heading = hasSelection
      ? `${selectedCount.toLocaleString()} flight record${selectedCount === 1 ? "" : "s"}`
      : defaultHeading;

    timeBrowserBlock.heading = heading;
    timeBrowserBlock.label = heading;
    timeBrowserBlock.description = hasSelection
      ? FULL_DATE_FORMATTER.format(activeEntry.startMs)
      : defaultDescription;
    timeBrowserBlock.collapsible = true;

    daySelectionNav.hidden = !hasSelection;
    daySelectionBackAction.hidden = !hasSelection;
    daySelectionPrevAction.hidden = !hasSelection;
    daySelectionNextAction.hidden = !hasSelection;
    daySelectionResetAction.hidden = !hasSelection;
    daySelectionPrevAction.disabled = !hasSelection || activeIndex <= 0;
    daySelectionNextAction.disabled =
      !hasSelection || activeIndex === -1 || activeIndex >= entries.length - 1;
    daySelectionResetAction.disabled = !hasSelection;
  }

  async function navigateSelectedDay(step) {
    const entries = getSelectableEntries();
    const activeIndex =
      cachedSelectableEntryIndex.get(getSelectedDayKey()) ?? -1;
    const nextEntry = entries[activeIndex + step];

    if (nextEntry) {
      await onSelectDay(nextEntry.dayKey);
    }
  }

  function bindActions() {
    const clearSelection = () => {
      onClearDay();
    };

    daySelectionBackAction.addEventListener("click", clearSelection);
    daySelectionResetAction.addEventListener("click", clearSelection);
    [
      [daySelectionPrevAction, -1],
      [daySelectionNextAction, 1],
    ].forEach(([action, step]) => {
      action.addEventListener("click", () => {
        navigateSelectedDay(step).catch(console.error);
      });
    });
  }

  return {
    bindActions,
    updateHeader,
  };
}

export function classifyDensity(entries) {
  const counts = entries
    .map((entry) => entry.count)
    .filter((count) => count > 0)
    .sort((a, b) => a - b);

  if (!counts.length) {
    return entries.map((entry) => ({ ...entry, densityClass: "density-0" }));
  }

  const q = (p) =>
    counts[Math.min(counts.length - 1, Math.floor((counts.length - 1) * p))];
  const thresholds = [q(0.2), q(0.4), q(0.6), q(0.8)];

  return entries.map((entry) => {
    if (Number(entry.count ?? 0) <= 0) {
      return { ...entry, densityClass: "density-0" };
    }

    let level = 5;
    for (let i = 0; i < thresholds.length; i += 1) {
      if (entry.count <= thresholds[i]) {
        level = i + 1;
        break;
      }
    }

    return { ...entry, densityClass: `density-${level}` };
  });
}

export function createHeatMapRenderer({
  container,
  onSelectDay,
  onClearSelection,
  emptyMessage = "No returned flight dates were found for the current data source.",
}) {
  let renderedEntries = null;
  let cachedRows = [];
  let selectedDayKey = null;

  function activateDay(dayKey) {
    if (dayKey === selectedDayKey) {
      onClearSelection?.();
      return;
    }

    onSelectDay?.(dayKey);
  }

  function getRows(entries) {
    if (entries === renderedEntries) {
      return cachedRows;
    }

    renderedEntries = entries;
    cachedRows = buildCalendarRows(
      [...entries].sort((a, b) => a.startMs - b.startMs),
    );
    return cachedRows;
  }

  return {
    render(entries, nextSelectedKey) {
      selectedDayKey = nextSelectedKey;

      if (!entries.length) {
        container.replaceChildren(createHeatEmptyState(emptyMessage));
        renderedEntries = null;
        cachedRows = [];
        return;
      }

      if (entries !== renderedEntries) {
        const rows = getRows(entries);
        const table = document.createElement("calcite-table");
        table.className = "calendar-grid";
        table.setAttribute("striped", "false");
        table.setAttribute("bordered", "false");
        table.setAttribute("scale", "s");

        rows.forEach((row) => {
          const tableRow = document.createElement("calcite-table-row");
          tableRow.className = "calendar-row";

          row.cells.forEach((cell) => {
            tableRow.append(
              cell
                ? createDayCell(cell.entry, cell.showMonth, activateDay)
                : createEmptyCell(),
            );
          });

          table.append(tableRow);
        });

        container.replaceChildren(table);
      }

      syncSelectedDayCell(container, nextSelectedKey);
    },
  };
}
