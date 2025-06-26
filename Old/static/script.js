const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COMPLEXITY_BASE = 4.5; // Define the complexity base constant
let projectCounter = 0;

// Save projects to localStorage
function updateTotalArea() {
    // Use projectsData which holds the latest data from the backend, including rounded_adjusted
    const totalArea = projectsData.reduce((sum, project) => sum + (project.original_hours || 0), 0);
    const adjustedArea = projectsData.reduce((sum, project) => {
        // Use rounded_adjusted directly from the backend calculation result stored in projectsData
        return sum + (project.muted ? 0 : (project.rounded_adjusted || 0));
    }, 0);
    document.getElementById('total-area-value').textContent = totalArea.toLocaleString();
    document.getElementById('adjusted-area-value').textContent = adjustedArea.toLocaleString();
}

function saveProjects() {
    // Save quarterly capacities
    const quarterlyCapacities = {};
    document.querySelectorAll('.quarterly-capacity-input').forEach(input => {
        // Ensure value is parsed as integer, default to 0 if invalid
        const value = parseInt(input.value);
        quarterlyCapacities[input.dataset.quarterKey] = isNaN(value) ? 0 : value;
    });
    localStorage.setItem('quarterlyCapacities', JSON.stringify(quarterlyCapacities));

    const projects = getProjectsData();
    localStorage.setItem('projects', JSON.stringify(projects));
    localStorage.setItem('timelineWeeks', document.getElementById('timeline-weeks').value);

    // Save group sales speeds
    saveGroupSalesSpeeds();
    
    // Save pre-sales lead times
    savePreSalesLeadTimes();

    updateTotalArea();
}

// Function to save group sales speeds, merging with existing stored values
function saveGroupSalesSpeeds() {
    // Load existing speeds first
    const savedSpeeds = localStorage.getItem('groupSalesSpeeds');
    const groupSalesSpeeds = savedSpeeds ? JSON.parse(savedSpeeds) : {};

    // Update with values from current inputs
    document.querySelectorAll('.group-sales-speed-input').forEach(input => {
        const groupName = input.dataset.groupName;
        const speed = parseFloat(input.value); // Use parseFloat
        // Update or add the speed for this group
        groupSalesSpeeds[groupName] = isNaN(speed) || speed < 0 ? 0.0 : speed; // Default to 0.0 if invalid or negative
    });
    // Save the potentially merged object back to local storage
    localStorage.setItem('groupSalesSpeeds', JSON.stringify(groupSalesSpeeds));
}


// Load projects from localStorage
async function loadProjects() {
    const savedProjects = localStorage.getItem('projects');
    const timelineWeeks = localStorage.getItem('timelineWeeks');
    const savedQuarterlyCapacities = localStorage.getItem('quarterlyCapacities');
    const quarterlyCapacities = savedQuarterlyCapacities ? JSON.parse(savedQuarterlyCapacities) : {};
    const savedGroupSalesSpeeds = localStorage.getItem('groupSalesSpeeds');
    const groupSalesSpeeds = savedGroupSalesSpeeds ? JSON.parse(savedGroupSalesSpeeds) : {};
    const savedPreSalesLeadTimes = localStorage.getItem('preSalesLeadTimes');
    const preSalesLeadTimes = savedPreSalesLeadTimes ? JSON.parse(savedPreSalesLeadTimes) : {};

    let loadedProjects = [];
    if (savedProjects) {
        loadedProjects = JSON.parse(savedProjects);
        // Clear existing dynamically added projects before loading
        document.getElementById('projects-list').innerHTML = '';
        projectCounter = 0; // Reset counter

        loadedProjects.forEach(project => {
            addProject(); // This increments projectCounter
            const projectEntries = document.querySelectorAll('.project-entry');
            const lastEntry = projectEntries[projectEntries.length - 1];
            const inputs = lastEntry.querySelectorAll('input'); // Use querySelectorAll for better targeting

            // Find inputs by a more robust method if needed, assuming order for now
            inputs[0].value = project.name; // Name
            inputs[1].value = project.start_week; // Start Week
            inputs[2].value = project.original_hours; // Area
            inputs[3].value = project.complexity || 4.5; // Complexity
            inputs[4].value = project.units || ''; // Units
            inputs[5].value = project.group || ''; // Group
            
            // Apply pre-sales lead time from separate storage
            if (preSalesLeadTimes && preSalesLeadTimes[project.name] !== undefined) {
                project.pre_sales_lead_months = preSalesLeadTimes[project.name];
            }
            
            const internalCheckbox = lastEntry.querySelector('input[type="checkbox"]');
            if (internalCheckbox) {
                internalCheckbox.checked = project.is_internal || false; // Default to false if missing
            }
            lastEntry.dataset.muted = project.muted ? 'true' : 'false';
        });
    }

    if (timelineWeeks) {
        document.getElementById('timeline-weeks').value = timelineWeeks;
    }

    // Generate and populate quarterly capacity inputs AFTER setting timeline weeks
    await updateQuarterlyCapacityInputs(quarterlyCapacities);

    // Update sales speed inputs based on loaded projects and saved speeds
    updateGroupSalesSpeedInputs(getUniqueGroupNames(loadedProjects), groupSalesSpeeds);
    // Pre-sales lead inputs are now updated from within updateGroupSalesSpeedInputs
}

