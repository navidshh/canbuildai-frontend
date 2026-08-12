'use strict';

const API_BASE_URL = 'https://r5v9vscw74.execute-api.ca-central-1.amazonaws.com';

const FIELD_GROUPS = [
    {
        id: 'building',
        title: 'Building Profile',
        description: 'Describe the building form, use, age, and ownership.',
        fields: [
            'in.sqft',
            'in.comstock_building_type',
            'in.ashrae_iecc_climate_zone_2006',
            'in.year_built',
            'in.number_of_stories',
            'in.ownership_type',
            'in.aspect_ratio',
            'in.rotation..degrees'
        ]
    },
    {
        id: 'envelope',
        title: 'Envelope',
        description: 'Set the construction, glazing, and thermal characteristics.',
        fields: [
            'in.airtightness..m3_per_m2_s',
            'in.wall_construction_type',
            'in.window_type',
            'out.params.window_to_wall_ratio',
            'out.params.average_window_u_value..btu_per_ft2_f_hr',
            'out.params.average_wall_u_value..btu_per_ft2_f_hr',
            'out.params.average_roof_u_value..btu_per_ft2_f_hr',
            'out.params.average_window_shgc'
        ]
    },
    {
        id: 'systems',
        title: 'HVAC & Water',
        description: 'Configure heating, cooling, ventilation, and service water systems.',
        fields: [
            'in.heating_fuel',
            'in.hvac_category',
            'in.hvac_system_type',
            'in.hvac_combined_type',
            'in.hvac_heat_type',
            'in.hvac_cool_type',
            'in.hvac_vent_type',
            'in.hvac_night_variability',
            'in.service_water_heating_fuel',
            'out.params.dx_cooling_design_cop..cop',
            'out.params.dx_heating_design_cop..cop',
            'out.params.broiler_fuel_type',
            'out.params.hot_water_volume..m3'
        ]
    },
    {
        id: 'operations',
        title: 'Operations',
        description: 'Define schedules, lighting, equipment, and occupancy intensity.',
        fields: [
            'in.interior_lighting_generation',
            'in.weekday_opening_time..hr',
            'in.weekday_operating_hours..hr',
            'in.weekend_opening_time..hr',
            'in.weekend_operating_hours..hr',
            'out.params.interior_lighting_power_density..w_per_ft2',
            'out.params.interior_electric_equipment_power_density..w_per_ft2',
            'out.params.occupant_density_ppl_per_m_2..people_per_m2'
        ]
    },
    {
        id: 'controls',
        title: 'Controls & Context',
        description: 'Review control setpoints, fan performance, and community context.',
        fields: [
            'out.params.average_cooling_setpoint_max..c',
            'out.params.average_cooling_setpoint_min..c',
            'out.params.average_heating_setpoint_max..c',
            'out.params.average_heating_setpoint_min..c',
            'out.params.air_system_fan_power_minimum_flow_fraction',
            'out.params.air_system_fan_static_pressure..inwc',
            'out.params.air_system_fan_total_efficiency',
            'in.ejscreen_census_tract_percentile_for_people_over_64',
            'in.ejscreen_census_tract_percentile_for_less_than_hs_educ',
            'in.ejscreen_census_tract_percentile_percent_people_under_5',
            'in.ejscreen_census_tract_percentile_for_low_income'
        ]
    }
];

