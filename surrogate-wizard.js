/**
 * surrogate-wizard.js
 *
 * Glue for the Early Building Design Advisor multi-page wizard:
 *   - Manages the progress bar + step transitions (Next / Back).
 *   - Initialises the Leaflet city map (Step 1) and wires marker clicks
 *     to the hidden <select id="epw_file"> so the existing form-submit
 *     handler in app.js keeps working unchanged.
 *   - Initialises the parametric Three.js building viewer (Step 1) and
 *     keeps it in sync with the archetype card picker and rotation slider.
 *   - Performs lightweight per-step validation before advancing.
 *
 * Depends on:
 *   - Leaflet (window.L)            -- for the map
 *   - Three.js (window.THREE) + OrbitControls + surrogate-geometry.js
 *   - app.js (form submission)      -- we do not duplicate submit logic
 */

(function () {
    'use strict';

    // ---- Step definitions --------------------------------------------------
    const STEPS = [
        { id: 1, title: 'Site & Geometry' },
        { id: 2, title: 'Envelope' },
        { id: 3, title: 'HVAC Systems' },
        { id: 4, title: 'Ventilation' },
        { id: 5, title: 'Analysis Type' }
    ];

    // ---- City catalog (matches backend / 7 supported cities) ---------------
    // Each entry maps a clickable map pin to the EPW filename used by the
    // hidden <select id="epw_file">.
    const CITIES = [
        {
            id: 'Calgary',
            label: 'Calgary, AB',
            lat: 51.0447,
            lng: -114.0719,
            epw: 'CAN_AB_Calgary.Intl.AP.718770_CWEC2016.epw'
        },
        {
            id: 'Halifax',
            label: 'Halifax, NS',
            lat: 44.6488,
            lng: -63.5752,
            epw: 'CAN_NS_Halifax.Stanfield.Intl.AP.713950_CWEC2016.epw'
        },
        {
            id: 'Iqaluit',
            label: 'Iqaluit, NU',
            lat: 63.7467,
            lng: -68.5170,
            epw: 'CAN_NU_Iqaluit.AP.719090_CWEC2016.epw'
        },
        {
            id: 'Montreal',
            label: 'Montreal, QC',
            lat: 45.5019,
            lng: -73.5674,
            epw: 'CAN_QC_Montreal-Trudeau.Intl.AP.716270_CWEC2016.epw'
        },
        {
            id: 'Toronto',
            label: 'Toronto, ON',
            lat: 43.6532,
            lng: -79.3832,
            epw: 'CAN_ON_Toronto.Pearson.Intl.AP.716240_CWEC2016.epw'
        },
        {
            id: 'Vancouver',
            label: 'Vancouver, BC',
            lat: 49.2827,
            lng: -123.1207,
            epw: 'CAN_BC_Vancouver.Intl.AP.718920_CWEC2016.epw'
        },
        {
            id: 'Winnipeg',
            label: 'Winnipeg, MB',
            lat: 49.8951,
            lng: -97.1384,
            epw: 'CAN_MB_Winnipeg-Richardson.Intl.AP.718520_CWEC2016.epw'
        }
    ];

    // Archetype card metadata (icons + display labels).
    const ARCHETYPE_CARDS = [
        { id: 'HighRise',     icon: '🏙️', name: 'High Rise',     meta: '~10 stories' },
        { id: 'MidRise',      icon: '🏬', name: 'Mid Rise',      meta: '~4 stories'  },
        { id: 'LowRise',      icon: '🏘️', name: 'Low Rise',      meta: '~3 stories'  },
        { id: 'LargeOffice',  icon: '🏢', name: 'Large Office',  meta: '~12 stories' },
        { id: 'MediumOffice', icon: '🏤', name: 'Medium Office', meta: '3 stories'   },
        { id: 'SmallOffice',  icon: '🏪', name: 'Small Office',  meta: '1 story'     }
    ];

    // ---- State -------------------------------------------------------------
    let currentStep = 1;
    let mapInstance = null;
    let cityMarkers = {};
    let buildingViewer = null;

    // =======================================================================
    // Helpers
    // =======================================================================

    function $(sel, root) { return (root || document).querySelector(sel); }
    function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

    function setProgressFill() {
        // Fill the bar proportionally to (currentStep - 1) / (STEPS.length - 1)
        const pct = ((currentStep - 1) / (STEPS.length - 1)) * 100;
        const progress = $('.wizard-progress');
        if (progress) progress.style.setProperty('--wizard-progress-fill', pct + '%');
    }

    function renderMarkers() {
        $$('.wizard-step-marker').forEach((el) => {
            const step = Number(el.dataset.step);
            el.classList.toggle('is-active', step === currentStep);
            el.classList.toggle('is-done', step < currentStep);
            el.classList.toggle('is-clickable', step < currentStep);
        });
        const counter = $('.wizard-step-counter');
        if (counter) {
            counter.textContent = `Step ${currentStep} of ${STEPS.length}`;
        }
    }

    function showStep(n) {
        if (n < 1 || n > STEPS.length) return;
        currentStep = n;
        $$('.wizard-step').forEach((sec) => {
            const isActive = Number(sec.dataset.step) === n;
            sec.classList.toggle('is-active', isActive);
        });

        // Update Back/Next button labels.
        const backBtn = $('#wizardBackBtn');
        const nextBtn = $('#wizardNextBtn');
        const submitBtn = $('#wizardSubmitBtn');
        if (backBtn) backBtn.style.visibility = n === 1 ? 'hidden' : 'visible';
        if (nextBtn && submitBtn) {
            if (n === STEPS.length) {
                nextBtn.style.display = 'none';
                submitBtn.style.display = 'inline-flex';
            } else {
                nextBtn.style.display = 'inline-flex';
                submitBtn.style.display = 'none';
            }
        }

        renderMarkers();
        setProgressFill();

        // Map may have been hidden when first painted; nudge Leaflet so tiles
        // render correctly the first time Step 1 becomes visible.
        if (n === 1 && mapInstance && typeof mapInstance.invalidateSize === 'function') {
            setTimeout(() => mapInstance.invalidateSize(), 50);
        }

        // Scroll to top of the wizard for clean transitions.
        const content = $('.content');
        if (content) {
            content.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // ---- Validation --------------------------------------------------------
    // Returns first invalid field's friendly message, or null if step is valid.
    function validateStep(n) {
        const sec = $(`.wizard-step[data-step="${n}"]`);
        if (!sec) return null;
        // Use native HTML5 validity, but only for required inputs/selects
        // that are visible on this step.
        const required = $$('input[required], select[required]', sec).filter(
            (el) => el.offsetParent !== null || el.type === 'hidden'
        );
        for (const el of required) {
            const v = el.value;
            if (v === '' || v == null) {
                const label = $(`label[for="${el.id}"]`);
                const friendly = label ? label.textContent.trim().split('\n')[0] : el.name;
                return `Please complete: ${friendly}`;
            }
        }

        // Step-1 specific: ensure city + archetype are set even though those
        // are wired through hidden form fields.
        if (n === 1) {
            const epw = $('#epw_file');
            const bt = $('#building_type');
            if (!epw || !epw.value) return 'Please pick a city on the map.';
            if (!bt || !bt.value) return 'Please choose a building archetype.';
        }

        // Step-5 specific: when "alternative" analysis is selected, require at
        // least one configured parameter; when "cost", require parameter +
        // baseline + improved.
        if (n === 5) {
            const analysisType = (document.querySelector(
                'input[name="analysisType"]:checked'
            ) || {}).value;
            if (analysisType === 'alternative') {
                if (!window.altConfig || typeof window.altConfig.collect !== 'function') {
                    return 'Alternative configuration UI not ready. Please refresh.';
                }
                const collected = window.altConfig.collect();
                if (!collected.ok) return collected.error;
            } else if (analysisType === 'cost') {
                const costParam = $('#costParameter');
                if (!costParam || !costParam.value)
                    return 'Choose a parameter for cost analysis.';
                // baseline / improved validated by app.js submit handler.
            }
        }

        return null;
    }

    function flashError(msg) {
        if (!msg) return;
        // Keep it simple - reuse the page's existing alert UX.
        if (window.alert) window.alert(msg);
    }

    // =======================================================================
    // Map (Leaflet)
    // =======================================================================

    function initMap() {
        if (!window.L) {
            console.warn('Leaflet not loaded; map will not be available.');
            return;
        }
        const el = $('#cityMap');
        if (!el) return;

        mapInstance = L.map(el, {
            zoomControl: true,
            scrollWheelZoom: true,
            doubleClickZoom: true
        }).setView([56.13, -106.35], 3); // Centred on Canada

        L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            {
                attribution:
                    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                maxZoom: 18
            }
        ).addTo(mapInstance);

        // Default marker icon (blue). We tint the selected one via CSS class.
        CITIES.forEach((city) => {
            const marker = L.marker([city.lat, city.lng], { title: city.label });
            marker
                .addTo(mapInstance)
                .bindTooltip(city.label, {
                    permanent: false,
                    direction: 'top',
                    offset: [0, -8]
                });
            marker.on('click', () => selectCity(city.id));
            cityMarkers[city.id] = marker;
        });
    }

    function selectCity(cityId) {
        const city = CITIES.find((c) => c.id === cityId);
        if (!city) return;

        // Drive the existing hidden <select> so the form submit picks it up.
        const sel = $('#epw_file');
        if (sel) {
            // Make sure an option with the right value exists.
            let opt = Array.from(sel.options).find((o) => o.value === city.epw);
            if (!opt) {
                opt = document.createElement('option');
                opt.value = city.epw;
                opt.textContent = city.label;
                sel.appendChild(opt);
            }
            sel.value = city.epw;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Highlight pin (CSS class on the marker's icon DOM element)
        Object.entries(cityMarkers).forEach(([id, marker]) => {
            const el = marker.getElement && marker.getElement();
            if (el) {
                el.classList.toggle('city-pin-selected', id === cityId);
            }
        });

        // Readout text
        const readout = $('#selectedCityReadout');
        if (readout) {
            readout.innerHTML = `Selected city: <strong>${city.label}</strong>`;
        }

        // Re-centre on the chosen city without zooming in too aggressively.
        if (mapInstance) {
            mapInstance.flyTo([city.lat, city.lng], 5, { duration: 0.6 });
        }
    }

    // =======================================================================
    // Archetype cards + 3D viewer
    // =======================================================================

    function renderArchetypeCards() {
        const grid = $('#archetypeGrid');
        if (!grid) return;
        grid.innerHTML = '';
        ARCHETYPE_CARDS.forEach((a) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'archetype-card';
            btn.dataset.archetype = a.id;
            btn.setAttribute('aria-pressed', 'false');
            btn.innerHTML = `
                <div class="icon" aria-hidden="true">${a.icon}</div>
                <div class="name">${a.name}</div>
                <div class="meta">${a.meta}</div>
            `;
            btn.addEventListener('click', () => selectArchetype(a.id));
            grid.appendChild(btn);
        });
    }

    function selectArchetype(archetypeId) {
        // Update hidden select for form submission.
        const sel = $('#building_type');
        if (sel) {
            sel.value = archetypeId;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Visual selection state on the cards.
        $$('.archetype-card').forEach((card) => {
            const on = card.dataset.archetype === archetypeId;
            card.classList.toggle('is-selected', on);
            card.setAttribute('aria-pressed', on ? 'true' : 'false');
        });

        // Drive the 3D viewer.
        if (buildingViewer) {
            buildingViewer.setArchetype(archetypeId);
        }

        // Footprint readout
        updateFootprintReadout(archetypeId);
    }

    function updateFootprintReadout(archetypeId) {
        const out = $('#footprintReadout');
        if (!out) return;
        const dims =
            (window.SurrogateGeometry &&
                window.SurrogateGeometry.getArchetypeDimensions(archetypeId)) ||
            null;
        if (!dims) {
            out.textContent = '';
            return;
        }
        const footprint = dims.width * dims.depth;
        const totalFloor = footprint * dims.stories;
        out.innerHTML =
            `Footprint: <strong>${footprint.toFixed(0)} m²</strong> ` +
            `(${dims.width.toFixed(1)} × ${dims.depth.toFixed(1)} m) &nbsp;·&nbsp; ` +
            `Stories: <strong>${dims.stories}</strong> &nbsp;·&nbsp; ` +
            `Total floor area: <strong>${totalFloor.toFixed(0)} m²</strong>`;
    }

    function initBuildingViewer() {
        if (!window.SurrogateGeometry || !window.SurrogateGeometry.createBuildingViewer) {
            console.warn('SurrogateGeometry not loaded; 3D viewer disabled.');
            return;
        }
        const container = $('#buildingViewer');
        if (!container) return;
        // Remove empty-state placeholder if present.
        const empty = container.querySelector('.viewer-empty-state');
        if (empty) empty.remove();

        try {
            buildingViewer = window.SurrogateGeometry.createBuildingViewer({
                container,
                archetype: 'MidRise',
                rotationDeg: 0
            });
        } catch (err) {
            console.error('Failed to init 3D viewer:', err);
            container.innerHTML =
                '<div class="viewer-empty-state">3D viewer could not start. ' +
                'Refresh to retry.</div>';
        }
    }

    // =======================================================================
    // Rotation slider
    // =======================================================================

    function initRotationSlider() {
        const slider = $('#rotation_slider');
        const valueEl = $('#rotation_value');
        const select = $('#rotation_degrees');
        if (!slider || !select) return;

        const sync = (deg, source) => {
            if (valueEl) valueEl.textContent = `${deg}°`;
            if (source !== 'slider') slider.value = String(deg);
            if (source !== 'select') {
                // Try to match an existing option; if not, append a custom one.
                let opt = Array.from(select.options).find(
                    (o) => Number(o.value) === Number(deg)
                );
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = String(deg);
                    opt.textContent = `${deg}°`;
                    select.appendChild(opt);
                }
                select.value = String(deg);
            }
            if (buildingViewer) buildingViewer.setRotation(Number(deg));
        };

        slider.addEventListener('input', () => sync(Number(slider.value), 'slider'));
        select.addEventListener('change', () => sync(Number(select.value || 0), 'select'));

        // Initialise from whatever the select currently has.
        const initial = Number(select.value || 0);
        sync(initial, 'init');
    }

    // =======================================================================
    // Wizard navigation buttons
    // =======================================================================

    function initNavigation() {
        const backBtn = $('#wizardBackBtn');
        const nextBtn = $('#wizardNextBtn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                if (currentStep > 1) showStep(currentStep - 1);
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                const err = validateStep(currentStep);
                if (err) {
                    flashError(err);
                    return;
                }
                if (currentStep < STEPS.length) {
                    showStep(currentStep + 1);
                }
            });
        }

        // Allow clicking earlier (completed) step markers to jump back.
        $$('.wizard-step-marker').forEach((el) => {
            el.addEventListener('click', () => {
                const target = Number(el.dataset.step);
                if (target < currentStep) showStep(target);
            });
        });

        // The final submit button is the form's <button type="submit">; let
        // the existing app.js handler do the work, but run our validation first.
        const form = $('#buildingForm');
        if (form) {
            form.addEventListener(
                'submit',
                (e) => {
                    // Validate every step up to the current one in case the
                    // user jumped backwards.
                    for (let n = 1; n <= STEPS.length; n++) {
                        const err = validateStep(n);
                        if (err) {
                            e.preventDefault();
                            e.stopImmediatePropagation();
                            showStep(n);
                            flashError(err);
                            return;
                        }
                    }
                },
                true // capture phase: run before app.js submit handler
            );
        }
    }

    // =======================================================================
    // Bootstrap
    // =======================================================================

    function init() {
        renderArchetypeCards();
        initMap();
        initBuildingViewer();
        initRotationSlider();
        initNavigation();

        // Pre-select the default city + archetype so the user starts with a
        // valid form even if they immediately hit Next.
        selectCity('Toronto');
        selectArchetype('MidRise');

        showStep(1);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