// Helper function to get unique group names from project data
function getUniqueGroupNames(projects) {
    const groupNames = new Set();
    projects.forEach(p => {
        if (p.group && p.units && !isNaN(parseInt(p.units)) && parseInt(p.units) > 0) {
            groupNames.add(p.group);
        }
    });
    return Array.from(groupNames);
}

// Function to generate/update group sales speed inputs
function updateGroupSalesSpeedInputs(groups, savedSpeeds) {
    const container = document.getElementById('group-sales-speed-controls');
    container.innerHTML = ''; // Clear existing inputs
    const defaultSpeed = 5;

    groups.sort().forEach(groupName => {
        const speed = savedSpeeds && savedSpeeds[groupName] !== undefined ? savedSpeeds[groupName] : defaultSpeed;

        const groupDiv = document.createElement('div');
        groupDiv.className = 'sales-speed-input-group';

        const label = document.createElement('label');
        label.textContent = `${groupName} Sales/Month`;
        label.htmlFor = `sales-speed-${groupName}`;

        const input = document.createElement('input');
        input.type = 'number';
        input.id = `sales-speed-${groupName}`;
        input.className = 'group-sales-speed-input';
        input.dataset.groupName = groupName;
        input.value = speed;
        input.min = "0"; // Sales speed cannot be negative
        input.step = "0.1"; // Allow decimal increments

        // Add event listener to save and recalculate on change
        input.addEventListener('change', () => {
            saveGroupSalesSpeeds();
            calculateAndDraw();
        });
         input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                saveGroupSalesSpeeds();
                calculateAndDraw();
            }
        });


        groupDiv.appendChild(label);
        groupDiv.appendChild(input);
        container.appendChild(groupDiv);
    });
    
    // After adding sales speed inputs, update pre-sales lead inputs
    updatePreSalesLeadInputs();
}

// Function to generate/update pre-sales lead inputs
function updatePreSalesLeadInputs() {
    const container = document.getElementById('pre-sales-lead-controls');
    container.innerHTML = ''; // Clear existing inputs
    
    // Get projects with non-empty units and group
    const projects = getProjectsData().filter(p => 
        p.units && p.units.trim() !== '' && 
        p.group && p.group.trim() !== '' && 
        !isNaN(parseInt(p.units)) && parseInt(p.units) > 0
    );
    
    if (projects.length === 0) {
        return; // No eligible projects
    }
    
    // Add header
    const header = document.createElement('h4');
    header.textContent = 'Pre-Sales Lead Times';
    header.className = 'pre-sales-header';
    container.appendChild(header);
    
    // Sort projects by name
    projects.sort((a, b) => a.name.localeCompare(b.name)).forEach(project => {
        const projectDiv = document.createElement('div');
        projectDiv.className = 'pre-sales-input-group';
        
        const label = document.createElement('label');
        label.textContent = `${project.name} (${project.group}) Lead Months`;
        label.htmlFor = `pre-sales-lead-${project.name}`;
        
        const input = document.createElement('input');
        input.type = 'number';
        input.id = `pre-sales-lead-${project.name}`;
        input.className = 'project-pre-sales-lead-input';
        input.dataset.projectName = project.name;
        input.value = project.pre_sales_lead_months || 0;
        input.min = "0";
        input.step = "1";
        
        // Add event listener to save and recalculate on change
        input.addEventListener('change', () => {
            savePreSalesLeadTimes();
            calculateAndDraw();
        });
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                savePreSalesLeadTimes();
                calculateAndDraw();
            }
        });
        
        projectDiv.appendChild(label);
        projectDiv.appendChild(input);
        container.appendChild(projectDiv);
    });
}

// Function to save pre-sales lead times, merging with existing stored values
function savePreSalesLeadTimes() {
    // Load existing lead times first
    const savedLeadTimes = localStorage.getItem('preSalesLeadTimes');
    const preSalesLeadTimes = savedLeadTimes ? JSON.parse(savedLeadTimes) : {};

    // Update with values from current inputs
    document.querySelectorAll('.project-pre-sales-lead-input').forEach(input => {
        const projectName = input.dataset.projectName;
        const leadMonths = parseInt(input.value);
        // Update or add the lead time for this project
        preSalesLeadTimes[projectName] = isNaN(leadMonths) || leadMonths < 0 ? 0 : leadMonths;
    });
    // Save the potentially merged object back to local storage
    localStorage.setItem('preSalesLeadTimes', JSON.stringify(preSalesLeadTimes));
    
    // This section was causing the error - removing it completely
    // as getProjectsData() already reads from localStorage when needed
}


// Call loadProjects and calculate when the page loads
window.addEventListener('load', async () => {
    await loadProjects();
    calculateAndDraw();
});

window.addEventListener('storage', (event) => {
    if (event.key === 'quarterlyCapacities') {
        console.log('Quarterly capacities updated externally. Reloading data...');
        const newCapacities = JSON.parse(event.newValue || '{}');
        updateQuarterlyCapacityInputs(newCapacities);
        calculateAndDraw();
    } else if (event.key === 'timelineWeeks') {
        console.log('Timeline weeks updated externally. Reloading data...');
        document.getElementById('timeline-weeks').value = event.newValue || '60';
        updateQuarterlyCapacityInputs();
        calculateAndDraw();
    }
});