const FIELD_LABELS = {
    'in.sqft': 'Floor area (sq ft)',
    'in.comstock_building_type': 'Building type',
    'in.ashrae_iecc_climate_zone_2006': 'ASHRAE climate zone',
    'in.year_built': 'Year built',
    'in.number_of_stories': 'Number of stories',
    'in.ownership_type': 'Ownership type',
    'in.aspect_ratio': 'Building aspect ratio',
    'in.rotation..degrees': 'Building rotation (degrees)',
    'in.airtightness..m3_per_m2_s': 'Airtightness (m3/m2-s)',
    'in.wall_construction_type': 'Wall construction',
    'in.window_type': 'Window assembly',
    'out.params.window_to_wall_ratio': 'Window-to-wall ratio',
    'out.params.average_window_u_value..btu_per_ft2_f_hr': 'Average window U-value (Btu/ft2-F-hr)',
    'out.params.average_wall_u_value..btu_per_ft2_f_hr': 'Average wall U-value (Btu/ft2-F-hr)',
    'out.params.average_roof_u_value..btu_per_ft2_f_hr': 'Average roof U-value (Btu/ft2-F-hr)',
    'out.params.average_window_shgc': 'Average window SHGC',
    'in.heating_fuel': 'Primary heating fuel',
    'in.hvac_category': 'HVAC category',
    'in.hvac_system_type': 'HVAC system type',
    'in.hvac_combined_type': 'Combined HVAC configuration',
    'in.hvac_heat_type': 'Heating equipment type',
    'in.hvac_cool_type': 'Cooling equipment type',
    'in.hvac_vent_type': 'Ventilation type',
    'in.hvac_night_variability': 'Night operation strategy',
    'in.service_water_heating_fuel': 'Service water heating fuel',
    'out.params.dx_cooling_design_cop..cop': 'DX cooling design COP',
    'out.params.dx_heating_design_cop..cop': 'DX heating design COP',
    'out.params.broiler_fuel_type': 'Boiler fuel type',
    'out.params.hot_water_volume..m3': 'Hot water volume (m3)',
    'in.interior_lighting_generation': 'Interior lighting generation',
    'in.weekday_opening_time..hr': 'Weekday opening time (hour)',
    'in.weekday_operating_hours..hr': 'Weekday operating duration (hours)',
    'in.weekend_opening_time..hr': 'Weekend opening time (hour)',
    'in.weekend_operating_hours..hr': 'Weekend operating duration (hours)',
    'out.params.interior_lighting_power_density..w_per_ft2': 'Lighting power density (W/ft2)',
    'out.params.interior_electric_equipment_power_density..w_per_ft2': 'Equipment power density (W/ft2)',
    'out.params.occupant_density_ppl_per_m_2..people_per_m2': 'Occupant density (people/m2)',
    'out.params.average_cooling_setpoint_max..c': 'Maximum cooling setpoint (C)',
    'out.params.average_cooling_setpoint_min..c': 'Minimum cooling setpoint (C)',
    'out.params.average_heating_setpoint_max..c': 'Maximum heating setpoint (C)',
    'out.params.average_heating_setpoint_min..c': 'Minimum heating setpoint (C)',
    'out.params.air_system_fan_power_minimum_flow_fraction': 'Fan minimum flow fraction',
    'out.params.air_system_fan_static_pressure..inwc': 'Fan static pressure (in. w.c.)',
    'out.params.air_system_fan_total_efficiency': 'Fan total efficiency',
    'in.ejscreen_census_tract_percentile_for_people_over_64': 'Community percentile: people over 64',
    'in.ejscreen_census_tract_percentile_for_less_than_hs_educ': 'Community percentile: less than high-school education',
    'in.ejscreen_census_tract_percentile_percent_people_under_5': 'Community percentile: people under 5',
    'in.ejscreen_census_tract_percentile_for_low_income': 'Community percentile: low income'
};

const FIELD_HINTS = {
    'in.sqft': 'Conditioned floor area used to select comparable buildings.',
    'in.comstock_building_type': 'Choose the closest ComStock occupancy archetype.',
    'in.ashrae_iecc_climate_zone_2006': 'Climate classification for weather-sensitive matching.',
    'in.aspect_ratio': 'Ratio of the long building dimension to the short dimension.',
    'in.airtightness..m3_per_m2_s': 'Envelope air leakage at the model reference pressure.',
    'out.params.window_to_wall_ratio': 'Enter as a decimal fraction, for example 0.30 for 30%.',
    'out.params.average_window_shgc': 'Solar heat gain coefficient from 0 to 1.',
    'in.hvac_combined_type': 'Detailed combined heating, cooling, and distribution configuration.',
    'in.hvac_night_variability': 'How the HVAC system behaves outside occupied hours.',
    'out.params.dx_cooling_design_cop..cop': 'Use 0 only when DX cooling is not present.',
    'out.params.dx_heating_design_cop..cop': 'Use 0 only when DX heating is not present.',
    'out.params.air_system_fan_power_minimum_flow_fraction': 'Minimum airflow as a fraction of design flow.',
    'out.params.air_system_fan_total_efficiency': 'Combined fan and motor efficiency as a decimal.',
    'in.ejscreen_census_tract_percentile_for_people_over_64': 'Percentile value from 0 to 100.',
    'in.ejscreen_census_tract_percentile_for_less_than_hs_educ': 'Percentile value from 0 to 100.',
    'in.ejscreen_census_tract_percentile_percent_people_under_5': 'Percentile value from 0 to 100.',
    'in.ejscreen_census_tract_percentile_for_low_income': 'Percentile value from 0 to 100.'
};

