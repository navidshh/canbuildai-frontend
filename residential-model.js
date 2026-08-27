'use strict';

const HOT2000_API = window.location.hostname === 'localhost'
    ? 'http://localhost:18000'
    : 'https://48u1s1snk6.execute-api.ca-central-1.amazonaws.com';

function checkAuthentication() {
    const accessToken = sessionStorage.getItem('accessToken');
    const idToken = sessionStorage.getItem('idToken');

    if (!accessToken || !idToken) {
        window.location.href = 'auth.html';
        return false;
    }

    document.getElementById('user-email').textContent = sessionStorage.getItem('userEmail') || 'Signed in';
    return true;
}

function handleLogout() {
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('idToken');
    sessionStorage.removeItem('userEmail');
    window.location.href = 'auth.html';
}

function configureOtherFields() {
    document.querySelectorAll('select[data-other-field]').forEach((select) => {
        const input = document.getElementById(select.dataset.otherField);
        const update = () => {
            const usesCustomValue = select.value === 'Other';
            input.hidden = !usesCustomValue;
            input.required = usesCustomValue;
            if (!usesCustomValue) input.value = '';
        };
        select.addEventListener('change', update);
        update();
    });
}

function fieldValue(form, name) {
    const select = form.elements[name];
    if (select instanceof HTMLSelectElement && select.value === 'Other') {
        return document.getElementById(select.dataset.otherField).value.trim();
    }
    return typeof select.value === 'string' ? select.value.trim() : select.value;
}

function metricMarkup(metric, summary = false) {
    const className = summary ? 'summary-item' : 'metric-row';
    return `
        <div class="${className}">
            <p class="metric-label">${metric.label}</p>
            <p class="metric-value">${metric.value}${metric.unit ? `<span class="metric-unit">${metric.unit}</span>` : ''}</p>
        </div>`;
}

function renderResults(result) {
    document.getElementById('euiLabel').textContent = result.eui.label;
    document.getElementById('euiValue').textContent = result.eui.value;
    document.getElementById('euiUnit').textContent = result.eui.unit;
    document.getElementById('euiSource').textContent = result.eui_source === 'reported' ? 'Source-reported EUI' : 'Calculated EUI';
    document.getElementById('summaryMetrics').innerHTML = result.summary_metrics.map((metric) => metricMarkup(metric, true)).join('');
    document.getElementById('buildingMetrics').innerHTML = result.building_metrics.map((metric) => metricMarkup(metric)).join('');
    document.getElementById('energyMetrics').innerHTML = result.energy_metrics.map((metric) => metricMarkup(metric)).join('');
    document.getElementById('heatLossMetrics').innerHTML = result.heat_loss_metrics.map((metric) => metricMarkup(metric)).join('');

    const downloadButton = document.getElementById('downloadButton');
    downloadButton.href = `${HOT2000_API}${result.download_path}`;
    downloadButton.setAttribute('download', result.filename);

    document.getElementById('inputView').hidden = true;
    document.getElementById('resultsView').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitModel(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const runButton = document.getElementById('runButton');
    const status = document.getElementById('formStatus');

    if (!form.reportValidity()) return;

    const payload = {
        houseregion: fieldValue(form, 'houseregion'),
        clientpcode: fieldValue(form, 'clientpcode'),
        typeofhouse: fieldValue(form, 'typeofhouse'),
        storeys: fieldValue(form, 'storeys'),
        footprint: Number(fieldValue(form, 'footprint')),
        fndtype: fieldValue(form, 'fndtype'),
        furnacefuel: fieldValue(form, 'furnacefuel'),
        furnacetype: fieldValue(form, 'furnacetype'),
        pdhwfuel: fieldValue(form, 'pdhwfuel'),
        pdhwtype: fieldValue(form, 'pdhwtype'),
        aircondtype: fieldValue(form, 'aircondtype')
    };

    status.hidden = true;
    runButton.disabled = true;
    runButton.querySelector('span').textContent = 'Matching model...';

    try {
        const response = await fetch(`${HOT2000_API}/api/predict`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${sessionStorage.getItem('idToken')}`
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Unable to generate a representative model.');
        renderResults(result);
    } catch (error) {
        status.textContent = error.message || 'Unable to connect to the HOT2000 service.';
        status.hidden = false;
    } finally {
        runButton.disabled = false;
        runButton.querySelector('span').textContent = 'Generate representative model';
    }
}

function showInputView() {
    document.getElementById('resultsView').hidden = true;
    document.getElementById('inputView').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuthentication()) return;
    configureOtherFields();
    document.getElementById('logoutButton').addEventListener('click', handleLogout);
    document.getElementById('residentialForm').addEventListener('submit', submitModel);
    document.getElementById('newModelButton').addEventListener('click', showInputView);
});