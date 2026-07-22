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
const ALTERNATIVE_MAX_COMBINATIONS = 100;

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

const HVAC_DIAGRAM_SVG = `
<svg viewBox="0 0 380 300" xmlns="http://www.w3.org/2000/svg" role="img"
     aria-label="HVAC system schematic"
     font-family="'Segoe UI', system-ui, sans-serif">
    <defs>
        <marker id="hvac-arrow-red" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#c0392b"/>
        </marker>
        <marker id="hvac-arrow-blue" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#2e6da6"/>
        </marker>
        <marker id="hvac-arrow-orange" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#c07030"/>
        </marker>
    </defs>

    <!-- Clean background -->
    <rect x="0" y="0" width="380" height="300" fill="#fbfcfe"/>

    <!-- Main title bar -->
    <rect x="0" y="0" width="380" height="24" fill="#2a5298"/>
    <text x="190" y="16" text-anchor="middle" font-size="11.5" fill="#fff"
          font-weight="700" id="hvacDiagramTitle">HVAC Schematic</text>

    <!-- Empty state -->
    <g class="empty-state">
        <rect x="40" y="110" width="300" height="70" fill="#fff" stroke="#cfd8e3"
              stroke-width="1" stroke-dasharray="4 3" rx="4"/>
        <text x="190" y="150" text-anchor="middle" font-size="12" fill="#7a8ba0">
            Select an HVAC system to view its schematic
        </text>
    </g>

    <!-- ============================================================ -->
    <!-- NECB SYSTEM 3 - PSZ-AC (packaged single-zone rooftop)         -->
    <!-- ============================================================ -->
    <g class="sys-necb-3">
        <!-- Panel frame + title bar -->
        <rect x="8" y="32" width="364" height="260" rx="4" fill="#fff" stroke="#a5b5cc" stroke-width="1.2"/>
        <rect x="8" y="32" width="364" height="20" fill="#2a5298"/>
        <text x="190" y="46" text-anchor="middle" font-size="10.5" fill="#fff" font-weight="600">
            Sys 3 · Rooftop Unit &#8594; Ducted Supply &#8594; Zone + Perimeter Baseboards
        </text>

        <!-- Building outline -->
        <rect x="40" y="120" width="300" height="140" rx="3" fill="#fdfefe" stroke="#8a99b0" stroke-width="1.4"/>
        <line x1="40" y1="120" x2="340" y2="120" stroke="#8a99b0" stroke-width="1.4"/>

        <!-- Rooftop unit (RTU) sitting on the roof -->
        <rect x="135" y="75" width="110" height="45" rx="2" fill="#fff" stroke="#1a3a6c" stroke-width="1.8"/>
        <g stroke="#1a3a6c" stroke-width="0.8" opacity="0.7">
            <line x1="145" y1="82" x2="225" y2="82"/>
            <line x1="145" y1="88" x2="225" y2="88"/>
            <line x1="145" y1="94" x2="225" y2="94"/>
        </g>
        <circle cx="215" cy="105" r="8" fill="none" stroke="#1a3a6c" stroke-width="1.2"/>
        <line x1="207" y1="105" x2="223" y2="105" stroke="#1a3a6c" stroke-width="1.1"/>
        <line x1="215" y1="97" x2="215" y2="113" stroke="#1a3a6c" stroke-width="1.1"/>
        <line x1="209" y1="99" x2="221" y2="111" stroke="#1a3a6c" stroke-width="1.1"/>
        <line x1="221" y1="99" x2="209" y2="111" stroke="#1a3a6c" stroke-width="1.1"/>
        <text x="190" y="72" text-anchor="middle" font-size="9.5" fill="#1a3a6c" font-weight="600">Rooftop Unit (DX cooling + gas heat)</text>

        <!-- Supply duct dropping down + horizontal trunk + diffusers -->
        <rect x="163" y="120" width="14" height="35" fill="#c0392b" opacity="0.85"/>
        <rect x="60" y="150" width="280" height="10" fill="#c0392b" opacity="0.85"/>
        <text x="60" y="147" font-size="8.5" fill="#c0392b" font-weight="600">Supply air trunk</text>
        <g fill="#c0392b">
            <polygon points="80,160 100,160 90,173"/>
            <polygon points="140,160 160,160 150,173"/>
            <polygon points="220,160 240,160 230,173"/>
            <polygon points="290,160 310,160 300,173"/>
        </g>

        <!-- Return path -->
        <path d="M50,200 L50,215 L340,215 L340,120" stroke="#2e6da6" stroke-width="1.4"
              fill="none" stroke-dasharray="4 3" marker-end="url(#hvac-arrow-blue)"/>
        <text x="190" y="212" text-anchor="middle" font-size="8.5" fill="#2e6da6" font-weight="600">Return air</text>

        <!-- Perimeter baseboards -->
        <rect x="50" y="236" width="280" height="4" fill="#f39c12"/>
        <text x="190" y="232" text-anchor="middle" font-size="8.5" fill="#a06000" font-weight="600">Perimeter baseboards</text>
        <text x="190" y="254" text-anchor="middle" font-size="9" fill="#6a7891" font-style="italic">Single-zone conditioned space</text>
    </g>

    <!-- ============================================================ -->
    <!-- NECB SYSTEM 4 - PSZ single-zone CAV MAU (no reheat)           -->
    <!-- ============================================================ -->
    <g class="sys-necb-4">
        <!-- Panel frame + title bar -->
        <rect x="8" y="32" width="364" height="260" rx="4" fill="#fff" stroke="#a5b5cc" stroke-width="1.2"/>
        <rect x="8" y="32" width="364" height="20" fill="#2a5298"/>
        <text x="190" y="46" text-anchor="middle" font-size="10.5" fill="#fff" font-weight="600">
            Sys 4 · Make-up Air Unit (CAV, no reheat) &#8594; Corridor + Baseboards
        </text>

        <!-- Building outline (corridor style) -->
        <rect x="40" y="130" width="300" height="130" rx="3" fill="#fdfefe" stroke="#8a99b0" stroke-width="1.4"/>
        <line x1="40" y1="130" x2="340" y2="130" stroke="#8a99b0" stroke-width="1.4"/>

        <!-- Rooftop MAU (simpler than RTU) -->
        <rect x="150" y="82" width="90" height="45" rx="2" fill="#fff" stroke="#1a3a6c" stroke-width="1.8"/>
        <g stroke="#2e6da6" stroke-width="0.9">
            <line x1="156" y1="90" x2="164" y2="90"/>
            <line x1="156" y1="96" x2="164" y2="96"/>
            <line x1="156" y1="102" x2="164" y2="102"/>
            <line x1="156" y1="108" x2="164" y2="108"/>
        </g>
        <text x="149" y="88" font-size="7.5" fill="#2e6da6" font-weight="600">OA</text>
        <circle cx="215" cy="105" r="10" fill="none" stroke="#1a3a6c" stroke-width="1.2"/>
        <line x1="205" y1="105" x2="225" y2="105" stroke="#1a3a6c" stroke-width="1.1"/>
        <line x1="215" y1="95" x2="215" y2="115" stroke="#1a3a6c" stroke-width="1.1"/>
        <line x1="208" y1="98" x2="222" y2="112" stroke="#1a3a6c" stroke-width="1.1"/>
        <line x1="222" y1="98" x2="208" y2="112" stroke="#1a3a6c" stroke-width="1.1"/>
        <text x="195" y="78" text-anchor="middle" font-size="9.5" fill="#1a3a6c" font-weight="600">Make-up Air Unit (heating only)</text>

        <!-- Supply duct dropping down + straight CV main -->
        <rect x="185" y="127" width="12" height="30" fill="#c0392b" opacity="0.85"/>
        <rect x="55" y="157" width="285" height="8" fill="#c0392b" opacity="0.85"/>
        <text x="60" y="154" font-size="8.5" fill="#c0392b" font-weight="600">CAV supply main</text>

        <g fill="#c0392b">
            <polygon points="80,165 100,165 90,177"/>
            <polygon points="170,165 190,165 180,177"/>
            <polygon points="270,165 290,165 280,177"/>
        </g>

        <!-- Perimeter baseboards -->
        <rect x="50" y="236" width="290" height="4" fill="#f39c12"/>
        <text x="190" y="232" text-anchor="middle" font-size="8.5" fill="#a06000" font-weight="600">Perimeter hydronic baseboards</text>
        <text x="190" y="254" text-anchor="middle" font-size="9" fill="#6a7891" font-style="italic">Long corridor / common space (single zone)</text>
    </g>

    <!-- ============================================================ -->
    <!-- NECB SYSTEM 6 - Built-up VAV w/ reheat + central plant        -->
    <!-- ============================================================ -->
    <g class="sys-necb-6">
        <!-- Panel frame + title bar -->
        <rect x="8" y="32" width="364" height="260" rx="4" fill="#fff" stroke="#a5b5cc" stroke-width="1.2"/>
        <rect x="8" y="32" width="364" height="20" fill="#2a5298"/>
        <text x="190" y="46" text-anchor="middle" font-size="10.5" fill="#fff" font-weight="600">
            Sys 6 · Built-up AHU &#8594; VAV + Reheat &#8594; Zones + Central Plant
        </text>

        <!-- Building block with 3 floors -->
        <rect x="90" y="58" width="240" height="150" rx="3" fill="#fdfefe" stroke="#8a99b0" stroke-width="1.4"/>
        <line x1="90" y1="106" x2="330" y2="106" stroke="#cfd8e3" stroke-width="0.8" stroke-dasharray="4 2"/>
        <line x1="90" y1="158" x2="330" y2="158" stroke="#cfd8e3" stroke-width="0.8" stroke-dasharray="4 2"/>
        <text x="326" y="102" text-anchor="end" font-size="8" fill="#6a7891" font-style="italic">Floor 3</text>
        <text x="326" y="154" text-anchor="end" font-size="8" fill="#6a7891" font-style="italic">Floor 2</text>
        <text x="326" y="174" text-anchor="end" font-size="8" fill="#6a7891" font-style="italic">Floor 1</text>

        <!-- AHU riser: supply (red) + return (blue) -->
        <rect x="100" y="60" width="8" height="145" fill="#c0392b" opacity="0.85"/>
        <rect x="112" y="60" width="8" height="145" fill="#2e6da6" opacity="0.75"/>

        <!-- VAV + reheat per floor -->
        <g font-size="7.5" fill="#a06000">
            <!-- Floor 3 -->
            <rect x="128" y="72" width="22" height="12" rx="1" fill="#fff" stroke="#c07030" stroke-width="1.2"/>
            <text x="151" y="70" font-weight="600">VAV+reheat</text>
            <rect x="146" y="74" width="4" height="8" fill="#fff7e6" stroke="#c07030" stroke-width="0.5"/>
            <line x1="150" y1="78" x2="325" y2="78" stroke="#c0392b" stroke-width="1.6"/>
            <polygon fill="#c0392b" points="200,78 214,78 207,88"/>
            <polygon fill="#c0392b" points="260,78 274,78 267,88"/>
            <polygon fill="#c0392b" points="308,78 322,78 315,88"/>
            <!-- Floor 2 -->
            <rect x="128" y="122" width="22" height="12" rx="1" fill="#fff" stroke="#c07030" stroke-width="1.2"/>
            <rect x="146" y="124" width="4" height="8" fill="#fff7e6" stroke="#c07030" stroke-width="0.5"/>
            <line x1="150" y1="128" x2="325" y2="128" stroke="#c0392b" stroke-width="1.6"/>
            <polygon fill="#c0392b" points="200,128 214,128 207,138"/>
            <polygon fill="#c0392b" points="260,128 274,128 267,138"/>
            <polygon fill="#c0392b" points="308,128 322,128 315,138"/>
            <!-- Floor 1 -->
            <rect x="128" y="174" width="22" height="12" rx="1" fill="#fff" stroke="#c07030" stroke-width="1.2"/>
            <rect x="146" y="176" width="4" height="8" fill="#fff7e6" stroke="#c07030" stroke-width="0.5"/>
            <line x1="150" y1="180" x2="325" y2="180" stroke="#c0392b" stroke-width="1.6"/>
            <polygon fill="#c0392b" points="200,180 214,180 207,190"/>
            <polygon fill="#c0392b" points="260,180 274,180 267,190"/>
            <polygon fill="#c0392b" points="308,180 322,180 315,190"/>
        </g>
        <!-- Perimeter baseboards -->
        <rect x="98" y="200" width="228" height="3" fill="#f39c12"/>

        <!-- Central plant row -->
        <!-- Cooling tower -->
        <text x="50" y="225" text-anchor="middle" font-size="8.5" fill="#2e6da6" font-weight="600">Cooling Tower</text>
        <rect x="20" y="228" width="60" height="55" rx="2" fill="#fff" stroke="#2e6da6" stroke-width="1.4"/>
        <g stroke="#2e6da6" stroke-width="0.6" opacity="0.7">
            <line x1="25" y1="236" x2="75" y2="236"/>
            <line x1="25" y1="242" x2="75" y2="242"/>
        </g>
        <circle cx="50" cy="264" r="10" fill="none" stroke="#2e6da6" stroke-width="1.2"/>
        <line x1="40" y1="264" x2="60" y2="264" stroke="#2e6da6" stroke-width="1"/>
        <line x1="50" y1="254" x2="50" y2="274" stroke="#2e6da6" stroke-width="1"/>
        <line x1="43" y1="257" x2="57" y2="271" stroke="#2e6da6" stroke-width="1"/>
        <line x1="57" y1="257" x2="43" y2="271" stroke="#2e6da6" stroke-width="1"/>

        <!-- Chiller -->
        <text x="190" y="225" text-anchor="middle" font-size="8.5" fill="#2e6da6" font-weight="600">Chiller (CHW)</text>
        <rect x="150" y="228" width="80" height="55" rx="2" fill="#e6f4ff" stroke="#2e6da6" stroke-width="1.4"/>
        <circle cx="170" cy="256" r="12" fill="#fff" stroke="#2e6da6" stroke-width="1.2"/>
        <rect x="188" y="242" width="36" height="28" fill="none" stroke="#2e6da6" stroke-width="0.6" opacity="0.5"/>

        <!-- Boiler -->
        <text x="325" y="225" text-anchor="middle" font-size="8.5" fill="#c07030" font-weight="600">Boiler (HW)</text>
        <rect x="285" y="228" width="80" height="55" rx="2" fill="#fff7e6" stroke="#c07030" stroke-width="1.4"/>
        <circle cx="305" cy="256" r="12" fill="#fff" stroke="#c07030" stroke-width="1.2"/>
        <path d="M300,264 L300,250 L308,257 L308,264 Z M300,250 L308,242 L308,257 Z" fill="#e67e22"/>
        <rect x="323" y="242" width="36" height="28" fill="none" stroke="#c07030" stroke-width="0.6" opacity="0.5"/>
    </g>

    <!-- ============================================================ -->
    <!-- NECB SYSTEM 1 - PTAC + perimeter baseboards (per-suite)       -->
    <!-- ============================================================ -->
    <g class="sys-necb-1">
        <!-- Panel frame + title bar -->
        <rect x="8" y="32" width="364" height="260" rx="4" fill="#fff" stroke="#a5b5cc" stroke-width="1.2"/>
        <rect x="8" y="32" width="364" height="20" fill="#2a5298"/>
        <text x="190" y="46" text-anchor="middle" font-size="10.5" fill="#fff" font-weight="600">
            Sys 1 · Per-Suite PTAC + Perimeter Baseboards (no central plant)
        </text>

        <!-- Building outline (residential cross-section, 3 stacked suites) -->
        <rect x="40" y="60" width="300" height="222" rx="3" fill="#fdfefe" stroke="#8a99b0" stroke-width="1.4"/>
        <line x1="40" y1="134" x2="340" y2="134" stroke="#cfd8e3" stroke-width="0.8"/>
        <line x1="40" y1="208" x2="340" y2="208" stroke="#cfd8e3" stroke-width="0.8"/>

        <!-- Suite labels -->
        <text x="335" y="76"  text-anchor="end" font-size="8" fill="#6a7891" font-style="italic">Suite 3</text>
        <text x="335" y="150" text-anchor="end" font-size="8" fill="#6a7891" font-style="italic">Suite 2</text>
        <text x="335" y="224" text-anchor="end" font-size="8" fill="#6a7891" font-style="italic">Suite 1</text>

        <!-- Suite 1 (top) - windows + PTAC + baseboards -->
        <rect x="55" y="72" width="34" height="24" fill="#e6f4ff" stroke="#8a99b0" stroke-width="0.8"/>
        <line x1="72" y1="72" x2="72" y2="96" stroke="#8a99b0" stroke-width="0.6"/>
        <rect x="55" y="100" width="34" height="17" fill="#fff" stroke="#1a3a6c" stroke-width="1.4"/>
        <g stroke="#1a3a6c" stroke-width="0.5" opacity="0.6">
            <line x1="58" y1="103" x2="58" y2="114"/><line x1="62" y1="103" x2="62" y2="114"/>
            <line x1="66" y1="103" x2="66" y2="114"/><line x1="70" y1="103" x2="70" y2="114"/>
            <line x1="74" y1="103" x2="74" y2="114"/><line x1="78" y1="103" x2="78" y2="114"/>
            <line x1="82" y1="103" x2="82" y2="114"/><line x1="86" y1="103" x2="86" y2="114"/>
        </g>
        <text x="95" y="112" font-size="8.5" fill="#1a3a6c" font-weight="600">PTAC (through-wall)</text>
        <path d="M96,86 L140,86" stroke="#c0392b" stroke-width="1.2" stroke-dasharray="3 2" marker-end="url(#hvac-arrow-red)"/>
        <path d="M140,128 L96,128" stroke="#2e6da6" stroke-width="1.2" stroke-dasharray="3 2" marker-end="url(#hvac-arrow-blue)"/>
        <text x="145" y="84"  font-size="7.5" fill="#c0392b">warm air</text>
        <text x="145" y="141" font-size="7.5" fill="#2e6da6">cool air</text>
        <rect x="95" y="120" width="230" height="4" fill="#f39c12"/>
        <text x="100" y="132" font-size="7.5" fill="#a06000">Perimeter baseboard</text>

        <!-- Suite 2 (middle) -->
        <rect x="55" y="146" width="34" height="24" fill="#e6f4ff" stroke="#8a99b0" stroke-width="0.8"/>
        <line x1="72" y1="146" x2="72" y2="170" stroke="#8a99b0" stroke-width="0.6"/>
        <rect x="55" y="174" width="34" height="17" fill="#fff" stroke="#1a3a6c" stroke-width="1.4"/>
        <g stroke="#1a3a6c" stroke-width="0.5" opacity="0.6">
            <line x1="58" y1="177" x2="58" y2="188"/><line x1="62" y1="177" x2="62" y2="188"/>
            <line x1="66" y1="177" x2="66" y2="188"/><line x1="70" y1="177" x2="70" y2="188"/>
            <line x1="74" y1="177" x2="74" y2="188"/><line x1="78" y1="177" x2="78" y2="188"/>
            <line x1="82" y1="177" x2="82" y2="188"/><line x1="86" y1="177" x2="86" y2="188"/>
        </g>
        <rect x="95" y="194" width="230" height="4" fill="#f39c12"/>

        <!-- Suite 3 (bottom) -->
        <rect x="55" y="220" width="34" height="24" fill="#e6f4ff" stroke="#8a99b0" stroke-width="0.8"/>
        <line x1="72" y1="220" x2="72" y2="244" stroke="#8a99b0" stroke-width="0.6"/>
        <rect x="55" y="248" width="34" height="17" fill="#fff" stroke="#1a3a6c" stroke-width="1.4"/>
        <g stroke="#1a3a6c" stroke-width="0.5" opacity="0.6">
            <line x1="58" y1="251" x2="58" y2="262"/><line x1="62" y1="251" x2="62" y2="262"/>
            <line x1="66" y1="251" x2="66" y2="262"/><line x1="70" y1="251" x2="70" y2="262"/>
            <line x1="74" y1="251" x2="74" y2="262"/><line x1="78" y1="251" x2="78" y2="262"/>
            <line x1="82" y1="251" x2="82" y2="262"/><line x1="86" y1="251" x2="86" y2="262"/>
        </g>
        <rect x="95" y="268" width="230" height="4" fill="#f39c12"/>
    </g>

    <!-- ============================================================ -->
    <!-- NECB MIXED (Sys 1 + Sys 4) - apartments                       -->
    <!-- Two side-by-side panels: dwelling suites vs corridors         -->
    <!-- ============================================================ -->
    <g class="sys-necb-mixed">

        <!-- ============ LEFT PANEL: Dwelling suites (Sys 1) ============ -->
        <rect x="8" y="32" width="180" height="260" rx="4" fill="#fff" stroke="#a5b5cc" stroke-width="1.2"/>
        <rect x="8" y="32" width="180" height="20" fill="#2a5298"/>
        <text x="98" y="46" text-anchor="middle" font-size="10" fill="#fff" font-weight="600">
            Dwelling Suites &#183; Sys 1
        </text>
        <text x="98" y="63" text-anchor="middle" font-size="8.5" fill="#4a5b76" font-style="italic">
            Per-suite PTAC + baseboards
        </text>

        <!-- Building outline (2 stacked suites) -->
        <rect x="20" y="72" width="156" height="212" rx="3" fill="#fdfefe" stroke="#8a99b0" stroke-width="1.2"/>
        <line x1="20" y1="178" x2="176" y2="178" stroke="#cfd8e3" stroke-width="0.8"/>
        <text x="170" y="84"  text-anchor="end" font-size="7.5" fill="#6a7891" font-style="italic">Suite A</text>
        <text x="170" y="190" text-anchor="end" font-size="7.5" fill="#6a7891" font-style="italic">Suite B</text>

        <!-- Suite A: window + PTAC + baseboard + warm/cool arrows -->
        <rect x="32" y="88" width="34" height="24" fill="#e6f4ff" stroke="#8a99b0" stroke-width="0.8"/>
        <line x1="49" y1="88" x2="49" y2="112" stroke="#8a99b0" stroke-width="0.6"/>
        <rect x="32" y="116" width="34" height="17" fill="#fff" stroke="#1a3a6c" stroke-width="1.4"/>
        <g stroke="#1a3a6c" stroke-width="0.5" opacity="0.6">
            <line x1="35" y1="119" x2="35" y2="130"/><line x1="39" y1="119" x2="39" y2="130"/>
            <line x1="43" y1="119" x2="43" y2="130"/><line x1="47" y1="119" x2="47" y2="130"/>
            <line x1="51" y1="119" x2="51" y2="130"/><line x1="55" y1="119" x2="55" y2="130"/>
            <line x1="59" y1="119" x2="59" y2="130"/><line x1="63" y1="119" x2="63" y2="130"/>
        </g>
        <text x="72" y="128" font-size="8" fill="#1a3a6c" font-weight="600">PTAC</text>
        <path d="M72,102 L120,102" stroke="#c0392b" stroke-width="1.2" stroke-dasharray="3 2" marker-end="url(#hvac-arrow-red)"/>
        <path d="M120,120 L72,120" stroke="#2e6da6" stroke-width="1.2" stroke-dasharray="3 2" marker-end="url(#hvac-arrow-blue)"/>
        <text x="102" y="100" font-size="6.5" fill="#c0392b" text-anchor="middle">warm</text>
        <text x="102" y="130" font-size="6.5" fill="#2e6da6" text-anchor="middle">cool</text>
        <rect x="70" y="140" width="100" height="4" fill="#f39c12"/>
        <text x="72" y="154" font-size="7" fill="#a06000">Perimeter baseboard</text>

        <!-- Suite B (below) -->
        <rect x="32" y="194" width="34" height="24" fill="#e6f4ff" stroke="#8a99b0" stroke-width="0.8"/>
        <line x1="49" y1="194" x2="49" y2="218" stroke="#8a99b0" stroke-width="0.6"/>
        <rect x="32" y="222" width="34" height="17" fill="#fff" stroke="#1a3a6c" stroke-width="1.4"/>
        <g stroke="#1a3a6c" stroke-width="0.5" opacity="0.6">
            <line x1="35" y1="225" x2="35" y2="236"/><line x1="39" y1="225" x2="39" y2="236"/>
            <line x1="43" y1="225" x2="43" y2="236"/><line x1="47" y1="225" x2="47" y2="236"/>
            <line x1="51" y1="225" x2="51" y2="236"/><line x1="55" y1="225" x2="55" y2="236"/>
            <line x1="59" y1="225" x2="59" y2="236"/><line x1="63" y1="225" x2="63" y2="236"/>
        </g>
        <text x="72" y="234" font-size="8" fill="#1a3a6c" font-weight="600">PTAC</text>
        <path d="M72,208 L120,208" stroke="#c0392b" stroke-width="1.2" stroke-dasharray="3 2" marker-end="url(#hvac-arrow-red)"/>
        <rect x="70" y="248" width="100" height="4" fill="#f39c12"/>
        <text x="72" y="262" font-size="7" fill="#a06000">Perimeter baseboard</text>

        <!-- ============ RIGHT PANEL: Corridors (Sys 4) ============ -->
        <rect x="192" y="32" width="180" height="260" rx="4" fill="#fff" stroke="#a5b5cc" stroke-width="1.2"/>
        <rect x="192" y="32" width="180" height="20" fill="#2a5298"/>
        <text x="282" y="46" text-anchor="middle" font-size="10" fill="#fff" font-weight="600">
            Corridors &#183; Sys 4
        </text>
        <text x="282" y="63" text-anchor="middle" font-size="8.5" fill="#4a5b76" font-style="italic">
            Rooftop MAU + CAV supply + baseboards
        </text>

        <!-- Rooftop MAU on top -->
        <text x="275" y="74" text-anchor="middle" font-size="9" fill="#1a3a6c" font-weight="600">Make-up Air Unit (rooftop)</text>
        <rect x="230" y="76" width="90" height="34" rx="2" fill="#fff" stroke="#1a3a6c" stroke-width="1.6"/>
        <g stroke="#2e6da6" stroke-width="0.8">
            <line x1="234" y1="82" x2="242" y2="82"/>
            <line x1="234" y1="88" x2="242" y2="88"/>
            <line x1="234" y1="94" x2="242" y2="94"/>
            <line x1="234" y1="100" x2="242" y2="100"/>
        </g>
        <text x="246" y="82" font-size="7" fill="#2e6da6" font-weight="600">OA</text>
        <circle cx="298" cy="93" r="7" fill="none" stroke="#1a3a6c" stroke-width="1.1"/>
        <line x1="291" y1="93" x2="305" y2="93" stroke="#1a3a6c" stroke-width="1"/>
        <line x1="298" y1="86" x2="298" y2="100" stroke="#1a3a6c" stroke-width="1"/>
        <line x1="293" y1="88" x2="303" y2="98" stroke="#1a3a6c" stroke-width="1"/>
        <line x1="303" y1="88" x2="293" y2="98" stroke="#1a3a6c" stroke-width="1"/>

        <!-- Building corridor block -->
        <rect x="200" y="140" width="164" height="144" rx="3" fill="#fdfefe" stroke="#8a99b0" stroke-width="1.2"/>

        <!-- Supply riser from MAU into corridor + horizontal supply -->
        <rect x="269" y="110" width="12" height="60" fill="#c0392b" opacity="0.85"/>
        <text x="288" y="138" font-size="7" fill="#c0392b" font-weight="600">supply riser</text>
        <rect x="208" y="170" width="148" height="8" fill="#c0392b" opacity="0.85"/>
        <text x="212" y="167" font-size="7.5" fill="#c0392b" font-weight="600">CAV supply main</text>

        <!-- Ceiling diffusers along corridor -->
        <g fill="#c0392b">
            <polygon points="222,178 238,178 230,190"/>
            <polygon points="268,178 284,178 276,190"/>
            <polygon points="322,178 338,178 330,190"/>
        </g>
        <text x="282" y="212" text-anchor="middle" font-size="8" fill="#6a7891" font-style="italic">Corridor / common area</text>

        <!-- Baseboards in corridor -->
        <rect x="208" y="270" width="148" height="4" fill="#f39c12"/>
        <text x="212" y="268" font-size="7.5" fill="#a06000" font-weight="600">Perimeter baseboards</text>
    </g>

    <!-- ============================================================ -->
    <!-- HEAT PUMP - outdoor unit panel + refrigerant lines            -->
    <!-- ============================================================ -->
    <g class="hp-unit">
        <!-- Left panel: outdoor unit -->
        <rect x="8" y="32" width="180" height="260" rx="4" fill="#fff" stroke="#a5b5cc" stroke-width="1.2"/>
        <rect x="8" y="32" width="180" height="20" fill="#2a5298"/>
        <text x="98" y="46" text-anchor="middle" font-size="10" fill="#fff" font-weight="600">
            Outdoor Heat Pump
        </text>
        <text x="98" y="63" text-anchor="middle" font-size="8.5" fill="#4a5b76" font-style="italic">
            Compressor + fan · air-source
        </text>

        <!-- Outdoor unit cabinet -->
        <rect x="30" y="90" width="120" height="150" rx="4" fill="#fdfefe" stroke="#1a3a6c" stroke-width="1.8"/>
        <!-- Big fan grille -->
        <circle cx="90" cy="150" r="42" fill="none" stroke="#1a3a6c" stroke-width="1.4"/>
        <line x1="48" y1="150" x2="132" y2="150" stroke="#1a3a6c" stroke-width="1.6"/>
        <line x1="90" y1="108" x2="90" y2="192" stroke="#1a3a6c" stroke-width="1.6"/>
        <line x1="60" y1="120" x2="120" y2="180" stroke="#1a3a6c" stroke-width="1.6"/>
        <line x1="120" y1="120" x2="60" y2="180" stroke="#1a3a6c" stroke-width="1.6"/>
        <circle cx="90" cy="150" r="6" fill="#1a3a6c"/>
        <!-- Side louvers -->
        <g stroke="#1a3a6c" stroke-width="0.6" opacity="0.5">
            <line x1="30" y1="205" x2="150" y2="205"/>
            <line x1="30" y1="212" x2="150" y2="212"/>
            <line x1="30" y1="219" x2="150" y2="219"/>
            <line x1="30" y1="226" x2="150" y2="226"/>
        </g>
        <text x="90" y="258" text-anchor="middle" font-size="8.5" fill="#1a3a6c" font-weight="600">Compressor + coil</text>

        <!-- Refrigerant lines heading to indoor panel -->
        <path d="M150,140 L200,140" stroke="#c0392b" stroke-width="2.4"
              stroke-dasharray="6 3" fill="none" marker-end="url(#hvac-arrow-red)"/>
        <path d="M200,175 L150,175" stroke="#2e6da6" stroke-width="2.4"
              stroke-dasharray="6 3" fill="none" marker-end="url(#hvac-arrow-blue)"/>
        <text x="175" y="160" text-anchor="middle" font-size="7" fill="#4a5b76" font-style="italic">refrigerant loop</text>
    </g>

    <!-- HP distribution: VRF ceiling cassettes -->
    <g class="dist-vrf-vis">
        <rect x="192" y="32" width="180" height="260" rx="4" fill="#fff" stroke="#a5b5cc" stroke-width="1.2"/>
        <rect x="192" y="32" width="180" height="20" fill="#2a5298"/>
        <text x="282" y="46" text-anchor="middle" font-size="10" fill="#fff" font-weight="600">
            Indoor: VRF Ceiling Cassettes
        </text>
        <text x="282" y="63" text-anchor="middle" font-size="8.5" fill="#4a5b76" font-style="italic">
            Refrigerant piping to zone cassettes
        </text>

        <!-- Building block, 3 floors -->
        <rect x="204" y="76" width="156" height="204" rx="3" fill="#fdfefe" stroke="#8a99b0" stroke-width="1.2"/>
        <line x1="204" y1="146" x2="360" y2="146" stroke="#cfd8e3" stroke-width="0.8" stroke-dasharray="4 2"/>
        <line x1="204" y1="214" x2="360" y2="214" stroke="#cfd8e3" stroke-width="0.8" stroke-dasharray="4 2"/>

        <!-- Refrigerant piping tree -->
        <g stroke="#c0392b" stroke-width="1.2" fill="none" opacity="0.75">
            <line x1="210" y1="86" x2="354" y2="86"/>
            <line x1="230" y1="86" x2="230" y2="150"/>
            <line x1="280" y1="86" x2="280" y2="150"/>
            <line x1="330" y1="86" x2="330" y2="150"/>
            <line x1="230" y1="160" x2="230" y2="220"/>
            <line x1="280" y1="160" x2="280" y2="220"/>
            <line x1="330" y1="160" x2="330" y2="220"/>
        </g>

        <!-- Ceiling cassettes (3 per floor) -->
        <g fill="#f39c12" stroke="#a06000" stroke-width="0.7">
            <rect x="216" y="94"  width="28" height="9" rx="1"/>
            <rect x="266" y="94"  width="28" height="9" rx="1"/>
            <rect x="316" y="94"  width="28" height="9" rx="1"/>
            <rect x="216" y="152" width="28" height="9" rx="1"/>
            <rect x="266" y="152" width="28" height="9" rx="1"/>
            <rect x="316" y="152" width="28" height="9" rx="1"/>
            <rect x="216" y="220" width="28" height="9" rx="1"/>
            <rect x="266" y="220" width="28" height="9" rx="1"/>
            <rect x="316" y="220" width="28" height="9" rx="1"/>
        </g>
        <text x="282" y="74" text-anchor="middle" font-size="7.5" fill="#a06000" font-weight="600">Cassette (per zone)</text>
    </g>

    <!-- HP distribution: hydronic baseboards -->
    <g class="dist-baseboard-vis">
        <rect x="192" y="32" width="180" height="260" rx="4" fill="#fff" stroke="#a5b5cc" stroke-width="1.2"/>
        <rect x="192" y="32" width="180" height="20" fill="#2a5298"/>
        <text x="282" y="46" text-anchor="middle" font-size="10" fill="#fff" font-weight="600">
            Indoor: Hydronic Baseboards
        </text>
        <text x="282" y="63" text-anchor="middle" font-size="8.5" fill="#4a5b76" font-style="italic">
            Hot-water loop to perimeter baseboards
        </text>

        <!-- Building block, 3 zones -->
        <rect x="204" y="76" width="156" height="204" rx="3" fill="#fdfefe" stroke="#8a99b0" stroke-width="1.2"/>
        <line x1="204" y1="148" x2="360" y2="148" stroke="#cfd8e3" stroke-width="0.8"/>
        <line x1="204" y1="216" x2="360" y2="216" stroke="#cfd8e3" stroke-width="0.8"/>

        <!-- HW piping loop -->
        <g stroke="#c07030" stroke-width="1.3" fill="none" opacity="0.75">
            <path d="M204,86 L354,86 L354,268 L214,268 L214,86"/>
        </g>
        <text x="282" y="82" text-anchor="middle" font-size="7.5" fill="#c07030" font-weight="600">HW loop</text>

        <!-- Baseboards per zone -->
        <rect x="222" y="130" width="120" height="5" fill="#f39c12"/>
        <rect x="222" y="198" width="120" height="5" fill="#f39c12"/>
        <rect x="222" y="258" width="120" height="5" fill="#f39c12"/>
        <text x="282" y="170" text-anchor="middle" font-size="8" fill="#a06000" font-weight="600">Baseboard per zone</text>
    </g>

    <!-- HP distribution: PTHP per zone -->
    <g class="dist-pthp-vis">
        <rect x="192" y="32" width="180" height="260" rx="4" fill="#fff" stroke="#a5b5cc" stroke-width="1.2"/>
        <rect x="192" y="32" width="180" height="20" fill="#2a5298"/>
        <text x="282" y="46" text-anchor="middle" font-size="10" fill="#fff" font-weight="600">
            Indoor: PTHP per Zone
        </text>
        <text x="282" y="63" text-anchor="middle" font-size="8.5" fill="#4a5b76" font-style="italic">
            Through-wall packaged units, one per zone
        </text>

        <!-- Building block, 3 zones -->
        <rect x="204" y="76" width="156" height="204" rx="3" fill="#fdfefe" stroke="#8a99b0" stroke-width="1.2"/>
        <line x1="204" y1="146" x2="360" y2="146" stroke="#cfd8e3" stroke-width="0.8"/>
        <line x1="204" y1="214" x2="360" y2="214" stroke="#cfd8e3" stroke-width="0.8"/>

        <!-- Windows + PTHP below (2 per zone) -->
        <g>
            <!-- Zone 1 -->
            <rect x="222" y="90"  width="28" height="16" fill="#e6f4ff" stroke="#8a99b0" stroke-width="0.8"/>
            <rect x="222" y="110" width="28" height="14" fill="#fff" stroke="#1a3a6c" stroke-width="1.2"/>
            <rect x="312" y="90"  width="28" height="16" fill="#e6f4ff" stroke="#8a99b0" stroke-width="0.8"/>
            <rect x="312" y="110" width="28" height="14" fill="#fff" stroke="#1a3a6c" stroke-width="1.2"/>
            <!-- Zone 2 -->
            <rect x="222" y="160" width="28" height="16" fill="#e6f4ff" stroke="#8a99b0" stroke-width="0.8"/>
            <rect x="222" y="180" width="28" height="14" fill="#fff" stroke="#1a3a6c" stroke-width="1.2"/>
            <rect x="312" y="160" width="28" height="16" fill="#e6f4ff" stroke="#8a99b0" stroke-width="0.8"/>
            <rect x="312" y="180" width="28" height="14" fill="#fff" stroke="#1a3a6c" stroke-width="1.2"/>
            <!-- Zone 3 -->
            <rect x="222" y="228" width="28" height="16" fill="#e6f4ff" stroke="#8a99b0" stroke-width="0.8"/>
            <rect x="222" y="248" width="28" height="14" fill="#fff" stroke="#1a3a6c" stroke-width="1.2"/>
            <rect x="312" y="228" width="28" height="16" fill="#e6f4ff" stroke="#8a99b0" stroke-width="0.8"/>
            <rect x="312" y="248" width="28" height="14" fill="#fff" stroke="#1a3a6c" stroke-width="1.2"/>
        </g>
        <text x="282" y="74" text-anchor="middle" font-size="7.5" fill="#1a3a6c" font-weight="600">PTHP under each window</text>
    </g>

    <!-- HP backup: NG boiler (small badge overlaid on the outdoor panel) -->
    <g class="backup-gas">
        <rect x="20" y="60" width="60" height="30" rx="3" fill="#fff7e6" stroke="#c07030" stroke-width="1.4"/>
        <circle cx="34" cy="75" r="8" fill="#fff" stroke="#c07030" stroke-width="1"/>
        <path d="M31,82 L31,72 L36,76 L36,82 Z M31,72 L36,67 L36,76 Z" fill="#e67e22"/>
        <text x="45" y="79" font-size="8" fill="#c07030" font-weight="700">NG backup</text>
    </g>

    <!-- HP backup: electric resistance -->
    <g class="backup-elec">
        <rect x="20" y="60" width="60" height="30" rx="3" fill="#f4efff" stroke="#7a4ec9" stroke-width="1.4"/>
        <path d="M27,80 L32,72 L37,80 L42,72 L47,80"
              stroke="#7a4ec9" stroke-width="1.6" fill="none"/>
        <text x="52" y="79" font-size="8" fill="#7a4ec9" font-weight="700">elec backup</text>
    </g>
</svg>
`;

