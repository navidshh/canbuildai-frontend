// Configuration
const API_BASE_URL = 'https://h3v7vtb0ee.execute-api.ca-central-1.amazonaws.com';  // Production API Gateway
const BUCKET_NAME = 'surrogate-api-dev-tgw-3-btap-v1-uploads';
const AWS_REGION = 'ca-central-1';

// Global storage for input parameters (for PDF reports)
let globalInputConfig = null;

// -----------------------------------------------------------------------------
// Alternative Configuration Analysis — parameter metadata
// Shared between the wizard UI (inline script in surrogate-model.html) and the
// prediction pipeline in this file. Update in one place to affect both.
// -----------------------------------------------------------------------------
const ALTERNATIVE_PARAM_METADATA = {
    ecm_system_name: {
        label: 'Dominant HVAC System',
        type: 'categorical',
        defaults: [
            'NECB_Default',
            'HS08_CCASHP_VRF',
            'HS09_CCASHP_Baseboard',
            'HS11_ASHP_PTHP',
            'HS12_ASHP_Baseboard',
            'HS13_ASHP_VRF'
        ]
    },
    ext_wall_cond: {
        label: 'External Wall Thermal Conductance (W/m²·K)',
        type: 'numeric',
        defaults: [0.183, 0.210, 0.247, 0.278, 0.314],
        suggested: { min: 0.15, max: 0.35, step: 0.05, absMin: 0.10, absMax: 0.50 }
    },
    ext_roof_cond: {
        label: 'External Roof Thermal Conductance (W/m²·K)',
        type: 'numeric',
        defaults: [0.121, 0.138, 0.142, 0.162, 0.183, 0.193, 0.227],
        suggested: { min: 0.10, max: 0.25, step: 0.03, absMin: 0.08, absMax: 0.35 }
    },
    fixed_window_cond: {
        label: 'Window Thermal Conductance (W/m²·K)',
        type: 'numeric',
        defaults: [1.6, 2.2, 2.4],
        suggested: { min: 1.5, max: 4.0, step: 0.5, absMin: 0.8, absMax: 6.0 }
    },
    fixed_wind_solar_trans: {
        label: 'Window Solar Heat Gain Coefficient',
        type: 'numeric',
        defaults: [0.2, 0.3, 0.4, 0.5, 0.6],
        suggested: { min: 0.2, max: 0.7, step: 0.1, absMin: 0.1, absMax: 0.9 }
    },
    fdwr_set: {
        label: 'Window-to-Wall Ratio (%)',
        type: 'numeric',
        defaults: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.69],
        suggested: { min: 0.1, max: 0.7, step: 0.1, absMin: 0.05, absMax: 0.9 }
    },
    srr_set: {
        label: 'Skylight-to-Roof Ratio (%)',
        type: 'numeric',
        defaults: ['NECB_Default', 0.03, 0.05, 0.08, 0.1],
        suggested: { min: 0.03, max: 0.15, step: 0.02, absMin: 0.0, absMax: 0.2 }
    },
    boiler_eff: {
        label: 'Boiler Efficiency',
        type: 'categorical',
        defaults: [
            'NECB_Default',
            'NECB 88% Efficient Condensing Boiler',
            'Viessmann Vitocrossal 300 CT3-17 96.2% Efficient Condensing Gas Boiler'
        ]
    },
    furnace_eff: {
        label: 'Furnace Efficiency',
        type: 'categorical',
        defaults: [
            'NECB_Default',
            'NECB 85% Efficient Condensing Gas Furnace'
        ]
    },
    shw_eff: {
        label: 'Service Hot Water Efficiency',
        type: 'categorical',
        defaults: [
            'NECB_Default',
            'Natural Gas Direct Vent with Electric Ignition',
            'Natural Gas Power Vent with Electric Ignition'
        ]
    }
};

// Max number of configurations (cartesian combinations) allowed per request.
const ALTERNATIVE_MAX_COMBINATIONS = 500;

// Expose for the wizard UI (loaded after app.js).
window.ALTERNATIVE_PARAM_METADATA = ALTERNATIVE_PARAM_METADATA;
window.ALTERNATIVE_MAX_COMBINATIONS = ALTERNATIVE_MAX_COMBINATIONS;

// Per-archetype geometry overrides. The default values in
// defaults_from_excel.json describe a MidriseApartment, so without these
// overrides every prediction would be run with MidRise geometry no matter
// which archetype the user picked. The numbers below come from the
// ASHRAE 90.1 Prototype Building Models / U.S. DOE Commercial Reference
// Buildings (the same prototypes the NECB archetypes are derived from);
// LowriseApartment is a NECB-specific 3-storey walk-up approximation.
//
// surrogate-geometry.js reads from window.ARCHETYPE_GEOMETRY at runtime so
// the 3D viewer never disagrees with what the model is actually being fed.
const ARCHETYPE_GEOMETRY = {
    HighRise: {
        bldg_name: 'HighriseApartment',
        bldg_standards_building_type: 'HighriseApartment',
        bldg_conditioned_floor_area_m_sq: 7058.0,   // 47.24 × 14.94 × 10
        bldg_exterior_area_m_sq: 4870.0,
        bldg_standards_number_of_above_ground_stories: 10,
        bldg_standards_number_of_stories: 10
    },
    MidRise: {
        bldg_name: 'MidriseApartment',
        bldg_standards_building_type: 'MidriseApartment',
        bldg_conditioned_floor_area_m_sq: 3134.61,
        bldg_exterior_area_m_sq: 2325.69,
        bldg_standards_number_of_above_ground_stories: 4,
        bldg_standards_number_of_stories: 4
    },
    LowRise: {
        bldg_name: 'LowriseApartment',
        bldg_standards_building_type: 'LowriseApartment',
        bldg_conditioned_floor_area_m_sq: 1248.0,   // 32.0 × 13.0 × 3
        bldg_exterior_area_m_sq: 1190.0,
        bldg_standards_number_of_above_ground_stories: 3,
        bldg_standards_number_of_stories: 3
    },
    LargeOffice: {
        bldg_name: 'LargeOffice',
        bldg_standards_building_type: 'LargeOffice',
        bldg_conditioned_floor_area_m_sq: 46320.0,
        bldg_exterior_area_m_sq: 17760.0,
        bldg_standards_number_of_above_ground_stories: 12,
        bldg_standards_number_of_stories: 12
    },
    MediumOffice: {
        bldg_name: 'MediumOffice',
        bldg_standards_building_type: 'MediumOffice',
        bldg_conditioned_floor_area_m_sq: 4982.19,
        bldg_exterior_area_m_sq: 3920.0,
        bldg_standards_number_of_above_ground_stories: 3,
        bldg_standards_number_of_stories: 3
    },
    SmallOffice: {
        bldg_name: 'SmallOffice',
        bldg_standards_building_type: 'SmallOffice',
        bldg_conditioned_floor_area_m_sq: 511.0,
        bldg_exterior_area_m_sq: 836.0,
        bldg_standards_number_of_above_ground_stories: 1,
        bldg_standards_number_of_stories: 1
    }
};

// Expose so surrogate-geometry.js (loaded after app.js) can pull the
// stories count from the same single source of truth.
window.ARCHETYPE_GEOMETRY = ARCHETYPE_GEOMETRY;

// Apply the per-archetype geometry overrides to an Excel row. Mutates `row`.
function applyArchetypeGeometry(row, buildingType) {
    if (!buildingType) return;
    const geom = ARCHETYPE_GEOMETRY[buildingType];
    if (!geom) {
        console.warn('No geometry mapping for archetype:', buildingType);
        return;
    }
    Object.keys(geom).forEach((k) => {
        row[k] = geom[k];
    });
}

// ---------------------------------------------------------------------------
// HVAC system cascading dropdowns
// ---------------------------------------------------------------------------
// The "Dominant HVAC System" picker is split in the UI into two cascading
// selects: a system family (e.g. Cold Climate Air Source Heat Pump) and a
// delivery type (e.g. VRF, Baseboard). The backend surrogate model still
// expects the original code names (HS08_CCASHP_VRF, HS12_ASHP_Baseboard, …)
// so a hidden input is populated with the mapped backend value whenever
// either select changes. The mapping below is the single source of truth.
const HVAC_SYSTEM_OPTIONS = {
    families: [
        { value: 'NECB_Default', label: 'NECB Default' },
        { value: 'CCASHP',       label: 'Cold Climate Air Source Heat Pump' },
        { value: 'ASHP',         label: 'Air Source Heat Pump' }
    ],
    typesByFamily: {
        NECB_Default: [],
        CCASHP: [
            { value: 'VRF',       label: 'VRF (Variable Refrigerant Flow)' },
            { value: 'Baseboard', label: 'Baseboard' }
        ],
        ASHP: [
            { value: 'PTHP',      label: 'Packaged Terminal Heat Pump (PTHP)' },
            { value: 'Baseboard', label: 'Baseboard' },
            { value: 'VRF',       label: 'VRF (Variable Refrigerant Flow)' }
        ]
    },
    // (family|type) -> backend ecm_system_name value expected by the model.
    // For NECB_Default the type is empty.
    backendValue: {
        'NECB_Default|':    'NECB_Default',
        'CCASHP|VRF':       'HS08_CCASHP_VRF',
        'CCASHP|Baseboard': 'HS09_CCASHP_Baseboard',
        'ASHP|PTHP':        'HS11_ASHP_PTHP',
        'ASHP|Baseboard':   'HS12_ASHP_Baseboard',
        'ASHP|VRF':         'HS13_ASHP_VRF'
    }
};

// Reverse lookup: backend ecm_system_name -> friendly display string that
// matches the wording used in the step-2 cascading dropdowns. Used by results
// (table, scatter tooltip, PDF) so users never see raw codes like
// "HS13_ASHP_VRF".
function formatHvacName(backendValue) {
    if (backendValue === undefined || backendValue === null || backendValue === '') return '—';
    // Find the (family|type) key that maps to this backend value
    const map = HVAC_SYSTEM_OPTIONS.backendValue;
    const key = Object.keys(map).find(k => map[k] === backendValue);
    if (!key) return backendValue; // Unknown code — show raw so it's at least visible

    const [family, type] = key.split('|');
    const familyLabel = (HVAC_SYSTEM_OPTIONS.families.find(f => f.value === family) || {}).label || family;
    if (!type) return familyLabel;

    const typeList = HVAC_SYSTEM_OPTIONS.typesByFamily[family] || [];
    const typeLabel = (typeList.find(t => t.value === type) || {}).label || type;
    return `${familyLabel} — ${typeLabel}`;
}

// Format a parameter value for user-facing display in results. Dispatches to
// parameter-specific formatters (e.g. HVAC codes → friendly names) and falls
// back to the raw value for numeric / free-text parameters.
function formatParamValue(paramKey, value) {
    if (value === undefined || value === null || value === '') return '—';
    if (paramKey === 'ecm_system_name') return formatHvacName(value);
    return typeof value === 'number' ? value : String(value);
}

function setupHvacCascade(familyId, typeId, hiddenId) {
    const familySel = document.getElementById(familyId);
    const typeSel = document.getElementById(typeId);
    const hidden = document.getElementById(hiddenId);
    if (!familySel || !typeSel || !hidden) return;

    // The main HVAC picker drives the live System Summary card; cost-analysis
    // pickers don't, so we only refresh the summary for the main picker.
    const isMainPicker = hiddenId === 'ecm_system_name';

    function syncHidden() {
        const family = familySel.value;
        if (!family) {
            hidden.value = '';
        } else if (family === 'NECB_Default') {
            hidden.value = 'NECB_Default';
        } else {
            const type = typeSel.value;
            hidden.value = type
                ? (HVAC_SYSTEM_OPTIONS.backendValue[`${family}|${type}`] || '')
                : '';
        }
        if (isMainPicker) renderHvacSummary();
    }

    function rebuildTypes() {
        const family = familySel.value;
        // Clear existing options
        typeSel.innerHTML = '';
        if (!family) {
            typeSel.appendChild(new Option('Select system first...', ''));
            typeSel.disabled = true;
            typeSel.required = false;
        } else if (family === 'NECB_Default') {
            typeSel.appendChild(new Option('Not applicable', ''));
            typeSel.disabled = true;
            typeSel.required = false;
        } else {
            typeSel.appendChild(new Option('Select Type...', ''));
            (HVAC_SYSTEM_OPTIONS.typesByFamily[family] || []).forEach((o) => {
                typeSel.appendChild(new Option(o.label, o.value));
            });
            typeSel.disabled = false;
            typeSel.required = true;
        }
        syncHidden();
    }

    familySel.addEventListener('change', rebuildTypes);
    typeSel.addEventListener('change', syncHidden);
    rebuildTypes();
}

// ---------------------------------------------------------------------------
// HVAC system summary card + animated layout diagram
// ---------------------------------------------------------------------------
// The summary card translates the raw form inputs into plain-English
// statements about what the simulation will model. It also exposes the
// "auto-derived" backend value for `primary_heating_fuel` - e.g. selecting
// `HS13_ASHP_VRF` + `NaturalGas` is silently rewritten by BTAP to
// `NaturalGasHPGasBackup` (heat pump primary, NG backup), and the summary
// makes that transformation visible to the user.
//
// The layout diagram is an engineering-style SVG schematic.  All elements
// are present at all times; CSS classes on the parent container toggle
// which ones are visible (mode-hp / mode-necb, necb-sys-1 / -3 / -4 / -6,
// necb-mixed for apartments (Sys 1 + Sys 4), fuel and distribution
// variants) and drive the working animations (fan spin, refrigerant flow,
// etc.).
//
// NECB system → building-archetype mapping (revised per the latest BTAP
// system assignment table). When the user selects "NECB Default", the
// building type determines which NECB system(s) the simulator will assign.
// Apartment archetypes are mixed-use: dwelling units get System 1 (PTAC +
// baseboards), corridors and common areas get System 4 (single-zone CAV
// make-up air unit, no reheat).
const NECB_DEFAULT_FOR_BUILDING = {
    SmallOffice:   { primary: 3, secondary: null,
                     note: 'Small Office (1 storey) → NECB assigns System 3 (PSZ-AC, packaged single-zone rooftop) with a single-duct CV diffuser and HW/electric perimeter baseboards.' },
    MediumOffice:  { primary: 6, secondary: null,
                     note: 'Medium Office (3 storeys) crosses the NECB ≥3-storey threshold for "General Area" zones, so the simulator assigns System 6 — a built-up multi-zone VAV air handler (one per storey), CHW cooling, HW/electric central heat, VAV reheat terminals (closest to ASHRAE 90.1 System 7).' },
    LargeOffice:   { primary: 6, secondary: null,
                     note: 'Large Office (≥3 storeys) → NECB assigns System 6 — a built-up multi-zone VAV air handler (one per storey), CHW cooling, HW/electric central heat, VAV reheat terminals (closest to ASHRAE 90.1 System 7).' },
    LowRise:       { primary: 1, secondary: 4,
                     note: 'Low-Rise Apartment: dwelling units use System 1 (PTAC + HW/electric baseboards). Corridors use System 4 — an optional central single-zone CAV make-up air unit (no reheat) + HW/electric baseboards.' },
    MidRise:       { primary: 1, secondary: 4,
                     note: 'Mid-Rise Apartment: dwelling units use System 1 (PTAC + HW/electric baseboards). Corridors use System 4 — an optional central single-zone CAV make-up air unit (no reheat) + HW/electric baseboards.' },
    HighRise:      { primary: 1, secondary: 4,
                     note: 'High-Rise Apartment: dwelling units use System 1 (PTAC + HW/electric baseboards). Corridors use System 4 — an optional central single-zone CAV make-up air unit (no reheat) + HW/electric baseboards.' }
};

