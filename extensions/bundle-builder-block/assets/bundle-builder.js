(function () {
  "use strict";

  const container = document.getElementById("bundle-builder-app");
  if (!container) return;

  const productId = container.dataset.productId;
  const proxyBase = container.dataset.proxyBase || "/apps/bundle-builder";

  // ── State ──────────────────────────────────────────────────────────────

  const state = {
    bundle: null,
    selectedVariantId: null,
    requiredCount: 0,
    allowMultiples: true,
    selections: {}, // { optionId: quantity }
    totalSelected: 0,
    loading: true,
    error: null,
    submitting: false,
  };

  // ── Init ───────────────────────────────────────────────────────────────

  async function init() {
    try {
      const res = await fetch(`${proxyBase}/bundle/${productId}`);
      const data = await res.json();

      if (!data.bundle) {
        // Not a bundle product — keep hidden
        return;
      }

      state.bundle = data.bundle;
      state.allowMultiples = data.bundle.allowMultiples;
      state.loading = false;

      container.style.display = "block";

      // Detect initial variant
      detectCurrentVariant();

      // Listen for variant changes
      watchVariantChanges();

      render();
    } catch (err) {
      state.loading = false;
      state.error = "Failed to load bundle options. Please refresh the page.";
      container.style.display = "block";
      render();
    }
  }

  // ── Variant Detection ──────────────────────────────────────────────────

  function detectCurrentVariant() {
    const params = new URLSearchParams(window.location.search);
    const variantParam = params.get("variant");

    if (variantParam) {
      setVariant(variantParam);
      return;
    }

    // Try to find selected variant from a <select>, radio, or hidden input on the page
    const variantSelect = document.querySelector(
      '.variant-picker__form input[type="radio"][checked]'
    );
    const variantId = variantSelect?.getAttribute('data-variant-id');
    if (variantId) {
      setVariant(variantId);
    }
  }

  function watchVariantChanges() {
    // Method 1: URL changes (works with most themes)
    let lastUrl = window.location.href;
    const urlObserver = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        detectCurrentVariant();
        render();
      }
    });
    urlObserver.observe(document, { subtree: true, childList: true });

    // Method 2: Listen for change events on variant selectors
    document.addEventListener("change", function (e) {
      const target = e.target;
      if (
        target.name === "id" ||
        target.closest("[data-variant-id]")
      ) {
        const variantId =
          target.value || target.dataset?.variantId;
        if (variantId) {
          setVariant(variantId);
          render();
        }
      }
    });

    // Method 3: Listen for popstate (back/forward navigation)
    window.addEventListener("popstate", () => {
      detectCurrentVariant();
      render();
    });
  }

  function setVariant(variantId) {
    const id = String(variantId);
    const variantMap = state.bundle?.variantMaps.find(
      (vm) =>
        vm.numericVariantId === id ||
        vm.shopifyVariantId === id ||
        vm.shopifyVariantId === `gid://shopify/ProductVariant/${id}`
    );

    if (variantMap) {
      const changed = state.selectedVariantId !== id;
      state.selectedVariantId = id;
      state.requiredCount = variantMap.selectionCount;

      if (changed) {
        // Reset selections when variant changes
        state.selections = {};
        state.totalSelected = 0;
      }
    }
  }

  // ── Selection Logic ────────────────────────────────────────────────────

  function incrementOption(optionId) {
    if (state.totalSelected >= state.requiredCount) return;

    const option = state.bundle.options.find((o) => o.id === optionId);
    if (!option) return;

    const currentQty = state.selections[optionId] || 0;

    if (!state.allowMultiples && currentQty >= 1) return;
    if (!option.inStock) return;

    state.selections[optionId] = currentQty + 1;
    state.totalSelected++;
    render();
  }

  function decrementOption(optionId) {
    const currentQty = state.selections[optionId] || 0;
    if (currentQty <= 0) return;

    state.selections[optionId] = currentQty - 1;
    state.totalSelected--;

    if (state.selections[optionId] === 0) {
      delete state.selections[optionId];
    }

    render();
  }

  function toggleOption(optionId) {
    const currentQty = state.selections[optionId] || 0;
    if (currentQty > 0) {
      decrementOption(optionId);
    } else {
      incrementOption(optionId);
    }
  }

  // ── Add to Cart ────────────────────────────────────────────────────────

  async function handleAddToCart() {
    if (state.totalSelected !== state.requiredCount) return;
    if (state.submitting) return;

    state.submitting = true;
    state.error = null;
    render();

    try {
      // Pre-flight validation
      const validateRes = await fetch(`${proxyBase}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bundleId: state.bundle.id,
          variantId: state.selectedVariantId,
          selections: Object.entries(state.selections).map(([id, qty]) => ({
            optionId: id,
            quantity: qty,
          })),
        }),
      });

      const validateData = await validateRes.json();

      if (!validateData.valid) {
        state.error = validateData.errors.join(". ");
        state.submitting = false;

        // Re-fetch bundle to get updated inventory
        const refreshRes = await fetch(`${proxyBase}/bundle/${productId}`);
        const refreshData = await refreshRes.json();
        if (refreshData.bundle) {
          state.bundle = refreshData.bundle;
        }

        render();
        return;
      }

      // Build human-readable selection string
      const selectionLabels = Object.entries(state.selections)
        .map(([optionId, qty]) => {
          const option = state.bundle.options.find((o) => o.id === optionId);
          return qty > 1 ? `${option?.name} x${qty}` : option?.name;
        })
        .filter(Boolean)
        .join(", ");

      // Add to Shopify cart
      const cartRes = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: parseInt(state.selectedVariantId, 10),
          quantity: 1,
          properties: {
            "Bundle Selections": selectionLabels,
            _bundle_id: state.bundle.id,
            _bundle_selections: JSON.stringify(state.selections),
          },
        }),
      });

      if (!cartRes.ok) {
        throw new Error("Failed to add to cart");
      }

      // Success — reset selections and show feedback
      state.selections = {};
      state.totalSelected = 0;
      state.submitting = false;

      // Trigger cart update for the theme
      try {
        const cartRes2 = await fetch("/cart.js");
        const cartData = await cartRes2.json();

        // Update the cart icon bubble count
        const cartBubble = document.getElementById("cart-icon-bubble");
        if (cartBubble) {
          const countEl = cartBubble.querySelector(".cart-count-bubble span[aria-hidden]");
          if (countEl) {
            countEl.textContent = cartData.item_count;
          } else if (cartData.item_count > 0) {
            // Create the bubble if it doesn't exist yet
            const bubble = document.createElement("div");
            bubble.className = "cart-count-bubble";
            bubble.innerHTML = `<span aria-hidden="true">${cartData.item_count}</span>`;
            cartBubble.appendChild(bubble);
          }
        }

        // Dawn cart-notification component
        const cartNotification = document.querySelector("cart-notification");
        if (cartNotification) {
          // Fetch the updated cart-notification section HTML
          const sectionId = cartNotification.closest(".shopify-section")?.id?.replace("shopify-section-", "");
          if (sectionId) {
            const sectionRes = await fetch(`/?sections=${sectionId}`);
            const sectionData = await sectionRes.json();
            if (sectionData[sectionId]) {
              const temp = document.createElement("div");
              temp.innerHTML = sectionData[sectionId];
              const newContent = temp.querySelector("cart-notification");
              if (newContent) {
                cartNotification.innerHTML = newContent.innerHTML;
              }
            }
          }
          cartNotification.classList.add("animate", "active");
          cartNotification.removeAttribute("hidden");
          setTimeout(() => {
            cartNotification.classList.remove("animate", "active");
          }, 5000);
        }

        // Dawn cart-drawer component
        const cartDrawer = document.querySelector("cart-drawer");
        if (cartDrawer && typeof cartDrawer.open === "function") {
          cartDrawer.open();
        }

        // Horizon theme: dispatch CartUpdateEvent via dynamic import
        try {
          const { CartUpdateEvent } = await import("@theme/events");
          const horizonDrawer = document.querySelector("cart-drawer-component");
          const event = new CartUpdateEvent(cartData, "manual-trigger", {
            itemCount: cartData.item_count,
            source: "bundle-builder",
            sections: {},
          });
          document.dispatchEvent(event);
          if (horizonDrawer?.hasAttribute("auto-open")) {
            horizonDrawer.open();
          }
        } catch (_) {
          // Not Horizon — try generic events
          document.dispatchEvent(new CustomEvent("cart:refresh"));
          document.dispatchEvent(
            new CustomEvent("cart:update", {
              bubbles: true,
              detail: { data: { itemCount: cartData.item_count, source: "product-form-component" } },
            })
          );
        }
      } catch (_) {
        // Fallback: cart will update on next navigation
      }

      // Show brief success message then re-render
      showSuccessMessage();
      render();
    } catch (err) {
      state.error = "Failed to add to cart. Please try again.";
      state.submitting = false;
      render();
    }
  }

  function showSuccessMessage() {
    const msg = container.querySelector(".bb-success");
    if (msg) {
      msg.style.display = "block";
      setTimeout(() => {
        msg.style.display = "none";
      }, 3000);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  function render() {
    if (state.loading) {
      container.innerHTML = `
        <div class="bb-loading">
          <div class="bb-spinner"></div>
          <p>Loading bundle options...</p>
        </div>`;
      return;
    }

    if (state.error && !state.bundle) {
      container.innerHTML = `
        <div class="bb-error">
          <p>${escapeHtml(state.error)}</p>
          <button class="bb-retry-btn" onclick="location.reload()">Retry</button>
        </div>`;
      return;
    }

    const bundle = state.bundle;
    const remaining = state.requiredCount - state.totalSelected;
    const isComplete = remaining === 0;

    let html = `
      <div class="bb-container">
        <div class="bb-success" style="display: none;">
          <p>Added to cart!</p>
        </div>

        ${state.error ? `<div class="bb-error"><p>${escapeHtml(state.error)}</p></div>` : ""}

        <div class="bb-header">
          <h2 class="bb-heading">Build Your Bundle</h2>
          ${
            state.selectedVariantId
              ? `<div class="bb-counter ${isComplete ? "bb-counter--complete" : ""}">
                  <span class="bb-counter__current">${state.totalSelected}</span>
                  <span class="bb-counter__sep"> / </span>
                  <span class="bb-counter__total">${state.requiredCount}</span>
                  <span class="bb-counter__label"> selected</span>
                </div>`
              : `<p class="bb-select-variant-msg">Please select a variant above to start building your bundle.</p>`
          }
        </div>

        ${
          state.selectedVariantId
            ? `<div class="bb-grid">
                ${bundle.options.map((option) => renderOption(option)).join("")}
              </div>

              <div class="bb-actions">
                <button
                  class="bb-add-to-cart ${isComplete ? "" : "bb-add-to-cart--disabled"}"
                  ${!isComplete || state.submitting ? "disabled" : ""}
                >
                  ${
                    state.submitting
                      ? "Adding..."
                      : isComplete
                      ? "Add to Cart"
                      : `Select ${remaining} more ${remaining === 1 ? "item" : "items"}`
                  }
                </button>
              </div>`
            : ""
        }
      </div>`;

    // Capture focused element before re-render
    const focused = document.activeElement;
    const focusAction = focused?.dataset?.action;
    const focusOptionId = focused?.dataset?.optionId;

    container.innerHTML = html;

    // Bind events
    bindEvents();

    // Restore focus after re-render
    if (focusAction && focusOptionId) {
      const target = container.querySelector(
        `[data-action="${focusAction}"][data-option-id="${focusOptionId}"]`
      );
      if (target) target.focus();
    }
  }

  function renderOption(option) {
    const qty = state.selections[option.id] || 0;
    const isSelected = qty > 0;
    const isOutOfStock = !option.inStock;
    const isAtMax = !state.allowMultiples && qty >= 1;
    const canIncrement =
      !isOutOfStock &&
      state.totalSelected < state.requiredCount &&
      !isAtMax;

    let classes = "bb-option";
    if (isSelected) classes += " bb-option--selected";
    if (isOutOfStock) classes += " bb-option--disabled";

    const inventoryBadge = isOutOfStock
      ? `<span class="bb-option__badge bb-option__badge--out">Sold out</span>`
      : "";

    const hasDescription = option.description && option.description.trim();
    const caratIcon = hasDescription
      ? `<span class="bb-option__carat" data-carat-id="${option.id}">&#9662;</span>`
      : "";
    const descriptionPanel = hasDescription
      ? `<div class="bb-option__desc" data-desc-id="${option.id}" hidden>${escapeHtml(option.description)}</div>`
      : "";

    if (!state.allowMultiples) {
      // Toggle mode — click to select/deselect
      return `
        <div class="${classes}" data-option-id="${option.id}">
          <div class="bb-option__row" data-action="toggle" data-option-id="${option.id}">
            <button type="button" class="bb-option__desc-trigger" ${hasDescription ? `data-action="toggle-desc" data-option-id="${option.id}" aria-expanded="false" aria-label="Show description for ${escapeHtml(option.name)}"` : `disabled`}>
              ${
                option.imageUrl
                  ? `<div class="bb-option__image"><img src="${escapeHtml(option.imageUrl)}" alt="${escapeHtml(option.name)}" loading="lazy" /></div>`
                  : `<div class="bb-option__image bb-option__image--placeholder"></div>`
              }
              <div class="bb-option__info">
                <span class="bb-option__name">${escapeHtml(option.name)}</span>
                ${inventoryBadge}
              </div>
              ${caratIcon}
            </button>
            ${isSelected ? `<div class="bb-option__check">&#10003;</div>` : ""}
          </div>
          ${descriptionPanel}
        </div>`;
    }

    // Quantity mode — +/- buttons
    return `
      <div class="${classes}" data-option-id="${option.id}">
        <div class="bb-option__row">
          <button type="button" class="bb-option__desc-trigger" ${hasDescription ? `data-action="toggle-desc" data-option-id="${option.id}" aria-expanded="false" aria-label="Show description for ${escapeHtml(option.name)}"` : `disabled`}>
            ${
              option.imageUrl
                ? `<div class="bb-option__image"><img src="${escapeHtml(option.imageUrl)}" alt="${escapeHtml(option.name)}" loading="lazy" /></div>`
                : `<div class="bb-option__image bb-option__image--placeholder"></div>`
            }
            <div class="bb-option__info">
              <span class="bb-option__name">${escapeHtml(option.name)}</span>
              ${inventoryBadge}
            </div>
            ${caratIcon}
          </button>
          <div class="bb-option__controls">
            <button class="bb-option__btn bb-option__btn--minus" data-action="decrement" data-option-id="${option.id}" ${qty === 0 ? "disabled" : ""} aria-label="Remove one ${escapeHtml(option.name)}">−</button>
            <span class="bb-option__qty">${qty}</span>
          <button class="bb-option__btn bb-option__btn--plus" data-action="increment" data-option-id="${option.id}" ${!canIncrement ? "disabled" : ""} aria-label="Add one ${escapeHtml(option.name)}">+</button>
        </div>
        </div>
        ${descriptionPanel}
      </div>`;
  }

  function bindEvents() {
    // Option toggle (single-select mode)
    container.querySelectorAll('[data-action="toggle"]').forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest('[data-action="toggle-desc"]')) return;
        const optionId = el.dataset.optionId;
        if (el.closest(".bb-option--disabled")) return;
        toggleOption(optionId);
      });
    });

    // Description accordion toggle
    container.querySelectorAll('[data-action="toggle-desc"]').forEach((trigger) => {
      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const optionId = trigger.dataset.optionId;
        const desc = container.querySelector(`[data-desc-id="${optionId}"]`);
        const carat = container.querySelector(`[data-carat-id="${optionId}"]`);
        if (desc) {
          const isHidden = desc.hasAttribute("hidden");
          desc.toggleAttribute("hidden");
          trigger.setAttribute("aria-expanded", String(isHidden));
          if (carat) carat.classList.toggle("bb-option__carat--open", isHidden);
        }
      });
    });

    // Increment/decrement buttons
    container.querySelectorAll('[data-action="increment"]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        incrementOption(btn.dataset.optionId);
      });
    });

    container.querySelectorAll('[data-action="decrement"]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        decrementOption(btn.dataset.optionId);
      });
    });

    // Add to cart
    const addBtn = container.querySelector(".bb-add-to-cart");
    if (addBtn) {
      addBtn.addEventListener("click", handleAddToCart);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Start ──────────────────────────────────────────────────────────────

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