// Function to generate/update quarterly capacity inputs
async function updateQuarterlyCapacityInputs(savedCapacities = null) {
    const timelineWeeksValue = document.getElementById('timeline-weeks').value;
    const timelineWeeks = parseInt(timelineWeeksValue) || 0;
    if (isNaN(timelineWeeks) || timelineWeeks <= 0) {
        console.error("Invalid timeline weeks value:", timelineWeeksValue);
        return; // Don't generate inputs if timeline is invalid
    }

    const container = document.getElementById('quarterly-capacity-header');
    const existingCapacities = savedCapacities || JSON.parse(localStorage.getItem('quarterlyCapacities') || '{}');
    const defaultCapacity = 450;

    // Clear existing inputs
    container.innerHTML = '';

    // Get quarters from server
    const response = await fetch(`/api/quarters?weeks=${timelineWeeks}`);
    const quarters = await response.json();

    quarters.forEach(({ quarter, year, weekCount }) => {
        const quarterKey = `${year}-Q${quarter}`;
        let value = existingCapacities[quarterKey];
        if (value === undefined || value === null || isNaN(parseInt(value))) {
            value = defaultCapacity;
        } else {
            value = parseInt(value);
        }

        // Create a container for the quarter label marker + input group
        const quarterItemDiv = document.createElement('div');
        quarterItemDiv.className = 'quarterly-capacity-item';
        quarterItemDiv.style.flex = weekCount; // Make the *item* span the correct number of weeks

        // Part 1: The visual marker spanning the quarter width
        const quarterLabelMarker = document.createElement('div');
        quarterLabelMarker.className = 'quarter-label-marker';
        // quarterLabelMarker.style.flex = weekCount; // Flex is now handled by parent item
        quarterLabelMarker.textContent = `Q${quarter}`;
        quarterLabelMarker.title = `Quarter ${year} Q${quarter}`;

        // Part 2: The input group placed next to the marker
        const inputGroupDiv = document.createElement('div');
        inputGroupDiv.className = 'quarter-input-group';

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'input-wrapper';

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'quarterly-capacity-input';
        input.dataset.quarterKey = quarterKey;
        input.value = value;
        input.min = "0"; // Capacity cannot be negative
        input.title = `Capacity for ${year} Q${quarter}`; // Add tooltip for clarity

        const controls = document.createElement('div');
        controls.className = 'input-controls vertical-controls'; // Use vertical layout

        const upBtn = document.createElement('button');
        upBtn.className = 'control-btn up';
        upBtn.textContent = '▲';

        const downBtn = document.createElement('button');
        downBtn.className = 'control-btn down';
        downBtn.textContent = '▼';

        controls.appendChild(upBtn);
        controls.appendChild(downBtn);

        inputWrapper.appendChild(input);
        inputWrapper.appendChild(controls);
        inputGroupDiv.appendChild(inputWrapper); // Add wrapper to the group

        quarterItemDiv.appendChild(quarterLabelMarker);
        quarterItemDiv.appendChild(inputGroupDiv);
        container.appendChild(quarterItemDiv);

        // Add event listeners for the new input
        setupNumberInput(input, upBtn, downBtn);
    });
    saveProjects();
}

// Modal functions
function openProjectModal() {
    const modal = document.getElementById('projectModal');
    modal.style.display = 'block';
}

function closeProjectModal() {
    const modal = document.getElementById('projectModal');
    modal.style.display = 'none';
    saveProjects();
    calculateAndDraw();
}

// Close modal when clicking outside of it
window.addEventListener('click', function(event) {
    const modal = document.getElementById('projectModal');
    if (event.target === modal) {
        closeProjectModal();
    }
});

function moveProjectUp(button) {
    const projectEntry = button.closest('.project-entry');
    const prev = projectEntry.previousElementSibling;
    if (prev) {
        projectEntry.parentNode.insertBefore(projectEntry, prev);
        saveProjects();
        calculateAndDraw();
    }
}

function moveProjectDown(button) {
    const projectEntry = button.closest('.project-entry');
    const next = projectEntry.nextElementSibling;
    if (next) {
        projectEntry.parentNode.insertBefore(next, projectEntry);
        saveProjects();
        calculateAndDraw();
    }
}

function addProject() {
    const projectsList = document.getElementById('projects-list');
    const projectDiv = document.createElement('div');
    projectDiv.className = 'project-entry';
    projectDiv.innerHTML = `
        <div class="move-buttons">
            <button onclick="moveProjectUp(this)">▲</button>
            <button onclick="moveProjectDown(this)">▼</button>
        </div>
        <label>
            Project Name
            <input type="text" value="Project${projectCounter + 1}">
        </label>
        <label>
            Start Week
            <input type="number" value="1" min="1">
        </label>
        <label>
            Area (m2)
            <input type="number" value="1000">
        </label>
        <label>
            Complexity
            <input type="number" value="4.5" step="0.1" min="0.1">
        </label>
        <label>
            Units
            <input type="number" value="" min="0" placeholder="e.g., 1">
        </label>
        <label>
            Group
            <input type="text" value="" placeholder="e.g., Team A">
        </label>
        <label class="checkbox-label">
            Internal
            <input type="checkbox">
        </label>
        <button onclick="this.parentElement.remove(); saveProjects();">Remove</button>
    `;
    projectsList.appendChild(projectDiv);
    projectCounter++;
    updateTotalArea(); // Update total area after adding
    saveProjects(); // Save after adding a project
}