const NECB_SYSTEM_INFO = {
    1: {
        label: 'System 1 - PTAC + baseboards',
        archetype: 'Packaged Terminal Air Conditioner (PTAC) - closest to ASHRAE 90.1 System 1',
        primary: 'Through-wall PTAC per zone + HW/electric perimeter baseboards (typical dwelling / hotel suite layout)',
        distribution: 'PTAC unit under each window for cooling + HW or electric baseboards along perimeter walls for heating',
        cls: 'necb-sys-1'
    },
    3: {
        label: 'System 3 - PSZ-AC',
        archetype: 'Packaged Single-Zone constant-volume rooftop unit - closest to ASHRAE 90.1 System 3',
        primary: 'Packaged Single-Zone rooftop unit (PSZ-AC) with DX cooling and gas / electric / hot-water heating + perimeter baseboards',
        distribution: 'Single-duct CV diffuser from rooftop unit + HW or electric perimeter baseboards',
        cls: 'necb-sys-3'
    },
    4: {
        label: 'System 4 - PSZ single-zone MAU (no reheat)',
        archetype: 'Packaged Single-Zone constant-volume make-up air unit (no reheat) - closest to ASHRAE 90.1 System 4',
        primary: 'Single-zone CAV make-up air unit (no reheat) with DX cooling and gas / electric heating + HW/electric baseboards',
        distribution: 'CV diffuser from a single-zone CAV MAU (no reheat) + HW or electric baseboards',
        cls: 'necb-sys-4'
    },
    6: {
        label: 'System 6 - Built-up VAV with reheat',
        archetype: 'Built-up multi-zone VAV air handler (one per storey) with reheat - closest to ASHRAE 90.1 System 7',
        primary: 'Built-up multi-zone VAV air handler (one per storey) with CHW cooling, HW/electric central heat, and VAV reheat terminals',
        distribution: 'VAV terminal per zone + HW or electric reheat coil + HW or electric perimeter baseboards',
        cls: 'necb-sys-6'
    }
};

// Static PNG schematic assets shipped in the frontend repo root. Each entry
// maps an NECB system number to the reference schematic adapted from the
// National Energy Code of Canada for Buildings (NECB) 2020, published by the
// National Research Council of Canada.
const NECB_SCHEMATIC_IMAGES = {
    1: { src: 'necb-system-1.png', caption: 'NECB System 1 - PTAC + baseboards' },
    3: { src: 'necb-system-3.png', caption: 'NECB System 3 - PSZ-AC rooftop' },
    4: { src: 'necb-system-4.png', caption: 'NECB System 4 - PSZ single-zone MAU (no reheat)' },
    6: { src: 'necb-system-6.png', caption: 'NECB System 6 - Built-up VAV with reheat' }
};

// Heat-pump reference schematic (shared by CCASHP and ASHP families).
const HEAT_PUMP_SCHEMATIC = {
    src: 'HeatPump.png',
    caption: 'Air-source heat pump - refrigerant cycle schematic'
};

const NECB_CITATION_HTML =
    'Adapted from the <em>National Energy Code of Canada for Buildings (NECB) 2020</em>, '
    + 'National Research Council of Canada.';

const HEAT_PUMP_CITATION_HTML =
    'Adapted from Natural Resources Canada, '
    + '<em>Air-Source Heat Pump Sizing and Selection Guide</em> (CanmetENERGY, 2020).';

// Show the reference schematic(s) below the "What the model will simulate"
// summary card. Rendered for NECB Default (per-archetype NECB system) and for
// the two heat-pump families (Cold Climate Air Source HP and Air Source HP).
function updateHvacSchematics(isNECB, necbMapping, isHP) {
    const wrap    = document.getElementById('hvacSchematics');
    const gallery = document.getElementById('hvacSchematicsImages');
    const title   = document.getElementById('hvacSchematicsTitle');
    const cite    = document.getElementById('hvacSchematicsCitation');
    if (!wrap || !gallery) return;

    // ---- Heat pump families ----------------------------------------------
    if (isHP) {
        if (title) title.textContent = 'Heat Pump Reference Schematic';
        gallery.innerHTML = `
            <figure class="hvac-schematic-figure">
                <img src="${HEAT_PUMP_SCHEMATIC.src}"
                     alt="${HEAT_PUMP_SCHEMATIC.caption}" loading="lazy">
                <figcaption>${HEAT_PUMP_SCHEMATIC.caption}</figcaption>
            </figure>
        `;
        if (cite) cite.innerHTML = HEAT_PUMP_CITATION_HTML;
        wrap.hidden = false;
        return;
    }

    // ---- NECB Default ----------------------------------------------------
    if (!isNECB || !necbMapping) {
        wrap.hidden = true;
        gallery.innerHTML = '';
        return;
    }

    const systems = [necbMapping.primary, necbMapping.secondary].filter(Boolean);
    const entries = systems
        .map((n) => ({ n, img: NECB_SCHEMATIC_IMAGES[n] }))
        .filter((e) => e.img);

    if (entries.length === 0) {
        wrap.hidden = true;
        gallery.innerHTML = '';
        return;
    }

    if (title) {
        title.textContent = entries.length > 1
            ? 'NECB Reference Schematics'
            : 'NECB Reference Schematic';
    }

    gallery.innerHTML = entries.map(({ n, img }) => `
        <figure class="hvac-schematic-figure">
            <img src="${img.src}" alt="${img.caption}" loading="lazy">
            <figcaption>System ${n}</figcaption>
        </figure>
    `).join('');

    if (cite) cite.innerHTML = NECB_CITATION_HTML;
    wrap.hidden = false;
}

function renderHvacSummary() {
    const familySel   = document.getElementById('ecm_system_family');
    const typeSel     = document.getElementById('ecm_system_type');
    const fuelSel     = document.getElementById('primary_heating_fuel');
    const shwSel      = document.getElementById('shw_eff');
    const ecmHidden   = document.getElementById('ecm_system_name');
    const buildingSel = document.getElementById('building_type');
    const card        = document.getElementById('hvacSummaryCard');
    if (!card) return;

    const family       = familySel   ? familySel.value   : '';
    const type         = typeSel     ? typeSel.value     : '';
    const fuel         = fuelSel     ? fuelSel.value     : '';
    const shw          = shwSel      ? shwSel.value      : '';
    const buildingType = buildingSel ? buildingSel.value : '';
    const isHP         = family === 'CCASHP' || family === 'ASHP';
    const isNECB       = family === 'NECB_Default';

    // ---- NECB default → actual NECB system number (from building type) ----
    const necbMapping = (isNECB && buildingType) ? NECB_DEFAULT_FOR_BUILDING[buildingType] : null;
    const primarySys  = necbMapping ? NECB_SYSTEM_INFO[necbMapping.primary]   : null;
    const secondarySys = (necbMapping && necbMapping.secondary)
                            ? NECB_SYSTEM_INFO[necbMapping.secondary] : null;

    // ---- Primary heating ----
    let primary = '-';
    if (family === 'CCASHP')           primary = 'Cold Climate Air Source Heat Pump (electric refrigerant cycle)';
    else if (family === 'ASHP')        primary = 'Air Source Heat Pump (electric refrigerant cycle)';
    else if (isNECB) {
        if (primarySys && secondarySys) {
            // Mixed-use building (e.g. apartments): both systems apply.
            const fuelTag = fuel === 'NaturalGas'   ? ' - natural gas fuelled'
                          : fuel === 'Electricity'  ? ' - electrically fuelled'
                          : '';
            primary = `${primarySys.label} (dwelling units) + ${secondarySys.label} (corridors / common areas)${fuelTag}. `
                    + `Suites: ${primarySys.primary}. Corridors: ${secondarySys.primary}.`;
        } else if (primarySys) {
            const fuelTag = fuel === 'NaturalGas'   ? ' - natural gas fuelled'
                          : fuel === 'Electricity'  ? ' - electrically fuelled'
                          : '';
            primary = `${primarySys.label}${fuelTag}. ${primarySys.primary}.`;
        } else if (fuel === 'NaturalGas') {
            primary = 'Natural Gas boiler / furnace (NECB default - select a building archetype to see the exact system)';
        } else if (fuel === 'Electricity') {
            primary = 'Electric heating (NECB default - select a building archetype to see the exact system)';
        } else {
            primary = 'NECB default (pick a building archetype and fuel)';
        }
    }

    // ---- Distribution ----
    const typeLabels = {
        VRF:       'Variable Refrigerant Flow (VRF)',
        Baseboard: 'Hydronic / electric baseboards',
        PTHP:      'Packaged Terminal Heat Pump (PTHP)'
    };
    let distribution = '-';
    if (isHP && type)              distribution = typeLabels[type] || type;
    else if (isNECB && primarySys && secondarySys) {
        distribution = `Dwelling units: ${primarySys.distribution}. `
                     + `Common areas: ${secondarySys.distribution}.`;
    }
    else if (isNECB && primarySys) distribution = primarySys.distribution;
    else if (isNECB)               distribution = 'NECB default zoning (depends on building archetype)';

    // ---- Backup heating + derived fuel value ----
    let backup       = '-';
    let derivedFuel  = '-';
    let note         = '';
    if (fuel === 'NaturalGas') {
        if (isHP) {
            backup      = 'Natural Gas - boiler / furnace loop (used during very cold hours)';
            derivedFuel = 'NaturalGasHPGasBackup (auto-derived)';
            note        = 'The heat pump remains the primary heating source. Natural gas is the supplementary backup, used when the heat pump cannot meet load.';
        } else {
            backup      = 'N/A - natural gas is the primary heat source';
            derivedFuel = 'NaturalGas';
        }
    } else if (fuel === 'Electricity') {
        if (isHP) {
            backup      = 'Electric resistance - supplementary heating during very cold hours';
            derivedFuel = 'ElectricityHPElecBackup (auto-derived)';
            note        = 'The heat pump remains the primary heating source. Electric resistance is the supplementary backup.';
        } else {
            backup      = 'N/A - electricity is the primary heat source';
            derivedFuel = 'Electricity';
        }
    }

    // For NECB default, append the archetype-driven NECB note (and secondary
    // system note for mixed-use buildings like apartments).
    if (isNECB && necbMapping) {
        const extra = secondarySys
            ? `${necbMapping.note} Corridors use ${secondarySys.label}.`
            : necbMapping.note;
        note = note ? `${note} ${extra}` : extra;
    } else if (isNECB && !buildingType) {
        note = note
            ? `${note} Select a building archetype to see the exact NECB system the simulator will assign.`
            : 'Select a building archetype to see the exact NECB system the simulator will assign.';
    }

    // ---- Service hot water ----
    const shwLabels = {
        'NECB_Default':                                        'NECB Default',
        'Natural Gas Direct Vent with Electric Ignition':      'Natural Gas Direct Vent',
        'Natural Gas Power Vent with Electric Ignition':       'Natural Gas Power Vent'
    };
    const shwDisplay = shw ? (shwLabels[shw] || shw) : '-';

    // ---- Write to the DOM ----
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    set('hvacSummaryPrimary',      primary);
    set('hvacSummaryDistribution', distribution);
    set('hvacSummaryBackup',       backup);
    set('hvacSummarySHW',          shwDisplay);
    set('hvacSummaryEcm',          (ecmHidden && ecmHidden.value) || '-');
    set('hvacSummaryFuel',         derivedFuel);
    set('hvacSummaryNote',         note);

    // ---- Update the NECB reference schematic(s) shown below the card ----
    updateHvacSchematics(isNECB, necbMapping, isHP);

    // ---- Reframe the "Primary Heating Fuel" label when in heat-pump mode ----
    const fuelLabel = document.getElementById('primaryHeatingFuelLabel');
    if (fuelLabel) {
        if (isHP) {
            fuelLabel.innerHTML =
                'Backup / Supplementary Heating Fuel ' +
                '<span class="tooltip" data-tooltip="The heat pump is the primary heating source (electric). ' +
                'This fuel powers the supplementary boiler / furnace loop used during very cold hours ' +
                'and for ancillary heating loads.">ℹ️</span>';
        } else {
            fuelLabel.innerHTML =
                'Primary Heating Fuel ' +
                '<span class="tooltip" data-tooltip="The main energy source for heating (boiler / furnace loop).">ℹ️</span>';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Main HVAC picker (present on both index.html and surrogate-model.html).
    setupHvacCascade('ecm_system_family', 'ecm_system_type', 'ecm_system_name');
    // Cost-analysis baseline / improved pickers (surrogate-model.html only).
    setupHvacCascade('baselineValue_family', 'baselineValue_type', 'baselineValueSelect');
    setupHvacCascade('improvedValue_family', 'improvedValue_type', 'improvedValueSelect');

    // Render the initial summary (schematics update lazily inside).
    renderHvacSummary();

    // Re-render the summary whenever any contributing field changes.
    // `building_type` is included so the NECB-default summary updates with
    // the selected archetype (the archetype cards dispatch a 'change' on
    // the hidden #building_type select - see surrogate-wizard.js).
    ['primary_heating_fuel', 'shw_eff', 'building_type'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', renderHvacSummary);
    });

    // Form reset doesn't trigger 'change' on selects, so re-run the cascade
    // initialisers on reset to keep the type select in sync with the family.
    const buildingForm = document.getElementById('buildingForm');
    if (buildingForm) {
        buildingForm.addEventListener('reset', () => {
            setTimeout(() => {
                ['ecm_system_family',
                 'baselineValue_family',
                 'improvedValue_family'].forEach((id) => {
                    const sel = document.getElementById(id);
                    if (sel) sel.dispatchEvent(new Event('change'));
                });
                renderHvacSummary();
            }, 0);
        });
    }
});

// Cognito Configuration
const poolData = {
    UserPoolId: 'ca-central-1_NHVo7D7Kw',
    ClientId: '1bba66drbfqk7rgnq0h13mf56l'
};

// Check authentication on page load
function checkAuthentication() {
    const accessToken = sessionStorage.getItem('accessToken');
    const idToken = sessionStorage.getItem('idToken');
    const userEmail = sessionStorage.getItem('userEmail');
    
    if (!accessToken || !idToken) {
        // Not authenticated, redirect to login
        window.location.href = 'auth.html';
        return false;
    }
    
    // Display user email
    if (userEmail) {
        document.getElementById('user-email').textContent = userEmail;
    }
    
    return true;
}

// Handle logout
function handleLogout() {
    // Clear session storage
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('idToken');
    sessionStorage.removeItem('userEmail');
    
    // Redirect to login page
    window.location.href = 'auth.html';
}

// Get auth token for API requests
function getAuthToken() {
    return sessionStorage.getItem('idToken');
}

// Check auth on page load
if (!checkAuthentication()) {
    // Stop script execution if not authenticated
    throw new Error('Not authenticated');
}

