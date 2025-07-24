document.addEventListener('DOMContentLoaded', () => {
    // --- ESTADO GLOBAL DE LA APLICACIÓN ---
    const appState = {
        fileArca: null, fileContabilidad: null,
        dataArca: null, dataContabilidad: null,
        allArcaRecords: [], allContabilidadRecords: [],
        providerCuits: [],
        columnVisibility: {},
        manualSelection: {
            pending: new Set(),
            reconciled: new Set(),
            unmatched: new Set()
        },
    };

    // --- ELEMENTOS DE LA UI (Interfaz de Usuario) ---
    const ui = {
        themeToggle: document.getElementById("themeToggle"),
        menuItems: document.querySelectorAll('.sidebar-menu .menu-item'),
        toolContents: document.querySelectorAll('.tool-content'),
        toolTitle: document.getElementById('tool-title'),
        columnStyles: document.getElementById('column-styles'),
        reconciliationPanel: {
            panel: document.getElementById('manual-reconciliation-panel'),
            reconcileView: document.getElementById('reconciliation-mode-view'),
            deReconcileView: document.getElementById('dereconciliation-mode-view'),
            selectedArcaTotal: document.getElementById('selected-arca-total'),
            selectedContTotal: document.getElementById('selected-cont-total'),
            selectedNetTotal: document.getElementById('selected-net-total'),
            reconcileBtn: document.getElementById('reconcile-manual-btn'),
            selectedReconciledCount: document.getElementById('selected-reconciled-count'),
            deReconcileBtn: document.getElementById('de-reconcile-manual-btn'),
        },
        reconciler: {
            loaderOverlay: document.getElementById('loader-overlay'),
            dropZoneArca: document.getElementById('drop-zone-arca'),
            fileInputArca: document.getElementById('file-input-arca'),
            fileNameArca: document.getElementById('file-name-arca'),
            dropZoneContabilidad: document.getElementById('drop-zone-contabilidad'),
            fileInputContabilidad: document.getElementById('file-input-contabilidad'),
            fileNameContabilidad: document.getElementById('file-name-contabilidad'),
            columnMappingSection: document.getElementById('column-mapping-section'),
            selectCuitArca: document.getElementById('select-cuit-arca'),
            selectMontoArca: document.getElementById('select-monto-arca'),
            selectCuitContabilidad: document.getElementById('select-cuit-contabilidad'),
            selectMontoContabilidad: document.getElementById('select-monto-contabilidad'),
            processBtn: document.getElementById('process-btn'),
            messageBox: document.getElementById('message-box'),
            resultsSection: document.getElementById('results-section'),
            summaryArcaAmount: document.getElementById('summary-arca-amount'),
            summaryArcaCount: document.getElementById('summary-arca-count'),
            summaryReconciledAmount: document.getElementById('summary-reconciled-amount'),
            summaryReconciledCount: document.getElementById('summary-reconciled-count'),
            summaryPendingAmount: document.getElementById('summary-pending-amount'),
            summaryPendingCount: document.getElementById('summary-pending-count'),
            downloadBtn: document.getElementById('download-report-btn'),
            tablePending: document.getElementById('table-pending'),
        },
        providerAnalysis: {
            placeholder: document.getElementById('provider-analysis-placeholder'),
            content: document.getElementById('provider-analysis-content'),
            providerSelect: document.getElementById('provider-select'),
            detailContent: document.getElementById('provider-detail-content'),
            downloadBtn: document.getElementById('download-provider-report-btn'),
            tablePending: document.getElementById('table-provider-pending'),
            tableReconciled: document.getElementById('table-provider-reconciled'),
            tableUnmatchedContabilidad: document.getElementById('table-provider-unmatched-contabilidad'),
            summaryArca: document.getElementById('provider-summary-arca'),
            summaryContabilidad: document.getElementById('provider-summary-contabilidad'),
            summaryDiferencia: document.getElementById('provider-summary-diferencia'),
        }
    };
    
    // --- LÓGICA DE CONFIGURACIÓN DE COLUMNAS ---
    function applyColumnVisibilityStyles() {
        let styles = '';
        for (const tableId in appState.columnVisibility) {
            const tableConfig = appState.columnVisibility[tableId];
            const headers = tableConfig._headers || [];
            headers.forEach((header, index) => {
                if (!tableConfig[header]) {
                    const colIndex = index + (tableConfig._hasCheckboxes ? 2 : 1);
                    styles += `#${tableId} th:nth-child(${colIndex}), #${tableId} td:nth-child(${colIndex}) { display: none; }\n`;
                }
            });
        }
        ui.columnStyles.innerHTML = styles;
    }

    function generateColumnConfigurator(tableId, headers, hasCheckboxes) {
        const dropdown = document.querySelector(`[data-table-target="${tableId}"]`);
        if (!dropdown) return;
        dropdown.innerHTML = '';
        
        if (!appState.columnVisibility[tableId]) {
            appState.columnVisibility[tableId] = { _headers: headers, _hasCheckboxes: hasCheckboxes };
            headers.forEach(header => {
                appState.columnVisibility[tableId][header] = true;
            });
        }
        
        headers.forEach(header => {
            const item = document.createElement('div');
            item.className = 'column-config-item';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `check-${tableId}-${header.replace(/\s/g, '-')}`;
            checkbox.checked = appState.columnVisibility[tableId][header];
            checkbox.dataset.column = header;
            const label = document.createElement('label');
            label.htmlFor = checkbox.id;
            label.textContent = header;
            item.appendChild(checkbox);
            item.appendChild(label);
            dropdown.appendChild(item);
            item.addEventListener('click', (e) => {
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });
            checkbox.addEventListener('change', (e) => {
                appState.columnVisibility[tableId][e.target.dataset.column] = e.target.checked;
                applyColumnVisibilityStyles();
            });
        });
    }

    // --- FUNCIONES AUXILIARES GLOBALES ---
    const showMessage = (message, isError = false) => {
        const msgBox = ui.reconciler.messageBox;
        msgBox.textContent = message;
        msgBox.className = 'message-box';
        msgBox.classList.add(isError ? 'error' : 'success');
        msgBox.classList.remove('hidden');
    };
    
    const normalizeRecord = (record, cuitCol, montoCol) => {
        const cuit = String(record[cuitCol] || '').replace(/[^0-9]/g, '');
        const montoValue = record[montoCol];
        let monto;
        if (typeof montoValue === 'number') {
            monto = montoValue;
        } else {
            const montoStr = String(montoValue || '0').replace(/[^0-9,.]/g, '').replace(',', '.');
            monto = parseFloat(montoStr);
        }
        return { cuit, monto: isNaN(monto) ? 0 : monto, original: record };
    };
    
    const renderTable = (jsonData, tableElement, { maxRows = -1, showCheckboxes = false, recordSource = '' }) => {
        tableElement.innerHTML = '';
        if (!jsonData || jsonData.length === 0) {
            const tbody = document.createElement('tbody');
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.textContent = 'No se encontraron registros.';
            td.colSpan = "100%";
            td.style.textAlign = 'center';
            tr.appendChild(td);
            tbody.appendChild(tr);
            tableElement.appendChild(tbody);
            generateColumnConfigurator(tableElement.id, [], showCheckboxes);
            return;
        }
        const headers = Object.keys(jsonData[0]).filter(h => h !== '__originalIndex' && h !== 'matchId');
        generateColumnConfigurator(tableElement.id, headers, showCheckboxes);
        const dataToShow = maxRows === -1 ? jsonData : jsonData.slice(0, maxRows);
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        if (showCheckboxes) {
            const th = document.createElement('th');
            th.className = 'checkbox-cell';
            
            // --- NUEVO: Crear y configurar el checkbox "Seleccionar todo" ---
            const selectAllCheckbox = document.createElement('input');
            selectAllCheckbox.type = 'checkbox';
            selectAllCheckbox.title = 'Seleccionar todo';
            selectAllCheckbox.addEventListener('change', (e) => {
                const isChecked = e.target.checked;
                const bodyCheckboxes = tableElement.querySelectorAll('tbody input[type="checkbox"]');
                bodyCheckboxes.forEach(cb => {
                    cb.checked = isChecked;
                });
                handleManualSelection(); // Actualizar el estado y el panel
            });
            th.appendChild(selectAllCheckbox);
            headerRow.appendChild(th);
        }

        headers.forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        const tbody = document.createElement('tbody');
        dataToShow.forEach(rowData => {
            const tr = document.createElement('tr');
            if (showCheckboxes) {
                const td = document.createElement('td');
                td.className = 'checkbox-cell';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.dataset.index = rowData.__originalIndex;
                checkbox.dataset.source = recordSource;
                td.appendChild(checkbox);
                tr.appendChild(td);
            }
            headers.forEach(header => {
                const td = document.createElement('td');
                let value = rowData[header];
                if (value instanceof Date) { value = value.toLocaleDateString('es-AR'); } 
                else if (typeof value === 'number') { value = value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
                td.textContent = value ?? '';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        tableElement.appendChild(thead);
        tableElement.appendChild(tbody);
        applyColumnVisibilityStyles();
    };
    
    // --- LÓGICA DE NAVEGACIÓN Y VISUALIZACIÓN ---
    function setupNavigation() {
        ui.menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const tool = item.dataset.tool;
                ui.menuItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                ui.toolTitle.textContent = item.querySelector('span').textContent;
                ui.toolContents.forEach(content => {
                    content.classList.toggle('hidden', content.id !== `tool-${tool}`);
                });
                updateToolAvailability();
            });
        });
    }

    function updateToolAvailability() {
        const hasResults = appState.allArcaRecords.length > 0 || appState.allContabilidadRecords.length > 0;
        ui.providerAnalysis.placeholder.classList.toggle('hidden', hasResults);
        ui.providerAnalysis.content.classList.toggle('hidden', !hasResults);
        if (hasResults) {
            populateProviderSelector();
        }
    }

    // --- LÓGICA DEL CONCILIADOR (Herramienta 1) ---
    async function handleFileSelect(file, type) {
        if (!file) return;
        appState[`file${type}`] = file;
        const fileNameEl = ui.reconciler[`fileName${type}`];
        fileNameEl.innerHTML = `<span class="file-loaded">${file.name}</span>`;
        ui.reconciler.resultsSection.classList.add('hidden');
        ui.reconciler.messageBox.classList.add('hidden');
        appState.allArcaRecords = [];
        appState.allContabilidadRecords = [];
        updateToolAvailability();
        ui.reconciler.loaderOverlay.style.display = 'flex';
        try {
            const fileData = await file.arrayBuffer();
            const workbook = XLSX.read(fileData, { type: 'array', cellDates: true });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const data = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
            const headers = data.length > 0 ? Object.keys(data[0]) : [];
            appState[`data${type}`] = data;
            appState[`headers${type}`] = headers;
            populateColumnSelectors(type, headers);
        } catch (e) {
            console.error(`Error reading file ${type}:`, e);
            showMessage(`Error al leer el archivo ${type}. Asegúrate que sea un formato válido.`, true);
            appState[`file${type}`] = null;
            fileNameEl.innerHTML = `Arrastra el archivo de <span>${type}</span>`;
        } finally {
            ui.reconciler.loaderOverlay.style.display = 'none';
        }
        const bothFilesLoaded = appState.fileArca && appState.fileContabilidad;
        ui.reconciler.columnMappingSection.classList.toggle('hidden', !bothFilesLoaded);
        ui.reconciler.processBtn.disabled = !bothFilesLoaded;
    }

    function populateColumnSelectors(type, headers) {
        const { reconciler: recUI } = ui;
        if (type === 'Arca') {
            const cuitSelect = recUI.selectCuitArca;
            const montoSelect = recUI.selectMontoArca;
            cuitSelect.innerHTML = '<option value="">Selecciona Columna CUIT...</option>';
            montoSelect.innerHTML = '<option value="">Selecciona Columna Monto...</option>';
            headers.forEach(header => {
                cuitSelect.add(new Option(header, header));
                montoSelect.add(new Option(header, header));
            });
            cuitSelect.value = headers.find(h => h.toLowerCase().includes('cuit')) || '';
            montoSelect.value = headers.find(h => h.toLowerCase().includes('monto retenido')) || '';
        } else {
            const cuitSelect = recUI.selectCuitContabilidad;
            const montoSelect = recUI.selectMontoContabilidad;
            cuitSelect.innerHTML = '<option value="">Selecciona Columna CUIT...</option>';
            montoSelect.innerHTML = '<option value="">Selecciona Columna Monto...</option>';
            headers.forEach(header => {
                cuitSelect.add(new Option(header, header));
                montoSelect.add(new Option(header, header));
            });
            cuitSelect.value = headers.find(h => h.toLowerCase().includes('cuit')) || '';
            montoSelect.value = headers.find(h => h.toLowerCase().includes('crédito') || h.toLowerCase().includes('monto')) || '';
        }
    }
    
    async function processReconciliation() {
        const { reconciler: recUI } = ui;
        const cuitArcaCol = recUI.selectCuitArca.value, montoArcaCol = recUI.selectMontoArca.value;
        const cuitContCol = recUI.selectCuitContabilidad.value, montoContCol = recUI.selectMontoContabilidad.value;

        if (!cuitArcaCol || !montoArcaCol || !cuitContCol || !montoContCol) {
            showMessage('Debes seleccionar las columnas de CUIT y Monto para ambos archivos.', true);
            return;
        }
        recUI.loaderOverlay.style.display = 'flex';
        recUI.messageBox.classList.add('hidden');
        recUI.resultsSection.classList.add('hidden');
        await new Promise(resolve => setTimeout(resolve, 50));
        try {
            appState.allArcaRecords = appState.dataArca
                .filter(r => r && typeof r === 'object')
                .map((r, i) => ({ ...r, __originalIndex: i, Estado: 'Pendiente' }));
            
            appState.allContabilidadRecords = appState.dataContabilidad
                .filter(r => r && typeof r === 'object')
                .map((r, i) => ({ ...r, __originalIndex: i, Estado: 'Pendiente' }));

            const arcaNorm = appState.allArcaRecords.map(r => normalizeRecord(r, cuitArcaCol, montoArcaCol));
            const contNorm = appState.allContabilidadRecords.map(r => normalizeRecord(r, cuitContCol, montoContCol));
            let matchCounter = 0;

            arcaNorm.forEach(arcaRec => {
                const match = contNorm.find(contRec => 
                    !contRec.matched && 
                    contRec.cuit === arcaRec.cuit && 
                    contRec.monto.toFixed(2) === arcaRec.monto.toFixed(2)
                );
                if (match) {
                    const matchId = `auto_${++matchCounter}`;
                    arcaRec.matched = true;
                    match.matched = true;
                    appState.allArcaRecords[arcaRec.original.__originalIndex].Estado = 'Conciliada';
                    appState.allArcaRecords[arcaRec.original.__originalIndex].matchId = matchId;
                    appState.allContabilidadRecords[match.original.__originalIndex].Estado = 'Conciliada';
                    appState.allContabilidadRecords[match.original.__originalIndex].matchId = matchId;
                }
            });

            const allArcaCuits = appState.allArcaRecords.map(r => normalizeRecord(r, cuitArcaCol, null).cuit);
            const allContabilidadCuits = appState.allContabilidadRecords.map(r => normalizeRecord(r, cuitContCol, null).cuit);
            appState.providerCuits = [...new Set([...allArcaCuits, ...allContabilidadCuits])].filter(c => c).sort();
            
            displayGeneralResults();
            updateToolAvailability();
            showMessage('Conciliación completada.');
        } catch (e) {
            console.error("Error en processReconciliation:", e);
            showMessage('Ocurrió un error inesperado durante el proceso.', true);
        } finally {
            recUI.loaderOverlay.style.display = 'none';
        }
    }

    function displayGeneralResults() {
        const { reconciler: recUI } = ui;
        const arcaMontoCol = recUI.selectMontoArca.value;
        const arcaData = appState.allArcaRecords;
        const reconciled = arcaData.filter(r => r.Estado === 'Conciliada');
        const pending = arcaData.filter(r => r.Estado === 'Pendiente');
        const totalArca = appState.dataArca.reduce((sum, r) => sum + (normalizeRecord(r, null, arcaMontoCol).monto || 0), 0);
        const totalReconciled = reconciled.reduce((sum, r) => sum + (normalizeRecord(r, null, arcaMontoCol).monto || 0), 0);
        const totalPending = totalArca - totalReconciled;
        const formatCurrency = (num) => num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        recUI.summaryArcaAmount.textContent = `$${formatCurrency(totalArca)}`;
        recUI.summaryArcaCount.textContent = `${appState.dataArca.length} registros`;
        recUI.summaryReconciledAmount.textContent = `$${formatCurrency(totalReconciled)}`;
        recUI.summaryReconciledCount.textContent = `${reconciled.length} registros`;
        recUI.summaryPendingAmount.textContent = `$${formatCurrency(totalPending)}`;
        recUI.summaryPendingCount.textContent = `${pending.length} registros`;
        renderTable(pending, recUI.tablePending, { maxRows: 10 });
        recUI.resultsSection.classList.remove('hidden');
    }

    // --- LÓGICA DEL ANÁLISIS POR PROVEEDOR (Herramienta 2) ---
    function populateProviderSelector() {
        const { providerAnalysis: provUI } = ui;
        provUI.providerSelect.innerHTML = '<option value="">Seleccione un CUIT para ver el detalle...</option>';
        appState.providerCuits.forEach(cuit => {
            provUI.providerSelect.add(new Option(cuit, cuit));
        });
        provUI.detailContent.classList.add('hidden');
    }

    function displayProviderDetails() {
        const { providerAnalysis: provUI, reconciler: recUI } = ui;
        const selectedCuit = provUI.providerSelect.value;
        const formatCurrency = (num) => num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (!selectedCuit) {
            provUI.detailContent.classList.add('hidden');
            return;
        }
        const arcaCuitCol = recUI.selectCuitArca.value;
        const arcaMontoCol = recUI.selectMontoArca.value;
        const contCuitCol = recUI.selectCuitContabilidad.value;
        const contMontoCol = recUI.selectMontoContabilidad.value;
        const allArcaForProvider = appState.allArcaRecords.filter(r => normalizeRecord(r, arcaCuitCol, null).cuit === selectedCuit);
        const allContabilidadForProvider = appState.allContabilidadRecords.filter(r => normalizeRecord(r, contCuitCol, null).cuit === selectedCuit);
        const totalArcaProvider = allArcaForProvider.reduce((sum, r) => sum + normalizeRecord(r, arcaCuitCol, arcaMontoCol).monto, 0);
        const totalContabilidadProvider = allContabilidadForProvider.reduce((sum, r) => sum + normalizeRecord(r, contCuitCol, contMontoCol).monto, 0);
        const diferencia = totalArcaProvider - totalContabilidadProvider;
        provUI.summaryArca.textContent = `$${formatCurrency(totalArcaProvider)}`;
        provUI.summaryContabilidad.textContent = `$${formatCurrency(totalContabilidadProvider)}`;
        provUI.summaryDiferencia.textContent = `$${formatCurrency(diferencia)}`;
        
        const providerPending = allArcaForProvider.filter(r => r.Estado === 'Pendiente');
        const providerReconciled = allArcaForProvider.filter(r => r.Estado === 'Conciliada');
        const providerUnmatchedContabilidad = allContabilidadForProvider.filter(r => r.Estado === 'Pendiente');

        renderTable(providerPending, provUI.tablePending, { showCheckboxes: true, recordSource: 'pending' });
        renderTable(providerReconciled, provUI.tableReconciled, { showCheckboxes: true, recordSource: 'reconciled' });
        renderTable(providerUnmatchedContabilidad, provUI.tableUnmatchedContabilidad, { showCheckboxes: true, recordSource: 'unmatched' });
        
        provUI.detailContent.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', handleManualSelection);
        });
        
        provUI.detailContent.classList.remove('hidden');
    }
    
    // --- LÓGICA DE CONCILIACIÓN MANUAL ---
    function updateSelectAllCheckboxes() {
        const tables = [
            ui.providerAnalysis.tablePending,
            ui.providerAnalysis.tableReconciled,
            ui.providerAnalysis.tableUnmatchedContabilidad
        ];
        tables.forEach(table => {
            const headerCheckbox = table.querySelector('thead input[type="checkbox"]');
            if (!headerCheckbox) return;
            const bodyCheckboxes = Array.from(table.querySelectorAll('tbody input[type="checkbox"]'));
            if (bodyCheckboxes.length === 0) {
                headerCheckbox.checked = false;
                headerCheckbox.indeterminate = false;
                return;
            }
            const totalChecked = bodyCheckboxes.filter(cb => cb.checked).length;
            if (totalChecked === 0) {
                headerCheckbox.checked = false;
                headerCheckbox.indeterminate = false;
            } else if (totalChecked === bodyCheckboxes.length) {
                headerCheckbox.checked = true;
                headerCheckbox.indeterminate = false;
            } else {
                headerCheckbox.checked = false;
                headerCheckbox.indeterminate = true;
            }
        });
    }

    function handleManualSelection() {
        appState.manualSelection = { pending: new Set(), reconciled: new Set(), unmatched: new Set() };
        const { providerAnalysis: provUI } = ui;
        provUI.tablePending.querySelectorAll('tbody input[type="checkbox"]:checked').forEach(cb => appState.manualSelection.pending.add(parseInt(cb.dataset.index)));
        provUI.tableReconciled.querySelectorAll('tbody input[type="checkbox"]:checked').forEach(cb => appState.manualSelection.reconciled.add(parseInt(cb.dataset.index)));
        provUI.tableUnmatchedContabilidad.querySelectorAll('tbody input[type="checkbox"]:checked').forEach(cb => appState.manualSelection.unmatched.add(parseInt(cb.dataset.index)));
        
        updateSelectAllCheckboxes(); // Actualizar estado del checkbox de cabecera
        updateReconciliationPanel();
    }

    function updateReconciliationPanel() {
        const { panel, reconcileView, deReconcileView, reconcileBtn, ...rest } = ui.reconciliationPanel;
        const { pending, reconciled, unmatched } = appState.manualSelection;
        const formatCurrency = (num) => num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const { reconciler: recUI } = ui;
        
        const showReconcileMode = pending.size > 0 || unmatched.size > 0;
        const showDeReconcileMode = reconciled.size > 0;

        panel.classList.toggle('hidden', !showReconcileMode && !showDeReconcileMode);
        reconcileView.classList.toggle('hidden', !showReconcileMode || showDeReconcileMode);
        deReconcileView.classList.toggle('hidden', !showDeReconcileMode || showReconcileMode);

        if (showReconcileMode && !showDeReconcileMode) {
            const arcaTotal = [...pending].reduce((sum, index) => sum + normalizeRecord(appState.allArcaRecords[index], recUI.selectCuitArca.value, recUI.selectMontoArca.value).monto, 0);
            const contTotal = [...unmatched].reduce((sum, index) => sum + normalizeRecord(appState.allContabilidadRecords[index], recUI.selectCuitContabilidad.value, recUI.selectMontoContabilidad.value).monto, 0);
            const net = arcaTotal - contTotal;
            rest.selectedArcaTotal.textContent = `$${formatCurrency(arcaTotal)}`;
            rest.selectedContTotal.textContent = `$${formatCurrency(contTotal)}`;
            rest.selectedNetTotal.textContent = `$${formatCurrency(net)}`;
            rest.selectedNetTotal.style.color = Math.abs(net) < 0.01 ? 'var(--success-color)' : 'var(--danger-color)';
            reconcileBtn.disabled = !(Math.abs(net) < 0.01 && pending.size > 0 && unmatched.size > 0);
        }
        if (showDeReconcileMode && !showReconcileMode) {
            rest.selectedReconciledCount.textContent = reconciled.size;
        }
    }

    function executeManualReconciliation() {
        const { pending, unmatched } = appState.manualSelection;
        const matchId = `manual_${Date.now()}`;
        pending.forEach(index => {
            appState.allArcaRecords[index].Estado = 'Conciliada';
            appState.allArcaRecords[index].matchId = matchId;
        });
        unmatched.forEach(index => {
            appState.allContabilidadRecords[index].Estado = 'Conciliada';
            appState.allContabilidadRecords[index].matchId = matchId;
        });
        appState.manualSelection = { pending: new Set(), reconciled: new Set(), unmatched: new Set() };
        updateReconciliationPanel();
        displayProviderDetails();
    }

    function executeDereconciliation() {
        const { reconciled } = appState.manualSelection;
        reconciled.forEach(index => {
            const record = appState.allArcaRecords[index];
            const matchId = record.matchId;
            record.Estado = 'Pendiente';
            delete record.matchId;
            if (matchId) {
                const contRecord = appState.allContabilidadRecords.find(r => r.matchId === matchId);
                if (contRecord) {
                    contRecord.Estado = 'Pendiente';
                    delete contRecord.matchId;
                }
            }
        });
        appState.manualSelection = { pending: new Set(), reconciled: new Set(), unmatched: new Set() };
        updateReconciliationPanel();
        displayProviderDetails();
    }
    
    // --- LÓGICA DE DESCARGA ---
    function downloadReport(isGeneral = true) {
        if (appState.allArcaRecords.length === 0) {
            showMessage('No hay resultados para descargar.', true);
            return;
        }
        if (isGeneral) {
            downloadGeneralReport();
        } else {
            downloadProviderReport();
        }
    }

    function downloadGeneralReport() {
        const wb = XLSX.utils.book_new();
        const pending = appState.allArcaRecords.filter(r => r.Estado === 'Pendiente');
        const reconciled = appState.allArcaRecords.filter(r => r.Estado === 'Conciliada');
        const unmatchedContabilidad = appState.allContabilidadRecords.filter(r => r.Estado === 'Pendiente');
        
        if (pending.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pending.map(({__originalIndex, matchId, ...rest}) => rest)), "ARCA Pendiente");
        if (reconciled.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reconciled.map(({__originalIndex, matchId, ...rest}) => rest)), "Conciliadas");
        if (unmatchedContabilidad.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(unmatchedContabilidad.map(({__originalIndex, matchId, ...rest}) => rest)), "Contabilidad Sin Match");

        if (wb.SheetNames.length > 0) {
            XLSX.writeFile(wb, "Reporte_Conciliacion_General.xlsx");
        } else {
            showMessage('No hay datos en ninguna categoría para generar el reporte.', true);
        }
    }

    function downloadProviderReport() {
        const { providerAnalysis: provUI, reconciler: recUI } = ui;
        const selectedCuit = provUI.providerSelect.value;
        if (!selectedCuit) {
            showMessage('Por favor, selecciona un proveedor para descargar.', true);
            return;
        }
        const wb = XLSX.utils.book_new();
        const arcaCuitCol = recUI.selectCuitArca.value;
        const contCuitCol = recUI.selectCuitContabilidad.value;
        
        const filterByCuit = (data, cuitCol) => data.filter(record => normalizeRecord(record, cuitCol, null).cuit === selectedCuit);
        const cleanForExport = ({__originalIndex, matchId, ...rest}) => rest;

        const providerPending = filterByCuit(appState.allArcaRecords, arcaCuitCol).filter(r => r.Estado === 'Pendiente').map(cleanForExport);
        const providerReconciled = filterByCuit(appState.allArcaRecords, arcaCuitCol).filter(r => r.Estado === 'Conciliada').map(cleanForExport);
        const providerUnmatchedCont = filterByCuit(appState.allContabilidadRecords, contCuitCol).filter(r => r.Estado === 'Pendiente').map(cleanForExport);
        
        if (providerPending.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(providerPending), "ARCA Pendiente");
        if (providerReconciled.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(providerReconciled), "Conciliadas");
        if (providerUnmatchedCont.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(providerUnmatchedCont), "Contabilidad Sin Match");

        if (wb.SheetNames.length > 0) {
            XLSX.writeFile(wb, `Reporte_Proveedor_${selectedCuit}.xlsx`);
        } else {
            showMessage('No hay datos para exportar para este proveedor.', true);
        }
    }
    
    // --- INICIALIZACIÓN DE LA APP ---
    function initialize() {
        const currentTheme = localStorage.getItem("theme");
        if (currentTheme) { document.body.classList.add(currentTheme); if (currentTheme === "dark-mode") ui.themeToggle.checked = true; }
        ui.themeToggle.addEventListener("change", function() {
            document.body.classList.toggle("dark-mode", this.checked);
            localStorage.setItem("theme", this.checked ? "dark-mode" : "light-mode");
        });
        
        ['dragover', 'drop'].forEach(eventName => {
            window.addEventListener(eventName, e => e.preventDefault());
        });

        setupNavigation();
        
        function setupDropZone(dropZone, fileInput, onFileSelect) {
            dropZone.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => onFileSelect(e.target.files[0]));
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                dropZone.addEventListener(eventName, e => {
                    e.preventDefault();
                    e.stopPropagation();
                });
            });
            dropZone.addEventListener('dragover', () => dropZone.classList.add('dragover'));
            dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
            dropZone.addEventListener('drop', (e) => {
                dropZone.classList.remove('dragover');
                if (e.dataTransfer.files.length) onFileSelect(e.dataTransfer.files[0]);
            });
        }
        
        setupDropZone(ui.reconciler.dropZoneArca, ui.reconciler.fileInputArca, (file) => handleFileSelect(file, 'Arca'));
        setupDropZone(ui.reconciler.dropZoneContabilidad, ui.reconciler.fileInputContabilidad, (file) => handleFileSelect(file, 'Contabilidad'));
        
        ui.reconciler.processBtn.addEventListener('click', processReconciliation);
        ui.reconciler.downloadBtn.addEventListener('click', () => downloadReport(true));
        
        ui.providerAnalysis.providerSelect.addEventListener('change', () => {
            displayProviderDetails();
            appState.manualSelection = { pending: new Set(), reconciled: new Set(), unmatched: new Set() };
            updateReconciliationPanel();
        });
        ui.providerAnalysis.downloadBtn.addEventListener('click', () => downloadReport(false));
        
        document.querySelectorAll('.config-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const dropdown = button.nextElementSibling;
                if (dropdown) {
                    const isHidden = dropdown.classList.contains('hidden');
                    document.querySelectorAll('.column-config-dropdown').forEach(d => d.classList.add('hidden'));
                    if (isHidden) dropdown.classList.remove('hidden');
                }
            });
        });

        window.addEventListener('click', (e) => {
            if (!e.target.closest('.table-config-container')) {
                document.querySelectorAll('.column-config-dropdown').forEach(dropdown => {
                    dropdown.classList.add('hidden');
                });
            }
        });

        ui.reconciliationPanel.reconcileBtn.addEventListener('click', executeManualReconciliation);
        ui.reconciliationPanel.deReconcileBtn.addEventListener('click', executeDereconciliation);
        
        document.querySelector('.menu-item[data-tool="reconciler"]').click();

        const providerFilterInput = document.getElementById('provider-filter-input');
        providerFilterInput.addEventListener('input', () => {
            const filterValue = providerFilterInput.value.toLowerCase();
            const providerSelect = ui.providerAnalysis.providerSelect;
            
            for (const option of providerSelect.options) {
                if (option.value === "") {
                    continue;
                }
                const optionValue = option.value.toLowerCase();
                if (optionValue.includes(filterValue)) {
                    option.style.display = '';
                } else {
                    option.style.display = 'none';
                }
            }
        });
    }
    
    initialize();
});