function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

async function fetchJSON(url) {
  var resp = await fetch(url, { method: "GET" });
  if (!resp.ok) {
    throw new Error("Request failed: " + resp.status + " " + resp.statusText);
  }
  return await resp.json();
}

function chartBar(canvas, labels, values, labelText) {
  var ctx = canvas.getContext("2d");

  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: labelText || "",
          data: values,
          backgroundColor: "rgba(45, 212, 191, 0.25)",
          borderColor: "rgba(45, 212, 191, 0.95)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { mode: "index", intersect: false },
      },
      scales: {
        x: {
          ticks: { color: "rgba(232, 237, 245, 0.8)" },
          grid: { color: "rgba(94, 234, 212, 0.06)" },
        },
        y: {
          ticks: { color: "rgba(232, 237, 245, 0.8)" },
          grid: { color: "rgba(94, 234, 212, 0.06)" },
        },
      },
    },
  });
}

document.addEventListener("DOMContentLoaded", function () {
  var kpiTotal = document.getElementById("kpiTotalRiders");
  var kpiAvgChurn = document.getElementById("kpiAvgChurnProb");
  var kpiChurnRate = document.getElementById("kpiChurnRate");
  var kpiAvgMonetary = document.getElementById("kpiAvgMonetary");
  var kpiAvgSurge = document.getElementById("kpiAvgSurgeExposure");

  var revenueCanvas = document.getElementById("revenueBySegmentChart");
  var modesCanvas = document.getElementById("rideModesChart");
  var churnCanvas = document.getElementById("churnBySegmentChart");

  var errorEl = document.getElementById("dashboardError");

  Promise.all([
    fetchJSON("/api/dashboard/kpis"),
    fetchJSON("/api/dashboard/revenue_by_segment"),
    fetchJSON("/api/dashboard/ride_modes"),
    fetchJSON("/api/dashboard/churn_by_segment"),
  ])
    .then(function (results) {
      var kpis = results[0];
      var revenue = results[1];
      var modes = results[2];
      var churn = results[3];

      setText(kpiTotal, kpis.total_riders.toLocaleString());
      setText(kpiAvgChurn, (kpis.avg_churn_prob).toFixed(1));
      setText(kpiChurnRate, (kpis.churn_rate * 100).toFixed(1) + "%");
      setText(kpiAvgMonetary, kpis.avg_monetary.toFixed(1));
      setText(kpiAvgSurge, kpis.avg_surge_exposure.toFixed(2));

      chartBar(revenueCanvas, revenue.labels, revenue.avg_monetary, "Avg monetary");
      chartBar(modesCanvas, modes.labels, modes.counts, "Driver vehicle types");
      chartBar(churnCanvas, churn.labels, churn.churn_rates.map(function (x) { return x * 100; }), "Churn rate (%)");
    })
    .catch(function (err) {
      if (!errorEl) return;
      setText(errorEl, String(err && err.message ? err.message : err));
      errorEl.style.display = "block";
    });
});