// Form handling
document.getElementById('buildingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Get form data
    const formData = new FormData(e.target);
    const buildingConfig = {};
    
    for (let [key, value] of formData.entries()) {
        // Skip analysis-specific parameters, handle them separately
        if (key === 'analysisType' || key === 'variableParameter' || key === 'rangeType' || 
            key === 'customMin' || key === 'customMax' || key === 'customStep' ||
            key === 'costParameter' || key === 'baselineValue' || key === 'improvedValue' ||
            key === 'electricityRate' || key === 'gasRate' || key === 'analysisYears') {
            continue;
        }
        // Convert numeric strings to numbers
        if (!isNaN(value) && value !== '') {
            buildingConfig[':' + key] = parseFloat(value);
        } else {
            buildingConfig[':' + key] = value;
        }
    }
    
    // Get analysis type
    const analysisType = formData.get('analysisType');

    // Cost analysis parameters (still form-based)
    const costParameter = formData.get('costParameter');
    let baselineValue = formData.get('baselineValue');
    let improvedValue = formData.get('improvedValue');

    // If HVAC system is selected, use the select dropdowns instead of numeric inputs
    if (costParameter === 'ecm_system_name') {
        baselineValue = formData.get('baselineValueSelect');
        improvedValue = formData.get('improvedValueSelect');
    }

    const electricityRate = formData.get('electricityRate');
    const gasRate = formData.get('gasRate');
    const analysisYears = formData.get('analysisYears');

    // Alternative analysis parameters come from the multi-row wizard UI
    let alternativeSpecs = null;
    if (analysisType === 'alternative') {
        if (window.altConfig && typeof window.altConfig.collect === 'function') {
            const collected = window.altConfig.collect();
            if (!collected.ok) {
                alert(collected.error);
                return;
            }
            alternativeSpecs = collected.specs;
            console.log('Alternative parameter specs:', alternativeSpecs,
                        'Total combinations:', collected.totalCombinations);
        } else {
            // Legacy single-parameter fallback (index.html — no wizard).
            const legacyParam = formData.get('variableParameter');
            if (!legacyParam) {
                alert('Please select a parameter to vary.');
                return;
            }
            const meta = (window.ALTERNATIVE_PARAM_METADATA || {})[legacyParam];
            let values;
            const rangeType = formData.get('rangeType');
            if (rangeType === 'custom') {
                const min = parseFloat(formData.get('customMin'));
                const max = parseFloat(formData.get('customMax'));
                const step = parseFloat(formData.get('customStep'));
                if (isNaN(min) || isNaN(max) || isNaN(step) || min >= max || step <= 0) {
                    alert('Please enter valid custom range values.');
                    return;
                }
                values = [];
                for (let v = min; v <= max + 1e-9; v += step) {
                    values.push(parseFloat(v.toFixed(6)));
                    if (values.length > 200) break;
                }
            } else if (meta) {
                values = [...meta.defaults];
            } else {
                alert(`No defaults defined for parameter: ${legacyParam}`);
                return;
            }
            alternativeSpecs = [{ parameter: legacyParam, values }];
        }
    }

    console.log('Building Configuration:', buildingConfig);
    console.log('Analysis Type:', analysisType);

    // Store input configuration globally for PDF reports
    globalInputConfig = { ...buildingConfig };
    // Remove ':' prefix for cleaner display
    Object.keys(globalInputConfig).forEach(key => {
        if (key.startsWith(':')) {
            const cleanKey = key.substring(1);
            globalInputConfig[cleanKey] = globalInputConfig[key];
            delete globalInputConfig[key];
        }
    });

    // Validate cost analysis inputs
    if (analysisType === 'cost') {
        if (!costParameter) {
            alert('Please select a parameter to improve for cost analysis.');
            return;
        }
        if (!baselineValue || !improvedValue) {
            alert('Please enter both baseline and improved values.');
            return;
        }
        if (!electricityRate || !gasRate) {
            alert('Please enter electricity rate and gas rate.');
            return;
        }
        // Only validate numeric values if not HVAC system
        if (costParameter !== 'ecm_system_name') {
            const baseline = parseFloat(baselineValue);
            const improved = parseFloat(improvedValue);
            if (isNaN(baseline) || isNaN(improved)) {
                alert('Please enter valid numeric values for baseline and improved values.');
                return;
            }
        }
    }

    // Show loading overlay
    showLoading();

    try {
        let results;

        if (analysisType === 'single') {
            // Generate Excel file from configuration
            const excelBlob = await generateExcelFile(buildingConfig);

            // Upload to API
            results = await uploadAndPredict(excelBlob);
            results.analysisType = 'single';
        } else if (analysisType === 'cost') {
            // Cost analysis - run two predictions (baseline and improved)
            // For numeric parameters, parse as float; for string parameters (HVAC), use as-is
            const baselineVal = costParameter === 'ecm_system_name' ? baselineValue : parseFloat(baselineValue);
            const improvedVal = costParameter === 'ecm_system_name' ? improvedValue : parseFloat(improvedValue);

            results = await performCostAnalysis(
                buildingConfig,
                costParameter,
                baselineVal,
                improvedVal,
                parseFloat(electricityRate),
                parseFloat(gasRate),
                parseInt(analysisYears || 25)
            );
        } else {
            // Alternative configuration analysis — cartesian product of all
            // parameter values, chunked into batches to stay under API Gateway
            // response-size limits.
            results = await runAlternativeAnalysisBatched(
                buildingConfig,
                alternativeSpecs,
                ({ batch, totalBatches, completed, total }) => {
                    if (totalBatches > 1) {
                        updateLoadingSubtext(
                            `Processing batch ${batch} of ${totalBatches} ` +
                            `(${completed}/${total} configurations complete)…`
                        );
                    }
                }
            );
            results.analysisType = 'alternative';
            results.variableParameters = alternativeSpecs.map(s => s.parameter);
            // Back-compat: keep singular field if only one param
            if (alternativeSpecs.length === 1) {
                results.variableParameter = alternativeSpecs[0].parameter;
            }
        }

        // Display results
        displayResults(results);

    } catch (error) {
        console.error('Error:', error);
        displayError(error.message);
    } finally {
        hideLoading();
    }
});

