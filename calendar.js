// Kamkrle — calendar workspace rendering (month grid + month navigation).


// ---------- Calendar ----------
function renderCalendar() {
    const container = document.getElementById('calendar-days-container');
    container.innerHTML = '';

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    document.getElementById('current-month-year').innerText = `${monthNames[currentMonth]} ${currentYear}`;

    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
    const totalDaysInMonth = daysInMonth(currentYear, currentMonth);

    for (let i = 0; i < firstDayIndex; i++) {
        const blank = document.createElement('div');
        blank.className = 'calendar-day empty';
        container.appendChild(blank);
    }

    for (let day = 1; day <= totalDaysInMonth; day++) {
        const key = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayElement = document.createElement('div');
        dayElement.className = 'calendar-day' + (key === todayKey ? ' today' : '');

        const dayTasks = appDataStore[key] || [];
        const completed = dayTasks.filter(t => t.done).length;
        let pctLabel = '0%';
        let doneClass = '';

        if (dayTasks.length > 0) {
            const calculatedPct = Math.round((completed / dayTasks.length) * 100);
            pctLabel = `${calculatedPct}%`;
            if (calculatedPct === 100) doneClass = 'complete';
        }

        dayElement.setAttribute('aria-label', `${monthNames[currentMonth]} ${day}: ${dayTasks.length > 0 ? pctLabel + ' complete' : 'no tasks logged'}`);
        dayElement.innerHTML = `
            <span class="day-num">${day}</span>
            ${dayTasks.length > 0 ? `<span class="day-progress ${doneClass}">${pctLabel}</span>` : ''}
        `;
        container.appendChild(dayElement);
    }
}

function changeMonth(dir) {
    currentMonth += dir;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    else if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar();
}
