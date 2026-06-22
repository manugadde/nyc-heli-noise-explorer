function overlaps(first, second) {
  return !(
    first.right <= second.left ||
    first.left >= second.right ||
    first.bottom <= second.top ||
    first.top >= second.bottom
  );
}

export function createAppShellController({
  viewElement,
  mapTitleBanner,
  mapControlsBar,
  sidebarOverlay,
  mobileFiltersMediaQuery,
  filtersSheetContent,
  openFiltersSheetAction,
  filtersSheet,
  getFlightDataExtentForPopup,
  titleBufferTop,
  heatBufferBottom,
  titleExtentGap,
  rightColumnWidth,
}) {
  const overlayInset = 12;
  const controlsBarEdgeBleed = 1;
  let overlayPositionFrameId = 0;
  let requestedSheetLayout = false;
  const sidebarContentRoot = ensureSidebarContentRoot();

  function setFiltersChipVisibility(isVisible) {
    if (!openFiltersSheetAction) {
      return;
    }

    const isDialogOpen =
      Boolean(filtersSheet?.open) &&
      filtersSheet?.dataset.filtersClosing !== "true";
    const shouldHide = !isVisible || isDialogOpen;
    openFiltersSheetAction.hidden = shouldHide;
    openFiltersSheetAction.selected = false;
    openFiltersSheetAction.setAttribute("aria-hidden", String(shouldHide));
  }

  function positionFiltersButton(frame, viewportWidth, viewportHeight) {
    if (!openFiltersSheetAction || openFiltersSheetAction.hidden) {
      return;
    }

    const buttonWidth = openFiltersSheetAction.offsetWidth || 96;
    const buttonHeight = openFiltersSheetAction.offsetHeight || 32;
    const desiredLeft = frame.right - buttonWidth - overlayInset;
    const desiredTop = frame.top + overlayInset;
    const left = Math.min(
      Math.max(overlayInset, desiredLeft),
      Math.max(overlayInset, viewportWidth - buttonWidth - overlayInset),
    );
    const top = Math.min(
      Math.max(overlayInset, desiredTop),
      Math.max(overlayInset, viewportHeight - buttonHeight - overlayInset),
    );

    Object.assign(openFiltersSheetAction.style, {
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
    });
  }

  function applyResponsivePadding() {
    viewElement.padding = mobileFiltersMediaQuery.matches
      ? { left: 0, top: 100, right: 0, bottom: 280 }
      : {
          left: 0,
          top: titleBufferTop,
          right: rightColumnWidth,
          bottom: heatBufferBottom,
        };
  }

  function ensureSidebarContentRoot() {
    if (!sidebarOverlay) {
      return null;
    }

    const wrapper = document.createElement("div");

    while (sidebarOverlay.firstChild) {
      wrapper.appendChild(sidebarOverlay.firstChild);
    }

    sidebarOverlay.appendChild(wrapper);
    return wrapper;
  }

  function getMeasurements() {
    return {
      titleHeight: mapTitleBanner?.offsetHeight || 120,
      controlsHeight: mapControlsBar?.offsetHeight || 84,
      sidebarWidth: sidebarOverlay?.offsetWidth || 420,
      sidebarHeight:
        sidebarContentRoot?.offsetHeight || sidebarOverlay?.offsetHeight || 300,
    };
  }

  function getFrameBounds(view) {
    const flightDataExtent = getFlightDataExtentForPopup();
    if (!flightDataExtent || !view) {
      return null;
    }

    const topLeft = view.toScreen({
      x: flightDataExtent.xmin,
      y: flightDataExtent.ymax,
      spatialReference: flightDataExtent.spatialReference,
    });
    const bottomLeft = view.toScreen({
      x: flightDataExtent.xmin,
      y: flightDataExtent.ymin,
      spatialReference: flightDataExtent.spatialReference,
    });
    const topRight = view.toScreen({
      x: flightDataExtent.xmax,
      y: flightDataExtent.ymax,
      spatialReference: flightDataExtent.spatialReference,
    });

    if (!topLeft || !bottomLeft || !topRight) {
      return null;
    }

    return {
      left: Math.round(Math.min(topLeft.x, bottomLeft.x)),
      right: Math.round(Math.max(topLeft.x, topRight.x)),
      top: Math.round(Math.min(topLeft.y, topRight.y)),
      bottom: Math.round(Math.max(topLeft.y, bottomLeft.y)),
    };
  }

  function positionTitle(frame, viewportWidth, viewportHeight, measurements) {
    if (!mapTitleBanner) {
      return false;
    }

    const left = Math.round(Math.max(overlayInset, frame.left));
    const width = Math.round(
      Math.max(
        0,
        Math.min(frame.right - left, viewportWidth - left - overlayInset),
      ),
    );
    const top = Math.round(
      Math.min(
        Math.max(
          overlayInset,
          frame.top - measurements.titleHeight - titleExtentGap,
        ),
        Math.max(
          overlayInset,
          viewportHeight - measurements.titleHeight - overlayInset,
        ),
      ),
    );

    Object.assign(mapTitleBanner.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
    });

    mapTitleBanner.classList.toggle("is-sticky", top === overlayInset);

    return overlaps(
      {
        left,
        right: left + width,
        top,
        bottom: top + measurements.titleHeight,
      },
      frame,
    );
  }

  function positionControls(
    frame,
    viewportWidth,
    viewportHeight,
    measurements,
  ) {
    if (!mapControlsBar) {
      return;
    }

    const left = Math.round(Math.max(0, frame.left - controlsBarEdgeBleed));
    const right = Math.round(
      Math.max(0, viewportWidth - frame.right - controlsBarEdgeBleed),
    );
    const dockToBottom =
      frame.bottom + measurements.controlsHeight > viewportHeight;

    Object.assign(mapControlsBar.style, {
      left: `${left}px`,
      right: `${right}px`,
      width: "auto",
      top: dockToBottom ? "auto" : `${Math.round(Math.max(0, frame.bottom))}px`,
      bottom: dockToBottom ? "0px" : "auto",
    });

    mapControlsBar.classList.toggle("is-bottom-docked", dockToBottom);
  }

  function syncResponsiveFilterSurface(
    forceSheetLayout = requestedSheetLayout,
  ) {
    if (!sidebarContentRoot) {
      return;
    }

    requestedSheetLayout = forceSheetLayout;

    if (mobileFiltersMediaQuery.matches || forceSheetLayout) {
      if (sidebarContentRoot.parentElement !== filtersSheetContent) {
        filtersSheetContent.appendChild(sidebarContentRoot);
      }
      sidebarOverlay.hidden = true;
      filtersSheet.hidden = false;
      setFiltersChipVisibility(true);
      applyResponsivePadding();
      return;
    }

    if (sidebarContentRoot.parentElement !== sidebarOverlay) {
      sidebarOverlay.appendChild(sidebarContentRoot);
    }
    sidebarOverlay.hidden = false;
    setFiltersChipVisibility(false);
    filtersSheet.open = false;
    filtersSheet.hidden = true;
    applyResponsivePadding();
    scheduleOverlayPositionUpdate();
  }

  function positionSidebar(frame, viewportWidth, measurements) {
    if (!sidebarOverlay) {
      return;
    }

    const left = Math.round(
      Math.min(
        viewportWidth - measurements.sidebarWidth - overlayInset,
        frame.right + titleExtentGap,
      ),
    );
    const top = Math.round(Math.max(overlayInset, frame.top));
    const sidebarBounds = {
      left,
      right: left + measurements.sidebarWidth,
      top,
      bottom: top + measurements.sidebarHeight,
    };
    const overlapsFrame = overlaps(sidebarBounds, frame);

    if (overlapsFrame !== requestedSheetLayout) {
      syncResponsiveFilterSurface(overlapsFrame);
    }

    if (sidebarOverlay.hidden) {
      sidebarOverlay.classList.remove("is-overlapping");
      return;
    }

    Object.assign(sidebarOverlay.style, {
      left: `${left}px`,
      top: `${top}px`,
    });
    sidebarOverlay.classList.toggle("is-overlapping", overlapsFrame);
  }

  if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(() => {
      scheduleOverlayPositionUpdate();
    });

    [mapTitleBanner, mapControlsBar, sidebarOverlay, sidebarContentRoot]
      .filter(Boolean)
      .forEach((element) => {
        resizeObserver.observe(element);
      });
  }

  function updateHeatPopupPosition() {
    const view = viewElement.view;
    const frame = getFrameBounds(view);
    if (!frame || !view) {
      return;
    }

    const viewportWidth = view.width || globalThis.innerWidth;
    const viewportHeight = view.height || globalThis.innerHeight;
    const measurements = getMeasurements();
    const titleOverlapsContent = positionTitle(
      frame,
      viewportWidth,
      viewportHeight,
      measurements,
    );

    if (mapTitleBanner) {
      mapTitleBanner.classList.toggle(
        "title-is-overlapping",
        titleOverlapsContent,
      );
    }

    positionControls(frame, viewportWidth, viewportHeight, measurements);
    positionSidebar(frame, viewportWidth, measurements);
    positionFiltersButton(frame, viewportWidth, viewportHeight);
  }

  function scheduleOverlayPositionUpdate() {
    if (overlayPositionFrameId) {
      return;
    }

    overlayPositionFrameId = globalThis.requestAnimationFrame(() => {
      overlayPositionFrameId = 0;
      updateHeatPopupPosition();
    });
  }

  return {
    applyResponsivePadding,
    scheduleOverlayPositionUpdate,
    syncResponsiveFilterSurface,
    updateHeatPopupPosition,
  };
}