function mountHvacDiagram() {
    const host = document.getElementById('hvacDiagram');
    if (host && !host.firstElementChild) {
        host.innerHTML = HVAC_DIAGRAM_SVG + `
<div class="hvac-diagram-legend" aria-label="Diagram legend">
    <span><i style="background:#c0392b"></i>Supply air</span>
    <span><i style="background:#2e6da6"></i>Return / cool</span>
    <span><i style="background:#c07030"></i>Heating (HW / boiler)</span>
    <span><i style="background:#f39c12"></i>Baseboard</span>
</div>`;
    }
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

    // ---- Update the diagram via CSS classes on the host ----
    const diagram = document.getElementById('hvacDiagram');
    if (diagram) {
        const classes = ['hvac-diagram'];
        if (isNECB)                         classes.push('mode-necb');
        else if (isHP)                      classes.push('mode-hp');
        else                                classes.push('mode-empty');

        if (fuel === 'NaturalGas')          classes.push('fuel-gas');
        else if (fuel === 'Electricity')    classes.push('fuel-elec');

        if (type === 'VRF')                 classes.push('dist-vrf');
        else if (type === 'Baseboard')      classes.push('dist-baseboard');
        else if (type === 'PTHP')           classes.push('dist-pthp');

        // NECB-specific sub-system layout (driven by building archetype).
        if (isNECB && primarySys) {
            classes.push(primarySys.cls);
            if (secondarySys) classes.push('necb-mixed');
        } else if (isNECB) {
            // NECB selected but no archetype yet → render as empty.
            classes.push('mode-empty');
        }

        diagram.className = classes.join(' ');

        // Update the schematic title to reflect the active system.
        const titleEl = diagram.querySelector('#hvacDiagramTitle');
        if (titleEl) {
            let title = 'HVAC Schematic';
            if (isHP)                       title = `${family} + ${typeLabels[type] || 'distribution'}`;
            else if (isNECB && secondarySys) title = `NECB Default → System ${necbMapping.primary} (suites) + System ${necbMapping.secondary} (corridors)`;
            else if (isNECB && primarySys)  title = `NECB Default → ${primarySys.label}`;
            else if (isNECB)                title = 'NECB Default (pick an archetype)';
            titleEl.textContent = title;
        }
    }

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

    // Mount the animated layout diagram and render the first summary.
    mountHvacDiagram();
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
            // Alternative configuration analysis — cartesian product of all parameter values
            const excelBlob = await generateCombinationsExcelFile(buildingConfig, alternativeSpecs);

            // Upload to API
            results = await uploadAndPredict(excelBlob);
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

// Generate Excel file with all cartesian-product combinations of the given
// parameter specs for alternative-configuration analysis.
//
//   config       – the base building configuration (as collected from the form)
//   paramSpecs   – array of { parameter: 'ecm_system_name', values: [...] }
//
// Returns an .xlsx Blob containing one row per combination.
async function generateCombinationsExcelFile(config, paramSpecs) {
    if (!Array.isArray(paramSpecs) || paramSpecs.length === 0) {
        throw new Error('No parameter specifications provided for alternative analysis.');
    }

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

    // Build cartesian product of all parameter value arrays
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

    const rows = combinations.map((combo, i) => {
        // Start from defaults and overlay the user's base configuration
        const row = { ...allDefaults };

        userParams.forEach(param => {
            const key = ':' + param;
            if (config[key] !== undefined) row[key] = config[key];
        });

        if (config[':building_type'] !== undefined) {
            row['bldg_standards_building_type'] = config[':building_type'];
        }
        applyArchetypeGeometry(row, config[':building_type']);

        // Override each varying parameter with its combination value
        paramSpecs.forEach((spec, j) => {
            row[':' + spec.parameter] = combo[j];
        });

        if (i < 20 || i === combinations.length - 1) {
            console.log(
                `Config ${i + 1}:`,
                paramSpecs.map((s, j) => `${s.parameter}=${combo[j]}`).join(', ')
            );
        }
        return row;
    });

    // Create workbook
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

    return new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
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
                    <strong>${parameterDisplayName}:</strong> ${baselineValue}
                </div>
                <div class="value" style="font-size: 1.5em;">${baselineResults.total_energy_eui_electricity_kwh_per_m_sq.toFixed(2)}</div>
                <div class="unit">kWh/m² (Electricity)</div>
                <div class="value" style="font-size: 1.5em; margin-top: 10px;">${baselineResults.total_energy_eui_natural_gas_gj_per_m_sq.toFixed(4)}</div>
                <div class="unit">GJ/m² (Gas)</div>
            </div>
            
            <div class="result-card" style="text-align: center; background: linear-gradient(135deg, #48bb7820 0%, #38a16920 100%);">
                <h4>✨ After Retrofit</h4>
                <div style="font-size: 1.1em; color: #666; margin: 10px 0;">
                    <strong>${parameterDisplayName}:</strong> ${improvedValue}
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
            ? variableParameters.map(p => paramValues[p]).join(' / ')
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
    `;

    configs.forEach((config, idx) => {
        const rowBg = idx % 2 === 0 ? '#f8f9ff' : 'white';
        const paramCells = variableParameters.map(p => {
            const val = config.paramValues[p];
            const display = typeof val === 'number' ? val : (val ?? '—');
            return `<td style="padding: 12px;">${display}</td>`;
        }).join('');

        htmlContent += `
            <tr style="background: ${rowBg}; border-bottom: 1px solid #e1e8ed; cursor: pointer; transition: background 0.2s;"
                onmouseover="this.style.background='#e6f2ff'"
                onmouseout="this.style.background='${rowBg}'"
                onclick="toggleConfigDetails(${config.index})">
                <td style="padding: 12px; font-weight: bold;">Config ${config.index} <span style="color: #667eea; font-size: 12px;">▼</span></td>
                ${paramCells}
                <td style="padding: 12px; text-align: right; font-family: monospace;">${config.totalEnergy.toFixed(6)}</td>
                <td style="padding: 12px; text-align: right;">$${config.totalCost.toFixed(2)}</td>
            </tr>
            <tr id="details-${config.index}" style="display: none; background: #f0f4ff;">
                <td colspan="${detailsColspan + 1}" style="padding: 20px;">
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
    });

    htmlContent += `
                </tbody>
            </table>
        </div>

        <!-- Visualization Charts -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 20px; max-width: 100%;">
            <div class="chart-container" style="background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); min-width: 0; max-width: 100%;">
                <h4 style="margin: 0 0 20px 0; color: #2d3748; text-align: center; font-size: 18px; font-weight: 600;">📊 Energy Use Intensity Comparison</h4>
                <div style="position: relative; width: 100%; height: 350px;">
                    <canvas id="energyChart" style="width: 100%; height: 100%; cursor: pointer;"></canvas>
                    <div id="energyTooltip" style="display: none; position: absolute; background: rgba(0,0,0,0.85); color: white; padding: 12px 16px; border-radius: 8px; pointer-events: none; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 1000; white-space: nowrap;"></div>
                </div>
            </div>
            <div class="chart-container" style="background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); min-width: 0; max-width: 100%;">
                <h4 style="margin: 0 0 20px 0; color: #2d3748; text-align: center; font-size: 18px; font-weight: 600;">💰 Cost Comparison</h4>
                <div style="position: relative; width: 100%; height: 350px;">
                    <canvas id="costChart" style="width: 100%; height: 100%; cursor: pointer;"></canvas>
                    <div id="costTooltip" style="display: none; position: absolute; background: rgba(0,0,0,0.85); color: white; padding: 12px 16px; border-radius: 8px; pointer-events: none; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 1000; white-space: nowrap;"></div>
                </div>
            </div>
        </div>
    `;

    resultsContent.innerHTML = htmlContent;
    resultsSection.style.display = 'block';

    // Smooth scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Store configs globally for PDF generation
    storeConfigsForPDF(configs, analysisTitle.replace(/^Alternative Configuration Analysis: /, ''), results, variableParameters, paramLabels);

    // Draw charts with hover functionality
    drawEnergyChart(configs);
    drawCostChart(configs);
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