function getProjectsData() {
    const projects = [];
    const savedPreSalesLeadTimes = localStorage.getItem('preSalesLeadTimes');
    const preSalesLeadTimes = savedPreSalesLeadTimes ? JSON.parse(savedPreSalesLeadTimes) : {};
    
    document.querySelectorAll('.project-entry').forEach(entry => {
        const inputs = entry.querySelectorAll('input'); // Use querySelectorAll
        const originalHours = parseInt(inputs[2].value);
        const complexity = parseFloat(inputs[3].value);
        const adjustedHours = (originalHours * complexity) / COMPLEXITY_BASE; // Use constant
        
        const projectName = inputs[0].value;
        const internalCheckbox = entry.querySelector('input[type="checkbox"]');
        
        // Get pre-sales lead months from the separate storage
        const preSalesLeadMonths = preSalesLeadTimes[projectName] !== undefined ? 
            preSalesLeadTimes[projectName] : 0;

        projects.push({
            name: projectName,
            start_week: parseInt(inputs[1].value),
            original_hours: originalHours,
            complexity: complexity,
            units: inputs[4].value, // Send raw string value
            group: inputs[5].value, // Send raw string value
            pre_sales_lead_months: isNaN(preSalesLeadMonths) || preSalesLeadMonths < 0 ? 0 : preSalesLeadMonths, // Add pre-sales lead
            remaining_hours: adjustedHours, // This will be recalculated by backend anyway
            muted: entry.dataset.muted === 'true',
            is_internal: internalCheckbox ? internalCheckbox.checked : false
        });
    });
    return projects;
}

let isDragging = false;
let currentProject = null;
let startX = 0;
let initialStartWeek = 0;
let weekWidth = 0;
let projectsData = [];
let currentProjectElement = null; // Store the DOM element being dragged
let draggedNewStartWeek = null; // Store the calculated new start week during drag

