import { createAppShellController } from "./app-shell.js";
import {
  classifyDensity,
  createDayBrowserController,
  createHeatMapRenderer,
  fillMissingDayEntries,
  queryDayFlightCounts,
  toDayStartMs,
} from "./day-heatmap.js";

const [
  { sqlDateLiteral, sqlStringLiteral },
  Graphic,
  GraphicsLayer,
  Polygon,
  geodesicBufferOperator,
  unionOperator,
  reactiveUtils,
  promiseUtils,
  WebMap,
  { createModel },
] = await $arcgis.import([
  "@arcgis/core/core/sql",
  "@arcgis/core/Graphic.js",
  "@arcgis/core/layers/GraphicsLayer.js",
  "@arcgis/core/geometry/Polygon.js",
  "@arcgis/core/geometry/operators/geodesicBufferOperator.js",
  "@arcgis/core/geometry/operators/unionOperator.js",
  "@arcgis/core/core/reactiveUtils.js",
  "@arcgis/core/core/promiseUtils.js",
  "@arcgis/core/WebMap.js",
  "@arcgis/charts-components",
]);

const viewElement = document.querySelector("arcgis-map");
const tableElement = document.getElementById("noise-feature-table");
const mapTitleBanner = document.getElementById("map-title-banner");
const mapControlsBar = document.getElementById("map-controls-bar");
const customHeatChart = document.getElementById("custom-heat-chart");
const appLoadingScrim = document.getElementById("app-loading-scrim");
const flightIdList = document.getElementById("flight-id-list");
const aircraftFlow = document.getElementById("aircraft-flow");
const aircraftFlowListItem = document.getElementById("aircraft-flow-list-item");
const aircraftFlowChartItem = document.getElementById(
  "aircraft-flow-chart-item",
);
const aircraftTypeChip = document.getElementById("aircraft-type-chip");
const timeBrowserBlock = document.getElementById("time-browser-block");
const daySelectionNav = document.getElementById("day-selection-nav");
const daySelectionBackAction = document.getElementById("day-selection-back");
const daySelectionPrevAction = document.getElementById("day-selection-prev");
const daySelectionNextAction = document.getElementById("day-selection-next");
const daySelectionResetAction = document.getElementById("day-selection-reset");
const loupeStatsBlock = document.getElementById("loupe-stats-block");
const toggleNoiseComplaints = document.getElementById(
  "toggle-noise-complaints",
);
const toggleFlights = document.getElementById("toggle-flights");
const toggleLoupe = document.getElementById("toggle-loupe");
const openFiltersSheetAction = document.getElementById("open-filters-dialog");
const selectedDateFilterChip = document.getElementById("selected-date-filter");
const selectedFlightFilterChip = document.getElementById(
  "selected-flight-filter",
);
const loupePopulation = document.getElementById("loupe-population");
const loupeIncome = document.getElementById("loupe-income");
const loupeNoiseCount = document.getElementById("loupe-noise-count");
const heliRidesChart = document.getElementById("heli-rides-chart");
const openOverviewSheetAction = document.getElementById("open-overview-sheet");
const overviewSheet = document.getElementById("overview-sheet");
const filtersSheet = document.getElementById("filters-dialog");
const filtersSheetContent = document.getElementById("filters-dialog-content");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const aircraftBlock = document.getElementById("aircraft-block");
const complaintsBlock = document.getElementById("complaints-block");
const complaintsCount = document.getElementById("complaints-count");
const openComplaintsDialogAction = document.getElementById(
  "open-complaints-dialog",
);
const complaintsDialog = document.getElementById("complaints-dialog");
const mobileFiltersMediaQuery = globalThis.matchMedia("(max-width: 900px)");

const TITLE_BUFFER_TOP = 132;
const HEAT_BUFFER_BOTTOM = 322;
const TITLE_EXTENT_GAP = 16;
const RIGHT_COLUMN_WIDTH = 420;
const HELI_RIDES_CHART_ID = "Chart 1771976572578";
const HELI_RIDES_CHART_TITLE = "Flight time of a specific helicopter";
const COMPLAINTS_LAYER_ITEM_ID = "83adef2909184c65ac26f2ba0c25328";
const COMPLAINTS_LAYER_URL_SUFFIX =
  "/new_york_city_311_helicopter_noise_complaints_since_jan_1_2025/featureserver/0";
const INITIAL_VIEW_EXPANSION = 0.88;
const FOCUS_PAN_LOCK_EXPANSION = 1.08;
const LOADING_SCRIM_FADE_MS = 400;
const HIGHLIGHT_EFFECT = "drop-shadow(0px, 0px, 4px)";
const DIM_NOISE_EFFECT = "opacity(20%) grayscale(100%)";
const SHOW_DEMOGRAPHIC_LAYERS_ON_MAP = false;

function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

const requiredElements = [
  viewElement,
  mapTitleBanner,
  mapControlsBar,
  customHeatChart,
  appLoadingScrim,
  timeBrowserBlock,
  daySelectionNav,
  daySelectionBackAction,
  daySelectionPrevAction,
  daySelectionNextAction,
  daySelectionResetAction,
  loupeStatsBlock,
  loupePopulation,
  loupeIncome,
  loupeNoiseCount,
  heliRidesChart,
  flightIdList,
  aircraftFlow,
  aircraftFlowListItem,
  aircraftFlowChartItem,
  aircraftTypeChip,
  tableElement,
  complaintsCount,
  openComplaintsDialogAction,
  complaintsDialog,
  openOverviewSheetAction,
  overviewSheet,
  openFiltersSheetAction,
  filtersSheet,
  filtersSheetContent,
  aircraftBlock,
  complaintsBlock,
  toggleNoiseComplaints,
  toggleFlights,
  toggleLoupe,
  selectedDateFilterChip,
  selectedFlightFilterChip,
];
if (requiredElements.some((el) => !el)) {
  throw new Error(
    "App initialization failed: required DOM elements are missing.",
  );
}

let lastSelectedFlightListItem = null;
let selectedAircraftId = null;
let selectedAircraftType = "";
let activeFlightListWhere = "1=1";
let activeComplaintsWhere = "1=1";
let selectedDayKey = null;
let flightDataExtentForPopup = null;
let heatMapEntries = [];
let queriedHeatEntries = [];
let customHeatRenderer = null;
let complaintsTableGeometry = null;
let complaintsCountRequestId = 0;
const groupedFlightsCache = new Map();
const groupedFlightsPending = new Map();
let heliRidesChartModelPromise = null;
let daySelectionRequestId = 0;
let renderedFlightListWhere = "1=1";
let pendingLoupePointerEvent = null;
let loupePointerFrameId = 0;
let loupeStatsRequestId = 0;
let loupeReadyPromise = null;