// Draw energy comparison chart
function drawEnergyChart(configs) {
    const canvas = document.getElementById('energyChart');
    const ctx = canvas.getContext('2d');
    
    // Set canvas size with device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const height = rect.height;
    const padding = { top: 50, right: 30, bottom: 60, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    // Find max value for scaling
    const maxEnergy = Math.max(...configs.map(c => c.totalEnergy)) * 1.15;
    const minEnergy = Math.min(...configs.map(c => c.totalEnergy)) * 0.95;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw background grid
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();
    }
    
    // Draw bars
    const barWidth = (chartWidth / configs.length) * 0.65;
    const barSpacing = chartWidth / configs.length;
    
    configs.forEach((config, i) => {
        const barHeight = ((config.totalEnergy - minEnergy) / (maxEnergy - minEnergy)) * chartHeight;
        const x = padding.left + i * barSpacing + (barSpacing - barWidth) / 2;
        const y = padding.top + chartHeight - barHeight;
        
        // Draw shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
        
        // Draw bar
        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        gradient.addColorStop(0, '#667eea');
        gradient.addColorStop(1, '#764ba2');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, barWidth, barHeight);
        
        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        
        // Draw value on top with smaller font and 4 decimals
        ctx.fillStyle = '#2d3748';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(config.totalEnergy.toFixed(4), x + barWidth / 2, y - 8);
        
        // Draw label
        ctx.fillStyle = '#4a5568';
        ctx.font = 'bold 14px Arial';
        ctx.fillText(`${config.index}`, x + barWidth / 2, padding.top + chartHeight + 25);
    });
    
    // Draw axes
    ctx.strokeStyle = '#a0aec0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartHeight);
    ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
    ctx.stroke();
    
    // Y-axis label
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#4a5568';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Energy Use Intensity (GJ/m²)', 0, 0);
    ctx.restore();
    
    // Add hover detection
    canvas.onmousemove = function(e) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const tooltip = document.getElementById('energyTooltip');
        let hoveredConfig = null;
        
        // Check if mouse is over any bar
        configs.forEach((config, i) => {
            const barWidth = (chartWidth / configs.length) * 0.65;
            const barSpacing = chartWidth / configs.length;
            const barHeight = ((config.totalEnergy - minEnergy) / (maxEnergy - minEnergy)) * chartHeight;
            const barX = padding.left + i * barSpacing + (barSpacing - barWidth) / 2;
            const barY = padding.top + chartHeight - barHeight;
            
            if (x >= barX && x <= barX + barWidth && y >= barY && y <= barY + barHeight) {
                hoveredConfig = config;
            }
        });
        
        if (hoveredConfig) {
            tooltip.innerHTML = `
                <strong>Configuration ${hoveredConfig.index}</strong><br/>
                Electricity: ${hoveredConfig.electricity.toFixed(4)} GJ/m²<br/>
                Gas: ${hoveredConfig.gas.toFixed(4)} GJ/m²<br/>
                <strong>Total: ${hoveredConfig.totalEnergy.toFixed(4)} GJ/m²</strong>
            `;
            tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX - rect.left + 15) + 'px';
            tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
        } else {
            tooltip.style.display = 'none';
        }
    };
    
    canvas.onmouseleave = function() {
        document.getElementById('energyTooltip').style.display = 'none';
    };
}

