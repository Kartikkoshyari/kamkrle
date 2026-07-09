// Kamkrle — stats, 30-day trend chart, heatmap, and the downloadable PDF report.


// ---------- Downloadable monthly PDF report ----------
// Combines a rolling 30-day stats summary with a full visual calendar
// for whichever month is currently open in Calendar Workspace.
function downloadMonthlyReportPDF() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        alert('The PDF library did not load — check your connection and try again.');
        return;
    }

    const btn = document.getElementById('pdf-download-btn');
    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-round" style="animation: spin 1s linear infinite;">progress_activity</span> Generating...';

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const margin = 40;
        let y = margin;

        const displayName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.username) || (function () {
            try { return localStorage.getItem('kamkrle_guest_username') || ''; } catch (e) { return ''; }
        })();

        // ---- Header ----
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(20);
        doc.setTextColor(16, 150, 110);
        doc.text('Kamkrle — Monthly Report', margin, y);
        y += 22;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(100, 100, 100);
        const subtitle = `${monthNames[currentMonth]} ${currentYear}` + (displayName ? `  •  ${displayName}` : '');
        doc.text(subtitle, margin, y);
        y += 10;
        doc.setDrawColor(225, 225, 225);
        doc.line(margin, y, pageWidth - margin, y);
        y += 28;

        // ---- Rolling 30-day stats (always the last 30 days from today) ----
        let rollingTasks = 0, rollingCompletes = 0, perfectDays30 = 0;
        for (let i = 29; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = getFormattedDateKey(d);
            const set = appDataStore[key] || [];
            if (set.length > 0) {
                const completed = set.filter(t => t.done).length;
                rollingTasks += set.length;
                rollingCompletes += completed;
                if (completed === set.length) perfectDays30++;
            }
        }
        const rollingAvg = rollingTasks > 0 ? Math.round((rollingCompletes / rollingTasks) * 100) : 0;
        const todayTasks = appDataStore[todayKey] || [];
        const todayPct = todayTasks.length > 0 ? Math.round((todayTasks.filter(t => t.done).length / todayTasks.length) * 100) : 0;

        let currentStreak = 0;
        const dateRunner = new Date();
        for (let i = 0; i < 365; i++) {
            const key = getFormattedDateKey(dateRunner);
            const list = appDataStore[key];
            const isComplete = list && list.length > 0 && list.filter(t => t.done).length === list.length;
            if (isComplete) currentStreak++;
            else if (i > 0) break;
            dateRunner.setDate(dateRunner.getDate() - 1);
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(30, 30, 30);
        doc.text('Last 30 Days', margin, y);
        y += 22;

        const stats = [
            ['TODAY', `${todayPct}%`],
            ['30-DAY AVERAGE', `${rollingAvg}%`],
            ['CURRENT STREAK', `${currentStreak} Day${currentStreak === 1 ? '' : 's'}`],
            ['PERFECT DAYS (30D)', `${perfectDays30}`]
        ];
        const colWidth = (pageWidth - margin * 2) / 4;
        stats.forEach((s, idx) => {
            const x = margin + idx * colWidth;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8.5);
            doc.setTextColor(130, 130, 130);
            doc.text(s[0], x, y);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(17);
            doc.setTextColor(20, 20, 20);
            doc.text(s[1], x, y + 22);
        });
        y += 48;
        doc.setDrawColor(230, 230, 230);
        doc.line(margin, y, pageWidth - margin, y);
        y += 28;

        // ---- Full calendar grid for the currently viewed month ----
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(30, 30, 30);
        doc.text(`${monthNames[currentMonth]} ${currentYear} — Daily Completion`, margin, y);
        y += 20;

        const gridWidth = pageWidth - margin * 2;
        const cellSize = gridWidth / 7;
        const weekdayLabels = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        weekdayLabels.forEach((wd, i) => {
            doc.text(wd, margin + i * cellSize + cellSize / 2, y, { align: 'center' });
        });
        y += 10;

        const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
        const totalDays = daysInMonth(currentYear, currentMonth);
        const cellH = 34;
        let col = firstDayIndex;
        let rowY = y;

        for (let day = 1; day <= totalDays; day++) {
            const key = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayTasks = appDataStore[key] || [];
            const hasData = dayTasks.length > 0;
            const completed = dayTasks.filter(t => t.done).length;
            const pct = hasData ? Math.round((completed / dayTasks.length) * 100) : null;
            const x = margin + col * cellSize;

            if (hasData) {
                // Blend white toward emerald green based on completion %.
                const alpha = 0.15 + (pct / 100) * 0.7;
                doc.setFillColor(
                    Math.round(255 - (255 - 16) * alpha),
                    Math.round(255 - (255 - 185) * alpha),
                    Math.round(255 - (255 - 129) * alpha)
                );
            } else {
                doc.setFillColor(244, 244, 244);
            }
            doc.roundedRect(x + 2, rowY, cellSize - 4, cellH - 4, 3, 3, 'F');

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(60, 60, 60);
            doc.text(String(day), x + 7, rowY + 12);

            if (hasData) {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.setTextColor(30, 100, 75);
                doc.text(`${pct}%`, x + 7, rowY + 24);
            }

            col++;
            if (col > 6) {
                col = 0;
                rowY += cellH;
                if (rowY + cellH > pageHeight - margin && day < totalDays) {
                    doc.addPage();
                    rowY = margin;
                }
            }
        }

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(160, 160, 160);
        doc.text(`Generated ${new Date().toLocaleString()}`, margin, pageHeight - 20);

        doc.save(`Kamkrle-Report-${monthNames[currentMonth]}-${currentYear}.pdf`);
    } catch (e) {
        console.error('PDF generation failed:', e);
        alert('Could not generate the PDF. Please try again.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalLabel;
    }
}