// Generate Excel file from building configuration
async function generateExcelFile(config) {
    // Load ALL default values from the first row of the sample Input.xlsx
    let allDefaults;
    try {
        const defaultsResponse = await fetch('./defaults_from_excel.json');
        if (!defaultsResponse.ok) {
            throw new Error(`Failed to load defaults_from_excel.json: ${defaultsResponse.status} ${defaultsResponse.statusText}`);
        }
        allDefaults = await defaultsResponse.json();
    } catch (error) {
        console.error('Error loading defaults:', error);
        throw new Error(`Failed to load configuration defaults: ${error.message}`);
    }
    
    // Create a copy of all defaults
    const row = { ...allDefaults };
    
    console.log('Config received:', config);
    console.log('Config keys:', Object.keys(config));
    
    // Override with user-selected values (the 18 configurable parameters)
    const userParams = [
        'ecm_system_name', 'primary_heating_fuel', 'boiler_eff', 'furnace_eff', 'shw_eff',
        'dcv_type', 'erv_package', 'airloop_economizer_type', 'nv_type',
        'ext_wall_cond', 'ext_roof_cond', 'fixed_window_cond', 'fixed_wind_solar_trans', 'fdwr_set',
        'srr_set', 'building_type', 'rotation_degrees', 'epw_file'
    ];
    
    let updatedCount = 0;
    userParams.forEach(param => {
        const key = ':' + param;
        if (config[key] !== undefined) {
            console.log(`Updating ${key}: ${allDefaults[key]} -> ${config[key]}`);
            row[key] = config[key];
            updatedCount++;
        }
    });

    // Keep the legacy ComStock column in sync with the user's selection so the
    // backend's auto config selection doesn't pick the stale default value.
    if (config[':building_type'] !== undefined) {
        row['bldg_standards_building_type'] = config[':building_type'];
    }

    // Inject per-archetype geometry (floor area, exterior area, bldg_name) so
    // the surrogate model receives the right geometry for the chosen archetype
    // instead of the MidRise defaults baked into defaults_from_excel.json.
    applyArchetypeGeometry(row, config[':building_type']);

    console.log(`Updated ${updatedCount} out of ${userParams.length} user parameters`);
    console.log('Final values:', userParams.map(p => ':' + p + '=' + row[':' + p]));
    
    // Create worksheet from the data (single row)
    const ws = XLSX.utils.json_to_sheet([row]);
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    
    // Generate Excel file as binary
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    
    // Convert to Blob
    const blob = new Blob([excelBuffer], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    
    return blob;
}

// Build all cartesian-product row objects for alternative-configuration
// analysis. Separated from the Excel packing step so callers can chunk large
// batches before uploading.
async function buildCombinationRows(config, paramSpecs) {
    if (!Array.isArray(paramSpecs) || paramSpecs.length === 0) {
        throw new Error('No parameter specifications provided for alternative analysis.');
    }

    let allDefaults;
    try {
        const defaultsResponse = await fetch('./defaults_from_excel.json');
        if (!defaultsResponse.ok) {
            throw new Error(`Failed to load defaults_from_excel.json: ${defaultsResponse.status} ${defaultsResponse.statusText}`);
        }
        allDefaults = await defaultsResponse.json();
    } catch (error) {
        console.error('Error loading defaults:', error);
        throw new Error(`Failed to load configuration defaults: ${error.message}`);
    }

    // Cartesian product of every parameter's values
    const combinations = paramSpecs.reduce(
        (acc, spec) => acc.flatMap(prev => spec.values.map(v => [...prev, v])),
        [[]]
    );

    console.log(`Generating ${combinations.length} combinations for parameters: ` +
                paramSpecs.map(s => s.parameter).join(', '));

    const userParams = [
        'ecm_system_name', 'primary_heating_fuel', 'boiler_eff', 'furnace_eff', 'shw_eff',
        'dcv_type', 'erv_package', 'airloop_economizer_type', 'nv_type',
        'ext_wall_cond', 'ext_roof_cond', 'fixed_window_cond', 'fixed_wind_solar_trans', 'fdwr_set',
        'srr_set', 'building_type', 'rotation_degrees', 'epw_file', 'pv_ground_type'
    ];

    return combinations.map(combo => {
        const row = { ...allDefaults };
        userParams.forEach(param => {
            const key = ':' + param;
            if (config[key] !== undefined) row[key] = config[key];
        });
        if (config[':building_type'] !== undefined) {
            row['bldg_standards_building_type'] = config[':building_type'];
        }
        applyArchetypeGeometry(row, config[':building_type']);
        paramSpecs.forEach((spec, j) => {
            row[':' + spec.parameter] = combo[j];
        });
        return row;
    });
}

// Pack an array of row objects into an .xlsx Blob for upload.
function rowsToExcelBlob(rows) {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
}

// Generate Excel file with all combinations in a single blob. Kept for
// backward compatibility / single-batch callers.
async function generateCombinationsExcelFile(config, paramSpecs) {
    const rows = await buildCombinationRows(config, paramSpecs);
    return rowsToExcelBlob(rows);
}

// Chunk size for the API round-trip. Each config produces ~100 KB of JSON
// output and API Gateway caps responses at 10 MB, so we cap batches well below
// that ceiling and merge results client-side.
const ALTERNATIVE_BATCH_SIZE = 30;

// Run an alternative-configuration analysis in one or more batches, merging
// energy_aggregated_results and costing_results into a single response object.
async function runAlternativeAnalysisBatched(config, paramSpecs, onProgress) {
    const rows = await buildCombinationRows(config, paramSpecs);
    const total = rows.length;

    const batches = [];
    for (let i = 0; i < total; i += ALTERNATIVE_BATCH_SIZE) {
        batches.push(rows.slice(i, i + ALTERNATIVE_BATCH_SIZE));
    }

    console.log(`Running ${total} configurations in ${batches.length} batch(es) of up to ${ALTERNATIVE_BATCH_SIZE}`);

    let merged = null;
    let completed = 0;
    for (let b = 0; b < batches.length; b++) {
        if (typeof onProgress === 'function') {
            onProgress({
                batch: b + 1,
                totalBatches: batches.length,
                completed,
                total
            });
        }

        const blob = rowsToExcelBlob(batches[b]);
        const batchResult = await uploadAndPredict(blob);

        if (!merged) {
            merged = {
                ...batchResult,
                energy_aggregated_results: [...(batchResult.energy_aggregated_results || [])],
                costing_results: [...(batchResult.costing_results || [])]
            };
        } else {
            merged.energy_aggregated_results.push(...(batchResult.energy_aggregated_results || []));
            merged.costing_results.push(...(batchResult.costing_results || []));
            // building_metadata is identical across batches for the same building.
        }
        completed += batches[b].length;
    }

    return merged;
}

// Perform cost analysis comparing baseline vs improved configuration
async function performCostAnalysis(config, parameter, baselineValue, improvedValue, electricityRate, gasRate, analysisYears) {
    console.log('Performing cost analysis:', { parameter, baselineValue, improvedValue, electricityRate, gasRate, analysisYears });
    
    try {
        // Create baseline configuration
        const baselineConfig = { ...config };
        baselineConfig[':' + parameter] = baselineValue;
        
        // Create improved configuration
        const improvedConfig = { ...config };
        improvedConfig[':' + parameter] = improvedValue;
        
        console.log('Generating baseline prediction...');
        // Generate and predict for baseline
        const baselineExcel = await generateExcelFile(baselineConfig);
        const baselineResults = await uploadAndPredict(baselineExcel);
        console.log('Baseline results received:', baselineResults);
        
        console.log('Generating improved prediction...');
        // Generate and predict for improved
        const improvedExcel = await generateExcelFile(improvedConfig);
        const improvedResults = await uploadAndPredict(improvedExcel);
        console.log('Improved results received:', improvedResults);
        
        // Check results structure
        if (!baselineResults.energy_aggregated_results || !baselineResults.costing_results) {
            console.error('Missing energy or cost data in baseline results:', baselineResults);
            throw new Error('Baseline results missing required data');
        }
        if (!improvedResults.energy_aggregated_results || !improvedResults.costing_results) {
            console.error('Missing energy or cost data in improved results:', improvedResults);
            throw new Error('Improved results missing required data');
        }
        
        // Extract energy consumption values (first result)
        const baselineEnergy = baselineResults.energy_aggregated_results[0];
        const improvedEnergy = improvedResults.energy_aggregated_results[0];
        
        // Extract costing results (per m²)
        const baselineCost = baselineResults.costing_results[0];
        const improvedCost = improvedResults.costing_results[0];
        
        // Get building area from the results
        let buildingArea = baselineResults.building_metadata?.floor_area || null;
        
        // If floor_area not available in metadata, try to extract from other sources
        if (!buildingArea) {
            // Try to get from energy results (some APIs include it there)
            buildingArea = baselineEnergy.floor_area_m_sq || baselineEnergy['Building Area (m²)'] || null;
        }
        
        // Last resort: use a default based on building type
        if (!buildingArea) {
            console.warn('Building area not found in results, using default 1000 m²');
            buildingArea = 1000;
        }
        
        console.log('Building area:', buildingArea);
        console.log('Building metadata:', baselineResults.building_metadata);
        console.log('Baseline cost keys:', Object.keys(baselineCost));
    
    // Calculate equipment costs ($/m²)
    const baselineEnvelopeCost = baselineCost["Predicted cost_equipment_envelope_total_cost_per_m_sq"] || 0;
    const baselineHvacCost = baselineCost["Predicted cost_equipment_heating_and_cooling_total_cost_per_m_sq"] || 0;
    const baselineLightingCost = baselineCost["Predicted cost_equipment_lighting_total_cost_per_m_sq"] || 0;
    const baselineVentilationCost = baselineCost["Predicted cost_equipment_ventilation_total_cost_per_m_sq"] || 0;
    const baselineShwCost = baselineCost["Predicted cost_equipment_shw_total_cost_per_m_sq"] || 0;
    const baselineTotalCostPerM2 = baselineEnvelopeCost + baselineHvacCost + baselineLightingCost + baselineVentilationCost + baselineShwCost;
    
    const improvedEnvelopeCost = improvedCost["Predicted cost_equipment_envelope_total_cost_per_m_sq"] || 0;
    const improvedHvacCost = improvedCost["Predicted cost_equipment_heating_and_cooling_total_cost_per_m_sq"] || 0;
    const improvedLightingCost = improvedCost["Predicted cost_equipment_lighting_total_cost_per_m_sq"] || 0;
    const improvedVentilationCost = improvedCost["Predicted cost_equipment_ventilation_total_cost_per_m_sq"] || 0;
    const improvedShwCost = improvedCost["Predicted cost_equipment_shw_total_cost_per_m_sq"] || 0;
    const improvedTotalCostPerM2 = improvedEnvelopeCost + improvedHvacCost + improvedLightingCost + improvedVentilationCost + improvedShwCost;
    
    // Calculate retrofit cost (difference in equipment costs)
    const retrofitCostPerM2 = improvedTotalCostPerM2 - baselineTotalCostPerM2;
    
    // For envelope components (windows, walls, roof), costs are per m² of component, not floor area
    // Apply correction factor based on parameter type
    let effectiveArea = buildingArea;
    let areaNote = '';
    
    if (parameter === 'fixed_window_cond') {
        // Window area = Wall area × FDWR (window-to-wall ratio)
        // Wall area ≈ 0.4-0.5 × floor area for multi-story buildings
        const wallToFloorRatio = 0.45; // Typical for mid-rise
        const fdwr = config[':fdwr_set'] || 0.3; // Get actual FDWR from config, default 0.3
        const wallArea = buildingArea * wallToFloorRatio;
        effectiveArea = wallArea * fdwr;
        areaNote = ` (wall area: ${wallArea.toFixed(0)} m² × FDWR: ${(fdwr * 100).toFixed(0)}%)`;
    } else if (parameter === 'ext_wall_cond') {
        // Exterior wall area ≈ 40-50% of floor area for mid-rise buildings
        effectiveArea = buildingArea * 0.45;
        areaNote = ' (estimated exterior wall area)';
    } else if (parameter === 'ext_roof_cond') {
        // Roof area ≈ floor area / number of floors (for flat roof)
        // For multi-story, typically 20-30% of total floor area
        effectiveArea = buildingArea * 0.25;
        areaNote = ' (estimated roof area)';
    }
    
    const retrofitCost = retrofitCostPerM2 * effectiveArea;
    
    console.log('Cost calculation:', {
        baselineTotalCostPerM2,
        improvedTotalCostPerM2,
        retrofitCostPerM2,
        buildingArea,
        effectiveArea,
        areaNote,
        retrofitCost
    });
    
    console.log('Baseline energy data:', baselineEnergy);
    console.log('Improved energy data:', improvedEnergy);
    console.log('Available energy fields:', Object.keys(baselineEnergy));
    
    // Calculate energy savings (per m²)
    const electricitySavings = baselineEnergy["Predicted Electricity Energy Total (Gigajoules per square meter)"] - 
                               improvedEnergy["Predicted Electricity Energy Total (Gigajoules per square meter)"];
    const gasSavings = baselineEnergy["Predicted Gas Energy Total (Gigajoules per square meter)"] - 
                      improvedEnergy["Predicted Gas Energy Total (Gigajoules per square meter)"];
    
    console.log('Energy savings (GJ/m²):', {
        electricitySavings,
        gasSavings,
        baselineElectricity: baselineEnergy["Predicted Electricity Energy Total (Gigajoules per square meter)"],
        improvedElectricity: improvedEnergy["Predicted Electricity Energy Total (Gigajoules per square meter)"],
        baselineGas: baselineEnergy["Predicted Gas Energy Total (Gigajoules per square meter)"],
        improvedGas: improvedEnergy["Predicted Gas Energy Total (Gigajoules per square meter)"]
    });
    
    // Convert to kWh and m³ for the building
    // 1 GJ = 277.778 kWh
    const electricitySavingsKwhPerM2 = electricitySavings * 277.778;
    // 1 GJ ≈ 26.8 m³ of natural gas
    const gasSavingsM3PerM2 = gasSavings * 26.8;
    
    // Calculate total annual energy savings for the whole building
    const totalElectricitySavingsKwh = electricitySavingsKwhPerM2 * buildingArea;
    const totalGasSavingsM3 = gasSavingsM3PerM2 * buildingArea;
    
    console.log('Total building energy savings:', {
        totalElectricitySavingsKwh,
        totalGasSavingsM3,
        buildingArea
    });
    
    // Calculate annual cost savings
    const annualElectricitySavings = totalElectricitySavingsKwh * electricityRate;
    const annualGasSavings = totalGasSavingsM3 * gasRate;
    const totalAnnualSavings = annualElectricitySavings + annualGasSavings;
    
    console.log('Annual cost savings:', {
        annualElectricitySavings,
        annualGasSavings,
        totalAnnualSavings,
        electricityRate,
        gasRate
    });
    
    // Calculate ROI metrics
    const simplePaybackYears = retrofitCost > 0 && totalAnnualSavings > 0 ? retrofitCost / totalAnnualSavings : 0;
    const totalSavingsOverPeriod = totalAnnualSavings * analysisYears;
    const netSavings = totalSavingsOverPeriod - retrofitCost;
    const roi = retrofitCost > 0 ? (netSavings / retrofitCost) * 100 : 0;
    
    console.log('ROI metrics:', {
        retrofitCost,
        simplePaybackYears,
        totalSavingsOverPeriod,
        netSavings,
        roi
    });
    
    // Calculate percentage reductions
    const baselineElectricityGJ = baselineEnergy["Predicted Electricity Energy Total (Gigajoules per square meter)"];
    const baselineGasGJ = baselineEnergy["Predicted Gas Energy Total (Gigajoules per square meter)"];
    const electricityReduction = baselineElectricityGJ > 0 ? (electricitySavings / baselineElectricityGJ) * 100 : 0;
    const gasReduction = baselineGasGJ > 0 ? (gasSavings / baselineGasGJ) * 100 : 0;
    
    // Return comprehensive results
    return {
        analysisType: 'cost',
        parameter: parameter,
        baselineValue: baselineValue,
        improvedValue: improvedValue,
        baselineResults: {
            total_energy_eui_electricity_kwh_per_m_sq: baselineElectricityGJ * 277.778,
            total_energy_eui_natural_gas_gj_per_m_sq: baselineGasGJ,
            total_cost_per_m_sq: baselineTotalCostPerM2
        },
        improvedResults: {
            total_energy_eui_electricity_kwh_per_m_sq: improvedEnergy["Predicted Electricity Energy Total (Gigajoules per square meter)"] * 277.778,
            total_energy_eui_natural_gas_gj_per_m_sq: improvedEnergy["Predicted Gas Energy Total (Gigajoules per square meter)"],
            total_cost_per_m_sq: improvedTotalCostPerM2
        },
        economics: {
            retrofitCost: retrofitCost,
            retrofitCostPerM2: retrofitCostPerM2,
            effectiveArea: effectiveArea,
            areaNote: areaNote,
            baselineTotalCost: baselineTotalCostPerM2 * buildingArea,
            improvedTotalCost: improvedTotalCostPerM2 * buildingArea,
            electricityRate: electricityRate,
            gasRate: gasRate,
            analysisYears: analysisYears,
            buildingArea: buildingArea,
            annualElectricitySavings: annualElectricitySavings,
            annualGasSavings: annualGasSavings,
            totalAnnualSavings: totalAnnualSavings,
            simplePaybackYears: simplePaybackYears,
            totalSavingsOverPeriod: totalSavingsOverPeriod,
            netSavings: netSavings,
            roi: roi
        },
        energySavings: {
            electricitySavings: electricitySavingsKwhPerM2,
            electricitySavingsPercent: electricityReduction,
            gasSavings: gasSavings,
            gasSavingsPercent: gasReduction,
            totalElectricitySavingsKwh: totalElectricitySavingsKwh,
            totalGasSavingsM3: totalGasSavingsM3
        }
    };
    } catch (error) {
        console.error('Error in performCostAnalysis:', error);
        throw error;
    }
}

// Upload file and get prediction
async function uploadAndPredict(fileBlob) {
    // Generate unique email with timestamp to avoid caching issues
    const uniqueEmail = 'frontend_user_' + Date.now();
    console.log('Using unique email:', uniqueEmail);
    
    // Create FormData for upload
    const uploadFormData = new FormData();
    uploadFormData.append('file', fileBlob, 'building_config.xlsx');
    uploadFormData.append('email', uniqueEmail);
    
    // Upload file
    let uploadResponse;
    try {
        uploadResponse = await fetch(`${API_BASE_URL}/surrogate_model/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: uploadFormData
        });
    } catch (error) {
        console.error('Network error during upload:', error);
        throw new Error(`Network error during file upload: ${error.message}. Please check your internet connection.`);
    }
    
    if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`Upload failed: ${errorText}`);
    }
    
    const uploadResult = await uploadResponse.json();
    console.log('Upload result:', uploadResult);
    
    // Run model with the uploaded file
    // The backend will auto-select the appropriate config based on building type and location
    const predictFormData = new FormData();
    predictFormData.append('email', uniqueEmail);
    // No need to send config_file - backend auto-selects based on building data
    
    const predictResponse = await fetch(`${API_BASE_URL}/surrogate_model/run-model-s3`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${getAuthToken()}`
        },
        body: predictFormData
    });
    
    if (!predictResponse.ok) {
        const errorText = await predictResponse.text();
        throw new Error(`Prediction failed: ${errorText}`);
    }
    
    const results = await predictResponse.json();
    console.log('Prediction results:', results);
    console.log('Output key:', results.output_key);
    console.log('Expected S3 path: uploads/' + uniqueEmail + '_output.json');
    
    // Wait a moment for S3 to be ready
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Download the actual results from S3
    if (results.status === 'success' && results.output_key) {
        const downloadFormData = new FormData();
        downloadFormData.append('email', uniqueEmail);
        
        console.log('Downloading results for email:', uniqueEmail);
        
        try {
            // Download output.json
            const downloadResponse = await fetch(`${API_BASE_URL}/surrogate_model/download-result`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: downloadFormData
            });
            
            if (downloadResponse.ok) {
                const predictions = await downloadResponse.json();
                console.log('Downloaded predictions:', predictions);
                console.log('Energy data sample:', predictions.energy_aggregated_results?.[0]);
                console.log('Cost data sample:', predictions.costing_results?.[0]);
                
                // Sanitize energy values - convert negative values to zero
                // This can happen when ML model predicts very small negative values (numerical precision issues)
                if (predictions.energy_aggregated_results) {
                    predictions.energy_aggregated_results.forEach(result => {
                        // Check electricity energy
                        if (result["Predicted Electricity Energy Total (Gigajoules per square meter)"] < 0) {
                            console.warn('Negative electricity value detected, converting to 0:', 
                                result["Predicted Electricity Energy Total (Gigajoules per square meter)"]);
                            result["Predicted Electricity Energy Total (Gigajoules per square meter)"] = 0;
                        }
                        // Check gas energy
                        if (result["Predicted Gas Energy Total (Gigajoules per square meter)"] < 0) {
                            console.warn('Negative gas value detected, converting to 0:', 
                                result["Predicted Gas Energy Total (Gigajoules per square meter)"]);
                            result["Predicted Gas Energy Total (Gigajoules per square meter)"] = 0;
                        }
                    });
                }
                
                // Extract building metadata from the backend response
                // The backend now includes metadata in energy_aggregated_results and costing_results
                const energyData = predictions.energy_aggregated_results?.[0] || {};
                const costData = predictions.costing_results?.[0] || {};
                
                // Prefer energy data if available, fallback to cost data
                const sourceData = Object.keys(energyData).length > 0 ? energyData : costData;
                
                console.log('Source data for metadata:', sourceData);
                
                // Extract building metadata from the backend response
                // Extract city name from location string (e.g., "CAN_ON_Toronto.Pearson.Intl.AP.716240_CWEC.epw" -> "Toronto")
                const locationString = sourceData[':epw_file'] || sourceData['epw_file'] || 'Unknown';
                let cityName = 'Unknown';
                if (locationString !== 'Unknown') {
                    // Remove CAN_ prefix and file extension
                    const cleaned = locationString.replace(/^CAN_/, '').replace(/\.epw$/, '').replace(/_CWEC.*$/, '');
                    // Split by underscore and get the part after province code (ON_, BC_, etc.)
                    const parts = cleaned.split('_');
                    if (parts.length > 1) {
                        // Get city name (after province code, before airport/station info)
                        // Split by both dots and spaces to get just the city name
                        cityName = parts[1].split(/[.\s]/)[0];
                    } else {
                        cityName = parts[0].split(/[.\s]/)[0];
                    }
                }
                
                predictions.building_metadata = {
                    floor_area: sourceData['bldg_conditioned_floor_area_m_sq'] || 0,
                    building_type: sourceData['bldg_standards_building_type'] || sourceData[':building_type'] || 'Unknown',
                    location: cityName
                };
                
                console.log('Building metadata:', predictions.building_metadata);
                
                return predictions;
            } else {
                const errorText = await downloadResponse.text();
                console.error('Download failed:', downloadResponse.status, errorText);
                throw new Error(`Download failed with status ${downloadResponse.status}`);
            }
        } catch (err) {
            console.error('Download error:', err);
            throw new Error(`Failed to download results: ${err.message}`);
        }
    }
    
    throw new Error('Prediction succeeded but no output key found');
}