//  Setup the map and layers

const map = new WebMap({
  portalItem: {
    id: "af17c67fbcb1467d9432f8285a999644",
  },
});
const extentOverlayLayer = new GraphicsLayer({
  listMode: "hide",
  popupEnabled: false,
});
map.add(extentOverlayLayer);

viewElement.map = map;
await map.load();

await viewElement.viewOnReady();
const view = viewElement.view;

// Keep map interactions enabled while locking rotation.
view.navigation = {
  mouseWheelZoomEnabled: true,
  browserTouchPanEnabled: true,
  momentumEnabled: true,
};

// Constraints will be set once flight data extent is resolved

const heliLayer = viewElement.map?.allLayers.find((layer) => {
  return layer.title === "Helicopter tracks";
});
const censusLayer = viewElement.map?.layers.find((layer) => {
  return layer.title === "NYC Enriched Census Tracts";
});
const neighborhoodTractsLayer = viewElement.map?.allLayers.find((layer) => {
  return (
    layer.title ===
    "Census tracts with aggregated noise complaints and helicopter paths"
  );
});
const noiseLayer = viewElement.map?.allLayers.find((layer) => {
  const title = String(layer.title || "").toLowerCase();
  const itemId = String(layer.itemId || "").toLowerCase();
  const url = String(layer.url || "").toLowerCase();
  return (
    title === "complaints since jan 2025" ||
    itemId === COMPLAINTS_LAYER_ITEM_ID ||
    url.includes(COMPLAINTS_LAYER_URL_SUFFIX)
  );
});

if (!heliLayer || !censusLayer || !neighborhoodTractsLayer || !noiseLayer) {
  throw new Error(
    "App initialization failed: one or more required layers are missing.",
  );
}

heliLayer.outFields = ["*"];
noiseLayer.outFields = ["*"];
censusLayer.outFields = ["TOTPOP_CY", "AVGHINC_CY"];
censusLayer.visible = false;
neighborhoodTractsLayer.visible = false;

await Promise.all([
  noiseLayer.load(),
  censusLayer.load(),
  neighborhoodTractsLayer.load(),
]);

const heliLayerView = await viewElement.whenLayerView(heliLayer);
const noiseLayerView = await viewElement.whenLayerView(noiseLayer);
const censusLayerView = await viewElement.whenLayerView(censusLayer);
const neighborhoodTractsLayerView = await viewElement.whenLayerView(
  neighborhoodTractsLayer,
);

function bringComplaintsLayerToTop() {
  const parentLayer = noiseLayer.parent;

  if (parentLayer?.layers?.includes(noiseLayer)) {
    parentLayer.layers.reorder(noiseLayer, parentLayer.layers.length - 1);
  }

  if (viewElement.map.layers.includes(parentLayer)) {
    viewElement.map.reorder(parentLayer, viewElement.map.layers.length - 1);
    return;
  }

  if (viewElement.map.layers.includes(noiseLayer)) {
    viewElement.map.reorder(noiseLayer, viewElement.map.layers.length - 1);
  }
}

function bringLoupeLayerToTop() {
  if (viewElement.map.layers.includes(bufferLayer)) {
    viewElement.map.reorder(bufferLayer, viewElement.map.layers.length - 1);
  }
}

bringComplaintsLayerToTop();

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAY_BROWSER_HEADING = "Filter by Day";
const DEFAULT_DAY_BROWSER_DESCRIPTION =
  "Select a day to view flights and complaints";
const FILTER_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const appShellController = createAppShellController({
  viewElement,
  mapTitleBanner,
  mapControlsBar,
  sidebarOverlay,
  mobileFiltersMediaQuery,
  filtersSheetContent,
  openFiltersSheetAction,
  filtersSheet,
  getFlightDataExtentForPopup: () => flightDataExtentForPopup,
  titleBufferTop: TITLE_BUFFER_TOP,
  heatBufferBottom: HEAT_BUFFER_BOTTOM,
  titleExtentGap: TITLE_EXTENT_GAP,
  rightColumnWidth: RIGHT_COLUMN_WIDTH,
});

const {
  applyResponsivePadding,
  scheduleOverlayPositionUpdate,
  syncResponsiveFilterSurface,
} = appShellController;

const dayBrowserController = createDayBrowserController({
  timeBrowserBlock,
  daySelectionNav,
  daySelectionBackAction,
  daySelectionPrevAction,
  daySelectionNextAction,
  daySelectionResetAction,
  defaultHeading: DEFAULT_DAY_BROWSER_HEADING,
  defaultDescription: DEFAULT_DAY_BROWSER_DESCRIPTION,
  getHeatEntries: () => heatMapEntries,
  getSelectedDayKey: () => selectedDayKey,
  onSelectDay: applyDaySelection,
  onClearDay: clearDaySelection,
});

const updateDayBrowserHeader = dayBrowserController.updateHeader;
dayBrowserController.bindActions();

applyResponsivePadding();
globalThis.addEventListener("resize", applyResponsivePadding);

syncResponsiveFilterSurface();
if (typeof mobileFiltersMediaQuery.addEventListener === "function") {
  mobileFiltersMediaQuery.addEventListener("change", () => {
    syncResponsiveFilterSurface();
    applyResponsivePadding();
    scheduleOverlayPositionUpdate();
  });
}

function createExtentOutlineSymbol() {
  return {
    type: "simple-fill",
    color: [0, 0, 0, 0],
    outline: {
      type: "simple-line",
      color: [0, 121, 94, 1],
      width: 2,
      style: "solid",
    },
  };
}

function createOuterMaskPolygon(extent) {
  const spatialReference = extent.spatialReference;
  const outerRing = spatialReference?.isGeographic
    ? [
        [-180, -90],
        [-180, 90],
        [180, 90],
        [180, -90],
        [-180, -90],
      ]
    : [
        [-20037508.3427892, -20037508.3427892],
        [-20037508.3427892, 20037508.3427892],
        [20037508.3427892, 20037508.3427892],
        [20037508.3427892, -20037508.3427892],
        [-20037508.3427892, -20037508.3427892],
      ];

  return new Polygon({
    rings: [outerRing, Polygon.fromExtent(extent).rings[0].slice().reverse()],
    spatialReference,
  });
}

