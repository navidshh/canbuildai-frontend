// Configuration
const API_BASE_URL = 'https://h3v7vtb0ee.execute-api.ca-central-1.amazonaws.com';  // Production API Gateway
const BUCKET_NAME = 'surrogate-api-dev-tgw-3-btap-v1-uploads';
const AWS_REGION = 'ca-central-1';

// Global storage for input parameters (for PDF reports)
let globalInputConfig = null;

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
// "auto-derived" backend value for `primary_heating_fuel` — e.g. selecting
// `HS13_ASHP_VRF` + `NaturalGas` is silently rewritten by BTAP to
// `NaturalGasHPGasBackup` (heat pump primary, NG backup), and the summary
// makes that transformation visible to the user.
//
// The layout diagram is an engineering-style SVG schematic.  All elements
// are present at all times; CSS classes on the parent container toggle
// which ones are visible (mode-hp / mode-necb, necb-sys-1 / -3 / -6, fuel
// and distribution variants) and drive the working animations (fan spin,
// refrigerant flow, etc.).
//
// NECB system → building-archetype mapping (from NECB_HVAC_Systems.md,
// derived from NECB 2011 Table 8.4.4.8.A and the BTAP prototype
// geometries). When the user selects "NECB Default", the building type
// determines which system the simulator will assign.
const NECB_DEFAULT_FOR_BUILDING = {
    SmallOffice:   { primary: 3, secondary: null,
                     note: 'Small Office (1 storey, "General Area" space type) → NECB assigns System 3 (PSZ-AC, packaged single-zone rooftop with baseboards).' },
    MediumOffice:  { primary: 6, secondary: null,
                     note: 'Medium Office (3 storeys) crosses the NECB ≥3-storey threshold for "General Area" zones, so the simulator assigns System 6 (built-up VAV with reheat + chiller + boiler).' },
    LargeOffice:   { primary: 6, secondary: null,
                     note: 'Large Office (≥3 storeys) → NECB assigns System 6 (built-up VAV with reheat + chiller + boiler) for all general office zones.' },
    LowRise:       { primary: 1, secondary: 6,
                     note: 'Low-Rise Apartment: dwelling units use System 1 (PTAC + baseboards); corridors / amenity / common areas use System 6 because the building has ≥3 storeys.' },
    MidRise:       { primary: 1, secondary: 6,
                     note: 'Mid-Rise Apartment: dwelling units use System 1 (PTAC + baseboards); corridors / amenity / common areas use System 6 because the building has ≥3 storeys.' },
    HighRise:      { primary: 1, secondary: 6,
                     note: 'High-Rise Apartment: dwelling units use System 1 (PTAC + baseboards); corridors / amenity / common areas use System 6 because the building has ≥3 storeys.' }
};

const NECB_SYSTEM_INFO = {
    1: {
        label: 'System 1 — PTAC + baseboards',
        archetype: 'Packaged Terminal Air Conditioner (PTAC) — closest to ASHRAE 90.1 System 1',
        primary: 'Through-wall PTAC per zone + hydronic/electric perimeter baseboards (typical dwelling/hotel layout)',
        distribution: 'PTAC unit under each window for cooling + baseboards along perimeter walls for heating',
        cls: 'necb-sys-1'
    },
    3: {
        label: 'System 3 — PSZ-AC',
        archetype: 'Packaged Single-Zone constant-volume rooftop unit — closest to ASHRAE 90.1 System 3',
        primary: 'Packaged Single-Zone rooftop unit (PSZ-AC) with DX cooling and gas/electric/hot-water heating + perimeter baseboards',
        distribution: 'Ducted constant-volume supply from rooftop unit + perimeter baseboards',
        cls: 'necb-sys-3'
    },
    6: {
        label: 'System 6 — Built-up VAV with reheat',
        archetype: 'Built-up multi-zone VAV with hydronic reheat — closest to ASHRAE 90.1 System 7',
        primary: 'Built-up VAV air handler (one per storey) with CHW cooling, HW reheat, central chiller + cooling tower + boiler',
        distribution: 'VAV terminal box with reheat coil per zone + perimeter baseboards; central CHW chiller, cooling tower and HW boiler',
        cls: 'necb-sys-6'
    }
};