// Display results
function displayResults(results) {
    const resultsSection = document.getElementById('results');
    const resultsContent = document.getElementById('resultsContent');
    
    console.log('Displaying results:', results);
    
    // Check if this is a cost analysis
    if (results.analysisType === 'cost') {
        displayCostAnalysisResults(results);
        return;
    }
    
    // Check if this is an alternative configuration analysis
    if (results.analysisType === 'alternative') {
        displayAlternativeResults(results);
        return;
    }
    
    let htmlContent = `
        <div style="display: flex; justify-content: flex-end; margin-bottom: 15px;">
            <button onclick="downloadSinglePDFReport()" class="btn btn-primary" style="padding: 10px 20px; font-size: 14px;">
                📄 Download PDF Report
            </button>
        </div>
        <div class="result-grid">`;
    
    // Check if we have energy_aggregated_results and costing_results
    if (results.energy_aggregated_results && results.energy_aggregated_results.length > 0 &&
        results.costing_results && results.costing_results.length > 0) {
        
        const energyData = results.energy_aggregated_results[0];
        const costData = results.costing_results[0];
        
        console.log('Energy data:', energyData);
        console.log('Cost data:', costData);
        console.log('Cost keys:', Object.keys(costData).filter(k => k.includes('cost')));
        
        // Extract Total Energy (Electricity + Gas in GJ/m²)
        const electricityGJ = energyData["Predicted Electricity Energy Total (Gigajoules per square meter)"] || 0;
        const gasGJ = energyData["Predicted Gas Energy Total (Gigajoules per square meter)"] || 0;
        const totalEnergyGJ = electricityGJ + gasGJ;
        
        // Extract building metadata from the input Excel file
        const metadata = results.building_metadata || {};
        const floorArea = metadata.floor_area || 0;
        const buildingType = metadata.building_type || 'Unknown';
        const location = metadata.location || 'Unknown';
        
        // Extract and sum all cost components from costing_results (CAD/m²)
        const envelopeCost = costData["Predicted cost_equipment_envelope_total_cost_per_m_sq"] || 0;
        const hvacCost = costData["Predicted cost_equipment_heating_and_cooling_total_cost_per_m_sq"] || 0;
        const lightingCost = costData["Predicted cost_equipment_lighting_total_cost_per_m_sq"] || 0;
        const ventilationCost = costData["Predicted cost_equipment_ventilation_total_cost_per_m_sq"] || 0;
        const shwCost = costData["Predicted cost_equipment_shw_total_cost_per_m_sq"] || 0;
        
        console.log('Extracted costs:', { envelopeCost, hvacCost, lightingCost, ventilationCost, shwCost });
        
        const totalCost = envelopeCost + hvacCost + lightingCost + ventilationCost + shwCost;
        
        htmlContent += `
            <div class="result-card highlight">
                <h4>🔋 Total Energy Use Intensity</h4>
                <div class="value">${totalEnergyGJ.toFixed(7)}</div>
                <div class="unit">GJ/m²</div>
                <p class="subtext">Electricity: ${electricityGJ.toFixed(7)} GJ/m²</p>
                <p class="subtext">Natural Gas: ${gasGJ.toFixed(7)} GJ/m²</p>
            </div>
            <div class="result-card highlight">
                <h4>💰 Total Equipment Cost</h4>
                <div class="value">${totalCost.toFixed(2)}</div>
                <div class="unit">CAD/m²</div>
                <p class="subtext">Envelope: $${envelopeCost.toFixed(2)}</p>
                <p class="subtext">HVAC: $${hvacCost.toFixed(2)}</p>
                <p class="subtext">Lighting: $${lightingCost.toFixed(2)}</p>
                <p class="subtext">Ventilation: $${ventilationCost.toFixed(2)}</p>
                <p class="subtext">Hot Water: $${shwCost.toFixed(2)}</p>
            </div>
            <div class="result-card">
                <h4>🏢 Building Information</h4>
                <div class="value">${floorArea.toFixed(0)}</div>
                <div class="unit">m²</div>
                <p class="subtext">Type: ${buildingType}</p>
                <p class="subtext">Location: ${location}</p>
            </div>
        `;
    }
    // If results only contain status/output_key, show that
    else if (results.status === 'success' && !results.energy_aggregated_results) {
        htmlContent += `
            <div class="result-card" style="grid-column: 1 / -1;">
                <h4>✅ Prediction Complete</h4>
                <p>Output saved to: ${results.output_key || 'S3'}</p>
                <p class="subtext">Results are being processed...</p>
            </div>
        `;
    } else {
        // Display helpful message
        htmlContent += `
            <div class="result-card" style="grid-column: 1 / -1;">
                <h4>⚠️ Unexpected Data Structure</h4>
                <p>Missing energy_aggregated_results or costing_results</p>
                <p class="subtext">Check browser console for details</p>
                <details>
                    <summary>Show raw data</summary>
                    <pre style="max-height: 400px; overflow-y: auto; text-align: left;">${JSON.stringify(results, null, 2)}</pre>
                </details>
            </div>
        `;
    }
    
    htmlContent += '</div></div>';
    
    resultsContent.innerHTML = htmlContent;
    resultsSection.style.display = 'block';
    
    // Store data for single prediction PDF generation
    if (results.energy_aggregated_results && results.costing_results) {
        storeSinglePredictionForPDF(results);
    }
    
    // Smooth scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Display cost analysis results with ROI calculations
function displayCostAnalysisResults(results) {
    const resultsSection = document.getElementById('results');
    const resultsContent = document.getElementById('resultsContent');
    
    console.log('Displaying cost analysis results');
    
    const { economics, energySavings, parameter, baselineValue, improvedValue, baselineResults, improvedResults } = results;
    
    // Get parameter display name
    const parameterNames = {
        'ecm_system_name': 'Dominant HVAC System',
        'ext_wall_cond': 'External Wall Thermal Conductance',
        'ext_roof_cond': 'External Roof Thermal Conductance',
        'fixed_window_cond': 'Window Thermal Conductance',
        'fixed_wind_solar_trans': 'Window Solar Heat Gain Coefficient',
        'fdwr_set': 'Window-to-Wall Ratio',
        'srr_set': 'Skylight-to-Roof Ratio'
    };
    
    const parameterDisplayName = parameterNames[parameter] || parameter;
    const baselineDisplay = formatParamValue(parameter, baselineValue);
    const improvedDisplay = formatParamValue(parameter, improvedValue);
    
    // Determine if this is a good investment
    const isFeasible = economics.totalAnnualSavings > 0 && economics.retrofitCost > 0;
    const hasPayback = isFeasible && economics.simplePaybackYears <= economics.analysisYears;
    const isGoodInvestment = hasPayback && economics.roi > 0;
    
    // Determine display values for payback and ROI
    let paybackDisplay, paybackUnit, paybackSubtext;
    if (!isFeasible || economics.totalAnnualSavings <= 0) {
        paybackDisplay = 'No Payback';
        paybackUnit = '';
        paybackSubtext = 'Retrofit increases costs';
    } else if (economics.simplePaybackYears > economics.analysisYears * 2) {
        paybackDisplay = 'Not Feasible';
        paybackUnit = '';
        paybackSubtext = `>${economics.analysisYears * 2} years`;
    } else {
        paybackDisplay = economics.simplePaybackYears.toFixed(1);
        paybackUnit = 'years';
        paybackSubtext = 'Time to recover investment';
    }
    
    let roiDisplay, roiUnit;
    if (!isFeasible || economics.roi < 0) {
        roiDisplay = 'Not Feasible';
        roiUnit = '';
    } else {
        roiDisplay = economics.roi.toFixed(1) + '%';
        roiUnit = `over ${economics.analysisYears} years`;
    }
    
    const statusEmoji = isGoodInvestment ? '✅' : '⚠️';
    const statusText = isGoodInvestment ? 'Financially Viable' : 'Not Recommended';
    
    let htmlContent = `
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 10px; margin-bottom: 25px;">
            <h3 style="margin: 0 0 10px 0;">💰 Cost-Benefit Analysis: ${parameterDisplayName}</h3>
            <p style="margin: 0; opacity: 0.9;">Comparing baseline vs improved configuration</p>
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding: 15px; background-color: #f8f9ff; border-radius: 8px; border-left: 4px solid ${isGoodInvestment ? '#48bb78' : '#f6ad55'};">
            <div>
                <h4 style="margin: 0 0 5px 0;">${statusEmoji} Investment Status: ${statusText}</h4>
                <p style="margin: 0; font-size: 14px; color: #666;">Based on ${economics.analysisYears}-year analysis period</p>
            </div>
            <button onclick="downloadCostAnalysisPDFReport()" class="btn btn-primary" style="padding: 10px 20px;">
                📄 Download PDF Report
            </button>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 30px;">
            <div class="result-card" style="background: linear-gradient(135deg, #667eea20 0%, #764ba220 100%); border: 2px solid ${isFeasible ? '#667eea' : '#f56565'};">
                <h4>💵 Simple Payback Period</h4>
                <div class="value" style="font-size: ${typeof paybackDisplay === 'string' && paybackDisplay.includes('Feasible') ? '1.8em' : '2.5em'}; color: ${isFeasible ? '#667eea' : '#f56565'};">${paybackDisplay}</div>
                <div class="unit">${paybackUnit}</div>
                <p class="subtext">${paybackSubtext}</p>
            </div>
            
            <div class="result-card" style="background: linear-gradient(135deg, #48bb7820 0%, #38a16920 100%); border: 2px solid ${economics.roi >= 0 ? '#48bb78' : '#f56565'};">
                <h4>📈 Return on Investment (ROI)</h4>
                <div class="value" style="font-size: ${typeof roiDisplay === 'string' && roiDisplay.includes('Feasible') ? '1.8em' : '2.5em'}; color: ${economics.roi >= 0 ? '#48bb78' : '#f56565'};">${roiDisplay}</div>
                <div class="unit">${roiUnit}</div>
                <p class="subtext">Total return on investment</p>
            </div>
            
            <div class="result-card" style="background: linear-gradient(135deg, #f6ad5520 0%, #ec845220 100%); border: 2px solid #f6ad55;">
                <h4>💰 Annual Cost Savings</h4>
                <div class="value" style="font-size: 2.5em; color: #f6ad55;">$${economics.totalAnnualSavings.toFixed(0)}</div>
                <div class="unit">per year</div>
                <p class="subtext">Electricity: $${economics.annualElectricitySavings.toFixed(0)}<br>Gas: $${economics.annualGasSavings.toFixed(0)}</p>
            </div>
        </div>
        
        <h3 style="margin-top: 30px; color: #2a5298;">💸 Financial Summary</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; margin-bottom: 30px;">
            <div class="result-card">
                <h4>🔨 Retrofit Investment</h4>
                <div class="value">$${economics.retrofitCost.toLocaleString()}</div>
                <div class="unit">total cost</div>
                <p class="subtext">$${economics.retrofitCostPerM2.toFixed(2)}/m²</p>
            </div>
            
            <div class="result-card">
                <h4>💵 Total Savings (${economics.analysisYears}yr)</h4>
                <div class="value">$${economics.totalSavingsOverPeriod.toLocaleString()}</div>
                <div class="unit">cumulative</div>
            </div>
            
            <div class="result-card">
                <h4>📊 Net Benefit</h4>
                <div class="value" style="color: ${economics.netSavings >= 0 ? '#48bb78' : '#f56565'};">$${economics.netSavings.toLocaleString()}</div>
                <div class="unit">after investment</div>
            </div>
        </div>
        
        <div style="background-color: #f0f7ff; padding: 15px; border-radius: 8px; margin-bottom: 30px; border-left: 4px solid #667eea;">
            <h4 style="margin-top: 0; color: #2a5298;">💡 Cost Calculation Details</h4>
            <p style="margin: 5px 0; font-size: 14px;">
                <strong>Baseline Total Equipment Cost:</strong> $${economics.baselineTotalCost.toLocaleString()} 
                (${baselineResults.total_cost_per_m_sq.toFixed(2)}/m²)
            </p>
            <p style="margin: 5px 0; font-size: 14px;">
                <strong>Improved Total Equipment Cost:</strong> $${economics.improvedTotalCost.toLocaleString()} 
                (${improvedResults.total_cost_per_m_sq.toFixed(2)}/m²)
            </p>
            <p style="margin: 5px 0; font-size: 14px;">
                <strong>Retrofit Cost (Difference):</strong> $${economics.retrofitCost.toLocaleString()} 
                (${economics.retrofitCostPerM2.toFixed(2)}/m² × ${economics.effectiveArea.toFixed(0)} m²${economics.areaNote})
            </p>
            <p style="margin: 10px 0 0 0; font-size: 13px; color: #666;">
                Note: ${economics.areaNote ? 'Envelope component costs are per m² of component area, not floor area. Areas are estimated based on typical building geometry.' : 'Retrofit cost is calculated from the equipment cost predictions provided by the surrogate model.'}
            </p>
        </div>
        
        <h3 style="margin-top: 30px; color: #2a5298;">⚡ Energy Performance Comparison</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 30px;">
            <div class="result-card" style="text-align: center;">
                <h4>📉 Baseline</h4>
                <div style="font-size: 1.1em; color: #666; margin: 10px 0;">
                    <strong>${parameterDisplayName}:</strong> ${baselineDisplay}
                </div>
                <div class="value" style="font-size: 1.5em;">${baselineResults.total_energy_eui_electricity_kwh_per_m_sq.toFixed(2)}</div>
                <div class="unit">kWh/m² (Electricity)</div>
                <div class="value" style="font-size: 1.5em; margin-top: 10px;">${baselineResults.total_energy_eui_natural_gas_gj_per_m_sq.toFixed(4)}</div>
                <div class="unit">GJ/m² (Gas)</div>
            </div>
            
            <div class="result-card" style="text-align: center; background: linear-gradient(135deg, #48bb7820 0%, #38a16920 100%);">
                <h4>✨ After Retrofit</h4>
                <div style="font-size: 1.1em; color: #666; margin: 10px 0;">
                    <strong>${parameterDisplayName}:</strong> ${improvedDisplay}
                </div>
                <div class="value" style="font-size: 1.5em; color: #48bb78;">${improvedResults.total_energy_eui_electricity_kwh_per_m_sq.toFixed(2)}</div>
                <div class="unit">kWh/m² (Electricity)</div>
                <div class="value" style="font-size: 1.5em; margin-top: 10px; color: #48bb78;">${improvedResults.total_energy_eui_natural_gas_gj_per_m_sq.toFixed(4)}</div>
                <div class="unit">GJ/m² (Gas)</div>
            </div>
            
            <div class="result-card" style="text-align: center; background: linear-gradient(135deg, #667eea20 0%, #764ba220 100%);">
                <h4>📊 Savings</h4>
                <div style="font-size: 1.1em; color: #666; margin: 10px 0;">
                    <strong>Reduction</strong>
                </div>
                <div class="value" style="font-size: 1.5em; color: #667eea;">${energySavings.electricitySavingsPercent.toFixed(1)}%</div>
                <div class="unit">${energySavings.electricitySavings.toFixed(2)} kWh/m²</div>
                <div class="value" style="font-size: 1.5em; margin-top: 10px; color: #667eea;">${energySavings.gasSavingsPercent.toFixed(1)}%</div>
                <div class="unit">${energySavings.gasSavings.toFixed(4)} GJ/m²</div>
            </div>
        </div>
        
        <h3 style="margin-top: 30px; color: #2a5298;">📋 Economic Assumptions</h3>
        <div style="background-color: #f8f9ff; padding: 20px; border-radius: 8px; border: 1px solid #667eea;">
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px;">
                <div>
                    <strong>⚡ Electricity Rate:</strong><br>
                    $${economics.electricityRate.toFixed(3)}/kWh
                </div>
                <div>
                    <strong>🔥 Natural Gas Rate:</strong><br>
                    $${economics.gasRate.toFixed(3)}/m³
                </div>
                <div>
                    <strong>🏢 Building Area:</strong><br>
                    ${economics.buildingArea.toFixed(0)} m²
                </div>
            </div>
        </div>
        
        <div style="margin-top: 20px; padding: 15px; background-color: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107;">
            <strong>💡 Note:</strong> This is a simplified economic analysis. Actual results may vary based on building operation, maintenance costs, utility rate changes, and other factors. Consider consulting with an energy professional for detailed analysis.
        </div>
    `;
    
    resultsContent.innerHTML = htmlContent;
    resultsSection.style.display = 'block';
    
    // Store results globally for PDF generation
    window.currentCostAnalysisResults = results;
}

// Display alternative configuration results
function displayAlternativeResults(results) {
    const resultsSection = document.getElementById('results');
    const resultsContent = document.getElementById('resultsContent');

    console.log('Displaying alternative configuration results');

    if (!results.energy_aggregated_results || !results.costing_results ||
        results.energy_aggregated_results.length === 0 || results.costing_results.length === 0) {
        resultsContent.innerHTML = `
            <div class="result-card" style="grid-column: 1 / -1;">
                <h4>⚠️ Incomplete Results</h4>
                <p>Expected multiple configurations but received ${results.energy_aggregated_results?.length || 0}</p>
            </div>
        `;
        resultsSection.style.display = 'block';
        return;
    }

    const numConfigs = results.energy_aggregated_results.length;
    console.log(`Processing ${numConfigs} configurations`);

    // Determine which parameters were varied (array of param keys)
    const variableParameters = Array.isArray(results.variableParameters) && results.variableParameters.length
        ? results.variableParameters
        : (results.variableParameter ? [results.variableParameter] : []);

    const META = window.ALTERNATIVE_PARAM_METADATA || {};
    const paramLabels = variableParameters.map(p => (META[p] && META[p].label) || p);

    // Extract data for all configurations
    const configs = [];
    for (let i = 0; i < numConfigs; i++) {
        const energyData = results.energy_aggregated_results[i];
        const costData = results.costing_results[i];

        const electricityGJ = energyData["Predicted Electricity Energy Total (Gigajoules per square meter)"] || 0;
        const gasGJ = energyData["Predicted Gas Energy Total (Gigajoules per square meter)"] || 0;
        const totalEnergyGJ = electricityGJ + gasGJ;

        const envelopeCost = costData["Predicted cost_equipment_envelope_total_cost_per_m_sq"] || 0;
        const hvacCost = costData["Predicted cost_equipment_heating_and_cooling_total_cost_per_m_sq"] || 0;
        const lightingCost = costData["Predicted cost_equipment_lighting_total_cost_per_m_sq"] || 0;
        const ventilationCost = costData["Predicted cost_equipment_ventilation_total_cost_per_m_sq"] || 0;
        const shwCost = costData["Predicted cost_equipment_shw_total_cost_per_m_sq"] || 0;
        const totalCost = envelopeCost + hvacCost + lightingCost + ventilationCost + shwCost;

        // Collect the values of every varied parameter for this config
        const paramValues = {};
        variableParameters.forEach(p => {
            const key = ':' + p;
            paramValues[p] = (energyData[key] !== undefined)
                ? energyData[key]
                : (costData[key] !== undefined ? costData[key] : '—');
        });

        // Legacy single-value field for chart labels / back-compat
        const paramValue = variableParameters.length
            ? variableParameters.map(p => formatParamValue(p, paramValues[p])).join(' / ')
            : (i + 1);

        configs.push({
            index: i + 1,
            paramValue,
            paramValues,
            totalEnergy: totalEnergyGJ,
            electricity: electricityGJ,
            gas: gasGJ,
            totalCost: totalCost,
            envelopeCost: envelopeCost,
            hvacCost: hvacCost,
            lightingCost: lightingCost,
            ventilationCost: ventilationCost,
            shwCost: shwCost
        });
    }

    console.log('Configurations:', configs);

    const analysisTitle = variableParameters.length > 1
        ? `Alternative Configuration Analysis: ${paramLabels.join(' × ')}`
        : `Alternative Configuration Analysis: ${paramLabels[0] || ''}`;

    // Build one <th> per varied parameter, plus Energy and Cost columns
    const paramHeaders = paramLabels.map(l =>
        `<th style="padding: 15px; text-align: left;">${l}</th>`
    ).join('');
    const detailsColspan = 2 + paramLabels.length; // Config + params + energy + cost
    const totalColumns = detailsColspan + 1; // for the details <td colspan>

    // Helper — render one config's summary + hidden details row
    function renderRow(config, idx) {
        const rowBg = idx % 2 === 0 ? '#f8f9ff' : 'white';
        const paramCells = variableParameters.map(p => {
            const display = formatParamValue(p, config.paramValues[p]);
            return `<td style="padding: 12px;">${display}</td>`;
        }).join('');
        return `
            <tr data-config-index="${config.index}" style="background: ${rowBg}; border-bottom: 1px solid #e1e8ed; cursor: pointer; transition: background 0.2s;"
                onmouseover="this.style.background='#e6f2ff'"
                onmouseout="this.style.background='${rowBg}'"
                onclick="toggleConfigDetails(${config.index})">
                <td style="padding: 12px; font-weight: bold;">Config ${config.index} <span style="color: #667eea; font-size: 12px;">▼</span></td>
                ${paramCells}
                <td style="padding: 12px; text-align: right; font-family: monospace;">${config.totalEnergy.toFixed(6)}</td>
                <td style="padding: 12px; text-align: right;">$${config.totalCost.toFixed(2)}</td>
            </tr>
            <tr id="details-${config.index}" style="display: none; background: #f0f4ff;">
                <td colspan="${totalColumns}" style="padding: 20px;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div>
                            <h5 style="margin: 0 0 10px 0; color: #2d3748;">⚡ Energy Breakdown</h5>
                            <p style="margin: 5px 0; font-size: 14px;">Electricity: <strong>${config.electricity.toFixed(6)} GJ/m²</strong></p>
                            <p style="margin: 5px 0; font-size: 14px;">Natural Gas: <strong>${config.gas.toFixed(6)} GJ/m²</strong></p>
                            <p style="margin: 10px 0 0 0; font-size: 14px; color: #667eea;">Total: <strong>${config.totalEnergy.toFixed(6)} GJ/m²</strong></p>
                        </div>
                        <div>
                            <h5 style="margin: 0 0 10px 0; color: #2d3748;">💰 Cost Breakdown</h5>
                            <p style="margin: 5px 0; font-size: 14px;">Envelope: <strong>$${config.envelopeCost.toFixed(2)}/m²</strong></p>
                            <p style="margin: 5px 0; font-size: 14px;">HVAC: <strong>$${config.hvacCost.toFixed(2)}/m²</strong></p>
                            <p style="margin: 5px 0; font-size: 14px;">Lighting: <strong>$${config.lightingCost.toFixed(2)}/m²</strong></p>
                            <p style="margin: 5px 0; font-size: 14px;">Ventilation: <strong>$${config.ventilationCost.toFixed(2)}/m²</strong></p>
                            <p style="margin: 5px 0; font-size: 14px;">Hot Water: <strong>$${config.shwCost.toFixed(2)}/m²</strong></p>
                            <p style="margin: 10px 0 0 0; font-size: 14px; color: #48bb78;">Total: <strong>$${config.totalCost.toFixed(2)}/m²</strong></p>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }

    // Split rows: show first 10 + last 10 with a collapsible middle when > 20
    const HEAD_TAIL = 10;
    const totalRows = configs.length;
    const useTrimmed = totalRows > (HEAD_TAIL * 2);
    const headRows = useTrimmed ? configs.slice(0, HEAD_TAIL) : configs;
    const tailRows = useTrimmed ? configs.slice(-HEAD_TAIL) : [];
    const middleRows = useTrimmed ? configs.slice(HEAD_TAIL, totalRows - HEAD_TAIL) : [];

    let htmlContent = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;">
            <h3 style="margin: 0;">${analysisTitle}</h3>
            <button onclick="downloadPDFReport()" class="btn btn-primary" style="padding: 10px 20px; font-size: 14px;">
                📄 Download PDF Report
            </button>
        </div>

        <!-- Configuration Comparison Table -->
        <div style="overflow-x: auto; margin-bottom: 30px;">
            <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <thead>
                    <tr style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                        <th style="padding: 15px; text-align: left;">Configuration</th>
                        ${paramHeaders}
                        <th style="padding: 15px; text-align: right;">Total Energy (GJ/m²)</th>
                        <th style="padding: 15px; text-align: right;">Total Cost (CAD/m²)</th>
                    </tr>
                </thead>
                <tbody>
                    ${headRows.map((c, i) => renderRow(c, i)).join('')}
                </tbody>
    `;

    if (useTrimmed) {
        htmlContent += `
                <tbody>
                    <tr style="background: #eef2ff;">
                        <td colspan="${totalColumns}" style="padding: 12px; text-align: center;">
                            <button type="button" id="toggle-hidden-configs"
                                onclick="toggleHiddenConfigs()"
                                style="background: transparent; border: 1px dashed #667eea; color: #4c51bf; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px;">
                                ▼ Show ${middleRows.length} hidden configurations
                            </button>
                        </td>
                    </tr>
                </tbody>
                <tbody id="tbody-hidden-configs" style="display: none;">
                    ${middleRows.map((c, i) => renderRow(c, i + HEAD_TAIL)).join('')}
                </tbody>
                <tbody>
                    ${tailRows.map((c, i) => renderRow(c, i + HEAD_TAIL + middleRows.length)).join('')}
                </tbody>
        `;
    }

    htmlContent += `
            </table>
        </div>

        <!-- Scatter plot: Cost (x) vs Energy (y) -->
        <div class="chart-container" style="background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); margin-bottom: 20px;">
            <h4 style="margin: 0 0 10px 0; color: #2d3748; text-align: center; font-size: 18px; font-weight: 600;">
                📈 Energy vs Cost — one dot per configuration
            </h4>
            <p style="margin: 0 0 15px 0; text-align: center; color: #718096; font-size: 13px;">
                Hover a dot for details, click to jump to that configuration in the table above.
                Ideal designs sit toward the <strong>lower-left</strong> (low energy, low cost).
            </p>
            <div style="position: relative; width: 100%; height: 500px;">
                <canvas id="scatterChart" style="width: 100%; height: 100%; cursor: pointer;"></canvas>
                <div id="scatterTooltip" style="display: none; position: absolute; background: rgba(15, 23, 42, 0.95); color: white; padding: 10px 14px; border-radius: 8px; pointer-events: none; font-size: 13px; box-shadow: 0 6px 18px rgba(0,0,0,0.3); z-index: 1000; max-width: 320px; line-height: 1.5;"></div>
            </div>
        </div>
    `;

    resultsContent.innerHTML = htmlContent;
    resultsSection.style.display = 'block';

    // Smooth scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Store configs globally for PDF generation
    storeConfigsForPDF(configs, analysisTitle.replace(/^Alternative Configuration Analysis: /, ''), results, variableParameters, paramLabels);

    // Draw the scatter plot with hover + click behaviour
    drawScatterPlot(configs, variableParameters, paramLabels);
}

// Toggle configuration details
function toggleConfigDetails(configIndex) {
    const detailsRow = document.getElementById(`details-${configIndex}`);
    const allDetailsRows = document.querySelectorAll('[id^="details-"]');
    
    // Close all other detail rows
    allDetailsRows.forEach(row => {
        if (row.id !== `details-${configIndex}`) {
            row.style.display = 'none';
        }
    });
    
    // Toggle current row
    if (detailsRow.style.display === 'none') {
        detailsRow.style.display = 'table-row';
    } else {
        detailsRow.style.display = 'none';
    }
}

// Show/hide the middle "hidden" configurations tbody used when the results
// table is trimmed (first 10 + last 10) for readability.
function toggleHiddenConfigs() {
    const hidden = document.getElementById('tbody-hidden-configs');
    const btn = document.getElementById('toggle-hidden-configs');
    if (!hidden) return;
    if (hidden.style.display === 'none') {
        hidden.style.display = '';
        if (btn) btn.textContent = '▲ Hide middle configurations';
    } else {
        hidden.style.display = 'none';
        if (btn) {
            const count = hidden.querySelectorAll('tr[data-config-index]').length;
            btn.textContent = `▼ Show ${count} hidden configurations`;
        }
    }
}

// -----------------------------------------------------------------------------
// Scatter plot — Cost (x) vs Energy (y), one dot per configuration.
// Hover shows a tooltip with parameter values; click focuses the corresponding
// row in the comparison table above (expanding hidden rows if necessary).
// -----------------------------------------------------------------------------
let __scatterState = null;

function drawScatterPlot(configs, variableParameters = [], parameterLabels = []) {
    const canvas = document.getElementById('scatterChart');
    if (!canvas) return;

    const layout = _computeScatterLayout(canvas);
    __scatterState = {
        configs,
        variableParameters,
        parameterLabels,
        layout,
        selectedIndex: null,
        hoveredIndex: null
    };

    _renderScatter();

    // ---- Mouse interactions ----
    canvas.onmousemove = function (e) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const idx = _pickNearestPoint(mx, my);
        if (idx !== __scatterState.hoveredIndex) {
            __scatterState.hoveredIndex = idx;
            _renderScatter();
        }
        if (idx !== null) {
            _showScatterTooltip(idx, e.clientX - rect.left, e.clientY - rect.top);
        } else {
            _hideScatterTooltip();
        }
    };
    canvas.onmouseleave = function () {
        __scatterState.hoveredIndex = null;
        _hideScatterTooltip();
        _renderScatter();
    };
    canvas.onclick = function (e) {
        const rect = canvas.getBoundingClientRect();
        const idx = _pickNearestPoint(e.clientX - rect.left, e.clientY - rect.top);
        if (idx === null) return;
        __scatterState.selectedIndex = idx;
        _renderScatter();
        focusConfigInTable(__scatterState.configs[idx].index);
    };
}

function _computeScatterLayout(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    return {
        ctx,
        dpr,
        width: rect.width,
        height: rect.height,
        padding: { top: 30, right: 30, bottom: 60, left: 80 }
    };
}

function _scatterAxes(configs, layout) {
    const costs = configs.map(c => c.totalCost);
    const energies = configs.map(c => c.totalEnergy);
    const minCost = Math.min(...costs);
    const maxCost = Math.max(...costs);
    const minEnergy = Math.min(...energies);
    const maxEnergy = Math.max(...energies);
    // Pad ranges (5% each side, non-zero minimum)
    const costPad = Math.max((maxCost - minCost) * 0.08, maxCost * 0.02, 0.01);
    const energyPad = Math.max((maxEnergy - minEnergy) * 0.08, maxEnergy * 0.02, 0.001);

    return {
        xMin: minCost - costPad,
        xMax: maxCost + costPad,
        yMin: Math.max(0, minEnergy - energyPad),
        yMax: maxEnergy + energyPad,
        chartWidth: layout.width - layout.padding.left - layout.padding.right,
        chartHeight: layout.height - layout.padding.top - layout.padding.bottom
    };
}

function _pointToPixel(cost, energy, layout, axes) {
    const x = layout.padding.left +
        ((cost - axes.xMin) / (axes.xMax - axes.xMin)) * axes.chartWidth;
    const y = layout.padding.top +
        axes.chartHeight -
        ((energy - axes.yMin) / (axes.yMax - axes.yMin)) * axes.chartHeight;
    return { x, y };
}

function _pickNearestPoint(mx, my) {
    const st = __scatterState;
    if (!st) return null;
    const axes = _scatterAxes(st.configs, st.layout);
    const threshold = 14; // px
    let best = null;
    let bestDist = threshold * threshold;
    st.configs.forEach((c, i) => {
        const { x, y } = _pointToPixel(c.totalCost, c.totalEnergy, st.layout, axes);
        const dx = x - mx;
        const dy = y - my;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    });
    return best;
}

function _renderScatter() {
    const st = __scatterState;
    if (!st) return;
    const { ctx, width, height, padding } = st.layout;
    const axes = _scatterAxes(st.configs, st.layout);

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Chart background
    ctx.fillStyle = '#fafbff';
    ctx.fillRect(padding.left, padding.top, axes.chartWidth, axes.chartHeight);

    // Grid + axis ticks (5 divisions each)
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748b';
    ctx.font = '11px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const nTicks = 5;
    for (let i = 0; i <= nTicks; i++) {
        const y = padding.top + (axes.chartHeight / nTicks) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + axes.chartWidth, y);
        ctx.stroke();
        const yValue = axes.yMax - ((axes.yMax - axes.yMin) / nTicks) * i;
        ctx.fillText(yValue.toFixed(3), padding.left - 8, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= nTicks; i++) {
        const x = padding.left + (axes.chartWidth / nTicks) * i;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + axes.chartHeight);
        ctx.stroke();
        const xValue = axes.xMin + ((axes.xMax - axes.xMin) / nTicks) * i;
        ctx.fillText('$' + xValue.toFixed(2), x, padding.top + axes.chartHeight + 8);
    }

    // Axis lines
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + axes.chartHeight);
    ctx.lineTo(padding.left + axes.chartWidth, padding.top + axes.chartHeight);
    ctx.stroke();

    // Axis titles
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(
        'Total Equipment Cost (CAD / m²)',
        padding.left + axes.chartWidth / 2,
        height - 12
    );
    ctx.save();
    ctx.translate(18, padding.top + axes.chartHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Total Energy Use Intensity (GJ / m²)', 0, 0);
    ctx.restore();

    // Draw dots — hovered/selected drawn last so they sit on top
    const drawOrder = st.configs.map((_, i) => i)
        .sort((a, b) => {
            const rank = (i) =>
                (i === st.selectedIndex ? 2 : 0) + (i === st.hoveredIndex ? 1 : 0);
            return rank(a) - rank(b);
        });

    drawOrder.forEach(i => {
        const c = st.configs[i];
        const { x, y } = _pointToPixel(c.totalCost, c.totalEnergy, st.layout, axes);
        const isSelected = i === st.selectedIndex;
        const isHovered = i === st.hoveredIndex;
        const radius = isSelected ? 8 : (isHovered ? 7 : 5);

        // Halo for selected/hovered
        if (isSelected || isHovered) {
            ctx.fillStyle = isSelected
                ? 'rgba(239, 68, 68, 0.25)'
                : 'rgba(102, 126, 234, 0.25)';
            ctx.beginPath();
            ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
            ctx.fill();
        }

        // Dot
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? '#ef4444' : '#667eea';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'white';
        ctx.stroke();
    });
}