async function resolveFlightDataExtent(layer) {
  await layer.load();

  if (layer.fullExtent) {
    return layer.fullExtent.clone();
  }

  const queryResult = await layer.queryExtent();
  return queryResult.extent?.clone() ?? null;
}

function addFlightExtentOutline(extent) {
  extentOverlayLayer.removeAll();

  extentOverlayLayer.addMany([
    new Graphic({
      geometry: createOuterMaskPolygon(extent),
      symbol: {
        type: "simple-fill",
        color: [233, 223, 210, 0.5],
        outline: null,
      },
    }),
    new Graphic({
      geometry: Polygon.fromExtent(extent),
      symbol: createExtentOutlineSymbol(),
    }),
  ]);
}

const flightDataExtent = await resolveFlightDataExtent(heliLayer);

if (flightDataExtent) {
  flightDataExtentForPopup = flightDataExtent.clone();
  addFlightExtentOutline(flightDataExtent);
  const panConstraintGeometry = flightDataExtent
    .clone()
    .expand(FOCUS_PAN_LOCK_EXPANSION);

  const initialViewExtent = flightDataExtent
    .clone()
    .expand(INITIAL_VIEW_EXPANSION);
  await view.goTo(initialViewExtent, { animate: false });

  view.constraints = {
    ...view.constraints,
    rotationEnabled: false,
    geometry: panConstraintGeometry,
    minZoom: 10,
    maxZoom: 15,
  };
}

function resetNoiseExtentFeatureEffect() {
  if (!flightDataExtentForPopup) {
    noiseLayerView.featureEffect = null;
    return;
  }

  noiseLayerView.featureEffect = {
    filter: {
      geometry: flightDataExtentForPopup,
      spatialRelationship: "intersects",
    },
    includedEffect: "opacity(100%)",
    excludedEffect: "opacity(14%) grayscale(82%)",
  };
}

function resetDemographicExtentFilters() {
  const filter = flightDataExtentForPopup
    ? {
        geometry: flightDataExtentForPopup,
        spatialRelationship: "intersects",
      }
    : null;

  censusLayerView.filter = filter;
  neighborhoodTractsLayerView.filter = filter;
}

function setDemographicLoupeEffect(geometry = null) {
  const effect = geometry
    ? {
        filter: {
          geometry,
          spatialRelationship: "intersects",
        },
        includedEffect: "opacity(50%)",
        excludedEffect: "opacity(18%) grayscale(100%)",
      }
    : null;

  censusLayerView.featureEffect = effect;
  neighborhoodTractsLayerView.featureEffect = effect;
}

function applyNoiseHighlightEffect(filter) {
  noiseLayerView.featureEffect = {
    filter,
    includedEffect: HIGHLIGHT_EFFECT,
    excludedEffect: DIM_NOISE_EFFECT,
  };
}

resetNoiseExtentFeatureEffect();
resetDemographicExtentFilters();

//  UI management

function bindChipSelect(chip, handler, { toggle = false } = {}) {
  if (!chip || typeof handler !== "function") {
    return;
  }

  chip.addEventListener("click", () => {
    if (toggle) {
      chip.selected = !chip.selected;
      handler(Boolean(chip.selected));
      return;
    }

    handler();
  });
}

function formatFilterDate(dayKey) {
  return FILTER_DATE_FORMATTER.format(toDayStartMs(dayKey));
}

function syncActiveFilterChips() {
  const hasSelectedDay = selectedDayKey !== null;
  const hasSelectedAircraft = selectedAircraftId !== null;

  selectedDateFilterChip.hidden = !hasSelectedDay;
  selectedDateFilterChip.value = hasSelectedDay ? selectedDayKey : "";
  selectedDateFilterChip.textContent = hasSelectedDay
    ? `Date: ${formatFilterDate(selectedDayKey)}`
    : "";

  selectedFlightFilterChip.hidden = !hasSelectedAircraft;
  selectedFlightFilterChip.value = hasSelectedAircraft
    ? String(selectedAircraftId)
    : "";
  selectedFlightFilterChip.textContent = hasSelectedAircraft
    ? `Flight: ${selectedAircraftId}`
    : "";
}

function updateFiltersChipState() {
  const hasActiveFilters =
    selectedDayKey !== null || selectedAircraftId !== null;

  openFiltersSheetAction.toggleAttribute(
    "data-has-active-filters",
    hasActiveFilters,
  );
  syncActiveFilterChips();
}

function syncFiltersChipOpenState({ forceOpen = null } = {}) {
  const isOpen = forceOpen ?? (!filtersSheet.hidden && filtersSheet.open);
  const shouldHide = filtersSheet.hidden || isOpen;

  openFiltersSheetAction.hidden = shouldHide;
  openFiltersSheetAction.selected = false;
  openFiltersSheetAction.setAttribute("aria-hidden", String(shouldHide));
  openFiltersSheetAction.setAttribute("aria-expanded", String(isOpen));
}

function focusFiltersButton() {
  if (openFiltersSheetAction.hidden) {
    return;
  }

  requestAnimationFrame(() => {
    if (typeof openFiltersSheetAction.setFocus === "function") {
      openFiltersSheetAction.setFocus();
      return;
    }

    openFiltersSheetAction.focus();
  });
}

function setDemographicLayersVisible(enabled = false) {
  const isVisible = Boolean(enabled) && SHOW_DEMOGRAPHIC_LAYERS_ON_MAP;
  censusLayer.visible = isVisible;
  neighborhoodTractsLayer.visible = isVisible;
}

function setDemographicsMode(enabled, { syncChip = false } = {}) {
  const isEnabled = Boolean(enabled);

  if (syncChip) {
    toggleLoupe.selected = isEnabled;
    toggleLoupe.toggleAttribute("selected", isEnabled);
  }

  setDemographicLayersVisible(isEnabled);
  setLoupeEnabled(isEnabled);
}

function isLayerVisibleAtCurrentScale(layer) {
  const scale = view.scale;
  const minScale = Number(layer.minScale) || 0;
  const maxScale = Number(layer.maxScale) || 0;

  return (
    Number.isFinite(scale) &&
    (!minScale || scale <= minScale) &&
    (!maxScale || scale >= maxScale)
  );
}

