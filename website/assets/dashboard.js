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

document.addEventListener("DOMContentLoaded", function () {
  var kpiTotal = document.getElementById("kpiTotalRiders");
  var kpiAvgChurn = document.getElementById("kpiAvgChurnProb");
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
      setText(kpiAvgChurn, kpis.avg_churn_prob.toFixed(1));
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

      chartBar(referralCanvas, ["Referred", "Not referred"], [referral.referred, referral.not_referred], "Riders");

      var pay = trip.payment_type || [];
      chartBar(
        paymentCanvas,
        pay.map(function (x) { return x.label; }),
        pay.map(function (x) { return x.count; }),
        "Trips"
      );
    })
    .catch(function (err) {
      if (!errorEl) return;
      setText(errorEl, String(err && err.message ? err.message : err));
      errorEl.style.display = "block";
    });
});