function _showScatterTooltip(idx, x, y) {
    const st = __scatterState;
    const c = st.configs[idx];
    const tooltip = document.getElementById('scatterTooltip');
    if (!tooltip || !c) return;

    let paramsHtml = '';
    if (st.variableParameters.length > 0 && c.paramValues) {
        paramsHtml = st.variableParameters
            .map((p, i) => {
                const label = st.parameterLabels[i] || p;
                const shown = formatParamValue(p, c.paramValues[p]);
                return `<div style="opacity:.85; font-size:12px;">${label}: <strong>${shown}</strong></div>`;
            })
            .join('');
    }

    tooltip.innerHTML = `
        <div style="font-weight:700; font-size:14px; margin-bottom:6px;">
            Configuration ${c.index}
        </div>
        ${paramsHtml}
        <div style="margin-top:6px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.15);">
            <div>Total Energy: <strong>${c.totalEnergy.toFixed(4)} GJ/m²</strong></div>
            <div>Total Cost: <strong>$${c.totalCost.toFixed(2)} / m²</strong></div>
        </div>
        <div style="margin-top:6px; font-size:11px; opacity:.7;">Click for full details</div>
    `;
    tooltip.style.display = 'block';

    // Position — keep the tooltip inside the chart container
    const parent = tooltip.parentElement;
    const parentRect = parent.getBoundingClientRect();
    let px = x + 15;
    let py = y - 10;
    // Show tooltip after measuring size
    requestAnimationFrame(() => {
        const tRect = tooltip.getBoundingClientRect();
        if (px + tRect.width > parentRect.width) px = x - tRect.width - 15;
        if (py + tRect.height > parentRect.height) py = parentRect.height - tRect.height - 5;
        if (py < 0) py = 5;
        tooltip.style.left = px + 'px';
        tooltip.style.top = py + 'px';
    });
}