// Draw cost comparison chart
function drawCostChart(configs) {
    const canvas = document.getElementById('costChart');
    const ctx = canvas.getContext('2d');
    
    // Set canvas size with device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const height = rect.height;
    const padding = { top: 50, right: 30, bottom: 60, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    // Find max value for scaling
    const maxCost = Math.max(...configs.map(c => c.totalCost)) * 1.15;
    const minCost = Math.min(...configs.map(c => c.totalCost)) * 0.95;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw background grid
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();
    }
    
    // Draw bars
    const barWidth = (chartWidth / configs.length) * 0.65;
    const barSpacing = chartWidth / configs.length;
    
    configs.forEach((config, i) => {
        const barHeight = ((config.totalCost - minCost) / (maxCost - minCost)) * chartHeight;
        const x = padding.left + i * barSpacing + (barSpacing - barWidth) / 2;
        const y = padding.top + chartHeight - barHeight;
        
        // Draw shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
        
        // Draw bar
        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        gradient.addColorStop(0, '#48bb78');
        gradient.addColorStop(1, '#2f855a');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, barWidth, barHeight);
        
        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        
        // Draw value on top with smaller font
        ctx.fillStyle = '#2d3748';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('$' + config.totalCost.toFixed(2), x + barWidth / 2, y - 8);
        
        // Draw label
        ctx.fillStyle = '#4a5568';
        ctx.font = 'bold 14px Arial';
        ctx.fillText(`${config.index}`, x + barWidth / 2, padding.top + chartHeight + 25);
    });
    
    // Draw axes
    ctx.strokeStyle = '#a0aec0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartHeight);
    ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
    ctx.stroke();
    
    // Y-axis label
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#4a5568';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Equipment Cost (CAD/m²)', 0, 0);
    ctx.restore();
    
    // Add hover detection
    canvas.onmousemove = function(e) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const tooltip = document.getElementById('costTooltip');
        let hoveredConfig = null;
        
        // Check if mouse is over any bar
        configs.forEach((config, i) => {
            const barWidth = (chartWidth / configs.length) * 0.65;
            const barSpacing = chartWidth / configs.length;
            const barHeight = ((config.totalCost - minCost) / (maxCost - minCost)) * chartHeight;
            const barX = padding.left + i * barSpacing + (barSpacing - barWidth) / 2;
            const barY = padding.top + chartHeight - barHeight;
            
            if (x >= barX && x <= barX + barWidth && y >= barY && y <= barY + barHeight) {
                hoveredConfig = config;
            }
        });
        
        if (hoveredConfig) {
            tooltip.innerHTML = `
                <strong>Configuration ${hoveredConfig.index}</strong><br/>
                Envelope: $${hoveredConfig.envelopeCost.toFixed(2)}/m²<br/>
                HVAC: $${hoveredConfig.hvacCost.toFixed(2)}/m²<br/>
                Lighting: $${hoveredConfig.lightingCost.toFixed(2)}/m²<br/>
                Ventilation: $${hoveredConfig.ventilationCost.toFixed(2)}/m²<br/>
                Hot Water: $${hoveredConfig.shwCost.toFixed(2)}/m²<br/>
                <strong>Total: $${hoveredConfig.totalCost.toFixed(2)}/m²</strong>
            `;
            tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX - rect.left + 15) + 'px';
            tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
        } else {
            tooltip.style.display = 'none';
        }
    };
    
    canvas.onmouseleave = function() {
        document.getElementById('costTooltip').style.display = 'none';
    };
}