function syncComplaintsChipState() {
  const isScaleVisible = isLayerVisibleAtCurrentScale(noiseLayer);
  const isSelected = Boolean(noiseLayer.visible && isScaleVisible);

  toggleNoiseComplaints.selected = isSelected;
  toggleNoiseComplaints.toggleAttribute("selected", isSelected);
  toggleNoiseComplaints.toggleAttribute(
    "data-scale-unavailable",
    !isScaleVisible,
  );
}

async function zoomToComplaintsScale() {
  noiseLayer.visible = true;
  syncComplaintsChipState();

  try {
    await view.goTo({ zoom: view.zoom + 1 });
  } catch (error) {
    logNonAbortError(error);
  } finally {
    syncComplaintsChipState();
  }
}

function clearDateFilter() {
  if (selectedDayKey === null) {
    updateFiltersChipState();
    return;
  }

  clearDaySelection();
}

function clearFlightFilter() {
  if (selectedAircraftId === null) {
    updateFiltersChipState();
    return;
  }

  resetAircraftToListMode({ collapseComplaints: selectedDayKey === null });
  heliLayerView.featureEffect = null;
  resetNoiseExtentFeatureEffect();
  if (selectedDayKey === null) {
    setDayScopedBlocksVisible(false);
  }
  updateFiltersChipState();
}

toggleNoiseComplaints.addEventListener("click", () => {
  if (!isLayerVisibleAtCurrentScale(noiseLayer)) {
    zoomToComplaintsScale();
    return;
  }

  noiseLayer.visible = !noiseLayer.visible;
  syncComplaintsChipState();
});

bindChipSelect(
  toggleFlights,
  (selected) => {
    heliLayer.visible = selected;
  },
  { toggle: true },
);

bindChipSelect(
  toggleLoupe,
  (enabled) => {
    setDemographicsMode(enabled);
  },
  { toggle: true },
);

bindChipSelect(openOverviewSheetAction, () => {
  overviewSheet.open = true;
});

bindChipSelect(openFiltersSheetAction, () => {
  const isOpen = !filtersSheet.hidden && filtersSheet.open;

  filtersSheet.hidden = false;
  delete filtersSheet.dataset.filtersClosing;
  filtersSheet.open = !isOpen;
  syncFiltersChipOpenState();
});

selectedDateFilterChip.addEventListener("calciteChipClose", (event) => {
  event.preventDefault();
  event.stopPropagation();
  clearDateFilter();
});

selectedFlightFilterChip.addEventListener("calciteChipClose", (event) => {
  event.preventDefault();
  event.stopPropagation();
  clearFlightFilter();
});

filtersSheet.addEventListener("calciteDialogBeforeClose", () => {
  filtersSheet.dataset.filtersClosing = "true";
  syncFiltersChipOpenState({ forceOpen: false });
  scheduleOverlayPositionUpdate();
});

filtersSheet.addEventListener("calciteDialogClose", () => {
  filtersSheet.open = false;
  delete filtersSheet.dataset.filtersClosing;
  syncFiltersChipOpenState();
  focusFiltersButton();
});

updateFiltersChipState();
syncFiltersChipOpenState();

openComplaintsDialogAction.addEventListener("click", () => {
  complaintsDialog.open = true;
});

//  Setup the table

tableElement.layer = noiseLayer;
tableElement.visibleElements = {
  ...(tableElement.visibleElements || {}),
  columnVisibilityMenu: false,
};

function setComplaintsCount(count) {
  const safeCount = Number.isFinite(count) ? count : 0;
  complaintsCount.textContent = `${safeCount.toLocaleString()} complaint${safeCount === 1 ? "" : "s"}`;
}

function setLayerViewFilter(layerView, where) {
  if (layerView.filter?.where !== where) {
    layerView.filter = { where };
  }
}

async function refreshComplaintsCount(
  whereClause = activeComplaintsWhere,
  geometry = complaintsTableGeometry,
) {
  const requestId = ++complaintsCountRequestId;

  try {
    const countQuery = noiseLayerView.createQuery();
    countQuery.where = whereClause || "1=1";
    countQuery.geometry = geometry ?? view.extent ?? null;
    countQuery.spatialRelationship = "intersects";

    const count = await noiseLayer.queryFeatureCount(countQuery);
    if (requestId !== complaintsCountRequestId) {
      return;
    }

    setComplaintsCount(count);
  } catch {
    if (requestId !== complaintsCountRequestId) {
      return;
    }

    setComplaintsCount(0);
  }
}

const refreshVisibleComplaintsCount = promiseUtils.debounce(async () => {
  if (complaintsTableGeometry) {
    return;
  }

  tableElement.filterGeometry = view.extent;
  await refreshComplaintsCount(activeComplaintsWhere, null);
});

function applyComplaintsTableFilter(
  whereClause = activeComplaintsWhere,
  geometry = complaintsTableGeometry,
  { updateBase = false } = {},
) {
  const nextWhere = whereClause || activeComplaintsWhere;
  if (updateBase) {
    activeComplaintsWhere = nextWhere;
  }
  complaintsTableGeometry = geometry ?? null;

  if ("definitionExpression" in tableElement) {
    tableElement.definitionExpression = nextWhere;
  }

  tableElement.filterGeometry =
    complaintsTableGeometry || viewElement.view?.extent || null;

  refreshComplaintsCount(nextWhere, complaintsTableGeometry).catch(() => {
    setComplaintsCount(0);
  });
}

applyComplaintsTableFilter("1=1", null, { updateBase: true });

reactiveUtils.watch(
  () => view.extent,
  (extent) => {
    if (!complaintsTableGeometry) {
      tableElement.filterGeometry = extent;
    }
    scheduleOverlayPositionUpdate();
  },
);

reactiveUtils.watch(
  () => view.stationary,
  (stationary) => {
    if (!stationary || complaintsTableGeometry) {
      return;
    }

    refreshVisibleComplaintsCount().catch(() => {
      setComplaintsCount(0);
    });
  },
);

function setDayScopedBlocksVisible(visible) {
  aircraftBlock.hidden = !visible;
  aircraftBlock.collapsed = !visible;
  complaintsBlock.hidden = !visible;
  if (!visible && complaintsDialog) {
    complaintsDialog.open = false;
  }
}