const HVAC_DIAGRAM_SVG = `
<svg viewBox="0 0 360 230" xmlns="http://www.w3.org/2000/svg" role="img"
     aria-label="HVAC system schematic">
    <defs>
        <pattern id="hvac-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e6ecf5" stroke-width="0.6"/>
        </pattern>
        <marker id="hvac-arrow-red" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#c0392b"/>
        </marker>
        <marker id="hvac-arrow-blue" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#2e6da6"/>
        </marker>
    </defs>

    <!-- Schematic background grid -->
    <rect x="0" y="0" width="360" height="230" fill="#f7fafd"/>
    <rect x="0" y="0" width="360" height="230" fill="url(#hvac-grid)"/>

    <!-- Title bar -->
    <rect x="0" y="0" width="360" height="16" fill="#1a3a6c"/>
    <text x="6" y="12" font-size="9" fill="#fff" font-family="Consolas, monospace"
          font-weight="600" id="hvacDiagramTitle">HVAC Schematic</text>
    <text x="354" y="12" text-anchor="end" font-size="8" fill="#cfd8e3"
          font-family="Consolas, monospace">Building section view</text>

    <!-- Ground -->
    <rect x="0" y="200" width="360" height="30" fill="#dde3ec"/>
    <line x1="0" y1="200" x2="360" y2="200" stroke="#7a8ba0" stroke-width="1.5"/>
    <g font-family="Consolas, monospace" font-size="6" fill="#7a8ba0">
        <text x="6" y="212">GRADE</text>
        <line x1="10" y1="216" x2="60" y2="216" stroke="#7a8ba0" stroke-width="0.6"/>
        <line x1="14" y1="216" x2="10" y2="220" stroke="#7a8ba0" stroke-width="0.6"/>
        <line x1="22" y1="216" x2="18" y2="220" stroke="#7a8ba0" stroke-width="0.6"/>
        <line x1="30" y1="216" x2="26" y2="220" stroke="#7a8ba0" stroke-width="0.6"/>
        <line x1="38" y1="216" x2="34" y2="220" stroke="#7a8ba0" stroke-width="0.6"/>
        <line x1="46" y1="216" x2="42" y2="220" stroke="#7a8ba0" stroke-width="0.6"/>
        <line x1="54" y1="216" x2="50" y2="220" stroke="#7a8ba0" stroke-width="0.6"/>
    </g>

    <!-- Building shell — 3 storey cross section -->
    <g class="building-shell">
        <!-- Roof slab + parapet -->
        <rect x="190" y="40" width="160" height="5" fill="#7a8ba0"/>
        <rect x="188" y="34" width="4" height="11" fill="#5a6a80"/>
        <rect x="346" y="34" width="4" height="11" fill="#5a6a80"/>
        <!-- Floor 3 -->
        <rect x="190" y="45" width="160" height="48" fill="#fafcff" stroke="#2a5298" stroke-width="1"/>
        <line x1="190" y1="93" x2="350" y2="93" stroke="#7a8ba0" stroke-width="2.5"/>
        <!-- Floor 2 -->
        <rect x="190" y="93" width="160" height="48" fill="#fafcff" stroke="#2a5298" stroke-width="1"/>
        <line x1="190" y1="141" x2="350" y2="141" stroke="#7a8ba0" stroke-width="2.5"/>
        <!-- Floor 1 -->
        <rect x="190" y="141" width="160" height="59" fill="#fafcff" stroke="#2a5298" stroke-width="1"/>
        <!-- Storey labels -->
        <g font-family="Consolas, monospace" font-size="6.5" fill="#5a6a80">
            <text x="194" y="56">L3</text>
            <text x="194" y="104">L2</text>
            <text x="194" y="153">L1</text>
        </g>
        <!-- Windows (3 per floor on east facade) -->
        <g fill="#cfe2ff" stroke="#2a5298" stroke-width="0.6">
            <rect x="266" y="62" width="20" height="22"/>
            <rect x="294" y="62" width="20" height="22"/>
            <rect x="322" y="62" width="20" height="22"/>
            <rect x="266" y="110" width="20" height="22"/>
            <rect x="294" y="110" width="20" height="22"/>
            <rect x="322" y="110" width="20" height="22"/>
            <rect x="266" y="158" width="20" height="22"/>
            <rect x="294" y="158" width="20" height="22"/>
            <rect x="322" y="158" width="20" height="22"/>
        </g>
    </g>

    <!-- Empty state -->
    <g class="empty-state">
        <rect x="40" y="80" width="280" height="60" fill="#fff" stroke="#cfd8e3"
              stroke-width="1" stroke-dasharray="4 3" rx="3"/>
        <text x="180" y="108" text-anchor="middle" font-size="11" fill="#7a8ba0"
              font-family="Consolas, monospace">Select an HVAC system to view its schematic</text>
        <text x="180" y="124" text-anchor="middle" font-size="8" fill="#9aa7b8"
              font-family="Consolas, monospace">family + fuel + (for NECB) building archetype</text>
    </g>

    <!-- ============================================================ -->
    <!-- NECB SYSTEM 3 — PSZ-AC (rooftop unit, single-zone CV)         -->
    <!-- ============================================================ -->
    <g class="sys-necb-3">
        <!-- Rooftop unit -->
        <rect x="230" y="22" width="90" height="18" rx="2" fill="#fff"
              stroke="#1a3a6c" stroke-width="1.2"/>
        <rect x="234" y="26" width="14" height="10" fill="#e6f0ff" stroke="#1a3a6c" stroke-width="0.6"/>
        <g class="rtu-fan">
            <line x1="241" y1="27" x2="241" y2="35" stroke="#1a3a6c" stroke-width="1"/>
            <line x1="237" y1="31" x2="245" y2="31" stroke="#1a3a6c" stroke-width="1"/>
        </g>
        <rect x="252" y="26" width="20" height="10" fill="#fff7e6" stroke="#a06000" stroke-width="0.6"/>
        <text x="262" y="33" text-anchor="middle" font-size="5" fill="#a06000">DX+HC</text>
        <rect x="276" y="26" width="40" height="10" fill="#fff" stroke="#1a3a6c" stroke-width="0.5"/>
        <text x="296" y="33" text-anchor="middle" font-size="5.5" fill="#1a3a6c" font-weight="600">PSZ-AC RTU</text>

        <!-- Supply duct (red) — vertical riser + horizontal trunk per floor -->
        <rect x="218" y="45" width="10" height="155" fill="#e74c3c" opacity="0.18"/>
        <line x1="218" y1="45" x2="218" y2="200" stroke="#c0392b" stroke-width="0.8"/>
        <line x1="228" y1="45" x2="228" y2="200" stroke="#c0392b" stroke-width="0.8"/>
        <!-- Supply diffusers (ceiling, each floor) -->
        <g class="duct-supply">
            <rect x="228" y="50" width="116" height="4" fill="#e74c3c" opacity="0.55"/>
            <rect x="228" y="98" width="116" height="4" fill="#e74c3c" opacity="0.55"/>
            <rect x="228" y="146" width="116" height="4" fill="#e74c3c" opacity="0.55"/>
            <!-- Diffuser tabs -->
            <rect x="260" y="54" width="6" height="3" fill="#c0392b"/>
            <rect x="295" y="54" width="6" height="3" fill="#c0392b"/>
            <rect x="325" y="54" width="6" height="3" fill="#c0392b"/>
            <rect x="260" y="102" width="6" height="3" fill="#c0392b"/>
            <rect x="295" y="102" width="6" height="3" fill="#c0392b"/>
            <rect x="325" y="102" width="6" height="3" fill="#c0392b"/>
            <rect x="260" y="150" width="6" height="3" fill="#c0392b"/>
            <rect x="295" y="150" width="6" height="3" fill="#c0392b"/>
            <rect x="325" y="150" width="6" height="3" fill="#c0392b"/>
        </g>
        <!-- Return duct (blue) — second riser -->
        <line x1="232" y1="45" x2="232" y2="200" stroke="#2e6da6" stroke-width="1.5" stroke-dasharray="3 2"/>
        <text x="232" y="195" font-size="5.5" fill="#2e6da6" transform="rotate(-90 232 195)">RA</text>

        <!-- Baseboards (perimeter, each floor) -->
        <rect x="262" y="88" width="80" height="3" fill="#f39c12"/>
        <rect x="262" y="136" width="80" height="3" fill="#f39c12"/>
        <rect x="262" y="194" width="80" height="3" fill="#f39c12"/>

        <!-- Annotation callouts -->
        <g font-family="Consolas, monospace" font-size="6" fill="#5a6a80">
            <text x="234" y="68">SA duct</text>
            <text x="262" y="68" fill="#a06000">Perimeter BB</text>
        </g>
    </g>

    <!-- ============================================================ -->
    <!-- NECB SYSTEM 6 — Built-up VAV with reheat                      -->
    <!-- ============================================================ -->
    <g class="sys-necb-6">
        <!-- Penthouse AHU -->
        <rect x="200" y="20" width="140" height="20" rx="2" fill="#fff"
              stroke="#1a3a6c" stroke-width="1.2"/>
        <rect x="204" y="24" width="18" height="12" fill="#e6f4ff" stroke="#2e6da6" stroke-width="0.6"/>
        <text x="213" y="32" text-anchor="middle" font-size="4.5" fill="#2e6da6">CHW</text>
        <rect x="224" y="24" width="18" height="12" fill="#fff7e6" stroke="#a06000" stroke-width="0.6"/>
        <text x="233" y="32" text-anchor="middle" font-size="4.5" fill="#a06000">HW</text>
        <rect x="244" y="24" width="14" height="12" fill="#fff" stroke="#1a3a6c" stroke-width="0.6"/>
        <g class="ahu-fan">
            <line x1="251" y1="25" x2="251" y2="35" stroke="#1a3a6c" stroke-width="1"/>
            <line x1="247" y1="30" x2="255" y2="30" stroke="#1a3a6c" stroke-width="1"/>
        </g>
        <text x="298" y="34" text-anchor="middle" font-size="6.5" fill="#1a3a6c" font-weight="600">Built-up VAV AHU</text>

        <!-- Supply riser (red) -->
        <rect x="217" y="40" width="8" height="160" fill="#e74c3c" opacity="0.18"/>
        <line x1="217" y1="40" x2="217" y2="200" stroke="#c0392b" stroke-width="0.8"/>
        <line x1="225" y1="40" x2="225" y2="200" stroke="#c0392b" stroke-width="0.8"/>

        <!-- VAV boxes + reheat coil per floor -->
        <g class="vav-box">
            <rect x="225" y="60" width="26" height="11" rx="1" fill="#fff" stroke="#a06000" stroke-width="0.8"/>
            <rect x="244" y="62" width="5" height="7" fill="#fff7e6" stroke="#a06000" stroke-width="0.5"/>
            <text x="238" y="68" text-anchor="middle" font-size="4.5" fill="#a06000" font-weight="600">VAV+RH</text>
            <rect x="251" y="63" width="93" height="3" fill="#e74c3c" opacity="0.55"/>
            <rect x="280" y="66" width="5" height="3" fill="#c0392b"/>
            <rect x="310" y="66" width="5" height="3" fill="#c0392b"/>
            <rect x="335" y="66" width="5" height="3" fill="#c0392b"/>
        </g>
        <g class="vav-box">
            <rect x="225" y="108" width="26" height="11" rx="1" fill="#fff" stroke="#a06000" stroke-width="0.8"/>
            <rect x="244" y="110" width="5" height="7" fill="#fff7e6" stroke="#a06000" stroke-width="0.5"/>
            <text x="238" y="116" text-anchor="middle" font-size="4.5" fill="#a06000" font-weight="600">VAV+RH</text>
            <rect x="251" y="111" width="93" height="3" fill="#e74c3c" opacity="0.55"/>
            <rect x="280" y="114" width="5" height="3" fill="#c0392b"/>
            <rect x="310" y="114" width="5" height="3" fill="#c0392b"/>
            <rect x="335" y="114" width="5" height="3" fill="#c0392b"/>
        </g>
        <g class="vav-box">
            <rect x="225" y="156" width="26" height="11" rx="1" fill="#fff" stroke="#a06000" stroke-width="0.8"/>
            <rect x="244" y="158" width="5" height="7" fill="#fff7e6" stroke="#a06000" stroke-width="0.5"/>
            <text x="238" y="164" text-anchor="middle" font-size="4.5" fill="#a06000" font-weight="600">VAV+RH</text>
            <rect x="251" y="159" width="93" height="3" fill="#e74c3c" opacity="0.55"/>
            <rect x="280" y="162" width="5" height="3" fill="#c0392b"/>
            <rect x="310" y="162" width="5" height="3" fill="#c0392b"/>
            <rect x="335" y="162" width="5" height="3" fill="#c0392b"/>
        </g>

        <!-- Return riser (dashed blue) -->
        <line x1="232" y1="40" x2="232" y2="200" stroke="#2e6da6" stroke-width="1.5" stroke-dasharray="3 2"/>

        <!-- Baseboards -->
        <rect x="262" y="88" width="80" height="3" fill="#f39c12"/>
        <rect x="262" y="136" width="80" height="3" fill="#f39c12"/>
        <rect x="262" y="194" width="80" height="3" fill="#f39c12"/>

        <!-- Plant equipment: cooling tower + chiller + boiler -->
        <g class="plant-equip">
            <!-- Cooling tower (outdoor) -->
            <rect x="44" y="80" width="38" height="48" rx="2" fill="#fff"
                  stroke="#1a3a6c" stroke-width="1.2"/>
            <line x1="44" y1="92" x2="82" y2="92" stroke="#1a3a6c" stroke-width="0.6"/>
            <g class="ct-fan">
                <circle cx="63" cy="105" r="9" fill="none" stroke="#1a3a6c" stroke-width="0.8"/>
                <line x1="54" y1="105" x2="72" y2="105" stroke="#1a3a6c" stroke-width="1"/>
                <line x1="63" y1="96" x2="63" y2="114" stroke="#1a3a6c" stroke-width="1"/>
                <line x1="57" y1="99" x2="69" y2="111" stroke="#1a3a6c" stroke-width="1"/>
                <line x1="69" y1="99" x2="57" y2="111" stroke="#1a3a6c" stroke-width="1"/>
            </g>
            <text x="63" y="142" text-anchor="middle" font-size="6.5" fill="#1a3a6c" font-weight="600">Cooling tower</text>
            <!-- Chiller -->
            <rect x="90" y="155" width="50" height="32" rx="2" fill="#fff"
                  stroke="#2e6da6" stroke-width="1.2"/>
            <circle cx="105" cy="170" r="6" fill="#e6f4ff" stroke="#2e6da6" stroke-width="0.6"/>
            <text x="105" y="173" text-anchor="middle" font-size="5" fill="#2e6da6">CHW</text>
            <text x="128" y="170" text-anchor="middle" font-size="5.5" fill="#2e6da6">chiller</text>
            <text x="115" y="183" text-anchor="middle" font-size="5.5" fill="#1a3a6c" font-weight="600">Chiller (CHW)</text>
            <!-- Boiler -->
            <rect x="148" y="155" width="34" height="32" rx="2" fill="#fff"
                  stroke="#a06000" stroke-width="1.2"/>
            <circle cx="165" cy="170" r="7" fill="#fff7e6" stroke="#a06000" stroke-width="0.6"/>
            <text x="165" y="173" text-anchor="middle" font-size="5" fill="#a06000">HW</text>
            <text x="165" y="183" text-anchor="middle" font-size="5.5" fill="#1a3a6c" font-weight="600">Boiler</text>

            <!-- Condenser-water loop (cooling tower ↔ chiller) -->
            <path d="M82,115 Q92,115 92,140 Q92,155 100,155" stroke="#9aa7b8"
                  stroke-width="1.2" fill="none" stroke-dasharray="2 2"/>
            <!-- CHW loop (chiller → AHU) -->
            <path d="M125,155 Q125,140 200,40" stroke="#2e6da6" stroke-width="0.8"
                  fill="none" stroke-dasharray="4 2"/>
            <!-- HW loop (boiler → AHU + baseboards) -->
            <path d="M165,155 Q165,135 200,40" stroke="#a06000" stroke-width="0.8"
                  fill="none" stroke-dasharray="4 2"/>
        </g>
    </g>

    <!-- ============================================================ -->
    <!-- NECB SYSTEM 1 — PTAC + baseboards (dwelling units)            -->
    <!-- ============================================================ -->
    <g class="sys-necb-1">
        <!-- Optional MAU on roof -->
        <rect x="250" y="24" width="60" height="14" rx="2" fill="#fff"
              stroke="#1a3a6c" stroke-width="1"/>
        <text x="280" y="34" text-anchor="middle" font-size="5.5" fill="#1a3a6c" font-weight="600">Optional MAU</text>

        <!-- PTAC unit below each window -->
        <g class="ptac-units">
            <rect x="266" y="82" width="20" height="5" rx="0.5" fill="#fff" stroke="#1a3a6c" stroke-width="1"/>
            <rect x="294" y="82" width="20" height="5" rx="0.5" fill="#fff" stroke="#1a3a6c" stroke-width="1"/>
            <rect x="322" y="82" width="20" height="5" rx="0.5" fill="#fff" stroke="#1a3a6c" stroke-width="1"/>
            <rect x="266" y="130" width="20" height="5" rx="0.5" fill="#fff" stroke="#1a3a6c" stroke-width="1"/>
            <rect x="294" y="130" width="20" height="5" rx="0.5" fill="#fff" stroke="#1a3a6c" stroke-width="1"/>
            <rect x="322" y="130" width="20" height="5" rx="0.5" fill="#fff" stroke="#1a3a6c" stroke-width="1"/>
            <rect x="266" y="178" width="20" height="5" rx="0.5" fill="#fff" stroke="#1a3a6c" stroke-width="1"/>
            <rect x="294" y="178" width="20" height="5" rx="0.5" fill="#fff" stroke="#1a3a6c" stroke-width="1"/>
            <rect x="322" y="178" width="20" height="5" rx="0.5" fill="#fff" stroke="#1a3a6c" stroke-width="1"/>
            <!-- Cooling fins (small slots) on each PTAC -->
            <g stroke="#1a3a6c" stroke-width="0.4" opacity="0.6">
                <line x1="270" y1="84" x2="270" y2="86"/><line x1="274" y1="84" x2="274" y2="86"/><line x1="278" y1="84" x2="278" y2="86"/><line x1="282" y1="84" x2="282" y2="86"/>
                <line x1="298" y1="84" x2="298" y2="86"/><line x1="302" y1="84" x2="302" y2="86"/><line x1="306" y1="84" x2="306" y2="86"/><line x1="310" y1="84" x2="310" y2="86"/>
            </g>
        </g>

        <!-- Perimeter baseboards -->
        <rect x="200" y="88" width="64" height="3" fill="#f39c12"/>
        <rect x="200" y="136" width="64" height="3" fill="#f39c12"/>
        <rect x="200" y="194" width="64" height="3" fill="#f39c12"/>

        <!-- Annotation: secondary system (System 6) for common areas -->
        <g class="necb-secondary-callout">
            <line x1="194" y1="120" x2="180" y2="120" stroke="#7a8ba0" stroke-width="0.6" stroke-dasharray="2 2"/>
            <rect x="100" y="105" width="80" height="30" rx="2" fill="#fffef5" stroke="#a06000" stroke-width="0.6"/>
            <text x="140" y="116" text-anchor="middle" font-size="6" fill="#1a3a6c" font-weight="700">+ System 6 (VAV)</text>
            <text x="140" y="125" text-anchor="middle" font-size="5.5" fill="#5a6a80">for corridors &amp;</text>
            <text x="140" y="132" text-anchor="middle" font-size="5.5" fill="#5a6a80">common areas (≥3 storeys)</text>
        </g>
    </g>

    <!-- ============================================================ -->
    <!-- HEAT PUMP SYSTEMS — outdoor unit + refrigerant lines          -->
    <!-- ============================================================ -->
    <g class="hp-unit">
        <!-- Pad -->
        <rect x="42" y="186" width="100" height="6" fill="#9aa7b8"/>
        <!-- Outdoor unit chassis -->
        <rect x="50" y="120" width="80" height="66" rx="3" fill="#fff"
              stroke="#1a3a6c" stroke-width="1.5"/>
        <!-- Compressor symbol -->
        <circle cx="118" cy="170" r="6" fill="#e6f0ff" stroke="#1a3a6c" stroke-width="0.6"/>
        <text x="118" y="172" text-anchor="middle" font-size="5" fill="#1a3a6c" font-weight="700">C</text>
        <!-- Fan grille -->
        <rect x="56" y="126" width="56" height="46" rx="2" fill="#f5f9ff" stroke="#1a3a6c" stroke-width="0.6"/>
        <g class="hp-fan">
            <circle cx="84" cy="149" r="20" fill="none" stroke="#1a3a6c" stroke-width="1"/>
            <line x1="84" y1="129" x2="84" y2="169" stroke="#1a3a6c" stroke-width="1.5"/>
            <line x1="64" y1="149" x2="104" y2="149" stroke="#1a3a6c" stroke-width="1.5"/>
            <line x1="70" y1="135" x2="98" y2="163" stroke="#1a3a6c" stroke-width="1.5"/>
            <line x1="98" y1="135" x2="70" y2="163" stroke="#1a3a6c" stroke-width="1.5"/>
            <circle cx="84" cy="149" r="2.5" fill="#1a3a6c"/>
        </g>
        <!-- Service valves -->
        <rect x="128" y="135" width="6" height="3" fill="#c0392b"/>
        <rect x="128" y="142" width="6" height="3" fill="#2e6da6"/>
        <text x="90" y="181" text-anchor="middle" font-size="6" fill="#1a3a6c" font-weight="600">Outdoor Heat Pump</text>

        <!-- Refrigerant lines (hot-gas / liquid red, suction blue) -->
        <path d="M134,136 L190,136" stroke="#c0392b" stroke-width="2"
              stroke-dasharray="6 3" fill="none" class="refrig-line refrig-supply"
              marker-end="url(#hvac-arrow-red)"/>
        <path d="M190,143 L134,143" stroke="#2e6da6" stroke-width="2"
              stroke-dasharray="6 3" fill="none" class="refrig-line refrig-return"
              marker-end="url(#hvac-arrow-blue)"/>
        <text x="162" y="132" text-anchor="middle" font-size="5.5" fill="#a02020"
              font-family="Consolas, monospace">liquid / hot-gas</text>
        <text x="162" y="155" text-anchor="middle" font-size="5.5" fill="#205aa0"
              font-family="Consolas, monospace">suction</text>
    </g>

    <!-- Heat pump distribution: VRF cassettes (one row per floor) -->
    <g class="dist-vrf-vis">
        <g fill="#f39c12">
            <rect x="200" y="50" width="140" height="4" rx="0.5" opacity="0.4"/>
            <rect x="210" y="50" width="12" height="6"/>
            <rect x="245" y="50" width="12" height="6"/>
            <rect x="280" y="50" width="12" height="6"/>
            <rect x="315" y="50" width="12" height="6"/>
            <rect x="200" y="98" width="140" height="4" rx="0.5" opacity="0.4"/>
            <rect x="210" y="98" width="12" height="6"/>
            <rect x="245" y="98" width="12" height="6"/>
            <rect x="280" y="98" width="12" height="6"/>
            <rect x="315" y="98" width="12" height="6"/>
            <rect x="200" y="146" width="140" height="4" rx="0.5" opacity="0.4"/>
            <rect x="210" y="146" width="12" height="6"/>
            <rect x="245" y="146" width="12" height="6"/>
            <rect x="280" y="146" width="12" height="6"/>
            <rect x="315" y="146" width="12" height="6"/>
        </g>
        <text x="270" y="218" text-anchor="middle" font-size="6.5"
              fill="#a06000" font-family="Consolas, monospace">VRF ceiling cassettes (per zone)</text>
    </g>

    <!-- Heat pump distribution: Baseboards -->
    <g class="dist-baseboard-vis">
        <rect x="200" y="88" width="148" height="3" fill="#f39c12"/>
        <rect x="200" y="136" width="148" height="3" fill="#f39c12"/>
        <rect x="200" y="194" width="148" height="3" fill="#f39c12"/>
        <text x="270" y="218" text-anchor="middle" font-size="6.5"
              fill="#a06000" font-family="Consolas, monospace">Perimeter hydronic / electric baseboards</text>
    </g>

    <!-- Heat pump distribution: PTHP through-wall units -->
    <g class="dist-pthp-vis">
        <g fill="#f39c12" stroke="#a06000" stroke-width="0.6">
            <rect x="266" y="82" width="20" height="5"/><rect x="294" y="82" width="20" height="5"/><rect x="322" y="82" width="20" height="5"/>
            <rect x="266" y="130" width="20" height="5"/><rect x="294" y="130" width="20" height="5"/><rect x="322" y="130" width="20" height="5"/>
            <rect x="266" y="178" width="20" height="5"/><rect x="294" y="178" width="20" height="5"/><rect x="322" y="178" width="20" height="5"/>
        </g>
        <text x="270" y="218" text-anchor="middle" font-size="6.5"
              fill="#a06000" font-family="Consolas, monospace">PTHP through-wall units (per zone)</text>
    </g>

    <!-- ============================================================ -->
    <!-- HEATING SOURCES — engineering symbols (no emoji)              -->
    <!-- ============================================================ -->

    <!-- HP backup: NG boiler -->
    <g class="backup-gas">
        <rect x="148" y="115" width="44" height="34" rx="2" fill="#fff"
              stroke="#a06000" stroke-width="1.2"/>
        <circle cx="170" cy="132" r="9" fill="#fff7e6" stroke="#a06000" stroke-width="0.8"/>
        <path d="M168,138 L168,130 L172,134 L172,138 Z M168,130 L172,126 L172,134 Z"
              fill="#e67e22" class="flame-shape"/>
        <text x="170" y="160" text-anchor="middle" font-size="6"
              fill="#a06000" font-weight="700" font-family="Consolas, monospace">NG backup boiler</text>
    </g>

    <!-- HP backup: electric resistance -->
    <g class="backup-elec">
        <rect x="148" y="115" width="44" height="34" rx="2" fill="#fff"
              stroke="#7a4ec9" stroke-width="1.2"/>
        <rect x="155" y="122" width="30" height="20" fill="#f4efff" stroke="#7a4ec9" stroke-width="0.6"/>
        <path d="M157,132 L161,128 L165,132 L169,128 L173,132 L177,128 L181,132 L183,128"
              stroke="#7a4ec9" stroke-width="1.4" fill="none"/>
        <text x="170" y="160" text-anchor="middle" font-size="6"
              fill="#7a4ec9" font-weight="700" font-family="Consolas, monospace">Electric backup</text>
    </g>

    <!-- NECB primary: NG boiler / furnace -->
    <g class="primary-gas">
        <rect x="44" y="110" width="80" height="58" rx="3" fill="#fff"
              stroke="#a06000" stroke-width="1.4"/>
        <circle cx="84" cy="138" r="14" fill="#fff7e6" stroke="#a06000" stroke-width="0.8"/>
        <path d="M81,148 L81,138 L86,143 L86,148 Z M81,138 L86,131 L86,143 Z"
              fill="#e67e22" class="flame-shape"/>
        <rect x="74" y="118" width="20" height="6" fill="#fff" stroke="#a06000" stroke-width="0.6"/>
        <text x="84" y="123" text-anchor="middle" font-size="4.5" fill="#a06000">flue</text>
        <text x="84" y="180" text-anchor="middle" font-size="7"
              fill="#a06000" font-weight="700" font-family="Consolas, monospace">NG Boiler / Furnace</text>
    </g>

    <!-- NECB primary: electric -->
    <g class="primary-elec">
        <rect x="44" y="110" width="80" height="58" rx="3" fill="#fff"
              stroke="#7a4ec9" stroke-width="1.4"/>
        <rect x="56" y="122" width="56" height="30" fill="#f4efff" stroke="#7a4ec9" stroke-width="0.6"/>
        <path d="M58,138 L64,130 L70,138 L76,130 L82,138 L88,130 L94,138 L100,130 L106,138 L110,134"
              stroke="#7a4ec9" stroke-width="1.6" fill="none"/>
        <text x="84" y="180" text-anchor="middle" font-size="7"
              fill="#7a4ec9" font-weight="700" font-family="Consolas, monospace">Electric heating</text>
    </g>
</svg>
`;