// Store configs globally for PDF generation
let globalConfigs = null;
let globalParameterDisplayName = null;
let globalVariableParameters = [];
let globalParameterLabels = [];
let globalResults = null;
let globalSinglePrediction = null;

// Helper function to create high-resolution chart image for PDF
function getHighResChartImage(canvasId, drawFunction, configs, scale = 3) {
    // Create a temporary high-resolution canvas
    const originalCanvas = document.getElementById(canvasId);
    const tempCanvas = document.createElement('canvas');
    const ctx = tempCanvas.getContext('2d');
    
    // Set high-resolution dimensions (3x or 4x for print quality)
    const baseWidth = 800;  // Standard width for PDF
    const baseHeight = 400; // Standard height for PDF
    tempCanvas.width = baseWidth * scale;
    tempCanvas.height = baseHeight * scale;
    
    // Scale the context to draw at high resolution
    ctx.scale(scale, scale);
    
    const width = baseWidth;
    const height = baseHeight;
    const padding = { top: 50, right: 30, bottom: 60, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    // Determine which type of chart to draw
    if (canvasId === 'energyChart') {
        drawHighResEnergyChart(ctx, configs, width, height, padding, chartWidth, chartHeight);
    } else if (canvasId === 'costChart') {
        drawHighResCostChart(ctx, configs, width, height, padding, chartWidth, chartHeight);
    }
    
    // Return the high-resolution image data
    return tempCanvas.toDataURL('image/png', 1.0);
}

// Draw high-resolution energy chart
function drawHighResEnergyChart(ctx, configs, width, height, padding, chartWidth, chartHeight) {
    const maxEnergy = Math.max(...configs.map(c => c.totalEnergy)) * 1.15;
    const minEnergy = Math.min(...configs.map(c => c.totalEnergy)) * 0.95;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw background grid
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();
    }
    
    // Draw bars
    const barWidth = (chartWidth / configs.length) * 0.65;
    const barSpacing = chartWidth / configs.length;
    
    configs.forEach((config, i) => {
        const barHeight = ((config.totalEnergy - minEnergy) / (maxEnergy - minEnergy)) * chartHeight;
        const x = padding.left + i * barSpacing + (barSpacing - barWidth) / 2;
        const y = padding.top + chartHeight - barHeight;
        
        // Draw shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
        
        // Draw bar
        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        gradient.addColorStop(0, '#667eea');
        gradient.addColorStop(1, '#764ba2');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, barWidth, barHeight);
        
        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        
        // Draw value on top
        ctx.fillStyle = '#2d3748';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(config.totalEnergy.toFixed(4), x + barWidth / 2, y - 8);
        
        // Draw label
        ctx.fillStyle = '#4a5568';
        ctx.font = 'bold 14px Arial';
        ctx.fillText(`${config.index}`, x + barWidth / 2, padding.top + chartHeight + 25);
    });
    
    // Draw axes
    ctx.strokeStyle = '#a0aec0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartHeight);
    ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
    ctx.stroke();
    
    // Y-axis label
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#4a5568';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Energy Use Intensity (GJ/m²)', 0, 0);
    ctx.restore();
}