function clearHeliSelectionState() {
  const selectionManager = viewElement.selectionManager;
  if (
    selectionManager &&
    typeof selectionManager.clearSelection === "function"
  ) {
    try {
      selectionManager.clearSelection(heliLayer);
    } catch {
      selectionManager.clearSelection();
    }
  }

  if (typeof heliRidesChart.clearSelection === "function") {
    heliRidesChart.clearSelection();
  }
}

function clearFlightTrackHighlights() {
  clearHeliSelectionState();
  heliLayerView.featureEffect = null;
  resetNoiseExtentFeatureEffect();
}

function clearDaySelection() {
  daySelectionRequestId += 1;
  setLayerViewFilter(heliLayerView, "1=1");
  setLayerViewFilter(noiseLayerView, "1=1");
  resetAircraftToListMode({ syncComplaints: false });
  selectedDayKey = null;
  activeFlightListWhere = "1=1";
  applyComplaintsTableFilter("1=1", complaintsTableGeometry, {
    updateBase: true,
  });
  groupedFlightsPending.clear();
  updateDayBrowserHeader();
  setDayScopedBlocksVisible(false);

  clearFlightTrackHighlights();
  renderCustomHeatMap();
  updateFiltersChipState();
}

function getPreferredHeatEntries() {
  if (queriedHeatEntries.length > 0) {
    return fillMissingDayEntries(queriedHeatEntries);
  }

  return [];
}

async function applyDaySelection(dayKey) {
  const requestId = ++daySelectionRequestId;

  if (selectedDayKey === dayKey) {
    updateDayBrowserHeader(dayKey);
    setDayScopedBlocksVisible(true);
    await renderFlightIdList(activeFlightListWhere || "1=1");
    if (requestId !== daySelectionRequestId) {
      return;
    }
    await syncSelectedAircraftUI(activeFlightListWhere || "1=1");
    return;
  }

  resetAircraftToListMode({ syncComplaints: false });
  clearFlightTrackHighlights();

  selectedDayKey = dayKey;
  const selectedStart = toDayStartMs(dayKey);
  const selectedEnd = selectedStart + DAY_MS;
  const heliWhere = `DateOfFlight >= ${sqlDateLiteral(selectedStart)} AND DateOfFlight < ${sqlDateLiteral(selectedEnd)}`;
  const noiseWhere = `Created_Date >= ${sqlDateLiteral(selectedStart)} AND Created_Date < ${sqlDateLiteral(selectedEnd)}`;

  setLayerViewFilter(heliLayerView, heliWhere);
  setLayerViewFilter(noiseLayerView, noiseWhere);

  activeFlightListWhere = heliWhere;
  applyComplaintsTableFilter(noiseWhere, complaintsTableGeometry, {
    updateBase: true,
  });
  setDayScopedBlocksVisible(true);
  const waitForLayerUpdate = reactiveUtils.whenOnce(
    () => !heliLayerView.updating,
  );
  await Promise.all([renderFlightIdList(heliWhere), waitForLayerUpdate]);
  if (requestId !== daySelectionRequestId) {
    return;
  }
  await syncSelectedAircraftUI(heliWhere);
  if (requestId !== daySelectionRequestId) {
    return;
  }
  updateDayBrowserHeader(dayKey);
  renderCustomHeatMap();
  updateFiltersChipState();
}

function setSelectedAttribute(element, selected) {
  element.selected = selected;
  element.toggleAttribute("selected", selected);
}

function updateAircraftSelectionUI(flightNumber = "", aircraftType = "") {
  const isDrilled = Boolean(flightNumber);
  const hasAircraftType = isDrilled && Boolean(aircraftType);

  aircraftBlock.heading = isDrilled ? "" : "Filter by Aircraft";
  aircraftBlock.description = "";
  aircraftBlock.collapsible = !isDrilled;

  setSelectedAttribute(aircraftFlowListItem, !isDrilled);

  aircraftFlowChartItem.heading = isDrilled ? String(flightNumber) : "";
  aircraftFlowChartItem.description = "";
  aircraftFlowChartItem.collapsible = true;
  aircraftTypeChip.hidden = !hasAircraftType;
  aircraftTypeChip.value = hasAircraftType ? aircraftType : "";
  aircraftTypeChip.textContent = hasAircraftType ? aircraftType : "";
  setSelectedAttribute(aircraftFlowChartItem, isDrilled);
}

function resetAircraftToListMode({
  collapseComplaints = false,
  syncComplaints = true,
} = {}) {
  clearAircraftSelectionState({ syncComplaints });
  updateAircraftSelectionUI();
  clearFlightTrackHighlights();
  if (collapseComplaints && complaintsDialog) {
    complaintsDialog.open = false;
  }
}

function clearAircraftSelectionState({ syncComplaints = true } = {}) {
  if (lastSelectedFlightListItem) {
    lastSelectedFlightListItem.selected = false;
  }
  selectedAircraftId = null;
  selectedAircraftType = "";
  lastSelectedFlightListItem = null;
  if (syncComplaints) {
    applyComplaintsTableFilter(activeComplaintsWhere, null);
  }
  updateFiltersChipState();
}

async function syncSelectedAircraftUI(baseWhereClause = activeFlightListWhere) {
  if (selectedAircraftId === null) {
    updateAircraftSelectionUI();
    return;
  }

  updateAircraftSelectionUI(selectedAircraftId, selectedAircraftType);

  heliRidesChart.model = await ensureHeliRidesChartModel();
  heliRidesChart.runtimeDataFilters = {
    where: `${baseWhereClause || "1=1"} AND r = ${sqlStringLiteral(selectedAircraftId)}`,
  };
  heliRidesChart.layer = heliLayer;
  heliRidesChart.view = viewElement.view;
  await getFilteredTracks(selectedAircraftId, baseWhereClause || "1=1");
}

async function hideAppLoadingOverlay() {
  await reactiveUtils.whenOnce(() => !view.updating);
  await nextFrame();
  await nextFrame();

  appLoadingScrim.classList.add("is-hiding");
  setTimeout(() => {
    appLoadingScrim.hidden = true;
  }, LOADING_SCRIM_FADE_MS);
}

function renderCustomHeatMap() {
  if (!customHeatRenderer) {
    return;
  }
  customHeatRenderer.render(heatMapEntries, selectedDayKey);
}