const SPECIAL_OPTIONS = {
    'out.params.broiler_fuel_type': ['Gas', 'Electricity', 'Propane', 'FuelOil', 'DistrictHeating']
};

const FIELD_BOUNDS = {
    'out.params.window_to_wall_ratio': { min: 0, max: 1 },
    'out.params.average_window_shgc': { min: 0, max: 1 },
    'out.params.air_system_fan_power_minimum_flow_fraction': { min: 0, max: 1 },
    'out.params.air_system_fan_total_efficiency': { min: 0, max: 1 },
    'in.ejscreen_census_tract_percentile_for_people_over_64': { min: 0, max: 100 },
    'in.ejscreen_census_tract_percentile_for_less_than_hs_educ': { min: 0, max: 100 },
    'in.ejscreen_census_tract_percentile_percent_people_under_5': { min: 0, max: 100 },
    'in.ejscreen_census_tract_percentile_for_low_income': { min: 0, max: 100 }
};

const plannerState = {
    currentStep: 1,
    maxVisitedStep: 1,
    inputColumns: [],
    outputColumns: [],
    allColumns: [],
    sampleValues: {},
    columnOptions: {},
    batchFile: null,
    predictionResults: null,
    ready: false
};

window.addEventListener('DOMContentLoaded', initializeRetrofitPlanner);

async function initializeRetrofitPlanner() {
    initializeAuthentication();
    bindPageEvents();

    try {
        const [optionsResponse, sampleResponse] = await Promise.all([
            fetch('column_options.json'),
            fetch('input_data.csv')
        ]);

        if (!optionsResponse.ok || !sampleResponse.ok) {
            throw new Error('Could not load the model input schema.');
        }

        plannerState.columnOptions = await optionsResponse.json();
        loadSampleSchema(await sampleResponse.text());
        validateFieldConfiguration();
        renderFieldGroups();
        plannerState.ready = true;
        updateSchemaStatus('48 model inputs ready', 'ready');
        updateWizard();
    } catch (error) {
        console.error('Retrofit planner initialization failed:', error);
        updateSchemaStatus(error.message, 'error');
    }
}

function initializeAuthentication() {
    const userEmail = sessionStorage.getItem('userEmail');
    if (!userEmail) {
        window.location.href = 'auth.html';
        return;
    }

    document.getElementById('user-email').textContent = userEmail;
}

function bindPageEvents() {
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    document.getElementById('backToHubBtn').addEventListener('click', () => {
        window.location.href = 'hub.html';
    });
    document.getElementById('wizardBackBtn').addEventListener('click', () => showStep(plannerState.currentStep - 1));
    document.getElementById('wizardNextBtn').addEventListener('click', handleNextStep);
    document.getElementById('runPredictionBtn').addEventListener('click', runGuidedPrediction);
    document.getElementById('downloadInputBtn').addEventListener('click', downloadGuidedInput);
    document.getElementById('downloadResultsBtn').addEventListener('click', downloadResults);
    document.getElementById('resetPlannerBtn').addEventListener('click', resetPlanner);
    document.getElementById('downloadTemplateBtn').addEventListener('click', downloadTemplate);
    document.getElementById('columnExplorerBtn').addEventListener('click', () => window.open('column-explorer.html', '_blank'));
    document.getElementById('batchPredictBtn').addEventListener('click', runBatchPrediction);

    document.querySelectorAll('.retrofit-step-marker').forEach(marker => {
        marker.addEventListener('click', () => {
            const step = Number(marker.dataset.step);
            if (step <= plannerState.maxVisitedStep) {
                showStep(step);
            }
        });
    });

    const fileInput = document.getElementById('fileInput');
    const uploadZone = document.getElementById('uploadZone');
    fileInput.addEventListener('change', event => {
        if (event.target.files[0]) handleBatchFile(event.target.files[0]);
    });
    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            fileInput.click();
        }
    });
    uploadZone.addEventListener('dragover', event => {
        event.preventDefault();
        uploadZone.classList.add('drag-over');
    });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
    uploadZone.addEventListener('drop', event => {
        event.preventDefault();
        uploadZone.classList.remove('drag-over');
        if (event.dataTransfer.files[0]) handleBatchFile(event.dataTransfer.files[0]);
    });
}