// ---------- Metrics & chart ----------
function calculateAndRenderMetrics() {
    const realToday = new Date();
    const realMonth = realToday.getMonth();
    const realYear = realToday.getFullYear();

    // Today
    const todayTasks = appDataStore[todayKey] || [];
    const todayPct = todayTasks.length > 0 ? Math.round((todayTasks.filter(t => t.done).length / todayTasks.length) * 100) : 0;
    document.getElementById('stat-day-pct').innerText = `${todayPct}%`;

    // Perfect days — always based on the real current month, independent
    // of whichever month the user happens to be browsing in the calendar.
    let perfectDays = 0;
    const daysThisRealMonth = daysInMonth(realYear, realMonth);
    for (let d = 1; d <= daysThisRealMonth; d++) {
        const key = `${realYear}-${String(realMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const list = appDataStore[key];
        if (list && list.length > 0 && list.filter(t => t.done).length === list.length) {
            perfectDays++;
        }
    }
    document.getElementById('stat-perfect').innerText = perfectDays;

    // Current streak: consecutive fully-completed days counting back from
    // today. Today itself doesn't break the streak while still in progress.
    let currentStreak = 0;
    const dateRunner = new Date();
    for (let i = 0; i < 365; i++) {
        const key = getFormattedDateKey(dateRunner);
        const list = appDataStore[key];
        const isComplete = list && list.length > 0 && list.filter(t => t.done).length === list.length;

        if (isComplete) {
            currentStreak++;
        } else if (i > 0) {
            break;
        }
        dateRunner.setDate(dateRunner.getDate() - 1);
    }
    document.getElementById('stat-streak').innerText = `${currentStreak} Day${currentStreak === 1 ? '' : 's'}`;

    // 30-day rolling trend
    const labels = [];
    const chartValues = [];
    let rollingTasks = 0, rollingCompletes = 0;

    for (let i = 29; i >= 0; i--) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - i);
        const key = getFormattedDateKey(targetDate);

        labels.push(targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

        const set = appDataStore[key] || [];
        let pct = 0;
        if (set.length > 0) {
            pct = Math.round((set.filter(t => t.done).length / set.length) * 100);
            rollingTasks += set.length;
            rollingCompletes += set.filter(t => t.done).length;
        }
        chartValues.push(pct);
    }

    const rollingAvg = rollingTasks > 0 ? Math.round((rollingCompletes / rollingTasks) * 100) : 0;
    document.getElementById('stat-month-pct').innerText = `${rollingAvg}%`;

    render30DayChart(labels, chartValues);
    renderRoutineHeatmap();
}

// 30-day heatmap shown directly on the Daily Routine tab (below the
// checklist) so consistency is visible without switching tabs.
function renderRoutineHeatmap() {
    const container = document.getElementById('routine-heatmap-grid');
    if (!container) return;
    container.innerHTML = '';

    const successRgb = getComputedStyle(document.documentElement).getPropertyValue('--success-rgb').trim() || '45, 212, 167';

    for (let i = 29; i >= 0; i--) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - i);
        const key = getFormattedDateKey(targetDate);

        const set = appDataStore[key] || [];
        const hasData = set.length > 0;
        const pct = hasData ? Math.round((set.filter(t => t.done).length / set.length) * 100) : 0;

        const cell = document.createElement('div');
        cell.className = 'heatmap-cell' + (key === todayKey ? ' today' : '');
        cell.style.background = hasData
            ? `rgba(${successRgb}, ${(0.12 + (pct / 100) * 0.88).toFixed(2)})`
            : 'var(--heatmap-empty)';

        const dateLabel = targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const a11yLabel = hasData ? `${dateLabel}: ${pct}% complete` : `${dateLabel}: no tasks logged`;
        cell.setAttribute('aria-label', a11yLabel);
        cell.title = a11yLabel;

        container.appendChild(cell);
    }
}

function render30DayChart(labels, values) {
    const ctx = document.getElementById('monthlyTrendsChart').getContext('2d');
    if (analyticsChartInstance) analyticsChartInstance.destroy();

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim() || '#7c6ff2';
    const accentSoft = styles.getPropertyValue('--accent-soft').trim() || 'rgba(124, 111, 242, 0.16)';
    const gridColor = styles.getPropertyValue('--chart-grid').trim() || 'rgba(255,255,255,0.05)';
    const tickColor = styles.getPropertyValue('--chart-tick').trim() || '#93a0bd';

    analyticsChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                borderColor: accent,
                backgroundColor: accentSoft,
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointRadius: 2,
                pointHoverRadius: 5,
                pointBackgroundColor: accent
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { min: 0, max: 100, grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { color: tickColor, font: { size: 9 }, maxRotation: 45 } }
            }
        }
    });
}