async function initCustomHeatMap() {
  customHeatRenderer = createHeatMapRenderer({
    container: customHeatChart,
    onSelectDay: applyDaySelection,
    onClearSelection: clearDaySelection,
  });

  timeBrowserBlock.loading = true;

  try {
    const preferred = getPreferredHeatEntries();
    const raw = preferred.length > 0 ? preferred : queriedHeatEntries;
    if (!raw.length) {
      queriedHeatEntries = fillMissingDayEntries(
        await queryDayFlightCounts(heliLayer),
      );
    }
    heatMapEntries = classifyDensity(getPreferredHeatEntries());
    scheduleOverlayPositionUpdate();
    renderCustomHeatMap();
  } finally {
    timeBrowserBlock.loading = false;
  }
}

//  Individual helicopter view

async function queryGroupedFlights(whereClause = "1=1") {
  const normalizedWhere = whereClause || "1=1";
  if (groupedFlightsCache.has(normalizedWhere)) {
    return groupedFlightsCache.get(normalizedWhere);
  }

  if (groupedFlightsPending.has(normalizedWhere)) {
    return groupedFlightsPending.get(normalizedWhere);
  }

  const groupedRQuery = heliLayerView.createQuery();
  groupedRQuery.where = `(${normalizedWhere}) AND r IS NOT NULL`;
  groupedRQuery.outStatistics = [
    {
      onStatisticField: "OBJECTID",
      outStatisticFieldName: "COUNT_OBJECTID_0",
      statisticType: "count",
    },
  ];
  groupedRQuery.groupByFieldsForStatistics = ["r", "desc_", "aircraft_type"];
  const pending = heliLayerView
    .queryFeatures(groupedRQuery)
    .then((result) => {
      groupedFlightsCache.set(normalizedWhere, result);
      if (groupedFlightsCache.size > 64) {
        const oldestKey = groupedFlightsCache.keys().next().value;
        groupedFlightsCache.delete(oldestKey);
      }
      groupedFlightsPending.delete(normalizedWhere);
      return result;
    })
    .catch((error) => {
      groupedFlightsPending.delete(normalizedWhere);
      throw error;
    });

  groupedFlightsPending.set(normalizedWhere, pending);
  return pending;
}

function normalizeChartId(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll(" ", "");
}

function getHeliRidesChartConfig() {
  const charts = Array.isArray(heliLayer?.charts) ? heliLayer.charts : [];
  if (!charts.length) {
    return null;
  }

  const targetChartId = normalizeChartId(HELI_RIDES_CHART_ID);
  const byId = charts.find(
    (chart) => normalizeChartId(chart?.id) === targetChartId,
  );
  if (byId) {
    return byId;
  }

  const byTitle = charts.find(
    (chart) =>
      String(chart?.title?.content?.text || "") === HELI_RIDES_CHART_TITLE,
  );
  if (byTitle) {
    return byTitle;
  }

  return charts[3] ?? charts[0];
}

async function ensureHeliRidesChartModel() {
  if (!heliRidesChartModelPromise) {
    const chartConfig = structuredClone(getHeliRidesChartConfig());
    if (!chartConfig) {
      throw new Error(
        "App initialization failed: helicopter chart config missing.",
      );
    }

    if (Array.isArray(chartConfig.axes) && chartConfig.axes.length >= 2) {
      const xAxis = chartConfig.axes[0];
      const yAxis = chartConfig.axes[1];

      xAxis.title ??= {
        type: "chartText",
        visible: true,
        content: { text: "" },
      };
      xAxis.title.content ??= { text: "" };
      xAxis.title.content.text = "Flight start time";
      xAxis.labels ??= {
        type: "chartText",
        visible: true,
        content: { text: "" },
      };
      xAxis.labels.content ??= { text: "" };
      xAxis.labels.content.text = "Flight start time";

      yAxis.title ??= {
        type: "chartText",
        visible: true,
        content: { text: "" },
      };
      yAxis.title.content ??= { text: "" };
      yAxis.title.content.text = "No. of flight records";
      yAxis.labels ??= {
        type: "chartText",
        visible: true,
        content: { text: "" },
      };
      yAxis.labels.content ??= { text: "" };
      yAxis.labels.content.text = "No. of flight records";
    }

    heliRidesChartModelPromise = createModel({
      layer: heliLayer,
      config: chartConfig,
    }).then((model) => {
      model.chartTitleVisibility = false;
      return model;
    });
  }

  return heliRidesChartModelPromise;
}