async function drawGanttChart(data) {
    const chartContainer = document.getElementById('ganttChart');
    chartContainer.innerHTML = ''; // Clear previous chart
    
    projectsData = data.projects; // Store projects data globally
    const projects = data.projects;
    const weeks = parseInt(document.getElementById('timeline-weeks').value);
    
    // Create timeline headers
    const timelineContainer = document.createElement('div');
    timelineContainer.className = 'timeline-container';
    
    // Create month/year header
    const monthHeader = document.createElement('div');
    monthHeader.className = 'month-header';
    
    // Get month labels from server
    const monthLabels = data.month_labels || [];
    monthLabels.forEach(label => {
        const monthMarker = document.createElement('div');
        monthMarker.className = 'month-marker';
        monthMarker.style.flex = label.weekCount;
        // Only show year for January
        const yearDisplay = label.month === 0 ? ` ${label.year}` : '';
        monthMarker.textContent = `${MONTH_NAMES[label.month]}${yearDisplay}`;
        monthHeader.appendChild(monthMarker);
    });
    timelineContainer.appendChild(monthHeader);
    
    // Create week number header
    const weekHeader = document.createElement('div');
    weekHeader.className = 'week-header';
    
    let currentMonth = monthLabels[0].month;
    
    // Only show week numbers if timeline is 100 weeks or less
    const showWeekNumbers = weeks <= 100;
    
    for (let i = 1; i <= weeks; i++) {
        const weekMarker = document.createElement('div');
        weekMarker.className = 'week-marker';
        
        // Check if this week is the last week of a month
        const label = monthLabels.find(l => l.startWeek + l.weekCount - 1 === i);
        if (label && label.month !== currentMonth) {
            weekMarker.classList.add('month-end');
            currentMonth = label.month;
        }
        
        weekMarker.textContent = showWeekNumbers ? i : '';
        weekHeader.appendChild(weekMarker);
    }
    timelineContainer.appendChild(weekHeader);
    
    chartContainer.appendChild(timelineContainer);
    
    // Calculate week width based on first week marker
    if (weekHeader.firstChild) {
        weekWidth = weekHeader.firstChild.offsetWidth;
    }
    
    // Create project bars
    projects.forEach((project, index) => {
        const projectRow = document.createElement('div');
        projectRow.className = 'project-row';
        
        // Project bar container (starts from left edge)
        const barContainer = document.createElement('div');
        barContainer.className = 'bar-container';
        barContainer.style.marginLeft = '0';
        
        // Empty space before start week (starting at week 1)
        const preSpace = document.createElement('div');
        preSpace.className = 'empty-space';
        preSpace.style.flex = project.start_week - 1;
        barContainer.appendChild(preSpace);
        
        // Project bar
        const projectBar = document.createElement('div');
        projectBar.className = 'project-bar';
        projectBar.style.flex = project.end_week - project.start_week;
        projectBar.style.backgroundColor = `hsl(${index * 360/projects.length}, 70%, 70%)`;
        if (project.muted) {
            projectBar.classList.add('muted');
        }

        // Add mute button after the project bar
        const muteButton = document.createElement('button');
        muteButton.className = 'mute-button' + (project.muted ? ' muted' : '');
        muteButton.textContent = getMuteButtonSymbol(project.muted);
        muteButton.onclick = (e) => {
            e.stopPropagation();
            // Find the project entry in the modal and update its muted state
            const projectEntries = document.querySelectorAll('.project-entry');
            projectEntries.forEach(entry => {
                const nameInput = entry.querySelector('input[type="text"]');
                if (nameInput.value === project.name) {
                    entry.dataset.muted = (!project.muted).toString();
                    updateTotalArea();
                }
            });
            project.muted = !project.muted;
            projectBar.classList.toggle('muted');
            muteButton.classList.toggle('muted');
            muteButton.textContent = getMuteButtonSymbol(project.muted);
            calculateAndDraw();
        };
        barContainer.appendChild(muteButton);
        
        // Create tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        tooltip.innerHTML = `
            <div>Week ${project.start_week} → Week ${project.end_week}</div>
            <div>Total Area (m2): ${project.original_hours}</div>
            <div>Complexity: ${project.complexity}</div>
            <div>Adjusted Area (m2): ${project.rounded_adjusted}</div>
        `;
        // Position tooltip relative to project bar
        projectBar.style.position = 'relative';
        
        // Add hover events
        projectBar.addEventListener('mouseenter', () => {
            tooltip.style.visibility = 'visible';
            tooltip.style.opacity = '1';
        });
        projectBar.addEventListener('mouseleave', () => {
            tooltip.style.visibility = 'hidden';
            tooltip.style.opacity = '0';
        });
        
        projectBar.appendChild(tooltip);
        
        // Add project name inside the bar
        const nameSpan = document.createElement('span');
        nameSpan.textContent = project.name;
        nameSpan.style.pointerEvents = 'none'; // Allow clicks to pass through to projectBar
        projectBar.appendChild(nameSpan);
        
        // Add drag handlers
        projectBar.addEventListener('mousedown', (e) => {
            isDragging = true;
            currentProject = project;
            currentProjectElement = projectBar; // Store the element
            startX = e.clientX;
            initialStartWeek = project.start_week;
            projectBar.parentElement.classList.add('dragging'); // Add class to container
            projectBar.style.cursor = 'grabbing';
            e.preventDefault(); // Prevent text selection
        });

        barContainer.appendChild(projectBar);
        
        // Empty space after end week (starting at week 1)
        const postSpace = document.createElement('div');
        postSpace.className = 'empty-space';
        postSpace.style.flex = weeks - project.end_week + 1;
        barContainer.appendChild(postSpace);
        
        projectRow.appendChild(barContainer);
        chartContainer.appendChild(projectRow);
    });
}

// Add mouse move and up listeners to document
document.addEventListener('mousemove', (e) => {
    if (isDragging && currentProject && weekWidth > 0) {
        const deltaX = e.clientX - startX;
        // Apply visual transform directly to the bar's container
        if (currentProjectElement) {
            currentProjectElement.parentElement.style.transform = `translateX(${deltaX}px)`;
        }

        // Calculate potential new start week but don't update data/redraw yet
        const weekDelta = Math.round(deltaX / weekWidth);
        draggedNewStartWeek = Math.max(1, initialStartWeek + weekDelta);
    }
});

// Need to track dragging state globally for capacity chart tooltip logic
// let isDragging = false; // Already declared globally earlier

document.addEventListener('mouseup', () => {
    // Handle Gantt chart drag end
    if (isDragging && currentProject && currentProjectElement) {
        // Remove dragging state and styles
        currentProjectElement.parentElement.classList.remove('dragging');
        currentProjectElement.parentElement.style.transform = ''; // Reset transform
        currentProjectElement.style.cursor = 'grab';

        // Update the project data with the final calculated start week
        const finalStartWeek = draggedNewStartWeek !== null ? draggedNewStartWeek : currentProject.start_week;
        const projectIndex = projectsData.findIndex(p => p.name === currentProject.name);
        if (projectIndex !== -1) {
            projectsData[projectIndex].start_week = finalStartWeek;
        }

        // Update the input field in the modal with the new start week
        const projectInputs = document.querySelectorAll('.project-entry');
        projectInputs.forEach(entry => {
            const nameInput = entry.querySelector('input[type="text"]');
            if (nameInput && nameInput.value === currentProject.name) {
                const startWeekInput = entry.querySelector('input[type="number"]'); // Assuming the second input is start week
                if (startWeekInput) {
                    startWeekInput.value = finalStartWeek;
                }
            }
        });

        // Reset state variables
        isDragging = false;
        currentProject = null;
        currentProjectElement = null;
        draggedNewStartWeek = null;

        // Recalculate the timeline and redraw everything based on the updated data
        calculateAndDraw();
    }
    // General cleanup for any drag operation (Gantt or Capacity)
    if (isDragging) {
        isDragging = false; // Reset global dragging flag
        // Hide capacity tooltip if it was left visible
        const capacityTooltip = document.getElementById('capacityTooltip');
        if (capacityTooltip) {
            capacityTooltip.style.display = 'none';
        }
        // Reset Gantt drag specific elements if they exist
        if (currentProjectElement) {
             currentProjectElement.parentElement.classList.remove('dragging');
             currentProjectElement.parentElement.style.transform = '';
             currentProjectElement.style.cursor = 'grab';
        }
        currentProject = null;
        currentProjectElement = null;
        draggedNewStartWeek = null;
    }
});

// Removed getDateForWeek and formatDate as backend handles date logic based on weeks

function getMuteButtonSymbol(isMuted) {
    return isMuted ? '✖' : '✔';
}

function exportState() {
    // Include quarterly capacities in the export
    const quarterlyCapacities = localStorage.getItem('quarterlyCapacities');
    const groupSalesSpeeds = localStorage.getItem('groupSalesSpeeds');
    const preSalesLeadTimes = localStorage.getItem('preSalesLeadTimes');
    const state = {
        projects: JSON.parse(localStorage.getItem('projects')),
        quarterlyCapacities: quarterlyCapacities ? JSON.parse(quarterlyCapacities) : {},
        groupSalesSpeeds: groupSalesSpeeds ? JSON.parse(groupSalesSpeeds) : {}, // Add sales speeds
        preSalesLeadTimes: preSalesLeadTimes ? JSON.parse(preSalesLeadTimes) : {}, // Add pre-sales lead times
        timelineWeeks: localStorage.getItem('timelineWeeks')
    };
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gantt_state.json';
    a.click();
    URL.revokeObjectURL(url);
}

function importState(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const state = JSON.parse(e.target.result);
        localStorage.setItem('projects', JSON.stringify(state.projects || []));
        // Store quarterly capacities from import, ensuring it's an object
        localStorage.setItem('quarterlyCapacities', JSON.stringify(state.quarterlyCapacities || {}));
        // Store group sales speeds from import, ensuring it's an object
        localStorage.setItem('groupSalesSpeeds', JSON.stringify(state.groupSalesSpeeds || {}));
        // Store pre-sales lead times from import, ensuring it's an object
        localStorage.setItem('preSalesLeadTimes', JSON.stringify(state.preSalesLeadTimes || {}));
        localStorage.setItem('timelineWeeks', state.timelineWeeks || '60');
        location.reload(); // Reload to apply the imported state
    };
    reader.readAsText(file);
}

async function calculateAndDraw() {
    // Collect quarterly capacities
    const quarterlyCapacities = {};
    document.querySelectorAll('.quarterly-capacity-input').forEach(input => {
        const value = parseInt(input.value);
        quarterlyCapacities[input.dataset.quarterKey] = (isNaN(value) || value < 0) ? 0 : value;
    });

    // Collect group sales speeds
    const groupSalesSpeeds = {};
    document.querySelectorAll('.group-sales-speed-input').forEach(input => {
        const groupName = input.dataset.groupName;
        const speed = parseFloat(input.value); // Use parseFloat
        groupSalesSpeeds[groupName] = isNaN(speed) || speed < 0 ? 0.0 : speed; // Default to 0.0
    });


    const projects = getProjectsData();
    const timelineWeeks = parseInt(document.getElementById('timeline-weeks').value);

    const data = {
        projects: projects,
        quarterly_capacities: quarterlyCapacities,
        group_sales_speeds: groupSalesSpeeds, // Add sales speeds to request
        timeline_weeks: timelineWeeks
    };

    const response = await fetch('/calculate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        // Add allocations to each project
        data.projects.forEach(project => {
            project.allocations = data.allocations[project.name];
        });
        // Update projects data with results from backend (like rounded_adjusted)
        projectsData = data.projects;

        drawGanttChart(data);

        // Update and save group sales speed inputs based on potentially new groups from calculation
        const currentGroups = getUniqueGroupNames(data.projects);
        updateGroupSalesSpeedInputs(currentGroups, data.group_sales_speeds); // Use speeds returned from backend
        saveProjects(); // Saves projects, timeline, capacities, and now sales speeds

        triggerCalculateComplete(); // Trigger event to update capacity chart

        renderGroupChart(data.group_units_over_time, timelineWeeks); // Render group chart with inventory data
    });
}

// Add event listeners for chart toggle buttons
document.getElementById('showCapacityChartBtn').addEventListener('click', () => switchChartView('capacity'));
document.getElementById('showGroupChartBtn').addEventListener('click', () => switchChartView('group'));

// Add event listeners for input changes and controls
const timelineWeeksInput = document.getElementById('timeline-weeks');

function setupNumberInput(input, upBtn, downBtn) {
    const step = 1; // Increment/decrement by 1

    upBtn.addEventListener('click', () => {
        input.value = parseInt(input.value) + step;
        saveProjects();
        calculateAndDraw();
    });

    downBtn.addEventListener('click', () => { // Allow capacity to go down to 0
        const minVal = input.min ? parseInt(input.min) : 0; // Respect min attribute if set
        input.value = Math.max(minVal, parseInt(input.value) - step);
        saveProjects();
        calculateAndDraw();
    });

    input.addEventListener('change', () => {
        // If the timeline weeks input changes, regenerate quarterly inputs
        if (input.id === 'timeline-weeks') {
            updateQuarterlyCapacityInputs();
        }
        saveProjects();
        calculateAndDraw();
    });

    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            // If the timeline weeks input changes, regenerate quarterly inputs
            if (input.id === 'timeline-weeks') {
                updateQuarterlyCapacityInputs();
            }
            saveProjects();
            calculateAndDraw();
        }
    });
}

// Setup controls for timeline weeks
const timelineWeeksControls = timelineWeeksInput.closest('.input-wrapper').querySelectorAll('.control-btn');
setupNumberInput(timelineWeeksInput, timelineWeeksControls[0], timelineWeeksControls[1]);

// Note: Event listeners for dynamically added quarterly inputs are set up within updateQuarterlyCapacityInputs

// Add initial project if none exist
if (!localStorage.getItem('projects')) {
    addProject();
}

// Capacity Chart functionality
// Moved capacityChart declaration to global scope

function setupCapacityChart() { // Renamed from DOMContentLoaded listener function
    const capacityContainer = document.getElementById('capacityChartContainer');
    const ctx = document.getElementById('capacityChart').getContext('2d');
    const defaultCapacity = 450;

    async function loadCapacityData() {
        const timelineWeeksValue = localStorage.getItem('timelineWeeks') || '60';
        const timelineWeeks = parseInt(timelineWeeksValue);
        const savedCapacities = JSON.parse(localStorage.getItem('quarterlyCapacities') || '{}');

        if (isNaN(timelineWeeks) || timelineWeeks <= 0) {
            console.error("Invalid timeline weeks found in localStorage:", timelineWeeksValue);
            return { labels: [], data: [], keys: [] };
        }

        // Get quarters from server
        const response = await fetch(`/api/quarters?weeks=${timelineWeeks}`);
        const quarters = await response.json();
        
        const labels = quarters.map(q => `${q.year} Q${q.quarter}`);
        const keys = quarters.map(q => `${q.year}-Q${q.quarter}`);
        const data = keys.map(key => {
            const savedValue = savedCapacities[key];
            return (savedValue !== undefined && savedValue !== null && !isNaN(parseInt(savedValue)) && parseInt(savedValue) >= 0)
                   ? parseInt(savedValue)
                   : defaultCapacity;
        });

        return { labels, data, keys };
    }

    // This function was duplicated - removing the first version

    function saveCapacityData(keys, data) {
        const quarterlyCapacities = {};
        keys.forEach((key, index) => {
            quarterlyCapacities[key] = Math.max(0, Math.round(data[index] || 0));
        });
        localStorage.setItem('quarterlyCapacities', JSON.stringify(quarterlyCapacities));

        // Trigger update in quarterly input fields as well
        updateQuarterlyInputsFromData(keys, data);

        // Broadcast change for other tabs/windows
        // localStorage.setItem triggers 'storage' event in other tabs
    }

    // Helper to update input fields when chart is dragged
    function updateQuarterlyInputsFromData(keys, data) {
        document.querySelectorAll('.quarterly-capacity-input').forEach(input => {
            const quarterKey = input.dataset.quarterKey;
            const keyIndex = keys.indexOf(quarterKey);
            if (keyIndex !== -1) {
                input.value = data[keyIndex];
            }
        });
    }


    async function renderCapacityChart() {
        // Only render if the container is visible or if the chart doesn't exist yet
        if (capacityContainer.classList.contains('hidden') && capacityChart) {
             return; // Don't render if hidden and already exists
        }

        const { labels, data, keys } = await loadCapacityData();

        // Update average capacity display
        const avg = data.length ? Math.round(data.reduce((sum, val) => sum + val, 0) / data.length) : 0;
        document.getElementById('average-capacity-value').textContent = avg.toLocaleString();

        try {
            if (capacityChart) {
                capacityChart.destroy();
            }
        } catch (e) {
            console.error("Error destroying previous capacity chart:", e);
            // If destruction fails, nullify the reference to allow creating a new one
            capacityChart = null;
        }


        try {
            capacityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: '',
                    data: data,
                    backgroundColor: 'rgba(75, 192, 192, 0.6)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 1,
                    pointRadius: 10,
                    pointHoverRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                aspectRatio: 6, // Increased aspect ratio to make the chart less tall
                animation: {
                    duration: 0 // Disable animations
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Capacity (Adjusted Area m²)'
                        },
                        suggestedMax: Math.max(...data) + 100
                    },
                    x: {
                        title: {
                            display: false // Hide x-axis title
                        },
                        ticks: {
                            display: true // Keep quarter labels visible
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        enabled: false, // Disable default tooltip
                    },
                    dragData: {
                        round: 0,
                        showTooltip: true,
                        onDragStart: function(e, element) {
                            // Set global dragging flag for capacity chart drag
                            isDragging = true;
                        },
                        onDrag: function(e, datasetIndex, index, value) {
                            e.target.style.cursor = 'grabbing';
                            // Show custom tooltip with live value during drag
                            const tooltip = document.getElementById('capacityTooltip');
                            if (tooltip) {
                                const roundedValue = Math.max(0, Math.round(value));
                                tooltip.innerHTML = `${roundedValue}`;
                                tooltip.style.left = `${e.x + 15}px`;
                                tooltip.style.top = `${e.y - 15}px`;
                                tooltip.style.display = 'block';
                            }
                        },
                        onHover: function(e, items) {
                            // Only show hover tooltip if not currently dragging
                            if (!isDragging && items.length) {
                                const point = items[0];
                                const quarter = capacityChart.data.labels[point.index];
                                const value = capacityChart.data.datasets[point.datasetIndex].data[point.index];

                                // Show custom tooltip
                                const tooltip = document.getElementById('capacityTooltip');
                                if (tooltip) {
                                    tooltip.innerHTML = `${quarter}: ${value}`;
                                    tooltip.style.left = `${e.x + 15}px`;
                                    tooltip.style.top = `${e.y - 15}px`;
                                    tooltip.style.display = 'block';
                                }
                            }
                        },
                        onLeave: function() {
                            const tooltip = document.getElementById('capacityTooltip');
                            // Hide tooltip only if not currently dragging
                            if (!isDragging && tooltip) {
                                tooltip.style.display = 'none';
                            }
                        },
                        onDragEnd: function(e, datasetIndex, index, value) {
                            isDragging = false; // Reset global dragging flag
                            e.target.style.cursor = 'default';
                            // Hide the tooltip
                            const tooltip = document.getElementById('capacityTooltip');
                            if (tooltip) {
                                tooltip.style.display = 'none';
                            }
                            const currentData = capacityChart.data.datasets[datasetIndex].data;
                            currentData[index] = Math.max(0, Math.round(value));
                            saveCapacityData(keys, currentData); // This now also updates inputs
                            // Recalculate the Gantt chart with new capacities
                            calculateAndDraw();
                        },
                    },
                    legend: {
                         display: false // Hide legend as title is sufficient
                    }
                },
                dragData: true,
                dragX: false,
            }
        });
        } catch (e) {
             console.error("Error creating capacity chart:", e);
        }
    }

    // Initial render
    renderCapacityChart();

    // Update chart when timeline changes (capacities handled by saveCapacityData -> calculateAndDraw)
    document.getElementById('timeline-weeks').addEventListener('change', renderCapacityChart);

    // Also update when the calculate button is clicked (or data changes)
    document.addEventListener('calculateComplete', renderCapacityChart);

    // Listen for direct changes to capacity inputs (e.g., manual typing)
    document.getElementById('quarterly-capacity-header').addEventListener('change', (event) => {
        if (event.target.classList.contains('quarterly-capacity-input')) {
            renderCapacityChart(); // Re-render chart to reflect manual input change
        }
    });

} // End of setupCapacityChart function

// Create a custom event to trigger chart updates
function triggerCalculateComplete() {
    document.dispatchEvent(new CustomEvent('calculateComplete'));
}

// Initialize chart setup and load initial view preference
document.addEventListener('DOMContentLoaded', () => {
    setupCapacityChart(); // Setup capacity chart listeners and initial render
    const savedView = localStorage.getItem('activeChartView') || 'capacity'; // Default to capacity
    switchChartView(savedView); // Show the last active or default view
});

let groupChart = null;
let capacityChart = null; // Make capacityChart global as well

// Function to switch between chart views
function switchChartView(viewToShow) {
    const capacityContainer = document.getElementById('capacityChartContainer');
    const groupContainer = document.getElementById('groupChartContainer');
    const capacityBtn = document.getElementById('showCapacityChartBtn');
    const groupBtn = document.getElementById('showGroupChartBtn');

    // If clicking the currently active view, hide both
    if ((viewToShow === 'capacity' && capacityBtn.classList.contains('active')) ||
        (viewToShow === 'group' && groupBtn.classList.contains('active'))) {
        capacityContainer.classList.add('hidden');
        groupContainer.classList.add('hidden');
        capacityBtn.classList.remove('active');
        groupBtn.classList.remove('active');
        localStorage.removeItem('activeChartView');
        return;
    }

    if (viewToShow === 'capacity') {
        capacityContainer.classList.remove('hidden');
        groupContainer.classList.add('hidden');
        capacityBtn.classList.add('active');
        groupBtn.classList.remove('active');
        localStorage.setItem('activeChartView', 'capacity');
        // Ensure capacity chart is rendered if needed
        if (!capacityChart) {
             // Use setupCapacityChart instead of renderCapacityChart
             setupCapacityChart();
        }
    } else { // 'group'
        capacityContainer.classList.add('hidden');
        groupContainer.classList.remove('hidden');
        capacityBtn.classList.remove('active');
        groupBtn.classList.add('active');
        localStorage.setItem('activeChartView', 'group');
        // Ensure group chart is rendered if needed (data might need to be passed or fetched again)
        // We'll rely on calculateAndDraw to render the correct chart data
    }
}

function renderGroupChart(groupUnitsData, timelineWeeks) {
    const groupContainer = document.getElementById('groupChartContainer');
    // Only render if the container is visible or if the chart doesn't exist yet
    if (groupContainer.classList.contains('hidden') && groupChart) {
        return; // Don't render if hidden and already exists
    }
    const ctx = document.getElementById('groupChart').getContext('2d');
    const labels = Array.from({ length: timelineWeeks }, (_, i) => i + 1);
    const datasets = [];
    Object.keys(groupUnitsData).forEach((group, i) => {
        datasets.push({
            label: group,
            data: groupUnitsData[group],
            borderColor: `hsl(${i * 360 / Object.keys(groupUnitsData).length}, 70%, 50%)`,
            backgroundColor: `hsla(${i * 360 / Object.keys(groupUnitsData).length}, 70%, 50%, 0.5)`,
            fill: false,
            tension: 0.1
        });
    });
    if (groupChart) {
        groupChart.destroy();
    }
    groupChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 6, // Match capacity chart's aspect ratio
            animation: {
                duration: 0 // Disable animations like capacity chart
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Inventory (Units)' // Update Y-axis label
                    }
                },
                x: {
                    title: {
                        display: false // Hide x-axis title like capacity chart
                    },
                    ticks: {
                        display: true
                    }
                }
            },
            plugins: {
                legend: {
                    display: true // Show legend since we have multiple groups
                }
            }
        }
    });
}