function _hideScatterTooltip() {
    const tooltip = document.getElementById('scatterTooltip');
    if (tooltip) tooltip.style.display = 'none';
}

// Scroll the comparison table to a given config's row and expand its details.
// If the row is inside a collapsed "middle" section, expand that section first.
function focusConfigInTable(configIndex) {
    const hidden = document.getElementById('tbody-hidden-configs');
    const toggleBtn = document.getElementById('toggle-hidden-configs');
    const row = document.querySelector(`tr[data-config-index="${configIndex}"]`);
    if (!row) return;

    // If the target row is inside the hidden tbody, expand it first
    if (hidden && hidden.contains(row) && hidden.style.display === 'none') {
        hidden.style.display = '';
        if (toggleBtn) {
            toggleBtn.textContent = `▲ Hide middle configurations`;
        }
    }

    // Expand the details row for this config
    const detailsRow = document.getElementById(`details-${configIndex}`);
    if (detailsRow) {
        document.querySelectorAll('[id^="details-"]').forEach(r => {
            if (r.id !== `details-${configIndex}`) r.style.display = 'none';
        });
        detailsRow.style.display = 'table-row';
    }

    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Brief highlight flash
    const originalBg = row.style.background;
    row.style.background = '#fff3cd';
    setTimeout(() => { row.style.background = originalBg || ''; }, 900);
}

// Store configs globally for PDF generation
let globalConfigs = null;
let globalParameterDisplayName = null;
let globalVariableParameters = [];
let globalParameterLabels = [];
let globalResults = null;
let globalSinglePrediction = null;