function toSqlLiteral(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function getFlightListItemFromEvent(event) {
  return event
    .composedPath()
    .find(
      (node) =>
        node instanceof HTMLElement &&
        node.matches?.("calcite-list-item[data-flight-id]"),
    );
}

flightIdList.addEventListener("click", (event) => {
  const item = getFlightListItemFromEvent(event);
  if (!item) {
    return;
  }

  if (lastSelectedFlightListItem === item) {
    item.selected = false;
    resetAircraftToListMode({ collapseComplaints: true });
    return;
  }

  const aircraftType = item.dataset.aircraftType || "";
  selectFlight(
    item.dataset.flightId,
    item,
    renderedFlightListWhere,
    aircraftType,
  ).catch((error) => {
    console.error(error);
  });
});

function populateFlightList(groupedRResults) {
  let matchedSelectedItem = null;

  const flightsWithCounts = groupedRResults.features
    .map((feature) => ({
      flightId: feature.attributes.r,
      description: feature.attributes.desc_,
      aircraftType: feature.attributes.aircraft_type,
      count: feature.attributes.COUNT_OBJECTID_0 ?? 0,
    }))
    .filter(
      (entry) =>
        entry.flightId !== null &&
        entry.flightId !== undefined &&
        entry.flightId !== "",
    );

  if (!flightsWithCounts.length) {
    const emptyItem = document.createElement("calcite-list-item");
    emptyItem.label = "No flights found";
    flightIdList.replaceChildren(emptyItem);
    return;
  }

  flightsWithCounts.sort((a, b) => {
    if (a.count !== b.count) {
      return b.count - a.count;
    }
    return String(a.flightId).localeCompare(String(b.flightId), undefined, {
      numeric: true,
    });
  });

  const listItems = new DocumentFragment();

  for (const entry of flightsWithCounts) {
    const item = document.createElement("calcite-list-item");
    const flightId = String(entry.flightId);
    const aircraftType = String(entry.aircraftType || "").trim();

    item.label = flightId;
    item.dataset.flightId = flightId;
    item.dataset.aircraftType = aircraftType;

    const tracksChip = document.createElement("calcite-chip");
    tracksChip.slot = "content-end";
    tracksChip.scale = "s";
    tracksChip.value = "tracks";
    tracksChip.closable = false;
    tracksChip.innerText = `${entry.count.toLocaleString()}`;
    tracksChip.icon = "round-about";

    item.appendChild(tracksChip);

    item.value = flightId;

    if (
      selectedAircraftId !== null &&
      flightId === String(selectedAircraftId)
    ) {
      matchedSelectedItem = item;
    }

    listItems.appendChild(item);
  }

  flightIdList.replaceChildren(listItems);

  if (matchedSelectedItem) {
    matchedSelectedItem.selected = true;
    lastSelectedFlightListItem = matchedSelectedItem;
  } else if (selectedAircraftId !== null) {
    lastSelectedFlightListItem = null;
  }
}

async function renderFlightIdList(whereClause = activeFlightListWhere) {
  const effectiveWhere = whereClause || "1=1";
  renderedFlightListWhere = effectiveWhere;
  const groupedRResults = await queryGroupedFlights(effectiveWhere);
  populateFlightList(groupedRResults);
}

async function selectFlight(
  flightId,
  listItem,
  baseWhereClause = "1=1",
  aircraftType = "",
) {
  if (lastSelectedFlightListItem) {
    lastSelectedFlightListItem.selected = false;
  }
  if (listItem) {
    listItem.selected = true;
    lastSelectedFlightListItem = listItem;
  }
  selectedAircraftId = flightId;
  selectedAircraftType = aircraftType;
  updateFiltersChipState();

  updateAircraftSelectionUI(flightId, aircraftType);

  heliRidesChart.model = await ensureHeliRidesChartModel();

  heliRidesChart.runtimeDataFilters = {
    where: `${baseWhereClause} AND r = ${sqlStringLiteral(flightId)}`,
  };
  heliRidesChart.layer = heliLayer;
  heliRidesChart.view = viewElement.view;
  await getFilteredTracks(flightId, baseWhereClause);
}

const handleAircraftFlowReturn = () => {
  resetAircraftToListMode();
};

aircraftFlowChartItem.addEventListener(
  "calciteFlowItemBack",
  handleAircraftFlowReturn,
);
aircraftFlowChartItem.addEventListener(
  "calciteFlowItemClose",
  handleAircraftFlowReturn,
);

heliRidesChart.addEventListener("arcgisSelectionComplete", async (event) => {
  if (selectedAircraftId === null) {
    return;
  }

  const selectionData = event.detail.selectionData;
  if (!selectionData?.selectionItems?.length) {
    return;
  }
  const objectIds = await reactiveUtils.whenOnce(() => {
    const ids = viewElement.selectionManager?.getSelection(heliLayer);
    return ids?.length ? [...ids] : false;
  });
  if (!objectIds?.length) {
    return;
  }

  const { features } = await heliLayerView.queryFeatures({
    objectIds,
    outFields: ["start_t"],
    returnGeometry: true,
  });
  if (!features.length) {
    return;
  }

  const geometries = features.map(({ geometry }) => geometry);
  const startTs = features.map(({ attributes }) => attributes.start_t);
  const minT = Math.min(...startTs);
  const maxT = Math.max(...startTs);
  const union = unionOperator.executeMany(geometries);
  const selectionWhere = `(${activeComplaintsWhere || "1=1"}) AND Created_Date >= ${sqlDateLiteral(
    minT,
  )} AND Created_Date <= ${sqlDateLiteral(maxT)}`;
  const filter = {
    geometry: union,
    distance: 0.5,
    units: "miles",
    spatialRelationship: "intersects",
    where: selectionWhere,
  };
  applyNoiseHighlightEffect(filter);
});

async function getFilteredTracks(flightId, baseWhereClause = "1=1") {
  const trackQuery = heliLayerView.createQuery();
  const currentWhere = baseWhereClause || "1=1";
  trackQuery.where = `(${currentWhere}) AND r = ${toSqlLiteral(flightId)}`;
  trackQuery.returnGeometry = true;
  trackQuery.outFields = [heliLayer.objectIdField];

  const trackResults = await heliLayerView.queryFeatures(trackQuery);
  if (!trackResults.features.length) {
    applyComplaintsTableFilter(activeComplaintsWhere, null);
    return [];
  }

  const trackGeometries = trackResults.features.map(
    (feature) => feature.geometry,
  );
  const trackObjectIds = trackResults.features
    .map((feature) => feature.attributes?.[heliLayer.objectIdField])
    .filter((objectId) => objectId !== null && objectId !== undefined);
  const combinedGeometry =
    trackGeometries.length === 1
      ? trackGeometries[0]
      : unionOperator.executeMany(trackGeometries);

  applyLayerViewEffects(trackObjectIds, combinedGeometry);
}

function applyLayerViewEffects(trackObjectIds, combinedGeometry) {
  const heliFilter = {
    objectIds: trackObjectIds,
  };

  heliLayerView.featureEffect = {
    filter: heliFilter,
    includedEffect: "drop-shadow(0px, 0px, 4px)",
    excludedEffect: "grayscale(100%) opacity(20%)",
  };

  if (combinedGeometry) {
    applyNoiseHighlightEffect({
      geometry: combinedGeometry,
      distance: 0.5,
      units: "miles",
      spatialRelationship: "intersects",
    });
  }
}

//  Loupe / demographic buffer mode

const bufferLayer = new GraphicsLayer({
  effect: HIGHLIGHT_EFFECT,
  listMode: "hide",
  popupEnabled: false,
});
const censusQuery = censusLayer.createQuery();
viewElement.map.addMany([bufferLayer]);
bringComplaintsLayerToTop();
bringLoupeLayerToTop();
bufferLayer.visible = false;
let loupeEnabled = false;

const bufferSymbol = {
  type: "simple-fill",
  color: [150, 150, 150, 0],
  outline: { color: "#f7db25", width: 4 },
};

censusQuery.outFields = ["*"];
censusQuery.outStatistics = [
  {
    onStatisticField: "TOTPOP_CY",
    outStatisticFieldName: "Pop_2025_sum",
    statisticType: "sum",
  },
  {
    onStatisticField: "AVGHINC_CY",
    outStatisticFieldName: "Inc_2025_avg",
    statisticType: "avg",
  },
];
censusQuery.returnGeometry = false;

const numberFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  compactDisplay: "short",
});
const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 0,
});