function loadSampleSchema(csvText) {
    const workbook = XLSX.read(csvText, { type: 'string' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    if (rows.length < 2 || rows[0].length < 3) {
        throw new Error('The model input schema is empty or malformed.');
    }

    plannerState.allColumns = rows[0];
    plannerState.inputColumns = rows[0].slice(0, -2);
    plannerState.outputColumns = rows[0].slice(-2);
    plannerState.sampleValues = Object.fromEntries(
        plannerState.allColumns.map((column, index) => [column, rows[1][index]])
    );
}

function validateFieldConfiguration() {
    const configuredFields = FIELD_GROUPS.flatMap(group => group.fields);
    const missing = plannerState.inputColumns.filter(column => !configuredFields.includes(column));
    const unexpected = configuredFields.filter(column => !plannerState.inputColumns.includes(column));
    const duplicates = configuredFields.filter((column, index) => configuredFields.indexOf(column) !== index);

    if (plannerState.inputColumns.length !== 48 || missing.length || unexpected.length || duplicates.length) {
        throw new Error(`Input configuration mismatch. Missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}; duplicates: ${duplicates.join(', ') || 'none'}.`);
    }
}

function renderFieldGroups() {
    FIELD_GROUPS.forEach(group => {
        const container = document.getElementById(`fields-${group.id}`);
        container.replaceChildren(...group.fields.map(createField));
    });
}

function createField(column) {
    const wrapper = document.createElement('div');
    wrapper.className = 'retrofit-field';

    const label = document.createElement('label');
    label.htmlFor = fieldId(column);

    const labelText = document.createElement('span');
    labelText.textContent = FIELD_LABELS[column] || humanizeColumn(column);
    label.appendChild(labelText);

    const defaultValue = plannerState.sampleValues[column];
    const options = getFieldOptions(column);
    const useDropdown = options.length > 0 && options.length <= 500;
    const kind = document.createElement('span');
    kind.className = 'field-kind';
    kind.textContent = useDropdown ? 'Dropdown' : 'Number';
    label.appendChild(kind);

    const control = useDropdown
        ? createSelect(column, options, defaultValue)
        : createNumberInput(column, defaultValue);

    const hint = document.createElement('small');
    hint.textContent = FIELD_HINTS[column] || 'A model-valid starting value is preselected.';

    wrapper.append(label, control, hint);
    return wrapper;
}

function getFieldOptions(column) {
    const configured = SPECIAL_OPTIONS[column] || plannerState.columnOptions[column] || [];
    const defaultValue = plannerState.sampleValues[column];
    const uniqueValues = [...new Set(configured.map(String))];

    if (defaultValue !== '' && !uniqueValues.includes(String(defaultValue))) {
        uniqueValues.unshift(String(defaultValue));
    }

    return uniqueValues;
}

function createSelect(column, options, defaultValue) {
    const select = document.createElement('select');
    select.id = fieldId(column);
    select.dataset.column = column;
    select.required = true;

    options.forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = formatOption(value);
        option.selected = String(value) === String(defaultValue);
        select.appendChild(option);
    });

    return select;
}

function createNumberInput(column, defaultValue) {
    const input = document.createElement('input');
    input.id = fieldId(column);
    input.dataset.column = column;
    input.type = 'number';
    input.step = 'any';
    input.required = true;
    input.value = defaultValue;

    const bounds = FIELD_BOUNDS[column];
    if (bounds) {
        input.min = bounds.min;
        input.max = bounds.max;
    }

    return input;
}