// Draw high-resolution cost chart
function drawHighResCostChart(ctx, configs, width, height, padding, chartWidth, chartHeight) {
    const maxCost = Math.max(...configs.map(c => c.totalCost)) * 1.15;
    const minCost = Math.min(...configs.map(c => c.totalCost)) * 0.95;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw background grid
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();
    }
    
    // Draw bars
    const barWidth = (chartWidth / configs.length) * 0.65;
    const barSpacing = chartWidth / configs.length;
    
    configs.forEach((config, i) => {
        const barHeight = ((config.totalCost - minCost) / (maxCost - minCost)) * chartHeight;
        const x = padding.left + i * barSpacing + (barSpacing - barWidth) / 2;
        const y = padding.top + chartHeight - barHeight;
        
        // Draw shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
        
        // Draw bar
        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        gradient.addColorStop(0, '#48bb78');
        gradient.addColorStop(1, '#2f855a');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, barWidth, barHeight);
        
        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        
        // Draw value on top
        ctx.fillStyle = '#2d3748';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('$' + config.totalCost.toFixed(2), x + barWidth / 2, y - 8);
        
        // Draw label
        ctx.fillStyle = '#4a5568';
        ctx.font = 'bold 14px Arial';
        ctx.fillText(`${config.index}`, x + barWidth / 2, padding.top + chartHeight + 25);
    });
    
    // Draw axes
    ctx.strokeStyle = '#a0aec0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartHeight);
    ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
    ctx.stroke();
    
    // Y-axis label
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#4a5568';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Equipment Cost (CAD/m²)', 0, 0);
    ctx.restore();
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
            const val = config.paramValues ? config.paramValues[k] : config.paramValue;
            const str = val === undefined || val === null ? '—' : String(val);
            const truncated = doc.splitTextToSize(str, paramColWidth - 3)[0] || str;
            doc.text(truncated, colX['p' + i] + 2, yPos + 5);
        });
        doc.text(`${config.totalEnergy.toFixed(6)}`, colX.energy + 2, yPos + 5);
        doc.text(`$${config.totalCost.toFixed(2)}`, colX.cost + 2, yPos + 5);
        yPos += 7;
    });
    
    yPos += 5;
    
    // Add new page for charts
    doc.addPage();
    yPos = 20;
    
    // Add Energy Chart
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Energy Use Intensity Comparison', 15, yPos);
    yPos += 10;
    
    // Use high-resolution chart image
    const energyImgData = getHighResChartImage('energyChart', null, globalConfigs, 3);
    doc.addImage(energyImgData, 'PNG', 15, yPos, 180, 80);
    yPos += 90;
    
    // Add Cost Chart
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Cost Comparison', 15, yPos);
    yPos += 10;
    
    // Use high-resolution chart image
    const costImgData = getHighResChartImage('costChart', null, globalConfigs, 3);
    doc.addImage(costImgData, 'PNG', 15, yPos, 180, 80);
    yPos += 90;
    
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
                .map((k, i) => `${(globalParameterLabels[i] || k)}: ${config.paramValues[k]}`)
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
function showLoading() {
    document.getElementById('loadingOverlay').style.display = 'flex';
}

// Hide loading overlay
function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}