function setLoupeStats(data) {
  loupePopulation.textContent = data
    ? numberFmt.format(data.pop_sum ?? 0)
    : "—";
  loupeIncome.textContent = data ? currencyFmt.format(data.inc_avg ?? 0) : "—";
  loupeNoiseCount.textContent = data
    ? numberFmt.format(data.noiseCount ?? 0)
    : "—";
}

function isAbortError(error) {
  return (
    error?.name === "AbortError" ||
    error?.details?.name === "AbortError" ||
    /abort/i.test(error?.message || "")
  );
}

function logNonAbortError(error) {
  if (!isAbortError(error)) {
    console.error(error);
  }
}

function ensureLoupeReady() {
  loupeReadyPromise ??= geodesicBufferOperator.load();
  return loupeReadyPromise;
}

function clearNoiseBufferEffect() {
  resetNoiseExtentFeatureEffect();
}

function clearLoupeStats() {
  loupePopulation.textContent = "—";
  loupeIncome.textContent = "—";
  loupeNoiseCount.textContent = "—";
}

function resetLoupePresentation() {
  pendingLoupePointerEvent = null;
  if (loupePointerFrameId) {
    cancelAnimationFrame(loupePointerFrameId);
    loupePointerFrameId = 0;
  }
  bufferLayer.graphics.removeAll();
  setDemographicLoupeEffect();
  clearNoiseBufferEffect();
  clearLoupeStats();
}

function updateLoupeGraphic(buffer) {
  if (bufferLayer.graphics.length === 0) {
    bufferLayer.add(
      new Graphic({
        geometry: buffer,
        symbol: bufferSymbol,
      }),
    );
    return;
  }

  bufferLayer.graphics.getItemAt(0).geometry = buffer;
}

async function updateLoupeBuffer(event) {
  await ensureLoupeReady();
  const point = viewElement.view.toMap(event);
  if (!point) {
    return;
  }

  point.hasZ = false;
  point.z = undefined;

  const buffer = await geodesicBufferOperator.execute(point, 0.5, {
    unit: "miles",
  });

  updateLoupeGraphic(buffer);
  setDemographicLoupeEffect(buffer);
  updateLoupeStatistics(buffer).catch(logNonAbortError);
}

function scheduleLoupePointerUpdate(event) {
  pendingLoupePointerEvent = event;
  if (loupePointerFrameId) {
    return;
  }

  loupePointerFrameId = requestAnimationFrame(() => {
    loupePointerFrameId = 0;
    const nextEvent = pendingLoupePointerEvent;
    pendingLoupePointerEvent = null;

    if (!loupeEnabled || !nextEvent) {
      return;
    }

    updateLoupeBuffer(nextEvent).catch(logNonAbortError);
  });
}

function setLoupeEnabled(enabled) {
  loupeEnabled = enabled;
  bufferLayer.visible = enabled;
  loupeStatsBlock.hidden = !enabled;
  viewElement.removeEventListener(
    "arcgisViewPointerMove",
    handleLoupePointerMove,
  );

  if (enabled) {
    ensureLoupeReady().catch(logNonAbortError);
    viewElement.addEventListener(
      "arcgisViewPointerMove",
      handleLoupePointerMove,
    );
    return;
  }

  resetLoupePresentation();
}

function handleLoupePointerMove(event) {
  if (!loupeEnabled) {
    return;
  }

  const pointerEvent = event.detail;
  if (!pointerEvent) {
    return;
  }

  if (typeof pointerEvent.stopPropagation === "function") {
    pointerEvent.stopPropagation();
  }

  scheduleLoupePointerUpdate(pointerEvent);
}

function handleLoupePointerLeave() {
  if (!loupeEnabled) {
    return;
  }

  resetLoupePresentation();
}

function applyLoupeNoiseBufferEffect(geometry) {
  applyNoiseHighlightEffect({
    geometry,
    spatialRelationship: "intersects",
    where: activeComplaintsWhere || "1=1",
  });
}

const updateLoupeStatistics = promiseUtils.debounce(async function (geometry) {
  const requestId = ++loupeStatsRequestId;

  try {
    censusQuery.geometry = geometry;
    applyLoupeNoiseBufferEffect(geometry);

    censusQuery.spatialRelationship = "intersects";

    const noiseCountQuery = noiseLayerView.createQuery();
    noiseCountQuery.where = activeComplaintsWhere || "1=1";
    noiseCountQuery.geometry = geometry;
    noiseCountQuery.spatialRelationship = "intersects";

    const [censusResult, noiseCount] = await Promise.all([
      censusLayer.queryFeatures(censusQuery),
      noiseLayer.queryFeatureCount(noiseCountQuery),
    ]);

    if (!loupeEnabled || requestId !== loupeStatsRequestId) {
      return;
    }

    const attributes = censusResult.features[0]?.attributes ?? {};
    setLoupeStats({
      pop_sum: attributes.Pop_2025_sum,
      inc_avg: attributes.Inc_2025_avg,
      noiseCount,
    });
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }

    throw error;
  }
});

view.on("pointer-leave", () => {
  handleLoupePointerLeave();
});

setDemographicsMode(false, { syncChip: true });
noiseLayer.visible = toggleNoiseComplaints.selected;
syncComplaintsChipState();
heliLayer.visible = toggleFlights.selected;

reactiveUtils.watch(() => view.scale, syncComplaintsChipState);
reactiveUtils.watch(() => noiseLayer.visible, syncComplaintsChipState);
reactiveUtils.watch(
  () => [toggleLoupe.selected, censusLayer.visible, neighborhoodTractsLayer.visible],
  ([, censusVisible, neighborhoodVisible]) => {
    if (censusVisible || neighborhoodVisible) {
      setDemographicLayersVisible(false);
    }
  },
);

updateAircraftSelectionUI();
setDayScopedBlocksVisible(false);
updateDayBrowserHeader();
await hideAppLoadingOverlay();
setTimeout(async () => {
  try {
    await initCustomHeatMap();
    updateDayBrowserHeader();
  } catch (error) {
    logNonAbortError(error);
  }
}, 0);