function fieldId(column) {
    return `retrofit-${column.replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

function humanizeColumn(column) {
    return column
        .replace(/^(in|out\.params)\./, '')
        .replace(/\.\.[^.]+$/, '')
        .replaceAll('_', ' ')
        .replace(/\b\w/g, character => character.toUpperCase());
}

function formatOption(value) {
    return String(value)
        .replaceAll('_', ' ')
        .replace(/\b(necb|hvac|dx|vav|rtu|psz|shgc)\b/gi, match => match.toUpperCase());
}

function handleNextStep() {
    if (!plannerState.ready || !validateCurrentStep()) return;
    showStep(Math.min(6, plannerState.currentStep + 1));
}

function validateCurrentStep() {
    if (plannerState.currentStep === 6) return true;

    const activeStep = document.querySelector(`.retrofit-step[data-step="${plannerState.currentStep}"]`);
    const invalidControl = [...activeStep.querySelectorAll('[required]')].find(control => !control.checkValidity());
    if (invalidControl) {
        invalidControl.reportValidity();
        invalidControl.focus();
        return false;
    }

    return true;
}

function showStep(step) {
    if (step < 1 || step > 6 || !plannerState.ready) return;

    plannerState.currentStep = step;
    plannerState.maxVisitedStep = Math.max(plannerState.maxVisitedStep, step);
    if (step === 6) renderReview();
    updateWizard();
    document.querySelector('.retrofit-shell').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateWizard() {
    document.querySelectorAll('.retrofit-step').forEach(section => {
        section.classList.toggle('is-active', Number(section.dataset.step) === plannerState.currentStep);
    });

    document.querySelectorAll('.retrofit-step-marker').forEach(marker => {
        const step = Number(marker.dataset.step);
        marker.classList.toggle('is-active', step === plannerState.currentStep);
        marker.classList.toggle('is-complete', step < plannerState.currentStep || step < plannerState.maxVisitedStep);
        marker.disabled = !plannerState.ready || step > plannerState.maxVisitedStep;
        marker.setAttribute('aria-current', step === plannerState.currentStep ? 'step' : 'false');
    });

    const progress = ((plannerState.currentStep - 1) / 5) * 83;
    document.getElementById('retrofitProgress').style.setProperty('--retrofit-progress', `${progress}%`);
    document.getElementById('wizardBackBtn').style.visibility = plannerState.currentStep === 1 ? 'hidden' : 'visible';
    document.getElementById('wizardNextBtn').disabled = !plannerState.ready;
    document.getElementById('wizardNextBtn').style.display = plannerState.currentStep === 6 ? 'none' : 'inline-flex';
    document.getElementById('reviewActions').style.display = plannerState.currentStep === 6 ? 'flex' : 'none';
    document.getElementById('wizardStepCount').textContent = `Step ${plannerState.currentStep} of 6`;
}

function collectFormData() {
    return Object.fromEntries(plannerState.inputColumns.map(column => {
        const control = document.querySelector(`[data-column="${CSS.escape(column)}"]`);
        const sampleValue = plannerState.sampleValues[column];
        const value = typeof sampleValue === 'number' ? Number(control.value) : control.value;
        return [column, value];
    }));
}

function renderReview() {
    const values = collectFormData();
    const container = document.getElementById('retrofitReview');
    container.replaceChildren();

    FIELD_GROUPS.forEach((group, index) => {
        const section = document.createElement('section');
        section.className = 'review-group';

        const heading = document.createElement('h4');
        heading.textContent = group.title;

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'btn-link';
        editButton.textContent = 'Edit';
        editButton.addEventListener('click', () => showStep(index + 1));
        heading.append(' ', editButton);

        const list = document.createElement('dl');
        list.className = 'review-list';
        group.fields.forEach(column => {
            const term = document.createElement('dt');
            term.textContent = FIELD_LABELS[column] || humanizeColumn(column);
            const detail = document.createElement('dd');
            detail.textContent = formatOption(values[column]);
            list.append(term, detail);
        });

        section.append(heading, list);
        container.appendChild(section);
    });
}

function createGuidedWorkbook() {
    if (!plannerState.ready) throw new Error('The input schema is not ready.');

    const values = collectFormData();
    const row = plannerState.allColumns.map(column => (
        plannerState.inputColumns.includes(column) ? values[column] : ''
    ));
    const worksheet = XLSX.utils.aoa_to_sheet([plannerState.allColumns, row]);
    worksheet['!cols'] = plannerState.allColumns.map(() => ({ wch: 28 }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'ComStock_Input_Template');
    return workbook;
}

function guidedWorkbookFile() {
    const workbook = createGuidedWorkbook();
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    return new File([bytes], 'canbem_retrofit_input.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
}

async function runGuidedPrediction() {
    if (!plannerState.ready) return;
    await requestPrediction(guidedWorkbookFile());
}

function downloadGuidedInput() {
    if (!plannerState.ready) return;
    XLSX.writeFile(createGuidedWorkbook(), 'canbem_retrofit_input.xlsx');
}

async function handleBatchFile(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(extension)) {
        alert('Please select an Excel (.xlsx, .xls) or CSV file.');
        return;
    }

    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });
        const buildingCount = Math.max(0, rows.length - 1);

        if (!buildingCount) throw new Error('The file does not contain any building rows.');
        if (buildingCount > 1000) throw new Error(`Maximum 1000 buildings allowed; this file contains ${buildingCount}.`);

        plannerState.batchFile = file;
        document.getElementById('fileName').textContent = file.name;
        document.getElementById('buildingCount').textContent = buildingCount;
        document.getElementById('fileInfo').style.display = 'block';
        document.getElementById('batchPredictBtn').style.display = 'inline-flex';
    } catch (error) {
        plannerState.batchFile = null;
        alert(`Could not read this file: ${error.message}`);
    }
}

async function runBatchPrediction() {
    if (!plannerState.batchFile) {
        alert('Select a batch file first.');
        return;
    }
    await requestPrediction(plannerState.batchFile);
}

async function requestPrediction(file) {
    const runButtons = [document.getElementById('runPredictionBtn'), document.getElementById('batchPredictBtn')];
    runButtons.forEach(button => { button.disabled = true; });

    try {
        showProgress('Preparing building inputs...', 20);
        const base64Content = await fileToBase64(file);
        showProgress('Running energy and emissions models...', 50);

        const response = await fetch(`${API_BASE_URL}/retrofit/upload-base64`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, content: base64Content })
        });

        if (!response.ok) {
            let message = 'Prediction failed.';
            try {
                const errorData = await response.json();
                message = errorData.detail || errorData.message || message;
            } catch (_) {
                message = `${message} The service returned HTTP ${response.status}.`;
            }
            throw new Error(message);
        }

        showProgress('Preparing results...', 85);
        const results = await response.json();
        plannerState.predictionResults = results;
        showProgress('Complete', 100);
        displayResults(results);
    } catch (error) {
        console.error('Retrofit prediction failed:', error);
        alert(`Prediction could not be completed: ${error.message}`);
    } finally {
        window.setTimeout(hideProgress, 350);
        runButtons.forEach(button => { button.disabled = false; });
    }
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function displayResults(results) {
    const predictions = Array.isArray(results.predictions) ? results.predictions : [];
    if (!predictions.length) {
        throw new Error('The prediction service returned no building results.');
    }

    const averageEui = predictions.reduce((sum, prediction) => (
        sum + Number(prediction.predicted_values?.energy_use_intensity_kbtu_sqft || 0)
    ), 0) / predictions.length;
    const averageGhg = predictions.reduce((sum, prediction) => (
        sum + Number(prediction.predicted_values?.ghg_emissions_kg_co2e || 0)
    ), 0) / predictions.length;

    const stats = [
        ['Buildings analyzed', results.total_buildings ?? predictions.length],
        ['Average EUI', `${averageEui.toFixed(2)} kBtu/sq ft/yr`],
        ['Average GHG emissions', `${averageGhg.toFixed(0)} kg CO2e`],
        ['Processing time', `${(Number(results.total_processing_time_ms || 0) / 1000).toFixed(2)} s`]
    ];

    const statsGrid = document.getElementById('statsGrid');
    statsGrid.replaceChildren(...stats.map(([label, value]) => {
        const card = document.createElement('div');
        card.className = 'stat-card';
        const labelElement = document.createElement('div');
        labelElement.className = 'stat-label';
        labelElement.textContent = label;
        const valueElement = document.createElement('div');
        valueElement.className = 'stat-value';
        valueElement.textContent = value;
        card.append(labelElement, valueElement);
        return card;
    }));

    const tableBody = document.getElementById('resultsTableBody');
    tableBody.replaceChildren(...predictions.map((prediction, index) => {
        const values = prediction.predicted_values || {};
        const row = document.createElement('tr');
        const cells = [
            index + 1,
            values.building_type || 'Commercial',
            values.floor_area_sqft ? Number(values.floor_area_sqft).toLocaleString() : '-',
            values.climate_zone || '-',
            Number(values.energy_use_intensity_kbtu_sqft || 0).toFixed(2),
            Number(values.ghg_emissions_kg_co2e || 0).toLocaleString()
        ];
        cells.forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
        });
        return row;
    }));

    const resultsContainer = document.getElementById('resultsContainer');
    resultsContainer.style.display = 'block';
    resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function downloadResults() {
    if (!plannerState.predictionResults) return;

    const rows = plannerState.predictionResults.predictions.map((prediction, index) => ({
        'Building #': index + 1,
        'Building Type': prediction.predicted_values?.building_type || 'Commercial',
        'Floor Area (sqft)': prediction.predicted_values?.floor_area_sqft || 0,
        'Climate Zone': prediction.predicted_values?.climate_zone || 'Unknown',
        'Energy Use Intensity (kBtu/sqft/yr)': Number(prediction.predicted_values?.energy_use_intensity_kbtu_sqft || 0).toFixed(2),
        'GHG Emissions (kg CO2e)': prediction.predicted_values?.ghg_emissions_kg_co2e || 0,
        'ComStock ID': prediction.matched_comstock_id || '',
        'Model Used': prediction.model_used || '',
        'Processing Time (ms)': Number(prediction.processing_time_ms || 0).toFixed(2)
    }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Predictions');
    XLSX.writeFile(workbook, 'retrofit_planner_results.xlsx');
}

async function downloadTemplate() {
    try {
        const response = await fetch('comstock_input_template_with_dropdowns.xlsx');
        if (!response.ok) throw new Error('Template download failed.');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'comstock_input_template_with_dropdowns.xlsx';
        link.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        alert(error.message);
    }
}

function resetPlanner() {
    plannerState.predictionResults = null;
    plannerState.batchFile = null;
    plannerState.currentStep = 1;
    plannerState.maxVisitedStep = 1;
    document.getElementById('fileInput').value = '';
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('batchPredictBtn').style.display = 'none';
    document.getElementById('resultsContainer').style.display = 'none';
    renderFieldGroups();
    updateWizard();
    document.querySelector('.retrofit-shell').scrollIntoView({ behavior: 'smooth' });
}

function showProgress(message, percent) {
    document.getElementById('progressContainer').style.display = 'block';
    document.getElementById('progressFill').style.width = `${percent}%`;
    document.getElementById('progressFill').textContent = `${percent}%`;
    document.getElementById('progressText').textContent = message;
}

function hideProgress() {
    document.getElementById('progressContainer').style.display = 'none';
}

function updateSchemaStatus(message, state) {
    const status = document.getElementById('schemaStatus');
    status.textContent = message;
    status.className = `schema-status${state === 'ready' ? '' : ` is-${state}`}`;
}

function handleLogout() {
    sessionStorage.removeItem('userEmail');
    sessionStorage.removeItem('idToken');
    window.location.href = 'auth.html';
}

window.retrofitPlanner = {
    createGuidedWorkbook,
    collectFormData,
    getSchema: () => ({
        allColumns: [...plannerState.allColumns],
        inputColumns: [...plannerState.inputColumns],
        outputColumns: [...plannerState.outputColumns],
        ready: plannerState.ready
    })
};