// Render the scatter plot to a high-resolution offscreen canvas and return
// a PNG data URL suitable for embedding in the PDF report.
function getScatterPlotImage(configs, scale = 3) {
    const baseWidth = 800;
    const baseHeight = 500;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = baseWidth * scale;
    tempCanvas.height = baseHeight * scale;
    const ctx = tempCanvas.getContext('2d');
    ctx.scale(scale, scale);

    const layout = {
        ctx,
        dpr: 1,
        width: baseWidth,
        height: baseHeight,
        padding: { top: 30, right: 30, bottom: 60, left: 80 }
    };
    const axes = _scatterAxes(configs, layout);

    // Background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, baseWidth, baseHeight);
    ctx.fillStyle = '#fafbff';
    ctx.fillRect(layout.padding.left, layout.padding.top, axes.chartWidth, axes.chartHeight);

    // Grid + tick labels
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const nTicks = 5;
    for (let i = 0; i <= nTicks; i++) {
        const y = layout.padding.top + (axes.chartHeight / nTicks) * i;
        ctx.beginPath();
        ctx.moveTo(layout.padding.left, y);
        ctx.lineTo(layout.padding.left + axes.chartWidth, y);
        ctx.stroke();
        const yValue = axes.yMax - ((axes.yMax - axes.yMin) / nTicks) * i;
        ctx.fillText(yValue.toFixed(3), layout.padding.left - 8, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= nTicks; i++) {
        const x = layout.padding.left + (axes.chartWidth / nTicks) * i;
        ctx.beginPath();
        ctx.moveTo(x, layout.padding.top);
        ctx.lineTo(x, layout.padding.top + axes.chartHeight);
        ctx.stroke();
        const xValue = axes.xMin + ((axes.xMax - axes.xMin) / nTicks) * i;
        ctx.fillText('$' + xValue.toFixed(2), x, layout.padding.top + axes.chartHeight + 8);
    }

    // Axis lines
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(layout.padding.left, layout.padding.top);
    ctx.lineTo(layout.padding.left, layout.padding.top + axes.chartHeight);
    ctx.lineTo(layout.padding.left + axes.chartWidth, layout.padding.top + axes.chartHeight);
    ctx.stroke();

    // Axis titles
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 13px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(
        'Total Equipment Cost (CAD / m²)',
        layout.padding.left + axes.chartWidth / 2,
        baseHeight - 12
    );
    ctx.save();
    ctx.translate(18, layout.padding.top + axes.chartHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Total Energy Use Intensity (GJ / m²)', 0, 0);
    ctx.restore();

    // Dots
    configs.forEach(c => {
        const { x, y } = _pointToPixel(c.totalCost, c.totalEnergy, layout, axes);
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#667eea';
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'white';
        ctx.stroke();
    });

    return tempCanvas.toDataURL('image/png', 1.0);
}


// Update the displayAlternativeResults to store configs globally
function storeConfigsForPDF(configs, parameterDisplayName, results, variableParameters = [], parameterLabels = []) {
    globalConfigs = configs;
    globalParameterDisplayName = parameterDisplayName;
    globalVariableParameters = variableParameters;
    globalParameterLabels = parameterLabels;
    globalResults = results;
}

// Store single prediction data for PDF generation
function storeSinglePredictionForPDF(results) {
    const energyData = results.energy_aggregated_results[0];
    const costData = results.costing_results[0];
    
    globalSinglePrediction = {
        electricityGJ: energyData["Predicted Electricity Energy Total (Gigajoules per square meter)"] || 0,
        gasGJ: energyData["Predicted Gas Energy Total (Gigajoules per square meter)"] || 0,
        totalEnergyGJ: (energyData["Predicted Electricity Energy Total (Gigajoules per square meter)"] || 0) + (energyData["Predicted Gas Energy Total (Gigajoules per square meter)"] || 0),
        envelopeCost: costData["Predicted cost_equipment_envelope_total_cost_per_m_sq"] || 0,
        hvacCost: costData["Predicted cost_equipment_heating_and_cooling_total_cost_per_m_sq"] || 0,
        lightingCost: costData["Predicted cost_equipment_lighting_total_cost_per_m_sq"] || 0,
        ventilationCost: costData["Predicted cost_equipment_ventilation_total_cost_per_m_sq"] || 0,
        shwCost: costData["Predicted cost_equipment_shw_total_cost_per_m_sq"] || 0,
        metadata: results.building_metadata
    };
    globalSinglePrediction.totalCost = globalSinglePrediction.envelopeCost + globalSinglePrediction.hvacCost + 
                                       globalSinglePrediction.lightingCost + globalSinglePrediction.ventilationCost + 
                                       globalSinglePrediction.shwCost;
}

// Download PDF Report for Cost Analysis
async function downloadCostAnalysisPDFReport() {
    if (!window.currentCostAnalysisResults) {
        alert('No cost analysis data available to generate report');
        return;
    }
    
    const results = window.currentCostAnalysisResults;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPos = 20;
    
    // Add logo and letterhead
    doc.setFillColor(102, 126, 234);
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('CanBuildAI', pageWidth / 2, 20, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('Cost-Benefit Analysis Report', pageWidth / 2, 30, { align: 'center' });
    
    // Reset text color
    doc.setTextColor(0, 0, 0);
    yPos = 55;
    
    // Parameter info
    const parameterNames = {
        'ext_wall_cond': 'External Wall Thermal Conductance',
        'ext_roof_cond': 'External Roof Thermal Conductance',
        'fixed_window_cond': 'Window Thermal Conductance',
        'fixed_wind_solar_trans': 'Window Solar Heat Gain Coefficient',
        'fdwr_set': 'Window-to-Wall Ratio',
        'srr_set': 'Skylight-to-Roof Ratio'
    };
    
    const paramName = parameterNames[results.parameter] || results.parameter;
    
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`Parameter: ${paramName}`, 15, yPos);
    yPos += 10;
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(`Baseline Value: ${results.baselineValue}`, 15, yPos);
    yPos += 6;
    doc.text(`Improved Value: ${results.improvedValue}`, 15, yPos);
    yPos += 12;
    
    // Input Parameters Section (if available)
    if (globalInputConfig && Object.keys(globalInputConfig).length > 0) {
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Configuration Parameters', 15, yPos);
        yPos += 7;
        
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        
        // Parameter display names
        const parameterLabels = {
            'ecm_system_name': 'HVAC System',
            'primary_heating_fuel': 'Primary Heating Fuel',
            'boiler_eff': 'Boiler Efficiency',
            'furnace_eff': 'Furnace Efficiency',
            'shw_eff': 'Hot Water Efficiency',
            'dcv_type': 'Demand Control Ventilation',
            'erv_package': 'Energy Recovery Ventilator',
            'airloop_economizer_type': 'Economizer Type',
            'nv_type': 'Natural Ventilation',
            'ext_wall_cond': 'Wall Conductance (W/m²·K)',
            'ext_roof_cond': 'Roof Conductance (W/m²·K)',
            'fixed_window_cond': 'Window Conductance (W/m²·K)',
            'fixed_wind_solar_trans': 'Window SHGC',
            'fdwr_set': 'Window-to-Wall Ratio',
            'srr_set': 'Skylight-to-Roof Ratio',
            'building_type': 'Building Type',
            'rotation_degrees': 'Building Rotation (°)',
            'epw_file': 'Weather Location'
        };
        
        let col = 0;
        const colWidth = (pageWidth - 30) / 2;
        const startX = [15, 15 + colWidth];
        
        Object.keys(globalInputConfig).forEach((key, index) => {
            // Check if need new page
            if (yPos > 270) {
                doc.addPage();
                yPos = 20;
            }
            
            const label = parameterLabels[key] || key;
            let value = globalInputConfig[key];
            
            // Shorten long values
            if (typeof value === 'string' && value.length > 25) {
                value = value.substring(0, 22) + '...';
            }
            
            doc.text(`${label}:`, startX[col], yPos);
            doc.setFont('helvetica', 'bold');
            doc.text(String(value), startX[col] + 45, yPos);
            doc.setFont('helvetica', 'normal');
            
            col = (col + 1) % 2;
            if (col === 0) {
                yPos += 4.5;
            }
        });
        
        if (col !== 0) yPos += 4.5;
        yPos += 10;
    }
    
    // Key Metrics
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Financial Analysis', 15, yPos);
    yPos += 8;
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const econ = results.economics;
    doc.text(`Simple Payback Period: ${econ.simplePaybackYears.toFixed(1)} years`, 15, yPos);
    yPos += 6;
    doc.text(`Return on Investment: ${econ.roi.toFixed(1)}% over ${econ.analysisYears} years`, 15, yPos);
    yPos += 6;
    doc.text(`Annual Cost Savings: $${econ.totalAnnualSavings.toFixed(0)}`, 15, yPos);
    yPos += 6;
    doc.text(`Retrofit Cost: $${econ.retrofitCost.toLocaleString()}`, 15, yPos);
    yPos += 6;
    doc.text(`Net Benefit (${econ.analysisYears}yr): $${econ.netSavings.toLocaleString()}`, 15, yPos);
    yPos += 12;
    
    // Energy Savings
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Energy Savings', 15, yPos);
    yPos += 8;
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const energy = results.energySavings;
    doc.text(`Electricity Reduction: ${energy.electricitySavingsPercent.toFixed(1)}% (${energy.electricitySavings.toFixed(2)} kWh/m²)`, 15, yPos);
    yPos += 6;
    doc.text(`Natural Gas Reduction: ${energy.gasSavingsPercent.toFixed(1)}% (${energy.gasSavings.toFixed(4)} GJ/m²)`, 15, yPos);
    yPos += 12;
    
    // Footer
    doc.setFontSize(9);
    doc.setTextColor(128, 128, 128);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 15, pageHeight - 15);
    doc.text('CanBuildAI - Energy Surrogate Model', pageWidth / 2, pageHeight - 15, { align: 'center' });
    
    // Save
    doc.save('cost_analysis_report.pdf');
}

// Download PDF Report for Single Prediction
async function downloadSinglePDFReport() {
    if (!globalSinglePrediction) {
        alert('No data available to generate report');
        return;
    }
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPos = 20;
    
    // Add logo and letterhead
    doc.setFillColor(102, 126, 234);
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('CanBuildAI', pageWidth / 2, 20, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('Building Design Decision Maker', pageWidth / 2, 28, { align: 'center' });
    doc.text('Single Building Prediction Report', pageWidth / 2, 35, { align: 'center' });
    
    yPos = 50;
    
    // Report Title
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Building Performance Prediction Report', 15, yPos);
    yPos += 10;
    
    // Date
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${new Date().toLocaleString()}`, 15, yPos);
    yPos += 10;
    
    // Building Information Section
    if (globalSinglePrediction.metadata) {
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Building Information', 15, yPos);
        yPos += 7;
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const metadata = globalSinglePrediction.metadata;
        doc.text(`Floor Area: ${metadata.floor_area?.toFixed(0) || 'N/A'} m²`, 20, yPos);
        yPos += 5;
        doc.text(`Building Type: ${metadata.building_type || 'N/A'}`, 20, yPos);
        yPos += 5;
        doc.text(`Location: ${metadata.location || 'N/A'}`, 20, yPos);
        yPos += 15;
    }
    
    // Input Parameters Section (if available)
    if (globalInputConfig && Object.keys(globalInputConfig).length > 0) {
        // Check if we need to add a new page
        if (yPos > 220) {
            doc.addPage();
            yPos = 20;
        }
        
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Configuration Parameters', 15, yPos);
        yPos += 7;
        
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        
        // Parameter display names
        const parameterLabels = {
            'ecm_system_name': 'HVAC System',
            'primary_heating_fuel': 'Primary Heating Fuel',
            'boiler_eff': 'Boiler Efficiency',
            'furnace_eff': 'Furnace Efficiency',
            'shw_eff': 'Hot Water Efficiency',
            'dcv_type': 'Demand Control Ventilation',
            'erv_package': 'Energy Recovery Ventilator',
            'airloop_economizer_type': 'Economizer Type',
            'nv_type': 'Natural Ventilation',
            'ext_wall_cond': 'Wall Conductance (W/m²·K)',
            'ext_roof_cond': 'Roof Conductance (W/m²·K)',
            'fixed_window_cond': 'Window Conductance (W/m²·K)',
            'fixed_wind_solar_trans': 'Window SHGC',
            'fdwr_set': 'Window-to-Wall Ratio',
            'srr_set': 'Skylight-to-Roof Ratio',
            'building_type': 'Building Type',
            'rotation_degrees': 'Building Rotation (°)',
            'epw_file': 'Weather Location'
        };
        
        let col = 0;
        const colWidth = (pageWidth - 30) / 2;
        const startX = [20, 20 + colWidth + 10];
        
        Object.keys(globalInputConfig).forEach((key, index) => {
            const label = parameterLabels[key] || key;
            let value = globalInputConfig[key];
            
            // Shorten long values
            if (typeof value === 'string' && value.length > 30) {
                value = value.substring(0, 27) + '...';
            }
            
            doc.text(`${label}:`, startX[col], yPos);
            doc.setFont('helvetica', 'bold');
            doc.text(String(value), startX[col] + 50, yPos);
            doc.setFont('helvetica', 'normal');
            
            col = (col + 1) % 2;
            if (col === 0) {
                yPos += 5;
            }
        });
        
        if (col !== 0) yPos += 5;  // Add line if last entry was in right column
        yPos += 10;
    }
    
    // Energy Performance Section
    doc.setFillColor(102, 126, 234);
    doc.setTextColor(255, 255, 255);
    doc.rect(15, yPos, pageWidth - 30, 10, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Energy Performance', 20, yPos + 6.5);
    yPos += 15;
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total Energy Use Intensity: ${globalSinglePrediction.totalEnergyGJ.toFixed(7)} GJ/m²`, 20, yPos);
    yPos += 10;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Energy Breakdown:', 20, yPos);
    yPos += 6;
    doc.text(`  • Electricity: ${globalSinglePrediction.electricityGJ.toFixed(7)} GJ/m²`, 25, yPos);
    yPos += 5;
    doc.text(`  • Natural Gas: ${globalSinglePrediction.gasGJ.toFixed(7)} GJ/m²`, 25, yPos);
    yPos += 15;
    
    // Cost Analysis Section
    doc.setFillColor(72, 187, 120);
    doc.setTextColor(255, 255, 255);
    doc.rect(15, yPos, pageWidth - 30, 10, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Equipment Cost Analysis', 20, yPos + 6.5);
    yPos += 15;
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total Equipment Cost: $${globalSinglePrediction.totalCost.toFixed(2)}/m²`, 20, yPos);
    yPos += 10;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Cost Breakdown by Component:', 20, yPos);
    yPos += 6;
    doc.text(`  • Envelope: $${globalSinglePrediction.envelopeCost.toFixed(2)}/m²`, 25, yPos);
    yPos += 5;
    doc.text(`  • HVAC (Heating & Cooling): $${globalSinglePrediction.hvacCost.toFixed(2)}/m²`, 25, yPos);
    yPos += 5;
    doc.text(`  • Lighting: $${globalSinglePrediction.lightingCost.toFixed(2)}/m²`, 25, yPos);
    yPos += 5;
    doc.text(`  • Ventilation: $${globalSinglePrediction.ventilationCost.toFixed(2)}/m²`, 25, yPos);
    yPos += 5;
    doc.text(`  • Service Hot Water: $${globalSinglePrediction.shwCost.toFixed(2)}/m²`, 25, yPos);
    yPos += 15;
    
    // Summary Section
    doc.setFillColor(102, 126, 234);
    doc.setTextColor(255, 255, 255);
    doc.rect(15, yPos, pageWidth - 30, 10, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Performance Summary', 20, yPos + 6.5);
    yPos += 15;
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('This report provides a comprehensive analysis of the predicted building performance', 20, yPos);
    yPos += 5;
    doc.text('based on the selected configuration parameters. The energy use intensity reflects', 20, yPos);
    yPos += 5;
    doc.text('the total annual energy consumption per square meter, while equipment costs', 20, yPos);
    yPos += 5;
    doc.text('represent the capital investment required for each building system.', 20, yPos);
    
    // Add footer
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(128, 128, 128);
    doc.text('Page 1 of 1', pageWidth / 2, pageHeight - 10, { align: 'center' });
    doc.text('CanBuildAI - Building Design Decision Maker', pageWidth / 2, pageHeight - 6, { align: 'center' });
    
    // Save the PDF
    const fileName = `CanBuildAI_Single_Prediction_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
}

// Download PDF Report
async function downloadPDFReport() {
    if (!globalConfigs || !globalResults) {
        alert('No data available to generate report');
        return;
    }
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPos = 20;
    
    // Add logo and letterhead
    doc.setFillColor(102, 126, 234);
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('CanBuildAI', pageWidth / 2, 20, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('Building Design Decision Maker', pageWidth / 2, 28, { align: 'center' });
    doc.text('Alternative Configuration Analysis Report', pageWidth / 2, 35, { align: 'center' });
    
    yPos = 50;
    
    // Report Title
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Configuration Analysis Report', 15, yPos);
    yPos += 10;
    
    // Date
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${new Date().toLocaleString()}`, 15, yPos);
    yPos += 5;
    const paramsLine = (globalParameterLabels && globalParameterLabels.length)
        ? globalParameterLabels.join(' × ')
        : (globalParameterDisplayName || 'N/A');
    doc.text(`Parameters Analyzed: ${paramsLine}`, 15, yPos);
    yPos += 10;
    
    // Building Information Section
    if (globalResults.building_metadata) {
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Building Information', 15, yPos);
        yPos += 7;
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const metadata = globalResults.building_metadata;
        doc.text(`Floor Area: ${metadata.floor_area?.toFixed(0) || 'N/A'} m²`, 20, yPos);
        yPos += 5;
        doc.text(`Building Type: ${metadata.building_type || 'N/A'}`, 20, yPos);
        yPos += 5;
        doc.text(`Location: ${metadata.location || 'N/A'}`, 20, yPos);
        yPos += 10;
    }
    
    // Summary Statistics
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Configuration Summary', 15, yPos);
    yPos += 7;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const minEnergy = Math.min(...globalConfigs.map(c => c.totalEnergy));
    const maxEnergy = Math.max(...globalConfigs.map(c => c.totalEnergy));
    const avgEnergy = globalConfigs.reduce((sum, c) => sum + c.totalEnergy, 0) / globalConfigs.length;
    const minCost = Math.min(...globalConfigs.map(c => c.totalCost));
    const maxCost = Math.max(...globalConfigs.map(c => c.totalCost));
    const avgCost = globalConfigs.reduce((sum, c) => sum + c.totalCost, 0) / globalConfigs.length;
    
    doc.text(`Total Configurations Analyzed: ${globalConfigs.length}`, 20, yPos);
    yPos += 5;
    doc.text(`Energy Range: ${minEnergy.toFixed(4)} - ${maxEnergy.toFixed(4)} GJ/m²`, 20, yPos);
    yPos += 5;
    doc.text(`Average Energy: ${avgEnergy.toFixed(4)} GJ/m²`, 20, yPos);
    yPos += 5;
    doc.text(`Cost Range: $${minCost.toFixed(2)} - $${maxCost.toFixed(2)}/m²`, 20, yPos);
    yPos += 5;
    doc.text(`Average Cost: $${avgCost.toFixed(2)}/m²`, 20, yPos);
    yPos += 10;
    
    // Comparison Table
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Configuration Comparison', 15, yPos);
    yPos += 7;

    // Layout: dynamic columns — Config | <one column per varied parameter> | Energy | Cost
    const paramKeys = globalVariableParameters && globalVariableParameters.length
        ? globalVariableParameters
        : [];
    const paramLabelsPdf = globalParameterLabels && globalParameterLabels.length
        ? globalParameterLabels
        : paramKeys;

    const contentLeft = 15;
    const contentRight = pageWidth - 15;
    const contentWidth = contentRight - contentLeft;
    const fixedCols = { config: 15, energy: 32, cost: 28 };
    const paramColsWidth = Math.max(20, contentWidth - fixedCols.config - fixedCols.energy - fixedCols.cost);
    const paramColWidth = paramKeys.length > 0 ? paramColsWidth / paramKeys.length : paramColsWidth;

    // Column x positions (left edges)
    const colX = { config: contentLeft };
    paramKeys.forEach((k, i) => {
        colX['p' + i] = contentLeft + fixedCols.config + i * paramColWidth;
    });
    colX.energy = contentLeft + fixedCols.config + paramKeys.length * paramColWidth;
    colX.cost = colX.energy + fixedCols.energy;

    // Header row
    doc.setFillColor(102, 126, 234);
    doc.setTextColor(255, 255, 255);
    doc.rect(contentLeft, yPos, contentWidth, 8, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Config', colX.config + 2, yPos + 5.5);
    paramLabelsPdf.forEach((lbl, i) => {
        const truncated = doc.splitTextToSize(lbl, paramColWidth - 3)[0] || lbl;
        doc.text(truncated, colX['p' + i] + 2, yPos + 5.5);
    });
    doc.text('Energy (GJ/m²)', colX.energy + 2, yPos + 5.5);
    doc.text('Cost (CAD/m²)', colX.cost + 2, yPos + 5.5);
    yPos += 8;

    // Table rows
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    globalConfigs.forEach((config, idx) => {
        if (yPos > pageHeight - 30) {
            doc.addPage();
            yPos = 20;
        }

        const bgColor = idx % 2 === 0 ? [248, 249, 255] : [255, 255, 255];
        doc.setFillColor(...bgColor);
        doc.rect(contentLeft, yPos, contentWidth, 7, 'F');

        doc.text(`${config.index}`, colX.config + 2, yPos + 5);
        paramKeys.forEach((k, i) => {
            const raw = config.paramValues ? config.paramValues[k] : config.paramValue;
            const str = formatParamValue(k, raw);
            const truncated = doc.splitTextToSize(str, paramColWidth - 3)[0] || str;
            doc.text(truncated, colX['p' + i] + 2, yPos + 5);
        });
        doc.text(`${config.totalEnergy.toFixed(6)}`, colX.energy + 2, yPos + 5);
        doc.text(`$${config.totalCost.toFixed(2)}`, colX.cost + 2, yPos + 5);
        yPos += 7;
    });
    
    yPos += 5;

    // Add new page for the scatter plot
    doc.addPage();
    yPos = 20;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Energy vs Cost — one dot per configuration', 15, yPos);
    yPos += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 116, 139);
    doc.text('Ideal designs sit toward the lower-left (low energy, low cost).', 15, yPos);
    doc.setTextColor(0, 0, 0);
    yPos += 6;

    // Scatter plot image — sized to fit on-page (A4 usable width ≈ 180 mm)
    const scatterImg = getScatterPlotImage(globalConfigs, 3);
    doc.addImage(scatterImg, 'PNG', 15, yPos, 180, 112);
    yPos += 120;
    
    // Add detailed breakdowns on new page
    doc.addPage();
    yPos = 20;
    
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Detailed Configuration Breakdown', 15, yPos);
    yPos += 10;
    
    globalConfigs.forEach((config) => {
        if (yPos > pageHeight - 60) {
            doc.addPage();
            yPos = 20;
        }
        
        // Configuration header
        doc.setFillColor(102, 126, 234);
        doc.setTextColor(255, 255, 255);
        doc.rect(15, yPos, pageWidth - 30, 8, 'F');
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        const paramSummary = (globalVariableParameters && globalVariableParameters.length && config.paramValues)
            ? globalVariableParameters
                .map((k, i) => `${(globalParameterLabels[i] || k)}: ${formatParamValue(k, config.paramValues[k])}`)
                .join('  |  ')
            : `Parameter Value: ${config.paramValue}`;
        doc.text(`Configuration ${config.index} — ${paramSummary}`, 20, yPos + 5.5);
        yPos += 13;
        
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('Energy Breakdown:', 20, yPos);
        yPos += 5;
        
        doc.setFont('helvetica', 'normal');
        doc.text(`  Electricity: ${config.electricity.toFixed(6)} GJ/m²`, 25, yPos);
        yPos += 5;
        doc.text(`  Natural Gas: ${config.gas.toFixed(6)} GJ/m²`, 25, yPos);
        yPos += 5;
        doc.setFont('helvetica', 'bold');
        doc.text(`  Total Energy: ${config.totalEnergy.toFixed(6)} GJ/m²`, 25, yPos);
        yPos += 8;
        
        doc.setFont('helvetica', 'bold');
        doc.text('Cost Breakdown:', 20, yPos);
        yPos += 5;
        
        doc.setFont('helvetica', 'normal');
        doc.text(`  Envelope: $${config.envelopeCost.toFixed(2)}/m²`, 25, yPos);
        yPos += 5;
        doc.text(`  HVAC: $${config.hvacCost.toFixed(2)}/m²`, 25, yPos);
        yPos += 5;
        doc.text(`  Lighting: $${config.lightingCost.toFixed(2)}/m²`, 25, yPos);
        yPos += 5;
        doc.text(`  Ventilation: $${config.ventilationCost.toFixed(2)}/m²`, 25, yPos);
        yPos += 5;
        doc.text(`  Hot Water: $${config.shwCost.toFixed(2)}/m²`, 25, yPos);
        yPos += 5;
        doc.setFont('helvetica', 'bold');
        doc.text(`  Total Cost: $${config.totalCost.toFixed(2)}/m²`, 25, yPos);
        yPos += 10;
    });
    
    // Add footer on each page
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(128, 128, 128);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
        doc.text('CanBuildAI - Building Design Decision Maker', pageWidth / 2, pageHeight - 6, { align: 'center' });
    }
    
    // Save the PDF
    const fileName = `CanBuildAI_Report_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
}

// Display error
function displayError(message) {
    const resultsSection = document.getElementById('results');
    const resultsContent = document.getElementById('resultsContent');
    
    resultsContent.innerHTML = `
        <div class="result-card" style="grid-column: 1 / -1; background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%);">
            <h4>⚠️ Error</h4>
            <p>${message}</p>
            <p class="subtext">Please check your inputs and try again.</p>
        </div>
    `;
    
    resultsSection.style.display = 'block';
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Show loading overlay
function showLoading(subtext) {
    document.getElementById('loadingOverlay').style.display = 'flex';
    if (subtext !== undefined) updateLoadingSubtext(subtext);
}

// Hide loading overlay
function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
    // Restore default subtext for next time
    updateLoadingSubtext('This may take a few moments');
}

// Update the loading overlay's subtext (progress messages, etc.)
function updateLoadingSubtext(text) {
    const overlay = document.getElementById('loadingOverlay');
    if (!overlay) return;
    const sub = overlay.querySelector('.loading-subtext');
    if (sub) sub.textContent = text;
}