function mountHvacDiagram() {
    const host = document.getElementById('hvacDiagram');
    if (host && !host.firstElementChild) {
        host.innerHTML = HVAC_DIAGRAM_SVG;
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
    let primary = '—';
    if (family === 'CCASHP')           primary = 'Cold Climate Air Source Heat Pump (electric refrigerant cycle)';
    else if (family === 'ASHP')        primary = 'Air Source Heat Pump (electric refrigerant cycle)';
    else if (isNECB) {
        if (primarySys) {
            const fuelTag = fuel === 'NaturalGas'   ? ' — natural gas fuelled'
                          : fuel === 'Electricity'  ? ' — electrically fuelled'
                          : '';
            primary = `${primarySys.label}${fuelTag}. ${primarySys.primary}.`;
        } else if (fuel === 'NaturalGas') {
            primary = 'Natural Gas boiler / furnace (NECB default — select a building archetype to see the exact system)';
        } else if (fuel === 'Electricity') {
            primary = 'Electric heating (NECB default — select a building archetype to see the exact system)';
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
    let distribution = '—';
    if (isHP && type)         distribution = typeLabels[type] || type;
    else if (isNECB && primarySys) distribution = primarySys.distribution;
    else if (isNECB)          distribution = 'NECB default zoning (depends on building archetype)';

    // ---- Backup heating + derived fuel value ----
    let backup       = '—';
    let derivedFuel  = '—';
    let note         = '';
    if (fuel === 'NaturalGas') {
        if (isHP) {
            backup      = 'Natural Gas — boiler / furnace loop (used during very cold hours)';
            derivedFuel = 'NaturalGasHPGasBackup (auto-derived)';
            note        = 'The heat pump remains the primary heating source. Natural gas is the supplementary backup, used when the heat pump cannot meet load.';
        } else {
            backup      = 'N/A — natural gas is the primary heat source';
            derivedFuel = 'NaturalGas';
        }
    } else if (fuel === 'Electricity') {
        if (isHP) {
            backup      = 'Electric resistance — supplementary heating during very cold hours';
            derivedFuel = 'ElectricityHPElecBackup (auto-derived)';
            note        = 'The heat pump remains the primary heating source. Electric resistance is the supplementary backup.';
        } else {
            backup      = 'N/A — electricity is the primary heat source';
            derivedFuel = 'Electricity';
        }
    }

    // For NECB default, append the archetype-driven NECB note (and secondary
    // system note for mixed-use buildings like apartments).
    if (isNECB && necbMapping) {
        const extra = secondarySys
            ? `${necbMapping.note} Common areas use ${secondarySys.label}.`
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
    const shwDisplay = shw ? (shwLabels[shw] || shw) : '—';

    // ---- Write to the DOM ----
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    set('hvacSummaryPrimary',      primary);
    set('hvacSummaryDistribution', distribution);
    set('hvacSummaryBackup',       backup);
    set('hvacSummarySHW',          shwDisplay);
    set('hvacSummaryEcm',          (ecmHidden && ecmHidden.value) || '—');
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
    // the hidden #building_type select — see surrogate-wizard.js).
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
    const variableParameter = formData.get('variableParameter');
    const rangeType = formData.get('rangeType');
    const customMin = formData.get('customMin');
    const customMax = formData.get('customMax');
    const customStep = formData.get('customStep');
    
    // Get cost analysis parameters
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
    
    console.log('Building Configuration:', buildingConfig);
    console.log('Analysis Type:', analysisType);
    console.log('Variable Parameter:', variableParameter);
    console.log('Range Type:', rangeType);
    
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
    
    // Validate alternative analysis selection
    if (analysisType === 'alternative' && !variableParameter) {
        alert('Please select a parameter to vary for alternative configuration analysis.');
        return;
    }
    
    // Validate custom range inputs
    if (analysisType === 'alternative' && rangeType === 'custom') {
        if (!customMin || !customMax || !customStep) {
            alert('Please enter minimum, maximum, and step values for custom range.');
            return;
        }
        const min = parseFloat(customMin);
        const max = parseFloat(customMax);
        const step = parseFloat(customStep);
        
        if (isNaN(min) || isNaN(max) || isNaN(step)) {
            alert('Please enter valid numeric values for min, max, and step.');
            return;
        }
        if (min >= max) {
            alert('Minimum value must be less than maximum value.');
            return;
        }
        if (step <= 0) {
            alert('Step value must be greater than zero.');
            return;
        }
        
        const numValues = Math.floor((max - min) / step) + 1;
        if (numValues > 50) {
            alert(`Your custom range would generate ${numValues} configurations. Please limit to 50 or fewer by adjusting your step size.`);
            return;
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
            // Alternative configuration analysis
            const customRange = rangeType === 'custom' ? {
                min: parseFloat(customMin),
                max: parseFloat(customMax),
                step: parseFloat(customStep)
            } : null;
            
            const excelBlob = await generateMultiConfigExcelFile(buildingConfig, variableParameter, customRange);
            
            // Upload to API
            results = await uploadAndPredict(excelBlob);
            results.analysisType = 'alternative';
            results.variableParameter = variableParameter;
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

// Generate Excel file with multiple configurations for alternative analysis
async function generateMultiConfigExcelFile(config, variableParameter, customRange = null) {
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
    
    console.log('Generating configurations for parameter:', variableParameter);
    console.log('Custom range:', customRange);
    
    let variations;
    
    if (customRange) {
        // Generate custom range values
        variations = [];
        for (let v = customRange.min; v <= customRange.max + 0.0001; v += customRange.step) {
            // Round to avoid floating point precision issues
            variations.push(parseFloat(v.toFixed(6)));
        }
        console.log(`Generated ${variations.length} custom values:`, variations);
    } else {
        // Use predefined default variations
        const parameterVariations = {
            'ecm_system_name': [
                'NECB_Default',
                'HS08_CCASHP_VRF',
                'HS09_CCASHP_Baseboard',
                'HS11_ASHP_PTHP',
                'HS12_ASHP_Baseboard',
                'HS13_ASHP_VRF'
            ],
            'ext_wall_cond': [0.183, 0.210, 0.247, 0.278, 0.314],
            'ext_roof_cond': [0.121, 0.138, 0.142, 0.162, 0.183, 0.193, 0.227],
            'fixed_window_cond': [1.6, 2.2, 2.4],
            'fixed_wind_solar_trans': [0.2, 0.3, 0.4, 0.5, 0.6],
            'fdwr_set': [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.69],
            'srr_set': ['NECB_Default', 0.03, 0.05, 0.08, 0.1],
            'boiler_eff': [
                'NECB_Default',
                'NECB 88% Efficient Condensing Boiler',
                'Viessmann Vitocrossal 300 CT3-17 96.2% Efficient Condensing Gas Boiler'
            ],
            'furnace_eff': [
                'NECB_Default',
                'NECB 85% Efficient Condensing Gas Furnace'
            ],
            'shw_eff': [
                'NECB_Default',
                'Natural Gas Direct Vent with Electric Ignition',
                'Natural Gas Power Vent with Electric Ignition'
            ]
        };
        
        variations = parameterVariations[variableParameter];
        if (!variations) {
            throw new Error(`No variations defined for parameter: ${variableParameter}`);
        }
    }
    
    const rows = [];
    const numConfigs = variations.length;
    
    console.log(`Creating ${numConfigs} configurations for ${variableParameter}`);
    
    // Create configurations based on the number of variations available
    for (let i = 0; i < numConfigs; i++) {
        // Create a copy of all defaults
        const row = { ...allDefaults };
        
        // Override with user-selected values (the 19 configurable parameters)
        const userParams = [
            'ecm_system_name', 'primary_heating_fuel', 'boiler_eff', 'furnace_eff', 'shw_eff',
            'dcv_type', 'erv_package', 'airloop_economizer_type', 'nv_type',
            'ext_wall_cond', 'ext_roof_cond', 'fixed_window_cond', 'fixed_wind_solar_trans', 'fdwr_set',
            'srr_set', 'building_type', 'rotation_degrees', 'epw_file', 'pv_ground_type'
        ];
        
        userParams.forEach(param => {
            const key = ':' + param;
            if (config[key] !== undefined) {
                row[key] = config[key];
            }
        });

        // Keep the legacy ComStock column in sync with the user's selection so the
        // backend's auto config selection doesn't pick the stale default value.
        if (config[':building_type'] !== undefined) {
            row['bldg_standards_building_type'] = config[':building_type'];
        }

        // Inject per-archetype geometry so the surrogate model receives
        // the right geometry for the chosen archetype.
        applyArchetypeGeometry(row, config[':building_type']);

        // Override the variable parameter with the specific variation value
        const variableKey = ':' + variableParameter;
        row[variableKey] = variations[i];
        
        console.log(`Configuration ${i + 1}: ${variableParameter} = ${variations[i]}`);
        
        rows.push(row);
    }
    
    // Create worksheet from the data (5 rows)
    const ws = XLSX.utils.json_to_sheet(rows);
    
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
        
        // Get parameter value
        const paramValue = energyData[':' + results.variableParameter] || costData[':' + results.variableParameter] || i + 1;
        
        configs.push({
            index: i + 1,
            paramValue: paramValue,
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
    
    // Get parameter display name
    const parameterNames = {
        'ext_wall_cond': 'External Wall Thermal Conductance (W/m²·K)',
        'ext_roof_cond': 'External Roof Thermal Conductance (W/m²·K)',
        'fixed_window_cond': 'Window Thermal Conductance (W/m²·K)',
        'fixed_wind_solar_trans': 'Window Solar Heat Gain Coefficient',
        'fdwr_set': 'Window-to-Wall Ratio (%)',
        'srr_set': 'Skylight-to-Roof Ratio (%)',
        'boiler_eff': 'Boiler Efficiency',
        'furnace_eff': 'Furnace Efficiency',
        'shw_eff': 'Service Hot Water Efficiency'
    };
    
    const parameterDisplayName = parameterNames[results.variableParameter] || results.variableParameter;
    
    // Build HTML
    let htmlContent = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h3 style="margin: 0;">Alternative Configuration Analysis: ${parameterDisplayName}</h3>
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
                        <th style="padding: 15px; text-align: left;">Parameter Value</th>
                        <th style="padding: 15px; text-align: right;">Total Energy (GJ/m²)</th>
                        <th style="padding: 15px; text-align: right;">Total Cost (CAD/m²)</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    configs.forEach((config, idx) => {
        const rowBg = idx % 2 === 0 ? '#f8f9ff' : 'white';
        htmlContent += `
            <tr style="background: ${rowBg}; border-bottom: 1px solid #e1e8ed; cursor: pointer; transition: background 0.2s;" 
                onmouseover="this.style.background='#e6f2ff'" 
                onmouseout="this.style.background='${rowBg}'"
                onclick="toggleConfigDetails(${config.index})">
                <td style="padding: 12px; font-weight: bold;">Config ${config.index} <span style="color: #667eea; font-size: 12px;">▼</span></td>
                <td style="padding: 12px;">${config.paramValue}</td>
                <td style="padding: 12px; text-align: right; font-family: monospace;">${config.totalEnergy.toFixed(6)}</td>
                <td style="padding: 12px; text-align: right;">$${config.totalCost.toFixed(2)}</td>
            </tr>
            <tr id="details-${config.index}" style="display: none; background: #f0f4ff;">
                <td colspan="4" style="padding: 20px;">
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
    storeConfigsForPDF(configs, parameterDisplayName, results);
    
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
function storeConfigsForPDF(configs, parameterDisplayName, results) {
    globalConfigs = configs;
    globalParameterDisplayName = parameterDisplayName;
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
    doc.text(`Parameter Analyzed: ${globalParameterDisplayName}`, 15, yPos);
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
    
    // Table headers
    doc.setFillColor(102, 126, 234);
    doc.setTextColor(255, 255, 255);
    doc.rect(15, yPos, pageWidth - 30, 8, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Config', 20, yPos + 5.5);
    doc.text('Parameter Value', 50, yPos + 5.5);
    doc.text('Energy (GJ/m²)', 110, yPos + 5.5);
    doc.text('Cost (CAD/m²)', 155, yPos + 5.5);
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
        doc.rect(15, yPos, pageWidth - 30, 7, 'F');
        
        doc.text(`${config.index}`, 20, yPos + 5);
        doc.text(`${config.paramValue}`, 50, yPos + 5);
        doc.text(`${config.totalEnergy.toFixed(6)}`, 110, yPos + 5);
        doc.text(`$${config.totalCost.toFixed(2)}`, 155, yPos + 5);
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
        doc.text(`Configuration ${config.index} - Parameter Value: ${config.paramValue}`, 20, yPos + 5.5);
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
