function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

async function fetchJSON(path) {
  var url = typeof window.ridewiseUrl === "function" ? window.ridewiseUrl(path) : path;
  var resp = await fetch(url, { method: "GET" });
  if (!resp.ok) {
    var t = await resp.text();
    throw new Error(
      "Request failed: " + resp.status + " " + resp.statusText + (t ? " — " + t.slice(0, 120) : "")
    );
  }
  var raw = await resp.text();
  if (!raw) throw new Error("Empty response from " + url);
  return JSON.parse(raw);
}

function chartBar(canvas, labels, values, yAxisLabel) {
  var ctx = canvas.getContext("2d");
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
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
          title: yAxisLabel ? { display: true, text: yAxisLabel, color: "rgba(232,237,245,0.6)" } : undefined,
          ticks: { color: "rgba(232, 237, 245, 0.8)" },
          grid: { color: "rgba(94, 234, 212, 0.06)" },
        },
      },
    },
  });
}

function chartPie(canvas, labels, values) {
  var ctx = canvas.getContext("2d");
  return new Chart(ctx, {
    type: "pie",
    data: {
      labels: labels,
      datasets: [
        {
          data: values,
          backgroundColor: [
            "rgba(45, 212, 191, 0.9)",
            "rgba(59, 130, 246, 0.9)",
            "rgba(251, 191, 36, 0.9)",
            "rgba(168, 85, 247, 0.9)",
            "rgba(244, 114, 182, 0.9)",
            "rgba(34, 197, 94, 0.9)",
          ],
          borderColor: "rgba(10,14,23,0.75)",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: { color: "rgba(232, 237, 245, 0.85)", padding: 14 },
        },
        tooltip: { mode: "nearest", intersect: true },
      },
    },
  });
}

document.addEventListener("DOMContentLoaded", function () {
  var kpiTotal = document.getElementById("kpiTotalRiders");
  var kpiTrips = document.getElementById("kpiTripsAnalyzed");
  var kpiAvgMonetary = document.getElementById("kpiAvgMonetary");
  var kpiAvgSurge = document.getElementById("kpiAvgSurgeExposure");

  var revenueCanvas = document.getElementById("revenueBySegmentChart");
  var modesCanvas = document.getElementById("rideModesChart");
  var weatherCanvas = document.getElementById("weatherChart");
  var revenueAgeCanvas = document.getElementById("revenueAgeChart");
  var revenuePeriodCanvas = document.getElementById("revenuePeriodChart");
  var referralCanvas = document.getElementById("referralChart");
  var paymentCanvas = document.getElementById("paymentChart");

  var errorEl = document.getElementById("dashboardError");

  Promise.all([
    fetchJSON("/api/dashboard/kpis"),
    fetchJSON("/api/dashboard/revenue_by_segment"),
    fetchJSON("/api/dashboard/ride_modes"),
    fetchJSON("/api/dashboard/trip_aggregates"),
    fetchJSON("/api/dashboard/referral_split"),
  ])
    .then(function (results) {
      var kpis = results[0];
      var revenue = results[1];
      var modes = results[2];
      var trip = results[3];
      var referral = results[4];

      setText(kpiTotal, kpis.total_riders.toLocaleString());
      setText(kpiTrips, (kpis.trips_analyzed || 200000).toLocaleString());
      setText(kpiAvgMonetary, kpis.avg_monetary.toFixed(1));
      setText(kpiAvgSurge, kpis.avg_surge_exposure.toFixed(2));

      chartBar(revenueCanvas, revenue.labels, revenue.avg_monetary, "Avg monetary");
      chartBar(modesCanvas, modes.labels, modes.counts, "Count");

      var w = trip.trips_by_weather || [];
      chartBar(
        weatherCanvas,
        w.map(function (x) { return x.label; }),
        w.map(function (x) { return x.count; }),
        "Trips"
      );

      var age = trip.revenue_by_age_group || [];
      chartBar(
        revenueAgeCanvas,
        age.map(function (x) { return x.label; }),
        age.map(function (x) { return x.revenue; }),
        "Revenue"
      );

      var per = trip.revenue_by_period || [];
      chartBar(
        revenuePeriodCanvas,
        per.map(function (x) { return x.label; }),
        per.map(function (x) { return x.revenue; }),
        "Revenue"
      );

      chartPie(referralCanvas, ["Referred", "Not referred"], [referral.referred, referral.not_referred]);

      var pay = trip.payment_type || [];
      chartPie(
        paymentCanvas,
        pay.map(function (x) { return x.label; }),
        pay.map(function (x) { return x.count; })
      );
    })
    .catch(function (err) {
      if (!errorEl) return;
      setText(errorEl, String(err && err.message ? err.message : err));
      errorEl.style.display = "block";
    });
});
